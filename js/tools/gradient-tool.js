// gradient-tool.js — 그라디언트 도구.
// 드래그로 시작점→끝점을 정하면 그 축을 따라 그라디언트를 채운다.
//   onPointerDown: 시작점 기록
//   onPointerMove: 미리보기(드래그 라인 오버레이) + 라이브 합성 미리보기
//   onPointerUp:  활성 레이어에 확정(히스토리 1스텝)
//
// 종류: Linear(선형) / Radial(방사형) / Angle(각도) / Reflected(반사) / Diamond(다이아몬드)
// 색  : foreground→background(전경→배경) / foreground→transparent(전경→투명)
// 옵션: 종류, 모드, Reverse(반전), Opacity, (선택)블렌드 Mode.
// Shift: 드래그 각도를 45° 단위로 고정.
//
// 선택 영역이 있으면 선택 마스크 알파로 클립한다(페더 부분선택 알파까지 반영).
// 합성은 "오프스크린 그라디언트 캔버스 → (선택 마스크 곱) → 활성 레이어" 순서로 수행해
// 불투명도/블렌드 모드/선택 클립이 서로 간섭하지 않게 한다.

import { BaseTool } from "./base-tool.js";
import { hexToRgb } from "../engine/color.js";

// Angle/Diamond 처럼 Canvas 기본 그라디언트로 표현 불가능한 종류는
// 오프스크린에 픽셀 단위로 직접 채운다. Linear/Radial/Reflected는
// createLinearGradient / createRadialGradient 로 그린다.
const ANGLE = "angle";
const DIAMOND = "diamond";

// 블렌드 모드(선택) → Canvas globalCompositeOperation 매핑.
// 그라디언트를 아래 픽셀 위에 합성할 때 쓰는 네이티브 모드만 추린 것.
// (레이어 블렌드 24종과 달리 도구 옵션은 흔히 쓰는 것만 노출)
const PAINT_GCO = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

export class GradientTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    this.layer = layer;
    this.drawing = true;
    this.start = pt;
    this.end = pt;
    this.shift = e.shiftKey;

    // 그리기 시작 직전 전체 스냅샷 확보(라이브 미리보기 복원 + 히스토리 before로 재사용)
    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;

    // 도구 옵션 스냅샷(드래그 중 옵션이 바뀌어도 일관되게)
    this.opts = this._params();
  }

  onPointerMove(pt, e) {
    if (!this.drawing) return;
    this.end = pt;
    this.shift = e.shiftKey;
    this._composite(); // 라이브 미리보기(레이어에 직접 그렸다가 onPointerUp에서 확정)
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.end = pt;
    this.shift = e.shiftKey;

    // 시작점==끝점(클릭만)인 경우: 길이 0 그라디언트는 의미 없음 → 편집 취소
    const a = this.start, b = this._effectiveEnd();
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) {
      this.history.cancelPixelEdit();
      this._reset();
      this.app.renderer.requestRender();
      return;
    }

    this._composite();          // 최종 결과를 레이어에 확정
    this.history.commitPixelEdit(null, "그라디언트"); // 전체 레이어 1스텝(채움은 전역적)
    this._reset();
  }

  onLeave() {
    // 드래그 중 캔버스를 벗어나도 pointercapture로 up이 오므로 별도 처리는 불필요.
  }

  _reset() {
    this.before = null;
    this.layer = null;
    this.opts = null;
  }

  // 현재 상태에서 도구 파라미터 묶음
  _params() {
    const s = this.state;
    return {
      type: s.gradientType || "linear",            // linear|radial|angle|reflected|diamond
      colorMode: s.gradientColorMode || "fg-bg",   // fg-bg | fg-transparent
      reverse: !!s.gradientReverse,
      opacity: s.gradientOpacity != null ? s.gradientOpacity : 1, // 0~1
      blend: PAINT_GCO[s.gradientBlendMode] ? s.gradientBlendMode : "normal",
      fg: hexToRgb(s.foreground),
      bg: hexToRgb(s.background),
    };
  }

  // Shift 적용된 끝점(45° 단위 고정)
  _effectiveEnd() {
    if (!this.shift) return this.end;
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return this.end;
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: this.start.x + Math.cos(ang) * len, y: this.start.y + Math.sin(ang) * len };
  }

  // 두 색 스톱을 [start, end] 색으로 결정. reverse면 뒤집는다.
  // 반환: { c0:{r,g,b,a}, c1:{r,g,b,a} }  (a=0~1)
  _stops(o) {
    const fg = o.fg, bg = o.bg;
    let c0, c1;
    if (o.colorMode === "fg-transparent") {
      c0 = { r: fg.r, g: fg.g, b: fg.b, a: 1 };
      c1 = { r: fg.r, g: fg.g, b: fg.b, a: 0 };
    } else { // fg-bg
      c0 = { r: fg.r, g: fg.g, b: fg.b, a: 1 };
      c1 = { r: bg.r, g: bg.g, b: bg.b, a: 1 };
    }
    return o.reverse ? { c0: c1, c1: c0 } : { c0, c1 };
  }

  // 오프스크린(문서 크기)에 그라디언트만 그린 캔버스를 만든다.
  _renderGradientCanvas() {
    const o = this.opts;
    const W = this.layer.width, H = this.layer.height;
    const a = this.start, b = this._effectiveEnd();
    const { c0, c1 } = this._stops(o);

    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d", { willReadFrequently: true });

    const rgba = (c) => `rgba(${c.r},${c.g},${c.b},${c.a})`;

    if (o.type === "linear" || o.type === "reflected") {
      if (o.type === "reflected") {
        // 반사형: 중심(start)에서 양쪽으로 같은 그라디언트가 대칭으로 뻗는다.
        // start를 0.5로 두고 끝점 방향과 반대 방향 모두 채우도록 축을 2배로 잡는다.
        const grd = g.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
        grd.addColorStop(0, rgba(c1));
        grd.addColorStop(0.5, rgba(c0));
        grd.addColorStop(1, rgba(c1));
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
      } else {
        const grd = g.createLinearGradient(a.x, a.y, b.x, b.y);
        grd.addColorStop(0, rgba(c0));
        grd.addColorStop(1, rgba(c1));
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
      }
    } else if (o.type === "radial") {
      // 방사형: 중심 a, 반지름 = |a→b|. 안쪽 c0 → 바깥 c1.
      const r = Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
      const grd = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
      grd.addColorStop(0, rgba(c0));
      grd.addColorStop(1, rgba(c1));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      // 반지름 바깥은 createRadialGradient가 마지막 색(c1)으로 채우므로 추가 처리 불필요.
    } else if (o.type === ANGLE) {
      this._fillAngle(g, W, H, a, b, c0, c1);
    } else if (o.type === DIAMOND) {
      this._fillDiamond(g, W, H, a, b, c0, c1);
    } else {
      // 알 수 없는 종류 → 선형으로 폴백
      const grd = g.createLinearGradient(a.x, a.y, b.x, b.y);
      grd.addColorStop(0, rgba(c0));
      grd.addColorStop(1, rgba(c1));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }

    return cv;
  }

  // 각도형(conic): 시작 각도(a→b 방향)를 0으로 두고 한 바퀴(360°) 도는 동안 c0→c1.
  // Canvas에 conic gradient API가 없으므로 픽셀 단위로 직접 채운다.
  _fillAngle(g, W, H, a, b, c0, c1) {
    const base = Math.atan2(b.y - a.y, b.x - a.x);
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let ang = Math.atan2(y - a.y, x - a.x) - base; // 시작 방향 기준 각
        ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const t = ang / (Math.PI * 2); // 0~1
        const i = (y * W + x) * 4;
        d[i]     = c0.r + (c1.r - c0.r) * t;
        d[i + 1] = c0.g + (c1.g - c0.g) * t;
        d[i + 2] = c0.b + (c1.b - c0.b) * t;
        d[i + 3] = (c0.a + (c1.a - c0.a) * t) * 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // 다이아몬드형: 중심 a에서 체비셰프 유사 거리(회전된 정사각형 등고선)로 c0→c1.
  // 거리 = max(|투영_주축|, |투영_부축|) / 반지름. b가 한 꼭짓점 방향이 된다.
  _fillDiamond(g, W, H, a, b, c0, c1) {
    let ux = b.x - a.x, uy = b.y - a.y;
    const len = Math.max(0.0001, Math.hypot(ux, uy));
    ux /= len; uy /= len;          // 주축 단위벡터
    const vx = -uy, vy = ux;       // 부축(수직) 단위벡터
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - a.x, dy = y - a.y;
        const p = dx * ux + dy * uy; // 주축 투영
        const q = dx * vx + dy * vy; // 부축 투영
        let t = (Math.abs(p) + Math.abs(q)) / len; // 마름모 등고선(맨해튼 거리)
        if (t > 1) t = 1;
        const i = (y * W + x) * 4;
        d[i]     = c0.r + (c1.r - c0.r) * t;
        d[i + 1] = c0.g + (c1.g - c0.g) * t;
        d[i + 2] = c0.b + (c1.b - c0.b) * t;
        d[i + 3] = (c0.a + (c1.a - c0.a) * t) * 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // 그라디언트를 활성 레이어에 합성한다.
  // 매 미리보기/확정 호출마다 "그리기 전 스냅샷"을 복원한 뒤 다시 그려, 중첩 누적을 막는다.
  _composite() {
    const layer = this.layer;
    if (!layer) return;
    const ctx = layer.ctx;

    // 1) 시작 상태로 복원
    ctx.putImageData(this.before, 0, 0);

    // 2) 그라디언트 오프스크린 생성
    const grad = this._renderGradientCanvas();

    // 3) 선택 영역이 있으면 그라디언트 알파에 선택 마스크 알파를 곱한다(페더 반영).
    const sel = this.selection;
    if (sel?.active && sel.mask) {
      this._maskBySelection(grad, sel.mask, layer.width, layer.height);
    }

    // 4) 불투명도 + 블렌드 모드로 레이어에 합성
    ctx.save();
    ctx.globalAlpha = this.opts.opacity;
    ctx.globalCompositeOperation = PAINT_GCO[this.opts.blend] || "source-over";
    ctx.drawImage(grad, 0, 0);
    ctx.restore();

    layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 그라디언트 캔버스의 픽셀 알파에 선택 마스크 알파(0~255)를 곱해 선택 밖을 0으로 만든다.
  _maskBySelection(gradCanvas, mask, W, H) {
    const g = gradCanvas.getContext("2d", { willReadFrequently: true });
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    for (let p = 0, n = W * H; p < n; p++) {
      const m = mask[p];               // 0~255 (페더 시 중간값)
      if (m === 255) continue;
      const i = p * 4;
      d[i + 3] = (d[i + 3] * m) / 255;  // 알파를 선택 강도로 감쇠
    }
    g.putImageData(img, 0, 0);
  }

  // 드래그 라인 + 끝점 표시(화면 좌표계)
  drawOverlay(ctx, vp) {
    if (!this.drawing) return;
    const a = vp.worldToScreen(this.start.x, this.start.y);
    const bw = this._effectiveEnd();
    const b = vp.worldToScreen(bw.x, bw.y);

    ctx.save();
    ctx.lineWidth = 1;
    // 검정/흰색 이중선으로 배경 대비 확보
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = 1; ctx.stroke();

    // 양 끝 점
    for (const p of [a, b]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.stroke();
    }
    ctx.restore();
  }
}
