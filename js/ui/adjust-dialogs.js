// adjust-dialogs.js — 색상/톤 보정 다이얼로그 모음:
//   색상 균형(Color Balance) · 한계값(Threshold) · 포스터화(Posterize)
//   · 그라디언트 맵(Gradient Map) · 채널 혼합(Channel Mixer).
// 모두 channel-dialogs.js 패턴을 따른다: app._startPreview()로 실시간 미리보기,
// 확인 시 commit(undo 1스텝), 취소 시 원복.
// (균일화 Equalize는 슬라이더가 없어 다이얼로그가 불필요 → app.applyFilter로 직접 호출)

import * as Adjust from "../engine/adjustments.js";
import { rgbToHex, hexToRgb } from "../engine/color.js";

// 공통: 라벨+슬라이더+값뱃지 한 줄을 만들고 body에 추가한다.
// onInput(value)는 input 이벤트마다 호출. 반환된 객체로 값 동기화 가능.
function makeSlider(body, label, min, max, step, value, onInput, suffix = "") {
  const row = document.createElement("div"); row.className = "row";
  const lb = document.createElement("label"); lb.textContent = label; lb.style.width = "70px";
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value; inp.style.flex = "1";
  const badge = document.createElement("span"); badge.className = "val-badge";
  badge.textContent = value + suffix;
  inp.addEventListener("input", () => {
    const v = parseFloat(inp.value);
    badge.textContent = v + suffix;
    onInput(v);
  });
  row.append(lb, inp, badge);
  body.appendChild(row);
  return { inp, badge, set(v) { inp.value = v; badge.textContent = v + suffix; } };
}

// 공통: 소제목 캡션
function caption(body, text) {
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText = "color:var(--text-dim);font-size:11px;margin:8px 0 2px;";
  body.appendChild(d);
}

// ── 색상 균형 (Color Balance) ──
export function openColorBalance(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  // 톤 영역별 [CR, MG, YB]
  const tones = { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] };
  let preserve = true;
  const compute = (img) => Adjust.colorBalance(img, tones.shadows, tones.midtones, tones.highlights, preserve);

  const body = document.createElement("div");
  body.style.width = "320px";

  // 톤 영역 선택(라디오 대신 셀렉트)
  let region = "midtones";
  const selRow = document.createElement("div"); selRow.className = "row";
  const selLab = document.createElement("label"); selLab.textContent = "톤 균형"; selLab.style.width = "70px";
  const sel = document.createElement("select");
  [["shadows", "그림자"], ["midtones", "중간 영역"], ["highlights", "하이라이트"]].forEach(([v, t]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o);
  });
  sel.value = region;
  sel.addEventListener("change", () => { region = sel.value; syncSliders(); });
  selRow.append(selLab, sel);
  body.appendChild(selRow);

  // 3개 색축 슬라이더(시안-빨강 / 마젠타-녹색 / 노랑-파랑)
  const axes = [["시안 ↔ 빨강", 0], ["마젠타 ↔ 녹색", 1], ["노랑 ↔ 파랑", 2]];
  const sliders = [];
  axes.forEach(([label, idx]) => {
    const s = makeSlider(body, label, -100, 100, 1, 0, (v) => { tones[region][idx] = v; h.apply(compute); });
    sliders.push(s);
  });

  // 광도 보존 체크박스
  const lumRow = document.createElement("div"); lumRow.className = "row";
  const lumLab = document.createElement("label"); lumLab.textContent = "광도 보존"; lumLab.style.width = "70px";
  const lumChk = document.createElement("input"); lumChk.type = "checkbox"; lumChk.checked = preserve;
  lumChk.addEventListener("change", () => { preserve = lumChk.checked; h.apply(compute); });
  lumRow.append(lumLab, lumChk);
  body.appendChild(lumRow);

  function syncSliders() {
    const arr = tones[region];
    sliders.forEach((s, i) => s.set(arr[i]));
  }

  app.dialogs.custom("색상 균형", body, () => h.commit(compute, "색상 균형"), () => h.cancel(), "적용");
  syncSliders();
}

// ── 한계값 (Threshold) ──
export function openThreshold(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  let level = 128;
  const compute = (img) => Adjust.threshold(img, level);

  const body = document.createElement("div");
  body.style.width = "300px";

  // 휘도 히스토그램(원본 기준)
  const hist = document.createElement("canvas");
  hist.width = 256; hist.height = 90;
  hist.style.cssText = "width:100%;height:90px;background:#1c1c1c;border:1px solid #555;margin:0 0 4px;";
  body.appendChild(hist);

  const slider = makeSlider(body, "한계값", 1, 255, 1, level, (v) => { level = v; drawHist(); h.apply(compute); });

  function drawHist() {
    const ctx = hist.getContext("2d");
    ctx.clearRect(0, 0, 256, 90);
    const hh = Adjust.histogram(h.original, "l");
    let max = 0;
    for (let i = 0; i < 256; i++) if (hh[i] > max) max = hh[i];
    const scale = max > 0 ? 86 / Math.log(max + 1) : 0;
    ctx.fillStyle = "#bbbbbb";
    for (let i = 0; i < 256; i++) { const v = Math.log(hh[i] + 1) * scale; ctx.fillRect(i, 90 - v, 1, v); }
    // 한계값 위치 표시선
    ctx.strokeStyle = "#e74c3c"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(level, 0); ctx.lineTo(level, 90); ctx.stroke();
  }

  app.dialogs.custom("한계값", body, () => h.commit(compute, "한계값"), () => h.cancel(), "적용");
  drawHist();
  h.apply(compute); // 초기 미리보기
}

// ── 포스터화 (Posterize) ──
export function openPosterize(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  let levels = 4;
  const compute = (img) => Adjust.posterize(img, levels);

  const body = document.createElement("div");
  body.style.width = "280px";
  makeSlider(body, "레벨", 2, 255, 1, levels, (v) => { levels = v; h.apply(compute); });

  app.dialogs.custom("포스터화", body, () => h.commit(compute, "포스터화"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}

// ── 그라디언트 맵 (Gradient Map) ──
export function openGradientMap(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  // 기본: 전경→배경. (없으면 흑→백) 두 끝점 색을 사용자에게 노출.
  const fg = app.state?.foreground || "#000000";
  const bg = app.state?.background || "#ffffff";
  let colA = fg, colB = bg;
  let reverse = false;
  const buildLUT = () => Adjust.gradientLUTFromColors(reverse ? colB : colA, reverse ? colA : colB);
  const compute = (img) => Adjust.gradientMap(img, buildLUT());

  const body = document.createElement("div");
  body.style.width = "300px";

  // 그라디언트 미리보기 막대
  const bar = document.createElement("canvas");
  bar.width = 256; bar.height = 20;
  bar.style.cssText = "width:100%;height:20px;border:1px solid #555;margin:0 0 8px;display:block;";
  function drawBar() {
    const ctx = bar.getContext("2d");
    const lut = buildLUT();
    for (let i = 0; i < 256; i++) {
      ctx.fillStyle = rgbToHex(lut.r[i], lut.g[i], lut.b[i]);
      ctx.fillRect(i, 0, 1, 20);
    }
  }
  body.appendChild(bar);

  // 두 끝점 색상 선택(검정 끝 / 흰색 끝)
  const mkColor = (label, val, onChange) => {
    const row = document.createElement("div"); row.className = "row";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.width = "90px";
    const inp = document.createElement("input"); inp.type = "color"; inp.value = val;
    inp.addEventListener("input", () => { onChange(inp.value); drawBar(); h.apply(compute); });
    row.append(lb, inp);
    body.appendChild(row);
    return inp;
  };
  mkColor("어두운 쪽", colA, (v) => colA = v);
  mkColor("밝은 쪽", colB, (v) => colB = v);

  // 반전 체크박스
  const revRow = document.createElement("div"); revRow.className = "row";
  const revLab = document.createElement("label"); revLab.textContent = "반전"; revLab.style.width = "90px";
  const revChk = document.createElement("input"); revChk.type = "checkbox";
  revChk.addEventListener("change", () => { reverse = revChk.checked; drawBar(); h.apply(compute); });
  revRow.append(revLab, revChk);
  body.appendChild(revRow);

  app.dialogs.custom("그라디언트 맵", body, () => h.commit(compute, "그라디언트 맵"), () => h.cancel(), "적용");
  drawBar();
  h.apply(compute); // 초기 미리보기
}

// ── 채널 혼합 (Channel Mixer) ──
export function openChannelMixer(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  // mix = { r:[rr,rg,rb,const], g:[...], b:[...] } — 엔진 channelMixer 규약
  const mix = {
    r: [1, 0, 0, 0],
    g: [0, 1, 0, 0],
    b: [0, 0, 1, 0],
  };
  let mono = false;
  // Monochrome일 때는 회색 출력 = (모노 가중치 R,G,B) 합을 R/G/B에 동일 적용 + 상수
  const monoMix = [1, 0, 0, 0]; // [R,G,B,const]
  const compute = (img) => {
    if (mono) {
      const m = { r: monoMix.slice(), g: monoMix.slice(), b: monoMix.slice() };
      Adjust.channelMixer(img, m);
    } else {
      Adjust.channelMixer(img, mix);
    }
  };

  const body = document.createElement("div");
  body.style.width = "320px";

  // 출력 채널 선택
  let outCh = "r";
  const selRow = document.createElement("div"); selRow.className = "row";
  const selLab = document.createElement("label"); selLab.textContent = "출력 채널"; selLab.style.width = "70px";
  const sel = document.createElement("select");
  [["r", "빨강"], ["g", "녹색"], ["b", "파랑"]].forEach(([v, t]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o);
  });
  sel.value = outCh;
  sel.addEventListener("change", () => { outCh = sel.value; syncSliders(); });
  selRow.append(selLab, sel);
  body.appendChild(selRow);

  caption(body, "소스 채널 (%)");
  // 소스 가중치 슬라이더 3개(-200~200%, 엔진은 배수 → /100) + 상수
  const srcLabels = ["빨강", "녹색", "파랑"];
  const srcSliders = [];
  srcLabels.forEach((label, idx) => {
    const s = makeSlider(body, label, -200, 200, 1, 100, (v) => {
      if (mono) monoMix[idx] = v / 100; else mix[outCh][idx] = v / 100;
      h.apply(compute);
    }, "%");
    srcSliders.push(s);
  });
  // 상수(-255~255)
  const constSlider = makeSlider(body, "상수", -255, 255, 1, 0, (v) => {
    if (mono) monoMix[3] = v; else mix[outCh][3] = v;
    h.apply(compute);
  });

  // Monochrome 체크박스
  const monoRow = document.createElement("div"); monoRow.className = "row";
  const monoLab = document.createElement("label"); monoLab.textContent = "단색(Monochrome)"; monoLab.style.width = "auto";
  const monoChk = document.createElement("input"); monoChk.type = "checkbox"; monoChk.style.marginLeft = "6px";
  monoChk.addEventListener("change", () => { mono = monoChk.checked; syncSliders(); h.apply(compute); });
  monoRow.append(monoLab, monoChk);
  body.appendChild(monoRow);

  // 현재 선택(출력 채널 또는 모노) 가중치를 슬라이더에 반영
  function syncSliders() {
    sel.disabled = mono; // 모노일 땐 출력 채널 선택 무의미
    const arr = mono ? monoMix : mix[outCh];
    srcSliders.forEach((s, i) => s.set(Math.round(arr[i] * 100)));
    constSlider.set(arr[3]);
  }

  app.dialogs.custom("채널 혼합", body, () => h.commit(compute, "채널 혼합"), () => h.cancel(), "적용");
  syncSliders();
}
