// path-manager.js — 베지어 패스(Pen 도구) 모델 + 패스 연산.
// 포토샵 펜 도구처럼 "앵커 + 양방향 제어 핸들"로 이루어진 패스를 관리한다.
//
// [데이터 모델]
//   path  = { anchors: [anchor...], closed: bool }
//   anchor = { x, y, inX, inY, outX, outY }
//     - (x,y)             : 앵커 점(월드 좌표 = 문서 px)
//     - (inX,inY)         : "들어오는" 제어 핸들 (이전 앵커 → 이 앵커 구간의 끝 핸들)
//     - (outX,outY)       : "나가는" 제어 핸들 (이 앵커 → 다음 앵커 구간의 시작 핸들)
//   제어 핸들도 월드 절대좌표로 저장한다(앵커 이동 시 함께 옮기기 쉽도록 PenTool에서 처리).
//   핸들이 앵커와 같은 좌표면(코너 포인트) 그 구간은 직선으로 그려진다.
//
// [좌표계] 모든 좌표는 월드(문서 px). 화면 표시는 drawOverlay에서 vp.worldToScreen으로 변환.
//
// [패스 → 선택영역] selection-manager.js의 setPolygon(97줄) 임시 캔버스 래스터화 패턴을 따른다.
//   임시 캔버스에 베지어 경로를 흰색으로 채우고 → 알파 추출 → Uint8Array 마스크 + bounds →
//   app.selection.setMask(mask, bounds).
//
// [채우기 / 스트로크] 활성 레이어 ctx에 직접 그리고 history.beginPixelEdit/commitPixelEdit로 등록.

export class PathManager {
  constructor(app) {
    this.app = app;
    this.paths = [];          // 완성/작업 중 패스 목록
    this.current = null;      // 현재 작업 중인 패스(열린 상태). 없으면 null.
    // PenTool이 hover/드래그 미리보기를 위해 채워 넣는 임시 상태(오버레이 표시용).
    // { type:"segment", from:{x,y}, to:{x,y} }  — 마지막 앵커에서 커서까지 곡선 고무줄.
    this.preview = null;
    // 오버레이에서 시작점 근처 강조(닫기 가능 표시)용 플래그
    this.hoverCloseHint = false;
  }

  // ── 패스 생성/선택 ──

  // 새 작업 패스를 시작하고 current로 만든다.
  startPath() {
    const p = { anchors: [], closed: false };
    this.paths.push(p);
    this.current = p;
    return p;
  }

  // current가 없으면 새로 시작한다(편의).
  ensureCurrent() {
    if (!this.current || this.current.closed) this.startPath();
    return this.current;
  }

  // 작업 패스 확정(닫지 않고 펜 조작 종료). current 해제만.
  finishCurrent() {
    this.current = null;
    this.preview = null;
    this._changed();
  }

  // 특정 패스를 current(작업 대상)로 지정. 닫힌 패스도 다시 편집 가능하도록 허용.
  setCurrent(path) {
    this.current = path || null;
    this._changed();
  }

  // 패스 삭제
  removePath(path) {
    const i = this.paths.indexOf(path);
    if (i < 0) return;
    this.paths.splice(i, 1);
    if (this.current === path) this.current = null;
    this._changed();
  }

  // 모든 패스 삭제
  clearAll() {
    this.paths = [];
    this.current = null;
    this.preview = null;
    this._changed();
  }

  // ── 앵커 편집 (PenTool이 위임 호출) ──

  // 앵커 추가. 코너 포인트(핸들 없음)는 in/out을 앵커와 동일하게 둔다.
  addAnchor(x, y) {
    const p = this.ensureCurrent();
    const a = { x, y, inX: x, inY: y, outX: x, outY: y };
    p.anchors.push(a);
    this._changed();
    return a;
  }

  // 마지막 앵커에 대칭 제어 핸들을 설정한다(펜 드래그 시).
  // dragX,dragY = 드래그 현재 위치 → out 핸들. in 핸들은 앵커 기준 반대편(대칭).
  setLastHandle(dragX, dragY) {
    const p = this.current;
    if (!p || p.anchors.length === 0) return;
    const a = p.anchors[p.anchors.length - 1];
    a.outX = dragX; a.outY = dragY;
    a.inX = a.x - (dragX - a.x);  // 대칭(부드러운 곡선)
    a.inY = a.y - (dragY - a.y);
    this._changed();
  }

  // 마지막 앵커의 out 핸들만 독립 설정(Alt 드래그=핸들 분리/코너화).
  setLastHandleOutOnly(dragX, dragY) {
    const p = this.current;
    if (!p || p.anchors.length === 0) return;
    const a = p.anchors[p.anchors.length - 1];
    a.outX = dragX; a.outY = dragY;
    this._changed();
  }

  // 임의 앵커 이동(핸들도 같은 변위만큼 따라 이동).
  moveAnchor(path, index, x, y) {
    const a = path?.anchors[index];
    if (!a) return;
    const dx = x - a.x, dy = y - a.y;
    a.x = x; a.y = y;
    a.inX += dx; a.inY += dy;
    a.outX += dx; a.outY += dy;
    this._changed();
  }

  // 특정 앵커의 한쪽 핸들만 이동(직접 조작). which="in"|"out".
  moveHandle(path, index, which, x, y) {
    const a = path?.anchors[index];
    if (!a) return;
    if (which === "in") { a.inX = x; a.inY = y; }
    else { a.outX = x; a.outY = y; }
    this._changed();
  }

  // 앵커 삭제. 패스가 비면 패스 자체를 제거.
  deleteAnchor(path, index) {
    if (!path || index < 0 || index >= path.anchors.length) return;
    path.anchors.splice(index, 1);
    if (path.anchors.length === 0) this.removePath(path);
    else this._changed();
  }

  // 현재 패스 닫기(시작점과 끝점 연결).
  closeCurrent() {
    const p = this.current;
    if (!p || p.anchors.length < 2) return false;
    p.closed = true;
    this._changed();
    return true;
  }

  // ── 적중 판정 (PenTool이 클릭 대상 찾기용) ──

  // (x,y) 월드좌표 근처의 앵커를 찾는다. tolWorld=월드 단위 허용 반경.
  // 반환: { path, index, anchor } 또는 null. current 패스를 우선 검사.
  hitAnchor(x, y, tolWorld) {
    const t2 = tolWorld * tolWorld;
    const order = this.current ? [this.current, ...this.paths.filter((p) => p !== this.current)] : this.paths;
    for (const path of order) {
      for (let i = 0; i < path.anchors.length; i++) {
        const a = path.anchors[i];
        const dx = a.x - x, dy = a.y - y;
        if (dx * dx + dy * dy <= t2) return { path, index: i, anchor: a };
      }
    }
    return null;
  }

  // current 패스의 시작 앵커 근처인가(닫기 판정용).
  isNearStart(x, y, tolWorld) {
    const p = this.current;
    if (!p || p.closed || p.anchors.length < 2) return false;
    const a = p.anchors[0];
    const dx = a.x - x, dy = a.y - y;
    return dx * dx + dy * dy <= tolWorld * tolWorld;
  }

  // ── 경로를 ctx에 구성 (채우기/스트로크/래스터화 공용) ──
  // closeOverride: true면 닫힌 것으로, false면 열린 것으로, undefined면 path.closed 사용.
  // 코너(핸들=앵커)면 lineTo, 핸들이 있으면 bezierCurveTo로 구간을 그린다.
  buildPath2D(ctx, path, closeOverride) {
    const A = path.anchors;
    if (A.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(A[0].x, A[0].y);
    for (let i = 1; i < A.length; i++) {
      const prev = A[i - 1], cur = A[i];
      // 구간 prev→cur: 제어점 = prev.out, cur.in
      ctx.bezierCurveTo(prev.outX, prev.outY, cur.inX, cur.inY, cur.x, cur.y);
    }
    const closed = closeOverride === undefined ? path.closed : closeOverride;
    if (closed && A.length >= 2) {
      // 마지막 → 처음 구간(닫기): 제어점 = last.out, first.in
      const last = A[A.length - 1], first = A[0];
      ctx.bezierCurveTo(last.outX, last.outY, first.inX, first.inY, first.x, first.y);
      ctx.closePath();
    }
  }

  // ── 패스 → 선택 영역 ──
  // 대상 패스(없으면 current, 그것도 없으면 마지막 패스)를 닫힌 영역으로 채워 마스크 추출.
  toSelection(path) {
    const target = path || this.current || this.paths[this.paths.length - 1];
    if (!target || target.anchors.length < 2) {
      this.app.status?.("선택으로 변환할 패스가 없습니다(앵커 2개 이상 필요).");
      return false;
    }
    const W = this.app.layers.width, H = this.app.layers.height;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    // 선택 영역화는 항상 닫힌 영역으로 간주(열린 패스도 시작점과 이어 채움).
    this.buildPath2D(g, target, true);
    g.fill();

    const data = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      const a = data[i * 4 + 3];
      if (a >= 128) {
        mask[i] = 255;
        const px = i % W, py = (i / W) | 0;
        if (px < minX) minX = px; if (py < minY) minY = py;
        if (px > maxX) maxX = px; if (py > maxY) maxY = py;
      }
    }
    if (maxX < 0) { this.app.status?.("패스 영역이 비어 있습니다."); return false; }
    this.app.selection.setMask(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    this.app.status?.("패스를 선택 영역으로 변환했습니다.");
    return true;
  }

  // ── 패스 채우기 (활성 레이어에 전경색으로) ──
  fillPath(path) {
    const target = path || this.current || this.paths[this.paths.length - 1];
    if (!target || target.anchors.length < 2) { this.app.status?.("채울 패스가 없습니다."); return false; }
    const layer = this.app.layers.activeLayer;
    if (!layer) { this.app.status?.("레이어가 없습니다."); return false; }
    if (!layer.visible) { this.app.status?.("숨겨진 레이어는 편집할 수 없습니다."); return false; }

    const ctx = layer.ctx;
    this.app.history.beginPixelEdit(layer);
    ctx.save();
    // 선택 영역이 있으면 그 안으로 클립(포토샵 동작과 일치)
    if (this.app.selection?.active) this.app.selection.applyClipPath(ctx);
    ctx.fillStyle = this.app.state.foreground;
    this.buildPath2D(ctx, target, true); // 채우기는 닫힌 영역
    ctx.fill();
    ctx.restore();
    layer.thumbDirty = true;
    this.app.history.commitPixelEdit(this._pathBox(target, 2), "패스 채우기");
    this.app.status?.("패스를 채웠습니다.");
    return true;
  }

  // ── 패스 스트로크 (활성 레이어에 전경색 외곽선) ──
  // width: px(없으면 인자 받은 값). 닫힘 여부는 패스 상태를 따른다(열린 패스는 열린 선).
  strokePath(path, width = 2) {
    const target = path || this.current || this.paths[this.paths.length - 1];
    if (!target || target.anchors.length < 2) { this.app.status?.("획을 그릴 패스가 없습니다."); return false; }
    const layer = this.app.layers.activeLayer;
    if (!layer) { this.app.status?.("레이어가 없습니다."); return false; }
    if (!layer.visible) { this.app.status?.("숨겨진 레이어는 편집할 수 없습니다."); return false; }

    const w = Math.max(1, Math.round(width));
    const ctx = layer.ctx;
    this.app.history.beginPixelEdit(layer);
    ctx.save();
    if (this.app.selection?.active) this.app.selection.applyClipPath(ctx);
    ctx.strokeStyle = this.app.state.foreground;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.buildPath2D(ctx, target); // 닫힘은 패스 상태 그대로
    ctx.stroke();
    ctx.restore();
    layer.thumbDirty = true;
    this.app.history.commitPixelEdit(this._pathBox(target, w + 2), "패스 획");
    this.app.status?.("패스에 획을 그렸습니다.");
    return true;
  }

  // 패스의 변경 영역 박스(앵커+핸들 모두 포함, pad 여유). commitPixelEdit용.
  _pathBox(path, pad = 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of path.anchors) {
      for (const [x, y] of [[a.x, a.y], [a.inX, a.inY], [a.outX, a.outY]]) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  // ── 오버레이 (곡선·앵커점·제어 핸들) ──
  // ctx는 화면(CSS) 좌표계. vp.worldToScreen으로 변환해 그린다. 렌더러가 매 프레임 호출.
  drawOverlay(ctx, vp) {
    if (this.paths.length === 0 && !this.preview) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const path of this.paths) {
      const isCur = path === this.current;
      this._drawPathCurve(ctx, vp, path);
      // 제어 핸들/앵커는 current 패스만 상세 표시(다른 패스는 곡선만)
      if (isCur || this.paths.length === 1) this._drawAnchorsAndHandles(ctx, vp, path);
      else this._drawAnchorsOnly(ctx, vp, path);
    }

    // 펜 고무줄 미리보기(마지막 앵커 → 커서)
    if (this.preview && this.preview.type === "segment") {
      const a = this.preview.from, b = this.preview.to;
      const pa = vp.worldToScreen(a.x, a.y), pb = vp.worldToScreen(b.x, b.y);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,120,255,0.7)";
      ctx.beginPath();
      // out 핸들이 있으면 곡선 미리보기, 없으면 직선
      if (this.preview.c1) {
        const c1 = vp.worldToScreen(this.preview.c1.x, this.preview.c1.y);
        ctx.moveTo(pa.x, pa.y);
        ctx.bezierCurveTo(c1.x, c1.y, pb.x, pb.y, pb.x, pb.y);
      } else {
        ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // 패스 곡선 본체(흰 외곽 + 파란 실선의 2겹으로 어떤 배경에서도 보이게)
  _drawPathCurve(ctx, vp, path) {
    if (path.anchors.length < 2) return;
    // 화면 좌표로 다시 구성
    const A = path.anchors;
    const move = vp.worldToScreen(A[0].x, A[0].y);
    const build = () => {
      ctx.beginPath();
      ctx.moveTo(move.x, move.y);
      for (let i = 1; i < A.length; i++) {
        const prev = A[i - 1], cur = A[i];
        const c1 = vp.worldToScreen(prev.outX, prev.outY);
        const c2 = vp.worldToScreen(cur.inX, cur.inY);
        const p = vp.worldToScreen(cur.x, cur.y);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
      }
      if (path.closed && A.length >= 2) {
        const last = A[A.length - 1], first = A[0];
        const c1 = vp.worldToScreen(last.outX, last.outY);
        const c2 = vp.worldToScreen(first.inX, first.inY);
        const p = vp.worldToScreen(first.x, first.y);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
        ctx.closePath();
      }
    };
    ctx.setLineDash([]);
    build();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    build();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,120,255,0.95)";
    ctx.stroke();
  }

  // 앵커점 + 제어 핸들(선 + 끝의 원). current 패스용 상세 표시.
  _drawAnchorsAndHandles(ctx, vp, path) {
    const A = path.anchors;
    ctx.setLineDash([]);
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const p = vp.worldToScreen(a.x, a.y);
      // 제어 핸들 선/점(앵커와 다를 때만 = 곡선 구간)
      for (const [hx, hy] of [[a.inX, a.inY], [a.outX, a.outY]]) {
        if (hx === a.x && hy === a.y) continue;
        const hp = vp.worldToScreen(hx, hy);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(hp.x, hp.y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,120,255,0.7)";
        ctx.stroke();
        // 핸들 끝 원(빈 원)
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,120,255,0.95)";
        ctx.fill(); ctx.stroke();
      }
      // 앵커 점(채운 사각형). 시작점은 닫기 힌트로 강조 가능.
      this._drawAnchorDot(ctx, p, i === 0 && this.hoverCloseHint);
    }
  }

  // 앵커점만(다른 패스용)
  _drawAnchorsOnly(ctx, vp, path) {
    for (const a of path.anchors) {
      const p = vp.worldToScreen(a.x, a.y);
      this._drawAnchorDot(ctx, p, false);
    }
  }

  // 앵커 점 1개 그리기. highlight면 더 크게/색 강조(닫기 가능 표시).
  _drawAnchorDot(ctx, p, highlight) {
    const s = highlight ? 5 : 3.5;
    ctx.beginPath();
    ctx.rect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.fillStyle = highlight ? "rgba(255,200,0,0.95)" : "#fff";
    ctx.strokeStyle = "rgba(0,90,200,1)";
    ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
  }

  // 변경 통지(렌더 갱신 + 팔레트 갱신용 이벤트는 PathsPanel이 직접 폴링/구독).
  _changed() {
    this.app.renderer?.requestRender();
    // 패널이 구독할 수 있도록 콜백 훅(있으면 호출). 별도 EVT 상수 없이 가볍게 처리.
    this.onChange?.();
  }
}
