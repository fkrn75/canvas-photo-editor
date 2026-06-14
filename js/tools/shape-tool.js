// shape-tool.js — 사각형 / 타원 / 직선 / 정다각형 / 둥근 사각형.
// 드래그로 미리보기, 놓으면 활성 레이어에 확정.
// Shift: 정사각형/정원/45° 직선, 다각형은 15° 회전 스냅.
//
// 종류는 app.state.shapeType 로 선택한다(rect|ellipse|line|polygon|rounded).
//   - rect/ellipse/line/rounded: 시작점→끝점의 외접 사각형(bounding box) 모델.
//   - polygon: 시작점=중심, 드래그 거리=반지름, 방향=첫 꼭짓점 각도(중심→반지름 드래그).
// 다각형 변 수는 app.state.polygonSides(기본 5), 둥근 사각 반경은 app.state.cornerRadius(기본 10px).

import { BaseTool } from "./base-tool.js";
import { SHAPE } from "../core/constants.js";
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
    // 변경 경계: 다각형은 중심±반지름, 그 외는 외접 사각형. 선 두께만큼 여유를 둔다.
    const b = newBounds();
    const pad = this.state.shapeStrokeWidth + 2;
    if (this.state.shapeType === SHAPE.POLYGON) {
      const rad = this._radius();
      expandBounds(b, this.start.x - rad, this.start.y - rad, pad);
      expandBounds(b, this.start.x + rad, this.start.y + rad, pad);
    } else {
      expandBounds(b, r.x, r.y, pad);
      expandBounds(b, r.x + r.w, r.y + r.h, pad);
    }
    this.history.commitPixelEdit(boundsToBox(b), "도형");
    this.layer = null;
  }

  _rect() {
    let { x: x0, y: y0 } = this.start;
    let { x: x1, y: y1 } = this.end;
    if (this.shift && this.state.shapeType !== SHAPE.LINE && this.state.shapeType !== SHAPE.POLYGON) {
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

  // 다각형 반지름 = 중심(start)에서 현재점까지 거리
  _radius() {
    return Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y);
  }

  // 다각형 시작 각도(첫 꼭짓점). Shift면 15° 단위로 스냅.
  _polyAngle() {
    let ang = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
    if (this.shift) {
      const step = Math.PI / 12; // 15°
      ang = Math.round(ang / step) * step;
    }
    return ang;
  }

  // 정다각형 꼭짓점 배열(월드 좌표). sides<3이면 3으로 보정.
  _polyPoints() {
    const sides = Math.max(3, this.state.polygonSides | 0);
    const cx = this.start.x, cy = this.start.y;
    const rad = this._radius();
    const a0 = this._polyAngle();
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i * 2 * Math.PI) / sides;
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
    return pts;
  }

  // 둥근 사각형 경로를 ctx에 구성(arcTo). 반경은 변 길이의 절반을 넘지 않게 보정.
  _roundedPath(ctx, r) {
    let rr = Math.max(0, this.state.cornerRadius || 0);
    rr = Math.min(rr, r.w / 2, r.h / 2);
    const { x, y, w, h } = r;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  _paint(ctx, r) {
    const s = this.state;
    ctx.fillStyle = s.foreground;
    ctx.strokeStyle = s.foreground;
    ctx.lineWidth = s.shapeStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.shapeType === SHAPE.LINE) {
      const { ex, ey } = this._lineEnd(r);
      ctx.beginPath();
      ctx.moveTo(r.x0, r.y0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    } else if (s.shapeType === SHAPE.RECT) {
      if (s.shapeFill) ctx.fillRect(r.x, r.y, r.w, r.h);
      if (s.shapeStroke) ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else if (s.shapeType === SHAPE.ROUNDED_RECT) {
      this._roundedPath(ctx, r);
      if (s.shapeFill) ctx.fill();
      if (s.shapeStroke) ctx.stroke();
    } else if (s.shapeType === SHAPE.POLYGON) {
      const pts = this._polyPoints();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (s.shapeFill) ctx.fill();
      if (s.shapeStroke) ctx.stroke();
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
    const kind = this.state.shapeType;
    if (kind === SHAPE.LINE) {
      const { ex, ey } = this._lineEnd(r);
      const p0 = vp.worldToScreen(r.x0, r.y0);
      const p1 = vp.worldToScreen(ex, ey);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    } else if (kind === SHAPE.POLYGON) {
      // 다각형 외곽선 미리보기(화면 좌표로 변환)
      const pts = this._polyPoints();
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = vp.worldToScreen(pts[i].x, pts[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath(); ctx.stroke();
    } else if (kind === SHAPE.ROUNDED_RECT) {
      // 둥근 사각형 미리보기: 화면 좌표·화면 반경으로 다시 구성
      const a = vp.worldToScreen(r.x, r.y);
      const w = r.w * vp.zoom, h = r.h * vp.zoom;
      let rr = Math.min(Math.max(0, this.state.cornerRadius || 0) * vp.zoom, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(a.x + rr, a.y);
      ctx.arcTo(a.x + w, a.y, a.x + w, a.y + h, rr);
      ctx.arcTo(a.x + w, a.y + h, a.x, a.y + h, rr);
      ctx.arcTo(a.x, a.y + h, a.x, a.y, rr);
      ctx.arcTo(a.x, a.y, a.x + w, a.y, rr);
      ctx.closePath(); ctx.stroke();
    } else {
      const a = vp.worldToScreen(r.x, r.y);
      ctx.strokeRect(a.x, a.y, r.w * vp.zoom, r.h * vp.zoom);
    }
    ctx.restore();
  }
}
