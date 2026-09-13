// image-mode.js 단위테스트 — 이미지 모드 변환(grayscale/bitmap/indexed), 순수 함수(DOM 무관)
import { test } from "node:test";
import assert from "node:assert/strict";
import { toGrayscale, toBitmap, buildPalette, applyPalette, toIndexed } from "../js/engine/image-mode.js";
import { makeImageData, getPixel } from "./helpers.js";

test("toGrayscale: 순색 R=255의 가중 휘도(0.299*255=76.245 → |0 절삭=76)", () => {
  const img = makeImageData(1, 1, [255, 0, 0, 200]);
  toGrayscale(img);
  const [r, g, b, a] = getPixel(img, 0, 0);
  assert.equal(r, 76); assert.equal(g, 76); assert.equal(b, 76);
  assert.equal(a, 200); // 알파는 보존
});

test("toGrayscale: 흑/백은 그대로 보존(경계값)", () => {
  const black = makeImageData(1, 1, [0, 0, 0, 255]);
  const white = makeImageData(1, 1, [255, 255, 255, 255]);
  toGrayscale(black); toGrayscale(white);
  assert.deepEqual(getPixel(black, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(getPixel(white, 0, 0), [255, 255, 255, 255]);
});

test("toBitmap(threshold): level 경계 판정", () => {
  // adjustments.test.js와 동일한 이유로 부동소수 오차 없는 값(126/129)으로 경계를 검증한다.
  // (같은 이미지를 재사용하면 첫 변환 결과가 두 번째 변환의 입력이 되어버리므로 이미지를 분리한다)
  const imgHigh = makeImageData(1, 1, [126, 126, 126, 255]);
  toBitmap(imgHigh, { method: "threshold", level: 126 });
  assert.deepEqual(getPixel(imgHigh, 0, 0).slice(0, 3), [255, 255, 255]); // 휘도 126 >= 126 → 흰

  const imgLow = makeImageData(1, 1, [129, 129, 129, 255]);
  toBitmap(imgLow, { method: "threshold", level: 130 });
  assert.deepEqual(getPixel(imgLow, 0, 0).slice(0, 3), [0, 0, 0]);       // 휘도 129 < 130 → 검
});

test("toBitmap(diffusion): 단색 이미지는 오차확산 후에도 흑/백만 존재", () => {
  const img = makeImageData(4, 4, [100, 100, 100, 255]); // 임계값(128) 미만인 중간톤
  toBitmap(img, { method: "diffusion" });
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i];
    assert.ok(v === 0 || v === 255, `픽셀 값이 흑/백이 아님: ${v}`);
  }
});

test("buildPalette: 완전 투명 이미지는 흑백 2색 기본값 반환", () => {
  const img = makeImageData(2, 2, [10, 20, 30, 0]); // 알파 0 → 통계에서 제외
  const palette = buildPalette(img, 8);
  assert.deepEqual(palette, [[0, 0, 0], [255, 255, 255]]);
});

test("buildPalette: 단색 이미지는 그 색 하나로 수렴", () => {
  const img = makeImageData(4, 4, [200, 50, 10, 255]);
  const palette = buildPalette(img, 4);
  assert.ok(palette.length >= 1);
  for (const [r, g, b] of palette) {
    assert.equal(r, 200); assert.equal(g, 50); assert.equal(b, 10);
  }
});

test("applyPalette: 각 픽셀이 팔레트 중 가장 가까운 색으로 치환됨", () => {
  const img = makeImageData(1, 2, [0, 0, 0, 255]);
  img.data.set([10, 10, 10, 255, 240, 240, 240, 255]); // 검정에 가까움 / 흰색에 가까움
  const palette = [[0, 0, 0], [255, 255, 255]];
  applyPalette(img, palette, { dither: false });
  assert.deepEqual(getPixel(img, 0, 0).slice(0, 3), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 0, 1).slice(0, 3), [255, 255, 255]);
});

test("applyPalette: 빈 팔레트는 이미지를 건드리지 않는다(방어 가드)", () => {
  const img = makeImageData(1, 1, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  applyPalette(img, [], { dither: false });
  assert.deepEqual(img.data, original);
});

test("toIndexed: 팔레트 생성+매핑을 한 번에 수행하고 palette를 반환", () => {
  const img = makeImageData(2, 2, [100, 100, 100, 255]);
  const { palette } = toIndexed(img, { colors: 2 });
  assert.ok(Array.isArray(palette) && palette.length >= 1);
});
