// pen-tool.js — 펜 도구(베지어 패스 그리기). BaseTool 상속.
// 실제 패스 데이터/연산은 app.paths(PathManager)에 위임하고, 이 클래스는 포인터 제스처만 해석한다.
//
// [조작 규칙] (포토샵 펜과 동일한 느낌)
//   - 빈 곳 클릭        : 코너 앵커 추가(직선 연결).
//   - 빈 곳 드래그       : 앵커 추가 + 드래그로 양방향(대칭) 제어 핸들 생성 → 부드러운 곡선.
//   - Alt+드래그        : 핸들 분리(out 핸들만 독립 조정 → 다음 구간만 곡선, 코너 유지).
//   - 시작 앵커 클릭     : 패스 닫기.
//   - 기존 앵커 위 클릭  : 그 앵커 삭제(Alt 없이 단순 클릭). (포토샵의 "포인트 삭제"에 해당)
//   - 더블클릭/Enter/Esc : 현재 패스 작업 종료(열린 채 확정).
//
// 적중 허용 반경은 화면 8px를 월드 단위로 환산해 줌과 무관하게 일정한 클릭감을 준다.

import { BaseTool } from "./base-tool.js";

const HIT_SCREEN_PX = 8; // 앵커/시작점 클릭 허용 반경(화면 px)

export class PenTool extends BaseTool {
  get cursor() { return "crosshair"; }

  get paths() { return this.app.paths; }

  // 화면 px 허용치를 현재 줌 기준 월드 단위로 환산
  _tolWorld() {
    return HIT_SCREEN_PX / (this.app.viewport.zoom || 1);
  }

  onActivate() {
    // 펜 진입 시 미리보기 초기화. 패스는 유지(이어서 편집 가능).
    this.paths.preview = null;
    this._dragging = false;
    this._draggedAnchor = false;
    this.app.renderer.requestRender();
  }

  onDeactivate() {
    // 도구를 떠나면 고무줄/힌트만 정리(패스는 보존).
    this.paths.preview = null;
    this.paths.hoverCloseHint = false;
    this.app.renderer.requestRender();
  }

  onPointerDown(pt, e) {
    const tol = this._tolWorld();
    this._dragging = true;
    this._draggedAnchor = false;
    this._downPt = pt;
    this._alt = e.altKey;

    // 1) 현재 패스의 시작점 클릭 → 닫기
    if (this.paths.isNearStart(pt.x, pt.y, tol)) {
      if (this.paths.closeCurrent()) {
        this.app.status("패스를 닫았습니다.");
        // 닫은 뒤에는 새 앵커를 받지 않도록 드래그 비활성
        this._dragging = false;
        this.paths.preview = null;
      }
      return;
    }

    // 2) 기존 앵커 위 클릭 → 삭제 (단, current 패스에 앵커가 이미 있을 때만 "편집"으로 간주)
    const hit = this.paths.hitAnchor(pt.x, pt.y, tol);
    if (hit && !e.shiftKey) {
      // 클릭(드래그 아님)으로 끝나면 삭제, 드래그면 앵커 이동으로 전환한다.
      this._editHit = hit;
      this._dragging = true;
      this._draggedAnchor = false;
      return;
    }
    this._editHit = null;

    // 3) 새 앵커 추가(코너로 시작). 드래그하면 onPointerMove에서 핸들이 생긴다.
    this.paths.addAnchor(pt.x, pt.y);
  }

  onPointerMove(pt, e) {
    const tol = this._tolWorld();

    if (this._dragging) {
      // (a) 기존 앵커를 잡고 드래그 → 앵커 이동
      if (this._editHit) {
        // 약간이라도 움직이면 이동으로 간주(클릭과 구분)
        const d = Math.hypot(pt.x - this._downPt.x, pt.y - this._downPt.y);
        if (d > tol * 0.4) this._draggedAnchor = true;
        if (this._draggedAnchor) {
          this.paths.moveAnchor(this._editHit.path, this._editHit.index, pt.x, pt.y);
        }
        return;
      }
      // (b) 방금 추가한 앵커에서 드래그 → 제어 핸들 생성
      if (this._alt) this.paths.setLastHandleOutOnly(pt.x, pt.y); // 핸들 분리
      else this.paths.setLastHandle(pt.x, pt.y);                  // 대칭 곡선
      this._draggedAnchor = true;
      return;
    }

    // 드래그 아님 → 고무줄 미리보기 + 시작점 닫기 힌트 갱신
    this._updatePreview(pt);
    this.paths.hoverCloseHint = this.paths.isNearStart(pt.x, pt.y, tol);
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    // 기존 앵커를 "클릭만" 했다면(이동 없음) 삭제
    if (this._editHit && !this._draggedAnchor) {
      this.paths.deleteAnchor(this._editHit.path, this._editHit.index);
      this.app.status("앵커를 삭제했습니다.");
    }
    this._dragging = false;
    this._editHit = null;
    this._draggedAnchor = false;
    // 펜업 후 곧바로 고무줄 미리보기 갱신
    this._updatePreview(pt);
    this.app.renderer.requestRender();
  }

  onLeave() {
    this.paths.preview = null;
    this.paths.hoverCloseHint = false;
    this.app.renderer.requestRender();
  }

  // 마지막 앵커 → 커서 위치 고무줄(곡선) 미리보기 구성
  _updatePreview(pt) {
    const p = this.paths.current;
    if (!p || p.closed || p.anchors.length === 0) { this.paths.preview = null; return; }
    const last = p.anchors[p.anchors.length - 1];
    // last.out 핸들이 있으면 곡선 미리보기의 첫 제어점으로 사용
    const hasOut = !(last.outX === last.x && last.outY === last.y);
    this.paths.preview = {
      type: "segment",
      from: { x: last.x, y: last.y },
      to: { x: pt.x, y: pt.y },
      c1: hasOut ? { x: last.outX, y: last.outY } : null,
    };
  }
}
