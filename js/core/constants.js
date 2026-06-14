// constants.js — 전역 상수: 이벤트명, 도구 ID, 기본값
// 모든 모듈이 문자열 리터럴 대신 이 상수를 import 해서 오타로 인한 버그를 막는다.

// EventBus 이벤트명
export const EVT = {
  STATE_CHANGED: "state:changed",          // AppState의 임의 키 변경 {key, value}
  TOOL_CHANGED: "tool:changed",            // 활성 도구 변경 {tool}
  COLOR_CHANGED: "color:changed",          // 전경/배경색 변경
  LAYERS_CHANGED: "layers:changed",        // 레이어 추가/삭제/순서/속성 변경
  ACTIVE_LAYER_CHANGED: "layer:active",    // 활성 레이어 변경
  DOCUMENT_CHANGED: "document:changed",    // 문서 크기 변경 (resize/crop 등)
  HISTORY_CHANGED: "history:changed",      // undo/redo 스택 변경
  SELECTION_CHANGED: "selection:changed",  // 선택 영역 변경
  VIEWPORT_CHANGED: "viewport:changed",    // 줌/팬 변경
  RENDER_REQUEST: "render:request",        // 재합성 요청 (dirty)
  CURSOR_INFO: "cursor:info",              // 상태바 좌표 표시 {x, y}
  STATUS_MSG: "status:msg",                // 상태바 메시지 {text}
  IMAGE_STORED: "image:stored",            // File Browser(IndexedDB)에 이미지 저장됨 — 패널 갱신 신호
};

// 도구 ID
export const TOOL = {
  MOVE: "move",
  MARQUEE: "marquee",
  LASSO: "lasso",
  WAND: "wand",
  BRUSH: "brush",
  PENCIL: "pencil",
  ERASER: "eraser",
  BUCKET: "bucket",
  GRADIENT: "gradient",
  EYEDROPPER: "eyedropper",
  SHAPE: "shape",
  TEXT: "text",
  HAND: "hand",
  ZOOM: "zoom",
  CLONE: "clone",
  DODGEBURN: "dodgeburn",
  RETOUCH: "retouch",
  PEN: "pen",
  HISTORYBRUSH: "historybrush",
  PATTERNSTAMP: "patternstamp",
  SHAPELAYER: "shapelayer",
  HEALING: "healing",
  PATCH: "patch",
  ARTHISTORY: "arthistory",
  COLORSAMPLER: "colorsampler",
  MEASURE: "measure",
  NOTES: "notes",
};

// 도형 종류
export const SHAPE = { RECT: "rect", ELLIPSE: "ellipse", LINE: "line", POLYGON: "polygon", ROUNDED_RECT: "rounded" };

// 새 문서 기본 크기
export const DEFAULT_DOC = { width: 800, height: 600 };

// 줌 한계
export const ZOOM = { MIN: 0.05, MAX: 32, STEP: 1.25 };

// undo 히스토리 메모리 한계 (바이트) / 최대 단계 수
export const HISTORY_LIMIT = { bytes: 256 * 1024 * 1024, steps: 50 };
