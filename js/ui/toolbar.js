// toolbar.js — 좌측 도구 버튼들. 클릭/단축키로 도구 전환, 활성 도구 하이라이트.

import { TOOL, EVT } from "../core/constants.js";

// 도구 아이콘 (인라인 SVG, currentColor 사용)
const ICONS = {
  [TOOL.MOVE]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>`,
  [TOOL.MARQUEE]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>`,
  [TOOL.LASSO]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 11c0-4 4-7 8-7s8 3 8 7-4 6-8 6c-1.5 0-2 1-1.5 2.2A2 2 0 1 1 7 19"/></svg>`,
  [TOOL.WAND]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1.4 1.4M19.4 7.4L18 6M6 20L17 9"/></svg>`,
  [TOOL.BRUSH]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3.5 0 5-1.5 5-4 0-1.7-1.3-3-3-3s-3 1.3-3 3c0 1.5 0 4 1 4z"/><path d="M8.5 14.5L20 4"/></svg>`,
  [TOOL.PENCIL]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 21l4-1L20 7l-3-3L4 17z"/><path d="M14 6l3 3"/></svg>`,
  [TOOL.ERASER]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 14.5l6-6 8 8-3.5 3.5H8z"/><path d="M11 21h9"/></svg>`,
  [TOOL.BUCKET]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 11l7-7 7 7-7 7z"/><path d="M19 14c1 1.6 2 2.6 2 3.6a2 2 0 1 1-4 0c0-1 1-2 2-3.6z"/></svg>`,
  [TOOL.GRADIENT]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 5h9v14H3z" fill="currentColor" stroke="none" opacity="0.45"/></svg>`,
  [TOOL.EYEDROPPER]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21l8-8M11 11l2 2M13.5 7.5l4 4 2.3-2.3a2 2 0 0 0-2.8-2.8z"/></svg>`,
  [TOOL.SHAPE]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>`,
  [TOOL.TEXT]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5h14M12 5v14M9 19h6"/></svg>`,
  [TOOL.HAND]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V5.5a1.5 1.5 0 0 1 3 0V12M16 8.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7S7 19 5.5 16.5L4 14a1.5 1.5 0 0 1 2.6-1.5L7.5 14"/></svg>`,
  [TOOL.ZOOM]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>`,
  [TOOL.CLONE]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6v3H9z"/><path d="M8 7h8v3H8z"/><path d="M12 10v7"/><circle cx="12" cy="19" r="2"/></svg>`,
  [TOOL.DODGEBURN]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></svg>`,
  [TOOL.RETOUCH]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/></svg>`,
  [TOOL.PEN]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3.5l5 5L9 20l-5 1 1-5z"/><path d="M13.5 5.5l5 5"/><circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  [TOOL.HISTORYBRUSH]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>`,
  [TOOL.PATTERNSTAMP]: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M13 3h8v8h-8zM3 13h8v8H3z" fill="currentColor" stroke="none" opacity="0.3"/></svg>`,
};

const LAYOUT = [
  { id: TOOL.MOVE, name: "이동 (V)" },
  { id: TOOL.MARQUEE, name: "사각형 선택 (M)" },
  { id: TOOL.LASSO, name: "올가미 (L)" },
  { id: TOOL.WAND, name: "매직완드 (W)" },
  { id: TOOL.BRUSH, name: "브러시 (B)" },
  { id: TOOL.PENCIL, name: "연필 (N)" },
  { id: TOOL.ERASER, name: "지우개 (E)" },
  { id: TOOL.BUCKET, name: "페인트 버킷 (G)" },
  { id: TOOL.GRADIENT, name: "그라디언트 (G)" },
  { id: TOOL.EYEDROPPER, name: "스포이드 (I)" },
  { id: TOOL.SHAPE, name: "도형 (U)" },
  { id: TOOL.TEXT, name: "텍스트 (T)" },
  { id: TOOL.HAND, name: "손 (H)" },
  { id: TOOL.ZOOM, name: "돋보기 (Z)" },
  { id: TOOL.CLONE, name: "복제 도장 (S)" },
  { id: TOOL.DODGEBURN, name: "닷지/번/스펀지 (O)" },
  { id: TOOL.RETOUCH, name: "흐리게/선명/번짐 (R)" },
  { id: TOOL.PEN, name: "펜 (P)" },
  { id: TOOL.HISTORYBRUSH, name: "히스토리 브러시 (J)" },
  { id: TOOL.PATTERNSTAMP, name: "패턴 도장 (Y)" },
];

export class Toolbar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.btns = {};
    this._build();
    app.bus.on(EVT.TOOL_CHANGED, () => this._sync());
  }

  _build() {
    this.el.innerHTML = "";
    for (const t of LAYOUT) {
      const b = document.createElement("button");
      b.className = "tool-btn";
      b.title = t.name;
      b.innerHTML = ICONS[t.id] || "";
      b.addEventListener("click", () => this.app.tools.setTool(t.id));
      this.el.appendChild(b);
      this.btns[t.id] = b;
    }
    this._sync();
  }

  _sync() {
    const cur = this.app.tools.activeId;
    for (const id in this.btns) this.btns[id].classList.toggle("active", id === cur);
  }
}
