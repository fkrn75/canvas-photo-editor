// adjust-ext.test.js — 확장 보정(노출·활기·포토 필터·선택 색상·흑백(혼합)·어두운/밝은 영역·
// 채도 감소·색상 대체·자동 대비·자동 색상), 확장 조정 레이어 타입, 확장 블렌드 모드 5종 단위테스트.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers.js"; // ImageData 폴리필
import { makeImageData, setPixel, getPixel } from "./helpers.js";
import {
  exposure, vibrance, photoFilter, selectiveColor, blackWhite, desaturate,
  shadowsHighlights, replaceColor, autoContrast, autoColor, autoTone, BLACK_WHITE_DEFAULTS,
} from "../js/engine/adjustments.js";
import {
  ADJUSTMENT_TYPES, applyAdjustment, defaultParams, adjustmentHasDialog, adjustmentSpec, channelMixFromParams,
} from "../js/layers/adjustment-layer.js";
import { blendImageData, isCustomBlendMode } from "../js/engine/blend.js";

// 다양한 색이 섞인 4×4 시험 이미지(결정적)
function sample() {
  const img = makeImageData(4, 4);
  const cols = [
    [0, 0, 0], [255, 255, 255], [128, 128, 128], [255, 0, 0],
    [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255],
    [255, 0, 255], [200, 120, 40], [30, 60, 90], [17, 200, 150],
    [99, 99, 98], [250, 240, 230], [5, 10, 15], [180, 30, 220],
  ];
  cols.forEach((c, i) => setPixel(img, i % 4, (i / 4) | 0, [...c, 255]));
  return img;
}
// 회색만으로 된 이미지(그라디언트 맵·흑백 혼합 항등 검증용)
function grays() {
  const img = makeImageData(4, 1);
  [0, 64, 128, 255].forEach((v, x) => setPixel(img, x, 0, [v, v, v, 255]));
  return img;
}
const same = (img, ref) => assert.deepEqual(Array.from(img.data), Array.from(ref.data));

// ── 엔진: 항등 파라미터 = 불변 ────────────────────────────────────────────────
test("확장 보정: 항등 파라미터면 이미지가 변하지 않는다", () => {
  const cases = [
    (i) => exposure(i, 0, 0, 1),
    (i) => exposure(i, 1e-12, 0, 1), // LUT 경로(선형광 왕복)도 항등
    (i) => vibrance(i, 0, 0),
    (i) => photoFilter(i, "#ff0000", 0, true),
    (i) => selectiveColor(i, {}, true),
    (i) => selectiveColor(i, { reds: [0, 0, 0, 0] }, false),
    (i) => shadowsHighlights(i, 0, 0, 50, 30),
    (i) => replaceColor(i, "#ff0000", 100, 0, 0, 0),
    (i) => autoContrast(i), // 이미 0~255 전 범위
  ];
  for (const fn of cases) { const img = sample(); fn(img); same(img, sample()); }
});

// ── 엔진: 대표값 ────────────────────────────────────────────────────────────
test("exposure: +1 스톱은 밝게, 극단은 0/255 유지", () => {
  const img = makeImageData(3, 1);
  setPixel(img, 0, 0, [0, 0, 0, 255]); setPixel(img, 1, 0, [128, 128, 128, 255]); setPixel(img, 2, 0, [255, 255, 255, 255]);
  exposure(img, 1, 0, 1);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [255, 255, 255, 255]);
  const v = getPixel(img, 1, 0)[0];
  assert.ok(v >= 174 && v <= 178, `128 → ${v} (선형광 2배 ≈ 176)`);
  const dark = makeImageData(1, 1, [128, 128, 128, 255]);
  exposure(dark, -20, 0, 1);
  assert.deepEqual(getPixel(dark, 0, 0), [0, 0, 0, 255]);
});

test("vibrance: 채도 -100 → 휘도 회색, 활기는 저채도 색을 더 많이 바꾼다", () => {
  const img = makeImageData(1, 1, [200, 100, 50, 255]);
  vibrance(img, 0, -100);
  const y = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50);
  assert.deepEqual(getPixel(img, 0, 0), [y, y, y, 255]);
  // 저채도(140,128,120) vs 고채도(255,0,0): 활기 +100 시 채도 증가 비율
  const lo = makeImageData(1, 1, [140, 128, 120, 255]);
  vibrance(lo, 100, 0);
  const [r1, , b1] = getPixel(lo, 0, 0);
  assert.ok((r1 - b1) / (140 - 120) > 1.8, "저채도 색은 크게 증가");
  const hi = makeImageData(1, 1, [255, 0, 0, 255]);
  vibrance(hi, 100, 0);
  assert.deepEqual(getPixel(hi, 0, 0), [255, 0, 0, 255], "이미 최대 채도면 그대로");
});

test("photoFilter: 농도 100·광도 유지 끔 → 흰색이 필터색이 된다, 광도 유지는 휘도 보존", () => {
  const img = makeImageData(1, 1, [255, 255, 255, 255]);
  photoFilter(img, "#ec8a00", 100, false);
  assert.deepEqual(getPixel(img, 0, 0), [0xec, 0x8a, 0x00, 255]);
  const g = makeImageData(1, 1, [128, 128, 128, 255]);
  photoFilter(g, "#006dff", 50, true);
  const [r, gg, b] = getPixel(g, 0, 0);
  assert.ok(b > r, "cooling 필터 → 푸른 기");
  assert.ok(Math.abs(0.299 * r + 0.587 * gg + 0.114 * b - 128) < 1.5, "휘도 유지");
});

test("selectiveColor: 빨강 계열 녹청 +100(절대) → 빨강 채널 0, 파랑 픽셀은 영향 없음", () => {
  const img = makeImageData(2, 1);
  setPixel(img, 0, 0, [255, 0, 0, 255]); setPixel(img, 1, 0, [0, 0, 255, 255]);
  selectiveColor(img, { reds: [100, 0, 0, 0] }, false);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 1, 0), [0, 0, 255, 255]);
  // 상대치: 순수 빨강은 녹청 잉크가 0이므로 변화 없음
  const rel = makeImageData(1, 1, [255, 0, 0, 255]);
  selectiveColor(rel, { reds: [100, 0, 0, 0] }, true);
  assert.deepEqual(getPixel(rel, 0, 0), [255, 0, 0, 255]);
  // 검정 계열 K +100(절대) → 어두운 회색이 검정으로
  const dk = makeImageData(1, 1, [20, 20, 20, 255]);
  selectiveColor(dk, { blacks: [0, 0, 0, 100] }, false);
  assert.deepEqual(getPixel(dk, 0, 0), [0, 0, 0, 255]);
});

test("blackWhite: 회색 불변, 원색/혼합색은 해당 가중치 밝기", () => {
  const g = grays(); blackWhite(g, { reds: 300, blues: -200 }); same(g, grays());
  const img = makeImageData(3, 1);
  setPixel(img, 0, 0, [255, 0, 0, 255]); setPixel(img, 1, 0, [255, 255, 0, 255]); setPixel(img, 2, 0, [0, 0, 255, 255]);
  blackWhite(img, BLACK_WHITE_DEFAULTS);
  assert.deepEqual(getPixel(img, 0, 0), [102, 102, 102, 255]); // 빨강 40%
  assert.deepEqual(getPixel(img, 1, 0), [153, 153, 153, 255]); // 노랑 60%
  assert.deepEqual(getPixel(img, 2, 0), [51, 51, 51, 255]);    // 파랑 20%
});

test("desaturate: (최대+최소)/2 회색", () => {
  const img = makeImageData(1, 1, [200, 100, 0, 255]);
  desaturate(img);
  assert.deepEqual(getPixel(img, 0, 0), [100, 100, 100, 255]);
});

test("shadowsHighlights: 어두운 영역은 밝게, 밝은 영역은 어둡게, 중간은 그대로", () => {
  const dark = makeImageData(5, 5, [30, 30, 30, 255]);
  shadowsHighlights(dark, 100, 0, 50, 0);
  assert.ok(getPixel(dark, 2, 2)[0] > 30);
  const dark2 = makeImageData(5, 5, [30, 30, 30, 255]);
  shadowsHighlights(dark2, 100, 0, 50, 6); // 균일 이미지는 블러해도 같은 결과
  assert.deepEqual(getPixel(dark2, 2, 2), getPixel(dark, 2, 2));
  const bright = makeImageData(3, 3, [230, 230, 230, 255]);
  shadowsHighlights(bright, 0, 100, 50, 0);
  assert.ok(getPixel(bright, 1, 1)[0] < 230);
  const mid = makeImageData(3, 3, [140, 140, 140, 255]);
  shadowsHighlights(mid, 100, 100, 40, 0);
  assert.deepEqual(getPixel(mid, 1, 1), [140, 140, 140, 255]);
});

test("replaceColor: 허용치 0이면 대상 색만 색조 이동", () => {
  const img = makeImageData(2, 1);
  setPixel(img, 0, 0, [255, 0, 0, 255]); setPixel(img, 1, 0, [0, 0, 255, 255]);
  replaceColor(img, "#ff0000", 0, 120, 0, 0);
  assert.deepEqual(getPixel(img, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(getPixel(img, 1, 0), [0, 0, 255, 255]);
});

test("autoContrast: 50~150 회색 범위를 0~255로 펼친다", () => {
  const img = makeImageData(3, 1);
  setPixel(img, 0, 0, [50, 50, 50, 255]); setPixel(img, 1, 0, [100, 100, 100, 255]); setPixel(img, 2, 0, [150, 150, 150, 255]);
  autoContrast(img);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [255, 255, 255, 255]);
  assert.deepEqual(getPixel(img, 1, 0), [128, 128, 128, 255]);
});

test("autoColor: 중성 전범위 이미지는 불변, 색 캐스트는 채널별로 0~255로 펼쳐진다", () => {
  const n = makeImageData(3, 1);
  setPixel(n, 0, 0, [0, 0, 0, 255]); setPixel(n, 1, 0, [128, 128, 128, 255]); setPixel(n, 2, 0, [255, 255, 255, 255]);
  const ref = makeImageData(3, 1);
  ref.data.set(n.data);
  autoColor(n); same(n, ref);
  const c = makeImageData(2, 1);
  setPixel(c, 0, 0, [60, 30, 10, 255]); setPixel(c, 1, 0, [220, 190, 170, 255]);
  autoColor(c);
  assert.deepEqual(getPixel(c, 0, 0).slice(0, 3), [0, 0, 0]);
  assert.deepEqual(getPixel(c, 1, 0).slice(0, 3), [255, 255, 255]);
});

// ── 조정 레이어 타입 ─────────────────────────────────────────────────────────
const NEW_TYPES = ["exposure", "vibrance", "colorBalance", "blackWhite", "photoFilter", "channelMixer", "gradientMap", "selectiveColor"];

test("조정 레이어: 새 타입 8종 등록 + 편집 다이얼로그 보유, 기존 grayscale 하위 호환 유지", () => {
  for (const t of NEW_TYPES) {
    assert.ok(ADJUSTMENT_TYPES[t], t);
    assert.equal(adjustmentHasDialog(t), true, t);
  }
  assert.equal(ADJUSTMENT_TYPES.grayscale.label, "흑백");
  assert.equal(ADJUSTMENT_TYPES.blackWhite.label, "흑백(혼합)");
  assert.equal(adjustmentSpec("selectiveColor").bank.options.length, 9);
  assert.equal(adjustmentSpec("colorBalance").bank.options.length, 3);
});

test("조정 레이어: 항등 파라미터면 불변", () => {
  const ident = {
    exposure: defaultParams("exposure"),
    vibrance: defaultParams("vibrance"),
    colorBalance: defaultParams("colorBalance"),
    photoFilter: { ...defaultParams("photoFilter"), density: 0 },
    channelMixer: defaultParams("channelMixer"),
    selectiveColor: defaultParams("selectiveColor"),
  };
  for (const [t, p] of Object.entries(ident)) {
    const img = sample(); applyAdjustment(img, t, p); same(img, sample());
  }
  // 회색 이미지에서: 흑백(혼합) 임의 가중치, 그라디언트 맵 흑→백은 항등
  const g1 = grays(); applyAdjustment(g1, "blackWhite", { reds: 10, cyans: 200 }); same(g1, grays());
  const g2 = grays(); applyAdjustment(g2, "gradientMap", { colorA: "#000000", colorB: "#ffffff", reverse: false }); same(g2, grays());
});

test("조정 레이어: 대표값(채널 혼합 단색·그라디언트 맵 반전·색상 균형)", () => {
  // 채널 혼합 단색: 기본 gray 40/40/20 → 순수 빨강 = 102
  const cm = makeImageData(1, 1, [255, 0, 0, 255]);
  applyAdjustment(cm, "channelMixer", { ...defaultParams("channelMixer"), mono: true });
  assert.deepEqual(getPixel(cm, 0, 0), [102, 102, 102, 255]);
  const mix = channelMixFromParams({ r: [0, 0, 100, 50] });
  assert.deepEqual(mix.r, [0, 0, 1, 127.5]);
  // 그라디언트 맵 반전: 검정 픽셀 → 밝은 쪽(colorB 가 어두운 끝으로)
  const gm = makeImageData(1, 1, [0, 0, 0, 255]);
  applyAdjustment(gm, "gradientMap", { colorA: "#ff0000", colorB: "#0000ff", reverse: true });
  assert.deepEqual(getPixel(gm, 0, 0), [0, 0, 255, 255]);
  // 색상 균형: 중간 영역 시안↔빨강 +100 (광도 유지 끔) → 회색의 빨강 증가
  const cb = makeImageData(1, 1, [128, 128, 128, 255]);
  applyAdjustment(cb, "colorBalance", { ...defaultParams("colorBalance"), midtones: [100, 0, 0], preserveLum: false });
  assert.ok(getPixel(cb, 0, 0)[0] > 150);
});

test("조정 레이어: 그라디언트 맵 기본값은 생성 시점의 전경/배경색을 값으로 저장", () => {
  const prev = globalThis.app;
  globalThis.app = { state: { foreground: "#ff0000", background: "#00ff00" } };
  try {
    const p = defaultParams("gradientMap");
    assert.deepEqual(p, { colorA: "#ff0000", colorB: "#00ff00", reverse: false });
    globalThis.app.state.foreground = "#123456"; // 이후 색이 바뀌어도 이미 만든 파라미터는 그대로
    assert.equal(p.colorA, "#ff0000");
  } finally {
    if (prev === undefined) delete globalThis.app; else globalThis.app = prev;
  }
  assert.equal(defaultParams("gradientMap").colorA, "#000000"); // app 없으면 흑→백
});

test("조정 레이어: 기본 파라미터는 매번 독립 사본(중첩 배열 공유 없음)", () => {
  const a = defaultParams("selectiveColor"), b = defaultParams("selectiveColor");
  a.reds[0] = 50;
  assert.equal(b.reds[0], 0);
  const c = defaultParams("colorBalance");
  c.shadows[1] = 9;
  assert.equal(ADJUSTMENT_TYPES.colorBalance.defaults.shadows[1], 0);
});

// ── 블렌드 모드 확장 5종(순수 ImageData 합성) ────────────────────────────────
function px(rgba) { return makeImageData(1, 1, rgba); }
function blend1(b, s, mode, op = 1) {
  const bd = px(b);
  assert.equal(blendImageData(bd, px(s), mode, op), true);
  return getPixel(bd, 0, 0);
}

test("블렌드: 확장 5종은 커스텀 per-pixel 경로, 네이티브 모드는 false", () => {
  for (const m of ["hard-mix", "darker-color", "lighter-color", "subtract", "divide"]) assert.equal(isCustomBlendMode(m), true, m);
  assert.equal(blendImageData(px([1, 2, 3, 255]), px([4, 5, 6, 255]), "multiply", 1), false);
});

test("블렌드: 하드 혼합 = cb+cs>=1 ? 1 : 0", () => {
  assert.deepEqual(blend1([200, 50, 128, 255], [100, 100, 128, 255], "hard-mix"), [255, 0, 255, 255]);
});

test("블렌드: 빼기 = max(0, cb-cs), 불투명도 50%는 배경과 반반", () => {
  assert.deepEqual(blend1([200, 50, 128, 255], [100, 100, 27, 255], "subtract"), [100, 0, 101, 255]);
  assert.deepEqual(blend1([200, 50, 128, 255], [100, 100, 28, 255], "subtract", 0.5), [150, 25, 114, 255]);
});

test("블렌드: 나누기 = cb/cs (cs=0이면 흰색, 단 cb=0이면 0)", () => {
  assert.deepEqual(blend1([100, 50, 0, 255], [200, 0, 0, 255], "divide"), [128, 255, 0, 255]);
  assert.deepEqual(blend1([100, 100, 100, 255], [50, 100, 255, 255], "divide"), [255, 255, 100, 255]);
});

test("블렌드: 어두운/밝은 색상은 Lum 비교로 픽셀 전체를 고른다", () => {
  assert.deepEqual(blend1([255, 0, 0, 255], [0, 0, 255, 255], "darker-color"), [0, 0, 255, 255]);
  assert.deepEqual(blend1([255, 0, 0, 255], [0, 0, 255, 255], "lighter-color"), [255, 0, 0, 255]);
  // 채널별 min 과 다름: (200,10,10) vs (10,200,10) → 어두운 쪽은 Lum 이 낮은 빨강 픽셀 그대로
  assert.deepEqual(blend1([200, 10, 10, 255], [10, 200, 10, 255], "darker-color"), [200, 10, 10, 255]);
});

test("블렌드: 투명 소스는 배경 유지, 투명 배경엔 소스 원색", () => {
  assert.deepEqual(blend1([10, 20, 30, 255], [200, 200, 200, 0], "subtract"), [10, 20, 30, 255]);
  assert.deepEqual(blend1([0, 0, 0, 0], [200, 100, 50, 255], "divide"), [200, 100, 50, 255]);
});

// ── 투명(알파 0) 픽셀 제외 ───────────────────────────────────────────────────
// 투명 영역(RGB 0)이 히스토그램에 섞이면 최소 0이 되어 스트레치가 죽던 문제의 회귀 테스트.
function transparentMix() {
  const img = makeImageData(6, 1, [0, 0, 0, 0]);
  setPixel(img, 0, 0, [50, 50, 50, 255]); setPixel(img, 1, 0, [100, 100, 100, 255]); setPixel(img, 2, 0, [150, 150, 150, 255]);
  return img; // 나머지 3픽셀은 알파 0
}

test("autoContrast: 알파 0 픽셀은 히스토그램에서 제외된다(투명이 많아도 효과 유지)", () => {
  const img = transparentMix();
  autoContrast(img);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [255, 255, 255, 255]);
  assert.equal(getPixel(img, 4, 0)[3], 0); // 투명 픽셀 알파 보존
});

test("autoColor: 알파 0 픽셀은 히스토그램·평균에서 제외된다", () => {
  const img = makeImageData(6, 1, [0, 0, 0, 0]);
  setPixel(img, 0, 0, [60, 30, 10, 255]); setPixel(img, 1, 0, [220, 190, 170, 255]);
  autoColor(img);
  assert.deepEqual(getPixel(img, 0, 0).slice(0, 3), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 1, 0).slice(0, 3), [255, 255, 255]);
});

test("autoTone(자동 레벨): 알파 0 제외 스트레치", () => {
  const img = transparentMix();
  autoTone(img);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [255, 255, 255, 255]);
});

test("autoContrast/autoColor/autoTone: 전부 투명이면 no-op", () => {
  for (const fn of [autoContrast, autoColor, autoTone]) {
    const img = makeImageData(4, 1, [10, 20, 30, 0]);
    const ref = makeImageData(4, 1, [10, 20, 30, 0]);
    fn(img);
    same(img, ref);
  }
});
