// guides.js — 가이드 상호작용(눈금자에서 끌어 생성 / 이동 도구로 끌어 이동 / 캔버스 밖으로 끌면 삭제).
// 렌더러가 생성한다. 뷰포트 컨테이너에 캡처 단계 pointerdown을 걸어 도구 관리자(tool-manager)보다
// 먼저 판정하고, 가이드 드래그로 처리하는 경우에만 이벤트 전파를 막는다(그 외엔 도구가 그대로 받음).
// 가이드 모델은 state.guides([{orient:'h'|'v', pos}])를 그대로 쓴다(h=수평선=문서 y, v=수직선=문서 x).
// 잠금(state.guidesLocked)이면 기존 가이드는 잡히지 않는다(이동 도구는 레이어를 옮김). 새 가이드 생성은 허용.

import { EVT, TOOL } from "../core/constants.js";
import { RULER_SIZE } from "./renderer.js";
import { snapAxis, snapThreshold, snapTargetsFromApp, ensureSnapState } from "./snap.js";

const HIT_PX = 4;   // 가이드 잡기 판정 거리(화면 px)

export class GuideController {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.drag = null;          // { guide, isNew } — 드래그 중인 가이드
    this._cursorSet = false;   // 호버 커서를 우리가 바꿨는지(원복 판단용)
    ensureSnapState(app.state);

    const host = canvas.parentElement || canvas;
    host.addEventListener("pointerdown", (e) => this._onDown(e), true);
    host.addEventListener("pointermove", (e) => this._onHover(e), true);
    window.addEventListener("pointermove", (e) => this._onMove(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    window.addEventListener("pointercancel", (e) => this._onUp(e, true));
  }

  // 캔버스 기준 화면 좌표 + 캔버스 안 여부
  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height };
  }

  // 눈금자 띠 판정: "top" | "left" | "corner" | null
  _rulerAt(p) {
    if (!this.app.state.showRulers) return null;
    const R = RULER_SIZE;
    if (p.x < R && p.y < R) return "corner";
    if (p.y < R) return "top";
    if (p.x < R) return "left";
    return null;
  }

  // 기존 가이드 이동이 가능한 상황인가(이동 도구 + 가이드 표시 + 잠금 해제)
  _canMoveGuides() {
    const st = this.app.state;
    return st.showGuides && st.guides?.length > 0 && !st.guidesLocked && this.app.tools?.activeId === TOOL.MOVE;
  }

  // 화면 좌표 근처(HIT_PX)의 가이드. 여러 개면 가장 가까운 것.
  _hit(sx, sy) {
    const vp = this.app.viewport;
    let best = null, bestD = HIT_PX + 0.001;
    for (const g of this.app.state.guides || []) {
      const s = vp.worldToScreen(g.pos, g.pos);
      const d = g.orient === "h" ? Math.abs(s.y - sy) : Math.abs(s.x - sx);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  _onDown(e) {
    if (e.button !== 0 || e.target !== this.canvas) return;
    if (this.app.tools?._space) return; // 스페이스 임시 팬 우선
    const st = this.app.state;
    const p = this._local(e);
    const ruler = this._rulerAt(p);
    let guide = null, isNew = false;

    if (ruler === "top" || ruler === "left") {
      // 상단 눈금자 → 수평 가이드, 좌측 눈금자 → 수직 가이드
      guide = { orient: ruler === "top" ? "h" : "v", pos: 0 };
      isNew = true;
      if (!Array.isArray(st.guides)) st.guides = [];
      st.guides.push(guide);
      if (!st.showGuides) st.set("showGuides", true);
    } else if (ruler === "corner") {
      // 모서리 클릭은 아무 동작 없음(아래 도구로 넘기지도 않는다)
      e.stopPropagation(); e.preventDefault();
      return;
    } else if (this._canMoveGuides()) {
      guide = this._hit(p.x, p.y);
    }
    if (!guide) return;

    e.stopPropagation();
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    this.drag = { guide, isNew };
    this.canvas.style.cursor = guide.orient === "h" ? "ns-resize" : "ew-resize";
    this._cursorSet = true;
    this._place(p, e);
  }

  // 드래그 중 가이드 위치 갱신(스냅 적용, 정수 px)
  _place(p, e) {
    const d = this.drag;
    if (!d) return;
    const vp = this.app.viewport;
    const w = vp.screenToWorld(p.x, p.y);
    let pos = d.guide.orient === "h" ? w.y : w.x;
    const targets = snapTargetsFromApp(this.app, { exclude: d.guide });
    if (targets && !e?.altKey) {
      const s = snapAxis([pos], d.guide.orient === "h" ? targets.y : targets.x, snapThreshold(vp.zoom));
      if (s) pos = s.target;
    }
    d.guide.pos = Math.round(pos);
    this.app.status(`${d.guide.orient === "h" ? "수평" : "수직"} 가이드: ${d.guide.pos}px`);
    this.app.renderer.requestOverlayRender();
  }

  _onMove(e) {
    if (!this.drag) return;
    this._place(this._local(e), e);
  }

  _onUp(e, cancelled = false) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { this.canvas.releasePointerCapture?.(e.pointerId); } catch { /* 무시 */ }
    const st = this.app.state;
    const p = this._local(e);
    const ruler = this._rulerAt(p);
    // 캔버스(뷰포트) 밖이나 같은 방향 눈금자 위에 놓으면 삭제. 새로 끌던 가이드가 취소되면 역시 제거.
    const out = !p.inside
      || (d.guide.orient === "h" && (ruler === "top" || ruler === "corner"))
      || (d.guide.orient === "v" && (ruler === "left" || ruler === "corner"));
    const dup = st.guides.some((g) => g !== d.guide && g.orient === d.guide.orient && g.pos === d.guide.pos);
    if (out || dup || (cancelled && d.isNew)) {
      const i = st.guides.indexOf(d.guide);
      if (i >= 0) st.guides.splice(i, 1);
      if (out && !d.isNew) this.app.status("가이드를 삭제했습니다.");
      else if (out || cancelled) this.app.status("");
    }
    this.app.bus.emit(EVT.STATE_CHANGED, { key: "guides", value: st.guides });
    this._restoreCursor();
    this.app.renderer.requestOverlayRender();
  }

  // 호버: 이동 가능한 가이드 위/눈금자 위에서 커서 변경(도구 커서는 벗어나면 원복)
  _onHover(e) {
    if (this.drag || e.buttons) return;
    if (e.target !== this.canvas) return;
    const p = this._local(e);
    let cur = null;
    if (this._rulerAt(p)) cur = "default";
    else if (this._canMoveGuides()) {
      const g = this._hit(p.x, p.y);
      if (g) cur = g.orient === "h" ? "ns-resize" : "ew-resize";
    }
    if (cur) {
      if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
      this._cursorSet = true;
    } else if (this._cursorSet) {
      this._restoreCursor();
    }
  }

  _restoreCursor() {
    if (!this._cursorSet) return;
    this._cursorSet = false;
    const tm = this.app.tools;
    if (tm?._applyCursor) tm._applyCursor();
    else this.canvas.style.cursor = "";
  }
}
