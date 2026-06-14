// color-sampler-tool.js — 색상 샘플러. 캔버스에 최대 4개의 샘플 포인트를 놓고
// 각 지점의 "합성 결과(보이는 픽셀)" RGB 값을 캔버스 위에 칩으로 표시한다.
// 클릭=새 포인트 추가(또는 기존 포인트 잡아 이동), Alt+클릭=가까운 포인트 삭제.
// 포인트는 app.state.colorSamplers 배열(월드좌표 + 캐시된 rgb)에 보존된다.

import { BaseTool } from "./base-tool.js";
import { EVT } from "../core/constants.js";
import { rgbToHex } from "../engine/color.js";

const MAX_SAMPLERS = 4;       // 포토샵과 동일하게 최대 4개
const HIT_RADIUS = 10;        // 포인터 잡기 판정 반경(화면 px)

export class ColorSamplerTool extends BaseTool {
  constructor(app, id) {
    super(app, id);
    this._dragIndex = -1;   // 드래그 중인 샘플 인덱스(-1=없음)
    this._offLayers = null; // LAYERS_CHANGED 구독 해제 함수(활성 중에만 구독)
    // LAYERS_CHANGED 핸들러: 레이어 내용/구조가 바뀌면 보이는 색이 달라지므로 캐시를 다시 채운다.
    // 활성 중에만 구독하므로(onActivate↔onDeactivate 짝) 비활성 시 잔류하지 않는다.
    this._onLayersChanged = () => {
      this._resampleAll();
      this.app.renderer.requestRender();
    };
  }

  get cursor() { return "crosshair"; }

  // 상태 배열 보장(없으면 생성). 다른 모듈(state)에서 이미 만들어 두면 그대로 사용.
  get _samplers() {
    if (!Array.isArray(this.state.colorSamplers)) this.state.colorSamplers = [];
    return this.state.colorSamplers;
  }

  onActivate() {
    // 활성 중에만 LAYERS_CHANGED 구독(중복 방지: 이미 구독돼 있으면 재구독 안 함).
    if (!this._offLayers) this._offLayers = this.app.bus.on(EVT.LAYERS_CHANGED, this._onLayersChanged);
    // 활성화 시 기존 포인트 색을 최신 합성 결과로 갱신
    this._resampleAll();
    this.app.renderer.requestRender();
    this._showSummary();
  }

  onDeactivate() {
    // 비활성 시 구독 해제(리스너 잔류 방지). 등록/해제 짝을 맞춘다.
    if (this._offLayers) { this._offLayers(); this._offLayers = null; }
  }

  onPointerDown(pt, e) {
    const vp = this.app.viewport;
    const idx = this._hitTest(pt, vp);

    // Alt+클릭: 가까운 포인트 삭제
    if (e.altKey) {
      if (idx >= 0) {
        this._samplers.splice(idx, 1);
        this.app.status(`샘플 포인트 삭제 (남은 ${this._samplers.length}개)`);
        this.app.renderer.requestRender();
      }
      return;
    }

    if (idx >= 0) {
      // 기존 포인트 잡아 이동 시작
      this._dragIndex = idx;
    } else {
      // 새 포인트 추가(문서 영역 안쪽일 때만, 최대 개수 제한)
      if (!this._inDoc(pt)) return;
      if (this._samplers.length >= MAX_SAMPLERS) {
        this.app.status(`색상 샘플러는 최대 ${MAX_SAMPLERS}개까지 놓을 수 있습니다.`);
        return;
      }
      this._samplers.push({ x: Math.floor(pt.x), y: Math.floor(pt.y), rgb: null });
      this._dragIndex = this._samplers.length - 1;
    }
    // 누르는 순간 합성 결과 1회 캐시(드래그 중 재샘플 비용 절감) — 스포이드와 동일 패턴
    this._beginSampling();
    this._sampleOne(this._dragIndex);
    this.app.renderer.requestRender();
  }

  onPointerMove(pt, e) {
    if (this._dragIndex < 0 || !(e.buttons & 1)) return;
    const s = this._samplers[this._dragIndex];
    if (!s) return;
    // 문서 범위로 클램프(포인터가 캔버스 밖으로 나가도 포인트는 문서 안에 머문다)
    s.x = Math.max(0, Math.min(this.layers.width - 1, Math.floor(pt.x)));
    s.y = Math.max(0, Math.min(this.layers.height - 1, Math.floor(pt.y)));
    this._sampleOne(this._dragIndex);
    this.app.renderer.requestRender();
  }

  onPointerUp() {
    if (this._dragIndex >= 0) this._showSummary();
    this._dragIndex = -1;
    this._endSampling();
  }

  // onLeave는 정리하지 않는다: 포인터 캡처 중이라 pointerup이 항상 도착해 거기서 마무리한다.
  // (드래그 중 캔버스를 잠깐 벗어나도 포인트 이동이 끊기지 않도록)

  // ── 샘플링(합성 결과 읽기) ──
  // 비용이 큰 flatten을 묶어서 호출하기 위해 begin/end로 컨텍스트를 잡아둔다.
  _beginSampling() {
    const flat = this.layers.flatten();
    this._fctx = flat.getContext("2d", { willReadFrequently: true });
    this._fw = flat.width; this._fh = flat.height;
  }
  _endSampling() { this._fctx = null; }

  _sampleOne(i) {
    const s = this._samplers[i];
    if (!s) return;
    // 단발 호출에도 안전하도록 컨텍스트가 없으면 즉석에서 만든다
    const own = !this._fctx;
    if (own) this._beginSampling();
    const x = s.x, y = s.y;
    if (x >= 0 && y >= 0 && x < this._fw && y < this._fh) {
      const p = this._fctx.getImageData(x, y, 1, 1).data;
      s.rgb = [p[0], p[1], p[2]];
    } else {
      s.rgb = null;
    }
    if (own) this._endSampling();
  }

  _resampleAll() {
    if (this._samplers.length === 0) return;
    this._beginSampling();
    for (let i = 0; i < this._samplers.length; i++) this._sampleOne(i);
    this._endSampling();
  }

  // ── 히트 테스트/경계 ──
  // 화면 거리 기준으로 가장 가까운(반경 내) 포인트 인덱스를 찾는다. 없으면 -1.
  _hitTest(pt, vp) {
    const ps = vp.worldToScreen(pt.x, pt.y);
    let best = -1, bestD = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < this._samplers.length; i++) {
      const s = this._samplers[i];
      const ss = vp.worldToScreen(s.x + 0.5, s.y + 0.5);
      const dx = ss.x - ps.x, dy = ss.y - ps.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _inDoc(pt) {
    return pt.x >= 0 && pt.y >= 0 && pt.x < this.layers.width && pt.y < this.layers.height;
  }

  // ── 상태바 요약 ──
  _showSummary() {
    const n = this._samplers.length;
    if (n === 0) { this.app.status("클릭하여 색상 샘플러를 놓으세요 (최대 4개). Alt+클릭=삭제"); return; }
    const last = this._samplers[n - 1];
    if (last?.rgb) {
      this.app.status(`샘플 #${n}: R ${last.rgb[0]} G ${last.rgb[1]} B ${last.rgb[2]}  (${rgbToHex(...last.rgb)})`);
    }
  }

  // ── 오버레이: 각 포인트에 십자 표적 + 번호/RGB 칩 ──
  drawOverlay(ctx, vp) {
    const arr = this._samplers;
    if (arr.length === 0) return;

    ctx.save();
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";

    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      const p = vp.worldToScreen(s.x + 0.5, s.y + 0.5);
      const px = Math.round(p.x) + 0.5, py = Math.round(p.y) + 0.5;

      // 십자 표적(흰 테두리 + 검은 심) — 어떤 배경에서도 보이도록 2중선
      const R = 7;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.9)";
      this._crosshair(ctx, px, py, R);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.9)";
      this._crosshair(ctx, px, py, R);

      // 정보 칩: "#n  R,G,B" + 색 견본 사각형
      const rgb = s.rgb;
      const label = `#${i + 1}` + (rgb ? `  ${rgb[0]},${rgb[1]},${rgb[2]}` : "");
      const padX = 5, padY = 3, sw = rgb ? 12 : 0, gap = rgb ? 5 : 0;
      const tw = ctx.measureText(label).width;
      const boxW = padX * 2 + sw + gap + tw;
      const boxH = 18;
      // 칩 위치: 표적 우측 상단(화면 밖으로 넘치면 좌측/아래로 보정)
      let bx = px + R + 4, by = py - boxH - R - 2;
      if (bx + boxW > vp.cssWidth) bx = px - R - 4 - boxW;
      if (by < 0) by = py + R + 4;

      // 칩 배경
      ctx.fillStyle = "rgba(20,20,20,0.82)";
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      this._roundRect(ctx, bx, by, boxW, boxH, 3);
      ctx.fill(); ctx.stroke();

      // 색 견본
      let tx = bx + padX;
      if (rgb) {
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(bx + padX, by + (boxH - sw) / 2, sw, sw);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.strokeRect(bx + padX + 0.5, by + (boxH - sw) / 2 + 0.5, sw - 1, sw - 1);
        tx += sw + gap;
      }
      // 라벨 텍스트
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx, by + padY + 1);
    }
    ctx.restore();
  }

  _crosshair(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x - 2, y);
    ctx.moveTo(x + 2, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2); ctx.lineTo(x, y + r);
    ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
