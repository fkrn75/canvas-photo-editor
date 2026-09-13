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
    // fit()으로 맞춘 상태인지 추적(수동 줌/팬 이후엔 false) — 리사이즈 시 강제로 되돌리지 않기 위함.
    this._isFitted = true;
    this._installResizeObserver();
  }

  // 뷰포트 컨테이너 크기 변화 감지. 두 경우에 fit()을 다시 건다.
  //   1) 직전이 fit() 상태였던 경우(창 크기 변경 시 화면 맞춤 유지)
  //   2) cssWidth/Height가 0에서 양수로 바뀐 경우(초기 로드 시 레이아웃이 아직 안 잡혀
  //      0px로 fit()이 계산되면 zoom이 ZOOM.MIN(0.05)에 고착되는 문제의 자가 복구)
  // 그 외(사용자가 수동으로 줌/팬한 뒤)에는 값을 건드리지 않고 재렌더만 요청한다.
  _installResizeObserver() {
    let prevW = 0, prevH = 0; // 0 = "아직 실측 전" 센티널
    const ro = new ResizeObserver(() => {
      const w = this.cssWidth, h = this.cssHeight;
      if (w <= 0 || h <= 0) return; // 레이아웃 확정 전(0px)이면 다음 콜백을 기다린다
      const cameFromZero = prevW <= 0 || prevH <= 0;
      prevW = w; prevH = h;
      const lm = this.app.layers;
      if ((this._isFitted || cameFromZero) && lm?.width && lm?.height) {
        this.fit(lm.width, lm.height);
      } else {
        this.app.renderer?.requestRender();
      }
    });
    ro.observe(this.el);
    this._resizeObserver = ro;
  }

  get cssWidth() { return this.el.clientWidth; }
  get cssHeight() { return this.el.clientHeight; }

  // ── 가이드 추가/삭제 (state.guides 모델에 위임 후 재렌더) ──
  // selection 모델처럼 외부(메뉴/다이얼로그)에서는 이 메서드만 호출하면 된다.
  addGuide(orient, pos) {
    this.app.state.addGuide(orient, pos);
    this.app.renderer?.requestRender();
  }
  clearGuides() {
    this.app.state.clearGuides();
    this.app.renderer?.requestRender();
  }

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
    this._isFitted = false; // 수동 줌 — 이후 리사이즈에서 강제 fit 안 함
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
    this._isFitted = false; // 수동 팬 — 이후 리사이즈에서 강제 fit 안 함
    this._changed();
  }

  // 문서 전체가 보이도록 맞춤(여백 포함). 작은 이미지는 100%까지만 확대.
  fit(docW, docH) {
    const margin = 48;
    const z = Math.min((this.cssWidth - margin) / docW, (this.cssHeight - margin) / docH);
    this.zoom = clamp(Math.min(z, 1), ZOOM.MIN, ZOOM.MAX);
    this.panX = Math.round((this.cssWidth - docW * this.zoom) / 2);
    this.panY = Math.round((this.cssHeight - docH * this.zoom) / 2);
    this._isFitted = true; // 리사이즈 시 이 상태를 유지하려 시도(ResizeObserver 참고)
    this._changed();
  }

  // 100% 배율, 중앙 정렬
  actualSize(docW, docH) {
    this.zoom = 1;
    this.panX = Math.round((this.cssWidth - docW) / 2);
    this.panY = Math.round((this.cssHeight - docH) / 2);
    this._isFitted = false; // fit이 아닌 고정 배율 — 이후 리사이즈에서 강제 fit 안 함
    this._changed();
  }

  _changed() {
    this.dpr = window.devicePixelRatio || 1;
    this.app.bus.emit(EVT.VIEWPORT_CHANGED, { zoom: this.zoom });
    this.app.renderer?.requestRender();
  }
}
