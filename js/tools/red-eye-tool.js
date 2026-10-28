// red-eye-tool.js — 적목 현상 도구(Red Eye, K 슬롯: 복구 브러시 → 스팟 복구 → 적목).
//
// 눈동자를 클릭(주변 정사각 영역 자동) 또는 드래그로 감싸면, 그 안의 "빨간" 픽셀(R이 G·B 평균보다 훨씬 큰)을
// 무채색으로 바꾸고 어둡게 한다. 옵션: 동공 크기(덜 붉은 가장자리까지 포함하는 정도), 어둡게 양.
// 선택 영역이 있으면 그 강도(0~255)만큼만 반영한다.

import { BaseTool } from "./base-tool.js";
import { clampBox } from "../engine/imagedata.js";
import { ensureDefaults, pixelEditBlocker } from "./ext-tool-base.js";
import { redEyeFix } from "./tool-ext-math.js";

export class RedEyeTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { redEyePupil: 0.5, redEyeDarken: 0.5 });
    this.start = null;
    this.cur = null;
  }

  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    const blocked = pixelEditBlocker(layer, this.app);
    if (blocked) { this.app.status(blocked); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 보정할 수 없습니다."); return; }
    this.layer = layer;
    this.start = { x: pt.x, y: pt.y };
    this.cur = { x: pt.x, y: pt.y };
  }

  onPointerMove(pt, e) {
    if (!this.start) return;
    this.cur = { x: pt.x, y: pt.y };
    this.app.renderer.requestOverlayRender();
  }

  onPointerUp(pt, e) {
    if (!this.start) return;
    const layer = this.layer, W = layer.width, H = layer.height;
    const a = this.start, b = { x: pt.x, y: pt.y };
    this.start = null; this.cur = null; this.layer = null;
    const dragPx = Math.hypot(b.x - a.x, b.y - a.y) * this.app.viewport.zoom;
    let box;
    if (dragPx < 4) {
      // 클릭: 문서 크기에 비례한 정사각 영역(최소 8, 최대 80px 반경)
      const rad = Math.max(8, Math.min(80, Math.round(Math.min(W, H) * 0.04)));
      box = { x: a.x - rad, y: a.y - rad, w: rad * 2, h: rad * 2 };
    } else {
      box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    }
    const cb = clampBox(box, W, H);
    if (!cb) { this.app.renderer.requestOverlayRender(); return; }

    this.history.beginPixelEdit(layer);
    const before = this.history._peBefore;
    const work = new ImageData(new Uint8ClampedArray(before.data), W, H);
    const n = redEyeFix(work.data, W, H, cb, this.state.redEyePupil ?? 0.5, this.state.redEyeDarken ?? 0.5);
    if (!n) {
      this.history.cancelPixelEdit();
      this.app.status("영역 안에서 빨간 눈동자를 찾지 못했습니다. 동공 크기를 키워 보세요.");
      this.app.renderer.requestOverlayRender();
      return;
    }
    // 선택 영역 강도만큼만 반영
    const sel = this.selection?.active ? this.selection.mask : null;
    if (sel) {
      const wd = work.data, bd = before.data;
      for (let y = cb.y; y < cb.y + cb.h; y++) {
        for (let x = cb.x; x < cb.x + cb.w; x++) {
          const p = y * W + x, k = sel[p] / 255;
          if (k >= 1) continue;
          const i = p * 4;
          for (let c = 0; c < 3; c++) wd[i + c] = bd[i + c] + (wd[i + c] - bd[i + c]) * k;
        }
      }
    }
    layer.ctx.putImageData(work, 0, 0, cb.x, cb.y, cb.w, cb.h);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(cb, "적목 현상");
    this.app.renderer.requestRender();
    this.app.status(`적목 보정: ${n}픽셀`);
  }

  onDeactivate() { this.start = null; this.cur = null; this.layer = null; }

  drawOverlay(ctx, vp) {
    if (!this.start || !this.cur) return;
    const p = vp.worldToScreen(Math.min(this.start.x, this.cur.x), Math.min(this.start.y, this.cur.y));
    const q = vp.worldToScreen(Math.max(this.start.x, this.cur.x), Math.max(this.start.y, this.cur.y));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(q.x - p.x), Math.round(q.y - p.y));
    ctx.restore();
  }
}
