// measure-tool.js — 측정 도구(포토샵의 자/측정 도구).
// 두 점을 드래그해 거리(px)·각도(°)를 잰다. Shift=45° 스냅.
// drawOverlay로 측정선 + 끝점 핸들 + 거리/각도 라벨을 그리고, 상태바에도 값을 표시한다.
// 측정선은 app.state.measureLine = {x1,y1,x2,y2}(월드좌표)에 보존된다(도구를 벗어나도 유지).

import { BaseTool } from "./base-tool.js";

export class MeasureTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this._dragging = false;
  }

  get cursor() { return "crosshair"; }

  // 상태에 보존된 측정선(없으면 null)
  get _line() { return this.state.measureLine || null; }
  set _line(v) { this.state.measureLine = v; }

  onActivate() {
    this.app.renderer.requestRender();
    this._showInfo();
  }

  onPointerDown(pt, e) {
    // 새 측정 시작: 시작점=끝점=현재 위치
    const x = this._clampX(pt.x), y = this._clampY(pt.y);
    this._line = { x1: x, y1: y, x2: x, y2: y };
    this._dragging = true;
    this.app.renderer.requestRender();
  }

  onPointerMove(pt, e) {
    if (!this._dragging || !this._line) return;
    let x = this._clampX(pt.x), y = this._clampY(pt.y);
    // Shift: 시작점 기준 45° 배수 각도로 스냅
    if (e.shiftKey) {
      const snapped = this._snap45(this._line.x1, this._line.y1, x, y);
      x = snapped.x; y = snapped.y;
    }
    this._line.x2 = x; this._line.y2 = y;
    this._showInfo();
    this.app.renderer.requestRender();
  }

  onPointerUp() {
    this._dragging = false;
    this._showInfo();
  }

  // ── 측정 계산 ──
  // 화면 y는 아래로 증가하므로, 사람이 기대하는 "위로 향하면 양수" 각도를 위해 dy 부호를 뒤집는다.
  // 결과 각도 범위: -180 ~ 180 (수평 오른쪽=0°, 위=+, 아래=-) — 포토샵과 동일.
  _metrics() {
    const L = this._line;
    if (!L) return null;
    const dx = L.x2 - L.x1;
    const dy = L.y2 - L.y1;
    const dist = Math.hypot(dx, dy);
    const angle = -Math.atan2(dy, dx) * 180 / Math.PI;
    return { dx, dy, dist, angle };
  }

  // 시작점 기준 45° 격자에 끝점을 투영
  _snap45(x1, y1, x, y) {
    const dx = x - x1, dy = y - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x, y };
    const a = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const sa = Math.round(a / step) * step;
    return { x: x1 + Math.cos(sa) * len, y: y1 + Math.sin(sa) * len };
  }

  _clampX(v) { return Math.max(0, Math.min(this.layers.width, v)); }
  _clampY(v) { return Math.max(0, Math.min(this.layers.height, v)); }

  // ── 상태바 정보 ──
  _showInfo() {
    const m = this._metrics();
    if (!m) { this.app.status("드래그하여 거리와 각도를 측정하세요. (Shift=45° 스냅)"); return; }
    this.app.status(
      `거리 ${m.dist.toFixed(1)}px · 각도 ${m.angle.toFixed(1)}° · 수평 ${Math.abs(m.dx).toFixed(0)} · 수직 ${Math.abs(m.dy).toFixed(0)}`
    );
  }

  // ── 오버레이: 측정선 + 끝점 핸들 + 시작점의 각도 호 + 라벨 ──
  drawOverlay(ctx, vp) {
    const L = this._line;
    if (!L) return;
    const m = this._metrics();
    const a = vp.worldToScreen(L.x1, L.y1);
    const b = vp.worldToScreen(L.x2, L.y2);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 측정선(흰 외곽 + 검은 심으로 2중 그려 어느 배경에서도 보이게)
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // 시작점에서 수평 기준선(점선) — 각도의 기준을 시각적으로 표시
    if (m && m.dist > 1) {
      const dir = b.x >= a.x ? 1 : -1; // 끝점이 향한 수평 방향
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dir * Math.min(30, m.dist * vp.zoom), a.y); ctx.stroke();
      ctx.restore();
    }

    // 양 끝점 핸들(작은 원)
    this._handle(ctx, a.x, a.y);
    this._handle(ctx, b.x, b.y);

    // 라벨: 선 중앙 위쪽에 "거리 / 각도"
    if (m) {
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const text = `${m.dist.toFixed(1)} px   ${m.angle.toFixed(1)}°`;
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(text).width;
      const padX = 6, boxH = 18, boxW = tw + padX * 2;
      // 선 위쪽에 살짝 띄워 배치(화면 밖이면 아래로)
      let bx = midX - boxW / 2;
      let by = midY - boxH - 8;
      if (by < 0) by = midY + 8;
      bx = Math.max(2, Math.min(vp.cssWidth - boxW - 2, bx));

      ctx.fillStyle = "rgba(20,20,20,0.82)";
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      this._roundRect(ctx, bx, by, boxW, boxH, 3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(text, bx + padX, by + boxH / 2);
    }
    ctx.restore();
  }

  _handle(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
