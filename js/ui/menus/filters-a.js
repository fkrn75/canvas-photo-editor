// menus/filters-a.js — 확장 필터 A 메뉴(흐림 효과·선명 효과·노이즈·기타).
// 픽셀 연산은 engine/filters-ext-a.js(순수 함수)에 있고, 여기서는 메뉴 항목과 다이얼로그만 만든다.
// - 파라미터 없는 필터: app.applyFilter(동기, 선택 영역 클립·히스토리 1단계 자동)
// - 슬라이더만 있는 가벼운 필터(O(n)): app.runAdjustment(실시간 미리보기)
// - 선택(select)·커널 격자가 필요하거나 무거운 필터: 아래 paramDialog(app._startPreview + dialogs.custom +
//   rAF 합치기 미리보기 + [적용] 시 runBusy) — filter-dialogs.js 패턴과 동일.

import * as FX from "../../engine/filters-ext-a.js";
import { runBusy } from "../busy.js";

// ── 파라미터 다이얼로그 ──
// fields: [{ key, label, type: "range"|"select"|"number", min, max, step, value, suffix, options:[[값,표시]] }]
// compute(img, values): 원본 복사본에 필터 적용. extra(body, values, refresh): 커스텀 UI를 붙이는 훅(선택).
function paramDialog(app, title, fields, compute, extra) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const values = {};
  for (const f of fields) values[f.key] = f.value;
  const run = (img) => compute(img, values);

  // 슬라이더 드래그 중 input 이벤트가 몰려도 프레임당 1회만 계산(무거운 필터 대비)
  // closed: 다이얼로그가 닫힌 뒤 늦게 도착한 프레임이 취소/적용 결과를 덮어쓰지 않도록 막는다.
  let pending = false, closed = false;
  const refresh = () => {
    if (pending || closed) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; if (!closed) h.apply(run); });
  };

  const body = document.createElement("div");
  body.style.width = "300px";
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "row";
    const lb = document.createElement("label");
    lb.textContent = f.label;
    row.appendChild(lb);
    if (f.type === "select") {
      const sel = document.createElement("select");
      for (const [val, text] of f.options) {
        const o = document.createElement("option"); o.value = val; o.textContent = text; sel.appendChild(o);
      }
      sel.value = f.value;
      sel.addEventListener("change", () => { values[f.key] = sel.value; refresh(); });
      row.appendChild(sel);
    } else if (f.type === "number") {
      const inp = document.createElement("input");
      inp.type = "number";
      if (f.min != null) inp.min = f.min;
      if (f.max != null) inp.max = f.max;
      if (f.step != null) inp.step = f.step;
      inp.value = f.value;
      inp.style.width = "80px";
      inp.addEventListener("input", () => {
        const n = parseFloat(inp.value);
        if (Number.isFinite(n)) { values[f.key] = n; refresh(); }
      });
      row.appendChild(inp);
      if (f.suffix) { const s = document.createElement("span"); s.textContent = f.suffix; row.appendChild(s); }
    } else {
      const inp = document.createElement("input");
      inp.type = "range"; inp.min = f.min; inp.max = f.max; inp.step = f.step ?? 1; inp.value = f.value;
      inp.style.flex = "1";
      const badge = document.createElement("span");
      badge.className = "val-badge";
      const suffix = f.suffix || "";
      badge.textContent = f.value + suffix;
      inp.addEventListener("input", () => {
        values[f.key] = parseFloat(inp.value);
        badge.textContent = inp.value + suffix;
        refresh();
      });
      row.append(inp, badge);
    }
    body.appendChild(row);
  }
  extra?.(body, values, refresh);

  app.dialogs.custom(title, body,
    () => { closed = true; runBusy(app, title, () => h.commit(run, title)); },
    () => { closed = true; h.cancel(); }, "적용");
  h.apply(run); // 초기 미리보기
}

// ── 사용자 정의(5×5 커널) ──
function openCustomKernel(app) {
  const kernel = FX.CUSTOM_KERNEL_PRESETS.sharpen.kernel.slice();
  const presetOpts = Object.entries(FX.CUSTOM_KERNEL_PRESETS).map(([k, p]) => [k, p.label]);
  const cells = [];
  let scaleInp, offsetInp;

  paramDialog(app, "사용자 정의", [
    { key: "scale", label: "비율", type: "number", min: 1, max: 9999, step: 1, value: 1 },
    { key: "offset", label: "오프셋", type: "number", min: -9999, max: 9999, step: 1, value: 0 },
  ], (img, v) => FX.customKernel(img, kernel, v.scale, v.offset), (body, values, refresh) => {
    // 비율/오프셋 입력칸 참조(프리셋 선택 시 값 동기화용)
    const nums = body.querySelectorAll('input[type="number"]');
    scaleInp = nums[0]; offsetInp = nums[1];

    // 프리셋 선택
    const prow = document.createElement("div");
    prow.className = "row";
    const plb = document.createElement("label");
    plb.textContent = "프리셋";
    const psel = document.createElement("select");
    for (const [val, text] of presetOpts) {
      const o = document.createElement("option"); o.value = val; o.textContent = text; psel.appendChild(o);
    }
    psel.value = "sharpen";
    psel.addEventListener("change", () => {
      const p = FX.CUSTOM_KERNEL_PRESETS[psel.value];
      if (!p) return;
      for (let i = 0; i < 25; i++) { kernel[i] = p.kernel[i]; cells[i].value = p.kernel[i]; }
      values.scale = p.scale; values.offset = p.offset;
      scaleInp.value = p.scale; offsetInp.value = p.offset;
      refresh();
    });
    prow.append(plb, psel);

    // 5×5 숫자 격자
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(5, 1fr)";
    grid.style.gap = "4px";
    for (let i = 0; i < 25; i++) {
      const c = document.createElement("input");
      c.type = "number"; c.step = 1; c.min = -999; c.max = 999;
      c.value = kernel[i];
      c.style.width = "100%"; c.style.boxSizing = "border-box"; c.style.textAlign = "center";
      c.setAttribute("aria-label", `커널 ${Math.floor(i / 5) + 1}행 ${(i % 5) + 1}열`);
      c.addEventListener("input", () => {
        const n = parseFloat(c.value);
        kernel[i] = Number.isFinite(n) ? n : 0;
        refresh();
      });
      cells.push(c);
      grid.appendChild(c);
    }
    body.prepend(prow, grid);
  });
}

export default function menus(app) {
  const a = app;
  return {
    "필터": [
      { label: "흐림 효과", sub: [
        { sep: true },
        { label: "흐리게", fn: () => a.applyFilter("흐리게", FX.blur) },
        { label: "더 흐리게", fn: () => a.applyFilter("더 흐리게", FX.blurMore) },
        { label: "상자 흐림…", fn: () => a.runAdjustment("상자 흐림", [
          { key: "r", label: "반경", min: 1, max: 200, step: 1, value: 5, suffix: "px" },
        ], (img, v) => FX.boxBlur(img, v.r)) },
        { label: "방사형 흐림…", fn: () => paramDialog(a, "방사형 흐림", [
          { key: "amount", label: "양", min: 1, max: 100, step: 1, value: 10 },
          { key: "mode", label: "방식", type: "select", value: "spin", options: [["spin", "회전"], ["zoom", "확대"]] },
        ], (img, v) => FX.radialBlur(img, v.amount, v.mode)) },
        { label: "표면 흐림…", fn: () => paramDialog(a, "표면 흐림", [
          { key: "r", label: "반경", min: 1, max: 100, step: 1, value: 5, suffix: "px" },
          { key: "t", label: "한계값", min: 2, max: 255, step: 1, value: 15, suffix: "레벨" },
        ], (img, v) => FX.surfaceBlur(img, v.r, v.t)) },
        { label: "렌즈 흐림…", fn: () => paramDialog(a, "렌즈 흐림", [
          { key: "r", label: "조리개 반경", min: 1, max: FX.LENS_BLUR_MAX_RADIUS, step: 1, value: 8, suffix: "px" },
          { key: "b", label: "밝은 부분", min: 0, max: 100, step: 1, value: 30 },
        ], (img, v) => FX.lensBlur(img, v.r, v.b)) },
        { label: "평균", fn: () => a.applyFilter("평균", (img) => FX.average(img, a.selection.mask)) },
      ]},
      { label: "선명 효과", sub: [
        { sep: true },
        { label: "더 선명하게", fn: () => a.applyFilter("더 선명하게", FX.sharpenMore) },
        { label: "가장자리 선명하게", fn: () => a.applyFilter("가장자리 선명하게", FX.sharpenEdges) },
        { label: "스마트 샤픈…", fn: () => a.runAdjustment("스마트 샤픈", [
          { key: "amount", label: "양", min: 1, max: 500, step: 1, value: 100, suffix: "%" },
          { key: "r", label: "반경", min: 1, max: 64, step: 1, value: 1, suffix: "px" },
          { key: "noise", label: "노이즈 감소", min: 0, max: 100, step: 1, value: 10, suffix: "%" },
        ], (img, v) => FX.smartSharpen(img, v.amount, v.r, v.noise)) },
      ]},
      { label: "노이즈", sub: [
        { sep: true },
        { label: "반점 제거", fn: () => a.applyFilter("반점 제거", (img) => FX.despeckle(img)) },
        { label: "먼지와 스크래치…", fn: () => paramDialog(a, "먼지와 스크래치", [
          { key: "r", label: "반경", min: 1, max: FX.DUST_MAX_RADIUS, step: 1, value: 1, suffix: "px" },
          { key: "t", label: "한계값", min: 0, max: 255, step: 1, value: 0, suffix: "레벨" },
        ], (img, v) => FX.dustAndScratches(img, v.r, v.t)) },
        { label: "노이즈 감소…", fn: () => a.runAdjustment("노이즈 감소", [
          { key: "s", label: "강도", min: 0, max: 10, step: 1, value: 6 },
          { key: "p", label: "세부 보존", min: 0, max: 100, step: 1, value: 60, suffix: "%" },
        ], (img, v) => FX.reduceNoise(img, v.s, v.p)) },
      ]},
      { label: "기타", sub: [
        { sep: true },
        { label: "사용자 정의…", fn: () => openCustomKernel(a) },
        { label: "최댓값…", fn: () => a.runAdjustment("최댓값", [
          { key: "r", label: "반경", min: 1, max: 100, step: 1, value: 1, suffix: "px" },
        ], (img, v) => FX.maximum(img, v.r)) },
        { label: "최솟값…", fn: () => a.runAdjustment("최솟값", [
          { key: "r", label: "반경", min: 1, max: 100, step: 1, value: 1, suffix: "px" },
        ], (img, v) => FX.minimum(img, v.r)) },
        { label: "오프셋…", fn: () => {
          const W = a.layers.width, H = a.layers.height;
          paramDialog(a, "오프셋", [
            { key: "dx", label: "가로(px)", type: "number", min: -W, max: W, step: 1, value: Math.round(W / 2) },
            { key: "dy", label: "세로(px)", type: "number", min: -H, max: H, step: 1, value: Math.round(H / 2) },
            { key: "mode", label: "정의되지 않은 영역", type: "select", value: "wrap",
              options: [["wrap", "감싸기"], ["repeat", "가장자리 픽셀 반복"], ["transparent", "투명하게"]] },
          ], (img, v) => FX.offset(img, v.dx, v.dy, v.mode));
        } },
        { label: "HSB/HSL…", fn: () => paramDialog(a, "HSB/HSL", [
          { key: "mode", label: "변환", type: "select", value: "rgb2hsb", options: [
            ["rgb2hsb", "RGB → HSB"], ["rgb2hsl", "RGB → HSL"], ["hsb2rgb", "HSB → RGB"], ["hsl2rgb", "HSL → RGB"]] },
        ], (img, v) => {
          if (v.mode === "rgb2hsl") return FX.rgbToHsl(img);
          if (v.mode === "hsb2rgb") return FX.hsbToRgb(img);
          if (v.mode === "hsl2rgb") return FX.hslToRgb(img);
          return FX.rgbToHsb(img);
        }) },
      ]},
    ],
  };
}
