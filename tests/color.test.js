// color.js 단위테스트 — 색상 변환 순수 함수(DOM 무관)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, rgbToHex, rgbaStr, rgbToHsl, hslToRgb, luminance } from "../js/engine/color.js";

test("hexToRgb: 6자리 hex를 rgb로 변환", () => {
  assert.deepEqual(hexToRgb("#ff0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hexToRgb("#00ff00"), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hexToRgb("#0000ff"), { r: 0, g: 0, b: 255 });
});

test("hexToRgb: 3자리 축약 hex 확장", () => {
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#000"), { r: 0, g: 0, b: 0 });
});

test("rgbToHex ↔ hexToRgb 왕복(항등)", () => {
  const hex = "#3a7fd9";
  const rgb = hexToRgb(hex);
  assert.equal(rgbToHex(rgb.r, rgb.g, rgb.b), hex);
});

test("rgbToHex: 범위 밖 값은 0~255로 clamp", () => {
  assert.equal(rgbToHex(-10, 300, 128.6), "#00ff81"); // 128.6 → round(129)=0x81
});

test("rgbaStr: 포맷 문자열", () => {
  assert.equal(rgbaStr(255, 0, 0, 0.5), "rgba(255,0,0,0.5)");
  assert.equal(rgbaStr(1.9, 2.9, 3.9), "rgba(1,2,3,1)"); // |0 은 절삭(내림)
});

test("luminance: 알려진 가중치 값(순색)", () => {
  assert.ok(Math.abs(luminance(255, 0, 0) - 76.245) < 1e-9);
  assert.ok(Math.abs(luminance(0, 255, 0) - 149.685) < 1e-9);
  assert.ok(Math.abs(luminance(0, 0, 255) - 29.07) < 1e-9);
  assert.equal(luminance(0, 0, 0), 0);
  assert.equal(luminance(255, 255, 255), 255);
});

test("rgbToHsl ↔ hslToRgb 왕복(경계값·중간값)", () => {
  for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 64, 200], [0, 0, 0], [255, 255, 255]]) {
    const { h, s, l } = rgbToHsl(r, g, b);
    const back = hslToRgb(h, s, l);
    // 부동소수 반올림 오차 허용(±1)
    assert.ok(Math.abs(back.r - r) <= 1, `r: ${back.r} vs ${r}`);
    assert.ok(Math.abs(back.g - g) <= 1, `g: ${back.g} vs ${g}`);
    assert.ok(Math.abs(back.b - b) <= 1, `b: ${back.b} vs ${b}`);
  }
});

test("rgbToHsl: 무채색(회색)은 채도 0", () => {
  const { s } = rgbToHsl(128, 128, 128);
  assert.equal(s, 0);
});
