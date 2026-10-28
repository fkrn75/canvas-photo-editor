// resample.js — 이미지 크기 변경(리샘플링) 순수 함수. ImageData → 새 ImageData.
//
// [방식] Photoshop 이미지 크기 다이얼로그의 리샘플 옵션을 따른다.
//   nearest(최단 입점) / bilinear(쌍선형) / bicubic(쌍입방) / bicubicSmoother(쌍입방 부드럽게)
//   / bicubicSharper(쌍입방 선명하게) / lanczos3
//
// [알고리즘] 분리형(separable) 필터. 각 축마다 "출력 좌표 → (원본 인덱스, 가중치) 목록" 표를 미리 만든다.
//   축소할 때는 필터 폭을 배율만큼 넓혀(지원 반경 × 1/scale) 원본 픽셀을 고루 평균한다 → 앨리어싱 방지.
//   메모리 절약을 위해 "출력 한 행씩": 세로 가중합으로 원본 폭 1행(Float32)을 만든 뒤 가로 가중합으로 출력한다.
//   (4000×3000 전체를 Float32 중간 버퍼로 잡으면 수백 MB가 되므로 행 버퍼 1개만 쓴다)
//
// [알파] 프리멀티플라이드(색×알파)로 누적한 뒤 마지막에 나눈다 → 투명 경계에 검은/엉뚱한 색 번짐이 없다.
// [가장자리] 원본 범위를 벗어난 탭은 가장자리 픽셀로 고정(clamp)한다.
// [정규화] 가중치 합을 1로 정규화 → 단색 이미지는 어떤 방식으로도 같은 단색을 유지한다.

// 다이얼로그용 목록: [값, 표시 이름]
export const RESAMPLE_METHODS = [
  ["nearest", "최단 입점(가장자리 유지)"],
  ["bilinear", "쌍선형"],
  ["bicubic", "쌍입방(부드러운 그라디언트)"],
  ["bicubicSmoother", "쌍입방 부드럽게(확대용)"],
  ["bicubicSharper", "쌍입방 선명하게(축소용)"],
  ["lanczos3", "Lanczos3"],
];

// Keys 큐빅(a: -0.5=Catmull-Rom 표준, 더 음수일수록 선명)
function keysCubic(a) {
  return (x) => {
    x = Math.abs(x);
    if (x < 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
    if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
    return 0;
  };
}

// Mitchell-Netravali(B, C) — B=C=1/3 은 링잉이 적고 부드럽다(확대용 "부드럽게").
function mitchell(B, C) {
  return (x) => {
    x = Math.abs(x);
    if (x < 1) return ((12 - 9 * B - 6 * C) * x * x * x + (-18 + 12 * B + 6 * C) * x * x + (6 - 2 * B)) / 6;
    if (x < 2) return ((-B - 6 * C) * x * x * x + (6 * B + 30 * C) * x * x + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
    return 0;
  };
}

function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

// 방식별 커널과 지원 반경
const KERNELS = {
  bilinear: { support: 1, fn: (x) => { x = Math.abs(x); return x < 1 ? 1 - x : 0; } },
  bicubic: { support: 2, fn: keysCubic(-0.5) },
  bicubicSmoother: { support: 2, fn: mitchell(1 / 3, 1 / 3) },
  bicubicSharper: { support: 2, fn: keysCubic(-0.75) },
  lanczos3: { support: 3, fn: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

// 한 축의 가중치 표. 반환: { start: Int32Array(dst+1), idx: Int32Array, w: Float32Array }
// 출력 i 의 탭은 idx/w 의 [start[i], start[i+1]) 구간.
export function buildWeights(srcLen, dstLen, kernel) {
  const scale = dstLen / srcLen;
  const fscale = scale < 1 ? 1 / scale : 1; // 축소 시 필터 폭 확장
  const sup = kernel.support * fscale;
  const start = new Int32Array(dstLen + 1);
  const idx = [];
  const w = [];
  for (let i = 0; i < dstLen; i++) {
    start[i] = idx.length;
    const center = (i + 0.5) / scale - 0.5; // 출력 픽셀 중심의 원본 좌표
    const lo = Math.ceil(center - sup);
    const hi = Math.floor(center + sup);
    let sum = 0;
    const s0 = idx.length;
    for (let j = lo; j <= hi; j++) {
      const wt = kernel.fn((j - center) / fscale);
      if (wt === 0) continue;
      idx.push(j < 0 ? 0 : j >= srcLen ? srcLen - 1 : j);
      w.push(wt);
      sum += wt;
    }
    if (idx.length === s0 || Math.abs(sum) < 1e-12) {
      // 탭이 없으면(극단적 경우) 최근접 픽셀 1개
      idx.length = s0; w.length = s0;
      const n = Math.min(srcLen - 1, Math.max(0, Math.round(center)));
      idx.push(n); w.push(1);
    } else {
      for (let k = s0; k < w.length; k++) w[k] /= sum;
    }
  }
  start[dstLen] = idx.length;
  return { start, idx: Int32Array.from(idx), w: Float32Array.from(w) };
}

// 결과 ImageData 생성(브라우저/테스트 폴리필 공통)
function makeImageData(data, w, h) {
  return new ImageData(data, w, h);
}

// 최단 입점: 보간 없이 가장 가까운 원본 픽셀을 복사한다(픽셀 아트 확대용).
function resampleNearest(src, dw, dh) {
  const sw = src.width, sh = src.height, s = src.data;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xmap = new Int32Array(dw);
  for (let x = 0; x < dw; x++) xmap[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    const srow = sy * sw;
    let o = y * dw * 4;
    for (let x = 0; x < dw; x++, o += 4) {
      const i = (srow + xmap[x]) * 4;
      out[o] = s[i]; out[o + 1] = s[i + 1]; out[o + 2] = s[i + 2]; out[o + 3] = s[i + 3];
    }
  }
  return makeImageData(out, dw, dh);
}

// 메인 진입점. src: ImageData, dw/dh: 출력 크기(정수 ≥1), method: RESAMPLE_METHODS 값.
export function resample(src, dw, dh, method = "bicubic") {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const sw = src.width, sh = src.height;
  // 항등: 같은 크기면 정확한 복사본(필터에 따라 미세하게 흐려지는 것을 막는다)
  if (dw === sw && dh === sh) return makeImageData(new Uint8ClampedArray(src.data), sw, sh);
  if (method === "nearest") return resampleNearest(src, dw, dh);
  const kernel = KERNELS[method] || KERNELS.bicubic;

  const H = buildWeights(sw, dw, kernel);
  const V = buildWeights(sh, dh, kernel);
  const s = src.data;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const row = new Float32Array(sw * 4); // 세로 가중합 결과(프리멀티플라이드) 1행

  for (let y = 0; y < dh; y++) {
    // 1) 세로: 탭 행들을 가중합해 원본 폭 1행을 만든다(색은 알파를 곱해 누적)
    row.fill(0);
    for (let k = V.start[y]; k < V.start[y + 1]; k++) {
      const wy = V.w[k];
      let i = V.idx[k] * sw * 4;
      for (let x = 0, r = 0; x < sw; x++, i += 4, r += 4) {
        const a = s[i + 3];
        if (a === 0) continue; // 투명 픽셀은 기여 0(프리멀티플라이드)
        const wa = wy * a / 255;
        row[r] += s[i] * wa;
        row[r + 1] += s[i + 1] * wa;
        row[r + 2] += s[i + 2] * wa;
        row[r + 3] += wy * a;
      }
    }
    // 2) 가로: 행 버퍼에서 출력 픽셀로 가중합 후 알파로 나눠 되돌린다
    let o = y * dw * 4;
    for (let x = 0; x < dw; x++, o += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = H.start[x]; k < H.start[x + 1]; k++) {
        const wx = H.w[k];
        const j = H.idx[k] * 4;
        r += row[j] * wx; g += row[j + 1] * wx; b += row[j + 2] * wx; a += row[j + 3] * wx;
      }
      if (a <= 0.5) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      const inv = 255 / a;
      out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv; out[o + 3] = a;
    }
  }
  return makeImageData(out, dw, dh);
}
