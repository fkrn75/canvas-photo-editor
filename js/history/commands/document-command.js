// document-command.js — 문서 전체 변형(리사이즈/자르기/회전/뒤집기) undo/redo.
// applyFn(lm)이 모든 레이어 캔버스를 변형한다. 실행 전/후의 모든 레이어 픽셀을 보관해 복원한다.

import { EVT } from "../../core/constants.js";

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
    return this.lm.layers.map((l) => {
      // 픽셀 + 비파괴 속성(마스크/블렌드/조정 메타)을 함께 보관해 undo 시 유실되지 않게 한다.
      const rec = {
        id: l.id, name: l.name, opacity: l.opacity, visible: l.visible,
        w: l.width, h: l.height, data: l.snapshot(),
        maskEnabled: l.maskEnabled, maskActive: l.maskActive,
        blendMode: l.blendMode, fillOpacity: l.fillOpacity, clipped: l.clipped,
        type: l.type, adjustmentType: l.adjustmentType,
        adjustmentParams: l.adjustmentParams ? JSON.parse(JSON.stringify(l.adjustmentParams)) : null,
        mask: null, maskW: 0, maskH: 0,
      };
      if (l.mask) {
        rec.maskW = l.mask.width; rec.maskH = l.mask.height;
        const mc = l.maskCtx || l.mask.getContext("2d", { willReadFrequently: true });
        rec.mask = mc.getImageData(0, 0, l.mask.width, l.mask.height);
      }
      return rec;
    });
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
      // 비파괴 속성 복원(보관된 경우에만)
      if (s.blendMode !== undefined) layer.blendMode = s.blendMode;
      if (s.fillOpacity !== undefined) layer.fillOpacity = s.fillOpacity;
      if (s.clipped !== undefined) layer.clipped = s.clipped;
      if (s.type !== undefined) layer.type = s.type;
      if (s.adjustmentType !== undefined) layer.adjustmentType = s.adjustmentType;
      if (s.adjustmentParams !== undefined) {
        layer.adjustmentParams = s.adjustmentParams ? JSON.parse(JSON.stringify(s.adjustmentParams)) : null;
      }
      // 마스크 복원: 보관된 마스크가 있으면 새 캔버스로 재생성, 없으면 제거
      if (s.mask) {
        const m = document.createElement("canvas");
        m.width = s.maskW; m.height = s.maskH;
        m.getContext("2d", { willReadFrequently: true }).putImageData(s.mask, 0, 0);
        layer.attachMask(m);
        layer.maskEnabled = s.maskEnabled;
        layer.maskActive = s.maskActive;
      } else if (layer.mask) {
        layer.removeMask();
      }
      layer.thumbDirty = true;
    }
    this._notify();
  }

  _notify() {
    this.lm.notifyStructure();
    this.lm.app.bus.emit(EVT.DOCUMENT_CHANGED, { width: this.lm.width, height: this.lm.height });
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
