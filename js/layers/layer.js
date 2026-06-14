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
    this.opacity = 1;          // 0~1 (레이어 전체 불투명도)
    this.fillOpacity = 1;      // 0~1 (채우기 불투명도: 픽셀 알파에만 곱함, 스타일과 별개)
    this.blendMode = "normal"; // 블렌드 모드 id (blend.js의 BLEND_MODES 참조)
    this.thumbDirty = true;    // 썸네일 재생성 필요 여부

    // ── 마스크/클리핑/잠금 (레이어 마스크 담당) ──
    this.mask = null;          // 그레이스케일 마스크 캔버스(흰=불투명/검=가림). null=마스크 없음
    this.maskCtx = null;       // mask 캔버스의 2D 컨텍스트(willReadFrequently)
    this.maskEnabled = true;   // 마스크 사용 여부(사용 안 함=disable면 false)
    this.maskActive = false;   // 편집 대상이 마스크인지(true=마스크, false=레이어 픽셀)
    this.clipped = false;      // 클리핑 마스크: 바로 아래 레이어의 알파로 클리핑
    this.lockTransparency = false; // 투명 영역 잠금(기존 알파>0 영역만 칠함)
    this.lockImage = false;        // 이미지 픽셀 잠금(페인팅 차단)
    this.lockPosition = false;     // 위치 잠금(이동 차단)
    this.styles = null;            // 레이어 스타일(layer-styles.js). null=없음
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  // 마스크 적용이 실제로 합성에 반영되는 상태인지(마스크 존재 + 사용함)
  get maskApplied() { return !!this.mask && this.maskEnabled; }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.thumbDirty = true;
  }

  // ── 마스크 관리 ──
  // 마스크 캔버스를 생성한다. reveal=true면 전체 흰색(모두 드러냄/Reveal All),
  // false면 전체 검정(모두 가림/Hide All). 이미 있으면 그대로 둔다.
  createMask(reveal = true) {
    if (this.mask) return this.mask;
    const m = document.createElement("canvas");
    m.width = this.width;
    m.height = this.height;
    const mc = m.getContext("2d", { willReadFrequently: true });
    mc.fillStyle = reveal ? "#ffffff" : "#000000";
    mc.fillRect(0, 0, m.width, m.height);
    this.mask = m;
    this.maskCtx = mc;
    this.maskEnabled = true;
    this.thumbDirty = true;
    return m;
  }

  // 기존 마스크 캔버스(undo 복원용)를 그대로 장착한다.
  attachMask(canvas) {
    this.mask = canvas;
    this.maskCtx = canvas ? canvas.getContext("2d", { willReadFrequently: true }) : null;
    this.thumbDirty = true;
  }

  // 마스크 제거(편집 대상도 레이어로 되돌림)
  removeMask() {
    this.mask = null;
    this.maskCtx = null;
    this.maskActive = false;
    this.thumbDirty = true;
  }

  // 현재 편집 대상 컨텍스트(마스크 편집 중이면 마스크, 아니면 레이어 픽셀)
  get editCtx() {
    return (this.maskActive && this.mask) ? this.maskCtx : this.ctx;
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
    // 마스크도 동일하게 재배치(새 영역은 검정=가림으로 채워 캔버스 밖이 드러나지 않게 한다)
    if (this.mask) {
      const oldMask = this.mask;
      const nm = document.createElement("canvas");
      nm.width = newW;
      nm.height = newH;
      const nmc = nm.getContext("2d", { willReadFrequently: true });
      nmc.fillStyle = "#000000";
      nmc.fillRect(0, 0, newW, newH);
      nmc.drawImage(oldMask, dx, dy);
      this.mask = nm;
      this.maskCtx = nmc;
    }
    this.thumbDirty = true;
  }
}
