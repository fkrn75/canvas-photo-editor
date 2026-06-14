// document-command.js — 문서 전체 변형(리사이즈/자르기/회전/뒤집기) undo/redo.
// applyFn(lm)이 모든 레이어 캔버스를 변형한다. 실행 전/후의 모든 레이어 픽셀을 보관해 복원한다.

export class DocumentTransformCommand {
  constructor(lm, label, applyFn) {
    this.lm = lm;
    this.label = label;
    this.applyFn = applyFn;
    this.beforeW = lm.width;
    this.beforeH = lm.height;
    this.before = this._capture();
    this.memoryBytes = this.beforeW * this.beforeH * 4 * Math.max(1, lm.layers.length);
    this._after = null;
  }

  // 현재 모든 레이어의 픽셀/속성 스냅샷
  _capture() {
    return this.lm.layers.map((l) => ({
      id: l.id, name: l.name, opacity: l.opacity, visible: l.visible,
      w: l.width, h: l.height, data: l.snapshot(),
    }));
  }

  // 스냅샷으로 레이어들을 되돌린다 (캔버스 크기까지 복원)
  _restore(snap, w, h) {
    const lm = this.lm;
    lm.width = w; lm.height = h;
    for (const s of snap) {
      const layer = lm.byId(s.id);
      if (!layer) continue;
      layer.canvas.width = s.w;
      layer.canvas.height = s.h;
      layer.ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
      layer.ctx.putImageData(s.data, 0, 0);
      layer.opacity = s.opacity;
      layer.visible = s.visible;
      layer.name = s.name;
      layer.thumbDirty = true;
    }
    this._notify();
  }

  _notify() {
    this.lm.notifyStructure();
    this.lm.app.bus.emit("document:changed", { width: this.lm.width, height: this.lm.height });
    this.lm.app.fitIfNeeded?.();
  }

  redo() {
    if (!this._after) {
      this.applyFn(this.lm);       // 최초 실행: 실제 변형
      this._after = this._capture();
      this.afterW = this.lm.width;
      this.afterH = this.lm.height;
      this._notify();
    } else {
      this._restore(this._after, this.afterW, this.afterH);
    }
  }

  undo() { this._restore(this.before, this.beforeW, this.beforeH); }
}
