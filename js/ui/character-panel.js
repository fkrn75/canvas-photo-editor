// character-panel.js — Character(문자) 팔레트.
// 벡터 텍스트 레이어의 글꼴/크기/자간/행간/색/스타일/정렬을 조절한다.
// 두 가지 모드로 동작:
//   (A) 텍스트 도구로 편집 중   : bindData()로 현재 편집 데이터에 연결 → 즉시 라이브 반영(확정 시 커밋).
//   (B) 텍스트 레이어가 선택만 됨: 활성 레이어가 텍스트면 컨트롤 활성화 → 변경 시 히스토리 트랜잭션으로 재렌더.
//
// 공유 state.js / options-bar.js 를 수정하지 않기 위해 글꼴 목록은 여기서 자체 보유한다.
// paths-panel.js 의 인라인 스타일 패턴을 따라 공유 CSS 없이도 동작하도록 한다.

import { EVT } from "../core/constants.js";
import { isTextLayer, renderTextLayer } from "../text/text-layer.js";
import { beginVectorEdit, commitVectorEdit } from "../text/vector-layer-command.js";

// options-bar.js 의 텍스트 글꼴 목록과 동일하게 유지(중복이지만 disjoint 위해 자체 보유)
const FONTS = [
  ["Malgun Gothic, sans-serif", "맑은 고딕"],
  ["'Nanum Gothic', sans-serif", "나눔고딕"],
  ["'Batang', serif", "바탕"],
  ["'Gulim', sans-serif", "굴림"],
  ["Arial, sans-serif", "Arial"],
  ["'Times New Roman', serif", "Times"],
  ["'Courier New', monospace", "Courier"],
];

export class CharacterPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    // 편집 중 라이브 데이터 바인딩 (없으면 활성 레이어 모드)
    this._liveData = null;
    this._liveOnChange = null;
    this._build();
    // 활성 레이어 변경/구조 변경 시 컨트롤 상태 갱신
    app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => this._syncFromActive());
    app.bus.on(EVT.LAYERS_CHANGED, () => this._syncFromActive());
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">문자</div>
      <div class="char-body" style="padding:6px;display:flex;flex-direction:column;gap:6px;"></div>`;
    const body = this.el.querySelector(".char-body");

    // 글꼴
    this.fontSel = this._row(body, "글꼴", this._select(FONTS, (v) => this._change((d) => d.fontFamily = v)));
    // 크기 / 색
    const sizeColor = this._inlineRow(body);
    this.sizeInput = this._numberCell(sizeColor, "크기", 6, 300, 1, (v) => this._change((d) => d.fontSize = v));
    this.colorInput = this._colorCell(sizeColor, "색", (v) => this._change((d) => d.color = v));
    // 자간 / 행간
    const spacing = this._inlineRow(body);
    this.lsInput = this._numberCell(spacing, "자간", -20, 200, 1, (v) => this._change((d) => d.letterSpacing = v));
    this.lhInput = this._numberCell(spacing, "행간", 0.5, 4, 0.05, (v) => this._change((d) => d.lineHeight = v));
    // 스타일(굵게/기울임) + 정렬
    const style = this._inlineRow(body);
    this.boldBtn = this._toggleBtn(style, "B", "굵게", () => this._change((d) => d.bold = !d.bold));
    this.boldBtn.style.fontWeight = "bold";
    this.italicBtn = this._toggleBtn(style, "I", "기울임", () => this._change((d) => d.italic = !d.italic));
    this.italicBtn.style.fontStyle = "italic";
    const sep = document.createElement("span"); sep.style.cssText = "width:8px;"; style.appendChild(sep);
    this.alignBtns = {};
    for (const [a, label, sym] of [["left", "왼쪽", "⬅"], ["center", "가운데", "↔"], ["right", "오른쪽", "➡"]]) {
      this.alignBtns[a] = this._toggleBtn(style, sym, `${label} 정렬`, () => this._change((d) => d.align = a));
    }

    this.hint = document.createElement("div");
    this.hint.style.cssText = "color:var(--text-dim);font-size:11px;padding:2px;";
    this.hint.textContent = "텍스트 도구(T)로 글자를 만들거나 텍스트 레이어를 선택하세요.";
    body.appendChild(this.hint);

    this._syncFromActive();
  }

  // ── 편집 중 라이브 바인딩 (텍스트 도구가 호출) ──
  bindData(data, onChange) {
    this._liveData = data;
    this._liveOnChange = onChange;
    this._syncControls(data);
    this._setEnabled(true);
    this.hint.textContent = "편집 중 — 속성이 즉시 반영됩니다.";
  }
  unbind() {
    this._liveData = null;
    this._liveOnChange = null;
    this._syncFromActive();
  }

  // ── 현재 대상 데이터 결정: 라이브 우선, 없으면 활성 텍스트 레이어 ──
  _targetData() {
    if (this._liveData) return this._liveData;
    const layer = this.app.layers.activeLayer;
    return isTextLayer(layer) ? layer.vectorText : null;
  }

  // 컨트롤 변경 → 데이터 반영. 라이브면 즉시 콜백, 아니면 히스토리 트랜잭션으로 재렌더.
  _change(mutator) {
    if (this._liveData) {
      mutator(this._liveData);
      this._liveOnChange?.();
      this._syncControls(this._liveData);
      return;
    }
    // 활성 레이어 모드: 텍스트 도구가 활성이면 위임(편집 중 라이브 반영까지 일관 처리),
    // 아니면 여기서 직접 히스토리 트랜잭션으로 처리(어떤 도구가 켜져 있어도 undo 가능).
    const tool = this.app.activeTextTool;
    if (tool && tool.editor && tool.applyDataChangeToActiveLayer) {
      tool.applyDataChangeToActiveLayer(mutator, "문자 속성");
    } else {
      const layer = this.app.layers.activeLayer;
      if (!isTextLayer(layer)) return;
      const tx = beginVectorEdit(this.app, layer, "vectorText");
      mutator(layer.vectorText);
      renderTextLayer(layer, { selection: null });
      commitVectorEdit(tx, "문자 속성");
      this.app.layers.notifyContent(layer.id);
    }
    this._syncFromActive();
  }

  _syncFromActive() {
    if (this._liveData) return; // 편집 중이면 라이브가 우선
    const d = this._targetData();
    if (d) { this._syncControls(d); this._setEnabled(true); this.hint.textContent = "선택된 텍스트 레이어를 편집합니다."; }
    else { this._setEnabled(false); this.hint.textContent = "텍스트 도구(T)로 글자를 만들거나 텍스트 레이어를 선택하세요."; }
  }

  _syncControls(d) {
    this.fontSel.value = d.fontFamily;
    this.sizeInput.value = d.fontSize;
    this.colorInput.value = this._toHex(d.color);
    this.lsInput.value = d.letterSpacing ?? 0;
    this.lhInput.value = d.lineHeight ?? 1.2;
    this.boldBtn.classList.toggle("on", !!d.bold);
    this.italicBtn.classList.toggle("on", !!d.italic);
    for (const a in this.alignBtns) this.alignBtns[a].classList.toggle("on", (d.align || "left") === a);
  }

  _setEnabled(on) {
    const ctrls = [this.fontSel, this.sizeInput, this.colorInput, this.lsInput, this.lhInput,
      this.boldBtn, this.italicBtn, ...Object.values(this.alignBtns)];
    for (const c of ctrls) { c.disabled = !on; c.style.opacity = on ? "1" : "0.45"; }
  }

  // ── 작은 UI 빌더들(인라인 스타일) ──
  _row(parent, label, control) {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;align-items:center;gap:6px;";
    const lb = document.createElement("label");
    lb.textContent = label; lb.style.cssText = "width:34px;font-size:11px;color:var(--text-dim);";
    g.append(lb, control);
    control.style.flex = "1";
    parent.appendChild(g);
    return control;
  }
  _inlineRow(parent) {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
    parent.appendChild(g);
    return g;
  }
  _select(options, onChange) {
    const sel = document.createElement("select");
    sel.style.cssText = "font-size:12px;min-width:0;";
    for (const [val, text] of options) {
      const o = document.createElement("option"); o.value = val; o.textContent = text; sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }
  _numberCell(parent, label, min, max, step, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:3px;";
    const lb = document.createElement("label");
    lb.textContent = label; lb.style.cssText = "font-size:11px;color:var(--text-dim);";
    const input = document.createElement("input");
    input.type = "number"; input.min = min; input.max = max; input.step = step;
    input.style.cssText = "width:52px;font-size:12px;";
    const fire = () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onChange(v); };
    input.addEventListener("change", fire);
    input.addEventListener("input", fire);
    wrap.append(lb, input);
    parent.appendChild(wrap);
    return input;
  }
  _colorCell(parent, label, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:3px;";
    const lb = document.createElement("label");
    lb.textContent = label; lb.style.cssText = "font-size:11px;color:var(--text-dim);";
    const input = document.createElement("input");
    input.type = "color";
    input.style.cssText = "width:32px;height:22px;padding:0;border:1px solid var(--border);";
    input.addEventListener("input", () => onChange(input.value));
    wrap.append(lb, input);
    parent.appendChild(wrap);
    return input;
  }
  _toggleBtn(parent, sym, title, onClick) {
    const b = document.createElement("button");
    b.textContent = sym; b.title = title;
    b.style.cssText = "min-width:24px;height:22px;font-size:12px;cursor:pointer;";
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }

  // color 입력은 #rrggbb 만 받으므로 보정(이미 hex면 그대로)
  _toHex(c) {
    if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    // 간단 보정: 캔버스로 파싱
    try {
      const cv = document.createElement("canvas").getContext("2d");
      cv.fillStyle = c || "#000000";
      return cv.fillStyle;
    } catch { return "#000000"; }
  }
}
