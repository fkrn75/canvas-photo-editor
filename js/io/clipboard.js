// clipboard.js — 복사/병합 복사/잘라내기/붙여넣기/제자리에 붙여넣기.
//
// [동작 — Photoshop 관례]
//   · 복사(Ctrl+C)        : 활성 레이어의 선택 영역(없으면 레이어 전체) 픽셀
//   · 병합 복사(Shift+Ctrl+C): 보이는 레이어 합성 결과의 선택 영역
//   · 잘라내기(Ctrl+X)     : 복사 후 활성 레이어에서 선택 영역을 지움(실행 취소 가능)
//   · 붙여넣기(Ctrl+V)     : 시스템 클립보드 이미지 → 새 레이어(기존 경로, paste 이벤트)
//   · 제자리에 붙여넣기(Shift+Ctrl+V): 이 에디터에서 마지막으로 복사/잘라낸 내용을 원래 위치에 새 레이어로
//
// [내부 버퍼] 시스템 클립보드는 PNG 픽셀만 담고 "원래 위치"를 모르므로, 복사할 때 { canvas, x, y } 를
//   this.buffer 에 함께 보관한다. 제자리에 붙여넣기는 이 버퍼를 쓴다(다른 앱에서 복사한 이미지는 Ctrl+V).
// 선택 마스크(페더 포함)는 알파에 곱해 복사한다.
// 버퍼 좌표는 "복사한 시점의 문서" 기준이라, 문서 크기 변경(자르기·크기 조절·회전, 그 실행 취소/다시 실행)이나
// 문서 교체(열기)로 DOCUMENT_CHANGED 가 발행되면 버퍼를 비운다. 같은 문서 안의 일반 편집(그리기·레이어 조작 등)은
// 이 이벤트를 발행하지 않으므로 버퍼가 유지된다. 이벤트를 안 내는 새 문서 생성 경로 대비로 붙여넣을 때
// 복사 시점의 문서 크기와 현재 크기가 다르면 한 번 더 걸러낸다.

import { maskAlphaInBox } from "../engine/layer-image-ops.js";
import { EVT } from "../core/constants.js";

export class Clipboard {
  constructor(app) {
    this.app = app;
    this.buffer = null; // { canvas, x, y, w, h, docW, docH } — 마지막으로 복사/잘라낸 내용과 원래 위치(+복사 시점 문서 크기)
    app.bus?.on?.(EVT.DOCUMENT_CHANGED, () => { this.buffer = null; });
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

  // 선택 경계(문서 안으로 자름) 또는 문서 전체 박스
  _box() {
    const lm = this.app.layers, sel = this.app.selection;
    if (sel?.active && sel.bounds) {
      const b = sel.bounds;
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      const r = Math.min(lm.width, b.x + b.w), btm = Math.min(lm.height, b.y + b.h);
      if (r <= x || btm <= y) return null;
      return { x, y, w: r - x, h: btm - y, masked: true };
    }
    return { x: 0, y: 0, w: lm.width, h: lm.height, masked: false };
  }

  // 문서 크기 소스 캔버스에서 선택 영역을 잘라 내부 버퍼로 만든다(선택 마스크를 알파에 곱함).
  _capture(srcCanvas) {
    const box = this._box();
    if (!box) return null;
    const lm = this.app.layers;
    const img = srcCanvas.getContext("2d", { willReadFrequently: true }).getImageData(box.x, box.y, box.w, box.h);
    if (box.masked) maskAlphaInBox(img, this.app.selection.mask, lm.width, box);
    const c = document.createElement("canvas");
    c.width = box.w; c.height = box.h;
    c.getContext("2d").putImageData(img, 0, 0);
    return { canvas: c, x: box.x, y: box.y, w: box.w, h: box.h, docW: lm.width, docH: lm.height };
  }

  // 시스템 클립보드에 PNG 로 쓴다(실패해도 내부 버퍼는 유지 → 제자리에 붙여넣기는 가능)
  async _writeSystem(canvas, okMsg) {
    if (!navigator.clipboard || !window.ClipboardItem) {
      this.app.status(okMsg + " (이 브라우저는 시스템 클립보드 쓰기를 지원하지 않아 에디터 안에서만 붙여넣을 수 있습니다)");
      return;
    }
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      this.app.status(okMsg);
    } catch (err) {
      console.error(err);
      this.app.status("시스템 클립보드 복사 실패: " + err.message + " (제자리에 붙여넣기는 가능)");
    }
  }

  // 활성 레이어의 선택 영역(없으면 레이어 전체) 복사
  async copy() {
    const L = this.app.layers.activeLayer;
    if (!L) { this.app.status("레이어가 없습니다."); return; }
    if (L.type === "adjustment") { this.app.status("조정 레이어에는 복사할 픽셀이 없습니다. (병합 복사: Shift+Ctrl+C)"); return; }
    const buf = this._capture(L.canvas);
    if (!buf) { this.app.status("선택 영역이 비어 있습니다."); return; }
    this.buffer = buf;
    await this._writeSystem(buf.canvas, "클립보드에 복사했습니다.");
  }

  // 보이는 레이어 합성 결과의 선택 영역 복사
  async copyMerged() {
    const buf = this._capture(this.app.layers.flatten());
    if (!buf) { this.app.status("선택 영역이 비어 있습니다."); return; }
    this.buffer = buf;
    await this._writeSystem(buf.canvas, "병합 복사했습니다.");
  }

  // 잘라내기: 복사 후 활성 레이어의 선택 영역(없으면 레이어 전체)을 지운다.
  async cut() {
    const app = this.app, L = app.layers.activeLayer;
    if (!L) { app.status("레이어가 없습니다."); return; }
    if (L.type === "adjustment") { app.status("조정 레이어에는 잘라낼 픽셀이 없습니다."); return; }
    if (L.vectorText || L.vectorShape) { app.status("텍스트/셰이프 레이어는 잘라낼 수 없습니다. 복사(Ctrl+C)를 사용하세요."); return; }
    if (L.lockImage || L.lockTransparency) { app.status("레이어가 잠겨 있어 잘라낼 수 없습니다."); return; }
    const buf = this._capture(L.canvas);
    if (!buf) { app.status("선택 영역이 비어 있습니다."); return; }
    this.buffer = buf;
    // 지우기(동기 — 히스토리 1단계). 선택 마스크가 부분값(페더)이면 그만큼만 지운다.
    app.history.beginPixelEdit(L);
    if (app.selection?.active && app.selection.bounds) {
      const box = { x: buf.x, y: buf.y, w: buf.w, h: buf.h };
      const img = L.ctx.getImageData(box.x, box.y, box.w, box.h);
      maskAlphaInBox(img, app.selection.mask, app.layers.width, box, true);
      L.ctx.putImageData(img, box.x, box.y);
      app.history.commitPixelEdit(box, "잘라내기");
    } else {
      L.ctx.clearRect(0, 0, L.width, L.height);
      app.history.commitPixelEdit(null, "잘라내기");
    }
    await this._writeSystem(buf.canvas, "잘라냈습니다.");
  }

  // 제자리에 붙여넣기: 내부 버퍼를 원래 위치에 새 레이어로
  pasteInPlace() {
    let b = this.buffer;
    // 문서 크기가 복사 시점과 달라졌다면(이벤트 없이 문서가 바뀐 경우) 좌표가 어긋나므로 버린다
    if (b && (b.docW !== this.app.layers.width || b.docH !== this.app.layers.height)) { this.buffer = null; b = null; }
    if (!b) { this.app.status("제자리에 붙여넣을 내용이 없습니다. 먼저 이 에디터에서 복사하세요. (외부 이미지는 Ctrl+V)"); return; }
    this.app.layers.addLayer({ name: "붙여넣은 레이어", image: b.canvas, x: b.x, y: b.y });
    this.app.status("제자리에 붙여넣었습니다.");
  }
}
