// state.js — 애플리케이션 단일 상태원천(Single Source of Truth)
// 도구 옵션, 색상 등 UI 전역 상태를 보관한다. set()으로 변경하면 EventBus로 통지된다.

import { EVT } from "./constants.js";

export class AppState {
  constructor(bus) {
    this.bus = bus;

    // 활성 도구
    this.activeTool = "brush";

    // 색상 (CSS hex 문자열)
    this.foreground = "#000000";
    this.background = "#ffffff";

    // 브러시/연필/지우개 공통 옵션
    this.brushType = "round";  // round | square | spatter | chalk | calligraphy
    this.brushSize = 14;       // 지름(px)
    this.brushHardness = 0.85; // 0~1 (가장자리 경도, round 전용)
    this.brushOpacity = 1;     // 0~1

    // 페인트 버킷 / 매직완드 허용오차 (0~255)
    this.tolerance = 32;
    this.contiguous = true;    // 인접 영역만(true) / 전체(false)

    // 도형 옵션
    this.shapeType = "rect";   // rect | ellipse | line | polygon | rounded
    this.shapeFill = true;
    this.shapeStroke = false;
    this.shapeStrokeWidth = 3;
    this.polygonSides = 5;      // 정다각형 변 수 (3~12)
    this.cornerRadius = 10;     // 둥근 사각형 모서리 반경(px)

    // 텍스트 옵션
    this.fontSize = 36;
    this.fontFamily = "Malgun Gothic, sans-serif";
    this.fontBold = false;
    this.fontItalic = false;

    // 그라디언트 옵션
    this.gradientType = "linear";        // linear | radial | angle | reflected | diamond
    this.gradientColorMode = "fg-bg";    // fg-bg | fg-transparent
    this.gradientReverse = false;
    this.gradientOpacity = 1;            // 0~1
    this.gradientBlendMode = "normal";

    // 복제 도장(clone-stamp-tool.js)
    this.cloneAligned = true;   // 정렬: stroke 간 소스 오프셋 유지
    this.cloneOpacity = 1;      // 0~1

    // 닷지/번/스펀지(dodge-burn-tool.js)
    this.dodgeBurnMode = "dodge";   // dodge | burn | sponge
    this.dodgeRange = "midtones";   // shadows | midtones | highlights (dodge/burn)
    this.dodgeExposure = 0.5;       // 0~1
    this.spongeSaturate = true;     // sponge: true=채도↑, false=채도↓

    // 흐리게/선명/번짐(blur-sharpen-smudge-tool.js)
    this.retouchMode = "blur";      // blur | sharpen | smudge
    this.retouchStrength = 0.5;     // 0~1

    // 사각형 선택 도구 모드 (marquee-tool.js)
    this.marqueeMode = "rect";  // rect | ellipse | row | col

    // 보기 옵션
    this.pixelGrid = false;    // 고배율에서 픽셀 또렷하게

    // 눈금자/그리드/가이드 (보기 메뉴 §2.7)
    this.showRulers = false;   // 뷰포트 상/좌 눈금자 표시
    this.showGrid = false;     // 문서 위 그리드 오버레이 표시
    this.gridSize = 32;        // 그리드 간격(문서 px)
    this.showGuides = true;    // 가이드 선 표시(가이드가 있을 때)
    this.guides = [];          // [{orient:'h'|'v', pos}] pos=문서 좌표(px)
  }

  // ── 가이드 모델 (selection 모델처럼 메서드로만 조작) ──
  // 수평(h) 가이드는 문서 y좌표, 수직(v) 가이드는 문서 x좌표를 pos로 갖는다.
  addGuide(orient, pos) {
    if (orient !== "h" && orient !== "v") return;
    const p = Math.round(pos);
    if (!Number.isFinite(p)) return;
    // 같은 방향·같은 위치 중복 추가 방지
    if (this.guides.some((g) => g.orient === orient && g.pos === p)) return;
    this.guides.push({ orient, pos: p });
    this.bus.emit(EVT.STATE_CHANGED, { key: "guides", value: this.guides });
  }

  clearGuides() {
    if (this.guides.length === 0) return;
    this.guides = [];
    this.bus.emit(EVT.STATE_CHANGED, { key: "guides", value: this.guides });
  }

  // 값을 바꾸고 변경 이벤트를 발행한다. 동일 값이면 무시.
  set(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    this.bus.emit(EVT.STATE_CHANGED, { key, value });
    if (key === "activeTool") this.bus.emit(EVT.TOOL_CHANGED, { tool: value });
    if (key === "foreground" || key === "background") this.bus.emit(EVT.COLOR_CHANGED, { key, value });
  }

  // 전경/배경색 교환
  swapColors() {
    const fg = this.foreground;
    this.foreground = this.background;
    this.background = fg;
    this.bus.emit(EVT.STATE_CHANGED, { key: "foreground", value: this.foreground });
    this.bus.emit(EVT.COLOR_CHANGED, { key: "swap" });
  }

  // 기본 색(검정/흰색)으로 초기화
  resetColors() {
    this.foreground = "#000000";
    this.background = "#ffffff";
    this.bus.emit(EVT.COLOR_CHANGED, { key: "reset" });
  }
}
