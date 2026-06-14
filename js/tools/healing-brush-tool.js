// healing-brush-tool.js — 복구 브러시(Healing Brush).
//
// 복제 도장과 비슷하게 Alt+클릭으로 소스점을 잡고 드래그해 소스 픽셀을 가져오지만,
// 단순 복사가 아니라 "소스의 질감(고주파)은 유지하되, 전체 명도/색은 칠하는 대상 주변에
// 맞춰" 자연스럽게 녹여 넣는다. 잡티 제거에 쓰는 포토샵 복구 브러시의 간단 버전이다.
//
// 알고리즘(간단·견고 버전):
//   1) clone-stamp처럼 (현재−소스) 오프셋만큼 떨어진 소스 픽셀을 가져온다.
//   2) 칠해진 영역(마스크>0) 전체에 대해 "대상(주변 원본) 평균색 − 소스 평균색"을 구한다.
//      → 이 차이(보정량)를 소스 픽셀마다 더하면, 소스의 디테일은 그대로지만 평균 톤이
//        대상 주변과 같아진다(명도/색 매칭).
//   3) 마스크 강도(경도 기반 페더)를 알파로 써서 보정된 소스를 원본 위에 블렌딩한다.
//      → 가장자리가 주변과 부드럽게 이어진다.
//
// 합성 사상: clone과 달리 stroke가 커질수록 평균 보정량이 갱신되어야 하므로,
//   매 _composite마다 work를 before(원본)에서 다시 계산한다(누적이 아니라 재계산).
//   힐링은 보통 짧게 칠하므로 영역 한정 재계산으로 충분히 가볍다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";

export class HealingBrushTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this.source = null;   // 소스점(월드좌표) {x,y}. Alt+클릭으로 설정
    this.offset = null;   // 정렬 모드에서 유지하는 (현재−소스) 오프셋 {dx,dy}
    this._hover = null;
  }

  get cursor() { return "none"; } // 브러시 원형 커서를 직접 그린다

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: s.brushHardness,
      opacity: s.healOpacity ?? 1,
      aligned: s.healAligned !== false,
    };
  }

  onPointerDown(pt, e) {
    // Alt+클릭 = 소스점 지정 (그리기 시작 안 함)
    if (e.altKey) {
      this.source = { x: pt.x, y: pt.y };
      this.offset = null; // 새 소스를 잡으면 정렬 오프셋도 초기화
      this.app.status("복구 소스 지정됨. 드래그하여 복구하세요.");
      this.app.renderer.requestRender();
      return;
    }

    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 복구할 수 없습니다."); return; }
    if (!this.source) { this.app.status("Alt+클릭으로 먼저 복구 소스를 지정하세요."); return; }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();

    // 소스/대상이 같은 레이어이므로 칠하는 동안 변하지 않도록 원본 스냅샷을 고정한다.
    this.srcSnap = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore; // 매 프레임 재계산의 기준이 되는 원본

    // 이번 stroke의 소스→대상 오프셋 결정 (clone과 동일)
    if (this.p.aligned && this.offset) {
      // 정렬: 이전 stroke 오프셋 유지
    } else {
      this.offset = { dx: pt.x - this.source.x, dy: pt.y - this.source.y };
    }

    // 강도 마스크(검정 바탕, 흰 스탬프 lighten 누적)
    this._initMask(layer);

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
      this.app.renderer.requestRender(); // 커서/소스 오버레이 갱신
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    this.history.commitPixelEdit(box, "복구 브러시");

    this.mask = null; this.mctx = null; this.before = null;
    this.srcSnap = null; this.layer = null;
    // offset은 정렬 모드에서 다음 stroke로 이어지므로 유지
  }

  onLeave() { this._hover = null; this.app.renderer.requestRender(); }

  // 강도 마스크 초기화(clone-stamp와 동일 사상)
  _initMask(layer) {
    this.mask = document.createElement("canvas");
    this.mask.width = layer.width;
    this.mask.height = layer.height;
    this.mctx = this.mask.getContext("2d", { willReadFrequently: true });
    this.mctx.fillStyle = "#000";
    this.mctx.fillRect(0, 0, layer.width, layer.height);
    if (this.selection?.active) this.selection.applyClipPath(this.mctx);
    this.mctx.globalCompositeOperation = "lighten";
  }

  // a→b 구간을 거리 기반 보간으로 스탬프
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

  // 흰색(강도) 스탬프. 경도에 따른 부드러운 가장자리.
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

  // 마스크 강도 → 색 보정된 소스를 원본 위에 합성(변경 영역만, before에서 매번 재계산)
  _composite() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const W = this.layer.width, H = this.layer.height;
    // 마스크는 가장자리 링 판정을 위해 한 겹 바깥까지(여유 1px) 읽는다.
    const ex = Math.max(0, cb.x - 1), ey = Math.max(0, cb.y - 1);
    const ew = Math.min(W, cb.x + cb.w + 1) - ex;
    const eh = Math.min(H, cb.y + cb.h + 1) - ey;
    const m = this.mctx.getImageData(ex, ey, ew, eh).data;
    const maskAt = (gx, gy) => { // 전역좌표 → 확장 마스크 알파(밖이면 0)
      if (gx < ex || gy < ey || gx >= ex + ew || gy >= ey + eh) return 0;
      return m[((gy - ey) * ew + (gx - ex)) * 4];
    };
    const src = this.srcSnap.data;   // 소스 원본(고정)
    const base = this.before.data;   // 대상 원본(보정 기준이자 합성 바탕)
    const op = this.p.opacity;
    const dx = Math.round(this.offset.dx);
    const dy = Math.round(this.offset.dy);

    // 1) 보정량 = "브러시 경계 바깥 테두리"에서 (대상 − 소스) 평균. RGB 채널별.
    //    ★중요: 칠하는 영역 내부(고치려는 잡티)를 기준으로 삼으면 잡티 톤이 소스에 입혀져
    //      거꾸로 망가진다. 그래서 영역 바로 바깥(정상 배경) 테두리만 톤 매칭 기준으로 쓴다.
    //    테두리 픽셀 = 마스크==0 이지만 4-이웃 중 마스크>0 인 칸. (브러시가 닿은 곳의 외곽선)
    let tR = 0, tG = 0, tB = 0, sR = 0, sG = 0, sB = 0, cnt = 0;
    for (let gy = ey; gy < ey + eh; gy++) {
      const sy = gy - dy;
      for (let gx = ex; gx < ex + ew; gx++) {
        if (maskAt(gx, gy) > 0) continue; // 내부/칠한 영역은 제외
        // 4-이웃에 칠한 픽셀이 있으면 "바로 바깥 테두리"
        if (maskAt(gx - 1, gy) === 0 && maskAt(gx + 1, gy) === 0 &&
            maskAt(gx, gy - 1) === 0 && maskAt(gx, gy + 1) === 0) continue;
        const sx = gx - dx;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const di = (gy * W + gx) * 4;
        const si = (sy * W + sx) * 4;
        tR += base[di];     tG += base[di + 1];     tB += base[di + 2];
        sR += src[si];      sG += src[si + 1];      sB += src[si + 2];
        cnt++;
      }
    }
    // 테두리 샘플이 전혀 없으면(영역이 캔버스 끝에 붙는 등) 보정 0으로 둔다(단순 복제처럼).
    const adjR = cnt ? (tR - sR) / cnt : 0;
    const adjG = cnt ? (tG - sG) / cnt : 0;
    const adjB = cnt ? (tB - sB) / cnt : 0;

    // 2) work = before 사본에서 시작 → 보정된 소스를 마스크 알파로 블렌딩
    //    (매 프레임 재계산이므로 직전 결과를 누적하지 않고, 원본 사본 위에 새로 칠한다)
    const out = new ImageData(new Uint8ClampedArray(base), W, H);
    const od = out.data;

    for (let ty = cb.y; ty < cb.y + cb.h; ty++) {
      const sy = ty - dy;
      for (let tx = cb.x; tx < cb.x + cb.w; tx++) {
        const a = (maskAt(tx, ty) / 255) * op;
        if (a <= 0) continue;
        const sx = tx - dx;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const si = (sy * W + sx) * 4;
        const di = (ty * W + tx) * 4;
        const sa = src[si + 3] / 255;
        const k = a * sa;
        if (k <= 0) continue;
        const ia = 1 - k;
        // 보정된 소스 색(질감 유지 + 평균 톤 매칭)
        const cr = src[si]     + adjR;
        const cg = src[si + 1] + adjG;
        const cb2 = src[si + 2] + adjB;
        od[di]     = clamp255(cr)  * k + od[di]     * ia;
        od[di + 1] = clamp255(cg)  * k + od[di + 1] * ia;
        od[di + 2] = clamp255(cb2) * k + od[di + 2] * ia;
        od[di + 3] = 255           * k + od[di + 3] * ia;
      }
    }

    this.layer.ctx.putImageData(out, 0, 0);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 브러시 원형 커서 + 소스점/소스 미리보기 표시 (clone-stamp와 동일)
  drawOverlay(ctx, vp) {
    if (this.source) {
      const sc = vp.worldToScreen(this.source.x, this.source.y);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,180,90,0.9)";
      ctx.beginPath();
      ctx.moveTo(sc.x - 6, sc.y); ctx.lineTo(sc.x + 6, sc.y);
      ctx.moveTo(sc.x, sc.y - 6); ctx.lineTo(sc.x, sc.y + 6);
      ctx.stroke();
      ctx.restore();
    }
    if (!this._hover) return;
    const c = vp.worldToScreen(this._hover.x, this._hover.y);
    const r = Math.max(0.5, this.state.brushSize / 2) * vp.zoom;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();

    // 현재 소스 위치(브러시 아래에서 떠올 지점) 표식
    const off = this.offset || (this.source ? { dx: this._hover.x - this.source.x, dy: this._hover.y - this.source.y } : null);
    if (this.source && off) {
      const sw = vp.worldToScreen(this._hover.x - off.dx, this._hover.y - off.dy);
      ctx.beginPath(); ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,180,90,0.5)";
      ctx.setLineDash([4, 3]);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// 0~255 클램프
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
