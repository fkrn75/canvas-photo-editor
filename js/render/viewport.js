// viewport.js — 화면(screen, CSS px) ↔ 문서(world, 이미지 px) 좌표 변환과 줌/팬 관리.
// 변환식:  screen = world * zoom + pan   /   world = (screen - pan) / zoom

import { EVT, ZOOM } from "../core/constants.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Viewport {
  constructor(app, el) {
    this.app = app;
    this.el = el;            // 뷰포트 컨테이너 div
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.dpr = window.devicePixelRatio || 1;
  }

  get cssWidth() { return this.el.clientWidth; }
  get cssHeight() { return this.el.clientHeight; }

  screenToWorld(sx, sy) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }
  worldToScreen(wx, wy) {
    return { x: wx * this.zoom + this.panX, y: wy * this.zoom + this.panY };
  }

  // 화면의 (sx,sy)를 고정한 채 배율을 factor배 한다 (휠 줌).
  zoomAt(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, ZOOM.MIN, ZOOM.MAX);
    this.panX = sx - before.x * this.zoom;
    this.panY = sy - before.y * this.zoom;
    this._changed();
  }

  // 배율을 절대값으로 설정(뷰포트 중심 기준)
  setZoom(z) {
    const cx = this.cssWidth / 2, cy = this.cssHeight / 2;
    this.zoomAt(clamp(z, ZOOM.MIN, ZOOM.MAX) / this.zoom, cx, cy);
  }

  pan(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this._changed();
  }

  // 문서 전체가 보이도록 맞춤(여백 포함). 작은 이미지는 100%까지만 확대.
  fit(docW, docH) {
    const margin = 48;
    const z = Math.min((this.cssWidth - margin) / docW, (this.cssHeight - margin) / docH);
    this.zoom = clamp(Math.min(z, 1), ZOOM.MIN, ZOOM.MAX);
    this.panX = Math.round((this.cssWidth - docW * this.zoom) / 2);
    this.panY = Math.round((this.cssHeight - docH * this.zoom) / 2);
    this._changed();
  }

  // 100% 배율, 중앙 정렬
  actualSize(docW, docH) {
    this.zoom = 1;
    this.panX = Math.round((this.cssWidth - docW) / 2);
    this.panY = Math.round((this.cssHeight - docH) / 2);
    this._changed();
  }

  _changed() {
    this.dpr = window.devicePixelRatio || 1;
    this.app.bus.emit(EVT.VIEWPORT_CHANGED, { zoom: this.zoom });
    this.app.renderer?.requestRender();
  }
}
