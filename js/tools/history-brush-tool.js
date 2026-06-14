// history-brush-tool.js — 히스토리 브러시(History Brush).
//
// 사용법:
//   1) 히스토리 팔레트에서 "스냅샷"을 하나 이상 만들어 둔다(소스가 됨).
//   2) 옵션바에서 복원할 스냅샷을 고른다(state.historyBrushSource = 스냅샷 인덱스).
//   3) 브러시로 칠하면, 칠한 영역에 그 스냅샷의 픽셀이 현재 레이어로 "복원"된다.
//
// 즉, 부분적 실행취소 도구다. 전체 이미지를 과거 상태로 되돌리는 대신
// 브러시로 문지른 곳만 선택한 스냅샷 시점으로 되돌린다(포토샵 히스토리 브러시와 동일 개념).
//
// 합성 방식: clone-stamp-tool.js의 "강도 마스크" 사상을 그대로 따른다.
//   stroke 동안 누적 마스크(검정 바탕에 흰 스탬프를 lighten)로 부드러운 가장자리/불투명도를 만들고,
//   _composite에서 그 강도를 알파로 환산해 "스냅샷에서 떠온 픽셀"을 현재 레이어에 얹는다.
//   소스는 오프셋 없이 같은 좌표(대상 = 소스 좌표)에서 떠온다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";

export class HistoryBrushTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
  }

  get cursor() { return "none"; } // 브러시 원형 커서를 직접 그린다

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: s.brushHardness,
      opacity: s.brushOpacity ?? 1,
    };
  }

  // 현재 선택된 스냅샷 객체({name,canvas,thumb}) 반환. 없으면 null.
  _sourceSnap() {
    const snaps = this.app.historyPanel?.snapshots || [];
    if (snaps.length === 0) return null;
    let idx = this.state.historyBrushSource ?? 0;
    if (idx < 0 || idx >= snaps.length) idx = snaps.length - 1; // 범위를 벗어나면 최신 스냅샷
    return snaps[idx] || null;
  }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 복원할 수 없습니다."); return; }

    const snap = this._sourceSnap();
    if (!snap) {
      this.app.status("히스토리 브러시: 먼저 히스토리 팔레트에서 스냅샷을 만드세요.");
      return;
    }
    // 문서 크기가 스냅샷과 다르면(자르기/리사이즈 후) 안전하게 막는다.
    if (snap.canvas.width !== layer.width || snap.canvas.height !== layer.height) {
      this.app.status("문서 크기가 달라 이 스냅샷으로 복원할 수 없습니다.");
      return;
    }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();

    // 스냅샷 픽셀을 한 번만 떠 둔다(같은 좌표 복원이므로 오프셋 없음)
    const sctx = snap.canvas.getContext("2d", { willReadFrequently: true });
    this.srcSnap = sctx.getImageData(0, 0, layer.width, layer.height);

    // undo 스냅샷 + 누적 작업 버퍼(직전까지의 합성 결과)
    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;
    this.work = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    // 강도 마스크(검정 바탕, 흰 스탬프 lighten 누적)
    this._initMask(layer);

    this.last = pt;
    this._stamp(pt, pt);
    this._composite();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (this.drawing) {
      this._stamp(this.last, pt);
      this.last = pt;
      this._composite();
    } else {
      this.app.renderer.requestRender(); // 커서 오버레이 갱신
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    this.history.commitPixelEdit(box, "히스토리 브러시");

    this.mask = null; this.mctx = null; this.before = null;
    this.work = null; this.srcSnap = null; this.layer = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestRender(); }

  // 강도 마스크 초기화(clone-stamp와 동일 사상)
  _initMask(layer) {
    this.mask = document.createElement("canvas");
    this.mask.width = layer.width;
    this.mask.height = layer.height;
    this.mctx = this.mask.getContext("2d", { willReadFrequently: true });
    this.mctx.fillStyle = "#000";
    this.mctx.fillRect(0, 0, layer.width, layer.height);
    if (this.selection?.active) this.selection.applyClipPath(this.mctx);
    this.mctx.globalCompositeOperation = "lighten";
  }

  // a→b 구간을 거리 기반 보간으로 스탬프
  _stamp(a, b) {
    const r = Math.max(0.5, this.p.size / 2);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(0.5, r * 0.15);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      this._dot(x, y, r);
      expandBounds(this.bounds, x, y, r + 2);
    }
  }

  // 흰색(강도) 스탬프. 경도에 따른 부드러운 가장자리.
  _dot(x, y, r) {
    const ctx = this.mctx;
    ctx.globalAlpha = 1;
    if (this.p.hardness >= 1) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const inner = Math.max(0.001, r * this.p.hardness);
      const grd = ctx.createRadialGradient(x, y, inner, x, y, r);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 마스크 강도 → 스냅샷 픽셀을 같은 좌표의 대상에 합성(변경 영역만)
  _composite() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const W = this.layer.width;
    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    const out = this.work;          // 누적 작업 버퍼(직전 결과)
    const od = out.data;
    const src = this.srcSnap.data;  // 스냅샷 원본(고정)
    const op = this.p.opacity;

    for (let yy = 0; yy < cb.h; yy++) {
      const ty = cb.y + yy;
      for (let xx = 0; xx < cb.w; xx++) {
        const mi = (yy * cb.w + xx) * 4;
        const a = (m[mi] / 255) * op; // 잉크 강도
        if (a <= 0) continue;
        const tx = cb.x + xx;
        const di = (ty * W + tx) * 4; // 소스/대상 동일 좌표
        const k = a;
        const ia = 1 - k;
        od[di]     = src[di]     * k + od[di]     * ia;
        od[di + 1] = src[di + 1] * k + od[di + 1] * ia;
        od[di + 2] = src[di + 2] * k + od[di + 2] * ia;
        od[di + 3] = src[di + 3] * k + od[di + 3] * ia;
      }
    }

    this.layer.ctx.putImageData(out, 0, 0);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 브러시 원형 커서
  drawOverlay(ctx, vp) {
    if (!this._hover) return;
    const c = vp.worldToScreen(this._hover.x, this._hover.y);
    const r = Math.max(0.5, this.state.brushSize / 2) * vp.zoom;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
    ctx.restore();
  }
}
