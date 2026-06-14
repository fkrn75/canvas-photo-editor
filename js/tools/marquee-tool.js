// marquee-tool.js — 사각형/타원/행/열 선택.
// app.state.marqueeMode 로 모양을 고른다:
//   "rect"    드래그 사각형 (기본)
//   "ellipse" 드래그 사각형에 내접하는 타원
//   "row"     클릭한 y행 전체(폭=문서폭, 높이 1px)
//   "col"     클릭한 x열 전체(높이=문서높이, 폭 1px)
// rect/ellipse는 드래그 중 Shift=정사각형(원) 고정, Alt=시작점을 중심으로 그린다.
// row/col은 한 번 클릭하면 그 줄 전체를 선택한다(드래그 무관).
// 선택은 selection-manager의 setRect/setEllipse/setRowCol으로 위임하며 마칭앤츠는 그쪽이 담당.

import { BaseTool } from "./base-tool.js";

export class MarqueeTool extends BaseTool {
  get cursor() { return "crosshair"; }

  // 현재 모드(미설정이면 rect)
  _mode() { return this.state.marqueeMode || "rect"; }

  onPointerDown(pt, e) {
    this.sel = true;
    this.start = pt;
    this.end = pt;
    this.mode = this._mode(); // 드래그 도중 모드가 바뀌어도 일관되게 시작 시점 고정
  }

  onPointerMove(pt, e) {
    if (!this.sel) return;
    this.end = pt;
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    if (!this.sel) return;
    this.sel = false;
    this.end = pt;
    const mode = this.mode;

    if (mode === "row" || mode === "col") {
      // 행/열: 클릭 지점 기준으로 한 줄 선택
      this.selection.setRowCol(mode, pt.x, pt.y);
      return;
    }

    // rect/ellipse: 드래그 사각형 산출(Shift=정사각, Alt=중심 기준)
    const r = this._rectFromDrag(e);
    if (r.w < 2 || r.h < 2) { this.selection.clear(); return; }
    if (mode === "ellipse") this.selection.setEllipse(r.x, r.y, r.w, r.h);
    else this.selection.setRect(r.x, r.y, r.w, r.h);
  }

  // 시작점→끝점 드래그를 Shift(정사각형)·Alt(중심 기준) 보정해 {x,y,w,h}로 변환.
  _rectFromDrag(e) {
    let dx = this.end.x - this.start.x;
    let dy = this.end.y - this.start.y;
    if (e && e.shiftKey) {
      // 정사각형: 더 긴 축에 맞추고 부호는 보존
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
    if (e && e.altKey) {
      // 시작점을 중심으로: 양방향으로 펼친다
      return {
        x: this.start.x - Math.abs(dx),
        y: this.start.y - Math.abs(dy),
        w: Math.abs(dx) * 2,
        h: Math.abs(dy) * 2,
      };
    }
    return {
      x: Math.min(this.start.x, this.start.x + dx),
      y: Math.min(this.start.y, this.start.y + dy),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
  }

  drawOverlay(ctx, vp) {
    if (!this.sel) return;
    const mode = this.mode;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    if (mode === "row" || mode === "col") {
      // 행/열: 커서가 가리키는 1px 줄을 미리보기로 표시
      const W = this.layers.width, H = this.layers.height;
      if (mode === "row") {
        const a = vp.worldToScreen(0, this.end.y);
        const b = vp.worldToScreen(W, this.end.y);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else {
        const a = vp.worldToScreen(this.end.x, 0);
        const b = vp.worldToScreen(this.end.x, H);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // rect/ellipse: 드래그 사각형을 산출해 외곽선 미리보기
    // (drawOverlay에는 이벤트가 없으므로 현재 키 상태는 알 수 없다 → 드래그 좌표 그대로 사용)
    const x = Math.min(this.start.x, this.end.x);
    const y = Math.min(this.start.y, this.end.y);
    const w = Math.abs(this.end.x - this.start.x);
    const h = Math.abs(this.end.y - this.start.y);
    const a = vp.worldToScreen(x, y);
    const b = vp.worldToScreen(x + w, y + h);
    if (mode === "ellipse") {
      ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    ctx.restore();
  }
}
