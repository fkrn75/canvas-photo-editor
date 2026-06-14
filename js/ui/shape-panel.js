// shape-panel.js — 셰이프(셰이프 레이어 + 벡터 마스크) 속성 팔레트.
// 활성 레이어가 셰이프 레이어면 채움/획 색·두께·모서리 반경을 재편집할 수 있게 한다.
// 또한 현재 펜 패스(app.paths)를 "셰이프 레이어로" 또는 활성 레이어의 "벡터 마스크로" 변환하는 버튼 제공.
//   (paths-panel.js 는 공유 파일이라 수정 금지 → 패스 변환 진입점을 이 패널에 둔다.)

import { EVT } from "../core/constants.js";
import { isShapeLayer, renderShapeLayer } from "../layers/shape-layer.js";
import { pathToShapeData } from "../layers/shape-layer.js";
import { applyVectorMaskFromPath, hasVectorMask, removeVectorMask, loadVectorMaskToPaths } from "../layers/vector-mask.js";
import { beginVectorEdit, commitVectorEdit } from "../text/vector-layer-command.js";

export class ShapePanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._build();
    app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => this._sync());
    app.bus.on(EVT.LAYERS_CHANGED, () => this._sync());
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">셰이프 / 벡터 마스크</div>
      <div class="shape-body" style="padding:6px;display:flex;flex-direction:column;gap:6px;"></div>`;
    const body = this.el.querySelector(".shape-body");

    // 셰이프 레이어 속성 영역
    this.propsWrap = document.createElement("div");
    this.propsWrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    body.appendChild(this.propsWrap);

    const fillRow = this._inlineRow(this.propsWrap);
    this.fillChk = this._check(fillRow, "채움", (v) => this._change((d) => d.fill = v));
    this.fillColor = this._color(fillRow, (v) => this._change((d) => d.fillColor = v));

    const strokeRow = this._inlineRow(this.propsWrap);
    this.strokeChk = this._check(strokeRow, "획", (v) => this._change((d) => d.stroke = v));
    this.strokeColor = this._color(strokeRow, (v) => this._change((d) => d.strokeColor = v));
    this.strokeW = this._number(strokeRow, "두께", 0, 200, 1, (v) => this._change((d) => d.strokeWidth = v));

    const radiusRow = this._inlineRow(this.propsWrap);
    this.radius = this._number(radiusRow, "모서리", 0, 400, 1, (v) => this._change((d) => d.cornerRadius = v));
    this.radiusRow = radiusRow;

    // 패스 변환 영역(항상 표시)
    const convWrap = document.createElement("div");
    convWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--border);padding-top:6px;";
    const convLabel = document.createElement("div");
    convLabel.textContent = "현재 펜 패스 활용";
    convLabel.style.cssText = "font-size:11px;color:var(--text-dim);";
    convWrap.appendChild(convLabel);
    const convBtns = this._inlineRow(convWrap);
    this.toShapeBtn = this._btn(convBtns, "→ 셰이프 레이어", () => this._pathToShapeLayer());
    this.toMaskBtn = this._btn(convBtns, "→ 벡터 마스크", () => this._pathToVectorMask());
    this.editMaskBtn = this._btn(convBtns, "마스크 패스 편집", () => this._loadMaskPath());
    this.delMaskBtn = this._btn(convBtns, "벡터 마스크 삭제", () => this._removeVectorMask());
    body.appendChild(convWrap);

    this.hint = document.createElement("div");
    this.hint.style.cssText = "color:var(--text-dim);font-size:11px;padding:2px;";
    body.appendChild(this.hint);

    this._sync();
  }

  _change(mutator) {
    const tool = this.app.tools?.tools?.["shapelayer"]; // 셰이프 레이어 도구(있으면 일관 처리)
    if (tool && tool.applyDataChangeToActiveLayer) {
      tool.applyDataChangeToActiveLayer(mutator, "셰이프 속성");
    } else {
      const layer = this.app.layers.activeLayer;
      if (!isShapeLayer(layer)) return;
      const tx = beginVectorEdit(this.app, layer, "vectorShape");
      mutator(layer.vectorShape);
      renderShapeLayer(layer);
      commitVectorEdit(tx, "셰이프 속성");
      this.app.layers.notifyContent(layer.id);
    }
    this._sync();
  }

  _sync() {
    const layer = this.app.layers.activeLayer;
    const d = isShapeLayer(layer) ? layer.vectorShape : null;
    // 셰이프 속성 컨트롤 활성/비활성
    const ctrls = [this.fillChk, this.fillColor, this.strokeChk, this.strokeColor, this.strokeW, this.radius];
    for (const c of ctrls) { c.disabled = !d; c.style.opacity = d ? "1" : "0.45"; }
    if (d) {
      this.fillChk.checked = !!d.fill;
      this.fillColor.value = this._toHex(d.fillColor);
      this.strokeChk.checked = !!d.stroke;
      this.strokeColor.value = this._toHex(d.strokeColor);
      this.strokeW.value = d.strokeWidth ?? 3;
      this.radius.value = d.cornerRadius ?? 10;
      this.radiusRow.style.display = d.kind === "rounded" ? "" : "none";
    }
    // 패스 변환 버튼: 현재 펜 패스가 있어야 활성
    const pm = this.app.paths;
    const hasPath = pm && (pm.current || pm.paths[pm.paths.length - 1]);
    this.toShapeBtn.disabled = !hasPath;
    this.toMaskBtn.disabled = !hasPath || !layer;
    this.editMaskBtn.disabled = !hasVectorMask(layer);
    this.delMaskBtn.disabled = !hasVectorMask(layer);

    if (d) this.hint.textContent = `셰이프 레이어(${d.kind}) 편집 중.`;
    else if (hasVectorMask(layer)) this.hint.textContent = "이 레이어에 벡터 마스크가 적용되어 있습니다.";
    else this.hint.textContent = "셰이프 레이어를 선택하거나, 펜 패스를 셰이프/마스크로 변환하세요.";
  }

  // ── 패스 변환 동작 ──
  _currentPath() {
    const pm = this.app.paths;
    if (!pm) return null;
    const p = pm.current || pm.paths[pm.paths.length - 1];
    return (p && p.anchors.length >= 2) ? p : null;
  }

  _pathToShapeLayer() {
    const p = this._currentPath();
    if (!p) { this.app.status("변환할 펜 패스가 없습니다(앵커 2개 이상)."); return; }
    const s = this.app.state;
    const data = pathToShapeData(p, {
      fill: true, fillColor: s.foreground,
      stroke: !!s.shapeStroke, strokeColor: s.foreground, strokeWidth: s.shapeStrokeWidth || 3,
    });
    const layer = this.app.layers.addLayer({ name: "패스 셰이프" });
    layer.vectorShape = data;
    renderShapeLayer(layer);
    this.app.layers.notifyContent(layer.id);
    this.app.status("패스를 셰이프 레이어로 변환했습니다.");
    this._sync();
  }

  _pathToVectorMask() {
    const p = this._currentPath();
    if (!p) { this.app.status("마스크로 쓸 펜 패스가 없습니다."); return; }
    const layer = this.app.layers.activeLayer;
    if (!layer) { this.app.status("레이어가 없습니다."); return; }
    applyVectorMaskFromPath(this.app, layer, p);
    this.app.status("패스를 벡터 마스크로 적용했습니다.");
    this._sync();
  }

  _removeVectorMask() {
    const layer = this.app.layers.activeLayer;
    if (!hasVectorMask(layer)) return;
    removeVectorMask(this.app, layer);
    this.app.status("벡터 마스크를 제거했습니다.");
    this._sync();
  }

  // 활성 레이어의 벡터 마스크 패스를 펜 도구로 다시 편집하도록 패스 패널에 올린다.
  // 편집 후 "→ 벡터 마스크"를 다시 누르면 새 패스로 마스크가 갱신된다.
  _loadMaskPath() {
    const layer = this.app.layers.activeLayer;
    if (!hasVectorMask(layer)) return;
    if (loadVectorMaskToPaths(this.app, layer)) {
      this.app.status("마스크 패스를 펜 도구로 불러왔습니다. 수정 후 '→ 벡터 마스크'를 다시 누르세요.");
    }
    this._sync();
  }

  // ── UI 빌더 ──
  _inlineRow(parent) {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
    parent.appendChild(g);
    return g;
  }
  _check(parent, label, onChange) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => onChange(input.checked));
    wrap.append(input, document.createTextNode(label));
    parent.appendChild(wrap);
    return input;
  }
  _color(parent, onChange) {
    const input = document.createElement("input");
    input.type = "color";
    input.style.cssText = "width:32px;height:22px;padding:0;border:1px solid var(--border);";
    input.addEventListener("input", () => onChange(input.value));
    parent.appendChild(input);
    return input;
  }
  _number(parent, label, min, max, step, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:3px;";
    const lb = document.createElement("label");
    lb.textContent = label; lb.style.cssText = "font-size:11px;color:var(--text-dim);";
    const input = document.createElement("input");
    input.type = "number"; input.min = min; input.max = max; input.step = step;
    input.style.cssText = "width:50px;font-size:12px;";
    const fire = () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onChange(v); };
    input.addEventListener("change", fire);
    wrap.append(lb, input);
    parent.appendChild(wrap);
    return input;
  }
  _btn(parent, label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "font-size:11px;padding:3px 6px;cursor:pointer;";
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }
  _toHex(c) {
    if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    try { const cv = document.createElement("canvas").getContext("2d"); cv.fillStyle = c || "#000000"; return cv.fillStyle; }
    catch { return "#000000"; }
  }
}
