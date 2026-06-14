// layer-style-dialog.js — 레이어 스타일(Layer Styles) 편집 모달.
// 활성 레이어의 styles를 효과별 체크박스 + 파라미터로 편집한다.
//   · 그림자(Drop Shadow) · 외부 광선(Outer Glow) · 선(Stroke) · 색상 오버레이(Color Overlay)
// 실시간 미리보기: 편집 중에는 layer.styles를 임시로 바꿔 renderer로 즉시 반영한다.
//   - 확인: LayerPropCommand("styles")로 히스토리 1스텝 등록(undo/redo 지원).
//   - 취소: 원래 styles로 되돌리고 재렌더.
// dialogs.custom(title, bodyEl, onOk, onCancel) 패턴을 따른다(stroke-dialog.js 참고).

import { makeDefaultStyles, hasAnyStyle } from "../layers/layer-styles.js";
import { LayerPropCommand } from "../history/commands/layer-structure-command.js";

// styles 객체 깊은 복사(효과 4종 평면 객체이므로 얕은 병합으로 충분)
function cloneStyles(s) {
  if (!s) return null;
  return {
    dropShadow:   { ...s.dropShadow },
    outerGlow:    { ...s.outerGlow },
    stroke:       { ...s.stroke },
    colorOverlay: { ...s.colorOverlay },
  };
}

// 한 줄(라벨 + 슬라이더 + 숫자 뱃지) 컨트롤 생성. onInput(value)로 값 통지.
function sliderRow(label, { min, max, step, value, suffix = "" }, onInput) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = label; lab.style.width = "56px";
  const sl = document.createElement("input");
  sl.type = "range"; sl.min = min; sl.max = max; sl.step = step; sl.value = value;
  sl.style.flex = "1";
  const badge = document.createElement("span");
  badge.className = "val-badge";
  badge.textContent = value + suffix;
  sl.addEventListener("input", () => {
    const v = parseFloat(sl.value);
    badge.textContent = v + suffix;
    onInput(v);
  });
  row.append(lab, sl, badge);
  return row;
}

// 색상 선택 줄
function colorRow(label, value, onInput) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = label; lab.style.width = "56px";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = value;
  picker.style.cssText = "width:34px;height:24px;padding:0;border:1px solid #555;background:none;";
  picker.addEventListener("input", () => onInput(picker.value));
  row.append(lab, picker);
  return row;
}

// 셀렉트 줄
function selectRow(label, value, options, onChange) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = label; lab.style.width = "56px";
  const sel = document.createElement("select");
  sel.style.flex = "1";
  for (const [val, text] of options) {
    const o = document.createElement("option"); o.value = val; o.textContent = text; sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  row.append(lab, sel);
  return row;
}

// 효과 섹션(체크박스 헤더 + 접이식 파라미터 영역) 생성.
//   eff: styles 안의 해당 효과 객체(직접 mutate). title: 표시명.
//   buildParams(container): 파라미터 컨트롤들을 container에 채우는 콜백.
//   onChange(): 값/체크 변경 시 미리보기 갱신 콜백.
function effectSection(eff, title, buildParams, onChange) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "border:1px solid var(--border,#3a3a3a);border-radius:4px;margin-bottom:8px;";

  const head = document.createElement("label");
  head.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;font-weight:600;";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = !!eff.enabled;
  const t = document.createElement("span");
  t.textContent = title;
  head.append(chk, t);
  wrap.appendChild(head);

  const params = document.createElement("div");
  params.style.cssText = "padding:4px 8px 8px;display:" + (eff.enabled ? "block" : "none") + ";";
  buildParams(params);
  wrap.appendChild(params);

  chk.addEventListener("change", () => {
    eff.enabled = chk.checked;
    params.style.display = chk.checked ? "block" : "none";
    onChange();
  });
  return wrap;
}

export function openLayerStyle(app) {
  const lm = app.layers;
  const layer = lm.activeLayer;
  if (!layer) { app.status("레이어가 없습니다."); return; }

  // 원본 보관(취소 복원용) + 편집용 작업본(없으면 기본값 생성)
  const original = cloneStyles(layer.styles);
  const work = layer.styles ? cloneStyles(layer.styles) : makeDefaultStyles();

  // 미리보기: 작업본을 레이어에 즉시 반영하고 재렌더
  const preview = () => {
    layer.styles = work;
    layer.thumbDirty = true;
    app.renderer.requestRender();
  };

  const body = document.createElement("div");
  body.style.cssText = "width:300px;max-height:60vh;overflow-y:auto;";

  // ── 그림자(Drop Shadow) ──
  body.appendChild(effectSection(work.dropShadow, "그림자 (Drop Shadow)", (c) => {
    c.appendChild(colorRow("색", work.dropShadow.color, (v) => { work.dropShadow.color = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.dropShadow.opacity * 100), suffix: "%" },
      (v) => { work.dropShadow.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("거리", { min: 0, max: 100, step: 1, value: work.dropShadow.distance, suffix: "px" },
      (v) => { work.dropShadow.distance = v; preview(); }));
    c.appendChild(sliderRow("각도", { min: 0, max: 360, step: 1, value: work.dropShadow.angle, suffix: "°" },
      (v) => { work.dropShadow.angle = v; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.dropShadow.blur, suffix: "px" },
      (v) => { work.dropShadow.blur = v; preview(); }));
    c.appendChild(sliderRow("스프레드", { min: 0, max: 30, step: 1, value: work.dropShadow.spread, suffix: "px" },
      (v) => { work.dropShadow.spread = v; preview(); }));
  }, preview));

  // ── 외부 광선(Outer Glow) ──
  body.appendChild(effectSection(work.outerGlow, "외부 광선 (Outer Glow)", (c) => {
    c.appendChild(colorRow("색", work.outerGlow.color, (v) => { work.outerGlow.color = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.outerGlow.opacity * 100), suffix: "%" },
      (v) => { work.outerGlow.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.outerGlow.blur, suffix: "px" },
      (v) => { work.outerGlow.blur = v; preview(); }));
    c.appendChild(sliderRow("스프레드", { min: 0, max: 30, step: 1, value: work.outerGlow.spread, suffix: "px" },
      (v) => { work.outerGlow.spread = v; preview(); }));
  }, preview));

  // ── 선(Stroke) ──
  body.appendChild(effectSection(work.stroke, "선 (Stroke)", (c) => {
    c.appendChild(sliderRow("크기", { min: 1, max: 50, step: 1, value: work.stroke.size, suffix: "px" },
      (v) => { work.stroke.size = v; preview(); }));
    c.appendChild(selectRow("위치", work.stroke.position,
      [["outside", "바깥쪽"], ["center", "중앙"], ["inside", "안쪽"]],
      (v) => { work.stroke.position = v; preview(); }));
    c.appendChild(colorRow("색", work.stroke.color, (v) => { work.stroke.color = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.stroke.opacity * 100), suffix: "%" },
      (v) => { work.stroke.opacity = v / 100; preview(); }));
  }, preview));

  // ── 색상 오버레이(Color Overlay) ──
  body.appendChild(effectSection(work.colorOverlay, "색상 오버레이 (Color Overlay)", (c) => {
    c.appendChild(colorRow("색", work.colorOverlay.color, (v) => { work.colorOverlay.color = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.colorOverlay.opacity * 100), suffix: "%" },
      (v) => { work.colorOverlay.opacity = v / 100; preview(); }));
    c.appendChild(selectRow("모드", work.colorOverlay.blendMode,
      [["normal", "표준"], ["multiply", "곱하기"], ["screen", "스크린"], ["overlay", "오버레이"],
       ["color", "색상"], ["hue", "색조"]],
      (v) => { work.colorOverlay.blendMode = v; preview(); }));
  }, preview));

  // 첫 진입 시 작업본을 즉시 반영(체크된 효과가 있으면 바로 보이게)
  preview();

  app.dialogs.custom("레이어 스타일", body, () => {
    // 확인: 활성 효과가 하나도 없으면 styles를 null로 정리(메모리/표시 깔끔)
    const finalStyles = hasAnyStyle(work) ? cloneStyles(work) : null;
    // 먼저 원본 상태로 되돌린 뒤(커맨드 redo가 다시 적용) 히스토리에 등록
    layer.styles = original;
    app.history.execute(new LayerPropCommand(lm, layer.id, "styles", original, finalStyles));
    app.status(finalStyles ? "레이어 스타일 적용" : "레이어 스타일 해제");
  }, () => {
    // 취소: 원본 복원 + 재렌더
    layer.styles = original;
    layer.thumbDirty = true;
    app.renderer.requestRender();
  }, "확인");
}
