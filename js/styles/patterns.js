// patterns.js — Pattern Overlay/채움용 기본 절차적 패턴 타일 모음.
// 외부 이미지 없이 Canvas 2D로 직접 그린 작은 타일을 createPattern("repeat")로 반복한다.
// (CSP 안전: eval/외부 URL 없음, 순수 캔버스 드로잉)
//
// getPattern(id, scale) → 타일 캔버스(없으면 null). scale은 타일 픽셀 크기 배율(1=기본).
// 타일 캔버스를 그대로 반환하고, 반복/클립은 호출자(layer-styles.js)가 createPattern으로 처리한다.
// 같은 (id,scale) 조합은 캐시해 재생성 비용을 줄인다.

// 패턴 메타: id → { label, base(기본 타일 px), draw(ctx,size) }
// draw는 size×size 캔버스에 1타일 분량을 그린다(가장자리에서 매끄럽게 반복되도록 설계).
const PATTERNS = {
  checker: {
    label: "체커보드",
    base: 16,
    draw(ctx, n) {
      const h = n / 2;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, h, h);
      ctx.fillRect(h, h, h, h);
    },
  },
  stripeDiag: {
    label: "대각선 줄무늬",
    base: 16,
    draw(ctx, n) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, n / 8);
      // 타일 경계에서 이어지도록 두 개의 대각선을 그린다.
      ctx.beginPath();
      ctx.moveTo(-n, n); ctx.lineTo(n, -n);
      ctx.moveTo(0, 2 * n); ctx.lineTo(2 * n, 0);
      ctx.stroke();
    },
  },
  dots: {
    label: "물방울",
    base: 20,
    draw(ctx, n) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = "#000000";
      const r = n / 6;
      // 중앙 + 네 모서리(반복 시 경계 점이 합쳐져 균일)
      const pts = [[n / 2, n / 2], [0, 0], [n, 0], [0, n], [n, n]];
      for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    },
  },
  grid: {
    label: "격자",
    base: 24,
    draw(ctx, n) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, n / 16);
      ctx.strokeRect(0.5, 0.5, n - 1, n - 1);
    },
  },
  cross: {
    label: "크로스해치",
    base: 16,
    draw(ctx, n) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, n / 12);
      ctx.beginPath();
      // 양방향 대각선(반복 경계 연결)
      ctx.moveTo(-n, n); ctx.lineTo(n, -n);
      ctx.moveTo(0, 2 * n); ctx.lineTo(2 * n, 0);
      ctx.moveTo(-n, 0); ctx.lineTo(n, 2 * n);
      ctx.moveTo(0, -n); ctx.lineTo(2 * n, n);
      ctx.stroke();
    },
  },
  brick: {
    label: "벽돌",
    base: 32,
    draw(ctx, n) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, n / 16);
      const half = n / 2;
      // 가로 줄눈 2개
      ctx.beginPath();
      ctx.moveTo(0, half + 0.5); ctx.lineTo(n, half + 0.5);
      ctx.moveTo(0, 0.5); ctx.lineTo(n, 0.5);
      // 세로 줄눈: 위 칸은 중앙, 아래 칸은 양끝(엇갈림)
      ctx.moveTo(half + 0.5, 0); ctx.lineTo(half + 0.5, half);
      ctx.moveTo(0.5, half); ctx.lineTo(0.5, n);
      ctx.moveTo(n - 0.5, half); ctx.lineTo(n - 0.5, n);
      ctx.stroke();
    },
  },
};

// (id,scale) → 캔버스 캐시. scale은 0.25 단위로 반올림해 캐시 키 폭주를 막는다.
const _cache = new Map();

// 패턴 목록(팔레트 UI용): [{ id, label }]
export function listPatterns() {
  return Object.keys(PATTERNS).map((id) => ({ id, label: PATTERNS[id].label }));
}

// 패턴 타일 캔버스 반환. id가 없으면 null. scale은 타일 크기 배율(0.25~8 권장).
export function getPattern(id, scale = 1) {
  const def = PATTERNS[id];
  if (!def) return null;
  const sc = Math.max(0.25, Math.min(8, Math.round((scale || 1) * 4) / 4));
  const key = id + "@" + sc;
  let c = _cache.get(key);
  if (c) return c;
  const n = Math.max(2, Math.round(def.base * sc));
  c = document.createElement("canvas");
  c.width = n; c.height = n;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  def.draw(ctx, n);
  _cache.set(key, c);
  return c;
}

// 패턴 미리보기용 작은 캔버스(팔레트 셀). size px 정사각.
export function patternPreview(id, size = 22) {
  const tile = getPattern(id, 1);
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  if (!tile) return c;
  const pat = ctx.createPattern(tile, "repeat");
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, size, size);
  return c;
}
