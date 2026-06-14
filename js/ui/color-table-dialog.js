// color-table-dialog.js — 인덱스 색상 모드의 팔레트(Color Table) 보기/편집 다이얼로그.
//
// 포토샵 "이미지 > 모드 > 색상표"에 해당. app.imageMode.palette 의 색들을 격자 스와치로
// 보여주고, 스와치를 클릭하면 색을 편집(<input type="color">)할 수 있다. "적용"하면 편집된
// 팔레트를 컨트롤러가 전 레이어에 다시 매핑한다(undo 가능). 인덱스 모드가 아니면 안내만 한다.
//
// CSP 안전: 인라인 onclick/스크립트 없이 모두 addEventListener 로 배선한다.

import { rgbToHex, hexToRgb } from "../engine/color.js";

export function openColorTable(app) {
  const c = app.imageMode;
  if (!c) { app.status("이미지 모드 컨트롤러가 아직 연결되지 않았습니다."); return; }
  if (c.mode !== "indexed" || !c.palette || !c.palette.length) {
    app.status("인덱스 색상 모드에서만 색상표를 편집할 수 있습니다.");
    return;
  }

  // 편집용 팔레트 사본(취소 시 원본 보존)
  const working = c.palette.map((col) => col.slice());

  const body = document.createElement("div");
  body.style.width = "320px";

  // 안내 + 색 수
  const info = document.createElement("div");
  info.className = "row";
  info.style.justifyContent = "space-between";
  const infoLabel = document.createElement("span");
  infoLabel.textContent = `색상 ${working.length}개 — 스와치를 클릭해 편집`;
  info.appendChild(infoLabel);
  body.appendChild(info);

  // 디더링 재적용 토글
  const ditherRow = document.createElement("div");
  ditherRow.className = "row";
  const ditherLb = document.createElement("label");
  ditherLb.textContent = "디더링 재적용";
  ditherLb.style.flex = "1";
  const ditherChk = document.createElement("input");
  ditherChk.type = "checkbox";
  ditherRow.append(ditherLb, ditherChk);
  body.appendChild(ditherRow);

  // 스와치 격자
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(16, 1fr)";
  grid.style.gap = "2px";
  grid.style.marginTop = "8px";
  grid.style.maxHeight = "240px";
  grid.style.overflowY = "auto";

  // 각 색 스와치 생성. 클릭 시 숨은 color input 을 열어 편집.
  working.forEach((col, idx) => {
    const sw = document.createElement("div");
    sw.title = `#${idx}  rgb(${col[0]},${col[1]},${col[2]})`;
    sw.style.width = "100%";
    sw.style.paddingBottom = "100%"; // 정사각형 유지
    sw.style.position = "relative";
    sw.style.cursor = "pointer";
    sw.style.borderRadius = "2px";
    sw.style.boxShadow = "inset 0 0 0 1px rgba(0,0,0,0.3)";
    sw.style.background = rgbToHex(col[0], col[1], col[2]);

    // 색 편집용 숨은 input(스와치 위에 겹쳐 클릭 영역으로 활용)
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = rgbToHex(col[0], col[1], col[2]);
    picker.style.position = "absolute";
    picker.style.inset = "0";
    picker.style.opacity = "0";        // 보이진 않지만 클릭으로 네이티브 피커 호출
    picker.style.cursor = "pointer";
    picker.addEventListener("input", () => {
      const rgb = hexToRgb(picker.value);
      working[idx] = [rgb.r, rgb.g, rgb.b];
      sw.style.background = picker.value;
      sw.title = `#${idx}  rgb(${rgb.r},${rgb.g},${rgb.b})`;
    });

    sw.appendChild(picker);
    grid.appendChild(sw);
  });
  body.appendChild(grid);

  app.dialogs.custom("색상표(Color Table)", body,
    () => { // 적용: 편집된 팔레트를 전 레이어에 재매핑
      c.reapplyPalette(working, { dither: ditherChk.checked });
    },
    null,
    "적용");
}
