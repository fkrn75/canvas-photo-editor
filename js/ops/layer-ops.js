// layer-ops.js — 레이어 메뉴 확장 연산(정렬 / 복사한 레이어 / 잘라낸 레이어 / 투명도→마스크 / 마스크 적용).
// 모두 히스토리 1단계로 실행 취소된다.

import { Layer } from "../layers/layer.js";
import { AddLayerCommand } from "../history/commands/layer-structure-command.js";
import { PaintCommand } from "../history/commands/paint-command.js";
import {
  CompoundCommand, LayerShiftCommand, LayerPixelMaskCommand,
} from "../history/commands/layer-image-commands.js";
import {
  opaqueBounds, alignOffset, maskAlphaInBox, bakeMaskIntoAlpha, alphaToMaskData, makeOpaque,
} from "../engine/layer-image-ops.js";

const isVector = (L) => !!(L && (L.vectorText || L.vectorShape));
const isAdjustment = (L) => !!(L && L.type === "adjustment");

function cloneImg(img) {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

// 선택 영역 경계를 문서 안으로 자른 박스(없거나 비면 null)
function selectionBox(app) {
  const sel = app.selection, lm = app.layers;
  if (!sel?.active || !sel.bounds) return null;
  const b = sel.bounds;
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const r = Math.min(lm.width, b.x + b.w), btm = Math.min(lm.height, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

function hasAnyAlpha(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}

// ── 정렬 ──
// edge: "top" | "vcenter" | "bottom" | "left" | "hcenter" | "right"
// 기준: 선택 영역이 있으면 선택 경계, 없으면 캔버스. 레이어의 불투명 픽셀 경계를 기준에 맞춰 이동한다.
export function alignLayer(app, edge) {
  const L = app.layers.activeLayer;
  if (!L) { app.status("레이어가 없습니다."); return; }
  if (isAdjustment(L)) { app.status("조정 레이어는 정렬할 수 없습니다."); return; }
  if (L.lockPosition) { app.status("위치가 잠겨 있어 이동할 수 없습니다."); return; }
  if (L.lockImage) { app.status("이미지가 잠겨 있어 이동할 수 없습니다."); return; }
  const content = opaqueBounds(L.snapshot());
  if (!content) { app.status("레이어에 불투명한 픽셀이 없습니다."); return; }
  const lm = app.layers;
  const target = selectionBox(app) || { x: 0, y: 0, w: lm.width, h: lm.height };
  const { dx, dy } = alignOffset(content, target, edge);
  if (!dx && !dy) { app.status("이미 정렬되어 있습니다."); return; }
  const label = {
    top: "위쪽 가장자리 정렬", vcenter: "세로 가운데 정렬", bottom: "아래쪽 가장자리 정렬",
    left: "왼쪽 가장자리 정렬", hcenter: "가로 가운데 정렬", right: "오른쪽 가장자리 정렬",
  }[edge] || "정렬";
  app.history.execute(new LayerShiftCommand(lm, L, dx, dy, label));
}

// ── 복사한 레이어(Ctrl+J) ──
// 선택 영역이 있으면 활성 레이어의 그 부분(페더 포함)만 새 레이어로, 없으면 레이어 복제.
export function layerViaCopy(app) {
  const lm = app.layers, L = lm.activeLayer;
  if (!L) { app.status("레이어가 없습니다."); return; }
  const box = selectionBox(app);
  if (!box) { lm.duplicateLayer(); return; }
  if (isAdjustment(L)) { app.status("조정 레이어에는 복사할 픽셀이 없습니다."); return; }
  const img = L.ctx.getImageData(box.x, box.y, box.w, box.h);
  maskAlphaInBox(img, app.selection.mask, lm.width, box);
  if (!hasAnyAlpha(img)) { app.status("선택한 영역이 비어 있습니다."); return; }
  const nl = new Layer(lm.width, lm.height, "복사한 레이어");
  nl.ctx.putImageData(img, box.x, box.y);
  const cmd = new AddLayerCommand(lm, nl, lm.indexOf(L.id) + 1);
  cmd.label = "복사한 레이어";
  app.history.execute(cmd);
}

// ── 잘라낸 레이어(Shift+Ctrl+J) ──
// 선택 영역을 활성 레이어에서 지우고 그 픽셀로 새 레이어를 만든다(히스토리 1단계).
export function layerViaCut(app) {
  const lm = app.layers, L = lm.activeLayer;
  if (!L) { app.status("레이어가 없습니다."); return; }
  const box = selectionBox(app);
  if (!box) { app.status("먼저 영역을 선택하세요."); return; }
  if (isAdjustment(L)) { app.status("조정 레이어에는 잘라낼 픽셀이 없습니다."); return; }
  if (isVector(L)) { app.status("텍스트/셰이프 레이어는 잘라낼 수 없습니다(픽셀 레이어에서 사용하세요)."); return; }
  if (L.lockImage || L.lockTransparency) { app.status("레이어가 잠겨 있어 잘라낼 수 없습니다."); return; }
  const before = L.ctx.getImageData(box.x, box.y, box.w, box.h);
  const cut = maskAlphaInBox(cloneImg(before), app.selection.mask, lm.width, box);
  if (!hasAnyAlpha(cut)) { app.status("선택한 영역이 비어 있습니다."); return; }
  const after = maskAlphaInBox(cloneImg(before), app.selection.mask, lm.width, box, true);
  const nl = new Layer(lm.width, lm.height, "잘라낸 레이어");
  nl.ctx.putImageData(cut, box.x, box.y);
  const erase = new PaintCommand(lm, L.id, box.x, box.y, before, after, "잘라낸 레이어");
  const add = new AddLayerCommand(lm, nl, lm.indexOf(L.id) + 1);
  app.history.execute(new CompoundCommand("잘라낸 레이어", [erase, add]));
}

// 현재 레이어의 픽셀/마스크 상태 묶음(LayerPixelMaskCommand 용)
function maskState(L, pixels) {
  return {
    pixels,
    mask: L.mask || null,
    maskEnabled: L.maskEnabled,
    maskActive: L.maskActive,
    vectorMask: L.vectorMask || null,
  };
}

// ── 투명도에서 마스크 만들기 ──
// 레이어 알파를 그레이스케일 마스크로 옮기고 레이어 픽셀은 불투명하게 만든다(보이는 결과 동일).
// 텍스트/셰이프 레이어는 픽셀을 다시 그리는 레이어라(불투명화가 다음 렌더에서 사라짐) 지원하지 않는다.
export function maskFromTransparency(app) {
  const lm = app.layers, L = lm.activeLayer;
  if (!L) { app.status("레이어가 없습니다."); return; }
  if (isAdjustment(L)) { app.status("조정 레이어에는 투명도가 없습니다."); return; }
  if (L.mask) { app.status("이미 마스크가 있습니다. 먼저 마스크를 적용하거나 삭제하세요."); return; }
  if (isVector(L)) { app.status("텍스트/셰이프 레이어에는 사용할 수 없습니다(픽셀 레이어에서 사용하세요)."); return; }
  if (L.lockImage || L.lockTransparency) { app.status("레이어가 잠겨 있어 변경할 수 없습니다."); return; }
  const snap = L.snapshot();
  const m = document.createElement("canvas");
  m.width = lm.width; m.height = lm.height;
  const mctx = m.getContext("2d", { willReadFrequently: true });
  mctx.putImageData(new ImageData(alphaToMaskData(snap.data), snap.width, snap.height), 0, 0);
  const before = maskState(L, snap);
  const afterPixels = new ImageData(makeOpaque(new Uint8ClampedArray(snap.data)), snap.width, snap.height);
  const after = { pixels: afterPixels, mask: m, maskEnabled: true, maskActive: false, vectorMask: null };
  app.history.execute(new LayerPixelMaskCommand(lm, L, before, after, "투명도에서 마스크 만들기"));
  app.status("투명도로 레이어 마스크를 만들었습니다.");
}

// ── 레이어 마스크 적용 ──
// 마스크를 레이어 알파에 구워 넣고 마스크(및 벡터 마스크)를 제거한다.
export function applyLayerMask(app) {
  const lm = app.layers, L = lm.activeLayer;
  if (!L) { app.status("레이어가 없습니다."); return; }
  if (!L.mask) { app.status("적용할 레이어 마스크가 없습니다."); return; }
  if (isAdjustment(L)) { app.status("조정 레이어의 마스크는 적용할 수 없습니다."); return; }
  if (isVector(L)) { app.status("텍스트/셰이프 레이어에는 마스크를 적용할 수 없습니다(픽셀을 다시 그리는 레이어)."); return; }
  if (L.lockImage || L.lockTransparency) { app.status("레이어가 잠겨 있어 변경할 수 없습니다."); return; }
  const snap = L.snapshot();
  const mc = L.maskCtx || L.mask.getContext("2d", { willReadFrequently: true });
  const md = mc.getImageData(0, 0, L.mask.width, L.mask.height).data;
  const baked = cloneImg(snap);
  bakeMaskIntoAlpha(baked.data, md);
  const before = maskState(L, snap);
  const after = { pixels: baked, mask: null, maskEnabled: true, maskActive: false, vectorMask: null };
  app.history.execute(new LayerPixelMaskCommand(lm, L, before, after, "레이어 마스크 적용"));
  app.status("레이어 마스크를 적용했습니다.");
}
