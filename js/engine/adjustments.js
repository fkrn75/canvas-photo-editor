// adjustments.js — 색상 보정 (모두 ImageData를 제자리 수정). 가능한 곳은 256-LUT로 가속.

import { rgbToHsl, hslToRgb, luminance, hexToRgb } from "./color.js";

// 밝기(-100~100) / 대비(-100~100)
export function brightnessContrast(img, brightness = 0, contrast = 0) {
  const d = img.data;
  const bb = brightness * 2.55;
  const con = contrast * 2.55;
  const factor = (259 * (con + 255)) / (255 * (259 - con));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = factor * (i - 128) + 128 + bb;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
  }
  return img;
}

// 색조(-180~180) / 채도(-100~100) / 밝기(-100~100)
export function hueSaturation(img, hue = 0, sat = 0, light = 0) {
  const d = img.data;
  const satF = 1 + sat / 100;        // 0~2
  const lightF = light / 100;        // -1~1
  for (let i = 0; i < d.length; i += 4) {
    const hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    let h = hsl.h + hue; h %= 360; if (h < 0) h += 360;
    const s = Math.max(0, Math.min(1, hsl.s * satF));
    const l = Math.max(0, Math.min(1, hsl.l + lightF));
    const rgb = hslToRgb(h, s, l);
    d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
  }
  return img;
}

// 흑백(채도 제거, 휘도 기반)
export function grayscale(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = luminance(d[i], d[i + 1], d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return img;
}

// 색 반전(네거티브)
export function invert(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
  }
  return img;
}

// 자동 레벨: 각 채널의 최소/최대를 0~255로 스트레치
export function autoTone(img) {
  const d = img.data;
  const min = [255, 255, 255], max = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = d[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  for (let k = 0; k < 3; k++) {
    const range = max[k] - min[k] || 1;
    for (let i = 0; i < 256; i++) lut[k][i] = ((i - min[k]) / range) * 255;
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]];
  }
  return img;
}

// ── 채널 / 히스토그램 / 레벨 / 커브 ──

// 채널 히스토그램. channel: 'r'|'g'|'b'|'a'|'l'(휘도). 256 빈도(Float32) 반환.
export function histogram(img, channel = "l") {
  const d = img.data;
  const hist = new Float32Array(256);
  if (channel === "l") {
    for (let i = 0; i < d.length; i += 4) hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  } else {
    const off = { r: 0, g: 1, b: 2, a: 3 }[channel];
    for (let i = 0; i < d.length; i += 4) hist[d[i + off]]++;
  }
  return hist;
}

// 256 LUT를 지정 채널에 적용. channel: 'rgb'|'r'|'g'|'b'|'a'.
export function applyChannelLUT(img, channel, lut) {
  const d = img.data;
  if (channel === "a") {
    for (let i = 0; i < d.length; i += 4) d[i + 3] = lut[d[i + 3]];
  } else if (channel === "rgb") {
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  } else {
    const off = { r: 0, g: 1, b: 2 }[channel];
    for (let i = 0; i < d.length; i += 4) d[i + off] = lut[d[i + off]];
  }
  return img;
}

// 레벨 보정: 입력 검정/감마/흰점 + 출력 검정/흰점. channel별 적용.
export function levels(img, channel, inB, inW, gamma, outB, outW) {
  const lut = new Uint8ClampedArray(256);
  const range = Math.max(1, inW - inB);
  const ig = 1 / Math.max(0.01, gamma);
  for (let i = 0; i < 256; i++) {
    let t = (i - inB) / range;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    lut[i] = outB + Math.pow(t, ig) * (outW - outB);
  }
  return applyChannelLUT(img, channel, lut);
}

// 제어점(각 {x,y} 0~255) → 256 LUT. Catmull-Rom 스플라인으로 부드럽게.
export function buildCurveLUT(points) {
  const lut = new Uint8ClampedArray(256);
  // 방어 가드: 제어점이 없거나(0개) 1개뿐이면 스플라인 계산이 pts[0]/pts[n-1]을
  // 역참조하다 TypeError가 난다(정상흐름은 normalizeCurvesParams가 n>=2를 보장하지만
  // 임포트/마이그레이션·직접 호출 등 비정상 입력 대비).
  if (!Array.isArray(points) || points.length === 0) {
    // 제어점 없음 → 항등 LUT(입력=출력)
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (points.length === 1) {
    // 제어점 1개 → 전 구간을 그 점의 y로 채움(상수)
    const y = points[0].y;
    for (let i = 0; i < 256; i++) lut[i] = y;
    return lut;
  }
  const pts = points.slice().sort((a, b) => a.x - b.x);
  const n = pts.length;
  // 제어점이 2개면 직선 보간(불필요한 곡률 방지)
  if (n === 2) {
    const a = pts[0], b = pts[1];
    const span = Math.max(1, b.x - a.x);
    for (let i = 0; i < 256; i++) {
      if (i <= a.x) lut[i] = a.y;
      else if (i >= b.x) lut[i] = b.y;
      else lut[i] = a.y + (b.y - a.y) * (i - a.x) / span;
    }
    return lut;
  }
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    if (i <= pts[0].x) { lut[i] = pts[0].y; continue; }
    if (i >= pts[n - 1].x) { lut[i] = pts[n - 1].y; continue; }
    while (seg < n - 1 && i > pts[seg + 1].x) seg++;
    const p1 = pts[seg], p2 = pts[seg + 1];
    const p0 = pts[seg - 1] || p1, p3 = pts[seg + 2] || p2;
    const t = (i - p1.x) / Math.max(1, p2.x - p1.x);
    const t2 = t * t, t3 = t2 * t;
    lut[i] = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  }
  return lut;
}

// 채널 믹서: 각 출력 채널 = 입력 R/G/B 가중합 + 상수.
// mix = { r:[rr,rg,rb,const], g:[...], b:[...] } (가중치 -2~2, const -255~255)
export function channelMixer(img, mix) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    d[i] = mix.r[0] * R + mix.r[1] * G + mix.r[2] * B + mix.r[3];
    d[i + 1] = mix.g[0] * R + mix.g[1] * G + mix.g[2] * B + mix.g[3];
    d[i + 2] = mix.b[0] * R + mix.b[1] * G + mix.b[2] * B + mix.b[3];
  }
  return img;
}

// ── 색상 균형 / 한계값 / 포스터화 / 그라디언트 맵 / 균일화 ──

// 색상 균형(Color Balance). 그림자/중간/하이라이트 톤 영역별로 RGB를 가감한다.
// 각 영역 인자는 [CR, MG, YB] (-100~100): +면 빨강/녹색/파랑, -면 시안/마젠타/노랑 쪽.
// preserveLum=true면 보정 후 원본 휘도를 복원해 밝기 변화를 막는다(PS의 "광도 보존").
export function colorBalance(img, shadows = [0, 0, 0], midtones = [0, 0, 0], highlights = [0, 0, 0], preserveLum = true) {
  const d = img.data;
  // 톤 영역별 가중 LUT를 채널마다 미리 만든다. 입력값 0~255 → 더할 양(실수).
  // 각 톤 영역의 픽셀값(0~1)에 대한 가중치 곡선(PS 근사): 그림자=어두울수록, 하이라이트=밝을수록, 중간=가운데 봉우리.
  const addLUT = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let k = 0; k < 3; k++) {
    const sh = shadows[k] / 100, mi = midtones[k] / 100, hi = highlights[k] / 100;
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      // 톤 영역 가중치(합이 과도하지 않도록 PS 유사 곡선 사용)
      const wShadow = Math.pow(1 - x, 2);          // 0에서 1, 1에서 0
      const wHigh = Math.pow(x, 2);                // 1에서 1, 0에서 0
      const wMid = 1 - Math.abs(2 * x - 1);        // 0.5에서 1, 양끝 0 (삼각형)
      // 영역별 가감(×100 스케일로 PS 슬라이더 1당 약 1단계). 0.5 계수로 과보정 완화.
      addLUT[k][i] = (sh * wShadow + mi * wMid * 0.66 + hi * wHigh) * 100 * 0.5;
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    let r = r0 + addLUT[0][r0];
    let g = g0 + addLUT[1][g0];
    let b = b0 + addLUT[2][b0];
    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    b = b < 0 ? 0 : b > 255 ? 255 : b;
    if (preserveLum) {
      // 보정 전후 휘도 비율로 스케일해 원본 밝기를 복원
      const ly = luminance(r0, g0, b0);
      const ny = luminance(r, g, b) || 1;
      const f = ly / ny;
      r *= f; g *= f; b *= f;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return img;
}

// 한계값(Threshold). 휘도가 level 이상이면 흰색, 미만이면 검정으로 2치화. level: 1~255.
export function threshold(img, level = 128) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = luminance(d[i], d[i + 1], d[i + 2]) >= level ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

// 포스터화(Posterize). 채널별로 levels 단계(2~255)로 계조를 양자화한다.
export function posterize(img, levels = 4) {
  const n = Math.max(2, Math.min(255, Math.round(levels)));
  // 입력 0~255를 n개 구간으로 나눠 각 구간을 대표값에 매핑하는 LUT
  const lut = new Uint8ClampedArray(256);
  const step = 255 / (n - 1);   // 출력 대표값 간격
  const inStep = 256 / n;       // 입력 구간 폭
  for (let i = 0; i < 256; i++) {
    const idx = Math.min(n - 1, Math.floor(i / inStep));
    lut[i] = Math.round(idx * step);
  }
  return applyChannelLUT(img, "rgb", lut);
}

// 그라디언트 맵용 LUT 생성. stops: [{ pos:0~1, r,g,b }] (pos 오름차순). 256 길이의 {r,g,b} LUT 반환.
// 휘도(0~255)를 0~1로 보고 stops 사이를 선형 보간한다.
export function buildGradientLUT(stops) {
  const s = stops.slice().sort((a, b) => a.pos - b.pos);
  if (s.length === 0) s.push({ pos: 0, r: 0, g: 0, b: 0 }, { pos: 1, r: 255, g: 255, b: 255 });
  if (s.length === 1) s.push({ ...s[0], pos: 1 });
  const lutR = new Uint8ClampedArray(256), lutG = new Uint8ClampedArray(256), lutB = new Uint8ClampedArray(256);
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    while (seg < s.length - 2 && t > s[seg + 1].pos) seg++;
    const a = s[seg], b = s[seg + 1];
    const span = (b.pos - a.pos) || 1;
    let f = (t - a.pos) / span;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    lutR[i] = a.r + (b.r - a.r) * f;
    lutG[i] = a.g + (b.g - a.g) * f;
    lutB[i] = a.b + (b.b - a.b) * f;
  }
  return { r: lutR, g: lutG, b: lutB };
}

// 그라디언트 맵(Gradient Map). 각 픽셀의 휘도를 그라디언트 색으로 치환한다.
// gradLUT는 buildGradientLUT의 반환값({r,g,b} 각 256). 알파는 보존.
export function gradientMap(img, gradLUT) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = luminance(d[i], d[i + 1], d[i + 2]) | 0;
    d[i] = gradLUT.r[y]; d[i + 1] = gradLUT.g[y]; d[i + 2] = gradLUT.b[y];
  }
  return img;
}

// 두 hex 색("#rrggbb")으로 흑→백 위치의 2-스톱 그라디언트 LUT를 만든다(그라디언트 맵 기본용).
export function gradientLUTFromColors(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return buildGradientLUT([{ pos: 0, ...a }, { pos: 1, ...b }]);
}

// 균일화(Equalize). 휘도 히스토그램의 CDF로 톤을 펼쳐 명암 분포를 고르게 한다.
// 휘도 매핑 비율을 각 RGB 채널에 동일 적용해 색상은 최대한 보존한다.
export function equalize(img) {
  const d = img.data;
  const n = d.length / 4;
  // 휘도 히스토그램
  const hist = new Float32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[luminance(d[i], d[i + 1], d[i + 2]) | 0]++;
  // 누적분포(CDF) → 휘도 매핑 LUT
  const cdf = new Float32Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc; }
  // 0이 아닌 최소 CDF로 정규화(전형적 평활화 공식)
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) { if (cdf[i] > 0) { cdfMin = cdf[i]; break; } }
  const denom = (n - cdfMin) || 1;
  const map = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) map[i] = ((cdf[i] - cdfMin) / denom) * 255;
  // 각 픽셀: 새 휘도/옛 휘도 비율을 RGB에 곱해 색조 유지
  for (let i = 0; i < d.length; i += 4) {
    const y = luminance(d[i], d[i + 1], d[i + 2]) | 0;
    if (y === 0) { d[i] = d[i + 1] = d[i + 2] = map[0]; continue; }
    const f = map[y] / y;
    let r = d[i] * f, g = d[i + 1] * f, b = d[i + 2] * f;
    d[i] = r > 255 ? 255 : r;
    d[i + 1] = g > 255 ? 255 : g;
    d[i + 2] = b > 255 ? 255 : b;
  }
  return img;
}
