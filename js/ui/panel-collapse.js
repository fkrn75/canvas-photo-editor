// panel-collapse.js — 패널 접기/펴기.
// 각 패널의 .panel-head(제목 영역)를 클릭하면 그 패널을 접어 헤더만 남기고, 다시 클릭하면 편다.
// 접힌 패널 id 목록을 localStorage에 저장해 새로고침 후에도 유지한다.
// ② 패널 도킹 도입 후: 패널이 우측/좌측/하단 도크·플로팅 어디로 옮겨가도 동작해야 하므로
//   이벤트 위임을 document(전역)에 걸고, 저장/복원도 document 전체에서 .panel을 찾는다.

const LS_KEY = "cpe.collapsedPanels";

// 첫 실행(저장된 접힘 상태가 전혀 없을 때)에만 적용할 기본 접힘 패널 id 목록.
// 펼침 유지 = 레이어·색상 견본(Swatches)·히스토리, 나머지 우측 패널은 접힘.
const DEFAULT_COLLAPSED = [
  "styles-panel", "channels-panel", "paths-panel", "character-panel",
  "shape-panel", "brushes-panel", "actions-panel", "tool-presets-panel",
  "file-browser-panel",
];

// 저장된 접힘 패널 id 배열 읽기. 키가 아예 없으면(첫 실행) null, 파싱 실패 시 빈 배열.
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null) return null;
    const v = JSON.parse(raw);
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

  // 1) 저장된 접힘 상태 복원(패널이 어느 컨테이너에 있든 document 전역에서 찾는다).
  // 저장된 상태가 전혀 없으면(첫 실행) DEFAULT_COLLAPSED를 적용하고, 있으면 그 값을 그대로 따른다
  // (사용자가 직접 편 패널을 덮어쓰지 않기 위해 저장된 상태가 있을 땐 기본값을 절대 섞지 않는다).
  const saved = load();
  const ids = saved == null ? DEFAULT_COLLAPSED : saved;
  for (const id of ids) {
    const p = document.getElementById(id);
    if (p && p.classList.contains("panel")) p.classList.add("collapsed");
  }
  // 첫 실행에 적용한 기본값을 즉시 저장해 두어, 다음 로드부터는 "저장된 상태 있음"으로 취급되게 한다.
  if (saved == null) saveAll();

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
