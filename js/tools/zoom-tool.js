// zoom-tool.js — 돋보기(줌) 도구.
//   클릭        : 커서 지점을 기준으로 확대(ZOOM.STEP 배)
//   Alt+클릭    : 커서 지점을 기준으로 축소(1/ZOOM.STEP 배)
//   드래그      : 드래그한 사각 영역이 화면에 가득 차도록 줌(영역 중심으로 맞춤)
//
// 줌/팬은 모두 viewport의 public API(zoomAt/pan/zoom/cssWidth·cssHeight)로만 수행한다.
// zoomAt이 기대하는 좌표계는 캔버스 getBoundingClientRect 기준 화면 px이므로,
// PointerEvent의 clientX/Y를 캔버스 rect로 보정해 사용한다(tool-manager._pt와 동일 좌표계).

import { BaseTool } from "./base-tool.js";
import { ZOOM } from "../core/constants.js";

// 드래그로 인정할 최소 이동 거리(px). 이보다 작으면 단순 클릭(점 확대/축소)으로 처리.
const DRAG_MIN = 6;

export class ZoomTool extends BaseTool {
  // Alt를 누르면 축소 커서로 바뀐다(onActivate/포인터에서 갱신).
  get cursor() { return this._out ? "zoom-out" : "zoom-in"; }

  onActivate() {
    this._out = false;
    this.drawing = false;
  }

  // PointerEvent → 캔버스 기준 화면 좌표(zoomAt 좌표계와 동일)
  _screen(e) {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(pt, e) {
    this.drawing = true;
    this.startWorld = pt;                 // 드래그 영역 시작(월드)
    this.startScreen = this._screen(e);   // 드래그 영역 시작(화면)
    this.endScreen = this.startScreen;
    this._out = e.altKey;                 // 커서 모양 갱신용
    this._applyCursor();
  }

  onPointerMove(pt, e) {
    // Alt 상태가 바뀌면 커서를 갱신(드래그 중이 아니어도)
    if (e.altKey !== this._out) { this._out = e.altKey; this._applyCursor(); }
    if (!this.drawing) return;
    this.endWorld = pt;
    this.endScreen = this._screen(e);
    this.app.renderer.requestRender(); // 드래그 사각형 미리보기
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    const s = this.startScreen, en = this._screen(e);
    const dist = Math.hypot(en.x - s.x, en.y - s.y);

    if (dist < DRAG_MIN) {
      // 클릭: 커서 지점 기준 확대/축소
      const factor = e.altKey ? 1 / ZOOM.STEP : ZOOM.STEP;
      this.app.viewport.zoomAt(factor, en.x, en.y);
    } else {
      // 드래그: 사각 영역에 맞춰 줌(영역 중심을 화면 중앙으로)
      this._zoomToArea(s, en);
    }
    this._out = e.altKey;
    this._applyCursor();
  }

  // 화면 좌표 두 점이 이루는 사각 영역이 뷰포트에 가득 차도록 배율·위치를 맞춘다.
  _zoomToArea(p0, p1) {
    const vp = this.app.viewport;
    const rectW = Math.abs(p1.x - p0.x);
    const rectH = Math.abs(p1.y - p0.y);
    if (rectW < 1 || rectH < 1) return;

    // 영역 중심(현재 화면 좌표) → 월드 좌표(배율 변경 전 기준으로 고정점 산출)
    const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
    const centerWorld = vp.screenToWorld(cx, cy);

    // 영역이 뷰포트에 맞도록 추가 배율(현재 대비). 가로/세로 중 더 빡빡한 쪽 기준.
    const grow = Math.min(vp.cssWidth / rectW, vp.cssHeight / rectH);

    // 1) 영역 중심을 고정한 채 배율 적용(zoomAt은 ZOOM 한계로 클램프됨)
    vp.zoomAt(grow, cx, cy);

    // 2) 영역 중심(월드)을 화면 정중앙으로 이동(클램프로 grow가 깎였어도 중앙 정렬은 유지)
    const after = vp.worldToScreen(centerWorld.x, centerWorld.y);
    vp.pan(vp.cssWidth / 2 - after.x, vp.cssHeight / 2 - after.y);
  }

  // 캔버스 커서를 현재 확대/축소 모양으로 갱신(get cursor를 ToolManager가 다시 읽게)
  _applyCursor() {
    this.app.canvas.style.cursor = this.cursor;
  }

  // 드래그 영역 미리보기(화면 좌표계)
  drawOverlay(ctx) {
    if (!this.drawing) return;
    const a = this.startScreen, b = this.endScreen;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < DRAG_MIN && h < DRAG_MIN) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
