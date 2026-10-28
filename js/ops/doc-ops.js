// doc-ops.js — 문서 전체 연산(이미지 크기 / 캔버스 크기 / 임의 각도 회전 / 재단 / 패턴 정의).
// app.js 의 resizeImage/resizeCanvas 를 대체하는 확장판. 모두 DocTransformVectorCommand 로 실행되어
// 픽셀·마스크·텍스트/셰이프/벡터 마스크 좌표까지 한 번에 실행 취소된다.
//
// [특수 레이어 규칙] (이동 도구 move-tool.js 와 같은 원칙: 픽셀을 바꾸면 벡터 소스 좌표도 같이 바꾼다)
//   · 크기 변경: 텍스트 위치·글자 크기, 셰이프 기하·획 두께, 벡터 마스크 패스를 같은 배율로 변환
//   · 캔버스 크기/재단: 기준점 오프셋만큼 평행 이동
//   · 임의 회전: 셰이프(사각형/다각형/패스)·벡터 마스크는 회전 변환, 회전을 표현할 수 없는
//     텍스트·타원·둥근 사각형은 벡터 데이터를 떼어 픽셀 레이어로 래스터화(undo 시 복원)
//   · 조정 레이어: 픽셀이 없으므로 캔버스만 새 크기로 교체

import { DocTransformVectorCommand } from "../history/commands/layer-image-commands.js";
import { resample } from "../engine/resample.js";
import {
  anchorOffset, rotatedSize, rotatePointFn, trimBounds,
  scaleVectorText, scaleVectorShape, scaleVectorMask, rotateVectorShape, mapPath,
} from "../engine/layer-image-ops.js";
import { runBusy } from "../ui/busy.js";
import { EVT } from "../core/constants.js";

function newCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true }) };
}

// 레이어의 벡터 소스 좌표를 축 정렬 변환(배율+이동)
function transformVectors(L, xf) {
  if (L.vectorText) L.vectorText = scaleVectorText(L.vectorText, xf);
  if (L.vectorShape) L.vectorShape = scaleVectorShape(L.vectorShape, xf);
  if (L.vectorMask) L.vectorMask = scaleVectorMask(L.vectorMask, xf);
}

// 확장 영역 채움 색 해석: "background" | "white" | "black" | "transparent" → CSS 색 또는 null
function resolveFill(app, fill) {
  if (fill === "background") return app.state.background;
  if (fill === "white") return "#ffffff";
  if (fill === "black") return "#000000";
  return null;
}

// 레이어 픽셀이 전부 불투명한지(포토샵 "배경 레이어"처럼 취급할지 판단)
function isFullyOpaque(L) {
  const d = L.ctx.getImageData(0, 0, L.width, L.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
  return true;
}

// 가이드([{orient:'h'|'v', pos}])를 문서 변환(배율 sx/sy + 이동 dx/dy)에 맞춰 옮긴다. (순수 함수)
//   v(수직선)는 x축, h(수평선)는 y축 값이라 각각 sx/dx, sy/dy 를 쓴다.
//   변환 결과가 새 문서 영역(0~w / 0~h) 밖이면 제거. xf 가 null 이면 변환 불가(회전 등) → 전부 제거.
export function transformGuides(guides, xf, w, h) {
  if (!xf || !Array.isArray(guides)) return [];
  const out = [];
  for (const g of guides) {
    const vert = g.orient === "v";
    const pos = Math.round(vert ? g.pos * xf.sx + xf.dx : g.pos * xf.sy + xf.dy);
    if (!Number.isFinite(pos) || pos < 0 || pos > (vert ? w : h)) continue;
    if (out.some((o) => o.orient === g.orient && o.pos === pos)) continue; // 변환 후 겹친 가이드 병합
    out.push({ orient: g.orient, pos });
  }
  return out;
}

// 문서 변환 후 공통 마무리: 선택 해제, 가이드 변환(xf=null 이면 비움), 뷰 맞춤.
// ※ 가이드는 undo 히스토리에 기록되지 않으므로 실행 취소해도 원래 위치로 복원되지 않는다(알려진 한계).
function finish(app, w, h, xf = null) {
  app.selection.clear();
  const st = app.state;
  if (st && Array.isArray(st.guides) && st.guides.length) {
    st.guides = transformGuides(st.guides, xf, w, h);
    app.bus?.emit(EVT.STATE_CHANGED, { key: "guides", value: st.guides });
  }
  app.viewport.fit(w, h);
}

// ── 이미지 크기(리샘플) ──
export function resizeImage(app, w, h, method = "bicubic") {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const lm = app.layers;
  const ow = lm.width, oh = lm.height;
  if (w === ow && h === oh) { app.status("크기가 같습니다."); return; }
  app._guardLargeSize(w, h, () => runBusy(app, "이미지 크기", () => {
    const xf = { sx: w / ow, sy: h / oh, dx: 0, dy: 0 };
    app.history.execute(new DocTransformVectorCommand(lm, "이미지 크기", (lm) => {
      for (const L of lm.layers) {
        const { c, ctx } = newCanvas(w, h);
        if (L.type !== "adjustment") {
          ctx.putImageData(resample(L.ctx.getImageData(0, 0, ow, oh), w, h, method), 0, 0);
        }
        L.canvas = c; L.ctx = ctx;
        if (L.mask) {
          const mc = L.maskCtx || L.mask.getContext("2d", { willReadFrequently: true });
          const m = newCanvas(w, h);
          m.ctx.putImageData(resample(mc.getImageData(0, 0, L.mask.width, L.mask.height), w, h, method), 0, 0);
          L.attachMask(m.c);
        }
        transformVectors(L, xf);
        L.thumbDirty = true;
      }
      lm.width = w; lm.height = h;
    }));
    finish(app, w, h, xf);
  }));
}

// ── 캔버스 크기 ──
// anchor: 0~8 기준점, fill: 확장 영역 색("background"|"white"|"black"|"transparent").
// 확장 영역 색은 맨 아래 픽셀 레이어에만 칠한다(포토샵: 배경 레이어만 색, 나머지는 투명).
export function resizeCanvas(app, w, h, anchor = 4, fill = "background") {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const lm = app.layers;
  const ow = lm.width, oh = lm.height;
  if (w === ow && h === oh) { app.status("크기가 같습니다."); return; }
  const { dx, dy } = anchorOffset(ow, oh, w, h, anchor);
  const color = resolveFill(app, fill);
  app._guardLargeSize(w, h, () => {
    app.history.execute(new DocTransformVectorCommand(lm, "캔버스 크기", (lm) => {
      lm.layers.forEach((L, i) => {
        L.resizeCanvas(w, h, dx, dy);
        const plain = L.type !== "adjustment" && !L.vectorText && !L.vectorShape;
        if (i === 0 && color && plain && (w > ow || h > oh)) {
          // 기존 이미지 사각형 바깥(확장된 부분)만 칠한다(evenodd 로 안쪽 구멍)
          const ctx = L.ctx;
          ctx.save();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.rect(dx, dy, ow, oh);
          ctx.fill("evenodd");
          ctx.restore();
        }
        transformVectors(L, { sx: 1, sy: 1, dx, dy });
        L.thumbDirty = true;
      });
      lm.width = w; lm.height = h;
    }));
    finish(app, w, h, { sx: 1, sy: 1, dx, dy });
  });
}

// ── 임의 각도 회전(캔버스 확장) ──
// deg: 시계 방향 양수(반시계는 음수로 넘긴다).
export function rotateArbitrary(app, deg) {
  deg = Number(deg) || 0;
  if (deg % 360 === 0) { app.status("회전 각도가 0°입니다."); return; }
  const lm = app.layers;
  const ow = lm.width, oh = lm.height;
  const { w: nw, h: nh } = rotatedSize(ow, oh, deg);
  const rad = (deg * Math.PI) / 180;
  const fn = rotatePointFn(ow, oh, nw, nh, deg);
  const bg = app.state.background;
  app._guardLargeSize(nw, nh, () => runBusy(app, "임의 각도 회전", () => {
    let rasterized = 0;
    app.history.execute(new DocTransformVectorCommand(lm, `회전 ${deg}°`, (lm) => {
      // 맨 아래 레이어가 완전 불투명이면(배경 레이어처럼) 드러난 모서리를 배경색으로 채운다
      const bottom = lm.layers[0];
      const fillBottom = !!bottom && bottom.type !== "adjustment" && isFullyOpaque(bottom);
      for (const L of lm.layers) {
        const { c, ctx } = newCanvas(nw, nh);
        if (L.type !== "adjustment") {
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.translate(nw / 2, nh / 2); ctx.rotate(rad);
          ctx.drawImage(L.canvas, -ow / 2, -oh / 2);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (L === bottom && fillBottom) {
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = bg; ctx.fillRect(0, 0, nw, nh);
            ctx.globalCompositeOperation = "source-over";
          }
        }
        L.canvas = c; L.ctx = ctx;
        if (L.mask) {
          // 드러난 모서리는 마스크 검정(가림) — Layer.resizeCanvas 와 같은 정책
          const m = newCanvas(nw, nh);
          m.ctx.fillStyle = "#000000"; m.ctx.fillRect(0, 0, nw, nh);
          m.ctx.imageSmoothingEnabled = true; m.ctx.imageSmoothingQuality = "high";
          m.ctx.translate(nw / 2, nh / 2); m.ctx.rotate(rad);
          m.ctx.drawImage(L.mask, -ow / 2, -oh / 2);
          m.ctx.setTransform(1, 0, 0, 1, 0, 0);
          L.attachMask(m.c);
        }
        // 벡터 소스: 회전 표현이 가능하면 변환, 아니면 래스터화(데이터 제거)
        if (L.vectorText) { L.vectorText = null; rasterized++; }
        if (L.vectorShape) {
          const r = rotateVectorShape(L.vectorShape, fn, deg);
          if (!r) rasterized++;
          L.vectorShape = r;
        }
        if (L.vectorMask?.path) L.vectorMask = { ...L.vectorMask, path: mapPath(L.vectorMask.path, fn) };
        L.thumbDirty = true;
      }
      lm.width = nw; lm.height = nh;
    }));
    finish(app, nw, nh, null); // 임의 각도 회전: 가이드는 의미를 잃으므로 비운다
    if (rasterized) app.status(`회전을 표현할 수 없는 텍스트/셰이프 레이어 ${rasterized}개를 픽셀로 래스터화했습니다.`);
  }));
}

// ── 재단(Trim) ──
// mode: "transparent" | "topLeft" | "bottomRight", sides: { top, bottom, left, right }
// 판정은 보이는 레이어 합성 결과 기준(포토샵과 동일).
export function trimDocument(app, mode = "transparent", sides = { top: true, bottom: true, left: true, right: true }) {
  const lm = app.layers;
  const flat = lm.flatten();
  const img = flat.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, lm.width, lm.height);
  const b = trimBounds(img, mode, sides);
  if (!b) { app.status("재단하면 이미지가 모두 사라집니다. 재단하지 않았습니다."); return; }
  if (b.x === 0 && b.y === 0 && b.w === lm.width && b.h === lm.height) { app.status("잘라낼 영역이 없습니다."); return; }
  app.history.execute(new DocTransformVectorCommand(lm, "재단", (lm) => {
    for (const L of lm.layers) {
      L.resizeCanvas(b.w, b.h, -b.x, -b.y);
      transformVectors(L, { sx: 1, sy: 1, dx: -b.x, dy: -b.y });
      L.thumbDirty = true;
    }
    lm.width = b.w; lm.height = b.h;
  }));
  finish(app, b.w, b.h, { sx: 1, sy: 1, dx: -b.x, dy: -b.y });
  app.status(`재단: ${b.w} × ${b.h}`);
}

// ── 패턴 정의 ──
// 선택 영역(사각 경계)이 있으면 그 부분, 없으면 문서 전체의 "보이는 합성 결과"를 패턴 타일로 등록한다.
// 등록처: app.state.patterns(패턴 도장 도구·패턴 메이커가 쓰는 레지스트리, {id,name,tile}).
let _patSeq = 0;
export function definePattern(app, name) {
  const lm = app.layers, sel = app.selection;
  const box = sel?.active && sel.bounds ? { ...sel.bounds } : { x: 0, y: 0, w: lm.width, h: lm.height };
  if (box.w < 1 || box.h < 1) { app.status("선택 영역이 비어 있습니다."); return; }
  const flat = lm.flatten();
  const { c: tile, ctx } = newCanvas(box.w, box.h);
  ctx.drawImage(flat, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  _patSeq += 1;
  const id = "defined-" + Date.now() + "-" + _patSeq;
  const label = (name && String(name).trim()) || `패턴 ${_patSeq}`;
  if (!Array.isArray(app.state.patterns)) app.state.patterns = [];
  // 배열 참조를 유지한 채 push(패턴 메이커 dialog 와 같은 방식 → 도장 도구가 그대로 인식)
  app.state.patterns.push({ id, name: label, tile });
  app.state.set("patternIndex", app.state.patterns.length - 1);
  if (app.tools?.activeId === "patternstamp") app.optionsBar?._render?.();
  app.status(`"${label}"(${box.w}×${box.h})을(를) 패턴으로 정의했습니다. (패턴 도장 도구에서 사용)`);
}
