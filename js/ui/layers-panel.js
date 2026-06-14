// layers-panel.js — 레이어 목록(맨 위 레이어가 위에 표시), 불투명도, 표시 토글, 추가/복제/이동/병합/삭제, 썸네일.

import { EVT } from "../core/constants.js";
import { BLEND_MODES } from "../engine/blend.js";

export class LayersPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._build();
    app.bus.on(EVT.LAYERS_CHANGED, () => this._render());
    app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => this._render());
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">레이어</div>
      <div class="layer-options">
        <div class="row">
          <label>모드</label>
          <select class="blend">${this._blendOptionsHtml()}</select>
        </div>
        <div class="row">
          <label>불투명도</label>
          <input type="range" class="op" min="0" max="100" value="100">
          <span class="val-badge op-val">100%</span>
        </div>
      </div>
      <div class="layer-list"></div>
      <div class="layer-toolbar">
        <button class="add" title="새 레이어">＋</button>
        <button class="dup" title="레이어 복제">⧉</button>
        <button class="up" title="위로 이동">▲</button>
        <button class="down" title="아래로 이동">▼</button>
        <button class="merge" title="아래로 병합">⤓</button>
        <button class="del" title="레이어 삭제">🗑</button>
      </div>`;

    this.list = this.el.querySelector(".layer-list");
    this.blendSel = this.el.querySelector(".blend");
    this.opSlider = this.el.querySelector(".op");
    this.opVal = this.el.querySelector(".op-val");

    this.blendSel.addEventListener("change", (e) => {
      const id = this.app.layers.activeId;
      if (id != null) this.app.layers.setBlendMode(id, e.target.value);
    });

    this.opSlider.addEventListener("input", (e) => {
      const v = +e.target.value / 100;
      this.app.layers.setOpacity(this.app.layers.activeId, v, { commit: false });
      this.opVal.textContent = e.target.value + "%";
    });
    this.opSlider.addEventListener("change", (e) => {
      this.app.layers.setOpacity(this.app.layers.activeId, +e.target.value / 100, { commit: true });
    });

    const L = this.app.layers;
    this.el.querySelector(".add").addEventListener("click", () => L.addLayer({}));
    this.el.querySelector(".dup").addEventListener("click", () => L.duplicateLayer());
    this.el.querySelector(".up").addEventListener("click", () => L.moveLayer(undefined, +1));
    this.el.querySelector(".down").addEventListener("click", () => L.moveLayer(undefined, -1));
    this.el.querySelector(".merge").addEventListener("click", () => L.mergeDown());
    this.el.querySelector(".del").addEventListener("click", () => L.removeLayer());

    this._render();
  }

  // BLEND_MODES → <option> 문자열. sep 마커는 비활성 구분선 옵션으로 표시.
  // (라벨은 코드 내 고정 상수이므로 XSS 위험 없음)
  _blendOptionsHtml() {
    return BLEND_MODES.map((m) =>
      m.sep
        ? `<option disabled>──────────</option>`
        : `<option value="${m.id}">${m.label}</option>`
    ).join("");
  }

  _render() {
    const lm = this.app.layers;
    const act = lm.activeLayer;
    if (act) {
      this.opSlider.value = Math.round(act.opacity * 100);
      this.opVal.textContent = Math.round(act.opacity * 100) + "%";
      this.blendSel.value = act.blendMode || "normal";
      this.blendSel.disabled = false;
    } else {
      this.blendSel.disabled = true;
    }

    this.list.innerHTML = "";
    // 위에서부터(맨 위 레이어) 표시 → 배열 역순
    for (let i = lm.layers.length - 1; i >= 0; i--) {
      const layer = lm.layers[i];
      const row = document.createElement("div");
      row.className = "layer-row" + (layer.id === lm.activeId ? " active" : "");

      const vis = document.createElement("div");
      vis.className = "layer-vis" + (layer.visible ? "" : " hidden");
      vis.textContent = layer.visible ? "👁" : "○";
      vis.title = "표시/숨김";
      vis.addEventListener("click", (e) => { e.stopPropagation(); lm.toggleVisible(layer.id); });

      const thumb = document.createElement("div");
      thumb.className = "layer-thumb";
      thumb.appendChild(this._thumb(layer));

      const name = document.createElement("div");
      name.className = "layer-name";
      name.textContent = layer.name;
      name.addEventListener("dblclick", () => this._rename(layer, name));

      row.append(vis, thumb, name);
      row.addEventListener("click", () => lm.setActive(layer.id));
      this.list.appendChild(row);
    }
  }

  _thumb(layer) {
    const c = document.createElement("canvas");
    const ratio = Math.min(36 / layer.width, 36 / layer.height);
    c.width = Math.max(1, Math.round(layer.width * ratio));
    c.height = Math.max(1, Math.round(layer.height * ratio));
    c.getContext("2d").drawImage(layer.canvas, 0, 0, c.width, c.height);
    layer.thumbDirty = false;
    return c;
  }

  _rename(layer, nameEl) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = layer.name;
    nameEl.innerHTML = "";
    nameEl.appendChild(input);
    input.focus();
    input.select();
    const done = () => this.app.layers.rename(layer.id, input.value.trim() || layer.name);
    input.addEventListener("blur", done);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = layer.name; input.blur(); }
    });
  }
}
