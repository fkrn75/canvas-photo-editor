// menus/panels.js — 보기 메뉴 추가 항목(200%·픽셀 격자·스냅·가이드 잠금·화면 모드)과 "창" 메뉴.
// 창 메뉴: 패널 표시/숨기기 토글 + 패널 배치 초기화.
//   · 숨김은 .panel-hidden 클래스(display:none)로 하고 localStorage("cpe.hiddenPanels")에 영속한다.
//   · 저장된 숨김 상태 복원은 메뉴가 처음 만들어질 때(MenuBar 생성 = 모든 패널 생성 직후) 1회 수행한다.
// 메뉴 항목은 정적이라 체크 표시가 없으므로, 토글 결과는 상태바 메시지로 알린다.

import { ensureSnapState, saveSnapState } from "../../render/snap.js";
import { clearLayout } from "../panel-layout.js";
import { clearFloating, isFloating } from "../panel-float.js";

const HIDDEN_KEY = "cpe.hiddenPanels";

// editor.html의 기본 패널 순서(우측 도크) — 배치 초기화 시 이 순서로 되돌린다. [id, 메뉴 표시명]
export const PANELS = [
  ["layers-panel", "레이어"],
  ["swatches-panel", "색상 견본"],
  ["styles-panel", "스타일"],
  ["history-panel", "작업 내역"],
  ["navigator-panel", "내비게이터"],
  ["info-panel", "정보"],
  ["histogram-panel", "히스토그램"],
  ["channels-panel", "채널"],
  ["paths-panel", "패스"],
  ["character-panel", "문자"],
  ["shape-panel", "셰이프 / 벡터 마스크"],
  ["brushes-panel", "브러시 동역학"],
  ["actions-panel", "액션"],
  ["tool-presets-panel", "도구 사전 설정"],
  ["file-browser-panel", "파일 브라우저"],
];

function loadHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveHidden() {
  const ids = [...document.querySelectorAll(".panel.panel-hidden")].map((p) => p.id).filter(Boolean);
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)); } catch { /* 무시 */ }
}

let restored = false;
function restoreHidden() {
  if (restored) return;
  restored = true;
  for (const id of loadHidden()) document.getElementById(id)?.classList.add("panel-hidden");
}

// 패널 토글: 숨김 → 표시(+펼침) / 표시·접힘 → 펼침 / 표시·펼침 → 숨김
function togglePanel(app, id, name) {
  const p = document.getElementById(id);
  if (!p) { app.status(`${name} 패널을 찾을 수 없습니다.`); return; }
  if (p.classList.contains("panel-hidden")) {
    p.classList.remove("panel-hidden");
    expand(p);
    p.scrollIntoView?.({ block: "nearest" });
    app.status(`${name} 패널 표시`);
  } else if (p.classList.contains("collapsed")) {
    expand(p);
    p.scrollIntoView?.({ block: "nearest" });
    app.status(`${name} 패널 펼침`);
  } else {
    p.classList.add("panel-hidden");
    app.status(`${name} 패널 숨김 (창 메뉴에서 다시 표시)`);
  }
  saveHidden();
}

// 접힌 패널 펼치기 — panel-collapse의 영속 처리를 그대로 타도록 헤더 클릭을 흉내 낸다
function expand(p) {
  if (!p.classList.contains("collapsed")) return;
  const head = p.querySelector(":scope > .panel-head");
  if (head) head.click();
  else p.classList.remove("collapsed");
}

// 패널 배치 초기화: 저장된 도킹/플로팅/크기/숨김을 지우고 모든 패널을 기본 순서로 우측 도크에 되돌린다
function resetLayout(app) {
  clearLayout();
  try { localStorage.removeItem("cpe.panelOrder"); localStorage.removeItem(HIDDEN_KEY); } catch { /* 무시 */ }
  const right = document.querySelector('.dock[data-dock="right"]');
  if (!right) return;
  for (const [id] of PANELS) {
    const p = document.getElementById(id);
    if (!p) continue;
    if (isFloating(p)) clearFloating(p);
    p.classList.remove("panel-hidden");
    right.appendChild(p);
  }
  // 목록에 없는(다른 작업자가 추가한) 패널도 우측 도크로 회수
  document.querySelectorAll(".float-layer > .panel, .dock-left > .panel, .dock-bottom > .panel").forEach((p) => {
    if (isFloating(p)) clearFloating(p);
    right.appendChild(p);
  });
  // 도크 크기: 좌/하단은 비었으니 0, 우측은 기본 폭
  const root = document.documentElement.style;
  root.setProperty("--left-w", "0px");
  root.setProperty("--bottom-h", "0px");
  root.setProperty("--right-w", "240px");
  for (const name of ["left", "bottom", "right"]) {
    const d = document.querySelector(`.dock[data-dock="${name}"]`);
    if (d) d.classList.toggle("empty", name !== "right");
    const sp = document.querySelector(".splitter-" + name);
    if (sp) sp.style.display = name === "right" ? "" : "none";
  }
  app.renderer?.resize();
  app.renderer?.requestRender();
  app.status("패널 배치를 초기화했습니다.");
}

// 화면 모드(Fullscreen API)
function setScreenMode(app, full) {
  const d = document;
  if (full) {
    if (d.fullscreenElement) return;
    const p = d.documentElement.requestFullscreen?.();
    if (p?.catch) p.catch(() => app.status("전체 화면으로 전환할 수 없습니다."));
  } else if (d.fullscreenElement) {
    d.exitFullscreen?.();
  }
}

// 단축키용 공개 진입점(지휘자가 app.js _bindGlobalKeys에서 호출)
//   Shift+Ctrl+; = 스냅 토글,  Alt+Ctrl+; = 가이드 잠금 토글
export function toggleSnap(app) {
  const st = app.state;
  ensureSnapState(st);
  st.set("snapEnabled", !st.snapEnabled);
  saveSnapState(st);
  app.status(`스냅: ${st.snapEnabled ? "켬" : "끔"}`);
}
export function toggleGuideLock(app) {
  const locked = app.viewport.toggleGuidesLocked();
  app.status(`가이드 잠금: ${locked ? "켬" : "끔"}`);
}

export default function menus(app) {
  restoreHidden();
  const st = app.state;
  ensureSnapState(st);
  const onOff = (v) => (v ? "켬" : "끔");

  const toggleTarget = (key, label) => () => {
    st.set(key, !st[key]);
    saveSnapState(st);
    app.status(`${label}: ${onOff(st[key])}`);
  };
  const setAllSnap = (v) => () => {
    for (const k of ["snapGuides", "snapGrid", "snapBounds"]) st.set(k, v);
    saveSnapState(st);
    app.status(`스냅 대상: ${v ? "모두" : "없음"}`);
  };

  return {
    "보기": [
      { label: "200%", after: "실제 크기", fn: () => app.viewport.setZoom(2) },
      { label: "픽셀 격자", fn: () => {
        st.set("pixelGrid", !st.pixelGrid);
        app.renderer.requestOverlayRender();
        app.status(`픽셀 격자: ${onOff(st.pixelGrid)}${st.pixelGrid && app.viewport.zoom < 6 ? " (600% 이상 확대 시 표시)" : ""}`);
      } },
      { sep: true },
      { label: "스냅", shortcut: "Shift+Ctrl+;", fn: () => toggleSnap(app) },
      { label: "스냅 대상", sub: [
        { label: "가이드", fn: toggleTarget("snapGuides", "가이드에 스냅") },
        { label: "그리드", fn: toggleTarget("snapGrid", "그리드에 스냅") },
        { label: "문서 경계", fn: toggleTarget("snapBounds", "문서 경계에 스냅") },
        { sep: true },
        { label: "모두", fn: setAllSnap(true) },
        { label: "없음", fn: setAllSnap(false) },
      ] },
      { label: "가이드 잠금", shortcut: "Alt+Ctrl+;", fn: () => toggleGuideLock(app) },
      { sep: true },
      { label: "화면 모드", sub: [
        { label: "표준 화면 모드", fn: () => setScreenMode(app, false) },
        { label: "전체 화면 모드", fn: () => setScreenMode(app, true) },
      ] },
    ],
    "창": [
      ...PANELS.map(([id, name]) => ({ label: name, fn: () => togglePanel(app, id, name) })),
      { sep: true },
      { label: "패널 배치 초기화", fn: () => resetLayout(app) },
    ],
  };
}
