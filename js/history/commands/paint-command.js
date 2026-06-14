// paint-command.js — 픽셀 편집 undo/redo 커맨드
// 변경 영역(box)의 변경 전/후 ImageData만 보관하므로 1px 점은 수십 바이트로 저렴하다.

export class PaintCommand {
  constructor(layerManager, layerId, x, y, before, after, label = "그리기") {
    this.lm = layerManager;
    this.layerId = layerId;
    this.x = x;
    this.y = y;
    this.before = before; // 변경 전 ImageData (box 크기)
    this.after = after;   // 변경 후 ImageData (box 크기)
    this.label = label;
    this.memoryBytes = before.data.length + after.data.length;
  }

  undo() {
    const layer = this.lm.byId(this.layerId);
    if (!layer) return;
    layer.ctx.putImageData(this.before, this.x, this.y);
    this.lm.notifyContent(this.layerId);
  }

  redo() {
    const layer = this.lm.byId(this.layerId);
    if (!layer) return;
    layer.ctx.putImageData(this.after, this.x, this.y);
    this.lm.notifyContent(this.layerId);
  }
}
