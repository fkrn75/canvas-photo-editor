// stroke-dialog.js — 선택 윤곽(Stroke) 모달.
// 현재 선택 영역의 경계를 따라 활성 레이어에 외곽선을 칠한다.
//   폭(px)   : 외곽선 두께
//   색       : 외곽선 색(기본=전경색)
//   위치     : inside(안쪽) / center(중앙) / outside(바깥쪽)
// 선택이 없으면 안내 후 종료. 결과는 히스토리 1스텝으로 등록(undo 가능).
// select-dialogs.js의 custom 모달 패턴을 그대로 따른다.

import { hexToRgb, rgbToHex } from "../engine/color.js";

export function openStroke(app) {
  const sel = app.selection;
  if (!sel.active || !sel.mask) { app.status("먼저 영역을 선택하세요."); return; }
  const layer = app.layers.activeLayer;
  if (!layer) { app.status("레이어가 없습니다."); return; }

  let color = app.state.foreground; // 기본 전경색
  let width = 3;
  let position = "center";

  const body = document.createElement("div");
  body.style.width = "240px";

  // 폭(px) 슬라이더 + 숫자 뱃지
  const row1 = document.createElement("div");
  row1.className = "row";
  const lab1 = document.createElement("label");
  lab1.textContent = "폭"; lab1.style.width = "44px";
  const wslider = document.createElement("input");
  wslider.type = "range"; wslider.min = 1; wslider.max = 100; wslider.step = 1; wslider.value = width;
  wslider.style.flex = "1";
  const wbadge = document.createElement("span");
  wbadge.className = "val-badge";
  wbadge.textContent = width + "px";
  wslider.addEventListener("input", () => { width = parseInt(wslider.value, 10); wbadge.textContent = width + "px"; });
  row1.append(lab1, wslider, wbadge);
  body.appendChild(row1);

  // 색 선택
  const row2 = document.createElement("div");
  row2.className = "row";
  const lab2 = document.createElement("label");
  lab2.textContent = "색"; lab2.style.width = "44px";
  const picker = document.createElement("input");
  picker.type = "color";
  const c0 = hexToRgb(color);
  picker.value = rgbToHex(c0.r, c0.g, c0.b); // #rrggbb 정규화(3자리 hex 대응)
  picker.style.cssText = "width:34px;height:24px;padding:0;border:1px solid #555;background:none;";
  picker.addEventListener("input", () => { color = picker.value; });
  row2.append(lab2, picker);
  body.appendChild(row2);

  // 위치 선택
  const row3 = document.createElement("div");
  row3.className = "row";
  const lab3 = document.createElement("label");
  lab3.textContent = "위치"; lab3.style.width = "44px";
  const psel = document.createElement("select");
  psel.style.flex = "1";
  for (const [val, text] of [["inside", "안쪽"], ["center", "중앙"], ["outside", "바깥쪽"]]) {
    const o = document.createElement("option"); o.value = val; o.textContent = text; psel.appendChild(o);
  }
  psel.value = position;
  psel.addEventListener("change", () => { position = psel.value; });
  row3.append(lab3, psel);
  body.appendChild(row3);

  app.dialogs.custom("선택 윤곽 (Stroke)", body, () => {
    // 1) 선택 경계를 따라 테두리 마스크 생성
    const { mask, bounds } = sel.strokeMaskFromSelection(width, position);
    if (!mask || !bounds) { app.status("외곽선을 그릴 테두리가 없습니다."); return; }

    // 2) 활성 레이어 bbox 픽셀에 색 채움(테두리 마스크가 255인 곳만)
    const W = app.layers.width;
    const rgb = hexToRgb(color);
    app.history.beginPixelEdit(layer);
    const img = layer.ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
    const d = img.data;
    for (let row = 0; row < bounds.h; row++) {
      for (let col = 0; col < bounds.w; col++) {
        const gi = (bounds.y + row) * W + (bounds.x + col);
        if (mask[gi] === 255) {
          const di = (row * bounds.w + col) * 4;
          d[di] = rgb.r; d[di + 1] = rgb.g; d[di + 2] = rgb.b; d[di + 3] = 255;
        }
      }
    }
    layer.ctx.putImageData(img, bounds.x, bounds.y);
    layer.thumbDirty = true;
    // 3) 변경 영역(bounds)만 히스토리 1스텝으로 등록
    app.history.commitPixelEdit(bounds, "선택 윤곽");
    app.status(`선택 윤곽 ${width}px(${psel.options[psel.selectedIndex].textContent})`);
  }, null, "확인");
}
