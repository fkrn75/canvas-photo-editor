// panel-float.js — 패널 플로팅(② 패널 플로팅/도킹의 "떠있는" 쪽).
// 패널을 position:fixed 로 띄워 헤더 드래그로 자유 이동하고, 헤더의 복귀버튼(⤓)으로 도킹으로 되돌린다.
// 화면(viewport) 밖으로 나가지 않도록 클램프하며, window resize 시 reclampAll 로 안쪽으로 보정한다.
//
// 책임 분리:
//   - 이 모듈은 "플로팅 패널 1개"의 스타일/드래그/복귀버튼만 담당한다.
//   - .float-layer 로의 appendChild(어느 컨테이너에 떠있을지)는 지휘자(panel-dock)가 처리한다.
//   - 좌표 저장/순서 복원은 onMove/onDockBack 콜백으로 지휘자·panel-layout 이 처리한다(여기서 panel-layout import 금지).
//
// panel-collapse(헤더 클릭=접기)와의 충돌 회피:
//   드래그 이동거리가 임계(DRAG_THRESHOLD)를 넘으면, 그 직후 발생하는 click 1회를 캡처 단계에서 삼켜
//   "헤더를 끌었을 뿐인데 접힘" 오발을 막는다.

// ── 상수 ────────────────────────────────────────────────────────────────
const DRAG_THRESHOLD = 4;        // 이 거리(px) 이상 움직이면 "드래그"로 간주(클릭 억제 트리거)
const MIN_VISIBLE = 28;          // 패널이 화면 밖으로 나가도 최소 이만큼(px)은 보이게 클램프(대략 헤더 높이)

// 드래그 시작에서 제외할 헤더 내 조작 요소(이들 위에서 누르면 이동 시작 안 함).
// panel-collapse 의 제외 규칙(button/input/select/textarea/a)과 결을 맞추고, 옵션 토글·복귀버튼을 추가한다.
const NO_DRAG_SELECTOR = "button, input, select, textarea, a, .opt-toggle, .float-dock-btn";

// 패널별 정리 함수(드래그 핸들러 해제용)를 저장. clearFloating 에서 꺼내 호출한다.
const cleanups = new WeakMap();

// ── 유틸 ────────────────────────────────────────────────────────────────

// 이 패널이 플로팅 상태인가? — 단일 진실원천은 'floating' 클래스.
export function isFloating(panelEl) {
  return !!panelEl && panelEl.classList.contains("floating");
}

// 값 v 를 [min, max] 범위로 가둔다(max < min 인 비정상 상황도 안전하게 처리).
function clamp(v, min, max) {
  if (max < min) return min;
  return v < min ? min : v > max ? max : v;
}

// left/top 을 viewport 안에 최소 MIN_VISIBLE 만큼 남도록 보정해 돌려준다.
// 패널이 화면보다 커도 좌상단이 화면 안에 머물도록(음수 끝까지 밀리지 않게) 한다.
function clampPos(x, y, w, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // x 최소: 패널 오른쪽 끝이 화면 왼쪽에서 MIN_VISIBLE 만큼은 들어오도록 → x >= MIN_VISIBLE - w
  // x 최대: 패널 왼쪽 끝이 화면 오른쪽에서 MIN_VISIBLE 만큼은 남도록 → x <= vw - MIN_VISIBLE
  const minX = Math.min(0, MIN_VISIBLE - w);
  const maxX = Math.max(minX, vw - MIN_VISIBLE);
  // y 는 헤더가 위로 잘려 잡을 수 없게 되는 걸 막기 위해 top 은 0 이상으로, 아래로는 MIN_VISIBLE 남게.
  const minY = 0;
  const maxY = Math.max(minY, vh - MIN_VISIBLE);
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
}

// 패널의 현재 인라인 위치/크기를 {x,y,w,h}(정수 px)로 읽는다.
function readRect(panelEl) {
  return {
    x: Math.round(parseFloat(panelEl.style.left) || 0),
    y: Math.round(parseFloat(panelEl.style.top) || 0),
    w: Math.round(parseFloat(panelEl.style.width) || panelEl.offsetWidth),
    h: Math.round(parseFloat(panelEl.style.height) || panelEl.offsetHeight),
  };
}

// 헤더에 복귀버튼(⤓)을 보장한다(이미 있으면 그대로 반환 — 중복 생성 금지).
function ensureDockBtn(head) {
  let btn = head.querySelector(":scope > .float-dock-btn");
  if (btn) return btn;
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "float-dock-btn";
  btn.textContent = "⤓";
  btn.title = "도킹으로 복귀";
  head.appendChild(btn);
  return btn;
}

// ── 핵심: 플로팅으로 전환 ─────────────────────────────────────────────────

// panelEl 을 플로팅으로 만든다.
//   rect : {x,y,w,h} — viewport 기준 절대좌표(position:fixed 의 left/top/width/height). CSS 픽셀.
//   opts : { onDockBack(panelEl), onMove(panelEl, {x,y,w,h}) }
//          - onDockBack: 복귀버튼 클릭 시 호출(실제 재도킹/순서복원은 지휘자가).
//          - onMove    : 드래그 종료 시 현재 rect 통지(좌표 저장은 지휘자·panel-layout 이).
// ※ .float-layer 로의 appendChild 는 여기서 하지 않는다(지휘자 담당). 여기선 스타일/버튼/드래그만.
export function makeFloating(panelEl, rect, opts = {}) {
  if (!panelEl) return;
  const onMove = typeof opts.onMove === "function" ? opts.onMove : null;
  const onDockBack = typeof opts.onDockBack === "function" ? opts.onDockBack : null;

  // 1) 클래스 + 인라인 스타일로 position:fixed 부여. 시작 위치는 화면 안으로 클램프.
  const w = Math.round(rect?.w || panelEl.offsetWidth || 240);
  const h = Math.round(rect?.h || panelEl.offsetHeight || 200);
  const pos = clampPos(Math.round(rect?.x || 0), Math.round(rect?.y || 0), w, h);
  panelEl.classList.add("floating");
  panelEl.style.position = "fixed";
  panelEl.style.left = pos.x + "px";
  panelEl.style.top = pos.y + "px";
  panelEl.style.width = w + "px";
  panelEl.style.height = h + "px";

  // 2) 헤더 + 복귀버튼 확보
  const head = panelEl.querySelector(":scope > .panel-head");
  if (!head) {
    // 헤더가 없으면 드래그/복귀를 걸 곳이 없다. 스타일만 입힌 채로 둔다(비정상 케이스).
    cleanups.set(panelEl, () => {});
    return;
  }
  const dockBtn = ensureDockBtn(head);

  // 3) 복귀버튼 클릭 → onDockBack. (드래그 억제 click 캡처보다 먼저 처리되도록 stopPropagation)
  const onDockClick = (e) => {
    e.preventDefault();
    e.stopPropagation();          // 헤더 click(=접기) 위임으로 전파 방지
    if (onDockBack) onDockBack(panelEl);
  };
  dockBtn.addEventListener("click", onDockClick);

  // 4) 헤더 pointer 드래그로 이동.
  let dragging = false;
  let moved = false;              // 임계 초과로 "드래그"가 된 적 있는지(클릭 억제 판단)
  let startX = 0, startY = 0;     // pointerdown 시 포인터 좌표
  let baseX = 0, baseY = 0;       // pointerdown 시 패널 left/top
  let pointerId = null;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;                 // 좌클릭만
    if (e.target.closest(NO_DRAG_SELECTOR)) return; // 버튼/입력/토글/복귀버튼 위에서는 이동 시작 안 함
    dragging = true;
    moved = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const r = readRect(panelEl);
    baseX = r.x;
    baseY = r.y;
    try { head.setPointerCapture(pointerId); } catch { /* 일부 환경 무시 */ }
    // 드래그 동안 텍스트 선택/기본 동작 방지
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    if (!moved) return;                          // 임계 전에는 위치 고정(미세 흔들림 무시)
    const pos2 = clampPos(baseX + dx, baseY + dy, panelEl.offsetWidth, panelEl.offsetHeight);
    panelEl.style.left = pos2.x + "px";
    panelEl.style.top = pos2.y + "px";
  };

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { if (pointerId != null) head.releasePointerCapture(pointerId); } catch { /* 무시 */ }
    pointerId = null;
    if (moved && onMove) onMove(panelEl, readRect(panelEl)); // 실제로 이동했을 때만 저장 통지
    // moved 플래그는 직후 click 억제(captureClick)에서 읽고 리셋한다.
  };

  // 5) 드래그였다면(임계 초과) 바로 뒤따르는 click 1회를 캡처 단계에서 삼켜
  //    panel-collapse(헤더클릭=접기) 오발을 막는다. 단순 클릭(미이동)은 통과시켜 접기 정상 동작.
  const captureClick = (e) => {
    if (moved) {
      e.stopPropagation();
      e.preventDefault();
      moved = false;             // 1회만 억제
    }
  };

  head.addEventListener("pointerdown", onPointerDown);
  head.addEventListener("pointermove", onPointerMove);
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  head.addEventListener("click", captureClick, true); // 캡처 단계 → collapse 위임보다 먼저

  // 6) 정리 함수 등록(clearFloating 에서 호출)
  cleanups.set(panelEl, () => {
    dockBtn.removeEventListener("click", onDockClick);
    head.removeEventListener("pointerdown", onPointerDown);
    head.removeEventListener("pointermove", onPointerMove);
    head.removeEventListener("pointerup", endDrag);
    head.removeEventListener("pointercancel", endDrag);
    head.removeEventListener("click", captureClick, true);
  });
}

// ── 핵심: 플로팅 해제(원복) ───────────────────────────────────────────────

// panelEl 의 플로팅 흔적을 완전히 제거한다(class/인라인스타일/복귀버튼/드래그 핸들러).
// ※ DOM 위치(어느 부모로 되돌릴지)는 여기서 다루지 않는다 — 지휘자가 .rightpanel 로 재삽입한다.
export function clearFloating(panelEl) {
  if (!panelEl) return;

  // 1) 드래그/버튼 핸들러 해제
  const cleanup = cleanups.get(panelEl);
  if (cleanup) { cleanup(); cleanups.delete(panelEl); }

  // 2) 복귀버튼 제거
  const head = panelEl.querySelector(":scope > .panel-head");
  if (head) {
    const btn = head.querySelector(":scope > .float-dock-btn");
    if (btn) btn.remove();
  }

  // 3) 클래스 + 인라인 스타일 원복(makeFloating 이 설정한 것들만 제거 → 도킹 시 CSS 레이아웃 복귀)
  panelEl.classList.remove("floating");
  panelEl.style.position = "";
  panelEl.style.left = "";
  panelEl.style.top = "";
  panelEl.style.width = "";
  panelEl.style.height = "";
}

// ── 화면 리사이즈 보정 ────────────────────────────────────────────────────

// floatLayer 안의 모든 플로팅 패널이 viewport 밖이면 안쪽으로 위치를 보정한다.
// (크기는 건드리지 않고 left/top 만 클램프 — window resize 핸들러에서 호출됨.)
export function reclampAll(floatLayer) {
  if (!floatLayer) return;
  floatLayer.querySelectorAll(":scope > .floating").forEach((panelEl) => {
    const r = readRect(panelEl);
    const pos = clampPos(r.x, r.y, r.w, r.h);
    if (pos.x !== r.x) panelEl.style.left = pos.x + "px";
    if (pos.y !== r.y) panelEl.style.top = pos.y + "px";
  });
}
