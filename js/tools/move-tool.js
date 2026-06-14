// move-tool.js — 활성 레이어의 픽셀 전체를 드래그로 이동한다.

import { BaseTool } from "./base-tool.js";

export class MoveTool extends BaseTool {
  get cursor() { return "move"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockPosition) { this.app.status("위치가 잠겨 있어 이동할 수 없습니다."); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 이동할 수 없습니다."); return; }
    this.layer = layer;
    this.moving = true;
    this.start = pt;
    this.snapshot = layer.snapshot();   // 이동 기준 원본
    this.history.beginPixelEdit(layer);
  }

  onPointerMove(pt, e) {
    if (!this.moving) return;
    let dx = Math.round(pt.x - this.start.x);
    let dy = Math.round(pt.y - this.start.y);
    if (e.shiftKey) { // Shift: 수평/수직 고정
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    const ctx = this.layer.ctx;
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    ctx.putImageData(this.snapshot, dx, dy);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    if (!this.moving) return;
    this.moving = false;
    this.snapshot = null;
    this.history.commitPixelEdit(null, "이동"); // 레이어 전체 저장
    this.layer = null;
  }
}
