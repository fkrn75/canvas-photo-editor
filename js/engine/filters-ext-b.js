// filters-ext-b.js — 확장 필터 B: 왜곡 · 픽셀화 · 렌더 · 스타일화.
// 모두 ImageData(호환 객체 {width,height,data}) 를 제자리 수정하고 같은 객체를 돌려주는 순수 함수다.
// DOM·app 상태에 의존하지 않는다. 색은 {r,g,b}(0~255) 인자로, 랜덤은 시드 고정 PRNG로 받는다
// (미리보기와 확정 결과가 같아야 하므로 Math.random 금지).
//
// 왜곡 계열은 "역매핑 + 쌍선형 샘플링" 방식이다: 출력 픽셀마다 원본에서 읽을 좌표를 계산해 보간한다.
// region({x,y,w,h}) 은 효과의 기준 영역(선택 경계 또는 문서 전체)이며 중심·반경을 정한다.
// 영역 밖 처리(선택 클립)는 호출부(app.runAdjustment/_startPreview)가 담당한다.

import { stackBlur } from "./blur.js";

// ── 공통 유틸 ──

// 시드 PRNG(mulberry32). 0~1 반환. brush-dynamics.js 와 동일 구현(엔진 모듈 간 의존 분리 목적).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lum = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;

// region 정규화: 없으면 이미지 전체. 중심(cx,cy)과 반축(rx,ry)을 함께 계산한다.
function normRegion(img, region) {
  const r = region && region.w > 0 && region.h > 0 ? region : { x: 0, y: 0, w: img.width, h: img.height };
  return {
    x: r.x, y: r.y, w: r.w, h: r.h,
    cx: r.x + r.w / 2, cy: r.y + r.h / 2,
    rx: Math.max(1, r.w / 2), ry: Math.max(1, r.h / 2),
  };
}

// 쌍선형 샘플링(가장자리 반복). (sx,sy)는 픽셀 인덱스 좌표(정수 = 그 픽셀 그대로).
// 반투명 경계에서 색이 번지지 않도록 프리멀티플라이드 알파로 보간한다.
function sampleBilinear(src, w, h, sx, sy, dst, di) {
  if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
  if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
  const x0 = sx | 0, y0 = sy | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = sx - x0, fy = sy - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const a00 = src[i00 + 3] * w00, a10 = src[i10 + 3] * w10, a01 = src[i01 + 3] * w01, a11 = src[i11 + 3] * w11;
  const a = a00 + a10 + a01 + a11;
  if (a > 0) {
    for (let c = 0; c < 3; c++) {
      dst[di + c] = (src[i00 + c] * a00 + src[i10 + c] * a10 + src[i01 + c] * a01 + src[i11 + c] * a11) / a;
    }
  } else {
    for (let c = 0; c < 3; c++) {
      dst[di + c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    }
  }
  dst[di + 3] = a;
}

// 역매핑 공통 루프. fn(x, y, p) 는 출력 픽셀 중심 좌표(x+0.5, y+0.5)를 받아
// p.x/p.y 에 원본 좌표(픽셀 중심 좌표계)를 넣고 true 를 반환한다. false 면 그 픽셀은 그대로 둔다.
function remap(img, fn) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const p = { x: 0, y: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!fn(x + 0.5, y + 0.5, p)) continue;
      sampleBilinear(src, w, h, p.x - 0.5, p.y - 0.5, data, (y * w + x) * 4);
    }
  }
  return img;
}

// ════════════════════════════════════════════════════════════
// 왜곡
// ════════════════════════════════════════════════════════════

// 핀치. amount -100~100 (양수 = 중심으로 오므림, 음수 = 바깥으로 부풀림). 영역 내접 타원 안에만 적용.
// GIMP whirl-pinch 공식: 원본 거리 = 거리 × sin(π/2·d)^(-k).
export function pinch(img, amount = 50, region) {
  const R = normRegion(img, region);
  const k = clamp(amount, -100, 100) / 100;
  return remap(img, (x, y, p) => {
    const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) return false;
    const d = Math.sqrt(d2);
    const f = d > 0 ? Math.pow(Math.sin((Math.PI / 2) * d), -k) : 1;
    p.x = R.cx + dx * f * R.rx;
    p.y = R.cy + dy * f * R.ry;
    return true;
  });
}

// 구형화. amount -100~100 (양수 = 볼록, 음수 = 오목). 영역 내접 타원 안에만 적용.
// 양수: 원본 거리 = mix(d, asin(d)·2/π) (중심 확대), 음수: mix(d, sin(d·π/2)) (중심 축소).
export function spherize(img, amount = 100, region) {
  const R = normRegion(img, region);
  const t = clamp(amount, -100, 100) / 100;
  const at = Math.abs(t);
  return remap(img, (x, y, p) => {
    const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) return false;
    const d = Math.sqrt(d2);
    if (d === 0) { p.x = x; p.y = y; return true; }
    const m = t >= 0 ? Math.asin(d) * 2 / Math.PI : Math.sin(d * Math.PI / 2);
    const ds = d * (1 - at) + m * at;
    const f = ds / d;
    p.x = R.cx + dx * f * R.rx;
    p.y = R.cy + dy * f * R.ry;
    return true;
  });
}

// 돌리기(Twirl). angle: 도(-999~999). 중심일수록 많이 돌고 경계에서 0 이 된다.
export function twirl(img, angle = 50, region) {
  const R = normRegion(img, region);
  const a = (angle * Math.PI) / 180;
  return remap(img, (x, y, p) => {
    const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) return false;
    const th = -a * (1 - Math.sqrt(d2));
    const c = Math.cos(th), s = Math.sin(th);
    p.x = R.cx + (dx * c - dy * s) * R.rx;
    p.y = R.cy + (dx * s + dy * c) * R.ry;
    return true;
  });
}

// 극좌표. mode 0 = 직교→극(윗변이 중심으로 말려 들어감), 1 = 극→직교(역변환).
export function polarCoordinates(img, mode = 0, region) {
  const R = normRegion(img, region);
  const TAU = Math.PI * 2;
  if (mode === 0) {
    return remap(img, (x, y, p) => {
      const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = Math.atan2(dx, -dy); // 12시 방향 0, 시계 방향 증가
      if (a < 0) a += TAU;
      p.x = R.x + (a / TAU) * R.w;
      p.y = R.y + r * R.h;
      return true;
    });
  }
  return remap(img, (x, y, p) => {
    const a = ((x - R.x) / R.w) * TAU;
    const r = (y - R.y) / R.h;
    p.x = R.cx + r * R.rx * Math.sin(a);
    p.y = R.cy - r * R.ry * Math.cos(a);
    return true;
  });
}

// 잔물결. amount -999~999, size 0 작게 / 1 중간 / 2 크게(파장).
export function ripple(img, amount = 100, size = 1) {
  const lambda = [10, 20, 40][clamp(size | 0, 0, 2)];
  const amp = (amount / 100) * (lambda / 5);
  const k = (Math.PI * 2) / lambda;
  return remap(img, (x, y, p) => {
    p.x = x + amp * Math.sin(y * k);
    p.y = y + amp * Math.sin(x * k);
    return true;
  });
}

// 기울임(Shear). amount -100~100 (영역 폭 1/4 기준 최대 가로 이동), mode 0 = 직선, 1 = 사인 곡선.
// 세로 위치에 따라 가로로 밀어낸다.
export function shear(img, amount = 50, mode = 0, region) {
  const R = normRegion(img, region);
  const maxShift = (amount / 100) * (R.w / 4);
  return remap(img, (x, y, p) => {
    const t = clamp((y - R.y) / R.h, 0, 1);
    const f = mode === 1 ? Math.sin(Math.PI * t) : (0.5 - t) * 2;
    p.x = x - maxShift * f;
    p.y = y;
    return true;
  });
}

// 파형(Wave). wavelength 기준 파장(px), amplitude 진폭(px), count 생성기 수, seed.
// 생성기마다 파장·진폭·위상을 시드로 흩뜨려 가로/세로 변위를 합산한다.
export function wave(img, wavelength = 120, amplitude = 20, count = 5, seed = 1) {
  const n = clamp(count | 0, 1, 20);
  const rnd = mulberry32(seed);
  const gens = [];
  for (let i = 0; i < n; i++) {
    gens.push({
      kx: (Math.PI * 2) / (wavelength * (0.5 + rnd())),
      ky: (Math.PI * 2) / (wavelength * (0.5 + rnd())),
      ax: (amplitude / n) * (0.5 + rnd()),
      ay: (amplitude / n) * (0.5 + rnd()),
      px: rnd() * Math.PI * 2,
      py: rnd() * Math.PI * 2,
    });
  }
  return remap(img, (x, y, p) => {
    let ox = 0, oy = 0;
    for (let i = 0; i < n; i++) {
      const g = gens[i];
      ox += g.ax * Math.sin(y * g.ky + g.px);
      oy += g.ay * Math.sin(x * g.kx + g.py);
    }
    p.x = x + ox;
    p.y = y + oy;
    return true;
  });
}

// 지그재그(연못 물결). amount -100~100, ridges 마루 수(1~20). 중심에서 바깥으로 동심 물결 변위.
export function zigzag(img, amount = 50, ridges = 5, region) {
  const R = normRegion(img, region);
  const k = clamp(amount, -100, 100) / 100;
  const n = clamp(ridges, 1, 50);
  const ampl = 0.5 / n; // 정규화 거리 기준 변위 진폭(마루 간격의 절반)
  return remap(img, (x, y, p) => {
    const dx = (x - R.cx) / R.rx, dy = (y - R.cy) / R.ry;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1 || d2 === 0) return false;
    const d = Math.sqrt(d2);
    const ds = d + k * ampl * Math.sin(Math.PI * 2 * n * d) * (1 - d);
    const f = ds / d;
    p.x = R.cx + dx * f * R.rx;
    p.y = R.cy + dy * f * R.ry;
    return true;
  });
}

// ════════════════════════════════════════════════════════════
// 픽셀화
// ════════════════════════════════════════════════════════════

// 색상 하프톤. maxRadius 망점 최대 반경(px), angles 채널(R,G,B)별 망각(도). 기본값은 Photoshop RGB 기본(108/162/90).
// 각 채널을 회전 격자의 원형 망점으로 바꾼다(밝을수록 큰 점). 알파 보존.
export function colorHalftone(img, maxRadius = 8, angles = [108, 162, 90]) {
  const { width: w, height: h, data } = img;
  const cell = Math.max(2, maxRadius * 2);
  // 셀 평균 근사용 블러 사본(망점 크기 결정)
  const blurred = { width: w, height: h, data: new Uint8ClampedArray(data) };
  stackBlur(blurred, Math.max(1, Math.round(maxRadius / 2)));
  const bd = blurred.data;
  // 최대값에서 셀 모서리(중심에서 0.707셀)까지 완전히 덮도록(+0.5px 은 안티앨리어싱 여유)
  const Rmax = cell * Math.SQRT1_2 + 0.5;
  for (let c = 0; c < 3; c++) {
    const th = ((angles[c] ?? 0) * Math.PI) / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    // 회전 좌표(u,v) 범위 → 셀 격자 크기 산정
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const u = px * cs + py * sn, v = -px * sn + py * cs;
      umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    }
    const i0 = Math.floor(umin / cell) - 2, j0 = Math.floor(vmin / cell) - 2;
    const gw = Math.ceil(umax / cell) - i0 + 3, gh = Math.ceil(vmax / cell) - j0 + 3;
    // 셀 중심의 망점 반경을 미리 계산
    const rad = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const cu = (i + i0 + 0.5) * cell, cv = (j + j0 + 0.5) * cell;
        const X = clamp(Math.floor(cu * cs - cv * sn), 0, w - 1);
        const Y = clamp(Math.floor(cu * sn + cv * cs), 0, h - 1);
        rad[j * gw + i] = Rmax * Math.sqrt(bd[(Y * w + X) * 4 + c] / 255);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = px * cs + py * sn, v = -px * sn + py * cs;
        const ci = Math.floor(u / cell) - i0, cj = Math.floor(v / cell) - j0;
        let cov = 0;
        for (let jj = cj - 1; jj <= cj + 1 && cov < 1; jj++) {
          const cv = (jj + j0 + 0.5) * cell;
          for (let ii = ci - 1; ii <= ci + 1; ii++) {
            const r = rad[jj * gw + ii];
            if (r <= 0) continue;
            const cu = (ii + i0 + 0.5) * cell;
            const du = u - cu, dv = v - cv;
            const e = r - Math.sqrt(du * du + dv * dv) + 0.5;
            if (e > cov) { cov = e >= 1 ? 1 : e; if (cov >= 1) break; }
          }
        }
        data[(y * w + x) * 4 + c] = 255 * cov;
      }
    }
  }
  return img;
}

// 셀 크기 격자에 셀마다 시드 점 하나를 흩뿌린다(보로노이 사이트). 반환: Float64Array [x0,y0,x1,y1,...], 격자 폭/높이.
function jitterSites(w, h, cell, seed) {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const rnd = mulberry32(seed);
  const sites = new Float64Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = (j * gw + i) * 2;
      sites[k] = (i + rnd()) * cell;
      sites[k + 1] = (j + rnd()) * cell;
    }
  }
  return { sites, gw, gh };
}

// 수정화(Crystallize). cell 셀 크기(px). 보로노이 영역별 평균색으로 채운다.
export function crystallize(img, cell = 10, seed = 1) {
  const { width: w, height: h, data } = img;
  cell = Math.max(2, cell);
  const { sites, gw, gh } = jitterSites(w, h, cell, seed);
  const label = new Int32Array(w * h);
  const sums = new Float64Array(gw * gh * 5); // r,g,b,a,count
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const gx = Math.floor(x / cell);
      let best = -1, bd = Infinity;
      for (let j = gy - 1; j <= gy + 1; j++) {
        if (j < 0 || j >= gh) continue;
        for (let i = gx - 1; i <= gx + 1; i++) {
          if (i < 0 || i >= gw) continue;
          const k = j * gw + i;
          const dx = sites[k * 2] - (x + 0.5), dy = sites[k * 2 + 1] - (y + 0.5);
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
      }
      const p = y * w + x;
      label[p] = best;
      const s = best * 5, o = p * 4;
      sums[s] += data[o]; sums[s + 1] += data[o + 1]; sums[s + 2] += data[o + 2]; sums[s + 3] += data[o + 3]; sums[s + 4]++;
    }
  }
  for (let p = 0; p < w * h; p++) {
    const s = label[p] * 5, o = p * 4, n = sums[s + 4];
    data[o] = sums[s] / n; data[o + 1] = sums[s + 1] / n; data[o + 2] = sums[s + 2] / n; data[o + 3] = sums[s + 3] / n;
  }
  return img;
}

// 단면화(Facet). 대칭 최근접 이웃(SNN) 평활을 반복해 비슷한 색을 면(블록)으로 뭉친다. 경계는 보존.
export function facet(img, passes = 3) {
  const { width: w, height: h, data } = img;
  // 마주보는 이웃 쌍 4개(↖↘, ↑↓, ↗↙, ←→): [ax, ay, bx, by] 를 평탄 배열로(핫루프 구조분해 회피)
  const P = [-1, -1, 1, 1, 0, -1, 0, 1, 1, -1, -1, 1, -1, 0, 1, 0];
  for (let it = 0; it < passes; it++) {
    const src = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const r0 = src[o], g0 = src[o + 1], b0 = src[o + 2];
        let sr = r0, sg = g0, sb = b0, n = 1;
        for (let q = 0; q < 16; q += 4) {
          let xa = x + P[q], ya = y + P[q + 1], xb = x + P[q + 2], yb = y + P[q + 3];
          if (xa < 0) xa = 0; else if (xa >= w) xa = w - 1;
          if (ya < 0) ya = 0; else if (ya >= h) ya = h - 1;
          if (xb < 0) xb = 0; else if (xb >= w) xb = w - 1;
          if (yb < 0) yb = 0; else if (yb >= h) yb = h - 1;
          const ia = (ya * w + xa) * 4, ib = (yb * w + xb) * 4;
          const da = Math.abs(src[ia] - r0) + Math.abs(src[ia + 1] - g0) + Math.abs(src[ia + 2] - b0);
          const db = Math.abs(src[ib] - r0) + Math.abs(src[ib + 1] - g0) + Math.abs(src[ib + 2] - b0);
          const i = da <= db ? ia : ib;
          sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; n++;
        }
        data[o] = sr / n; data[o + 1] = sg / n; data[o + 2] = sb / n;
      }
    }
  }
  return img;
}

// 분열(Fragment). 상하좌우로 offset(px)만큼 어긋난 사본 4개를 평균한다.
export function fragment(img, offset = 4) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const offs = [[offset, 0], [-offset, 0], [0, offset], [0, -offset]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of offs) {
        const i = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      data[o] = r / 4; data[o + 1] = g / 4; data[o + 2] = b / 4; data[o + 3] = a / 4;
    }
  }
  return img;
}

// 메조틴트. type 0 = 점(픽셀별 무작위 임계), 1 = 짧은 선, 2 = 긴 선(가로 런 단위로 임계 유지).
// 채널별로 0/255 로 이진화한다. 알파 보존.
export function mezzotint(img, type = 0, seed = 1) {
  const { width: w, height: h, data } = img;
  const rnd = mulberry32(seed);
  const [minL, maxL] = type === 2 ? [8, 24] : type === 1 ? [2, 6] : [1, 1];
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      let left = 0, thr = 0;
      for (let x = 0; x < w; x++) {
        if (left <= 0) { thr = rnd() * 255; left = minL + Math.floor(rnd() * (maxL - minL + 1)); }
        left--;
        const o = (y * w + x) * 4 + c;
        data[o] = data[o] > thr ? 255 : 0;
      }
    }
  }
  return img;
}

// 점묘화(Pointillize). cell 셀 크기(px), bg 배경색 {r,g,b}. 셀마다 원본색(약간 흔듦)의 점을 찍는다.
export function pointillize(img, cell = 8, bg = { r: 255, g: 255, b: 255 }, seed = 1) {
  const { width: w, height: h, data } = img;
  cell = Math.max(3, cell);
  const src = new Uint8ClampedArray(data);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    data[o] = bg.r; data[o + 1] = bg.g; data[o + 2] = bg.b;
  }
  const { sites, gw, gh } = jitterSites(w, h, cell, seed);
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let k = 0; k < gw * gh; k++) {
    const sx = sites[k * 2], sy = sites[k * 2 + 1];
    const r = cell * (0.45 + rnd() * 0.2);
    const si = (clamp(Math.floor(sy), 0, h - 1) * w + clamp(Math.floor(sx), 0, w - 1)) * 4;
    const jit = (rnd() - 0.5) * 30;
    const cr = clamp(src[si] + jit, 0, 255), cg = clamp(src[si + 1] + jit, 0, 255), cb = clamp(src[si + 2] + jit, 0, 255);
    const x0 = Math.max(0, Math.floor(sx - r - 1)), x1 = Math.min(w - 1, Math.ceil(sx + r + 1));
    const y0 = Math.max(0, Math.floor(sy - r - 1)), y1 = Math.min(h - 1, Math.ceil(sy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - sx, dy = y + 0.5 - sy;
        const cov = clamp(r - Math.sqrt(dx * dx + dy * dy) + 0.5, 0, 1);
        if (cov <= 0) continue;
        const o = (y * w + x) * 4;
        data[o] += (cr - data[o]) * cov;
        data[o + 1] += (cg - data[o + 1]) * cov;
        data[o + 2] += (cb - data[o + 2]) * cov;
      }
    }
  }
  return img;
}

// ════════════════════════════════════════════════════════════
// 렌더
// ════════════════════════════════════════════════════════════

// 시드 고정 2D 펄린(그라디언트) 노이즈. 반환 함수 값 범위 대략 -1~1.
function makePerlin(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const h00 = perm[perm[X] + Y], h10 = perm[perm[X + 1] + Y], h01 = perm[perm[X] + Y + 1], h11 = perm[perm[X + 1] + Y + 1];
    const n00 = gx[h00] * xf + gy[h00] * yf;
    const n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  };
}

// fBm 노이즈 필드를 계산해 0~1 로 정규화(최소·최대 스트레치)한 Float32Array 를 돌려준다.
// sx/sy: 가로/세로 기본 주기(px). 옥타브는 가장 작은 주기가 2px 이상이 되도록 자동 결정(최대 8).
function noiseField(w, h, seed, sx, sy) {
  const noise = makePerlin(seed);
  const octaves = clamp(Math.floor(Math.log2(Math.max(2, Math.min(sx, sy)))), 1, 8);
  const out = new Float32Array(w * h);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let fx = x / sx, fy = y / sy, amp = 1, s = 0;
      for (let o = 0; o < octaves; o++) {
        s += amp * noise(fx + o * 17.3, fy + o * 9.1);
        fx *= 2; fy *= 2; amp *= 0.5;
      }
      out[y * w + x] = s;
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
  }
  const range = mx - mn || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / range;
  return out;
}

// 구름. fg/bg {r,g,b}, seed, scale 기본 주기(px). 전경~배경색 사이 fBm 값으로 채운다(불투명).
export function clouds(img, fg, bg, seed = 1, scale = 128) {
  const { width: w, height: h, data } = img;
  const n = noiseField(w, h, seed, scale, scale);
  for (let i = 0; i < n.length; i++) {
    const t = n[i], o = i * 4;
    data[o] = bg.r + (fg.r - bg.r) * t;
    data[o + 1] = bg.g + (fg.g - bg.g) * t;
    data[o + 2] = bg.b + (fg.b - bg.b) * t;
    data[o + 3] = 255;
  }
  return img;
}

// 차이 구름. 구름 색과 현재 픽셀의 차이(|원본 - 구름|) 블렌드. 알파 보존.
export function differenceClouds(img, fg, bg, seed = 1, scale = 128) {
  const { width: w, height: h, data } = img;
  const n = noiseField(w, h, seed, scale, scale);
  for (let i = 0; i < n.length; i++) {
    const t = n[i], o = i * 4;
    data[o] = Math.abs(data[o] - (bg.r + (fg.r - bg.r) * t));
    data[o + 1] = Math.abs(data[o + 1] - (bg.g + (fg.g - bg.g) * t));
    data[o + 2] = Math.abs(data[o + 2] - (bg.b + (fg.b - bg.b) * t));
  }
  return img;
}

// 섬유. variance 분산(1~64, 클수록 가로 방향 색 변화가 잦음), strength 강도(1~64, 클수록 세로 섬유가 김).
// 가로로 촘촘하고 세로로 길게 늘인 이방성 노이즈로 전경~배경색 섬유 결을 만든다(불투명).
export function fibers(img, fg, bg, variance = 16, strength = 4, seed = 1) {
  const { width: w, height: h, data } = img;
  const sx = 1 + (64 - clamp(variance, 1, 64)) / 8;
  const sy = 4 + clamp(strength, 1, 64) * 6;
  const noise = makePerlin(seed);
  const rnd = mulberry32((seed * 7919) >>> 0);
  const colJit = new Float32Array(w);
  for (let x = 0; x < w; x++) colJit[x] = (rnd() - 0.5) * 0.5;
  const field = new Float32Array(w * h);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let fx = x / sx, fy = y / sy, amp = 1, s = colJit[x];
      for (let o = 0; o < 3; o++) {
        s += amp * noise(fx + o * 31.7, fy + o * 13.3);
        fx *= 2; fy *= 2; amp *= 0.5;
      }
      field[y * w + x] = s;
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
  }
  const range = mx - mn || 1;
  for (let i = 0; i < field.length; i++) {
    const t = (field[i] - mn) / range, o = i * 4;
    data[o] = bg.r + (fg.r - bg.r) * t;
    data[o + 1] = bg.g + (fg.g - bg.g) * t;
    data[o + 2] = bg.b + (fg.b - bg.b) * t;
    data[o + 3] = 255;
  }
  return img;
}

// 렌즈 플레어. brightness 10~300(%), (px,py) 광원 위치(이미지 대비 %), type 0 = 50-300mm 줌,
// 1 = 35mm 프라임, 2 = 105mm 프라임. 광원 → 이미지 중심 → 반대편 직선 위에 고스트(잔상)를 배치하고
// 스크린 합성한다. 알파 보존.
export function lensFlare(img, brightness = 100, px = 30, py = 30, type = 0) {
  const { width: w, height: h, data } = img;
  const fx = (px / 100) * w, fy = (py / 100) * h;
  const cx = w / 2, cy = h / 2;
  const diag = Math.hypot(w, h);
  const k = brightness / 100;
  const preset = [
    { core: 0.02, halo: 0.12, rays: 6, rayI: 0.25, ring: 0.10,
      ghosts: [[0.45, 0.025, 0.35, 0.6, 0.3], [0.7, 0.012, 0.6, 0.4, 0.8], [1.15, 0.04, 0.3, 0.7, 0.4],
               [1.4, 0.018, 0.8, 0.5, 0.2], [1.75, 0.06, 0.25, 0.4, 0.9], [2.1, 0.03, 0.5, 0.8, 0.5]] },
    { core: 0.03, halo: 0.10, rays: 12, rayI: 0.5, ring: 0,
      ghosts: [[0.6, 0.02, 0.5, 0.5, 0.9], [1.3, 0.035, 0.7, 0.6, 0.3], [1.9, 0.015, 0.4, 0.8, 0.6]] },
    { core: 0.05, halo: 0.2, rays: 0, rayI: 0, ring: 0.16,
      ghosts: [[0.8, 0.05, 0.3, 0.4, 0.6], [1.6, 0.03, 0.6, 0.3, 0.3]] },
  ][clamp(type | 0, 0, 2)];
  // 고스트: [직선상 위치 t, 반경(대각 비), r, g, b]
  const ghosts = preset.ghosts.map(([t, r, gr, gg, gb]) => ({
    x: fx + (cx - fx) * t, y: fy + (cy - fy) * t, r: r * diag, cr: gr, cg: gg, cb: gb,
  }));
  const coreR = preset.core * diag, haloR = preset.halo * diag, ringR = preset.ring * diag, ringW = diag * 0.006;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
      const d = Math.sqrt(dx * dx + dy * dy);
      // 중심 광원(흰색) + 넓은 후광(따뜻한 색)
      const core = Math.exp(-d / coreR);
      const halo = Math.exp(-(d * d) / (haloR * haloR)) * 0.35;
      let ar = core + halo, ag = core + halo * 0.85, ab = core * 0.95 + halo * 0.6;
      // 광선(별 모양)
      if (preset.rays > 0) {
        const ang = Math.atan2(dy, dx);
        const ray = Math.pow(Math.abs(Math.cos(ang * preset.rays / 2)), 80) * preset.rayI * Math.exp(-d / (diag * 0.18));
        ar += ray; ag += ray; ab += ray;
      }
      // 무지개 링
      if (ringR > 0) {
        const e = (d - ringR) / ringW;
        if (e > -4 && e < 4) {
          const ring = Math.exp(-e * e) * 0.12;
          ar += ring * (e > 0 ? 1 : 0.4); ag += ring * 0.7; ab += ring * (e < 0 ? 1 : 0.4);
        }
      }
      // 고스트(부드러운 원반)
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        const gx = x + 0.5 - g.x, gy = y + 0.5 - g.y;
        const gd2 = gx * gx + gy * gy;
        if (gd2 >= g.r * g.r) continue;
        const q = 1 - Math.sqrt(gd2) / g.r;
        const v = Math.min(1, q * 3) * 0.18;
        ar += g.cr * v; ag += g.cg * v; ab += g.cb * v;
      }
      const o = (y * w + x) * 4;
      // 스크린 합성: 1 - (1-a)(1-b)
      ar = Math.min(1, ar * k); ag = Math.min(1, ag * k); ab = Math.min(1, ab * k);
      data[o] = 255 - (255 - data[o]) * (1 - ar);
      data[o + 1] = 255 - (255 - data[o + 1]) * (1 - ag);
      data[o + 2] = 255 - (255 - data[o + 2]) * (1 - ab);
    }
  }
  return img;
}

// 조명 효과(단순화: 조명 1개). opts:
//   type 0 = 전방향(부드러운 원형 감쇠), 1 = 스포트(가장자리가 또렷한 원뿔)
//   x, y: 위치(이미지 대비 %), intensity: 강도(%, 0~200), range: 범위(대각선 대비 %), bump: 질감 높이(0~50)
// 높이맵 = 휘도. 법선 · 광원 방향(램버트) × 감쇠 + 주변광 으로 원본을 밝히거나 어둡게 한다. 알파 보존.
export function lightingEffects(img, opts = {}) {
  const { type = 0, x: lxp = 50, y: lyp = 50, intensity = 100, range = 50, bump = 10 } = opts;
  const { width: w, height: h, data } = img;
  const lx = (lxp / 100) * w, ly = (lyp / 100) * h;
  const R = Math.max(1, (range / 100) * Math.hypot(w, h));
  const lz = R * (type === 1 ? 0.6 : 0.35);
  const ambient = 0.15;
  const k = intensity / 100;
  const hm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hm[i] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255;
  const bs = bump; // 높이 기울기 배율(px 단위 법선)
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      const gx = (hm[y * w + xr] - hm[y * w + xl]) * 0.5 * bs;
      const gy = (hm[yd * w + x] - hm[yu * w + x]) * 0.5 * bs;
      let nx = -gx, ny = -gy, nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + 1);
      nx /= nl; ny /= nl; nz /= nl;
      const vx = lx - (x + 0.5), vy = ly - (y + 0.5);
      const dist = Math.sqrt(vx * vx + vy * vy);
      const vl = Math.sqrt(vx * vx + vy * vy + lz * lz);
      const diff = Math.max(0, (nx * vx + ny * vy + nz * lz) / vl);
      let att;
      if (type === 1) {
        // 스포트: 범위의 75% 까지 거의 일정, 그 밖에서 빠르게 떨어짐(smoothstep)
        const t = clamp((R - dist) / (R * 0.25), 0, 1);
        att = t * t * (3 - 2 * t);
      } else {
        const q = dist / R;
        att = Math.max(0, 1 - q * q);
      }
      const L = ambient + k * diff * att * 1.3;
      const o = (y * w + x) * 4;
      data[o] *= L; data[o + 1] *= L; data[o + 2] *= L;
    }
  }
  return img;
}

// ════════════════════════════════════════════════════════════
// 스타일화
// ════════════════════════════════════════════════════════════

// 확산(Diffuse). mode 0 = 표준, 1 = 어두운 것만, 2 = 밝은 것만. radius 이웃 범위(px).
// 각 픽셀을 반경 안의 무작위 이웃 픽셀로 바꾼다.
export function diffuse(img, mode = 0, radius = 2, seed = 1) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const rnd = mulberry32(seed);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = clamp(x + Math.floor(rnd() * span) - radius, 0, w - 1);
      const ny = clamp(y + Math.floor(rnd() * span) - radius, 0, h - 1);
      const o = (y * w + x) * 4, i = (ny * w + nx) * 4;
      if (mode !== 0) {
        const ln = lum(src[i], src[i + 1], src[i + 2]), lc = lum(src[o], src[o + 1], src[o + 2]);
        if (mode === 1 ? ln >= lc : ln <= lc) continue;
      }
      data[o] = src[i]; data[o + 1] = src[i + 1]; data[o + 2] = src[i + 2]; data[o + 3] = src[i + 3];
    }
  }
  return img;
}

// 솔라리즈. 채널값이 128 이상이면 반전(255-v), 미만이면 유지. 알파 보존.
export function solarize(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c];
  }
  return img;
}

// 바람. method 0 = 바람, 1 = 강풍(긴 줄기), 2 = 엇갈림(끊긴 줄기). direction 0 = 왼쪽에서(줄기가 오른쪽으로),
// 1 = 오른쪽에서(줄기가 왼쪽으로). 밝은 가장자리에서 바람 방향으로 색이 흐려지며 번진다.
export function wind(img, method = 0, direction = 0, seed = 1) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const rnd = mulberry32(seed);
  const step = direction === 1 ? -1 : 1;
  const [minL, maxL] = method === 1 ? [20, 80] : [4, 24];
  const thr = 12;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let s = 0; s < w; s++) {
      const x = step === 1 ? s : w - 1 - s;
      const nx = x + step;
      if (nx < 0 || nx >= w) continue;
      const i = (row + x) * 4, j = (row + nx) * 4;
      if (lum(src[i], src[i + 1], src[i + 2]) - lum(src[j], src[j + 1], src[j + 2]) <= thr) continue;
      const L = minL + Math.floor(rnd() * (maxL - minL));
      for (let q = 1; q <= L; q++) {
        const tx = x + q * step;
        if (tx < 0 || tx >= w) break;
        if (method === 2 && ((q >> 1) & 1)) continue; // 엇갈림: 2px 간격으로 끊음
        const t = 1 - q / (L + 1);
        const o = (row + tx) * 4;
        data[o] += (src[i] - data[o]) * t;
        data[o + 1] += (src[i + 1] - data[o + 1]) * t;
        data[o + 2] += (src[i + 2] - data[o + 2]) * t;
      }
    }
  }
  return img;
}

// 타일. count 짧은 변 기준 타일 수, maxOffset 최대 오프셋(타일 크기 대비 %), bg 빈 곳 색 {r,g,b}.
export function tiles(img, count = 10, maxOffset = 10, bg = { r: 255, g: 255, b: 255 }, seed = 1) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const s = Math.max(1, Math.floor(Math.min(w, h) / Math.max(1, count)));
  const rnd = mulberry32(seed);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    data[o] = bg.r; data[o + 1] = bg.g; data[o + 2] = bg.b; data[o + 3] = 255;
  }
  const mo = (maxOffset / 100) * s;
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const dx = Math.round((rnd() * 2 - 1) * mo), dy = Math.round((rnd() * 2 - 1) * mo);
      const bw = Math.min(s, w - bx), bh = Math.min(s, h - by);
      for (let y = 0; y < bh; y++) {
        const ty = by + y + dy;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < bw; x++) {
          const tx = bx + x + dx;
          if (tx < 0 || tx >= w) continue;
          const i = ((by + y) * w + bx + x) * 4, o = (ty * w + tx) * 4;
          data[o] = src[i]; data[o + 1] = src[i + 1]; data[o + 2] = src[i + 2]; data[o + 3] = src[i + 3];
        }
      }
    }
  }
  return img;
}

// 윤곽선 추적. level 0~255, edge 0 = 아래(값이 level 미만인 쪽 경계), 1 = 위(level 이상인 쪽 경계).
// 채널별로 경계 픽셀을 0, 나머지를 255(흰 바탕)로 만든다. 알파 보존.
export function traceContour(img, level = 128, edge = 0) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const above = src[o + c] >= level;
        let on = false;
        if (above === (edge === 1)) {
          // 4-이웃 중 반대편(level 기준) 값이 있으면 경계
          if (x > 0 && (src[o - 4 + c] >= level) !== above) on = true;
          else if (x < w - 1 && (src[o + 4 + c] >= level) !== above) on = true;
          else if (y > 0 && (src[o - w * 4 + c] >= level) !== above) on = true;
          else if (y < h - 1 && (src[o + w * 4 + c] >= level) !== above) on = true;
        }
        data[o + c] = on ? 0 : 255;
      }
    }
  }
  return img;
}

// 돌출(간단 구현). type 0 = 블록(평평한 앞면 + 경사 옆면), 1 = 피라미드(4 삼각면).
// size 블록 크기(px), depth 깊이(1~100, 옆면 폭/음영 세기). 블록 밝기가 높을수록 블록 옆면이 넓다(레벨 기준).
export function extrude(img, type = 0, size = 30, depth = 30) {
  const { width: w, height: h, data } = img;
  const s = Math.max(2, size | 0);
  const dp = clamp(depth, 1, 100) / 100;
  // 옆면 음영 계수: 위·왼쪽은 밝게, 오른쪽·아래는 어둡게
  const shadeTop = 1 + 0.35 * dp, shadeLeft = 1 + 0.15 * dp, shadeRight = 1 - 0.25 * dp, shadeBottom = 1 - 0.45 * dp;
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const bw = Math.min(s, w - bx), bh = Math.min(s, h - by);
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const o = (y * w + x) * 4;
          r += data[o]; g += data[o + 1]; b += data[o + 2]; a += data[o + 3];
        }
      }
      const n = bw * bh;
      r /= n; g /= n; b /= n; a /= n;
      const band = Math.max(1, Math.round((Math.min(bw, bh) / 2) * dp * (0.3 + 0.7 * lum(r, g, b) / 255)));
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          // 각 변까지의 정규화 거리 중 최소인 변이 그 픽셀이 속한 면
          const dl = (x + 0.5) / bw, dr = (bw - x - 0.5) / bw, dt = (y + 0.5) / bh, db = (bh - y - 0.5) / bh;
          let f = 1;
          const m = Math.min(dl, dr, dt, db);
          const minPx = Math.min(x, bw - 1 - x, y, bh - 1 - y);
          if (type === 1 || minPx < band) {
            f = m === dt ? shadeTop : m === dl ? shadeLeft : m === dr ? shadeRight : shadeBottom;
          }
          const o = ((by + y) * w + bx + x) * 4;
          data[o] = r * f; data[o + 1] = g * f; data[o + 2] = b * f; data[o + 3] = a;
        }
      }
    }
  }
  return img;
}

// 유화(Oil Paint). radius 반경(px), levels 휘도 단계 수(2~64).
// 반경 안 픽셀을 휘도 단계로 분류해 가장 많은 단계의 평균색을 쓴다(고전 oil-paint).
// 행마다 슬라이딩 히스토그램(열 추가/제거)으로 O(n·r) 에 계산한다. 알파는 그 단계의 평균.
export function oilPaint(img, radius = 4, levels = 20) {
  const { width: w, height: h, data } = img;
  const r = clamp(Math.round(radius), 1, 20);
  const L = clamp(Math.round(levels), 2, 64);
  const src = new Uint8ClampedArray(data);
  const bins = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    bins[i] = Math.min(L - 1, Math.floor((lum(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]) * L) / 256));
  }
  const cnt = new Int32Array(L);
  const sr = new Float64Array(L), sg = new Float64Array(L), sb = new Float64Array(L), sa = new Float64Array(L);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0); sa.fill(0);
    const addCol = (cx, sign) => {
      for (let yy = y0; yy <= y1; yy++) {
        const p = yy * w + cx, b = bins[p], o = p * 4;
        cnt[b] += sign; sr[b] += sign * src[o]; sg[b] += sign * src[o + 1]; sb[b] += sign * src[o + 2]; sa[b] += sign * src[o + 3];
      }
    };
    for (let cx = 0; cx <= Math.min(w - 1, r); cx++) addCol(cx, 1);
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        if (x + r < w) addCol(x + r, 1);
        if (x - r - 1 >= 0) addCol(x - r - 1, -1);
      }
      let best = 0;
      for (let b = 1; b < L; b++) if (cnt[b] > cnt[best]) best = b;
      const n = cnt[best], o = (y * w + x) * 4;
      data[o] = sr[best] / n; data[o + 1] = sg[best] / n; data[o + 2] = sb[best] / n; data[o + 3] = sa[best] / n;
    }
  }
  return img;
}

// 네온 가장자리(Glowing Edges). width 가장자리 폭(1~14), brightness 밝기(0~20), smoothness 부드럽게(1~15).
// 부드럽게 블러 → 채널별 소벨 크기 × 밝기 → 폭만큼 최대값 팽창. 검은 바탕에 빛나는 윤곽. 알파 보존.
export function glowingEdges(img, width = 2, brightness = 6, smoothness = 5) {
  const { width: w, height: h, data } = img;
  const sm = { width: w, height: h, data: new Uint8ClampedArray(data) };
  const br = Math.round(smoothness / 3);
  if (br >= 1) stackBlur(sm, br);
  const s = sm.data;
  const edge = new Uint8ClampedArray(w * h * 3);
  const gain = brightness / 4;
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      const tl = (yu * w + xl) * 4, tc = (yu * w + x) * 4, tr = (yu * w + xr) * 4;
      const ml = (y * w + xl) * 4, mr = (y * w + xr) * 4;
      const bl = (yd * w + xl) * 4, bc = (yd * w + x) * 4, bR = (yd * w + xr) * 4;
      for (let c = 0; c < 3; c++) {
        const gx = s[tr + c] + 2 * s[mr + c] + s[bR + c] - s[tl + c] - 2 * s[ml + c] - s[bl + c];
        const gy = s[bl + c] + 2 * s[bc + c] + s[bR + c] - s[tl + c] - 2 * s[tc + c] - s[tr + c];
        edge[(y * w + x) * 3 + c] = Math.sqrt(gx * gx + gy * gy) * gain;
      }
    }
  }
  // 분리형 최대값 팽창(가로 → 세로)
  const rad = Math.floor((clamp(width, 1, 14) - 1) / 2);
  let cur = edge;
  if (rad > 0) {
    const tmp = new Uint8ClampedArray(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
        for (let c = 0; c < 3; c++) {
          let m = 0;
          for (let xx = x0; xx <= x1; xx++) { const v = cur[(y * w + xx) * 3 + c]; if (v > m) m = v; }
          tmp[(y * w + x) * 3 + c] = m;
        }
      }
    }
    const out = new Uint8ClampedArray(w * h * 3);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let m = 0;
          for (let yy = y0; yy <= y1; yy++) { const v = tmp[(yy * w + x) * 3 + c]; if (v > m) m = v; }
          out[(y * w + x) * 3 + c] = m;
        }
      }
    }
    cur = out;
  }
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = cur[i * 3]; data[i * 4 + 1] = cur[i * 3 + 1]; data[i * 4 + 2] = cur[i * 3 + 2];
  }
  return img;
}
