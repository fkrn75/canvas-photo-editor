// swatches-panel.js — 색 견본(Swatches) 팔레트.
// 기본 견본(흑/백/RGB/CMY + 회색 단계) + "현재 전경색 추가"(+버튼) + 견본 삭제(우클릭).
// 견본 클릭 시 전경색을 설정한다(app.state.set("foreground", ...)).
// 목록은 localStorage 키 "ps7_swatches"로 영속한다.
// layers-panel.js의 패널 구조/클래스(.panel/.panel-head/.layer-toolbar 등)를 참고했다.

import { EVT } from "../core/constants.js";

const STORAGE_KEY = "ps7_swatches";

// 기본 견본: 기본 8색 + 0~100% 회색 6단계. (모두 "#rrggbb" 소문자)
const DEFAULT_SWATCHES = [
  "#000000", "#ffffff", "#ff0000", "#00ff00",
  "#0000ff", "#00ffff", "#ff00ff", "#ffff00",
  "#333333", "#555555", "#808080", "#aaaaaa", "#cccccc", "#e0e0e0",
];

export class SwatchesPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.swatches = this._load();
    this._build();
    // 전경색이 바뀌면 현재 색과 일치하는 견본을 강조 표시.
    app.bus.on(EVT.COLOR_CHANGED, () => this._highlightCurrent());
  }

  // ── 영속 ──
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        // 저장값이 유효한 hex 배열일 때만 사용.
        if (Array.isArray(arr) && arr.every((s) => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s))) {
          return arr.map((s) => s.toLowerCase());
        }
      }
    } catch { /* 파싱 실패 시 기본값 사용 */ }
    return DEFAULT_SWATCHES.slice();
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.swatches)); }
    catch { /* 용량 초과 등은 무시(견본은 부가 기능) */ }
  }

  // ── DOM ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">색상 견본</div>
      <div class="swatch-grid"></div>
      <div class="swatch-toolbar">
        <button class="sw-add" title="현재 전경색 추가">＋</button>
        <button class="sw-reset" title="기본 견본으로 초기화">↺</button>
      </div>`;

    this.grid = this.el.querySelector(".swatch-grid");
    // 핵심 레이아웃은 공유 CSS 없이도 동작하도록 인라인으로 보장(클래스는 추가 스타일링용).
    this.grid.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fill,18px);gap:4px;padding:8px;" +
      "align-content:start;overflow-y:auto;flex:1;min-height:0;";
    const tb = this.el.querySelector(".swatch-toolbar");
    tb.style.cssText =
      "display:flex;gap:2px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";

    this.el.querySelector(".sw-add").addEventListener("click", () => this._addCurrent());
    this.el.querySelector(".sw-reset").addEventListener("click", () => this._reset());

    this._render();
  }

  _render() {
    this.grid.innerHTML = "";
    this.swatches.forEach((hex, i) => {
      const cell = document.createElement("button");
      cell.className = "swatch-cell";
      // 정사각 견본. 인라인으로 크기/테두리 보장(공유 CSS 의존 없이 동작).
      cell.style.cssText =
        "width:18px;height:18px;padding:0;border:1px solid var(--border);border-radius:2px;cursor:pointer;";
      cell.style.background = hex;
      cell.title = `${hex}  (클릭=전경색 · 우클릭=삭제)`;
      // 클릭: 전경색 설정 (state의 정확한 키 "foreground" 사용)
      cell.addEventListener("click", () => this.app.state.set("foreground", hex));
      // 우클릭: 견본 삭제 (기본 컨텍스트 메뉴 차단)
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._remove(i);
      });
      this.grid.appendChild(cell);
    });
    this._highlightCurrent();
  }

  // 현재 전경색과 같은 견본에 .active 표시(흰 외곽선으로 강조; 인라인이라 CSS 불필요).
  _highlightCurrent() {
    const cur = (this.app.state.foreground || "").toLowerCase();
    const cells = this.grid.querySelectorAll(".swatch-cell");
    cells.forEach((cell, i) => {
      const on = this.swatches[i] === cur;
      cell.classList.toggle("active", on);
      cell.style.outline = on ? "2px solid #fff" : "none";
      cell.style.outlineOffset = on ? "-1px" : "0";
      cell.style.boxShadow = on ? "0 0 0 1px var(--border)" : "none";
    });
  }

  // ── 동작 ──
  _addCurrent() {
    const hex = (this.app.state.foreground || "#000000").toLowerCase();
    if (this.swatches.includes(hex)) { this.app.status("이미 있는 견본입니다."); return; }
    this.swatches.push(hex);
    this._save();
    this._render();
    this.app.status(`견본 추가: ${hex}`);
  }

  _remove(i) {
    if (i < 0 || i >= this.swatches.length) return;
    const hex = this.swatches[i];
    this.swatches.splice(i, 1);
    this._save();
    this._render();
    this.app.status(`견본 삭제: ${hex}`);
  }

  _reset() {
    this.swatches = DEFAULT_SWATCHES.slice();
    this._save();
    this._render();
    this.app.status("기본 견본으로 초기화했습니다.");
  }
}
