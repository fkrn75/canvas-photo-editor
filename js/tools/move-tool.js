// move-tool.js — 활성 레이어의 픽셀 전체를 드래그로 이동한다.
// 스냅(보기 > 스냅)이 켜져 있으면 레이어 내용 경계(불투명 픽셀 bbox)의 가장자리·중앙을
// 가이드/그리드/문서 경계에 화면 8px 이내로 붙인다. Alt를 누르고 끌면 스냅을 잠시 끈다.
// (가이드 자체를 끄는 동작은 render/guides.js가 캡처 단계에서 먼저 가로챈다)

import { BaseTool } from "./base-tool.js";
import { snapBox, snapThreshold, snapTargetsFromApp } from "../render/snap.js";

// ImageData의 불투명(알파>0) 픽셀 경계 {x,y,w,h}. 전부 투명이면 null.
export function opaqueBounds(img) {
  const { width: W, height: H, data: d } = img;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    let row = y * W * 4 + 3;
    for (let x = 0; x < W; x++, row += 4) {
      if (d[row] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export class MoveTool extends BaseTool {
  get cursor() { return "move"; }

  onPointerDown(pt, e) {
    const layer = this.ensureLayer();
    if (!layer) return;
    if (layer.lockPosition) { this.app.status("위치가 잠겨 있어 이동할 수 없습니다."); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 이동할 수 없습니다."); return; }
    this.layer = layer;
    this.moving = true;
    this.start = pt;
    this.snapshot = layer.snapshot();   // 이동 기준 원본
    // 스냅 기준 상자: 불투명 픽셀 경계(없으면 레이어 전체). 스냅이 꺼져 있으면 계산 생략.
    this.snapTargets = snapTargetsFromApp(this.app);
    this.box = this.snapTargets
      ? (opaqueBounds(this.snapshot) || { x: 0, y: 0, w: layer.width, h: layer.height })
      : null;
    this.delta = { dx: 0, dy: 0 };
    this.history.beginPixelEdit(layer);
  }

  // 포인터 위치 → 정수 이동량(스냅·Shift 축 고정 반영)
  _delta(pt, e) {
    let dx = pt.x - this.start.x;
    let dy = pt.y - this.start.y;
    if (this.snapTargets && this.box && !e.altKey) {
      const thr = snapThreshold(this.app.viewport.zoom);
      const moved = { x: this.box.x + dx, y: this.box.y + dy, w: this.box.w, h: this.box.h };
      const s = snapBox(moved, this.snapTargets, thr);
      dx += s.dx; dy += s.dy;
    }
    dx = Math.round(dx); dy = Math.round(dy);
    if (e.shiftKey) { // Shift: 수평/수직 고정
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    return { dx, dy };
  }

  onPointerMove(pt, e) {
    if (!this.moving) return;
    const { dx, dy } = this.delta = this._delta(pt, e);
    const ctx = this.layer.ctx;
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    ctx.putImageData(this.snapshot, dx, dy);
    this.layer.thumbDirty = true;
    this.app.renderer.requestRender();
  }

  onPointerUp(pt, e) {
    if (!this.moving) return;
    this.moving = false;
    // 벡터(텍스트/셰이프/마스크) 레이어면 소스 좌표도 같은 델타로 이동(재편집 일관성)
    const L = this.layer;
    const { dx, dy } = this._delta(pt, e);
    // 마지막 move 이후 위치가 달라졌으면(스냅 경계 등) 픽셀도 최종 델타로 맞춘다
    if (L && (dx !== this.delta.dx || dy !== this.delta.dy)) {
      L.ctx.clearRect(0, 0, L.width, L.height);
      L.ctx.putImageData(this.snapshot, dx, dy);
      L.thumbDirty = true;
    }
    this.snapshot = null;
    this.snapTargets = null;
    this.box = null;
    if (L && (dx || dy)) {
      if (L.vectorText) { L.vectorText.x += dx; L.vectorText.y += dy; }
      if (L.vectorShape) this._shiftShape(L.vectorShape, dx, dy);
    }
    this.history.commitPixelEdit(null, "이동"); // 레이어 전체 저장
    this.layer = null;
  }
  // 셰이프 기하 좌표 평행이동(벡터 레이어 전용)
  _shiftShape(d, dx, dy) {
    if (d.rect) { d.rect.x += dx; d.rect.y += dy; }
    if (d.polygon) { d.polygon.cx += dx; d.polygon.cy += dy; }
    if (d.path) for (const a of d.path.anchors) { a.x += dx; a.y += dy; a.inX += dx; a.inY += dy; a.outX += dx; a.outY += dy; }
  }
}
