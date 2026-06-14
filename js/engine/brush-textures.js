// brush-textures.js — 브러시 텍스처 동역학용 절차적 텍스처 타일 생성기.
//
// 외부 이미지/CDN 없이 코드로 "타일링 가능한" 그레이스케일 패턴을 만든다(CSP 안전).
// 이 그레이값(0~255)은 브러시 스트로크의 강도(알파)에 곱해져 "질감 입은 붓터치"를 만든다.
//   - 흰색(255) = 그 픽셀 강도 100% 유지, 검정(0) = 강도 0(=칠 안 됨).
//   - depth(깊이)로 명암 대비(=질감이 얼마나 강하게 먹히는지)를 조절한다.
//
// [텍스처 종류]
//   canvas : 직조(캔버스천) — 가로/세로 실 격자.
//   paper  : 거친 종이 — 부드러운 값 노이즈(여러 옥타브 합성).
//   noise  : 굵은 노이즈 — 셀 기반 거친 점.
//   grain  : 미세 입자 — 픽셀 단위 고운 노이즈(필름 그레인 류).
//
// [타일링]
//   문서 좌표에 타일을 반복(repeat)해 깔면, 붓이 지나간 자리마다 같은 위치의 질감이 찍혀
//   포토샵의 "텍스처: 각 끝에 텍스처 적용"처럼 일관된 무늬가 된다(paint-tool이 patternify로 깐다).
//   따라서 타일 경계가 이어지도록(seamless) 그린다.
//
// [난수]
//   생성은 결정성을 위해 자체 시드 PRNG(mulberry32)를 쓴다(미리보기/테스트 일관성).

// 빠르고 가벼운 시드 난수(mulberry32). 0~1 반환. brush-dynamics.js와 동일 구현(중복이지만 의존 분리 목적).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 오프스크린 타일 canvas 생성 헬퍼
function makeTile(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// depth(0~1)로 그레이값의 명암 대비를 조절한다.
//   depth=0 → 전부 255(질감 없음=평평), depth=1 → 원본 명암 그대로.
//   즉 밝은 쪽(255)을 기준으로 어두운 쪽을 depth만큼만 끌어내린다.
function applyDepth(v, depth) {
  return 255 - (255 - v) * depth;
}

// ── canvas(직조/캔버스천) ──
// 가로·세로 사인파 실 격자. 두 방향 밝기를 합성해 천 질감을 낸다. 타일 경계가 자연스럽게 이어진다.
function weave(size, depth) {
  const c = makeTile(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  // 한 타일에 실 가닥이 정수 개 들어가야 경계가 이어진다.
  const threads = Math.max(2, Math.round(size / 8));
  const k = (Math.PI * 2 * threads) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 가로실/세로실 밝기(0~1). 교차 지점이 밝고 골이 어둡게.
      const wx = (Math.sin(x * k) + 1) * 0.5;
      const wy = (Math.sin(y * k) + 1) * 0.5;
      // 직조: 한 쪽 실이 위로 올라온 곳이 더 밝음(max 합성에 약간의 평균을 섞음)
      let v = (Math.max(wx, wy) * 0.7 + (wx + wy) * 0.15) * 255;
      v = applyDepth(v, depth);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 값 노이즈(value noise): 격자점에 난수를 두고 부드럽게 보간. cells가 타일을 나누는 격자 수.
// 타일 경계가 이어지도록 격자를 wrap(모듈로)해 샘플링한다.
function makeValueGrid(cells, rng) {
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let j = 0; j <= cells; j++) {
    for (let i = 0; i <= cells; i++) {
      // 마지막 행/열은 첫 행/열과 같게(=타일링 연속성)
      const ii = i % cells, jj = j % cells;
      g[j * (cells + 1) + i] = (ii === i && jj === j) ? rng() : g[jj * (cells + 1) + ii];
    }
  }
  return g;
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function sampleGrid(grid, cells, u, v) {
  // u,v: 0~1. 격자 좌표로 환산해 쌍선형(부드럽게) 보간.
  const fx = u * cells, fy = v * cells;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0), ty = smoothstep(fy - y0);
  const stride = cells + 1;
  const a = grid[y0 * stride + x0];
  const b = grid[y0 * stride + x0 + 1];
  const c = grid[(y0 + 1) * stride + x0];
  const d = grid[(y0 + 1) * stride + x0 + 1];
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

// ── paper(거친 종이) ──
// 여러 옥타브의 값 노이즈를 합성(fractal). 부드러운 얼룩 + 미세 거칠기.
function paper(size, depth, seed) {
  const c = makeTile(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  // 옥타브: 격자 수를 배로 늘리며 진폭은 줄인다.
  const octaves = [
    { cells: 2, amp: 0.5 },
    { cells: 4, amp: 0.3 },
    { cells: 8, amp: 0.2 },
  ];
  const grids = octaves.map((o) => makeValueGrid(o.cells, rng));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = 0;
      for (let o = 0; o < octaves.length; o++) {
        n += sampleGrid(grids[o], octaves[o].cells, u, v) * octaves[o].amp;
      }
      // n은 대략 0~1. 종이는 전반적으로 밝게(살짝 위로 치우침).
      let val = (0.35 + n * 0.65) * 255;
      val = applyDepth(val, depth);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ── noise(굵은 노이즈) ──
// 작은 셀마다 단일 난수값(보간 없음)으로 거친 블록 노이즈. 셀 크기는 타일을 정수 분할.
function coarseNoise(size, depth, seed) {
  const c = makeTile(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  const cell = 3;                       // 한 블록 변(px)
  const cols = Math.ceil(size / cell);
  const vals = new Float32Array(cols * cols);
  for (let i = 0; i < vals.length; i++) vals[i] = rng();
  for (let y = 0; y < size; y++) {
    const cy = (y / cell) | 0;
    for (let x = 0; x < size; x++) {
      const cx = (x / cell) | 0;
      let val = (0.25 + vals[cy * cols + cx] * 0.75) * 255;
      val = applyDepth(val, depth);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ── grain(미세 입자) ──
// 픽셀 단위 고운 노이즈(필름 그레인). 보간 없음, 셀=1px.
function grain(size, depth, seed) {
  const c = makeTile(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let p = 0; p < size * size; p++) {
    let val = (0.4 + rng() * 0.6) * 255;
    val = applyDepth(val, depth);
    const i = p * 4;
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 텍스처 종류 목록(UI 셀렉트가 쓸 [value,label]). brushes-panel과 동기화.
export const TEXTURE_TYPES = [
  ["canvas", "캔버스천"],
  ["paper", "거친 종이"],
  ["noise", "굵은 노이즈"],
  ["grain", "미세 입자"],
];

// 텍스처 타일 캐시. (종류|크기|깊이정수) 키로 재사용해 stroke마다 재생성 비용을 줄인다.
const _cache = new Map();

// 절차적 텍스처 타일(그레이스케일 canvas) 하나를 만든다(캐시됨).
//   type   : 'canvas' | 'paper' | 'noise' | 'grain'
//   scale  : 0~1. 타일 크기 비율(클수록 무늬가 큼). 16~128px로 환산.
//   depth  : 0~1. 명암 대비(질감 강도).
//   seed   : 결정성 시드(기본 1).
// 반환: { tile(canvas), size }
export function buildTexture(type, scale, depth, seed = 1) {
  const t = TEXTURE_TYPES.some(([v]) => v === type) ? type : "canvas";
  // scale(0~1) → 타일 변 길이(px). 작은 scale=촘촘, 큰 scale=큰 무늬.
  const size = Math.round(16 + clamp01(scale) * 112); // 16~128
  const dep = clamp01(depth);
  // 깊이는 캐시 키에 정수 단계(0~20)로만 반영(미세 변화로 캐시 폭증 방지)
  // canvas(weave)는 시드를 안 쓰는 결정적 사인파 격자 → 출력이 seed에 무관하다.
  //   그런데 키에 seed를 넣으면 같은 무늬가 seed별로 중복 캐시되어 32칸 예산을 낭비한다(점검 #P3).
  //   weave만 키에서 seed를 빼 중복을 없앤다(출력 불변). 나머지 타입은 seed가 무늬에 반영되므로 키에 유지.
  const seedKey = (t === "canvas") ? "-" : seed;
  const key = `${t}|${size}|${Math.round(dep * 20)}|${seedKey}`;
  const hit = _cache.get(key);
  if (hit) return { tile: hit, size };

  let tile;
  switch (t) {
    case "paper": tile = paper(size, dep, seed); break;
    case "noise": tile = coarseNoise(size, dep, seed); break;
    case "grain": tile = grain(size, dep, seed); break;
    default:      tile = weave(size, dep); break; // canvas
  }
  // 캐시 상한(메모리 보호): 32개 초과 시 가장 오래된 항목 제거.
  if (_cache.size >= 32) _cache.delete(_cache.keys().next().value);
  _cache.set(key, tile);
  return { tile, size };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
