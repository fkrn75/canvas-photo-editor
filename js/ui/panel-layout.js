// panel-layout.js — 패널 플로팅/도킹 배치 상태를 localStorage에 저장/복원하는 순수 데이터 모듈(② 패널 도킹).
// DOM에 일절 접근하지 않는다(읽기/쓰기 모두 localStorage + JSON만). 실제 패널 이동·렌더는 panel-float / dock-zones / 조율자가 담당.
// 저장 키: "cpe.panelLayout"  (panel-drag의 "cpe.panelOrder", panel-collapse의 "cpe.collapsedPanels"와 별개)
//
// 레이아웃 구조(Layout):
//   {
//     panels: {                       // 패널별 배치(키=패널 id, 예: "layers-panel")
//       "<panelId>": {
//         place: "dock" | "float",    // 도킹됨 / 떠 있음
//         dock?: "right"|"left"|"bottom",   // place==="dock"일 때 어느 도크에 속하는지
//         float?: { x, y, w, h }            // place==="float"일 때 화면상 위치/크기(px)
//       }
//     },
//     docks: {                        // 도크 영역 크기(폭/높이) — 스플리터가 갱신
//       right?:  { w }, left?: { w }, bottom?: { h }
//     }
//   }
//
// 모든 JSON 파싱/저장은 try/catch로 감싼다(프라이빗 모드·할당량 초과 등에서도 앱이 죽지 않도록).

const LS_KEY = "cpe.panelLayout";

// 비어 있는 기본 레이아웃을 새로 만든다(매 호출마다 새 객체 — 공유 참조로 인한 오염 방지).
function emptyLayout() {
  return { panels: {}, docks: {} };
}

// 임의의 값이 "객체"인지(배열·null 제외) 확인하는 헬퍼.
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// localStorage에서 읽은 raw 값을 안전한 Layout 형태로 정규화한다.
// panels/docks가 없거나 객체가 아니면 빈 객체로 보정해 이후 코드가 항상 두 키에 접근 가능하도록 한다.
function normalize(raw) {
  if (!isObject(raw)) return emptyLayout();
  return {
    panels: isObject(raw.panels) ? raw.panels : {},
    docks: isObject(raw.docks) ? raw.docks : {},
  };
}

// 저장된 레이아웃을 읽어 Layout으로 반환한다. 없거나 손상되면 빈 레이아웃({panels:{},docks:{}}).
export function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    return normalize(raw);
  } catch {
    return emptyLayout();
  }
}

// 레이아웃 전체를 localStorage에 저장한다. 저장 실패(프라이빗 모드 등)는 조용히 무시.
export function saveLayout(layout) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(normalize(layout)));
  } catch {
    /* 저장 실패는 무시(프라이빗 모드·할당량 초과 등) */
  }
}

// 특정 패널의 배치(PanelPlace)를 반환. 저장된 적 없으면 null.
export function getPanelPlace(panelId) {
  if (!panelId) return null;
  const place = loadLayout().panels[panelId];
  return isObject(place) ? place : null;
}

// 특정 패널의 배치를 저장한다.
//   place === null  →  그 패널 키를 삭제(레이아웃 초기 상태로 되돌림)
//   그 외           →  기존 값과 병합(merge) 후 저장 — 부분 갱신(예: float 좌표만)도 안전
// 반환값: 갱신된 Layout(호출부가 즉시 활용할 수 있도록).
export function setPanelPlace(panelId, place) {
  if (!panelId) return loadLayout();
  const layout = loadLayout();
  if (place === null) {
    delete layout.panels[panelId];
  } else if (isObject(place)) {
    // 기존 배치 위에 얕은 병합(전달된 키만 덮어씀).
    layout.panels[panelId] = { ...(layout.panels[panelId] || {}), ...place };
  }
  saveLayout(layout);
  return layout;
}

// 도크(right/left/bottom)의 크기를 반환. right/left는 {w}, bottom은 {h}. 저장된 적 없으면 null.
export function getDockSize(dock) {
  if (!dock) return null;
  const size = loadLayout().docks[dock];
  return isObject(size) ? size : null;
}

// 도크의 크기를 저장한다(기존 값과 병합). size=null이면 그 도크 키 삭제.
// 반환값: 갱신된 Layout.
export function setDockSize(dock, size) {
  if (!dock) return loadLayout();
  const layout = loadLayout();
  if (size === null) {
    delete layout.docks[dock];
  } else if (isObject(size)) {
    layout.docks[dock] = { ...(layout.docks[dock] || {}), ...size };
  }
  saveLayout(layout);
  return layout;
}

// 저장된 레이아웃을 완전히 삭제한다(전체 초기화 = 기본 배치로 복귀).
export function clearLayout() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* 삭제 실패는 무시 */
  }
}
