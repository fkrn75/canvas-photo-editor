// panel-refresh.js — 정보성 패널(히스토그램/정보/내비게이터) 공용 유틸.
//   · createRefresher: 디바운스 갱신. 패널이 접혀 있거나 숨겨져 있으면 계산을 미뤘다가
//     다시 보이는 순간(ResizeObserver) 한 번 갱신한다 — 안 보이는 패널이 매 편집마다 일하지 않게.
//   · collapseOnFirstSeen: 새로 추가된 패널을 처음 한 번만 접힌 상태로 시작시킨다
//     (기존 사용자의 우측 패널이 갑자기 길어지지 않도록. 이후 펼침/접힘은 panel-collapse가 영속).

const SEEN_KEY = "cpe.seenPanels";
const COLLAPSED_KEY = "cpe.collapsedPanels"; // panel-collapse.js와 같은 키

// 패널이 실제로 보이는가(접힘 아님 + 레이아웃 상자 있음 — 플로팅(fixed)도 판정 가능)
export function isPanelShown(panelEl) {
  if (!panelEl || panelEl.classList.contains("collapsed")) return false;
  return panelEl.getClientRects().length > 0;
}

// fn: 실제 갱신 함수. delay: 디바운스(ms). watchEl: 크기 변화를 감시할 본문 요소(기본=panelEl)
export function createRefresher(panelEl, fn, delay = 150, watchEl = panelEl) {
  let timer = 0, pending = false;
  const run = () => {
    timer = 0;
    if (!isPanelShown(panelEl)) { pending = true; return; }
    pending = false;
    try { fn(); } catch (e) { console.error("[panel] 갱신 오류:", e); }
  };
  const ro = new ResizeObserver(() => {
    // 접힘/숨김 → 표시로 바뀌면(크기 0→양수) 미뤄 둔 갱신을 수행
    if (pending && isPanelShown(panelEl)) run();
  });
  ro.observe(watchEl);
  return {
    // 디바운스 예약
    request() {
      if (timer) return;
      timer = setTimeout(run, delay);
    },
    // 즉시 갱신(보이지 않으면 보류)
    now() {
      if (timer) { clearTimeout(timer); timer = 0; }
      run();
    },
  };
}

// 처음 보는 패널 id면 collapsed 클래스를 붙이고(저장된 접힘 목록이 있으면 거기에도 추가) 본 것으로 기록.
// initPanelCollapse보다 먼저(패널 생성자에서) 호출해야 한다 — 첫 실행이면 panel-collapse가 DOM을 스캔해 저장한다.
export function collapseOnFirstSeen(panelEl) {
  if (!panelEl?.id) return;
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    if (!Array.isArray(seen) || seen.includes(panelEl.id)) return;
    panelEl.classList.add("collapsed");
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw != null) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && !list.includes(panelEl.id)) {
        list.push(panelEl.id);
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(list));
      }
    }
    seen.push(panelEl.id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* 저장소 사용 불가 — 기본(펼침) 유지 */ }
}
