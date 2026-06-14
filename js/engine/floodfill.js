// floodfill.js — 스캔라인 기반 flood fill (재귀 없이 명시적 스택 사용 → 스택오버플로 방지)
// 시작점과 색이 비슷한(허용오차 이내) 영역을 찾아 마스크(Uint8Array, 255=선택)로 반환한다.
// 페인트 버킷과 매직완드가 공유한다.

// d: ImageData.data, W/H: 크기, sx/sy: 시작점, tolerance: 0~255, contiguous: 인접만(true)/전체(false)
export function floodFill(d, W, H, sx, sy, tolerance, contiguous = true) {
  const mask = new Uint8Array(W * H);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return { mask, bounds: null };

  const si = (sy * W + sx) * 4;
  const sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
  const tol = tolerance;

  const match = (idx) => {
    const i = idx * 4;
    return Math.abs(d[i] - sr) <= tol &&
           Math.abs(d[i + 1] - sg) <= tol &&
           Math.abs(d[i + 2] - sb) <= tol &&
           Math.abs(d[i + 3] - sa) <= tol;
  };

  let minX = W, minY = H, maxX = -1, maxY = -1;
  const mark = (idx, x, y) => {
    mask[idx] = 255;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };

  if (!contiguous) {
    // 전역 모드: 화면 전체에서 색이 맞는 픽셀을 모두 선택
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (match(idx)) mark(idx, x, y);
      }
    }
  } else {
    // 인접 모드: 스캔라인 스택
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      let lx = x;
      while (lx >= 0 && !mask[y * W + lx] && match(y * W + lx)) lx--;
      lx++;
      let rx = x;
      while (rx < W && !mask[y * W + rx] && match(y * W + rx)) rx++;
      rx--;
      for (let i = lx; i <= rx; i++) mark(y * W + i, i, y);
      // 위/아래 줄에서 이어지는 영역을 스택에 추가
      for (let i = lx; i <= rx; i++) {
        if (y > 0) { const u = (y - 1) * W + i; if (!mask[u] && match(u)) stack.push(i, y - 1); }
        if (y < H - 1) { const dn = (y + 1) * W + i; if (!mask[dn] && match(dn)) stack.push(i, y + 1); }
      }
    }
  }

  if (maxX < 0) return { mask, bounds: null };
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}
