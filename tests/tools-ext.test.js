// tools-ext.test.js — 확장 도구(자르기·올가미·빠른 선택·지우개·스팟 복구·적목·색상 대체)의 순수 계산 단위테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeImageData, setPixel, getPixel } from "./helpers.js";
import {
  colorDistance, matchesRef, brushFalloff,
  parseRatio, cropRectFromDrag, resizeCropRect, applyRatioToRect, roundCropRect,
  redness, redEyeFix, lum, replaceColor,
  growRegion, magicErase, bgEraseDab, colorReplaceDab,
  spotHeal, gradientMagnitude, liveWirePath,
} from "../js/tools/tool-ext-math.js";

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── 허용치 색 거리 ──
test("colorDistance: 채널별 절대차의 최댓값", () => {
  assert.equal(colorDistance(10, 20, 30, 10, 20, 30), 0);
  assert.equal(colorDistance(0, 0, 0, 5, 40, 12), 40);
  assert.equal(colorDistance(255, 0, 0, 0, 0, 0), 255);
});

test("matchesRef: 허용치 경계 포함, 알파도 비교", () => {
  const d = new Uint8ClampedArray([100, 100, 100, 255]);
  assert.ok(matchesRef(d, 0, [110, 90, 100, 255], 10));
  assert.ok(!matchesRef(d, 0, [111, 100, 100, 255], 10));
  assert.ok(!matchesRef(d, 0, [100, 100, 100, 0], 10)); // 알파 차 255
});

test("brushFalloff: 경도 안은 1, 가장자리 0, 사이는 선형", () => {
  assert.equal(brushFalloff(0, 10, 0.5), 1);
  assert.equal(brushFalloff(5, 10, 0.5), 1);
  assert.ok(close(brushFalloff(7.5, 10, 0.5), 0.5));
  assert.equal(brushFalloff(10, 10, 0.5), 0);
  assert.equal(brushFalloff(9.99, 10, 1), 1); // 경도 100% = 단단한 원
});

// ── 자르기 비율 ──
test("parseRatio: 자유=null, 'a:b'=a/b", () => {
  assert.equal(parseRatio("free"), null);
  assert.equal(parseRatio(undefined), null);
  assert.equal(parseRatio("16:9"), 16 / 9);
  assert.equal(parseRatio("1:1"), 1);
  assert.equal(parseRatio("abc"), null);
});

test("cropRectFromDrag: 자유 비율은 드래그 그대로, 역방향 드래그도 정규화", () => {
  assert.deepEqual(cropRectFromDrag(10, 10, 50, 30, null, 100, 100), { x: 10, y: 10, w: 40, h: 20 });
  assert.deepEqual(cropRectFromDrag(50, 30, 10, 10, null, 100, 100), { x: 10, y: 10, w: 40, h: 20 });
});

test("cropRectFromDrag: 비율 고정 + 문서 밖으로 나가지 않음", () => {
  const r = cropRectFromDrag(0, 0, 80, 10, 16 / 9, 200, 200);
  assert.ok(close(r.w / r.h, 16 / 9));
  assert.equal(r.w, 80);
  // 문서(100×50) 밖까지 끌어도 고정점 기준으로 줄어든다
  const r2 = cropRectFromDrag(0, 0, 500, 500, 1, 100, 50);
  assert.deepEqual(r2, { x: 0, y: 0, w: 50, h: 50 });
  const r3 = cropRectFromDrag(10, 10, 999, 20, null, 100, 50);
  assert.equal(r3.x + r3.w, 100);
});

test("resizeCropRect: 이동은 문서 안으로 클램프", () => {
  const r = resizeCropRect({ x: 10, y: 10, w: 20, h: 20 }, "move", 500, -500, null, 100, 100);
  assert.deepEqual(r, { x: 80, y: 0, w: 20, h: 20 });
});

test("resizeCropRect: 모서리는 반대편 고정, 변은 한 변만(자유)", () => {
  const r0 = { x: 10, y: 10, w: 20, h: 20 };
  assert.deepEqual(resizeCropRect(r0, "se", 10, 5, null, 100, 100), { x: 10, y: 10, w: 30, h: 25 });
  assert.deepEqual(resizeCropRect(r0, "nw", -5, -5, null, 100, 100), { x: 5, y: 5, w: 25, h: 25 });
  assert.deepEqual(resizeCropRect(r0, "e", 10, 99, null, 100, 100), { x: 10, y: 10, w: 30, h: 20 });
  assert.deepEqual(resizeCropRect(r0, "n", 99, -5, null, 100, 100), { x: 10, y: 5, w: 20, h: 25 });
});

test("resizeCropRect: 변 조절도 비율 유지(중심 기준)", () => {
  const r = resizeCropRect({ x: 10, y: 40, w: 20, h: 20 }, "e", 20, 0, 1, 100, 100);
  assert.ok(close(r.w, 40)); assert.ok(close(r.h, 40));
  assert.ok(close(r.y + r.h / 2, 50)); // 세로 중심 유지
});

test("applyRatioToRect / roundCropRect", () => {
  const r = applyRatioToRect({ x: 30, y: 45, w: 40, h: 10 }, 1, 100, 100);
  assert.ok(close(r.w, r.h));
  assert.ok(close(r.w * r.h, 400)); // 면적 유지
  assert.ok(close(r.x + r.w / 2, 50) && close(r.y + r.h / 2, 50)); // 중심 유지
  const edge = applyRatioToRect({ x: 0, y: 0, w: 40, h: 10 }, 1, 100, 100);
  assert.ok(edge.y >= 0 && edge.x >= 0, "문서 밖으로 안 나감");
  assert.deepEqual(roundCropRect({ x: -3.4, y: 2.6, w: 10, h: 10 }, 100, 100), { x: 0, y: 3, w: 7, h: 10 });
  assert.equal(roundCropRect({ x: 200, y: 0, w: 10, h: 10 }, 100, 100), null);
});

// ── 적목 ──
test("redEyeFix: 빨간 픽셀만 무채색·어둡게, 피부색은 그대로", () => {
  const img = makeImageData(3, 1, [0, 0, 0, 255]);
  setPixel(img, 0, 0, [200, 30, 30, 255]);   // 적목
  setPixel(img, 1, 0, [220, 170, 140, 255]); // 피부
  setPixel(img, 2, 0, [30, 30, 30, 255]);    // 어두운 동공
  const n = redEyeFix(img.data, 3, 1, { x: 0, y: 0, w: 3, h: 1 }, 0.5, 0.5);
  assert.equal(n, 1);
  const [r, g, b] = getPixel(img, 0, 0);
  assert.ok(redness(r, g, b) < 1.5, "보정 후 더 이상 붉지 않음");
  assert.ok(r < 100, "어두워짐");
  assert.deepEqual(getPixel(img, 1, 0), [220, 170, 140, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [30, 30, 30, 255]);
});

test("redEyeFix: 박스 밖은 손대지 않고, 어둡게 0이면 밝기 유지(빨강만 제거)", () => {
  const img = makeImageData(2, 1);
  setPixel(img, 0, 0, [200, 40, 40, 255]);
  setPixel(img, 1, 0, [200, 40, 40, 255]);
  redEyeFix(img.data, 2, 1, { x: 1, y: 0, w: 1, h: 1 }, 0.5, 0);
  assert.deepEqual(getPixel(img, 0, 0), [200, 40, 40, 255]);
  const [r, g, b] = getPixel(img, 1, 0);
  assert.equal(r, 40); assert.equal(g, 40); assert.equal(b, 40);
});

// ── 색상 대체 ──
test("replaceColor 'color' 모드: 광도 유지 + 전경색 색조", () => {
  const base = [120, 120, 120]; // 회색
  const c = replaceColor(...base, 255, 0, 0, "color");
  assert.ok(Math.abs(lum(...c) - lum(...base)) < 0.5, "광도 유지");
  assert.ok(c[0] > c[1] && c[0] > c[2], "빨강 쪽으로");
});

test("replaceColor 'luminosity': 원래 색조, 전경색 광도", () => {
  const c = replaceColor(200, 50, 50, 255, 255, 255, "luminosity");
  assert.ok(Math.abs(lum(...c) - 255) < 1);
});

test("colorReplaceDab: 허용치 안 픽셀만 바뀌고 알파는 그대로", () => {
  const W = 5, H = 5;
  const before = makeImageData(W, H, [0, 0, 200, 255]); // 파랑
  setPixel(before, 2, 3, [0, 200, 0, 128]);              // 초록(반투명) = 다른 색
  const work = { data: new Uint8ClampedArray(before.data) };
  const str = new Uint8Array(W * H);
  const box = colorReplaceDab(work.data, before.data, W, H, 2.5, 2.5, 3, 1, [0, 0, 200, 255], 30, [255, 0, 0], "color", str);
  assert.ok(box);
  const i = (2 * W + 2) * 4;
  assert.ok(work.data[i] > work.data[i + 2], "파랑 → 빨강 계열");
  const j = (3 * W + 2) * 4;
  assert.deepEqual([...work.data.slice(j, j + 4)], [0, 200, 0, 128], "허용치 밖 그대로");
  for (let k = 3; k < work.data.length; k += 4) assert.equal(work.data[k], before.data[k]);
});

// ── 국소 영역 확장(빠른 선택) ──
test("growRegion: 창 안의 이어진 비슷한 색만, out 마스크에 기록", () => {
  const W = 6, H = 1;
  const img = makeImageData(W, H, [10, 10, 10, 255]);
  setPixel(img, 3, 0, [250, 250, 250, 255]); // 벽
  const out = new Uint8Array(W);
  const g = growRegion(img.data, W, H, 0, 0, [10, 10, 10, 255], 20, { x0: 0, y0: 0, x1: W, y1: H }, out, 255);
  assert.equal(g.count, 3);
  assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]);
  // 창 제한
  const out2 = new Uint8Array(W);
  growRegion(img.data, W, H, 0, 0, [10, 10, 10, 255], 20, { x0: 0, y0: 0, x1: 2, y1: 1 }, out2, 255);
  assert.deepEqual([...out2], [255, 255, 0, 0, 0, 0]);
  // 빼기(value=0)
  growRegion(img.data, W, H, 5, 0, [10, 10, 10, 255], 20, { x0: 0, y0: 0, x1: W, y1: H }, out, 0);
  assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]);
});

// ── 지우개 ──
test("magicErase: 마스크·불투명도·선택 강도 반영", () => {
  const img = makeImageData(3, 1, [50, 50, 50, 200]);
  const mask = new Uint8Array([255, 255, 0]);
  const sel = new Uint8Array([255, 0, 255]);
  const n = magicErase(img.data, mask, 1, sel);
  assert.equal(n, 1);
  assert.equal(getPixel(img, 0, 0)[3], 0);
  assert.equal(getPixel(img, 1, 0)[3], 200);
  assert.equal(getPixel(img, 2, 0)[3], 200);
  const img2 = makeImageData(1, 1, [0, 0, 0, 200]);
  magicErase(img2.data, new Uint8Array([255]), 0.5);
  assert.equal(getPixel(img2, 0, 0)[3], 100);
});

test("bgEraseDab: 기준색과 비슷한 픽셀만 지우고, 겹쳐 칠해도 누적되지 않음", () => {
  const W = 7, H = 7;
  const before = makeImageData(W, H, [255, 255, 255, 255]); // 흰 배경
  for (let y = 0; y < H; y++) setPixel(before, 3, y, [0, 0, 0, 255]); // 검정 세로선(피사체)
  const work = new Uint8ClampedArray(before.data);
  const str = new Uint8Array(W * H);
  bgEraseDab(work, before.data, W, H, 3.5, 3.5, 3, 1, [255, 255, 255, 255], 40, false, str);
  assert.equal(work[(3 * W + 1) * 4 + 3], 0, "흰 배경 지워짐");
  assert.equal(work[(3 * W + 3) * 4 + 3], 255, "검정 선 보존");
  const snap = work.slice();
  bgEraseDab(work, before.data, W, H, 3.5, 3.5, 3, 1, [255, 255, 255, 255], 40, false, str);
  assert.deepEqual(work, snap, "같은 자리 재칠해도 동일");
});

test("bgEraseDab 인접 모드: 선 너머(이어지지 않은) 배경은 남김", () => {
  const W = 9, H = 3;
  const before = makeImageData(W, H, [255, 255, 255, 255]);
  for (let y = 0; y < H; y++) setPixel(before, 5, y, [0, 0, 0, 255]);
  const work = new Uint8ClampedArray(before.data);
  bgEraseDab(work, before.data, W, H, 3.5, 1.5, 4, 1, [255, 255, 255, 255], 40, true, new Uint8Array(W * H));
  assert.equal(work[(1 * W + 3) * 4 + 3], 0);
  assert.equal(work[(1 * W + 6) * 4 + 3], 255, "벽 너머는 인접 아님");
});

// ── 스팟 복구 ──
test("spotHeal: 단색 배경 위 잡티를 주변 색으로 채움", () => {
  const W = 40, H = 40;
  const img = makeImageData(W, H, [100, 150, 200, 255]);
  for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) setPixel(img, x, y, [255, 0, 0, 255]);
  const box = { x: 15, y: 15, w: 10, h: 10 };
  const mask = new Uint8Array(box.w * box.h);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) mask[y * box.w + x] = 255; // (17..22) 덮음
  const res = spotHeal(img.data, W, H, mask, box, 1);
  assert.ok(res.ok);
  assert.ok(res.offset, "주변 패치를 찾음");
  const [r, g, b] = getPixel(img, 20, 20);
  assert.ok(Math.abs(r - 100) <= 2 && Math.abs(g - 150) <= 2 && Math.abs(b - 200) <= 2, `got ${r},${g},${b}`);
  assert.deepEqual(getPixel(img, 5, 5), [100, 150, 200, 255], "영역 밖 불변");
});

test("spotHeal: 가로 그라디언트에서도 이음매 없이(경계 차이 확산)", () => {
  const W = 60, H = 60;
  const img = makeImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPixel(img, x, y, [x * 4, 100, 100, 255]);
  for (let y = 28; y < 32; y++) for (let x = 28; x < 32; x++) setPixel(img, x, y, [0, 255, 0, 255]);
  const box = { x: 24, y: 24, w: 12, h: 12 };
  const mask = new Uint8Array(box.w * box.h);
  for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) mask[y * box.w + x] = 255;
  spotHeal(img.data, W, H, mask, box, 1);
  for (const x of [28, 30, 31]) {
    const [r, g] = getPixel(img, x, 30);
    assert.ok(Math.abs(r - x * 4) <= 4, `x=${x} r=${r}`);
    assert.ok(Math.abs(g - 100) <= 2);
  }
});

test("spotHeal: 패치를 둘 곳이 없는 작은 이미지는 확산 채움으로 대체", () => {
  const W = 6, H = 6;
  const img = makeImageData(W, H, [80, 80, 80, 255]);
  setPixel(img, 2, 2, [255, 255, 255, 255]);
  const box = { x: 0, y: 0, w: 6, h: 6 };
  const mask = new Uint8Array(36); mask[2 * 6 + 2] = 255; mask[2 * 6 + 3] = 255; mask[3 * 6 + 2] = 255; mask[3 * 6 + 3] = 255;
  const res = spotHeal(img.data, W, H, mask, box, 1);
  assert.ok(res.ok);
  assert.deepEqual(getPixel(img, 2, 2).slice(0, 3), [80, 80, 80]);
});

// ── 자석 올가미 ──
test("gradientMagnitude: 가장자리에서 최대(1), 평탄부 0", () => {
  const W = 10, H = 5;
  const img = makeImageData(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) for (let x = 5; x < W; x++) setPixel(img, x, y, [255, 255, 255, 255]);
  const g = gradientMagnitude(img.data, W, H);
  assert.equal(g[2 * W + 0], 0);
  assert.ok(close(Math.max(g[2 * W + 4], g[2 * W + 5]), 1));
});

test("liveWirePath: 직선 대신 가장자리를 따라간다", () => {
  const W = 40, H = 40;
  const img = makeImageData(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) for (let x = 20; x < W; x++) setPixel(img, x, y, [255, 255, 255, 255]);
  const g = gradientMagnitude(img.data, W, H);
  // 가장자리(x≈19~20)에서 조금 떨어진 두 점을 잇되, 경로 중간은 가장자리에 붙어야 함
  const path = liveWirePath(g, W, H, 17, 5, 17, 35, 6);
  assert.deepEqual(path[0], { x: 17, y: 5 });
  assert.deepEqual(path[path.length - 1], { x: 17, y: 35 });
  const mid = path.filter((p) => p.y >= 12 && p.y <= 28);
  assert.ok(mid.length > 0);
  for (const p of mid) assert.ok(p.x === 19 || p.x === 20, `x=${p.x}`);
  // 경로는 8-이웃으로 끊김 없이 이어진다
  for (let i = 1; i < path.length; i++) {
    assert.ok(Math.abs(path[i].x - path[i - 1].x) <= 1 && Math.abs(path[i].y - path[i - 1].y) <= 1);
  }
});

// ── 자르기: 가이드 이동/제거 ──
import { cropGuides } from "../js/tools/crop-tool.js";
import { shouldCloseClick } from "../js/tools/lasso-ext-tools.js";
import { pixelEditBlocker } from "../js/tools/ext-tool-base.js";

test("cropGuides: 오프셋만큼 이동, 문서 밖 가이드는 제거, 입력 불변", () => {
  const src = [
    { orient: "v", pos: 50 }, { orient: "v", pos: 5 }, { orient: "v", pos: 400 },
    { orient: "h", pos: 30 }, { orient: "h", pos: 10 }, { orient: "h", pos: 110 },
  ];
  // 자르기 영역 x=20,y=20, 80×80
  const out = cropGuides(src, 20, 20, 80, 80);
  assert.deepEqual(out, [{ orient: "v", pos: 30 }, { orient: "h", pos: 10 }]);
  assert.equal(src[0].pos, 50); // 원본 배열은 바뀌지 않는다(undo 복원용)
  // 경계(0, 끝)는 유지
  assert.equal(cropGuides([{ orient: "v", pos: 20 }, { orient: "h", pos: 100 }], 20, 20, 80, 80).length, 2);
  assert.deepEqual(cropGuides(undefined, 0, 0, 10, 10), []);
});

// ── 다각형 올가미: 닫기 판정 ──
test("shouldCloseClick: 점 1~2개에서는 더블클릭/시작점 클릭으로 닫지 않는다", () => {
  const base = { pt: { x: 10, y: 10 }, startPt: { x: 10, y: 10 }, lastClick: { t: 100, x: 10, y: 10 }, now: 200, tol: 5 };
  assert.equal(shouldCloseClick({ ...base, count: 1 }), false);
  assert.equal(shouldCloseClick({ ...base, count: 2 }), false);
  assert.equal(shouldCloseClick({ ...base, count: 3 }), true);
});

test("shouldCloseClick: 3점 이상 — 더블클릭은 시간·거리 안에서만, 시작점 근처는 즉시", () => {
  const far = { pt: { x: 100, y: 100 }, startPt: { x: 0, y: 0 }, count: 4, tol: 5 };
  assert.equal(shouldCloseClick({ ...far, lastClick: { t: 100, x: 100, y: 100 }, now: 200 }), true);   // 더블클릭
  assert.equal(shouldCloseClick({ ...far, lastClick: { t: 100, x: 100, y: 100 }, now: 900 }), false);  // 시간 초과
  assert.equal(shouldCloseClick({ ...far, lastClick: { t: 100, x: 50, y: 50 }, now: 200 }), false);    // 거리 초과
  assert.equal(shouldCloseClick({ ...far, pt: { x: 2, y: 2 }, lastClick: null, now: 200 }), true);      // 시작점 클릭
});

// ── 픽셀 도구 거부 판정 ──
test("pixelEditBlocker: 마스크 편집·조정·벡터 레이어는 거부, 일반 픽셀 레이어는 통과", () => {
  assert.equal(pixelEditBlocker(null), null);
  assert.equal(pixelEditBlocker({ type: "pixel" }), null);
  assert.equal(pixelEditBlocker({ maskActive: true, mask: null }), null); // 마스크가 없으면 무시
  assert.match(pixelEditBlocker({ maskActive: true, mask: {} }), /마스크/);
  assert.match(pixelEditBlocker({ type: "adjustment" }), /조정 레이어/);
  assert.match(pixelEditBlocker({ vectorText: {} }), /텍스트\/셰이프/);
  assert.match(pixelEditBlocker({ vectorShape: {} }), /텍스트\/셰이프/);
  assert.match(pixelEditBlocker({ type: "pixel" }, { quickMask: { active: true } }), /빠른 마스크/);
  assert.equal(pixelEditBlocker({ type: "pixel" }, { quickMask: { active: false } }), null);
});
