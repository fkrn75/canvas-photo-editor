// crop-tool.js — 자르기 도구(Crop, C).
//
// 사용법: 드래그로 자를 영역 지정 → 8개 핸들로 크기 조절 / 안쪽 드래그로 이동 → Enter(또는 안쪽 더블클릭,
// 옵션바 [자르기])로 확정, Esc(또는 [취소])로 취소. 영역 밖은 어둡게 덮어 결과를 미리 보여 준다.
// 옵션바 비율(자유/1:1/4:3/…)을 고르면 드래그·핸들 조절이 그 비율로 고정된다(자유 비율에서 Shift=정사각).
//
// 확정은 DocTransformVectorCommand(재단 trimDocument와 같은 경로)라 undo/redo 한 단계로 되돌린다.
// 레이어 마스크는 Layer.resizeCanvas가 같은 오프셋으로 함께 잘라 주고, 텍스트/셰이프/벡터 마스크 좌표와
// 가이드(state.guides)도 같은 오프셋만큼 평행 이동한다(가이드는 문서 밖이면 제거, undo 시 복원).

import { BaseTool } from "./base-tool.js";
import { EVT } from "../core/constants.js";
import { DocTransformVectorCommand } from "../history/commands/layer-image-commands.js";
import { scaleVectorText, scaleVectorShape, scaleVectorMask } from "../engine/layer-image-ops.js";
import { ensureDefaults } from "./ext-tool-base.js";
import { parseRatio, cropRectFromDrag, resizeCropRect, applyRatioToRect, roundCropRect } from "./tool-ext-math.js";

// 레이어의 벡터 소스(텍스트/셰이프/벡터 마스크)를 (dx,dy)만큼 평행 이동 — trimDocument(doc-ops.js)와 같은 규칙
function shiftVectors(L, dx, dy) {
  const xf = { sx: 1, sy: 1, dx, dy };
  if (L.vectorText) L.vectorText = scaleVectorText(L.vectorText, xf);
  if (L.vectorShape) L.vectorShape = scaleVectorShape(L.vectorShape, xf);
  if (L.vectorMask) L.vectorMask = scaleVectorMask(L.vectorMask, xf);
}

// 자르기에 따른 가이드 갱신(순수): 자른 영역 원점 (bx,by)만큼 이동하고, 새 문서(w×h) 밖이면 제거.
// 가이드 형식: {orient:'h'|'v', pos} — v=수직선=문서 x, h=수평선=문서 y.
export function cropGuides(guides, bx, by, w, h) {
  const out = [];
  for (const g of guides || []) {
    const pos = g.orient === "v" ? g.pos - bx : g.pos - by;
    const max = g.orient === "v" ? w : h;
    if (pos < 0 || pos > max) continue;
    out.push({ ...g, pos });
  }
  return out;
}

// 자르기 커맨드: 픽셀·마스크·벡터 좌표(DocTransformVectorCommand)에 더해 가이드도 함께 undo/redo 한다.
class CropCommand extends DocTransformVectorCommand {
  constructor(lm, app, b) {
    super(lm, "자르기", (lm) => {
      // resizeCanvas(새W, 새H, dx, dy): 픽셀과 마스크를 (−x,−y)만큼 옮겨 새 크기로 — 즉 잘라내기
      for (const L of lm.layers) {
        L.resizeCanvas(b.w, b.h, -b.x, -b.y);
        shiftVectors(L, -b.x, -b.y);
        L.thumbDirty = true;
      }
      lm.width = b.w; lm.height = b.h;
    });
    this.app = app;
    this.b = b;
    this.guidesBefore = (app.state.guides || []).map((g) => ({ ...g }));
  }
  _setGuides(list) {
    const st = this.app.state;
    st.guides = list;
    this.app.bus.emit(EVT.STATE_CHANGED, { key: "guides", value: st.guides });
  }
  redo() {
    super.redo();
    this._setGuides(cropGuides(this.guidesBefore, this.b.x, this.b.y, this.b.w, this.b.h));
  }
  undo() {
    super.undo();
    this._setGuides(this.guidesBefore.map((g) => ({ ...g })));
  }
}

const HANDLE_CURSOR = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move",
};

export class CropTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    ensureDefaults(app.state, { cropRatio: "free" });
    this.rect = null;   // 현재 자르기 영역(문서 좌표, 실수) {x,y,w,h}
    this.drag = null;   // 진행 중 드래그 {mode:"new"|핸들명|"move", ax, ay, start, r0}
    this._lastDown = 0;

    // 비율을 바꾸면 기존 영역을 새 비율에 맞춘다
    app.bus.on(EVT.STATE_CHANGED, ({ key }) => {
      if (key !== "cropRatio" || !this.rect) return;
      const r = parseRatio(this.state.cropRatio);
      if (r) this.rect = applyRatioToRect(this.rect, r, this.layers.width, this.layers.height);
      this.app.renderer.requestOverlayRender();
    });
    // 문서 크기가 바뀌면(undo/다른 변형) 영역이 무의미해지므로 버린다
    app.bus.on(EVT.DOCUMENT_CHANGED, () => { this.rect = null; this.drag = null; });
  }

  get cursor() { return "crosshair"; }

  get hasRect() { return !!this.rect; }

  _ratio(e) {
    const r = parseRatio(this.state.cropRatio);
    if (!r && e?.shiftKey) return 1; // 자유 비율 + Shift = 정사각
    return r;
  }

  // 월드 좌표 pt가 어느 핸들/안쪽에 있는지. 핸들 판정 반경은 화면 7px.
  _hit(pt) {
    const r = this.rect;
    if (!r) return null;
    const tol = 7 / this.app.viewport.zoom;
    const xs = { w: r.x, c: r.x + r.w / 2, e: r.x + r.w };
    const ys = { n: r.y, c: r.y + r.h / 2, s: r.y + r.h };
    const cand = [
      ["nw", xs.w, ys.n], ["ne", xs.e, ys.n], ["se", xs.e, ys.s], ["sw", xs.w, ys.s],
      ["n", xs.c, ys.n], ["s", xs.c, ys.s], ["e", xs.e, ys.c], ["w", xs.w, ys.c],
    ];
    for (const [name, hx, hy] of cand) {
      if (Math.abs(pt.x - hx) <= tol && Math.abs(pt.y - hy) <= tol) return name;
    }
    if (pt.x > r.x && pt.x < r.x + r.w && pt.y > r.y && pt.y < r.y + r.h) return "move";
    return null;
  }

  _setCanvasCursor(c) {
    const cv = this.app.tools?.canvas;
    if (cv && !this.app.tools._space) cv.style.cursor = c || this.cursor;
  }

  onPointerDown(pt, e) {
    if (!this.layers.activeLayer && !this.layers.layers?.length) return;
    const now = performance.now();
    const hit = this._hit(pt);
    // 안쪽 더블클릭 = 확정
    if (hit === "move" && now - this._lastDown < 350) { this._lastDown = 0; this.commit(); return; }
    this._lastDown = now;

    if (hit) {
      this.drag = { mode: hit, start: { x: pt.x, y: pt.y }, r0: { ...this.rect } };
    } else {
      const W = this.layers.width, H = this.layers.height;
      this.drag = { mode: "new", ax: Math.max(0, Math.min(W, pt.x)), ay: Math.max(0, Math.min(H, pt.y)) };
      this.rect = null;
    }
    this.app.renderer.requestOverlayRender();
  }

  onPointerMove(pt, e) {
    const W = this.layers.width, H = this.layers.height;
    if (!this.drag) {
      this._setCanvasCursor(HANDLE_CURSOR[this._hit(pt)]);
      return;
    }
    const d = this.drag;
    if (d.mode === "new") {
      this.rect = cropRectFromDrag(d.ax, d.ay, pt.x, pt.y, this._ratio(e), W, H);
    } else {
      // 핸들 조절은 옵션바 비율만 따른다(Shift 정사각은 새로 그릴 때만)
      this.rect = resizeCropRect(d.r0, d.mode, pt.x - d.start.x, pt.y - d.start.y, parseRatio(this.state.cropRatio), W, H);
    }
    this.app.renderer.requestOverlayRender();
  }

  onPointerUp(pt, e) {
    if (!this.drag) return;
    const wasNew = this.drag.mode === "new";
    this.drag = null;
    // 클릭만 한(아주 작은) 새 영역은 버린다
    if (this.rect && (this.rect.w < 1 || this.rect.h < 1)) this.rect = null;
    if (wasNew && this.rect) this.app.status("핸들로 조절 후 Enter=자르기, Esc=취소");
    this.app.renderer.requestOverlayRender();
  }

  // ToolManager가 전달하는 키. 처리했으면 true.
  onKeyDown(e) {
    if (!this.rect) return false;
    if (e.key === "Enter") { this.commit(); return true; }
    if (e.key === "Escape") { this.cancel(); return true; }
    return false;
  }

  onDeactivate() {
    // 다른 도구로 바꾸면 확정하지 않은 영역은 취소(포토샵은 묻지만 여기선 조용히 버린다)
    this.rect = null;
    this.drag = null;
  }

  cancel() {
    this.rect = null;
    this.drag = null;
    this.app.renderer.requestOverlayRender();
  }

  // 현재 영역으로 문서 전체 자르기(undo 가능)
  commit() {
    const W = this.layers.width, H = this.layers.height;
    const b = roundCropRect(this.rect, W, H);
    this.rect = null;
    this.drag = null;
    if (!b) { this.app.status("자를 영역을 먼저 드래그하세요."); this.app.renderer.requestOverlayRender(); return; }
    if (b.x === 0 && b.y === 0 && b.w === W && b.h === H) {
      this.app.status("영역이 문서 전체와 같아 자르지 않았습니다.");
      this.app.renderer.requestOverlayRender();
      return;
    }
    this.history.execute(new CropCommand(this.layers, this.app, b));
    this.selection.clear();
    this.app.viewport.fit(b.w, b.h);
    this.app.status(`자르기: ${b.w} × ${b.h}px`);
  }

  drawOverlay(ctx, vp) {
    const r = this.rect;
    if (!r) return;
    const W = this.layers.width, H = this.layers.height;
    const a = vp.worldToScreen(0, 0), b = vp.worldToScreen(W, H);
    const p = vp.worldToScreen(r.x, r.y), q = vp.worldToScreen(r.x + r.w, r.y + r.h);
    const pw = q.x - p.x, ph = q.y - p.y;
    ctx.save();
    // 1) 영역 밖(문서 안) 어둡게 — evenodd로 구멍 뚫기
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.rect(p.x, p.y, pw, ph);
    ctx.fill("evenodd");
    // 2) 삼분할 안내선
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k <= 2; k++) {
      const gx = Math.round(p.x + (pw * k) / 3) + 0.5, gy = Math.round(p.y + (ph * k) / 3) + 0.5;
      ctx.moveTo(gx, p.y); ctx.lineTo(gx, q.y);
      ctx.moveTo(p.x, gy); ctx.lineTo(q.x, gy);
    }
    ctx.stroke();
    // 3) 테두리(흰+검 2중으로 어떤 배경에서도 보이게)
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeRect(Math.round(p.x) - 0.5, Math.round(p.y) - 0.5, Math.round(pw) + 1, Math.round(ph) + 1);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
    // 4) 핸들 8개
    const hs = 7;
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    for (const [hx, hy] of [[p.x, p.y], [mx, p.y], [q.x, p.y], [q.x, my], [q.x, q.y], [mx, q.y], [p.x, q.y], [p.x, my]]) {
      ctx.fillRect(Math.round(hx - hs / 2), Math.round(hy - hs / 2), hs, hs);
      ctx.strokeRect(Math.round(hx - hs / 2) + 0.5, Math.round(hy - hs / 2) + 0.5, hs - 1, hs - 1);
    }
    // 5) 크기 표시
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    ctx.font = "11px sans-serif";
    const tw = ctx.measureText(label).width + 8;
    const lx = q.x - tw, ly = q.y + 6;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(lx, ly, tw, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, lx + 4, ly + 12);
    ctx.restore();
  }
}
