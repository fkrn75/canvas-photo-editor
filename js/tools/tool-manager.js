// tool-manager.js — 도구 등록 + 캔버스 포인터/휠 이벤트 라우팅 + 도구 관련 단축키.
// 포인터 좌표를 월드 좌표로 변환해 활성 도구에 위임한다. 파일/편집 단축키(Ctrl 조합)는 app.js가 담당.

import { TOOL, ZOOM, EVT } from "../core/constants.js";
import { PaintTool } from "./paint-tool.js";
import { BucketTool } from "./bucket-tool.js";
import { EyedropperTool } from "./eyedropper-tool.js";
import { MoveTool } from "./move-tool.js";
import { ShapeTool } from "./shape-tool.js";
import { MarqueeTool } from "./marquee-tool.js";
import { LassoTool } from "./lasso-tool.js";
import { WandTool } from "./wand-tool.js";
import { HandTool } from "./hand-tool.js";
import { GradientTool } from "./gradient-tool.js";
import { ZoomTool } from "./zoom-tool.js";
import { CloneStampTool } from "./clone-stamp-tool.js";
import { DodgeBurnTool } from "./dodge-burn-tool.js";
import { BlurSharpenSmudgeTool } from "./blur-sharpen-smudge-tool.js";
import { PenTool } from "./pen-tool.js";
import { HistoryBrushTool } from "./history-brush-tool.js";
import { PatternStampTool } from "./pattern-stamp-tool.js";
import { TextToolV } from "../text/text-tool-v.js";
import { ShapeLayerTool } from "../layers/shape-layer-tool.js";
import { HealingBrushTool } from "./healing-brush-tool.js";
import { PatchTool } from "./patch-tool.js";
import { ArtHistoryBrushTool } from "./art-history-brush-tool.js";
import { ColorSamplerTool } from "./color-sampler-tool.js";
import { MeasureTool } from "./measure-tool.js";
import { NotesTool } from "./notes-tool.js";

// 단일 키 도구 단축키 (g는 버킷↔그라디언트 슬롯 순환이라 아래 keydown에서 별도 처리)
const KEYMAP = {
  v: TOOL.MOVE, m: TOOL.MARQUEE, l: TOOL.LASSO, w: TOOL.WAND,
  b: TOOL.BRUSH, n: TOOL.PENCIL, e: TOOL.ERASER,
  u: TOOL.SHAPE, t: TOOL.TEXT, h: TOOL.HAND, z: TOOL.ZOOM,
  s: TOOL.CLONE, o: TOOL.DODGEBURN, r: TOOL.RETOUCH,
  p: TOOL.PEN, a: TOOL.SHAPELAYER,
  j: TOOL.HISTORYBRUSH, y: TOOL.PATTERNSTAMP,
  k: TOOL.HEALING, c: TOOL.PATCH,
  f: TOOL.ARTHISTORY,
};

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export class ToolManager {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.tools = {};
    this.active = null;
    this.activeId = null;
    this._space = false;
    this._tempPan = false;
    this._down = false;
    this._register();
    this._bind();
  }

  _register() {
    const a = this.app;
    this.tools[TOOL.BRUSH] = new PaintTool(a, "brush");
    this.tools[TOOL.PENCIL] = new PaintTool(a, "pencil");
    this.tools[TOOL.ERASER] = new PaintTool(a, "eraser");
    this.tools[TOOL.BUCKET] = new BucketTool(a, TOOL.BUCKET);
    this.tools[TOOL.GRADIENT] = new GradientTool(a, TOOL.GRADIENT);
    this.tools[TOOL.EYEDROPPER] = new EyedropperTool(a, TOOL.EYEDROPPER);
    this.tools[TOOL.MOVE] = new MoveTool(a, TOOL.MOVE);
    this.tools[TOOL.SHAPE] = new ShapeTool(a, TOOL.SHAPE);
    this.tools[TOOL.TEXT] = new TextToolV(a, TOOL.TEXT);   // 재편집 가능 텍스트로 교체
    this.tools[TOOL.MARQUEE] = new MarqueeTool(a, TOOL.MARQUEE);
    this.tools[TOOL.LASSO] = new LassoTool(a, TOOL.LASSO);
    this.tools[TOOL.WAND] = new WandTool(a, TOOL.WAND);
    this.tools[TOOL.HAND] = new HandTool(a, TOOL.HAND);
    this.tools[TOOL.ZOOM] = new ZoomTool(a, TOOL.ZOOM);
    this.tools[TOOL.CLONE] = new CloneStampTool(a, TOOL.CLONE);
    this.tools[TOOL.DODGEBURN] = new DodgeBurnTool(a, TOOL.DODGEBURN);
    this.tools[TOOL.RETOUCH] = new BlurSharpenSmudgeTool(a, TOOL.RETOUCH);
    this.tools[TOOL.PEN] = new PenTool(a, TOOL.PEN);
    this.tools[TOOL.HISTORYBRUSH] = new HistoryBrushTool(a, TOOL.HISTORYBRUSH);
    this.tools[TOOL.PATTERNSTAMP] = new PatternStampTool(a, TOOL.PATTERNSTAMP);
    this.tools[TOOL.SHAPELAYER] = new ShapeLayerTool(a, TOOL.SHAPELAYER);
    this.tools[TOOL.HEALING] = new HealingBrushTool(a, TOOL.HEALING);
    this.tools[TOOL.PATCH] = new PatchTool(a, TOOL.PATCH);
    this.tools[TOOL.ARTHISTORY] = new ArtHistoryBrushTool(a, TOOL.ARTHISTORY);
    this.tools[TOOL.COLORSAMPLER] = new ColorSamplerTool(a, TOOL.COLORSAMPLER);
    this.tools[TOOL.MEASURE] = new MeasureTool(a, TOOL.MEASURE);
    this.tools[TOOL.NOTES] = new NotesTool(a, TOOL.NOTES);
  }

  setTool(id) {
    if (!this.tools[id]) return;
    if (this.active && this.active !== this.tools[id]) {
      // 드래그(포인터 다운) 도중 도구가 바뀌면 진행 중 작업을 안전 종료한다.
      // 미완료 픽셀 편집을 취소해(undo 오염/미리보기 확정 방지) 다음 도구가 깨끗한 상태에서 시작하게 한다.
      if (this._down) { this._down = false; this.app.history.cancelPixelEdit?.(); }
      this.active.onDeactivate?.();
    }
    this.activeId = id;
    this.active = this.tools[id];
    // state.set은 값이 같으면 이벤트를 생략하므로(초기 도구가 brush인 경우) 직접 설정 후 항상 발행한다.
    this.app.state.activeTool = id;
    this.app.bus.emit(EVT.TOOL_CHANGED, { tool: id });
    this.active.onActivate?.();
    this._applyCursor();
    this.app.renderer.requestRender();
  }

  _applyCursor() {
    this.canvas.style.cursor = this._space ? "grab" : (this.active?.cursor || "default");
  }

  // 포인터 이벤트 → {screen, world}
  _pt(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { screen: { x: sx, y: sy }, world: this.app.viewport.screenToWorld(sx, sy) };
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => {
      c.focus();
      // 중간 버튼 또는 스페이스 → 임시 팬
      if (e.button === 1 || this._space) {
        this._tempPan = true;
        c.setPointerCapture(e.pointerId);
        this._panLast = { x: e.clientX, y: e.clientY };
        c.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this._down = true;
      this.active?.onPointerDown(this._pt(e).world, e);
    });

    c.addEventListener("pointermove", (e) => {
      const { world } = this._pt(e);
      this.app.cursorInfo(world);
      if (this._tempPan) {
        const dx = e.clientX - this._panLast.x, dy = e.clientY - this._panLast.y;
        this._panLast = { x: e.clientX, y: e.clientY };
        this.app.viewport.pan(dx, dy);
        return;
      }
      this.active?.onPointerMove(world, e);
    });

    const endPointer = (e) => {
      if (this._tempPan) {
        this._tempPan = false;
        this._applyCursor();
        return;
      }
      if (!this._down) return;
      this._down = false;
      this.active?.onPointerUp(this._pt(e).world, e);
    };
    c.addEventListener("pointerup", endPointer);
    c.addEventListener("pointercancel", endPointer);
    c.addEventListener("pointerleave", () => this.active?.onLeave?.());

    // 휠 = 줌 (커서 지점 기준)
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const { screen } = this._pt(e);
      const factor = e.deltaY < 0 ? ZOOM.STEP : 1 / ZOOM.STEP;
      this.app.viewport.zoomAt(factor, screen.x, screen.y);
    }, { passive: false });

    c.addEventListener("contextmenu", (e) => e.preventDefault());

    // 도구 단축키
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      if (e.code === "Space" && !this._space) {
        this._space = true;
        if (!this._down) this._applyCursor();
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl 조합은 app이 처리
      const k = e.key.toLowerCase();
      if (k === "q") { // 빠른 마스크 모드 토글
        this.app.quickMask?.toggle();
        e.preventDefault(); return;
      }
      if (k === "g") { // G 슬롯: 페인트 버킷 ↔ 그라디언트 순환
        this.setTool(this.activeId === TOOL.BUCKET ? TOOL.GRADIENT : TOOL.BUCKET);
        e.preventDefault(); return;
      }
      if (k === "i") { // I 슬롯: 스포이드 → 색상 샘플러 → 측정 순환
        const order = [TOOL.EYEDROPPER, TOOL.COLORSAMPLER, TOOL.MEASURE];
        const cur = order.indexOf(this.activeId); // 슬롯 밖이면 -1 → 첫 도구로
        this.setTool(order[(cur + 1) % order.length]);
        e.preventDefault(); return;
      }
      if (KEYMAP[k]) { this.setTool(KEYMAP[k]); e.preventDefault(); return; }
      const s = this.app.state;
      if (e.key === "[") s.set("brushSize", Math.max(1, s.brushSize - 2));
      else if (e.key === "]") s.set("brushSize", Math.min(500, s.brushSize + 2));
      else if (k === "x") s.swapColors();
      else if (k === "d") s.resetColors();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") { this._space = false; this._applyCursor(); }
    });
  }
}
