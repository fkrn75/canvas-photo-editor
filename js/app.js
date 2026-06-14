// app.js — 애플리케이션 진입점. 모든 매니저/UI를 생성·연결하고 전역 단축키와 고수준 액션을 제공한다.

import { EventBus } from "./core/event-bus.js";
import { AppState } from "./core/state.js";
import { EVT, DEFAULT_DOC, TOOL } from "./core/constants.js";
import { LayerManager } from "./layers/layer-manager.js";
import { Viewport } from "./render/viewport.js";
import { Renderer } from "./render/renderer.js";
import { CommandManager } from "./history/command-manager.js";
import { SelectionManager } from "./selection/selection-manager.js";
import { ToolManager } from "./tools/tool-manager.js";
import { FileIO } from "./io/file-io.js";
import { Clipboard } from "./io/clipboard.js";
import { Toolbar } from "./ui/toolbar.js";
import { ColorPanel } from "./ui/color-panel.js";
import { OptionsBar } from "./ui/options-bar.js";
import { LayersPanel } from "./ui/layers-panel.js";
import { SwatchesPanel } from "./ui/swatches-panel.js";
import { HistoryPanel } from "./ui/history-panel.js";
import { ChannelsPanel } from "./ui/channels-panel.js";
import { MenuBar } from "./ui/menu-bar.js";
import { Dialogs } from "./ui/dialogs.js";
import { DocumentTransformCommand } from "./history/commands/document-command.js";
import { FlattenCommand } from "./history/commands/layer-structure-command.js";
import { openColorRange, openSaveSelection, openLoadSelection } from "./ui/select-dialogs.js";
import { openAdjustmentLayerDialog } from "./ui/adjustment-layer-dialog.js";
import { QuickMask } from "./selection/quick-mask.js";
import { FreeTransform } from "./transform/free-transform.js";
import { PathManager } from "./paths/path-manager.js";
import { PathsPanel } from "./ui/paths-panel.js";

class App {
  constructor() {
    this.bus = new EventBus();
    this.state = new AppState(this.bus);
    this.docName = "untitled";
    this.isBlankDoc = true;

    // 코어 매니저 (생성 순서 주의: 서로 app을 통해 참조)
    this.layers = new LayerManager(this);
    this.viewport = new Viewport(this, document.getElementById("viewport"));
    this.canvas = document.getElementById("view");
    this.renderer = new Renderer(this, this.canvas);
    this.history = new CommandManager(this);
    this.selection = new SelectionManager(this);
    this.paths = new PathManager(this);
    this.quickMask = new QuickMask(this);   // 빠른 마스크 모드 (tools보다 먼저 생성)
    this.tools = new ToolManager(this, this.canvas);
    this.fileIO = new FileIO(this);
    this.clipboard = new Clipboard(this);
    this.dialogs = new Dialogs(this);
    this.freeTransform = new FreeTransform(this);   // 자유 변형(Ctrl+T)

    // UI 패널
    this.toolbar = new Toolbar(this, document.getElementById("toolbar"));
    this.colorPanel = new ColorPanel(this, document.getElementById("colorbox"));
    this.optionsBar = new OptionsBar(this, document.getElementById("optionsbar"));
    this.layersPanel = new LayersPanel(this, document.getElementById("layers-panel"));
    this.swatchesPanel = new SwatchesPanel(this, document.getElementById("swatches-panel"));
    this.historyPanel = new HistoryPanel(this, document.getElementById("history-panel"));
    this.channelsPanel = new ChannelsPanel(this, document.getElementById("channels-panel"));
    this.pathsPanel = new PathsPanel(this, document.getElementById("paths-panel"));
    this.menuBar = new MenuBar(this, document.getElementById("menubar"));

    this._bindStatus();
    this._bindGlobalKeys();

    // 그리기 시작(히스토리 발생) 시 빈 문서 플래그 해제
    this.bus.on(EVT.HISTORY_CHANGED, ({ canUndo }) => { if (canUndo) this.isBlankDoc = false; });

    // 초기 문서
    this.newDocument(DEFAULT_DOC.width, DEFAULT_DOC.height, { blank: true });
    this.tools.setTool(TOOL.BRUSH);

    window.addEventListener("resize", () => this._onResize());
    this._onResize();
  }

  // ── 상태바 ──
  status(msg) {
    const el = document.getElementById("status-msg");
    if (!el) return;
    el.textContent = msg;
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
  }

  cursorInfo(world) {
    const el = document.getElementById("status-coord");
    if (el) el.textContent = `${Math.floor(world.x)}, ${Math.floor(world.y)} px`;
  }

  _bindStatus() {
    this.bus.on(EVT.VIEWPORT_CHANGED, () => {
      document.getElementById("status-zoom").textContent = Math.round(this.viewport.zoom * 100) + "%";
    });
    this._updateSize();
    this.bus.on(EVT.DOCUMENT_CHANGED, () => this._updateSize());
  }

  _updateSize() {
    document.getElementById("status-size").textContent = `${this.layers.width} × ${this.layers.height}`;
  }

  _onResize() {
    this.renderer.resize();
    this.renderer.requestRender();
  }

  // ── 문서 ──
  newDocument(w, h, { image = null, blank = false } = {}) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    this.selection.clear();
    this.history.clear();
    this.layers.init(w, h, { fillBackground: !image });
    if (image) {
      const base = this.layers.layers[0];
      base.name = "배경";
      base.ctx.drawImage(image, 0, 0);
      base.thumbDirty = true;
      this.isBlankDoc = false;
    } else {
      this.isBlankDoc = blank;
    }
    this.layers.notifyStructure();
    this.viewport.fit(w, h);
    this._updateSize();
    this.renderer.requestRender();
  }

  // 열기 정책: 빈 문서면 그 이미지로 새 문서, 작업 중이면 새 레이어로 추가
  placeImage(img, name) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (this.isBlankDoc) {
      this.docName = name || "image";
      this.newDocument(w, h, { image: img });
    } else {
      this.layers.addLayer({ name: name || "가져온 이미지", image: img });
    }
  }

  // 변형 후 화면 맞춤 (DocumentTransformCommand가 호출)
  fitIfNeeded() { /* 각 변형 메서드가 직접 viewport.fit을 호출하므로 비워둠 */ }

  // ── 선택 영역 액션 ──
  selectAll() { this.selection.selectAll(); }
  deselect() { this.selection.clear(); }

  // 활성 레이어의 불투명(알파>0) 픽셀을 선택 영역으로 만든다 (알파 채널 활용).
  selectOpaque() {
    const layer = this.layers.activeLayer;
    if (!layer) return;
    const W = layer.width, H = layer.height;
    const d = layer.ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (d[i * 4 + 3] > 0) {
        mask[i] = 255;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) { this.selection.clear(); this.status("불투명한 픽셀이 없습니다."); return; }
    this.selection.setMask(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    this.status("불투명 영역을 선택했습니다.");
  }

  // ── 선택 영역 연산 (반전/페더/모디파이) ──
  invertSelection() {
    if (!this.selection.active) { this.status("선택 영역이 없습니다."); return; }
    this.selection.invert();
    this.status("선택 영역을 반전했습니다.");
  }

  featherSelection() {
    if (!this.selection.active) { this.status("먼저 영역을 선택하세요."); return; }
    this.dialogs.form("페더", [
      { key: "r", label: "반경(px)", type: "number", value: 5, min: 1, max: 250 },
    ], (v) => { this.selection.feather(v.r); this.status(`페더 ${v.r}px 적용`); }, "적용");
  }

  // kind: "expand" | "contract" | "border" | "smooth"
  modifySelection(kind) {
    if (!this.selection.active) { this.status("먼저 영역을 선택하세요."); return; }
    const meta = {
      expand:   { title: "선택 확장", label: "확장(px)", def: 4 },
      contract: { title: "선택 축소", label: "축소(px)", def: 4 },
      border:   { title: "테두리", label: "폭(px)", def: 6 },
      smooth:   { title: "둥글리기", label: "반경(px)", def: 4 },
    }[kind];
    this.dialogs.form(meta.title, [
      { key: "n", label: meta.label, type: "number", value: meta.def, min: 1, max: 250 },
    ], (v) => { this.selection[kind](v.n); this.status(`${meta.title} ${v.n}px 적용`); }, "적용");
  }

  // ── 고급 선택 (색상 범위 / 확대 / 유사 / 저장·불러오기) ──
  colorRange() {
    if (!this.layers.activeLayer) { this.status("레이어가 없습니다."); return; }
    openColorRange(this);
  }
  grow() {
    const layer = this.layers.activeLayer;
    if (!layer) { this.status("레이어가 없습니다."); return; }
    if (!this.selection.active) { this.status("먼저 영역을 선택하세요."); return; }
    this.dialogs.form("선택 확대", [
      { key: "t", label: "허용치", type: "number", value: this.state.tolerance, min: 0, max: 255 },
    ], (v) => { const img = layer.ctx.getImageData(0, 0, layer.width, layer.height); this.selection.grow(img, v.t); this.status(`확대(허용치 ${v.t})`); }, "적용");
  }
  similar() {
    const layer = this.layers.activeLayer;
    if (!layer) { this.status("레이어가 없습니다."); return; }
    if (!this.selection.active) { this.status("먼저 영역을 선택하세요."); return; }
    this.dialogs.form("유사 영역 선택", [
      { key: "t", label: "허용치", type: "number", value: this.state.tolerance, min: 0, max: 255 },
    ], (v) => { const img = layer.ctx.getImageData(0, 0, layer.width, layer.height); this.selection.similar(img, v.t); this.status(`유사 영역(허용치 ${v.t})`); }, "적용");
  }
  saveSelection() { openSaveSelection(this); }
  loadSelection() { openLoadSelection(this); }

  // ── 보기: 눈금자/그리드/가이드 토글 ──
  toggleRulers() { this.state.set("showRulers", !this.state.showRulers); this.renderer.requestRender(); }
  toggleGrid() { this.state.set("showGrid", !this.state.showGrid); this.renderer.requestRender(); }
  toggleGuides() { this.state.set("showGuides", !this.state.showGuides); this.renderer.requestRender(); }

  deleteSelection() {
    const layer = this.layers.activeLayer;
    if (!layer) return;
    const sel = this.selection;
    this.history.beginPixelEdit(layer);
    if (sel.active && sel.bounds) {
      const b = sel.bounds, W = layer.width;
      const img = layer.ctx.getImageData(b.x, b.y, b.w, b.h);
      for (let row = 0; row < b.h; row++)
        for (let col = 0; col < b.w; col++)
          if (sel.mask[(b.y + row) * W + (b.x + col)]) img.data[(row * b.w + col) * 4 + 3] = 0;
      layer.ctx.putImageData(img, b.x, b.y);
      this.history.commitPixelEdit(b, "선택 영역 삭제");
    } else {
      layer.ctx.clearRect(0, 0, layer.width, layer.height);
      this.history.commitPixelEdit(null, "레이어 비우기");
    }
  }

  fillSelection(color) {
    const layer = this.layers.activeLayer;
    if (!layer) return;
    const sel = this.selection;
    this.history.beginPixelEdit(layer);
    const ctx = layer.ctx;
    ctx.save();
    if (sel.active) sel.applyClipPath(ctx);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, layer.width, layer.height);
    ctx.restore();
    this.history.commitPixelEdit(sel.active ? sel.bounds : null, "채우기");
  }

  // ── 문서 변형 ──
  resizeCanvas(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    this.history.execute(new DocumentTransformCommand(this.layers, "캔버스 크기", (lm) => {
      for (const L of lm.layers) L.resizeCanvas(w, h, 0, 0);
      lm.width = w; lm.height = h;
    }));
    this.selection.clear();
    this.viewport.fit(w, h);
  }

  resizeImage(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const ow = this.layers.width, oh = this.layers.height;
    this.history.execute(new DocumentTransformCommand(this.layers, "이미지 크기", (lm) => {
      for (const L of lm.layers) {
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        const t = tmp.getContext("2d", { willReadFrequently: true });
        t.imageSmoothingEnabled = true; t.imageSmoothingQuality = "high";
        t.drawImage(L.canvas, 0, 0, ow, oh, 0, 0, w, h);
        L.canvas = tmp; L.ctx = t; L.thumbDirty = true;
      }
      lm.width = w; lm.height = h;
    }));
    this.selection.clear();
    this.viewport.fit(w, h);
  }

  cropToSelection() {
    const sel = this.selection;
    if (!sel.active || !sel.bounds) { this.status("먼저 선택 도구로 영역을 지정하세요."); return; }
    const b = { ...sel.bounds };
    this.history.execute(new DocumentTransformCommand(this.layers, "자르기", (lm) => {
      for (const L of lm.layers) {
        const tmp = document.createElement("canvas");
        tmp.width = b.w; tmp.height = b.h;
        const t = tmp.getContext("2d", { willReadFrequently: true });
        t.drawImage(L.canvas, -b.x, -b.y);
        L.canvas = tmp; L.ctx = t; L.thumbDirty = true;
      }
      lm.width = b.w; lm.height = b.h;
    }));
    this.selection.clear();
    this.viewport.fit(b.w, b.h);
  }

  rotate90(dir) {
    const ow = this.layers.width, oh = this.layers.height;
    const nw = oh, nh = ow;
    this.history.execute(new DocumentTransformCommand(this.layers, "90° 회전", (lm) => {
      for (const L of lm.layers) {
        const tmp = document.createElement("canvas");
        tmp.width = nw; tmp.height = nh;
        const t = tmp.getContext("2d", { willReadFrequently: true });
        t.translate(nw / 2, nh / 2);
        t.rotate((dir * Math.PI) / 2);
        t.drawImage(L.canvas, -ow / 2, -oh / 2);
        L.canvas = tmp; L.ctx = t; L.thumbDirty = true;
      }
      lm.width = nw; lm.height = nh;
    }));
    this.selection.clear();
    this.viewport.fit(nw, nh);
  }

  flip(axis) {
    this.history.execute(new DocumentTransformCommand(this.layers, axis === "h" ? "좌우 뒤집기" : "상하 뒤집기", (lm) => {
      for (const L of lm.layers) {
        const tmp = document.createElement("canvas");
        tmp.width = lm.width; tmp.height = lm.height;
        const t = tmp.getContext("2d", { willReadFrequently: true });
        if (axis === "h") { t.translate(lm.width, 0); t.scale(-1, 1); }
        else { t.translate(0, lm.height); t.scale(1, -1); }
        t.drawImage(L.canvas, 0, 0);
        L.canvas = tmp; L.ctx = t; L.thumbDirty = true;
      }
    }));
    this.selection.clear();
  }

  flattenImage() {
    if (this.layers.count <= 1) { this.status("병합할 레이어가 없습니다."); return; }
    this.history.execute(new FlattenCommand(this.layers));
  }

  // 조정 레이어 추가(메뉴/단축키용). 추가 후 편집 다이얼로그가 있으면 바로 연다.
  addAdjustmentLayer(type) {
    this.layers.addAdjustmentLayer(type);
    this.editAdjustmentLayer(this.layers.activeId);
  }
  // 조정 레이어 파라미터 편집 다이얼로그.
  editAdjustmentLayer(id = this.layers.activeId) {
    openAdjustmentLayerDialog(this, id);
  }

  // ── 보정/필터 ──
  _clone(img) { return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height); }

  // 전용 보정 다이얼로그(레벨/커브)용 미리보기 핸들.
  // apply: 원본 복사본에 computeFn 적용 후 화면 미리보기 / commit: 히스토리 등록 / cancel: 원복.
  _startPreview() {
    const layer = this.layers.activeLayer;
    if (!layer) return null;
    const original = layer.snapshot();
    const full = { x: 0, y: 0, w: layer.width, h: layer.height };
    const self = this;
    return {
      original,
      width: layer.width,
      height: layer.height,
      apply(computeFn) {
        const img = self._clone(original);
        computeFn(img);
        if (self.selection.active) self.selection.clipImageData(img, original, full);
        layer.ctx.putImageData(img, 0, 0);
        layer.thumbDirty = true;
        self.renderer.requestRender();
      },
      commit(computeFn, label) {
        layer.ctx.putImageData(original, 0, 0);
        const img = self._clone(original);
        computeFn(img);
        if (self.selection.active) self.selection.clipImageData(img, original, full);
        self.history.beginPixelEdit(layer);
        layer.ctx.putImageData(img, 0, 0);
        layer.thumbDirty = true;
        self.history.commitPixelEdit(null, label);
      },
      cancel() {
        layer.ctx.putImageData(original, 0, 0);
        layer.thumbDirty = true;
        self.renderer.requestRender();
      },
    };
  }

  // 슬라이더 없는 즉시 적용 필터. fn(imageData)
  applyFilter(title, fn) {
    const layer = this.layers.activeLayer;
    if (!layer) { this.status("레이어가 없습니다."); return; }
    const original = layer.snapshot();
    const img = this._clone(original);
    fn(img);
    if (this.selection.active) this.selection.clipImageData(img, original, { x: 0, y: 0, w: layer.width, h: layer.height });
    this.history.beginPixelEdit(layer);
    layer.ctx.putImageData(img, 0, 0);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(null, title);
  }

  // 슬라이더 미리보기 보정. computeFn(imageData, values)
  runAdjustment(title, sliders, computeFn) {
    const layer = this.layers.activeLayer;
    if (!layer) { this.status("레이어가 없습니다."); return; }
    const original = layer.snapshot();
    const full = { x: 0, y: 0, w: layer.width, h: layer.height };

    const preview = (values) => {
      const img = this._clone(original);
      if (values) computeFn(img, values);
      if (this.selection.active) this.selection.clipImageData(img, original, full);
      layer.ctx.putImageData(img, 0, 0);
      layer.thumbDirty = true;
      this.renderer.requestRender();
    };

    this.dialogs.adjust(title, sliders, preview,
      (values) => { // 확인: 깨끗한 원본에서 다시 계산 후 히스토리 등록
        const img = this._clone(original);
        computeFn(img, values);
        if (this.selection.active) this.selection.clipImageData(img, original, full);
        this.history.beginPixelEdit(layer);
        layer.ctx.putImageData(img, 0, 0);
        layer.thumbDirty = true;
        this.history.commitPixelEdit(null, title);
      },
      () => { // 취소: 원본 복원
        layer.ctx.putImageData(original, 0, 0);
        layer.thumbDirty = true;
        this.renderer.requestRender();
      });

    // 초기 미리보기(기본값)
    const init = {};
    sliders.forEach((s) => (init[s.key] = s.value));
    preview(init);
  }

  // ── 전역 단축키 (Ctrl 조합 / Delete) ──
  _bindGlobalKeys() {
    window.addEventListener("keydown", (e) => {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); e.shiftKey ? this.history.redo() : this.history.undo(); }
        else if (k === "y") { e.preventDefault(); this.history.redo(); }
        else if (k === "s") { e.preventDefault(); this.fileIO.save("png"); }
        else if (k === "o") { e.preventDefault(); this.fileIO.openDialog(); }
        else if (k === "n") { e.preventDefault(); this.menuBar._newDoc(); }
        else if (k === "a") { e.preventDefault(); this.selectAll(); }
        else if (k === "d" && e.altKey) { e.preventDefault(); this.featherSelection(); }
        else if (k === "d") { e.preventDefault(); this.deselect(); }
        else if (k === "i" && e.shiftKey) { e.preventDefault(); this.invertSelection(); }
        else if (k === "e" && e.shiftKey) { e.preventDefault(); this.layers.mergeVisible(); }
        else if (k === "e") { e.preventDefault(); this.layers.mergeDown(); }
        else if (k === "g") { e.preventDefault(); this.layers.toggleClip(); }
        else if (k === "r") { e.preventDefault(); this.toggleRulers(); }
        else if (k === "t") { e.preventDefault(); this.freeTransform.start(); }
        else if (k === "c" && !typing) { e.preventDefault(); this.clipboard.copy(); }
        else if (k === "0") { e.preventDefault(); this.viewport.fit(this.layers.width, this.layers.height); }
        else if (k === "1") { e.preventDefault(); this.viewport.actualSize(this.layers.width, this.layers.height); }
        else if (k === "=" || k === "+") { e.preventDefault(); this.viewport.setZoom(this.viewport.zoom * 1.25); }
        else if (k === "-" || k === "_") { e.preventDefault(); this.viewport.setZoom(this.viewport.zoom / 1.25); }
        return;
      }

      if (typing) return;
      if (this.freeTransform.active) {
        if (e.key === "Enter") { e.preventDefault(); this.freeTransform.commit(); return; }
        if (e.key === "Escape") { e.preventDefault(); this.freeTransform.cancel(); return; }
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.deleteSelection(); }
    });
  }
}

// DOM 준비 후 앱 시작
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => { window.app = new App(); });
} else {
  window.app = new App();
}
