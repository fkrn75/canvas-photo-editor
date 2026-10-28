// navigator-panel.js — 내비게이터 패널(창 > 내비게이터).
// 문서 썸네일 위에 현재 뷰포트(화면에 보이는 영역)를 빨간 사각형으로 표시한다.
//   · 사각형을 끌면 화면이 따라 팬, 사각형 밖을 누르면 그 지점이 화면 중앙으로 이동
//   · 하단 슬라이더(로그 눈금)·± 버튼·배율 입력으로 확대/축소(뷰포트 중심 기준)
// 썸네일은 합성 결과가 바뀔 때 디바운스로 다시 만들고, 사각형은 뷰포트 변경 때마다 즉시 다시 그린다.
// 순수 좌표 함수(navLayout/viewRectOnThumb/thumbToDoc/zoomToSlider/sliderToZoom)는 DOM 없이 테스트한다.

import { EVT, ZOOM } from "../core/constants.js";
import { createRefresher, collapseOnFirstSeen } from "./panel-refresh.js";

// 슬라이더 분해능(0..SLIDER_MAX)
export const SLIDER_MAX = 1000;

// 문서를 boxW×boxH 상자에 비율 유지로 맞춘 썸네일 크기와 배율(scale = 썸네일 px / 문서 px)
export function navLayout(docW, docH, boxW, boxH) {
  if (!(docW > 0 && docH > 0 && boxW > 0 && boxH > 0)) return { w: 0, h: 0, scale: 0 };
  const scale = Math.min(boxW / docW, boxH / docH);
  return { w: Math.max(1, Math.round(docW * scale)), h: Math.max(1, Math.round(docH * scale)), scale };
}

// 뷰포트({zoom, panX, panY, cssW, cssH})가 보여주는 문서 영역을 썸네일 좌표 사각형으로.
// raw = 썸네일 밖까지 포함한 사각형, clipped = 썸네일(thumbW×thumbH) 안으로 자른 사각형(겹침 없으면 null)
export function viewRectOnThumb(vp, scale, thumbW, thumbH) {
  const x = (-vp.panX / vp.zoom) * scale;
  const y = (-vp.panY / vp.zoom) * scale;
  const w = (vp.cssW / vp.zoom) * scale;
  const h = (vp.cssH / vp.zoom) * scale;
  const raw = { x, y, w, h };
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(thumbW, x + w), y1 = Math.min(thumbH, y + h);
  const clipped = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  return { raw, clipped };
}

// 썸네일 좌표 → 문서 좌표
export function thumbToDoc(tx, ty, scale) {
  return { x: tx / scale, y: ty / scale };
}

// 문서 좌표 (cx,cy)를 화면 중앙에 두는 팬 값(viewport.centerOn과 같은 식 — 테스트용 순수 버전)
export function panForCenter(cx, cy, zoom, cssW, cssH) {
  return { panX: cssW / 2 - cx * zoom, panY: cssH / 2 - cy * zoom };
}

// 배율 ↔ 슬라이더 값(로그 눈금: 축소 쪽도 촘촘하게 조절되도록)
export function zoomToSlider(z, min = ZOOM.MIN, max = ZOOM.MAX) {
  const c = Math.min(max, Math.max(min, z));
  return Math.round((Math.log(c / min) / Math.log(max / min)) * SLIDER_MAX);
}
export function sliderToZoom(v, min = ZOOM.MIN, max = ZOOM.MAX) {
  const t = Math.min(SLIDER_MAX, Math.max(0, v)) / SLIDER_MAX;
  return min * Math.pow(max / min, t);
}

const BOX_H = 150; // 썸네일 최대 높이(CSS px)

export class NavigatorPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    if (!el) return;
    this.layout = { w: 0, h: 0, scale: 0 };
    this.drag = null;
    collapseOnFirstSeen(el);
    this._build();
    this.refresher = createRefresher(el, () => this._rebuildThumb(), 250, this.wrap);
    const req = () => this.refresher.request();
    app.renderer.onComposite(req);
    app.bus.on(EVT.DOCUMENT_CHANGED, req);
    app.bus.on(EVT.VIEWPORT_CHANGED, () => this._onViewport());
    // 패널 폭이 바뀌면(스플리터·도킹 이동) 썸네일 크기 재계산
    new ResizeObserver(() => req()).observe(this.wrap);
    req();
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">내비게이터</div>
      <div class="info-panel-body nav-body">
        <div class="nav-wrap"><canvas class="nav-canvas"></canvas></div>
        <div class="nav-zoom">
          <button class="nav-out" title="축소">−</button>
          <input class="nav-slider" type="range" min="0" max="${SLIDER_MAX}" step="1">
          <button class="nav-in" title="확대">＋</button>
          <input class="nav-pct" type="text" title="배율(%) 입력 후 Enter">
        </div>
      </div>`;
    this.wrap = this.el.querySelector(".nav-wrap");
    this.canvas = this.el.querySelector(".nav-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.slider = this.el.querySelector(".nav-slider");
    this.pct = this.el.querySelector(".nav-pct");
    const vp = this.app.viewport;

    this.slider.addEventListener("input", () => vp.setZoom(sliderToZoom(+this.slider.value)));
    this.el.querySelector(".nav-out").addEventListener("click", () => vp.setZoom(vp.zoom / ZOOM.STEP));
    this.el.querySelector(".nav-in").addEventListener("click", () => vp.setZoom(vp.zoom * ZOOM.STEP));
    const applyPct = () => {
      const v = parseFloat(this.pct.value);
      if (Number.isFinite(v) && v > 0) vp.setZoom(v / 100);
      else this._syncZoomUi();
    };
    this.pct.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyPct(); this.pct.blur(); }
      else if (e.key === "Escape") { this._syncZoomUi(); this.pct.blur(); }
      e.stopPropagation(); // 도구 단축키로 새지 않게
    });
    this.pct.addEventListener("blur", () => this._syncZoomUi());

    // 썸네일 드래그 → 팬
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.layout.scale) return;
      const p = this._local(e);
      const { raw } = this._rect();
      const inside = p.x >= raw.x && p.y >= raw.y && p.x <= raw.x + raw.w && p.y <= raw.y + raw.h;
      // 사각형 안을 잡으면 잡은 지점과 사각형 중심의 차이를 유지, 밖이면 그 지점을 중심으로 점프
      this.drag = { ox: inside ? p.x - (raw.x + raw.w / 2) : 0, oy: inside ? p.y - (raw.y + raw.h / 2) : 0 };
      try { c.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      this._panTo(p);
      e.preventDefault();
    });
    c.addEventListener("pointermove", (e) => { if (this.drag) this._panTo(this._local(e)); });
    const end = () => { this.drag = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    this._syncZoomUi();
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    // CSS 크기와 캔버스 픽셀 크기가 같도록 유지하지만 안전하게 비율 보정
    const sx = r.width ? this.layout.w / r.width : 1, sy = r.height ? this.layout.h / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  _panTo(p) {
    const d = thumbToDoc(p.x - this.drag.ox, p.y - this.drag.oy, this.layout.scale);
    this.app.viewport.centerOn(d.x, d.y);
  }

  _rect() {
    const vp = this.app.viewport;
    return viewRectOnThumb(
      { zoom: vp.zoom, panX: vp.panX, panY: vp.panY, cssW: vp.cssWidth, cssH: vp.cssHeight },
      this.layout.scale, this.layout.w, this.layout.h);
  }

  _onViewport() {
    this._syncZoomUi();
    if (this.thumb) this._paint();
  }

  _syncZoomUi() {
    const z = this.app.viewport.zoom;
    this.slider.value = String(zoomToSlider(z));
    if (document.activeElement !== this.pct) this.pct.value = `${Math.round(z * 1000) / 10}%`;
  }

  // 합성 결과로 썸네일을 다시 만든다(문서/패널 크기 변화 반영)
  _rebuildThumb() {
    const lm = this.app.layers;
    const boxW = Math.max(60, this.wrap.clientWidth - 8);
    const L = this.layout = navLayout(lm.width, lm.height, boxW, BOX_H);
    if (!L.scale) return;
    let t = this.thumb;
    if (!t) { t = this.thumb = document.createElement("canvas"); this.thumbCtx = t.getContext("2d"); }
    t.width = L.w; t.height = L.h;
    const tc = this.thumbCtx;
    // 투명 영역 표현(회색 체커)
    for (let y = 0; y < L.h; y += 6) for (let x = 0; x < L.w; x += 6) {
      tc.fillStyle = ((x + y) / 6) % 2 ? "#cfcfcf" : "#ffffff";
      tc.fillRect(x, y, 6, 6);
    }
    const s = lm._scratch;
    // 합성 캐시 재사용(그리는 중이면 직전 프레임 합성 — 다음 재합성 알림에서 갱신). 없을 때만 평탄화.
    const src = s && s.width === lm.width && s.height === lm.height ? s : lm.flatten();
    tc.imageSmoothingEnabled = true;
    tc.imageSmoothingQuality = "medium";
    tc.drawImage(src, 0, 0, lm.width, lm.height, 0, 0, L.w, L.h);
    if (this.canvas.width !== L.w || this.canvas.height !== L.h) {
      this.canvas.width = L.w; this.canvas.height = L.h;
      this.canvas.style.width = L.w + "px"; this.canvas.style.height = L.h + "px";
    }
    this._paint();
  }

  // 썸네일 + 뷰포트 사각형(빨강)
  _paint() {
    const ctx = this.ctx, L = this.layout;
    if (!L.scale || !this.thumb) return;
    ctx.clearRect(0, 0, L.w, L.h);
    ctx.drawImage(this.thumb, 0, 0);
    const { clipped } = this._rect();
    if (!clipped) return;
    ctx.strokeStyle = "#ff2a2a";
    ctx.lineWidth = 2;
    // 선이 썸네일 밖으로 반쯤 잘리지 않도록 1px 안쪽으로
    const x = Math.max(1, clipped.x), y = Math.max(1, clipped.y);
    const w = Math.min(L.w - 1, clipped.x + clipped.w) - x, h = Math.min(L.h - 1, clipped.y + clipped.h) - y;
    ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
  }
}
