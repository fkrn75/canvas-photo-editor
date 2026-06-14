// shape-tool.js — 사각형 / 타원 / 직선. 드래그로 미리보기, 놓으면 활성 레이어에 확정.
// Shift: 정사각형/정원/45° 직선.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox } from "../engine/imagedata.js";

export class ShapeTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    this.layer = layer;
    this.drawing = true;
    this.start = pt; this.end = pt; this.shift = e.shiftKey;
  }

  onPointerMove(pt, e) {
    if (!this.drawing) return;
    this.end = pt; this.shift = e.shiftKey;
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.end = pt;
    const r = this._rect();
    const ctx = this.layer.ctx;
    this.history.beginPixelEdit(this.layer);
    ctx.save();
    if (this.selection?.active) this.selection.applyClipPath(ctx);
    this._paint(ctx, r);
    ctx.restore();
    this.layer.thumbDirty = true;
    const b = newBounds();
    const pad = this.state.shapeStrokeWidth + 2;
    expandBounds(b, r.x, r.y, pad);
    expandBounds(b, r.x + r.w, r.y + r.h, pad);
    this.history.commitPixelEdit(boundsToBox(b), "도형");
    this.layer = null;
  }

  _rect() {
    let { x: x0, y: y0 } = this.start;
    let { x: x1, y: y1 } = this.end;
    if (this.shift && this.state.shapeType !== "line") {
      const w = x1 - x0, h = y1 - y0;
      const s = Math.max(Math.abs(w), Math.abs(h));
      x1 = x0 + (w < 0 ? -s : s);
      y1 = y0 + (h < 0 ? -s : s);
    }
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), x0, y0, x1, y1 };
  }

  // shift 적용된 직선 끝점
  _lineEnd(r) {
    let ex = r.x1, ey = r.y1;
    if (this.shift) {
      const dx = ex - r.x0, dy = ey - r.y0;
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      ex = r.x0 + Math.cos(ang) * len;
      ey = r.y0 + Math.sin(ang) * len;
    }
    return { ex, ey };
  }

  _paint(ctx, r) {
    const s = this.state;
    ctx.fillStyle = s.foreground;
    ctx.strokeStyle = s.foreground;
    ctx.lineWidth = s.shapeStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.shapeType === "line") {
      const { ex, ey } = this._lineEnd(r);
      ctx.beginPath();
      ctx.moveTo(r.x0, r.y0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    } else if (s.shapeType === "rect") {
      if (s.shapeFill) ctx.fillRect(r.x, r.y, r.w, r.h);
      if (s.shapeStroke) ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else { // ellipse
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (s.shapeFill) ctx.fill();
      if (s.shapeStroke) ctx.stroke();
    }
  }

  drawOverlay(ctx, vp) {
    if (!this.drawing) return;
    const r = this._rect();
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    if (this.state.shapeType === "line") {
      const { ex, ey } = this._lineEnd(r);
      const p0 = vp.worldToScreen(r.x0, r.y0);
      const p1 = vp.worldToScreen(ex, ey);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    } else {
      const a = vp.worldToScreen(r.x, r.y);
      ctx.strokeRect(a.x, a.y, r.w * vp.zoom, r.h * vp.zoom);
    }
    ctx.restore();
  }
}
