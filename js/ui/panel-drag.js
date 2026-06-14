// panel-drag.js — 우측 패널을 헤더 드래그로 위/아래 순서 재배치(① 레이아웃 이동).
// 한 컬럼(.rightpanel) 안에서만 순서를 바꾸고, 결과 순서를 localStorage에 저장해 새로고침 후에도 유지한다.
// panel-collapse(헤더 클릭=접기)와는 자연히 구분된다: 드래그하면 click 이벤트가 발생하지 않으므로 접기와 충돌하지 않는다.

const ORDER_KEY = "cpe.panelOrder";

// 저장된 패널 id 순서 배열(없거나 손상 시 null).
function loadOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// 현재 DOM 순서를 localStorage에 저장.
function saveOrder(rightpanel) {
  const ids = [...rightpanel.children].map((p) => p.id).filter(Boolean);
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패는 무시(프라이빗 모드 등) */
  }
}

// 모든 패널 헤더를 드래그 핸들로 지정(헤더에서만 드래그 시작).
function setHandles(rightpanel) {
  rightpanel.querySelectorAll(".panel-head").forEach((h) => { h.draggable = true; });
}

// 드롭 위치 표시(파란 선) 제거.
function clearMarks(rightpanel) {
  rightpanel.querySelectorAll(".drop-before, .drop-after")
    .forEach((p) => p.classList.remove("drop-before", "drop-after"));
}

export function initPanelDrag(rightpanel) {
  if (!rightpanel) return;

  // 1) 저장된 순서 복원(저장된 id 순서대로 다시 append → 그 순서가 됨)
  const order = loadOrder();
  if (order) {
    for (const id of order) {
      const p = rightpanel.querySelector("#" + CSS.escape(id));
      if (p) rightpanel.appendChild(p);
    }
  }

  // 2) 헤더를 드래그 핸들로 지정
  setHandles(rightpanel);

  let dragId = null;

  rightpanel.addEventListener("dragstart", (e) => {
    const head = e.target.closest(".panel-head");
    const panel = head && head.closest(".panel");
    if (!panel) { e.preventDefault(); return; }
    dragId = panel.id;
    panel.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", panel.id); } catch { /* 일부 환경 무시 */ }
  });

  rightpanel.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();               // drop 허용
    e.dataTransfer.dropEffect = "move";
    const over = e.target.closest(".panel");
    clearMarks(rightpanel);
    if (!over || over.id === dragId) return;
    const r = over.getBoundingClientRect();
    // 패널 상반부 위면 앞에, 하반부면 뒤에 놓는다는 표시
    over.classList.add((e.clientY - r.top) < r.height / 2 ? "drop-before" : "drop-after");
  });

  rightpanel.addEventListener("drop", (e) => {
    if (!dragId) return;
    e.preventDefault();
    const dragged = rightpanel.querySelector("#" + CSS.escape(dragId));
    const over = e.target.closest(".panel");
    if (dragged && over && over.id !== dragId) {
      const r = over.getBoundingClientRect();
      if ((e.clientY - r.top) < r.height / 2) rightpanel.insertBefore(dragged, over);
      else rightpanel.insertBefore(dragged, over.nextSibling);
      saveOrder(rightpanel);
    }
    clearMarks(rightpanel);
  });

  rightpanel.addEventListener("dragend", () => {
    const d = rightpanel.querySelector(".panel.dragging");
    if (d) d.classList.remove("dragging");
    clearMarks(rightpanel);
    dragId = null;
  });
}
