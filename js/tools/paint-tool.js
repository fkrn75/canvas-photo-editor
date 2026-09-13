// paint-tool.js — 브러시 / 연필 / 지우개.
//
// 부드러운 가장자리를 제대로 표현하기 위해 "강도 마스크" 방식을 쓴다.
//  1) stroke 동안 별도 마스크 캔버스(불투명 검정)에 흰색 스탬프를 globalCompositeOperation='lighten'으로 찍는다.
//     lighten은 픽셀별 최댓값을 취하므로, 스탬프가 겹쳐도 강도가 누적되지 않는다(=부드러운 가장자리 보존).
//  2) 매 프레임 "stroke 시작 전 스냅샷"을 복원한 뒤, 마스크 밝기를 잉크 알파로 환산해 색을 입혀 합성한다.
// 이렇게 하면 한 stroke 안의 중첩이 불투명도/부드러움을 망가뜨리지 않는다.
//
// [브러시 동역학] (브러시 도구 한정 — 연필/지우개는 영향 없음)
//   brush-dynamics.js 엔진을 통해 스탬프마다 크기/각도/위치/색을 변조한다.
//   - 동역학 OFF, 또는 연필/지우개: 위의 단색-마스크 경로를 그대로 탄다(완전한 기존 동작, 회귀 없음).
//   - Shape/Scatter만 ON: 단색-마스크 경로 안에서 점(dot)의 크기/각도/위치만 흔든다(_stampDynamicMask).
//   - Color/Dual ON: 스탬프마다 색·질감이 달라지므로 "스탬프별 채색 경로"로 분기한다(_strokeLayer 사용).
//       각 dab은 flow 알파로 stroke 레이어에 source-over 누적되고, stroke 전체를 opacity로 한 번에 합성한다
//       (포토샵의 flow↔opacity 분리와 동일 — stroke 내 중첩은 쌓이되 stroke 총량은 opacity로 상한).

import { BaseTool } from "./base-tool.js";
import { hexToRgb } from "../engine/color.js";
import { newBounds, expandBounds, boundsToBox, clampBox, cropImageData } from "../engine/imagedata.js";
import { MaskPaintCommand } from "../history/commands/layer-structure-command.js";
import { BrushDynamics } from "../engine/brush-dynamics.js";

export class PaintTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
    this.dyn = new BrushDynamics(this.state); // 브러시 동역학 엔진(브러시 도구에서만 사용)
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

    // 편집 대상 결정: 빠른마스크 > 레이어마스크 > 레이어픽셀
    this.quickMaskTarget = !!this.app.quickMask?.active;
    this.targetMask = this.quickMaskTarget || !!(layer.maskActive && layer.mask);

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

    // ── 브러시 동역학 활성 판정 ──
    // 동역학은 "브러시" 도구에만 적용(연필/지우개는 순수 유지).
    // 또한 색을 다루는 동역학(Color/Dual)은 마스크(그레이) 편집/빠른마스크에서는 의미가 없으므로
    // 그 경우엔 색 경로를 끄고 Shape/Scatter만 단색 경로에서 처리한다.
    this.dynOn = this.id === "brush" && this.dyn.isActive();
    this.perStampColor = this.dynOn && this.dyn.needsPerStampColor() && !this.targetMask;
    if (this.dynOn) this.dyn.reset(); // stroke마다 난수열 초기화

    // 대상 컨텍스트 + 변경 전 스냅샷(undo용)
    this.targetCtx = this.quickMaskTarget ? this.app.quickMask.ctx
                   : (this.targetMask ? layer.maskCtx : layer.ctx);
    if (this.quickMaskTarget) {
      // 빠른 마스크: 선택 환원은 exit에서 하므로 stroke 단위 히스토리는 생략(일시 편집)
      this.before = this.targetCtx.getImageData(0, 0, layer.width, layer.height);
    } else if (this.targetMask) {
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

    // ── 텍스처/노이즈 알파 변조 마스크(없으면 null) ──
    // 색이 아니라 강도(알파)에만 곱하므로 단색·색 경로 양쪽에서 공통 사용. dynOn일 때만.
    this.alphaMod = this.dynOn ? this.dyn.buildAlphaModulator(layer.width, layer.height) : null;
    this.amd = this.alphaMod ? this.alphaMod.getContext("2d", { willReadFrequently: true }) : null;

    // ── 스탬프별 채색 경로 준비 ──
    if (this.perStampColor) {
      // 색 dab을 누적할 stroke 레이어(투명 시작). 선택 영역 클립 적용.
      this.strokeLayer = document.createElement("canvas");
      this.strokeLayer.width = layer.width;
      this.strokeLayer.height = layer.height;
      this.sctx = this.strokeLayer.getContext("2d", { willReadFrequently: true });
      if (this.selection?.active) { this.sctx.save(); this.selection.applyClipPath(this.sctx); this._strokeClipped = true; }
      else this._strokeClipped = false;
      // Dual Brush 2차 텍스처 마스크(없으면 null)
      this.dualMask = this.dyn.buildDualMask(layer.width, layer.height,
        this.selection?.active ? (c) => this.selection.applyClipPath(c) : null);
      this.dualCtx = this.dualMask ? this.dualMask.getContext("2d", { willReadFrequently: true }) : null;
    }

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
      this.app.renderer.requestOverlayRender(); // 커서 위치 갱신(레이어 픽셀 무관 — 합성 캐시 유지)
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    const label = this.id === "eraser" ? "지우개" : this.id === "pencil" ? "연필" : "브러시";

    if (this.quickMaskTarget) {
      // 빠른 마스크 버퍼만 갱신(레이어/히스토리 무관). 화면은 renderer 오버레이가 반영.
      this.app.renderer.requestRender();
    } else if (this.targetMask) {
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
    this.targetCtx = null; this.targetMask = false; this.quickMaskTarget = false;
    this.strokeLayer = null; this.sctx = null; this.dualMask = null; this.dualCtx = null;
    this.perStampColor = false; this.dynOn = false; this.alphaMod = null; this.amd = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  // a→b 구간을 거리 기반으로 보간하며 스탬프를 찍는다.
  // 동역학 경로에 따라 단색-마스크(_dot) 또는 스탬프별 채색(_colorDab)으로 분기한다.
  _stamp(a, b) {
    const r = Math.max(0.5, this.p.size / 2);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(0.5, r * 0.15);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;

      if (!this.dynOn) {
        // ── 기존 경로(동역학 OFF) : 중심에 기본 크기 한 번 ──
        this._dot(x, y, r);
        expandBounds(this.bounds, x, y, r + 2);
      } else {
        // ── 동역학 ON : 엔진이 만든 스탬프 목록대로 ──
        const stamps = this.dyn.stampsAt(x, y, r, this.p.rgb);
        for (const sp of stamps) {
          if (this.perStampColor) this._colorDab(sp);
          else this._dot(sp.x, sp.y, sp.r, sp.angle); // Shape/Scatter만: 단색 마스크에 변조 점
          expandBounds(this.bounds, sp.x, sp.y, sp.r + 2);
        }
      }
    }
  }

  // 마스크에 흰색(=강도) 스탬프. 색/지우기는 _composite에서 처리.
  // angle: 동역학 각도 지터(라디안). 방향성 있는 모양(square/calligraphy)에만 적용.
  _dot(x, y, r, angle = 0) {
    const ctx = this.mctx;
    ctx.globalAlpha = 1;
    switch (this.p.brushType) {
      case "square":
        if (angle) { ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = "#fff"; ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore(); }
        else { ctx.fillStyle = "#fff"; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
        break;
      case "calligraphy":
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle - Math.PI / 4);
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

  // 스탬프별 채색 dab — stroke 레이어에 색을 직접 누적(flow=경도 기반 알파).
  // sp = { x, y, r, angle, color:{r,g,b} }
  _colorDab(sp) {
    const ctx = this.sctx;
    const { r: cr, g: cg, b: cb } = sp.color;
    const r = sp.r;
    // flow: 한 dab의 불투명도. 경도가 낮으면 가장자리가 부드럽게 빠지는 radial로 표현.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const hard = this.p.hardness;
    if (hard >= 1 || this.p.brushType !== "round") {
      // 단단하거나 비원형: 균일 알파 채색(모양은 _paintShape에서)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},1)`;
      this._paintShape(ctx, sp.x, sp.y, r, sp.angle, `rgba(${cr},${cg},${cb},1)`);
    } else {
      const inner = Math.max(0.001, r * hard);
      const grd = ctx.createRadialGradient(sp.x, sp.y, inner, sp.x, sp.y, r);
      grd.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
      grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Dual Brush: 2차 텍스처 강도를 같은 위치에 누적(나중에 stroke 레이어 알파에 곱한다)
    if (this.dualCtx) this.dyn.stampDualTexture(this.dualCtx, sp.x, sp.y, r);
  }

  // 채색 경로용 모양 그리기(원/사각/캘리/스패터/분필). 단색 _dot의 색 버전.
  _paintShape(ctx, x, y, r, angle, fill) {
    ctx.fillStyle = fill;
    switch (this.p.brushType) {
      case "square":
        ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle); ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
        break;
      case "calligraphy":
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle - Math.PI / 4);
        ctx.beginPath(); ctx.ellipse(0, 0, r, Math.max(0.5, r * 0.34), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      case "spatter": {
        const n = Math.max(5, Math.round(r * 1.6));
        for (let i = 0; i < n; i++) {
          const a = this.dyn.rng() * Math.PI * 2, rad = this.dyn.rng() * r;
          const dr = Math.max(0.5, r * 0.14 * this.dyn.rng());
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, dr, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case "chalk": {
        const n = Math.max(10, Math.round(r * r * 0.6));
        for (let i = 0; i < n; i++) {
          const a = this.dyn.rng() * Math.PI * 2, rad = Math.sqrt(this.dyn.rng()) * r;
          ctx.fillRect(Math.round(x + Math.cos(a) * rad), Math.round(y + Math.sin(a) * rad), 1, 1);
        }
        break;
      }
      default: // round 단단
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 마스크(강도) → 색/지우기로 변환해 대상(레이어 픽셀 또는 레이어 마스크, 변경 영역만)에 합성
  _composite() {
    const ctx = this.targetCtx;        // 레이어 픽셀 ctx 또는 마스크 ctx
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }
    // 부분 복원: this.bounds는 stroke 동안 단조 증가만 하므로(축소 없음) cb도 프레임마다 커지기만 한다.
    // 즉 cb 밖 픽셀은 이 stroke에서 한 번도 스탬프가 찍힌 적이 없어 항상 before 그대로다 — 복원 불필요.
    // (과거엔 매 프레임 캔버스 전체를 putImageData로 복원해 4000x4000 기준 이동 1회당 64MB를 복사했다.)
    ctx.putImageData(this.before, 0, 0, cb.x, cb.y, cb.w, cb.h);

    // ── 스탬프별 채색 경로: stroke 레이어를 opacity로 한 번에 얹는다(flow↔opacity 분리) ──
    if (this.perStampColor) {
      this._compositeColor(cb);
      return;
    }

    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    // 텍스처/노이즈: 강도 마스크에 변조를 곱해 넣는다(마스크편집/레이어픽셀 경로 공통).
    if (this.amd) {
      const amData = this.amd.getImageData(cb.x, cb.y, cb.w, cb.h).data;
      for (let i = 0; i < m.length; i += 4) m[i] = (m[i] * amData[i]) / 255;
    }
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

  // 스탬프별 채색 합성: stroke 레이어(색 dab 누적)를 레이어 픽셀 위에 opacity로 알파 합성.
  // Dual Brush가 있으면 stroke 알파에 2차 텍스처 강도를 곱해 질감을 입힌다.
  _compositeColor(cb) {
    const ctx = this.targetCtx;
    const out = ctx.getImageData(cb.x, cb.y, cb.w, cb.h);
    const od = out.data;
    const sd = this.sctx.getImageData(cb.x, cb.y, cb.w, cb.h).data; // stroke 레이어(색+알파)
    const dual = this.dualCtx ? this.dualCtx.getImageData(cb.x, cb.y, cb.w, cb.h).data : null;
    const amd = this.amd ? this.amd.getImageData(cb.x, cb.y, cb.w, cb.h).data : null;
    const op = this.p.opacity;
    const lockT = this.layer.lockTransparency;

    for (let i = 0; i < sd.length; i += 4) {
      let a = (sd[i + 3] / 255) * op; // dab 누적 알파 × 전체 opacity
      if (dual) a *= dual[i] / 255;   // Dual Brush 질감 강도 곱
      if (amd) a *= amd[i] / 255;     // 텍스처/노이즈 강도 곱
      if (a <= 0) continue;
      const srcA = od[i + 3];
      if (lockT) {
        if (srcA <= 0) continue;
        a = a * (srcA / 255);
      }
      const ia = 1 - a;
      // stroke 레이어 색은 프리멀티플라이가 아니므로(source-over로 누적된 평색) 그대로 사용.
      od[i]     = sd[i]     * a + od[i] * ia;
      od[i + 1] = sd[i + 1] * a + od[i + 1] * ia;
      od[i + 2] = sd[i + 2] * a + od[i + 2] * ia;
      od[i + 3] = 255 * a + srcA * ia;
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
