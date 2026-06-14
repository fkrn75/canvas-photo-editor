// adjustments.js — 색상 보정 (모두 ImageData를 제자리 수정). 가능한 곳은 256-LUT로 가속.

import { rgbToHsl, hslToRgb, luminance } from "./color.js";

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
  const pts = points.slice().sort((a, b) => a.x - b.x);
  const n = pts.length;
  const lut = new Uint8ClampedArray(256);
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
