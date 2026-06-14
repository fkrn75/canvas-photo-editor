// layer-manager.js — 레이어 배열과 문서 크기의 소유자.
// 레이어는 layers[0]=맨 아래 … layers[n-1]=맨 위 순서로 보관한다.
// 구조 변경(추가/삭제/이동/병합/속성)은 모두 Command를 통해 실행되어 undo/redo가 자동 지원된다.

import { EVT } from "../core/constants.js";
import { Layer } from "./layer.js";
import {
  blendLayerOnto, normalizeBlendMode,
  buildEffectiveSource, clipAlphaByAlpha,
} from "../engine/blend.js";
import { applyLayerStyles } from "./layer-styles.js";
import { composeAdjustment } from "./adjustment-layer.js";
import { AddAdjustmentLayerCommand } from "../history/commands/adjustment-command.js";
import {
  AddLayerCommand, RemoveLayerCommand, MoveLayerCommand,
  MergeDownCommand, DuplicateLayerCommand, LayerPropCommand,
  MergeVisibleCommand,
  AddMaskCommand, RemoveMaskCommand, ToggleMaskEnabledCommand,
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

  // 조정 레이어 추가(활성 레이어 위에 삽입). type=ADJUSTMENT_TYPES 키.
  addAdjustmentLayer(type, params = null) {
    const index = this.indexOf(this.activeId) + 1;
    this.app.history.execute(new AddAdjustmentLayerCommand(this, type, index, params));
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

  // ── 마스크 ──
  // 레이어 마스크 추가. reveal=true(Reveal All/흰색) / false(Hide All/검정).
  // 선택 영역이 있으면 그 영역만 드러내는 마스크(Reveal Selection)를 만든다.
  addMask(id = this.activeId, { reveal = true, fromSelection = false } = {}) {
    const layer = this.byId(id);
    if (!layer) return;
    if (layer.mask) { this.app.status("이미 마스크가 있습니다."); return; }
    this.app.history.execute(new AddMaskCommand(this, id, { reveal, fromSelection }));
    this.app.status("레이어 마스크를 추가했습니다.");
  }

  // 레이어 마스크 삭제
  removeMask(id = this.activeId) {
    const layer = this.byId(id);
    if (!layer || !layer.mask) { this.app.status("삭제할 마스크가 없습니다."); return; }
    this.app.history.execute(new RemoveMaskCommand(this, id));
    this.app.status("레이어 마스크를 삭제했습니다.");
  }

  // 마스크 사용/사용 안 함(disable) 토글
  toggleMaskEnabled(id = this.activeId) {
    const layer = this.byId(id);
    if (!layer || !layer.mask) { this.app.status("마스크가 없습니다."); return; }
    this.app.history.execute(new ToggleMaskEnabledCommand(this, id));
    this.app.status(layer.maskEnabled ? "마스크 사용" : "마스크 사용 안 함");
  }

  // 레이어↔마스크 편집 전환(maskActive 토글). 히스토리 불필요한 일시 상태.
  setMaskActive(id, active) {
    const layer = this.byId(id);
    if (!layer || !layer.mask) return;
    layer.maskActive = !!active;
    this.notifyStructure();
  }

  // ── 클리핑 마스크 ──
  // 클리핑 토글(이전 레이어와 그룹/해제). 맨 아래 레이어는 베이스가 없어 클립 불가.
  toggleClip(id = this.activeId) {
    const layer = this.byId(id);
    if (!layer) return;
    const idx = this.indexOf(id);
    if (idx <= 0) { this.app.status("맨 아래 레이어는 클리핑할 수 없습니다."); return; }
    this.app.history.execute(new LayerPropCommand(this, id, "clipped", !!layer.clipped, !layer.clipped));
    this.app.status(layer.clipped ? "클리핑 마스크 생성" : "클리핑 마스크 해제");
  }

  // ── 잠금 ──
  // prop: "lockTransparency" | "lockImage" | "lockPosition"
  toggleLock(id, prop) {
    const layer = this.byId(id);
    if (!layer) return;
    this.app.history.execute(new LayerPropCommand(this, id, prop, !!layer[prop], !layer[prop]));
  }

  // ── 채우기 불투명도(Fill Opacity) ──
  setFillOpacity(id, fillOpacity, { commit = true } = {}) {
    const layer = this.byId(id);
    if (!layer) return;
    if (commit) {
      this.app.history.execute(new LayerPropCommand(this, id, "fillOpacity", layer._fillStart ?? layer.fillOpacity, fillOpacity));
      layer._fillStart = undefined;
    } else {
      if (layer._fillStart === undefined) layer._fillStart = layer.fillOpacity;
      layer.fillOpacity = fillOpacity;
      this.requestRender();
    }
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

  // 단일 레이어를 마스크/FillOpacity/클리핑을 반영해 ctx 위에 블렌드한다.
  // baseAlphaCanvas: 클리핑된 레이어면 그 클립 베이스(아래 레이어)의 캔버스(알파 제공). 아니면 null.
  // (블렌드 결과 보존: 마스크/fill/클립은 모두 "소스 알파"에만 곱한 뒤 blendLayerOnto에 전달)
  _blendOneLayer(ctx, layer, baseAlphaCanvas) {
    // 1) 마스크 휘도 + fillOpacity를 알파에 곱한 유효 소스 캔버스 생성(없으면 null=원본 사용)
    let eff = buildEffectiveSource(layer);

    // 1.5) 레이어 스타일: eff(없으면 원본 복사)에 효과를 합성한 새 캔버스로 교체(비파괴)
    if (layer.styles) {
      if (!eff) {
        eff = document.createElement("canvas");
        eff.width = this.width; eff.height = this.height;
        eff.getContext("2d", { willReadFrequently: true }).drawImage(layer.canvas, 0, 0);
      }
      eff = applyLayerStyles(eff, layer.styles);
    }

    // 2) 클리핑: 베이스 알파로 추가 마스킹. eff가 없으면(=마스크/fill 모두 없음) 원본을 복사해 만든다.
    if (baseAlphaCanvas) {
      if (!eff) {
        eff = document.createElement("canvas");
        eff.width = this.width; eff.height = this.height;
        eff.getContext("2d", { willReadFrequently: true }).drawImage(layer.canvas, 0, 0);
      }
      clipAlphaByAlpha(eff, baseAlphaCanvas);
    }

    if (!eff) {
      // 적용할 마스크/fill/클립 없음 → 원본 레이어 그대로 블렌드(가장 빠른 경로)
      blendLayerOnto(ctx, layer);
      return;
    }

    // 유효 소스를 입힌 래퍼로 블렌드(원본 blendMode/opacity 유지).
    // ctx(.ctx) 미제공 → blendLayerOnto의 per-pixel 경로가 canvas.getContext로 읽음.
    blendLayerOnto(ctx, {
      canvas: eff,
      blendMode: layer.blendMode,
      opacity: layer.opacity,
      visible: true,
    });
  }

  // 주어진 레이어 목록을 블렌드 인식 방식으로 "문서 좌표계" 캔버스에 합성한다.
  // out 캔버스를 받으면 거기에, 없으면 내부 scratch에 그려 그 ctx를 반환한다.
  // (per-pixel 모드는 backdrop을 읽어야 하므로 반드시 1:1 문서 좌표계에서 수행)
  //
  // 클리핑 마스크: layer.clipped 레이어는 "바로 아래의 클립 베이스" 알파로 제한된다.
  // 베이스 = 자신 아래의 가장 가까운 비클립(clipped=false) 레이어. 베이스가 숨김/없음이면
  // 클립 그룹 전체를 건너뛴다(포토샵 동작: 베이스가 안 보이면 클립 레이어도 안 보임).
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

    // 현재 활성 클립 베이스(아래 레이어)와 그 가시성을 추적
    let clipBase = null;        // 가장 최근의 비클립 레이어
    let clipBaseVisible = false;
    for (const layer of layers) {
      // 조정 레이어: 그때까지 합성된 ctx 전체에 보정 적용(아래 레이어 전부에 영향).
      // 빈 투명 캔버스라 클립 베이스가 되면 안 되므로 clipBase 추적을 건드리지 않고 조기 처리.
      if (layer.type === "adjustment") {
        if (!layer.visible || (layer.opacity ?? 1) <= 0) continue;
        composeAdjustment(ctx, layer, this.width, this.height);
        continue;
      }
      const isClipped = !!layer.clipped;
      if (!isClipped) {
        // 새 클립 베이스 후보
        clipBase = layer;
        clipBaseVisible = layer.visible && (layer.opacity ?? 1) > 0;
        if (!clipBaseVisible) continue;
        this._blendOneLayer(ctx, layer, null);
      } else {
        // 클립 레이어: 베이스가 없거나 숨김이면 그림(포토샵: 베이스 비가시 시 클립도 비가시)
        if (!clipBase || !clipBaseVisible) continue;
        if (!layer.visible || (layer.opacity ?? 1) <= 0) continue;
        this._blendOneLayer(ctx, layer, clipBase.canvas);
      }
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
