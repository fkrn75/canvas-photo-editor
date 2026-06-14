// patterns.js — 패턴 도장(Pattern Stamp)용 기본 패턴 타일 생성기.
//
// 외부 이미지/CDN 없이 코드로 작은 타일 canvas를 그려 반환한다(CSP 안전).
// 각 패턴은 { id, name, tile } 형태. tile은 반복(타일링)을 전제로 한 작은 canvas다.
// 색은 전경/배경에 의존하지 않는 중립 회색 계열로 고정한다(패턴 자체의 무늬가 목적).

// 작은 오프스크린 canvas 생성 헬퍼
function makeTile(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

// 체커보드(격자 두 칸 교차)
function checker(size = 16) {
  const c = makeTile(size);
  const ctx = c.getContext("2d");
  const half = size / 2;
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
  return c;
}

// 도트(가운데 점 + 모서리 점으로 타일 경계에서도 이어지게)
function dots(size = 16) {
  const c = makeTile(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e6e6e6";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#8c8c8c";
  const r = Math.max(1.5, size * 0.16);
  const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  // 가운데 + 네 모서리(이웃 타일과 합쳐져 균일한 점 격자가 됨)
  dot(size / 2, size / 2);
  dot(0, 0); dot(size, 0); dot(0, size); dot(size, size);
  return c;
}

// 가는 격자선(그리드)
function grid(size = 16) {
  const c = makeTile(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#a8a8a8";
  ctx.lineWidth = 1;
  // 타일 경계에 선을 그어 반복 시 끊김 없는 격자
  ctx.beginPath();
  ctx.moveTo(0.5, 0); ctx.lineTo(0.5, size);
  ctx.moveTo(0, 0.5); ctx.lineTo(size, 0.5);
  ctx.stroke();
  return c;
}

// 대각선 줄무늬
function diagonal(size = 16) {
  const c = makeTile(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ececec";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#9a9a9a";
  ctx.lineWidth = Math.max(2, size * 0.18);
  ctx.beginPath();
  // 타일 경계를 가로지르는 대각선 2개(반복 시 연속됨)
  ctx.moveTo(-size * 0.25, size * 0.75); ctx.lineTo(size * 0.75, -size * 0.25);
  ctx.moveTo(size * 0.25, size * 1.25); ctx.lineTo(size * 1.25, size * 0.25);
  ctx.stroke();
  return c;
}

// 기본 패턴 목록을 생성해 반환(앱 시작 시 한 번 호출해 state.patterns에 보관).
export function buildDefaultPatterns() {
  return [
    { id: "checker", name: "체커", tile: checker(16) },
    { id: "dots", name: "도트", tile: dots(16) },
    { id: "grid", name: "격자", tile: grid(16) },
    { id: "diagonal", name: "대각선", tile: diagonal(16) },
  ];
}
