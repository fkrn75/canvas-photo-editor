// filters.js 단위테스트 — 이미지 필터(모두 ImageData 제자리 수정), 순수 함수(DOM 무관)
// unsharpMask/highPass는 내부에서 `new ImageData(...)`를 쓰므로 helpers.js 폴리필을 먼저 로드한다.
import "./helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { gaussianBlur, sharpen, addNoise, sepia, unsharpMask, motionBlur, median, mosaic, findEdges, highPass } from "../js/engine/filters.js";
import { makeImageData, getPixel } from "./helpers.js";

test("gaussianBlur: radius=0은 항등(blur.js의 radius<1 가드)", () => {
  const img = makeImageData(3, 3, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  gaussianBlur(img, 0);
  assert.deepEqual(img.data, original);
});

test("sharpen: amount=0은 항등 컨벌루션(중앙 가중치 1, 나머지 0)", () => {
  const img = makeImageData(3, 3, [50, 100, 150, 255]);
  const original = Uint8ClampedArray.from(img.data);
  sharpen(img, 0);
  assert.deepEqual(img.data, original);
});

test("addNoise: amount=0은 항등(난수 진폭이 0이라 변화 없음)", () => {
  const img = makeImageData(2, 2, [50, 100, 150, 255]);
  const original = Uint8ClampedArray.from(img.data);
  addNoise(img, 0, true);
  assert.deepEqual(img.data, original);
});

test("sepia: 검정/흰색 경계값", () => {
  const black = makeImageData(1, 1, [0, 0, 0, 255]);
  const white = makeImageData(1, 1, [255, 255, 255, 255]);
  sepia(black); sepia(white);
  assert.deepEqual(getPixel(black, 0, 0).slice(0, 3), [0, 0, 0]);
  // 흰색 세피아: R=(0.393+0.769+0.189)*255=344.5→255(clamp), G=(0.349+0.686+0.168)*255=306.8→255(clamp),
  // B=(0.272+0.534+0.131)*255=238.9→239(반올림)
  assert.deepEqual(getPixel(white, 0, 0).slice(0, 3), [255, 255, 239]);
});

test("unsharpMask: amount=0은 항등(고주파 가산량이 0)", () => {
  const img = makeImageData(4, 4, [80, 90, 100, 255]);
  const original = Uint8ClampedArray.from(img.data);
  unsharpMask(img, 0, 2, 0);
  assert.deepEqual(img.data, original);
});

test("motionBlur: distance=1(단일 픽셀 평균)은 항등", () => {
  const img = makeImageData(3, 3, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  motionBlur(img, 0, 1);
  assert.deepEqual(img.data, original);
});

test("median: 단색 이미지는 중앙값 필터를 적용해도 변화 없음", () => {
  const img = makeImageData(5, 5, [77, 88, 99, 255]);
  const original = Uint8ClampedArray.from(img.data);
  median(img, 1);
  assert.deepEqual(img.data, original);
});

test("mosaic: 셀 크기가 이미지 전체를 덮으면 평균색 단색으로 변한다", () => {
  const img = makeImageData(1, 2, [0, 0, 0, 255]);
  img.data.set([0, 0, 0, 255, 100, 100, 100, 255]); // 평균 = 50
  mosaic(img, 10); // cell(10) > 이미지 크기(1x2) → 전체가 한 셀
  assert.deepEqual(getPixel(img, 0, 0).slice(0, 3), [50, 50, 50]);
  assert.deepEqual(getPixel(img, 0, 1).slice(0, 3), [50, 50, 50]);
});

test("findEdges: 단색(평탄) 이미지는 엣지가 없어 전부 0", () => {
  const img = makeImageData(4, 4, [123, 123, 123, 255]);
  findEdges(img);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], 0);
    assert.equal(img.data[i + 1], 0);
    assert.equal(img.data[i + 2], 0);
  }
});

test("highPass: radius=0(블러 항등)이면 원본-블러=0 → 전부 중간회색(128)", () => {
  const img = makeImageData(3, 3, [40, 90, 200, 255]);
  highPass(img, 0);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], 128);
    assert.equal(img.data[i + 1], 128);
    assert.equal(img.data[i + 2], 128);
  }
});
