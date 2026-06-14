// layer-structure-command.js — 레이어 구조/속성 변경 커맨드 모음
// 모두 { label, memoryBytes, redo(), undo() } 인터페이스를 따른다.

import { Layer } from "../../layers/layer.js";
import { blendLayerOnto } from "../../engine/blend.js";

// 레이어 추가
export class AddLayerCommand {
  constructor(lm, layer, index) {
    this.lm = lm; this.layer = layer; this.index = index;
    this.label = "레이어 추가"; this.memoryBytes = 0;
  }
  redo() { this.lm._insert(this.layer, this.index); this.lm.notifyStructure(); }
  undo() {
    const i = this.lm.indexOf(this.layer.id);
    if (i >= 0) this.lm._removeAt(i);
    this.lm.notifyStructure();
  }
}

// 레이어 삭제 (삭제된 레이어를 보관해 복원)
export class RemoveLayerCommand {
  constructor(lm, id, index) {
    this.lm = lm; this.index = index;
    this.layer = lm.byId(id);
    this.label = "레이어 삭제";
    this.memoryBytes = lm.width * lm.height * 4;
  }
  redo() {
    const i = this.lm.indexOf(this.layer.id);
    if (i >= 0) this.lm._removeAt(i);
    this.lm.notifyStructure();
  }
  undo() { this.lm._insert(this.layer, this.index); this.lm.notifyStructure(); }
}

// 레이어 복제
export class DuplicateLayerCommand {
  constructor(lm, srcId) {
    this.lm = lm; this.label = "레이어 복제";
    const src = lm.byId(srcId);
    this.copy = new Layer(lm.width, lm.height, (src?.name || "레이어") + " 사본");
    if (src) {
      this.copy.ctx.drawImage(src.canvas, 0, 0);
      this.copy.opacity = src.opacity;
      this.copy.visible = src.visible;
      this.copy.blendMode = src.blendMode || "normal";
    }
    this.index = lm.indexOf(srcId) + 1;
    this.memoryBytes = lm.width * lm.height * 4;
  }
  redo() { this.lm._insert(this.copy, this.index); this.lm.notifyStructure(); }
  undo() {
    const i = this.lm.indexOf(this.copy.id);
    if (i >= 0) this.lm._removeAt(i);
    this.lm.notifyStructure();
  }
}

// 레이어 순서 이동
export class MoveLayerCommand {
  constructor(lm, id, from, to) {
    this.lm = lm; this.id = id; this.from = from; this.to = to;
    this.label = "레이어 순서 변경"; this.memoryBytes = 0;
  }
  redo() { this.lm._moveTo(this.id, this.to); this.lm.activeId = this.id; this.lm.notifyStructure(); }
  undo() { this.lm._moveTo(this.id, this.from); this.lm.activeId = this.id; this.lm.notifyStructure(); }
}

// 아래 레이어로 병합
export class MergeDownCommand {
  constructor(lm, id) {
    this.lm = lm; this.label = "아래로 병합";
    this.upperIndex = lm.indexOf(id);
    this.upper = lm.byId(id);
    this.lower = lm.layers[this.upperIndex - 1];
    this.lowerBefore = this.lower.snapshot(); // undo용
    this.memoryBytes = lm.width * lm.height * 4;
  }
  redo() {
    // 아래 레이어 캔버스 위에 위 레이어를 자신의 blendMode+불투명도로 합쳐 넣는다.
    // (blendLayerOnto는 ctx.canvas 크기를 문서 크기로 가정 → 레이어 캔버스가 곧 문서 크기이므로 OK)
    blendLayerOnto(this.lower.ctx, this.upper);
    this.lower.ctx.globalAlpha = 1;
    this.lower.ctx.globalCompositeOperation = "source-over";
    this.lower.thumbDirty = true;
    const i = this.lm.indexOf(this.upper.id);
    if (i >= 0) this.lm._removeAt(i);
    this.lm.activeId = this.lower.id;
    this.lm.notifyStructure();
  }
  undo() {
    this.lower.restore(this.lowerBefore);
    this.lm._insert(this.upper, this.upperIndex);
    this.lm.activeId = this.upper.id;
    this.lm.notifyStructure();
  }
}

// 이미지 평탄화: 모든 레이어를 하나로 합친다 (개수가 바뀌므로 별도 커맨드)
export class FlattenCommand {
  constructor(lm) {
    this.lm = lm;
    this.label = "이미지 평탄화";
    this.before = lm.layers.slice();   // 이전 레이어 배열 보관
    this.beforeActive = lm.activeId;
    const flat = lm.flatten();
    this.merged = new Layer(lm.width, lm.height, "배경");
    this.merged.ctx.drawImage(flat, 0, 0);
    this.memoryBytes = lm.width * lm.height * 4 * (lm.layers.length + 1);
  }
  redo() {
    this.lm.layers = [this.merged];
    this.lm.activeId = this.merged.id;
    this.lm.notifyStructure();
  }
  undo() {
    this.lm.layers = this.before.slice();
    this.lm.activeId = this.beforeActive;
    this.lm.notifyStructure();
  }
}

// 보이는 레이어 병합: 보이는 레이어 전부를 블렌드 합성해 하나로 만들고
// 가장 아래 보이는 레이어 위치에 끼워 넣는다. 숨긴 레이어는 그대로 보존.
export class MergeVisibleCommand {
  constructor(lm) {
    this.lm = lm;
    this.label = "보이는 레이어 병합";
    this.before = lm.layers.slice();      // 이전 배열 전체 보관(undo)
    this.beforeActive = lm.activeId;

    // 보이는 레이어 합성 결과(블렌드 인식) — 문서 좌표계 캔버스로 합친다.
    const out = document.createElement("canvas");
    out.width = lm.width; out.height = lm.height;
    lm._composeLayers(lm.layers.filter((l) => l.visible),
                      out.getContext("2d", { willReadFrequently: true }));

    this.merged = new Layer(lm.width, lm.height, "병합됨");
    this.merged.ctx.drawImage(out, 0, 0);
    // 병합 결과는 블렌드가 이미 적용됨 → normal/100%
    this.merged.blendMode = "normal";
    this.merged.opacity = 1;

    // 가장 아래 보이는 레이어의 인덱스(그 자리에 결과를 넣는다)
    this.insertIndex = lm.layers.findIndex((l) => l.visible);
    if (this.insertIndex < 0) this.insertIndex = 0;

    // redo 시 보존할 "숨긴 레이어"들과, 결과가 들어갈 최종 배열을 미리 구성
    this.afterLayers = [];
    let inserted = false;
    for (let i = 0; i < lm.layers.length; i++) {
      const l = lm.layers[i];
      if (l.visible) {
        if (!inserted) { this.afterLayers.push(this.merged); inserted = true; }
        // 보이는 레이어는 결과로 대체되므로 버림
      } else {
        this.afterLayers.push(l); // 숨긴 레이어 보존
      }
    }
    if (!inserted) this.afterLayers.push(this.merged); // 안전망

    this.memoryBytes = lm.width * lm.height * 4;
  }
  redo() {
    this.lm.layers = this.afterLayers.slice();
    this.lm.activeId = this.merged.id;
    this.lm.notifyStructure();
  }
  undo() {
    this.lm.layers = this.before.slice();
    this.lm.activeId = this.beforeActive;
    this.lm.notifyStructure();
  }
}

// 레이어 속성(visible/opacity/name/blendMode) 변경
export class LayerPropCommand {
  constructor(lm, id, prop, oldVal, newVal) {
    this.lm = lm; this.id = id; this.prop = prop;
    this.oldVal = oldVal; this.newVal = newVal; this.memoryBytes = 0;
    this.label = { visible: "레이어 표시 전환", opacity: "불투명도 변경", name: "레이어 이름 변경", blendMode: "블렌드 모드 변경" }[prop] || "레이어 속성";
  }
  _set(v) {
    const layer = this.lm.byId(this.id);
    if (!layer) return;
    layer[this.prop] = v;
    this.lm.notifyStructure();
  }
  redo() { this._set(this.newVal); }
  undo() { this._set(this.oldVal); }
}
