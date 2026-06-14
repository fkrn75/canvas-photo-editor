// image-mode-command.js — 이미지 모드 변환(전 레이어 픽셀 일괄 변환) undo/redo 커맨드.
// layer-structure-command.js 의 인터페이스({ label, memoryBytes, redo(), undo() })를 따른다.
//
// 이미지 모드 변환(Grayscale/Indexed/Bitmap)은 "보이는 픽셀 레이어 전부"를 동시에 바꾸므로
// 기존 begin/commitPixelEdit(단일 레이어)로는 한 번의 undo 로 묶을 수 없다. 그래서
// 각 대상 레이어의 변환 전/후 전체 ImageData 와 (선택적으로) 모드 상태/팔레트를 함께 보관해
// 한 단계로 되돌린다.
//
// 조정 레이어(type==="adjustment")는 자체 픽셀이 합성에 쓰이지 않으므로 변환 대상에서 제외한다.

export class ImageModeCommand {
  // lm        : LayerManager
  // transform : (ImageData) => void  — 각 레이어 픽셀을 in-place 변환하는 함수
  //             (호출 측에서 toGrayscale/applyPalette/toBitmap 등을 클로저로 넘긴다)
  // label     : 히스토리 라벨
  // modeInfo  : { setMode(modeObj), prevMode, nextMode } | null
  //             모드 상태를 함께 저장/복원하고 싶을 때만 전달(없으면 픽셀만 변환).
  constructor(lm, transform, label = "이미지 모드 변환", modeInfo = null) {
    this.lm = lm;
    this.transform = transform;
    this.label = label;
    this.modeInfo = modeInfo;

    // 변환 대상 = 조정 레이어가 아닌 모든 레이어(가시성 무관: 숨은 레이어도 모드를 따라야 함)
    this.targets = lm.layers.filter((l) => l.type !== "adjustment");

    // 변환 전 스냅샷 보관 + 즉시 변환 후 스냅샷도 보관(redo 재적용을 저렴하게)
    this.before = new Map(); // id -> ImageData(원본)
    this.after = new Map();  // id -> ImageData(변환 결과)
    this.memoryBytes = 0;

    for (const layer of this.targets) {
      const snap = layer.ctx.getImageData(0, 0, layer.width, layer.height);
      this.before.set(layer.id, snap);
      // 변환은 사본에 적용(원본 보존)
      const work = new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height);
      transform(work);
      this.after.set(layer.id, work);
      this.memoryBytes += snap.data.length + work.data.length;
    }
  }

  // 보관해 둔 결과를 각 레이어에 그려 넣고(또는 원복) 썸네일/재렌더 통지
  _put(map, mode) {
    for (const layer of this.targets) {
      const img = map.get(layer.id);
      if (!img) continue;
      // 레이어가 그 사이 리사이즈됐을 수 있으니 크기 일치할 때만 적용(안전장치)
      if (layer.width === img.width && layer.height === img.height) {
        layer.ctx.putImageData(img, 0, 0);
        layer.thumbDirty = true;
      }
    }
    if (this.modeInfo && this.modeInfo.setMode) this.modeInfo.setMode(mode);
    this.lm.notifyStructure(); // 재렌더 + 레이어 패널 갱신
  }

  redo() { this._put(this.after, this.modeInfo ? this.modeInfo.nextMode : undefined); }
  undo() { this._put(this.before, this.modeInfo ? this.modeInfo.prevMode : undefined); }
}

// 픽셀 변경 없이 "모드 표식"만 바꾸는 경량 커맨드(예: 인덱스/비트맵 → RGB 색상 복귀).
// 전 레이어 스냅샷을 보관할 필요가 없어 메모리 0 으로 한 단계 undo 를 제공한다.
export class ImageModeStateCommand {
  // setMode : (modeObj)=>void, prevMode/nextMode : { mode, palette }
  constructor(lm, setMode, prevMode, nextMode, label = "이미지 모드 변경") {
    this.lm = lm;
    this.setMode = setMode;
    this.prevMode = prevMode;
    this.nextMode = nextMode;
    this.label = label;
    this.memoryBytes = 0;
  }
  redo() { this.setMode(this.nextMode); this.lm.notifyStructure(); }
  undo() { this.setMode(this.prevMode); this.lm.notifyStructure(); }
}
