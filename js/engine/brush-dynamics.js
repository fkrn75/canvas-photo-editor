// brush-dynamics.js — 브러시 동역학 엔진 (순수 로직, DOM 무관).
//
// 포토샵의 "브러시 동역학" 4종을 모사한다. paint-tool이 스탬프를 찍기 직전에
// 이 엔진을 호출해 각 스탬프의 크기/각도/위치/색을 변조(jitter)한다.
//
//   1) Shape Dynamics : 스탬프마다 크기·각도를 무작위로 흔든다.
//   2) Scatter        : 스탬프를 스트로크 경로에서 옆으로 흩뿌리고, 한 점에서 여러 개를 찍는다(count).
//   3) Color Dynamics : 스탬프마다 전경↔배경 사이를 섞고 색조/채도/명도를 흔든다.
//   4) Dual Brush     : 1차 스탬프 강도에 2차 텍스처(spatter/chalk 류)의 강도를 곱해 질감을 입힌다.
//
// [설계 원칙 — 회귀 안전]
//   모든 동역학이 꺼져 있으면(isActive()===false) paint-tool은 기존 단색-마스크 경로를 그대로 탄다.
//   색/질감을 스탬프마다 바꾸는 동역학(Color/Dual)이 켜진 경우에만 paint-tool이 "스탬프별 채색 경로"로 분기한다.
//   크기/각도/흩뿌림(Shape/Scatter)은 단색 마스크 경로 안에서도 점(dot) 변조만으로 처리할 수 있다.
//
// [난수]
//   결정성(테스트·미리보기 일관성)을 위해 자체 시드 PRNG(mulberry32)를 쓴다.
//   stroke 시작 시 reset(seed)로 초기화한다. 시드를 안 주면 Date.now 기반.

import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from "./color.js";

// 빠르고 가벼운 시드 난수(mulberry32). 0~1 반환.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BrushDynamics {
  // state = AppState (브러시 동역학 옵션 필드들을 읽는다)
  constructor(state) {
    this.state = state;
    this.rng = mulberry32(0);
  }

  // stroke 시작마다 호출해 난수열을 초기화(시드 없으면 시간 기반).
  reset(seed) {
    this.rng = mulberry32(seed == null ? (Date.now() & 0xffffffff) : seed);
  }

  // ─────────────────────────────────────────────────────────────
  // 활성 여부 질의
  // ─────────────────────────────────────────────────────────────

  // 동역학이 하나라도 켜져 있는가(꺼져 있으면 paint-tool 기존 경로 유지)
  isActive() {
    const s = this.state;
    return !!(s.dynShape || s.dynScatter || s.dynColor || s.dynDual);
  }

  // 스탬프마다 색/질감이 달라지는가 → paint-tool이 "스탬프별 채색 경로"를 써야 함.
  // (Shape/Scatter만이면 단색 마스크 경로 안에서 점 변조로 충분하다.)
  needsPerStampColor() {
    const s = this.state;
    return !!(s.dynColor || s.dynDual);
  }

  // ─────────────────────────────────────────────────────────────
  // 변조 계산
  // ─────────────────────────────────────────────────────────────

  // 대칭 지터: 0~1 양(amount)에 대해 [-amount, +amount] 범위의 난수.
  _jit(amount) {
    return (this.rng() * 2 - 1) * amount;
  }

  // 한 보간 지점(x,y, 기준 반경 r)에서 찍을 스탬프 목록을 만든다.
  // 반환: [{ x, y, r, angle, color }]
  //   - x,y     : (Scatter로 흩뿌려진) 최종 좌표
  //   - r       : (Shape size jitter 적용) 반경
  //   - angle   : (Shape angle jitter 적용) 라디안. 단색 마스크 경로에선 사각/캘리 등 방향성 모양에만 의미.
  //   - color   : (Color dynamics) {r,g,b}. Color dynamics 꺼졌으면 baseRgb 그대로.
  //
  // baseRgb : 전경색 {r,g,b} (paint-tool이 hexToRgb로 미리 만들어 전달)
  stampsAt(x, y, r, baseRgb) {
    const s = this.state;
    const out = [];

    // Scatter: 한 지점에서 찍을 개수(count). 1~16.
    let count = 1;
    if (s.dynScatter) {
      const cMax = Math.max(1, s.scatterCount | 0);
      // count 지터: 1..cMax 사이 균등(최소 1 보장)
      count = 1 + Math.floor(this.rng() * cMax);
      if (count > 16) count = 16;
    }

    for (let i = 0; i < count; i++) {
      let sx = x, sy = y, sr = r, ang = 0;

      // Shape Dynamics: 크기/각도 흔들기
      if (s.dynShape) {
        if (s.shapeSizeJitter > 0) {
          // 크기는 0으로 죽지 않게 [1-amount, 1] 사이로 줄이는 방식(포토샵 size jitter와 동일 방향)
          const f = 1 - this.rng() * s.shapeSizeJitter;
          sr = Math.max(0.5, r * f);
        }
        if (s.shapeAngleJitter > 0) {
          ang = this.rng() * Math.PI * 2 * s.shapeAngleJitter;
        }
      }

      // Scatter: 경로에서 옆/주변으로 흩뿌림. scatterAmount(0~1) × 반경의 몇 배까지.
      if (s.dynScatter && s.scatterAmount > 0) {
        const spread = r * 4 * s.scatterAmount; // 최대 흩뿌림 거리
        const a = this.rng() * Math.PI * 2;
        const d = this.rng() * spread;
        sx += Math.cos(a) * d;
        sy += Math.sin(a) * d;
      }

      // Color Dynamics: 색 변조
      let color = baseRgb;
      if (s.dynColor) color = this._jitterColor(baseRgb);

      out.push({ x: sx, y: sy, r: sr, angle: ang, color });
    }
    return out;
  }

  // 전경/배경 혼합 + HSL 지터로 한 스탬프의 색을 만든다.
  _jitterColor(baseRgb) {
    const s = this.state;
    let { r, g, b } = baseRgb;

    // 전경↔배경 변동: fgbgJitter(0~1) 확률 강도로 배경색 쪽으로 보간.
    if (s.colorFgBgJitter > 0 && s.background) {
      const bg = hexToRgb(s.background);
      const t = this.rng() * s.colorFgBgJitter;
      r = r + (bg.r - r) * t;
      g = g + (bg.g - g) * t;
      b = b + (bg.b - b) * t;
    }

    // HSL 지터(색조/채도/명도)
    const needHsl = s.colorHueJitter > 0 || s.colorSatJitter > 0 || s.colorBriJitter > 0;
    if (needHsl) {
      let { h, s: sat, l } = rgbToHsl(r, g, b);
      if (s.colorHueJitter > 0) h = (h + this._jit(180 * s.colorHueJitter) + 360) % 360;
      if (s.colorSatJitter > 0) sat = clamp01(sat + this._jit(s.colorSatJitter));
      if (s.colorBriJitter > 0) l = clamp01(l + this._jit(s.colorBriJitter));
      const c = hslToRgb(h, sat, l);
      r = c.r; g = c.g; b = c.b;
    }

    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }

  // Dual Brush 2차 텍스처 강도 마스크를 만든다(0~1 알파를 곱할 용도).
  // paint-tool이 1차 스탬프를 찍은 영역에 대해, 같은 크기 캔버스에 2차 질감을 흩뿌려
  // 그 강도를 픽셀별로 곱하면 "질감 입은 브러시"가 된다.
  //
  // 반환: 강도(0~255 그레이) 캔버스. dynDual이 꺼져 있으면 null.
  buildDualMask(width, height, applyClip) {
    const s = this.state;
    if (!s.dynDual) return null;

    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // 검정 바탕(=질감 없는 곳은 강도 0 → 그 픽셀은 안 칠해짐)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (applyClip) applyClip(ctx);
    return c;
  }

  // 2차 텍스처를 한 스탬프 위치에 찍는다(buildDualMask의 캔버스에 누적).
  // dualType: 'spatter' | 'chalk' | 'dots' | 'noise'
  stampDualTexture(ctx, x, y, r) {
    const s = this.state;
    const type = s.dualType || "spatter";
    const density = Math.max(0.05, s.dualDensity ?? 0.5); // 0~1
    ctx.save();
    ctx.globalCompositeOperation = "lighten"; // 겹쳐도 강도 누적 방지
    ctx.fillStyle = "#fff";

    switch (type) {
      case "chalk": {
        const n = Math.max(6, Math.round(r * r * 0.5 * density));
        for (let i = 0; i < n; i++) {
          const a = this.rng() * Math.PI * 2, rad = Math.sqrt(this.rng()) * r;
          ctx.fillRect(Math.round(x + Math.cos(a) * rad), Math.round(y + Math.sin(a) * rad), 1, 1);
        }
        break;
      }
      case "dots": {
        const n = Math.max(3, Math.round(r * density));
        for (let i = 0; i < n; i++) {
          const a = this.rng() * Math.PI * 2, rad = this.rng() * r;
          const dr = Math.max(0.5, r * 0.2 * this.rng());
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, dr, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "noise": {
        // 성긴 점 노이즈: 픽셀 단위 무작위
        const n = Math.max(8, Math.round(r * r * density));
        for (let i = 0; i < n; i++) {
          const a = this.rng() * Math.PI * 2, rad = this.rng() * r;
          const g = Math.round(120 + this.rng() * 135); // 회색~흰색 강도
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(Math.round(x + Math.cos(a) * rad), Math.round(y + Math.sin(a) * rad), 1, 1);
        }
        break;
      }
      default: { // spatter: 크고 작은 물방울
        const n = Math.max(4, Math.round(r * 1.4 * density));
        for (let i = 0; i < n; i++) {
          const a = this.rng() * Math.PI * 2, rad = this.rng() * r;
          const dr = Math.max(0.5, r * 0.16 * this.rng());
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, dr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// rgbToHex는 직접 안 쓰지만, paint-tool/패널에서 동역학 미리보기 색을 만들 때 재사용할 수 있도록 재수출.
export { rgbToHex };
