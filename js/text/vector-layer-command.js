// vector-layer-command.js — 벡터 레이어(텍스트/셰이프) 데이터 편집용 undo/redo 커맨드.
//
// [왜 별도 커맨드인가]
//   기존 commitPixelEdit 는 레이어 "픽셀"의 변경 영역만 보관한다. 하지만 벡터 텍스트/셰이프는
//   픽셀과 함께 "소스 데이터 객체"(layer.vectorText / layer.vectorShape / layer.vectorMask)도
//   바뀌므로, 둘을 함께 되돌려야 재편집 일관성이 유지된다.
//   → 변경 전/후의 (데이터 객체 깊은복사 + 레이어 전체 픽셀 스냅샷)을 보관하고 통째로 복원한다.
//   공유 commands 디렉터리를 수정하지 않기 위해(disjoint 규칙) 이 파일을 별도로 둔다.
//
// [인터페이스] 기존 커맨드와 동일: { label, memoryBytes, redo(), undo() }. app.history.push(cmd) 로 등록.

// 깊은 복사(데이터 객체는 순수 직렬화 가능 값들로만 구성됨)
function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

export class VectorLayerEditCommand {
  // app: App, layer: 대상 레이어, key: "vectorText"|"vectorShape"|"vectorMask"
  // beforeData/afterData: 데이터 객체(깊은복사본), beforeImg/afterImg: ImageData 전체 스냅샷
  constructor(app, layer, key, beforeData, afterData, beforeImg, afterImg, label) {
    this.app = app;
    this.layerId = layer.id;
    this.key = key;
    this.beforeData = clone(beforeData);
    this.afterData = clone(afterData);
    this.beforeImg = beforeImg;
    this.afterImg = afterImg;
    this.label = label || "벡터 레이어 편집";
    this.memoryBytes = (beforeImg?.data.length || 0) + (afterImg?.data.length || 0);
  }

  _apply(data, img) {
    const layer = this.app.layers.byId(this.layerId);
    if (!layer) return;
    layer[this.key] = clone(data);
    if (img) layer.ctx.putImageData(img, 0, 0);
    layer.thumbDirty = true;
    this.app.layers.notifyContent(this.layerId);
  }

  redo() { this._apply(this.afterData, this.afterImg); }
  undo() { this._apply(this.beforeData, this.beforeImg); }
}

// 편집 트랜잭션 헬퍼: 시작 시 before 스냅샷을 잡고, 끝낼 때 after 를 잡아 커맨드를 push.
// 사용:
//   const tx = beginVectorEdit(app, layer, "vectorText");
//   ... layer.vectorText 수정 + 다시 렌더 ...
//   commitVectorEdit(app, tx, "텍스트 편집");
export function beginVectorEdit(app, layer, key) {
  return {
    app, layer, key,
    beforeData: clone(layer[key]),
    beforeImg: layer.ctx.getImageData(0, 0, layer.width, layer.height),
  };
}

export function commitVectorEdit(tx, label) {
  const { app, layer, key, beforeData, beforeImg } = tx;
  const afterData = layer[key];
  const afterImg = layer.ctx.getImageData(0, 0, layer.width, layer.height);
  const cmd = new VectorLayerEditCommand(app, layer, key, beforeData, afterData, beforeImg, afterImg, label);
  app.history.push(cmd);
}
