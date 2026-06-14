// notes-tool.js - 노트(주석) 도구. BaseTool 상속.
//
// 동작:
//   - 캔버스 빈 곳 클릭 : 그 지점(문서 좌표)에 새 노트 마커를 만들고 메모 팝업을 즉시 연다.
//   - 기존 마커 클릭/우클릭/드래그 : 마커 엘리먼트(notes-overlay)가 직접 처리. 오버레이 컨테이너는
//     pointer-events:none 이고 마커만 auto 이므로, 마커 위 클릭은 마커가 가로채고 캔버스(=이 도구)는
//     받지 않는다. 빈 곳 클릭만 오버레이를 통과해 캔버스로 전달된다.
//
// 마커와 팝업의 표시/편집/삭제는 NotesOverlay(DOM 오버레이)가 담당하고, 노트 데이터의 보존은
// NotesManager(app.notes)가 담당한다. 이 도구는 빈 곳 클릭으로 새 노트 생성만 책임진다.

import { BaseTool } from "./base-tool.js";

export class NotesTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onActivate() {
    this.app.status("캔버스를 클릭해 노트를 추가하세요. 마커: 클릭=열기, 우클릭=삭제, 드래그=이동");
  }

  onPointerDown(pt, e) {
    if (e && e.button !== 0) return; // 좌클릭만 새 노트
    const mgr = this.app.notes;
    if (!mgr) { this.app.status("노트 매니저가 초기화되지 않았습니다."); return; }
    // 문서 영역 밖 클릭은 무시(노트는 이미지 위 주석)
    const lm = this.app.layers;
    if (lm.width && (pt.x < 0 || pt.y < 0 || pt.x > lm.width || pt.y > lm.height)) return;

    const note = mgr.add(pt.x, pt.y, "");
    // 생성 직후 메모 팝업을 열어 바로 입력할 수 있게 한다.
    this.app.notesOverlay?.openPopup(note.id);
  }
}
