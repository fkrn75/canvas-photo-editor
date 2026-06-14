// layer-manager.js — 레이어 배열과 문서 크기의 소유자.
// 레이어는 layers[0]=맨 아래 … layers[n-1]=맨 위 순서로 보관한다.
// 구조 변경(추가/삭제/이동/병합/속성)은 모두 Command를 통해 실행되어 undo/redo가 자동 지원된다.

import { EVT } from "../core/constants.js";
import { Layer } from "./layer.js";
import { blendLayerOnto, normalizeBlendMode } from "../engine/blend.js";
import {
  AddLayerCommand, RemoveLayerCommand, MoveLayerCommand,
  MergeDownCommand, DuplicateLayerCommand, LayerPropCommand,
  MergeVisibleCommand,
} from "../history/commands/layer-structure-command.js";

export class LayerManager {
  constructor(app) {
    this.app = app;
    /** @type {Layer[]} */
    this.layers = [];
    this.activeId = null;
    this.width = 0;
    this.height = 0;
  }

  // 새 문서 초기화: 흰 배경 레이어 1장으로 시작
  init(width, height, { fillBackground = true } = {}) {
    this.width = width;
    this.height = height;
    this.layers = [];
    const base = new Layer(width, height, "배경");
    if (fillBackground) {
      base.ctx.fillStyle = "#ffffff";
      base.ctx.fillRect(0, 0, width, height);
    }
    this.layers.push(base);
    this.activeId = base.id;
    this.notifyStructure();
  }

  // ── 조회 ──
  get activeLayer() { return this.byId(this.activeId); }
  byId(id) { return this.layers.find((l) => l.id === id) || null; }
  indexOf(id) { return this.layers.findIndex((l) => l.id === id); }
  get count() { return this.layers.length; }

  setActive(id) {
    if (this.activeId === id || !this.byId(id)) return;
    this.activeId = id;
    this.app.bus.emit(EVT.ACTIVE_LAYER_CHANGED, { id });
    this.notifyStructure();
  }

  // ── 저수준 조작 (Command 내부에서만 호출) ──
  _insert(layer, index) {
    this.layers.splice(index, 0, layer);
    this.activeId = layer.id;
  }
  _removeAt(index) {
    const [removed] = this.layers.splice(index, 1);
    if (this.activeId === removed.id) {
      const next = this.layers[Math.min(index, this.layers.length - 1)];
      this.activeId = next ? next.id : null;
    }
    return removed;
  }
  _moveTo(id, index) {
    const cur = this.indexOf(id);
    if (cur < 0) return;
    const [l] = this.layers.splice(cur, 1);
    this.layers.splice(index, 0, l);
  }

  // ── 고수준 액션 (UI에서 호출) ──
  addLayer({ name, fill = null, image = null } = {}) {
    const layer = new Layer(this.width, this.height, name);
    if (fill) { layer.ctx.fillStyle = fill; layer.ctx.fillRect(0, 0, this.width, this.height); }
    if (image) layer.ctx.drawImage(image, 0, 0);
    const index = this.indexOf(this.activeId) + 1; // 활성 레이어 위에 삽입
    this.app.history.execute(new AddLayerCommand(this, layer, index));
    return layer;
  }

  removeLayer(id = this.activeId) {
    if (this.layers.length <= 1) { this.app.status("마지막 레이어는 삭제할 수 없습니다."); return; }
    const index = this.indexOf(id);
    if (index < 0) return;
    this.app.history.execute(new RemoveLayerCommand(this, id, index));
  }

  duplicateLayer(id = this.activeId) {
    const src = this.byId(id);
    if (!src) return;
    this.app.history.execute(new DuplicateLayerCommand(this, id));
  }

  // dir: -1=아래로, +1=위로
  moveLayer(id = this.activeId, dir) {
    const cur = this.indexOf(id);
    const target = cur + dir;
    if (cur < 0 || target < 0 || target >= this.layers.length) return;
    this.app.history.execute(new MoveLayerCommand(this, id, cur, target));
  }

  mergeDown(id = this.activeId) {
    const index = this.indexOf(id);
    if (index <= 0) { this.app.status("아래에 병합할 레이어가 없습니다."); return; }
    this.app.history.execute(new MergeDownCommand(this, id));
  }

  // 보이는 레이어를 블렌드 합성해 하나로 만든다 (Merge Visible / Shift+Ctrl+E)
  mergeVisible() {
    const visibleCount = this.layers.filter((l) => l.visible).length;
    if (visibleCount <= 1) { this.app.status("병합할 보이는 레이어가 2장 이상 필요합니다."); return; }
    this.app.history.execute(new MergeVisibleCommand(this));
  }

  setOpacity(id, opacity, { commit = true } = {}) {
    const layer = this.byId(id);
    if (!layer) return;
    if (commit) {
      // 슬라이더 드래그 종료 시 한 번만 undo 항목 생성
      this.app.history.execute(new LayerPropCommand(this, id, "opacity", layer._opacityStart ?? layer.opacity, opacity));
      layer._opacityStart = undefined;
    } else {
      if (layer._opacityStart === undefined) layer._opacityStart = layer.opacity;
      layer.opacity = opacity;
      this.requestRender();
    }
  }

  // 블렌드 모드 변경 (현재값과 같으면 무시, 다르면 undo 지원)
  setBlendMode(id, mode) {
    const layer = this.byId(id);
    if (!layer) return;
    mode = normalizeBlendMode(mode);
    const cur = normalizeBlendMode(layer.blendMode || "normal");
    if (cur === mode) return;
    this.app.history.execute(new LayerPropCommand(this, id, "blendMode", cur, mode));
  }

  toggleVisible(id) {
    const layer = this.byId(id);
    if (!layer) return;
    this.app.history.execute(new LayerPropCommand(this, id, "visible", layer.visible, !layer.visible));
  }

  rename(id, name) {
    const layer = this.byId(id);
    if (!layer || layer.name === name) return;
    this.app.history.execute(new LayerPropCommand(this, id, "name", layer.name, name));
  }

  // 문서 크기 오프스크린 합성 캔버스(재사용). per-pixel 블렌드 정확성을 위해 문서 좌표계 필수.
  _ensureScratch() {
    let s = this._scratch;
    if (!s) {
      s = this._scratch = document.createElement("canvas");
      this._scratchCtx = s.getContext("2d", { willReadFrequently: true });
    }
    if (s.width !== this.width || s.height !== this.height) {
      s.width = this.width;
      s.height = this.height;
    }
    const ctx = this._scratchCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.width, this.height);
    return ctx;
  }

  // 주어진 레이어 목록을 블렌드 인식 방식으로 "문서 좌표계" 캔버스에 합성한다.
  // out 캔버스를 받으면 거기에, 없으면 내부 scratch에 그려 그 ctx를 반환한다.
  // (per-pixel 모드는 backdrop을 읽어야 하므로 반드시 1:1 문서 좌표계에서 수행)
  _composeLayers(layers, outCtx = null) {
    let ctx;
    if (outCtx) {
      ctx = outCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, this.width, this.height);
    } else {
      ctx = this._ensureScratch();
    }
    for (const layer of layers) {
      if (!layer.visible || (layer.opacity ?? 1) <= 0) continue;
      blendLayerOnto(ctx, layer);
    }
    // 합성 후 상태 원복(호출자 안전)
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return ctx;
  }

  // ── 합성 ── ctx(표시/내보내기용)에 보이는 레이어를 블렌드 인식으로 그린다.
  // renderer가 전달하는 ctx는 변환(translate/scale)이 걸려 있을 수 있으므로,
  // 항상 문서 좌표계 scratch에 합성한 뒤 결과를 한 번에 (0,0)로 그린다.
  compositeTo(ctx) {
    if (!this.width || !this.height) return;
    this._composeLayers(this.layers); // scratch에 합성
    ctx.drawImage(this._scratch, 0, 0);
  }

  // 모든 레이어를 평탄화한 단일 캔버스를 만든다 (내보내기/병합용) — 블렌드 인식
  flatten() {
    const out = document.createElement("canvas");
    out.width = this.width;
    out.height = this.height;
    this._composeLayers(this.layers, out.getContext("2d", { willReadFrequently: true }));
    return out;
  }

  // ── 통지 ──
  requestRender() { this.app.renderer?.requestRender(); }
  // 픽셀 내용만 바뀜(레이어 목록 구조는 그대로): 썸네일 갱신 + 재렌더
  notifyContent(id) {
    const layer = this.byId(id);
    if (layer) layer.thumbDirty = true;
    this.requestRender();
    this.app.bus.emit(EVT.LAYERS_CHANGED, { reason: "content" });
  }
  // 구조 변경(추가/삭제/순서/속성/활성)
  notifyStructure() {
    this.requestRender();
    this.app.bus.emit(EVT.LAYERS_CHANGED, { reason: "structure" });
  }
}
