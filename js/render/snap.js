// snap.js — 스냅(가이드/그리드/문서 경계) 계산.
// 순수 함수(nearestOnAxis/snapAxis/snapPoint/snapBox/buildSnapTargets)는 DOM·app에 의존하지 않아
// 단위 테스트가 가능하다. app 상태를 읽는 얇은 어댑터(snapTargetsFromApp 등)는 파일 끝에 둔다.
//
// 스냅 대상 표현(SnapTargets):
//   { x: { lines: number[], step: number }, y: { lines: number[], step: number } }
//   · lines = 이산 좌표(가이드 위치, 문서 경계·중앙)
//   · step  = 격자 간격(0이면 격자 스냅 없음). 무한 격자를 배열로 펼치지 않고 반올림으로 처리한다.
// 임계값은 문서 px 단위다. 화면 8px을 쓰려면 snapThreshold(zoom)로 환산한다.

// 화면상 스냅 거리(CSS px) — 줌과 무관하게 손에 느껴지는 거리를 일정하게 유지
export const SNAP_SCREEN_PX = 8;

// localStorage 키(스냅 설정 영속)
const LS_KEY = "cpe.snap";

// 화면 px 임계값을 문서 px로 환산
export function snapThreshold(zoom, screenPx = SNAP_SCREEN_PX) {
  return screenPx / (zoom > 0 ? zoom : 1);
}

// 한 축에서 v에 가장 가까운 대상 좌표와 거리. 대상이 없으면 null.
export function nearestOnAxis(v, axis) {
  if (!axis) return null;
  let best = null;
  for (const t of axis.lines || []) {
    const d = Math.abs(t - v);
    if (!best || d < best.dist) best = { target: t, dist: d };
  }
  if (axis.step > 0) {
    const t = Math.round(v / axis.step) * axis.step;
    const d = Math.abs(t - v);
    if (!best || d < best.dist) best = { target: t, dist: d };
  }
  return best;
}

// 여러 기준값(예: 왼쪽·중앙·오른쪽 가장자리) 중 대상에 가장 가까운 것 하나를 골라
// 그 차이(delta)만큼 옮기면 스냅된다. 임계값 밖이면 null.
// 반환: { delta, target, value }  (value = 스냅된 기준값의 원래 좌표)
export function snapAxis(values, axis, threshold) {
  let best = null;
  for (const v of values) {
    const n = nearestOnAxis(v, axis);
    if (!n || n.dist > threshold) continue;
    if (!best || n.dist < best.dist) best = { delta: n.target - v, target: n.target, value: v, dist: n.dist };
  }
  if (!best) return null;
  return { delta: best.delta, target: best.target, value: best.value };
}

// 점 하나를 스냅(사각형 선택의 시작/끝점 등). 축별로 독립 판정한다.
export function snapPoint(x, y, targets, threshold) {
  const sx = targets ? snapAxis([x], targets.x, threshold) : null;
  const sy = targets ? snapAxis([y], targets.y, threshold) : null;
  return {
    x: sx ? sx.target : x,
    y: sy ? sy.target : y,
    snappedX: !!sx,
    snappedY: !!sy,
  };
}

// 상자({x,y,w,h})의 가장자리·중앙을 대상에 스냅하기 위한 이동량 {dx, dy}.
// (이동 도구가 레이어 내용 경계를 끌 때 사용 — 결과를 기존 이동량에 더한다)
export function snapBox(box, targets, threshold) {
  if (!targets || !box) return { dx: 0, dy: 0, snappedX: false, snappedY: false };
  const sx = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], targets.x, threshold);
  const sy = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], targets.y, threshold);
  return { dx: sx ? sx.delta : 0, dy: sy ? sy.delta : 0, snappedX: !!sx, snappedY: !!sy };
}

// 스냅 대상 구성(순수). 옵션이 꺼진 대상은 넣지 않는다.
//   guides: [{orient:'h'|'v', pos}]  (h=수평선=y좌표, v=수직선=x좌표)
//   exclude: 드래그 중인 가이드 객체(자기 자신에게 스냅하지 않도록 제외)
export function buildSnapTargets({
  guides = [], gridStep = 0, docW = 0, docH = 0,
  useGuides = true, useGrid = true, useBounds = true, exclude = null,
} = {}) {
  const x = { lines: [], step: 0 };
  const y = { lines: [], step: 0 };
  if (useGuides) {
    for (const g of guides) {
      if (!g || g === exclude || !Number.isFinite(g.pos)) continue;
      if (g.orient === "h") y.lines.push(g.pos);
      else if (g.orient === "v") x.lines.push(g.pos);
    }
  }
  if (useBounds && docW > 0 && docH > 0) {
    x.lines.push(0, docW / 2, docW);
    y.lines.push(0, docH / 2, docH);
  }
  if (useGrid && gridStep > 0) { x.step = gridStep; y.step = gridStep; }
  return { x, y };
}

// ── app 어댑터 ──────────────────────────────────────────

// 스냅 설정 기본값을 state에 채운다(state.js를 건드리지 않고 동적 키로 관리, localStorage 영속).
//   snapEnabled(전체 스냅) / snapGuides / snapGrid / snapBounds
export function ensureSnapState(state) {
  if (!state || state._snapReady) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { saved = null; }
  const pick = (k, def) => (saved && typeof saved[k] === "boolean" ? saved[k] : def);
  state.snapEnabled = pick("snapEnabled", true);
  state.snapGuides = pick("snapGuides", true);
  state.snapGrid = pick("snapGrid", true);
  state.snapBounds = pick("snapBounds", true);
  if (typeof state.guidesLocked !== "boolean") state.guidesLocked = false;
  state._snapReady = true;
}

// 스냅 설정 저장(실패는 무시 — 프라이빗 모드 등)
export function saveSnapState(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      snapEnabled: !!state.snapEnabled, snapGuides: !!state.snapGuides,
      snapGrid: !!state.snapGrid, snapBounds: !!state.snapBounds,
    }));
  } catch { /* 무시 */ }
}

// 현재 앱 상태로 스냅 대상을 만든다. 스냅이 꺼져 있으면 null(호출부는 null이면 스냅 생략).
// 가이드는 표시 중일 때만, 그리드도 표시 중일 때만 스냅한다(포토샵 관례).
export function snapTargetsFromApp(app, { exclude = null } = {}) {
  const st = app.state;
  ensureSnapState(st);
  if (!st.snapEnabled) return null;
  const lm = app.layers;
  return buildSnapTargets({
    guides: st.guides || [],
    gridStep: st.gridSize > 0 ? st.gridSize : 32,
    docW: lm.width, docH: lm.height,
    useGuides: !!(st.snapGuides && st.showGuides),
    useGrid: !!(st.snapGrid && st.showGrid),
    useBounds: !!st.snapBounds,
    exclude,
  });
}
