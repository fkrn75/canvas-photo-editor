// spot-heal-tool.js — 스팟 복구 브러시(Spot Healing Brush, K 슬롯).
//
// 복구 브러시와 달리 소스를 Alt+클릭으로 지정하지 않는다. 잡티 위를 칠하고 놓으면,
//   1) 칠한 영역 바로 바깥 링과 가장 비슷한 주변 패치(24개 후보 오프셋)를 자동으로 고르고
//   2) 링에서의 (대상 − 소스) 차이를 영역 안으로 확산(간이 Poisson)해 톤을 이음매 없이 맞춘 뒤
//   3) 브러시 마스크 강도로 원본 위에 블렌딩한다. (수학: tool-ext-math.spotHeal — 복구 브러시의
//      "주변 평균 톤 매칭"을 픽셀 단위 확산으로 일반화)
// 칠하는 동안에는 반투명 회색 획만 보여 주고(포토샵과 같은 피드백), 놓을 때 한 번 계산한다.

import { BaseTool } from "./base-tool.js";
import { clampBox } from "../engine/imagedata.js";
import { drawBrushCursor, pixelEditBlocker } from "./ext-tool-base.js";
import { spotHeal } from "./tool-ext-math.js";

export class SpotHealTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.points = null;
    this._hover = null;
  }

  get cursor() { return "none"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    const blocked = pixelEditBlocker(layer, this.app);
    if (blocked) { this.app.status(blocked); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 복구할 수 없습니다."); return; }
    this.layer = layer;
    this.size = Math.max(1, this.state.brushSize);
    this.points = [{ x: pt.x, y: pt.y }];
    this.app.renderer.requestOverlayRender();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (this.points) {
      const last = this.points[this.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.5) this.points.push({ x: pt.x, y: pt.y });
    }
    this.app.renderer.requestOverlayRender();
  }

  onPointerUp(pt, e) {
    if (!this.points) return;
    const pts = this.points, layer = this.layer;
    this.points = null; this.layer = null;
    const W = layer.width, H = layer.height, r = this.size / 2;

    // 획 경계 상자(+링 여유 2px) — 문서 안으로
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const box = clampBox({ x: x0 - r - 2, y: y0 - r - 2, w: x1 - x0 + 2 * r + 4, h: y1 - y0 + 2 * r + 4 }, W, H);
    if (!box) { this.app.renderer.requestOverlayRender(); return; }

    // 획 → 마스크(캔버스로 둥근 굵은 선을 그려 알파를 강도로)
    const mc = document.createElement("canvas");
    mc.width = box.w; mc.height = box.h;
    const g = mc.getContext("2d", { willReadFrequently: true });
    g.translate(-box.x, -box.y);
    g.strokeStyle = g.fillStyle = "#fff";
    g.lineWidth = this.size; g.lineCap = "round"; g.lineJoin = "round";
    if (pts.length === 1) { g.beginPath(); g.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); g.fill(); }
    else {
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
    const md = g.getImageData(0, 0, box.w, box.h).data;
    const mask = new Uint8Array(box.w * box.h);
    const sel = this.selection?.active ? this.selection.mask : null;
    let any = false;
    for (let ly = 0; ly < box.h; ly++) {
      for (let lx = 0; lx < box.w; lx++) {
        const li = ly * box.w + lx;
        let v = md[li * 4 + 3];
        if (sel) v = (v * sel[(box.y + ly) * W + (box.x + lx)]) / 255;
        mask[li] = v;
        if (v) any = true;
      }
    }
    if (!any) { this.app.status("선택 영역 밖이라 복구할 곳이 없습니다."); this.app.renderer.requestOverlayRender(); return; }

    this.history.beginPixelEdit(layer);
    const before = this.history._peBefore;
    const work = new ImageData(new Uint8ClampedArray(before.data), W, H);
    const res = spotHeal(work.data, W, H, mask, box, 1);
    if (!res.ok) { this.history.cancelPixelEdit(); this.app.renderer.requestOverlayRender(); return; }
    layer.ctx.putImageData(work, 0, 0, box.x, box.y, box.w, box.h);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(box, "스팟 복구 브러시");
    this.app.renderer.requestRender();
    if (!res.offset) this.app.status("주변에 쓸 패치가 없어 가장자리 색 확산으로 채웠습니다.");
  }

  onDeactivate() { this.points = null; this.layer = null; this._hover = null; }
  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  drawOverlay(ctx, vp) {
    if (this.points && this.points.length) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = this.size * vp.zoom; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      this.points.forEach((p, i) => { const s = vp.worldToScreen(p.x, p.y); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
      if (this.points.length === 1) {
        const s = vp.worldToScreen(this.points[0].x, this.points[0].y);
        ctx.beginPath(); ctx.arc(s.x, s.y, (this.size / 2) * vp.zoom, 0, Math.PI * 2); ctx.fill();
      } else ctx.stroke();
      ctx.restore();
    }
    drawBrushCursor(ctx, vp, this._hover, this.state.brushSize);
  }
}
