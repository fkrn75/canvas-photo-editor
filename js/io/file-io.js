// file-io.js — 이미지 열기(파일 선택/드래그앤드롭)와 저장(PNG/JPG).

import { EVT } from "../core/constants.js";

// 파일명 sanitize: 경로구분자·제어문자 제거 + 앞뒤 공백/점 제거 + 빈 값 대체 + 길이 제한.
// 다운로드 파일명(문서명 기반)에 그대로 쓰면 OS별 금지문자나 숨김파일(.으로 시작) 문제가
// 생길 수 있어 file-io.js/save-for-web.js 양쪽에서 공용으로 사용한다.
export function sanitizeFileName(name) {
  let s = String(name ?? "")
    .replace(/[/\\:*?"<>|]/g, "")   // 경로구분자 + Windows 금지문자
    .replace(/[\x00-\x1f\x7f]/g, "") // 제어문자
    .trim()
    .replace(/^\.+|\.+$/g, "")      // 앞뒤 점 제거(숨김파일/확장자 오인 방지)
    .trim();
  if (!s) s = "untitled";
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

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
        // File Browser(IndexedDB)에 최근 이미지로 저장 + 패널 갱신 신호(워커F). 저장 실패는 무시.
        if (this.app.imageStore) {
          this.app.imageStore.putFromImage(img, file.name?.replace(/\.[^.]+$/, "") || "이미지")
            .then(() => this.app.bus.emit(EVT.IMAGE_STORED))
            .catch(() => {});
        }
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
      a.download = `${sanitizeFileName(this.app.docName)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.app.status(`저장: ${a.download}`);
      this.app.bus.emit(EVT.FILE_SAVED);
    }, mime, quality);
  }
}
