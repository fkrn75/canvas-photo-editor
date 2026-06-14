// brushes-panel.js — 브러시 동역학(Brushes) 팔레트.
//
// 기존 브러시 옵션(크기/경도/타입)은 옵션바에 그대로 두고, 여기서는 "동역학"만 다룬다.
//   - Shape Dynamics : 크기/각도 지터
//   - Scatter        : 흩뿌림 양 + 한 점당 개수
//   - Color Dynamics : 전경↔배경 변동 + 색조/채도/명도 지터
//   - Dual Brush     : 2차 텍스처(종류 + 밀도)로 질감 곱
//
// 각 섹션은 활성 체크박스 + 슬라이더(들)로 구성된다. 값은 app.state와 양방향 바인딩.
// brush-dynamics.js 엔진이 이 state 필드들을 읽어 paint-tool 스탬프에 적용한다.
//
// history-panel.js / swatches-panel.js의 인라인 스타일 패턴을 따른다(공유 CSS 없이도 동작).
// ⚠ .rightpanel 안에서는 패널이 flex 형제로 짜부되지 않도록 인라인 레이아웃을 보장한다(메모리 사례 참고).

import { EVT } from "../core/constants.js";

export class BrushesPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._updaters = {}; // state 키 → 컨트롤 동기화 함수
    this._build();
    // 외부에서 동역학 값이 바뀌면(프리셋 적용 등) 컨트롤을 갱신
    app.bus.on(EVT.STATE_CHANGED, ({ key }) => this._updaters[key]?.());
  }

  _build() {
    this.el.innerHTML = `<div class="panel-head">브러시 동역학</div>`;
    // 스크롤 가능한 본문(옵션이 많아도 패널이 형제를 밀어내지 않게)
    this.body = document.createElement("div");
    this.body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;padding:4px 6px;";
    this.el.appendChild(this.body);

    // ── Shape Dynamics ──
    this._section("모양 동역학", "dynShape", (box) => {
      this._slider(box, "크기 지터", "shapeSizeJitter", 0, 1, 0.01, "%", 100);
      this._slider(box, "각도 지터", "shapeAngleJitter", 0, 1, 0.01, "%", 100,
        "사각/캘리그래피 등 방향성 모양에서 각도를 흔듭니다.");
    });

    // ── Scatter ──
    this._section("흩뿌림", "dynScatter", (box) => {
      this._slider(box, "흩뿌림", "scatterAmount", 0, 1, 0.01, "%", 100);
      this._slider(box, "개수", "scatterCount", 1, 16, 1, "");
    });

    // ── Color Dynamics ──
    this._section("색상 동역학", "dynColor", (box) => {
      this._slider(box, "전경/배경", "colorFgBgJitter", 0, 1, 0.01, "%", 100,
        "스탬프마다 전경색과 배경색 사이를 무작위로 섞습니다.");
      this._slider(box, "색조", "colorHueJitter", 0, 1, 0.01, "%", 100);
      this._slider(box, "채도", "colorSatJitter", 0, 1, 0.01, "%", 100);
      this._slider(box, "명도", "colorBriJitter", 0, 1, 0.01, "%", 100);
    });

    // ── Dual Brush ──
    this._section("듀얼 브러시", "dynDual", (box) => {
      this._select(box, "텍스처", "dualType", [
        ["spatter", "스패터"], ["chalk", "분필"], ["dots", "점"], ["noise", "노이즈"],
      ]);
      this._slider(box, "밀도", "dualDensity", 0.05, 1, 0.01, "%", 100);
    });

    // 안내
    const hint = document.createElement("div");
    hint.style.cssText = "color:var(--text-dim);font-size:11px;padding:6px 2px 2px;border-top:1px solid var(--border);margin-top:4px;";
    hint.textContent = "동역학은 브러시 도구에만 적용됩니다(연필/지우개 제외).";
    this.body.appendChild(hint);
  }

  // 활성 체크박스 헤더 + (켜졌을 때만 보이는) 컨트롤 박스.
  _section(title, enableKey, buildControls) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:8px;border:1px solid var(--border);border-radius:4px;overflow:hidden;";

    // 헤더(체크박스 + 제목)
    const head = document.createElement("label");
    head.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:5px 7px;cursor:pointer;" +
      "background:var(--bg-panel-2);font-weight:600;font-size:12px;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!this.app.state[enableKey];
    const tt = document.createElement("span");
    tt.textContent = title;
    tt.style.flex = "1";
    head.append(cb, tt);
    wrap.appendChild(head);

    // 컨트롤 박스
    const box = document.createElement("div");
    box.style.cssText = "padding:4px 8px 6px;";
    buildControls(box);
    wrap.appendChild(box);

    const syncEnabled = () => {
      const on = !!this.app.state[enableKey];
      cb.checked = on;
      box.style.display = on ? "" : "none";
      box.style.opacity = on ? "1" : "0.5";
    };
    cb.addEventListener("change", () => this.app.state.set(enableKey, cb.checked));
    this._updaters[enableKey] = syncEnabled;
    syncEnabled();

    this.body.appendChild(wrap);
  }

  // 슬라이더 한 줄. scale: 표시 환산(0~1→% 100배). suffix: 단위. hint: 행 툴팁.
  _slider(parent, label, key, min, max, step, suffix = "", scale = 1, hint = "") {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0;";
    if (hint) row.title = hint;

    const lb = document.createElement("label");
    lb.textContent = label;
    lb.style.cssText = "flex:none;width:62px;font-size:11px;";

    const input = document.createElement("input");
    input.type = "range"; input.min = min; input.max = max; input.step = step;
    input.style.cssText = "flex:1;min-width:0;";

    const badge = document.createElement("span");
    badge.style.cssText = "flex:none;width:38px;text-align:right;font-size:11px;color:var(--text-dim);";

    const fmt = () => (scale === 1 ? this.app.state[key] : Math.round(this.app.state[key] * scale)) + suffix;
    const sync = () => { input.value = this.app.state[key]; badge.textContent = fmt(); };
    input.addEventListener("input", () => { this.app.state.set(key, parseFloat(input.value)); badge.textContent = fmt(); });

    row.append(lb, input, badge);
    parent.appendChild(row);
    this._updaters[key] = sync;
    sync();
  }

  _select(parent, label, key, options) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0;";
    const lb = document.createElement("label");
    lb.textContent = label;
    lb.style.cssText = "flex:none;width:62px;font-size:11px;";
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;min-width:0;";
    for (const [val, text] of options) {
      const o = document.createElement("option"); o.value = val; o.textContent = text; sel.appendChild(o);
    }
    sel.value = this.app.state[key];
    sel.addEventListener("change", () => this.app.state.set(key, sel.value));
    row.append(lb, sel);
    parent.appendChild(row);
    this._updaters[key] = () => { sel.value = this.app.state[key]; };
  }
}
