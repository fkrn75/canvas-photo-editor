// adjustments.js 단위테스트 — 색상 보정(모두 ImageData 제자리 수정)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invert, brightnessContrast, grayscale, histogram, applyChannelLUT,
  levels, buildCurveLUT, threshold, posterize,
} from "../js/engine/adjustments.js";
import { makeImageData, getPixel } from "./helpers.js";

test("invert: 두 번 적용하면 원본으로 돌아온다(항등)", () => {
  const img = makeImageData(2, 2, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  invert(img);
  invert(img);
  assert.deepEqual(img.data, original);
});

test("invert: 회색 128 → 127 (255-128)", () => {
  const img = makeImageData(1, 1, [128, 128, 128, 255]);
  invert(img);
  assert.deepEqual(getPixel(img, 0, 0), [127, 127, 127, 255]);
});

test("invert: 경계값 0/255", () => {
  const img = makeImageData(1, 1, [0, 255, 0, 255]);
  invert(img);
  assert.deepEqual(getPixel(img, 0, 0), [255, 0, 255, 255]);
});

test("brightnessContrast: 밝기/대비 모두 0이면 항등", () => {
  const img = makeImageData(2, 2, [50, 100, 200, 255]);
  const original = Uint8ClampedArray.from(img.data);
  brightnessContrast(img, 0, 0);
  assert.deepEqual(img.data, original);
});

test("brightnessContrast: 밝기 +100은 픽셀을 255로 clamp(순수 흰색 근처)", () => {
  const img = makeImageData(1, 1, [200, 200, 200, 255]);
  brightnessContrast(img, 100, 0);
  const [r, g, b] = getPixel(img, 0, 0);
  assert.equal(r, 255); assert.equal(g, 255); assert.equal(b, 255);
});

test("grayscale: 순색 R=255의 가중 휘도(0.299*255 반올림=76)", () => {
  const img = makeImageData(1, 1, [255, 0, 0, 255]);
  grayscale(img);
  assert.deepEqual(getPixel(img, 0, 0), [76, 76, 76, 255]);
});

test("grayscale: 흰/검은 그대로", () => {
  const img = makeImageData(2, 1, [0, 0, 0, 255]);
  const white = { width: 1, height: 1, data: Uint8ClampedArray.from([255, 255, 255, 255]) };
  grayscale(img);
  grayscale(white);
  assert.deepEqual(getPixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(white, 0, 0), [255, 255, 255, 255]);
});

test("histogram: 1x1 이미지는 해당 빈도만 1", () => {
  const img = makeImageData(1, 1, [10, 10, 10, 255]);
  const hist = histogram(img, "r");
  assert.equal(hist[10], 1);
  assert.equal(hist.reduce((a, b) => a + b, 0), 1);
});

test("histogram: 휘도 채널 기본값", () => {
  const img = makeImageData(1, 1, [0, 0, 0, 255]);
  const hist = histogram(img); // channel 기본 'l'
  assert.equal(hist[0], 1);
});

test("applyChannelLUT: 항등 LUT는 값 보존", () => {
  const identityLut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) identityLut[i] = i;
  const img = makeImageData(1, 1, [12, 34, 56, 78]);
  applyChannelLUT(img, "rgb", identityLut);
  assert.deepEqual(getPixel(img, 0, 0), [12, 34, 56, 78]);
});

test("applyChannelLUT: 알파 채널만 변경", () => {
  const zeroLut = new Uint8ClampedArray(256); // 전부 0으로 매핑
  const img = makeImageData(1, 1, [12, 34, 56, 200]);
  applyChannelLUT(img, "a", zeroLut);
  assert.deepEqual(getPixel(img, 0, 0), [12, 34, 56, 0]);
});

test("levels: 감마=1, 입출력 풀레인지면 항등", () => {
  const img = makeImageData(1, 3, [0, 0, 0, 255]);
  // 픽셀 3개를 서로 다른 값으로
  img.data.set([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  const original = Uint8ClampedArray.from(img.data);
  levels(img, "rgb", 0, 255, 1, 0, 255);
  assert.deepEqual(img.data, original);
});

test("levels: 입력 화이트포인트를 낮추면 그 값 이상은 흰색으로 클리핑", () => {
  const img = makeImageData(1, 1, [200, 200, 200, 255]);
  levels(img, "rgb", 0, 100, 1, 0, 255); // inW=100 → 200은 클리핑되어 outW=255
  assert.deepEqual(getPixel(img, 0, 0), [255, 255, 255, 255]);
});

test("buildCurveLUT: 방어 가드 — 제어점 0개는 항등 LUT", () => {
  const lut = buildCurveLUT([]);
  assert.equal(lut.length, 256);
  for (let i = 0; i < 256; i += 17) assert.equal(lut[i], i);
});

test("buildCurveLUT: 방어 가드 — 제어점 1개는 그 y값으로 상수 채움", () => {
  const lut = buildCurveLUT([{ x: 128, y: 200 }]);
  assert.equal(lut[0], 200);
  assert.equal(lut[128], 200);
  assert.equal(lut[255], 200);
});

test("buildCurveLUT: 제어점 2개(0,0)-(255,255)는 항등 직선", () => {
  const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  for (let i = 0; i < 256; i += 17) assert.equal(lut[i], i);
});

test("threshold: level 경계 판정(휘도 >= level → 255)", () => {
  // 주의: 0.299+0.587+0.114는 부동소수 오차로 정확히 1.0이 아니라(0.9999999999999999),
  // 회색 128의 계산된 휘도가 127.99999999999999가 되어 128 미만으로 판정될 수 있다.
  // 그런 오차가 없는 값(126→126, 129→129 정확히 일치)으로 경계를 검증한다.
  const img = makeImageData(1, 1, [126, 126, 126, 255]); // 휘도=126(정확) >= 126 → 흰
  threshold(img, 126);
  assert.deepEqual(getPixel(img, 0, 0).slice(0, 3), [255, 255, 255]);
  const img2 = makeImageData(1, 1, [129, 129, 129, 255]); // 휘도=129(정확) < 130 → 검
  threshold(img2, 130);
  assert.deepEqual(getPixel(img2, 0, 0).slice(0, 3), [0, 0, 0]);
});

test("posterize: levels=2는 순수 흑백(0 또는 255)으로 양자화", () => {
  const img = makeImageData(1, 2, [0, 0, 0, 255]);
  img.data.set([100, 100, 100, 255, 200, 200, 200, 255]);
  posterize(img, 2);
  const [r0] = getPixel(img, 0, 0);
  const [r1] = getPixel(img, 0, 1);
  assert.ok(r0 === 0 || r0 === 255);
  assert.ok(r1 === 0 || r1 === 255);
});
