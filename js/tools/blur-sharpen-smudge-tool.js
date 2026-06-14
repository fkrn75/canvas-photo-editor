// blur-sharpen-smudge-tool.js — 흐리게(Blur) / 선명(Sharpen) / 번짐(Smudge).
//
// 3모드(app.state.retouchMode):
//   - "blur":    브러시 아래를 3x3 박스 블러로 흐리게
//   - "sharpen": 언샤프(원본 + (원본−블러)) 방식으로 선명하게
//   - "smudge":  직전 위치의 색을 끌고 가며 번지게(손가락으로 문지르는 효과)
//
// 강도(app.state.retouchStrength, 0~1): 효과의 세기.
//
// 합성 사상: blur/sharpen은 매 스탬프마다 현재 work 버퍼에서 해당 점 주변을 읽어 연산 → 강도로 블렌딩.
//   smudge는 "픽업 버퍼"(직전 위치에서 떠온 영역)를 다음 위치에 강도만큼 섞어 색을 끌고 간다.
// 누적이 본질이므로 work 버퍼 위에 직접 이어 칠한다(매 프레임 before 복원 안 함).

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";

export class BlurSharpenSmudgeTool extends BaseTool {
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
      mode: s.retouchMode || "blur",     // blur | sharpen | smudge
      strength: s.retouchStrength ?? 0.5, // 0~1
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

    // smudge용 픽업 버퍼: 직전 스탬프 위치에서 떠온 사각 패치
    this.pickup = null;

    this.last = pt;
    this._stampLine(pt, pt);
    this._flush();
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (this.drawing) {
      this._stampLine(this.last, pt);
      this.last = pt;
      this._flush();
    } else {
      this.app.renderer.requestRender();
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._flush();
    const box = boundsToBox(this.bounds);
    const label = this.p.mode === "blur" ? "흐리게" : this.p.mode === "sharpen" ? "선명하게" : "번짐";
    this.history.commitPixelEdit(box, label);

    this.before = null; this.work = null; this.pickup = null; this.layer = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestRender(); }

  // a→b 구간을 보간하며 각 점에 효과를 적용
  _stampLine(a, b) {
    const r = Math.max(1, this.p.size / 2);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(0.5, r * 0.25); // 효과가 무거워 보간 간격을 조금 넓게
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      this._apply(x, y, r);
      expandBounds(this.bounds, x, y, r + 2);
    }
  }

  // 점(cx,cy) 중심, 반경 r 영역에 모드별 효과 적용 (work 버퍼 직접 수정)
  _apply(cx, cy, r) {
    const W = this.layer.width, H = this.layer.height;
    const ri = Math.ceil(r);
    const x0 = Math.max(0, Math.floor(cx) - ri);
    const y0 = Math.max(0, Math.floor(cy) - ri);
    const x1 = Math.min(W - 1, Math.floor(cx) + ri);
    const y1 = Math.min(H - 1, Math.floor(cy) + ri);
    if (x1 < x0 || y1 < y0) { this.pickup = null; return; }

    const d = this.work.data;
    const strength = this.p.strength;
    const hard = this.p.hardness;
    const sel = this.selection;

    // 브러시 강도(거리/경도/선택영역 반영) 계산 헬퍼
    const falloff = (px, py) => {
      const dx = px - cx, dy = py - cy;
      const dd = Math.hypot(dx, dy);
      if (dd > r) return 0;
      let f;
      if (hard >= 1) f = 1;
      else {
        const inner = r * hard;
        f = dd <= inner ? 1 : 1 - (dd - inner) / (r - inner);
      }
      if (sel?.active && !sel.isSelected(px, py)) return 0;
      return f;
    };

    if (this.p.mode === "smudge") {
      this._applySmudge(d, W, x0, y0, x1, y1, cx, cy, r, strength, falloff);
      return;
    }

    // blur/sharpen: 원본(work 현재값)을 읽어 3x3 박스 블러를 구하고 강도로 블렌딩.
    // work를 직접 고치면 같은 패스 내 이웃 참조가 오염되므로, 영역 사본에서 읽어 결과를 work에 쓴다.
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const srcPatch = new Float32Array(bw * bh * 4);
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const si = ((y0 + yy) * W + (x0 + xx)) * 4;
        const pi = (yy * bw + xx) * 4;
        srcPatch[pi] = d[si]; srcPatch[pi + 1] = d[si + 1];
        srcPatch[pi + 2] = d[si + 2]; srcPatch[pi + 3] = d[si + 3];
      }
    }

    const sharpen = this.p.mode === "sharpen";
    for (let yy = 0; yy < bh; yy++) {
      const py = y0 + yy;
      for (let xx = 0; xx < bw; xx++) {
        const px = x0 + xx;
        const f = falloff(px, py) * strength;
        if (f <= 0) continue;

        // 3x3 평균(패치 경계는 클램프)
        let sr = 0, sg = 0, sb = 0, sa = 0, cnt = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = Math.min(bw - 1, Math.max(0, xx + ox));
            const ny = Math.min(bh - 1, Math.max(0, yy + oy));
            const ni = (ny * bw + nx) * 4;
            sr += srcPatch[ni]; sg += srcPatch[ni + 1];
            sb += srcPatch[ni + 2]; sa += srcPatch[ni + 3]; cnt++;
          }
        }
        sr /= cnt; sg /= cnt; sb /= cnt; sa /= cnt;

        const pi = (yy * bw + xx) * 4;
        const or = srcPatch[pi], og = srcPatch[pi + 1], ob = srcPatch[pi + 2], oa = srcPatch[pi + 3];
        let nr, ng, nb, na;
        if (sharpen) {
          // 언샤프: 원본 + (원본 − 블러)
          nr = or + (or - sr);
          ng = og + (og - sg);
          nb = ob + (ob - sb);
          na = oa; // 알파는 보존
        } else {
          nr = sr; ng = sg; nb = sb; na = sa;
        }
        const di = (py * W + px) * 4;
        const ia = 1 - f;
        d[di]     = clamp255(or * ia + nr * f);
        d[di + 1] = clamp255(og * ia + ng * f);
        d[di + 2] = clamp255(ob * ia + nb * f);
        d[di + 3] = clamp255(oa * ia + na * f);
      }
    }
  }

  // 번짐: 직전 픽업(이전 위치의 패치)을 현재 위치에 강도만큼 섞고, 현재 위치를 새 픽업으로 저장.
  _applySmudge(d, W, x0, y0, x1, y1, cx, cy, r, strength, falloff) {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

    // 픽업 색을 현재 영역에 블렌딩.
    // 픽업 패치는 직전 스탬프의 절대 캔버스 좌표(px0,py0)를 기준으로 저장돼 있다.
    // 캔버스 경계에서 패치 크기(bw/bh)가 바뀌어도 두 패치의 겹치는 부분을 절대 좌표로 정렬해 섞으면
    // 번짐이 한 스텝 끊기지 않는다(과거: w/h 완전 일치할 때만 섞어 경계에서 끊김).
    if (this.pickup) {
      const pdata = this.pickup.data;
      const pw = this.pickup.w, ph = this.pickup.h;
      const px0 = this.pickup.x0, py0 = this.pickup.y0;
      for (let yy = 0; yy < bh; yy++) {
        const py = y0 + yy;
        const sy = py - py0;                 // 픽업 패치 내 행 인덱스(절대 좌표 정렬)
        if (sy < 0 || sy >= ph) continue;    // 픽업에 없는 행은 건너뜀
        for (let xx = 0; xx < bw; xx++) {
          const px = x0 + xx;
          const sx = px - px0;               // 픽업 패치 내 열 인덱스
          if (sx < 0 || sx >= pw) continue;  // 픽업에 없는 열은 건너뜀
          const f = falloff(px, py) * strength;
          if (f <= 0) continue;
          const di = (py * W + px) * 4;
          const pi = (sy * pw + sx) * 4;
          const ia = 1 - f;
          d[di]     = clamp255(d[di]     * ia + pdata[pi]     * f);
          d[di + 1] = clamp255(d[di + 1] * ia + pdata[pi + 1] * f);
          d[di + 2] = clamp255(d[di + 2] * ia + pdata[pi + 2] * f);
          d[di + 3] = clamp255(d[di + 3] * ia + pdata[pi + 3] * f);
        }
      }
    }

    // 현재 영역을 새 픽업으로 저장(다음 점으로 끌고 갈 색). 절대 좌표 기준점(x0,y0)도 함께 보존.
    const np = new Float32Array(bw * bh * 4);
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const si = ((y0 + yy) * W + (x0 + xx)) * 4;
        const pi = (yy * bw + xx) * 4;
        np[pi] = d[si]; np[pi + 1] = d[si + 1];
        np[pi + 2] = d[si + 2]; np[pi + 3] = d[si + 3];
      }
    }
    this.pickup = { w: bw, h: bh, x0, y0, data: np };
  }

  // work 버퍼를 화면에 반영
  _flush() {
    this.layer.ctx.putImageData(this.work, 0, 0);
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

// 0~255 클램프
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
