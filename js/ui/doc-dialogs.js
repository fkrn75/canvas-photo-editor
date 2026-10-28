// doc-dialogs.js — 이미지 크기 / 캔버스 크기 / 임의 각도 회전 / 재단 / 패턴 정의 다이얼로그.
// 실제 연산은 js/ops/doc-ops.js. 스타일은 공용 .row 클래스 + 인라인(공유 style.css 비수정).

import { RESAMPLE_METHODS } from "../engine/resample.js";
import { anchorOffset } from "../engine/layer-image-ops.js";
import { resizeImage, resizeCanvas, rotateArbitrary, trimDocument, definePattern } from "../ops/doc-ops.js";

// ── 작은 DOM 헬퍼 ──
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") e.style.cssText = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function row(labelText, ...controls) {
  return el("div", { className: "row" }, el("label", { textContent: labelText }), ...controls);
}
function numInput(value, { min = null, max = null, step = "any" } = {}) {
  const i = el("input", { type: "number", value: String(value), step: String(step) });
  if (min != null) i.min = String(min);
  if (max != null) i.max = String(max);
  i.style.width = "90px";
  return i;
}
function select(options, value) {
  const s = el("select");
  for (const [v, t] of options) s.append(el("option", { value: v, textContent: t }));
  s.value = value;
  return s;
}
function checkbox(labelText, checked) {
  const c = el("input", { type: "checkbox", checked: !!checked });
  const lb = el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;" }, c, labelText);
  return { box: c, label: lb };
}
const infoLine = (text) => el("div", { textContent: text, style: "font-size:12px;opacity:.8;margin:2px 0 8px;" });
// 검증 실패: 상태바 + 다이얼로그 안 오류 표시 후 false 반환(→ dialogs 가 닫지 않고 입력 보존)
function invalid(app, ui, msg) {
  app.status(msg);
  ui?.error(msg);
  return false;
}
const fmtNum = (v) => String(Math.round(v * 100) / 100);

// ── 이미지 크기 ──
let _lastResample = "bicubic";
export function openImageSize(app) {
  const lm = app.layers, ow = lm.width, oh = lm.height;
  const unit = select([["px", "픽셀"], ["%", "퍼센트"]], "px");
  const wIn = numInput(ow, { min: 0.01 });
  const hIn = numInput(oh, { min: 0.01 });
  const keep = checkbox("비율 유지", true);
  const method = select(RESAMPLE_METHODS, _lastResample);
  const result = infoLine("");

  // 현재 입력값을 픽셀로 환산
  const toPx = () => {
    const w = parseFloat(wIn.value), h = parseFloat(hIn.value);
    if (unit.value === "%") return { w: Math.round((ow * w) / 100), h: Math.round((oh * h) / 100) };
    return { w: Math.round(w), h: Math.round(h) };
  };
  const refresh = () => {
    const { w, h } = toPx();
    result.textContent = Number.isFinite(w) && Number.isFinite(h) ? `새 크기: ${w} × ${h} px` : "크기를 입력하세요.";
  };
  // 비율 유지: 한쪽을 바꾸면 다른 쪽을 같은 비율로
  wIn.addEventListener("input", () => {
    const v = parseFloat(wIn.value);
    if (keep.box.checked && Number.isFinite(v)) hIn.value = unit.value === "%" ? fmtNum(v) : String(Math.max(1, Math.round((v * oh) / ow)));
    refresh();
  });
  hIn.addEventListener("input", () => {
    const v = parseFloat(hIn.value);
    if (keep.box.checked && Number.isFinite(v)) wIn.value = unit.value === "%" ? fmtNum(v) : String(Math.max(1, Math.round((v * ow) / oh)));
    refresh();
  });
  keep.box.addEventListener("change", () => { if (keep.box.checked) wIn.dispatchEvent(new Event("input")); });
  let prevUnit = "px";
  unit.addEventListener("change", () => {
    // 단위 전환 시 같은 크기를 새 단위로 다시 표시
    const w = parseFloat(wIn.value), h = parseFloat(hIn.value);
    if (prevUnit === "px" && unit.value === "%") { wIn.value = fmtNum((w / ow) * 100); hIn.value = fmtNum((h / oh) * 100); }
    else if (prevUnit === "%" && unit.value === "px") { wIn.value = String(Math.round((ow * w) / 100)); hIn.value = String(Math.round((oh * h) / 100)); }
    prevUnit = unit.value;
    refresh();
  });

  const body = el("div", {},
    infoLine(`현재 크기: ${ow} × ${oh} px`),
    row("단위", unit),
    row("폭", wIn),
    row("높이", hIn),
    el("div", { className: "row" }, keep.label),
    row("리샘플", method),
    result,
  );
  refresh();
  app.dialogs.custom("이미지 크기", body, (ui) => {
    const { w, h } = toPx();
    if (!(w >= 1 && h >= 1)) return invalid(app, ui, "폭과 높이는 1px 이상이어야 합니다.");
    _lastResample = method.value;
    resizeImage(app, w, h, method.value);
  }, null, "확인");
}

// ── 캔버스 크기 ──
let _lastCanvasFill = "background";
export function openCanvasSize(app) {
  const lm = app.layers, ow = lm.width, oh = lm.height;
  const unit = select([["px", "픽셀"], ["%", "퍼센트"]], "px");
  const wIn = numInput(ow);
  const hIn = numInput(oh);
  const rel = checkbox("상대값(현재 크기에 더하기)", false);
  const fill = select([["background", "배경색"], ["white", "흰색"], ["black", "검정"], ["transparent", "투명"]], _lastCanvasFill);
  const result = infoLine("");
  let anchor = 4;

  const toPx = () => {
    const a = parseFloat(wIn.value), b = parseFloat(hIn.value);
    let w, h;
    if (rel.box.checked) {
      w = unit.value === "%" ? ow + (ow * a) / 100 : ow + a;
      h = unit.value === "%" ? oh + (oh * b) / 100 : oh + b;
    } else {
      w = unit.value === "%" ? (ow * a) / 100 : a;
      h = unit.value === "%" ? (oh * b) / 100 : b;
    }
    return { w: Math.round(w), h: Math.round(h) };
  };
  // 입력 기본값을 (상대/절대, 단위) 조합에 맞게 다시 채운다
  const resetInputs = () => {
    if (rel.box.checked) { wIn.value = "0"; hIn.value = "0"; }
    else if (unit.value === "%") { wIn.value = "100"; hIn.value = "100"; }
    else { wIn.value = String(ow); hIn.value = String(oh); }
    refresh();
  };

  // 기준점 3×3 격자: 선택 칸은 채운 사각형, 확장/축소 방향을 화살표로 표시
  const grid = el("div", { style: "display:grid;grid-template-columns:repeat(3,26px);gap:2px;" });
  const cells = [];
  const ARROWS = { "-1,-1": "↖", "0,-1": "↑", "1,-1": "↗", "-1,0": "←", "1,0": "→", "-1,1": "↙", "0,1": "↓", "1,1": "↘" };
  const paintGrid = () => {
    const ax = anchor % 3, ay = Math.floor(anchor / 3);
    cells.forEach((c, i) => {
      const cx = i % 3, cy = Math.floor(i / 3);
      const ddx = cx - ax, ddy = cy - ay;
      c.textContent = i === anchor ? "■" : (Math.abs(ddx) <= 1 && Math.abs(ddy) <= 1 ? ARROWS[`${ddx},${ddy}`] || "" : "");
      c.style.fontWeight = i === anchor ? "bold" : "normal";
      c.setAttribute("aria-pressed", String(i === anchor));
    });
  };
  for (let i = 0; i < 9; i++) {
    const b = el("button", { type: "button", title: "기준점", style: "width:26px;height:26px;padding:0;line-height:1;" });
    b.addEventListener("click", (e) => { e.preventDefault(); anchor = i; paintGrid(); refresh(); });
    cells.push(b); grid.append(b);
  }
  paintGrid();

  const refresh = () => {
    const { w, h } = toPx();
    if (!(w >= 1 && h >= 1)) { result.textContent = "크기는 1px 이상이어야 합니다."; return; }
    const { dx, dy } = anchorOffset(ow, oh, w, h, anchor);
    result.textContent = `새 크기: ${w} × ${h} px (원본 위치 ${dx}, ${dy})`;
  };
  wIn.addEventListener("input", refresh);
  hIn.addEventListener("input", refresh);
  rel.box.addEventListener("change", resetInputs);
  unit.addEventListener("change", resetInputs);

  const body = el("div", {},
    infoLine(`현재 크기: ${ow} × ${oh} px`),
    row("단위", unit),
    row("폭", wIn),
    row("높이", hIn),
    el("div", { className: "row" }, rel.label),
    row("기준", grid),
    row("확장 영역 색", fill),
    infoLine("확장 영역 색은 맨 아래 픽셀 레이어에만 칠하고, 나머지 레이어는 투명으로 확장합니다."),
    result,
  );
  refresh();
  app.dialogs.custom("캔버스 크기", body, (ui) => {
    const { w, h } = toPx();
    if (!(w >= 1 && h >= 1)) return invalid(app, ui, "캔버스 크기는 1px 이상이어야 합니다.");
    _lastCanvasFill = fill.value;
    resizeCanvas(app, w, h, anchor, fill.value);
  }, null, "확인");
}

// ── 임의 각도 회전 ──
export function openRotateArbitrary(app) {
  app.dialogs.form("캔버스 회전", [
    { key: "angle", label: "각도(°)", type: "number", value: 15, min: -359.99, max: 359.99, step: 0.01 },
    { key: "dir", label: "방향", type: "select", value: "cw", options: [["cw", "시계 방향"], ["ccw", "반시계 방향"]] },
  ], (v, ui) => {
    const a = Number(v.angle);
    if (!Number.isFinite(a)) return invalid(app, ui, "각도를 입력하세요.");
    rotateArbitrary(app, v.dir === "ccw" ? -a : a);
  }, "회전");
}

// ── 재단(Trim) ──
export function openTrim(app) {
  const name = "trim-mode-" + Date.now();
  const modes = [["transparent", "투명 픽셀"], ["topLeft", "왼쪽 위 픽셀 색"], ["bottomRight", "오른쪽 아래 픽셀 색"]];
  const radios = {};
  const modeBox = el("div", { style: "display:flex;flex-direction:column;gap:4px;margin-bottom:8px;" },
    el("div", { textContent: "기준", style: "font-weight:bold;" }));
  modes.forEach(([v, t], i) => {
    const r = el("input", { type: "radio", name, value: v, checked: i === 0 });
    radios[v] = r;
    modeBox.append(el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;" }, r, t));
  });
  const sides = {
    top: checkbox("위", true), bottom: checkbox("아래", true),
    left: checkbox("왼쪽", true), right: checkbox("오른쪽", true),
  };
  const sideBox = el("div", { style: "display:grid;grid-template-columns:repeat(2,auto);gap:4px 16px;" },
    sides.top.label, sides.bottom.label, sides.left.label, sides.right.label);
  const body = el("div", {},
    modeBox,
    el("div", { textContent: "잘라낼 쪽", style: "font-weight:bold;margin-bottom:4px;" }),
    sideBox,
  );
  app.dialogs.custom("재단", body, (ui) => {
    const mode = Object.keys(radios).find((k) => radios[k].checked) || "transparent";
    const s = { top: sides.top.box.checked, bottom: sides.bottom.box.checked, left: sides.left.box.checked, right: sides.right.box.checked };
    if (!s.top && !s.bottom && !s.left && !s.right) return invalid(app, ui, "잘라낼 쪽을 하나 이상 선택하세요.");
    trimDocument(app, mode, s);
  }, null, "확인");
}

// ── 패턴 정의 ──
export function openDefinePattern(app) {
  app.dialogs.form("패턴 정의", [
    { key: "name", label: "이름", type: "text", value: `패턴 ${(app.state.patterns?.length || 0) + 1}` },
  ], (v) => definePattern(app, v.name), "확인");
}
