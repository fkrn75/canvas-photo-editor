// filters-ext-a.js 단위테스트 — 흐림·선명·노이즈·기타 확장 필터(순수 함수, DOM 무관).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as FX from "../js/engine/filters-ext-a.js";
import { makeImageData, setPixel, getPixel } from "./helpers.js";

// 결정적 의사난수 이미지(시드 고정)
function randomImage(w, h, seed = 7, alpha = 255) {
  const img = makeImageData(w, h);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) & 255);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rnd(); img.data[i + 1] = rnd(); img.data[i + 2] = rnd(); img.data[i + 3] = alpha;
  }
  return img;
}

// 모든 픽셀이 rgb와 tol 이내인지
function nearlyUniform(img, rgb, tol = 1) {
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) if (Math.abs(img.data[i + c] - rgb[c]) > tol) return false;
  }
  return true;
}

function alphaAll(img, a) {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== a) return false;
  return true;
}

// 파라미터별 대표 호출(크기·알파 보존 공통 검사용)
const CASES = {
  blur: (img) => FX.blur(img),
  blurMore: (img) => FX.blurMore(img),
  boxBlur: (img) => FX.boxBlur(img, 3),
  radialSpin: (img) => FX.radialBlur(img, 30, "spin"),
  radialZoom: (img) => FX.radialBlur(img, 30, "zoom"),
  surfaceBlur: (img) => FX.surfaceBlur(img, 3, 20),
  lensBlur: (img) => FX.lensBlur(img, 3, 50),
  average: (img) => FX.average(img),
  sharpenMore: (img) => FX.sharpenMore(img),
  sharpenEdges: (img) => FX.sharpenEdges(img),
  smartSharpen: (img) => FX.smartSharpen(img, 150, 2, 20),
  despeckle: (img) => FX.despeckle(img),
  dustAndScratches: (img) => FX.dustAndScratches(img, 2, 10),
  reduceNoise: (img) => FX.reduceNoise(img, 6, 50),
  customKernel: (img) => FX.customKernel(img, FX.CUSTOM_KERNEL_PRESETS.edge.kernel, 1, 0),
  maximum: (img) => FX.maximum(img, 2),
  minimum: (img) => FX.minimum(img, 2),
  offsetWrap: (img) => FX.offset(img, 3, -2, "wrap"),
  offsetRepeat: (img) => FX.offset(img, 3, -2, "repeat"),
  rgbToHsb: (img) => FX.rgbToHsb(img),
  rgbToHsl: (img) => FX.rgbToHsl(img),
  hsbToRgb: (img) => FX.hsbToRgb(img),
  hslToRgb: (img) => FX.hslToRgb(img),
};

for (const [name, fn] of Object.entries(CASES)) {
  test(`${name}: 크기 유지·불투명 알파 보존·값 유한`, () => {
    const img = randomImage(13, 9);
    const out = fn(img);
    assert.equal(out, img, "제자리 수정 후 같은 객체 반환");
    assert.equal(img.width, 13); assert.equal(img.height, 9);
    assert.equal(img.data.length, 13 * 9 * 4);
    assert.ok(alphaAll(img, 255), "불투명 이미지는 불투명 유지");
  });
}

// 색만 바꾸는 필터는 반투명 알파도 픽셀 단위로 그대로 둬야 한다
for (const name of ["sharpenMore", "sharpenEdges", "smartSharpen", "despeckle", "dustAndScratches",
  "reduceNoise", "customKernel", "maximum", "minimum", "surfaceBlur", "average", "rgbToHsb", "rgbToHsl"]) {
  test(`${name}: 반투명 알파 픽셀별 보존`, () => {
    const img = randomImage(11, 8, 3);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = (i * 37) & 255;
    const before = [];
    for (let i = 3; i < img.data.length; i += 4) before.push(img.data[i]);
    CASES[name](img);
    const after = [];
    for (let i = 3; i < img.data.length; i += 4) after.push(img.data[i]);
    assert.deepEqual(after, before);
  });
}

// 단색 이미지에 흐림·노이즈 계열을 적용해도 불변
for (const name of ["blur", "blurMore", "boxBlur", "radialSpin", "radialZoom", "surfaceBlur", "lensBlur",
  "average", "sharpenMore", "sharpenEdges", "smartSharpen", "despeckle", "dustAndScratches", "reduceNoise",
  "maximum", "minimum", "offsetWrap", "offsetRepeat"]) {
  test(`${name}: 단색 이미지는 불변`, () => {
    const img = makeImageData(10, 7, [90, 140, 200, 255]);
    CASES[name](img);
    assert.ok(nearlyUniform(img, [90, 140, 200], 1));
  });
}

test("boxBlur: 한 점이 (2r+1)² 상자로 고르게 퍼진다", () => {
  const img = makeImageData(9, 9, [0, 0, 0, 255]);
  setPixel(img, 4, 4, [225, 225, 225, 255]);
  FX.boxBlur(img, 1);
  assert.equal(getPixel(img, 4, 4)[0], 25);
  assert.equal(getPixel(img, 3, 3)[0], 25);
  assert.equal(getPixel(img, 5, 5)[0], 25);
  assert.equal(getPixel(img, 2, 4)[0], 0);
});

test("boxBlur: 반경 0은 항등", () => {
  const img = randomImage(6, 6);
  const orig = Uint8ClampedArray.from(img.data);
  FX.boxBlur(img, 0);
  assert.deepEqual(img.data, orig);
});

test("blur/blurMore: 더 흐리게가 점을 더 넓게 퍼뜨린다", () => {
  const a = makeImageData(9, 9, [0, 0, 0, 255]); setPixel(a, 4, 4, [255, 255, 255, 255]);
  const b = makeImageData(9, 9, [0, 0, 0, 255]); setPixel(b, 4, 4, [255, 255, 255, 255]);
  FX.blur(a); FX.blurMore(b);
  assert.equal(getPixel(a, 4, 2)[0], 0, "흐리게는 반경 1까지만");
  assert.ok(getPixel(b, 4, 2)[0] > 0, "더 흐리게는 반경 2 이상으로");
  assert.ok(getPixel(b, 4, 4)[0] < getPixel(a, 4, 4)[0]);
});

test("흐림: 투명 이웃의 검정이 번지지 않는다(프리멀티 처리)", () => {
  const img = makeImageData(5, 1, [0, 0, 0, 0]);
  setPixel(img, 2, 0, [255, 0, 0, 255]);
  FX.boxBlur(img, 1);
  const p = getPixel(img, 1, 0);
  assert.equal(p[0], 255, "색은 순수 빨강 유지");
  assert.ok(p[3] > 0 && p[3] < 255, "알파만 퍼짐");
});

test("radialBlur: 중심 픽셀은 그대로, 바깥은 회전 방향으로 섞인다", () => {
  const img = makeImageData(21, 21, [0, 0, 0, 255]);
  for (let y = 0; y < 21; y++) setPixel(img, 10, y, [255, 255, 255, 255]); // 세로 흰 선
  FX.radialBlur(img, 60, "spin");
  assert.equal(getPixel(img, 10, 10)[0], 255, "중심은 불변");
  const edge = getPixel(img, 10, 0)[0];
  assert.ok(edge < 255, "가장자리 선은 회전으로 흐려짐");
  assert.ok(getPixel(img, 7, 1)[0] > 0, "선 옆으로 번짐");
});

test("radialBlur: 확대 방식은 선을 방사 방향으로 유지한다", () => {
  const img = makeImageData(21, 21, [0, 0, 0, 255]);
  for (let y = 0; y < 21; y++) setPixel(img, 10, y, [255, 255, 255, 255]);
  FX.radialBlur(img, 60, "zoom");
  // 중심을 지나는 선은 확대 방향과 평행 → 그대로
  assert.equal(getPixel(img, 10, 0)[0], 255);
  assert.equal(getPixel(img, 5, 0)[0], 0);
});

test("surfaceBlur: 큰 경계는 보존하고 작은 잡음은 줄인다", () => {
  const img = makeImageData(12, 6, [0, 0, 0, 255]);
  for (let y = 0; y < 6; y++) for (let x = 6; x < 12; x++) setPixel(img, x, y, [250, 250, 250, 255]);
  setPixel(img, 2, 2, [10, 10, 10, 255]); // 어두운 쪽 작은 잡음
  FX.surfaceBlur(img, 2, 15);
  assert.equal(getPixel(img, 5, 3)[0], 0, "경계 왼쪽 유지");
  assert.equal(getPixel(img, 6, 3)[0], 250, "경계 오른쪽 유지");
  assert.ok(getPixel(img, 2, 2)[0] < 10, "잡음 감소");
});

test("lensBlur: 원판으로 퍼지고, 밝은 부분 강조가 클수록 밝은 점이 더 밝게 남는다", () => {
  const mk = () => { const i = makeImageData(15, 15, [0, 0, 0, 255]); setPixel(i, 7, 7, [255, 255, 255, 255]); return i; };
  const a = mk(), b = mk();
  FX.lensBlur(a, 3, 0); FX.lensBlur(b, 3, 100);
  assert.ok(getPixel(a, 7, 10)[0] > 0, "반경 3 안쪽으로 퍼짐");
  assert.equal(getPixel(a, 7, 11)[0], 0, "반경 밖은 영향 없음");
  assert.ok(getPixel(b, 7, 9)[0] > getPixel(a, 7, 9)[0], "강조 시 보케가 더 밝다");
});

test("lensBlur: 반경 상한 초과는 상한으로 제한(크래시 없음)", () => {
  const img = randomImage(8, 8);
  FX.lensBlur(img, 10000, 50);
  assert.ok(alphaAll(img, 255));
});

test("average: 전체 평균색으로 채우고 마스크 밖은 건드리지 않는다", () => {
  const img = makeImageData(2, 2, [0, 0, 0, 255]);
  setPixel(img, 0, 0, [200, 100, 0, 255]);
  setPixel(img, 1, 0, [0, 100, 200, 255]);
  const mask = new Uint8Array([255, 255, 0, 0]);
  FX.average(img, mask);
  assert.deepEqual(getPixel(img, 0, 0), [100, 100, 100, 255]);
  assert.deepEqual(getPixel(img, 1, 0), [100, 100, 100, 255]);
  assert.deepEqual(getPixel(img, 0, 1), [0, 0, 0, 255], "선택 밖 유지");
});

test("average: 투명 픽셀은 평균에 기여하지 않는다", () => {
  const img = makeImageData(2, 1, [0, 0, 0, 0]);
  setPixel(img, 0, 0, [40, 80, 120, 255]);
  FX.average(img);
  assert.deepEqual(getPixel(img, 0, 0), [40, 80, 120, 255]);
  assert.equal(getPixel(img, 1, 0)[3], 0);
});

test("sharpenMore: 대비를 키운다", () => {
  const img = makeImageData(5, 5, [100, 100, 100, 255]);
  setPixel(img, 2, 2, [150, 150, 150, 255]);
  FX.sharpenMore(img);
  assert.ok(getPixel(img, 2, 2)[0] > 150);
  assert.ok(getPixel(img, 1, 1)[0] < 100);
});

test("smartSharpen: 노이즈 감소가 작은 진폭 강조를 억제한다", () => {
  const a = makeImageData(7, 7, [100, 100, 100, 255]); setPixel(a, 3, 3, [104, 104, 104, 255]);
  const b = makeImageData(7, 7, [100, 100, 100, 255]); setPixel(b, 3, 3, [104, 104, 104, 255]);
  FX.smartSharpen(a, 200, 1, 0); FX.smartSharpen(b, 200, 1, 100);
  assert.ok(getPixel(a, 3, 3)[0] > getPixel(b, 3, 3)[0]);
});

test("dustAndScratches: 고립된 점(먼지)을 지운다", () => {
  const img = makeImageData(7, 7, [50, 50, 50, 255]);
  setPixel(img, 3, 3, [255, 255, 255, 255]);
  FX.dustAndScratches(img, 1, 0);
  assert.deepEqual(getPixel(img, 3, 3), [50, 50, 50, 255]);
});

test("dustAndScratches: 한계값보다 작은 차이는 유지", () => {
  const img = makeImageData(7, 7, [50, 50, 50, 255]);
  setPixel(img, 3, 3, [60, 60, 60, 255]);
  FX.dustAndScratches(img, 1, 20);
  assert.deepEqual(getPixel(img, 3, 3), [60, 60, 60, 255]);
});

test("dustAndScratches: 미디언이 정렬 기반 미디언과 일치(랜덤 입력)", () => {
  const img = randomImage(9, 7, 11);
  const ref = Uint8ClampedArray.from(img.data);
  FX.dustAndScratches(img, 2, 0);
  const w = 9, h = 7, r = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const vals = [];
    for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) {
      const xx = Math.min(w - 1, Math.max(0, x + kx)), yy = Math.min(h - 1, Math.max(0, y + ky));
      vals.push(ref[(yy * w + xx) * 4 + c]);
    }
    vals.sort((p, q) => p - q);
    assert.equal(img.data[(y * w + x) * 4 + c], vals[vals.length >> 1]);
  }
});

test("despeckle: 평탄부의 점 잡음은 지우고 강한 경계는 남긴다", () => {
  const img = makeImageData(12, 6, [60, 60, 60, 255]);
  for (let y = 0; y < 6; y++) for (let x = 6; x < 12; x++) setPixel(img, x, y, [240, 240, 240, 255]);
  setPixel(img, 2, 2, [75, 75, 75, 255]);
  FX.despeckle(img);
  assert.equal(getPixel(img, 2, 2)[0], 60, "작은 잡음 제거");
  assert.equal(getPixel(img, 5, 3)[0], 60);
  assert.equal(getPixel(img, 6, 3)[0], 240, "경계 보존");
});

test("reduceNoise: 강도 0은 항등, 작은 잡음은 줄인다", () => {
  const img = randomImage(8, 8);
  const orig = Uint8ClampedArray.from(img.data);
  FX.reduceNoise(img, 0, 50);
  assert.deepEqual(img.data, orig);
  const n = makeImageData(9, 9, [100, 100, 100, 255]);
  setPixel(n, 4, 4, [106, 106, 106, 255]);
  FX.reduceNoise(n, 10, 0);
  assert.ok(getPixel(n, 4, 4)[0] < 106);
});

test("customKernel: 항등 커널은 불변, 비율·오프셋 적용", () => {
  const img = randomImage(6, 5);
  const orig = Uint8ClampedArray.from(img.data);
  const P = FX.CUSTOM_KERNEL_PRESETS.identity;
  FX.customKernel(img, P.kernel, P.scale, P.offset);
  assert.deepEqual(img.data, orig);

  const g = makeImageData(3, 3, [100, 100, 100, 255]);
  FX.customKernel(g, P.kernel.map((v) => v * 2), 4, 10); // 100*2/4 + 10 = 60
  assert.deepEqual(getPixel(g, 1, 1), [60, 60, 60, 255]);
});

test("customKernel: 전부 0 커널·잘못된 길이는 변경 없음", () => {
  const img = randomImage(5, 5);
  const orig = Uint8ClampedArray.from(img.data);
  FX.customKernel(img, new Array(25).fill(0), 1, 50);
  FX.customKernel(img, [1, 2, 3], 1, 0);
  assert.deepEqual(img.data, orig);
});

test("customKernel: 3×3(길이 9)도 지원", () => {
  const img = makeImageData(4, 4, [80, 80, 80, 255]);
  FX.customKernel(img, [0, 0, 0, 0, 2, 0, 0, 0, 0], 1, 0);
  assert.ok(nearlyUniform(img, [160, 160, 160], 0));
});

test("maximum: 밝은 점을 (2r+1)² 정사각으로 넓힌다 / minimum은 반대", () => {
  const img = makeImageData(9, 9, [10, 10, 10, 255]);
  setPixel(img, 4, 4, [200, 200, 200, 255]);
  FX.maximum(img, 2);
  assert.equal(getPixel(img, 2, 2)[0], 200);
  assert.equal(getPixel(img, 6, 6)[0], 200);
  assert.equal(getPixel(img, 1, 4)[0], 10);
  assert.equal(getPixel(img, 7, 4)[0], 10);

  const m = makeImageData(9, 9, [200, 200, 200, 255]);
  setPixel(m, 4, 4, [10, 10, 10, 255]);
  FX.minimum(m, 1);
  assert.equal(getPixel(m, 3, 5)[0], 10);
  assert.equal(getPixel(m, 2, 4)[0], 200);
});

test("maximum/minimum: 무작위 입력에서 무차별 계산과 일치", () => {
  const img = randomImage(10, 8, 5);
  const ref = Uint8ClampedArray.from(img.data);
  const mx = { width: 10, height: 8, data: Uint8ClampedArray.from(ref) };
  const mn = { width: 10, height: 8, data: Uint8ClampedArray.from(ref) };
  FX.maximum(mx, 2); FX.minimum(mn, 3);
  const brute = (r, isMax) => {
    const out = new Uint8ClampedArray(ref.length);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) for (let c = 0; c < 3; c++) {
      let v = isMax ? 0 : 255;
      for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) {
        const xx = x + kx, yy = y + ky;
        if (xx < 0 || yy < 0 || xx >= 10 || yy >= 8) continue;
        const s = ref[(yy * 10 + xx) * 4 + c];
        v = isMax ? Math.max(v, s) : Math.min(v, s);
      }
      out[(y * 10 + x) * 4 + c] = v;
    }
    return out;
  };
  const bmx = brute(2, true), bmn = brute(3, false);
  for (let i = 0; i < ref.length; i++) {
    if ((i & 3) === 3) continue;
    assert.equal(mx.data[i], bmx[i]); assert.equal(mn.data[i], bmn[i]);
  }
});

test("offset: 감싸기는 반대편으로 넘어온다", () => {
  const img = makeImageData(4, 3, [0, 0, 0, 255]);
  setPixel(img, 3, 2, [255, 0, 0, 255]);
  FX.offset(img, 1, 1, "wrap");
  assert.deepEqual(getPixel(img, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(getPixel(img, 3, 2), [0, 0, 0, 255]);
});

test("offset: 음수 이동 감싸기·전체 폭 이동은 항등", () => {
  const img = randomImage(5, 4);
  const orig = Uint8ClampedArray.from(img.data);
  FX.offset(img, -2, 3, "wrap");
  FX.offset(img, 2, -3, "wrap");
  assert.deepEqual(img.data, orig);
  FX.offset(img, 5, 4, "wrap");
  assert.deepEqual(img.data, orig);
});

test("offset: 투명 모드는 빈 곳을 투명으로, 반복 모드는 가장자리 복제", () => {
  const t = makeImageData(3, 1, [9, 9, 9, 255]);
  setPixel(t, 0, 0, [1, 2, 3, 255]);
  FX.offset(t, 1, 0, "transparent");
  assert.equal(getPixel(t, 0, 0)[3], 0);
  assert.deepEqual(getPixel(t, 1, 0), [1, 2, 3, 255]);

  const r = makeImageData(3, 1, [9, 9, 9, 255]);
  setPixel(r, 0, 0, [1, 2, 3, 255]);
  FX.offset(r, 1, 0, "repeat");
  assert.deepEqual(getPixel(r, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(getPixel(r, 1, 0), [1, 2, 3, 255]);
});

test("rgbToHsb/rgbToHsl: 대표색 변환값", () => {
  const img = makeImageData(3, 1);
  setPixel(img, 0, 0, [255, 0, 0, 255]);   // 빨강: H0 S1 B1 / L0.5
  setPixel(img, 1, 0, [0, 0, 255, 255]);   // 파랑: H240
  setPixel(img, 2, 0, [128, 128, 128, 255]); // 회색: S0
  const hsl = { width: 3, height: 1, data: Uint8ClampedArray.from(img.data) };
  FX.rgbToHsb(img);
  assert.deepEqual(getPixel(img, 0, 0), [0, 255, 255, 255]);
  assert.deepEqual(getPixel(img, 1, 0), [170, 255, 255, 255]);
  assert.deepEqual(getPixel(img, 2, 0), [0, 0, 128, 255]);
  FX.rgbToHsl(hsl);
  assert.deepEqual(getPixel(hsl, 0, 0), [0, 255, 128, 255]);
  assert.deepEqual(getPixel(hsl, 2, 0), [0, 0, 128, 255]);
});

test("HSB/HSL 왕복 변환은 원본에 가깝다", () => {
  for (const [fwd, inv] of [[FX.rgbToHsb, FX.hsbToRgb], [FX.rgbToHsl, FX.hslToRgb]]) {
    const img = randomImage(16, 16, 21);
    const orig = Uint8ClampedArray.from(img.data);
    fwd(img); inv(img);
    let maxErr = 0;
    for (let i = 0; i < orig.length; i++) maxErr = Math.max(maxErr, Math.abs(orig[i] - img.data[i]));
    assert.ok(maxErr <= 12, `왕복 오차 ${maxErr}`); // 8비트 H/S 양자화 오차 허용
  }
});

test("성능: 큰 반경 상자 흐림·최댓값이 반경에 무관하게 빠르다", () => {
  const img = randomImage(400, 300, 4);
  const t0 = Date.now();
  FX.boxBlur(img, 150);
  FX.maximum(img, 150);
  FX.minimum(img, 150);
  assert.ok(Date.now() - t0 < 2000);
});
