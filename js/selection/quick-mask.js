// quick-mask.js — 빠른 마스크 모드.
// 포토샵 Quick Mask처럼, 선택 영역을 "그레이스케일 캔버스"로 바꿔 브러시/지우개로
// 자유롭게 칠해 다듬은 뒤, 다시 선택 영역으로 환원한다.
//
// 내부 표현: 문서 크기 그레이스케일 캔버스(this.canvas).
//   흰색(255) = 선택됨 / 검정(0) = 비선택 / 중간값 = 부분 선택(소프트 에지).
//   (selection.mask의 0~255 의미와 동일하게 R채널을 선택 강도로 쓴다)
//
// 페인팅: paint-tool이 app.quickMask.active일 때, 자신의 강도 마스크를 이 캔버스에
//   그레이로 합성한다(브러시=전경색 휘도, 지우개=검정으로 가림). → maskCtx 게터 제공.
// 화면: renderer가 active일 때 buildOverlay() 결과(비선택 영역 빨강 반투명)를 합성한다.

export class QuickMask {
  constructor(app) {
    this.app = app;
    this._active = false;
    this.canvas = null; // 그레이스케일 편집 버퍼(문서 크기)
    this.ctx = null;
  }

  get active() { return this._active; }

  // paint-tool이 칠할 대상 컨텍스트(그레이스케일). active가 아니면 null.
  get maskCtx() { return this._active ? this.ctx : null; }

  // 빠른 마스크 진입: 현재 선택을 그레이스케일 버퍼로 복제.
  // 선택이 없으면 전체 0(검정=아무것도 선택 안 됨)으로 시작한다.
  enter() {
    if (this._active) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    if (!W || !H) { this.app.status?.("문서가 없습니다."); return; }

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });

    const sel = this.app.selection;
    const img = g.createImageData(W, H);
    const d = img.data;
    if (sel && sel.mask) {
      // 선택 마스크(0~255) → 그레이 R=G=B, 알파 불투명
      const m = sel.mask;
      for (let i = 0; i < m.length; i++) {
        const v = m[i];
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    } else {
      // 선택 없음 → 전체 0(검정), 알파만 불투명
      for (let i = 0; i < W * H; i++) d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    this.canvas = c;
    this.ctx = g;
    this._active = true;
    // 진입 중에는 마칭앤츠 대신 빨강 오버레이로 보이므로 기존 선택 표시는 잠시 가린다.
    // (선택 자체는 exit에서 새로 산출하므로 여기서 clear하지 않는다)
    this.app.renderer?.requestRender();
    this.app.status?.("빠른 마스크: 브러시로 칠해 선택을 다듬으세요. (다시 Q로 종료)");
  }

  // 빠른 마스크 종료: 그레이스케일 버퍼를 선택 영역으로 환원.
  exit() {
    if (!this._active) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const sel = this.app.selection;
    const data = this.ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let any = false;
    for (let i = 0; i < W * H; i++) {
      const v = data[i * 4]; // R채널 = 선택 강도
      mask[i] = v;
      if (v > 0) any = true;
    }
    this._active = false;
    this.canvas = null; this.ctx = null;

    if (!any) { sel.clear(); }
    else { sel._commitMask(mask); } // bounds·외곽선 자동 계산 + 마칭앤츠 재개
    this.app.renderer?.requestRender();
    this.app.status?.("빠른 마스크를 선택 영역으로 변환했습니다.");
  }

  toggle() { this._active ? this.exit() : this.enter(); }

  // 화면 합성용 오버레이: 비선택 영역(강도 < 255)에 빨강 반투명을 입힌 ImageData(문서 크기).
  // 강도가 낮을수록(=덜 선택) 더 진한 빨강. 완전 선택(255)은 투명.
  // 반환: ImageData 또는 비활성/문서없음이면 null.
  buildOverlay() {
    if (!this._active || !this.ctx) return null;
    const W = this.app.layers.width, H = this.app.layers.height;
    const src = this.ctx.getImageData(0, 0, W, H).data;
    const out = new ImageData(W, H);
    const od = out.data;
    for (let i = 0; i < W * H; i++) {
      const sel = src[i * 4];          // 선택 강도 0~255
      const cover = 255 - sel;         // 비선택 정도
      if (cover === 0) continue;       // 완전 선택 → 투명
      const j = i * 4;
      od[j] = 255; od[j + 1] = 0; od[j + 2] = 0;
      od[j + 3] = (cover * 128) / 255; // 최대 알파 128(반투명 빨강)
    }
    return out;
  }
}
