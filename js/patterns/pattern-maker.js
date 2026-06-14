// pattern-maker.js — 패턴 메이커(Pattern Maker) 엔진.
//
// 현재 레이어(또는 선택 영역) 픽셀에서 "반복 가능한 타일"을 만들어낸다.
// 외부 라이브러리 없이 순수 Canvas 2D / ImageData 로만 동작한다(CSP 안전).
//
// [생성 흐름]
//   1) 소스 박스 결정: 선택 영역 bounds가 있으면 그 영역, 없으면 레이어 전체.
//   2) 타일 크기(w,h)와 오프셋(ox,oy)으로 소스에서 한 칸을 wrap 샘플링해 잘라낸다.
//      - 오프셋은 "어느 지점을 타일 좌상단으로 삼을지"를 정한다(소스를 토러스로 보고 순환).
//   3) 엣지 스무딩(seamless): 타일을 절반 시프트해 이음매를 가운데로 옮긴 뒤,
//      이음매 부근을 반대편 픽셀과 알파 블렌딩(크로스페이드)해 경계를 부드럽게 잇는다.
//      → 도장으로 반복 도포해도 격자무늬 이음매가 두드러지지 않는다.
//
// 반환물은 항상 "작은 오프스크린 canvas"다(patterns.js의 tile 규약과 동일: {id,name,tile}).
// 이 모듈은 app/state 를 직접 건드리지 않는다(순수 함수 모음). 저장/목록 연결은 다이얼로그가 담당.

// ── 양수 modulo (음수 좌표도 안전하게 wrap) ──
function wrap(v, n) {
  return ((v % n) + n) % n;
}

// 소스 ImageData(sw×sh)에서 (ox,oy)를 좌상단으로 하는 tw×th 타일을 순환 샘플링해 새 ImageData로 반환.
// 소스를 무한 반복(토러스)으로 보고 잘라내므로, 타일 크기가 소스보다 커도 자연스럽게 채워진다.
function sampleTile(src, sw, sh, ox, oy, tw, th) {
  const out = new ImageData(tw, th);
  const sd = src.data, od = out.data;
  for (let y = 0; y < th; y++) {
    const syRow = wrap(oy + y, sh) * sw;
    for (let x = 0; x < tw; x++) {
      const sx = wrap(ox + x, sw);
      const si = (syRow + sx) * 4;
      const di = (y * tw + x) * 4;
      od[di] = sd[si];
      od[di + 1] = sd[si + 1];
      od[di + 2] = sd[si + 2];
      od[di + 3] = sd[si + 3];
    }
  }
  return out;
}

// 타일을 (dx,dy)만큼 순환 시프트한 새 ImageData를 반환(경계가 가운데로 오게 하는 데 사용).
function shiftWrap(img, w, h, dx, dy) {
  const out = new ImageData(w, h);
  const id = img.data, od = out.data;
  for (let y = 0; y < h; y++) {
    const syRow = wrap(y - dy, h) * w;
    for (let x = 0; x < w; x++) {
      const sx = wrap(x - dx, w);
      const si = (syRow + sx) * 4;
      const di = (y * w + x) * 4;
      od[di] = id[si];
      od[di + 1] = id[si + 1];
      od[di + 2] = id[si + 2];
      od[di + 3] = id[si + 3];
    }
  }
  return out;
}

// 두 픽셀을 t(0~1) 비율로 선형 보간해 dst[di]에 기록(src 쪽 가중치 t).
function lerpPixel(dst, di, a, ai, b, bi, t) {
  const it = 1 - t;
  dst[di] = a[ai] * it + b[bi] * t;
  dst[di + 1] = a[ai + 1] * it + b[bi + 1] * t;
  dst[di + 2] = a[ai + 2] * it + b[bi + 2] * t;
  dst[di + 3] = a[ai + 3] * it + b[bi + 3] * t;
}

// 엣지 스무딩(seamless): 타일을 절반 시프트해 이음매를 중앙으로 모은 뒤,
// 중앙 십자(가로/세로 밴드)를 양쪽 픽셀의 크로스페이드로 메워 경계를 잇는다.
//   smooth: 0~1. 밴드 폭(타일의 최대 ~40%) 비율. 0이면 원본 그대로(시프트만, 이음매는 가장자리에 잔존).
// 반환: 새 ImageData(같은 크기).
function seamlessBlend(img, w, h, smooth) {
  // 1) 절반 시프트 → 원래 가장자리(이음매)가 타일 중앙선으로 이동
  const shifted = shiftWrap(img, w, h, Math.floor(w / 2), Math.floor(h / 2));
  if (smooth <= 0) return shifted;

  const sd = shifted.data;
  const out = new ImageData(new Uint8ClampedArray(sd), w, h);
  const od = out.data;

  // 밴드 폭(가운데 이음매를 덮는 크로스페이드 구간). 타일 절반을 넘지 않게 제한.
  const bw = Math.max(1, Math.min(Math.floor(w * 0.4), Math.floor(w / 2) - 1, Math.round((w / 2) * smooth)));
  const bh = Math.max(1, Math.min(Math.floor(h * 0.4), Math.floor(h / 2) - 1, Math.round((h / 2) * smooth)));
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // 세로 이음매(중앙 세로선) 덮기: 중앙에서 멀어질수록 원본 비중↑(코사인 페이드).
  for (let y = 0; y < h; y++) {
    for (let d = -bw; d <= bw; d++) {
      const x = cx + d;
      if (x < 0 || x >= w) continue;
      // 반대편 픽셀(타일을 가로로 반바퀴 돌린 위치)
      const ox = wrap(x + Math.floor(w / 2), w);
      // 중앙(d=0)에서 t=0.5(완전 혼합), 가장자리에서 t=0(원본 유지)
      const t = 0.5 * (1 - Math.abs(d) / (bw + 1));
      const di = (y * w + x) * 4;
      const oi = (y * w + ox) * 4;
      lerpPixel(od, di, sd, di, sd, oi, t);
    }
  }
  // 가로 이음매(중앙 가로선) 덮기 — 위에서 갱신된 od를 소스로 사용해 교차점도 자연스럽게.
  const od2 = new Uint8ClampedArray(od);
  for (let x = 0; x < w; x++) {
    for (let d = -bh; d <= bh; d++) {
      const y = cy + d;
      if (y < 0 || y >= h) continue;
      const oy = wrap(y + Math.floor(h / 2), h);
      const t = 0.5 * (1 - Math.abs(d) / (bh + 1));
      const di = (y * w + x) * 4;
      const oi = (oy * w + x) * 4;
      lerpPixel(od, di, od2, di, od2, oi, t);
    }
  }
  return out;
}

// ImageData → 작은 오프스크린 canvas(tile 규약).
function imageDataToCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

// ── 공개 API ──

// 소스 ImageData에서 타일 canvas를 생성한다.
//   src: 소스 ImageData (레이어 또는 선택 영역 크롭)
//   opts: { tileW, tileH, offsetX, offsetY, smooth(0~1) }
// 반환: { tile(canvas), width, height }
export function generateTile(src, opts = {}) {
  const sw = src.width, sh = src.height;
  const tw = Math.max(2, Math.min(512, Math.round(opts.tileW || Math.min(128, sw))));
  const th = Math.max(2, Math.min(512, Math.round(opts.tileH || Math.min(128, sh))));
  const ox = Math.round(opts.offsetX || 0);
  const oy = Math.round(opts.offsetY || 0);
  const smooth = Math.max(0, Math.min(1, opts.smooth ?? 0.3));

  let tile = sampleTile(src, sw, sh, ox, oy, tw, th);
  if (smooth > 0 || opts.forceSeamless) {
    tile = seamlessBlend(tile, tw, th, smooth);
  }
  return { tile: imageDataToCanvas(tile), width: tw, height: th };
}

// 미리보기용: 타일을 dest canvas에 dw×dh 영역을 채우도록 반복 도포(타일링)해 그린다.
// 작은 타일이 실제로 어떻게 이어지는지 보여준다.
export function tilePreview(tileCanvas, dest, dw, dh) {
  const g = dest.getContext("2d");
  g.clearRect(0, 0, dw, dh);
  g.imageSmoothingEnabled = false;
  const tw = tileCanvas.width, th = tileCanvas.height;
  if (tw <= 0 || th <= 0) return;
  for (let y = 0; y < dh; y += th) {
    for (let x = 0; x < dw; x += tw) {
      g.drawImage(tileCanvas, x, y);
    }
  }
}
