// pen-tool.js — 펜 도구(베지어 패스 그리기). BaseTool 상속.
// 실제 패스 데이터/연산은 app.paths(PathManager)에 위임하고, 이 클래스는 포인터 제스처만 해석한다.
//
// [모드] app.state.penMode 로 두 가지 모드를 전환한다(옵션바에서 선택, 기본 "path").
//   - "path"     : 표준 펜(아래 조작 규칙). 클릭/드래그로 앵커·핸들을 정밀하게 찍는다.
//   - "freeform" : 자유곡선 펜. 드래그한 궤적을 따라 패스를 자동 생성한다.
//
// [Path 모드 조작 규칙] (포토샵 펜과 동일한 느낌)
//   - 빈 곳 클릭        : 코너 앵커 추가(직선 연결).
//   - 빈 곳 드래그       : 앵커 추가 + 드래그로 양방향(대칭) 제어 핸들 생성 → 부드러운 곡선.
//   - Alt+드래그        : 핸들 분리(out 핸들만 독립 조정 → 다음 구간만 곡선, 코너 유지).
//   - 시작 앵커 클릭     : 패스 닫기.
//   - 기존 앵커 위 클릭   : 그 앵커 삭제(Alt 없이 단순 클릭). (포토샵의 "포인트 삭제")
//   - 기존 앵커 위 Alt+클릭: Convert Point — 코너↔부드러운 곡선 전환(드래그 없이 클릭만).
//   - 기존 앵커 위 Alt+드래그: Convert Point 후 그 핸들을 직접 끌어 곡률 조정.
//   - 더블클릭/Enter/Esc : 현재 패스 작업 종료(열린 채 확정).
//
// [Freeform 모드 조작]
//   - 드래그            : 누른 지점에서 시작해 궤적을 따라 자유곡선 패스 생성(놓으면 부드럽게 정리).
//   - 시작점 근처에서 놓기 : 패스를 닫는다.
//
// 적중 허용 반경은 화면 8px를 월드 단위로 환산해 줌과 무관하게 일정한 클릭감을 준다.

import { BaseTool } from "./base-tool.js";

const HIT_SCREEN_PX = 8;          // 앵커/시작점 클릭 허용 반경(화면 px)
const FREEFORM_MIN_SCREEN_PX = 4; // Freeform 샘플 간격(화면 px) — 줌 보정해 사용

export class PenTool extends BaseTool {
  get cursor() { return "crosshair"; }

  get paths() { return this.app.paths; }

  // 현재 펜 모드("path" | "freeform"). state 미정의 시 기존 동작("path")으로 폴백.
  get mode() { return this.app.state?.penMode || "path"; }

  // 화면 px 허용치를 현재 줌 기준 월드 단위로 환산
  _tolWorld() {
    return HIT_SCREEN_PX / (this.app.viewport.zoom || 1);
  }

  onActivate() {
    // 펜 진입 시 미리보기 초기화. 패스는 유지(이어서 편집 가능).
    this.paths.preview = null;
    this._dragging = false;
    this._draggedAnchor = false;
    this._freeform = false;
    this.app.renderer.requestRender();
  }

  onDeactivate() {
    // 도구를 떠나면 고무줄/힌트만 정리(패스는 보존).
    this.paths.preview = null;
    this.paths.hoverCloseHint = false;
    this._freeform = false;
    this.app.renderer.requestRender();
  }

  onPointerDown(pt, e) {
    // ── Freeform 모드: 드래그 궤적으로 새 패스를 만든다 ──
    if (this.mode === "freeform") {
      this._freeform = true;
      this._dragging = true;
      this._downPt = pt;
      // 새 패스를 시작하고 첫 코너 앵커를 찍는다(드래그로 점이 누적됨).
      this.paths.startPath();
      this.paths.addAnchor(pt.x, pt.y);
      this.paths.preview = null;
      this.paths.hoverCloseHint = false;
      return;
    }

    // ── Path 모드(표준 펜) ──
    const tol = this._tolWorld();
    this._dragging = true;
    this._draggedAnchor = false;
    this._downPt = pt;
    this._alt = e.altKey;
    this._converted = false;

    // 1) 현재 패스의 시작점 클릭 → 닫기 (단, Alt면 시작점도 Convert Point 대상으로 처리)
    if (!e.altKey && this.paths.isNearStart(pt.x, pt.y, tol)) {
      if (this.paths.closeCurrent()) {
        this.app.status("패스를 닫았습니다.");
        // 닫은 뒤에는 새 앵커를 받지 않도록 드래그 비활성
        this._dragging = false;
        this.paths.preview = null;
      }
      return;
    }

    // 2) 기존 앵커 위 클릭
    const hit = this.paths.hitAnchor(pt.x, pt.y, tol);
    if (hit && !e.shiftKey) {
      this._editHit = hit;
      this._dragging = true;
      this._draggedAnchor = false;
      if (e.altKey) {
        // Alt+앵커 클릭 = Convert Point: 코너↔곡선 즉시 전환.
        // 이어서 드래그하면 onPointerMove에서 그 핸들을 직접 조정한다.
        const becameCorner = this.paths.convertAnchor(hit.path, hit.index);
        this._converted = true;
        this.app.status(becameCorner ? "앵커를 코너로 변환했습니다." : "앵커를 곡선으로 변환했습니다.");
      }
      // Alt 없는 클릭은 onPointerUp에서 (이동 없었으면) 삭제로 처리.
      return;
    }
    this._editHit = null;

    // 3) 새 앵커 추가(코너로 시작). 드래그하면 onPointerMove에서 핸들이 생긴다.
    this.paths.addAnchor(pt.x, pt.y);
  }

  onPointerMove(pt, e) {
    const tol = this._tolWorld();

    // ── Freeform 모드: 드래그 궤적을 따라 앵커 누적 ──
    if (this._freeform) {
      if (!this._dragging) return;
      const minDist = FREEFORM_MIN_SCREEN_PX / (this.app.viewport.zoom || 1);
      this.paths.addFreeformPoint(pt.x, pt.y, minDist);
      // 시작점 근처로 돌아오면 닫기 힌트 표시(앵커가 충분히 쌓였을 때만)
      this.paths.hoverCloseHint =
        this.paths.current?.anchors.length > 2 && this.paths.isNearStart(pt.x, pt.y, tol);
      return;
    }

    // ── Path 모드 ──
    if (this._dragging) {
      // (a) 기존 앵커를 잡고 드래그
      if (this._editHit) {
        const d = Math.hypot(pt.x - this._downPt.x, pt.y - this._downPt.y);
        if (d > tol * 0.4) this._draggedAnchor = true;
        if (this._draggedAnchor) {
          if (this._converted) {
            // Convert Point 직후 드래그 → out 핸들을 직접 끌고 in 핸들은 대칭으로 곡률 조정.
            this.paths.moveHandle(this._editHit.path, this._editHit.index, "out", pt.x, pt.y);
            const a = this._editHit.path.anchors[this._editHit.index];
            this.paths.moveHandle(this._editHit.path, this._editHit.index, "in",
              a.x - (pt.x - a.x), a.y - (pt.y - a.y));
          } else {
            // 일반 앵커 이동(핸들도 함께 따라 이동)
            this.paths.moveAnchor(this._editHit.path, this._editHit.index, pt.x, pt.y);
          }
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
    const tol = this._tolWorld();

    // ── Freeform 모드: 궤적 정리 + (시작점 근처면) 닫기 ──
    if (this._freeform) {
      const cur = this.paths.current;
      if (cur) {
        // 시작점 근처에서 놓고 앵커가 충분하면 닫는다.
        if (cur.anchors.length > 2 && this.paths.isNearStart(pt.x, pt.y, tol)) {
          cur.closed = true;
        }
        this.paths.finishFreeform(cur);
        // 점이 사실상 1개뿐이면(클릭만 한 경우) 빈 패스로 남지 않게 제거.
        if (cur.anchors.length < 2) this.paths.removePath(cur);
        else this.app.status(cur.closed ? "자유곡선 패스를 닫았습니다." : "자유곡선 패스를 만들었습니다.");
      }
      this._freeform = false;
      this._dragging = false;
      this.paths.hoverCloseHint = false;
      this.paths.preview = null;
      this.app.renderer.requestRender();
      return;
    }

    // ── Path 모드 ──
    // 기존 앵커를 "클릭만" 했고(이동 없음) Alt가 아니면 삭제. (Alt 클릭은 Convert Point였음)
    if (this._editHit && !this._draggedAnchor && !this._converted) {
      this.paths.deleteAnchor(this._editHit.path, this._editHit.index);
      this.app.status("앵커를 삭제했습니다.");
    }
    this._dragging = false;
    this._editHit = null;
    this._draggedAnchor = false;
    this._converted = false;
    // 펜업 후 곧바로 고무줄 미리보기 갱신
    this._updatePreview(pt);
    this.app.renderer.requestRender();
  }

  onLeave() {
    this.paths.preview = null;
    this.paths.hoverCloseHint = false;
    this.app.renderer.requestRender();
  }

  // 마지막 앵커 → 커서 위치 고무줄(곡선) 미리보기 구성 (Freeform/드래그 중엔 표시 안 함)
  _updatePreview(pt) {
    if (this.mode === "freeform") { this.paths.preview = null; return; }
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
