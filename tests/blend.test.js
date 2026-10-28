// blend.js 단위테스트 — 레이어 블렌드 모드 27종 메타데이터/검증 함수만 대상으로 한다.
// (커스텀 per-pixel 수식은 순수 ImageData API blendImageData 로 tests/adjust-ext.test.js 에서 검증)
// buildEffectiveSource/clipAlphaByAlpha/blendLayerOnto는 내부에서 document.createElement,
// canvas.getContext 등 DOM/Canvas API를 직접 호출하므로 Node 환경에서 테스트할 수 없어 제외한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLEND_MODES, isValidBlendMode, normalizeBlendMode, blendModeLabel } from "../js/engine/blend.js";

test("BLEND_MODES: PS7 22종 + 확장 5종 = 27종(구분선 제외)이 등록되어 있다", () => {
  const ids = BLEND_MODES.filter((m) => !m.sep).map((m) => m.id);
  assert.equal(ids.length, 27);
  assert.equal(new Set(ids).size, 27); // 중복 없음
});

test("BLEND_MODES: 확장 5종(하드 혼합·어두운 색상·밝은 색상·빼기·나누기)이 유효 모드다", () => {
  for (const id of ["hard-mix", "darker-color", "lighter-color", "subtract", "divide"]) {
    assert.equal(isValidBlendMode(id), true, id);
    assert.equal(normalizeBlendMode(id), id, id);
  }
});

test("isValidBlendMode: 등록된 id는 true, 모르는 값은 false", () => {
  assert.equal(isValidBlendMode("multiply"), true);
  assert.equal(isValidBlendMode("hard-mix"), true); // PS7엔 없었지만 확장 모드로 추가됨
  assert.equal(isValidBlendMode("behind"), false);  // 페인팅 전용 모드는 레이어 모드가 아님
  assert.equal(isValidBlendMode(""), false);
  assert.equal(isValidBlendMode(undefined), false);
});

test("normalizeBlendMode: 유효값은 그대로, 무효값은 normal로 대체", () => {
  assert.equal(normalizeBlendMode("screen"), "screen");
  assert.equal(normalizeBlendMode("not-a-real-mode"), "normal");
  assert.equal(normalizeBlendMode(undefined), "normal");
});

test("blendModeLabel: 등록된 id는 라벨을, 모르는 id는 id 자체를 반환", () => {
  assert.equal(blendModeLabel("multiply"), "Multiply · 곱하기");
  assert.equal(blendModeLabel("unknown-mode"), "unknown-mode");
});
