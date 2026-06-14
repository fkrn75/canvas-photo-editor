// vector-mask.js — 벡터 마스크(레이어를 패스로 비파괴 클립).
//
// [핵심 아이디어 — 무충돌 합성]
//   레이어 마스크 합성(blend.js buildEffectiveSource)은 이미 "그레이스케일 마스크 캔버스(layer.mask)"를
//   읽어 알파에 곱한다. 벡터 마스크는 패스를 그 마스크 캔버스에 흰색으로 래스터화하는 방식으로 구현한다.
//   → layer-manager / blend.js / renderer 를 전혀 수정하지 않고 기존 마스크 파이프라인을 그대로 재사용.
//   동시에 패스의 "소스 데이터"를 layer.vectorMask 에 보존 → 패스를 다시 편집하면 마스크를 재래스터화.
//
// [vectorMask 데이터] { path: { anchors:[...], closed:bool } }  (path-manager 패스 구조의 깊은복사)
//
// [재편집] 패스 편집 후 reRasterizeVectorMask(app, layer) 를 호출하면 layer.mask 를 다시 그린다.
//
// 공유 layer.js 비수정: layer.attachMask/removeMask/createMask 는 기존 공개 메서드라 그대로 사용한다.

// 베지어 패스를 ctx 경로로 구성(path-manager buildPath2D 동일 규칙). 마스크는 항상 닫힌 영역으로 채운다.
function buildPathClosed(ctx, path) {
  const A = path.anchors;
  if (A.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(A[0].x, A[0].y);
  for (let i = 1; i < A.length; i++) {
    const prev = A[i - 1], cur = A[i];
    ctx.bezierCurveTo(prev.outX, prev.outY, cur.inX, cur.inY, cur.x, cur.y);
  }
  const last = A[A.length - 1], first = A[0];
  ctx.bezierCurveTo(last.outX, last.outY, first.inX, first.inY, first.x, first.y);
  ctx.closePath();
}

export function hasVectorMask(layer) {
  return !!(layer && layer.vectorMask);
}

// 패스 객체 깊은복사(원본 패스와 분리)
function clonePath(pmPath) {
  return {
    anchors: pmPath.anchors.map((a) => ({ x: a.x, y: a.y, inX: a.inX, inY: a.inY, outX: a.outX, outY: a.outY })),
    closed: !!pmPath.closed,
  };
}

// layer.mask(그레이스케일) 캔버스를 vectorMask.path 로 다시 그린다.
// 패스 안=흰색(드러냄), 밖=검정(가림). 마스크 캔버스가 없으면 만든다.
export function reRasterizeVectorMask(app, layer) {
  const d = layer.vectorMask;
  if (!d || !d.path) return;
  if (!layer.mask) layer.createMask(false); // 전체 가림으로 시작(없을 때만)
  const mc = layer.maskCtx;
  mc.save();
  mc.setTransform(1, 0, 0, 1, 0, 0);
  // 전체 검정으로 리셋 후 패스 영역만 흰색
  mc.globalCompositeOperation = "source-over";
  mc.fillStyle = "#000000";
  mc.fillRect(0, 0, layer.width, layer.height);
  mc.fillStyle = "#ffffff";
  buildPathClosed(mc, d.path);
  mc.fill();
  mc.restore();
  layer.maskEnabled = true;
  layer.thumbDirty = true;
}

// ── 벡터 마스크 적용/제거 커맨드 ──
// 마스크 캔버스(통째)와 vectorMask 데이터, 그리고 마스크 관련 플래그를 함께 보관/복원한다.
class VectorMaskCommand {
  constructor(app, layer, label, before, after) {
    this.app = app;
    this.layerId = layer.id;
    this.label = label;
    this.before = before; // { maskCanvas|null, vectorMask|null, maskEnabled, maskActive }
    this.after = after;
    this.memoryBytes = app.layers.width * app.layers.height * 4;
  }
  _restore(state) {
    const layer = this.app.layers.byId(this.layerId);
    if (!layer) return;
    layer.vectorMask = state.vectorMask ? JSON.parse(JSON.stringify(state.vectorMask)) : null;
    if (state.maskCanvas) {
      // 보관된 마스크 캔버스를 복제해 장착(이후 편집이 보관본을 오염시키지 않도록)
      const m = document.createElement("canvas");
      m.width = layer.width; m.height = layer.height;
      m.getContext("2d", { willReadFrequently: true }).drawImage(state.maskCanvas, 0, 0);
      layer.attachMask(m);
    } else {
      layer.removeMask();
    }
    layer.maskEnabled = state.maskEnabled;
    layer.maskActive = state.maskActive;
    layer.thumbDirty = true;
    this.app.layers.notifyStructure();
  }
  redo() { this._restore(this.after); }
  undo() { this._restore(this.before); }
}

// 현재 레이어 상태(마스크/벡터마스크/플래그)를 스냅샷
function snapshotMaskState(layer) {
  let maskCanvas = null;
  if (layer.mask) {
    maskCanvas = document.createElement("canvas");
    maskCanvas.width = layer.width; maskCanvas.height = layer.height;
    maskCanvas.getContext("2d", { willReadFrequently: true }).drawImage(layer.mask, 0, 0);
  }
  return {
    maskCanvas,
    vectorMask: layer.vectorMask ? JSON.parse(JSON.stringify(layer.vectorMask)) : null,
    maskEnabled: layer.maskEnabled,
    maskActive: layer.maskActive,
  };
}

// 펜 패스를 벡터 마스크로 적용(히스토리 등록). 기존 마스크가 있으면 벡터 마스크로 덮어쓴다.
export function applyVectorMaskFromPath(app, layer, pmPath) {
  if (!layer || !pmPath || pmPath.anchors.length < 2) return false;
  const before = snapshotMaskState(layer);
  layer.vectorMask = { path: clonePath(pmPath) };
  reRasterizeVectorMask(app, layer);
  layer.maskActive = false; // 마스크 적용 후 편집 대상은 레이어 픽셀로
  const after = snapshotMaskState(layer);
  app.history.push(new VectorMaskCommand(app, layer, "벡터 마스크 적용", before, after));
  app.layers.notifyStructure();
  return true;
}

// 벡터 마스크 제거(마스크 캔버스도 함께 제거, 히스토리 등록).
export function removeVectorMask(app, layer) {
  if (!hasVectorMask(layer)) return false;
  const before = snapshotMaskState(layer);
  layer.vectorMask = null;
  layer.removeMask();
  const after = snapshotMaskState(layer);
  app.history.push(new VectorMaskCommand(app, layer, "벡터 마스크 제거", before, after));
  app.layers.notifyStructure();
  return true;
}

// 활성 레이어의 벡터 마스크 패스를 재편집용으로 app.paths 에 올린다(펜 도구로 편집).
// 편집 후 "셰이프 패널 → 벡터 마스크" 버튼을 다시 누르면 새 패스로 마스크가 갱신된다.
export function loadVectorMaskToPaths(app, layer) {
  if (!hasVectorMask(layer)) return false;
  const pm = app.paths;
  if (!pm) return false;
  // path-manager 에 동일 구조의 패스를 추가하고 current 로(원본과 분리된 복사본)
  const p = { anchors: layer.vectorMask.path.anchors.map((a) => ({ ...a })), closed: layer.vectorMask.path.closed };
  pm.paths.push(p);
  pm.setCurrent(p);
  app.renderer?.requestRender();
  return true;
}
