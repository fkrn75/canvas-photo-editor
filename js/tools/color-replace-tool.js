// color-replace-tool.js — 색상 대체 도구(Color Replacement, B 슬롯: 브러시 ↔ 색상 대체).
//
// 브러시 중심 아래 색(연속/한 번 샘플링)과 허용오차 안에서 비슷한 픽셀만, 전경색으로 바꾼다.
// 모드(포토샵과 같은 W3C 비분리 블렌드):
//   색상(기본) = 전경색의 색조·채도 + 원래 광도  → 명암·질감은 그대로, 색만 바뀜
//   색조 / 채도 / 광도 = 해당 성분만 전경색에서 가져옴
// 알파는 건드리지 않는다(투명 영역 잠금과 무관하게 안전).

import { hexToRgb } from "../engine/color.js";
import { ensureDefaults, DabPixelTool } from "./ext-tool-base.js";
import { colorReplaceDab } from "./tool-ext-math.js";

export class ColorReplaceTool extends DabPixelTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { colorReplaceTolerance: 64, colorReplaceMode: "color", colorReplaceSampling: "continuous" });
  }

  get label() { return "색상 대체"; }

  _beginStroke(pt) {
    const c = hexToRgb(this.state.foreground);
    this.fg = [c.r, c.g, c.b];
    this.ref = this._sample(pt.x, pt.y);
  }

  _dab(x, y, r) {
    const s = this.state;
    const ref = s.colorReplaceSampling === "once" ? this.ref : this._sample(x, y);
    if (!ref || ref[3] === 0) return null;
    return colorReplaceDab(this.work.data, this.before.data, this.layer.width, this.layer.height,
      x, y, r, s.brushHardness, ref, s.colorReplaceTolerance ?? 64, this.fg, s.colorReplaceMode || "color", this.str, this.selMask);
  }
}
