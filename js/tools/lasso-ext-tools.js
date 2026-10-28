// lasso-ext-tools.js — 다각형 올가미 / 자석 올가미 (L 슬롯 순환: 올가미 → 다각형 → 자석).
//
// 기존 올가미(lasso-tool.js)는 "누른 채 드래그" 한 번으로 끝나는 구조라 모드를 끼워 넣기보다
// 별도 도구로 분리했다. 둘 다 "클릭으로 점을 쌓고 닫으면 selection.setPolygon"이라는 같은 뼈대를 공유한다.
//   - 닫기: 시작점 클릭 / 더블클릭 / Enter      - 취소: Esc(또는 다른 도구로 전환)
//   - Backspace/Delete: 마지막 점(자석은 마지막 고정점) 취소 — ToolManager가 onKeyDown으로 넘겨 준다
//     (도구가 처리하면 전역 Delete=선택 영역 지우기가 실행되지 않는다)

import { BaseTool } from "./base-tool.js";
import { ensureDefaults } from "./ext-tool-base.js";
import { gradientMagnitude, liveWirePath } from "./tool-ext-math.js";

const DBL_MS = 350;     // 더블클릭 판정 시간
const CLOSE_PX = 7;     // 시작점·더블클릭 판정 반경(화면 px)

// Shift: 직전 점 기준 45° 단위로 고정
function constrain45(from, pt) {
  const dx = pt.x - from.x, dy = pt.y - from.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

// "이번 클릭이 닫기인가" 순수 판정. 시작점 근처 클릭도, 더블클릭도 점이 3개 이상일 때만 닫는다
// (점 1~2개에서 닫으면 폴리곤이 만들어지지 못하고 폐기되므로 — 첫 점 직후 빠른 두 번째 클릭은 점 추가).
export function shouldCloseClick({ pt, startPt, count, lastClick, now, tol }) {
  if (count < 3) return false;
  if (Math.hypot(pt.x - startPt.x, pt.y - startPt.y) <= tol) return true;
  if (lastClick && now - lastClick.t < DBL_MS && Math.hypot(pt.x - lastClick.x, pt.y - lastClick.y) <= tol) return true;
  return false;
}

// 점 목록을 화면에 폴리라인으로 그린다(흰 바탕 + 검정 점선 = 어떤 배경에서도 보임)
function strokePolyline(ctx, vp, pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = vp.worldToScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.stroke();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.stroke();
  ctx.setLineDash([]);
}

// 공통 뼈대: 진행 중 여부, 시작점/더블클릭 닫기 판정, 키 처리
class ClickPolygonTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this._lastClick = null; // {t, x, y}
  }

  get cursor() { return "crosshair"; }
  get inProgress() { return false; }

  _closeTol() { return CLOSE_PX / this.app.viewport.zoom; }

  // 이번 클릭이 "닫기"인지 판정하고 클릭 기록을 갱신한다.
  _isCloseClick(pt, startPt, count) {
    const tol = this._closeTol();
    const now = performance.now();
    const lc = this._lastClick;
    this._lastClick = { t: now, x: pt.x, y: pt.y };
    return shouldCloseClick({ pt, startPt, count, lastClick: lc, now, tol });
  }

  _commitPolygon(pts) {
    if (pts && pts.length >= 3) this.selection.setPolygon(pts);
    else this.app.status("점이 3개 이상이어야 선택 영역을 만들 수 있습니다.");
  }

  onKeyDown(e) {
    if (!this.inProgress) return false;
    if (e.key === "Enter") { this.close(); return true; }
    if (e.key === "Escape") { this.cancel(); return true; }
    if (e.key === "Backspace" || e.key === "Delete") { this.undoPoint(); return true; }
    return false;
  }

  onDeactivate() { this.cancel(); }
  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }
}

// ───────────────────────────────────────────────────────────
// 다각형 올가미
// ───────────────────────────────────────────────────────────
export class PolyLassoTool extends ClickPolygonTool {
  constructor(app, id) {
    super(app, id);
    this.points = null; // 확정된 꼭짓점(월드)
    this._hover = null;
  }

  get inProgress() { return !!this.points; }

  onPointerDown(pt, e) {
    if (!this.points) {
      this.points = [{ x: pt.x, y: pt.y }];
      this._lastClick = { t: performance.now(), x: pt.x, y: pt.y };
      this.app.renderer.requestOverlayRender();
      return;
    }
    const last = this.points[this.points.length - 1];
    const p = e.shiftKey ? constrain45(last, pt) : { x: pt.x, y: pt.y };
    if (this._isCloseClick(pt, this.points[0], this.points.length)) { this.close(); return; }
    this.points.push(p);
    this.app.renderer.requestOverlayRender();
  }

  onPointerMove(pt, e) {
    if (!this.points) return;
    const last = this.points[this.points.length - 1];
    this._hover = e.shiftKey ? constrain45(last, pt) : { x: pt.x, y: pt.y };
    this.app.renderer.requestOverlayRender();
  }

  close() {
    const pts = this.points;
    this.points = null; this._hover = null; this._lastClick = null;
    this._commitPolygon(pts);
    this.app.renderer.requestOverlayRender();
  }

  cancel() {
    this.points = null; this._hover = null; this._lastClick = null;
    this.app.renderer.requestOverlayRender();
  }

  undoPoint() {
    if (!this.points) return;
    this.points.pop();
    if (!this.points.length) this.points = null;
    this.app.renderer.requestOverlayRender();
  }

  drawOverlay(ctx, vp) {
    if (!this.points) return;
    ctx.save();
    ctx.lineWidth = 1;
    const pts = this._hover ? this.points.concat([this._hover]) : this.points;
    strokePolyline(ctx, vp, pts);
    // 시작점 표식(가까이 오면 강조 = 클릭하면 닫힘)
    const s = vp.worldToScreen(this.points[0].x, this.points[0].y);
    const near = this._hover && this.points.length >= 3 &&
      Math.hypot(this._hover.x - this.points[0].x, this._hover.y - this.points[0].y) <= this._closeTol();
    ctx.beginPath(); ctx.arc(s.x, s.y, near ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = near ? "rgba(0,160,255,0.9)" : "#fff"; ctx.fill();
    ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.restore();
  }
}

// ───────────────────────────────────────────────────────────
// 자석 올가미 — live-wire 근사
//   첫 클릭에서 활성 레이어의 휘도 Sobel 그래디언트를 한 번 계산하고, 마우스를 움직이면
//   마지막 고정점 → 커서 사이를 "가장자리(그래디언트 큰 곳)를 따라가는 최소 비용 경로"로 잇는다.
//   경로가 빈도 옵션에 따른 길이를 넘으면 자동으로 고정점을 박아 탐색 창을 작게 유지한다(실시간).
//   폭(px)은 탐색 상자 여유 = 커서 주변 몇 px까지 가장자리를 찾을지.
// ───────────────────────────────────────────────────────────
export class MagneticLassoTool extends ClickPolygonTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { magLassoWidth: 10, magLassoFrequency: 57 });
    this._reset();
  }

  _reset() {
    this.active = false;
    this.fixed = null;    // 확정 경로 픽셀 [{x,y}] (정수 픽셀 좌표)
    this.anchors = null;  // 고정점이 박힌 fixed 인덱스 스택(Backspace용)
    this.live = null;     // 마지막 고정점 → 커서 임시 경로
    this.grad = null;
    this._hover = null;
  }

  get inProgress() { return this.active; }

  _spacing() {
    const f = Math.max(0, Math.min(100, this.state.magLassoFrequency ?? 57)) / 100;
    return Math.round(120 - 105 * f); // 빈도 0 → 120px, 100 → 15px 간격
  }
  _width() { return Math.max(1, Math.round(this.state.magLassoWidth ?? 10)); }

  // pt 주변(폭 반경)에서 그래디언트가 가장 큰 픽셀로 스냅
  _snap(pt) {
    const W = this.W, H = this.H, w = this._width();
    const cx = Math.max(0, Math.min(W - 1, Math.floor(pt.x))), cy = Math.max(0, Math.min(H - 1, Math.floor(pt.y)));
    let best = { x: cx, y: cy }, bg = this.grad[cy * W + cx];
    for (let y = Math.max(0, cy - w); y <= Math.min(H - 1, cy + w); y++) {
      for (let x = Math.max(0, cx - w); x <= Math.min(W - 1, cx + w); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > w * w) continue;
        const g = this.grad[y * W + x];
        if (g > bg + 0.02) { bg = g; best = { x, y }; } // 거의 같으면 클릭 지점 유지
      }
    }
    return best;
  }

  _anchor() { return this.fixed[this.fixed.length - 1]; }

  onPointerDown(pt, e) {
    if (!this.active) {
      const layer = this.layers.activeLayer;
      if (!layer) { this.app.status("레이어가 없습니다."); return; }
      this.W = layer.width; this.H = layer.height;
      this.grad = gradientMagnitude(layer.ctx.getImageData(0, 0, this.W, this.H).data, this.W, this.H);
      const s = this._snap(pt);
      this.active = true;
      this.fixed = [s];
      this.anchors = [0];
      this.live = null;
      this._lastClick = { t: performance.now(), x: pt.x, y: pt.y };
      this.app.renderer.requestOverlayRender();
      return;
    }
    const start = { x: this.fixed[0].x + 0.5, y: this.fixed[0].y + 0.5 };
    if (this._isCloseClick(pt, start, this.fixed.length)) { this.close(); return; }
    // 수동 고정점: 현재 임시 경로를 확정
    this._updateLive(pt);
    if (this.live && this.live.length > 1) {
      for (let i = 1; i < this.live.length; i++) this.fixed.push(this.live[i]);
      this.anchors.push(this.fixed.length - 1);
    }
    this.live = null;
    this.app.renderer.requestOverlayRender();
  }

  onPointerMove(pt, e) {
    if (!this.active) return;
    this._hover = pt;
    this._updateLive(pt);
    this.app.renderer.requestOverlayRender();
  }

  // 마지막 고정점 → pt 경로 재계산 + 길면 자동 고정점
  _updateLive(pt) {
    const W = this.W, H = this.H, pad = this._width(), sp = this._spacing();
    const tx = Math.max(0, Math.min(W - 1, Math.floor(pt.x))), ty = Math.max(0, Math.min(H - 1, Math.floor(pt.y)));
    let a = this._anchor();
    let path = liveWirePath(this.grad, W, H, a.x, a.y, tx, ty, pad);
    let guard = 0;
    while (path.length > sp + 1 && guard++ < 64) {
      for (let i = 1; i <= sp; i++) this.fixed.push(path[i]);
      this.anchors.push(this.fixed.length - 1);
      a = this._anchor();
      path = liveWirePath(this.grad, W, H, a.x, a.y, tx, ty, pad);
    }
    this.live = path;
  }

  close() {
    if (!this.active) return;
    let pts = this.fixed.slice();
    if (this.live && this.live.length > 1) pts = pts.concat(this.live.slice(1));
    // 마지막 점 → 시작점도 가장자리를 따라 닫는다
    if (pts.length >= 2) {
      const last = pts[pts.length - 1], first = pts[0];
      const back = liveWirePath(this.grad, this.W, this.H, last.x, last.y, first.x, first.y, this._width());
      pts = pts.concat(back.slice(1, -1));
    }
    this._reset();
    this._lastClick = null;
    // 픽셀 좌표 → 픽셀 중심(월드)
    this._commitPolygon(pts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })));
    this.app.renderer.requestOverlayRender();
  }

  cancel() {
    this._reset();
    this._lastClick = null;
    this.app.renderer.requestOverlayRender();
  }

  // 마지막 고정점 취소(첫 고정점이면 전체 취소)
  undoPoint() {
    if (!this.active) return;
    if (this.anchors.length <= 1) { this.cancel(); return; }
    this.anchors.pop();
    this.fixed.length = this.anchors[this.anchors.length - 1] + 1;
    if (this._hover) this._updateLive(this._hover); else this.live = null;
    this.app.renderer.requestOverlayRender();
  }

  drawOverlay(ctx, vp) {
    if (!this.active) return;
    const toW = (p) => ({ x: p.x + 0.5, y: p.y + 0.5 });
    ctx.save();
    ctx.lineWidth = 1;
    strokePolyline(ctx, vp, this.fixed.map(toW));
    if (this.live) {
      ctx.globalAlpha = 0.85;
      strokePolyline(ctx, vp, this.live.map(toW));
      ctx.globalAlpha = 1;
    }
    // 고정점 표식(작은 사각형)
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000";
    for (const ai of this.anchors) {
      const s = vp.worldToScreen(this.fixed[ai].x + 0.5, this.fixed[ai].y + 0.5);
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 5, 5);
      ctx.strokeRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 6, 6);
    }
    ctx.restore();
  }
}
