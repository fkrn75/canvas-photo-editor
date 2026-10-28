// menus/adjust.js — 보정 메뉴 확장(PhotoCraft 이식분, 파괴적 적용).
// 노출·활기·포토 필터·선택 색상·흑백(혼합)은 조정 레이어 타입 메타(ADJUSTMENT_TYPES)를 그대로 재사용해
// 레이어(비파괴)와 메뉴(파괴적)가 같은 수학·같은 UI를 쓴다.
// (새 조정 레이어 8종은 ADJUSTMENT_TYPES 에 등록되어 레이어 메뉴 "새 조정 레이어: …" 로 자동 노출된다.)
import * as Adjust from "../../engine/adjustments.js";
import { openTypeAdjustment, openShadowsHighlights, openReplaceColor } from "../adjust-dialogs.js";

export default function menus(app) {
  return {
    "보정": [
      { label: "노출…", fn: () => openTypeAdjustment(app, "exposure") },
      { label: "활기…", fn: () => openTypeAdjustment(app, "vibrance") },
      { label: "포토 필터…", fn: () => openTypeAdjustment(app, "photoFilter") },
      { label: "선택 색상…", fn: () => openTypeAdjustment(app, "selectiveColor") },
      { label: "흑백(혼합)…", fn: () => openTypeAdjustment(app, "blackWhite") },
      { sep: true },
      { label: "어두운 영역/밝은 영역…", fn: () => openShadowsHighlights(app) },
      { label: "색상 대체…", fn: () => openReplaceColor(app) },
      { label: "채도 감소", shortcut: "Shift+Ctrl+U", fn: () => app.applyFilter("채도 감소", Adjust.desaturate) },
      { sep: true },
      { label: "자동 대비", shortcut: "Alt+Shift+Ctrl+L", fn: () => app.applyFilter("자동 대비", (img) => Adjust.autoContrast(img)) },
      { label: "자동 색상", shortcut: "Shift+Ctrl+B", fn: () => app.applyFilter("자동 색상", (img) => Adjust.autoColor(img)) },
    ],
  };
}
