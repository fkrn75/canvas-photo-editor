// eraser-ext-tools.js — 마술 지우개 / 배경 지우개 (E 슬롯 순환: 지우개 → 배경 지우개 → 마술 지우개).
//
// 마술 지우개: 클릭한 픽셀과 비슷한 색(허용오차, 인접 옵션)을 한 번에 투명하게 — 매직완드의 floodFill을 그대로 쓴다.
// 배경 지우개: 브러시 중심 픽셀 색을 샘플링해(연속/한 번) 허용오차 안의 픽셀만 지운다 — 피사체 가장자리 따기용.
// 두 도구 모두 투명 영역 잠금 레이어에서는 동작하지 않는다(알파를 바꾸는 도구라 잠금 의미와 충돌).

import { BaseTool } from "./base-tool.js";
import { floodFill } from "../engine/floodfill.js";
import { ensureDefaults, DabPixelTool, pixelEditBlocker } from "./ext-tool-base.js";
import { magicErase, bgEraseDab } from "./tool-ext-math.js";

export class MagicEraserTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { magicEraserTolerance: 32, magicEraserContiguous: true, magicEraserOpacity: 1 });
  }

  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    const blocked = pixelEditBlocker(layer, this.app);
    if (blocked) { this.app.status(blocked); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 지울 수 없습니다."); return; }
    if (layer.lockTransparency) { this.app.status("투명 영역이 잠겨 있어 마술 지우개를 쓸 수 없습니다."); return; }
    const W = layer.width, H = layer.height;
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;

    this.history.beginPixelEdit(layer);
    const before = this.history._peBefore;
    const work = new ImageData(new Uint8ClampedArray(before.data), W, H);
    const s = this.state;
    const { mask, bounds } = floodFill(work.data, W, H, x, y, s.magicEraserTolerance ?? 32, s.magicEraserContiguous !== false);
    const sel = this.selection?.active ? this.selection.mask : null;
    const n = bounds ? magicErase(work.data, mask, s.magicEraserOpacity ?? 1, sel) : 0;
    if (!n) {
      this.history.cancelPixelEdit();
      this.app.status("지울 픽셀이 없습니다(이미 투명하거나 선택 영역 밖).");
      return;
    }
    layer.ctx.putImageData(work, 0, 0, bounds.x, bounds.y, bounds.w, bounds.h);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(bounds, "마술 지우개");
    this.app.renderer.requestRender();
  }
}

export class BackgroundEraserTool extends DabPixelTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { bgEraserTolerance: 50, bgEraserSampling: "continuous", bgEraserContiguous: true });
  }

  get label() { return "배경 지우개"; }

  _reject(layer) {
    if (layer.lockImage) return "이미지가 잠겨 있어 지울 수 없습니다.";
    if (layer.lockTransparency) return "투명 영역이 잠겨 있어 배경 지우개를 쓸 수 없습니다.";
    return null;
  }

  // 샘플링 "한 번": stroke 시작점 색을 끝까지 기준으로 쓴다
  _beginStroke(pt) { this.ref = this._sample(pt.x, pt.y); }

  _dab(x, y, r) {
    const s = this.state;
    const ref = s.bgEraserSampling === "once" ? this.ref : this._sample(x, y);
    if (!ref || ref[3] === 0) return null; // 투명 픽셀은 기준색이 될 수 없다
    return bgEraseDab(this.work.data, this.before.data, this.layer.width, this.layer.height,
      x, y, r, s.brushHardness, ref, s.bgEraserTolerance ?? 50, s.bgEraserContiguous !== false, this.str, this.selMask);
  }
}
