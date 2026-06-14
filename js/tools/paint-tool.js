// paint-tool.js — 브러시 / 연필 / 지우개.
//
// 부드러운 가장자리를 제대로 표현하기 위해 "강도 마스크" 방식을 쓴다.
//  1) stroke 동안 별도 마스크 캔버스(불투명 검정)에 흰색 스탬프를 globalCompositeOperation='lighten'으로 찍는다.
//     lighten은 픽셀별 최댓값을 취하므로, 스탬프가 겹쳐도 강도가 누적되지 않는다(=부드러운 가장자리 보존).
//  2) 매 프레임 "stroke 시작 전 스냅샷"을 복원한 뒤, 마스크 밝기를 잉크 알파로 환산해 색을 입혀 합성한다.
// 이렇게 하면 한 stroke 안의 중첩이 불투명도/부드러움을 망가뜨리지 않는다.

import { BaseTool } from "./base-tool.js";
import { hexToRgb } from "../engine/color.js";
import { newBounds, expandBounds, boundsToBox, clampBox, cropImageData } from "../engine/imagedata.js";
import { MaskPaintCommand } from "../history/commands/layer-structure-command.js";

export class PaintTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
  }

  get cursor() { return "none"; } // 브러시 원형 커서를 직접 그린다

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: this.id === "pencil" ? 1 : s.brushHardness,
      opacity: this.id === "pencil" ? 1 : s.brushOpacity,
      erase: this.id === "eraser",
      rgb: hexToRgb(s.foreground),
      brushType: this.id === "brush" ? s.brushType : "round",
    };
  }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;

    // 편집 대상 결정: 마스크 편집 중이면 마스크 캔버스, 아니면 레이어 픽셀
    this.targetMask = !!(layer.maskActive && layer.mask);

    // 잠금 검사(마스크 편집에는 레이어 잠금이 적용되지 않음)
    if (!this.targetMask) {
      if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 칠할 수 없습니다."); return; }
      // 투명 영역 잠금: 칠하기는 허용하되 기존 알파>0 영역으로만 제한(_composite에서 처리).
      // 지우개+lockTransparency는 포토샵에서 배경색으로 칠하지만, 여기선 기존 동작 보존을 위해 알파만 제한.
    }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();

    // 대상 컨텍스트 + 변경 전 스냅샷(undo용)
    this.targetCtx = this.targetMask ? layer.maskCtx : layer.ctx;
    if (this.targetMask) {
      // 마스크 직접 편집: 자체 before 스냅샷(히스토리 begin/commit은 레이어 픽셀 전용)
      this.before = layer.maskCtx.getImageData(0, 0, layer.width, layer.height);
    } else {
      this.history.beginPixelEdit(layer);
      this.before = this.history._peBefore;
    }

    // 강도 마스크: 불투명 검정으로 시작 → 흰색 스탬프를 lighten으로 누적
    this.mask = document.createElement("canvas");
    this.mask.width = layer.width;
    this.mask.height = layer.height;
    this.mctx = this.mask.getContext("2d", { willReadFrequently: true });
    this.mctx.fillStyle = "#000";
    this.mctx.fillRect(0, 0, layer.width, layer.height);
    if (this.selection?.active) this.selection.applyClipPath(this.mctx); // 선택 영역으로 제한
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
      this.app.renderer.requestRender(); // 커서 위치 갱신
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    const label = this.id === "eraser" ? "지우개" : this.id === "pencil" ? "연필" : "브러시";

    if (this.targetMask) {
      // 마스크 편집: 변경 영역만 잘라 MaskPaintCommand로 등록
      const layer = this.layer;
      const cb = box && clampBox(box, layer.width, layer.height);
      if (cb) {
        const beforeCrop = cropImageData(this.before, cb);
        const afterCrop = layer.maskCtx.getImageData(cb.x, cb.y, cb.w, cb.h);
        this.history.push(new MaskPaintCommand(this.layers, layer.id, cb.x, cb.y, beforeCrop, afterCrop, label + " (마스크)"));
      }
      this.layers.notifyContent(layer.id);
    } else {
      this.history.commitPixelEdit(box, label);
    }

    this.mask = null; this.mctx = null; this.before = null; this.layer = null;
    this.targetCtx = null; this.targetMask = false;
  }

  onLeave() { this._hover = null; this.app.renderer.requestRender(); }

  // a→b 구간을 거리 기반으로 보간하며 마스크에 스탬프를 찍는다
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

  // 마스크에 흰색(=강도) 스탬프. 색/지우기는 _composite에서 처리.
  _dot(x, y, r) {
    const ctx = this.mctx;
    ctx.globalAlpha = 1;
    switch (this.p.brushType) {
      case "square":
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        break;
      case "calligraphy":
        ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.ellipse(0, 0, r, Math.max(0.5, r * 0.34), 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      case "spatter": {
        ctx.fillStyle = "#fff";
        const n = Math.max(5, Math.round(r * 1.6));
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2, rad = Math.random() * r;
          const dotR = Math.max(0.5, r * 0.14 * Math.random());
          ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, dotR, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case "chalk": {
        ctx.fillStyle = "#fff";
        const n = Math.max(10, Math.round(r * r * 0.6));
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * r;
          ctx.fillRect(Math.round(x + Math.cos(ang) * rad), Math.round(y + Math.sin(ang) * rad), 1, 1);
        }
        break;
      }
      default: { // round: 경도에 따른 부드러운 원
        if (this.p.hardness >= 1) {
          // 경도 100%: 단단한 원 (radial gradient의 r0==r1 퇴화로 안 그려지는 것 방지)
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
    }
  }

  // 마스크(강도) → 색/지우기로 변환해 대상(레이어 픽셀 또는 레이어 마스크, 변경 영역만)에 합성
  _composite() {
    const ctx = this.targetCtx;        // 레이어 픽셀 ctx 또는 마스크 ctx
    ctx.putImageData(this.before, 0, 0);
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    const out = ctx.getImageData(cb.x, cb.y, cb.w, cb.h);
    const od = out.data;
    const op = this.p.opacity;
    const erase = this.p.erase;

    if (this.targetMask) {
      // ── 마스크 페인팅: 그레이스케일에 칠한다(검정=가림 / 흰=드러냄) ──
      // 브러시는 전경색의 휘도를 그레이 값으로 사용. 지우개는 흰색(=드러냄)으로 칠한다.
      const { r, g, b } = this.p.rgb;
      const gray = erase ? 255 : Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      for (let i = 0; i < m.length; i += 4) {
        const a = (m[i] / 255) * op; // 잉크 강도
        if (a <= 0) continue;
        const ia = 1 - a;
        od[i]     = gray * a + od[i] * ia;
        od[i + 1] = gray * a + od[i + 1] * ia;
        od[i + 2] = gray * a + od[i + 2] * ia;
        od[i + 3] = 255; // 마스크는 항상 불투명(알파 채널 미사용)
      }
    } else {
      // ── 레이어 픽셀 페인팅(기존 경로) ──
      const { r, g, b } = this.p.rgb;
      // 투명 영역 잠금: 칠하기 전 알파(=현재 od[i+3], before를 막 복원해 읽은 값)로 강도 제한.
      const lockT = this.layer.lockTransparency;
      for (let i = 0; i < m.length; i += 4) {
        let a = (m[i] / 255) * op; // 마스크 밝기 × 불투명도 = 잉크 강도
        if (a <= 0) continue;
        const srcA = od[i + 3]; // 변경 전 픽셀 알파
        if (lockT) {
          // 투명 잠금: 투명 영역엔 칠하지 않고, 지우개는 알파를 바꾸지 않음(잠금 의미 보존)
          if (srcA <= 0 || erase) continue;
          a = a * (srcA / 255);        // 기존 알파에 비례해 제한(가장자리 자연스럽게)
        }
        if (erase) {
          od[i + 3] = srcA * (1 - a);
        } else {
          const ia = 1 - a;
          od[i] = r * a + od[i] * ia;
          od[i + 1] = g * a + od[i + 1] * ia;
          od[i + 2] = b * a + od[i + 2] * ia;
          od[i + 3] = 255 * a + srcA * ia;
        }
      }
    }
    ctx.putImageData(out, cb.x, cb.y);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 브러시 크기 원형 커서
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
