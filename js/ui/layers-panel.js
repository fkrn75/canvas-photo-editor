// layers-panel.js — 레이어 목록(맨 위 레이어가 위에 표시), 불투명도, 표시 토글, 추가/복제/이동/병합/삭제, 썸네일.

import { EVT } from "../core/constants.js";
import { BLEND_MODES } from "../engine/blend.js";
import { openLayerStyle } from "./layer-style-dialog.js";

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
      <div class="panel-head">레이어<button class="opt-toggle" title="레이어 옵션(모드/잠금/불투명도/채우기) 접기/펴기">⚙</button></div>
      <div class="layer-options">
        <div class="row">
          <label>모드</label>
          <select class="blend">${this._blendOptionsHtml()}</select>
        </div>
        <div class="row lock-row">
          <label>잠금</label>
          <button class="lock-tp" title="투명 영역 잠금">▦</button>
          <button class="lock-img" title="이미지 픽셀 잠금">🖌</button>
          <button class="lock-pos" title="위치 잠금">✛</button>
        </div>
        <div class="row">
          <label>불투명</label>
          <input type="range" class="op" min="0" max="100" value="100">
          <span class="val-badge op-val">100%</span>
        </div>
        <div class="row">
          <label>채우기</label>
          <input type="range" class="fill" min="0" max="100" value="100">
          <span class="val-badge fill-val">100%</span>
        </div>
      </div>
      <div class="layer-list"></div>
      <div class="layer-toolbar">
        <button class="add" title="새 레이어">＋</button>
        <button class="dup" title="레이어 복제">⧉</button>
        <button class="mask" title="레이어 마스크 추가/삭제">◧</button>
        <button class="clip" title="클리핑 마스크 (Ctrl+G)">⌎</button>
        <button class="up" title="위로 이동">▲</button>
        <button class="down" title="아래로 이동">▼</button>
        <button class="merge" title="아래로 병합">⤓</button>
        <button class="del" title="레이어 삭제">🗑</button>
      </div>`;

    this.list = this.el.querySelector(".layer-list");
    this.blendSel = this.el.querySelector(".blend");
    this.opSlider = this.el.querySelector(".op");
    this.opVal = this.el.querySelector(".op-val");
    this.fillSlider = this.el.querySelector(".fill");
    this.fillVal = this.el.querySelector(".fill-val");
    this.lockTpBtn = this.el.querySelector(".lock-tp");
    this.lockImgBtn = this.el.querySelector(".lock-img");
    this.lockPosBtn = this.el.querySelector(".lock-pos");

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

    // 채우기 불투명도(Fill Opacity)
    this.fillSlider.addEventListener("input", (e) => {
      this.app.layers.setFillOpacity(this.app.layers.activeId, +e.target.value / 100, { commit: false });
      this.fillVal.textContent = e.target.value + "%";
    });
    this.fillSlider.addEventListener("change", (e) => {
      this.app.layers.setFillOpacity(this.app.layers.activeId, +e.target.value / 100, { commit: true });
    });

    const L = this.app.layers;
    // 잠금 토글
    this.lockTpBtn.addEventListener("click", () => L.toggleLock(L.activeId, "lockTransparency"));
    this.lockImgBtn.addEventListener("click", () => L.toggleLock(L.activeId, "lockImage"));
    this.lockPosBtn.addEventListener("click", () => L.toggleLock(L.activeId, "lockPosition"));

    this.el.querySelector(".add").addEventListener("click", () => L.addLayer({}));
    this.el.querySelector(".dup").addEventListener("click", () => L.duplicateLayer());
    // 마스크 버튼: 없으면 추가, 있으면 삭제(토글)
    this.el.querySelector(".mask").addEventListener("click", () => {
      const a = L.activeLayer;
      if (!a) return;
      if (a.mask) L.removeMask(); else L.addMask(undefined, { fromSelection: !!(this.app.selection?.active) });
    });
    this.el.querySelector(".clip").addEventListener("click", () => L.toggleClip());
    this.el.querySelector(".up").addEventListener("click", () => L.moveLayer(undefined, +1));
    this.el.querySelector(".down").addEventListener("click", () => L.moveLayer(undefined, -1));
    this.el.querySelector(".merge").addEventListener("click", () => L.mergeDown());
    this.el.querySelector(".del").addEventListener("click", () => L.removeLayer());

    // 레이어 옵션(모드/잠금/불투명/채우기) 표시 토글 — 숨기면 레이어 목록이 그만큼 넓어진다.
    // ⚙ 버튼과 상단 [보기] 메뉴(menu-bar)가 공통으로 toggleLayerOptions()를 호출한다.
    // (⚙는 <button>이라 panel-collapse의 "헤더 내 button 클릭 무시" 규칙으로 패널 전체 접기와 구분됨)
    this._optBody = this.el.querySelector(".layer-options");
    this._optToggle = this.el.querySelector(".opt-toggle");
    if (localStorage.getItem("cpe.layerOptionsHidden") === "1") this._optBody.classList.add("hidden");
    this._syncOptToggle();
    this._optToggle.addEventListener("click", () => this.toggleLayerOptions());

    this._render();
  }

  // 레이어 옵션(모드/잠금/불투명/채우기) 표시/숨김 토글. ⚙ 버튼·[보기] 메뉴 공용, localStorage 영속.
  toggleLayerOptions() {
    const hidden = this._optBody.classList.toggle("hidden");
    this._syncOptToggle();
    try { localStorage.setItem("cpe.layerOptionsHidden", hidden ? "1" : "0"); } catch { /* 저장 실패 무시 */ }
  }
  // ⚙ 버튼 활성(숨김 상태) 표시를 현재 상태와 동기화.
  _syncOptToggle() {
    if (this._optToggle) this._optToggle.classList.toggle("on", this._optBody.classList.contains("hidden"));
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
      this.fillSlider.value = Math.round((act.fillOpacity ?? 1) * 100);
      this.fillVal.textContent = Math.round((act.fillOpacity ?? 1) * 100) + "%";
      this.blendSel.value = act.blendMode || "normal";
      this.blendSel.disabled = false;
      this.opSlider.disabled = this.fillSlider.disabled = false;
      // 잠금 버튼 활성 표시
      this.lockTpBtn.classList.toggle("on", !!act.lockTransparency);
      this.lockImgBtn.classList.toggle("on", !!act.lockImage);
      this.lockPosBtn.classList.toggle("on", !!act.lockPosition);
    } else {
      this.blendSel.disabled = true;
      this.opSlider.disabled = this.fillSlider.disabled = true;
    }
    // 마스크 버튼 상태(있으면 삭제 모드 표시)
    const maskBtn = this.el.querySelector(".mask");
    if (maskBtn) maskBtn.classList.toggle("on", !!(act && act.mask));
    const clipBtn = this.el.querySelector(".clip");
    if (clipBtn) clipBtn.classList.toggle("on", !!(act && act.clipped));

    this.list.innerHTML = "";
    // 위에서부터(맨 위 레이어) 표시 → 배열 역순
    for (let i = lm.layers.length - 1; i >= 0; i--) {
      const layer = lm.layers[i];
      const row = document.createElement("div");
      row.className = "layer-row" + (layer.id === lm.activeId ? " active" : "")
        + (layer.clipped ? " clipped" : "");

      const vis = document.createElement("div");
      vis.className = "layer-vis" + (layer.visible ? "" : " hidden");
      vis.textContent = layer.visible ? "👁" : "○";
      vis.title = "표시/숨김";
      vis.addEventListener("click", (e) => { e.stopPropagation(); lm.toggleVisible(layer.id); });

      // 레이어 픽셀 썸네일 — 클릭하면 레이어를 편집 대상으로(maskActive=false)
      const thumb = document.createElement("div");
      thumb.className = "layer-thumb"
        + (layer.mask && !layer.maskActive ? " edit-target" : "");
      thumb.appendChild(this._thumb(layer));
      thumb.title = "레이어 편집";
      thumb.addEventListener("click", (e) => {
        e.stopPropagation();
        lm.setActive(layer.id);
        if (layer.mask) lm.setMaskActive(layer.id, false);
      });

      // 마스크 썸네일(있을 때만) — 클릭하면 마스크를 편집 대상으로(maskActive=true)
      let maskThumb = null;
      if (layer.mask) {
        maskThumb = document.createElement("div");
        maskThumb.className = "layer-mask-thumb"
          + (layer.maskActive ? " edit-target" : "")
          + (layer.maskEnabled ? "" : " disabled");
        maskThumb.appendChild(this._maskThumb(layer));
        maskThumb.title = layer.maskEnabled
          ? "마스크 편집 (클릭) · 더블클릭=사용/사용안함"
          : "마스크 사용 안 함 (더블클릭=다시 사용)";
        maskThumb.addEventListener("click", (e) => {
          e.stopPropagation();
          lm.setActive(layer.id);
          lm.setMaskActive(layer.id, true);
        });
        maskThumb.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          lm.toggleMaskEnabled(layer.id);
        });
      }

      const name = document.createElement("div");
      name.className = "layer-name";
      name.textContent = (layer.clipped ? "↳ " : "") + layer.name;
      // 조정 레이어: 이름 더블클릭 시 이름변경 대신 파라미터 편집 다이얼로그
      if (layer.type === "adjustment") {
        name.classList.add("adjustment");
        name.addEventListener("dblclick", (e) => { e.stopPropagation(); this.app.editAdjustmentLayer(layer.id); });
      } else {
        name.addEventListener("dblclick", () => this._rename(layer, name));
      }

      // fx 버튼: 레이어 스타일 편집 진입(스타일 있으면 강조 표시)
      const fxBtn = document.createElement("div");
      fxBtn.className = "layer-fx" + (layer.styles ? " on" : "");
      fxBtn.textContent = "fx";
      fxBtn.title = "레이어 스타일";
      fxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        lm.setActive(layer.id);
        openLayerStyle(this.app);
      });

      // 잠금 상태 표시 아이콘(요약)
      const locks = document.createElement("div");
      locks.className = "layer-locks";
      const lockStr = (layer.lockPosition ? "✛" : "") + (layer.lockTransparency ? "▦" : "") + (layer.lockImage ? "🔒" : "");
      locks.textContent = lockStr;

      row.append(vis, thumb);
      if (maskThumb) row.append(maskThumb);
      row.append(name, fxBtn, locks);
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

  // 마스크 그레이스케일 썸네일
  _maskThumb(layer) {
    const c = document.createElement("canvas");
    const ratio = Math.min(36 / layer.width, 36 / layer.height);
    c.width = Math.max(1, Math.round(layer.width * ratio));
    c.height = Math.max(1, Math.round(layer.height * ratio));
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); // 알파 없는 마스크 배경
    x.drawImage(layer.mask, 0, 0, c.width, c.height);
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
