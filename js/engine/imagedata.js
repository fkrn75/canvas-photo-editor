// imagedata.js — ImageData/경계상자(bounding box) 유틸 (순수 함수)

// 빈 경계 누적기. expandBounds로 점을 누적한 뒤 boundsToBox로 변환한다.
export function newBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

// (x,y)를 포함하도록 경계를 확장. r(반경)을 주면 브러시 두께를 반영.
export function expandBounds(b, x, y, r = 0) {
  if (x - r < b.minX) b.minX = x - r;
  if (y - r < b.minY) b.minY = y - r;
  if (x + r > b.maxX) b.maxX = x + r;
  if (y + r > b.maxY) b.maxY = y + r;
}

// 경계 → {x,y,w,h}. 누적된 점이 없으면 null.
export function boundsToBox(b) {
  if (b.maxX < b.minX) return null;
  const x = Math.floor(b.minX);
  const y = Math.floor(b.minY);
  return { x, y, w: Math.ceil(b.maxX) - x, h: Math.ceil(b.maxY) - y };
}

// box를 [0,0,W,H] 범위로 자른 정수 박스. 범위 밖이면 null.
export function clampBox(box, W, H) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(W, Math.ceil(box.x + box.w));
  const y2 = Math.min(H, Math.ceil(box.y + box.h));
  const w = x2 - x;
  const h = y2 - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

// ImageData에서 box 영역만 잘라 새 ImageData 생성
export function cropImageData(src, box) {
  const { x, y, w, h } = box;
  const out = new ImageData(w, h);
  const sd = src.data, od = out.data, sw = src.width;
  for (let row = 0; row < h; row++) {
    const sStart = ((y + row) * sw + x) * 4;
    od.set(sd.subarray(sStart, sStart + w * 4), row * w * 4);
  }
  return out;
}
