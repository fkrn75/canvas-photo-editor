// layer-styles.js — 레이어 스타일(Layer Styles) 순수 렌더 엔진.
// 입력 레이어 캔버스(srcCanvas)에 효과를 합성한 "새 캔버스"를 반환한다(비파괴).
// styles가 없거나 활성 효과가 하나도 없으면 srcCanvas를 그대로 반환(불필요한 복사 방지).
//
// 지원 효과(포토샵 7 레이어 스타일 일부):
//   · Drop Shadow  (그림자) : distance/angle/blur/spread/color/opacity
//   · Outer Glow   (외부 광선): blur/spread/color/opacity
//   · Stroke       (선)      : size/position(inside·center·outside)/color/opacity
//   · Color Overlay(색상 오버레이): color/opacity/blendMode
//
// 합성 순서(아래→위, 포토샵 Z-순서와 동일):
//   Drop Shadow → Outer Glow → (원본 레이어 + Color Overlay) → Stroke
//
// 그림자/광선은 레이어의 "알파 실루엣"을 추출 → 오프셋/확장 → 블러 → 색 입힘 방식으로 만든다.
// 모든 작업은 입력과 동일한 크기의 오프스크린 캔버스에서 수행한다(문서 좌표계 가정).

import { hexToRgb } from "../engine/color.js";

// ── 기본값 정의(다이얼로그/마이그레이션에서 공용으로 사용) ──────────────────
// 각 효과 객체의 enabled 플래그로 on/off를 제어한다. opacity는 0~1.
export const DEFAULT_STYLES = {
  dropShadow:   { enabled: false, color: "#000000", opacity: 0.5,  distance: 6, angle: 135, blur: 6, spread: 0 },
  outerGlow:    { enabled: false, color: "#ffd34d", opacity: 0.6,  blur: 10, spread: 0 },
  stroke:       { enabled: false, color: "#000000", opacity: 1,    size: 3, position: "outside" },
  colorOverlay: { enabled: false, color: "#ff0000", opacity: 1,    blendMode: "normal" },
};

// 효과가 하나라도 켜져 있는지(없으면 렌더를 건너뛴다)
export function hasAnyStyle(styles) {
  if (!styles) return false;
  return !!(
    (styles.dropShadow && styles.dropShadow.enabled) ||
    (styles.outerGlow && styles.outerGlow.enabled) ||
    (styles.stroke && styles.stroke.enabled) ||
    (styles.colorOverlay && styles.colorOverlay.enabled)
  );
}

// 빈(모두 비활성) 스타일 객체를 deep-copy로 만든다(다이얼로그 초기값용).
export function makeDefaultStyles() {
  return {
    dropShadow:   { ...DEFAULT_STYLES.dropShadow },
    outerGlow:    { ...DEFAULT_STYLES.outerGlow },
    stroke:       { ...DEFAULT_STYLES.stroke },
    colorOverlay: { ...DEFAULT_STYLES.colorOverlay },
  };
}

// ── 내부 헬퍼 ───────────────────────────────────────────────────────────────

// 동일 크기의 빈 캔버스 생성(willReadFrequently: 알파 추출용 getImageData가 잦다)
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function ctx2d(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true });
}

// 입력 캔버스의 "알파 실루엣"을 지정 색(rgb)으로 칠한 새 캔버스를 만든다.
// source-in 합성으로 알파는 원본을 따르되 색만 단색으로 바꾼다(그림자/광선/색상오버레이 베이스).
function tintSilhouette(srcCanvas, r, g, b) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = makeCanvas(w, h);
  const o = ctx2d(out);
  o.drawImage(srcCanvas, 0, 0);           // 원본 알파 복사
  o.globalCompositeOperation = "source-in"; // 기존 알파 영역만 색으로 덮음
  o.fillStyle = `rgb(${r},${g},${b})`;
  o.fillRect(0, 0, w, h);
  return out;
}

// 알파 채널을 spread(px)만큼 팽창(dilate)시킨다. 단순 max 필터(정사각 커널 근사)로,
// 작은 spread 값에서 충분히 자연스럽다. spread<=0이면 원본을 그대로 반환.
// (성능: 분리형 1D 두 패스로 O(w·h·r). 큰 spread는 다이얼로그에서 제한)
function dilateAlpha(srcCanvas, spread) {
  const r = Math.round(spread);
  if (r <= 0) return srcCanvas;
  const w = srcCanvas.width, h = srcCanvas.height;
  const sctx = ctx2d(srcCanvas);
  const src = sctx.getImageData(0, 0, w, h);
  const a0 = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) a0[p] = src.data[i + 3];

  // 가로 패스
  const a1 = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) { const v = a0[row + xx]; if (v > m) m = v; }
      a1[row + x] = m;
    }
  }
  // 세로 패스
  const a2 = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) { const v = a1[yy * w + x]; if (v > m) m = v; }
      a2[y * w + x] = m;
    }
  }

  // 팽창된 알파를 흰색 실루엣 캔버스로 출력(색은 이후 tint 단계에서 입힘)
  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  const img = octx.createImageData(w, h);
  for (let p = 0, i = 0; p < a2.length; p++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a2[p];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// 캔버스에 가우시안 근사 블러를 입힌 새 캔버스를 반환한다.
// Canvas2D의 filter 속성(blur())을 사용 — CSP 안전(인라인/eval 아님)하고 브라우저 가속.
// blur<=0이면 원본을 그대로 반환.
function blurCanvas(srcCanvas, blur) {
  const b = Math.max(0, blur);
  if (b <= 0) return srcCanvas;
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = makeCanvas(w, h);
  const o = ctx2d(out);
  o.filter = `blur(${b}px)`;
  o.drawImage(srcCanvas, 0, 0);
  o.filter = "none";
  return out;
}

// 그림자/광선용 실루엣 레이어 생성:
//   srcCanvas 알파 → spread 팽창 → blur → 색 입힘 → opacity 캔버스로 반환.
// dx,dy: 합성 시 적용할 오프셋(여기선 캔버스 자체는 원위치, 합성 단계에서 translate).
function buildGlowLayer(srcCanvas, { color, opacity, blur, spread }) {
  const rgb = hexToRgb(color);
  let sil = dilateAlpha(srcCanvas, spread || 0); // 팽창된 흰 실루엣(또는 원본)
  // dilate가 원본을 반환했을 수 있으므로(=spread 0) 항상 색 입힘은 tint로 통일
  sil = tintSilhouette(sil, rgb.r, rgb.g, rgb.b);
  const blurred = blurCanvas(sil, blur || 0);
  return { canvas: blurred, opacity: clamp01(opacity) };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : (v == null ? 1 : v); }

// 각도(도) → 라디안. 포토샵 각도는 "빛의 방향"이라 그림자는 반대로 떨어진다.
// dx = distance * cos, dy = -distance * sin (화면 y는 아래로 +이므로 부호 반전).
function shadowOffset(distance, angleDeg) {
  const a = (angleDeg || 0) * Math.PI / 180;
  return { dx: distance * Math.cos(a), dy: -distance * Math.sin(a) };
}

// ── 개별 효과 합성기(모두 dest ctx 위에 그린다) ─────────────────────────────

// Drop Shadow: 실루엣을 오프셋 위치에 깔되, "원본 레이어가 차지한 영역"은 빼서
// 가장자리에만 그림자가 보이도록 한다(destination-out으로 원본 알파를 도려냄).
function drawDropShadow(destCtx, srcCanvas, s) {
  const { dx, dy } = shadowOffset(s.distance || 0, s.angle || 0);
  const { canvas: glow, opacity } = buildGlowLayer(srcCanvas, s);

  // 그림자만 따로 그린 임시 캔버스(원본 영역 도려내기 위해)
  const w = srcCanvas.width, h = srcCanvas.height;
  const tmp = makeCanvas(w, h);
  const t = ctx2d(tmp);
  t.globalAlpha = opacity;
  t.drawImage(glow, dx, dy);
  t.globalAlpha = 1;
  // 원본 실루엣 영역을 도려내 가장자리 그림자만 남김(포토샵 "레이어가 그림자를 가림")
  t.globalCompositeOperation = "destination-out";
  t.drawImage(srcCanvas, 0, 0);

  destCtx.drawImage(tmp, 0, 0);
}

// Outer Glow: 팽창+블러한 실루엣을 그린 뒤, 원본 영역을 도려내 바깥쪽 광선만 남긴다.
function drawOuterGlow(destCtx, srcCanvas, s) {
  const { canvas: glow, opacity } = buildGlowLayer(srcCanvas, s);
  const w = srcCanvas.width, h = srcCanvas.height;
  const tmp = makeCanvas(w, h);
  const t = ctx2d(tmp);
  t.globalAlpha = opacity;
  t.drawImage(glow, 0, 0);
  t.globalAlpha = 1;
  t.globalCompositeOperation = "destination-out";
  t.drawImage(srcCanvas, 0, 0); // 원본 영역 제거 → 바깥 광선만
  destCtx.drawImage(tmp, 0, 0);
}

// Stroke: 위치(inside/center/outside)에 따라 외곽선을 그린다.
//   outside : 팽창 실루엣 − 원본       (바깥쪽)
//   inside  : 원본 − 축소(팽창의 반대) ≈ 원본 − (원본을 -size 침식)  (안쪽)
//   center  : outside(size/2) ∪ inside(size/2) 근사 → 팽창(size/2) ∩ 링
// 단순화를 위해 center는 outside(size/2)와 inside(size/2)를 합쳐 표현한다.
function drawStroke(destCtx, srcCanvas, s) {
  const size = Math.max(1, Math.round(s.size || 1));
  const rgb = hexToRgb(s.color);
  const op = clamp01(s.opacity);
  const w = srcCanvas.width, h = srcCanvas.height;

  // 도우미: 두께 t의 "바깥 링"(팽창 t − 원본) 캔버스
  const outerRing = (t) => {
    const dil = dilateAlpha(srcCanvas, t);
    const tint = tintSilhouette(dil, rgb.r, rgb.g, rgb.b);
    const c = makeCanvas(w, h);
    const cc = ctx2d(c);
    cc.drawImage(tint, 0, 0);
    cc.globalCompositeOperation = "destination-out";
    cc.drawImage(srcCanvas, 0, 0); // 원본 영역 제거 → 바깥 링만
    return c;
  };
  // 도우미: 두께 t의 "안쪽 링"(원본 − 침식 t). 침식=원본 알파를 반전 팽창으로 근사.
  const innerRing = (t) => {
    const eroded = erodeAlpha(srcCanvas, t);            // t만큼 줄어든 실루엣
    const tint = tintSilhouette(srcCanvas, rgb.r, rgb.g, rgb.b);
    const c = makeCanvas(w, h);
    const cc = ctx2d(c);
    cc.drawImage(tint, 0, 0);
    cc.globalCompositeOperation = "destination-out";
    cc.drawImage(eroded, 0, 0); // 안쪽(줄어든) 영역 제거 → 안쪽 링만
    return c;
  };

  let ring;
  if (s.position === "inside") {
    ring = innerRing(size);
  } else if (s.position === "center") {
    // 중앙: 바깥 size/2 + 안쪽 size/2 를 합성
    const half = Math.max(1, Math.round(size / 2));
    const o = outerRing(half), i = innerRing(half);
    ring = makeCanvas(w, h);
    const rc = ctx2d(ring);
    rc.drawImage(o, 0, 0);
    rc.drawImage(i, 0, 0);
  } else {
    ring = outerRing(size); // outside(기본)
  }

  destCtx.globalAlpha = op;
  destCtx.drawImage(ring, 0, 0);
  destCtx.globalAlpha = 1;
}

// 알파 침식(erode): 알파를 반전 → 팽창 → 다시 반전과 동치. inside stroke에 사용.
// size만큼 실루엣을 안쪽으로 깎은 흰 실루엣 캔버스를 반환한다.
function erodeAlpha(srcCanvas, size) {
  const r = Math.round(size);
  if (r <= 0) return srcCanvas;
  const w = srcCanvas.width, h = srcCanvas.height;
  const sctx = ctx2d(srcCanvas);
  const src = sctx.getImageData(0, 0, w, h);
  // 반전 알파(바깥=255, 안=0)
  const inv = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) inv[p] = 255 - src.data[i + 3];

  // 가로/세로 max 필터(=반전 알파 팽창)
  const t1 = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) { const v = inv[row + xx]; if (v > m) m = v; }
      t1[row + x] = m;
    }
  }
  const t2 = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) { const v = t1[yy * w + x]; if (v > m) m = v; }
      t2[y * w + x] = m;
    }
  }
  // 다시 반전 → 침식된 알파
  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  const img = octx.createImageData(w, h);
  for (let p = 0, i = 0; p < t2.length; p++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = 255 - t2[p];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// Color Overlay: 원본 알파 영역을 단색으로 덮는다. blendMode/opacity 반영.
// 원본 레이어 위에 "원본 알파로 클립된 색"을 지정 블렌드 모드로 올린다.
function drawColorOverlay(destCtx, srcCanvas, s) {
  const rgb = hexToRgb(s.color);
  const tint = tintSilhouette(srcCanvas, rgb.r, rgb.g, rgb.b); // 원본 알파 모양의 단색
  destCtx.save();
  destCtx.globalAlpha = clamp01(s.opacity);
  // 네이티브 합성 모드만 안전하게 사용(레이어 스타일 색상 오버레이는 단순 모드 위주)
  destCtx.globalCompositeOperation = nativeGco(s.blendMode);
  destCtx.drawImage(tint, 0, 0);
  destCtx.restore();
}

// Color Overlay용 블렌드 모드 → Canvas globalCompositeOperation 매핑(네이티브만).
// 알 수 없거나 커스텀(per-pixel) 모드는 source-over(=normal)로 폴백한다.
function nativeGco(mode) {
  const MAP = {
    normal: "source-over",
    multiply: "multiply", screen: "screen", overlay: "overlay",
    darken: "darken", lighten: "lighten",
    "color-dodge": "color-dodge", "color-burn": "color-burn",
    "hard-light": "hard-light", "soft-light": "soft-light",
    difference: "difference", exclusion: "exclusion",
    hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
  };
  return MAP[mode] || "source-over";
}

// ── 공개 API ────────────────────────────────────────────────────────────────
// applyLayerStyles(srcCanvas, styles) -> canvas
//   srcCanvas: 레이어의 유효 소스 캔버스(마스크/fill 반영 후의 것일 수 있음).
//   styles   : layer.styles 객체(없거나 비활성뿐이면 srcCanvas 그대로 반환).
//   반환     : 효과가 합성된 새 캔버스(원본 srcCanvas는 변경하지 않음).
export function applyLayerStyles(srcCanvas, styles) {
  if (!hasAnyStyle(styles)) return srcCanvas;

  const w = srcCanvas.width, h = srcCanvas.height;
  const out = makeCanvas(w, h);
  const o = ctx2d(out);

  // 1) 그림자(맨 아래)
  if (styles.dropShadow && styles.dropShadow.enabled) {
    drawDropShadow(o, srcCanvas, styles.dropShadow);
  }
  // 2) 외부 광선(그림자 위, 원본 아래)
  if (styles.outerGlow && styles.outerGlow.enabled) {
    drawOuterGlow(o, srcCanvas, styles.outerGlow);
  }
  // 3) 원본 레이어
  o.drawImage(srcCanvas, 0, 0);
  // 4) 색상 오버레이(원본 픽셀 위에 색)
  if (styles.colorOverlay && styles.colorOverlay.enabled) {
    drawColorOverlay(o, srcCanvas, styles.colorOverlay);
  }
  // 5) 선(맨 위)
  if (styles.stroke && styles.stroke.enabled) {
    drawStroke(o, srcCanvas, styles.stroke);
  }

  return out;
}
