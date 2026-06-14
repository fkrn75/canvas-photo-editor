// color-panel.js — 전경/배경 색상 스와치 + 교환/기본값 + 색상 선택기.

import { EVT } from "../core/constants.js";

export class ColorPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._build();
    app.bus.on(EVT.COLOR_CHANGED, () => this._sync());
    app.bus.on(EVT.STATE_CHANGED, ({ key }) => {
      if (key === "foreground" || key === "background") this._sync();
    });
  }

  _build() {
    this.el.innerHTML = `
      <div class="swatch fg" title="전경색 (클릭하여 선택)"></div>
      <div class="swatch bg" title="배경색 (클릭하여 선택)"></div>
      <div class="swatch-swap" title="전경/배경 교환 (X)">⇄</div>
      <div class="swatch-reset" title="기본 흑백 (D)">◰</div>
      <input type="color" id="fg-picker" class="hidden">
      <input type="color" id="bg-picker" class="hidden">`;
    this.fg = this.el.querySelector(".fg");
    this.bg = this.el.querySelector(".bg");
    this.fgPick = this.el.querySelector("#fg-picker");
    this.bgPick = this.el.querySelector("#bg-picker");

    this.fg.addEventListener("click", () => this.fgPick.click());
    this.bg.addEventListener("click", () => this.bgPick.click());
    this.fgPick.addEventListener("input", (e) => this.app.state.set("foreground", e.target.value));
    this.bgPick.addEventListener("input", (e) => this.app.state.set("background", e.target.value));
    this.el.querySelector(".swatch-swap").addEventListener("click", () => this.app.state.swapColors());
    this.el.querySelector(".swatch-reset").addEventListener("click", () => this.app.state.resetColors());
    this._sync();
  }

  _sync() {
    const s = this.app.state;
    this.fg.style.background = s.foreground;
    this.bg.style.background = s.background;
    this.fgPick.value = s.foreground;
    this.bgPick.value = s.background;
  }
}
