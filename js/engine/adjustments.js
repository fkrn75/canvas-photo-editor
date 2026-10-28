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
// 알파 0(완전 투명) 픽셀의 RGB 는 의미가 없으므로 최소/최대 산정에서 제외한다(투명 레이어에서 효과가 죽는 문제 방지).
// 불투명 픽셀이 하나도 없으면 변경 없음.
export function autoTone(img) {
  const d = img.data;
  const min = [255, 255, 255], max = [0, 0, 0];
  let counted = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    counted++;
    for (let k = 0; k < 3; k++) {
      const v = d[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!counted) return img;
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
    // 반올림: 회색(v,v,v)의 휘도가 부동소수 오차로 v-ε 가 되어 |0 이 v-1 로 내려가는 것을 막는다
    const y = (luminance(d[i], d[i + 1], d[i + 2]) + 0.5) | 0;
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

// ════════════════════════════════════════════════════════════════════════════
// 확장 보정(PhotoCraft 이식분): 노출·활기·포토 필터·선택 색상·흑백(혼합)·
// 어두운 영역/밝은 영역·채도 감소·색상 대체·자동 대비·자동 색상.
// 파괴적 메뉴(보정 >)와 비파괴 조정 레이어가 같은 함수를 공유한다. 모두 ImageData 제자리 수정.
// ════════════════════════════════════════════════════════════════════════════

// sRGB(0~1) ↔ 선형광(0~1). 노출은 PS처럼 선형광 공간에서 계산한다.
function srgbToLinear(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function linearToSrgb(v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

// 노출(Exposure). ev: 스톱(-20~20, 2^ev 배), offset: 선형광 가감(-0.5~0.5), gamma: 감마 보정(0.01~9.99).
// 순서(PS 근사): 선형광 × 2^ev → + offset → ^(1/gamma). 채널 독립이라 256-LUT 하나로 처리한다.
export function exposure(img, ev = 0, offset = 0, gamma = 1) {
  if (ev === 0 && offset === 0 && gamma === 1) return img; // 항등 → 무동작(왕복 오차 방지)
  const mul = Math.pow(2, ev);
  const ig = 1 / Math.max(0.01, gamma);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = srgbToLinear(i / 255) * mul + offset;
    v = v < 0 ? 0 : v;
    v = Math.pow(v, ig);
    lut[i] = linearToSrgb(v > 1 ? 1 : v) * 255;
  }
  return applyChannelLUT(img, "rgb", lut);
}

// 활기(Vibrance) / 채도(Saturation). 둘 다 -100~100.
// 채도: 휘도 기준 선형 증감(전 픽셀 균일). 활기: 현재 채도가 낮은 픽셀일수록 강하게 바꾼다.
export function vibrance(img, vib = 0, sat = 0) {
  if (vib === 0 && sat === 0) return img;
  const d = img.data;
  const v = vib / 100, s = 1 + sat / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const curSat = (mx - mn) / 255;            // 현재 채도(0~1)
    const f = s * (1 + v * (1 - curSat));      // 채도 배율 × 활기 배율(저채도일수록 큼)
    const y = luminance(r, g, b);
    d[i] = y + (r - y) * f;
    d[i + 1] = y + (g - y) * f;
    d[i + 2] = y + (b - y) * f;
  }
  return img;
}

// 포토 필터 프리셋(PS 기본 목록 근사). [hex, 표시 이름]
export const PHOTO_FILTER_PRESETS = [
  ["#ec8a00", "Warming 필터(85)"],
  ["#fa9600", "Warming 필터(LBA)"],
  ["#ebb113", "Warming 필터(81)"],
  ["#006dff", "Cooling 필터(80)"],
  ["#005dff", "Cooling 필터(LBB)"],
  ["#00b5ff", "Cooling 필터(82)"],
  ["#ea1a1a", "빨강"],
  ["#f38417", "주황"],
  ["#f9e31c", "노랑"],
  ["#19c919", "초록"],
  ["#1dcbea", "녹청"],
  ["#1d35ea", "파랑"],
  ["#9b1dea", "보라"],
  ["#e318e3", "마젠타"],
  ["#ac7a33", "세피아"],
  ["#00c1b1", "수중"],
];

// 포토 필터(Photo Filter). color: "#rrggbb", density: 농도 0~100, preserveLum: 광도 유지.
// 렌즈 앞 색 필터 근사 = 원색 × 필터색(곱하기)을 농도만큼 섞고, 광도 유지면 원래 휘도로 되돌린다.
export function photoFilter(img, color = "#ec8a00", density = 25, preserveLum = true) {
  const k = Math.max(0, Math.min(100, density)) / 100;
  if (k === 0) return img;
  const fc = typeof color === "string" ? hexToRgb(color) : color;
  const fr = fc.r / 255, fg = fc.g / 255, fb = fc.b / 255;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    let r = r0 + (r0 * fr - r0) * k;
    let g = g0 + (g0 * fg - g0) * k;
    let b = b0 + (b0 * fb - b0) * k;
    if (preserveLum) {
      const ly = luminance(r0, g0, b0), ny = luminance(r, g, b);
      if (ny > 0) { const f = ly / ny; r *= f; g *= f; b *= f; }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return img;
}

// 선택 색상(Selective Color) 색 범위 키(UI 순서) + 표시 이름.
export const SELECTIVE_COLOR_RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"];
export const SELECTIVE_COLOR_LABELS = {
  reds: "빨강 계열", yellows: "노랑 계열", greens: "초록 계열", cyans: "녹청 계열", blues: "파랑 계열",
  magentas: "마젠타 계열", whites: "흰색 계열", neutrals: "중간 계열", blacks: "검정 계열",
};

// 선택 색상(Selective Color).
//   adj: { reds:[C,M,Y,K], yellows:[...], ..., blacks:[...] } 각 -100~100(%)
//   relative: true=상대(기존 잉크량에 비례) / false=절대(잉크량을 직접 가감)
// 각 픽셀이 각 색 범위에 속하는 정도(가중치)를 구하고, CMY 잉크(=1-RGB)에 C/M/Y + K 를 더한다.
//   잉크 증가량 = 가중치 × 기준 × (색 조정 + K 조정), 기준 = 상대면 현재 잉크량(1-채널), 절대면 1.
export function selectiveColor(img, adj = {}, relative = true) {
  // 실제로 값이 있는 범위만 추린다(전부 0이면 무동작).
  const active = [];
  for (const key of SELECTIVE_COLOR_RANGES) {
    const a = adj[key];
    if (a && (a[0] || a[1] || a[2] || a[3])) active.push([key, a[0] / 100, a[1] / 100, a[2] / 100, a[3] / 100]);
  }
  if (!active.length) return img;
  const d = img.data;
  const w = {};
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const md = r + g + b - mx - mn;
    // 색 범위 가중치(0~1). 동률이면 앞 채널을 우선해 한 범위에만 속하게 한다.
    w.reds = mx === r ? mx - md : 0;
    w.greens = mx === g && mx !== r ? mx - md : 0;
    w.blues = mx === b && mx !== r && mx !== g ? mx - md : 0;
    w.cyans = mn === r ? md - mn : 0;
    w.magentas = mn === g && mn !== r ? md - mn : 0;
    w.yellows = mn === b && mn !== r && mn !== g ? md - mn : 0;
    w.whites = mn > 0.5 ? (mn - 0.5) * 2 : 0;
    w.blacks = mx < 0.5 ? (0.5 - mx) * 2 : 0;
    w.neutrals = Math.max(0, 1 - (Math.abs(mx - 0.5) + Math.abs(mn - 0.5)));
    let nr = r, ng = g, nb = b;
    for (const [key, c, m, y, k] of active) {
      const wt = w[key];
      if (wt <= 0) continue;
      // 채널별 잉크: R↔C, G↔M, B↔Y
      nr -= wt * (relative ? 1 - r : 1) * (c + k);
      ng -= wt * (relative ? 1 - g : 1) * (m + k);
      nb -= wt * (relative ? 1 - b : 1) * (y + k);
    }
    d[i] = nr * 255; d[i + 1] = ng * 255; d[i + 2] = nb * 255;
  }
  return img;
}

// 흑백(혼합) 기본 가중치(%) — PS "기본값" 프리셋. 키 순서가 UI 순서.
export const BLACK_WHITE_DEFAULTS = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };

// 흑백(Black & White, 색상별 가중 혼합). weights: { reds, yellows, greens, cyans, blues, magentas } (%; -200~300)
// 회색 = 최솟값 + (최대-중간)×[최대 채널 원색 가중] + (중간-최소)×[최대·중간 채널 혼합색 가중].
// (회색 픽셀은 가중치와 무관하게 그대로, 순수 빨강=reds%, 순수 노랑=yellows% 밝기가 된다.)
export function blackWhite(img, weights = BLACK_WHITE_DEFAULTS) {
  const W = { ...BLACK_WHITE_DEFAULTS, ...weights };
  const wr = W.reds / 100, wy = W.yellows / 100, wg = W.greens / 100;
  const wc = W.cyans / 100, wb = W.blues / 100, wm = W.magentas / 100;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let mx, md, mn, wPrim, wSec;
    // 최대/중간/최소 채널과 해당 원색·혼합색 가중치 결정
    if (r >= g && r >= b) {
      mx = r; wPrim = wr;
      if (g >= b) { md = g; mn = b; wSec = wy; } else { md = b; mn = g; wSec = wm; }
    } else if (g >= b) {
      mx = g; wPrim = wg;
      if (r >= b) { md = r; mn = b; wSec = wy; } else { md = b; mn = r; wSec = wc; }
    } else {
      mx = b; wPrim = wb;
      if (r >= g) { md = r; mn = g; wSec = wm; } else { md = g; mn = r; wSec = wc; }
    }
    const y = mn + (mx - md) * wPrim + (md - mn) * wSec;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return img;
}

// 채도 감소(Desaturate). PS와 같이 HSL 명도((최대+최소)/2)로 회색화한다.
export function desaturate(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  }
  return img;
}

// Float32 단일 채널 박스 블러(누적합, 반경 r, 가장자리 복제). 가로→세로 분리형 O(n).
// 3회 반복하면 가우시안 근사가 된다.
function boxBlurF32(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {           // 가로
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / div;
      const xo = x - r, xi = x + r + 1;
      acc += src[row + (xi >= w ? w - 1 : xi)] - src[row + (xo < 0 ? 0 : xo)];
    }
  }
  for (let x = 0; x < w; x++) {           // 세로
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / div;
      const yo = y - r, yi = y + r + 1;
      acc += tmp[(yi >= h ? h - 1 : yi) * w + x] - tmp[(yo < 0 ? 0 : yo) * w + x];
    }
  }
  return out;
}

// 어두운 영역/밝은 영역(Shadows/Highlights).
//   shadows/highlights: 양 0~100(%), toneWidth: 톤 폭 1~100(%), radius: 주변 휘도 반경(px, 0=픽셀 단위)
// 주변 평균 휘도(박스 블러 3회=가우시안 근사)로 어두운/밝은 영역 마스크를 만들고,
// 어두운 영역은 1-(1-c)^(1+2·양·마스크)로 들어올리고, 밝은 영역은 c^(1+2·양·마스크)로 눌러 준다.
export function shadowsHighlights(img, shadows = 35, highlights = 0, toneWidth = 50, radius = 30) {
  const sa = shadows / 100, ha = highlights / 100;
  if (sa === 0 && ha === 0) return img;
  const d = img.data, w = img.width, h = img.height, n = w * h;
  const tw = Math.max(0.01, Math.min(1, toneWidth / 100));
  let L = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) L[p] = luminance(d[i], d[i + 1], d[i + 2]) / 255;
  const r = Math.max(0, Math.round(radius / 3)); // 박스 3회 ≈ 반경 radius 가우시안
  if (r >= 1) for (let k = 0; k < 3; k++) L = boxBlurF32(L, w, h, r);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const lb = L[p];
    const ms = lb < tw ? Math.pow(1 - lb / tw, 2) : 0;               // 어두운 영역 마스크
    const mh = lb > 1 - tw ? Math.pow((lb - (1 - tw)) / tw, 2) : 0;  // 밝은 영역 마스크
    if (ms <= 0 && mh <= 0) continue;
    const es = 1 + 2 * sa * ms, eh = 1 + 2 * ha * mh;
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] / 255;
      if (ms > 0) v = 1 - Math.pow(1 - v, es);
      if (mh > 0) v = Math.pow(v, eh);
      d[i + c] = v * 255;
    }
  }
  return img;
}

// 색상 대체(Replace Color).
//   target: "#rrggbb" 또는 {r,g,b} — 대상 색, fuzziness: 허용치 0~200,
//   hue: -180~180, sat: -100~100, light: -100~100 (색조/채도와 같은 규약)
// 대상 색과의 RGB 거리로 선택 가중치(1→0 선형 감쇠, 반경=허용치×2)를 만들고, 그만큼 HSL 이동 결과를 섞는다.
export function replaceColor(img, target = "#ff0000", fuzziness = 40, hue = 0, sat = 0, light = 0) {
  if (hue === 0 && sat === 0 && light === 0) return img;
  const t = typeof target === "string" ? hexToRgb(target) : target;
  const rad = Math.max(0, fuzziness) * 2;
  const satF = 1 + sat / 100, lightF = light / 100;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dr = r - t.r, dg = g - t.g, db = b - t.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const wt = rad > 0 ? 1 - dist / rad : (dist === 0 ? 1 : 0);
    if (wt <= 0) continue;
    const hsl = rgbToHsl(r, g, b);
    let hh = (hsl.h + hue) % 360; if (hh < 0) hh += 360;
    const s = Math.max(0, Math.min(1, hsl.s * satF));
    const l = Math.max(0, Math.min(1, hsl.l + lightF));
    const o = hslToRgb(hh, s, l);
    d[i] = r + (o.r - r) * wt;
    d[i + 1] = g + (o.g - g) * wt;
    d[i + 2] = b + (o.b - b) * wt;
  }
  return img;
}

// 히스토그램(256)에서 양끝 clip 비율만큼 잘라낸 [low, high] 입력 범위를 찾는다.
function clipRange(hist, total, clip) {
  const cut = Math.floor(total * clip);
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cut) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > cut) break; }
  return [lo, hi];
}

// 자동 대비(Auto Contrast). RGB 세 채널을 합친 분포의 양끝 clip(기본 0.1%)을 잘라 같은 비율로 펼친다(색조 유지).
// 알파 0 픽셀은 히스토그램에서 제외(모두 투명이면 no-op).
export function autoContrast(img, clip = 0.001) {
  const d = img.data;
  const hist = new Float32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    n++; hist[d[i]]++; hist[d[i + 1]]++; hist[d[i + 2]]++;
  }
  if (!n) return img;
  const [lo, hi] = clipRange(hist, n * 3, clip);
  if (hi <= lo || (lo === 0 && hi === 255)) return img;
  return levels(img, "rgb", lo, hi, 1, 0, 255);
}

// 자동 색상(Auto Color). 채널별로 양끝 clip 을 잘라 펼친 뒤(색 캐스트 제거),
// 각 채널 평균이 세 채널 평균과 같아지도록 채널별 감마로 중간 톤을 중성화한다.
// 알파 0 픽셀은 히스토그램·평균에서 제외(모두 투명이면 no-op).
export function autoColor(img, clip = 0.001) {
  const d = img.data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
  if (!n) return img;
  const CH = ["r", "g", "b"];
  for (let c = 0; c < 3; c++) {
    const hist = new Float32Array(256);
    for (let i = c; i < d.length; i += 4) if (d[i + 3 - c] !== 0) hist[d[i]]++;
    const [lo, hi] = clipRange(hist, n, clip);
    if (hi > lo && !(lo === 0 && hi === 255)) levels(img, CH[c], lo, hi, 1, 0, 255);
  }
  // 중간 톤 중성화: 채널 평균(0~1) m 을 목표 평균 t 로 보내는 감마(m^(1/γ)=t → γ=ln m/ln t)
  const mean = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2];
  }
  for (let c = 0; c < 3; c++) mean[c] = mean[c] / n / 255;
  const target = (mean[0] + mean[1] + mean[2]) / 3;
  if (target <= 0.001 || target >= 0.999) return img;
  for (let c = 0; c < 3; c++) {
    const m = mean[c];
    if (m <= 0.001 || m >= 0.999 || Math.abs(m - target) < 0.002) continue;
    const g = Math.max(0.5, Math.min(2, Math.log(m) / Math.log(target))); // 과보정 방지 0.5~2
    levels(img, CH[c], 0, 255, g, 0, 255);
  }
  return img;
}
