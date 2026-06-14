// filter-dialogs.js — 파라미터가 있는 필터의 미리보기 다이얼로그.
// 채널 다이얼로그(channel-dialogs.js)와 동일하게 app._startPreview() 핸들 +
// app.dialogs.custom() 모달을 사용한다. 슬라이더 입력 시 h.apply(compute)로 실시간 미리보기.

import * as Filters from "../engine/filters.js";

// 슬라이더 행 생성 헬퍼. body에 추가하고, 값 변경 시 onInput을 호출한다.
// scale: 표시값 배율(예: 0.01 → 50을 "50%"가 아니라 0.5로 쓰되 배지엔 정수로), suffix: 배지 단위.
function slider(body, label, opt, onInput) {
  const { min, max, step, value, suffix = "" } = opt;
  const row = document.createElement("div");
  row.className = "row";
  const lb = document.createElement("label");
  lb.textContent = label; lb.style.width = "44px";
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  inp.style.flex = "1";
  const badge = document.createElement("span");
  badge.className = "val-badge";
  badge.textContent = value + suffix;
  inp.addEventListener("input", () => {
    badge.textContent = inp.value + suffix;
    onInput(parseFloat(inp.value));
  });
  row.append(lb, inp, badge);
  body.appendChild(row);
  return inp;
}

// ── 언샤프 마스크 ──
export function openUnsharpMask(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const v = { amount: 50, radius: 2, threshold: 0 };
  const compute = (img) => Filters.unsharpMask(img, v.amount, v.radius, v.threshold);

  const body = document.createElement("div");
  body.style.width = "280px";
  slider(body, "양", { min: 0, max: 500, step: 1, value: v.amount, suffix: "%" },
    (n) => { v.amount = n; h.apply(compute); });
  slider(body, "반경", { min: 0.1, max: 50, step: 0.1, value: v.radius, suffix: "px" },
    (n) => { v.radius = n; h.apply(compute); });
  slider(body, "임계값", { min: 0, max: 255, step: 1, value: v.threshold },
    (n) => { v.threshold = n; h.apply(compute); });

  app.dialogs.custom("언샤프 마스크", body, () => h.commit(compute, "언샤프 마스크"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}

// ── 모션 블러 ──
export function openMotionBlur(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const v = { angle: 0, distance: 15 };
  const compute = (img) => Filters.motionBlur(img, v.angle, v.distance);

  const body = document.createElement("div");
  body.style.width = "280px";
  slider(body, "각도", { min: -180, max: 180, step: 1, value: v.angle, suffix: "°" },
    (n) => { v.angle = n; h.apply(compute); });
  slider(body, "거리", { min: 1, max: 200, step: 1, value: v.distance, suffix: "px" },
    (n) => { v.distance = n; h.apply(compute); });

  app.dialogs.custom("모션 블러", body, () => h.commit(compute, "모션 블러"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}

// ── 미디언 ──
export function openMedian(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const v = { radius: 1 };
  const compute = (img) => Filters.median(img, v.radius);

  const body = document.createElement("div");
  body.style.width = "280px";
  slider(body, "반경", { min: 1, max: 5, step: 1, value: v.radius, suffix: "px" },
    (n) => { v.radius = n; h.apply(compute); });

  app.dialogs.custom("미디언", body, () => h.commit(compute, "미디언"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}

// ── 모자이크 ──
export function openMosaic(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const v = { cell: 10 };
  const compute = (img) => Filters.mosaic(img, v.cell);

  const body = document.createElement("div");
  body.style.width = "280px";
  slider(body, "셀 크기", { min: 2, max: 100, step: 1, value: v.cell, suffix: "px" },
    (n) => { v.cell = n; h.apply(compute); });

  app.dialogs.custom("모자이크", body, () => h.commit(compute, "모자이크"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}

// ── 하이 패스 ──
export function openHighPass(app) {
  const h = app._startPreview();
  if (!h) { app.status("레이어가 없습니다."); return; }

  const v = { radius: 3 };
  const compute = (img) => Filters.highPass(img, v.radius);

  const body = document.createElement("div");
  body.style.width = "280px";
  slider(body, "반경", { min: 1, max: 100, step: 1, value: v.radius, suffix: "px" },
    (n) => { v.radius = n; h.apply(compute); });

  app.dialogs.custom("하이 패스", body, () => h.commit(compute, "하이 패스"), () => h.cancel(), "적용");
  h.apply(compute); // 초기 미리보기
}
