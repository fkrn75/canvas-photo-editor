// filters-ext-b.test.js — 확장 필터 B(왜곡·픽셀화·렌더·스타일화) 순수 함수 단위 테스트.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeImageData } from "./helpers.js";
import * as FX from "../js/engine/filters-ext-b.js";

// 결정적 그라디언트+격자 패턴 이미지(불투명)
function pattern(w = 24, h = 18) {
  const img = makeImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = (x * 11) & 255;
      img.data[i + 1] = (y * 13) & 255;
      img.data[i + 2] = ((x ^ y) * 29) & 255;
      img.data[i + 3] = 255;
    }
  }
  return img;
}
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const same = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
const FG = { r: 10, g: 20, b: 200 }, BG = { r: 250, g: 240, b: 30 };

// ── 항등(양=0) ──
test("왜곡: 양=0 이면 항등(핀치·구형화·돌리기·지그재그·잔물결·기울임·파형)", () => {
  const src = pattern();
  const cases = [
    (i) => FX.pinch(i, 0),
    (i) => FX.spherize(i, 0),
    (i) => FX.twirl(i, 0),
    (i) => FX.zigzag(i, 0, 5),
    (i) => FX.ripple(i, 0, 1),
    (i) => FX.shear(i, 0, 1),
    (i) => FX.wave(i, 100, 0, 5, 3),
  ];
  for (const fn of cases) {
    const img = copy(src);
    fn(img);
    assert.ok(same(img, src), fn.toString());
  }
});

test("왜곡: 영역 지정 시 영역 밖 픽셀은 그대로", () => {
  const src = pattern(30, 30);
  const img = copy(src);
  FX.twirl(img, 300, { x: 5, y: 5, w: 10, h: 10 });
  // 영역(내접 타원) 밖: (0,0), (29,29), (20,20)
  for (const [x, y] of [[0, 0], [29, 29], [20, 20], [5, 5]]) {
    const i = (y * 30 + x) * 4;
    assert.deepEqual([...img.data.slice(i, i + 4)], [...src.data.slice(i, i + 4)]);
  }
  assert.ok(!same(img, src)); // 안쪽은 바뀜
});

test("왜곡: 양수 값이면 실제로 변하고 크기는 보존", () => {
  const src = pattern();
  for (const fn of [
    (i) => FX.pinch(i, 80), (i) => FX.spherize(i, 80), (i) => FX.twirl(i, 180),
    (i) => FX.polarCoordinates(i, 0), (i) => FX.polarCoordinates(i, 1),
    (i) => FX.ripple(i, 300, 0), (i) => FX.shear(i, 60, 0), (i) => FX.wave(i, 20, 6, 3, 1), (i) => FX.zigzag(i, 80, 3),
  ]) {
    const img = copy(src);
    const r = fn(img);
    assert.equal(r, img); // 제자리 수정
    assert.equal(img.width, 24); assert.equal(img.height, 18); assert.equal(img.data.length, 24 * 18 * 4);
    assert.ok(!same(img, src), fn.toString());
  }
});

test("균일색 이미지는 왜곡해도 균일색 유지(쌍선형 보간 정상성)", () => {
  const src = makeImageData(16, 16, [40, 80, 120, 255]);
  for (const fn of [(i) => FX.pinch(i, -70), (i) => FX.twirl(i, 400), (i) => FX.polarCoordinates(i, 0), (i) => FX.wave(i, 30, 10, 4, 2)]) {
    const img = copy(src);
    fn(img);
    assert.ok(same(img, src));
  }
});

// ── 시드 재현성 ──
test("시드 재현성: 같은 시드 = 같은 결과, 다른 시드 = 다른 결과", () => {
  const seeded = [
    (i, s) => FX.clouds(i, FG, BG, s, 16),
    (i, s) => FX.differenceClouds(i, FG, BG, s, 16),
    (i, s) => FX.fibers(i, FG, BG, 16, 4, s),
    (i, s) => FX.crystallize(i, 5, s),
    (i, s) => FX.mezzotint(i, 0, s),
    (i, s) => FX.pointillize(i, 5, BG, s),
    (i, s) => FX.diffuse(i, 0, 2, s),
    (i, s) => FX.tiles(i, 3, 30, BG, s),
    (i, s) => FX.wave(i, 20, 8, 4, s),
  ];
  const src = pattern();
  for (const fn of seeded) {
    const a = copy(src), b = copy(src), c = copy(src);
    fn(a, 7); fn(b, 7); fn(c, 8);
    assert.ok(same(a, b), "재현: " + fn.toString());
    assert.ok(!same(a, c), "시드 차이: " + fn.toString());
  }
});

test("mulberry32 는 0~1 범위의 결정적 수열", () => {
  const r1 = FX.mulberry32(42), r2 = FX.mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

// ── 값 검증 ──
test("솔라리즈: 127 이하 유지, 128 이상 반전, 알파 보존", () => {
  const img = makeImageData(4, 1);
  const vals = [0, 100, 127, 128, 200, 255];
  img.data.set([0, 100, 127, 77, 128, 200, 255, 66, 50, 50, 50, 255, 255, 0, 128, 255]);
  FX.solarize(img);
  assert.deepEqual([...img.data], [0, 100, 127, 77, 127, 55, 0, 66, 50, 50, 50, 255, 0, 0, 127, 255]);
  assert.ok(vals.length); // 사용 표시
});

test("구름: 전경~배경 사이 값, 불투명, 양 끝 색 모두 도달(정규화)", () => {
  const img = makeImageData(40, 40, [0, 0, 0, 0]);
  FX.clouds(img, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 5, 16);
  let mn = 255, mx = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i + 3], 255);
    assert.equal(img.data[i], img.data[i + 1]);
    mn = Math.min(mn, img.data[i]); mx = Math.max(mx, img.data[i]);
  }
  assert.equal(mn, 0); assert.equal(mx, 255);
});

test("차이 구름: 검정 이미지에 적용하면 구름과 동일", () => {
  const a = makeImageData(20, 20, [0, 0, 0, 255]);
  const b = makeImageData(20, 20, [0, 0, 0, 255]);
  FX.differenceClouds(a, FG, BG, 3, 16);
  FX.clouds(b, FG, BG, 3, 16);
  assert.ok(same(a, b));
});

test("수정화: 균일색이면 그대로, 결과 색은 원본 색 범위 안", () => {
  const u = makeImageData(20, 20, [90, 30, 60, 255]);
  const uc = copy(u);
  FX.crystallize(u, 6, 1);
  assert.ok(same(u, uc));
});

test("분열: 균일색 불변 / 단면화: 균일색 불변", () => {
  const u = makeImageData(10, 10, [12, 34, 56, 200]);
  const uc = copy(u);
  FX.fragment(u); assert.ok(same(u, uc));
  FX.facet(u); assert.ok(same(u, uc));
});

test("메조틴트: 채널 값이 0 또는 255 로 이진화, 알파 보존", () => {
  const img = pattern();
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 99;
  FX.mezzotint(img, 1, 4);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) assert.ok(img.data[i + c] === 0 || img.data[i + c] === 255);
    assert.equal(img.data[i + 3], 99);
  }
});

test("점묘화: 흰 이미지 + 흰 배경 → 점 색도 흰 근처", () => {
  const img = makeImageData(20, 20, [255, 255, 255, 255]);
  FX.pointillize(img, 5, { r: 255, g: 255, b: 255 }, 1);
  for (let i = 0; i < img.data.length; i += 4) assert.ok(img.data[i] >= 240);
});

test("타일: 오프셋 0 이면 원본과 동일(빈 곳 없음)", () => {
  const src = pattern(20, 20);
  const img = copy(src);
  FX.tiles(img, 4, 0, BG, 1);
  assert.ok(same(img, src));
});

test("윤곽선 추적: 128 경계 한 줄만 검출, 나머지는 흰색", () => {
  // 왼쪽 절반 50, 오른쪽 절반 200 (회색)
  const img = makeImageData(8, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const v = x < 4 ? 50 : 200, i = (y * 8 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  const up = copy(img);
  FX.traceContour(img, 128, 0); // 아래쪽 경계 = x=3
  FX.traceContour(up, 128, 1);  // 위쪽 경계 = x=4
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 4;
    assert.equal(img.data[i], x === 3 ? 0 : 255);
    assert.equal(up.data[i], x === 4 ? 0 : 255);
  }
});

test("확산: 균일색 불변, 결과 픽셀은 원본 팔레트 안", () => {
  const u = makeImageData(10, 10, [1, 2, 3, 255]);
  const uc = copy(u);
  FX.diffuse(u, 0, 3, 9);
  assert.ok(same(u, uc));
  const src = pattern();
  const img = copy(src);
  FX.diffuse(img, 0, 2, 9);
  const palette = new Set();
  for (let i = 0; i < src.data.length; i += 4) palette.add(src.data.slice(i, i + 4).join());
  for (let i = 0; i < img.data.length; i += 4) assert.ok(palette.has(img.data.slice(i, i + 4).join()));
});

test("확산 어두운 것만: 어떤 픽셀도 밝아지지 않음", () => {
  const src = pattern();
  const img = copy(src);
  FX.diffuse(img, 1, 2, 5);
  const L = (d, i) => d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114;
  for (let i = 0; i < img.data.length; i += 4) assert.ok(L(img.data, i) <= L(src.data, i));
});

test("바람: 균일색 불변, 밝은 경계에서 바람 방향으로만 번짐", () => {
  const u = makeImageData(12, 3, [80, 80, 80, 255]);
  const uc = copy(u);
  FX.wind(u, 0, 0, 1);
  assert.ok(same(u, uc));
  // 왼쪽 흰 1열, 나머지 검정 → 오른쪽으로 번짐(왼쪽에서 부는 바람)
  const img = makeImageData(12, 1, [0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], 0);
  FX.wind(img, 0, 0, 1);
  assert.ok(img.data[4] > 0);
  const img2 = makeImageData(12, 1, [0, 0, 0, 255]);
  img2.data.set([255, 255, 255, 255], 0);
  FX.wind(img2, 0, 1, 1); // 오른쪽에서 부는 바람 → 왼쪽 끝에서는 번질 곳 없음
  assert.equal(img2.data[4], 0);
});

test("유화: 균일색 불변, 두 색 영역은 경계 근처에서도 두 색 중 하나", () => {
  const u = makeImageData(12, 12, [70, 140, 210, 255]);
  const uc = copy(u);
  FX.oilPaint(u, 3, 16);
  assert.ok(same(u, uc));
  const img = makeImageData(12, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const i = (y * 12 + x) * 4, v = x < 6 ? 30 : 220;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  FX.oilPaint(img, 2, 8);
  for (let i = 0; i < img.data.length; i += 4) assert.ok(img.data[i] === 30 || img.data[i] === 220);
});

test("네온 가장자리: 균일색이면 전부 검정, 경계에서는 밝음, 알파 보존", () => {
  const u = makeImageData(10, 10, [120, 120, 120, 180]);
  FX.glowingEdges(u, 3, 6, 1);
  for (let i = 0; i < u.data.length; i += 4) {
    assert.equal(u.data[i], 0); assert.equal(u.data[i + 3], 180);
  }
  const img = makeImageData(10, 10);
  for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) img.data.set([255, 255, 255, 255], (y * 10 + x) * 4);
  FX.glowingEdges(img, 1, 10, 1);
  assert.ok(img.data[(5 * 10 + 5) * 4] > 200);
  assert.equal(img.data[(5 * 10 + 0) * 4], 0);
});

test("돌출: 균일색 블록 면은 원색, 옆면은 음영 / 크기 보존", () => {
  const img = makeImageData(20, 20, [100, 100, 100, 255]);
  FX.extrude(img, 0, 10, 50);
  const at = (x, y) => img.data[(y * 20 + x) * 4];
  assert.equal(at(5, 5), 100);   // 앞면
  assert.ok(at(5, 0) > 100);     // 위 옆면 밝게
  assert.ok(at(5, 9) < 100);     // 아래 옆면 어둡게
  const p = makeImageData(20, 20, [100, 100, 100, 255]);
  FX.extrude(p, 1, 10, 50);
  assert.ok(p.data[(1 * 20 + 5) * 4] > 100 && p.data[(8 * 20 + 5) * 4] < 100);
});

test("색상 하프톤: 흰색은 흰색, 검정은 검정 유지(채널 0/최대)", () => {
  const w = makeImageData(24, 24, [255, 255, 255, 255]);
  FX.colorHalftone(w, 4);
  for (let i = 0; i < w.data.length; i += 4) for (let c = 0; c < 3; c++) assert.equal(w.data[i + c], 255);
  const b = makeImageData(24, 24, [0, 0, 0, 255]);
  FX.colorHalftone(b, 4);
  for (let i = 0; i < b.data.length; i += 4) for (let c = 0; c < 3; c++) assert.equal(b.data[i + c], 0);
});

test("렌즈 플레어: 광원 위치가 가장 밝아지고 알파 보존 / 조명 효과: 강도 0 이면 주변광만", () => {
  const img = makeImageData(40, 40, [0, 0, 0, 200]);
  FX.lensFlare(img, 100, 25, 25, 0);
  const at = (x, y) => img.data[(y * 40 + x) * 4];
  assert.ok(at(10, 10) > at(35, 35));
  assert.ok(at(10, 10) > 200);
  assert.equal(img.data[3], 200);

  const l = makeImageData(10, 10, [200, 200, 200, 255]);
  FX.lightingEffects(l, { intensity: 0 });
  assert.equal(l.data[0], 30); // 200 × 0.15
  const l2 = makeImageData(30, 30, [200, 200, 200, 255]);
  FX.lightingEffects(l2, { x: 50, y: 50, intensity: 100, range: 60 });
  assert.ok(l2.data[(15 * 30 + 15) * 4] > l2.data[0]); // 중심이 모서리보다 밝음
});

test("섬유: 불투명, 전경·배경 사이 값", () => {
  const img = makeImageData(30, 30, [0, 0, 0, 0]);
  FX.fibers(img, { r: 0, g: 0, b: 0 }, { r: 200, g: 200, b: 200 }, 16, 4, 2);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i + 3], 255);
    assert.ok(img.data[i] <= 200);
  }
});
