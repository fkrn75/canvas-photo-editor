// shape-layer.js — 셰이프 레이어(재편집 가능 벡터 윤곽 + 채움).
//
// [설계] 텍스트 레이어와 동일 전략: 셰이프의 "소스 데이터"(layer.vectorShape)를 레이어에 보존하고
//   화면 픽셀은 레이어 캔버스에 래스터로 렌더한다. geometry/색/획을 바꾸면 다시 렌더 → 재편집 가능.
//   합성/블렌드/마스크/내보내기는 일반 픽셀 레이어와 동일(비파괴 + layer-manager/blend 무수정).
//
// [vectorShape 데이터]
//   {
//     kind: "rect" | "ellipse" | "rounded" | "polygon" | "path",
//     fill: bool, stroke: bool,
//     fillColor: "#rrggbb", strokeColor: "#rrggbb", strokeWidth: number,
//     cornerRadius?: number,                       // rounded 전용
//     // 기하 데이터(kind별):
//     rect?:   { x, y, w, h },                     // rect/ellipse/rounded (문서 좌표 bbox)
//     polygon?:{ cx, cy, radius, sides, angle },   // 정다각형(중심/반지름/변수/시작각)
//     path?:   { anchors:[{x,y,inX,inY,outX,outY}...], closed:bool }, // 펜 패스(path-manager 구조)
//   }
//
// [좌표계] 모든 기하 좌표는 문서(월드) 좌표. 렌더는 레이어 캔버스(문서 1:1)에 직접.

// 셰이프 데이터 기본값
export function defaultShapeData(kind, overrides = {}) {
  return {
    kind,
    fill: true,
    stroke: false,
    fillColor: "#000000",
    strokeColor: "#000000",
    strokeWidth: 3,
    cornerRadius: 10,
    rect: null,
    polygon: null,
    path: null,
    ...overrides,
  };
}

export function isShapeLayer(layer) {
  return !!(layer && layer.vectorShape);
}

// ── 경로 구성: vectorShape 를 ctx 경로로 만든다(채움/획/적중판정 공용) ──
export function buildShapePath(ctx, d) {
  ctx.beginPath();
  if (d.kind === "rect" && d.rect) {
    ctx.rect(d.rect.x, d.rect.y, d.rect.w, d.rect.h);
  } else if (d.kind === "ellipse" && d.rect) {
    const r = d.rect;
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
  } else if (d.kind === "rounded" && d.rect) {
    _roundedRectPath(ctx, d.rect, d.cornerRadius || 0);
  } else if (d.kind === "polygon" && d.polygon) {
    const p = d.polygon;
    const sides = Math.max(3, p.sides | 0);
    for (let i = 0; i < sides; i++) {
      const a = (p.angle || 0) + (i * 2 * Math.PI) / sides;
      const x = p.cx + Math.cos(a) * p.radius;
      const y = p.cy + Math.sin(a) * p.radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (d.kind === "path" && d.path && d.path.anchors.length >= 2) {
    _bezierPath(ctx, d.path);
  }
}

// 둥근 사각형 경로(arcTo). 반경은 변 절반 이내로 보정.
function _roundedRectPath(ctx, r, radius) {
  let rr = Math.max(0, radius || 0);
  rr = Math.min(rr, Math.abs(r.w) / 2, Math.abs(r.h) / 2);
  const x = Math.min(r.x, r.x + r.w), y = Math.min(r.y, r.y + r.h);
  const w = Math.abs(r.w), h = Math.abs(r.h);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 베지어 패스(path-manager 의 buildPath2D 와 동일 규칙: prev.out, cur.in 제어점)
function _bezierPath(ctx, path) {
  const A = path.anchors;
  ctx.moveTo(A[0].x, A[0].y);
  for (let i = 1; i < A.length; i++) {
    const prev = A[i - 1], cur = A[i];
    ctx.bezierCurveTo(prev.outX, prev.outY, cur.inX, cur.inY, cur.x, cur.y);
  }
  if (path.closed && A.length >= 2) {
    const last = A[A.length - 1], first = A[0];
    ctx.bezierCurveTo(last.outX, last.outY, first.inX, first.inY, first.x, first.y);
    ctx.closePath();
  }
}

// ── 렌더: 레이어 캔버스를 비우고 셰이프를 그린다 ──
export function renderShapeLayer(layer) {
  const d = layer.vectorShape;
  if (!d) return;
  const ctx = layer.ctx;
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  buildShapePath(ctx, d);
  if (d.fill) { ctx.fillStyle = d.fillColor; ctx.fill(); }
  if (d.stroke && d.strokeWidth > 0) {
    ctx.strokeStyle = d.strokeColor;
    ctx.lineWidth = d.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
  layer.thumbDirty = true;
}

// (wx,wy) 문서좌표가 셰이프 안/근처인지(이동 적중판정용). 채움 영역 또는 획 위.
export function hitShape(layer, wx, wy) {
  const d = layer.vectorShape;
  if (!d) return false;
  // 측정용 임시 컨텍스트(레이어 ctx 상태 오염 방지)
  const ctx = layer.ctx;
  ctx.save();
  buildShapePath(ctx, d);
  let hit = ctx.isPointInPath(wx, wy);
  if (!hit && d.stroke) {
    ctx.lineWidth = Math.max(6, d.strokeWidth || 0);
    hit = ctx.isPointInStroke(wx, wy);
  }
  ctx.restore();
  return hit;
}

// path-manager 의 패스 객체 → vectorShape(path) 데이터로 변환(셰이프 레이어화).
export function pathToShapeData(pmPath, overrides = {}) {
  // 앵커 깊은복사(원본 패스와 분리)
  const anchors = pmPath.anchors.map((a) => ({
    x: a.x, y: a.y, inX: a.inX, inY: a.inY, outX: a.outX, outY: a.outY,
  }));
  return defaultShapeData("path", {
    path: { anchors, closed: !!pmPath.closed },
    ...overrides,
  });
}
