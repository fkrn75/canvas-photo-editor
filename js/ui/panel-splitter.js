// panel-splitter.js — 도킹 컨테이너(.main 그리드) 경계에 드래그 핸들을 만들어 도크 크기를 리사이즈한다(② 패널 도킹).
// 실제로 바꾸는 것은 CSS 변수뿐이다: 우측 도크 폭 --right-w, 좌측 도크 폭 --left-w, 하단 도크 높이 --bottom-h.
// (이 변수들이 .main의 grid-template-columns/rows를 구성하므로, 변수만 바꾸면 그리드가 즉시 재배치된다.)
//
// 역할 분리:
//   - 이 모듈: 핸들 생성 + 포인터 드래그 + 클램프 + documentElement에 CSS변수 setProperty + 드래그 종료 시 onResize(dock, px) 콜백.
//   - 영속 저장(panel-layout.setDockSize)·복원은 조율자가 onResize에서 연결한다. 스플리터는 저장소를 직접 모른다.
//
// 클래스 약속(지휘자 CSS와 일치해야 함):
//   .splitter            공통(hit 영역·hover 강조)
//   .splitter-right      우측 도크 좌변(세로 핸들, col-resize) → --right-w 조절
//   .splitter-left       좌측 도크 우변(세로 핸들, col-resize) → --left-w 조절
//   .splitter-bottom     하단 도크 상변(가로 핸들, row-resize) → --bottom-h 조절
//
// 도크 컨테이너 약속(존재 여부로 핸들 생성을 결정):
//   우측 .rightpanel  — 항상 존재 → .splitter-right 항상 생성(필수 동작)
//   좌측 .dock-left   — 있을 때만 → .splitter-left 생성
//   하단 .dock-bottom — 있을 때만 → .splitter-bottom 생성

// 드래그 시 도크 크기 클램프 범위(px). 너무 좁아 패널이 짜부되거나, 캔버스를 다 덮는 것을 막는다.
const CLAMP = {
  right: { min: 160, max: 640 },
  left: { min: 160, max: 640 },
  bottom: { min: 120, max: 480 },
};

// 도크별 갱신 대상 CSS 변수명. panel-layout.js의 docks.right.w / left.w / bottom.h 와 1:1 매핑.
const VAR_NAME = {
  right: "--right-w",
  left: "--left-w",
  bottom: "--bottom-h",
};

// 값을 [min,max]로 자른다.
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// documentElement에 CSS변수를 px 단위로 설정. (:root 변수를 덮어써 .main 그리드가 즉시 반응)
function setVar(dock, px) {
  document.documentElement.style.setProperty(VAR_NAME[dock], px + "px");
}

// 현재 적용된 도크 크기(px)를 읽는다. 인라인 변수가 없으면 :root 기본값을 계산해 사용.
// computed 값이 px가 아니거나 비정상이면 클램프 최솟값으로 폴백(드래그 시작점이 NaN이 되는 것 방지).
function readVar(dock) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(VAR_NAME[dock]).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : CLAMP[dock].min;
}

// 핸들 1개를 만들고 mainEl에 붙인 뒤, 포인터 드래그를 배선한다.
//   dock: "right" | "left" | "bottom"
//   axis: "x"(세로 핸들=가로 리사이즈) | "y"(가로 핸들=세로 리사이즈)
//   sign: 드래그 이동량을 도크 크기 증감으로 바꿀 때의 부호.
//         우측 도크는 왼쪽(-dx)으로 끌수록 넓어짐 → sign -1
//         좌측 도크는 오른쪽(+dx)으로 끌수록 넓어짐 → sign +1
//         하단 도크는 위(-dy)로 끌수록 높아짐     → sign -1
//   modifier: 추가로 붙일 클래스(.splitter-right 등)
//   onResize: 드래그 종료 콜백(dock, px)
function makeHandle(mainEl, dock, axis, sign, modifier, onResize) {
  const handle = document.createElement("div");
  handle.className = "splitter " + modifier;
  // 접근성/식별용 데이터 속성(테스트·CSS에서 활용 가능, 동작에는 불필요).
  handle.dataset.dock = dock;
  mainEl.appendChild(handle);

  // 드래그 상태(포인터 캡처 동안만 유효).
  let dragging = false;
  let startPos = 0;     // 드래그 시작 시 포인터 좌표(axis에 맞춰 clientX/clientY)
  let startSize = 0;    // 드래그 시작 시 도크 크기(px)
  let pointerId = null;

  handle.addEventListener("pointerdown", (e) => {
    // 주 버튼(좌클릭/터치/펜)만 시작.
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    startPos = axis === "x" ? e.clientX : e.clientY;
    startSize = readVar(dock);
    handle.classList.add("dragging");
    // 포인터 캡처: 핸들 밖으로 빠르게 움직여도 move/up을 계속 받는다.
    try { handle.setPointerCapture(pointerId); } catch { /* 일부 환경 무시 */ }
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const cur = axis === "x" ? e.clientX : e.clientY;
    const delta = cur - startPos;
    // sign에 따라 이동량을 크기 증감으로 변환 후 클램프.
    const { min, max } = CLAMP[dock];
    const next = clamp(startSize + sign * delta, min, max);
    setVar(dock, next);   // 드래그 중 실시간 반영
    e.preventDefault();
  });

  // 드래그 종료(up/cancel 공통 처리).
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    if (pointerId !== null) {
      try { handle.releasePointerCapture(pointerId); } catch { /* 무시 */ }
      pointerId = null;
    }
    // 최종 크기를 콜백으로 통지(조율자가 setDockSize로 저장). 정수 px로 반올림 → 저장 JSON이 깔끔.
    if (typeof onResize === "function") onResize(dock, Math.round(readVar(dock)));
  }

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  return handle;
}

// .main 그리드 경계에 도크 스플리터들을 설치한다. app 생성 시 1회 호출.
//   mainEl: .main 엘리먼트
//   opts.onResize(dock, sizePx): 드래그 종료 시 호출(영속 저장은 호출부가 담당). 선택.
// 반환: 생성된 핸들 엘리먼트 배열(필요 시 호출부가 추가 제어).
//
// 우측(.splitter-right)은 .rightpanel이 항상 있으므로 무조건 생성한다.
// 좌측/하단은 해당 도킹 컨테이너(.dock-left/.dock-bottom)가 DOM에 있을 때만 핸들을 만든다
// (없으면 생성 자체를 생략 → 빈 도크에 떠 있는 핸들로 캔버스를 가리는 일이 없다).
// ※ 조율자가 도크 div를 항상 DOM에 두고 .empty 클래스로만 비움을 표시하는 모델을 쓸 수도 있다.
//   그 경우 좌/하단 핸들은 항상 생성되지만, CSS가 .main:not(.has-left)/.main:not(.has-bottom)일 때
//   해당 핸들을 display:none 처리하므로(스니펫 참조) 빈 도크 위에 핸들이 보이지 않는다 — 이중 안전.
export function initSplitters(mainEl, opts = {}) {
  if (!mainEl) return [];
  const onResize = opts.onResize;
  const handles = [];

  // 우측 도크 좌변 핸들(필수): 왼쪽으로 끌수록 우측 패널이 넓어진다(sign -1).
  handles.push(makeHandle(mainEl, "right", "x", -1, "splitter-right", onResize));

  // 좌측 도크 우변 핸들(.dock-left 존재 시): 오른쪽으로 끌수록 좌측 도크가 넓어진다(sign +1).
  if (mainEl.querySelector(".dock-left")) {
    handles.push(makeHandle(mainEl, "left", "x", +1, "splitter-left", onResize));
  }

  // 하단 도크 상변 핸들(.dock-bottom 존재 시): 위로 끌수록 하단 도크가 높아진다(sign -1).
  if (mainEl.querySelector(".dock-bottom")) {
    handles.push(makeHandle(mainEl, "bottom", "y", -1, "splitter-bottom", onResize));
  }

  return handles;
}
