// layer.js — 단일 레이어. 문서와 동일 크기의 분리(detached) 캔버스 1장을 픽셀 버퍼로 가진다.

let _seq = 0;

export class Layer {
  constructor(width, height, name) {
    this.id = ++_seq;
    this.name = name || `레이어 ${this.id}`;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    // willReadFrequently: getImageData 호출이 잦으므로 읽기 최적화 모드를 켠다.
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.visible = true;
    this.opacity = 1;          // 0~1
    this.blendMode = "normal"; // 블렌드 모드 id (blend.js의 BLEND_MODES 참조)
    this.thumbDirty = true;    // 썸네일 재생성 필요 여부
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.thumbDirty = true;
  }

  // 전체 픽셀 데이터 사본
  snapshot() {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  // 스냅샷 복원
  restore(imageData) {
    this.ctx.putImageData(imageData, 0, 0);
    this.thumbDirty = true;
  }

  // 문서 리사이즈/크롭 시: 새 크기의 캔버스로 교체하고 기존 픽셀을 (dx,dy) 위치에 옮긴다.
  resizeCanvas(newW, newH, dx = 0, dy = 0) {
    const old = this.canvas;
    const next = document.createElement("canvas");
    next.width = newW;
    next.height = newH;
    const nctx = next.getContext("2d", { willReadFrequently: true });
    nctx.drawImage(old, dx, dy);
    this.canvas = next;
    this.ctx = nctx;
    this.thumbDirty = true;
  }
}
