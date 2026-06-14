// styles-panel.js — Styles(스타일) 팔레트.
// 프리셋 레이어 스타일 목록(빌트인 + 사용자 저장)을 미리보기 셀로 보여주고,
// 클릭 시 활성 레이어에 스타일을 일괄 적용한다(undo 지원).
//   · ＋ : 현재 활성 레이어의 스타일을 새 사용자 프리셋으로 저장(localStorage 영속)
//   · ↺ : 활성 레이어의 스타일 모두 제거(스타일 해제)
//   · 셀 우클릭 : 사용자 프리셋 삭제(빌트인은 삭제 불가)
// 영속 키 "ps7_style_presets". swatches-panel.js의 영속/그리드 패턴을 따랐다.

import { EVT } from "../core/constants.js";
import { applyLayerStyles, cloneStyles, hasAnyStyle } from "../layers/layer-styles.js";
import { BUILTIN_PRESETS, mergePreset, stylesToPreset } from "../styles/style-presets.js";
import { LayerPropCommand } from "../history/commands/layer-structure-command.js";

const STORAGE_KEY = "ps7_style_presets";
const CELL = 40; // 미리보기 셀 크기(px)

export class StylesPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.userPresets = this._load();   // [{ name, styles }]
    this._build();
    // 활성 레이어가 바뀌면 현재 스타일과 일치하는 셀 강조
    app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => this._highlightCurrent());
    app.bus.on(EVT.LAYERS_CHANGED, () => this._highlightCurrent());
  }

  // ── 영속 ──
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // 최소 형태 검증: name 문자열 + styles 객체
          return arr.filter((p) => p && typeof p.name === "string" && p.styles && typeof p.styles === "object");
        }
      }
    } catch { /* 파싱 실패 시 빈 사용자 목록 */ }
    return [];
  }
  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPresets)); }
    catch { /* 용량 초과 등 무시(부가 기능) */ }
  }

  // 빌트인 + 사용자 프리셋 합본(빌트인은 builtin:true 표시)
  _allPresets() {
    return [
      ...BUILTIN_PRESETS.map((p) => ({ ...p, builtin: true })),
      ...this.userPresets.map((p) => ({ ...p, builtin: false })),
    ];
  }

  // ── DOM ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">스타일</div>
      <div class="style-grid"></div>
      <div class="style-toolbar">
        <button class="st-add" title="현재 레이어 스타일을 프리셋으로 저장">＋</button>
        <button class="st-clear" title="활성 레이어 스타일 제거">↺</button>
      </div>`;

    this.grid = this.el.querySelector(".style-grid");
    // 핵심 레이아웃은 공유 CSS 없이도 동작하도록 인라인으로 보장(클래스는 추가 스타일링용).
    this.grid.style.cssText =
      `display:grid;grid-template-columns:repeat(auto-fill,${CELL}px);gap:6px;padding:8px;` +
      "align-content:start;overflow-y:auto;flex:1 1 auto;min-height:0;";
    const tb = this.el.querySelector(".style-toolbar");
    tb.style.cssText =
      "display:flex;gap:2px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";

    this.el.querySelector(".st-add").addEventListener("click", () => this._saveCurrent());
    this.el.querySelector(".st-clear").addEventListener("click", () => this._clearActive());

    this._render();
  }

  _render() {
    this.grid.innerHTML = "";
    this._allPresets().forEach((preset, i) => {
      const cell = document.createElement("button");
      cell.className = "style-cell";
      cell.style.cssText =
        `width:${CELL}px;height:${CELL}px;padding:2px;border:1px solid var(--border);border-radius:3px;` +
        "background:var(--bg-panel,#2b2b2b);cursor:pointer;display:block;overflow:hidden;";
      cell.title = preset.name + (preset.builtin ? "" : "  (우클릭=삭제)") + "  · 클릭=적용";
      cell.appendChild(this._preview(preset.styles));
      // 클릭: 활성 레이어에 적용
      cell.addEventListener("click", () => this._apply(preset));
      // 우클릭: 사용자 프리셋만 삭제
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (!preset.builtin) this._removeUser(preset.name);
      });
      // builtin 식별용 데이터(강조 비교에 사용)
      cell._presetName = preset.name;
      this.grid.appendChild(cell);
    });
    this._highlightCurrent();
  }

  // 프리셋 스타일을 샘플 도형(둥근 사각 + 글자)에 입힌 미리보기 캔버스.
  _preview(partialStyles) {
    const n = CELL - 6;            // 셀 내부 여백 고려
    // 1) 샘플 베이스 레이어 캔버스(둥근 사각 채움) 만들기
    const base = document.createElement("canvas");
    base.width = n; base.height = n;
    const b = base.getContext("2d", { willReadFrequently: true });
    const pad = Math.round(n * 0.22);
    const r = Math.round(n * 0.16);
    b.fillStyle = "#9aa0a6";       // 중간 회색 도형(효과가 잘 보이도록)
    roundRect(b, pad, pad, n - pad * 2, n - pad * 2, r);
    b.fill();

    // 2) 프리셋을 완전 styles로 병합해 효과 합성
    const styles = mergePreset(partialStyles);
    const styled = hasAnyStyle(styles) ? applyLayerStyles(base, styles) : base;

    // 3) 체커 배경 위에 결과를 올린 미리보기 캔버스(투명 영역 구분)
    const out = document.createElement("canvas");
    out.width = n; out.height = n;
    const o = out.getContext("2d");
    drawChecker(o, n, n);
    o.drawImage(styled, 0, 0);
    out.style.cssText = "width:100%;height:100%;display:block;pointer-events:none;";
    return out;
  }

  // 현재 활성 레이어 스타일과 "동일한" 프리셋 셀을 강조(간단 비교: 직렬화 일치).
  _highlightCurrent() {
    const act = this.app.layers?.activeLayer;
    const curKey = act && act.styles ? JSON.stringify(normalize(act.styles)) : null;
    const cells = this.grid.querySelectorAll(".style-cell");
    const all = this._allPresets();
    cells.forEach((cell, i) => {
      const presetKey = JSON.stringify(normalize(mergePreset(all[i].styles)));
      const on = curKey !== null && presetKey === curKey;
      cell.style.outline = on ? "2px solid #4af" : "none";
      cell.style.outlineOffset = on ? "-1px" : "0";
    });
  }

  // ── 동작 ──
  // 프리셋을 활성 레이어에 적용(undo 지원). 빈 프리셋이면 스타일 해제로 동작.
  _apply(preset) {
    const lm = this.app.layers;
    const layer = lm?.activeLayer;
    if (!layer) { this.app.status("레이어가 없습니다."); return; }
    const full = mergePreset(preset.styles);
    const next = hasAnyStyle(full) ? full : null;
    this.app.history.execute(new LayerPropCommand(lm, layer.id, "styles", cloneStyles(layer.styles), next));
    this.app.status(`스타일 적용: ${preset.name}`);
  }

  // 현재 활성 레이어의 스타일을 새 사용자 프리셋으로 저장.
  _saveCurrent() {
    const layer = this.app.layers?.activeLayer;
    if (!layer || !hasAnyStyle(layer.styles)) {
      this.app.status("저장할 레이어 스타일이 없습니다."); return;
    }
    // 이름 입력(간단 prompt; CSP 영향 없음 — 표준 브라우저 다이얼로그)
    const name = (window.prompt("스타일 이름", `스타일 ${this.userPresets.length + 1}`) || "").trim();
    if (!name) return;
    this.userPresets.push({ name, styles: stylesToPreset(layer.styles) });
    this._save();
    this._render();
    this.app.status(`스타일 저장: ${name}`);
  }

  // 활성 레이어 스타일 제거(해제). undo 지원.
  _clearActive() {
    const lm = this.app.layers;
    const layer = lm?.activeLayer;
    if (!layer || !hasAnyStyle(layer.styles)) { this.app.status("제거할 스타일이 없습니다."); return; }
    this.app.history.execute(new LayerPropCommand(lm, layer.id, "styles", cloneStyles(layer.styles), null));
    this.app.status("레이어 스타일 제거");
  }

  _removeUser(name) {
    const i = this.userPresets.findIndex((p) => p.name === name);
    if (i < 0) return;
    this.userPresets.splice(i, 1);
    this._save();
    this._render();
    this.app.status(`스타일 삭제: ${name}`);
  }
}

// ── 모듈 내부 유틸 ──

// 둥근 사각형 path
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 작은 체커 배경(투명 표시용)
function drawChecker(ctx, w, h) {
  const s = 5;
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) ? "#3a3a3a" : "#4a4a4a";
      ctx.fillRect(x, y, s, s);
    }
  }
}

// 스타일 비교용 정규화: 활성(enabled) 효과만 추려 키 정렬(직렬화 일치 비교).
function normalize(styles) {
  if (!styles) return {};
  const out = {};
  for (const k of Object.keys(styles).sort()) {
    if (styles[k] && styles[k].enabled) out[k] = styles[k];
  }
  return out;
}
