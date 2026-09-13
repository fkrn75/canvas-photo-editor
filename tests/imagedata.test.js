// imagedata.js 단위테스트 — ImageData/경계상자 유틸(순수 함수)
// cropImageData는 내부에서 `new ImageData(...)`를 쓰므로 helpers.js의 폴리필이 먼저 로드되어야 한다.
import "./helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newBounds, expandBounds, boundsToBox, clampBox, cropImageData } from "../js/engine/imagedata.js";
import { makeImageData } from "./helpers.js";

test("newBounds: 초기값은 빈 경계(Infinity)", () => {
  const b = newBounds();
  assert.equal(boundsToBox(b), null); // 점을 하나도 누적하지 않으면 박스 없음
});

test("expandBounds + boundsToBox: 점 하나만 누적", () => {
  const b = newBounds();
  expandBounds(b, 10, 20);
  assert.deepEqual(boundsToBox(b), { x: 10, y: 20, w: 0, h: 0 });
});

test("expandBounds: 반경(r)을 반영해 브러시 두께만큼 확장", () => {
  const b = newBounds();
  expandBounds(b, 10, 10, 5);
  assert.deepEqual(boundsToBox(b), { x: 5, y: 5, w: 10, h: 10 });
});

test("expandBounds: 여러 점 누적 시 전체를 포함하는 최소 박스", () => {
  const b = newBounds();
  expandBounds(b, 0, 0);
  expandBounds(b, 10, 5);
  expandBounds(b, -3, 8);
  assert.deepEqual(boundsToBox(b), { x: -3, y: 0, w: 13, h: 8 });
});

test("clampBox: 범위 안 박스는 그대로", () => {
  assert.deepEqual(clampBox({ x: 1, y: 1, w: 5, h: 5 }, 100, 100), { x: 1, y: 1, w: 5, h: 5 });
});

test("clampBox: 캔버스 경계를 넘는 박스는 잘라낸다", () => {
  assert.deepEqual(clampBox({ x: -5, y: -5, w: 10, h: 10 }, 8, 8), { x: 0, y: 0, w: 5, h: 5 });
});

test("clampBox: 완전히 범위 밖이면 null", () => {
  assert.equal(clampBox({ x: 100, y: 100, w: 10, h: 10 }, 50, 50), null);
});

test("clampBox: 폭/높이가 0 이하가 되면 null(경계값)", () => {
  assert.equal(clampBox({ x: 10, y: 10, w: 0, h: 0 }, 50, 50), null);
});

test("cropImageData: 지정한 box 영역만 정확히 잘라낸다", () => {
  const src = makeImageData(4, 4, [0, 0, 0, 255]);
  // (1,1) 픽셀만 흰색으로 표시
  const i = (1 * 4 + 1) * 4;
  src.data[i] = src.data[i + 1] = src.data[i + 2] = 255;
  const cropped = cropImageData(src, { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(cropped.width, 2);
  assert.equal(cropped.height, 2);
  // 잘라낸 이미지의 (0,0)이 원본의 (1,1)과 같아야 함
  assert.deepEqual([cropped.data[0], cropped.data[1], cropped.data[2]], [255, 255, 255]);
  // 나머지 3픽셀은 검정 유지
  assert.deepEqual([cropped.data[4], cropped.data[5], cropped.data[6]], [0, 0, 0]);
});
