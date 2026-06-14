// base-tool.js — 모든 도구의 공통 기반.
// ToolManager가 포인터 이벤트를 월드 좌표로 변환해 onPointerDown/Move/Up으로 위임한다.

export class BaseTool {
  constructor(app, id) {
    this.app = app;
    this.id = id;
  }

  get state() { return this.app.state; }
  get layers() { return this.app.layers; }
  get history() { return this.app.history; }
  get selection() { return this.app.selection; }

  // 라이프사이클
  onActivate() {}
  onDeactivate() {}

  // 포인터 (pt = 월드좌표 {x,y}, e = PointerEvent)
  onPointerDown(pt, e) {}
  onPointerMove(pt, e) {}
  onPointerUp(pt, e) {}
  onLeave() {}

  // 캔버스 위 오버레이. ctx는 화면(CSS) 좌표계, vp.worldToScreen으로 변환해 그린다.
  drawOverlay(ctx, vp) {}

  // CSS 커서
  get cursor() { return "crosshair"; }

  // 편집 대상 레이어 확보. 없거나 숨김이면 안내 후 null.
  ensureLayer() {
    const layer = this.layers.activeLayer;
    if (!layer) { this.app.status("레이어가 없습니다."); return null; }
    if (!layer.visible) { this.app.status("숨겨진 레이어는 편집할 수 없습니다. 레이어를 표시하세요."); return null; }
    return layer;
  }
}
