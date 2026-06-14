// select-dialogs.js — 고급 선택 전용 다이얼로그.
// Color Range(색상 범위), 선택 저장/불러오기 UI를 제공한다.
// Grow(확대)·Similar(유사 영역)는 슬라이더 한 줄이면 충분하므로 app 래퍼에서
// dialogs.form 으로 처리한다(별도 다이얼로그 불필요).

import { hexToRgb, rgbToHex } from "../engine/color.js";

// 활성 레이어의 ImageData(문서 전체)를 읽는다. 없으면 null.
function activeImageData(app) {
  const layer = app.layers.activeLayer;
  if (!layer) return null;
  return layer.ctx.getImageData(0, 0, layer.width, layer.height);
}

// ───────────────────────────────────────────────────────────
// Color Range (색상 범위)
// 기준색 + 허용치(fuzziness)로 전역 유사색 마스크를 만든다. 마칭앤츠로 실시간 미리보기.
// 스포이드 버튼을 누르면 캔버스를 한 번 클릭해 기준색을 합성 결과에서 추출한다.
// ───────────────────────────────────────────────────────────
export function openColorRange(app) {
  const imageData = activeImageData(app);
  if (!imageData) { app.status("레이어가 없습니다."); return; }

  // 취소 시 되돌리기 위해 현재 선택 상태를 스냅샷.
  const sel = app.selection;
  const snap = sel.mask
    ? { mask: sel.mask.slice(), bounds: sel.bounds ? { ...sel.bounds } : null }
    : null;

  // 초기 기준색: 전경색.
  let ref = hexToRgb(app.state.foreground);
  let tolerance = 32;

  const body = document.createElement("div");
  body.style.width = "260px";

  // 기준색 줄: 색상 견본 + 색상 선택 input + 스포이드 버튼
  const row1 = document.createElement("div");
  row1.className = "row";
  const lab1 = document.createElement("label");
  lab1.textContent = "기준색"; lab1.style.width = "44px";
  const swatch = document.createElement("span");
  swatch.style.cssText = "width:28px;height:20px;border:1px solid #555;display:inline-block;border-radius:3px;";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = rgbToHex(ref.r, ref.g, ref.b);
  picker.style.cssText = "width:34px;height:24px;padding:0;border:1px solid #555;background:none;";
  const pipBtn = document.createElement("button");
  pipBtn.textContent = "스포이드";
  pipBtn.style.cssText = "flex:1;";
  row1.append(lab1, swatch, picker, pipBtn);
  body.appendChild(row1);

  // 허용치 슬라이더
  const row2 = document.createElement("div");
  row2.className = "row";
  const lab2 = document.createElement("label");
  lab2.textContent = "허용치"; lab2.style.width = "44px";
  const slider = document.createElement("input");
  slider.type = "range"; slider.min = 0; slider.max = 255; slider.step = 1; slider.value = tolerance;
  slider.style.flex = "1";
  const badge = document.createElement("span");
  badge.className = "val-badge";
  badge.textContent = tolerance;
  row2.append(lab2, slider, badge);
  body.appendChild(row2);

  const hint = document.createElement("div");
  hint.textContent = "스포이드 클릭 후 캔버스에서 색을 찍으세요.";
  hint.style.cssText = "color:var(--text-dim);font-size:11px;margin-top:6px;";
  body.appendChild(hint);

  const updateSwatch = () => { swatch.style.background = rgbToHex(ref.r, ref.g, ref.b); };
  updateSwatch();

  // 미리보기: fromColorMatch로 마스크 계산 후 _commitMask (정확한 외곽선 + 마칭앤츠 갱신)
  const preview = () => {
    const { mask, bounds } = sel.fromColorMatch(imageData, ref, tolerance);
    if (bounds) sel._commitMask(mask);
    else sel.clear();
  };

  picker.addEventListener("input", () => { ref = hexToRgb(picker.value); updateSwatch(); preview(); });
  slider.addEventListener("input", () => {
    tolerance = parseInt(slider.value, 10);
    badge.textContent = tolerance;
    preview();
  });

  // 스포이드: 캔버스 1회 클릭으로 합성 결과에서 색 추출.
  // ※ 다이얼로그 backdrop(position:fixed; inset:0)이 캔버스를 덮으므로 클릭이 캔버스에
  //    직접 닿지 않는다. 따라서 window 캡처 단계에서 좌표를 받아 캔버스 기준으로 환산하고,
  //    다이얼로그 박스 안쪽 클릭은 무시한다(슬라이더/버튼 조작 보호). backdrop은 반투명이라
  //    사용자는 그 아래 이미지를 보며 색을 찍을 수 있다.
  let picking = false;
  let flat = null, fctx = null, fw = 0, fh = 0;
  const canvas = app.canvas;
  // 색을 찍은 직후 backdrop의 mousedown(=취소) 1회를 삼키는 가드.
  // pointerdown과 mousedown은 별개 이벤트라 pointerdown의 stopPropagation으로는
  // backdrop 취소를 막지 못하므로, 다음 mousedown 1회를 캡처 단계에서 차단한다.
  const swallowNextMouseDown = (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    window.removeEventListener("mousedown", swallowNextMouseDown, true);
  };
  const onPick = (e) => {
    if (!picking) return;
    // 다이얼로그 패널 내부 클릭이면 색 추출하지 않음(컨트롤 조작 허용)
    if (e.target.closest && e.target.closest(".dialog")) return;
    e.preventDefault(); e.stopPropagation();
    window.addEventListener("mousedown", swallowNextMouseDown, true);
    const rect = canvas.getBoundingClientRect();
    const world = app.viewport.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const x = Math.floor(world.x), y = Math.floor(world.y);
    stopPick();
    if (x < 0 || y < 0 || x >= fw || y >= fh) { app.status("캔버스 밖입니다."); return; }
    const p = fctx.getImageData(x, y, 1, 1).data;
    ref = { r: p[0], g: p[1], b: p[2] };
    picker.value = rgbToHex(ref.r, ref.g, ref.b);
    updateSwatch();
    preview();
  };
  const startPick = () => {
    if (picking) { stopPick(); return; }
    picking = true;
    pipBtn.classList.add("primary");
    // 합성 결과를 1회 캐시(스포이드 도구와 동일 방식)
    flat = app.layers.flatten();
    fctx = flat.getContext("2d", { willReadFrequently: true });
    fw = flat.width; fh = flat.height;
    // backdrop이 모든 클릭을 가로채므로 window 캡처 단계에서 받는다
    window.addEventListener("pointerdown", onPick, true);
  };
  const stopPick = () => {
    picking = false;
    pipBtn.classList.remove("primary");
    window.removeEventListener("pointerdown", onPick, true);
    window.removeEventListener("mousedown", swallowNextMouseDown, true);
  };
  pipBtn.addEventListener("click", (e) => { e.preventDefault(); startPick(); });

  // 첫 진입 시 즉시 미리보기
  preview();

  app.dialogs.custom("색상 범위", body,
    () => { // 확인: 현재 미리보기(=마스크)를 그대로 확정. 추가 작업 없음.
      stopPick();
      app.status("색상 범위로 선택했습니다.");
    },
    () => { // 취소: 원래 선택으로 복원 (외곽선까지 정확히)
      stopPick();
      if (snap) sel._commitMask(snap.mask);
      else sel.clear();
    },
    "확인");
}

// ───────────────────────────────────────────────────────────
// 선택 저장 (이름 입력)
// ───────────────────────────────────────────────────────────
export function openSaveSelection(app) {
  const sel = app.selection;
  if (!sel.active || !sel.bounds) { app.status("저장할 선택 영역이 없습니다."); return; }
  const def = "선택 " + (sel.listSaved().length + 1);
  app.dialogs.form("선택 저장", [
    { key: "name", label: "이름", type: "text", value: def },
  ], (v) => {
    const name = (v.name || "").trim() || def;
    if (sel.saveSelection(name)) app.status(`선택 '${name}' 저장됨`);
    else app.status("저장에 실패했습니다.");
  }, "저장");
}

// ───────────────────────────────────────────────────────────
// 선택 불러오기 (목록 선택 + 삭제)
// ───────────────────────────────────────────────────────────
export function openLoadSelection(app) {
  const sel = app.selection;
  const names = sel.listSaved();
  if (names.length === 0) { app.status("저장된 선택이 없습니다."); return; }

  const body = document.createElement("div");
  body.style.width = "240px";

  const row = document.createElement("div");
  row.className = "row";
  const lab = document.createElement("label");
  lab.textContent = "선택"; lab.style.width = "44px";
  const select = document.createElement("select");
  select.style.flex = "1";
  for (const nm of names) {
    const o = document.createElement("option");
    o.value = nm; o.textContent = nm; select.appendChild(o);
  }
  row.append(lab, select);
  body.appendChild(row);

  // 삭제 버튼: 선택한 항목을 저장소에서 제거하고 목록 갱신.
  const delRow = document.createElement("div");
  delRow.style.cssText = "text-align:right;margin-top:6px;";
  const delBtn = document.createElement("button");
  delBtn.textContent = "삭제";
  delBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const nm = select.value;
    if (!nm) return;
    sel.deleteSaved(nm);
    select.querySelector(`option[value="${CSS.escape(nm)}"]`)?.remove();
    if (select.options.length === 0) app.status("저장된 선택을 모두 삭제했습니다.");
  });
  delRow.appendChild(delBtn);
  body.appendChild(delRow);

  app.dialogs.custom("선택 불러오기", body,
    () => {
      const nm = select.value;
      if (!nm) { app.status("불러올 선택이 없습니다."); return; }
      if (sel.loadSelection(nm)) app.status(`선택 '${nm}' 불러옴`);
    },
    null,
    "불러오기");
}
