// menus/tools.js — 확장 도구 관련 메뉴 항목(도구 전환 바로가기).
// 실제 단축키는 tool-manager.js의 SLOTS(같은 키 반복 = 슬롯 순환)가 처리하고, 여기 shortcut은 표시용이다.
import { TOOL } from "../../core/constants.js";

export default function menus(app) {
  const use = (id) => () => app.tools.setTool(id);
  return {
    "이미지": [
      { label: "자르기 도구", shortcut: "C", fn: use(TOOL.CROP) },
      { label: "적목 현상 도구", shortcut: "K", fn: use(TOOL.REDEYE) },
    ],
    "선택": [
      { label: "다각형 올가미 도구", shortcut: "L", fn: use(TOOL.POLYLASSO) },
      { label: "자석 올가미 도구", shortcut: "L", fn: use(TOOL.MAGLASSO) },
      { label: "빠른 선택 도구", shortcut: "W", fn: use(TOOL.QUICKSELECT) },
    ],
  };
}
