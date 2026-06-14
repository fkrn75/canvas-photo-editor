// command-manager.js — undo/redo 스택 관리 + 픽셀 편집 보조(begin/commit)
// 두 종류의 커맨드를 다룬다.
//   1) 구조/속성 커맨드: execute()로 처음 실행(redo) 후 스택에 push
//   2) 픽셀 편집(PaintCommand): 도구가 직접 그린 뒤 push()만 (이미 적용됨)

import { EVT, HISTORY_LIMIT } from "../core/constants.js";
import { PaintCommand } from "./commands/paint-command.js";
import { cropImageData, clampBox } from "../engine/imagedata.js";

export class CommandManager {
  constructor(app) {
    this.app = app;
    this.undoStack = [];
    this.redoStack = [];
    this._bytes = 0;
    // 픽셀 편집 진행 상태
    this._peLayer = null;
    this._peBefore = null;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // 구조/속성 커맨드: 처음 적용 + 스택 push
  execute(cmd) {
    cmd.redo();
    this._push(cmd);
  }

  // 이미 적용된 커맨드를 스택에만 넣음
  push(cmd) {
    this._push(cmd);
  }

  _push(cmd) {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this._bytes += cmd.memoryBytes || 0;
    this._enforceLimit();
    this.app.bus.emit(EVT.HISTORY_CHANGED, { canUndo: this.canUndo, canRedo: this.canRedo });
  }

  // 메모리/단계 상한 초과 시 오래된 항목부터 폐기
  _enforceLimit() {
    while (
      this.undoStack.length > HISTORY_LIMIT.steps ||
      (this._bytes > HISTORY_LIMIT.bytes && this.undoStack.length > 1)
    ) {
      const old = this.undoStack.shift();
      this._bytes -= old.memoryBytes || 0;
    }
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.app.bus.emit(EVT.HISTORY_CHANGED, { canUndo: this.canUndo, canRedo: this.canRedo });
    this.app.status(`실행 취소: ${cmd.label}`);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.app.bus.emit(EVT.HISTORY_CHANGED, { canUndo: this.canUndo, canRedo: this.canRedo });
    this.app.status(`다시 실행: ${cmd.label}`);
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._bytes = 0;
    this.app.bus.emit(EVT.HISTORY_CHANGED, { canUndo: false, canRedo: false });
  }

  // ── 픽셀 편집 보조 ──
  // 도구가 그리기를 시작하기 직전에 호출: 대상 레이어의 현재 전체 픽셀을 임시 보관한다.
  beginPixelEdit(layer) {
    this._peLayer = layer;
    this._peBefore = layer.snapshot();
  }

  // 그리기 종료 시 호출: 변경된 영역(box)만 잘라 before/after를 PaintCommand로 저장한다.
  // box가 없으면(null) 레이어 전체를 저장한다.
  commitPixelEdit(box, label = "그리기") {
    const layer = this._peLayer;
    const before = this._peBefore;
    this._peLayer = null;
    this._peBefore = null;
    if (!layer || !before) return;

    const clamped = box
      ? clampBox(box, layer.width, layer.height)
      : { x: 0, y: 0, w: layer.width, h: layer.height };
    if (!clamped || clamped.w <= 0 || clamped.h <= 0) {
      this.app.layers.notifyContent(layer.id);
      return;
    }

    const beforeCrop = cropImageData(before, clamped);
    const afterCrop = layer.ctx.getImageData(clamped.x, clamped.y, clamped.w, clamped.h);
    this.push(new PaintCommand(this.app.layers, layer.id, clamped.x, clamped.y, beforeCrop, afterCrop, label));
    this.app.layers.notifyContent(layer.id);
  }

  // 진행 중 편집을 취소(되돌림)하고 싶을 때
  cancelPixelEdit() {
    if (this._peLayer && this._peBefore) {
      this._peLayer.restore(this._peBefore);
      this.app.layers.notifyContent(this._peLayer.id);
    }
    this._peLayer = null;
    this._peBefore = null;
  }
}
