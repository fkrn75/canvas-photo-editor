// dock-zones.js — 패널 드래그 중 화면 좌표를 도킹존으로 판정하고, 해당 존을 반투명 하이라이트로 표시(② 패널 도킹).
// computeZone은 순수 기하 함수(부수효과 없음). showZoneHint/clearZoneHints만 DOM(오버레이 div 1개)을 다룬다.
// 색·테두리 등 시각 스타일은 지휘자 CSS의 .dock-zone-hint 가 정의한다. 이 모듈은 위치 계산과 표시 토글에 집중.

// 가장자리 감지 폭(px). 마우스가 .main의 좌/우 끝에서 이 거리 안이면 left/right, 하단에서 이 거리 안이면 bottom.
const EDGE = 64;

// 화면 좌표(clientX, clientY)가 .main(mainRect) 기준 어느 도킹존에 속하는지 판정한다.
//   반환: "right" | "left" | "bottom" | "float"
//   - 좌/우 가장자리 EDGE 안 → "left"/"right"
//   - 하단 가장자리 EDGE 안 → "bottom"
//   - 어디에도 안 걸리면 → "float"
//   - 모서리에서 두 가장자리에 동시에 걸리면, 경계로부터 더 "깊이" 들어온(=가까운) 쪽을 우선한다.
// mainRect: .main 엘리먼트의 getBoundingClientRect() 결과(left/right/top/bottom 사용).
export function computeZone(clientX, clientY, mainRect) {
  if (!mainRect) return "float";

  // 각 가장자리까지의 거리(.main 내부 기준). 음수면 그 변 바깥에 있다는 뜻.
  const distLeft = clientX - mainRect.left;        // 왼쪽 변에서 오른쪽으로 들어온 거리
  const distRight = mainRect.right - clientX;       // 오른쪽 변에서 왼쪽으로 들어온 거리
  const distBottom = mainRect.bottom - clientY;     // 아래 변에서 위로 들어온 거리

  // 각 가장자리 후보: EDGE 띠 안(0..EDGE)에 들어왔는지. 들어왔으면 그 거리값, 아니면 무한대(후보 아님).
  const candidates = [];
  if (distLeft >= 0 && distLeft <= EDGE) candidates.push({ zone: "left", d: distLeft });
  if (distRight >= 0 && distRight <= EDGE) candidates.push({ zone: "right", d: distRight });
  if (distBottom >= 0 && distBottom <= EDGE) candidates.push({ zone: "bottom", d: distBottom });

  if (candidates.length === 0) return "float";

  // 모서리 겹침 시: 가장자리에 가장 가까운(거리 d가 작은) 존을 우선.
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0].zone;
}

// 하이라이트 오버레이 div(재사용). showZoneHint가 처음 호출될 때 1개만 만들고 이후 재활용한다.
let hintEl = null;

// 오버레이 div를 보장(없으면 생성해 mainEl에 붙임). .main은 position 컨텍스트가 필요하므로
// (CSS Grid 컨테이너라도) 인라인으로 position을 잡지 않고, 오버레이는 fixed 좌표(뷰포트 기준)로 배치한다 →
// .main의 position 설정 여부와 무관하게 정확히 겹친다.
function ensureHint(mainEl) {
  if (hintEl && hintEl.isConnected) return hintEl;
  hintEl = document.createElement("div");
  hintEl.className = "dock-zone-hint";
  hintEl.style.position = "fixed";   // 뷰포트(clientX/Y) 좌표계와 일치 → mainRect 값을 그대로 사용 가능
  hintEl.style.pointerEvents = "none"; // 드래그 이벤트를 가로채지 않도록
  hintEl.style.display = "none";
  // mainEl이 있으면 그 안에, 없으면 body에 부착(fixed라 부모 위치와 무관).
  (mainEl || document.body).appendChild(hintEl);
  return hintEl;
}

// 주어진 존(zone)에 맞춰 하이라이트 띠/테두리 위치를 mainEl 기준으로 계산해 표시한다.
//   right  → 우측 EDGE 폭 세로 띠
//   left   → 좌측 EDGE 폭 세로 띠
//   bottom → 하단 EDGE 높이 가로 띠
//   float  → .main 전체(점선 테두리는 CSS가 처리, 여기선 전체 영역만 잡아줌)
// 위치는 mainEl.getBoundingClientRect()(뷰포트 좌표)를 fixed 인라인 style로 변환해 지정.
export function showZoneHint(zone, mainEl) {
  if (!mainEl || !zone) { clearZoneHints(); return; }
  const r = mainEl.getBoundingClientRect();
  const el = ensureHint(mainEl);
  const s = el.style;

  // 매 호출마다 4변을 모두 재설정(이전 존 잔여값이 남지 않도록).
  if (zone === "right") {
    s.left = (r.right - EDGE) + "px";
    s.top = r.top + "px";
    s.width = EDGE + "px";
    s.height = r.height + "px";
  } else if (zone === "left") {
    s.left = r.left + "px";
    s.top = r.top + "px";
    s.width = EDGE + "px";
    s.height = r.height + "px";
  } else if (zone === "bottom") {
    s.left = r.left + "px";
    s.top = (r.bottom - EDGE) + "px";
    s.width = r.width + "px";
    s.height = EDGE + "px";
  } else {
    // "float": .main 전체 영역(테두리 표시는 .dock-zone-hint--float 등 CSS가 담당).
    s.left = r.left + "px";
    s.top = r.top + "px";
    s.width = r.width + "px";
    s.height = r.height + "px";
  }

  // 존별 CSS 훅을 위해 modifier 클래스를 부여(지휘자 CSS가 .dock-zone-hint--<zone>로 스타일 차등 가능).
  el.className = "dock-zone-hint dock-zone-hint--" + zone;
  s.display = "block";
}

// 하이라이트를 숨긴다(엘리먼트는 재사용 위해 남겨둠). 드래그 종료/취소 시 호출.
export function clearZoneHints() {
  if (hintEl) hintEl.style.display = "none";
}
