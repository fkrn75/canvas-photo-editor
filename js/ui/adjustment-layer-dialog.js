// adjustment-layer-dialog.js — 조정 레이어 파라미터 편집 다이얼로그.
//
// 조정 레이어는 비파괴이므로 픽셀을 직접 건드리지 않는다. 대신 layer.adjustmentParams 를
// 실시간으로 바꿔 재렌더(미리보기)하고, 확인 시 AdjustmentParamsCommand 로 undo 등록한다.
// 취소 시 진입 당시 파라미터로 되돌린다.
//
// 타입별 UI:
//   - editor==="levels" : 채널별(rgb/r/g/b/a) 히스토그램 + 입력/출력 레벨 슬라이더 (전용 에디터)
//   - editor==="curves" : 채널별 Catmull-Rom 곡선 편집 (전용 에디터)
//   - 그 외             : ADJUSTMENT_TYPES.sliders 로 슬라이더를 자동 생성(타입 추가에 무수정 대응)
//
// 히스토그램 소스는 "이 조정 레이어 아래까지 합성된 결과"를 사용한다(포토샵과 동일한 맥락).

import {
  adjustmentSliders, adjustmentLabel, adjustmentEditor,
  normalizeLevelsParams, normalizeCurvesParams, LEVELS_CHANNELS, cloneParams,
} from "../layers/adjustment-layer.js";
import * as Adjust from "../engine/adjustments.js";
import { AdjustmentParamsCommand } from "../history/commands/adjustment-command.js";

const CH_LABEL = { rgb: "RGB", r: "빨강", g: "녹색", b: "파랑", a: "알파" };
const CH_COLOR = { r: "#e74c3c", g: "#2ecc71", b: "#3498db", a: "#bbbbbb", rgb: "#eeeeee" };

// app, 조정 레이어 id 를 받아 편집 다이얼로그를 연다.
export function openAdjustmentLayerDialog(app, id) {
  const layer = app.layers.byId(id);
  if (!layer || layer.type !== "adjustment") return;

  const editor = adjustmentEditor(layer.adjustmentType);
  if (editor === "levels") return openLevelsLayerEditor(app, id, layer);
  if (editor === "curves") return openCurvesLayerEditor(app, id, layer);
  return openSliderEditor(app, id, layer);
}

// ── 공통: 비파괴 미리보기/커밋 헬퍼 ──────────────────────────────────────────
// before(진입 시 파라미터 사본)와, 현재 cur 을 layer 에 반영해 재렌더하는 클로저를 만든다.
function makePreview(app, id, layer) {
  const before = cloneParams(layer.adjustmentParams);
  return {
    before,
    // 작업 중 파라미터를 레이어에 꽂고 즉시 재렌더(비파괴 미리보기)
    preview(cur) {
      layer.adjustmentParams = cloneParams(cur);
      app.renderer.requestRender();
    },
    // 확인: 변경이 있으면 undo 커맨드로 등록(현재 화면은 이미 cur 반영됨)
    commit(cur) {
      if (JSON.stringify(before) === JSON.stringify(cur)) return;
      app.history.execute(new AdjustmentParamsCommand(app.layers, id, before, cur));
    },
    // 취소: 진입 당시 파라미터로 원복 + 재렌더
    cancel() {
      layer.adjustmentParams = cloneParams(before);
      app.renderer.requestRender();
    },
  };
}

// 이 조정 레이어 "아래까지 합성된" ImageData 를 만든다(히스토그램 소스).
// 실패하거나 아래에 아무것도 없으면 null.
function compositeBelow(app, id) {
  const lm = app.layers;
  const idx = lm.indexOf(id);
  if (idx <= 0) return null;                 // 맨 아래 조정 레이어면 아래가 없음
  const below = lm.layers.slice(0, idx);
  if (below.length === 0) return null;
  try {
    const c = document.createElement("canvas");
    c.width = lm.width; c.height = lm.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    lm._composeLayers(below, g);             // 아래 레이어들만 합성(조정 레이어 자신 제외)
    return g.getImageData(0, 0, lm.width, lm.height);
  } catch (_) {
    return null;
  }
}

// 채널 선택 드롭다운(rgb/r/g/b/a 공용)
function channelSelect(onChange) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = "채널"; lab.style.width = "44px";
  const sel = document.createElement("select");
  for (const ch of LEVELS_CHANNELS) {
    const o = document.createElement("option"); o.value = ch; o.textContent = CH_LABEL[ch]; sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  row.append(lab, sel);
  return { row, sel };
}

// ── 슬라이더형(밝기/대비·색조/채도·포스터화·한계값 등) ──────────────────────
function openSliderEditor(app, id, layer) {
  const sliders = adjustmentSliders(layer.adjustmentType);
  if (!sliders.length) {
    app.status(`${adjustmentLabel(layer.adjustmentType)} 보정은 편집할 설정이 없습니다.`);
    return;
  }
  const pv = makePreview(app, id, layer);
  const cur = { ...pv.before };

  const body = document.createElement("div");
  body.style.width = "300px";
  for (const s of sliders) {
    const row = document.createElement("div");
    row.className = "row";
    const lb = document.createElement("label");
    lb.textContent = s.label; lb.style.width = "70px";
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = s.step;
    inp.value = cur[s.key] ?? s.min; inp.style.flex = "1";
    const badge = document.createElement("span");
    badge.className = "val-badge";
    const fmt = (v) => v + (s.suffix || "");
    badge.textContent = fmt(inp.value);
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      cur[s.key] = v; badge.textContent = fmt(v);
      pv.preview(cur);
    });
    row.append(lb, inp, badge);
    body.appendChild(row);
  }
  app.dialogs.custom(adjustmentLabel(layer.adjustmentType), body,
    () => pv.commit(cur), () => pv.cancel(), "적용");
}

// ── 레벨 에디터(채널별 히스토그램 + 입출력 레벨) ─────────────────────────────
function openLevelsLayerEditor(app, id, layer) {
  const pv = makePreview(app, id, layer);
  const cur = normalizeLevelsParams(pv.before); // { rgb:{...}, r:{...}, ... }
  let channel = "rgb";

  // 히스토그램 소스(아래 합성 결과). 없으면 히스토그램을 비워 둔다.
  const srcImg = compositeBelow(app, id);

  const apply = () => pv.preview(cur);

  const body = document.createElement("div");
  body.style.width = "300px";

  const cs = channelSelect((v) => { channel = v; syncSliders(); drawHist(); });
  body.appendChild(cs.row);

  const hist = document.createElement("canvas");
  hist.width = 256; hist.height = 90;
  hist.style.cssText = "width:100%;height:90px;background:#1c1c1c;border:1px solid #555;margin:8px 0 4px;";
  body.appendChild(hist);

  const sliders = {};
  const mk = (label, key, min, max, step) => {
    const row = document.createElement("div"); row.className = "row";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.width = "44px";
    const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.style.flex = "1";
    const badge = document.createElement("span"); badge.className = "val-badge";
    inp.addEventListener("input", () => { cur[channel][key] = parseFloat(inp.value); badge.textContent = inp.value; apply(); });
    row.append(lb, inp, badge);
    body.appendChild(row);
    sliders[key] = { inp, badge };
  };
  const cap = (t) => { const d = document.createElement("div"); d.textContent = t; d.style.cssText = "color:var(--text-dim);font-size:11px;margin-top:6px;"; body.appendChild(d); };
  cap("입력 레벨");
  mk("검정", "inB", 0, 254, 1);
  mk("감마", "gamma", 0.1, 9.9, 0.01);
  mk("흰색", "inW", 1, 255, 1);
  cap("출력 레벨");
  mk("검정", "outB", 0, 255, 1);
  mk("흰색", "outW", 0, 255, 1);

  function syncSliders() {
    const s = cur[channel];
    for (const k of ["inB", "gamma", "inW", "outB", "outW"]) {
      sliders[k].inp.value = s[k];
      sliders[k].badge.textContent = s[k];
    }
  }
  function drawHist() {
    const ctx = hist.getContext("2d");
    ctx.clearRect(0, 0, 256, 90);
    if (!srcImg) return;
    const hh = Adjust.histogram(srcImg, channel === "rgb" ? "l" : channel);
    let max = 0;
    for (let i = 0; i < 256; i++) if (hh[i] > max) max = hh[i];
    const scale = max > 0 ? 86 / Math.log(max + 1) : 0;
    ctx.fillStyle = CH_COLOR[channel];
    for (let i = 0; i < 256; i++) { const v = Math.log(hh[i] + 1) * scale; ctx.fillRect(i, 90 - v, 1, v); }
  }

  app.dialogs.custom("레벨", body, () => pv.commit(cur), () => pv.cancel(), "적용");
  syncSliders();
  drawHist();
}

// ── 커브 에디터(채널별 Catmull-Rom 곡선) ─────────────────────────────────────
function openCurvesLayerEditor(app, id, layer) {
  const pv = makePreview(app, id, layer);
  const cur = normalizeCurvesParams(pv.before); // { rgb:[{x,y}...], r:[...], ... }
  let channel = "rgb";

  // 곡선 배경 히스토그램용 소스(아래 합성). 없으면 격자만 표시.
  const srcImg = compositeBelow(app, id);
  const apply = () => pv.preview(cur);

  const body = document.createElement("div");
  body.style.width = "280px";
  const cs = channelSelect((v) => { channel = v; draw(); });
  body.appendChild(cs.row);

  const SIZE = 256;
  const cv = document.createElement("canvas");
  cv.width = SIZE; cv.height = SIZE;
  cv.style.cssText = "width:256px;height:256px;background:#1c1c1c;border:1px solid #555;margin:8px auto 2px;display:block;cursor:crosshair;touch-action:none;";
  body.appendChild(cv);
  const hint = document.createElement("div");
  hint.textContent = "클릭=점 추가 · 드래그=이동 · 우클릭=삭제";
  hint.style.cssText = "color:var(--text-dim);font-size:11px;text-align:center;";
  body.appendChild(hint);

  const toCv = (p) => ({ x: p.x, y: SIZE - 1 - p.y });
  function draw() {
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    // 배경 히스토그램(연하게)
    if (srcImg) {
      const hh = Adjust.histogram(srcImg, channel === "rgb" ? "l" : channel);
      let max = 0;
      for (let i = 0; i < 256; i++) if (hh[i] > max) max = hh[i];
      const scale = max > 0 ? (SIZE - 4) / Math.log(max + 1) : 0;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (let i = 0; i < 256; i++) { const v = Math.log(hh[i] + 1) * scale; ctx.fillRect(i, SIZE - v, 1, v); }
    }
    // 격자 + 대각선
    ctx.strokeStyle = "#3a3a3a"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const g = i * SIZE / 4;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, SIZE); ctx.moveTo(0, g); ctx.lineTo(SIZE, g); ctx.stroke();
    }
    ctx.strokeStyle = "#555"; ctx.beginPath(); ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0); ctx.stroke();
    // 곡선
    const lut = Adjust.buildCurveLUT(cur[channel]);
    ctx.strokeStyle = CH_COLOR[channel]; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = SIZE - 1 - lut[x]; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    // 제어점
    ctx.fillStyle = "#fff";
    for (const p of cur[channel]) { const c = toCv(p); ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }

  const evtPt = (e) => {
    const r = cv.getBoundingClientRect();
    let x = Math.round((e.clientX - r.left) * SIZE / r.width);
    let y = Math.round(SIZE - 1 - (e.clientY - r.top) * SIZE / r.height);
    return { x: Math.max(0, Math.min(255, x)), y: Math.max(0, Math.min(255, y)) };
  };
  const findNear = (pt) => cur[channel].findIndex((p) => Math.abs(p.x - pt.x) < 10 && Math.abs(p.y - pt.y) < 10);

  let drag = -1;
  cv.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    cv.setPointerCapture(e.pointerId);
    const pt = evtPt(e), arr = cur[channel];
    let idx = findNear(pt);
    if (idx < 0) { arr.push(pt); arr.sort((a, b) => a.x - b.x); idx = arr.indexOf(pt); }
    drag = idx; draw(); apply();
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const pt = evtPt(e), arr = cur[channel];
    if (drag === 0) pt.x = 0;
    else if (drag === arr.length - 1) pt.x = 255;
    else pt.x = Math.max(arr[drag - 1].x + 1, Math.min(arr[drag + 1].x - 1, pt.x));
    arr[drag] = pt; draw(); apply();
  });
  cv.addEventListener("pointerup", () => { drag = -1; });
  cv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const pt = evtPt(e), arr = cur[channel], idx = findNear(pt);
    if (idx > 0 && idx < arr.length - 1) { arr.splice(idx, 1); draw(); apply(); }
  });

  app.dialogs.custom("커브", body, () => pv.commit(cur), () => pv.cancel(), "적용");
  draw();
}
