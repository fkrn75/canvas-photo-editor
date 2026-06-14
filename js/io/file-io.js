// file-io.js — 이미지 열기(파일 선택/드래그앤드롭)와 저장(PNG/JPG).

export class FileIO {
  constructor(app) {
    this.app = app;
    this.input = document.getElementById("file-input");
    this.input.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files && files.length) this.openFiles(files);
      this.input.value = ""; // 같은 파일 재선택 허용
    });
    this._bindDragDrop();
  }

  openDialog() { this.input.click(); }

  _bindDragDrop() {
    const vp = document.getElementById("viewport");
    ["dragenter", "dragover"].forEach((ev) =>
      vp.addEventListener(ev, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; })
    );
    vp.addEventListener("drop", (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length) this.openFiles(files);
    });
  }

  async openFiles(files) {
    for (const f of files) {
      if (f.type.startsWith("image/")) await this.openImage(f);
    }
  }

  openImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        this.app.placeImage(img, file.name?.replace(/\.[^.]+$/, "") || "이미지");
        this.app.status(`열기: ${file.name}`);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.app.status("이미지를 열 수 없습니다.");
        resolve();
      };
      img.src = url;
    });
  }

  // 합성 결과를 파일로 저장. format: 'png' | 'jpg'
  save(format = "png", quality = 0.92) {
    const lm = this.app.layers;
    if (!lm.width) return;
    let canvas = lm.flatten();
    const mime = format === "jpg" ? "image/jpeg" : "image/png";

    if (format === "jpg") {
      // JPG는 투명을 지원하지 않으므로 흰 배경 위에 합성
      const opaque = document.createElement("canvas");
      opaque.width = canvas.width;
      opaque.height = canvas.height;
      const octx = opaque.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, opaque.width, opaque.height);
      octx.drawImage(canvas, 0, 0);
      canvas = opaque;
    }

    canvas.toBlob((blob) => {
      if (!blob) { this.app.status("저장 실패"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${this.app.docName || "untitled"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.app.status(`저장: ${a.download}`);
    }, mime, quality);
  }
}
