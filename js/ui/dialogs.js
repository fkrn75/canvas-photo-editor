// dialogs.js — 모달 다이얼로그. 폼 입력(새 문서/리사이즈)과 슬라이더 미리보기(보정/필터)를 제공.

export class Dialogs {
  // aria-labelledby용 헤더 id를 다이얼로그마다 유일하게 만들기 위한 카운터.
  static _seq = 0;

  constructor(app) {
    this.app = app;
    this.root = document.getElementById("dialog-root");
  }

  // 공통 모달 골격. body(Element)를 받고 확인/취소 버튼을 단다.
  _open(title, body, onOk, onCancel, okText = "확인") {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";

    // title은 사용자/파일 데이터(문서명 등)에서 올 수 있어 innerHTML 보간 대신
    // DOM API로 넣는다(유일한 innerHTML 사용자 데이터 경로였던 부분 제거).
    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const headId = `dialog-head-${++Dialogs._seq}`;
    dialog.setAttribute("aria-labelledby", headId);

    const head = document.createElement("div");
    head.className = "dialog-head";
    head.id = headId;
    head.textContent = title;

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "dialog-body";
    bodyWrap.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "dialog-foot";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel";
    cancelBtn.textContent = "취소";
    const okBtn = document.createElement("button");
    okBtn.className = "ok primary";
    okBtn.textContent = okText;
    foot.append(cancelBtn, okBtn);

    dialog.append(head, bodyWrap, foot);
    backdrop.appendChild(dialog);
    this.root.appendChild(backdrop);

    // 열기 전 포커스를 기억해 뒀다가 닫힐 때 복원한다(접근성: 모달 진입/이탈 시 포커스 왕복).
    const prevFocus = document.activeElement;

    // close는 모든 닫기 경로(확인/취소/Esc/Enter/백드롭)에서 호출되므로
    // 여기서 keydown 리스너를 일괄 해제한다(마우스 클릭으로 닫을 때 핸들러가 잔류해
    // Enter로 onOk가 다시 호출되던 누수/이중 실행 방지).
    const close = () => {
      backdrop.remove();
      window.removeEventListener("keydown", keyHandler, true);
      if (prevFocus?.focus) prevFocus.focus();
    };
    const cancel = () => { onCancel?.(); close(); };
    okBtn.addEventListener("click", () => { onOk?.(); close(); });
    cancelBtn.addEventListener("click", cancel);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) cancel(); });

    // Tab 포커스 트랩: dialog 안의 포커스 가능 요소만 순환시킨다(마지막→첫, 첫←마지막).
    const focusables = () => [...dialog.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);
    const keyHandler = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { cancel(); return; }
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { onOk?.(); close(); return; }
      if (e.key === "Tab") {
        const els = focusables();
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", keyHandler, true);
    // 첫 포커스 가능 요소로 포커스(입력/셀렉트 우선, 없으면 아무 포커스 가능 요소)
    const first = body.querySelector("input,select") || focusables()[0];
    if (first) setTimeout(() => { first.focus(); first.select?.(); }, 0);
    return close;
  }

  // 폼 다이얼로그. fields: [{key,label,type,value,min,max,step,options}]
  form(title, fields, onOk, okText = "확인") {
    const body = document.createElement("div");
    const refs = {};
    for (const f of fields) {
      const row = document.createElement("div");
      row.className = "row";
      const lb = document.createElement("label");
      lb.textContent = f.label;
      row.appendChild(lb);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const [val, text] of f.options) {
          const o = document.createElement("option"); o.value = val; o.textContent = text; input.appendChild(o);
        }
        input.value = f.value;
      } else {
        input = document.createElement("input");
        input.type = f.type || "number";
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        if (f.step != null) input.step = f.step;
        input.value = f.value;
      }
      refs[f.key] = input;
      row.appendChild(input);
      body.appendChild(row);
    }
    this._open(title, body, () => {
      const out = {};
      for (const f of fields) {
        const v = refs[f.key].value;
        out[f.key] = f.type === "number" ? parseFloat(v) : v;
      }
      onOk(out);
    }, null, okText);
  }

  // 슬라이더 미리보기 다이얼로그. sliders: [{key,label,min,max,step,value,scale,suffix}]
  // onPreview(values)는 슬라이더가 바뀔 때마다, onCommit(values)는 확인 시, onCancel은 취소 시 호출.
  adjust(title, sliders, onPreview, onCommit, onCancel) {
    const body = document.createElement("div");
    const values = {};
    for (const s of sliders) {
      values[s.key] = s.value;
      const row = document.createElement("div");
      row.className = "row";
      const lb = document.createElement("label");
      lb.textContent = s.label;
      const inp = document.createElement("input");
      inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = s.step; inp.value = s.value;
      const badge = document.createElement("span");
      badge.className = "val-badge";
      const scale = s.scale || 1;
      const fmt = (v) => (scale === 1 ? v : Math.round(v * scale)) + (s.suffix || "");
      badge.textContent = fmt(s.value);
      inp.addEventListener("input", () => {
        values[s.key] = parseFloat(inp.value);
        badge.textContent = fmt(values[s.key]);
        onPreview({ ...values });
      });
      row.append(lb, inp, badge);
      body.appendChild(row);
    }
    this._open(title, body,
      () => onCommit({ ...values }),
      () => onCancel?.(),
      "적용");
  }

  // 임의의 body 엘리먼트를 담는 커스텀 모달 (레벨/커브 등 전용 UI용)
  custom(title, bodyEl, onOk, onCancel, okText = "적용") {
    return this._open(title, bodyEl, onOk, onCancel, okText);
  }

  // 간단 알림
  alert(title, message) {
    const body = document.createElement("div");
    body.textContent = message;
    this._open(title, body, null, null, "확인");
  }
}
