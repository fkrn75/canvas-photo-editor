// menu-bar.js — 상단 메뉴(파일/편집/이미지/레이어/보정/필터/보기)와 각 액션.

import * as Adjust from "../engine/adjustments.js";
import * as Filters from "../engine/filters.js";
import { openLevels, openCurves } from "./channel-dialogs.js";
import { openColorBalance, openThreshold, openPosterize, openGradientMap, openChannelMixer } from "./adjust-dialogs.js";
import { openUnsharpMask, openMotionBlur, openMedian, openMosaic, openHighPass } from "./filter-dialogs.js";
import { EVT } from "../core/constants.js";
import { openStroke } from "./stroke-dialog.js";
import { openSaveForWeb } from "./save-for-web.js";
import { openLayerStyle } from "./layer-style-dialog.js";
import { ADJUSTMENT_TYPES } from "../layers/adjustment-layer.js";
import { openAdjustmentLayerDialog } from "./adjustment-layer-dialog.js";
import { convertGrayscale, convertRGB, openBitmapDialog, openIndexedDialog } from "./image-mode-dialog.js";
import { openColorTable } from "./color-table-dialog.js";
import { openPatternMaker } from "./pattern-maker-dialog.js";
import { openLiquify } from "./liquify-dialog.js";

export class MenuBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.openItem = null;
    this._build();
    window.addEventListener("click", () => this._close());
  }

  _menus() {
    const a = this.app;
    return [
      { title: "파일", items: [
        { label: "새로 만들기", shortcut: "Ctrl+N", fn: () => this._newDoc() },
        { label: "열기", shortcut: "Ctrl+O", fn: () => a.fileIO.openDialog() },
        { sep: true },
        { label: "PNG로 저장", shortcut: "Ctrl+S", fn: () => a.fileIO.save("png") },
        { label: "JPG로 저장", fn: () => a.fileIO.save("jpg") },
        { sep: true },
        { label: "웹용으로 저장…", fn: () => openSaveForWeb(a) },
      ]},
      { title: "편집", items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", fn: () => a.history.undo() },
        { label: "다시 실행", shortcut: "Ctrl+Shift+Z", fn: () => a.history.redo() },
        { sep: true },
        { label: "복사", shortcut: "Ctrl+C", fn: () => a.clipboard.copy() },
        { label: "붙여넣기", shortcut: "Ctrl+V", fn: () => a.status("Ctrl+V 키로 이미지를 붙여넣으세요.") },
        { sep: true },
        { label: "전경색으로 채우기", fn: () => a.fillSelection(a.state.foreground) },
        { label: "배경색으로 채우기", fn: () => a.fillSelection(a.state.background) },
        { label: "선택 윤곽(Stroke)…", fn: () => openStroke(a) },
        { sep: true },
        { label: "자유 변형", shortcut: "Ctrl+T", fn: () => a.freeTransform.start() },
        { sep: true },
        { label: "빠른 마스크 전환", shortcut: "Q", fn: () => a.quickMask.toggle() },
        { sep: true },
        { label: "모두 선택", shortcut: "Ctrl+A", fn: () => a.selectAll() },
        { label: "불투명 영역 선택", fn: () => a.selectOpaque() },
        { label: "선택 반전", shortcut: "Shift+Ctrl+I", fn: () => a.invertSelection() },
        { label: "선택 해제", shortcut: "Ctrl+D", fn: () => a.deselect() },
        { sep: true },
        { label: "페더…", shortcut: "Alt+Ctrl+D", fn: () => a.featherSelection() },
        { label: "선택 확장…", fn: () => a.modifySelection("expand") },
        { label: "선택 축소…", fn: () => a.modifySelection("contract") },
        { label: "테두리…", fn: () => a.modifySelection("border") },
        { label: "둥글리기…", fn: () => a.modifySelection("smooth") },
        { sep: true },
        { label: "색상 범위…", fn: () => a.colorRange() },
        { label: "확대(Grow)…", fn: () => a.grow() },
        { label: "유사 영역…", fn: () => a.similar() },
        { label: "선택 저장…", fn: () => a.saveSelection() },
        { label: "선택 불러오기…", fn: () => a.loadSelection() },
        { sep: true },
        { label: "선택 영역 삭제", shortcut: "Del", fn: () => a.deleteSelection() },
      ]},
      { title: "이미지", items: [
        { label: "모드: 회색조", fn: () => convertGrayscale(a) },
        { label: "모드: 인덱스 색상…", fn: () => openIndexedDialog(a) },
        { label: "모드: 비트맵…", fn: () => openBitmapDialog(a) },
        { label: "모드: RGB 색상", fn: () => convertRGB(a) },
        { label: "색상표(Color Table)…", fn: () => openColorTable(a) },
        { sep: true },
        { label: "이미지 크기…", fn: () => this._sizeDialog("이미지 크기", (w, h) => a.resizeImage(w, h)) },
        { label: "캔버스 크기…", fn: () => this._sizeDialog("캔버스 크기", (w, h) => a.resizeCanvas(w, h)) },
        { sep: true },
        { label: "시계 방향 90°", fn: () => a.rotate90(1) },
        { label: "반시계 방향 90°", fn: () => a.rotate90(-1) },
        { label: "180° 회전", fn: () => { a.rotate90(1); a.rotate90(1); } },
        { sep: true },
        { label: "좌우 뒤집기", fn: () => a.flip("h") },
        { label: "상하 뒤집기", fn: () => a.flip("v") },
        { sep: true },
        { label: "선택 영역으로 자르기", fn: () => a.cropToSelection() },
      ]},
      { title: "레이어", items: [
        { label: "새 레이어", fn: () => a.layers.addLayer({}) },
        { label: "레이어 복제", fn: () => a.layers.duplicateLayer() },
        { label: "아래로 병합", shortcut: "Ctrl+E", fn: () => a.layers.mergeDown() },
        { label: "보이는 레이어 병합", shortcut: "Shift+Ctrl+E", fn: () => a.layers.mergeVisible() },
        { label: "이미지 평탄화", fn: () => a.flattenImage() },
        { label: "레이어 스타일…", fn: () => openLayerStyle(a) },
        { sep: true },
        ...Object.keys(ADJUSTMENT_TYPES).map((type) => ({
          label: `새 조정 레이어: ${ADJUSTMENT_TYPES[type].label}`,
          fn: () => a.addAdjustmentLayer(type),
        })),
        { sep: true },
        { label: "레이어 마스크 추가", fn: () => a.layers.addMask(undefined, { fromSelection: !!(a.selection?.active) }) },
        { label: "레이어 마스크 삭제", fn: () => a.layers.removeMask() },
        { label: "마스크 사용/사용 안 함", fn: () => a.layers.toggleMaskEnabled() },
        { label: "이전 레이어와 클리핑", shortcut: "Ctrl+G", fn: () => a.layers.toggleClip() },
        { sep: true },
        { label: "레이어 삭제", fn: () => a.layers.removeLayer() },
      ]},
      { title: "보정", items: [
        { label: "밝기/대비…", fn: () => a.runAdjustment("밝기/대비", [
          { key: "b", label: "밝기", min: -100, max: 100, step: 1, value: 0 },
          { key: "c", label: "대비", min: -100, max: 100, step: 1, value: 0 },
        ], (img, v) => Adjust.brightnessContrast(img, v.b, v.c)) },
        { label: "색조/채도…", fn: () => a.runAdjustment("색조/채도", [
          { key: "h", label: "색조", min: -180, max: 180, step: 1, value: 0 },
          { key: "s", label: "채도", min: -100, max: 100, step: 1, value: 0 },
          { key: "l", label: "밝기", min: -100, max: 100, step: 1, value: 0 },
        ], (img, v) => Adjust.hueSaturation(img, v.h, v.s, v.l)) },
        { sep: true },
        { label: "레벨…", fn: () => openLevels(a) },
        { label: "커브…", fn: () => openCurves(a) },
        { sep: true },
        { label: "자동 레벨", fn: () => a.applyFilter("자동 레벨", Adjust.autoTone) },
        { label: "흑백", fn: () => a.applyFilter("흑백", Adjust.grayscale) },
        { label: "색 반전", fn: () => a.applyFilter("색 반전", Adjust.invert) },
        { sep: true },
        { label: "색상 균형…", fn: () => openColorBalance(a) },
        { label: "채널 혼합…", fn: () => openChannelMixer(a) },
        { label: "그라디언트 맵…", fn: () => openGradientMap(a) },
        { sep: true },
        { label: "한계값…", fn: () => openThreshold(a) },
        { label: "포스터화…", fn: () => openPosterize(a) },
        { label: "균일화", fn: () => a.applyFilter("균일화", Adjust.equalize) },
      ]},
      { title: "필터", items: [
        { label: "가우시안 블러…", fn: () => a.runAdjustment("가우시안 블러", [
          { key: "r", label: "반경", min: 1, max: 100, step: 1, value: 4, suffix: "px" },
        ], (img, v) => Filters.gaussianBlur(img, v.r)) },
        { label: "샤픈…", fn: () => a.runAdjustment("샤픈", [
          { key: "a", label: "강도", min: 0, max: 300, step: 1, value: 80, scale: 0.01, suffix: "%" },
        ], (img, v) => Filters.sharpen(img, v.a / 100)) },
        { label: "언샤프 마스크…", fn: () => openUnsharpMask(a) },
        { label: "하이 패스…", fn: () => openHighPass(a) },
        { sep: true },
        { label: "모션 블러…", fn: () => openMotionBlur(a) },
        { label: "미디언…", fn: () => openMedian(a) },
        { label: "모자이크…", fn: () => openMosaic(a) },
        { label: "엣지 찾기", fn: () => a.applyFilter("엣지 찾기", Filters.findEdges) },
        { sep: true },
        { label: "노이즈 추가…", fn: () => a.runAdjustment("노이즈 추가", [
          { key: "a", label: "양", min: 1, max: 100, step: 1, value: 24 },
        ], (img, v) => Filters.addNoise(img, v.a, true)) },
        { label: "세피아", fn: () => a.applyFilter("세피아", Filters.sepia) },
        { label: "엠보스", fn: () => a.applyFilter("엠보스", Filters.emboss) },
        { sep: true },
        { label: "픽셀 유동화…", fn: () => openLiquify(a) },
        { label: "패턴 메이커…", fn: () => openPatternMaker(a) },
      ]},
      { title: "보기", items: [
        { label: "확대", shortcut: "Ctrl++", fn: () => a.viewport.setZoom(a.viewport.zoom * 1.25) },
        { label: "축소", shortcut: "Ctrl+-", fn: () => a.viewport.setZoom(a.viewport.zoom / 1.25) },
        { label: "화면 맞춤", shortcut: "Ctrl+0", fn: () => a.viewport.fit(a.layers.width, a.layers.height) },
        { label: "실제 크기", shortcut: "Ctrl+1", fn: () => a.viewport.actualSize(a.layers.width, a.layers.height) },
        { sep: true },
        { label: "눈금자", shortcut: "Ctrl+R", fn: () => a.toggleRulers() },
        { label: "그리드 표시", fn: () => a.toggleGrid() },
        { label: "가이드 표시", fn: () => a.toggleGuides() },
        { label: "새 가이드…", fn: () => this._newGuide() },
        { label: "가이드 지우기", fn: () => a.viewport.clearGuides() },
      ]},
    ];
  }

  _build() {
    this.el.innerHTML = "";
    const brand = document.createElement("div");
    brand.className = "menu-title";
    brand.textContent = "Canvas Photo Editor";
    this.el.appendChild(brand);

    for (const m of this._menus()) {
      const item = document.createElement("div");
      item.className = "menu-item";
      const label = document.createElement("span");
      label.textContent = m.title;
      item.appendChild(label);

      const dd = document.createElement("div");
      dd.className = "menu-dropdown";
      for (const row of m.items) {
        if (row.sep) {
          const s = document.createElement("div");
          s.className = "menu-sep";
          dd.appendChild(s);
          continue;
        }
        const r = document.createElement("div");
        r.className = "menu-row";
        const t = document.createElement("span");
        t.textContent = row.label;
        r.appendChild(t);
        if (row.shortcut) {
          const sc = document.createElement("span");
          sc.className = "shortcut";
          sc.textContent = row.shortcut;
          r.appendChild(sc);
        }
        r.addEventListener("click", (e) => { e.stopPropagation(); this._close(); row.fn(); });
        dd.appendChild(r);
      }
      item.appendChild(dd);

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.openItem === item) this._close();
        else { this._close(); item.classList.add("open"); this.openItem = item; }
      });
      item.addEventListener("mouseenter", () => {
        if (this.openItem && this.openItem !== item) {
          this._close(); item.classList.add("open"); this.openItem = item;
        }
      });
      this.el.appendChild(item);
    }

    // 우측: 실행취소/다시실행 빠른 버튼 (항상 보이도록)
    const actions = document.createElement("div");
    actions.className = "menu-actions";
    this._undoBtn = document.createElement("button");
    this._undoBtn.className = "menu-action-btn";
    this._undoBtn.title = "실행 취소 (Ctrl+Z)";
    this._undoBtn.textContent = "↶";
    this._undoBtn.addEventListener("click", () => this.app.history.undo());
    this._redoBtn = document.createElement("button");
    this._redoBtn.className = "menu-action-btn";
    this._redoBtn.title = "다시 실행 (Ctrl+Shift+Z)";
    this._redoBtn.textContent = "↷";
    this._redoBtn.addEventListener("click", () => this.app.history.redo());
    actions.append(this._undoBtn, this._redoBtn);
    // 브랜드(children[0]) 다음, 첫 메뉴 앞에 끼워 넣어 항상 보이게 한다
    this.el.insertBefore(actions, this.el.children[1] || null);

    this._syncHistory();
    this.app.bus.on(EVT.HISTORY_CHANGED, () => this._syncHistory());
  }

  _syncHistory() {
    this._undoBtn.disabled = !this.app.history.canUndo;
    this._redoBtn.disabled = !this.app.history.canRedo;
  }

  _close() { if (this.openItem) { this.openItem.classList.remove("open"); this.openItem = null; } }

  _newDoc() {
    this.app.dialogs.form("새 문서", [
      { key: "w", label: "폭(px)", type: "number", value: 800, min: 1, max: 8000 },
      { key: "h", label: "높이(px)", type: "number", value: 600, min: 1, max: 8000 },
      { key: "bg", label: "배경", type: "select", value: "white", options: [["white", "흰색"], ["transparent", "투명"]] },
    ], (v) => {
      this.app.docName = "untitled";
      this.app.newDocument(v.w, v.h, { blank: true });
      if (v.bg === "transparent") {
        this.app.layers.layers[0].clear();
        this.app.renderer.requestRender();
      }
    }, "만들기");
  }

  _sizeDialog(title, apply) {
    const a = this.app;
    a.dialogs.form(title, [
      { key: "w", label: "폭(px)", type: "number", value: a.layers.width, min: 1, max: 8000 },
      { key: "h", label: "높이(px)", type: "number", value: a.layers.height, min: 1, max: 8000 },
    ], (v) => apply(v.w, v.h), "적용");
  }

  _newGuide() {
    const a = this.app;
    a.dialogs.form("새 가이드", [
      { key: "orient", label: "방향", type: "select", value: "h", options: [["h", "수평"], ["v", "수직"]] },
      { key: "pos", label: "위치(px)", type: "number", value: 0, min: 0, max: 8000 },
    ], (v) => a.viewport.addGuide(v.orient, v.pos), "추가");
  }
}
