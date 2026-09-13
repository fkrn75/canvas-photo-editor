// blur.js 단위테스트 — StackBlur(순수 함수, DOM 무관). filters.js가 내부에서 사용.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stackBlur } from "../js/engine/blur.js";
import { makeImageData } from "./helpers.js";

test("stackBlur: radius=0은 항등(radius<1 가드)", () => {
  const img = makeImageData(4, 4, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  stackBlur(img, 0);
  assert.deepEqual(img.data, original);
});

test("stackBlur: radius가 음수여도 항등(radius<1 가드)", () => {
  const img = makeImageData(4, 4, [10, 20, 30, 255]);
  const original = Uint8ClampedArray.from(img.data);
  stackBlur(img, -5);
  assert.deepEqual(img.data, original);
});

test("stackBlur: radius>254는 254로 clamp되어 NaN/크래시 없이 동작(2026-06-15 감사 수정 검증)", () => {
  const img = makeImageData(6, 6, [200, 150, 50, 255]);
  stackBlur(img, 1000); // MUL[1000]/SHG[1000]은 undefined → 클램프 없으면 NaN
  for (let i = 0; i < img.data.length; i++) {
    assert.ok(Number.isFinite(img.data[i]), `NaN 발견 at index ${i}`);
    assert.ok(img.data[i] >= 0 && img.data[i] <= 255);
  }
});

test("stackBlur: 단색 이미지는 블러 후에도 같은 색(경계 반사로 값 보존)", () => {
  const img = makeImageData(5, 5, [77, 88, 99, 255]);
  stackBlur(img, 3);
  for (let i = 0; i < img.data.length; i += 4) {
    // 라운딩 오차 허용
    assert.ok(Math.abs(img.data[i] - 77) <= 1);
    assert.ok(Math.abs(img.data[i + 1] - 88) <= 1);
    assert.ok(Math.abs(img.data[i + 2] - 99) <= 1);
  }
});

test("stackBlur: 밝은 점 하나는 흐려져 이웃 픽셀로 값이 퍼진다", () => {
  const img = makeImageData(5, 5, [0, 0, 0, 255]);
  const c = (2 * 5 + 2) * 4; // 중앙 픽셀
  img.data[c] = 255;
  stackBlur(img, 2);
  // 중앙은 원래보다 어두워지고, 인접 픽셀은 원래(0)보다 밝아져야 한다
  assert.ok(img.data[c] < 255);
  const neighbor = (2 * 5 + 3) * 4;
  assert.ok(img.data[neighbor] > 0);
});
