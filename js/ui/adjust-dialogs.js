// adjust-dialogs.js — 색상/톤 보정 다이얼로그 모음:
//   색상 균형(Color Balance) · 한계값(Threshold) · 포스터화(Posterize)
//   · 그라디언트 맵(Gradient Map) · 채널 혼합(Channel Mixer).
// 모두 channel-dialogs.js 패턴을 따른다: app._startPreview()로 실시간 미리보기,
// 확인 시 commit(undo 1스텝), 취소 시 원복.
// (균일화 Equalize는 슬라이더가 없어 다이얼로그가 불필요 → app.applyFilter로 직접 호출)

import * as Adjust from "../engine/adjustments.js";
import { rgbToHex, hexToRgb } from "../engine/color.js";
import {
  ADJUSTMENT_TYPES, adjustmentSpec, defaultParams, applyAdjustment, cloneParams,
} from "../layers/adjustment-layer.js";

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

// ════════════════════════════════════════════════════════════════════════════
// 명세 기반 공용 컨트롤 빌더 — 조정 레이어 편집 다이얼로그와 파괴적 보정 다이얼로그가 공유한다.
// spec = { sliders, bank, fields } (adjustment-layer.js ADJUSTMENT_TYPES 메타와 같은 형식)
//   sliders : [{ key, label, min, max, step, suffix }]            → cur[key]
//   bank    : { label, options:[[값,표시]], initial, sliders:[{ idx, ... }] } → cur[선택값][idx]
//   fields  : [{ key, label, type:"checkbox"|"select"|"color", options }] → cur[key]
// cur 를 직접 수정하고 매 변경마다 onChange() 를 부른다. 반환 { sync() } 는 cur → 컨트롤 재반영.
// ════════════════════════════════════════════════════════════════════════════
export function buildParamControls(body, spec, cur, onChange) {
  const { sliders = [], bank = null, fields = [] } = spec || {};
  const syncers = [];
  const syncAll = () => syncers.forEach((f) => f());

  // 슬라이더 한 줄: get()/set(v) 로 값 위치를 추상화(평면 키 / 범위 묶음 공용)
  const sliderRow = (s, get, set) => {
    const row = document.createElement("div"); row.className = "row";
    const lb = document.createElement("label"); lb.textContent = s.label; lb.style.width = "80px";
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = s.step; inp.style.flex = "1";
    const badge = document.createElement("span"); badge.className = "val-badge";
    const dec = (String(s.step).split(".")[1] || "").length; // 표시 소수 자릿수 = step 자릿수
    const fmt = (v) => (dec ? Number(v).toFixed(dec) : v) + (s.suffix || "");
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      badge.textContent = fmt(v);
      set(v); onChange();
    });
    row.append(lb, inp, badge);
    body.appendChild(row);
    syncers.push(() => { const v = get() ?? s.min; inp.value = v; badge.textContent = fmt(v); });
  };

  // 1) 범위 선택 + 범위별 슬라이더
  if (bank) {
    let sel = bank.initial ?? bank.options[0][0];
    const row = document.createElement("div"); row.className = "row";
    const lb = document.createElement("label"); lb.textContent = bank.label; lb.style.width = "80px";
    const select = document.createElement("select");
    for (const [v, t] of bank.options) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; select.appendChild(o);
    }
    select.value = sel;
    select.addEventListener("change", () => { sel = select.value; syncAll(); });
    row.append(lb, select);
    body.appendChild(row);
    for (const bs of bank.sliders) {
      sliderRow(bs,
        () => (Array.isArray(cur[sel]) ? cur[sel][bs.idx] : undefined) ?? 0,
        (v) => { if (!Array.isArray(cur[sel])) cur[sel] = [0, 0, 0, 0]; cur[sel][bs.idx] = v; });
    }
    if (sliders.length) caption(body, "");
  }

  // 2) 평면 슬라이더
  for (const s of sliders) sliderRow(s, () => cur[s.key], (v) => { cur[s.key] = v; });

  // 3) 기타 컨트롤(체크박스/셀렉트/색상). 같은 key 를 여러 컨트롤이 공유할 수 있어(포토 필터 프리셋+색상)
  //    변경 후 전체 sync 로 서로를 맞춘다.
  for (const f of fields) {
    const row = document.createElement("div"); row.className = "row";
    const lb = document.createElement("label"); lb.textContent = f.label; lb.style.width = "80px";
    let el;
    if (f.type === "checkbox") {
      el = document.createElement("input"); el.type = "checkbox";
      el.addEventListener("change", () => { cur[f.key] = el.checked; onChange(); syncAll(); });
      syncers.push(() => { el.checked = !!cur[f.key]; });
    } else if (f.type === "select") {
      el = document.createElement("select");
      for (const [v, t] of f.options || []) {
        const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o);
      }
      el.addEventListener("change", () => {
        if (el.value === "") { syncAll(); return; } // "사용자 정의" 같은 빈 값 항목은 현재 값 유지
        cur[f.key] = el.value; onChange(); syncAll();
      });
      syncers.push(() => {
        const v = String(cur[f.key] ?? "").toLowerCase();
        const hit = (f.options || []).some(([ov]) => String(ov).toLowerCase() === v);
        el.value = hit ? (f.options.find(([ov]) => String(ov).toLowerCase() === v)[0]) : "";
      });
    } else if (f.type === "color") {
      el = document.createElement("input"); el.type = "color";
      el.addEventListener("input", () => { cur[f.key] = el.value; onChange(); syncAll(); });
      syncers.push(() => { el.value = cur[f.key] || "#000000"; });
    } else {
      continue;
    }
    row.append(lb, el);
    body.appendChild(row);
  }

  syncAll();
  return { sync: syncAll };
}

// 명세 기반 파괴적 보정 다이얼로그(활성 레이어 픽셀 수정, 실시간 미리보기, 확인=undo 1스텝).
//   spec    : buildParamControls 명세
//   init    : 초기 파라미터(복사해서 사용)
//   compute : (img, params) => void  — ImageData in-place 보정
// 미리보기는 requestAnimationFrame 으로 합쳐 큰 이미지에서 슬라이더 드래그가 밀리지 않게 한다.
export function openParamAdjustment(app, title, spec, init, compute) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }
  const cur = cloneParams(init);
  const run = (img) => compute(img, cur);
  let pending = false, closed = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16);
    raf(() => { pending = false; if (!closed) h.apply(run); });
  };

  const body = document.createElement("div");
  body.style.width = "320px";
  buildParamControls(body, spec, cur, schedule);

  app.dialogs.custom(title, body,
    () => { closed = true; h.commit(run, title); },
    () => { closed = true; h.cancel(); }, "적용");
  h.apply(run); // 초기 미리보기
}

// 조정 레이어 타입 메타(ADJUSTMENT_TYPES)를 그대로 써서 같은 보정을 파괴적으로 적용하는 다이얼로그.
// (노출·활기·포토 필터·선택 색상·흑백(혼합) — 레이어/메뉴가 같은 수학·같은 UI를 공유)
export function openTypeAdjustment(app, type) {
  const meta = ADJUSTMENT_TYPES[type];
  if (!meta) return;
  openParamAdjustment(app, meta.label, adjustmentSpec(type), defaultParams(type),
    (img, p) => applyAdjustment(img, type, p));
}

// ── 어두운 영역/밝은 영역 (Shadows/Highlights) ──
export const SHADOWS_HIGHLIGHTS_SPEC = {
  sliders: [
    { key: "shadows", label: "어두운 영역", min: 0, max: 100, step: 1, suffix: "%" },
    { key: "highlights", label: "밝은 영역", min: 0, max: 100, step: 1, suffix: "%" },
    { key: "toneWidth", label: "톤 폭", min: 1, max: 100, step: 1, suffix: "%" },
    { key: "radius", label: "반경", min: 0, max: 250, step: 1, suffix: "px" },
  ],
};
export function openShadowsHighlights(app) {
  openParamAdjustment(app, "어두운 영역/밝은 영역", SHADOWS_HIGHLIGHTS_SPEC,
    { shadows: 35, highlights: 0, toneWidth: 50, radius: 30 },
    (img, p) => Adjust.shadowsHighlights(img, p.shadows, p.highlights, p.toneWidth, p.radius));
}

// ── 색상 대체 (Replace Color) — 대상 색 기본값 = 현재 전경색 ──
export const REPLACE_COLOR_SPEC = {
  sliders: [
    { key: "fuzziness", label: "허용치", min: 0, max: 200, step: 1 },
    { key: "hue", label: "색조", min: -180, max: 180, step: 1 },
    { key: "sat", label: "채도", min: -100, max: 100, step: 1 },
    { key: "light", label: "밝기", min: -100, max: 100, step: 1 },
  ],
  fields: [{ key: "target", label: "대상 색", type: "color" }],
};
export function openReplaceColor(app) {
  const fg = app.state?.foreground || "#000000";
  openParamAdjustment(app, "색상 대체", REPLACE_COLOR_SPEC,
    { target: fg, fuzziness: 40, hue: 0, sat: 0, light: 0 },
    (img, p) => Adjust.replaceColor(img, p.target, p.fuzziness, p.hue, p.sat, p.light));
}
