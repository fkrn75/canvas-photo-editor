// layer-image-ops.js — 이미지/레이어 메뉴 연산의 순수 계산부(DOM 없음 → node --test 로 검증).
//   · 캔버스 크기 기준점 오프셋 / 임의 회전 후 크기 / 재단(Trim) 경계 / 불투명 경계
//   · 정렬 오프셋 / 마스크·알파 변환 / 벡터 데이터(텍스트·셰이프·패스) 좌표 변환
// 실제 캔버스·히스토리 처리는 js/ops/doc-ops.js, js/ops/layer-ops.js 가 담당한다.

// ── 캔버스 크기 ──
// anchor: 0~8 (0=왼쪽 위, 1=위 가운데, 2=오른쪽 위, 3=왼쪽 가운데, 4=가운데 … 8=오른쪽 아래)
// 반환: 기존 픽셀을 새 캔버스의 (dx,dy) 에 놓으면 된다. 축소 시 음수(잘려 나감).
export function anchorOffset(oldW, oldH, newW, newH, anchor = 4) {
  const ax = anchor % 3, ay = Math.floor(anchor / 3);
  return {
    dx: Math.floor(((newW - oldW) * ax) / 2),
    dy: Math.floor(((newH - oldH) * ay) / 2),
  };
}

// ── 임의 각도 회전 ──
// deg 만큼 회전했을 때 전체 이미지를 담는 캔버스 크기(캔버스 확장).
export function rotatedSize(w, h, deg) {
  const t = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  // 부동소수 오차(90°에서 cos≈6e-17 등)로 1px 커지지 않게 아주 작은 값을 뺀 뒤 올림
  return {
    w: Math.max(1, Math.ceil(w * c + h * s - 1e-6)),
    h: Math.max(1, Math.ceil(w * s + h * c - 1e-6)),
  };
}

// 중심 기준 회전 좌표 변환 함수 (ow×oh 문서 → nw×nh 문서, 시계 방향 양수 deg)
export function rotatePointFn(ow, oh, nw, nh, deg) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return (x, y) => {
    const px = x - ow / 2, py = y - oh / 2;
    return { x: px * c - py * s + nw / 2, y: px * s + py * c + nh / 2 };
  };
}

// ── 재단(Trim) ──
// img: ImageData 호환 { width, height, data }
// mode: "transparent"(투명 픽셀) | "topLeft"(왼쪽 위 픽셀 색) | "bottomRight"(오른쪽 아래 픽셀 색)
// sides: { top, bottom, left, right } — true 인 쪽만 잘라낸다.
// 반환: 남길 영역 {x,y,w,h}. 전부 잘려 나갈 이미지면 null.
export function trimBounds(img, mode = "transparent", sides = { top: true, bottom: true, left: true, right: true }) {
  const W = img.width, H = img.height, d = img.data;
  let isTrim;
  if (mode === "transparent") {
    isTrim = (i) => d[i + 3] === 0;
  } else {
    const ri = mode === "bottomRight" ? ((H - 1) * W + (W - 1)) * 4 : 0;
    const r = d[ri], g = d[ri + 1], b = d[ri + 2], a = d[ri + 3];
    isTrim = (i) => d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === a;
  }
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      if (isTrim(i)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x0 = sides.left ? minX : 0;
  const x1 = sides.right ? maxX : W - 1;
  const y0 = sides.top ? minY : 0;
  const y1 = sides.bottom ? maxY : H - 1;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 불투명(알파>0) 픽셀의 경계 박스. 없으면 null.
export function opaqueBounds(img) {
  return trimBounds(img, "transparent");
}

// ── 정렬 ──
// content: 레이어 불투명 경계, target: 선택 경계 또는 캔버스 {x,y,w,h}
// edge: "top" | "vcenter" | "bottom" | "left" | "hcenter" | "right"
// 반환: 레이어를 옮길 정수 오프셋 {dx,dy}
export function alignOffset(content, target, edge) {
  let dx = 0, dy = 0;
  switch (edge) {
    case "top": dy = target.y - content.y; break;
    case "bottom": dy = (target.y + target.h) - (content.y + content.h); break;
    case "vcenter": dy = Math.round((target.y + target.h / 2) - (content.y + content.h / 2)); break;
    case "left": dx = target.x - content.x; break;
    case "right": dx = (target.x + target.w) - (content.x + content.w); break;
    case "hcenter": dx = Math.round((target.x + target.w / 2) - (content.x + content.w / 2)); break;
    default: break;
  }
  return { dx: dx || 0, dy: dy || 0 };
}

// ── 알파·마스크 픽셀 연산 (data: RGBA Uint8ClampedArray) ──
// 박스 영역 ImageData(img)의 알파에 선택 마스크(문서 크기 Uint8Array 0~255)를 곱한다.
// invert=true 면 (255-마스크)를 곱한다(=선택 영역을 지움).
export function maskAlphaInBox(img, mask, docW, box, invert = false) {
  const d = img.data;
  for (let row = 0; row < box.h; row++) {
    const mRow = (box.y + row) * docW + box.x;
    let i = row * box.w * 4 + 3;
    for (let col = 0; col < box.w; col++, i += 4) {
      const m = mask[mRow + col];
      const f = invert ? 255 - m : m;
      if (f === 255) continue;
      d[i] = (d[i] * f) / 255;
    }
  }
  return img;
}

// 레이어 마스크 굽기: 픽셀 알파 × 마스크 휘도 × 마스크 알파 (blend.js buildEffectiveSource 와 같은 식)
export function bakeMaskIntoAlpha(pix, maskPix) {
  for (let i = 0; i < pix.length; i += 4) {
    const a = pix[i + 3];
    if (a === 0) continue;
    const lum = (maskPix[i] * 0.299 + maskPix[i + 1] * 0.587 + maskPix[i + 2] * 0.114) / 255;
    pix[i + 3] = a * lum * (maskPix[i + 3] / 255);
  }
  return pix;
}

// 투명도에서 마스크 만들기: 알파 → 그레이스케일 마스크 RGBA(알파 255)
export function alphaToMaskData(pix) {
  const out = new Uint8ClampedArray(pix.length);
  for (let i = 0; i < pix.length; i += 4) {
    const a = pix[i + 3];
    out[i] = out[i + 1] = out[i + 2] = a;
    out[i + 3] = 255;
  }
  return out;
}

// 픽셀을 모두 불투명하게(알파 255) — 투명도를 마스크로 옮긴 뒤 레이어 쪽 처리
export function makeOpaque(pix) {
  for (let i = 3; i < pix.length; i += 4) pix[i] = 255;
  return pix;
}

// ── 벡터 데이터 좌표 변환 ──
// 모든 함수는 새 객체를 돌려준다(원본 불변 → 히스토리 스냅샷 안전).
function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }

// 패스(anchors: {x,y,inX,inY,outX,outY}) 의 모든 점에 fn(x,y)→{x,y} 적용
export function mapPath(path, fn) {
  if (!path) return path;
  const p = clone(path);
  for (const a of p.anchors || []) {
    const m = fn(a.x, a.y), mi = fn(a.inX, a.inY), mo = fn(a.outX, a.outY);
    a.x = m.x; a.y = m.y; a.inX = mi.x; a.inY = mi.y; a.outX = mo.x; a.outY = mo.y;
  }
  return p;
}

// 축 정렬 변환(배율 sx,sy 후 평행이동 dx,dy): x' = x*sx + dx
// 텍스트: 좌상단 위치 이동 + 글자 크기/자간 비례
export function scaleVectorText(d, { sx = 1, sy = 1, dx = 0, dy = 0 }) {
  if (!d) return d;
  const t = clone(d);
  const s = Math.sqrt(Math.abs(sx * sy));
  t.x = t.x * sx + dx;
  t.y = t.y * sy + dy;
  if (s !== 1) {
    t.fontSize = Math.max(1, t.fontSize * s);
    if (t.letterSpacing) t.letterSpacing *= s;
  }
  return t;
}

export function scaleVectorShape(d, { sx = 1, sy = 1, dx = 0, dy = 0 }) {
  if (!d) return d;
  const t = clone(d);
  const s = Math.sqrt(Math.abs(sx * sy));
  if (t.rect) { t.rect.x = t.rect.x * sx + dx; t.rect.y = t.rect.y * sy + dy; t.rect.w *= sx; t.rect.h *= sy; }
  if (t.polygon) { t.polygon.cx = t.polygon.cx * sx + dx; t.polygon.cy = t.polygon.cy * sy + dy; t.polygon.radius *= s; }
  if (t.path) t.path = mapPath(t.path, (x, y) => ({ x: x * sx + dx, y: y * sy + dy }));
  if (s !== 1) {
    if (t.strokeWidth) t.strokeWidth *= s;
    if (t.cornerRadius) t.cornerRadius *= s;
  }
  return t;
}

export function scaleVectorMask(d, xf) {
  if (!d || !d.path) return d;
  const { sx = 1, sy = 1, dx = 0, dy = 0 } = xf;
  return { ...clone(d), path: mapPath(d.path, (x, y) => ({ x: x * sx + dx, y: y * sy + dy })) };
}

// 회전: 셰이프는 표현 가능한 경우만 변환해 돌려주고, 불가능하면 null(=래스터화 필요).
//   rect → 4점 닫힌 패스로 바꿔 회전 / polygon → 중심 회전 + 시작각 증가 / path → 앵커 회전
//   ellipse·rounded → 회전 표현 불가(null)
export function rotateVectorShape(d, fn, deg) {
  if (!d) return d;
  const t = clone(d);
  const rad = (deg * Math.PI) / 180;
  if (t.kind === "polygon" && t.polygon) {
    const c = fn(t.polygon.cx, t.polygon.cy);
    t.polygon.cx = c.x; t.polygon.cy = c.y;
    t.polygon.angle = (t.polygon.angle || 0) + rad;
    return t;
  }
  if (t.kind === "path" && t.path) { t.path = mapPath(t.path, fn); return t; }
  if (t.kind === "rect" && t.rect) {
    const r = t.rect;
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    const anchors = pts.map(([x, y]) => { const p = fn(x, y); return { x: p.x, y: p.y, inX: p.x, inY: p.y, outX: p.x, outY: p.y }; });
    t.kind = "path"; t.rect = null; t.path = { anchors, closed: true };
    return t;
  }
  return null;
}
