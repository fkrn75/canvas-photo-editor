// bucket-tool.js — 페인트 버킷. flood fill로 인접/전역 영역을 찾아 전경색으로 채운다.

import { BaseTool } from "./base-tool.js";
import { floodFill } from "../engine/floodfill.js";
import { hexToRgb } from "../engine/color.js";

export class BucketTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    const W = layer.width, H = layer.height;
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;

    const img = layer.ctx.getImageData(0, 0, W, H);
    const { mask, bounds } = floodFill(img.data, W, H, x, y, this.state.tolerance, this.state.contiguous);
    if (!bounds) return;

    const sel = this.selection;
    const { r, g, b } = hexToRgb(this.state.foreground);
    const a = Math.round(this.state.brushOpacity * 255);
    const d = img.data;

    for (let yy = bounds.y; yy < bounds.y + bounds.h; yy++) {
      for (let xx = bounds.x; xx < bounds.x + bounds.w; xx++) {
        const idx = yy * W + xx;
        if (!mask[idx]) continue;
        if (sel?.active && !sel.isSelected(xx, yy)) continue;
        const i = idx * 4;
        if (a >= 255) {
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        } else {
          // 반투명 채움: source-over 블렌딩
          const af = a / 255, ia = 1 - af;
          d[i] = r * af + d[i] * ia;
          d[i + 1] = g * af + d[i + 1] * ia;
          d[i + 2] = b * af + d[i + 2] * ia;
          d[i + 3] = Math.max(d[i + 3], a);
        }
      }
    }

    this.history.beginPixelEdit(layer);
    layer.ctx.putImageData(img, 0, 0);
    this.history.commitPixelEdit(bounds, "페인트 버킷");
  }
}
