// panel-collapse.js — 우측 패널 접기/펴기.
// 각 패널의 .panel-head(제목 영역)를 클릭하면 그 패널을 접어 헤더만 남기고,
// 다시 클릭하면 편다. 접힌 패널 id 목록을 localStorage에 저장해 새로고침 후에도 유지한다.
// 이벤트 위임(.rightpanel 한 곳에 바인딩)이라 각 패널 내용이 동적으로 다시 그려져도 동작한다.

const LS_KEY = "cpe.collapsedPanels";

// 저장된 접힘 패널 id 배열 읽기(파싱 실패 시 빈 배열).
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 현재 접힌 패널 id 목록을 localStorage에 저장.
function save(rightpanel) {
  const ids = [...rightpanel.querySelectorAll(".panel.collapsed")]
    .map((p) => p.id)
    .filter(Boolean);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패는 무시(프라이빗 모드 등) */
  }
}

// 우측 패널에 접기 동작을 설치한다. app 생성 시 1회 호출.
export function initPanelCollapse(rightpanel) {
  if (!rightpanel) return;

  // 1) 저장된 접힘 상태 복원
  for (const id of load()) {
    const p = rightpanel.querySelector("#" + CSS.escape(id));
    if (p) p.classList.add("collapsed");
  }

  // 2) 헤더 클릭 토글(이벤트 위임). 헤더 안의 조작 요소(버튼/입력 등)는 접기 대상에서 제외.
  rightpanel.addEventListener("click", (e) => {
    const head = e.target.closest(".panel-head");
    if (!head || !rightpanel.contains(head)) return;
    if (e.target.closest("button, input, select, textarea, a")) return;
    const panel = head.closest(".panel");
    if (!panel || !panel.id) return;
    panel.classList.toggle("collapsed");
    save(rightpanel);
  });
}
