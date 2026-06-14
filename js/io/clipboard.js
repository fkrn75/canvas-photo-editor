// clipboard.js — 붙여넣기(이미지→새 레이어) / 복사(합성 결과를 클립보드로).

export class Clipboard {
  constructor(app) {
    this.app = app;
    // 전역 paste 이벤트로 이미지 붙여넣기 처리 (가장 호환성이 좋다)
    window.addEventListener("paste", (e) => this._onPaste(e));
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          this.app.fileIO.openImage(file);
          return;
        }
      }
    }
  }

  // 합성 결과(또는 선택 영역)를 클립보드 이미지로 복사
  async copy() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      this.app.status("이 브라우저는 클립보드 복사를 지원하지 않습니다.");
      return;
    }
    const lm = this.app.layers;
    let canvas = lm.flatten();
    const sel = this.app.selection;
    if (sel?.active && sel.bounds) {
      // 선택 영역만 잘라 복사
      const b = sel.bounds;
      const crop = document.createElement("canvas");
      crop.width = b.w; crop.height = b.h;
      crop.getContext("2d").drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      canvas = crop;
    }
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      this.app.status("클립보드에 복사했습니다.");
    } catch (err) {
      console.error(err);
      this.app.status("복사 실패: " + err.message);
    }
  }
}
