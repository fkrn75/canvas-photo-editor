// selection-manager.js — 선택 영역 관리.
// mask: Uint8Array(문서 w*h), 값 255=선택/0=비선택. mask가 null이면 "선택 없음(=전체)".
// outline: 마칭앤츠 시각화를 위한 월드 좌표 폴리곤 링 배열.

import { EVT } from "../core/constants.js";

export class SelectionManager {
  constructor(app) {
    this.app = app;
    this.mask = null;
    this.bounds = null;   // {x,y,w,h}
    this.outline = null;  // [[{x,y}, ...], ...]
    this._dash = 0;
    this._timer = null;
  }

  get active() { return this.mask !== null; }

  clear() {
    if (!this.mask) return;
    this.mask = null; this.bounds = null; this.outline = null;
    this._stopAnts();
    this.app.renderer?.requestRender();
    this.app.bus.emit(EVT.SELECTION_CHANGED, { active: false });
  }

  _commit(mask, bounds, outline) {
    this.mask = mask; this.bounds = bounds; this.outline = outline;
    this._startAnts();
    this.app.renderer?.requestRender();
    this.app.bus.emit(EVT.SELECTION_CHANGED, { active: true, bounds });
  }

  selectAll() {
    const w = this.app.layers.width, h = this.app.layers.height;
    const mask = new Uint8Array(w * h).fill(255);
    this._commit(mask, { x: 0, y: 0, w, h },
      [[{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]]);
  }

  // 사각형 선택
  setRect(x, y, w, h) {
    const W = this.app.layers.width, H = this.app.layers.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) { this.clear(); return; }
    const mask = new Uint8Array(W * H);
    for (let yy = y0; yy < y1; yy++) mask.fill(255, yy * W + x0, yy * W + x1);
    this._commit(mask, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]);
  }

  // 폴리곤(올가미) 선택: 임시 캔버스에 채운 뒤 알파를 마스크로 추출
  setPolygon(points) {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (!points || points.length < 3) { this.clear(); return; }
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.beginPath();
    x.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) x.lineTo(points[i].x, points[i].y);
    x.closePath();
    x.fill();
    const data = x.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] >= 128) {
        mask[i] = 255;
        const px = i % W, py = (i / W) | 0;
        if (px < minX) minX = px; if (py < minY) minY = py;
        if (px > maxX) maxX = px; if (py > maxY) maxY = py;
      }
    }
    if (maxX < 0) { this.clear(); return; }
    this._commit(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, [points.slice()]);
  }

  // 마스크 직접 설정(매직완드 등). 외곽선은 bounds 사각형으로 근사.
  setMask(mask, bounds) {
    const b = bounds;
    this._commit(mask, b,
      [[{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]]);
  }

  // (x,y) 픽셀이 선택 영역인가
  isSelected(x, y) {
    if (!this.mask) return true;
    const W = this.app.layers.width;
    return this.mask[y * W + x] > 0;
  }

  // 선택 영역 밖 픽셀을 원본(original)으로 되돌려 modified를 선택 영역으로 한정한다.
  // box는 modified/original이 대응하는 문서상의 {x,y,w,h}.
  clipImageData(modified, original, box) {
    if (!this.mask) return modified;
    const W = this.app.layers.width;
    const md = modified.data, od = original.data;
    for (let row = 0; row < box.h; row++) {
      for (let col = 0; col < box.w; col++) {
        const gx = box.x + col, gy = box.y + row;
        if (this.mask[gy * W + gx] === 0) {
          const i = (row * box.w + col) * 4;
          md[i] = od[i]; md[i + 1] = od[i + 1]; md[i + 2] = od[i + 2]; md[i + 3] = od[i + 3];
        }
      }
    }
    return modified;
  }

  // 도구가 선택 영역으로 클립 패스를 적용할 때 사용 (브러시 등). ctx는 문서 좌표계.
  applyClipPath(ctx) {
    if (!this.outline) return false;
    ctx.beginPath();
    for (const ring of this.outline) {
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
      ctx.closePath();
    }
    ctx.clip();
    return true;
  }

  drawOverlay(ctx, vp) {
    if (!this.outline) return;
    ctx.save();
    ctx.lineWidth = 1;
    for (const ring of this.outline) {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const p = vp.worldToScreen(ring[i].x, ring[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this._dash;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.stroke();
    }
    ctx.restore();
  }

  _startAnts() {
    this._stopAnts();
    // 마칭앤츠 애니메이션: 주기적으로 점선 오프셋을 바꾸며 재렌더 요청
    this._timer = setInterval(() => {
      this._dash = (this._dash + 1) % 8;
      this.app.renderer?.requestRender();
    }, 90);
  }
  _stopAnts() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}
