// layer-image.test.js — 리샘플(resample.js)과 이미지/레이어 메뉴 순수 계산(layer-image-ops.js) 테스트.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeImageData, setPixel, getPixel } from "./helpers.js";
import { resample, RESAMPLE_METHODS, buildWeights } from "../js/engine/resample.js";
import {
  anchorOffset, rotatedSize, rotatePointFn, trimBounds, opaqueBounds, alignOffset,
  maskAlphaInBox, bakeMaskIntoAlpha, alphaToMaskData, makeOpaque,
  scaleVectorText, scaleVectorShape, rotateVectorShape, mapPath,
} from "../js/engine/layer-image-ops.js";

const METHODS = RESAMPLE_METHODS.map(([v]) => v);

// 결정적 의사난수 패턴
function noiseImage(w, h, seed = 7) {
  const img = makeImageData(w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i++) { s = (s * 1103515245 + 12345) >>> 0; img.data[i] = s >>> 24; }
  return img;
}

// ── resample ──
test("resample: 모든 방식이 요청한 크기를 돌려준다(확대/축소/비균등)", () => {
  const src = noiseImage(13, 9);
  for (const m of METHODS) {
    for (const [w, h] of [[26, 18], [5, 4], [40, 3], [1, 1]]) {
      const out = resample(src, w, h, m);
      assert.equal(out.width, w, `${m} 폭`);
      assert.equal(out.height, h, `${m} 높이`);
      assert.equal(out.data.length, w * h * 4, `${m} 데이터 길이`);
    }
  }
});

test("resample: 단색(반투명 포함)은 어떤 방식으로도 같은 단색을 유지한다", () => {
  for (const color of [[200, 40, 90, 255], [10, 220, 130, 128]]) {
    const src = makeImageData(11, 7, color);
    for (const m of METHODS) {
      for (const [w, h] of [[23, 15], [4, 3], [11, 20]]) {
        const out = resample(src, w, h, m);
        for (let i = 0; i < out.data.length; i += 4) {
          for (let c = 0; c < 4; c++) {
            assert.ok(Math.abs(out.data[i + c] - color[c]) <= 1, `${m} ${w}x${h} 채널${c}: ${out.data[i + c]} != ${color[c]}`);
          }
        }
      }
    }
  }
});

test("resample: 같은 크기는 정확한 항등(사본)", () => {
  const src = noiseImage(9, 6);
  for (const m of METHODS) {
    const out = resample(src, 9, 6, m);
    assert.deepEqual(Array.from(out.data), Array.from(src.data), m);
    assert.notEqual(out.data, src.data, "새 버퍼여야 한다");
  }
});

test("resample: 최단 입점 정수배 확대는 픽셀을 그대로 복제", () => {
  const src = makeImageData(2, 2);
  setPixel(src, 0, 0, [255, 0, 0, 255]); setPixel(src, 1, 0, [0, 255, 0, 255]);
  setPixel(src, 0, 1, [0, 0, 255, 255]); setPixel(src, 1, 1, [9, 9, 9, 255]);
  const out = resample(src, 4, 4, "nearest");
  assert.deepEqual(getPixel(out, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(getPixel(out, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(getPixel(out, 3, 0), [0, 255, 0, 255]);
  assert.deepEqual(getPixel(out, 0, 3), [0, 0, 255, 255]);
  assert.deepEqual(getPixel(out, 3, 3), [9, 9, 9, 255]);
});

test("resample: 투명 경계에 투명 픽셀의 색(검정)이 번지지 않는다(프리멀티플라이드)", () => {
  const src = makeImageData(4, 1, [0, 0, 0, 0]);
  setPixel(src, 0, 0, [255, 255, 255, 255]); setPixel(src, 1, 0, [255, 255, 255, 255]);
  const out = resample(src, 8, 1, "bilinear");
  for (let x = 0; x < 8; x++) {
    const [r, g, b, a] = getPixel(out, x, 0);
    if (a > 0) assert.ok(r >= 254 && g >= 254 && b >= 254, `x=${x} 색이 어두워짐: ${r},${g},${b},${a}`);
  }
});

test("buildWeights: 출력마다 가중치 합이 1", () => {
  const k = { support: 2, fn: (x) => Math.max(0, 1 - Math.abs(x) / 2) };
  for (const [s, d] of [[10, 3], [3, 10], [7, 7]]) {
    const W = buildWeights(s, d, k);
    for (let i = 0; i < d; i++) {
      let sum = 0;
      for (let j = W.start[i]; j < W.start[i + 1]; j++) sum += W.w[j];
      assert.ok(Math.abs(sum - 1) < 1e-5);
    }
  }
});

// ── 캔버스 크기 / 회전 ──
test("anchorOffset: 9방향 기준점", () => {
  assert.deepEqual(anchorOffset(100, 50, 200, 150, 0), { dx: 0, dy: 0 });
  assert.deepEqual(anchorOffset(100, 50, 200, 150, 4), { dx: 50, dy: 50 });
  assert.deepEqual(anchorOffset(100, 50, 200, 150, 8), { dx: 100, dy: 100 });
  assert.deepEqual(anchorOffset(100, 50, 200, 150, 2), { dx: 100, dy: 0 });
  assert.deepEqual(anchorOffset(100, 50, 200, 150, 6), { dx: 0, dy: 100 });
  // 축소: 음수 오프셋(잘림)
  assert.deepEqual(anchorOffset(100, 100, 60, 60, 8), { dx: -40, dy: -40 });
  assert.deepEqual(anchorOffset(100, 100, 60, 60, 4), { dx: -20, dy: -20 });
});

test("rotatedSize: 90°는 가로세로 교환, 45°는 대각 확장", () => {
  assert.deepEqual(rotatedSize(200, 100, 90), { w: 100, h: 200 });
  assert.deepEqual(rotatedSize(200, 100, -90), { w: 100, h: 200 });
  assert.deepEqual(rotatedSize(200, 100, 180), { w: 200, h: 100 });
  const r = rotatedSize(100, 100, 45);
  assert.equal(r.w, Math.ceil(100 * Math.SQRT2 - 1e-6));
  assert.equal(r.w, r.h);
});

test("rotatePointFn: 중심은 새 중심으로, 90° 시계 회전 좌표", () => {
  const fn = rotatePointFn(200, 100, 100, 200, 90);
  const c = fn(100, 50);
  assert.ok(Math.abs(c.x - 50) < 1e-9 && Math.abs(c.y - 100) < 1e-9);
  const tl = fn(0, 0); // 왼쪽 위 → 시계 90° 후 오른쪽 위
  assert.ok(Math.abs(tl.x - 100) < 1e-9 && Math.abs(tl.y - 0) < 1e-9);
});

// ── 재단 ──
test("trimBounds: 투명 픽셀 기준 4방향", () => {
  const img = makeImageData(10, 8, [0, 0, 0, 0]);
  setPixel(img, 2, 3, [1, 2, 3, 255]);
  setPixel(img, 6, 5, [1, 2, 3, 10]);
  assert.deepEqual(trimBounds(img, "transparent"), { x: 2, y: 3, w: 5, h: 3 });
  // 위·왼쪽만
  assert.deepEqual(trimBounds(img, "transparent", { top: true, left: true, bottom: false, right: false }), { x: 2, y: 3, w: 8, h: 5 });
  // 아래·오른쪽만
  assert.deepEqual(trimBounds(img, "transparent", { top: false, left: false, bottom: true, right: true }), { x: 0, y: 0, w: 7, h: 6 });
});

test("trimBounds: 왼쪽 위 / 오른쪽 아래 픽셀 색 기준", () => {
  const img = makeImageData(6, 6, [255, 255, 255, 255]);
  setPixel(img, 5, 5, [0, 0, 0, 255]); // 오른쪽 아래만 검정
  setPixel(img, 2, 2, [10, 10, 10, 255]);
  assert.deepEqual(trimBounds(img, "topLeft"), { x: 2, y: 2, w: 4, h: 4 });
  // 오른쪽 아래(검정) 기준: 검정은 (5,5) 하나뿐 → 흰 배경이 전부 남는다
  assert.deepEqual(trimBounds(img, "bottomRight"), { x: 0, y: 0, w: 6, h: 6 });
});

test("trimBounds: 전부 잘려 나가면 null, opaqueBounds 동일 규칙", () => {
  assert.equal(trimBounds(makeImageData(4, 4, [0, 0, 0, 0]), "transparent"), null);
  assert.equal(trimBounds(makeImageData(4, 4, [5, 5, 5, 255]), "topLeft"), null);
  const img = makeImageData(5, 5, [0, 0, 0, 0]);
  setPixel(img, 4, 0, [1, 1, 1, 1]);
  assert.deepEqual(opaqueBounds(img), { x: 4, y: 0, w: 1, h: 1 });
});

// ── 정렬 ──
test("alignOffset: 6가지 가장자리/가운데", () => {
  const c = { x: 10, y: 20, w: 30, h: 40 };
  const t = { x: 0, y: 0, w: 100, h: 200 };
  assert.deepEqual(alignOffset(c, t, "top"), { dx: 0, dy: -20 });
  assert.deepEqual(alignOffset(c, t, "bottom"), { dx: 0, dy: 140 });
  assert.deepEqual(alignOffset(c, t, "vcenter"), { dx: 0, dy: 60 });
  assert.deepEqual(alignOffset(c, t, "left"), { dx: -10, dy: 0 });
  assert.deepEqual(alignOffset(c, t, "right"), { dx: 60, dy: 0 });
  assert.deepEqual(alignOffset(c, t, "hcenter"), { dx: 25, dy: 0 });
  // 선택 경계 기준
  assert.deepEqual(alignOffset(c, { x: 50, y: 50, w: 10, h: 10 }, "left"), { dx: 40, dy: 0 });
  assert.deepEqual(alignOffset(c, c, "hcenter"), { dx: 0, dy: 0 });
});

// ── 알파/마스크 ──
test("maskAlphaInBox: 선택 마스크 곱하기/반전(지우기)", () => {
  const docW = 4;
  const mask = new Uint8Array(16);
  mask[1 * 4 + 1] = 255; mask[1 * 4 + 2] = 128; // (1,1)=전체, (2,1)=절반
  const box = { x: 1, y: 1, w: 2, h: 1 };
  const a = maskAlphaInBox(makeImageData(2, 1, [9, 9, 9, 200]), mask, docW, box);
  assert.equal(a.data[3], 200);
  assert.equal(a.data[7], Math.round((200 * 128) / 255));
  const b = maskAlphaInBox(makeImageData(2, 1, [9, 9, 9, 200]), mask, docW, box, true);
  assert.equal(b.data[3], 0);
  assert.equal(b.data[7], Math.round((200 * 127) / 255));
});

test("투명도→마스크, 마스크 굽기 왕복: 보이는 알파 보존", () => {
  const px = new Uint8ClampedArray([10, 20, 30, 0, 50, 60, 70, 128, 1, 2, 3, 255]);
  const mask = alphaToMaskData(px);
  assert.deepEqual(Array.from(mask), [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  const opaque = makeOpaque(new Uint8ClampedArray(px));
  assert.deepEqual([opaque[3], opaque[7], opaque[11]], [255, 255, 255]);
  bakeMaskIntoAlpha(opaque, mask);
  assert.deepEqual([opaque[3], opaque[7], opaque[11]], [0, 128, 255]);
});

// ── 벡터 좌표 변환 ──
test("scaleVectorText/Shape: 배율·이동, 원본 불변", () => {
  const t = { x: 10, y: 20, fontSize: 30, letterSpacing: 2 };
  const t2 = scaleVectorText(t, { sx: 2, sy: 2, dx: 5, dy: 0 });
  assert.deepEqual([t2.x, t2.y, t2.fontSize, t2.letterSpacing], [25, 40, 60, 4]);
  assert.equal(t.x, 10);
  const s = { kind: "rect", rect: { x: 1, y: 2, w: 3, h: 4 }, strokeWidth: 2, path: null, polygon: null };
  const s2 = scaleVectorShape(s, { sx: 2, sy: 3, dx: 0, dy: 0 });
  assert.deepEqual(s2.rect, { x: 2, y: 6, w: 6, h: 12 });
  const p = { anchors: [{ x: 1, y: 1, inX: 0, inY: 0, outX: 2, outY: 2 }], closed: false };
  const p2 = mapPath(p, (x, y) => ({ x: x + 10, y: y - 1 }));
  assert.deepEqual(p2.anchors[0], { x: 11, y: 0, inX: 10, inY: -1, outX: 12, outY: 1 });
});

test("rotateVectorShape: 사각형→패스, 타원은 null(래스터화)", () => {
  const fn = (x, y) => ({ x: -y, y: x });
  const r = rotateVectorShape({ kind: "rect", rect: { x: 0, y: 0, w: 2, h: 1 } }, fn, 90);
  assert.equal(r.kind, "path");
  assert.equal(r.path.anchors.length, 4);
  assert.deepEqual([r.path.anchors[1].x, r.path.anchors[1].y], [-0, 2]);
  assert.equal(rotateVectorShape({ kind: "ellipse", rect: { x: 0, y: 0, w: 2, h: 1 } }, fn, 90), null);
  const poly = rotateVectorShape({ kind: "polygon", polygon: { cx: 1, cy: 0, radius: 5, sides: 5, angle: 0 } }, fn, 90);
  assert.ok(Math.abs(poly.polygon.angle - Math.PI / 2) < 1e-12);
  assert.deepEqual([poly.polygon.cx, poly.polygon.cy], [-0, 1]);
});

// ── 문서 변환 후 가이드 변환(doc-ops.transformGuides) ──
import { transformGuides } from "../js/ops/doc-ops.js";

test("transformGuides: 이미지 크기 배율 — v 는 sx, h 는 sy 로 변환", () => {
  const g = [{ orient: "v", pos: 50 }, { orient: "h", pos: 20 }];
  const out = transformGuides(g, { sx: 2, sy: 0.5, dx: 0, dy: 0 }, 200, 50);
  assert.deepEqual(out, [{ orient: "v", pos: 100 }, { orient: "h", pos: 10 }]);
});

test("transformGuides: 캔버스 크기/재단 오프셋 이동, 문서 밖은 제거", () => {
  const g = [{ orient: "v", pos: 10 }, { orient: "v", pos: 90 }, { orient: "h", pos: 30 }];
  // 왼쪽에 20px 확장(dx=+20): 새 폭 120 → 10→30, 90→110 유지
  assert.deepEqual(
    transformGuides(g, { sx: 1, sy: 1, dx: 20, dy: 0 }, 120, 100).filter((x) => x.orient === "v"),
    [{ orient: "v", pos: 30 }, { orient: "v", pos: 110 }]);
  // 재단(dx=-50): 10→-40 제거, 90→40 유지, h 는 dy=0 이라 그대로
  assert.deepEqual(
    transformGuides(g, { sx: 1, sy: 1, dx: -50, dy: 0 }, 50, 100),
    [{ orient: "v", pos: 40 }, { orient: "h", pos: 30 }]);
  // 새 높이 밖으로 나간 수평선 제거
  assert.deepEqual(transformGuides([{ orient: "h", pos: 30 }], { sx: 1, sy: 1, dx: 0, dy: -40 }, 100, 50), []);
});

test("transformGuides: xf=null(임의 회전)이면 전부 비움", () => {
  assert.deepEqual(transformGuides([{ orient: "v", pos: 5 }], null, 10, 10), []);
});

// ── Dialogs: onOk 가 false 를 반환하면 닫지 않는다(최소 DOM 스텁) ──
function fakeEl(tag) {
  const e = {
    tag, children: [], style: {}, attrs: {}, listeners: {}, className: "", textContent: "", removed: false, tagName: tag.toUpperCase(),
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    remove() { this.removed = true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    click() { for (const f of this.listeners.click || []) f({}); },
  };
  return e;
}

async function withFakeDom(fn) {
  const saved = { document: globalThis.document, window: globalThis.window };
  const keyListeners = [];
  const root = fakeEl("div");
  globalThis.document = { createElement: fakeEl, getElementById: () => root, activeElement: null };
  globalThis.window = {
    addEventListener(t, f) { if (t === "keydown") keyListeners.push(f); },
    removeEventListener(t, f) { const i = keyListeners.indexOf(f); if (i >= 0) keyListeners.splice(i, 1); },
  };
  try { return await fn({ root, keyListeners }); }
  finally { globalThis.document = saved.document; globalThis.window = saved.window; }
}

test("Dialogs: onOk 가 false 를 반환하면 닫히지 않고 오류가 표시된다(버튼/Enter), undefined 면 닫힌다", async () => {
  const { Dialogs } = await import("../js/ui/dialogs.js");
  await withFakeDom(({ root, keyListeners }) => {
    const dlg = new Dialogs({});
    let ok = false;
    dlg.custom("t", fakeEl("div"), (ui) => { if (!ok) { ui.error("잘못된 입력"); return false; } }, null, "확인");
    const backdrop = root.children[0];
    const dialog = backdrop.children[0];
    const okBtn = dialog.children[2].children[1];
    const errLine = dialog.children[1].children[1];
    okBtn.click();
    assert.equal(backdrop.removed, false, "버튼: 검증 실패 시 유지");
    assert.equal(errLine.textContent, "잘못된 입력");
    assert.equal(errLine.style.display, "block");
    keyListeners[0]({ key: "Enter", target: { tagName: "INPUT" }, stopPropagation() {} });
    assert.equal(backdrop.removed, false, "Enter: 검증 실패 시 유지");
    ok = true;
    keyListeners[0]({ key: "Enter", target: { tagName: "INPUT" }, stopPropagation() {} });
    assert.equal(backdrop.removed, true, "통과하면 닫힘");
    assert.equal(keyListeners.length, 0, "keydown 리스너 해제");
  });
});
