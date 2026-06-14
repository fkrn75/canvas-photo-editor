// style-presets.js — Styles 팔레트용 프리셋 레이어 스타일 모음.
// 각 프리셋은 { name, styles } 이며 styles는 layer-styles.js DEFAULT_STYLES와 동일 구조의
// "부분(partial)" 객체다. 적용 시 makeDefaultStyles()에 deep-merge되어 누락 필드는 기본값으로 채워진다.
//
// 기본 프리셋(BUILTIN_PRESETS)은 읽기 전용이고, 사용자 프리셋은 styles-panel.js가
// localStorage("ps7_style_presets")에 저장/로드한다. 이 파일은 빌트인 정의 + 병합 헬퍼만 제공.

import { makeDefaultStyles, cloneStyles } from "../layers/layer-styles.js";

// 빌트인 프리셋: 자주 쓰는 버튼/텍스트 스타일 9종.
// (효과별로 enabled:true 인 필드만 명시 → mergePreset가 기본값과 병합)
export const BUILTIN_PRESETS = [
  {
    name: "기본 그림자",
    styles: {
      dropShadow: { enabled: true, color: "#000000", opacity: 0.5, distance: 6, angle: 135, blur: 8, spread: 0, blendMode: "multiply" },
    },
  },
  {
    name: "떠 있는 그림자",
    styles: {
      dropShadow: { enabled: true, color: "#000000", opacity: 0.35, distance: 16, angle: 90, blur: 20, spread: 2, blendMode: "multiply" },
    },
  },
  {
    name: "네온(시안)",
    styles: {
      outerGlow: { enabled: true, color: "#00f6ff", opacity: 0.9, blur: 18, spread: 4, blendMode: "screen" },
      innerGlow: { enabled: true, color: "#aeffff", opacity: 0.8, blur: 8, spread: 0, source: "edge", blendMode: "screen" },
    },
  },
  {
    name: "네온(핑크)",
    styles: {
      outerGlow: { enabled: true, color: "#ff2bd6", opacity: 0.9, blur: 18, spread: 4, blendMode: "screen" },
      stroke: { enabled: true, color: "#ffffff", opacity: 0.9, size: 2, position: "outside" },
    },
  },
  {
    name: "엠보스 버튼",
    styles: {
      bevel: { enabled: true, style: "inner", size: 8, depth: 180, angle: 135, altitude: 35,
               highlight: "#ffffff", highlightOpacity: 0.8, shadow: "#000000", shadowOpacity: 0.6 },
      dropShadow: { enabled: true, color: "#000000", opacity: 0.4, distance: 4, angle: 135, blur: 6, spread: 0, blendMode: "multiply" },
    },
  },
  {
    name: "음각(눌림)",
    styles: {
      innerShadow: { enabled: true, color: "#000000", opacity: 0.6, distance: 4, angle: 135, blur: 6, spread: 0, blendMode: "multiply" },
      bevel: { enabled: true, style: "inner", size: 4, depth: 120, angle: 135, altitude: 40,
               highlight: "#ffffff", highlightOpacity: 0.5, shadow: "#000000", shadowOpacity: 0.5 },
    },
  },
  {
    name: "골드 그라디언트",
    styles: {
      gradientOverlay: { enabled: true, colors: ["#fff3a0", "#d4a017", "#8a6d00"], opacity: 1, angle: 90, scale: 100, style: "linear", reverse: false, blendMode: "normal" },
      bevel: { enabled: true, style: "inner", size: 5, depth: 150, angle: 120, altitude: 35,
               highlight: "#fffbe0", highlightOpacity: 0.7, shadow: "#5a4500", shadowOpacity: 0.6 },
      stroke: { enabled: true, color: "#5a4500", opacity: 0.8, size: 1, position: "outside" },
    },
  },
  {
    name: "윤곽선만",
    styles: {
      stroke: { enabled: true, color: "#000000", opacity: 1, size: 3, position: "outside" },
    },
  },
  {
    name: "광택 새틴",
    styles: {
      colorOverlay: { enabled: true, color: "#3a7bd5", opacity: 1, blendMode: "normal" },
      satin: { enabled: true, color: "#ffffff", opacity: 0.4, angle: 19, distance: 14, blur: 16, invert: false, blendMode: "screen" },
    },
  },
];

// 프리셋 부분 styles → 완전한 styles 객체로 병합(기본값 기반 deep-merge).
// 각 효과 키에 대해 { ...기본값, ...프리셋효과 } 를 적용하고 배열(colors)은 복사.
export function mergePreset(partial) {
  const full = makeDefaultStyles();
  if (!partial) return full;
  for (const k of Object.keys(full)) {
    if (partial[k]) {
      full[k] = { ...full[k], ...partial[k] };
      if (Array.isArray(partial[k].colors)) full[k].colors = partial[k].colors.slice();
    }
  }
  return full;
}

// 현재 레이어 styles → 프리셋 저장용 부분 객체(완전 복사 사용; 단순/안전).
// (활성 효과만 추리지 않고 전체를 저장해도 무방 — 용량 작음. cloneStyles로 깊은 복사)
export function stylesToPreset(styles) {
  return cloneStyles(styles);
}
