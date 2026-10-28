// layer-image-commands.js — 이미지/레이어 메뉴 확장(layer-image 작업)용 undo/redo 커맨드 모음.
// 기존 커맨드 파일은 수정하지 않고 여기에 새로 둔다. 인터페이스는 동일: { label, memoryBytes, redo(), undo() }.

import { DocumentTransformCommand } from "./document-command.js";

function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }

// 벡터 소스 데이터 키(텍스트/셰이프/벡터 마스크). 문서 변형 시 픽셀과 함께 보관·복원해야 한다.
const VECTOR_KEYS = ["vectorText", "vectorShape", "vectorMask"];

// ── 여러 커맨드를 히스토리 1단계로 묶기 ──
// redo: 순서대로, undo: 역순으로. 각 하위 커맨드는 "아직 적용 안 된" 상태로 만들어 넘긴다.
export class CompoundCommand {
  constructor(label, cmds) {
    this.label = label;
    this.cmds = cmds;
    this.memoryBytes = cmds.reduce((s, c) => s + (c.memoryBytes || 0), 0);
  }
  redo() { for (const c of this.cmds) c.redo(); }
  undo() { for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(); }
}

// ── 문서 변형 + 벡터 데이터 보존 ──
// 기본 DocumentTransformCommand 는 픽셀·마스크·속성만 보관한다. 이미지 크기/캔버스 크기/회전/재단은
// 텍스트·셰이프·벡터 마스크의 좌표도 바꾸므로, 그 데이터까지 스냅샷에 넣어 undo 시 함께 되돌린다.
export class DocTransformVectorCommand extends DocumentTransformCommand {
  _capture() {
    const recs = super._capture();
    for (const r of recs) {
      const l = this.lm.byId(r.id);
      r.vec = {};
      for (const k of VECTOR_KEYS) r.vec[k] = l ? clone(l[k]) : null;
    }
    return recs;
  }
  _restore(snap, w, h) {
    for (const s of snap) {
      const l = this.lm.byId(s.id);
      if (!l || !s.vec) continue;
      for (const k of VECTOR_KEYS) {
        if (s.vec[k]) l[k] = clone(s.vec[k]);
        else if (l[k] !== undefined) l[k] = null;
      }
    }
    super._restore(snap, w, h);
  }
}

// ── 레이어 평행 이동(정렬용) ──
// 이동 도구와 같은 규칙: 레이어 픽셀만 옮기고(마스크는 그대로), 텍스트/셰이프 소스 좌표도 같은 델타로 이동.
// 이동 도구(PaintCommand)는 벡터 좌표를 undo 하지 못하지만 여기서는 함께 되돌린다.
export class LayerShiftCommand {
  constructor(lm, layer, dx, dy, label = "레이어 이동") {
    this.lm = lm; this.id = layer.id; this.dx = dx; this.dy = dy; this.label = label;
    this.before = layer.snapshot();
    this.textBefore = clone(layer.vectorText);
    this.shapeBefore = clone(layer.vectorShape);
    this.memoryBytes = this.before.data.length;
  }
  _layer() { return this.lm.byId(this.id); }
  redo() {
    const L = this._layer();
    if (!L) return;
    L.ctx.clearRect(0, 0, L.width, L.height);
    L.ctx.putImageData(this.before, this.dx, this.dy);
    const dx = this.dx, dy = this.dy;
    if (this.textBefore) { const t = clone(this.textBefore); t.x += dx; t.y += dy; L.vectorText = t; }
    if (this.shapeBefore) {
      const s = clone(this.shapeBefore);
      if (s.rect) { s.rect.x += dx; s.rect.y += dy; }
      if (s.polygon) { s.polygon.cx += dx; s.polygon.cy += dy; }
      if (s.path) for (const a of s.path.anchors) { a.x += dx; a.y += dy; a.inX += dx; a.inY += dy; a.outX += dx; a.outY += dy; }
      L.vectorShape = s;
    }
    this.lm.notifyContent(this.id);
  }
  undo() {
    const L = this._layer();
    if (!L) return;
    L.ctx.putImageData(this.before, 0, 0);
    if (this.textBefore) L.vectorText = clone(this.textBefore);
    if (this.shapeBefore) L.vectorShape = clone(this.shapeBefore);
    this.lm.notifyContent(this.id);
  }
}

// ── 레이어 픽셀 + 마스크 + 벡터 마스크를 통째로 바꾸는 커맨드 ──
// (투명도에서 마스크 만들기 / 레이어 마스크 적용) 변경 전·후 상태를 모두 보관해 그대로 교체한다.
// state: { pixels: ImageData, mask: canvas|null, maskEnabled, maskActive, vectorMask }
export class LayerPixelMaskCommand {
  constructor(lm, layer, before, after, label) {
    this.lm = lm; this.id = layer.id; this.label = label;
    this.before = before; this.after = after;
    this.memoryBytes = (before.pixels?.data.length || 0) + (after.pixels?.data.length || 0)
      + lm.width * lm.height * 4;
  }
  _apply(st) {
    const L = this.lm.byId(this.id);
    if (!L) return;
    if (st.pixels) L.ctx.putImageData(st.pixels, 0, 0);
    if (st.mask) {
      L.attachMask(st.mask);
      L.maskEnabled = st.maskEnabled;
      L.maskActive = st.maskActive;
    } else if (L.mask) {
      L.removeMask();
    }
    L.vectorMask = clone(st.vectorMask);
    L.thumbDirty = true;
    this.lm.notifyContent(this.id);
    this.lm.notifyStructure(); // 마스크 유무가 바뀌면 레이어 패널 썸네일 구조도 갱신
  }
  redo() { this._apply(this.after); }
  undo() { this._apply(this.before); }
}
