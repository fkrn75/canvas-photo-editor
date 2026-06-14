// hand-tool.js — 손바닥(팬). 화면 이동량만큼 뷰포트를 이동한다. (스페이스 누름으로 임시 전환도 가능)

import { BaseTool } from "./base-tool.js";

export class HandTool extends BaseTool {
  get cursor() { return "grab"; }

  onPointerDown(pt, e) {
    this.panning = true;
    this.lastClient = { x: e.clientX, y: e.clientY };
  }
  onPointerMove(pt, e) {
    if (!this.panning) return;
    const dx = e.clientX - this.lastClient.x;
    const dy = e.clientY - this.lastClient.y;
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.app.viewport.pan(dx, dy);
  }
  onPointerUp() { this.panning = false; }
}
