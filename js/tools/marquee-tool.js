// marquee-tool.js — 사각형 선택.

import { BaseTool } from "./base-tool.js";

export class MarqueeTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) { this.sel = true; this.start = pt; this.end = pt; }
  onPointerMove(pt, e) {
    if (!this.sel) return;
    this.end = pt;
    this.app.renderer.requestRender();
  }
  onPointerUp(pt, e) {
    if (!this.sel) return;
    this.sel = false;
    this.end = pt;
    const x = Math.min(this.start.x, this.end.x);
    const y = Math.min(this.start.y, this.end.y);
    const w = Math.abs(this.end.x - this.start.x);
    const h = Math.abs(this.end.y - this.start.y);
    if (w < 2 || h < 2) this.selection.clear();
    else this.selection.setRect(x, y, w, h);
  }

  drawOverlay(ctx, vp) {
    if (!this.sel) return;
    const a = vp.worldToScreen(Math.min(this.start.x, this.end.x), Math.min(this.start.y, this.end.y));
    const b = vp.worldToScreen(Math.max(this.start.x, this.end.x), Math.max(this.start.y, this.end.y));
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  }
}
