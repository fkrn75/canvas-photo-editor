// pattern-stamp-tool.js — 패턴 도장(Pattern Stamp).
//
// 사용법:
//   옵션바에서 패턴을 고른 뒤 캔버스를 드래그하면, 선택한 패턴 타일을 무한 반복(타일링)해
//   브러시로 칠한 영역에 찍는다. 소스점 지정(Alt+클릭)은 필요 없다.
//
// CloneStampTool을 상속해 마스크/스탬프/합성 골격을 재사용한다.
//   다른 점은 "소스"가 다른 좌표의 픽셀이 아니라, 문서 좌표를 타일 크기로 wrap 한
//   패턴 타일 픽셀이라는 것. _composite만 패턴 샘플링으로 교체한다.
//
// 정렬(aligned):
//   - true: 패턴 원점을 문서 (0,0)에 고정 → 여러 번 끊어 칠해도 무늬가 이어진다(기본).
//   - false: stroke 시작점을 패턴 원점으로 삼는다 → 칠하는 위치마다 패턴이 새로 시작.

import { CloneStampTool } from "./clone-stamp-tool.js";
import { boundsToBox, clampBox } from "../engine/imagedata.js";

export class PatternStampTool extends CloneStampTool {
  get cursor() { return "none"; }

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      hardness: s.brushHardness,
      opacity: s.patternOpacity ?? 1,
      aligned: s.patternAligned !== false,
    };
  }

  // 현재 선택된 패턴 타일의 ImageData를 반환(없으면 null). 결과는 stroke 동안 캐시한다.
  _patternData() {
    const list = this.app.state.patterns || [];
    if (list.length === 0) return null;
    let idx = this.app.state.patternIndex ?? 0;
    if (idx < 0 || idx >= list.length) idx = 0;
    const pat = list[idx];
    if (!pat || !pat.tile) return null;
    const tile = pat.tile;
    const tctx = tile.getContext("2d", { willReadFrequently: true });
    return { data: tctx.getImageData(0, 0, tile.width, tile.height), w: tile.width, h: tile.height };
  }

  onPointerDown(pt, e) {
    // 패턴 도장은 소스점(Alt) 개념이 없으므로 즉시 그리기 시작
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 칠할 수 없습니다."); return; }

    const pat = this._patternData();
    if (!pat) { this.app.status("패턴 도장: 사용할 패턴이 없습니다."); return; }
    this.pattern = pat;

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = this._newBounds();

    // undo 스냅샷 + 누적 작업 버퍼
    this.history.beginPixelEdit(layer);
    this.before = this.history._peBefore;
    this.work = layer.ctx.getImageData(0, 0, layer.width, layer.height);

    // 패턴 원점(이 좌표가 타일 (0,0)에 대응)
    if (this.p.aligned) {
      this.origin = { x: 0, y: 0 };           // 문서 원점 고정
    } else {
      this.origin = { x: pt.x, y: pt.y };      // stroke 시작점 기준
    }

    this._initMask(layer);
    this.last = pt;
    this._stamp(pt, pt);
    this._composite();
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._composite();
    const box = boundsToBox(this.bounds);
    this.history.commitPixelEdit(box, "패턴 도장");

    this.mask = null; this.mctx = null; this.before = null;
    this.work = null; this.pattern = null; this.layer = null;
  }

  // CloneStamp는 imagedata 헬퍼를 모듈 스코프로만 가지므로 newBounds를 안전하게 재확보
  _newBounds() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  // 마스크 강도 → 패턴 타일 픽셀을 wrap 샘플링해 대상에 합성(변경 영역만)
  _composite() {
    const box = boundsToBox(this.bounds);
    const cb = box && clampBox(box, this.layer.width, this.layer.height);
    if (!cb) { this.app.renderer.requestRender(); return; }

    const W = this.layer.width;
    const m = this.mctx.getImageData(cb.x, cb.y, cb.w, cb.h).data;
    const out = this.work;
    const od = out.data;
    const pd = this.pattern.data.data;   // 패턴 타일 픽셀
    const pw = this.pattern.w, ph = this.pattern.h;
    const op = this.p.opacity;
    const ox = Math.round(this.origin.x);
    const oy = Math.round(this.origin.y);

    for (let yy = 0; yy < cb.h; yy++) {
      const ty = cb.y + yy;
      // 패턴 y (양수 modulo로 음수 좌표도 안전하게 wrap)
      const py = (((ty - oy) % ph) + ph) % ph;
      for (let xx = 0; xx < cb.w; xx++) {
        const mi = (yy * cb.w + xx) * 4;
        const a = (m[mi] / 255) * op; // 잉크 강도
        if (a <= 0) continue;
        const tx = cb.x + xx;
        const px = (((tx - ox) % pw) + pw) % pw;
        const si = (py * pw + px) * 4;
        const di = (ty * W + tx) * 4;
        const sa = pd[si + 3] / 255;  // 패턴 알파 반영
        const k = a * sa;
        if (k <= 0) continue;
        const ia = 1 - k;
        od[di]     = pd[si]     * k + od[di]     * ia;
        od[di + 1] = pd[si + 1] * k + od[di + 1] * ia;
        od[di + 2] = pd[si + 2] * k + od[di + 2] * ia;
        od[di + 3] = 255        * k + od[di + 3] * ia;
      }
    }

    this.layer.ctx.putImageData(out, 0, 0);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  // 브러시 원형 커서만(소스 표식 없음)
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
