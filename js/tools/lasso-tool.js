// lasso-tool.js — 올가미(자유 곡선) 선택.

import { BaseTool } from "./base-tool.js";

export class LassoTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) { this.drawing = true; this.points = [pt]; }
  onPointerMove(pt, e) {
    if (!this.drawing) return;
    this.points.push(pt);
    this.app.renderer.requestRender();
  }
  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.points.length >= 3) this.selection.setPolygon(this.points);
    else this.selection.clear();
    this.points = null;
  }

  drawOverlay(ctx, vp) {
    if (!this.drawing || !this.points) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    this.points.forEach((p, i) => {
      const s = vp.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }
}
