// patch-tool.js — 패치 도구(Patch).
//
// 사용법:
//   1) 먼저 선택 도구(올가미/사각형/매직완드 등)로 고칠 영역을 선택한다.
//   2) 패치 도구로 그 선택 영역 안을 잡아 "깨끗한 다른 영역"으로 드래그한다.
//   3) 놓으면, 드래그한 곳(소스)의 픽셀이 원래 선택 영역으로 옮겨오되,
//      복구 브러시처럼 소스의 질감은 유지하고 명도/색은 원래 영역 주변에 맞춰 녹여 넣는다.
//
// 즉 "선택 영역 ← 드래그한 위치의 텍스처(톤 매칭)"로 치환한다. 큰 잡티/물체 제거에 유용.
//
// 구현:
//   - 선택 마스크(Uint8Array, 0~255 부분선택)를 그대로 블렌딩 알파로 쓴다(경계 페더 자동).
//   - 드래그 벡터(ddx,ddy)만큼 떨어진 픽셀이 소스. 소스가 캔버스 밖이면 그 픽셀은 건너뜀.
//   - 톤 매칭: 선택 영역 전체의 (대상 원본 평균 − 소스 평균)을 채널별로 구해 소스에 더한다
//     (healing-brush-tool과 동일 사상). 소스 디테일은 보존되고 평균 톤만 주변에 맞는다.

import { BaseTool } from "./base-tool.js";
import { boundsToBox, clampBox } from "../engine/imagedata.js";

export class PatchTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this.drawing = false;
    this.start = null;   // 드래그 시작점(월드)
    this.cur = null;     // 현재점(월드)
  }

  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    const sel = this.selection;
    if (!sel?.active) { this.app.status("먼저 패치할 영역을 선택하세요."); return; }
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 패치할 수 없습니다."); return; }

    // 드래그는 선택 영역 안에서 시작해야 한다(포토샵 동작). 밖이면 무시.
    const ix = Math.floor(pt.x), iy = Math.floor(pt.y);
    if (!sel.isSelected(ix, iy)) {
      this.app.status("선택 영역 안을 잡고 드래그하세요.");
      return;
    }

    this.layer = layer;
    this.drawing = true;
    this.start = { x: pt.x, y: pt.y };
    this.cur = { x: pt.x, y: pt.y };
    this.app.renderer.requestRender();
  }

  onPointerMove(pt, e) {
    if (!this.drawing) return;
    this.cur = { x: pt.x, y: pt.y };
    this.app.renderer.requestRender(); // 이동 미리보기 오버레이
  }

  onPointerUp(pt, e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.cur = { x: pt.x, y: pt.y };

    const ddx = Math.round(this.cur.x - this.start.x);
    const ddy = Math.round(this.cur.y - this.start.y);
    if (ddx === 0 && ddy === 0) { this.start = this.cur = null; this.app.renderer.requestRender(); return; }

    this._applyPatch(ddx, ddy);
    this.start = this.cur = null;
    this.app.renderer.requestRender();
  }

  onLeave() { /* 드래그 중엔 캡처되므로 별도 처리 불필요 */ }

  // 선택 영역을 (ddx,ddy)만큼 떨어진 소스 픽셀로 톤 매칭 치환
  _applyPatch(ddx, ddy) {
    const layer = this.layer;
    const sel = this.selection;
    const W = layer.width, H = layer.height;
    const mask = sel.mask;
    if (!mask) return;

    // 처리 범위 = 선택 bounds (없으면 전체)
    const sb = sel.bounds || { x: 0, y: 0, w: W, h: H };
    const cb = clampBox(sb, W, H);
    if (!cb) return;

    const snap = layer.ctx.getImageData(0, 0, W, H); // 소스/대상 동일 레이어 → 고정 스냅샷
    const src = snap.data;

    // 1) 톤 보정량 = (선택 영역 대상 평균) − (대응 소스 평균). 채널별.
    // ★중요: 톤 매칭 기준은 "선택 영역 바깥 테두리"(정상 배경)에서 잡는다.
    //   선택 영역 내부(고치려는 잡티 포함)를 기준으로 삼으면 잡티 톤이 소스에 입혀져
    //   거꾸로 어두워진다(healing-brush-tool과 동일 원리).
    //   테두리 = 마스크==0 이지만 4-이웃 중 마스크>0 인 칸. 그 칸의 대상색 vs 대응 소스색.
    const mAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= W || gy >= H) ? 0 : mask[gy * W + gx];
    let tR = 0, tG = 0, tB = 0, sR = 0, sG = 0, sB = 0, cnt = 0;
    // 선택 bounds를 1px 넓혀 바깥 테두리를 포함해 탐색
    const bx0 = Math.max(0, cb.x - 1), by0 = Math.max(0, cb.y - 1);
    const bx1 = Math.min(W - 1, cb.x + cb.w), by1 = Math.min(H - 1, cb.y + cb.h);
    for (let ty = by0; ty <= by1; ty++) {
      const sy = ty + ddy;
      for (let tx = bx0; tx <= bx1; tx++) {
        if (mAt(tx, ty) > 0) continue; // 내부 제외
        if (mAt(tx - 1, ty) === 0 && mAt(tx + 1, ty) === 0 &&
            mAt(tx, ty - 1) === 0 && mAt(tx, ty + 1) === 0) continue; // 테두리만
        const sx = tx + ddx;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const di = (ty * W + tx) * 4;
        const si = (sy * W + sx) * 4;
        tR += src[di];     tG += src[di + 1];     tB += src[di + 2];
        sR += src[si];     sG += src[si + 1];     sB += src[si + 2];
        cnt++;
      }
    }
    // 테두리 샘플이 없으면 보정 0(단순 복제처럼). 소스가 완전히 밖인지는 합성 루프에서 처리.
    const adjR = cnt ? (tR - sR) / cnt : 0;
    const adjG = cnt ? (tG - sG) / cnt : 0;
    const adjB = cnt ? (tB - sB) / cnt : 0;

    // 2) undo 스냅샷 시작 → 선택 마스크 알파로 보정된 소스를 합성
    this.history.beginPixelEdit(layer);
    const out = layer.ctx.getImageData(0, 0, W, H);
    const od = out.data;

    for (let yy = 0; yy < cb.h; yy++) {
      const ty = cb.y + yy;
      const sy = ty + ddy;
      for (let xx = 0; xx < cb.w; xx++) {
        const tx = cb.x + xx;
        const mv = mask[ty * W + tx];
        if (mv <= 0) continue;
        const sx = tx + ddx;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const si = (sy * W + sx) * 4;
        const di = (ty * W + tx) * 4;
        const sa = src[si + 3] / 255;
        const k = (mv / 255) * sa; // 부분선택 알파 × 소스 알파
        if (k <= 0) continue;
        const ia = 1 - k;
        od[di]     = clamp255(src[si]     + adjR) * k + od[di]     * ia;
        od[di + 1] = clamp255(src[si + 1] + adjG) * k + od[di + 1] * ia;
        od[di + 2] = clamp255(src[si + 2] + adjB) * k + od[di + 2] * ia;
        od[di + 3] = 255                          * k + od[di + 3] * ia;
      }
    }

    layer.ctx.putImageData(out, 0, 0);
    layer.thumbDirty = true;
    this.history.commitPixelEdit(boundsToBox({
      minX: cb.x, minY: cb.y, maxX: cb.x + cb.w, maxY: cb.y + cb.h,
    }), "패치");
  }

  // 드래그 중: 원래 선택 윤곽(고정)은 selection이 그리므로, 여기선 "이동된 위치"의
  // 윤곽을 점선으로 미리 보여준다(어디서 가져올지 가늠).
  drawOverlay(ctx, vp) {
    if (!this.drawing || !this.start || !this.cur) return;
    const sel = this.selection;
    if (!sel?.outline) return;
    const ddx = this.cur.x - this.start.x;
    const ddy = this.cur.y - this.start.y;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(0,128,255,0.9)";
    for (const ring of sel.outline) {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const p = vp.worldToScreen(ring[i].x + ddx, ring[i].y + ddy);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // 시작→현재 화살표(이동 방향)
    const a = vp.worldToScreen(this.start.x, this.start.y);
    const b = vp.worldToScreen(this.cur.x, this.cur.y);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0,128,255,0.6)";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }
}

// 0~255 클램프
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
