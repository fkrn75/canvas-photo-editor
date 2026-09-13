// dodge-burn-tool.js — 닷지(밝게) / 번(어둡게) / 스펀지(채도±).
//
// 3모드(app.state.dodgeBurnMode):
//   - "dodge":  브러시 아래 픽셀을 밝게(노출 기반)
//   - "burn":   어둡게
//   - "sponge": 채도를 올리거나(saturate) 내린다(desaturate). app.state.dodgeBurnMode가 sponge일 때
//               방향은 노출 부호가 아니라 별도 옵션(spongeSaturate)으로 정한다.
//
// 범위(app.state.dodgeRange, dodge/burn 전용): shadows | midtones | highlights
//   픽셀의 휘도에 따라 가중치를 줘서 해당 톤 영역만 주로 조정한다(포토샵 동작 모사).
//
// 노출(app.state.dodgeExposure, 0~1): 한 번의 패스가 주는 효과 강도.
//
// 합성: paint-tool과 동일한 강도 마스크로 부드러운 가장자리/누적을 만들고,
//   _composite에서 각 픽셀에 톤 조정을 적용한다. 결과 누적을 위해 work 버퍼 위에 이어 칠한다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";
import { luminance } from "../engine/color.js";

export class DodgeBurnTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
  }

  get cursor() { return "none"; }

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: s.brushHardness,
      mode: s.dodgeBurnMode || "dodge",     // dodge | burn | sponge
      range: s.dodgeRange || "midtones",    // shadows | midtones | highlights
      exposure: s.dodgeExposure ?? 0.5,     // 0~1
      spongeSaturate: s.spongeSaturate !== false, // sponge: true=채도↑, false=채도↓
    };
  }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 보정할 수 없습니다."); return; }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();

    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;
    this.work = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    // 강도 마스크
    this.mask = document.createElement("canvas");
    this.mask.width = layer.width;
    this.mask.height = layer.height;
    this.mctx = this.mask.getContext("2d", { willReadFrequently: true });
    this.mctx.fillStyle = "#000";
    this.mctx.fillRect(0, 0, layer.width, layer.height);
    if (this.selection?.active) this.selection.applyClipPath(this.mctx);
    this.mctx.globalCompositeOperation = "lighten";

    this.last = pt;
    this._stamp(pt, pt);
    this._composite();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (this.drawing) {
      this._stamp(this.last, pt);
      this.last = pt;
      this._composite();
    } else {
      this.app.renderer.requestRender();
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    const label = this.p.mode === "dodge" ? "닷지" : this.p.mode === "burn" ? "번" : "스펀지";
    this.history.commitPixelEdit(box, label);

    this.mask = null; this.mctx = null; this.before = null;
    this.work = null; this.layer = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  _stamp(a, b) {
    const r = Math.max(0.5, this.p.size / 2);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(0.5, r * 0.15);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      this._dot(x, y, r);
      expandBounds(this.bounds, x, y, r + 2);
    }
  }

  _dot(x, y, r) {
    const ctx = this.mctx;
    ctx.globalAlpha = 1;
    if (this.p.hardness >= 1) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const inner = Math.max(0.001, r * this.p.hardness);
      const grd = ctx.createRadialGradient(x, y, inner, x, y, r);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 휘도(0~255)에 따른 범위 가중치: 해당 톤에서 1에 가깝고 멀어질수록 0.
  // 부드러운 종 모양 곡선으로 자연스러운 영역 전이를 만든다.
  _rangeWeight(lum) {
    const t = lum / 255; // 0~1
    let center;
    if (this.p.range === "shadows") center = 0.2;
    else if (this.p.range === "highlights") center = 0.8;
    else center = 0.5; // midtones
    // 가우시안 형태의 가중치(폭 0.35). 최소 바닥값을 둬 끝단도 약하게 반응.
    const d = (t - center) / 0.35;
    return Math.max(0.15, Math.exp(-d * d));
  }

  // 마스크 강도 → 톤 조정(변경 영역만, work 버퍼 위 누적)
  _composite() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const W = this.layer.width;
    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    const out = this.work;
    const od = out.data;
    const exposure = this.p.exposure;
    const mode = this.p.mode;
    const sponge = mode === "sponge";

    for (let yy = 0; yy < cb.h; yy++) {
      const ty = cb.y + yy;
      for (let xx = 0; xx < cb.w; xx++) {
        const mi = (yy * cb.w + xx) * 4;
        const a = m[mi] / 255; // 잉크 강도(0~1)
        if (a <= 0) continue;
        const di = (ty * W + (cb.x + xx)) * 4;
        if (od[di + 3] === 0) continue; // 완전 투명 픽셀은 건너뜀

        let r = od[di], g = od[di + 1], b = od[di + 2];

        if (sponge) {
          // 채도 조정: 휘도를 기준으로 색을 당기거나(desaturate) 밀어낸다(saturate)
          const lum = luminance(r, g, b);
          // amount>0: 채도↑(휘도에서 멀어짐), amount<0: 채도↓(휘도로 수렴)
          const amount = (this.p.spongeSaturate ? 1 : -1) * exposure * a;
          r = r + (r - lum) * amount;
          g = g + (g - lum) * amount;
          b = b + (b - lum) * amount;
        } else {
          // dodge/burn: 범위 가중치 × 노출 × 강도
          const lum = luminance(r, g, b);
          const w = this._rangeWeight(lum);
          const amt = exposure * a * w * 0.5; // 0.5: 한 패스 과도함 방지 스케일
          if (mode === "dodge") {
            // 밝게: 흰색(255)에 비율만큼 접근(스크린 유사)
            r = r + (255 - r) * amt;
            g = g + (255 - g) * amt;
            b = b + (255 - b) * amt;
          } else {
            // 번: 검정(0)에 비율만큼 접근(멀티플라이 유사)
            r = r * (1 - amt);
            g = g * (1 - amt);
            b = b * (1 - amt);
          }
        }

        od[di]     = r < 0 ? 0 : r > 255 ? 255 : r;
        od[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        od[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        // 알파는 유지(톤 보정은 색만 바꾼다)
      }
    }

    // 부분 반영: out은 레이어 전체 크기 버퍼지만 이번 호출에서 실제로 바뀐 곳은 cb 영역뿐이다
    // (cb 밖은 이 stroke에서 한 번도 손댄 적이 없어 out과 캔버스가 이미 같은 값).
    // 과거엔 여기서 캔버스 전체를 putImageData해 4000x4000 기준 이동 1회당 64MB를 복사했다.
    this.layer.ctx.putImageData(out, 0, 0, cb.x, cb.y, cb.w, cb.h);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  drawOverlay(ctx, vp) {
    if (!this._hover) return;
    const c = vp.worldToScreen(this._hover.x, this._hover.y);
    const r = Math.max(0.5, this.state.brushSize / 2) * vp.zoom;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
    ctx.restore();
  }
}
