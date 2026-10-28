// histogram-panel.js — 히스토그램 패널(창 > 히스토그램).
// 채널(광도/RGB/빨강/녹색/파랑)·소스(전체 이미지 합성/현재 레이어)를 고르면 256단계 분포와
// 평균·표준 편차·중앙값·픽셀 수를 보여준다. 선택 영역이 있으면 그 안의 픽셀만 센다.
// 문서가 바뀌면(렌더러 재합성 알림) 디바운스로 다시 계산하고, 큰 이미지는 최근접 다운샘플(최대 MAX_SAMPLE 픽셀)로 계산한다.
// 완전히 투명한 픽셀(알파 0)은 세지 않는다.
// 순수 함수(computeHistogram/histogramStats/channelBins/sampleSize)는 DOM 없이 단위 테스트한다.

import { EVT } from "../core/constants.js";
import { createRefresher, collapseOnFirstSeen } from "./panel-refresh.js";

// 히스토그램 계산 시 최대 표본 픽셀 수(이보다 크면 다운샘플)
export const MAX_SAMPLE = 1_000_000;

// 광도 가중치(Rec.601 — 포토샵 광도 히스토그램과 같은 계열)
const LUM_R = 0.299, LUM_G = 0.587, LUM_B = 0.114;

// 채널 목록 [값, 표시명]
const CHANNELS = [["lum", "광도"], ["rgb", "RGB"], ["r", "빨강"], ["g", "녹색"], ["b", "파랑"]];

// RGBA 바이트 배열의 채널별 256단계 분포.
//   opts.mask/maskW: 선택 마스크(문서 크기, 128 이상이면 포함) — 표본 좌표를 문서 좌표로 바꾸는 xMap/yMap과 함께 쓴다
//   반환: { r, g, b, lum: Uint32Array(256), pixels: 센 픽셀 수 }
export function computeHistogram(data, width, height, opts = {}) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), lum = new Uint32Array(256);
  const { mask = null, maskW = width, xMap = null, yMap = null } = opts;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    const my = mask ? (yMap ? yMap[y] : y) * maskW : 0;
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
      if (data[i + 3] === 0) continue;
      if (mask && mask[my + (xMap ? xMap[x] : x)] < 128) continue;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      r[R]++; g[G]++; b[B]++;
      lum[Math.round(LUM_R * R + LUM_G * G + LUM_B * B)]++;
      pixels++;
    }
  }
  return { r, g, b, lum, pixels };
}

// 채널 키에 해당하는 분포. "rgb"는 세 채널을 합친 분포(포토샵 RGB 통계와 같은 방식).
export function channelBins(hist, channel) {
  if (channel === "r" || channel === "g" || channel === "b" || channel === "lum") return hist[channel];
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) out[i] = hist.r[i] + hist.g[i] + hist.b[i];
  return out;
}

// 256단계 분포의 통계: 평균, 표준 편차(모집단), 중앙값, 표본 수. 비어 있으면 모두 0.
export function histogramStats(bins) {
  let count = 0, sum = 0;
  for (let i = 0; i < bins.length; i++) { count += bins[i]; sum += i * bins[i]; }
  if (count === 0) return { mean: 0, std: 0, median: 0, count: 0 };
  const mean = sum / count;
  let v = 0;
  for (let i = 0; i < bins.length; i++) if (bins[i]) v += bins[i] * (i - mean) * (i - mean);
  // 중앙값: 누적 개수가 절반에 처음 도달하는 단계
  const half = count / 2;
  let acc = 0, median = 0;
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i];
    if (acc >= half) { median = i; break; }
  }
  return { mean, std: Math.sqrt(v / count), median, count };
}

// 다운샘플 크기: w*h가 maxPixels 이하가 되도록 비율 유지 축소(작으면 그대로)
export function sampleSize(w, h, maxPixels = MAX_SAMPLE) {
  if (w * h <= maxPixels) return { w, h, factor: 1 };
  const f = Math.sqrt(maxPixels / (w * h));
  return { w: Math.max(1, Math.floor(w * f)), h: Math.max(1, Math.floor(h * f)), factor: f };
}

export class HistogramPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    if (!el) return;
    this.channel = "lum";
    this.source = "composite";
    this.hist = null;
    collapseOnFirstSeen(el);
    this._build();
    this.refresher = createRefresher(el, () => this._recompute(), 200, this.canvas);
    const req = () => this.refresher.request();
    app.renderer.onComposite(req);
    app.bus.on(EVT.SELECTION_CHANGED, req);
    app.bus.on(EVT.DOCUMENT_CHANGED, req);
    app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => { if (this.source === "layer") req(); });
    // 레이어 소스일 때 활성 레이어 픽셀 변경은 합성 알림으로도 잡히지만, 숨긴 레이어는 합성이 안 바뀔 수 있어 보강
    app.bus.on(EVT.LAYERS_CHANGED, () => { if (this.source === "layer") req(); });
    req();
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">히스토그램</div>
      <div class="info-panel-body hist-body">
        <div class="hist-controls">
          <label>채널 <select class="hist-ch">${CHANNELS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
          <label>소스 <select class="hist-src"><option value="composite">전체 이미지</option><option value="layer">현재 레이어</option></select></label>
          <button class="hist-refresh" title="다시 계산">↻</button>
        </div>
        <canvas class="hist-canvas" width="256" height="100"></canvas>
        <div class="hist-stats"></div>
      </div>`;
    this.canvas = this.el.querySelector(".hist-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.statsEl = this.el.querySelector(".hist-stats");
    this.el.querySelector(".hist-ch").addEventListener("change", (e) => { this.channel = e.target.value; this._draw(); });
    this.el.querySelector(".hist-src").addEventListener("change", (e) => { this.source = e.target.value; this.refresher.now(); });
    this.el.querySelector(".hist-refresh").addEventListener("click", () => this.refresher.now());
  }

  // 계산 대상 캔버스(문서 크기). 합성은 렌더러가 만들어 둔 캐시를 재사용(없으면 평탄화).
  _sourceCanvas() {
    const lm = this.app.layers;
    if (!lm.width || !lm.height) return null;
    if (this.source === "layer") {
      const L = lm.activeLayer;
      if (!L || L.type === "adjustment" || !L.canvas) return null;
      return L.canvas;
    }
    // 그리는 도중(캐시 dirty)이어도 직전 합성을 그대로 쓴다 — 다음 재합성 알림에서 다시 갱신되므로
    // 큰 문서에서 매번 flatten(전체 재합성)을 돌리지 않는다. 캐시가 아예 없을 때만 평탄화.
    const s = lm._scratch;
    if (s && s.width === lm.width && s.height === lm.height) return s;
    return lm.flatten();
  }

  _recompute() {
    const src = this._sourceCanvas();
    if (!src) { this.hist = null; this._draw(); return; }
    const W = src.width, H = src.height;
    const sz = sampleSize(W, H);
    let data;
    if (sz.factor === 1) {
      data = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    } else {
      // 최근접 다운샘플(스무딩 끔 → 원본 픽셀 값을 그대로 표본으로 사용)
      let t = this._tmp;
      if (!t) { t = this._tmp = document.createElement("canvas"); this._tmpCtx = t.getContext("2d", { willReadFrequently: true }); }
      t.width = sz.w; t.height = sz.h;
      const c = this._tmpCtx;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, sz.w, sz.h);
      c.drawImage(src, 0, 0, W, H, 0, 0, sz.w, sz.h);
      data = c.getImageData(0, 0, sz.w, sz.h).data;
    }
    const opts = {};
    const sel = this.app.selection;
    if (sel?.active && sel.mask && sel.mask.length === W * H) {
      opts.mask = sel.mask;
      opts.maskW = W;
      if (sz.factor !== 1) {
        opts.xMap = new Int32Array(sz.w).map((_, x) => Math.min(W - 1, Math.floor((x + 0.5) * W / sz.w)));
        opts.yMap = new Int32Array(sz.h).map((_, y) => Math.min(H - 1, Math.floor((y + 0.5) * H / sz.h)));
      }
    }
    this.hist = computeHistogram(data, sz.w, sz.h, opts);
    this.sampled = sz.factor !== 1;
    this.sampleRatio = (sz.w * sz.h) / (W * H);
    this._draw();
  }

  _draw() {
    const ctx = this.ctx, Wc = this.canvas.width, Hc = this.canvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, Wc, Hc);
    if (!this.hist) {
      this.statsEl.textContent = this.source === "layer" ? "현재 레이어에 픽셀이 없습니다." : "-";
      return;
    }
    const drawBins = (bins, color, maxV) => {
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i++) {
        if (!bins[i]) continue;
        const h = Math.max(1, Math.round((bins[i] / maxV) * (Hc - 2)));
        ctx.fillRect(i * Wc / 256, Hc - h, Math.max(1, Wc / 256), h);
      }
    };
    const maxOf = (bins) => { let m = 0; for (let i = 0; i < 256; i++) if (bins[i] > m) m = bins[i]; return m || 1; };
    const h = this.hist;
    if (this.channel === "rgb") {
      // 세 채널을 가산 합성으로 겹쳐 그림(겹친 곳은 노랑/청록/자홍/흰색)
      const m = Math.max(maxOf(h.r), maxOf(h.g), maxOf(h.b));
      ctx.globalCompositeOperation = "lighter";
      drawBins(h.r, "rgb(220,40,40)", m);
      drawBins(h.g, "rgb(40,200,40)", m);
      drawBins(h.b, "rgb(50,90,235)", m);
      ctx.globalCompositeOperation = "source-over";
    } else {
      const bins = channelBins(h, this.channel);
      const color = { lum: "#d6d6d6", r: "#e04848", g: "#48c048", b: "#5a8cf0" }[this.channel];
      drawBins(bins, color, maxOf(bins));
    }
    const st = histogramStats(channelBins(h, this.channel));
    const fmt = (v) => v.toFixed(2);
    const px = this.sampled
      ? `약 ${Math.round(h.pixels / this.sampleRatio).toLocaleString()} (표본 ${h.pixels.toLocaleString()})`
      : h.pixels.toLocaleString();
    this.statsEl.innerHTML = "";
    for (const [k, v] of [["평균", fmt(st.mean)], ["표준 편차", fmt(st.std)], ["중앙값", String(st.median)], ["픽셀 수", px]]) {
      const a = document.createElement("span"); a.className = "k"; a.textContent = k;
      const b = document.createElement("span"); b.className = "v"; b.textContent = v;
      this.statsEl.append(a, b);
    }
  }
}
