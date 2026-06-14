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
