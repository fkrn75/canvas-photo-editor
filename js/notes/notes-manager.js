// notes-manager.js — 노트(주석) 모델과 영속을 담당.
//
// [설계 의도]
//   PS의 "메모 도구(Notes)"처럼 이미지에 비파괴 주석을 남긴다. 노트는 픽셀 레이어가 아니라
//   문서 전역의 메타데이터이므로, text-layer가 layer.vectorText 를 동적 프로퍼티로 붙이듯
//   여기서는 app.state.notes 배열을 단일 출처로 사용한다(공유 state.js에 배선됨).
//
//   이 매니저는 노트 배열의 CRUD만 책임지고, 변경 시 EVT.STATE_CHANGED(key:"notes")를 발행한다.
//   오버레이(notes-overlay.js)와 도구(notes-tool.js)는 이 매니저를 통해서만 노트를 조작한다.
//
// [좌표계] note.x / note.y 는 문서(월드) 좌표의 마커 위치(앵커점).
//
// [영속] 노트 배열은 app.state.notes 에 살아있으므로 문서 세션 동안 보존된다.
//   (파일 저장/불러오기 포맷 연동은 추후 file-io 측 합의 후 확장 — 지금은 세션 내 보존만.)

import { EVT } from "../core/constants.js";

let _seq = 1; // 노트 id 시퀀스(세션 내 고유)

export class NotesManager {
  constructor(app) {
    this.app = app;
    // state.notes 가 아직 배선되지 않았어도 안전하게 동작하도록 lazy-init.
    if (!Array.isArray(this.app.state.notes)) this.app.state.notes = [];
  }

  // 현재 노트 배열(읽기용). 직접 수정하지 말고 아래 메서드를 사용할 것.
  get notes() {
    if (!Array.isArray(this.app.state.notes)) this.app.state.notes = [];
    return this.app.state.notes;
  }

  // 새 노트를 (문서좌표 x,y)에 추가하고 그 노트 객체를 반환.
  add(x, y, text = "") {
    const note = {
      id: _seq++,
      x: Math.round(x),
      y: Math.round(y),
      text: text || "",
      author: this.app.noteAuthor || "",   // 작성자(선택). app 차원 기본값이 있으면 사용.
      createdAt: Date.now(),
    };
    this.notes.push(note);
    this._changed("structure");
    return note;
  }

  // id로 노트 찾기(없으면 null).
  get(id) {
    return this.notes.find((n) => n.id === id) || null;
  }

  // 노트 본문 텍스트 갱신. 변경이 있으면 true.
  setText(id, text) {
    const n = this.get(id);
    if (!n) return false;
    const t = text || "";
    if (n.text === t) return false;
    n.text = t;
    this._changed("value");
    return true;
  }

  // 노트 앵커 위치 이동(드래그 등). 변경이 있으면 true.
  move(id, x, y) {
    const n = this.get(id);
    if (!n) return false;
    const nx = Math.round(x), ny = Math.round(y);
    if (n.x === nx && n.y === ny) return false;
    n.x = nx; n.y = ny;
    this._changed("value");
    return true;
  }

  // 노트 삭제. 삭제했으면 true.
  remove(id) {
    const arr = this.notes;
    const i = arr.findIndex((n) => n.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    this._changed("structure");
    return true;
  }

  // 모든 노트 삭제.
  clear() {
    if (this.notes.length === 0) return;
    this.app.state.notes = [];
    this._changed("structure");
  }

  // 변경 통지 — 오버레이/패널이 구독해 갱신한다.
  // op: "structure"(추가/삭제 → 마커 재구성 필요) | "value"(이동/텍스트 → 위치만 갱신).
  _changed(op = "structure") {
    this.app.bus.emit(EVT.STATE_CHANGED, { key: "notes", op, value: this.app.state.notes });
  }
}
