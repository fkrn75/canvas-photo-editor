// panels.test.js — 정보성 패널·스냅·내비게이터의 순수 함수 테스트(panels 작업자).
// 대상: histogram-panel(computeHistogram/histogramStats/channelBins/sampleSize),
//       info-panel(rgbToHsb), render/snap(nearestOnAxis/snapAxis/snapPoint/snapBox/buildSnapTargets/snapThreshold),
//       navigator-panel(navLayout/viewRectOnThumb/thumbToDoc/panForCenter/zoomToSlider/sliderToZoom),
//       move-tool(opaqueBounds).
// 모두 최상위에서 DOM에 접근하지 않는 모듈이라 Node에서 그대로 import 한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeImageData, setPixel } from "./helpers.js";
import { computeHistogram, histogramStats, channelBins, sampleSize } from "../js/ui/histogram-panel.js";
import { rgbToHsb } from "../js/ui/info-panel.js";
import {
  nearestOnAxis, snapAxis, snapPoint, snapBox, buildSnapTargets, snapThreshold, SNAP_SCREEN_PX,
} from "../js/render/snap.js";
import {
  navLayout, viewRectOnThumb, thumbToDoc, panForCenter, zoomToSlider, sliderToZoom, SLIDER_MAX,
} from "../js/ui/navigator-panel.js";
import { opaqueBounds } from "../js/tools/move-tool.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// ── 히스토그램 ──
test("histogramStats: 평균·표준편차·중앙값·개수", () => {
  const bins = new Uint32Array(256);
  bins[0] = 2; bins[100] = 1; bins[200] = 1; // 값: 0,0,100,200
  const s = histogramStats(bins);
  assert.equal(s.count, 4);
  near(s.mean, 75);
  // 분산 = ((75²)*2 + 25² + 125²)/4 = (11250+625+15625)/4 = 6875
  near(s.std, Math.sqrt(6875));
  assert.equal(s.median, 0); // 누적 2 ≥ 4/2 → 0
});

test("histogramStats: 빈 분포는 모두 0", () => {
  assert.deepEqual(histogramStats(new Uint32Array(256)), { mean: 0, std: 0, median: 0, count: 0 });
});

test("histogramStats: 단일 값이면 표준편차 0, 중앙값=그 값", () => {
  const bins = new Uint32Array(256); bins[37] = 10;
  const s = histogramStats(bins);
  assert.equal(s.mean, 37); assert.equal(s.std, 0); assert.equal(s.median, 37);
});

test("computeHistogram: 채널별 집계·광도·투명 픽셀 제외", () => {
  const img = makeImageData(2, 2, [255, 0, 0, 255]);
  setPixel(img, 1, 0, [0, 255, 0, 255]);
  setPixel(img, 0, 1, [10, 20, 30, 0]);       // 투명 → 제외
  setPixel(img, 1, 1, [128, 128, 128, 255]);
  const h = computeHistogram(img.data, 2, 2);
  assert.equal(h.pixels, 3);
  assert.equal(h.r[255], 1); assert.equal(h.r[0], 1); assert.equal(h.r[128], 1);
  assert.equal(h.g[255], 1); assert.equal(h.b[0], 2);
  assert.equal(h.lum[Math.round(0.299 * 255)], 1);   // 빨강 광도 76
  assert.equal(h.lum[Math.round(0.587 * 255)], 1);   // 초록 광도 150
  assert.equal(h.lum[128], 1);
  assert.equal(h.r[10], 0); // 투명 픽셀은 어느 채널에도 없음
});

test("computeHistogram: 선택 마스크(128 이상만 포함)", () => {
  const img = makeImageData(2, 1, [50, 50, 50, 255]);
  setPixel(img, 1, 0, [200, 200, 200, 255]);
  const mask = new Uint8Array([255, 100]);
  const h = computeHistogram(img.data, 2, 1, { mask, maskW: 2 });
  assert.equal(h.pixels, 1);
  assert.equal(h.r[50], 1); assert.equal(h.r[200], 0);
});

test("channelBins: rgb는 세 채널 합", () => {
  const img = makeImageData(1, 1, [10, 20, 10, 255]);
  const h = computeHistogram(img.data, 1, 1);
  const rgb = channelBins(h, "rgb");
  assert.equal(rgb[10], 2); assert.equal(rgb[20], 1);
  assert.equal(histogramStats(rgb).count, 3);
  assert.equal(channelBins(h, "g"), h.g);
});

test("sampleSize: 상한 이하면 그대로, 넘으면 비율 유지 축소", () => {
  assert.deepEqual(sampleSize(100, 100, 20000), { w: 100, h: 100, factor: 1 });
  const s = sampleSize(4000, 3000, 1_000_000);
  assert.ok(s.w * s.h <= 1_000_000);
  near(s.w / s.h, 4 / 3, 0.01);
});

// ── HSB ──
test("rgbToHsb: 대표 색", () => {
  assert.deepEqual(rgbToHsb(255, 0, 0), { h: 0, s: 100, b: 100 });
  assert.deepEqual(rgbToHsb(0, 255, 0), { h: 120, s: 100, b: 100 });
  assert.deepEqual(rgbToHsb(0, 0, 255), { h: 240, s: 100, b: 100 });
  assert.deepEqual(rgbToHsb(128, 128, 128), { h: 0, s: 0, b: 50 });
  assert.deepEqual(rgbToHsb(0, 0, 0), { h: 0, s: 0, b: 0 });
  assert.deepEqual(rgbToHsb(255, 0, 255), { h: 300, s: 100, b: 100 });
});

// ── 스냅 ──
test("snapThreshold: 화면 8px을 줌으로 환산", () => {
  assert.equal(SNAP_SCREEN_PX, 8);
  assert.equal(snapThreshold(1), 8);
  assert.equal(snapThreshold(2), 4);
  assert.equal(snapThreshold(0.5), 16);
});

test("nearestOnAxis: 이산 좌표와 격자 중 가장 가까운 대상", () => {
  assert.deepEqual(nearestOnAxis(47, { lines: [0, 100], step: 0 }), { target: 0, dist: 47 });
  assert.deepEqual(nearestOnAxis(47, { lines: [0, 100], step: 32 }), { target: 32, dist: 15 });
  assert.deepEqual(nearestOnAxis(98, { lines: [100], step: 32 }), { target: 100, dist: 2 });
  assert.equal(nearestOnAxis(5, { lines: [], step: 0 }), null);
});

test("snapAxis: 여러 기준값 중 가장 가까운 것을 선택, 임계값 밖이면 null", () => {
  const axis = { lines: [100, 300], step: 0 };
  // 왼쪽 95(거리5) vs 오른쪽 297(거리3) → 오른쪽이 이김, delta=+3
  assert.deepEqual(snapAxis([95, 297], axis, 8), { delta: 3, target: 300, value: 297 });
  assert.equal(snapAxis([150], axis, 8), null);
  // 임계값 경계 포함
  assert.deepEqual(snapAxis([108], axis, 8), { delta: -8, target: 100, value: 108 });
  assert.equal(snapAxis([108.5], axis, 8), null);
});

test("snapPoint: 축별 독립 스냅", () => {
  const t = buildSnapTargets({ guides: [{ orient: "v", pos: 50 }, { orient: "h", pos: 200 }], useBounds: false, useGrid: false });
  assert.deepEqual(snapPoint(53, 120, t, 8), { x: 50, y: 120, snappedX: true, snappedY: false });
  assert.deepEqual(snapPoint(10, 196, t, 8), { x: 10, y: 200, snappedX: false, snappedY: true });
});

test("snapBox: 가장자리·중앙 스냅 이동량", () => {
  const t = buildSnapTargets({ docW: 400, docH: 300, useGuides: false, useGrid: false });
  // 상자 x=5..55 → 왼쪽이 0에 거리5 → dx=-5. y 중앙 147 → 150에 거리3 → dy=+3
  assert.deepEqual(snapBox({ x: 5, y: 122, w: 50, h: 50 }, t, 8), { dx: -5, dy: 3, snappedX: true, snappedY: true });
  assert.deepEqual(snapBox({ x: 100, y: 60, w: 20, h: 20 }, t, 8), { dx: 0, dy: 0, snappedX: false, snappedY: false });
  assert.deepEqual(snapBox({ x: 1, y: 1, w: 1, h: 1 }, null, 8), { dx: 0, dy: 0, snappedX: false, snappedY: false });
});

test("buildSnapTargets: 옵션별 대상 구성·드래그 중 가이드 제외", () => {
  const g1 = { orient: "v", pos: 10 }, g2 = { orient: "h", pos: 20 };
  const t = buildSnapTargets({ guides: [g1, g2], gridStep: 16, docW: 100, docH: 80, exclude: g1 });
  assert.deepEqual(t.x.lines, [0, 50, 100]);
  assert.deepEqual(t.y.lines, [20, 0, 40, 80]);
  assert.equal(t.x.step, 16);
  const none = buildSnapTargets({ guides: [g1], gridStep: 16, docW: 100, docH: 80, useGuides: false, useGrid: false, useBounds: false });
  assert.deepEqual(none, { x: { lines: [], step: 0 }, y: { lines: [], step: 0 } });
});

test("스냅: 격자 대상은 가장 가까운 배수", () => {
  const t = buildSnapTargets({ gridStep: 25, useGuides: false, useBounds: false });
  assert.deepEqual(snapPoint(73, 38, t, 3), { x: 75, y: 38, snappedX: true, snappedY: false });
});

// ── 내비게이터 ──
test("navLayout: 비율 유지로 상자에 맞춤", () => {
  assert.deepEqual(navLayout(800, 600, 200, 150), { w: 200, h: 150, scale: 0.25 });
  const L = navLayout(1000, 250, 200, 150);
  assert.equal(L.scale, 0.2); assert.equal(L.w, 200); assert.equal(L.h, 50);
  assert.deepEqual(navLayout(0, 10, 200, 150), { w: 0, h: 0, scale: 0 });
});

test("viewRectOnThumb: 뷰포트 → 썸네일 사각형", () => {
  // 줌 2, 팬(-200,-100), 화면 400×300 → 문서 (100,50)~(300,200) 보임
  const vp = { zoom: 2, panX: -200, panY: -100, cssW: 400, cssH: 300 };
  const { raw, clipped } = viewRectOnThumb(vp, 0.25, 200, 150);
  assert.deepEqual(raw, { x: 25, y: 12.5, w: 50, h: 37.5 });
  assert.deepEqual(clipped, raw);
});

test("viewRectOnThumb: 썸네일 밖은 잘리고, 겹침 없으면 null", () => {
  // 축소 상태: 문서가 화면 가운데(팬 +100) → 사각형이 썸네일보다 큼
  const r = viewRectOnThumb({ zoom: 0.5, panX: 100, panY: 50, cssW: 600, cssH: 400 }, 0.25, 200, 150);
  assert.deepEqual(r.raw, { x: -50, y: -25, w: 300, h: 200 });
  assert.deepEqual(r.clipped, { x: 0, y: 0, w: 200, h: 150 });
  const far = viewRectOnThumb({ zoom: 1, panX: -5000, panY: 0, cssW: 100, cssH: 100 }, 0.25, 200, 150);
  assert.equal(far.clipped, null);
});

test("thumbToDoc + panForCenter: 썸네일 점을 화면 중앙으로 (왕복)", () => {
  const d = thumbToDoc(50, 30, 0.25);
  assert.deepEqual(d, { x: 200, y: 120 });
  const p = panForCenter(d.x, d.y, 2, 400, 300);
  assert.deepEqual(p, { panX: -200, panY: -90 });
  // 그 팬으로 다시 사각형을 구하면 중심이 썸네일 점과 같다
  const { raw } = viewRectOnThumb({ zoom: 2, panX: p.panX, panY: p.panY, cssW: 400, cssH: 300 }, 0.25, 200, 150);
  near(raw.x + raw.w / 2, 50); near(raw.y + raw.h / 2, 30);
});

test("zoomToSlider/sliderToZoom: 로그 눈금 양끝·왕복", () => {
  assert.equal(zoomToSlider(0.05, 0.05, 32), 0);
  assert.equal(zoomToSlider(32, 0.05, 32), SLIDER_MAX);
  assert.equal(zoomToSlider(1000, 0.05, 32), SLIDER_MAX); // 범위 밖 클램프
  near(sliderToZoom(0, 0.05, 32), 0.05);
  near(sliderToZoom(SLIDER_MAX, 0.05, 32), 32, 1e-9);
  for (const z of [0.1, 0.5, 1, 2, 8]) near(sliderToZoom(zoomToSlider(z, 0.05, 32), 0.05, 32), z, z * 0.01);
});

// ── 이동 도구 스냅 기준 상자 ──
test("opaqueBounds: 불투명 픽셀 경계, 전부 투명이면 null", () => {
  const img = makeImageData(5, 4, [0, 0, 0, 0]);
  assert.equal(opaqueBounds(img), null);
  setPixel(img, 1, 2, [1, 1, 1, 255]);
  setPixel(img, 3, 1, [1, 1, 1, 10]);
  assert.deepEqual(opaqueBounds(img), { x: 1, y: 1, w: 3, h: 2 });
});
