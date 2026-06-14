// shape-layer-tool.js — 셰이프 레이어 도구. 드래그로 재편집 가능한 벡터 셰이프 레이어를 만든다.
//
// 동작:
//   - 빈 곳 드래그 : state.shapeType(rect/ellipse/rounded/polygon)에 맞는 셰이프 레이어 생성.
//                    rect/ellipse/rounded = 시작→끝 bbox, polygon = 중심(시작)→반지름(드래그).
//   - 기존 셰이프 레이어 클릭 : 그 레이어 선택(이후 셰이프 패널/Character 와 별개로 이동·재편집).
//   - Shift : 정사각/정원, 다각형 15° 스냅(shape-tool.js 와 동일 느낌).
//
// 색/획은 state(foreground, shapeFill, shapeStroke, shapeStrokeWidth, polygonSides, cornerRadius)에서 읽는다.
// 셰이프 도구(래스터, 기존 shape-tool.js)와 별개의 "셰이프 레이어" 전용 도구다.

import { BaseTool } from "../tools/base-tool.js";
import { SHAPE } from "../core/constants.js";
import {
  defaultShapeData, renderShapeLayer, isShapeLayer, hitShape,
} from "./shape-layer.js";
import { beginVectorEdit, commitVectorEdit } from "../text/vector-layer-command.js";

export class ShapeLayerTool extends BaseTool {
  get cursor() { return "crosshair"; }

  onPointerDown(pt, e) {
    // 기존 셰이프 레이어를 클릭하면 선택만(맨 위 우선)
    const hit = this._hitTopShapeLayer(pt);
    if (hit && !e.shiftKey) {
      this.app.layers.setActive(hit.id);
      this.app.status("셰이프 레이어 선택됨 (셰이프 패널에서 재편집)");
      this._drawing = false;
      return;
    }
    this._drawing = true;
    this.start = pt; this.end = pt; this.shift = e.shiftKey;
    this._layer = null; // 드래그가 의미있는 크기가 되면 생성
  }

  onPointerMove(pt, e) {
    if (!this._drawing) return;
    this.end = pt; this.shift = e.shiftKey;
    // 일정 크기 이상이면 레이어 생성 + 라이브 미리보기 렌더
    if (!this._layer) {
      const d = Math.hypot(pt.x - this.start.x, pt.y - this.start.y);
      if (d < 2) { this.app.renderer.requestRender(); return; }
      this._createLayer();
    }
    this._updateGeometry();
    renderShapeLayer(this._layer);
    this.app.layers.notifyContent(this._layer.id);
  }

  onPointerUp(pt, e) {
    if (!this._drawing) return;
    this._drawing = false;
    this.end = pt;
    if (!this._layer) { this.app.renderer.requestRender(); return; }
    this._updateGeometry();
    renderShapeLayer(this._layer);
    // 레이어는 이미 addLayer 로 히스토리 1단계가 잡혀 있다. 셰이프 데이터+픽셀은 그 위에 그려진 상태.
    // (생성+그리기를 한 동작으로 보고 별도 픽셀 커맨드는 생략 — undo 한 번에 레이어째 사라지는 게 자연스러움)
    this.app.layers.notifyContent(this._layer.id);
    this.app.status("셰이프 레이어를 만들었습니다.");
    this._layer = null;
  }

  drawOverlay(ctx, vp) {
    // 레이어 생성 전(작은 드래그) 단계의 점선 미리보기만 담당. 생성 후엔 실제 렌더가 보인다.
    if (!this._drawing || this._layer) return;
    const r = this._rect();
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    const a = vp.worldToScreen(r.x, r.y);
    ctx.strokeRect(a.x, a.y, r.w * vp.zoom, r.h * vp.zoom);
    ctx.restore();
  }

  _createLayer() {
    const s = this.state;
    let kind = s.shapeType;
    if (kind === SHAPE.LINE) kind = SHAPE.RECT; // 셰이프 레이어는 채움 도형 중심 → line 은 rect 로 대체
    const data = defaultShapeData(kind, {
      fill: s.shapeFill !== false,
      stroke: !!s.shapeStroke,
      fillColor: s.foreground,
      strokeColor: s.foreground,
      strokeWidth: s.shapeStrokeWidth || 3,
      cornerRadius: s.cornerRadius || 10,
    });
    const layer = this.app.layers.addLayer({ name: this._nameFor(kind) });
    layer.vectorShape = data;
    this._layer = layer;
  }

  _nameFor(kind) {
    return { rect: "사각형", ellipse: "타원", rounded: "둥근 사각형", polygon: "다각형", path: "패스 셰이프" }[kind] || "셰이프";
  }

  // 드래그 현재 상태를 vectorShape 기하 데이터로 반영
  _updateGeometry() {
    const d = this._layer.vectorShape;
    if (d.kind === "polygon") {
      d.polygon = {
        cx: this.start.x, cy: this.start.y,
        radius: this._radius(),
        sides: Math.max(3, this.state.polygonSides | 0),
        angle: this._polyAngle(),
      };
    } else {
      d.rect = this._rect();
    }
  }

  // ── 기하 계산(shape-tool.js 규칙 차용) ──
  _rect() {
    let { x: x0, y: y0 } = this.start;
    let { x: x1, y: y1 } = this.end;
    if (this.shift && this.state.shapeType !== SHAPE.POLYGON) {
      const w = x1 - x0, h = y1 - y0;
      const s = Math.max(Math.abs(w), Math.abs(h));
      x1 = x0 + (w < 0 ? -s : s);
      y1 = y0 + (h < 0 ? -s : s);
    }
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }
  _radius() { return Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y); }
  _polyAngle() {
    let ang = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
    if (this.shift) { const step = Math.PI / 12; ang = Math.round(ang / step) * step; }
    return ang;
  }

  _hitTopShapeLayer(pt) {
    const layers = this.app.layers.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.visible && isShapeLayer(L) && hitShape(L, pt.x, pt.y)) return L;
    }
    return null;
  }

  // 외부(셰이프 패널)에서 활성 셰이프 레이어의 데이터를 바꾸고 재렌더+히스토리 등록.
  applyDataChangeToActiveLayer(mutator, label = "셰이프 속성") {
    const layer = this.app.layers.activeLayer;
    if (!isShapeLayer(layer)) return false;
    const tx = beginVectorEdit(this.app, layer, "vectorShape");
    mutator(layer.vectorShape);
    renderShapeLayer(layer);
    commitVectorEdit(tx, label);
    this.app.layers.notifyContent(layer.id);
    return true;
  }
}
