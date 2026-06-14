// layer-style-dialog.js — 레이어 스타일(Layer Styles) 편집 모달.
// 활성 레이어의 styles를 효과별 체크박스 + 파라미터로 편집한다(10종).
//   · 그림자/내부 그림자 · 외부/내부 광선 · 경사와 엠보스 · 새틴
//   · 색상/그라디언트/패턴 오버레이 · 선
// 실시간 미리보기: 편집 중에는 layer.styles를 임시로 바꿔 renderer로 즉시 반영한다.
//   - 확인: LayerPropCommand("styles")로 히스토리 1스텝 등록(undo/redo 지원).
//   - 취소: 원래 styles로 되돌리고 재렌더.
// dialogs.custom(title, bodyEl, onOk, onCancel) 패턴을 따른다(stroke-dialog.js 참고).

import { makeDefaultStyles, hasAnyStyle, cloneStyles } from "../layers/layer-styles.js";
import { listPatterns, patternPreview } from "../styles/patterns.js";
import { LayerPropCommand } from "../history/commands/layer-structure-command.js";

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

// 블렌드 모드 셀렉트 줄(레이어 스타일에서 안전한 네이티브 모드 위주).
function blendRow(value, onChange) {
  return selectRow("모드", value || "normal",
    [["normal", "표준"], ["multiply", "곱하기"], ["screen", "스크린"], ["overlay", "오버레이"],
     ["darken", "어둡게"], ["lighten", "밝게"], ["soft-light", "소프트 라이트"], ["hard-light", "하드 라이트"],
     ["color-dodge", "색상 닷지"], ["color-burn", "색상 번"], ["difference", "차이"],
     ["color", "색상"], ["hue", "색조"], ["luminosity", "광도"]],
    onChange);
}

// 체크박스 줄(불리언 토글). 예: 새틴 반전.
function checkRow(label, value, onChange) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = label; lab.style.width = "56px";
  const chk = document.createElement("input");
  chk.type = "checkbox"; chk.checked = !!value;
  chk.addEventListener("change", () => onChange(chk.checked));
  row.append(lab, chk);
  return row;
}

// 그라디언트 색상 스톱 편집 줄: 색 피커들 + 추가/삭제 버튼.
// colors 배열(직접 mutate)을 편집하고, 변경 시 onChange() 호출(미리보기 갱신).
function gradientStopsRow(colors, onChange) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  const lab = document.createElement("label");
  lab.textContent = "색상"; lab.style.width = "56px";
  row.appendChild(lab);

  const rebuild = () => {
    // 라벨만 남기고 피커/버튼 재구성
    while (row.children.length > 1) row.removeChild(row.lastChild);
    colors.forEach((c, i) => {
      const pk = document.createElement("input");
      pk.type = "color"; pk.value = c;
      pk.style.cssText = "width:28px;height:22px;padding:0;border:1px solid #555;background:none;";
      pk.title = `스톱 ${i + 1} (우클릭=삭제)`;
      pk.addEventListener("input", () => { colors[i] = pk.value; onChange(); });
      // 우클릭으로 해당 스톱 삭제(최소 2개 유지)
      pk.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (colors.length > 2) { colors.splice(i, 1); rebuild(); onChange(); }
      });
      row.appendChild(pk);
    });
    const add = document.createElement("button");
    add.textContent = "＋"; add.title = "스톱 추가";
    add.style.cssText = "width:22px;height:22px;padding:0;";
    add.addEventListener("click", (e) => {
      e.preventDefault();
      colors.push(colors[colors.length - 1] || "#ffffff");
      rebuild(); onChange();
    });
    row.appendChild(add);
  };
  rebuild();
  return row;
}

// 패턴 선택 그리드 줄: 패턴 미리보기 셀들 중 하나 선택.
// 미리보기는 캔버스를 셀에 직접 append(데이터 URL 미사용 → CSP img-src 영향 없음).
function patternPickerRow(value, onChange) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  const lab = document.createElement("label");
  lab.textContent = "패턴"; lab.style.width = "56px";
  row.appendChild(lab);
  const cells = [];
  const setSel = (sel) => cells.forEach((b) => b.style.outline = (b === sel ? "2px solid #4af" : "none"));
  for (const { id, label } of listPatterns()) {
    const cell = document.createElement("button");
    cell.title = label;
    cell.style.cssText = "width:28px;height:28px;padding:1px;border:1px solid #555;background:#888;cursor:pointer;overflow:hidden;";
    const cv = patternPreview(id, 24);
    cv.style.cssText = "width:24px;height:24px;display:block;pointer-events:none;";
    cell.appendChild(cv);
    cell.addEventListener("click", (e) => { e.preventDefault(); onChange(id); setSel(cell); });
    cells.push(cell);
    if (id === value) cell.style.outline = "2px solid #4af";
    row.appendChild(cell);
  }
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

  // ── 내부 그림자(Inner Shadow) ──
  body.appendChild(effectSection(work.innerShadow, "내부 그림자 (Inner Shadow)", (c) => {
    c.appendChild(colorRow("색", work.innerShadow.color, (v) => { work.innerShadow.color = v; preview(); }));
    c.appendChild(blendRow(work.innerShadow.blendMode, (v) => { work.innerShadow.blendMode = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.innerShadow.opacity * 100), suffix: "%" },
      (v) => { work.innerShadow.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("거리", { min: 0, max: 100, step: 1, value: work.innerShadow.distance, suffix: "px" },
      (v) => { work.innerShadow.distance = v; preview(); }));
    c.appendChild(sliderRow("각도", { min: 0, max: 360, step: 1, value: work.innerShadow.angle, suffix: "°" },
      (v) => { work.innerShadow.angle = v; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.innerShadow.blur, suffix: "px" },
      (v) => { work.innerShadow.blur = v; preview(); }));
    c.appendChild(sliderRow("초크", { min: 0, max: 30, step: 1, value: work.innerShadow.spread, suffix: "px" },
      (v) => { work.innerShadow.spread = v; preview(); }));
  }, preview));

  // ── 외부 광선(Outer Glow) ──
  body.appendChild(effectSection(work.outerGlow, "외부 광선 (Outer Glow)", (c) => {
    c.appendChild(colorRow("색", work.outerGlow.color, (v) => { work.outerGlow.color = v; preview(); }));
    c.appendChild(blendRow(work.outerGlow.blendMode, (v) => { work.outerGlow.blendMode = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.outerGlow.opacity * 100), suffix: "%" },
      (v) => { work.outerGlow.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.outerGlow.blur, suffix: "px" },
      (v) => { work.outerGlow.blur = v; preview(); }));
    c.appendChild(sliderRow("스프레드", { min: 0, max: 30, step: 1, value: work.outerGlow.spread, suffix: "px" },
      (v) => { work.outerGlow.spread = v; preview(); }));
  }, preview));

  // ── 내부 광선(Inner Glow) ──
  body.appendChild(effectSection(work.innerGlow, "내부 광선 (Inner Glow)", (c) => {
    c.appendChild(colorRow("색", work.innerGlow.color, (v) => { work.innerGlow.color = v; preview(); }));
    c.appendChild(blendRow(work.innerGlow.blendMode, (v) => { work.innerGlow.blendMode = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.innerGlow.opacity * 100), suffix: "%" },
      (v) => { work.innerGlow.opacity = v / 100; preview(); }));
    c.appendChild(selectRow("소스", work.innerGlow.source,
      [["edge", "가장자리"], ["center", "중앙"]],
      (v) => { work.innerGlow.source = v; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.innerGlow.blur, suffix: "px" },
      (v) => { work.innerGlow.blur = v; preview(); }));
    c.appendChild(sliderRow("초크", { min: 0, max: 30, step: 1, value: work.innerGlow.spread, suffix: "px" },
      (v) => { work.innerGlow.spread = v; preview(); }));
  }, preview));

  // ── 경사와 엠보스(Bevel/Emboss) ──
  body.appendChild(effectSection(work.bevel, "경사와 엠보스 (Bevel/Emboss)", (c) => {
    c.appendChild(selectRow("스타일", work.bevel.style,
      [["inner", "내부 경사"], ["outer", "외부 경사"], ["emboss", "엠보스"]],
      (v) => { work.bevel.style = v; preview(); }));
    c.appendChild(sliderRow("크기", { min: 1, max: 50, step: 1, value: work.bevel.size, suffix: "px" },
      (v) => { work.bevel.size = v; preview(); }));
    c.appendChild(sliderRow("깊이", { min: 1, max: 1000, step: 1, value: work.bevel.depth, suffix: "%" },
      (v) => { work.bevel.depth = v; preview(); }));
    c.appendChild(sliderRow("각도", { min: 0, max: 360, step: 1, value: work.bevel.angle, suffix: "°" },
      (v) => { work.bevel.angle = v; preview(); }));
    c.appendChild(sliderRow("고도", { min: 0, max: 90, step: 1, value: work.bevel.altitude, suffix: "°" },
      (v) => { work.bevel.altitude = v; preview(); }));
    c.appendChild(colorRow("하이라이트", work.bevel.highlight, (v) => { work.bevel.highlight = v; preview(); }));
    c.appendChild(sliderRow("HL 불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.bevel.highlightOpacity * 100), suffix: "%" },
      (v) => { work.bevel.highlightOpacity = v / 100; preview(); }));
    c.appendChild(colorRow("섀도", work.bevel.shadow, (v) => { work.bevel.shadow = v; preview(); }));
    c.appendChild(sliderRow("SH 불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.bevel.shadowOpacity * 100), suffix: "%" },
      (v) => { work.bevel.shadowOpacity = v / 100; preview(); }));
  }, preview));

  // ── 새틴(Satin) ──
  body.appendChild(effectSection(work.satin, "새틴 (Satin)", (c) => {
    c.appendChild(colorRow("색", work.satin.color, (v) => { work.satin.color = v; preview(); }));
    c.appendChild(blendRow(work.satin.blendMode, (v) => { work.satin.blendMode = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.satin.opacity * 100), suffix: "%" },
      (v) => { work.satin.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("각도", { min: 0, max: 360, step: 1, value: work.satin.angle, suffix: "°" },
      (v) => { work.satin.angle = v; preview(); }));
    c.appendChild(sliderRow("거리", { min: 0, max: 100, step: 1, value: work.satin.distance, suffix: "px" },
      (v) => { work.satin.distance = v; preview(); }));
    c.appendChild(sliderRow("크기(블러)", { min: 0, max: 100, step: 1, value: work.satin.blur, suffix: "px" },
      (v) => { work.satin.blur = v; preview(); }));
    c.appendChild(checkRow("반전", work.satin.invert, (v) => { work.satin.invert = v; preview(); }));
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
    c.appendChild(blendRow(work.colorOverlay.blendMode, (v) => { work.colorOverlay.blendMode = v; preview(); }));
  }, preview));

  // ── 그라디언트 오버레이(Gradient Overlay) ──
  body.appendChild(effectSection(work.gradientOverlay, "그라디언트 오버레이 (Gradient Overlay)", (c) => {
    c.appendChild(gradientStopsRow(work.gradientOverlay.colors, preview));
    c.appendChild(selectRow("스타일", work.gradientOverlay.style,
      [["linear", "선형"], ["radial", "원형"]],
      (v) => { work.gradientOverlay.style = v; preview(); }));
    c.appendChild(checkRow("반전", work.gradientOverlay.reverse, (v) => { work.gradientOverlay.reverse = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.gradientOverlay.opacity * 100), suffix: "%" },
      (v) => { work.gradientOverlay.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("각도", { min: 0, max: 360, step: 1, value: work.gradientOverlay.angle, suffix: "°" },
      (v) => { work.gradientOverlay.angle = v; preview(); }));
    c.appendChild(sliderRow("비율", { min: 10, max: 300, step: 1, value: work.gradientOverlay.scale, suffix: "%" },
      (v) => { work.gradientOverlay.scale = v; preview(); }));
    c.appendChild(blendRow(work.gradientOverlay.blendMode, (v) => { work.gradientOverlay.blendMode = v; preview(); }));
  }, preview));

  // ── 패턴 오버레이(Pattern Overlay) ──
  body.appendChild(effectSection(work.patternOverlay, "패턴 오버레이 (Pattern Overlay)", (c) => {
    c.appendChild(patternPickerRow(work.patternOverlay.patternId, (v) => { work.patternOverlay.patternId = v; preview(); }));
    c.appendChild(sliderRow("불투명도", { min: 0, max: 100, step: 1, value: Math.round(work.patternOverlay.opacity * 100), suffix: "%" },
      (v) => { work.patternOverlay.opacity = v / 100; preview(); }));
    c.appendChild(sliderRow("비율", { min: 25, max: 400, step: 1, value: work.patternOverlay.scale, suffix: "%" },
      (v) => { work.patternOverlay.scale = v; preview(); }));
    c.appendChild(blendRow(work.patternOverlay.blendMode, (v) => { work.patternOverlay.blendMode = v; preview(); }));
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
