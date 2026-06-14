// filters.js — 이미지 필터 (모두 ImageData 제자리 수정)

import { stackBlur } from "./blur.js";

// 가우시안 블러 (StackBlur 근사)
export function gaussianBlur(img, radius = 4) {
  return stackBlur(img, radius);
}

// 3x3 컨벌루션. kernel은 길이 9 배열. 알파는 보존.
function convolve3(img, kernel) {
  const { data, width: w, height: h } = img;
  const src = new Uint8ClampedArray(data); // 입력 보존용 복사
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const wgt = kernel[(ky + 1) * 3 + (kx + 1)];
          if (wgt === 0) continue;
          const i = (yy * w + xx) * 4;
          r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt;
        }
      }
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; // 알파(o+3) 유지
    }
  }
  return img;
}

// 샤픈(언샤프). amount 0~3 권장.
export function sharpen(img, amount = 0.8) {
  const a = amount;
  return convolve3(img, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]);
}

// 노이즈 추가. amount: 강도(0~100), mono: 흑백 노이즈 여부
export function addNoise(img, amount = 24, mono = true) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = (Math.random() - 0.5) * 2 * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += (Math.random() - 0.5) * 2 * amount;
      d[i + 1] += (Math.random() - 0.5) * 2 * amount;
      d[i + 2] += (Math.random() - 0.5) * 2 * amount;
    }
  }
  return img;
}

// 세피아(갈색조)
export function sepia(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
    d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
  }
  return img;
}

// 엠보스(부조 효과)
export function emboss(img) {
  return convolve3(img, [-2, -1, 0, -1, 1, 1, 0, 1, 2]);
}

// ── 언샤프 마스크 ──
// 원본에서 가우시안 블러본을 빼서 만든 고주파(디테일)를 amount만큼 가산해 선명도를 높인다.
// amount: 강도(%, 0~500). radius: 블러 반경(px). threshold: 이 차이 이하인 픽셀은 건드리지 않음(잡티 방지, 0~255).
export function unsharpMask(img, amount = 50, radius = 2, threshold = 0) {
  const w = img.width, h = img.height;
  const src = new Uint8ClampedArray(img.data); // 원본 보존
  // 블러본은 별도 ImageData에서 계산(stackBlur은 제자리 동작이므로 복사본 사용)
  const blurImg = new ImageData(new Uint8ClampedArray(img.data), w, h);
  stackBlur(blurImg, Math.round(radius));
  const blur = blurImg.data;
  const amt = amount / 100;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = src[i + c];
      const diff = o - blur[i + c]; // 고주파 성분
      if (Math.abs(diff) < threshold) { d[i + c] = o; continue; } // 임계값 미만은 보존
      d[i + c] = o + diff * amt;
    }
    // 알파(i+3)는 src 그대로 유지
  }
  return img;
}

// ── 모션 블러 ──
// angle(도) 방향으로 distance(px)만큼 픽셀을 평균내 방향성 잔상을 만든다.
export function motionBlur(img, angle = 0, distance = 10) {
  const w = img.width, h = img.height;
  const src = new Uint8ClampedArray(img.data); // 입력 보존
  const d = img.data;
  const len = Math.max(1, Math.round(distance));
  const half = (len - 1) / 2;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad), dy = -Math.sin(rad); // 화면 좌표는 y가 아래로 증가하므로 부호 반전
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let t = 0; t < len; t++) {
        const off = t - half;
        const sx = Math.round(x + dx * off);
        const sy = Math.round(y + dy * off);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue; // 캔버스 밖은 평균에서 제외
        const i = (sy * w + sx) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
      }
      const o = (y * w + x) * 4;
      if (n > 0) { d[o] = r / n; d[o + 1] = g / n; d[o + 2] = b / n; d[o + 3] = a / n; }
    }
  }
  return img;
}

// ── 미디언 필터 ──
// (2*radius+1)² 이웃에서 채널별 중앙값을 취한다. 솔트앤페퍼 잡음 제거에 효과적. radius는 작게(1~3) 권장.
export function median(img, radius = 1) {
  const w = img.width, h = img.height;
  const r = Math.max(1, Math.round(radius));
  const src = new Uint8ClampedArray(img.data); // 입력 보존
  const d = img.data;
  const size = (2 * r + 1) * (2 * r + 1);
  const mid = size >> 1;
  const bufR = new Uint8Array(size), bufG = new Uint8Array(size), bufB = new Uint8Array(size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let ky = -r; ky <= r; ky++) {
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -r; kx <= r; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const i = (yy * w + xx) * 4;
          bufR[k] = src[i]; bufG[k] = src[i + 1]; bufB[k] = src[i + 2]; k++;
        }
      }
      // 작은 배열이라 기본 정렬로 중앙값 추출(채널별)
      bufR.sort(); bufG.sort(); bufB.sort();
      const o = (y * w + x) * 4;
      d[o] = bufR[mid]; d[o + 1] = bufG[mid]; d[o + 2] = bufB[mid]; // 알파는 유지
    }
  }
  return img;
}

// ── 모자이크 ──
// cell×cell 격자로 나눠 각 셀의 평균색으로 채운다.
export function mosaic(img, cell = 10) {
  const w = img.width, h = img.height;
  const c = Math.max(1, Math.round(cell));
  const d = img.data;
  const src = new Uint8ClampedArray(d); // 평균 계산용 입력 보존
  for (let by = 0; by < h; by += c) {
    for (let bx = 0; bx < w; bx += c) {
      const ex = Math.min(bx + c, w), ey = Math.min(by + c, h);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      r /= n; g /= n; b /= n; a /= n;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        }
      }
    }
  }
  return img;
}

// ── 엣지 검출(Find Edges) ──
// 소벨 연산자로 휘도 기울기 크기를 구해 엣지를 밝게, 평탄부를 어둡게 표시한다(원샷). 알파 유지.
export function findEdges(img) {
  const w = img.width, h = img.height;
  const src = img.data;
  // 휘도 그레이스케일 선계산(소벨은 휘도 한 채널에 적용)
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    gray[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
      const tl = gray[ym * w + xm], tc = gray[ym * w + x], tr = gray[ym * w + xp];
      const ml = gray[y * w + xm], mr = gray[y * w + xp];
      const bl = gray[yp * w + xm], bc = gray[yp * w + x], br = gray[yp * w + xp];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      let mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 255) mag = 255;
      const o = (y * w + x) * 4;
      d[o] = mag; d[o + 1] = mag; d[o + 2] = mag; // 알파 유지
    }
  }
  return img;
}

// ── 하이 패스 ──
// 원본에서 가우시안 블러(저주파)를 빼고 중간 그레이(128)를 더해 고주파만 남긴다.
// 결과는 회색 바탕에 엣지만 남으며, 오버레이/소프트라이트로 합성하면 선명화에 쓰인다. radius: 블러 반경(px).
export function highPass(img, radius = 3) {
  const w = img.width, h = img.height;
  const src = new Uint8ClampedArray(img.data); // 원본 보존
  const blurImg = new ImageData(new Uint8ClampedArray(img.data), w, h);
  stackBlur(blurImg, Math.round(radius));
  const blur = blurImg.data;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128 + (src[i] - blur[i]);
    d[i + 1] = 128 + (src[i + 1] - blur[i + 1]);
    d[i + 2] = 128 + (src[i + 2] - blur[i + 2]);
    // 알파(i+3) 유지
  }
  return img;
}
