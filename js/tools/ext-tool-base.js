// ext-tool-base.js — 확장 도구 공통 보조.
//   - ensureDefaults: 새 도구 옵션의 state 기본값 등록(state.js를 건드리지 않고 도구 생성 시 1회 채움)
//   - drawBrushCursor: 브러시 원형 커서(기존 픽셀 도구와 같은 모양)
//   - DabPixelTool: "원형 dab을 찍으며 work 버퍼를 고치고 bbox dirty-rect로 flush"하는 픽셀 도구 기반
//     (배경 지우개·색상 대체가 상속). blur-sharpen-smudge-tool의 work/_flush 패턴과 같다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";

// state에 key가 아직 없을 때만 기본값을 넣는다(옵션바 슬라이더가 undefined를 읽지 않게).
export function ensureDefaults(state, defs) {
  for (const k in defs) if (state[k] === undefined) state[k] = defs[k];
}

// 레이어 픽셀을 직접 바꾸는 확장 도구가 거부해야 하는 상황의 안내 문구(없으면 null).
//   - 빠른 마스크 / 레이어 마스크 편집 중: 이 도구들은 레이어 픽셀만 고치므로 마스크 대상이 아니다
//     (paint-tool 의 "빠른마스크 > 레이어마스크 > 레이어픽셀" 분기와 같은 판정 기준)
//   - 조정 레이어: 픽셀이 없다 / 텍스트·셰이프 레이어: 다음 렌더에서 벡터 소스로 다시 그려져 편집이 사라진다
export function pixelEditBlocker(layer, app = null) {
  if (!layer) return null;
  if (app?.quickMask?.active) return "빠른 마스크 편집 중에는 이 도구를 쓸 수 없습니다. 빠른 마스크를 먼저 종료하세요.";
  if (layer.maskActive && layer.mask) return "레이어 마스크 편집 중에는 이 도구를 쓸 수 없습니다. 레이어 썸네일을 선택해 픽셀 편집 모드로 바꾸세요.";
  if (layer.type === "adjustment") return "조정 레이어에는 픽셀이 없어 사용할 수 없습니다.";
  if (layer.vectorText || layer.vectorShape) return "텍스트/셰이프 레이어에는 사용할 수 없습니다(픽셀 레이어에서 사용하세요).";
  return null;
}

// 화면 좌표계 오버레이에 브러시 크기 원형 커서를 그린다.
export function drawBrushCursor(ctx, vp, pt, size) {
  if (!pt) return;
  const c = vp.worldToScreen(pt.x, pt.y);
  const r = Math.max(0.5, size / 2) * vp.zoom;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
  ctx.beginPath(); ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
  // 중심 십자(샘플링 지점 표시)
  ctx.beginPath();
  ctx.moveTo(c.x - 3, c.y); ctx.lineTo(c.x + 3, c.y);
  ctx.moveTo(c.x, c.y - 3); ctx.lineTo(c.x, c.y + 3);
  ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.stroke();
  ctx.restore();
}

// 원형 dab 픽셀 도구 기반. 하위 클래스는 label, _beginStroke(pt, e), _dab(x, y, r) 를 구현한다.
//   this.before: stroke 시작 시점 원본(ImageData) — 비교·샘플링 기준
//   this.work:   결과 버퍼(ImageData) — _dab이 고치고 _flush가 변경 bbox만 캔버스에 반영
//   this.str:    픽셀별 최대 강도(Uint8Array) — dab이 겹쳐도 누적되지 않게(lighten)
export class DabPixelTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
  }

  get cursor() { return "none"; }
  get label() { return "브러시"; }

  // 잠금 등 추가 거부 조건(하위 클래스 재정의). 거부 사유 문자열 또는 null.
  _reject(layer) { return layer.lockImage ? "이미지가 잠겨 있어 편집할 수 없습니다." : null; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    const why = pixelEditBlocker(layer, this.app) || this._reject(layer);
    if (why) { this.app.status(why); return; }

    this.layer = layer;
    this.drawing = true;
    this.bounds = newBounds();
    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;
    this.work = new ImageData(new Uint8ClampedArray(this.before.data), layer.width, layer.height);
    this.str = new Uint8Array(layer.width * layer.height);
    this.selMask = this.selection?.active ? this.selection.mask : null;
    this._beginStroke(pt, e);

    this.last = pt;
    this._stampLine(pt, pt);
    this._flush();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (this.drawing) {
      this._stampLine(this.last, pt);
      this.last = pt;
      this._flush();
    } else {
      this.app.renderer.requestOverlayRender(); // 커서만 갱신(합성 캐시 유지)
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._flush();
    const box = boundsToBox(this.bounds);
    // 바뀐 영역이 없으면(bounds 비어 있음) 레이어 전체 크기의 빈 undo 항목을 쌓지 않고 취소한다
    if (box) this.history.commitPixelEdit(box, this.label);
    else this.history.cancelPixelEdit();
    this.before = null; this.work = null; this.str = null; this.selMask = null; this.layer = null;
  }

  // 드래그 중 도구가 바뀌면 ToolManager가 cancelPixelEdit로 픽셀을 되돌린다 — 여기선 stroke 상태만 버려
  // 다시 이 도구로 돌아왔을 때 낡은 work 버퍼로 이어 칠하지 않게 한다.
  onDeactivate() {
    this._hover = null;
    this.drawing = false;
    this.before = null; this.work = null; this.str = null; this.selMask = null; this.layer = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  _beginStroke(pt, e) {}
  _dab(x, y, r) { return null; }

  // a→b 구간을 반경의 1/4 간격으로 dab
  _stampLine(a, b) {
    const r = Math.max(0.5, Math.max(1, this.state.brushSize) / 2);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(1, r * 0.25);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = (a === b ? n : 1); i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const box = this._dab(x, y, r);
      if (box) expandBounds(this.bounds, x, y, r + 2);
    }
  }

  // 현재 원본(before) 픽셀 색 [r,g,b,a] (범위 밖이면 null)
  _sample(x, y) {
    const W = this.layer.width, H = this.layer.height;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return null;
    const i = (iy * W + ix) * 4, d = this.before.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  // work 버퍼 → 캔버스(변경 bbox만). bounds는 stroke 동안 단조 증가라 bbox 밖은 항상 원본 그대로다.
  _flush() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (cb) this.layer.ctx.putImageData(this.work, 0, 0, cb.x, cb.y, cb.w, cb.h);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  drawOverlay(ctx, vp) { drawBrushCursor(ctx, vp, this._hover, this.state.brushSize); }
}
