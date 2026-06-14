// adjustment-command.js — 조정 레이어 추가 / 파라미터 변경 undo 커맨드.
// layer-structure-command.js 의 인터페이스({ label, memoryBytes, redo(), undo() })를 따른다.

import { createAdjustmentLayer, adjustmentLabel } from "../../layers/adjustment-layer.js";

// 조정 레이어 추가. 추가 시점에 조정 레이어를 만들어 두고 redo/undo 간 동일 인스턴스를 유지한다
// (마스크/파라미터 등 사용자가 편집한 상태가 undo 후 redo 시에도 보존되도록).
export class AddAdjustmentLayerCommand {
  constructor(lm, type, index, params = null) {
    this.lm = lm;
    this.index = index;
    this.layer = createAdjustmentLayer(lm.width, lm.height, type, params);
    this.label = `${adjustmentLabel(type)} 조정 레이어 추가`;
    // 조정 레이어는 빈 투명 캔버스(자체 픽셀 미사용)지만 캔버스 버퍼 비용만 대략 계상
    this.memoryBytes = lm.width * lm.height * 4;
  }
  redo() { this.lm._insert(this.layer, this.index); this.lm.notifyStructure(); }
  undo() {
    const i = this.lm.indexOf(this.layer.id);
    if (i >= 0) this.lm._removeAt(i);
    this.lm.notifyStructure();
  }
}

// 조정 레이어 파라미터 변경(편집 다이얼로그 확인 시). 객체를 통째로 교체한다.
// before/after 는 호출자가 사본으로 넘겨준다(외부 변경에 영향받지 않도록).
export class AdjustmentParamsCommand {
  constructor(lm, id, before, after, label = null) {
    this.lm = lm; this.id = id;
    this.before = before ? { ...before } : {};
    this.after = after ? { ...after } : {};
    this.memoryBytes = 0;
    const layer = lm.byId(id);
    this.label = label || `${adjustmentLabel(layer?.adjustmentType)} 보정 변경`;
  }
  _set(params) {
    const layer = this.lm.byId(this.id);
    if (!layer) return;
    layer.adjustmentParams = { ...params };
    // 조정 레이어는 자체 썸네일이 보정 결과가 아니므로 thumbDirty 불필요하지만,
    // 합성 결과가 바뀌므로 재렌더는 필요 → notifyContent 로 재렌더+이벤트 발생.
    this.lm.notifyContent(this.id);
  }
  redo() { this._set(this.after); }
  undo() { this._set(this.before); }
}
