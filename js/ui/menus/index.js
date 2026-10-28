// menus/index.js — 확장 메뉴 모듈 등록부.
// 각 모듈은 (app) => ({ "메뉴 제목": [항목...] }) 형태의 함수를 default export 한다.
// 항목 형식은 menu-bar.js 와 같다: { label, shortcut?, fn } | { sep: true } | { label, sub: [...] }
// 필터 메뉴의 하위 그룹 이름(흐림 효과·선명 효과·노이즈·왜곡·픽셀화·렌더·스타일화·기타)과 같은 label 로
// { label, sub } 를 주면 기존 그룹에 합쳐진다.
import filtersA from "./filters-a.js";
import filtersB from "./filters-b.js";
import adjust from "./adjust.js";
import layerImage from "./layer-image.js";
import tools from "./tools.js";
import file from "./file.js";
import panels from "./panels.js";

export const EXT_MENU_SOURCES = [filtersA, filtersB, adjust, layerImage, tools, file, panels];
