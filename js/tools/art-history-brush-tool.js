// art-history-brush-tool.js — 아트 히스토리 브러시(Art History Brush).
//
// 히스토리 브러시(history-brush-tool.js)가 "스냅샷 픽셀을 같은 좌표로 그대로 복원"하는 반면,
// 아트 히스토리 브러시는 그 스냅샷 색을 "예술적 스트로크(짧은 곡선 다발)"로 칠해 인상주의/유화 느낌을 낸다.
//
// [동작]
//   1) 히스토리 팔레트에서 스냅샷을 만들고, 옵션바에서 소스 스냅샷을 고른다(state.historyBrushSource 재사용).
//   2) 캔버스를 문지르면 일정 간격마다 "아트 스트로크"를 뿌린다.
//      각 스트로크는 시작점의 스냅샷 색을 샘플링해 짧은 곡선(테이퍼 둥근 획)으로 그린다.
//      스타일(tight/loose/curl)과 길이(artHistoryLength)로 형태를 조절한다.
//
// [합성]
//   history-brush-tool과 달리 단색-마스크가 아니라 레이어 ctx에 직접 곡선을 그린다(획끼리 겹치며 임파스토 느낌).
//   undo는 beginPixelEdit/commitPixelEdit로 stroke 단위 1단계. 선택 영역이 있으면 클립한다.

import { BaseTool } from "./base-tool.js";
import { newBounds, expandBounds, boundsToBox } from "../engine/imagedata.js";

// 자체 시드 난수(결정성). paint 동역학과 동일한 mulberry32.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ArtHistoryBrushTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this._hover = null;
    this.rng = mulberry32(1);
  }

  get cursor() { return "none"; } // 원형 커서를 직접 그린다

  _params() {
    const s = this.state;
    return {
      size: Math.max(1, s.brushSize),
      opacity: s.brushOpacity ?? 1,
      style: s.artHistoryStyle || "tight",   // tight | loose | curl
      length: Math.max(2, s.artHistoryLength ?? 16), // 스트로크 길이(px)
    };
  }

  // 선택된 스냅샷({name,canvas,thumb}) 반환(없으면 null). history-brush-tool과 동일 규칙.
  _sourceSnap() {
    const snaps = this.app.historyPanel?.snapshots || [];
    if (snaps.length === 0) return null;
    let idx = this.state.historyBrushSource ?? 0;
    if (idx < 0 || idx >= snaps.length) idx = snaps.length - 1;
    return snaps[idx] || null;
  }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 칠할 수 없습니다."); return; }

    const snap = this._sourceSnap();
    if (!snap) {
      this.app.status("아트 히스토리 브러시: 먼저 히스토리 팔레트에서 스냅샷을 만드세요.");
      return;
    }
    if (snap.canvas.width !== layer.width || snap.canvas.height !== layer.height) {
      this.app.status("문서 크기가 달라 이 스냅샷을 소스로 쓸 수 없습니다.");
      return;
    }

    this.layer = layer;
    this.drawing = true;
    this.p = this._params();
    this.bounds = newBounds();
    this.rng = mulberry32((Date.now() & 0xffffffff) >>> 0); // stroke마다 난수 초기화

    // 스냅샷 픽셀(색 샘플 소스)을 한 번 떠 둔다.
    const sctx = snap.canvas.getContext("2d", { willReadFrequently: true });
    this.src = sctx.getImageData(0, 0, layer.width, layer.height);

    // undo 스냅샷
    this.history.beginPixelEdit(layer);

    // 레이어 ctx에 직접 그린다. 선택 영역이 있으면 클립.
    this.ctx = layer.ctx;
    this.ctx.save();
    if (this.selection?.active) this.selection.applyClipPath(this.ctx);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    this.last = pt;
    this._acc = 0; // 거리 누적(스트로크 간격 제어)
    this._spray(pt); // 시작점에 한 번
  }

  onPointerMove(pt, e) {
    this._hover = pt;
    if (!this.drawing) { this.app.renderer.requestRender(); return; }
    // 경로를 따라 간격(spacing)마다 아트 스트로크를 뿌린다.
    const spacing = Math.max(2, this.p.size * 0.4);
    let ax = this.last.x, ay = this.last.y;
    const dx = pt.x - ax, dy = pt.y - ay;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const ux = dx / dist, uy = dy / dist;
    this._acc += dist;
    while (this._acc >= spacing) {
      this._acc -= spacing;
      ax += ux * spacing; ay += uy * spacing;
      this._spray({ x: ax, y: ay }, ux, uy);
    }
    this.last = pt;
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.ctx.restore();
    const box = boundsToBox(this.bounds);
    this.history.commitPixelEdit(box, "아트 히스토리 브러시");
    this.src = null; this.ctx = null; this.layer = null;
  }

  onLeave() { this._hover = null; this.app.renderer.requestRender(); }

  // 드래그 도중 도구가 바뀌면 ctx.save()/클립과 drawing 상태가 누수되므로 정리한다.
  // (그리던 픽셀은 tool-manager가 cancelPixelEdit로 되돌린다)
  onDeactivate() {
    if (this.drawing) {
      this.drawing = false;
      if (this.ctx) { this.ctx.restore(); this.ctx = null; }
      this.src = null; this.layer = null;
    }
  }

  // (cx,cy)에서 스냅샷 색을 샘플링해 짧은 곡선 스트로크를 그린다.
  // dirX,dirY: 진행 방향(없으면 무작위). 스타일에 따라 곡률/길이를 바꾼다.
  _spray(pos, dirX, dirY) {
    const W = this.layer.width, H = this.layer.height;
    const cx = pos.x, cy = pos.y;
    const ix = Math.round(cx), iy = Math.round(cy);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;

    // 스냅샷 색 샘플(투명 픽셀이면 건너뜀)
    const si = (iy * W + ix) * 4;
    const sa = this.src.data[si + 3];
    if (sa <= 0) return;
    const r = this.src.data[si], g = this.src.data[si + 1], b = this.src.data[si + 2];

    // 진행 방향(없으면 무작위). 스타일별로 약간의 각도 흔들림.
    let ang;
    if (dirX != null) ang = Math.atan2(dirY, dirX);
    else ang = this.rng() * Math.PI * 2;

    const len = this.p.length;
    const halfW = Math.max(0.5, this.p.size / 2);
    const ctx = this.ctx;
    ctx.globalAlpha = (sa / 255) * this.p.opacity;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;

    // 스타일별 제어점으로 짧은 곡선(2차 베지어 다발) 생성
    const style = this.p.style;
    const segs = style === "curl" ? 3 : 1; // curl은 여러 휘어진 분절
    let px = cx - Math.cos(ang) * len * 0.5;
    let py = cy - Math.sin(ang) * len * 0.5;

    ctx.lineWidth = Math.max(0.5, halfW * (style === "tight" ? 1 : 0.8));
    ctx.beginPath();
    ctx.moveTo(px, py);

    for (let s = 0; s < segs; s++) {
      // 분절 진행 + 스타일 곡률
      let curl;
      if (style === "tight") curl = (this.rng() - 0.5) * 0.3;       // 거의 직선
      else if (style === "loose") curl = (this.rng() - 0.5) * 1.0;  // 완만한 곡선
      else curl = (this.rng() * 0.8 + 0.4) * (s % 2 ? -1 : 1);      // curl: 번갈아 휘어 말림

      const segLen = len / segs;
      const a1 = ang + curl;
      const mx = px + Math.cos(a1) * segLen * 0.5;
      const my = py + Math.sin(a1) * segLen * 0.5;
      const a2 = ang + curl * 1.6;
      const ex = px + Math.cos(a2) * segLen;
      const ey = py + Math.sin(a2) * segLen;
      // 제어점(mx,my)으로 휘는 2차 베지어
      const ctrlX = mx + Math.cos(a1 + Math.PI / 2) * segLen * curl * 0.5;
      const ctrlY = my + Math.sin(a1 + Math.PI / 2) * segLen * curl * 0.5;
      ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
      px = ex; py = ey;
      ang = a2;
    }
    ctx.stroke();

    // 경계 누적(스트로크가 차지하는 대략 범위)
    expandBounds(this.bounds, cx, cy, len + halfW + 2);
  }

  // 원형 커서 + 스타일 표시
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
