// filters-ext-a.js — 확장 필터 A (흐림 효과·선명 효과·노이즈·기타).
// 모두 순수 픽셀 연산: ImageData를 제자리(in-place) 수정하고 같은 img를 반환한다(filters.js와 동일 계약).
// DOM 의존 없음 → Node 단위테스트 가능. 큰 이미지(4000×3000)를 고려해 상자/최댓값/최솟값은 O(n),
// 미디언은 히스토그램 슬라이딩(Huang) O(n·r), 방사형 흐림은 배가 패스 O(n·log 호길이),
// 렌즈 흐림은 행 누적합 원판 + 큰 반경은 축소본 계산으로 구현한다.

import { stackBlur } from "./blur.js";
import { unsharpMask } from "./filters.js";

// ── 공통 유틸 ──

// 숫자 정수화 + 범위 제한(NaN/undefined는 lo 쪽으로)
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
};
const clampNum = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
};

// 프리멀티플라이드 Float32 버퍼(r·a, g·a, b·a, a — 0~255 스케일)로 변환.
// 흐림 계열은 알파까지 함께 섞이므로, 투명 픽셀의 (보통 검정인) RGB가 번져 테두리가 어두워지는 것을 막는다.
function toPremul(img) {
  const d = img.data, n = d.length;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const a = d[i + 3], k = a / 255;
    buf[i] = d[i] * k; buf[i + 1] = d[i + 1] * k; buf[i + 2] = d[i + 2] * k; buf[i + 3] = a;
  }
  return buf;
}

// 프리멀티 버퍼를 일반(straight) RGBA로 되돌려 img에 기록. 완전 투명 결과는 RGB를 건드리지 않는다.
function fromPremul(img, buf) {
  const d = img.data, n = d.length;
  for (let i = 0; i < n; i += 4) {
    const a = buf[i + 3];
    if (a < 0.5) { d[i + 3] = 0; continue; }
    const k = 255 / a;
    d[i] = buf[i] * k; d[i + 1] = buf[i + 1] * k; d[i + 2] = buf[i + 2] * k; d[i + 3] = a;
  }
  return img;
}

// 1차원 이동 평균(가장자리 복제). 4채널 인터리브 버퍼 src → dst. 누적합 슬라이딩이라 반경과 무관하게 O(len).
function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const inv = 1 / (2 * r + 1), last = len - 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const j = k < 0 ? 0 : k > last ? last : k;
        sum += src[base + j * step + c];
      }
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum * inv;
        const add = i + r + 1 > last ? last : i + r + 1;
        const rem = i - r < 0 ? 0 : i - r;
        sum += src[base + add * step + c] - src[base + rem * step + c];
      }
    }
  }
}

// 작은 대칭 커널(예: [1,2,1]) 1차원 컨벌루션(가장자리 복제). 커널 합으로 정규화한다.
function kernelPass(src, dst, w, h, kernel, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const half = kernel.length >> 1, last = len - 1;
  let ksum = 0; for (const k of kernel) ksum += k;
  const inv = 1 / ksum;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let i = 0; i < len; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kernel.length; k++) {
        let j = i + k - half;
        j = j < 0 ? 0 : j > last ? last : j;
        const p = base + j * step, wt = kernel[k];
        r += src[p] * wt; g += src[p + 1] * wt; b += src[p + 2] * wt; a += src[p + 3] * wt;
      }
      const o = base + i * step;
      dst[o] = r * inv; dst[o + 1] = g * inv; dst[o + 2] = b * inv; dst[o + 3] = a * inv;
    }
  }
}

// 이미지 복사본(ImageData 호환). stackBlur 등 제자리 연산을 원본 보존하며 쓰기 위함.
function cloneImg(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

// ══════════════════ 흐림 효과 ══════════════════

// 흐리게(Blur): [1,2,1] 이항 커널을 가로·세로로 한 번 — 아주 약한 흐림.
export function blur(img) {
  return _binomialBlur(img, 1);
}

// 더 흐리게(Blur More): 같은 커널을 3회 반복 — 흐리게의 약 3배.
export function blurMore(img) {
  return _binomialBlur(img, 3);
}

function _binomialBlur(img, passes) {
  const { width: w, height: h } = img;
  if (w < 1 || h < 1) return img;
  const buf = toPremul(img), tmp = new Float32Array(buf.length);
  const k = [1, 2, 1];
  for (let p = 0; p < passes; p++) {
    kernelPass(buf, tmp, w, h, k, true);
    kernelPass(tmp, buf, w, h, k, false);
  }
  return fromPremul(img, buf);
}

// 상자 흐림(Box Blur): 정사각 (2r+1)² 평균. 분리형 누적합이라 반경과 무관하게 O(n).
export function boxBlur(img, radius = 5) {
  const r = clampInt(radius, 0, 2000);
  const { width: w, height: h } = img;
  if (r < 1 || w < 1 || h < 1) return img;
  const buf = toPremul(img), tmp = new Float32Array(buf.length);
  boxPass(buf, tmp, w, h, r, true);
  boxPass(tmp, buf, w, h, r, false);
  return fromPremul(img, buf);
}

// 방사형 흐림 최대 배가(doubling) 패스 수 → 최대 2^12 = 4096 샘플 등가.
export const RADIAL_BLUR_MAX_PASSES = 12;

// 아핀 2점 평균 패스: dst(p) = ½[src(T1·p) + src(T2·p)].
// T = [a, b, c, d, e, f] → 소스 좌표 sx = a·x + b·y + c, sy = d·x + e·y + f (이중선형 보간, 가장자리 복제).
// T1 이 null 이면 src(p) 를 그대로 쓴다. 행 안에서 소스 좌표가 선형으로 움직이므로 메모리 접근이 거의 순차적이다.
// (핫 루프라 보간을 함수로 빼지 않고 펼쳐 둔다)
function affineAvgPass(src, dst, w, h, T1, T2) {
  const xmax = w - 1, ymax = h - 1;
  const two = !!T1;
  const [a1, b1, c1, d1, e1, f1] = T1 || [1, 0, 0, 0, 1, 0];
  const [a2, b2, c2, d2, e2, f2] = T2;
  for (let y = 0; y < h; y++) {
    // 행 시작 소스 좌표(x=0) — 이후 x 마다 (a, d) 만큼 증가
    let ux = b1 * y + c1, uy = e1 * y + f1;
    let vx = b2 * y + c2, vy = e2 * y + f2;
    for (let x = 0; x < w; x++, ux += a1, uy += d1, vx += a2, vy += d2) {
      const o = (y * w + x) * 4;
      let r, g, b, al;
      if (two) {
        const sx = ux < 0 ? 0 : ux > xmax ? xmax : ux;
        const sy = uy < 0 ? 0 : uy > ymax ? ymax : uy;
        const x0 = sx | 0, y0 = sy | 0;
        const x1 = x0 < xmax ? x0 + 1 : x0, y1 = y0 < ymax ? y0 + 1 : y0;
        const fx = sx - x0, fy = sy - y0, gx = 1 - fx, gy = 1 - fy;
        const w00 = gx * gy, w10 = fx * gy, w01 = gx * fy, w11 = fx * fy;
        const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
        r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
        g = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
        b = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
        al = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
      } else {
        r = src[o]; g = src[o + 1]; b = src[o + 2]; al = src[o + 3];
      }
      const sx = vx < 0 ? 0 : vx > xmax ? xmax : vx;
      const sy = vy < 0 ? 0 : vy > ymax ? ymax : vy;
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = x0 < xmax ? x0 + 1 : x0, y1 = y0 < ymax ? y0 + 1 : y0;
      const fx = sx - x0, fy = sy - y0, gx = 1 - fx, gy = 1 - fy;
      const w00 = gx * gy, w10 = fx * gy, w01 = gx * fy, w11 = fx * fy;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      dst[o] = (r + src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11) * 0.5;
      dst[o + 1] = (g + src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11) * 0.5;
      dst[o + 2] = (b + src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11) * 0.5;
      dst[o + 3] = (al + src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11) * 0.5;
    }
  }
}

// 중심 (cx,cy) 기준 각도 φ 회전의 아핀 계수
function rotT(phi, cx, cy) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy];
}
// 중심 (cx,cy) 기준 배율 q 의 아핀 계수
function scaleT(q, cx, cy) {
  return [q, 0, cx - q * cx, 0, q, cy - q * cy];
}

// 방사형 흐림(Radial Blur). amount 1~100, mode "spin"(회전) | "zoom"(확대).
// cx, cy: 중심(픽셀 좌표). 생략하면 이미지 중앙.
// 픽셀마다 호를 따라 수십 번 샘플링하면 큰 이미지에서 캐시 미스로 매우 느리므로, "배가 패스"로 계산한다:
//   A₁(p) = ½[A₀(R_a·p) + A₀(R_{a+Δ}·p)],  A_{j+1}(p) = ½[A_j(p) + A_j(R_{2^j·Δ}·p)]
// k 패스 후 결과는 각도 a, a+Δ, …, a+(2^k−1)Δ 의 균일 평균(회전은 같은 중심에서 가환이라 합성 가능).
// 2^k 를 가장 바깥 호 길이의 절반 이상으로 잡아 샘플 간격 ≤ 2px(이중선형이 메움) → 고스트(겹상) 없음. 비용 O(n·k).
// 확대는 같은 방식으로 배율 ρ^m (m=0…2^k−1, 1 → 1−span 로그 균등) 평균.
export function radialBlur(img, amount = 10, mode = "spin", cx, cy) {
  const { width: w, height: h } = img;
  const amt = clampNum(amount, 0, 100);
  if (amt <= 0 || w < 1 || h < 1) return img;
  const ccx = Number.isFinite(cx) ? cx : (w - 1) / 2;
  const ccy = Number.isFinite(cy) ? cy : (h - 1) / 2;
  // 중심에서 가장 먼 모서리까지 거리(가장 긴 호/광선의 기준)
  const maxR = Math.max(
    Math.hypot(ccx, ccy), Math.hypot(w - 1 - ccx, ccy),
    Math.hypot(ccx, h - 1 - ccy), Math.hypot(w - 1 - ccx, h - 1 - ccy));
  const spin = mode !== "zoom";
  const theta = (amt / 100) * (Math.PI / 2); // 회전: 최대 총 90° 호
  const span = (amt / 100) * 0.5;            // 확대: 최대 반지름의 50% 구간
  const pathLen = spin ? theta * maxR : span * maxR;
  if (pathLen < 1) return img; // 1px 미만 이동은 변화 없음
  const k = Math.min(RADIAL_BLUR_MAX_PASSES, Math.max(1, Math.ceil(Math.log2(pathLen / 2 + 1))));
  const N = 2 ** k;
  let A = toPremul(img), B = new Float32Array(A.length);
  if (spin) {
    const delta = theta / (N - 1), a0 = -theta / 2;
    affineAvgPass(A, B, w, h, rotT(a0, ccx, ccy), rotT(a0 + delta, ccx, ccy));
    for (let j = 1; j < k; j++) {
      [A, B] = [B, A];
      affineAvgPass(A, B, w, h, null, rotT(delta * 2 ** j, ccx, ccy));
    }
  } else {
    const rho = Math.pow(1 - span, 1 / (N - 1));
    affineAvgPass(A, B, w, h, null, scaleT(rho, ccx, ccy));
    for (let j = 1; j < k; j++) {
      [A, B] = [B, A];
      affineAvgPass(A, B, w, h, null, scaleT(Math.pow(rho, 2 ** j), ccx, ccy));
    }
  }
  return fromPremul(img, B);
}

// 표면 흐림(Surface Blur): 가장자리 보존 흐림. 이웃과의 채널 차이가 threshold보다 클수록 가중치가 줄어
// (w = 1 − |Δ|/(2.5·threshold)) 경계는 남고 평탄부만 흐려진다. 알파는 보존(투명 이웃은 가중치 0).
// 큰 반경은 축당 샘플 7개 이하가 되도록 간격(stride)을 벌려 근사한다 → 픽셀당 최대 49 샘플.
export function surfaceBlur(img, radius = 5, threshold = 15) {
  const { width: w, height: h } = img;
  const r = clampInt(radius, 0, 100);
  const thr = clampNum(threshold, 1, 255);
  if (r < 1 || w < 1 || h < 1) return img;
  const stride = Math.max(1, Math.ceil((2 * r + 1) / 7));
  const m = Math.floor(r / stride) * stride; // 0을 포함하는 대칭 범위
  const src = new Uint8ClampedArray(img.data), d = img.data;
  // 가중치 룩업: lut[Δ+255] = max(0, 1 − |Δ|/(2.5·thr)) → 분기·abs 없이 누적
  const lut = new Float32Array(511);
  for (let k = -255; k <= 255; k++) lut[k + 255] = Math.max(0, 1 - Math.abs(k) / (2.5 * thr));
  const af = new Float32Array(256);
  for (let k = 0; k < 256; k++) af[k] = k / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] === 0) continue;
      const r0 = 255 - src[o], g0 = 255 - src[o + 1], b0 = 255 - src[o + 2];
      let sr = 0, sg = 0, sb = 0, wr = 0, wg = 0, wb = 0;
      for (let ky = -m; ky <= m; ky += stride) {
        let yy = y + ky; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
        const row = yy * w;
        for (let kx = -m; kx <= m; kx += stride) {
          let xx = x + kx; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
          const i = (row + xx) * 4;
          const a = af[src[i + 3]];
          const vr = src[i], vg = src[i + 1], vb = src[i + 2];
          const tr = lut[vr + r0] * a, tg = lut[vg + g0] * a, tb = lut[vb + b0] * a;
          wr += tr; sr += tr * vr; wg += tg; sg += tg * vg; wb += tb; sb += tb * vb;
        }
      }
      // 중심 픽셀은 항상 가중치>0이므로 0 나눗셈 없음
      d[o] = sr / wr; d[o + 1] = sg / wg; d[o + 2] = sb / wb;
    }
  }
  return img;
}

// 렌즈 흐림 반경 상한(px).
export const LENS_BLUR_MAX_RADIUS = 100;
// 원판 합산은 픽셀당 (2r+1)회라 큰 반경은 축소본에서 계산한다:
// 축소 해상도에서의 반경이 이 값 이하가 되도록 배율 s 를 고르고, 결과를 이중선형으로 확대한다.
const LENS_WORK_RADIUS = 3;

// 단일 평면 원판 평균(이미지 밖은 제외하고 남은 픽셀 수로 나눔). 행 누적합 → 픽셀당 (2r+1)회.
// hw[k]: dy=k−r 행의 원판 반폭. prefix: (w+1)·h 작업 버퍼.
function discAverage(plane, out, w, h, r, hw, prefix) {
  const W1 = w + 1;
  for (let y = 0; y < h; y++) {
    let s = 0; const base = y * W1; prefix[base] = 0;
    for (let x = 0; x < w; x++) { s += plane[y * w + x]; prefix[base + x + 1] = s; }
  }
  for (let y = 0; y < h; y++) {
    const k0 = y - r < 0 ? r - y : 0;
    const k1 = y + r >= h ? r + (h - 1 - y) : 2 * r;
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let k = k0; k <= k1; k++) {
        const half = hw[k];
        const x0 = x - half < 0 ? 0 : x - half;
        const x1 = x + half >= w ? w - 1 : x + half;
        const base = (y + k - r) * W1;
        sum += prefix[base + x1 + 1] - prefix[base + x0];
        cnt += x1 - x0 + 1;
      }
      out[y * w + x] = sum / cnt;
    }
  }
}

// 렌즈 흐림(Lens Blur): 원형 조리개(원판 커널) 평균 + 밝은 부분 강조.
// brightness 0~100: 값을 γ(1~4)제곱 공간에서 섞어 밝은 점이 둥근 보케로 커지게 한다(0이면 순수 원판 평균).
// 색은 알파 가중(프리멀티)으로 섞어 투명 영역의 색이 번지지 않는다. 반경 > LENS_WORK_RADIUS 이면 축소 처리.
export function lensBlur(img, radius = 10, brightness = 0) {
  const { width: w, height: h, data: d } = img;
  const r = clampInt(radius, 0, LENS_BLUR_MAX_RADIUS);
  if (r < 1 || w < 1 || h < 1) return img;
  const gamma = 1 + (clampNum(brightness, 0, 100) / 100) * 3;
  const invGamma = 1 / gamma;
  // 작업 배율·축소 크기·축소 반경
  const s = r > LENS_WORK_RADIUS ? Math.ceil(r / LENS_WORK_RADIUS) : 1;
  const sw = Math.ceil(w / s), sh = Math.ceil(h / s), sn = sw * sh;
  const rs = Math.max(1, Math.round(r / s));
  const hw = new Int32Array(2 * rs + 1);
  for (let dy = -rs; dy <= rs; dy++) hw[dy + rs] = Math.floor(Math.sqrt(rs * rs + rs - dy * dy));
  const prefix = new Float32Array((sw + 1) * sh);
  // (v/255)^γ 룩업
  const powLut = new Float32Array(256);
  for (let v = 0; v < 256; v++) powLut[v] = Math.pow(v / 255, gamma);
  // 역변환 v^(1/γ)·255 룩업(4096 구간 선형 보간) — 픽셀마다 Math.pow 를 부르지 않기 위함
  const INV_N = 4096;
  const invLut = new Float32Array(INV_N + 2);
  for (let k = 0; k <= INV_N; k++) invLut[k] = Math.pow(k / INV_N, invGamma) * 255;
  invLut[INV_N + 1] = invLut[INV_N];

  // 블록 평균 축소: valueAt(i=픽셀 바이트 인덱스) 를 s×s 블록마다 평균해 plane 에 기록
  const blockCnt = new Float32Array(sn);
  for (let y = 0; y < h; y++) {
    const row = ((y / s) | 0) * sw;
    for (let x = 0; x < w; x++) blockCnt[row + ((x / s) | 0)]++;
  }
  const small = new Float32Array(sn);
  const shrink = (valueAt) => {
    small.fill(0);
    for (let y = 0; y < h; y++) {
      const row = ((y / s) | 0) * sw;
      for (let x = 0; x < w; x++) small[row + ((x / s) | 0)] += valueAt((y * w + x) * 4);
    }
    for (let q = 0; q < sn; q++) small[q] /= blockCnt[q];
  };

  // 확대용 이중선형 좌표 테이블(s=1이면 정확히 항등)
  const mkAxis = (len, slen) => {
    const i0 = new Int32Array(len), i1 = new Int32Array(len), f = new Float32Array(len);
    for (let t = 0; t < len; t++) {
      let u = (t + 0.5) / s - 0.5;
      u = u < 0 ? 0 : u > slen - 1 ? slen - 1 : u;
      const a = u | 0;
      i0[t] = a; i1[t] = a < slen - 1 ? a + 1 : a; f[t] = u - a;
    }
    return { i0, i1, f };
  };
  const ax = mkAxis(w, sw), ay = mkAxis(h, sh);
  const up = (plane, x, y) => {
    const fx = ax.f[x], fy = ay.f[y];
    const r0 = ay.i0[y] * sw, r1 = ay.i1[y] * sw, c0 = ax.i0[x], c1 = ax.i1[x];
    const top = plane[r0 + c0] + (plane[r0 + c1] - plane[r0 + c0]) * fx;
    const bot = plane[r1 + c0] + (plane[r1 + c1] - plane[r1 + c0]) * fx;
    return top + (bot - top) * fy;
  };

  // 1) 알파 평면 원판 평균(색 정규화 분모 + 결과 알파)
  shrink((i) => d[i + 3] / 255);
  const avgA = new Float32Array(sn);
  discAverage(small, avgA, sw, sh, rs, hw, prefix);
  const { i0: xi0, i1: xi1, f: xf } = ax, { i0: yi0, i1: yi1, f: yf } = ay;
  // 2) 색 채널: (v/255)^γ · a 를 원판 평균 → avgA 로 나눈 뒤 1/γ 제곱으로 복원
  const avgC = new Float32Array(sn);
  for (let c = 0; c < 3; c++) {
    shrink((i) => powLut[d[i + c]] * (d[i + 3] / 255));
    discAverage(small, avgC, sw, sh, rs, hw, prefix);
    for (let y = 0; y < h; y++) {
      const r0 = yi0[y] * sw, r1 = yi1[y] * sw, fy = yf[y];
      for (let x = 0; x < w; x++) {
        const c0 = xi0[x], c1 = xi1[x], fx = xf[x];
        // 이중선형 확대(알파·색 동일 좌표)
        let t = avgA[r0 + c0] + (avgA[r0 + c1] - avgA[r0 + c0]) * fx;
        let b = avgA[r1 + c0] + (avgA[r1 + c1] - avgA[r1 + c0]) * fx;
        const A = t + (b - t) * fy;
        if (A <= 1e-6) continue; // 주변이 전부 투명: 색 유지
        t = avgC[r0 + c0] + (avgC[r0 + c1] - avgC[r0 + c0]) * fx;
        b = avgC[r1 + c0] + (avgC[r1 + c1] - avgC[r1 + c0]) * fx;
        let v = (t + (b - t) * fy) / A;
        v = v <= 0 ? 0 : v >= 1 ? 1 : v;
        const u = v * INV_N, k = u | 0;
        d[(y * w + x) * 4 + c] = invLut[k] + (invLut[k + 1] - invLut[k]) * (u - k);
      }
    }
  }
  // 3) 알파는 마지막에 기록(색 채널 계산이 원본 알파를 참조하므로)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = up(avgA, x, y) * 255;
  }
  return img;
}

// 평균(Average): 선택 영역(또는 전체)의 알파 가중 평균색으로 RGB를 채운다. 픽셀별 알파는 보존.
// mask: 이미지와 같은 크기의 Uint8 마스크(0=비선택, 255=완전 선택; 중간값은 가중치). null이면 전체.
export function average(img, mask = null) {
  const d = img.data, n = img.width * img.height;
  let sr = 0, sg = 0, sb = 0, sw = 0;
  for (let p = 0; p < n; p++) {
    const m = mask ? mask[p] : 255;
    if (!m) continue;
    const i = p * 4;
    const wt = (d[i + 3] / 255) * (m / 255);
    sr += d[i] * wt; sg += d[i + 1] * wt; sb += d[i + 2] * wt; sw += wt;
  }
  if (sw <= 0) return img; // 평균 낼 불투명 픽셀이 없으면 변경 없음
  const ar = sr / sw, ag = sg / sw, ab = sb / sw;
  for (let p = 0; p < n; p++) {
    if (mask && !mask[p]) continue;
    const i = p * 4;
    d[i] = ar; d[i + 1] = ag; d[i + 2] = ab;
  }
  return img;
}

// ══════════════════ 선명 효과 ══════════════════

// 더 선명하게(Sharpen More): 8방향 3×3 샤픈 커널(중심 10, 이웃 −1, 비율 2).
export function sharpenMore(img) {
  return customKernel(img, [
    0, 0, 0, 0, 0,
    0, -1, -1, -1, 0,
    0, -1, 10, -1, 0,
    0, -1, -1, -1, 0,
    0, 0, 0, 0, 0,
  ], 2, 0);
}

// 가장자리 선명하게(Sharpen Edges): 색 변화가 큰 곳만 선명하게 — 임계값 있는 언샤프 마스크 재사용.
export function sharpenEdges(img) {
  return unsharpMask(img, 100, 1, 12);
}

// 스마트 샤픈(Smart Sharpen): 언샤프 마스크 + 노이즈 감소.
// amount(%) 0~500, radius(px) 0.1~64, noise(%) 0~100: 고주파 성분 중 작은 진폭(잡음)을 부드럽게 깎는다(소프트 코어링).
export function smartSharpen(img, amount = 100, radius = 1, noise = 10) {
  const { width: w, height: h } = img;
  if (w < 1 || h < 1) return img;
  const amt = clampNum(amount, 0, 1000) / 100;
  const r = Math.max(1, clampInt(radius, 1, 254));
  const t = (clampNum(noise, 0, 100) / 100) * 24; // 코어링 임계(레벨 단위, 최대 24)
  if (amt === 0) return img;
  const blurImg = cloneImg(img);
  stackBlur(blurImg, r);
  const bl = blurImg.data, d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = d[i + c];
      let diff = o - bl[i + c];
      if (t > 0) {
        const ad = Math.abs(diff);
        if (ad < t) { const k = ad / t; diff *= k * k; } // 작은 진폭일수록 강하게 억제(연속적)
      }
      d[i + c] = o + diff * amt;
    }
  }
  return img;
}

// ══════════════════ 노이즈 ══════════════════

// 채널별 미디언(RGB만, 알파 보존). Huang 히스토그램 슬라이딩 → 픽셀당 O(r).
// 채널마다 1바이트 평면으로 떼어 처리해 세로 방향 접근의 캐시 효율을 높인다.
// 반환: 미디언 결과가 담긴 새 Uint8ClampedArray(알파는 원본 복사).
function medianRGB(img, r) {
  const { width: w, height: h, data: src } = img;
  const n = w * h;
  const dst = new Uint8ClampedArray(src);
  const hist = new Int32Array(256);
  const half = ((2 * r + 1) * (2 * r + 1)) >> 1;
  const plane = new Uint8Array(n), out = new Uint8Array(n);
  // 세로 클램프 행 오프셋 테이블(행 y+ky → 시작 인덱스), 가로 클램프는 루프에서 처리
  const rows = new Int32Array(2 * r + 1);
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < n; p++) plane[p] = src[p * 4 + c];
    for (let y = 0; y < h; y++) {
      for (let ky = -r; ky <= r; ky++) {
        const yy = y + ky;
        rows[ky + r] = (yy < 0 ? 0 : yy >= h ? h - 1 : yy) * w;
      }
      hist.fill(0);
      for (let k = 0; k <= 2 * r; k++) {
        const row = rows[k];
        for (let kx = -r; kx <= r; kx++) hist[plane[row + (kx < 0 ? 0 : kx >= w ? w - 1 : kx)]]++;
      }
      let m = 0, lt = 0;
      while (lt + hist[m] <= half) { lt += hist[m]; m++; }
      out[y * w] = m;
      for (let x = 1; x < w; x++) {
        let xo = x - r - 1, xi = x + r;
        xo = xo < 0 ? 0 : xo; xi = xi >= w ? w - 1 : xi;
        for (let k = 0; k <= 2 * r; k++) {
          const row = rows[k];
          const vo = plane[row + xo], vi = plane[row + xi];
          if (vo === vi) continue; // 같은 값이 나가고 들어오면 변화 없음(평탄부에서 흔함)
          hist[vo]--; hist[vi]++;
          lt += (vi < m) - (vo < m);
        }
        while (lt > half) { m--; lt -= hist[m]; }
        while (lt + hist[m] <= half) { lt += hist[m]; m++; }
        out[y * w + x] = m;
      }
    }
    for (let p = 0; p < n; p++) dst[p * 4 + c] = out[p];
  }
  return dst;
}

// 반점 제거(Despeckle): 가장자리(휘도 소벨 기울기 큼)는 두고, 평탄부만 3×3 미디언으로 잡티를 지운다.
export function despeckle(img, edgeThreshold = 40) {
  const { width: w, height: h, data: d } = img;
  if (w < 1 || h < 1) return img;
  const med = medianRGB(img, 1);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const thr2 = edgeThreshold * edgeThreshold;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      const tl = gray[ym * w + xm], tc = gray[ym * w + x], tr = gray[ym * w + xp];
      const ml = gray[y * w + xm], mr = gray[y * w + xp];
      const bl = gray[yp * w + xm], bc = gray[yp * w + x], br = gray[yp * w + xp];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      if (gx * gx + gy * gy >= thr2) continue; // 가장자리 보존
      const o = (y * w + x) * 4;
      d[o] = med[o]; d[o + 1] = med[o + 1]; d[o + 2] = med[o + 2];
    }
  }
  return img;
}

// 먼지와 스크래치 반경 상한(px)
export const DUST_MAX_RADIUS = 10;

// 먼지와 스크래치(Dust & Scratches): 반경 r 미디언과 차이가 threshold를 넘는 채널값만 미디언으로 교체.
// radius 1~10(상한 — 미디언 갱신이 픽셀당 O(r)), threshold 0~255(0이면 순수 미디언).
export function dustAndScratches(img, radius = 1, threshold = 0) {
  const r = clampInt(radius, 1, DUST_MAX_RADIUS);
  const thr = clampNum(threshold, 0, 255);
  if (img.width < 1 || img.height < 1) return img;
  const med = medianRGB(img, r), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(d[i + c] - med[i + c]) > thr) d[i + c] = med[i + c];
    }
  }
  return img;
}

// 노이즈 감소(Reduce Noise): strength 0~10, preserve(세부 보존 %) 0~100.
// 흐림본과의 차이(고주파) 중 잡음 수준(σ = strength·4 레벨)보다 작은 진폭을 부드럽게 억제한다.
// 세부 보존이 클수록 σ를 줄여(최대 70%↓) 미세한 질감을 남긴다. 알파 보존.
export function reduceNoise(img, strength = 5, preserve = 60) {
  const s = clampNum(strength, 0, 10);
  if (s <= 0 || img.width < 1 || img.height < 1) return img;
  const p = clampNum(preserve, 0, 100) / 100;
  const sigma = s * 4 * (1 - 0.7 * p);
  const blurImg = cloneImg(img);
  stackBlur(blurImg, 1 + Math.round(s / 4));
  const bl = blurImg.data, d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const b = bl[i + c];
      const diff = d[i + c] - b;
      const ad = Math.abs(diff);
      if (ad >= sigma) continue; // 진짜 디테일(큰 진폭)은 원본 유지
      const k = ad / sigma;
      d[i + c] = b + diff * k * k;
    }
  }
  return img;
}

// ══════════════════ 기타 ══════════════════

// 사용자 정의(Custom): 정사각 커널(길이 9 또는 25 등 n²) 컨벌루션. 결과 = Σ(k·v)/scale + offset.
// scale 0은 1로 취급, 가장자리 복제, 알파 보존. 커널이 전부 0이면 변경 없음(포토샵 동작).
export function customKernel(img, kernel, scale = 1, offset = 0) {
  const { width: w, height: h } = img;
  const size = Math.round(Math.sqrt(kernel?.length || 0));
  if (!size || size * size !== kernel.length || w < 1 || h < 1) return img;
  const half = size >> 1;
  const taps = [];
  for (let ky = 0; ky < size; ky++) {
    for (let kx = 0; kx < size; kx++) {
      const wt = Number(kernel[ky * size + kx]) || 0;
      if (wt !== 0) taps.push(kx - half, ky - half, wt);
    }
  }
  if (!taps.length) return img;
  const sc = Number(scale) || 1;
  const off = Number(offset) || 0;
  const inv = 1 / sc;
  const src = new Uint8ClampedArray(img.data), d = img.data;
  const T = taps.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let t = 0; t < T; t += 3) {
        let xx = x + taps[t], yy = y + taps[t + 1];
        xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
        yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
        const i = (yy * w + xx) * 4, wt = taps[t + 2];
        r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt;
      }
      const o = (y * w + x) * 4;
      d[o] = r * inv + off; d[o + 1] = g * inv + off; d[o + 2] = b * inv + off;
    }
  }
  return img;
}

// 사용자 정의 다이얼로그용 5×5 프리셋 { 이름: { kernel, scale, offset } }
export const CUSTOM_KERNEL_PRESETS = {
  sharpen: { label: "선명하게", scale: 1, offset: 0, kernel: [
    0, 0, 0, 0, 0,  0, 0, -1, 0, 0,  0, -1, 5, -1, 0,  0, 0, -1, 0, 0,  0, 0, 0, 0, 0] },
  blur: { label: "흐리게", scale: 25, offset: 0, kernel: new Array(25).fill(1) },
  edge: { label: "가장자리 검출", scale: 1, offset: 0, kernel: [
    0, 0, 0, 0, 0,  0, -1, -1, -1, 0,  0, -1, 8, -1, 0,  0, -1, -1, -1, 0,  0, 0, 0, 0, 0] },
  emboss: { label: "엠보스", scale: 1, offset: 128, kernel: [
    0, 0, 0, 0, 0,  0, -1, -1, 0, 0,  0, -1, 0, 1, 0,  0, 0, 1, 1, 0,  0, 0, 0, 0, 0] },
  identity: { label: "원본(항등)", scale: 1, offset: 0, kernel: [
    0, 0, 0, 0, 0,  0, 0, 0, 0, 0,  0, 0, 1, 0, 0,  0, 0, 0, 0, 0,  0, 0, 0, 0, 0] },
};

// 1차원 슬라이딩 최댓값/최솟값(단조 덱). 윈도 [i−r, i+r]∩[0,len). O(len).
function extremePass(src, dst, w, h, r, horizontal, isMax, c, dq) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  for (let l = 0; l < lines; l++) {
    const base = (horizontal ? l * w * 4 : l * 4) + c;
    let head = 0, tail = 0;
    for (let j = 0; j < len + r; j++) {
      if (j < len) {
        const v = src[base + j * step];
        if (isMax) { while (tail > head && src[base + dq[tail - 1] * step] <= v) tail--; }
        else { while (tail > head && src[base + dq[tail - 1] * step] >= v) tail--; }
        dq[tail++] = j;
      }
      const i = j - r;
      if (i < 0) continue;
      while (dq[head] < i - r) head++;
      dst[base + i * step] = src[base + dq[head] * step];
    }
  }
}

function _extreme(img, radius, isMax) {
  const { width: w, height: h } = img;
  const r = clampInt(radius, 0, 1000);
  if (r < 1 || w < 1 || h < 1) return img;
  const d = img.data;
  const tmp = new Uint8ClampedArray(d);
  const src = new Uint8ClampedArray(d);
  const dq = new Int32Array(Math.max(w, h));
  for (let c = 0; c < 3; c++) { // RGB만 — 알파 보존
    extremePass(src, tmp, w, h, r, true, isMax, c, dq);
    extremePass(tmp, d, w, h, r, false, isMax, c, dq);
  }
  return img;
}

// 최댓값(Maximum): 정사각 반경 r 안의 채널별 최댓값 → 밝은 영역이 넓어진다. 분리형 단조 덱 O(n).
export function maximum(img, radius = 1) { return _extreme(img, radius, true); }

// 최솟값(Minimum): 정사각 반경 r 안의 채널별 최솟값 → 어두운 영역이 넓어진다.
export function minimum(img, radius = 1) { return _extreme(img, radius, false); }

// 오프셋(Offset): 가로 dx·세로 dy 픽셀 이동(양수=오른쪽/아래).
// mode: "wrap"(감싸기) | "repeat"(가장자리 반복) | "transparent"(빈 곳 투명).
export function offset(img, dx = 0, dy = 0, mode = "wrap") {
  const { width: w, height: h } = img;
  if (w < 1 || h < 1) return img;
  const ox = Math.round(Number(dx) || 0), oy = Math.round(Number(dy) || 0);
  if (ox === 0 && oy === 0) return img;
  const src = new Uint8ClampedArray(img.data), d = img.data;
  for (let y = 0; y < h; y++) {
    let sy = y - oy;
    let rowOut = false;
    if (mode === "wrap") sy = ((sy % h) + h) % h;
    else if (mode === "repeat") sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
    else if (sy < 0 || sy >= h) rowOut = true;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let sx = x - ox;
      if (mode === "wrap") sx = ((sx % w) + w) % w;
      else if (mode === "repeat") sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
      else if (rowOut || sx < 0 || sx >= w) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; continue; }
      const i = (sy * w + sx) * 4;
      d[o] = src[i]; d[o + 1] = src[i + 1]; d[o + 2] = src[i + 2]; d[o + 3] = src[i + 3];
    }
  }
  return img;
}

// ── HSB/HSL 변환 ──
// 채널 매핑: R←H(0~360°→0~255), G←S, B←B(명도) 또는 L(밝기). 역변환은 같은 매핑을 거꾸로 해석한다.

// RGB → HSB(HSV): 결과를 R=H, G=S, B=B 채널에 기록. 알파 보존.
export function rgbToHsb(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
    d[i] = _hue(r, g, b, max, c) / 360 * 255;
    d[i + 1] = max === 0 ? 0 : (c / max) * 255;
    d[i + 2] = max * 255;
  }
  return img;
}

// RGB → HSL: 결과를 R=H, G=S, B=L 채널에 기록. 알파 보존.
export function rgbToHsl(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
    const l = (max + min) / 2;
    const s = c === 0 ? 0 : c / (1 - Math.abs(2 * l - 1));
    d[i] = _hue(r, g, b, max, c) / 360 * 255;
    d[i + 1] = s * 255;
    d[i + 2] = l * 255;
  }
  return img;
}

// HSB(R=H,G=S,B=B) → RGB. 알파 보존.
export function hsbToRgb(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const hh = (d[i] / 255) * 360, s = d[i + 1] / 255, v = d[i + 2] / 255;
    const c = v * s;
    _fromHcm(d, i, hh, c, v - c);
  }
  return img;
}

// HSL(R=H,G=S,B=L) → RGB. 알파 보존.
export function hslToRgb(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const hh = (d[i] / 255) * 360, s = d[i + 1] / 255, l = d[i + 2] / 255;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    _fromHcm(d, i, hh, c, l - c / 2);
  }
  return img;
}

// 색상각(0~360) 계산 공통부
function _hue(r, g, b, max, c) {
  if (c === 0) return 0;
  let hh;
  if (max === r) hh = ((g - b) / c) % 6;
  else if (max === g) hh = (b - r) / c + 2;
  else hh = (r - g) / c + 4;
  hh *= 60;
  return hh < 0 ? hh + 360 : hh;
}

// (색상각, 채도폭 c, 최소값 m) → RGB 기록
function _fromHcm(d, i, hh, c, m) {
  const hp = (hh % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  d[i] = (r + m) * 255; d[i + 1] = (g + m) * 255; d[i + 2] = (b + m) * 255;
}
