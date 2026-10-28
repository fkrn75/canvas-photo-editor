// tool-ext-math.js — 확장 도구(자르기·다각형/자석 올가미·빠른 선택·마술/배경 지우개·스팟 복구·적목·색상 대체)가
// 쓰는 순수 계산 함수 모음. DOM/캔버스에 의존하지 않으므로 node --test로 단위 검증한다(tests/tools-ext.test.js).
//
// 좌표·데이터 규약
//   - d: ImageData.data(Uint8ClampedArray, RGBA), W/H: 문서(=레이어) 크기
//   - 마스크/강도 배열: Uint8Array(W*H) 0~255 (선택 마스크와 같은 규약)
//   - 박스: {x, y, w, h} 정수 문서 좌표

// ───────────────────────────────────────────────────────────
// 1) 허용치 색 거리
// ───────────────────────────────────────────────────────────

// 두 색의 거리 = 채널별 절대차의 최댓값(0~255). floodfill.js(매직완드/버킷)와 같은 척도라
// 같은 "허용오차" 값이 도구 간에 같은 의미를 갖는다.
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = Math.abs(r1 - r2), dg = Math.abs(g1 - g2), db = Math.abs(b1 - b2);
  return dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
}

// d의 i번째 픽셀(바이트 오프셋)이 기준색 ref([r,g,b,a])와 허용치 tol 안인지. 알파도 같은 척도로 비교한다.
export function matchesRef(d, i, ref, tol) {
  return Math.abs(d[i] - ref[0]) <= tol &&
         Math.abs(d[i + 1] - ref[1]) <= tol &&
         Math.abs(d[i + 2] - ref[2]) <= tol &&
         Math.abs(d[i + 3] - (ref[3] ?? 255)) <= tol;
}

// 브러시 감쇠: 중심 거리 dist, 반경 r, 경도 hardness(0~1) → 강도 0~1.
// 경도 반경(r*hardness) 안은 1, 그 밖은 가장자리까지 선형으로 0. (paint-tool의 radial gradient와 같은 모양)
export function brushFalloff(dist, r, hardness) {
  if (dist >= r) return 0;
  const inner = r * Math.max(0, Math.min(1, hardness));
  if (dist <= inner) return 1;
  return (r - dist) / Math.max(1e-6, r - inner);
}

// ───────────────────────────────────────────────────────────
// 2) 자르기 사각형 계산
// ───────────────────────────────────────────────────────────

// 옵션바 비율 키 → 가로/세로 비(숫자). "free"·알 수 없는 값은 null(자유 비율).
export const CROP_RATIOS = [
  ["free", "자유"], ["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"],
  ["3:2", "3:2"], ["16:9", "16:9"], ["9:16", "9:16"],
];
export function parseRatio(key) {
  if (!key || key === "free") return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(key);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  return a > 0 && b > 0 ? a / b : null;
}

function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 고정점 a(ax,ay)에서 b(bx,by)로 드래그한 사각형. ratio(가로/세로)가 있으면 그 비율을 지키고,
// 문서(W×H) 밖으로 나가지 않게 고정점 기준으로 줄인다. 반환 {x,y,w,h}(실수).
export function cropRectFromDrag(ax, ay, bx, by, ratio, W, H) {
  ax = clampN(ax, 0, W); ay = clampN(ay, 0, H);
  const dirX = bx >= ax ? 1 : -1, dirY = by >= ay ? 1 : -1;
  // 고정점에서 드래그 방향으로 쓸 수 있는 최대 폭/높이
  const maxW = dirX > 0 ? W - ax : ax;
  const maxH = dirY > 0 ? H - ay : ay;
  let w = Math.abs(bx - ax), h = Math.abs(by - ay);
  if (ratio) {
    // 큰 쪽(비율 환산) 기준으로 맞춘 뒤 문서 한계 안으로 축소
    if (w / ratio >= h) h = w / ratio; else w = h * ratio;
    const lim = Math.min(maxW, maxH * ratio);
    if (w > lim) { w = lim; h = w / ratio; }
  } else {
    w = Math.min(w, maxW); h = Math.min(h, maxH);
  }
  return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - h, w, h };
}

// 핸들 이름: "nw","n","ne","e","se","s","sw","w","move"
// r0(드래그 시작 시 사각형)을 핸들로 (dx,dy)만큼 끌었을 때 새 사각형. 비율·문서 범위 유지.
export function resizeCropRect(r0, handle, dx, dy, ratio, W, H) {
  const x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
  if (handle === "move") {
    return { x: clampN(x1 + dx, 0, Math.max(0, W - r0.w)), y: clampN(y1 + dy, 0, Math.max(0, H - r0.h)), w: r0.w, h: r0.h };
  }
  // 모서리: 반대편 모서리를 고정점으로 드래그와 동일하게 처리
  const corners = {
    nw: [x2, y2, x1 + dx, y1 + dy], ne: [x1, y2, x2 + dx, y1 + dy],
    se: [x1, y1, x2 + dx, y2 + dy], sw: [x2, y1, x1 + dx, y2 + dy],
  };
  if (corners[handle]) {
    const [ax, ay, bx, by] = corners[handle];
    return cropRectFromDrag(ax, ay, bx, by, ratio, W, H);
  }
  // 변(edge): 반대편 변 고정
  const horiz = handle === "e" || handle === "w";
  if (horiz) {
    const fixed = handle === "e" ? x1 : x2;
    const moved = clampN((handle === "e" ? x2 : x1) + dx, 0, W);
    let w = Math.abs(moved - fixed);
    const dir = moved >= fixed ? 1 : -1;
    if (!ratio) return { x: dir > 0 ? fixed : fixed - w, y: y1, w, h: r0.h };
    // 비율 고정: 높이를 세로 중심 기준으로 맞추되 문서 안으로 제한
    const cy = (y1 + y2) / 2;
    const maxH = 2 * Math.min(cy, H - cy);
    let h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    return { x: dir > 0 ? fixed : fixed - w, y: cy - h / 2, w, h };
  }
  const fixed = handle === "s" ? y1 : y2;
  const moved = clampN((handle === "s" ? y2 : y1) + dy, 0, H);
  let h = Math.abs(moved - fixed);
  const dir = moved >= fixed ? 1 : -1;
  if (!ratio) return { x: x1, y: dir > 0 ? fixed : fixed - h, w: r0.w, h };
  const cx = (x1 + x2) / 2;
  const maxW = 2 * Math.min(cx, W - cx);
  let w = h * ratio;
  if (w > maxW) { w = maxW; h = w / ratio; }
  return { x: cx - w / 2, y: dir > 0 ? fixed : fixed - h, w, h };
}

// 비율 변경 시 기존 사각형을 중심 유지로 새 비율에 맞춘다(면적 비슷하게, 문서 안으로).
export function applyRatioToRect(r, ratio, W, H) {
  if (!ratio || !r) return r;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const area = Math.max(1, r.w * r.h);
  let w = Math.sqrt(area * ratio), h = w / ratio;
  const maxW = 2 * Math.min(cx, W - cx), maxH = 2 * Math.min(cy, H - cy);
  if (w > maxW) { w = maxW; h = w / ratio; }
  if (h > maxH) { h = maxH; w = h * ratio; }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// 실수 사각형 → 문서 안 정수 박스(최소 1px). 문서와 겹치지 않으면 null.
export function roundCropRect(r, W, H) {
  if (!r) return null;
  const x = clampN(Math.round(r.x), 0, W), y = clampN(Math.round(r.y), 0, H);
  const x2 = clampN(Math.round(r.x + r.w), 0, W), y2 = clampN(Math.round(r.y + r.h), 0, H);
  if (x2 - x < 1 || y2 - y < 1) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

// ───────────────────────────────────────────────────────────
// 3) 적목 현상 보정
// ───────────────────────────────────────────────────────────

// 붉음 정도: R / (G,B 평균). 정상 피부 ≈1.3~1.5, 적목 동공 ≈3 이상.
export function redness(r, g, b) { return r / ((g + b) / 2 + 1); }

// box 안의 "빨간" 픽셀을 무채색·어둡게 바꾼다(제자리 수정). 반환: 바뀐 픽셀 수.
//   pupil(0~1): 동공 크기 — 클수록 덜 붉은 가장자리까지 포함(임계 2.5 → 1.6)
//   darken(0~1): 어둡게 양 — 보정된 픽셀 밝기를 (1 − darken×강도)배
// 보정 강도는 임계 근처에서 부드럽게 올라가(0.5 구간) 동공 경계에 띠가 생기지 않는다.
export function redEyeFix(d, W, H, box, pupil = 0.5, darken = 0.5) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.w)), y1 = Math.min(H, Math.ceil(box.y + box.h));
  const thr = 2.5 - 0.9 * clampN(pupil, 0, 1);
  const dk = clampN(darken, 0, 1);
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 60 || d[i + 3] === 0) continue;
      const rd = redness(r, g, b);
      if (rd <= thr) continue;
      const s = Math.min(1, (rd - thr) / 0.5);
      const m = (g + b) / 2;                  // 빨강을 G·B 평균으로 → 무채색에 가깝게
      const nr = r + (m - r) * s;
      const f = 1 - dk * s;                   // 어둡게
      d[i] = nr * f; d[i + 1] = g * f; d[i + 2] = b * f;
      changed++;
    }
  }
  return changed;
}

// ───────────────────────────────────────────────────────────
// 4) 색상 대체(W3C 비분리 블렌드: 색상/색조/채도/광도)
// ───────────────────────────────────────────────────────────

export function lum(r, g, b) { return 0.3 * r + 0.59 * g + 0.11 * b; }

function clipColor(c) {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let k = 0; k < 3; k++) c[k] = l + ((c[k] - l) * l) / (l - n || 1);
  if (x > 255) for (let k = 0; k < 3; k++) c[k] = l + ((c[k] - l) * (255 - l)) / (x - l || 1);
  return c;
}
function setLum(c, l) {
  const dl = l - lum(c[0], c[1], c[2]);
  return clipColor([c[0] + dl, c[1] + dl, c[2] + dl]);
}
function sat(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
function setSat(c, s) {
  const out = [0, 0, 0];
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]); // min, mid, max 인덱스
  const mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
  if (mx > mn) {
    out[idx[1]] = ((md - mn) * s) / (mx - mn);
    out[idx[2]] = s;
  }
  return out; // min은 0
}

// 픽셀(base)을 전경색(src)으로 바꾼 색. mode: color(기본, 광도 유지) | hue | saturation | luminosity
export function replaceColor(r, g, b, fr, fg, fb, mode = "color") {
  const base = [r, g, b], src = [fr, fg, fb];
  const lb = lum(r, g, b);
  switch (mode) {
    case "hue": return setLum(setSat(src, sat(base)), lb);
    case "saturation": return setLum(setSat(base, sat(src)), lb);
    case "luminosity": return setLum(base, lum(fr, fg, fb));
    default: return setLum(src, lb);
  }
}

// ───────────────────────────────────────────────────────────
// 5) 국소 영역 확장(빠른 선택·배경 지우개 인접 모드)
// ───────────────────────────────────────────────────────────

// (sx,sy)에서 시작해 창(win={x0,y0,x1,y1}, x1/y1 미포함) 안에서 ref와 허용치 tol 안인 4-이웃 연결 영역을 찾는다.
// out(Uint8Array W*H)이 주어지면 찾은 픽셀에 value를 기록한다.
// 반환: { count, region(Uint8Array 창 크기, 1=영역), bbox:{x,y,w,h}|null }
export function growRegion(d, W, H, sx, sy, ref, tol, win, out = null, value = 255) {
  const wx0 = Math.max(0, win.x0 | 0), wy0 = Math.max(0, win.y0 | 0);
  const wx1 = Math.min(W, win.x1 | 0), wy1 = Math.min(H, win.y1 | 0);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  sx = Math.floor(sx); sy = Math.floor(sy);
  const empty = { count: 0, region: new Uint8Array(Math.max(0, ww * wh)), bbox: null, win: { x: wx0, y: wy0, w: ww, h: wh } };
  if (ww <= 0 || wh <= 0 || sx < wx0 || sy < wy0 || sx >= wx1 || sy >= wy1) return empty;
  const region = empty.region;
  const test = (x, y) => matchesRef(d, (y * W + x) * 4, ref, tol);
  if (!test(sx, sy)) return empty;
  let minX = sx, minY = sy, maxX = sx, maxY = sy, count = 0;
  const stack = [sx, sy];
  region[(sy - wy0) * ww + (sx - wx0)] = 1;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    count++;
    if (out) out[y * W + x] = value;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    // 4-이웃
    const nb = [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
    for (let k = 0; k < 8; k += 2) {
      const nx = nb[k], ny = nb[k + 1];
      if (nx < wx0 || ny < wy0 || nx >= wx1 || ny >= wy1) continue;
      const li = (ny - wy0) * ww + (nx - wx0);
      if (region[li]) continue;
      if (!test(nx, ny)) continue;
      region[li] = 1;
      stack.push(nx, ny);
    }
  }
  return { count, region, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, win: { x: wx0, y: wy0, w: ww, h: wh } };
}

// ───────────────────────────────────────────────────────────
// 6) 마술 지우개 / 배경 지우개 / 색상 대체 dab
// ───────────────────────────────────────────────────────────

// 마술 지우개: mask(0/255)가 켜진 픽셀의 알파를 opacity만큼 줄인다(1=완전 투명).
// selMask(선택, 0~255)가 있으면 그 강도로 제한. 반환: 바뀐 픽셀 수.
export function magicErase(d, mask, opacity = 1, selMask = null) {
  let n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const k = opacity * (selMask ? selMask[p] / 255 : 1);
    if (k <= 0) continue;
    const i = p * 4;
    const a = d[i + 3];
    if (a === 0) continue;
    d[i + 3] = a * (1 - k);
    n++;
  }
  return n;
}

// 원형 dab 공통 순회: 중심(cx,cy) 반경 r, 경도 hardness로 감쇠 f를 구하고
// 기준색 일치(색 거리 ≤ tol) + 인접(옵션) 조건을 만족하는 픽셀마다 visit(p, i, f)를 부른다.
// before: 비교 기준 원본 데이터(stroke 시작 시점). 반환: 영향 박스 {x,y,w,h}|null
function forEachDabPixel(before, W, H, cx, cy, r, hardness, ref, tol, contiguous, visit) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W, Math.ceil(cx + r) + 1), y1 = Math.min(H, Math.ceil(cy + r) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  let region = null, rw = 0;
  if (contiguous) {
    const g = growRegion(before, W, H, cx, cy, ref, tol, { x0, y0, x1, y1 });
    if (!g.count) return null;
    region = g.region; rw = g.win.w;
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const f = brushFalloff(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), r, hardness);
      if (f <= 0) continue;
      if (region) {
        if (!region[(y - y0) * rw + (x - x0)]) continue;
      } else {
        const i = (y * W + x) * 4;
        if (colorDistance(before[i], before[i + 1], before[i + 2], ref[0], ref[1], ref[2]) > tol) continue;
      }
      const p = y * W + x;
      visit(p, p * 4, f);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 배경 지우개 dab. work(현재 결과)·before(원본)·str(Uint8Array W*H, 지금까지의 최대 강도 0~255).
// 기준색 ref와 비슷한 픽셀만 지운다. 강도는 dab 사이 누적이 아니라 최댓값(lighten)이라 겹쳐 칠해도 경계가 일정.
// selMask가 있으면 선택 강도를 곱한다. 반환: 영향 박스|null
export function bgEraseDab(work, before, W, H, cx, cy, r, hardness, ref, tol, contiguous, str, selMask = null) {
  return forEachDabPixel(before, W, H, cx, cy, r, hardness, ref, tol, contiguous, (p, i, f) => {
    let s = f * 255;
    if (selMask) s = (s * selMask[p]) / 255;
    if (s <= str[p]) return;
    str[p] = s;
    work[i + 3] = before[i + 3] * (1 - str[p] / 255);
  });
}

// 색상 대체 dab. 기준색과 비슷한 원본 픽셀을 전경색(fg=[r,g,b])으로 mode 블렌드한 색 쪽으로 강도만큼 옮긴다.
export function colorReplaceDab(work, before, W, H, cx, cy, r, hardness, ref, tol, fg, mode, str, selMask = null) {
  return forEachDabPixel(before, W, H, cx, cy, r, hardness, ref, tol, false, (p, i, f) => {
    let s = f * 255;
    if (selMask) s = (s * selMask[p]) / 255;
    if (s <= str[p]) return;
    str[p] = s;
    const k = str[p] / 255;
    const br = before[i], bg = before[i + 1], bb = before[i + 2];
    const c = replaceColor(br, bg, bb, fg[0], fg[1], fg[2], mode);
    work[i] = br + (c[0] - br) * k;
    work[i + 1] = bg + (c[1] - bg) * k;
    work[i + 2] = bb + (c[2] - bb) * k;
  });
}

// ───────────────────────────────────────────────────────────
// 7) 스팟 복구(주변 패치 자동 탐색 + 경계 차이 확산 = 간이 Poisson)
// ───────────────────────────────────────────────────────────

// d를 제자리 수정. mask: Uint8Array(box.w*box.h, 0~255) — 칠한 영역(고칠 곳).
// 1) 영역 바로 바깥 1px 링(8-이웃 팽창)에서 주변과 가장 비슷한 텍스처를 가진 소스 오프셋을 후보 24곳 중 고른다.
// 2) 경계 차이 D = 대상 − 소스(링에서 고정)를 영역 안으로 라플라스 확산(Gauss-Seidel) → 이음매 없는 톤 보정.
//    (복구 브러시의 "주변 평균 톤 매칭"을 픽셀 단위로 일반화한 것. 초기값을 평균 차이로 두어 빨리 수렴)
// 3) 소스 + D 를 마스크 강도×opacity로 원본 위에 블렌딩.
// 쓸 만한 소스가 없으면(이미지가 너무 작음) 소스=0으로 두어 순수 확산 채움이 된다.
// 반환: { ok, offset:{dx,dy}|null }
export function spotHeal(d, W, H, mask, box, opacity = 1) {
  const bw = box.w, bh = box.h;
  // 영역/링 인덱스 수집(박스 지역 좌표)
  const inReg = (lx, ly) => lx >= 0 && ly >= 0 && lx < bw && ly < bh && mask[ly * bw + lx] > 0;
  const region = [], ring = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const isRing = new Uint8Array(bw * bh);
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      if (inReg(lx, ly)) {
        region.push(ly * bw + lx);
        if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
        continue;
      }
      let adj = false;
      for (let oy = -1; oy <= 1 && !adj; oy++) for (let ox = -1; ox <= 1; ox++) if (inReg(lx + ox, ly + oy)) { adj = true; break; }
      const gx = box.x + lx, gy = box.y + ly;
      if (adj && gx >= 0 && gy >= 0 && gx < W && gy < H) { ring.push(ly * bw + lx); isRing[ly * bw + lx] = 1; }
    }
  }
  if (!region.length) return { ok: false, offset: null };
  const orig = d.slice(); // 소스는 항상 원본에서 읽는다
  const gIdx = (li) => ((box.y + ((li / bw) | 0)) * W + (box.x + (li % bw))) * 4;

  // ── 1) 소스 오프셋 탐색 ──
  const spanW = maxX - minX + 1, spanH = maxY - minY + 1;
  const R = Math.max(spanW, spanH) + 3;
  let best = null, bestScore = Infinity;
  const dirs = [];
  for (let a = 0; a < 8; a++) dirs.push([Math.cos((a * Math.PI) / 4), Math.sin((a * Math.PI) / 4)]);
  for (const k of [1, 1.5, 2.2]) {
    for (const [ux, uy] of dirs) {
      const dx = Math.round(ux * R * k), dy = Math.round(uy * R * k);
      // 영역+링 전체가 문서 안이어야 후보
      const sx0 = box.x + minX - 1 + dx, sy0 = box.y + minY - 1 + dy;
      const sx1 = box.x + maxX + 1 + dx, sy1 = box.y + maxY + 1 + dy;
      if (sx0 < 0 || sy0 < 0 || sx1 >= W || sy1 >= H) continue;
      if (!ring.length) { best = { dx, dy }; bestScore = 0; break; }
      // 평균 제거 SSD(텍스처 유사도) + 평균 차 가중(톤이 너무 다른 곳 회피)
      let tm = [0, 0, 0], sm = [0, 0, 0];
      for (const li of ring) {
        const ti = gIdx(li), si = ti + (dy * W + dx) * 4;
        for (let c = 0; c < 3; c++) { tm[c] += orig[ti + c]; sm[c] += orig[si + c]; }
      }
      for (let c = 0; c < 3; c++) { tm[c] /= ring.length; sm[c] /= ring.length; }
      let ssd = 0;
      for (const li of ring) {
        const ti = gIdx(li), si = ti + (dy * W + dx) * 4;
        for (let c = 0; c < 3; c++) {
          const e = (orig[ti + c] - tm[c]) - (orig[si + c] - sm[c]);
          ssd += e * e;
        }
      }
      let md = 0;
      for (let c = 0; c < 3; c++) md += (tm[c] - sm[c]) ** 2;
      const score = ssd / ring.length + 0.25 * md;
      if (score < bestScore) { bestScore = score; best = { dx, dy }; }
    }
    if (best && !ring.length) break;
  }

  // ── 2) 경계 차이 확산 ──
  const n = bw * bh;
  const D = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const srcAt = (ti, c) => (best ? orig[ti + (best.dy * W + best.dx) * 4 + c] : 0);
  const mean = [0, 0, 0];
  for (const li of ring) {
    const ti = gIdx(li);
    for (let c = 0; c < 3; c++) { const v = orig[ti + c] - srcAt(ti, c); D[c][li] = v; mean[c] += v; }
  }
  for (let c = 0; c < 3; c++) mean[c] = ring.length ? mean[c] / ring.length : 0;
  for (const li of region) for (let c = 0; c < 3; c++) D[c][li] = mean[c];
  // 반복 수: 영역 크기에 비례(수렴), 단 총 연산량을 묶어 큰 영역에서도 수 초를 넘지 않게 한다.
  let iters = Math.min(400, Math.max(40, 2 * Math.max(spanW, spanH)));
  iters = Math.max(20, Math.min(iters, Math.floor(3e7 / region.length)));
  for (let it = 0; it < iters; it++) {
    for (const li of region) {
      const lx = li % bw, ly = (li / bw) | 0;
      for (let c = 0; c < 3; c++) {
        let s = 0, cnt = 0;
        if (lx > 0 && (isRing[li - 1] || mask[li - 1] > 0)) { s += D[c][li - 1]; cnt++; }
        if (lx < bw - 1 && (isRing[li + 1] || mask[li + 1] > 0)) { s += D[c][li + 1]; cnt++; }
        if (ly > 0 && (isRing[li - bw] || mask[li - bw] > 0)) { s += D[c][li - bw]; cnt++; }
        if (ly < bh - 1 && (isRing[li + bw] || mask[li + bw] > 0)) { s += D[c][li + bw]; cnt++; }
        if (cnt) D[c][li] = s / cnt;
      }
    }
  }

  // ── 3) 합성 ──
  for (const li of region) {
    const gx = box.x + (li % bw), gy = box.y + ((li / bw) | 0);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
    const ti = (gy * W + gx) * 4;
    const a = (mask[li] / 255) * opacity;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const v = srcAt(ti, c) + D[c][li];
      d[ti + c] = orig[ti + c] * (1 - a) + v * a;
    }
    const sa = best ? orig[ti + (best.dy * W + best.dx) * 4 + 3] : orig[ti + 3];
    d[ti + 3] = orig[ti + 3] * (1 - a) + sa * a;
  }
  return { ok: true, offset: best };
}

// ───────────────────────────────────────────────────────────
// 8) 자석 올가미: 그래디언트 크기 + live-wire(창 제한 다익스트라)
// ───────────────────────────────────────────────────────────

// 휘도(알파 가중) Sobel 그래디언트 크기, 최댓값으로 0~1 정규화. 반환 Float32Array(W*H)
export function gradientMagnitude(d, W, H) {
  const L = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    L[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * (d[i + 3] / 255);
  }
  const G = new Float32Array(W * H);
  let mx = 0;
  for (let y = 0; y < H; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < H - 1 ? y + 1 : H - 1;
    for (let x = 0; x < W; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : W - 1;
      const a = L[ym * W + xm], b = L[ym * W + x], c = L[ym * W + xp];
      const dd = L[y * W + xm], f = L[y * W + xp];
      const g = L[yp * W + xm], h = L[yp * W + x], k = L[yp * W + xp];
      const gx = (c + 2 * f + k) - (a + 2 * dd + g);
      const gy = (g + 2 * h + k) - (a + 2 * b + c);
      const m = Math.sqrt(gx * gx + gy * gy);
      G[y * W + x] = m;
      if (m > mx) mx = m;
    }
  }
  if (mx > 0) for (let p = 0; p < G.length; p++) G[p] /= mx;
  return G;
}

// a→b 최소 비용 경로(8-이웃). 비용 = 이동거리 × (1 − 그래디언트 + 0.05) → 가장자리를 따라간다.
// 탐색은 두 점을 감싸는 상자 + pad 안으로 제한(실시간 성능). 반환: 픽셀 좌표 [{x,y}] (a 포함, b 포함)
export function liveWirePath(grad, W, H, ax, ay, bx, by, pad = 10) {
  ax = clampN(Math.floor(ax), 0, W - 1); ay = clampN(Math.floor(ay), 0, H - 1);
  bx = clampN(Math.floor(bx), 0, W - 1); by = clampN(Math.floor(by), 0, H - 1);
  if (ax === bx && ay === by) return [{ x: ax, y: ay }];
  const x0 = Math.max(0, Math.min(ax, bx) - pad), y0 = Math.max(0, Math.min(ay, by) - pad);
  const x1 = Math.min(W - 1, Math.max(ax, bx) + pad), y1 = Math.min(H - 1, Math.max(ay, by) + pad);
  const ww = x1 - x0 + 1, wh = y1 - y0 + 1, n = ww * wh;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const start = (ay - y0) * ww + (ax - x0), goal = (by - y0) * ww + (bx - x0);
  // 이진 힙(우선순위 큐, 지연 삭제)
  const hk = [], hv = [];
  const push = (key, v) => {
    let i = hk.length; hk.push(key); hv.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; }
  };
  const pop = () => {
    const v = hv[0];
    const lk = hk.pop(), lv = hv.pop();
    if (hk.length) {
      hk[0] = lk; hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m;
      }
    }
    return v;
  };
  dist[start] = 0; push(0, start);
  const SQ2 = Math.SQRT2;
  while (hk.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    const ux = u % ww, uy = (u / ww) | 0;
    for (let oy = -1; oy <= 1; oy++) {
      const vy = uy + oy; if (vy < 0 || vy >= wh) continue;
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const vx = ux + ox; if (vx < 0 || vx >= ww) continue;
        const v = vy * ww + vx;
        if (done[v]) continue;
        const g = grad[(vy + y0) * W + (vx + x0)];
        const nd = dist[u] + (ox && oy ? SQ2 : 1) * (1.05 - g);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
      }
    }
  }
  const path = [];
  for (let v = goal; v !== -1; v = prev[v]) {
    path.push({ x: (v % ww) + x0, y: ((v / ww) | 0) + y0 });
    if (v === start) break;
  }
  return path.reverse();
}
