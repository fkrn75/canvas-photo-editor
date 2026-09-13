// clone-stamp-tool.js — 복제 도장(Clone Stamp).
//
// 사용법:
//   1) Alt+클릭 → 소스점(샘플 원점) 지정
//   2) 이후 드래그 → (현재점 − 소스점) 오프셋만큼 떨어진 소스 픽셀을 현재 레이어에 복사
//
// 정렬(aligned) 옵션:
//   - true(정렬): 첫 스탬프에서 잡은 (현재−소스) 오프셋을 stroke가 끝나도 유지한다.
//     여러 번 끊어 칠해도 소스가 이어진다(포토샵 기본 동작).
//   - false(비정렬): 매 stroke마다 소스점에서 다시 시작한다(같은 패턴을 반복 복제).
//
// 합성 방식: paint-tool과 동일한 "강도 마스크" 사상을 쓴다.
//   stroke 동안 누적 마스크(검정 바탕에 흰 스탬프를 lighten)로 부드러운 가장자리/불투명도를 만들고,
//   _composite에서 그 강도를 알파로 환산해 "소스에서 떠온 픽셀"을 현재 레이어에 얹는다.
//   단, 리터칭 특성상 결과를 누적해야 하므로 매 프레임 before로 되돌리지 않고
//   직전까지 합성된 결과(this.work) 위에 이어서 칠한다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox, clampBox } from "../engine/imagedata.js";

export class CloneStampTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this.source = null;   // 지정된 소스점(월드좌표) {x,y}. Alt+클릭으로 설정
    this.offset = null;   // 정렬 모드에서 유지하는 (현재−소스) 오프셋 {dx,dy}
    this._hover = null;
  }

  get cursor() { return "none"; } // 브러시 원형 커서를 직접 그린다

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: s.brushHardness,
      opacity: s.cloneOpacity ?? 1,
      aligned: s.cloneAligned !== false,
    };
  }

  onPointerDown(pt, e) {
    // Alt+클릭 = 소스점 지정 (그리기 시작 안 함)
    if (e.altKey) {
      this.source = { x: pt.x, y: pt.y };
      this.offset = null; // 새 소스를 잡으면 정렬 오프셋도 초기화
      this.app.status("복제 소스 지정됨. 드래그하여 복제하세요.");
      this.app.renderer.requestOverlayRender(); // 소스점 십자 표식만 갱신(레이어 픽셀 무관)
      return;
    }

    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 복제할 수 없습니다."); return; }
    if (!this.source) { this.app.status("Alt+클릭으로 먼저 복제 소스를 지정하세요."); return; }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();

    // 소스를 떠올 원본 스냅샷(소스/대상이 같은 레이어이므로, 칠하는 동안 소스가 변하지 않도록 고정)
    this.srcSnap = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    // undo 스냅샷 + 누적 작업 버퍼(직전까지의 합성 결과)
    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;
    this.work = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    // 이번 stroke의 소스→대상 오프셋 결정
    if (this.p.aligned && this.offset) {
      // 정렬: 이전 stroke에서 잡은 오프셋 유지
    } else {
      // 비정렬 또는 최초: 클릭점과 소스점 차이로 오프셋 확정
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
      this.app.renderer.requestOverlayRender(); // 커서/소스 오버레이 갱신(레이어 픽셀 무관)
    }
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    this.history.commitPixelEdit(box, "복제 도장");

    this.mask = null; this.mctx = null; this.before = null;
    this.work = null; this.srcSnap = null; this.layer = null;
    // offset은 정렬 모드에서 다음 stroke로 이어지므로 유지(비정렬이면 다음 down에서 갱신)
  }

  onLeave() { this._hover = null; this.app.renderer.requestOverlayRender(); }

  // 강도 마스크 초기화(paint-tool과 동일 사상)
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

  // 마스크 강도 → 소스 픽셀을 대상에 합성(변경 영역만)
  _composite() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const W = this.layer.width, H = this.layer.height;
    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    const out = this.work;          // 누적 작업 버퍼(직전 결과)
    const od = out.data;
    const src = this.srcSnap.data;  // 소스 원본(고정)
    const op = this.p.opacity;
    const dx = Math.round(this.offset.dx);
    const dy = Math.round(this.offset.dy);

    for (let yy = 0; yy < cb.h; yy++) {
      const ty = cb.y + yy;         // 대상 y
      const sy = ty - dy;           // 소스 y (대상 − 오프셋)
      for (let xx = 0; xx < cb.w; xx++) {
        const mi = (yy * cb.w + xx) * 4;
        const a = (m[mi] / 255) * op; // 잉크 강도
        if (a <= 0) continue;
        const tx = cb.x + xx;       // 대상 x
        const sx = tx - dx;         // 소스 x
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; // 소스가 캔버스 밖이면 건너뜀
        const si = (sy * W + sx) * 4;
        const di = (ty * W + tx) * 4;
        const sa = src[si + 3] / 255; // 소스 알파 반영(투명 소스는 약하게)
        const k = a * sa;
        if (k <= 0) continue;
        const ia = 1 - k;
        od[di]     = src[si]     * k + od[di]     * ia;
        od[di + 1] = src[si + 1] * k + od[di + 1] * ia;
        od[di + 2] = src[si + 2] * k + od[di + 2] * ia;
        od[di + 3] = 255         * k + od[di + 3] * ia;
      }
    }

    // 부분 반영: out은 레이어 전체 크기 버퍼지만 이번 호출에서 실제로 바뀐 곳은 cb 영역뿐이다
    // (cb 밖은 이 stroke에서 한 번도 손댄 적이 없어 out과 캔버스가 이미 같은 값).
    // 과거엔 여기서 캔버스 전체를 putImageData해 4000x4000 기준 이동 1회당 64MB를 복사했다.
    this.layer.ctx.putImageData(out, 0, 0, cb.x, cb.y, cb.w, cb.h);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 브러시 원형 커서 + 소스점/소스 미리보기 표시
  drawOverlay(ctx, vp) {
    // 소스점 표식(십자)
    if (this.source) {
      const sc = vp.worldToScreen(this.source.x, this.source.y);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,128,255,0.9)";
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

    // 현재 소스 위치(브러시 아래에서 떠올 지점) 표식 — 소스가 있고 오프셋이 정해졌을 때
    const off = this.offset || (this.source ? { dx: this._hover.x - this.source.x, dy: this._hover.y - this.source.y } : null);
    if (this.source && off) {
      const sw = vp.worldToScreen(this._hover.x - off.dx, this._hover.y - off.dy);
      ctx.beginPath(); ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,128,255,0.5)";
      ctx.setLineDash([4, 3]);
      ctx.stroke();
    }
    ctx.restore();
  }
}
