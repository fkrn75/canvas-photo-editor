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
    this.shapeType = "rect";   // rect | ellipse | line
    this.shapeFill = true;
    this.shapeStroke = false;
    this.shapeStrokeWidth = 3;

    // 텍스트 옵션
    this.fontSize = 36;
    this.fontFamily = "Malgun Gothic, sans-serif";
    this.fontBold = false;
    this.fontItalic = false;

    // 보기 옵션
    this.pixelGrid = false;    // 고배율에서 픽셀 또렷하게
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
