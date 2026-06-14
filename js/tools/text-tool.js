// text-tool.js — 텍스트 입력.
// 클릭 위치에 contenteditable 오버레이를 띄워 입력받고(한글 IME 안정), 확정 시 fillText로 래스터화한다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox } from "../engine/imagedata.js";

export class TextTool extends BaseTool {
  get cursor() { return "text"; }

  onActivate() { this.overlay = document.getElementById("text-overlay"); }
  onDeactivate() { this._commit(); }

  onPointerDown(pt, e) {
    if (this.editor) { this._commit(); return; } // 입력 중이면 먼저 확정
    const layer = this.ensureLayer();
    if (!layer) return;
    this.layer = layer;
    this.anchor = pt; // 텍스트 좌상단(월드 좌표)
    this._createEditor(pt);
  }

  _cssFont() {
    const s = this.state;
    return `${s.fontItalic ? "italic " : ""}${s.fontBold ? "bold " : ""}${s.fontSize}px ${s.fontFamily}`;
  }

  _createEditor(pt) {
    const vp = this.app.viewport;
    const el = document.createElement("div");
    el.className = "text-edit";
    el.contentEditable = "true";
    el.spellcheck = false;
    const sc = vp.worldToScreen(pt.x, pt.y);
    el.style.left = sc.x + "px";
    el.style.top = sc.y + "px";
    el.style.color = this.state.foreground;
    el.style.font = this._cssFont();
    el.style.lineHeight = "1.2";
    el.style.transform = `scale(${vp.zoom})`;
    this.overlay.appendChild(el);
    this.editor = el;
    setTimeout(() => el.focus(), 0);

    el.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // 도구 단축키와 충돌 방지
      if (ev.key === "Escape") { ev.preventDefault(); this._cancel(); }
      else if (ev.key === "Enter" && ev.ctrlKey) { ev.preventDefault(); this._commit(); }
    });
    el.addEventListener("blur", () => {
      // 포커스 잃으면 잠시 후 확정(다른 곳 클릭 시)
      setTimeout(() => { if (this.editor === el) this._commit(); }, 120);
    });
  }

  _commit() {
    const el = this.editor;
    const layer = this.layer;
    if (!el) return;
    const text = el.innerText.replace(/\n$/, "");
    this.editor = null;
    this.layer = null;
    el.remove();
    if (!text.trim() || !layer) return;

    const s = this.state;
    const ctx = layer.ctx;
    this.history.beginPixelEdit(layer);
    ctx.save();
    if (this.selection?.active) this.selection.applyClipPath(ctx);
    ctx.font = this._cssFont();
    ctx.fillStyle = s.foreground;
    ctx.textBaseline = "top";
    const lines = text.split("\n");
    const lh = s.fontSize * 1.2;
    let maxW = 0;
    lines.forEach((line, i) => {
      ctx.fillText(line, this.anchor.x, this.anchor.y + i * lh);
      maxW = Math.max(maxW, ctx.measureText(line).width);
    });
    ctx.restore();

    const b = newBounds();
    expandBounds(b, this.anchor.x - 2, this.anchor.y - 2);
    expandBounds(b, this.anchor.x + maxW + 4, this.anchor.y + lines.length * lh + 4);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(boundsToBox(b), "텍스트");
  }

  _cancel() {
    if (this.editor) { this.editor.remove(); this.editor = null; this.layer = null; }
  }
}
