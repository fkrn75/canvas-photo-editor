// image-mode.js — 이미지 모드 변환 엔진(순수 함수, DOM 무관).
//
// 포토샵의 "이미지 > 모드"에 해당. 모두 ImageData(8비트 RGBA)를 in-place 수정하며,
// 알파는 보존한다(픽셀의 존재 여부는 모드와 무관하므로). 휘도 가중치는
// adjustments.js / channel-view.js 와 동일한 (0.299/0.587/0.114) 를 쓴다.
//
// 제공 모드:
//   - grayscale : 가중 평균으로 회색조화(R=G=B=Y). adjustments.grayscale 과 동일 결과지만,
//                 이 파일은 인덱스/비트맵과 함께 "모드 변환" 클러스터로 묶어 둔다.
//   - indexed   : 색상 양자화(median-cut)로 N색 팔레트를 만들고 각 픽셀을 가장 가까운
//                 팔레트 색으로 매핑(옵션: Floyd–Steinberg 디더링).
//   - bitmap    : 1비트(검/흰) 2치화(임계값 또는 디더링).
//
// 인덱스 변환은 (1) 팔레트 생성 → (2) 매핑 두 단계로 분리해 Color Table 에서
// 팔레트만 따로 보거나 편집한 뒤 다시 매핑할 수 있게 한다.

// 휘도 계수(포토샵/adjustments.js/channel-view.js와 동일)
const LR = 0.299, LG = 0.587, LB = 0.114;

// 0~255 클램프(라운드)
function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// ── Grayscale ────────────────────────────────────────────────────────────────
// 전 픽셀을 가중 평균 휘도로 회색조화한다(알파 보존). in-place.
export function toGrayscale(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = (LR * d[i] + LG * d[i + 1] + LB * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return img;
}

// ── Bitmap(1비트) ────────────────────────────────────────────────────────────
// 휘도 기준 2치화. method:
//   "threshold" : level(1~255) 이상이면 흰, 미만이면 검.
//   "diffusion" : Floyd–Steinberg 오차확산 디더링(흑/백 2색).
// 알파 보존. in-place. (디더링은 width 가 필요하므로 img.width 사용)
export function toBitmap(img, { method = "threshold", level = 128 } = {}) {
  const d = img.data;
  if (method === "diffusion") {
    const w = img.width, h = img.height;
    // 오차확산용 휘도 버퍼(실수). 가장자리 밖 확산은 무시.
    const buf = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      buf[p] = LR * d[i] + LG * d[i + 1] + LB * d[i + 2];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const old = buf[p];
        const nv = old < 128 ? 0 : 255;     // 가장 가까운 흑/백
        const err = old - nv;
        buf[p] = nv;
        // Floyd–Steinberg 가중치(7/16, 3/16, 5/16, 1/16)
        if (x + 1 < w) buf[p + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) buf[p + w - 1] += err * 3 / 16;
          buf[p + w] += err * 5 / 16;
          if (x + 1 < w) buf[p + w + 1] += err * 1 / 16;
        }
        const i = p * 4;
        d[i] = d[i + 1] = d[i + 2] = buf[p];
      }
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const v = (LR * d[i] + LG * d[i + 1] + LB * d[i + 2]) >= level ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return img;
}

// ── Indexed Color: 팔레트 생성(median-cut) ───────────────────────────────────
// img(또는 ImageData)에서 maxColors(2~256) 개의 대표색 팔레트를 만든다.
// 반환: [[r,g,b], ...] (길이 ≤ maxColors).
//
// median-cut: 모든(샘플) 픽셀을 하나의 박스로 시작 → 가장 색 범위가 넓은 축으로
// 박스를 중앙값에서 분할하기를 박스 수가 maxColors 가 될 때까지 반복 → 각 박스의
// 평균색을 대표색으로 사용. 투명(알파 0) 픽셀은 색 통계에서 제외한다.
export function buildPalette(img, maxColors = 256) {
  const n = Math.max(2, Math.min(256, maxColors | 0));
  const d = img.data;

  // 픽셀 수가 많으면 샘플링으로 가속(최대 ~32k 샘플). 알파>0 만 수집.
  const total = d.length / 4;
  const step = Math.max(1, Math.floor(total / 32768));
  const pixels = []; // [r,g,b]
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (d[i + 3] === 0) continue;          // 투명 제외
    pixels.push([d[i], d[i + 1], d[i + 2]]);
  }
  // 색이 거의 없으면(전부 투명 등) 흑백 2색이라도 반환
  if (pixels.length === 0) return [[0, 0, 0], [255, 255, 255]];

  // 박스: { px:[[r,g,b]...] }. 한 색 범위가 가장 넓은 박스를 골라 분할.
  let boxes = [{ px: pixels }];
  while (boxes.length < n) {
    // 분할 가능한(픽셀 2개 이상) 박스 중 색 범위가 가장 큰 것을 고른다.
    let target = -1, targetRange = -1, targetAxis = 0;
    for (let b = 0; b < boxes.length; b++) {
      const px = boxes[b].px;
      if (px.length < 2) continue;
      const { range, axis } = colorRange(px);
      if (range > targetRange) { targetRange = range; target = b; targetAxis = axis; }
    }
    if (target < 0) break;                  // 더는 못 쪼갬

    // target 박스를 targetAxis 축의 중앙값에서 두 개로 분할
    const px = boxes[target].px;
    px.sort((a, b) => a[targetAxis] - b[targetAxis]);
    const mid = px.length >> 1;
    const lo = px.slice(0, mid);
    const hi = px.slice(mid);
    boxes.splice(target, 1, { px: lo }, { px: hi });
  }

  // 각 박스의 평균색을 대표색으로
  const palette = [];
  for (const box of boxes) {
    const px = box.px;
    if (px.length === 0) continue;
    let r = 0, g = 0, b = 0;
    for (const c of px) { r += c[0]; g += c[1]; b += c[2]; }
    palette.push([clamp8(r / px.length), clamp8(g / px.length), clamp8(b / px.length)]);
  }
  return palette.length ? palette : [[0, 0, 0], [255, 255, 255]];
}

// 박스(픽셀 배열)의 R/G/B 중 범위가 가장 넓은 축과 그 범위를 구한다.
function colorRange(px) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const c of px) {
    if (c[0] < rMin) rMin = c[0]; if (c[0] > rMax) rMax = c[0];
    if (c[1] < gMin) gMin = c[1]; if (c[1] > gMax) gMax = c[1];
    if (c[2] < bMin) bMin = c[2]; if (c[2] > bMax) bMax = c[2];
  }
  const rr = rMax - rMin, gr = gMax - gMin, br = bMax - bMin;
  // 시각 가중치(녹색에 민감)를 약간 반영해 축 선택
  const rw = rr * 1.0, gw = gr * 1.2, bw = br * 0.8;
  if (gw >= rw && gw >= bw) return { range: gr, axis: 1 };
  if (rw >= bw) return { range: rr, axis: 0 };
  return { range: br, axis: 2 };
}

// ── Indexed Color: 팔레트로 매핑 ─────────────────────────────────────────────
// img 의 각 픽셀을 palette 의 가장 가까운 색으로 치환(알파 보존). in-place.
//   palette : [[r,g,b], ...]
//   dither  : true 면 Floyd–Steinberg 오차확산(컬러).
export function applyPalette(img, palette, { dither = false } = {}) {
  const d = img.data;
  if (!palette || palette.length === 0) return img;

  // 빠른 최근접 탐색을 위한 보조: 팔레트가 작으므로 선형 탐색이지만,
  // 같은 색 반복 조회를 캐시(5비트 해시)로 가속.
  const cache = new Int16Array(32768).fill(-1); // index into palette, -1=미계산
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = cache[key];
    if (c >= 0) return c;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) { bestD = dist; best = k; }
    }
    cache[key] = best;
    return best;
  };

  if (dither) {
    const w = img.width, h = img.height;
    // 채널별 오차 버퍼(실수)
    const er = new Float32Array(w * h);
    const eg = new Float32Array(w * h);
    const eb = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        const r = clamp8(d[i] + er[p]);
        const g = clamp8(d[i + 1] + eg[p]);
        const b = clamp8(d[i + 2] + eb[p]);
        const k = nearest(r, g, b);
        const pc = palette[k];
        d[i] = pc[0]; d[i + 1] = pc[1]; d[i + 2] = pc[2];
        const dr = r - pc[0], dg = g - pc[1], db = b - pc[2];
        // Floyd–Steinberg 확산
        if (x + 1 < w) { er[p + 1] += dr * 7 / 16; eg[p + 1] += dg * 7 / 16; eb[p + 1] += db * 7 / 16; }
        if (y + 1 < h) {
          if (x > 0) { er[p + w - 1] += dr * 3 / 16; eg[p + w - 1] += dg * 3 / 16; eb[p + w - 1] += db * 3 / 16; }
          er[p + w] += dr * 5 / 16; eg[p + w] += dg * 5 / 16; eb[p + w] += db * 5 / 16;
          if (x + 1 < w) { er[p + w + 1] += dr * 1 / 16; eg[p + w + 1] += dg * 1 / 16; eb[p + w + 1] += db * 1 / 16; }
        }
      }
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const k = nearest(d[i], d[i + 1], d[i + 2]);
      const pc = palette[k];
      d[i] = pc[0]; d[i + 1] = pc[1]; d[i + 2] = pc[2];
    }
  }
  return img;
}

// ── Indexed Color: 팔레트 생성 + 매핑 한 번에 ────────────────────────────────
// 편의 함수. buildPalette → applyPalette 를 묶고 사용한 팔레트를 함께 반환한다.
//   반환: { palette: [[r,g,b]...] }  (img 는 in-place 변환됨)
export function toIndexed(img, { colors = 256, dither = false } = {}) {
  const palette = buildPalette(img, colors);
  applyPalette(img, palette, { dither });
  return { palette };
}
