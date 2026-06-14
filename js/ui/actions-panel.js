// actions-panel.js — Actions(매크로) 팔레트.
//
// ActionsManager(app.actions)의 액션 세트/스텝을 보여주고, 녹화 ●/정지 ■/재생 ▶/삭제,
// "+ 액션 추가"(레지스트리에서 골라 값 입력 후 추가·즉시 실행)를 제공한다.
//
// paths-panel.js / history-panel.js 의 패널 구조(.panel-head + 인라인 기본 스타일 + 하단 툴바)를
// 그대로 따른다. 공유 CSS가 없어도 동작하도록 핵심 레이아웃은 인라인으로 보장한다.
// ActionsManager.onChange 콜백으로 목록을 갱신한다(PathsPanel ↔ PathManager.onChange와 동일).

export class ActionsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._build();
    if (this.app.actions) this.app.actions.onChange = () => this._render();
  }

  get am() { return this.app.actions; }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">액션</div>
      <div class="actions-setbar"></div>
      <div class="actions-list"></div>
      <div class="actions-toolbar">
        <button class="act-record" title="녹화 시작/정지">● 녹화</button>
        <button class="act-play"   title="현재 세트 재생">▶ 재생</button>
        <button class="act-add"    title="재생 가능한 액션을 골라 추가">＋ 액션</button>
        <button class="act-newset" title="새 액션 세트">📁</button>
        <button class="act-del"    title="선택 세트 비우기/삭제">🗑</button>
      </div>`;

    this.setbar = this.el.querySelector(".actions-setbar");
    this.list = this.el.querySelector(".actions-list");
    this.setbar.style.cssText =
      "display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid var(--border);";
    this.list.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:4px;";

    const tb = this.el.querySelector(".actions-toolbar");
    tb.style.cssText =
      "display:flex;flex-wrap:wrap;gap:2px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";

    this._recordBtn = this.el.querySelector(".act-record");
    this._recordBtn.addEventListener("click", () => this._toggleRecord());
    this.el.querySelector(".act-play").addEventListener("click", () => this._play());
    this.el.querySelector(".act-add").addEventListener("click", () => this._addAction());
    this.el.querySelector(".act-newset").addEventListener("click", () => this._newSet());
    this.el.querySelector(".act-del").addEventListener("click", () => this._delete());

    this._render();
  }

  _render() {
    const am = this.am;
    if (!am) return;

    // ── 세트 선택 드롭다운 ──
    this.setbar.innerHTML = "";
    const lb = document.createElement("span");
    lb.textContent = "세트";
    lb.style.cssText = "font-size:11px;color:var(--text-dim);flex:none;";
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;min-width:0;font-size:12px;";
    am.sets.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = `${s.name} (${s.steps.length})`;
      sel.appendChild(o);
    });
    sel.value = am.currentSetId;
    sel.addEventListener("change", () => am.setCurrent(sel.value));
    this.setbar.append(lb, sel);

    // 녹화 버튼 상태 표시
    if (am.recording) {
      this._recordBtn.textContent = "■ 정지";
      this._recordBtn.style.color = "#ff5555";
      this._recordBtn.style.fontWeight = "bold";
    } else {
      this._recordBtn.textContent = "● 녹화";
      this._recordBtn.style.color = "";
      this._recordBtn.style.fontWeight = "";
    }

    // ── 스텝 목록 ──
    this.list.innerHTML = "";
    const set = am.currentSet;
    if (!set || set.steps.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = am.recording
        ? "녹화 중… 보정/필터/변형을 실행하거나 ＋액션으로 추가하세요."
        : "● 녹화 후 작업하거나 ＋액션으로 단계를 추가하세요.";
      empty.style.cssText = "color:var(--text-dim);font-size:11px;padding:8px 6px;line-height:1.5;";
      this.list.appendChild(empty);
      return;
    }

    set.steps.forEach((step, i) => {
      const row = document.createElement("div");
      row.className = "action-step";
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:4px 6px;margin-bottom:1px;border-radius:3px;";

      const num = document.createElement("span");
      num.textContent = (i + 1) + ".";
      num.style.cssText = "flex:none;width:18px;text-align:right;color:var(--text-dim);font-size:11px;";

      const name = document.createElement("span");
      name.textContent = step.label + this._paramSummary(step);
      name.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;";

      // 단일 스텝 재생
      const playOne = document.createElement("button");
      playOne.textContent = "▶";
      playOne.title = "이 단계만 실행";
      playOne.style.cssText = "flex:none;padding:0 5px;line-height:1.6;";
      playOne.addEventListener("click", (e) => { e.stopPropagation(); am._runStep(step); });

      // 삭제
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "이 단계 삭제";
      del.style.cssText = "flex:none;padding:0 5px;line-height:1.6;";
      del.addEventListener("click", (e) => { e.stopPropagation(); am.removeStep(set.id, i); });

      row.append(num, name, playOne, del);
      this.list.appendChild(row);
    });
  }

  // 파라미터가 있으면 "(밝기 30, 대비 -10)" 식 요약을 만든다.
  _paramSummary(step) {
    const action = this.am?._byId.get(step.actionId);
    if (!action || !action.params || action.params.length === 0) return "";
    const parts = action.params.map((p) => `${p.label} ${step.params?.[p.key] ?? p.value}`);
    return " (" + parts.join(", ") + ")";
  }

  // ── 툴바 동작 ──
  _toggleRecord() {
    const am = this.am;
    if (!am) return;
    if (am.recording) am.stopRecording();
    else am.startRecording();
  }

  _play() {
    const am = this.am;
    if (!am) return;
    am.play();
  }

  _newSet() {
    const am = this.am;
    if (!am) return;
    this.app.dialogs.form("새 액션 세트", [
      { key: "name", label: "이름", type: "text", value: `세트 ${am.sets.length + 1}` },
    ], (v) => { am.addSet(v.name || undefined); }, "만들기");
  }

  _delete() {
    const am = this.am;
    if (!am) return;
    const set = am.currentSet;
    if (!set) return;
    if (set.steps.length > 0) {
      // 단계가 있으면 우선 단계만 비운다(세트는 유지).
      am.clearSteps(set.id);
      this.app.status(`"${set.name}" 단계를 비웠습니다.`);
    } else if (am.sets.length > 1) {
      // 빈 세트면 세트 자체 삭제(마지막 1개는 유지).
      am.removeSet(set.id);
      this.app.status("빈 세트를 삭제했습니다.");
    } else {
      this.app.status("마지막 세트는 삭제할 수 없습니다.");
    }
  }

  // "+ 액션 추가": 레지스트리에서 액션을 고르고, 값이 필요한 액션이면 슬라이더로 입력받아 추가.
  _addAction() {
    const am = this.am;
    if (!am) return;

    // 1단계: 액션 선택(그룹 라벨 포함). dialogs.form select 사용.
    const options = am.registry.map((a) => [a.id, `[${a.group}] ${a.label}`]);
    this.app.dialogs.form("액션 추가", [
      { key: "id", label: "액션", type: "select", value: options[0][0], options },
      { key: "run", label: "추가 후 즉시 실행", type: "select", value: "yes", options: [["yes", "예"], ["no", "아니오"]] },
    ], (v) => {
      const action = am._byId.get(v.id);
      if (!action) return;
      const runNow = v.run === "yes";
      // 2단계: 파라미터가 있으면 값 입력 다이얼로그 → 추가
      if (action.params && action.params.length > 0) {
        const fields = action.params.map((p) => ({
          key: p.key, label: p.label, type: "number",
          value: p.value, min: p.min, max: p.max, step: p.step,
        }));
        this.app.dialogs.form(`${action.label} 값`, fields, (vals) => {
          am.addStep(action.id, vals, { runNow });
        }, "추가");
      } else {
        am.addStep(action.id, {}, { runNow });
      }
    }, "다음");
  }
}
