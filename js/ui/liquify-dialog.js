// liquify-dialog.js — 픽셀 유동화(Liquify) 모달 다이얼로그.
//
// 활성 레이어의 픽셀을 전용 캔버스로 가져와 브러시로 워핑하고(밀기/오목/볼록/소용돌이),
// [적용] 시 결과를 레이어에 commitPixelEdit으로 반영한다. [취소]/[모두 복구] 지원.
//
// 좌표계: 내부 캔버스 버퍼는 원본 해상도 그대로다. 큰 이미지는 CSS(max-width/height)로
// 축소 표시되므로, 포인터 좌표를 getBoundingClientRect 비율로 버퍼 좌표로 환산한다.
//
// 렌더링 엔진은 filters/liquify.js (LiquifyMesh). 다이얼로그는 UI/입력만 담당.

import { LiquifyMesh, LIQUIFY_MODE } from "../filters/liquify.js";

export function openLiquify(app) {
  const layer = app.layers?.activeLayer;
  if (!layer) { app.status("레이어가 없습니다."); return; }
  if (layer.lockImage) { app.status("이미지가 잠겨 있어 유동화할 수 없습니다."); return; }
  if (layer.type === "adjustment") { app.status("조정 레이어에는 적용할 수 없습니다."); return; }

  const W = layer.width, H = layer.height;
  const src = layer.ctx.getImageData(0, 0, W, H);
  const mesh = new LiquifyMesh(src);

  // ── UI 구성 ──
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";

  // 작업 캔버스(버퍼=원본 크기, 표시는 CSS로 화면 맞춤)
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  // 모달 안에 들어갈 최대 표시 크기 제한(뷰포트 기준)
  const maxW = Math.min(W, Math.floor(window.innerWidth * 0.6));
  const maxH = Math.min(H, Math.floor(window.innerHeight * 0.6));
  canvas.style.maxWidth = maxW + "px";
  canvas.style.maxHeight = maxH + "px";
  canvas.style.width = "auto";
  canvas.style.height = "auto";
  canvas.style.display = "block";
  canvas.style.cursor = "none";
  canvas.style.background =
    "repeating-conic-gradient(#c8c8c8 0% 25%, #fff 0% 50%) 50% / 16px 16px"; // 투명 체커
  const cctx = canvas.getContext("2d", { willReadFrequently: true });
  const paint = () => cctx.putImageData(mesh.result(), 0, 0);
  paint();

  // 컨트롤 줄
  const controls = document.createElement("div");
  controls.className = "row";
  controls.style.gap = "10px";
  controls.style.flexWrap = "wrap";

  // 모드 선택
  const modeWrap = document.createElement("div");
  const modeLb = document.createElement("label"); modeLb.textContent = "모드";
  const modeSel = document.createElement("select");
  for (const [val, text] of [
    [LIQUIFY_MODE.FORWARD, "밀기"],
    [LIQUIFY_MODE.PUCKER, "오목"],
    [LIQUIFY_MODE.BLOAT, "볼록"],
    [LIQUIFY_MODE.TWIRL, "소용돌이"],
  ]) {
    const o = document.createElement("option"); o.value = val; o.textContent = text; modeSel.appendChild(o);
  }
  modeSel.value = LIQUIFY_MODE.FORWARD;
  modeWrap.append(modeLb, modeSel);

  // 크기/세기 슬라이더(상태값 재사용: brushSize, liquifyStrength)
  const st = app.state;
  let radius = Math.max(10, Math.min(200, st.brushSize * 3 || 60));
  let strength = st.liquifyStrength ?? 0.5;

  const sizeWrap = document.createElement("div");
  const sizeLb = document.createElement("label"); sizeLb.textContent = "크기";
  const sizeInp = document.createElement("input");
  sizeInp.type = "range"; sizeInp.min = 10; sizeInp.max = 400; sizeInp.step = 1; sizeInp.value = radius;
  const sizeBadge = document.createElement("span"); sizeBadge.className = "val-badge"; sizeBadge.textContent = radius + "px";
  sizeInp.addEventListener("input", () => { radius = parseFloat(sizeInp.value); sizeBadge.textContent = radius + "px"; });
  sizeWrap.append(sizeLb, sizeInp, sizeBadge);

  const strWrap = document.createElement("div");
  const strLb = document.createElement("label"); strLb.textContent = "세기";
  const strInp = document.createElement("input");
  strInp.type = "range"; strInp.min = 0; strInp.max = 1; strInp.step = 0.01; strInp.value = strength;
  const strBadge = document.createElement("span"); strBadge.className = "val-badge"; strBadge.textContent = Math.round(strength * 100) + "%";
  strInp.addEventListener("input", () => { strength = parseFloat(strInp.value); strBadge.textContent = Math.round(strength * 100) + "%"; });
  strWrap.append(strLb, strInp, strBadge);

  // 모두 복구 버튼
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "모두 복구";
  resetBtn.addEventListener("click", () => { mesh.reset(); paint(); });

  controls.append(modeWrap, sizeWrap, strWrap, resetBtn);

  const hint = document.createElement("div");
  hint.style.color = "var(--text-dim)";
  hint.style.fontSize = "12px";
  hint.textContent = "캔버스 위에서 드래그하여 변형합니다. 밀기는 드래그 방향으로 픽셀을 밉니다.";

  body.append(controls, canvas, hint);

  // ── 포인터 워핑 ──
  let drawing = false;
  let last = null;       // 직전 버퍼 좌표 {x,y}
  let hover = null;      // 커서 표시용 버퍼 좌표

  // 클라이언트 좌표 → 캔버스 버퍼 좌표(표시 축소 비율 보정)
  const toBuf = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x: sx, y: sy };
  };

  // 커서 오버레이를 위한 합성 그리기(결과 + 브러시 원)
  const repaintWithCursor = () => {
    paint();
    if (!hover) return;
    cctx.save();
    cctx.lineWidth = Math.max(1, canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    cctx.strokeStyle = "rgba(0,0,0,0.7)";
    cctx.beginPath(); cctx.arc(hover.x, hover.y, radius, 0, Math.PI * 2); cctx.stroke();
    cctx.strokeStyle = "rgba(255,255,255,0.6)";
    cctx.beginPath(); cctx.arc(hover.x, hover.y, radius + cctx.lineWidth, 0, Math.PI * 2); cctx.stroke();
    cctx.restore();
  };

  const applyAt = (p, mdx, mdy) => {
    mesh.applyBrush(modeSel.value, p.x, p.y, radius, strength, mdx, mdy);
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const p = toBuf(e);
    last = p; hover = p;
    // forward는 이동이 있어야 효과가 나므로 다운 시엔 비이동 모드만 1회 적용.
    if (modeSel.value !== LIQUIFY_MODE.FORWARD) applyAt(p, 0, 0);
    repaintWithCursor();
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = toBuf(e);
    hover = p;
    if (drawing) {
      const mdx = p.x - last.x, mdy = p.y - last.y;
      // 이동 구간을 잘게 보간해 끊김 없이 적용
      const dist = Math.hypot(mdx, mdy);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.25)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ix = last.x + mdx * t, iy = last.y + mdy * t;
        applyAt({ x: ix, y: iy }, mdx / steps, mdy / steps);
      }
      last = p;
    }
    repaintWithCursor();
  });

  const endStroke = (e) => {
    if (drawing) { drawing = false; last = null; }
    repaintWithCursor();
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", () => { hover = null; paint(); });

  // ── 모달 열기 ──
  app.dialogs.custom("픽셀 유동화", body,
    () => { // 적용: 결과를 레이어에 픽셀 편집으로 커밋
      app.state.set("liquifyStrength", strength); // 마지막 세기 기억
      app.history.beginPixelEdit(layer);
      layer.ctx.putImageData(mesh.result(), 0, 0);
      layer.thumbDirty = true;
      app.history.commitPixelEdit({ x: 0, y: 0, w: W, h: H }, "픽셀 유동화");
      app.renderer.requestRender();
    },
    () => { /* 취소: 아무것도 하지 않음(레이어 원본 그대로) */ },
    "적용");
}
