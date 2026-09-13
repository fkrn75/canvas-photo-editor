// floodfill.js 단위테스트 — 스캔라인 flood fill(재귀 없음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { floodFill } from "../js/engine/floodfill.js";
import { makeImageData } from "./helpers.js";

// 3x3, 가운데 십자만 흰색(255) 나머지는 검정(0)인 테스트 이미지를 만든다.
function crossImage() {
  const img = makeImageData(3, 3, [0, 0, 0, 255]);
  for (const [x, y] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) {
    const i = (y * 3 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
  }
  return img;
}

test("floodFill: 허용오차 0 — 시작점과 정확히 같은 색만 채움(인접)", () => {
  const img = crossImage();
  const { mask, bounds } = floodFill(img.data, 3, 3, 1, 1, 0, true);
  // 십자 모양(5픽셀)만 채워져야 함
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  assert.equal(count, 5);
  assert.ok(bounds); // 경계 존재
});

test("floodFill: 허용오차 255 — 인접 모드라도 전체가 이어져 있으면 전부 채움", () => {
  const img = makeImageData(3, 3, [0, 0, 0, 255]);
  const { mask } = floodFill(img.data, 3, 3, 0, 0, 255, true);
  const count = mask.reduce((a, b) => a + (b ? 1 : 0), 0);
  assert.equal(count, 9);
});

test("floodFill: 시작점이 캔버스 범위 밖이면 빈 마스크와 bounds=null", () => {
  const img = makeImageData(3, 3, [0, 0, 0, 255]);
  const { mask, bounds } = floodFill(img.data, 3, 3, -1, 0, 10, true);
  assert.equal(mask.reduce((a, b) => a + b, 0), 0);
  assert.equal(bounds, null);
});

test("floodFill: contiguous=false(전역 모드)는 인접 여부와 무관하게 색이 맞으면 전부 선택", () => {
  const img = crossImage(); // 십자(흰) + 모서리(검) 분리된 영역
  const { mask } = floodFill(img.data, 3, 3, 0, 0, 0, false); // 시작점(0,0)=검정, 인접 아닌 모서리까지 전부
  // 모서리 4개(검정, 서로 안 이어짐)가 전역 모드로 모두 선택되어야 함
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  assert.equal(count, 4);
});

test("floodFill: 인접 모드는 색이 같아도 떨어진 영역은 채우지 않는다", () => {
  const img = crossImage();
  const { mask } = floodFill(img.data, 3, 3, 0, 0, 0, true); // 모서리 검정 1개만, 다른 모서리와 안 이어짐(대각선 미인접)
  const count = mask.reduce((a, b) => a + (b ? 1 : 0), 0);
  assert.equal(count, 1);
});

test("floodFill: bounds가 채워진 영역의 최소 사각형을 정확히 반환", () => {
  const img = crossImage();
  const { bounds } = floodFill(img.data, 3, 3, 1, 1, 0, true);
  assert.deepEqual(bounds, { x: 0, y: 0, w: 3, h: 3 }); // 십자는 3x3 전체에 걸침
});
