// tool-presets-panel.js — 도구 프리셋 팔레트 UI.
// 현재 활성 도구의 옵션을 이름 붙여 저장(＋버튼)하고, 도구별로 묶인 목록에서 클릭해 복원한다.
// 우클릭으로 프리셋을 삭제한다. "현재 도구만 보기" 토글로 활성 도구 그룹만 표시할 수 있다.
// swatches-panel.js의 패널 구조(.panel-head/툴바/인라인 스타일)와 우클릭 삭제 패턴을 차용했다.
// 실제 저장/적용 로직은 ToolPresets(js/presets/tool-presets.js)에 위임한다.

import { EVT } from "../core/constants.js";
import { ToolPresets, TOOL_LABELS } from "../presets/tool-presets.js";

export class ToolPresetsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    // 로직 객체(앱에 공유 인스턴스가 있으면 그것을 쓰고, 없으면 자체 생성).
    this.presets = app.toolPresets || (app.toolPresets = new ToolPresets(app));
    this.onlyCurrent = true;   // 기본: 현재 도구 그룹만 표시
    this._build();
    // 도구가 바뀌면 "현재 도구만 보기" 모드에서 목록을 다시 그리고, 저장 버튼 상태도 갱신한다.
    app.bus.on(EVT.TOOL_CHANGED, () => this._render());
  }

  // ── DOM 골격 ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">
        <span>도구 프리셋</span>
      </div>
      <div class="tp-list"></div>
      <div class="tp-toolbar">
        <button class="tp-save" title="현재 도구 옵션을 프리셋으로 저장">＋ 저장</button>
        <label class="tp-only" title="활성 도구의 프리셋만 표시">
          <input type="checkbox" class="tp-only-cb"> 현재 도구만
        </label>
        <button class="tp-reset" title="기본 프리셋으로 초기화">↺</button>
      </div>`;

    this.listEl = this.el.querySelector(".tp-list");
    // 목록은 늘어나는 영역: rightpanel 안에서 스크롤되도록 flex:1 + min-height:0. (우측패널 flex 함정 회피)
    this.listEl.style.cssText =
      "flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 8px;";

    const tb = this.el.querySelector(".tp-toolbar");
    // 툴바는 고정 영역: flex:0 0 auto로 두어 목록에 짓눌리지 않게 한다.
    tb.style.cssText =
      "flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:4px 6px;" +
      "border-top:1px solid var(--border);background:var(--bg-panel-2);";

    const onlyCb = this.el.querySelector(".tp-only-cb");
    onlyCb.checked = this.onlyCurrent;
    onlyCb.addEventListener("change", () => { this.onlyCurrent = onlyCb.checked; this._render(); });

    this.saveBtn = this.el.querySelector(".tp-save");
    this.saveBtn.style.cssText = "cursor:pointer;";
    this.saveBtn.addEventListener("click", () => this._saveCurrent());

    this.el.querySelector(".tp-reset").addEventListener("click", () => this._reset());

    this._render();
  }

  // ── 렌더 ──
  _render() {
    const activeId = this.app.tools.activeId;

    // 저장 버튼: 프리셋 미지원 도구면 비활성 + 안내.
    const supported = this.presets.supports(activeId);
    this.saveBtn.disabled = !supported;
    this.saveBtn.style.opacity = supported ? "1" : "0.45";
    this.saveBtn.title = supported
      ? `현재 도구(${TOOL_LABELS[activeId] || activeId}) 옵션을 프리셋으로 저장`
      : "이 도구는 저장할 옵션이 없습니다";

    this.listEl.innerHTML = "";

    // 표시할 도구 그룹 결정.
    let toolIds;
    if (this.onlyCurrent) {
      toolIds = supported ? [activeId] : [];
    } else {
      toolIds = this.presets.toolsWithPresets();
    }

    if (toolIds.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:var(--text-dim);font-size:12px;padding:8px 2px;line-height:1.5;";
      empty.textContent = this.onlyCurrent
        ? (supported ? "저장된 프리셋이 없습니다. 아래 ＋저장으로 현재 옵션을 추가하세요."
                     : "이 도구는 프리셋을 지원하지 않습니다.")
        : "저장된 프리셋이 없습니다.";
      this.listEl.appendChild(empty);
      return;
    }

    for (const toolId of toolIds) {
      const arr = this.presets.list(toolId);
      if (arr.length === 0) continue;

      // 그룹 헤더(도구 이름). "현재 도구만 보기"가 아니어도 어떤 도구의 프리셋인지 구분되게 한다.
      const head = document.createElement("div");
      head.textContent = TOOL_LABELS[toolId] || toolId;
      head.style.cssText =
        "font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 3px;" +
        "text-transform:none;letter-spacing:.02em;";
      // 활성 도구 그룹은 살짝 강조.
      if (toolId === activeId) head.style.color = "var(--text)";
      this.listEl.appendChild(head);

      arr.forEach((preset, i) => {
        this.listEl.appendChild(this._presetRow(toolId, i, preset));
      });
    }
  }

  // 프리셋 한 줄(클릭=적용, 우클릭=삭제).
  _presetRow(toolId, index, preset) {
    const row = document.createElement("button");
    row.className = "tp-row";
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;width:100%;text-align:left;" +
      "padding:5px 8px;margin:1px 0;border:1px solid transparent;border-radius:3px;" +
      "background:transparent;color:var(--text);cursor:pointer;font-size:12px;";
    row.title = `${preset.name}  (클릭=적용 · 우클릭=삭제)\n${this._summary(toolId, preset.values)}`;

    // 작은 점(현재 활성 도구 프리셋이면 강조색).
    const dot = document.createElement("span");
    dot.style.cssText =
      "flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--border);";
    if (toolId === this.app.tools.activeId) dot.style.background = "var(--accent, #4a90d9)";

    const name = document.createElement("span");
    name.textContent = preset.name;
    name.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    row.append(dot, name);

    // 호버 강조(공유 CSS 없이도 보이도록 인라인 처리).
    row.addEventListener("mouseenter", () => { row.style.background = "var(--bg-hover, rgba(255,255,255,.06))"; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });

    // 클릭: 적용
    row.addEventListener("click", () => {
      if (this.presets.apply(toolId, index)) {
        this.app.status(`프리셋 적용: ${preset.name}`);
        // 다른 도구 프리셋을 적용하면 활성 도구가 바뀌어 _render가 이미 호출되지만,
        // 같은 도구면 목록 강조 갱신을 위해 한 번 더 그린다.
        this._render();
      }
    });
    // 우클릭: 삭제
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.presets.remove(toolId, index);
      this.app.status(`프리셋 삭제: ${preset.name}`);
      this._render();
    });

    return row;
  }

  // 툴팁용 값 요약(키:값 몇 개). 불리언/소수는 읽기 쉽게 변환.
  _summary(toolId, values) {
    const parts = [];
    for (const k of Object.keys(values)) {
      let v = values[k];
      if (typeof v === "boolean") v = v ? "켜짐" : "꺼짐";
      else if (typeof v === "number" && !Number.isInteger(v)) v = Math.round(v * 100) + "%";
      parts.push(`${k}=${v}`);
    }
    return parts.join(", ");
  }

  // ── 동작 ──
  _saveCurrent() {
    const activeId = this.app.tools.activeId;
    if (!this.presets.supports(activeId)) { this.app.status("이 도구는 저장할 옵션이 없습니다."); return; }
    const label = TOOL_LABELS[activeId] || activeId;
    // 이름 입력 다이얼로그(dialogs.form의 text 타입 사용).
    this.app.dialogs.form(`프리셋 저장 — ${label}`, [
      { key: "name", label: "프리셋 이름", type: "text", value: `${label} 프리셋` },
    ], (v) => {
      const name = (v.name || "").trim();
      const toolId = this.presets.saveCurrent(name || undefined);
      if (toolId) {
        // 저장 직후 그 그룹이 보이도록: 현재 도구만 보기 모드면 이미 보이고, 아니면 전체 목록에 추가됨.
        this._render();
        this.app.status(`프리셋 저장: ${name || "(자동 이름)"}`);
      }
    }, "저장");
  }

  _reset() {
    this.presets.reset();
    this._render();
    this.app.status("도구 프리셋을 기본값으로 초기화했습니다.");
  }
}
