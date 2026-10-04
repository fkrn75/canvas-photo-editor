// mcp-bridge.js — AI(MCP) 연결 브리지 (페이지 쪽)
//
// mcp/server.mjs(MCP 서버)가 127.0.0.1에 연 HTTP 브리지를 롱폴링해 명령을 받고, window.app API로
// 실행한 뒤 결과를 돌려준다. 명령 이름·인자 스키마의 단일 출처는 mcp/tools.mjs.
//
// 개인정보 원칙: 사용자가 [도움말 > AI 연결(MCP)]을 켜거나 URL에 ?mcp=1 을 붙였을 때만 동작한다.
// 꺼져 있으면 네트워크 호출 0. 켜져 있어도 통신 대상은 127.0.0.1(이 PC) 하나뿐이다.

import * as Adjust from "../engine/adjustments.js";
import * as Filters from "../engine/filters.js";
import { isValidBlendMode } from "../engine/blend.js";
import { EVT } from "../core/constants.js";
import { MoveLayerCommand, LayerPropCommand } from "../history/commands/layer-structure-command.js";
import { defaultTextData, renderTextLayer } from "../text/text-layer.js";
import { defaultShapeData, renderShapeLayer } from "../layers/shape-layer.js";
import { makeDefaultStyles, cloneStyles, DEFAULT_STYLES } from "../layers/layer-styles.js";
import { ADJUSTMENT_TYPES, defaultParams } from "../layers/adjustment-layer.js";

const LS_ENABLED = "cpe.mcp.enabled";
const LS_PORT = "cpe.mcp.port";
const DEFAULT_PORT = 8131;
const POLL_ABORT_MS = 30000;   // 서버 롱폴링(20초)보다 길게
const RETRY_MIN_MS = 3000;     // 서버가 없을 때 첫 재시도 간격
const RETRY_MAX_MS = 30000;    // 재시도 간격 상한(실패할 때마다 2배 — 콘솔 연결오류 소음 억제)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } };

// 인자 검증 헬퍼 — 실패 메시지는 그대로 AI에게 전달된다.
function need(cond, msg) { if (!cond) throw new Error(msg); }
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ImageData/Uint8Array → base64 (큰 버퍼도 콜스택 초과 없이)
function bytesToBase64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
async function canvasToBase64(canvas, mime = "image/png", quality) {
  const blob = await new Promise((res) => canvas.toBlob(res, mime, quality));
  need(blob, "이미지 인코딩에 실패했습니다(캔버스가 너무 큼).");
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
// 긴 변을 max로 축소한 사본(작으면 원본 그대로)
function downscale(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  if (k >= 1) return src;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 디코딩하지 못했습니다(손상되었거나 지원하지 않는 형식)."));
    img.src = src;
  });
}

// 보정/필터 이름 → (ImageData, params) 적용 함수. 전부 제자리 수정.
const FILTERS = {
  grayscale: (img) => Adjust.grayscale(img),
  invert: (img) => Adjust.invert(img),
  auto_tone: (img) => Adjust.autoTone(img),
  equalize: (img) => Adjust.equalize(img),
  sepia: (img) => Filters.sepia(img),
  emboss: (img) => Filters.emboss(img),
  find_edges: (img) => Filters.findEdges(img),
  brightness_contrast: (img, p) => Adjust.brightnessContrast(img, p.brightness ?? 0, p.contrast ?? 0),
  hue_saturation: (img, p) => Adjust.hueSaturation(img, p.hue ?? 0, p.saturation ?? 0, p.lightness ?? 0),
  levels: (img, p) => Adjust.levels(img, p.channel ?? "rgb", p.in_black ?? 0, p.in_white ?? 255, p.gamma ?? 1, p.out_black ?? 0, p.out_white ?? 255),
  threshold: (img, p) => Adjust.threshold(img, p.level ?? 128),
  posterize: (img, p) => Adjust.posterize(img, p.levels ?? 4),
  gradient_map: (img, p) => Adjust.gradientMap(img, Adjust.gradientLUTFromColors(p.color_a ?? "#000000", p.color_b ?? "#ffffff")),
  gaussian_blur: (img, p) => Filters.gaussianBlur(img, p.radius ?? 4),
  sharpen: (img, p) => Filters.sharpen(img, p.amount ?? 0.8),
  unsharp_mask: (img, p) => Filters.unsharpMask(img, p.amount ?? 50, p.radius ?? 2, p.threshold ?? 0),
  motion_blur: (img, p) => Filters.motionBlur(img, p.angle ?? 0, p.distance ?? 10),
  median: (img, p) => Filters.median(img, p.radius ?? 1),
  mosaic: (img, p) => Filters.mosaic(img, p.cell ?? 10),
  high_pass: (img, p) => Filters.highPass(img, p.radius ?? 3),
  add_noise: (img, p) => Filters.addNoise(img, p.amount ?? 24, p.mono ?? true),
};

export class McpBridge {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.port = parseInt(lsGet(LS_PORT), 10) || DEFAULT_PORT;
    this.state = "off";        // off | waiting | connected
    this._abort = null;
    this._statusEl = null;

    // URL ?mcp=1 (또는 ?mcp=<포트>) 이면 이번 세션에 켠다. 저장된 설정이 켜짐이면 자동 시작.
    const q = new URLSearchParams(location.search).get("mcp");
    if (q && q !== "0") {
      if (/^\d+$/.test(q) && q !== "1") this.port = parseInt(q, 10);
      this.enable({ persist: false });
    } else if (lsGet(LS_ENABLED) === "1") {
      this.enable({ persist: false });
    }
  }

  get baseUrl() { return `http://127.0.0.1:${this.port}`; }

  toggle() {
    if (this.enabled) { this.disable(); return; }
    // 확장 페이지면 127.0.0.1 접근 선택 권한을 요청한다(메뉴 클릭 = 사용자 제스처). 거부돼도 CORS 로 시도는 한다.
    const perms = globalThis.chrome?.permissions;
    if (perms?.request) {
      perms.request({ origins: ["http://127.0.0.1/*"] }).catch(() => false).finally(() => this.enable());
    } else {
      this.enable();
    }
  }

  enable({ persist = true } = {}) {
    if (this.enabled) return;
    this.enabled = true;
    if (persist) lsSet(LS_ENABLED, "1");
    this._setState("waiting");
    this.app.status?.(`AI 연결(MCP) 켜짐 — 127.0.0.1:${this.port} 의 MCP 서버를 기다립니다.`);
    this._loop();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    lsSet(LS_ENABLED, "0");
    this._abort?.abort();
    this._setState("off");
    this.app.status?.("AI 연결(MCP) 꺼짐");
  }

  // ── 상태바 표시 ──
  _setState(s) {
    this.state = s;
    if (!this._statusEl) {
      const bar = document.getElementById("statusbar");
      if (!bar) return;
      this._statusEl = document.createElement("span");
      this._statusEl.id = "status-mcp";
      this._statusEl.className = "status-mcp";
      this._statusEl.title = "AI 연결(MCP) — 클릭하면 끄기/켜기";
      this._statusEl.addEventListener("click", () => this.toggle());
      bar.appendChild(this._statusEl);
    }
    this._statusEl.dataset.state = s;
    this._statusEl.textContent = s === "connected" ? "AI 연결됨" : s === "waiting" ? "AI 대기 중" : "";
    this._statusEl.hidden = s === "off";
  }

  // ── 롱폴링 루프 ──
  async _loop() {
    let hello = true;
    let retry = RETRY_MIN_MS;
    while (this.enabled) {
      const ctrl = new AbortController();
      this._abort = ctrl;
      const timer = setTimeout(() => ctrl.abort(), POLL_ABORT_MS);
      let cmd = null;
      try {
        const qs = hello ? `?hello=1&v=${encodeURIComponent(this._version())}` : "";
        const r = await fetch(`${this.baseUrl}/poll${qs}`, { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(timer);
        hello = false;
        retry = RETRY_MIN_MS;
        if (this.state !== "connected") this._setState("connected");
        if (r.status === 200) cmd = await r.json();
      } catch {
        clearTimeout(timer);
        if (!this.enabled) break;
        hello = true;
        if (this.state !== "waiting") this._setState("waiting");
        await sleep(retry);
        retry = Math.min(RETRY_MAX_MS, retry * 2);
        continue;
      }
      if (cmd) await this._execute(cmd);
    }
  }

  _version() { return globalThis.chrome?.runtime?.getManifest?.()?.version || "dev"; }

  async _execute({ id, cmd, args }) {
    let body;
    try {
      const fn = this[`cmd_${cmd}`];
      need(typeof fn === "function", `에디터가 지원하지 않는 명령입니다: ${cmd} (에디터를 새로고침했는지 확인)`);
      const result = await fn.call(this, args || {});
      body = { id, ok: true, result: result ?? { ok: true } };
    } catch (e) {
      console.warn("[mcp-bridge]", cmd, e);
      body = { id, ok: false, error: e?.message || String(e) };
    }
    try {
      await fetch(`${this.baseUrl}/result`, {
        method: "POST",
        // text/plain 은 CORS 사전요청이 필요 없는 단순 요청이다.
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.warn("[mcp-bridge] 결과 전송 실패", e);
    }
  }

  // ── 공용 헬퍼 ──
  _layer(id) {
    const lm = this.app.layers;
    // id 는 숫자지만 AI 가 문자열로 보낼 수 있으므로 문자열로 비교한다.
    const L = id !== undefined && id !== null && id !== "" ? lm.layers.find((l) => String(l.id) === String(id)) : lm.activeLayer;
    need(L, id ? `레이어를 찾을 수 없습니다: ${id}` : "활성 레이어가 없습니다.");
    return L;
  }
  _pixelLayer(id) {
    const L = this._layer(id);
    need(L.type !== "adjustment", "조정 레이어에는 픽셀을 그릴 수 없습니다. 픽셀 레이어를 선택하거나 layer_add 로 만드세요.");
    return L;
  }
  _layerInfo(L, index) {
    const kind = L.type === "adjustment" ? "adjustment" : L.vectorText ? "text" : L.vectorShape ? "shape" : "pixel";
    const info = {
      id: L.id, index, name: L.name, kind,
      visible: L.visible, opacity: Math.round((L.opacity ?? 1) * 100),
      fill_opacity: Math.round((L.fillOpacity ?? 1) * 100),
      blend_mode: L.blendMode || "normal",
    };
    if (L.mask) info.has_mask = true;
    if (L.clipped) info.clipped = true;
    if (L.vectorText) info.text = L.vectorText.text;
    if (L.adjustmentType) info.adjustment_type = L.adjustmentType;
    const fx = L.styles && Object.keys(L.styles).filter((k) => L.styles[k]?.enabled);
    if (fx?.length) info.effects = fx;
    return info;
  }

  // 활성 레이어에 직접 그리기 + undo 1단계 (선택 영역이 있으면 클립)
  _paint(layer, box, label, drawFn) {
    const app = this.app;
    app.history.beginPixelEdit(layer);
    const ctx = layer.ctx;
    ctx.save();
    try {
      if (app.selection.active) app.selection.applyClipPath(ctx);
      drawFn(ctx);
    } catch (e) {
      ctx.restore();
      app.history.cancelPixelEdit();
      throw e;
    }
    ctx.restore();
    app.history.commitPixelEdit(box ? this._clampBox(box, layer) : null, label);
  }
  _clampBox(b, layer) {
    const x = clamp(Math.floor(b.x), 0, layer.width), y = clamp(Math.floor(b.y), 0, layer.height);
    const r = clamp(Math.ceil(b.x + b.w), 0, layer.width), btm = clamp(Math.ceil(b.y + b.h), 0, layer.height);
    return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
  }
  _pointsBox(points, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  _checkPoints(points, min = 1) {
    need(Array.isArray(points) && points.length >= min, `points 는 [[x,y],...] 형태로 최소 ${min}개 필요합니다.`);
    for (const p of points) need(Array.isArray(p) && finite(p[0]) && finite(p[1]), "points 의 각 항목은 [x,y] 숫자쌍이어야 합니다.");
  }

  // ════════════════════════ 명령 핸들러 (이름 = mcp/tools.mjs 의 도구 이름) ════════════════════════

  cmd_get_state() {
    const app = this.app, lm = app.layers, sel = app.selection;
    return {
      document: { name: app.docName, width: lm.width, height: lm.height, unsaved_changes: !!app.dirty },
      layers: lm.layers.map((L, i) => this._layerInfo(L, i)),
      layer_order: "index 0 = 맨 아래, 마지막 = 맨 위",
      active_layer_id: lm.activeId,
      selection: sel.active ? { bounds: { ...sel.bounds } } : null,
      colors: { foreground: app.state.foreground, background: app.state.background },
      tool: app.tools.activeId,
      history: { undo: app.history.undoStack.length, redo: app.history.redoStack.length },
    };
  }

  async cmd_get_image({ max_size = 1024, layer_id }) {
    const lm = this.app.layers;
    const src = layer_id ? this._layer(layer_id).canvas : lm.flatten();
    const view = downscale(src, clamp(max_size || 1024, 64, 2048));
    return {
      width: src.width, height: src.height, preview_size: [view.width, view.height],
      preview: { data: await canvasToBase64(view), mimeType: "image/png" },
    };
  }

  async cmd_export_image({ path = "", format, quality = 0.92 }) {
    const fmt = format || (/\.jpe?g$/i.test(path) ? "jpg" : "png");
    need(fmt === "png" || fmt === "jpg", "format 은 png 또는 jpg 입니다.");
    let src = this.app.layers.flatten();
    if (fmt === "jpg") {
      // JPG 는 알파가 없으므로 흰 배경에 합성(file-io.js 저장과 동일 규칙)
      const c = document.createElement("canvas");
      c.width = src.width; c.height = src.height;
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0);
      src = c;
    }
    const mime = fmt === "jpg" ? "image/jpeg" : "image/png";
    const data = await canvasToBase64(src, mime, fmt === "jpg" ? clamp(quality, 0, 1) : undefined);
    const view = downscale(src, 512);
    this.app.bus.emit(EVT.FILE_SAVED); // 파일로 저장했으므로 "저장 안 된 변경" 경고 해제
    return {
      format: fmt, width: src.width, height: src.height,
      image: { data, mimeType: mime },
      preview: { data: await canvasToBase64(view), mimeType: "image/png" },
    };
  }

  cmd_new_document({ width, height, background = "white", name }) {
    need(finite(width) && finite(height) && width >= 1 && height >= 1, "width/height 는 1 이상의 숫자여야 합니다.");
    const w = Math.round(width), h = Math.round(height);
    need(w <= 16384 && h <= 16384, "한 변은 16384px 을 넘을 수 없습니다.");
    const app = this.app;
    app._createDocument(w, h, { blank: true });
    if (name) app.docName = String(name);
    const base = app.layers.layers[0];
    if (background === "transparent") {
      base.ctx.clearRect(0, 0, w, h);
    } else if (background && background !== "white") {
      base.ctx.fillStyle = background;
      base.ctx.fillRect(0, 0, w, h);
    }
    app.layers.notifyContent(base.id);
    app.renderer.requestRender();
    return { width: w, height: h, background, layer_id: base.id };
  }

  async cmd_open_image({ data_url, name, as_layer = false, x = 0, y = 0 }) {
    need(typeof data_url === "string" && data_url.startsWith("data:image/"), "path 또는 data_url(data:image/...) 이 필요합니다.");
    const img = await loadImage(data_url);
    const app = this.app;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (as_layer && !app.isBlankDoc) {
      // 문서 크기 캔버스에 (x,y) 위치로 배치해 레이어로 추가
      const c = document.createElement("canvas");
      c.width = app.layers.width; c.height = app.layers.height;
      c.getContext("2d").drawImage(img, x, y);
      const L = app.layers.addLayer({ name: name || "가져온 이미지", image: c });
      return { mode: "layer", layer_id: L?.id, image_size: [w, h] };
    }
    const wasBlank = app.isBlankDoc;
    app.placeImage(img, name);
    return {
      mode: wasBlank ? "document" : "layer", image_size: [w, h],
      note: w * h > 8192 * 8192 ? "매우 큰 이미지라 에디터에 확인 다이얼로그가 떴을 수 있습니다." : undefined,
    };
  }

  cmd_layer_add({ name, fill }) {
    const L = this.app.layers.addLayer({ name: name || undefined, fill: fill || null });
    return { layer_id: L?.id ?? this.app.layers.activeId };
  }

  cmd_layer_update({ id, name, opacity, fill_opacity, visible, blend_mode }) {
    const lm = this.app.layers, L = this._layer(id), changed = [];
    if (name !== undefined) { lm.rename(L.id, String(name)); changed.push("name"); }
    if (opacity !== undefined) { need(finite(opacity), "opacity 는 0~100"); lm.setOpacity(L.id, clamp(opacity, 0, 100) / 100); changed.push("opacity"); }
    if (fill_opacity !== undefined) { need(finite(fill_opacity), "fill_opacity 는 0~100"); lm.setFillOpacity(L.id, clamp(fill_opacity, 0, 100) / 100); changed.push("fill_opacity"); }
    if (blend_mode !== undefined) { need(isValidBlendMode(blend_mode), `알 수 없는 블렌드 모드: ${blend_mode}`); lm.setBlendMode(L.id, blend_mode); changed.push("blend_mode"); }
    if (visible !== undefined && !!visible !== !!L.visible) {
      this.app.history.execute(new LayerPropCommand(lm, L.id, "visible", L.visible, !!visible));
      changed.push("visible");
    }
    return { layer: this._layerInfo(L, lm.indexOf(L.id)), changed };
  }

  cmd_layer_op({ op, id }) {
    const app = this.app, lm = app.layers;
    const L = this._layer(id);
    const idx = lm.indexOf(L.id);
    switch (op) {
      case "select": lm.setActive(L.id); break;
      case "delete": need(lm.count > 1, "마지막 레이어는 삭제할 수 없습니다."); lm.removeLayer(L.id); break;
      case "duplicate": lm.duplicateLayer(L.id); break;
      case "up": need(idx < lm.count - 1, "이미 맨 위입니다."); lm.moveLayer(L.id, 1); break;
      case "down": need(idx > 0, "이미 맨 아래입니다."); lm.moveLayer(L.id, -1); break;
      case "top":
      case "bottom": {
        const to = op === "top" ? lm.count - 1 : 0;
        if (to !== idx) app.history.execute(new MoveLayerCommand(lm, L.id, idx, to));
        break;
      }
      case "merge_down": need(idx > 0, "아래 레이어가 없습니다."); lm.mergeDown(L.id); break;
      case "merge_visible": lm.mergeVisible(); break;
      case "flatten": app.flattenImage(); break;
      default: throw new Error(`알 수 없는 op: ${op}`);
    }
    return { op, active_layer_id: lm.activeId, layers: lm.layers.map((x, i) => this._layerInfo(x, i)) };
  }

  cmd_set_layer_style({ id, effects = {}, clear = false }) {
    const lm = this.app.layers, L = this._pixelLayer(id);
    need(effects && typeof effects === "object", "effects 는 객체여야 합니다.");
    const before = L.styles ? cloneStyles(L.styles) : null;
    const next = before ? cloneStyles(before) : makeDefaultStyles();
    if (clear) for (const k of Object.keys(next)) if (next[k]) next[k].enabled = false;
    for (const [k, v] of Object.entries(effects)) {
      need(k in DEFAULT_STYLES, `알 수 없는 효과: ${k} (사용 가능: ${Object.keys(DEFAULT_STYLES).join(", ")})`);
      need(v && typeof v === "object", `${k} 값은 객체여야 합니다.`);
      next[k] = { ...DEFAULT_STYLES[k], ...(next[k] || {}), enabled: true, ...v };
    }
    this.app.history.execute(new LayerPropCommand(lm, L.id, "styles", before, next));
    return { layer_id: L.id, enabled: Object.keys(next).filter((k) => next[k]?.enabled) };
  }

  cmd_select({ mode, x, y, width, height, points, feather, expand, contract }) {
    const app = this.app, sel = app.selection;
    switch (mode) {
      case "rect":
      case "ellipse":
        need([x, y, width, height].every(finite) && width > 0 && height > 0, "rect/ellipse 는 x, y, width(>0), height(>0) 가 필요합니다.");
        mode === "rect" ? sel.setRect(x, y, width, height) : sel.setEllipse(x, y, width, height);
        break;
      case "polygon":
        this._checkPoints(points, 3);
        sel.setPolygon(points.map(([px, py]) => ({ x: px, y: py })));
        break;
      case "all": sel.selectAll(); break;
      case "none": sel.clear(); break;
      case "invert": need(sel.active, "반전할 선택 영역이 없습니다."); sel.invert(); break;
      case "opaque": app.selectOpaque(); break;
      default: throw new Error(`알 수 없는 mode: ${mode}`);
    }
    if (sel.active) {
      if (finite(expand) && expand > 0) sel.expand(expand);
      if (finite(contract) && contract > 0) sel.contract(contract);
      if (finite(feather) && feather > 0) sel.feather(feather);
    }
    app.renderer.requestOverlayRender();
    return { selection: sel.active ? { bounds: { ...sel.bounds } } : null };
  }

  cmd_fill({ color, gradient, opacity = 1 }) {
    const L = this._pixelLayer();
    need(color || gradient, "color 또는 gradient 가 필요합니다.");
    const sel = this.app.selection;
    const box = sel.active ? sel.bounds : null;
    this._paint(L, box, gradient ? "그라디언트 채우기" : "채우기", (ctx) => {
      ctx.globalAlpha = clamp(opacity, 0, 1);
      if (gradient) {
        const { type = "linear", from, to, stops } = gradient;
        need(Array.isArray(from) && Array.isArray(to), "gradient.from / gradient.to 는 [x,y] 입니다.");
        need(Array.isArray(stops) && stops.length >= 2, "gradient.stops 는 [[0,색],[1,색]] 처럼 2개 이상입니다.");
        const g = type === "radial"
          ? ctx.createRadialGradient(from[0], from[1], 0, from[0], from[1], Math.hypot(to[0] - from[0], to[1] - from[1]))
          : ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
        for (const [off, c] of stops) g.addColorStop(clamp(off, 0, 1), c);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillRect(0, 0, L.width, L.height);
    });
    return { layer_id: L.id, area: box ? { ...box } : "layer" };
  }

  cmd_draw_shape({ shape, x, y, width, height, radius = 0, points, fill, stroke, stroke_width = 2, opacity = 1 }) {
    const L = this._pixelLayer();
    need(fill || stroke, "fill 또는 stroke 색 중 하나는 필요합니다.");
    const sw = Math.max(0, stroke_width);
    let box;
    const path = new Path2D();
    if (shape === "rect" || shape === "ellipse") {
      need([x, y, width, height].every(finite), `${shape} 는 x, y, width, height 가 필요합니다.`);
      if (shape === "rect") {
        if (radius > 0 && path.roundRect) path.roundRect(x, y, width, height, radius);
        else path.rect(x, y, width, height);
      } else {
        path.ellipse(x + width / 2, y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
      }
      box = { x: Math.min(x, x + width) - sw, y: Math.min(y, y + height) - sw, w: Math.abs(width) + sw * 2, h: Math.abs(height) + sw * 2 };
    } else if (shape === "line" || shape === "polyline" || shape === "polygon") {
      this._checkPoints(points, shape === "polygon" ? 3 : 2);
      path.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points.slice(1)) path.lineTo(px, py);
      if (shape === "polygon") path.closePath();
      box = this._pointsBox(points, sw + 2);
    } else {
      throw new Error(`알 수 없는 shape: ${shape}`);
    }
    const closed = shape !== "line" && shape !== "polyline";
    this._paint(L, box, "도형 그리기", (ctx) => {
      ctx.globalAlpha = clamp(opacity, 0, 1);
      if (fill && closed) { ctx.fillStyle = fill; ctx.fill(path); }
      const strokeColor = stroke || (!closed ? fill : null);
      if (strokeColor && sw > 0) {
        ctx.strokeStyle = strokeColor; ctx.lineWidth = sw;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.stroke(path);
      }
    });
    return { layer_id: L.id, bounds: this._clampBox(box, L) };
  }

  cmd_draw_stroke({ points, color, size, opacity = 1, hardness = 1, smooth = true, erase = false }) {
    this._checkPoints(points, 1);
    const app = this.app, L = this._pixelLayer();
    const d = Math.max(1, finite(size) ? size : (app.state.brushSize || 10));
    const hard = clamp(hardness, 0, 1);
    const blur = (1 - hard) * d * 0.35;
    // 오프스크린에 획 하나를 그린 뒤 한 번에 합성 — 겹침으로 불투명도가 누적되지 않게 한다.
    const off = document.createElement("canvas");
    off.width = L.width; off.height = L.height;
    const g = off.getContext("2d");
    g.strokeStyle = g.fillStyle = color || app.state.foreground;
    g.lineWidth = blur > 0 ? Math.max(1, d - blur) : d;
    g.lineCap = "round"; g.lineJoin = "round";
    if (blur > 0) g.filter = `blur(${blur.toFixed(2)}px)`;
    if (points.length === 1) {
      g.beginPath(); g.arc(points[0][0], points[0][1], g.lineWidth / 2, 0, Math.PI * 2); g.fill();
    } else {
      g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      if (smooth && points.length > 2) {
        // 중점을 지나는 2차 곡선으로 보간(브러시 손떨림 보정과 같은 방식)
        for (let i = 1; i < points.length - 1; i++) {
          const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
          g.quadraticCurveTo(points[i][0], points[i][1], mx, my);
        }
        const last = points[points.length - 1];
        g.lineTo(last[0], last[1]);
      } else {
        for (const [px, py] of points.slice(1)) g.lineTo(px, py);
      }
      g.stroke();
    }
    const box = this._pointsBox(points, d / 2 + blur * 2 + 2);
    this._paint(L, box, erase ? "지우기" : "브러시", (ctx) => {
      ctx.globalAlpha = clamp(opacity, 0, 1);
      if (erase) ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(off, 0, 0);
    });
    return { layer_id: L.id, bounds: this._clampBox(box, L), size: d };
  }

  cmd_add_text({ text, x, y, font_size, font_family, color, bold, italic, align, line_height, letter_spacing, name }) {
    need(typeof text === "string" && text.length > 0, "text 가 비어 있습니다.");
    need(finite(x) && finite(y), "x, y 가 필요합니다.");
    const app = this.app;
    const o = { text, x, y };
    if (finite(font_size)) o.fontSize = font_size;
    if (font_family) o.fontFamily = font_family;
    o.color = color || app.state.foreground;
    if (bold !== undefined) o.bold = !!bold;
    if (italic !== undefined) o.italic = !!italic;
    if (align) o.align = align;
    if (finite(line_height)) o.lineHeight = line_height;
    if (finite(letter_spacing)) o.letterSpacing = letter_spacing;
    // addLayer 의 AddLayerCommand 가 같은 레이어 객체를 재삽입하므로 vectorText 도 undo/redo 에 포함된다.
    const L = app.layers.addLayer({ name: name || text.split("\n")[0].slice(0, 30) });
    L.vectorText = defaultTextData(o);
    renderTextLayer(L);
    app.layers.notifyContent(L.id);
    return { layer_id: L.id };
  }

  cmd_add_shape_layer({ kind, x, y, width, height, radius, sides = 6, angle = 0, corner_radius, fill_color, stroke_color, stroke_width, no_fill = false, name }) {
    need(finite(x) && finite(y), "x, y 가 필요합니다.");
    const app = this.app;
    const o = { fill: !no_fill, fillColor: fill_color || app.state.foreground };
    if (stroke_width > 0 || stroke_color) {
      o.stroke = true;
      o.strokeColor = stroke_color || "#000000";
      if (finite(stroke_width)) o.strokeWidth = stroke_width;
    }
    if (kind === "polygon") {
      need(finite(radius) && radius > 0, "polygon 은 radius(>0) 가 필요합니다.");
      o.polygon = { cx: x, cy: y, radius, sides: clamp(Math.round(sides), 3, 12), angle };
    } else if (kind === "rect" || kind === "ellipse" || kind === "rounded") {
      need(finite(width) && finite(height) && width > 0 && height > 0, `${kind} 는 width/height(>0) 가 필요합니다.`);
      o.rect = { x, y, w: width, h: height };
      if (finite(corner_radius)) o.cornerRadius = corner_radius;
    } else {
      throw new Error(`알 수 없는 kind: ${kind}`);
    }
    const labels = { rect: "사각형", ellipse: "타원", rounded: "둥근 사각형", polygon: "다각형" };
    const L = app.layers.addLayer({ name: name || labels[kind] });
    L.vectorShape = defaultShapeData(kind, o);
    renderShapeLayer(L);
    app.layers.notifyContent(L.id);
    return { layer_id: L.id };
  }

  cmd_apply_filter({ name, params = {}, layer_id }) {
    const fn = FILTERS[name];
    need(fn, `알 수 없는 필터: ${name} (사용 가능: ${Object.keys(FILTERS).join(", ")})`);
    const app = this.app;
    if (layer_id !== undefined) app.layers.setActive(this._pixelLayer(layer_id).id);
    const L = this._pixelLayer();
    app.applyFilter(name, (img) => {
      const out = fn(img, params || {});
      // 방어: 새 ImageData 를 반환하는 구현이 생겨도 결과가 반영되게 한다.
      if (out && out !== img && out.data) img.data.set(out.data);
    });
    return { layer_id: L.id, filter: name, selection_only: app.selection.active };
  }

  cmd_add_adjustment_layer({ type, params }) {
    need(type in ADJUSTMENT_TYPES, `알 수 없는 조정 타입: ${type}`);
    const p = { ...defaultParams(type), ...(params || {}) };
    const L = this.app.layers.addAdjustmentLayer(type, p);
    return { layer_id: L?.id ?? this.app.layers.activeId, type, params: p };
  }

  cmd_transform({ op, width, height, keep_aspect = true }) {
    const app = this.app, lm = app.layers;
    switch (op) {
      case "rotate_cw": app.rotate90(1); break;
      case "rotate_ccw": app.rotate90(-1); break;
      case "rotate_180": {
        const act = app.actions?.registry?.find((a) => a.id === "img.rotate180");
        if (act) act.run(app, {}); else { app.rotate90(1); app.rotate90(1); }
        break;
      }
      case "flip_h": app.flip("h"); break;
      case "flip_v": app.flip("v"); break;
      case "crop_to_selection": need(app.selection.active, "자를 선택 영역이 없습니다. 먼저 select 로 영역을 지정하세요."); app.cropToSelection(); break;
      case "resize_image":
      case "resize_canvas": {
        let w = width, h = height;
        if (op === "resize_image" && keep_aspect) {
          if (finite(w) && !finite(h)) h = Math.round(lm.height * (w / lm.width));
          if (finite(h) && !finite(w)) w = Math.round(lm.width * (h / lm.height));
        }
        need(finite(w) && finite(h) && w >= 1 && h >= 1 && w <= 16384 && h <= 16384, "width/height 는 1~16384 입니다.");
        op === "resize_image" ? app.resizeImage(Math.round(w), Math.round(h)) : app.resizeCanvas(Math.round(w), Math.round(h));
        break;
      }
      default: throw new Error(`알 수 없는 op: ${op}`);
    }
    return { op, width: lm.width, height: lm.height };
  }

  cmd_set_colors({ foreground, background, swap, reset }) {
    const st = this.app.state;
    if (reset) st.resetColors();
    if (swap) st.swapColors();
    // 형식을 #rrggbb 로 정규화(state 는 hex 를 기대)
    const toHex = (c) => {
      const g = document.createElement("canvas").getContext("2d");
      g.fillStyle = "#000"; g.fillStyle = c;
      need(/^#[0-9a-f]{6}$/i.test(g.fillStyle), `반투명/알 수 없는 색은 쓸 수 없습니다: ${c}`);
      return g.fillStyle;
    };
    if (foreground) st.set("foreground", toHex(foreground));
    if (background) st.set("background", toHex(background));
    return { foreground: st.foreground, background: st.background };
  }

  cmd_history({ action, steps = 1 }) {
    const h = this.app.history;
    const n = clamp(Math.round(steps) || 1, 1, 100);
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (action === "undo" ? !h.canUndo : !h.canRedo) break;
      action === "undo" ? h.undo() : h.redo();
      done++;
    }
    need(action === "undo" || action === "redo", `알 수 없는 action: ${action}`);
    return { action, done, undo: h.undoStack.length, redo: h.redoStack.length };
  }
}
