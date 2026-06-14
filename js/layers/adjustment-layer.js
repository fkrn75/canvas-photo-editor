// adjustment-layer.js — 조정 레이어(Adjustment Layer, 비파괴 보정).
//
// 조정 레이어는 일반 Layer 인스턴스를 그대로 재사용하되 type="adjustment" 를 부여한다.
// 자체 픽셀(빈 투명 캔버스)은 합성에 직접 쓰이지 않고, 대신 "그 아래까지 합성된 결과"에
// adjustmentParams 로 정의된 보정을 적용한다(= 그 위치보다 아래 레이어 전체에 영향).
//
// 마스크/불투명도 지원:
//   - opacity        : 보정 결과를 원본과 lerp 하는 강도(0=무보정, 1=완전 보정).
//   - mask           : 픽셀별 마스크 휘도(0~1)를 추가 혼합 계수로 사용(검=원본 유지).
//   - 둘 다 곱해져 픽셀별 최종 혼합 계수가 된다.
//
// 보정 엔진(adjustments.js)의 ImageData in-place 함수를 재사용한다(중복 구현 없음).

import { Layer } from "./layer.js";
import * as Adjust from "../engine/adjustments.js";

// ── 채널별 레벨/커브 헬퍼 ────────────────────────────────────────────────────
// 채널 순서(합성 RGB + 개별 R/G/B + 알파). UI/적용 모두 이 순서를 따른다.
export const LEVELS_CHANNELS = ["rgb", "r", "g", "b", "a"];

// 한 채널의 레벨 기본값(항등: 보정 없음).
function defLevel() { return { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 }; }
// 채널별 레벨 기본 파라미터 { rgb:{...}, r:{...}, ... }.
function defLevelsAll() {
  const o = {};
  for (const ch of LEVELS_CHANNELS) o[ch] = defLevel();
  return o;
}
// 한 채널 레벨이 항등(무보정)인가.
function levelIsIdentity(s) {
  return !s || (s.inB === 0 && s.inW === 255 && s.gamma === 1 && s.outB === 0 && s.outW === 255);
}

// 한 채널의 커브 기본값(항등 직선). 제어점은 {x,y} 0~255.
function defCurve() { return [{ x: 0, y: 0 }, { x: 255, y: 255 }]; }
// 채널별 커브 기본 파라미터.
function defCurvesAll() {
  const o = {};
  for (const ch of LEVELS_CHANNELS) o[ch] = defCurve();
  return o;
}
// 한 채널 커브가 항등(직선 0,0~255,255)인가.
function curveIsIdentity(p) {
  return !p || (p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255);
}

// 레벨 파라미터를 "채널별" 형태로 정규화한다.
// 하위 호환: 예전(단일 RGB) 파라미터 { inB,gamma,inW,outB,outW } 가 들어오면 rgb 채널로 승격한다.
export function normalizeLevelsParams(p) {
  const out = defLevelsAll();
  if (!p) return out;
  // 예전 평면 형태 감지(채널 키 대신 inB 등이 최상위에 있음)
  if (p.inB !== undefined || p.inW !== undefined || p.gamma !== undefined) {
    out.rgb = { inB: p.inB ?? 0, inW: p.inW ?? 255, gamma: p.gamma ?? 1, outB: p.outB ?? 0, outW: p.outW ?? 255 };
    return out;
  }
  for (const ch of LEVELS_CHANNELS) if (p[ch]) out[ch] = { ...defLevel(), ...p[ch] };
  return out;
}

// 커브 파라미터를 채널별 형태로 정규화한다(누락 채널은 항등 직선).
export function normalizeCurvesParams(p) {
  const out = defCurvesAll();
  if (!p) return out;
  for (const ch of LEVELS_CHANNELS) if (Array.isArray(p[ch]) && p[ch].length >= 2) out[ch] = p[ch].map((q) => ({ x: q.x, y: q.y }));
  return out;
}

// ── 조정 타입 메타 정의 ──────────────────────────────────────────────────────
// 각 타입: { label, defaults, sliders, editor, apply(img, params) }
//   label    : 메뉴/레이어 행 표시 이름
//   defaults : 새 조정 레이어 생성 시 기본 파라미터(없으면 {})
//   sliders  : 편집 다이얼로그용 슬라이더 정의 배열(없으면 슬라이더 자동생성 안 함)
//              [{ key, label, min, max, step, suffix }]
//   editor   : 복합 커스텀 UI 종류("levels" | "curves"). 있으면 다이얼로그가 전용 에디터를 띄운다.
//   apply    : ImageData 를 in-place 보정(adjustments.js 위임)
//
// (레벨/커브는 sliders 로 표현이 어려운 복합 UI라 editor 로 전용 에디터를 연결한다.
//  나머지(밝기/대비·색조/채도·반전·흑백·포스터화·한계값)는 슬라이더형으로 제공한다.)
export const ADJUSTMENT_TYPES = {
  brightnessContrast: {
    label: "밝기/대비",
    defaults: { b: 0, c: 0 },
    sliders: [
      { key: "b", label: "밝기", min: -100, max: 100, step: 1 },
      { key: "c", label: "대비", min: -100, max: 100, step: 1 },
    ],
    apply: (img, p) => Adjust.brightnessContrast(img, p.b ?? 0, p.c ?? 0),
  },
  hueSaturation: {
    label: "색조/채도",
    defaults: { h: 0, s: 0, l: 0 },
    sliders: [
      { key: "h", label: "색조", min: -180, max: 180, step: 1 },
      { key: "s", label: "채도", min: -100, max: 100, step: 1 },
      { key: "l", label: "밝기", min: -100, max: 100, step: 1 },
    ],
    apply: (img, p) => Adjust.hueSaturation(img, p.h ?? 0, p.s ?? 0, p.l ?? 0),
  },
  levels: {
    label: "레벨",
    // 채널별 레벨(rgb/r/g/b/a). 전용 히스토그램 에디터로 편집한다.
    defaults: defLevelsAll(),
    editor: "levels",
    apply: (img, p) => {
      const all = normalizeLevelsParams(p);
      for (const ch of LEVELS_CHANNELS) {
        const s = all[ch];
        if (!levelIsIdentity(s)) Adjust.levels(img, ch, s.inB, s.inW, s.gamma, s.outB, s.outW);
      }
    },
  },
  curves: {
    label: "커브",
    // 채널별 커브(rgb/r/g/b/a). 전용 곡선 에디터로 편집한다.
    defaults: defCurvesAll(),
    editor: "curves",
    apply: (img, p) => {
      const all = normalizeCurvesParams(p);
      for (const ch of LEVELS_CHANNELS) {
        if (!curveIsIdentity(all[ch])) Adjust.applyChannelLUT(img, ch, Adjust.buildCurveLUT(all[ch]));
      }
    },
  },
  posterize: {
    label: "포스터화",
    defaults: { levels: 4 },
    sliders: [
      { key: "levels", label: "단계", min: 2, max: 255, step: 1 },
    ],
    apply: (img, p) => Adjust.posterize(img, p.levels ?? 4),
  },
  threshold: {
    label: "한계값",
    defaults: { level: 128 },
    sliders: [
      { key: "level", label: "한계값", min: 1, max: 255, step: 1 },
    ],
    apply: (img, p) => Adjust.threshold(img, p.level ?? 128),
  },
  invert: {
    label: "반전",
    defaults: {},
    sliders: null, // 파라미터 없음 → 다이얼로그 불필요
    apply: (img) => Adjust.invert(img),
  },
  grayscale: {
    label: "흑백",
    defaults: {},
    sliders: null,
    apply: (img) => Adjust.grayscale(img),
  },
};

// 조정 타입이 파라미터 편집 다이얼로그를 가지는지(슬라이더 정의 또는 전용 에디터 유무)
export function adjustmentHasDialog(type) {
  const meta = ADJUSTMENT_TYPES[type];
  if (!meta) return false;
  return !!meta.editor || !!(meta.sliders && meta.sliders.length);
}

// 조정 타입의 전용 에디터 종류("levels" | "curves") 또는 null(슬라이더형).
export function adjustmentEditor(type) {
  return ADJUSTMENT_TYPES[type]?.editor || null;
}

// 조정 타입의 표시 라벨(레이어 이름/메뉴용). 알 수 없으면 "보정".
export function adjustmentLabel(type) {
  return ADJUSTMENT_TYPES[type]?.label || "보정";
}

// 조정 타입의 기본 파라미터 사본(원본 메타 공유 방지).
// 레벨/커브는 채널별 중첩 객체/배열이므로 깊은 복사로 안전하게 떼어낸다.
export function defaultParams(type) {
  const meta = ADJUSTMENT_TYPES[type];
  if (!meta) return {};
  return cloneParams(meta.defaults);
}

// 조정 파라미터 깊은 복사(중첩 객체/배열까지). 함수/특수객체는 다루지 않는다(순수 데이터 가정).
export function cloneParams(p) {
  if (Array.isArray(p)) return p.map((q) => cloneParams(q));
  if (p && typeof p === "object") {
    const o = {};
    for (const k in p) o[k] = cloneParams(p[k]);
    return o;
  }
  return p;
}

// 조정 타입의 슬라이더 정의(다이얼로그 빌드용). 없으면 빈 배열.
export function adjustmentSliders(type) {
  return ADJUSTMENT_TYPES[type]?.sliders || [];
}

// ── 디스패처: ImageData 에 보정을 in-place 적용 ──────────────────────────────
// adjustmentType 에 해당하는 adjustments.js 함수로 위임한다. 알 수 없는 타입이면 무동작.
export function applyAdjustment(imageData, adjustmentType, params = {}) {
  const meta = ADJUSTMENT_TYPES[adjustmentType];
  if (!meta) return imageData;
  meta.apply(imageData, params || {});
  return imageData;
}

// ── 조정 레이어 팩토리 ───────────────────────────────────────────────────────
// 문서 크기의 빈 투명 캔버스를 가진 Layer 를 만들고 조정 메타를 부여한다.
//   width/height : 문서 크기
//   type         : ADJUSTMENT_TYPES 키
//   params       : 초기 파라미터(없으면 해당 타입 기본값)
//   name         : 표시 이름(없으면 타입 라벨)
export function createAdjustmentLayer(width, height, type, params = null, name = null) {
  const layer = new Layer(width, height, name || adjustmentLabel(type));
  // 조정 레이어 식별 메타. (캔버스는 빈 투명 그대로 — 합성 시 자체 픽셀은 쓰지 않음)
  layer.type = "adjustment";
  layer.adjustmentType = type;
  layer.adjustmentParams = params ? { ...params } : defaultParams(type);
  return layer;
}

// ── 합성 적용 ────────────────────────────────────────────────────────────────
// 조정 레이어를 "그 아래까지 합성된 결과(ctx)"에 적용한다.
//   ctx          : 문서 좌표계 2D 컨텍스트(아래 레이어들이 이미 그려진 scratch)
//   layer        : 조정 레이어(type==="adjustment")
//   width/height : 문서 크기
//
// 처리: ctx 전체 픽셀을 읽어 보정 결과(adj)와 원본(orig)을 픽셀별 혼합 계수 k 로 lerp 한다.
//   k = opacity × (마스크 휘도, 있으면) × (마스크 알파, 있으면)
// 보정은 "보이는(알파>0) 픽셀"에만 의미가 있으므로 RGB만 혼합하고 알파는 원본 유지한다.
// (조정 레이어는 새 픽셀을 만들지 않고 기존 픽셀의 색만 바꾸므로 알파 변경 없음)
export function composeAdjustment(ctx, layer, width, height) {
  const op = layer.opacity ?? 1;
  // 완전 투명(영향 0)이면 빠르게 종료
  if (op <= 0) return;

  // 1) 현재까지 합성된 결과를 읽는다(원본).
  const orig = ctx.getImageData(0, 0, width, height);
  const od = orig.data;

  // 2) 보정 결과를 별도 버퍼로 계산(원본 보존 → lerp 가능).
  const adjImg = new ImageData(new Uint8ClampedArray(od), width, height);
  applyAdjustment(adjImg, layer.adjustmentType, layer.adjustmentParams);
  const ad = adjImg.data;

  // 3) 마스크 픽셀(있으면) 미리 확보. 마스크는 문서 크기로 동기화되어 있다고 가정.
  let md = null;
  const useMask = !!(layer.mask && layer.maskEnabled !== false);
  if (useMask) {
    const mc = layer.maskCtx || layer.mask.getContext("2d", { willReadFrequently: true });
    md = mc.getImageData(0, 0, width, height).data;
  }

  // 4) 픽셀별 혼합. out = orig + (adj - orig) × k
  for (let i = 0; i < od.length; i += 4) {
    // 보이지 않는(완전 투명) 픽셀은 색이 의미 없으므로 건너뛴다.
    if (od[i + 3] === 0) continue;

    let k = op;
    if (useMask) {
      // 마스크 휘도(0~1) × 마스크 자체 알파(0~1)
      const lum = (md[i] * 0.299 + md[i + 1] * 0.587 + md[i + 2] * 0.114) / 255;
      const ma = md[i + 3] / 255;
      k *= lum * ma;
    }
    if (k <= 0) continue;        // 이 픽셀은 보정 영향 0 → 원본 유지
    if (k >= 1) {
      od[i] = ad[i]; od[i + 1] = ad[i + 1]; od[i + 2] = ad[i + 2];
    } else {
      od[i]     = od[i]     + (ad[i]     - od[i])     * k;
      od[i + 1] = od[i + 1] + (ad[i + 1] - od[i + 1]) * k;
      od[i + 2] = od[i + 2] + (ad[i + 2] - od[i + 2]) * k;
    }
    // 알파(od[i+3])는 원본 유지
  }

  // 5) 합성 결과를 다시 ctx 에 쓴다.
  ctx.putImageData(orig, 0, 0);
}
