// channel-dialogs.js — 채널별 보정 전용 다이얼로그: 레벨(히스토그램), 커브(곡선 편집).
// 채널은 RGB(합성)·빨강·녹색·파랑·알파를 지원한다.

import * as Adjust from "../engine/adjustments.js";

const CHANNELS = [["rgb", "RGB"], ["r", "빨강"], ["g", "녹색"], ["b", "파랑"], ["a", "알파"]];
const CH_COLOR = { r: "#e74c3c", g: "#2ecc71", b: "#3498db", a: "#bbbbbb", rgb: "#eeeeee" };

function channelSelect(onChange) {
  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = "채널"; lab.style.width = "44px";
  const sel = document.createElement("select");
  CHANNELS.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
  sel.addEventListener("change", () => onChange(sel.value));
  row.append(lab, sel);
  return { row, sel };
}

// ── 레벨 ──
export function openLevels(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  let channel = "rgb";
  const def = () => ({ inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 });
  const per = { rgb: def(), r: def(), g: def(), b: def(), a: def() };
  const changed = (s) => s.inB !== 0 || s.inW !== 255 || s.gamma !== 1 || s.outB !== 0 || s.outW !== 255;
  const compute = (img) => {
    for (const ch of ["rgb", "r", "g", "b", "a"]) {
      const s = per[ch];
      if (changed(s)) Adjust.levels(img, ch, s.inB, s.inW, s.gamma, s.outB, s.outW);
    }
  };

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
    inp.addEventListener("input", () => { per[channel][key] = parseFloat(inp.value); badge.textContent = inp.value; h.apply(compute); });
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
    const s = per[channel];
    for (const k of ["inB", "gamma", "inW", "outB", "outW"]) {
      sliders[k].inp.value = s[k];
      sliders[k].badge.textContent = s[k];
    }
  }
  function drawHist() {
    const ctx = hist.getContext("2d");
    ctx.clearRect(0, 0, 256, 90);
    const hh = Adjust.histogram(h.original, channel === "rgb" ? "l" : channel);
    let max = 0;
    for (let i = 0; i < 256; i++) if (hh[i] > max) max = hh[i];
    const scale = max > 0 ? 86 / Math.log(max + 1) : 0;
    ctx.fillStyle = CH_COLOR[channel];
    for (let i = 0; i < 256; i++) { const v = Math.log(hh[i] + 1) * scale; ctx.fillRect(i, 90 - v, 1, v); }
  }

  app.dialogs.custom("레벨", body, () => h.commit(compute, "레벨"), () => h.cancel(), "적용");
  syncSliders();
  drawHist();
}

// ── 커브 ──
export function openCurves(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  let channel = "rgb";
  const def = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  const per = { rgb: def(), r: def(), g: def(), b: def(), a: def() };
  const isIdentity = (p) => p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255;
  const compute = (img) => {
    for (const ch of ["rgb", "r", "g", "b", "a"]) {
      if (!isIdentity(per[ch])) Adjust.applyChannelLUT(img, ch, Adjust.buildCurveLUT(per[ch]));
    }
  };

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
    ctx.strokeStyle = "#3a3a3a"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const g = i * SIZE / 4;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, SIZE); ctx.moveTo(0, g); ctx.lineTo(SIZE, g); ctx.stroke();
    }
    ctx.strokeStyle = "#555"; ctx.beginPath(); ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0); ctx.stroke();
    const lut = Adjust.buildCurveLUT(per[channel]);
    ctx.strokeStyle = CH_COLOR[channel]; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = SIZE - 1 - lut[x]; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const p of per[channel]) { const c = toCv(p); ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }

  const evtPt = (e) => {
    const r = cv.getBoundingClientRect();
    let x = Math.round((e.clientX - r.left) * SIZE / r.width);
    let y = Math.round(SIZE - 1 - (e.clientY - r.top) * SIZE / r.height);
    return { x: Math.max(0, Math.min(255, x)), y: Math.max(0, Math.min(255, y)) };
  };
  const findNear = (pt) => per[channel].findIndex((p) => Math.abs(p.x - pt.x) < 10 && Math.abs(p.y - pt.y) < 10);

  let drag = -1;
  cv.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    cv.setPointerCapture(e.pointerId);
    const pt = evtPt(e), arr = per[channel];
    let idx = findNear(pt);
    if (idx < 0) { arr.push(pt); arr.sort((a, b) => a.x - b.x); idx = arr.indexOf(pt); }
    drag = idx; draw(); h.apply(compute);
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const pt = evtPt(e), arr = per[channel];
    if (drag === 0) pt.x = 0;
    else if (drag === arr.length - 1) pt.x = 255;
    else pt.x = Math.max(arr[drag - 1].x + 1, Math.min(arr[drag + 1].x - 1, pt.x));
    arr[drag] = pt; draw(); h.apply(compute);
  });
  cv.addEventListener("pointerup", () => { drag = -1; });
  cv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const pt = evtPt(e), arr = per[channel], idx = findNear(pt);
    if (idx > 0 && idx < arr.length - 1) { arr.splice(idx, 1); draw(); h.apply(compute); }
  });

  app.dialogs.custom("커브", body, () => h.commit(compute, "커브"), () => h.cancel(), "적용");
  draw();
}
