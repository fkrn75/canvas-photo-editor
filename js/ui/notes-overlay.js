// notes-overlay.js — 노트 마커와 메모 팝업을 DOM 오버레이로 렌더한다.
//
// [설계 의도]
//   노트는 클릭/텍스트 편집 등 상호작용이 핵심이라 캔버스 drawOverlay 대신 DOM 오버레이로 그린다
//   (text-tool의 #text-overlay 패턴 계승). 마커/팝업은 문서 좌표를 viewport.worldToScreen 으로
//   화면 좌표에 배치하고, 줌/팬/리사이즈가 바뀔 때마다 재배치한다.
//
// [상호작용]
//   - 마커 클릭        : 메모 팝업 열기/토글(편집 가능 textarea).
//   - 마커 우클릭      : 그 노트 삭제(확인 없이 즉시 — 비파괴 메타라 undo 대신 재작성).
//   - 마커 드래그      : 앵커 위치 이동.
//   - 팝업 textarea    : 입력 → notes-manager.setText 로 저장(blur/입력 시).
//   - 팝업 삭제 버튼   : 노트 삭제. 닫기 버튼: 팝업만 닫기.
//
// [컨테이너] #notes-overlay 는 pointer-events:none(캔버스 조작 방해 금지), 마커/팝업만 auto.

import { EVT } from "../core/constants.js";

export class NotesOverlay {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById("notes-overlay");
    this.markers = new Map(); // id -> 마커 엘리먼트
    this.popup = null;        // 현재 열린 팝업 엘리먼트
    this.popupId = null;      // 팝업이 가리키는 노트 id
    this._drag = null;        // 드래그 상태 {id, moved, pointerId}

    // 노트 변경 통지 처리:
    //   op "value"(이동/텍스트)는 위치만 갱신(드래그/입력 중 마커 재생성 방지),
    //   그 외(추가/삭제)는 마커 재구성. 뷰포트 변경은 위치만 재배치.
    app.bus.on(EVT.STATE_CHANGED, ({ key, op }) => {
      if (key !== "notes") return;
      if (op === "value") this.reposition();
      else this.rebuild();
    });
    app.bus.on(EVT.VIEWPORT_CHANGED, () => this.reposition());

    if (this.root) this.rebuild();
  }

  get manager() { return this.app.notes; }

  // 마커 전부 다시 생성(노트 추가/삭제/일괄 변경 시). 열린 팝업은 노트가 살아있으면 유지.
  rebuild() {
    if (!this.root) return;
    const notes = this.manager?.notes || [];
    const live = new Set(notes.map((n) => n.id));

    // 사라진 노트의 마커 제거
    for (const [id, el] of this.markers) {
      if (!live.has(id)) { el.remove(); this.markers.delete(id); }
    }
    // 새 노트의 마커 생성
    for (const n of notes) {
      if (!this.markers.has(n.id)) this.markers.set(n.id, this._createMarker(n));
    }
    // 팝업이 가리키던 노트가 사라졌으면 팝업도 닫기
    if (this.popupId != null && !live.has(this.popupId)) this.closePopup();

    this.reposition();
  }

  // 모든 마커/팝업을 현재 줌·팬에 맞춰 화면 좌표로 재배치.
  reposition() {
    if (!this.root) return;
    const vp = this.app.viewport;
    for (const [id, el] of this.markers) {
      const n = this.manager?.get(id);
      if (!n) continue;
      const s = vp.worldToScreen(n.x, n.y);
      el.style.left = s.x + "px";
      el.style.top = s.y + "px";
    }
    if (this.popup && this.popupId != null) {
      const n = this.manager?.get(this.popupId);
      if (n) {
        const s = vp.worldToScreen(n.x, n.y);
        this.popup.style.left = (s.x + 14) + "px";  // 마커 오른쪽 옆
        this.popup.style.top = (s.y + 14) + "px";
      }
    }
  }

  // ── 마커 생성 ──
  _createMarker(note) {
    const el = document.createElement("button");
    el.className = "note-marker";
    el.type = "button";
    el.title = "노트 (클릭=열기, 우클릭=삭제, 드래그=이동)";
    // 작은 말풍선 아이콘(인라인 SVG, currentColor)
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>`;

    // 클릭=팝업 토글(드래그였으면 무시)
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._drag && this._drag.moved) return;
      this.togglePopup(note.id);
    });
    // 우클릭=삭제
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      this.manager?.remove(note.id);
    });
    // 드래그=이동
    el.addEventListener("pointerdown", (e) => this._onMarkerDown(e, note.id));

    this.root.appendChild(el);
    return el;
  }

  // ── 마커 드래그 이동 ──
  _onMarkerDown(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = this.markers.get(id);
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    this._drag = { id, moved: false, pointerId: e.pointerId };

    const onMove = (ev) => {
      if (!this._drag) return;
      this._drag.moved = true;
      const r = this.root.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const w = this.app.viewport.screenToWorld(sx, sy);
      this.manager?.move(id, w.x, w.y); // move 가 reposition 트리거(STATE_CHANGED)
    };
    const onUp = (ev) => {
      el.releasePointerCapture?.(this._drag?.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // 클릭 핸들러가 직후 실행되므로 moved 플래그를 잠깐 유지했다가 해제
      const wasMoved = this._drag?.moved;
      setTimeout(() => { this._drag = null; }, 0);
      if (!wasMoved) { /* 단순 클릭 → click 이벤트가 팝업 토글 */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── 팝업 ──
  togglePopup(id) {
    if (this.popupId === id && this.popup) { this.closePopup(); return; }
    this.openPopup(id);
  }

  openPopup(id) {
    this.closePopup();
    const n = this.manager?.get(id);
    if (!n || !this.root) return;

    const box = document.createElement("div");
    box.className = "note-popup";

    // 헤더(작성자/시간 + 닫기·삭제 버튼)
    const head = document.createElement("div");
    head.className = "note-popup-head";
    const title = document.createElement("span");
    title.className = "note-popup-title";
    title.textContent = n.author ? `메모 · ${n.author}` : "메모";
    const btnDel = document.createElement("button");
    btnDel.type = "button"; btnDel.className = "note-popup-del"; btnDel.title = "노트 삭제";
    btnDel.textContent = "🗑";
    btnDel.addEventListener("click", (e) => { e.stopPropagation(); this.manager?.remove(id); });
    const btnClose = document.createElement("button");
    btnClose.type = "button"; btnClose.className = "note-popup-close"; btnClose.title = "닫기";
    btnClose.textContent = "✕";
    btnClose.addEventListener("click", (e) => { e.stopPropagation(); this.closePopup(); });
    head.appendChild(title); head.appendChild(btnDel); head.appendChild(btnClose);

    // 본문 textarea
    const ta = document.createElement("textarea");
    ta.className = "note-popup-text";
    ta.value = n.text || "";
    ta.placeholder = "메모를 입력하세요...";
    ta.spellcheck = false;
    // 입력 즉시 저장(라이브). Esc=닫기. 단축키 충돌 방지 위해 stopPropagation.
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); ta.blur(); this.closePopup(); }
    });
    ta.addEventListener("input", () => { this.manager?.setText(id, ta.value); });
    // 팝업 내부 포인터가 캔버스로 전파되지 않도록
    box.addEventListener("pointerdown", (e) => e.stopPropagation());

    box.appendChild(head);
    box.appendChild(ta);
    this.root.appendChild(box);
    this.popup = box;
    this.popupId = id;
    this.reposition();
    setTimeout(() => ta.focus(), 0);
  }

  closePopup() {
    if (this.popup) { this.popup.remove(); this.popup = null; }
    this.popupId = null;
  }
}
