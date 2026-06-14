// panel-collapse.js — 패널 접기/펴기.
// 각 패널의 .panel-head(제목 영역)를 클릭하면 그 패널을 접어 헤더만 남기고, 다시 클릭하면 편다.
// 접힌 패널 id 목록을 localStorage에 저장해 새로고침 후에도 유지한다.
// ② 패널 도킹 도입 후: 패널이 우측/좌측/하단 도크·플로팅 어디로 옮겨가도 동작해야 하므로
//   이벤트 위임을 document(전역)에 걸고, 저장/복원도 document 전체에서 .panel을 찾는다.

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

// 현재 접힌 패널 id 목록을 localStorage에 저장(컨테이너 무관, 문서 전체 스캔).
function saveAll() {
  const ids = [...document.querySelectorAll(".panel.collapsed")]
    .map((p) => p.id)
    .filter(Boolean);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패는 무시(프라이빗 모드 등) */
  }
}

// 접기 동작을 설치한다. app 생성 시 1회 호출(root는 보통 document — 모든 도크/플로팅을 포괄).
export function initPanelCollapse(root) {
  if (!root) return;

  // 1) 저장된 접힘 상태 복원(패널이 어느 컨테이너에 있든 document 전역에서 찾는다)
  for (const id of load()) {
    const p = document.getElementById(id);
    if (p && p.classList.contains("panel")) p.classList.add("collapsed");
  }

  // 2) 헤더 클릭 토글(이벤트 위임). 헤더 안의 조작 요소(버튼/입력 등)는 접기 대상에서 제외.
  root.addEventListener("click", (e) => {
    const head = e.target.closest(".panel-head");
    if (!head) return;
    // 헤더 내 조작 요소 클릭은 접기 토글에서 제외(panel-dock/panel-float와 동일 규칙으로 일치).
    // .opt-toggle(옵션 토글)을 누락하면 그 위 클릭이 접기로 오발한다 → 추가.
    if (e.target.closest("button, input, select, textarea, a, .opt-toggle")) return;
    const panel = head.closest(".panel");
    if (!panel || !panel.id) return;
    panel.classList.toggle("collapsed");
    saveAll();
  });
}
