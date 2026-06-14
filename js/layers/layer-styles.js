// layer-styles.js — 레이어 스타일(Layer Styles) 순수 렌더 엔진.
// 입력 레이어 캔버스(srcCanvas)에 효과를 합성한 "새 캔버스"를 반환한다(비파괴).
// styles가 없거나 활성 효과가 하나도 없으면 srcCanvas를 그대로 반환(불필요한 복사 방지).
//
// 지원 효과(포토샵 7 레이어 스타일):
//   · Drop Shadow     (그림자)        : distance/angle/blur/spread/color/opacity
//   · Inner Shadow    (내부 그림자)   : distance/angle/blur/spread/color/opacity
//   · Outer Glow      (외부 광선)     : blur/spread/color/opacity
//   · Inner Glow      (내부 광선)     : blur/spread/color/opacity/source(edge·center)
//   · Bevel/Emboss    (경사와 엠보스) : style/size/depth/angle/altitude/highlight/shadow…
//   · Satin           (새틴)          : color/opacity/angle/distance/blur/invert/blendMode
//   · Color Overlay   (색상 오버레이) : color/opacity/blendMode
//   · Gradient Overlay(그라디언트 오버레이): colors[]/opacity/angle/scale/style/reverse/blendMode
//   · Pattern Overlay (패턴 오버레이) : patternId/scale/opacity/blendMode
//   · Stroke          (선)            : size/position(inside·center·outside)/color/opacity
//
// 합성 순서(아래→위, 포토샵 Z-순서와 동일):
//   Drop Shadow → Outer Glow
//   → 원본 레이어
//   → Color Overlay → Gradient Overlay → Pattern Overlay  (원본 알파로 클립된 채움)
//   → Satin
//   → Inner Shadow → Inner Glow
//   → Bevel/Emboss
//   → Stroke (맨 위)
//
// 그림자/광선은 레이어의 "알파 실루엣"을 추출 → 오프셋/확장 → 블러 → 색 입힘 방식으로 만든다.
// 내부 계열(Inner Shadow/Glow)은 "반전 실루엣"을 흘려 안쪽 가장자리에만 나타나게 한다.
// 모든 작업은 입력과 동일한 크기의 오프스크린 캔버스에서 수행한다(문서 좌표계 가정).

import { hexToRgb } from "../engine/color.js";
import { getPattern } from "../styles/patterns.js";

// ── 기본값 정의(다이얼로그/마이그레이션에서 공용으로 사용) ──────────────────
// 각 효과 객체의 enabled 플래그로 on/off를 제어한다. opacity는 0~1.
export const DEFAULT_STYLES = {
  dropShadow:      { enabled: false, color: "#000000", opacity: 0.5, distance: 6, angle: 135, blur: 6, spread: 0, blendMode: "multiply" },
  innerShadow:     { enabled: false, color: "#000000", opacity: 0.5, distance: 6, angle: 135, blur: 6, spread: 0, blendMode: "multiply" },
  outerGlow:       { enabled: false, color: "#ffd34d", opacity: 0.6, blur: 10, spread: 0, blendMode: "screen" },
  innerGlow:       { enabled: false, color: "#ffffb3", opacity: 0.6, blur: 10, spread: 0, source: "edge", blendMode: "screen" },
  bevel:           { enabled: false, style: "inner", size: 6, depth: 100, angle: 135, altitude: 30,
                     highlight: "#ffffff", highlightOpacity: 0.75, shadow: "#000000", shadowOpacity: 0.75 },
  satin:           { enabled: false, color: "#000000", opacity: 0.5, angle: 19, distance: 11, blur: 14, invert: true, blendMode: "multiply" },
  colorOverlay:    { enabled: false, color: "#ff0000", opacity: 1, blendMode: "normal" },
  gradientOverlay: { enabled: false, colors: ["#000000", "#ffffff"], opacity: 1, angle: 90, scale: 100, style: "linear", reverse: false, blendMode: "normal" },
  patternOverlay:  { enabled: false, patternId: "checker", scale: 100, opacity: 1, blendMode: "normal" },
  stroke:          { enabled: false, color: "#000000", opacity: 1, size: 3, position: "outside" },
};

// 모든 효과 키(순회/복사용 단일 출처)
const STYLE_KEYS = Object.keys(DEFAULT_STYLES);

// 효과가 하나라도 켜져 있는지(없으면 렌더를 건너뛴다)
export function hasAnyStyle(styles) {
  if (!styles) return false;
  for (const k of STYLE_KEYS) {
    if (styles[k] && styles[k].enabled) return true;
  }
  return false;
}

// 빈(모두 비활성) 스타일 객체를 deep-copy로 만든다(다이얼로그 초기값용).
// 배열 값(gradientOverlay.colors)은 별도로 복사해 참조 공유를 막는다.
export function makeDefaultStyles() {
  const out = {};
  for (const k of STYLE_KEYS) out[k] = cloneEffect(DEFAULT_STYLES[k]);
  return out;
}

// 단일 효과 객체 복사(배열 필드까지 안전 복사). 다이얼로그/프리셋/커맨드 공용.
export function cloneEffect(eff) {
  const c = { ...eff };
  if (Array.isArray(eff.colors)) c.colors = eff.colors.slice();
  return c;
}

// styles 객체 전체 깊은 복사. 누락된 효과 키는 기본값으로 보강(구버전 마이그레이션).
export function cloneStyles(s) {
  if (!s) return null;
  const out = {};
  for (const k of STYLE_KEYS) {
    out[k] = s[k] ? cloneEffect({ ...DEFAULT_STYLES[k], ...s[k] }) : cloneEffect(DEFAULT_STYLES[k]);
  }
  return out;
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

// 원본 알파 모양으로 "잘라낸"(source-in) 콘텐츠 캔버스를 만든다.
// content를 (0,0)에 그린 뒤 srcCanvas 알파로 클립 → 원본 실루엣 안쪽만 남는다.
// 그라디언트/패턴 오버레이가 레이어 픽셀 모양을 따르게 할 때 사용.
function clipToSilhouette(srcCanvas, drawContent) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = makeCanvas(w, h);
  const o = ctx2d(out);
  drawContent(o, w, h);                       // 콘텐츠(그라디언트/패턴 등)를 먼저 채움
  o.globalCompositeOperation = "destination-in";
  o.drawImage(srcCanvas, 0, 0);               // 원본 알파만 남김
  return out;
}

// "내부 실루엣"(원본 안쪽 가장자리에 나타날 그림자/광선용) 생성.
// 바깥(원본 밖)을 효과색으로 채운 캔버스를 만들고 → spread 침식 → blur → 원본 알파로 클립.
// edge 모드: 가장자리에서 안쪽으로 스며드는 형태(내부 그림자/내부 광선 edge).
//   buildInnerLayer(src, {color,opacity,blur,spread}, dx,dy)
//   dx,dy: 내부 그림자의 오프셋(내부 광선은 0). 반전 실루엣을 오프셋해 한쪽으로 치우치게 한다.
function buildInnerEdgeLayer(srcCanvas, { color, opacity, blur, spread }, dx = 0, dy = 0) {
  const rgb = hexToRgb(color);
  const w = srcCanvas.width, h = srcCanvas.height;

  // 1) 반전 실루엣(원본 밖=불투명, 안=투명)을 효과색으로 만든다.
  //    erodeAlpha(src, spread)로 안쪽을 spread만큼 깎으면, 반전 시 가장자리에서 더 두꺼워진다.
  const eroded = (spread && spread > 0) ? erodeAlpha(srcCanvas, spread) : srcCanvas;
  const invSil = makeCanvas(w, h);
  const iv = ctx2d(invSil);
  iv.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  iv.fillRect(0, 0, w, h);                     // 전체를 효과색으로
  iv.globalCompositeOperation = "destination-out";
  iv.drawImage(eroded, dx, dy);               // 원본(또는 침식본)을 오프셋해 도려냄 → 바깥만 색
  iv.globalCompositeOperation = "source-over";

  // 2) 블러로 가장자리를 부드럽게
  const blurred = blurCanvas(invSil, blur || 0);

  // 3) 원본 알파로 클립 → 안쪽 가장자리에만 효과가 보이게
  const out = makeCanvas(w, h);
  const o = ctx2d(out);
  o.drawImage(blurred, 0, 0);
  o.globalCompositeOperation = "destination-in";
  o.drawImage(srcCanvas, 0, 0);
  return { canvas: out, opacity: clamp01(opacity) };
}

// "중앙 발광" 내부 광선(source=center): 중앙이 밝고 가장자리로 갈수록 옅어진다.
// 원본을 침식(erode)해 만든 "안쪽 코어"를 효과색으로 칠하고 블러 → 원본 알파로 클립한 뒤,
// 원본 알파에서 코어를 빼는 게 아니라 그대로 사용(중앙 채움). blur가 클수록 부드럽다.
function buildInnerCenterLayer(srcCanvas, { color, opacity, blur, spread }) {
  const rgb = hexToRgb(color);
  const w = srcCanvas.width, h = srcCanvas.height;
  // 코어 = 원본을 (blur+spread)만큼 침식한 실루엣 → 색 입힘
  const core = erodeAlpha(srcCanvas, Math.max(1, (blur || 0) + (spread || 0)));
  const tinted = tintSilhouette(core, rgb.r, rgb.g, rgb.b);
  const blurred = blurCanvas(tinted, blur || 0);
  const out = makeCanvas(w, h);
  const o = ctx2d(out);
  o.drawImage(blurred, 0, 0);
  o.globalCompositeOperation = "destination-in";
  o.drawImage(srcCanvas, 0, 0);               // 원본 알파 밖으로 새지 않게 클립
  return { canvas: out, opacity: clamp01(opacity) };
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

  destCtx.save();
  destCtx.globalCompositeOperation = nativeGco(s.blendMode || "multiply");
  destCtx.drawImage(tmp, 0, 0);
  destCtx.restore();
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
  destCtx.save();
  destCtx.globalCompositeOperation = nativeGco(s.blendMode || "screen");
  destCtx.drawImage(tmp, 0, 0);
  destCtx.restore();
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

// Inner Shadow: 내부 실루엣을 오프셋 방향으로 흘려 안쪽 가장자리에 그림자를 만든다.
// 빛 방향(angle)의 "반대쪽" 안쪽 가장자리가 어두워지도록 dx,dy로 반전 실루엣을 민다.
function drawInnerShadow(destCtx, srcCanvas, s) {
  const { dx, dy } = shadowOffset(s.distance || 0, s.angle || 0);
  // 내부 그림자는 빛 방향의 반대쪽 가장자리에 생기므로 오프셋을 그대로(반전 실루엣을 dx,dy로 민다)
  const { canvas, opacity } = buildInnerEdgeLayer(srcCanvas, s, dx, dy);
  destCtx.save();
  destCtx.globalAlpha = opacity;
  destCtx.globalCompositeOperation = nativeGco(s.blendMode || "multiply");
  destCtx.drawImage(canvas, 0, 0);
  destCtx.restore();
}

// Inner Glow: 안쪽 가장자리(edge) 또는 중앙(center)에서 발광.
function drawInnerGlow(destCtx, srcCanvas, s) {
  const { canvas, opacity } = (s.source === "center")
    ? buildInnerCenterLayer(srcCanvas, s)
    : buildInnerEdgeLayer(srcCanvas, s, 0, 0); // edge: 오프셋 없이 사방 가장자리
  destCtx.save();
  destCtx.globalAlpha = opacity;
  destCtx.globalCompositeOperation = nativeGco(s.blendMode || "screen");
  destCtx.drawImage(canvas, 0, 0);
  destCtx.restore();
}

// Satin(새틴): 실루엣을 두 방향으로 오프셋·반전 합성해 내부에 광택 무늬를 만든다.
// 포토샵 새틴 근사: 실루엣을 +offset, -offset 두 번 그린 뒤 XOR(겹침 제거)하고,
// 블러 → (옵션)반전 → 원본 알파로 클립. 부드러운 곡선형 광택이 생긴다.
function drawSatin(destCtx, srcCanvas, s) {
  const rgb = hexToRgb(s.color);
  const w = srcCanvas.width, h = srcCanvas.height;
  const { dx, dy } = shadowOffset(s.distance || 0, s.angle || 0);

  // 1) 실루엣을 +오프셋과 -오프셋 위치에 그리고 겹친 영역을 빼서(XOR 근사) 무늬 알파를 만든다.
  const sil = tintSilhouette(srcCanvas, rgb.r, rgb.g, rgb.b);
  const pat = makeCanvas(w, h);
  const p = ctx2d(pat);
  p.drawImage(sil, dx, dy);                    // +방향
  p.globalCompositeOperation = "xor";          // 겹침 제거 → 곡선 무늬
  p.drawImage(sil, -dx, -dy);                  // -방향
  p.globalCompositeOperation = "source-over";

  // 2) 블러로 부드럽게
  let shaped = blurCanvas(pat, s.blur || 0);

  // 3) 반전(invert): 무늬의 명암을 뒤집어 광택 위치를 바꾼다(알파 반전).
  if (s.invert) {
    const inv = makeCanvas(w, h);
    const ic = ctx2d(inv);
    ic.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ic.fillRect(0, 0, w, h);
    ic.globalCompositeOperation = "destination-out";
    ic.drawImage(shaped, 0, 0);                // 무늬 부분을 도려냄 → 반전
    ic.globalCompositeOperation = "source-over";
    shaped = inv;
  }

  // 4) 원본 알파로 클립(밖으로 안 새게)
  const clipped = makeCanvas(w, h);
  const cc = ctx2d(clipped);
  cc.drawImage(shaped, 0, 0);
  cc.globalCompositeOperation = "destination-in";
  cc.drawImage(srcCanvas, 0, 0);

  destCtx.save();
  destCtx.globalAlpha = clamp01(s.opacity);
  destCtx.globalCompositeOperation = nativeGco(s.blendMode || "multiply");
  destCtx.drawImage(clipped, 0, 0);
  destCtx.restore();
}

// Gradient Overlay: 그라디언트를 원본 알파 모양으로 클립해 올린다.
// style: linear(선형) / radial(원형). angle(도), scale(%), reverse(색 순서 반전).
function drawGradientOverlay(destCtx, srcCanvas, s) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const colors = (Array.isArray(s.colors) && s.colors.length >= 2) ? s.colors : ["#000000", "#ffffff"];
  const stops = s.reverse ? colors.slice().reverse() : colors;
  const scale = Math.max(1, (s.scale ?? 100)) / 100;

  const filled = clipToSilhouette(srcCanvas, (o) => {
    let grad;
    if (s.style === "radial") {
      const cx = w / 2, cy = h / 2;
      const r = Math.max(1, (Math.max(w, h) / 2) * scale);
      grad = o.createRadialGradient(cx, cy, 0, cx, cy, r);
    } else {
      // 선형: 각도 방향으로 캔버스 중앙을 지나는 선. scale로 길이 조절.
      const a = (s.angle || 0) * Math.PI / 180;
      const cx = w / 2, cy = h / 2;
      const len = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2 * scale;
      const dx = Math.cos(a) * len, dy = -Math.sin(a) * len; // 화면 y 반전
      grad = o.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    }
    const n = stops.length;
    stops.forEach((c, i) => grad.addColorStop(n === 1 ? 0 : i / (n - 1), c));
    o.fillStyle = grad;
    o.fillRect(0, 0, w, h);
  });

  destCtx.save();
  destCtx.globalAlpha = clamp01(s.opacity);
  destCtx.globalCompositeOperation = nativeGco(s.blendMode);
  destCtx.drawImage(filled, 0, 0);
  destCtx.restore();
}

// Pattern Overlay: 반복 패턴을 원본 알파 모양으로 클립해 올린다.
// patternId로 patterns.js에서 타일 캔버스를 받아 createPattern(repeat)로 채운다.
function drawPatternOverlay(destCtx, srcCanvas, s) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const scale = Math.max(1, (s.scale ?? 100)) / 100;
  const tile = getPattern(s.patternId, scale);
  if (!tile) return; // 알 수 없는 패턴이면 건너뜀

  const filled = clipToSilhouette(srcCanvas, (o) => {
    const pat = o.createPattern(tile, "repeat");
    if (!pat) return;
    o.fillStyle = pat;
    o.fillRect(0, 0, w, h);
  });

  destCtx.save();
  destCtx.globalAlpha = clamp01(s.opacity);
  destCtx.globalCompositeOperation = nativeGco(s.blendMode);
  destCtx.drawImage(filled, 0, 0);
  destCtx.restore();
}

// Bevel/Emboss(경사와 엠보스): 높이맵(알파를 블러)의 기울기에 빛 벡터를 내적해
// 하이라이트/섀도를 계산한다(법선 근사 lambert). 결과는 원본 알파로 클립.
//   style: inner(내부 경사) / outer(외부 경사) / emboss(엠보스, 근사: inner와 유사)
//   size: 경사 폭(블러 반경) / depth: 강도(0~1000%) / angle·altitude: 빛 방향/고도
function drawBevel(destCtx, srcCanvas, s) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const size = Math.max(1, Math.round(s.size || 1));
  const depth = Math.max(0, (s.depth ?? 100)) / 100;   // 0~10
  const azimuth = (s.angle || 0) * Math.PI / 180;
  const altitude = (s.altitude ?? 30) * Math.PI / 180;

  // 1) 높이맵 = 원본 알파를 블러한 그레이(부드러운 경사). getImageData로 알파 추출.
  const hmapCanvas = blurCanvas(tintSilhouette(srcCanvas, 255, 255, 255), size);
  const hctx = ctx2d(hmapCanvas);
  const hd = hctx.getImageData(0, 0, w, h).data;
  // 높이값(0~1): 블러된 흰 실루엣의 알파
  const H = new Float32Array(w * h);
  for (let p = 0, i = 3; p < H.length; p++, i += 4) H[p] = hd[i] / 255;

  // 2) 빛 벡터(azimuth/altitude → 3D 단위벡터)
  const lx = Math.cos(altitude) * Math.cos(azimuth);
  const ly = Math.cos(altitude) * Math.sin(azimuth);
  const lz = Math.sin(altitude);

  // 3) 각 픽셀 법선 = (-dH/dx, -dH/dy, 1/depth) 정규화 → 빛과 내적
  const hi = hexToRgb(s.highlight);
  const sh = hexToRgb(s.shadow);
  const hiOp = clamp01(s.highlightOpacity);
  const shOp = clamp01(s.shadowOpacity);
  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  const img = octx.createImageData(w, h);
  const od = img.data;
  const zScale = depth > 0 ? (1 / depth) : 8; // depth 클수록 법선이 더 기울어짐(요철 강조)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      // 중앙차분(가장자리는 클램프)
      const xl = x > 0 ? H[idx - 1] : H[idx];
      const xr = x < w - 1 ? H[idx + 1] : H[idx];
      const yt = y > 0 ? H[idx - w] : H[idx];
      const yb = y < h - 1 ? H[idx + w] : H[idx];
      const nx = (xl - xr);
      const ny = (yt - yb);
      const nz = zScale;
      const inv = 1 / Math.hypot(nx, ny, nz);
      // 빛과의 내적(lambert). -1~1
      const dot = (nx * inv) * lx + (ny * inv) * ly + (nz * inv) * lz;
      const i4 = idx * 4;
      if (dot >= 0) {
        // 밝은 면 → 하이라이트
        const a = Math.min(1, dot) * hiOp;
        od[i4] = hi.r; od[i4 + 1] = hi.g; od[i4 + 2] = hi.b; od[i4 + 3] = Math.round(a * 255);
      } else {
        // 어두운 면 → 섀도
        const a = Math.min(1, -dot) * shOp;
        od[i4] = sh.r; od[i4 + 1] = sh.g; od[i4 + 2] = sh.b; od[i4 + 3] = Math.round(a * 255);
      }
    }
  }
  octx.putImageData(img, 0, 0);

  // 4) 원본 알파로 클립(inner/emboss는 내부에만). outer는 바깥쪽도 허용하려면
  //    팽창 알파로 클립하지만, 단순화를 위해 모든 스타일을 원본 알파로 클립한다.
  const clipped = makeCanvas(w, h);
  const cc = ctx2d(clipped);
  cc.drawImage(out, 0, 0);
  cc.globalCompositeOperation = "destination-in";
  if (s.style === "outer") {
    // 외부 경사: 약간 팽창한 알파로 클립해 가장자리 바깥까지 음영이 보이게
    cc.drawImage(dilateAlpha(srcCanvas, size), 0, 0);
  } else {
    cc.drawImage(srcCanvas, 0, 0);
  }

  destCtx.save();
  destCtx.globalAlpha = 1;
  destCtx.drawImage(clipped, 0, 0);
  destCtx.restore();
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
  const on = (k) => styles[k] && styles[k].enabled; // 효과 활성 헬퍼

  // ── 원본 아래(밖으로 퍼지는 효과) ──
  // 1) 그림자(맨 아래)
  if (on("dropShadow")) drawDropShadow(o, srcCanvas, styles.dropShadow);
  // 2) 외부 광선
  if (on("outerGlow")) drawOuterGlow(o, srcCanvas, styles.outerGlow);

  // 3) 원본 레이어
  o.drawImage(srcCanvas, 0, 0);

  // ── 원본 위(안쪽 채움/오버레이, 모두 원본 알파로 클립) ──
  // 4) 색상 → 그라디언트 → 패턴 오버레이 (포토샵 순서)
  if (on("colorOverlay")) drawColorOverlay(o, srcCanvas, styles.colorOverlay);
  if (on("gradientOverlay")) drawGradientOverlay(o, srcCanvas, styles.gradientOverlay);
  if (on("patternOverlay")) drawPatternOverlay(o, srcCanvas, styles.patternOverlay);
  // 5) 새틴
  if (on("satin")) drawSatin(o, srcCanvas, styles.satin);
  // 6) 내부 그림자 → 내부 광선
  if (on("innerShadow")) drawInnerShadow(o, srcCanvas, styles.innerShadow);
  if (on("innerGlow")) drawInnerGlow(o, srcCanvas, styles.innerGlow);
  // 7) 경사와 엠보스
  if (on("bevel")) drawBevel(o, srcCanvas, styles.bevel);
  // 8) 선(맨 위)
  if (on("stroke")) drawStroke(o, srcCanvas, styles.stroke);

  return out;
}
