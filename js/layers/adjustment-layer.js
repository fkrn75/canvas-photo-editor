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

// ── 조정 타입 메타 정의 ──────────────────────────────────────────────────────
// 각 타입: { label, defaults, sliders, hasDialog, apply(img, params) }
//   label    : 메뉴/레이어 행 표시 이름
//   defaults : 새 조정 레이어 생성 시 기본 파라미터(없으면 {})
//   sliders  : 편집 다이얼로그용 슬라이더 정의 배열(없으면 다이얼로그 없이 즉시 적용)
//              [{ key, label, min, max, step, suffix }]
//   apply    : ImageData 를 in-place 보정(adjustments.js 위임)
//
// (레벨/커브 같은 복합 UI는 sliders 로 표현이 어려우므로 1차 범위에서는 단순 슬라이더형 위주로 제공.
//  레벨은 입력 검정/감마/흰점 3슬라이더로 근사 제공, 커브는 별도 복합 UI가 필요해 제외하고
//  대신 "노출(밝기/대비)·색조/채도·반전·흑백·포스터화·한계값"을 기본 제공한다.)
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
    defaults: { inB: 0, gamma: 1, inW: 255, outB: 0, outW: 255 },
    sliders: [
      { key: "inB", label: "입력 검정", min: 0, max: 254, step: 1 },
      { key: "gamma", label: "감마", min: 0.1, max: 9.99, step: 0.01 },
      { key: "inW", label: "입력 흰점", min: 1, max: 255, step: 1 },
      { key: "outB", label: "출력 검정", min: 0, max: 255, step: 1 },
      { key: "outW", label: "출력 흰점", min: 0, max: 255, step: 1 },
    ],
    // RGB 복합 채널에 일괄 적용(채널별 분리는 별도 채널 팔레트/커브 영역)
    apply: (img, p) => Adjust.levels(img, "rgb", p.inB ?? 0, p.inW ?? 255, p.gamma ?? 1, p.outB ?? 0, p.outW ?? 255),
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

// 조정 타입이 파라미터 편집 다이얼로그를 가지는지(슬라이더 정의 유무)
export function adjustmentHasDialog(type) {
  const meta = ADJUSTMENT_TYPES[type];
  return !!(meta && meta.sliders && meta.sliders.length);
}

// 조정 타입의 표시 라벨(레이어 이름/메뉴용). 알 수 없으면 "보정".
export function adjustmentLabel(type) {
  return ADJUSTMENT_TYPES[type]?.label || "보정";
}

// 조정 타입의 기본 파라미터 사본(원본 메타 공유 방지)
export function defaultParams(type) {
  const meta = ADJUSTMENT_TYPES[type];
  return meta ? { ...meta.defaults } : {};
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
