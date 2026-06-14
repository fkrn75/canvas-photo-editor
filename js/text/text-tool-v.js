// text-tool-v.js — 벡터(재편집 가능) 텍스트 도구. BaseTool 상속.
//
// 동작:
//   - 빈 곳 클릭        : 새 텍스트 레이어 생성 → contenteditable 오버레이로 입력 → 확정 시 vectorText 에 보존+렌더.
//   - 기존 텍스트 레이어 위 클릭(또는 더블클릭) : 그 텍스트를 다시 편집(오버레이 재오픈).
//   - 입력 중 클릭/blur : 확정. Esc=취소, Ctrl+Enter=확정.
//
// IME(한글) 안정성을 위해 입력은 contenteditable DIV 오버레이로 받는다(기존 text-tool 패턴 계승).
// 확정 시 화면 픽셀은 text-layer.renderTextLayer 가 그리고, 소스는 layer.vectorText 에 남아 재편집 가능하다.

import { BaseTool } from "../tools/base-tool.js";
import {
  defaultTextData, cssFontFromData, renderTextLayer,
  isTextLayer, hitText,
} from "./text-layer.js";
import { beginVectorEdit, commitVectorEdit } from "./vector-layer-command.js";

export class TextToolV extends BaseTool {
  get cursor() { return "text"; }

  onActivate() {
    this.overlay = document.getElementById("text-overlay");
    // Character 팔레트가 현재 편집 중인 레이어를 알 수 있도록 연결
    this.app.activeTextTool = this;
  }
  onDeactivate() {
    this._commit();
    if (this.app.activeTextTool === this) this.app.activeTextTool = null;
  }

  onPointerDown(pt, e) {
    if (this.editor) { this._commit(); return; } // 입력 중이면 먼저 확정

    // 1) 기존 텍스트 레이어 위를 클릭하면 그것을 편집(맨 위 레이어 우선)
    const hit = this._hitTopTextLayer(pt);
    if (hit) {
      this._newLayerJustCreated = null; // 기존 레이어 편집은 "새로 만든" 상태가 아님
      this.app.layers.setActive(hit.id);
      this._editLayer(hit);
      return;
    }

    // 2) 빈 곳 → 새 텍스트 레이어 생성 후 편집
    this._createTextLayer(pt);
  }

  // 새 텍스트 레이어를 만들고(빈 vectorText) 즉시 편집 모드로.
  _createTextLayer(pt) {
    const s = this.state;
    const data = defaultTextData({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      bold: s.fontBold,
      italic: s.fontItalic,
      color: s.foreground,
      align: s.textAlign || "left",
      letterSpacing: s.letterSpacing || 0,
      lineHeight: s.lineHeight || 1.2,
      x: pt.x,
      y: pt.y,
    });
    // addLayer 는 활성 레이어 위에 새 레이어를 만들고 활성화한다(히스토리 1단계).
    const layer = this.app.layers.addLayer({ name: "텍스트" });
    layer.vectorText = data;
    this._newLayerJustCreated = layer; // 빈 채로 확정 시 정리 판단용
    this._editLayer(layer);
  }

  // 맨 위에서부터 텍스트 레이어 적중 검사
  _hitTopTextLayer(pt) {
    const layers = this.app.layers.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.visible && isTextLayer(L) && hitText(L, pt.x, pt.y)) return L;
    }
    return null;
  }

  // 레이어의 vectorText 를 오버레이로 편집 시작
  _editLayer(layer) {
    if (!layer.vectorText) return;
    this.layer = layer;
    this._tx = beginVectorEdit(this.app, layer, "vectorText"); // 편집 트랜잭션 시작
    // 편집 중에는 캔버스의 해당 텍스트를 잠시 숨겨 오버레이와 겹치지 않게 한다.
    layer.ctx.clearRect(0, 0, layer.width, layer.height);
    layer.thumbDirty = true;
    this.app.renderer.requestRender();
    this._createEditor(layer.vectorText);
    // Character 팔레트 갱신(현재 편집 데이터 반영)
    this.app.characterPanel?.bindData(layer.vectorText, () => this._onLiveDataChange());
  }

  _createEditor(d) {
    const vp = this.app.viewport;
    const el = document.createElement("div");
    el.className = "text-edit";
    el.contentEditable = "true";
    el.spellcheck = false;
    el.innerText = d.text || "";
    const sc = vp.worldToScreen(d.x, d.y);
    el.style.left = sc.x + "px";
    el.style.top = sc.y + "px";
    el.style.color = d.color;
    el.style.font = cssFontFromData(d);
    el.style.lineHeight = String(d.lineHeight || 1.2);
    el.style.letterSpacing = (d.letterSpacing || 0) + "px";
    el.style.textAlign = d.align || "left";
    el.style.transform = `scale(${vp.zoom})`;
    this.overlay.appendChild(el);
    this.editor = el;
    setTimeout(() => {
      el.focus();
      // 커서를 끝으로
      const r = document.createRange();
      r.selectNodeContents(el); r.collapse(false);
      const selO = window.getSelection(); selO.removeAllRanges(); selO.addRange(r);
    }, 0);

    // IME(한글) 조합 상태 추적. 조합 중에 el.style.font 등을 교체하면 조합이 끊겨
    // 자모가 분리 확정되므로, 조합 중 들어온 스타일 변경은 미뤘다가 compositionend 후 반영한다.
    this._composing = false;
    this._pendingStyle = false;
    el.addEventListener("compositionstart", () => { this._composing = true; });
    el.addEventListener("compositionend", () => {
      this._composing = false;
      // 조합 중 보류된 스타일 변경이 있으면 지금 반영(이제 조합이 끝나 안전).
      if (this._pendingStyle) { this._pendingStyle = false; this._applyStyleToEditor(); }
    });

    el.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // 도구 단축키와 충돌 방지
      if (ev.key === "Escape") { ev.preventDefault(); this._cancel(); }
      else if (ev.key === "Enter" && ev.ctrlKey) { ev.preventDefault(); this._commit(); }
    });
    el.addEventListener("input", () => {
      // 라이브로 데이터에 반영(팔레트/측정 동기화). 렌더는 확정 시.
      if (this.layer?.vectorText) this.layer.vectorText.text = el.innerText.replace(/\n$/, "");
    });
    el.addEventListener("blur", () => {
      setTimeout(() => { if (this.editor === el) this._commit(); }, 120);
    });
  }

  // Character 팔레트에서 폰트/크기/색 등을 바꾸면 호출됨(편집 중 라이브 반영).
  // IME 조합 중에는 스타일 교체가 조합을 끊으므로(자모 분리 확정) 보류 플래그만 세우고,
  // compositionend 후에 실제로 반영한다. (데이터 자체는 호출측에서 이미 갱신됨)
  _onLiveDataChange() {
    if (this._composing) { this._pendingStyle = true; return; }
    this._applyStyleToEditor();
  }

  // 현재 vectorText 데이터를 편집 오버레이(el)의 인라인 스타일에 실제로 반영한다.
  _applyStyleToEditor() {
    const el = this.editor;
    const d = this.layer?.vectorText;
    if (!el || !d) return;
    el.style.color = d.color;
    el.style.font = cssFontFromData(d);
    el.style.lineHeight = String(d.lineHeight || 1.2);
    el.style.letterSpacing = (d.letterSpacing || 0) + "px";
    el.style.textAlign = d.align || "left";
  }

  _commit() {
    const el = this.editor;
    const layer = this.layer;
    const tx = this._tx;
    if (!el || !layer) return;
    const text = el.innerText.replace(/\n$/, "");
    this.editor = null;
    this.layer = null;
    this._tx = null;
    el.remove();
    this.app.characterPanel?.unbind();

    layer.vectorText.text = text;
    const wasNew = this._newLayerJustCreated === layer;
    this._newLayerJustCreated = null;

    // 빈 텍스트로 확정한 신규 레이어면 통째 취소(undo 한 번으로 레이어 추가 자체 제거).
    if (!text.trim() && wasNew) {
      this.app.history.undo(); // addLayer 취소
      return;
    }

    renderTextLayer(layer, { selection: null });
    // 신규 레이어는 이미 AddLayerCommand가 최종 상태(텍스트 포함)를 덮으므로 별도 편집 커맨드 불필요
    // (undo 1번에 레이어째 제거, redo 시 동일 객체라 텍스트 그대로 복원). 기존 레이어 편집만 커밋.
    if (!wasNew && tx) commitVectorEdit(tx, "텍스트"); // 데이터+픽셀 변경을 히스토리에 등록
    this.app.layers.notifyContent(layer.id);
  }

  _cancel() {
    const layer = this.layer;
    const tx = this._tx;
    if (this.editor) { this.editor.remove(); this.editor = null; }
    this.app.characterPanel?.unbind();
    this.layer = null;
    this._tx = null;
    if (!layer) return;
    // 방금 만든 레이어를 취소하면 레이어 추가 자체를 undo
    if (this._newLayerJustCreated === layer) {
      this._newLayerJustCreated = null;
      this.app.history.undo();
      return;
    }
    // 기존 레이어 편집 취소: before 데이터/픽셀로 복원
    if (tx) {
      layer.vectorText = tx.beforeData ? JSON.parse(JSON.stringify(tx.beforeData)) : layer.vectorText;
      layer.ctx.putImageData(tx.beforeImg, 0, 0);
      layer.thumbDirty = true;
      this.app.layers.notifyContent(layer.id);
    }
  }

  // 외부(팔레트)에서 "현재 활성 레이어가 텍스트면 그 데이터를 즉시 바꾸고 재렌더"할 때 사용.
  // 편집 중이 아니어도 동작(선택된 텍스트 레이어 속성 변경).
  applyDataChangeToActiveLayer(mutator, label = "텍스트 속성") {
    const layer = this.app.layers.activeLayer;
    if (!isTextLayer(layer)) return false;
    // 편집 중이면 라이브 반영만(확정 시 커밋), 아니면 즉시 히스토리 트랜잭션.
    if (this.editor && this.layer === layer) {
      mutator(layer.vectorText);
      this._onLiveDataChange();
      return true;
    }
    const tx = beginVectorEdit(this.app, layer, "vectorText");
    mutator(layer.vectorText);
    renderTextLayer(layer, { selection: null });
    commitVectorEdit(tx, label);
    this.app.layers.notifyContent(layer.id);
    return true;
  }
}
