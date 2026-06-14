// renderer.js — 표시 캔버스에 합성 결과를 그린다.
// requestAnimationFrame 루프를 돌되 dirty 플래그가 설정된 프레임에서만 실제 렌더(유휴 시 0비용).

export class Renderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this._dirty = true;
    this._checker = this._makeChecker();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
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

    // 6) 선택 영역 마칭앤츠 + 활성 도구 오버레이 (화면 좌표계로 그림 → 선 두께 일정)
    this.app.selection?.drawOverlay(ctx, vp);
    const tool = this.app.tools?.active;
    if (tool && tool.drawOverlay) tool.drawOverlay(ctx, vp);
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
