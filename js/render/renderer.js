// renderer.js — 표시 캔버스에 합성 결과를 그린다.
// requestAnimationFrame 루프를 돌되 dirty 플래그가 설정된 프레임에서만 실제 렌더(유휴 시 0비용).
// 합성 결과(compositeTo) 위에 눈금자/그리드/가이드를 오버레이로 그린다.

// 눈금자 두께(CSS px). 켜졌을 때 뷰포트 상/좌에 차지하는 띠의 크기.
export const RULER_SIZE = 18;

export class Renderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this._dirty = true;
    this._checker = this._makeChecker();
    // 눈금자 위 현재 커서 위치 표시용(화면 좌표, 캔버스 기준). 없으면 null.
    this._cursor = null;
    this._bindCursor();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // 눈금자의 커서 위치 표시를 위해 캔버스 포인터 이동을 직접 추적한다.
  // (tool-manager를 건드리지 않도록 렌더러가 자체적으로 구독)
  _bindCursor() {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      this._cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      // 눈금자가 켜져 있을 때만 커서 추적으로 재렌더(불필요한 렌더 방지)
      if (this.app.state?.showRulers) this._dirty = true;
    });
    c.addEventListener("pointerleave", () => {
      if (this._cursor) {
        this._cursor = null;
        if (this.app.state?.showRulers) this._dirty = true;
      }
    });
  }

  requestRender() { this._dirty = true; }

  // 뷰포트 크기 변화에 맞춰 캔버스 내부 해상도(물리 픽셀)를 갱신
  resize() {
    const vp = this.app.viewport;
    vp.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(vp.cssWidth * vp.dpr));
    const h = Math.max(1, Math.round(vp.cssHeight * vp.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = vp.cssWidth + "px";
      this.canvas.style.height = vp.cssHeight + "px";
    }
    this._dirty = true;
  }

  _loop() {
    if (this._dirty) {
      this._dirty = false;
      try { this._render(); } catch (e) { console.error("렌더 오류:", e); }
    }
    requestAnimationFrame(this._loop);
  }

  _render() {
    const ctx = this.ctx;
    const vp = this.app.viewport;
    const lm = this.app.layers;

    // 1) 물리 픽셀 전체를 투명하게 비운다 (뒤 빈 공간은 CSS 배경색)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!lm.width) return;

    // 2) CSS 좌표계(고DPI 보정)
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);

    const tl = vp.worldToScreen(0, 0);
    const sw = lm.width * vp.zoom;
    const sh = lm.height * vp.zoom;

    // 3) 문서 영역 체커보드(투명 표현) — 화면 좌표 고정 크기 패턴
    ctx.fillStyle = this._checker;
    ctx.fillRect(tl.x, tl.y, sw, sh);

    // 4) 레이어 합성(문서 좌표계). 확대 시 픽셀 또렷, 축소 시 부드럽게.
    ctx.save();
    ctx.translate(vp.panX, vp.panY);
    ctx.scale(vp.zoom, vp.zoom);
    ctx.imageSmoothingEnabled = vp.zoom < 1;
    lm.compositeTo(ctx);
    ctx.restore();

    // 5) 문서 테두리
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(sw), Math.round(sh));

    // 6) 그리드(문서 영역 안에서만) → 선택 영역 마칭앤츠 → 활성 도구 오버레이
    //    (모두 화면 좌표계로 그림 → 줌과 무관하게 선 두께 일정)
    this._drawGrid(ctx, vp, tl, sw, sh);
    this.app.selection?.drawOverlay(ctx, vp);
    const tool = this.app.tools?.active;
    if (tool && tool.drawOverlay) tool.drawOverlay(ctx, vp);

    // 6.5) 빠른 마스크 오버레이(비선택 영역 빨강 반투명) — 문서 좌표계로 합성
    const qm = this.app.quickMask;
    if (qm?.active) {
      const ov = qm.buildOverlay();
      if (ov) {
        // putImageData는 변환을 무시하므로 임시 캔버스에 올린 뒤 줌/팬 적용해 drawImage
        let oc = this._qmCanvas;
        if (!oc || oc.width !== ov.width || oc.height !== ov.height) {
          oc = this._qmCanvas = document.createElement("canvas");
          oc.width = ov.width; oc.height = ov.height;
          this._qmCtx = oc.getContext("2d");
        }
        this._qmCtx.putImageData(ov, 0, 0);
        ctx.save();
        ctx.translate(vp.panX, vp.panY);
        ctx.scale(vp.zoom, vp.zoom);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(oc, 0, 0);
        ctx.restore();
      }
    }

    // 7) 가이드 선(문서 좌표 → 화면). 도구 오버레이 위, 눈금자 아래.
    this._drawGuides(ctx, vp);

    // 8) 눈금자(뷰포트 상/좌 띠) — 항상 맨 위에 불투명하게.
    this._drawRulers(ctx, vp);
  }

  // ── 그리드: 문서 영역 위에 gridSize(문서 px) 간격의 격자선 ──
  // 화면 좌표로 그리되 문서 사각형(tl,sw,sh)으로 클립해 캔버스 밖으로 새지 않게 한다.
  _drawGrid(ctx, vp, tl, sw, sh) {
    const st = this.app.state;
    if (!st?.showGrid) return;
    const size = st.gridSize > 0 ? st.gridSize : 32;
    const step = size * vp.zoom; // 화면상 격자 간격(px)
    // 너무 촘촘하면(축소 과다) 그리지 않음 — 화면이 새까매지는 것 방지
    if (step < 4) return;

    const x0 = tl.x, y0 = tl.y;
    const x1 = tl.x + sw, y1 = tl.y + sh;

    ctx.save();
    // 문서 영역으로 클립
    ctx.beginPath();
    ctx.rect(x0, y0, sw, sh);
    ctx.clip();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    // 세로선: 문서 왼쪽(world 0)에서 size 간격
    for (let wx = 0, sx = x0; sx <= x1 + 0.5; wx += size, sx = x0 + wx * vp.zoom) {
      const px = Math.round(sx) + 0.5;
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y1);
    }
    // 가로선
    for (let wy = 0, sy = y0; sy <= y1 + 0.5; wy += size, sy = y0 + wy * vp.zoom) {
      const py = Math.round(sy) + 0.5;
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── 가이드: state.guides의 수평/수직 선을 뷰포트 전체 폭/높이로 그림 ──
  _drawGuides(ctx, vp) {
    const st = this.app.state;
    if (!st?.showGuides || !st.guides || st.guides.length === 0) return;
    const W = vp.cssWidth, H = vp.cssHeight;
    // 눈금자가 켜져 있으면 그 띠 영역은 가이드가 침범하지 않도록 시작점을 민다.
    const off = st.showRulers ? RULER_SIZE : 0;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,170,255,0.9)"; // 시안 계열(포토샵 가이드 느낌)
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const g of st.guides) {
      if (g.orient === "h") {
        const s = vp.worldToScreen(0, g.pos);
        const py = Math.round(s.y) + 0.5;
        if (py < off || py > H) continue;
        ctx.moveTo(off, py);
        ctx.lineTo(W, py);
      } else {
        const s = vp.worldToScreen(g.pos, 0);
        const px = Math.round(s.x) + 0.5;
        if (px < off || px > W) continue;
        ctx.moveTo(px, off);
        ctx.lineTo(px, H);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── 눈금자: 상단(가로)·좌측(세로) 띠. 문서 좌표 기준 눈금/숫자, 줌 반영 ──
  _drawRulers(ctx, vp) {
    const st = this.app.state;
    if (!st?.showRulers) return;
    const R = RULER_SIZE;
    const W = vp.cssWidth, H = vp.cssHeight;

    ctx.save();
    ctx.setLineDash([]);
    ctx.font = "9px 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";

    // 띠 배경
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(0, 0, W, R);        // 상단 가로 띠
    ctx.fillRect(0, 0, R, H);        // 좌측 세로 띠
    // 좌상단 모서리(교차부)
    ctx.fillStyle = "#202020";
    ctx.fillRect(0, 0, R, R);

    // 눈금 간격: 문서 좌표 step을 화면 픽셀로 환산해 적당히(40~80px) 유지하도록 선택
    const step = this._rulerStep(vp.zoom);
    const tickColor = "rgba(255,255,255,0.55)";
    const textColor = "rgba(255,255,255,0.8)";

    // 화면에 보이는 문서 좌표 범위
    const worldLeft = vp.screenToWorld(R, R).x;
    const worldRight = vp.screenToWorld(W, R).x;
    const worldTop = vp.screenToWorld(R, R).y;
    const worldBottom = vp.screenToWorld(R, H).y;

    // ── 상단 가로 눈금 ──
    ctx.beginPath();
    ctx.strokeStyle = tickColor;
    ctx.fillStyle = textColor;
    const startX = Math.floor(worldLeft / step) * step;
    for (let wx = startX; wx <= worldRight; wx += step) {
      const sx = Math.round(vp.worldToScreen(wx, 0).x) + 0.5;
      if (sx < R) continue;
      ctx.moveTo(sx, R);
      ctx.lineTo(sx, R - 6);
      ctx.fillText(String(Math.round(wx)), sx + 2, 2);
      // 중간(절반) 눈금
      const sxh = Math.round(vp.worldToScreen(wx + step / 2, 0).x) + 0.5;
      if (sxh >= R && sxh <= W) { ctx.moveTo(sxh, R); ctx.lineTo(sxh, R - 3); }
    }
    ctx.stroke();

    // ── 좌측 세로 눈금 ── (숫자는 90° 회전해 세로로 표기)
    ctx.beginPath();
    ctx.strokeStyle = tickColor;
    const startY = Math.floor(worldTop / step) * step;
    for (let wy = startY; wy <= worldBottom; wy += step) {
      const sy = Math.round(vp.worldToScreen(0, wy).y) + 0.5;
      if (sy < R) continue;
      ctx.moveTo(R, sy);
      ctx.lineTo(R - 6, sy);
      const syh = Math.round(vp.worldToScreen(0, wy + step / 2).y) + 0.5;
      if (syh >= R && syh <= H) { ctx.moveTo(R, syh); ctx.lineTo(R - 3, syh); }
    }
    ctx.stroke();
    // 세로 숫자(회전)
    ctx.fillStyle = textColor;
    for (let wy = startY; wy <= worldBottom; wy += step) {
      const sy = Math.round(vp.worldToScreen(0, wy).y) + 0.5;
      if (sy < R) continue;
      ctx.save();
      ctx.translate(2, sy + 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(String(Math.round(wy)), 0, 0);
      ctx.restore();
    }

    // ── 현재 커서 위치 표시(빨간 마커) ──
    if (this._cursor) {
      ctx.strokeStyle = "rgba(255,60,60,0.9)";
      ctx.beginPath();
      if (this._cursor.x >= R) { ctx.moveTo(this._cursor.x + 0.5, 0); ctx.lineTo(this._cursor.x + 0.5, R); }
      if (this._cursor.y >= R) { ctx.moveTo(0, this._cursor.y + 0.5); ctx.lineTo(R, this._cursor.y + 0.5); }
      ctx.stroke();
    }

    // 띠 경계선
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.moveTo(0, R + 0.5); ctx.lineTo(W, R + 0.5);
    ctx.moveTo(R + 0.5, 0); ctx.lineTo(R + 0.5, H);
    ctx.stroke();

    ctx.restore();
  }

  // 줌 배율에 따라 "보기 좋은" 눈금 간격(문서 px)을 고른다.
  // 화면상 한 칸이 대략 50~100px가 되도록 1·2·5·10 계열에서 선택.
  _rulerStep(zoom) {
    const target = 64;            // 목표 화면 픽셀 간격
    const raw = target / zoom;    // 그에 해당하는 문서 px
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    let mult;
    if (n < 1.5) mult = 1;
    else if (n < 3) mult = 2;
    else if (n < 7) mult = 5;
    else mult = 10;
    return Math.max(1, mult * pow);
  }

  // 투명 배경을 나타내는 회색 체커보드 패턴 생성
  _makeChecker() {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, 16, 16);
    x.fillStyle = "#cfcfcf"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(c, "repeat");
  }
}
