// tool-presets.js — 도구 프리셋 저장/로드/적용 로직.
// "현재 활성 도구의 옵션 묶음"을 이름 붙여 저장하고, 목록에서 골라 일괄 복원한다.
// 도구별로 어떤 state 키를 프리셋에 담을지(PRESET_KEYS)를 단일 출처로 관리한다.
// 영속은 localStorage 키 "ps7_tool_presets"로 한다(swatches-panel.js의 영속 패턴을 차용).
//
// 저장 형식(localStorage): 도구ID → 프리셋 배열
//   { brush: [ { name, values:{brushSize, ...} }, ... ], gradient: [ ... ], ... }
// 값은 state에서 읽은 원시값(숫자/불리언/문자열)만 담는다. patterns 같은 캔버스 객체는 절대 담지 않는다.

import { TOOL } from "../core/constants.js";

const STORAGE_KEY = "ps7_tool_presets";

// 도구별로 프리셋에 담을 state 키 목록.
// 출처: options-bar.js가 각 도구에서 실제로 렌더하는 컨트롤의 state 키.
// (눈금자/그리드처럼 도구와 무관한 보기 옵션, historyBrushSource/patternIndex 같은
//  문서·세션 의존 인덱스는 신중히 제외/포함한다. 아래 주석 참고.)
export const PRESET_KEYS = {
  [TOOL.BRUSH]:        ["brushType", "brushSize", "brushHardness", "brushOpacity"],
  [TOOL.PENCIL]:       ["brushSize"],
  [TOOL.ERASER]:       ["brushSize", "brushHardness", "brushOpacity"],
  [TOOL.BUCKET]:       ["tolerance", "brushOpacity", "contiguous"],
  [TOOL.GRADIENT]:     ["gradientType", "gradientColorMode", "gradientOpacity", "gradientReverse"],
  [TOOL.WAND]:         ["tolerance", "contiguous"],
  [TOOL.SHAPE]:        ["shapeType", "shapeFill", "shapeStroke", "shapeStrokeWidth", "polygonSides", "cornerRadius"],
  [TOOL.SHAPELAYER]:   ["shapeType", "shapeFill", "shapeStroke", "shapeStrokeWidth", "polygonSides", "cornerRadius"],
  [TOOL.TEXT]:         ["fontSize", "fontFamily", "fontBold", "fontItalic"],
  [TOOL.CLONE]:        ["brushSize", "brushHardness", "cloneOpacity", "cloneAligned"],
  [TOOL.DODGEBURN]:    ["dodgeBurnMode", "brushSize", "brushHardness", "dodgeExposure", "dodgeRange", "spongeSaturate"],
  [TOOL.RETOUCH]:      ["retouchMode", "brushSize", "brushHardness", "retouchStrength"],
  [TOOL.HEALING]:      ["brushSize", "brushHardness", "healOpacity", "healAligned"],
  // 히스토리 브러시: historyBrushSource는 "스냅샷 인덱스"라 세션마다 의미가 달라지므로 제외.
  [TOOL.HISTORYBRUSH]: ["brushSize", "brushHardness", "brushOpacity"],
  // 패턴 도장: patternIndex는 patterns 배열 순서에 의존하지만 기본 패턴은 항상 같은 순서로
  //   생성되므로(buildDefaultPatterns) 인덱스 복원이 합리적이다. 범위를 벗어나면 적용 시 무시한다.
  [TOOL.PATTERNSTAMP]: ["brushSize", "brushHardness", "patternOpacity", "patternAligned", "patternIndex"],
};

// 옵션이 없는(프리셋 의미가 없는) 도구: move/marquee/lasso/eyedropper/hand/zoom/pen/patch.
// → PRESET_KEYS에 키가 없으면 "이 도구는 프리셋 미지원"으로 본다.

// 도구 표시 이름(프리셋 그룹 헤더용). options-bar.js의 라벨과 결이 맞도록 한국어로.
export const TOOL_LABELS = {
  [TOOL.BRUSH]: "브러시",
  [TOOL.PENCIL]: "연필",
  [TOOL.ERASER]: "지우개",
  [TOOL.BUCKET]: "페인트 버킷",
  [TOOL.GRADIENT]: "그라디언트",
  [TOOL.WAND]: "자동 선택",
  [TOOL.SHAPE]: "도형",
  [TOOL.SHAPELAYER]: "셰이프 레이어",
  [TOOL.TEXT]: "텍스트",
  [TOOL.CLONE]: "복제 도장",
  [TOOL.DODGEBURN]: "닷지/번",
  [TOOL.RETOUCH]: "흐리게/선명/번짐",
  [TOOL.HEALING]: "복구 브러시",
  [TOOL.HISTORYBRUSH]: "히스토리 브러시",
  [TOOL.PATTERNSTAMP]: "패턴 도장",
};

// 기본 내장 프리셋(처음 실행 시 보이는 예시). 값은 state.js의 기본값 범위를 따른다.
// 사용자가 삭제·추가하면 그 결과가 localStorage에 저장되어 다음부터는 사용자 버전이 우선한다.
function buildDefaultPresets() {
  return {
    [TOOL.BRUSH]: [
      { name: "소프트 라운드", values: { brushType: "round", brushSize: 30, brushHardness: 0.2, brushOpacity: 1 } },
      { name: "하드 라운드", values: { brushType: "round", brushSize: 14, brushHardness: 0.95, brushOpacity: 1 } },
      { name: "분필 텍스처", values: { brushType: "chalk", brushSize: 40, brushHardness: 0.6, brushOpacity: 0.9 } },
      { name: "캘리그래피", values: { brushType: "calligraphy", brushSize: 28, brushHardness: 0.85, brushOpacity: 1 } },
    ],
    [TOOL.ERASER]: [
      { name: "소프트 지우개", values: { brushSize: 50, brushHardness: 0.1, brushOpacity: 1 } },
    ],
    [TOOL.GRADIENT]: [
      { name: "선형 전경→배경", values: { gradientType: "linear", gradientColorMode: "fg-bg", gradientOpacity: 1, gradientReverse: false } },
      { name: "방사형 전경→투명", values: { gradientType: "radial", gradientColorMode: "fg-transparent", gradientOpacity: 1, gradientReverse: false } },
    ],
    [TOOL.TEXT]: [
      { name: "제목(맑은고딕 굵게)", values: { fontSize: 72, fontFamily: "Malgun Gothic, sans-serif", fontBold: true, fontItalic: false } },
      { name: "본문", values: { fontSize: 18, fontFamily: "Malgun Gothic, sans-serif", fontBold: false, fontItalic: false } },
    ],
  };
}

export class ToolPresets {
  constructor(app) {
    this.app = app;
    this.store = this._load();
  }

  // ── 영속 ──
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          return this._sanitize(obj);
        }
      }
    } catch { /* 파싱 실패 시 기본 프리셋 사용 */ }
    return buildDefaultPresets();
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store)); }
    catch { /* 용량 초과 등은 무시(프리셋은 부가 기능) */ }
  }

  // 저장값을 신뢰하지 않고 형식만 통과시킨다(외부에서 손상된 JSON 방어).
  _sanitize(obj) {
    const out = {};
    for (const toolId of Object.keys(obj)) {
      if (!PRESET_KEYS[toolId]) continue;            // 모르는 도구는 버림
      const arr = obj[toolId];
      if (!Array.isArray(arr)) continue;
      const clean = [];
      for (const p of arr) {
        if (!p || typeof p.name !== "string" || typeof p.values !== "object" || !p.values) continue;
        // values는 해당 도구의 허용 키만 추려서 보관(불필요/위험 키 제거).
        const allow = PRESET_KEYS[toolId];
        const v = {};
        for (const k of allow) {
          if (k in p.values) v[k] = p.values[k];
        }
        clean.push({ name: p.name, values: v });
      }
      out[toolId] = clean;
    }
    return out;
  }

  // ── 조회 ──
  // 프리셋을 지원하는 도구인가?
  supports(toolId) { return !!PRESET_KEYS[toolId]; }

  // 특정 도구의 프리셋 목록(없으면 빈 배열).
  list(toolId) { return this.store[toolId] || []; }

  // 프리셋이 하나라도 있는 도구ID 목록(표시 순서는 PRESET_KEYS 선언 순서를 따른다).
  toolsWithPresets() {
    return Object.keys(PRESET_KEYS).filter((id) => (this.store[id] || []).length > 0);
  }

  // ── 동작 ──
  // 현재 활성 도구의 옵션을 state에서 읽어 새 프리셋으로 저장한다.
  // 반환: 저장된 도구ID(성공) / null(미지원 도구).
  saveCurrent(name) {
    const toolId = this.app.tools.activeId;
    const keys = PRESET_KEYS[toolId];
    if (!keys) return null;
    const values = {};
    for (const k of keys) values[k] = this.app.state[k];
    const arr = this.store[toolId] || (this.store[toolId] = []);
    arr.push({ name: name || this._autoName(toolId), values });
    this._save();
    return toolId;
  }

  // 프리셋 적용: 저장된 값을 state.set으로 일괄 복원한다.
  // 적용 대상 도구가 현재 활성 도구와 다르면 먼저 그 도구로 전환한다(옵션바가 맞게 갱신되도록).
  apply(toolId, index) {
    const arr = this.store[toolId];
    if (!arr || !arr[index]) return false;
    const keys = PRESET_KEYS[toolId];
    if (!keys) return false;

    if (this.app.tools.activeId !== toolId) this.app.tools.setTool(toolId);

    const values = arr[index].values;
    for (const k of keys) {
      if (!(k in values)) continue;
      let val = values[k];
      // 패턴 인덱스는 현재 patterns 길이를 벗어나면 적용하지 않는다(세션 간 안전장치).
      if (k === "patternIndex") {
        const n = (this.app.state.patterns || []).length;
        if (!(val >= 0 && val < n)) continue;
      }
      this.app.state.set(k, val);
    }
    return true;
  }

  // 프리셋 삭제.
  remove(toolId, index) {
    const arr = this.store[toolId];
    if (!arr || index < 0 || index >= arr.length) return false;
    arr.splice(index, 1);
    if (arr.length === 0) delete this.store[toolId];
    this._save();
    return true;
  }

  // 기본 프리셋으로 초기화.
  reset() {
    this.store = buildDefaultPresets();
    this._save();
  }

  // 이름 미입력 시 자동 이름("브러시 1" 형태).
  _autoName(toolId) {
    const base = TOOL_LABELS[toolId] || toolId;
    const n = (this.store[toolId] || []).length + 1;
    return `${base} ${n}`;
  }
}
