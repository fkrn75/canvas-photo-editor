// wand-tool.js — 매직완드. 클릭 지점과 비슷한 색 영역을 선택 영역으로 만든다.

import { BaseTool } from "./base-tool.js";
import { floodFill } from "../engine/floodfill.js";

export class WandTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.layers.activeLayer;
    if (!layer) return;
    const W = layer.width, H = layer.height;
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const img = layer.ctx.getImageData(0, 0, W, H);
    const { mask, bounds } = floodFill(img.data, W, H, x, y, this.state.tolerance, this.state.contiguous);
    if (bounds) this.selection.setMask(mask, bounds);
    else this.selection.clear();
  }
}
