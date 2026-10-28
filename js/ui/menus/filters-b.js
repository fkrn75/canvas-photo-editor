// menus/filters-b.js — 확장 필터 B 메뉴: 필터 > 왜곡 · 픽셀화 · 렌더 · 스타일화.
// 엔진은 js/engine/filters-ext-b.js(순수 함수). 파라미터 필터는 app._startPreview() 핸들 +
// app.dialogs.custom() 모달로 슬라이더 실시간 미리보기를 띄운다(filter-dialogs.js 와 같은 구조).
// runAdjustment 대신 자체 다이얼로그를 쓰는 이유: ① 선택형 옵션(0/1/2)을 배지에 이름으로 표시,
// ② 무거운 필터(유화·하프톤 등)는 미리보기 계산을 디바운스해 슬라이더 드래그가 버벅이지 않게 함.
// 파라미터 없는 필터는 app.applyFilter(동기 계약 — 액션 재생 대상)로 즉시 적용한다.

import * as FX from "../../engine/filters-ext-b.js";
import { hexToRgb } from "../../engine/color.js";
import { runBusy } from "../busy.js";

// 고정 시드: 시드 슬라이더가 없는 무작위 필터도 미리보기 = 확정 결과가 되도록 한다.
const SEED = 1337;

// 효과 기준 영역: 선택이 있으면 선택 경계, 없으면 문서 전체.
function regionOf(app) {
  const W = app.layers.width, H = app.layers.height;
  const b = app.selection?.active ? app.selection.bounds : null;
  if (!b || b.w <= 0 || b.h <= 0) return { x: 0, y: 0, w: W, h: H };
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

const fgRgb = (app) => hexToRgb(app.state.foreground);
const bgRgb = (app) => hexToRgb(app.state.background);

// 슬라이더 미리보기 다이얼로그.
// sliders: [{ key, label, min, max, step=1, value, suffix?, labels? }] — labels 가 있으면 배지에 labels[값] 표시(선택형).
// compute(img, v): v 는 현재 값 객체. 미리보기·확정 모두 원본 사본에서 다시 계산한다(app._startPreview 계약).
function openFx(app, title, sliders, compute) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }
  const v = {};
  for (const s of sliders) v[s.key] = s.value;
  const run = (img) => compute(img, v);

  // 미리보기 디바운스: 직전 계산이 느렸으면(>60ms) 입력이 멈출 때까지 기다렸다 계산한다.
  let timer = null, lastMs = 0;
  const doApply = () => {
    timer = null;
    const t0 = performance.now();
    h.apply(run);
    lastMs = performance.now() - t0;
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(doApply, lastMs > 60 ? 160 : 0);
  };
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const body = document.createElement("div");
  body.style.width = "300px";
  for (const s of sliders) {
    const row = document.createElement("div");
    row.className = "row";
    const lb = document.createElement("label");
    lb.textContent = s.label; lb.style.width = "72px";
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = s.min; inp.max = s.max; inp.step = s.step ?? 1; inp.value = s.value;
    inp.style.flex = "1";
    const badge = document.createElement("span");
    badge.className = "val-badge";
    const fmt = (n) => (s.labels ? s.labels[n] ?? n : n + (s.suffix || ""));
    badge.textContent = fmt(s.value);
    inp.addEventListener("input", () => {
      v[s.key] = parseFloat(inp.value);
      badge.textContent = fmt(v[s.key]);
      schedule();
    });
    row.append(lb, inp, badge);
    body.appendChild(row);
  }

  app.dialogs.custom(title, body,
    () => { stop(); runBusy(app, title, () => h.commit(run, title)); },
    () => { stop(); h.cancel(); },
    "적용");
  doApply(); // 초기 미리보기
}

export default function menus(app) {
  const a = app;
  const rg = () => regionOf(a);

  return {
    "필터": [
      { label: "왜곡", sub: [
        { label: "핀치…", fn: () => { const R = rg(); openFx(a, "핀치", [
          { key: "amt", label: "양", min: -100, max: 100, value: 50, suffix: "%" },
        ], (img, v) => FX.pinch(img, v.amt, R)); } },
        { label: "극좌표…", fn: () => { const R = rg(); openFx(a, "극좌표", [
          { key: "mode", label: "변환", min: 0, max: 1, value: 0, labels: ["직교→극", "극→직교"] },
        ], (img, v) => FX.polarCoordinates(img, v.mode, R)); } },
        { label: "잔물결…", fn: () => openFx(a, "잔물결", [
          { key: "amt", label: "양", min: -999, max: 999, value: 100, suffix: "%" },
          { key: "size", label: "크기", min: 0, max: 2, value: 1, labels: ["작게", "중간", "크게"] },
        ], (img, v) => FX.ripple(img, v.amt, v.size)) },
        { label: "기울임…", fn: () => { const R = rg(); openFx(a, "기울임", [
          { key: "amt", label: "휘기", min: -100, max: 100, value: 50, suffix: "%" },
          { key: "mode", label: "모양", min: 0, max: 1, value: 0, labels: ["직선", "사인 곡선"] },
        ], (img, v) => FX.shear(img, v.amt, v.mode, R)); } },
        { label: "구형화…", fn: () => { const R = rg(); openFx(a, "구형화", [
          { key: "amt", label: "양", min: -100, max: 100, value: 100, suffix: "%" },
        ], (img, v) => FX.spherize(img, v.amt, R)); } },
        { label: "돌리기…", fn: () => { const R = rg(); openFx(a, "돌리기", [
          { key: "ang", label: "각도", min: -999, max: 999, value: 50, suffix: "°" },
        ], (img, v) => FX.twirl(img, v.ang, R)); } },
        { label: "파형…", fn: () => openFx(a, "파형", [
          { key: "len", label: "파장", min: 10, max: 500, value: 120, suffix: "px" },
          { key: "amp", label: "진폭", min: 0, max: 200, value: 20, suffix: "px" },
          { key: "n", label: "생성기 수", min: 1, max: 10, value: 5 },
        ], (img, v) => FX.wave(img, v.len, v.amp, v.n, SEED)) },
        { label: "지그재그…", fn: () => { const R = rg(); openFx(a, "지그재그", [
          { key: "amt", label: "양", min: -100, max: 100, value: 50, suffix: "%" },
          { key: "n", label: "마루 수", min: 1, max: 20, value: 5 },
        ], (img, v) => FX.zigzag(img, v.amt, v.n, R)); } },
      ]},
      { label: "픽셀화", sub: [
        { label: "색상 하프톤…", fn: () => openFx(a, "색상 하프톤", [
          { key: "r", label: "최대 반경", min: 4, max: 127, value: 8, suffix: "px" },
          { key: "c1", label: "채널 1(R)", min: 0, max: 360, value: 108, suffix: "°" },
          { key: "c2", label: "채널 2(G)", min: 0, max: 360, value: 162, suffix: "°" },
          { key: "c3", label: "채널 3(B)", min: 0, max: 360, value: 90, suffix: "°" },
        ], (img, v) => FX.colorHalftone(img, v.r, [v.c1, v.c2, v.c3])) },
        { label: "수정화…", fn: () => openFx(a, "수정화", [
          { key: "cell", label: "셀 크기", min: 3, max: 300, value: 10 },
        ], (img, v) => FX.crystallize(img, v.cell, SEED)) },
        { label: "단면화", fn: () => a.applyFilter("단면화", (img) => FX.facet(img)) },
        { label: "분열", fn: () => a.applyFilter("분열", (img) => FX.fragment(img)) },
        { label: "메조틴트…", fn: () => openFx(a, "메조틴트", [
          { key: "t", label: "종류", min: 0, max: 2, value: 0, labels: ["점", "짧은 선", "긴 선"] },
        ], (img, v) => FX.mezzotint(img, v.t, SEED)) },
        { label: "점묘화…", fn: () => { const bg = bgRgb(a); openFx(a, "점묘화", [
          { key: "cell", label: "셀 크기", min: 3, max: 300, value: 8 },
        ], (img, v) => FX.pointillize(img, v.cell, bg, SEED)); } },
      ]},
      { label: "렌더", sub: [
        { label: "구름…", fn: () => { const fg = fgRgb(a), bg = bgRgb(a); openFx(a, "구름", [
          { key: "scale", label: "크기", min: 16, max: 512, value: 128, suffix: "px" },
          { key: "seed", label: "시드", min: 1, max: 999, value: 1 },
        ], (img, v) => FX.clouds(img, fg, bg, v.seed, v.scale)); } },
        { label: "차이 구름…", fn: () => { const fg = fgRgb(a), bg = bgRgb(a); openFx(a, "차이 구름", [
          { key: "scale", label: "크기", min: 16, max: 512, value: 128, suffix: "px" },
          { key: "seed", label: "시드", min: 1, max: 999, value: 1 },
        ], (img, v) => FX.differenceClouds(img, fg, bg, v.seed, v.scale)); } },
        { label: "섬유…", fn: () => { const fg = fgRgb(a), bg = bgRgb(a); openFx(a, "섬유", [
          { key: "var", label: "분산", min: 1, max: 64, value: 16 },
          { key: "str", label: "강도", min: 1, max: 64, value: 4 },
          { key: "seed", label: "시드", min: 1, max: 999, value: 1 },
        ], (img, v) => FX.fibers(img, fg, bg, v.var, v.str, v.seed)); } },
        { label: "렌즈 플레어…", fn: () => openFx(a, "렌즈 플레어", [
          { key: "b", label: "명도", min: 10, max: 300, value: 100, suffix: "%" },
          { key: "x", label: "위치 X", min: 0, max: 100, value: 30, suffix: "%" },
          { key: "y", label: "위치 Y", min: 0, max: 100, value: 30, suffix: "%" },
          { key: "t", label: "렌즈 종류", min: 0, max: 2, value: 0, labels: ["50-300mm 줌", "35mm 프라임", "105mm 프라임"] },
        ], (img, v) => FX.lensFlare(img, v.b, v.x, v.y, v.t)) },
        { label: "조명 효과…", fn: () => openFx(a, "조명 효과", [
          { key: "type", label: "조명 종류", min: 0, max: 1, value: 0, labels: ["전방향", "스포트"] },
          { key: "x", label: "위치 X", min: 0, max: 100, value: 50, suffix: "%" },
          { key: "y", label: "위치 Y", min: 0, max: 100, value: 50, suffix: "%" },
          { key: "i", label: "강도", min: 0, max: 200, value: 100, suffix: "%" },
          { key: "r", label: "범위", min: 5, max: 200, value: 50, suffix: "%" },
          { key: "bump", label: "질감 높이", min: 0, max: 50, value: 10 },
        ], (img, v) => FX.lightingEffects(img, { type: v.type, x: v.x, y: v.y, intensity: v.i, range: v.r, bump: v.bump })) },
      ]},
      { label: "스타일화", sub: [
        { label: "확산…", fn: () => openFx(a, "확산", [
          { key: "mode", label: "모드", min: 0, max: 2, value: 0, labels: ["표준", "어두운 것만", "밝은 것만"] },
          { key: "r", label: "반경", min: 1, max: 10, value: 2, suffix: "px" },
        ], (img, v) => FX.diffuse(img, v.mode, v.r, SEED)) },
        { label: "솔라리즈", fn: () => a.applyFilter("솔라리즈", FX.solarize) },
        { label: "바람…", fn: () => openFx(a, "바람", [
          { key: "m", label: "방법", min: 0, max: 2, value: 0, labels: ["바람", "강풍", "엇갈림"] },
          { key: "d", label: "방향", min: 0, max: 1, value: 0, labels: ["왼쪽에서", "오른쪽에서"] },
        ], (img, v) => FX.wind(img, v.m, v.d, SEED)) },
        { label: "타일…", fn: () => { const bg = bgRgb(a); openFx(a, "타일", [
          { key: "n", label: "타일 수", min: 1, max: 99, value: 10 },
          { key: "off", label: "최대 오프셋", min: 1, max: 99, value: 10, suffix: "%" },
        ], (img, v) => FX.tiles(img, v.n, v.off, bg, SEED)); } },
        { label: "윤곽선 추적…", fn: () => openFx(a, "윤곽선 추적", [
          { key: "lv", label: "레벨", min: 0, max: 255, value: 128 },
          { key: "e", label: "가장자리", min: 0, max: 1, value: 0, labels: ["아래", "위"] },
        ], (img, v) => FX.traceContour(img, v.lv, v.e)) },
        { label: "돌출…", fn: () => openFx(a, "돌출", [
          { key: "t", label: "유형", min: 0, max: 1, value: 0, labels: ["블록", "피라미드"] },
          { key: "s", label: "크기", min: 2, max: 255, value: 30, suffix: "px" },
          { key: "d", label: "깊이", min: 1, max: 100, value: 30 },
        ], (img, v) => FX.extrude(img, v.t, v.s, v.d)) },
        { label: "유화…", fn: () => openFx(a, "유화", [
          { key: "r", label: "반경", min: 1, max: 10, value: 4, suffix: "px" },
          { key: "lv", label: "단계", min: 2, max: 64, value: 20 },
        ], (img, v) => FX.oilPaint(img, v.r, v.lv)) },
        { label: "네온 가장자리…", fn: () => openFx(a, "네온 가장자리", [
          { key: "w", label: "가장자리 폭", min: 1, max: 14, value: 2 },
          { key: "b", label: "밝기", min: 0, max: 20, value: 6 },
          { key: "s", label: "부드럽게", min: 1, max: 15, value: 5 },
        ], (img, v) => FX.glowingEdges(img, v.w, v.b, v.s)) },
      ]},
    ],
  };
}
