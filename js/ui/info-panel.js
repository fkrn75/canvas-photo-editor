// info-panel.js — 정보 패널(창 > 정보).
// 커서 위치(문서 px), 커서 아래 합성 픽셀의 RGB·HSB·알파, 선택 영역 크기(W×H), 문서 크기,
// 색상 샘플러(state.colorSamplers) 지점의 현재 RGB를 보여준다.
// 픽셀 값은 렌더러가 만들어 둔 합성 캐시(layers._scratch)에서 1px만 읽는다(커서 이동은 rAF로 묶음).

import { EVT } from "../core/constants.js";
import { createRefresher, collapseOnFirstSeen } from "./panel-refresh.js";

// RGB(0~255) → HSB(H 0~360°, S·B 0~100%), 정수 반올림
export function rgbToHsb(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: Math.round(h) % 360, s: Math.round(s * 100), b: Math.round(max * 100) };
}

export class InfoPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    if (!el) return;
    this.cursor = null;   // 캔버스 기준 화면 좌표(없으면 커서가 캔버스 밖)
    this._raf = 0;
    collapseOnFirstSeen(el);
    this._build();
    this.refresher = createRefresher(el, () => this._update(), 60, this.body);

    const c = app.canvas;
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this._schedule();
    });
    c.addEventListener("pointerleave", () => { this.cursor = null; this._schedule(); });
    const req = () => this.refresher.request();
    app.renderer.onComposite(req);
    app.bus.on(EVT.SELECTION_CHANGED, req);
    app.bus.on(EVT.DOCUMENT_CHANGED, req);
    app.bus.on(EVT.VIEWPORT_CHANGED, req);
    app.bus.on(EVT.STATE_CHANGED, ({ key } = {}) => { if (key === "colorSamplers") req(); });
    // 샘플러는 도구가 배열을 직접 수정하므로 포인터를 놓을 때도 갱신
    c.addEventListener("pointerup", req);
    req();
  }

  // 커서 이동은 프레임당 1회만 갱신
  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.refresher.now(); });
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">정보</div>
      <div class="info-panel-body">
        <div class="info-grid">
          <div class="info-block"><span class="k">R</span><span class="v" data-f="r"></span><span class="k">G</span><span class="v" data-f="g"></span><span class="k">B</span><span class="v" data-f="b"></span><span class="k">A</span><span class="v" data-f="a"></span></div>
          <div class="info-block"><span class="k">H</span><span class="v" data-f="hh"></span><span class="k">S</span><span class="v" data-f="ss"></span><span class="k">B</span><span class="v" data-f="bb"></span></div>
          <div class="info-block"><span class="k">X</span><span class="v" data-f="x"></span><span class="k">Y</span><span class="v" data-f="y"></span></div>
          <div class="info-block"><span class="k">W</span><span class="v" data-f="w"></span><span class="k">H</span><span class="v" data-f="h"></span></div>
        </div>
        <div class="info-line"><span class="k">문서</span> <span data-f="doc"></span></div>
        <div class="info-samplers"></div>
      </div>`;
    this.body = this.el.querySelector(".info-panel-body");
    this.f = {};
    this.el.querySelectorAll("[data-f]").forEach((n) => { this.f[n.dataset.f] = n; });
    this.samplersEl = this.el.querySelector(".info-samplers");
  }

  // 합성 캐시에서 문서 좌표 (x,y) 픽셀 RGBA. 범위 밖/캐시 없음이면 null.
  _pixel(x, y) {
    const lm = this.app.layers;
    if (x < 0 || y < 0 || x >= lm.width || y >= lm.height) return null;
    const s = lm._scratch, sc = lm._scratchCtx;
    if (!s || !sc || s.width !== lm.width || s.height !== lm.height) return null;
    return sc.getImageData(x, y, 1, 1).data;
  }

  _set(key, text) {
    const n = this.f[key];
    if (n && n.textContent !== text) n.textContent = text;
  }

  _update() {
    const app = this.app, lm = app.layers;
    let p = null, wx = null, wy = null;
    if (this.cursor) {
      const w = app.viewport.screenToWorld(this.cursor.x, this.cursor.y);
      wx = Math.floor(w.x); wy = Math.floor(w.y);
      p = this._pixel(wx, wy);
    }
    this._set("x", wx == null ? "-" : String(wx));
    this._set("y", wy == null ? "-" : String(wy));
    if (p) {
      const hsb = rgbToHsb(p[0], p[1], p[2]);
      this._set("r", String(p[0])); this._set("g", String(p[1])); this._set("b", String(p[2]));
      this._set("a", `${Math.round((p[3] / 255) * 100)}%`);
      this._set("hh", `${hsb.h}°`); this._set("ss", `${hsb.s}%`); this._set("bb", `${hsb.b}%`);
    } else {
      for (const k of ["r", "g", "b", "a", "hh", "ss", "bb"]) this._set(k, "-");
    }
    const b = app.selection?.active ? app.selection.bounds : null;
    this._set("w", b ? String(b.w) : "-");
    this._set("h", b ? String(b.h) : "-");
    this._set("doc", `${lm.width} × ${lm.height} px`);
    this._updateSamplers();
  }

  // 색상 샘플러 지점별 RGB(합성 기준, 실시간)
  _updateSamplers() {
    const list = Array.isArray(this.app.state.colorSamplers) ? this.app.state.colorSamplers : [];
    const lines = list.map((s, i) => {
      const p = this._pixel(Math.floor(s.x), Math.floor(s.y));
      return p ? `#${i + 1}  R ${p[0]}  G ${p[1]}  B ${p[2]}` : `#${i + 1}  -`;
    });
    const text = lines.join("\n");
    if (this.samplersEl.textContent !== text) this.samplersEl.textContent = text;
    this.samplersEl.style.display = lines.length ? "" : "none";
  }
}
