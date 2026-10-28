// quick-select-tool.js — 빠른 선택 도구(Quick Selection, W 슬롯).
//
// 브러시로 칠하면, 각 dab 중심 색과 허용치 안에서 "이어진" 영역을 브러시 반경의 3배 창 안에서 찾아
// 선택에 더한다(Alt = 빼기). 넓은 영역은 그 위를 칠해 나가면 창이 따라가며 넓어진다.
// 포토샵처럼 선택이 이미 있으면 자동으로 "더하기" 모드다(새로 시작하려면 Ctrl+D).
//
// 성능: 칠하는 동안은 selection을 갱신하지 않고(외곽선 추출이 문서 전체 O(W·H)) 작업 마스크를
// 반투명 파랑 오버레이 캔버스로만 보여 준다. 놓을 때 한 번 selection에 반영(마칭앤츠 외곽선 포함).

import { BaseTool } from "./base-tool.js";
import { ensureDefaults, drawBrushCursor } from "./ext-tool-base.js";
import { growRegion } from "./tool-ext-math.js";

const TINT = [40, 130, 255, 110]; // 진행 중 선택 표시 색(RGBA)

export class QuickSelectTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { quickSelectTolerance: 32 });
    this.drawing = false;
    this._hover = null;
    this._alt = false;
  }

  get cursor() { return "none"; }

  onPointerDown(pt, e) {
    const layer = this.layers.activeLayer;
    if (!layer) { this.app.status("레이어가 없습니다."); return; }
    const W = layer.width, H = layer.height;
    this.W = W; this.H = H;
    this.data = layer.ctx.getImageData(0, 0, W, H).data;
    this.subtract = e.altKey;
    const sel = this.selection;
    this.mask = sel.active && sel.mask ? sel.mask.slice() : new Uint8Array(W * H);
    if (this.subtract && !sel.active) { this.app.status("뺄 선택 영역이 없습니다."); this.mask = null; return; }

    // 진행 표시 오버레이(문서 크기) — 시작 시 현재 마스크 전체를 한 번 칠한다
    this.ov = document.createElement("canvas");
    this.ov.width = W; this.ov.height = H;
    this.octx = this.ov.getContext("2d");
    if (sel.active) this._paintOverlay(0, 0, W, H);

    this.drawing = true;
    this.last = pt;
    this._dab(pt.x, pt.y);
    this.app.renderer.requestOverlayRender();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    this._alt = e.altKey;
    if (this.drawing) {
      const r = Math.max(1, this.state.brushSize / 2);
      const dist = Math.hypot(pt.x - this.last.x, pt.y - this.last.y);
      const step = Math.max(1, r * 0.5);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        this._dab(this.last.x + (pt.x - this.last.x) * t, this.last.y + (pt.y - this.last.y) * t);
      }
      this.last = pt;
    }
    this.app.renderer.requestOverlayRender();
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    const sel = this.selection;
    // 마스크 → 선택(경계 상자·외곽선 자동 계산). 비면 해제된다.
    if (typeof sel._commitMask === "function") sel._commitMask(this.mask);
    else this._commitFallback(sel);
    this.mask = null; this.data = null; this.ov = null; this.octx = null;
    this.app.renderer.requestOverlayRender();
  }

  // selection-manager에 _commitMask가 없을 때의 대체 경로(경계 상자 계산 후 setMask)
  _commitFallback(sel) {
    const W = this.W, H = this.H, m = this.mask;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) sel.clear(); else sel.setMask(m, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  onDeactivate() {
    if (this.drawing) this.onPointerUp(this.last || { x: 0, y: 0 }, {});
    this._hover = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  // 중심 색 기준으로 주변 창 안의 이어진 비슷한 색 영역을 마스크에 더하기/빼기
  _dab(x, y) {
    const W = this.W, H = this.H;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const r = Math.max(1, this.state.brushSize / 2);
    const reach = Math.ceil(r * 3);
    const i = (iy * W + ix) * 4, d = this.data;
    const ref = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    const win = { x0: ix - reach, y0: iy - reach, x1: ix + reach + 1, y1: iy + reach + 1 };
    const g = growRegion(d, W, H, ix, iy, ref, this.state.quickSelectTolerance ?? 32, win, this.mask, this.subtract ? 0 : 255);
    if (g.bbox) this._paintOverlay(g.bbox.x, g.bbox.y, g.bbox.w, g.bbox.h);
  }

  // 마스크의 (x,y,w,h) 구간을 오버레이 캔버스에 반영(dirty-rect)
  _paintOverlay(x, y, w, h) {
    if (!this.octx || w <= 0 || h <= 0) return;
    const W = this.W, m = this.mask;
    const img = this.octx.createImageData(w, h);
    const od = img.data;
    for (let row = 0; row < h; row++) {
      let p = (y + row) * W + x, o = row * w * 4;
      for (let col = 0; col < w; col++, p++, o += 4) {
        const v = m[p];
        if (!v) continue;
        od[o] = TINT[0]; od[o + 1] = TINT[1]; od[o + 2] = TINT[2]; od[o + 3] = (TINT[3] * v) / 255;
      }
    }
    this.octx.putImageData(img, x, y);
  }

  drawOverlay(ctx, vp) {
    if (this.drawing && this.ov) {
      const tl = vp.worldToScreen(0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.ov, tl.x, tl.y, this.W * vp.zoom, this.H * vp.zoom);
      ctx.restore();
    }
    if (!this._hover) return;
    drawBrushCursor(ctx, vp, this._hover, this.state.brushSize);
    // 더하기(+)/빼기(−) 표시
    const c = vp.worldToScreen(this._hover.x, this._hover.y);
    const sub = this.drawing ? this.subtract : this._alt;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x + 6, c.y + 9); ctx.lineTo(c.x + 12, c.y + 9);
    if (!sub) { ctx.moveTo(c.x + 9, c.y + 6); ctx.lineTo(c.x + 9, c.y + 12); }
    ctx.stroke();
    ctx.restore();
  }
}
