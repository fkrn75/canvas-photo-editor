// panel-dock.js — 패널 도킹/플로팅 조율자(② 레이아웃 자유 배치).
// 역할: 패널 헤더 드래그를 전면 관장한다.
//   · 같은 도킹 컨테이너 안에서 위/아래 순서 변경
//   · 다른 도킹 컨테이너(우/좌/하단)로 이동
//   · 화면 가장자리 밖(float 존)으로 끌면 패널을 떼어내 플로팅
// 책임 분리: 상태 저장=panel-layout, 존 판정/하이라이트=dock-zones,
//   플로팅 스타일·이동=panel-float, 경계 리사이즈=panel-splitter.
// app.js는 initPanelDock(.main) 한 줄만 호출한다(기존 initPanelDrag 대체 — 순서 드래그①도 여기서 흡수).

import { loadLayout, setPanelPlace, getDockSize, setDockSize } from "./panel-layout.js";
import { computeZone, showZoneHint, clearZoneHints } from "./dock-zones.js";
import { makeFloating, clearFloating, reclampAll, isFloating } from "./panel-float.js";
import { initSplitters } from "./panel-splitter.js";

const DRAG_THRESHOLD = 4;     // 이 거리(px) 이상 움직여야 드래그로 인정(헤더 클릭=접기와 구분)
const DEFAULT_DOCK = "right"; // 플로팅 복귀 시 기본 도킹처

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

// data-dock 속성으로 3개 도킹 컨테이너 참조(없으면 null)
function getDocks(mainEl) {
  return {
    right: mainEl.querySelector('[data-dock="right"]'),
    left: mainEl.querySelector('[data-dock="left"]'),
    bottom: mainEl.querySelector('[data-dock="bottom"]'),
  };
}
function getFloatLayer() { return document.querySelector(".float-layer"); }
function dockVar(dock) { return dock === "bottom" ? "--bottom-h" : dock === "left" ? "--left-w" : "--right-w"; }

export function initPanelDock(mainEl) {
  if (!mainEl) return;
  const docks = getDocks(mainEl);
  const floatLayer = getFloatLayer();
  if (!floatLayer) return;

  // 1) 저장된 레이아웃 복원(패널 위치/순서 + 도킹 크기 + 플로팅)
  restoreLayout(mainEl, docks, floatLayer);
  // 2) 도킹된 패널 헤더 드래그 바인딩(플로팅 패널 이동은 panel-float 담당)
  bindHeaderDrag(mainEl, docks, floatLayer);
  // 3) 도킹 컨테이너 경계 스플리터(CSS 변수 리사이즈)
  initSplitters(mainEl, {
    onResize: (dock, px) => setDockSize(dock, dock === "bottom" ? { h: px } : { w: px }),
  });
  // 4) 창 크기 변경 시 플로팅 패널 위치 보정
  window.addEventListener("resize", () => reclampAll(floatLayer));
  // 5) 빈 좌/하단 도킹존 표시 갱신
  updateDockVisibility(docks, mainEl);
}

// ── 복원 ───────────────────────────────────────────────
function restoreLayout(mainEl, docks, floatLayer) {
  const layout = loadLayout();

  // 도킹 컨테이너 크기(스플리터 저장값) 복원
  for (const dock of ["right", "left", "bottom"]) {
    const s = getDockSize(dock);
    if (s && (s.w != null || s.h != null)) {
      document.documentElement.style.setProperty(dockVar(dock), (s.w != null ? s.w : s.h) + "px");
    }
  }

  // 패널 위치 복원(저장된 것만; 없으면 editor.html 기본 위치 유지)
  const panels = (layout && layout.panels) || {};
  const byDock = { right: [], left: [], bottom: [] };
  for (const [id, place] of Object.entries(panels)) {
    const el = document.getElementById(id);
    if (!el || !place) continue;
    if (place.place === "float" && place.float) {
      floatLayer.appendChild(el);
      makeFloating(el, place.float, floatCallbacks(mainEl, docks, floatLayer));
    } else if (place.place === "dock" && place.dock && byDock[place.dock]) {
      byDock[place.dock].push({ el, order: typeof place.order === "number" ? place.order : 9999 });
    }
  }
  // 도크별로 저장된 순서(order)대로 재배치(미저장 패널은 editor.html 기본 위치 유지)
  for (const dock of ["right", "left", "bottom"]) {
    if (!docks[dock]) continue;
    byDock[dock].sort((a, b) => a.order - b.order).forEach(({ el }) => docks[dock].appendChild(el));
  }
}

// 플로팅 패널 콜백: 이동 시 위치 저장 / 복귀 버튼 클릭 시 도킹
function floatCallbacks(mainEl, docks, floatLayer) {
  return {
    onMove: (panelEl, rect) => setPanelPlace(panelEl.id, { place: "float", float: rect }),
    onDockBack: (panelEl) => {
      clearFloating(panelEl);
      const target = docks[DEFAULT_DOCK] || docks.right;
      target.appendChild(panelEl);
      persistOrder(target, DEFAULT_DOCK); // 복귀 후 그 도크 전체 순서 저장
      updateDockVisibility(docks, mainEl);
    },
  };
}

// ── 헤더 드래그(도킹된 패널) ───────────────────────────
function bindHeaderDrag(mainEl, docks, floatLayer) {
  let st = null;

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const head = e.target.closest(".panel-head");
    if (!head) return;
    const panel = head.closest(".panel");
    if (!panel || isFloating(panel)) return; // 플로팅 패널은 panel-float이 이동 담당
    // 헤더 내 인터랙티브 요소는 드래그 시작 제외(클릭 동작 보존)
    if (e.target.closest("button, input, select, textarea, a, .opt-toggle")) return;
    st = { panel, head, x0: e.clientX, y0: e.clientY, dragging: false };
  });

  document.addEventListener("pointermove", (e) => {
    if (!st) return;
    if (!st.dragging) {
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < DRAG_THRESHOLD) return;
      st.dragging = true;
      st.panel.classList.add("dragging");
    }
    const mainRect = mainEl.getBoundingClientRect();
    const zone = computeZone(e.clientX, e.clientY, mainRect);
    showZoneHint(zone, mainEl);
    markOrder(e, mainEl, docks, st.panel, zone);
  });

  const finish = (e, canceled) => {
    if (!st) return;
    if (st.dragging) {
      st.panel.classList.remove("dragging");
      clearZoneHints();
      clearOrderMarks(mainEl, docks);
      if (!canceled) {
        const mainRect = mainEl.getBoundingClientRect();
        const zone = computeZone(e.clientX, e.clientY, mainRect);
        applyDrop(st.panel, zone, e, mainEl, docks, floatLayer);
      }
      suppressNextClick(st.head); // 드래그 직후 click 억제(접기 오발 방지)
    }
    st = null;
  };
  document.addEventListener("pointerup", (e) => finish(e, false));
  document.addEventListener("pointercancel", (e) => finish(e, true));
}

// 드롭 적용: zone에 따라 플로팅 / 도킹 이동 / 순서 변경
function applyDrop(panel, zone, e, mainEl, docks, floatLayer) {
  if (zone === "float") {
    const w = clamp(panel.offsetWidth || 240, 180, 520);
    const h = clamp(panel.offsetHeight || 260, 120, 600);
    const rect = {
      x: clamp(e.clientX - 40, 0, Math.max(0, window.innerWidth - w)),
      y: clamp(e.clientY - 12, 0, Math.max(0, window.innerHeight - h)),
      w, h,
    };
    floatLayer.appendChild(panel);
    makeFloating(panel, rect, floatCallbacks(mainEl, docks, floatLayer));
    setPanelPlace(panel.id, { place: "float", float: rect });
  } else {
    const target = docks[zone];
    if (!target) return;
    const ref = orderRef(e, target, panel);
    if (ref) target.insertBefore(panel, ref);
    else target.appendChild(panel);
    persistOrder(target, zone); // 이 컨테이너 전체 순서를 order로 저장(드롭된 패널 포함)
  }
  updateDockVisibility(docks, mainEl);
}

// ── 순서 표시/계산 ─────────────────────────────────────
// 드래그 중 마우스 아래 패널의 상/하단에 삽입선 표시(같은 컨테이너 내 순서 시각화)
function markOrder(e, mainEl, docks, dragged, zone) {
  clearOrderMarks(mainEl, docks);
  if (zone === "float") return;
  const target = docks[zone];
  if (!target) return;
  const over = elementPanelAt(e.clientX, e.clientY);
  if (!over || over === dragged || over.parentElement !== target) return;
  const r = over.getBoundingClientRect();
  const after = (e.clientY - r.top) > r.height / 2;
  over.classList.add(after ? "drop-after" : "drop-before");
}
// 삽입 기준 형제(마우스 아래 패널의 상/하단 기준; 없으면 null=맨 끝)
function orderRef(e, target, dragged) {
  const over = elementPanelAt(e.clientX, e.clientY);
  if (!over || over === dragged || over.parentElement !== target) return null;
  const r = over.getBoundingClientRect();
  return (e.clientY - r.top) > r.height / 2 ? over.nextSibling : over;
}
function elementPanelAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(".panel") : null;
}
function clearOrderMarks(mainEl, docks) {
  for (const d of Object.values(docks)) {
    if (d) d.querySelectorAll(".drop-before, .drop-after").forEach((p) => p.classList.remove("drop-before", "drop-after"));
  }
}

// ── 기타 ───────────────────────────────────────────────
// 드래그 직후 한 번의 click을 가로채 막는다(헤더 click=접기 오발 방지)
function suppressNextClick(head) {
  const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); head.removeEventListener("click", block, true); };
  head.addEventListener("click", block, true);
  setTimeout(() => head.removeEventListener("click", block, true), 350); // 안전장치
}

// 컨테이너의 현재 DOM 순서를 각 패널의 place.order로 저장(같은 도크 내 순서 복원용)
function persistOrder(container, dock) {
  container.querySelectorAll(":scope > .panel").forEach((p, i) => {
    if (p.id) setPanelPlace(p.id, { place: "dock", dock, order: i });
  });
}

// 좌/하단 도킹 컨테이너의 빈 상태에 따라 grid 트랙 크기·스플리터 표시를 갱신한다.
// 비어 있으면 CSS 변수를 0으로(트랙 0폭/0높이 → 캔버스 안 가림) + 스플리터 숨김.
// 채워지면 저장된 크기(없으면 기본값)로 트랙을 펼치고 스플리터를 보인다.
function updateDockVisibility(docks, mainEl) {
  for (const dock of ["left", "bottom"]) {
    const el = docks[dock];
    if (!el) continue;
    const empty = el.querySelectorAll(".panel").length === 0;
    el.classList.toggle("empty", empty);
    const varName = dock === "bottom" ? "--bottom-h" : "--left-w";
    if (empty) {
      document.documentElement.style.setProperty(varName, "0px");
    } else {
      const saved = getDockSize(dock);
      const px = saved ? (saved.w != null ? saved.w : saved.h) : (dock === "bottom" ? 160 : 220);
      document.documentElement.style.setProperty(varName, px + "px");
    }
    // 빈 도크엔 스플리터를 숨겨 캔버스 가장자리에 핸들이 떠 있지 않도록 한다.
    const sp = mainEl ? mainEl.querySelector(".splitter-" + dock) : null;
    if (sp) sp.style.display = empty ? "none" : "";
  }
}
