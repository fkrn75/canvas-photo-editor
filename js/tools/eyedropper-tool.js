// eyedropper-tool.js — 스포이드. 합성 결과(보이는 픽셀)에서 색을 추출한다.
// 클릭=전경색, Alt+클릭=배경색. 드래그하면 실시간으로 추출.

import { BaseTool } from "./base-tool.js";
import { rgbToHex } from "../engine/color.js";

export class EyedropperTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    // 추출 비용을 줄이기 위해 누르는 순간 합성 결과를 1회 캐시한다
    const flat = this.layers.flatten();
    this._fctx = flat.getContext("2d", { willReadFrequently: true });
    this._fw = flat.width; this._fh = flat.height;
    this._pick(pt, e);
  }

  onPointerMove(pt, e) {
    if (this._fctx && (e.buttons & 1)) this._pick(pt, e);
  }

  onPointerUp() { this._fctx = null; }

  _pick(pt, e) {
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= this._fw || y >= this._fh) return;
    const p = this._fctx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(p[0], p[1], p[2]);
    this.state.set(e.altKey ? "background" : "foreground", hex);
    this.app.status(`색 추출: ${hex}`);
  }
}
