// free-transform.js — 자유 변형(Free Transform). 선택 영역(없으면 활성 레이어의 비투명 bbox)
// 픽셀을 임시 캔버스로 떠서 바운딩박스 8핸들 + 회전으로 자유롭게 변형한다.
//
// 모드(핸들/수정자 조합):
//   Scale       : 핸들 드래그 (Shift=비율유지, Alt=중심기준)
//   Rotate      : 바운딩박스 바깥 드래그
//   Skew        : Ctrl + 변(edge) 핸들
//   Distort     : Ctrl + 코너 핸들 (개별 코너 자유 이동)
//   Perspective : Ctrl+Alt+Shift + 코너 핸들 (대칭 사다리꼴)
//
// commit()(Enter): 원본 영역을 지우고 변형 결과를 레이어에 합성 + 히스토리.
// cancel()(Esc): 원본 복원.
//
// [입력 라우팅] FreeTransform은 도구가 아니라 모달 오버레이라서, 활성화 시 캔버스에
// capture-phase 포인터 리스너를 직접 달고 stopImmediatePropagation으로 tool-manager의
// (bubble-phase) 도구 위임을 차단한다. → tool-manager.js를 건드리지 않는다.

// 핸들 식별자. 코너 4 + 변 4.
const HANDLES = ["tl", "tr", "br", "bl", "t", "r", "b", "l"];

// 화면상 핸들 정사각형 한 변 크기(px)와 히트 테스트 여유.
const HANDLE_SIZE = 8;
const HIT_PAD = 6;
// 회전 히트 영역: 바운딩박스 밖으로 이 정도(px) 이내면 회전으로 본다(코너 근처 우선).
const ROTATE_BAND = 28;

export class FreeTransform {
  constructor(app) {
    this.app = app;
    this.active = false;

    this.layer = null;        // 변형 대상 레이어
    this.before = null;       // 원본 전체 픽셀(ImageData) — cancel/commit 기준
    this.src = null;          // 떠낸 변형 소스(임시 캔버스, 잘라낸 픽셀만)
    this.srcRect = null;      // 소스가 차지했던 원본 영역 {x,y,w,h} (문서 좌표)
    this.useSelectionMask = false; // 선택 영역으로 떠냈는지(커밋 시 마스크 클립 사용)

    // 변형 상태
    // corners: 변형 결과 사각형의 네 꼭짓점(문서 좌표). 순서 [tl, tr, br, bl].
    this.corners = null;
    // 회전 각(라디안)·중심·반(half) 크기 — 어파인(scale/rotate/skew) 모드의 파라미터.
    // distort/perspective는 corners를 직접 조작하므로 이 값과 분리될 수 있다.
    this.angle = 0;

    // 드래그 진행 상태
    this._drag = null;        // { handle, startWorld, startCorners, startAngle, center, mode }

    // 캡처용 핸들러(바인딩 보관 → 정확히 같은 참조로 remove)
    this._onDown = this._onPointerDown.bind(this);
    this._onMove = this._onPointerMove.bind(this);
    this._onUp = this._onPointerUp.bind(this);
  }

  get canvasEl() { return this.app.canvas; }
  get vp() { return this.app.viewport; }

  // ── 시작 ──
  // 선택 영역이 있으면 그 영역, 없으면 활성 레이어의 비투명 픽셀 bbox를 떠서 변형을 시작한다.
  start() {
    if (this.active) return; // 이미 변형 중이면 무시
    const layer = this.app.layers.activeLayer;
    if (!layer) { this.app.status("레이어가 없습니다."); return; }
    if (!layer.visible) { this.app.status("숨겨진 레이어는 변형할 수 없습니다."); return; }
    if (layer.lockImage) { this.app.status("이미지가 잠겨 있어 변형할 수 없습니다."); return; }

    const sel = this.app.selection;
    let rect, mask = null;
    if (sel.active && sel.bounds) {
      rect = { ...sel.bounds };
      mask = sel.mask;
      this.useSelectionMask = true;
    } else {
      rect = this._opaqueBounds(layer);
      this.useSelectionMask = false;
      if (!rect) { this.app.status("변형할 픽셀이 없습니다."); return; }
    }

    // 소스 캔버스: rect 크기로 떠낸다. 선택 영역이면 마스크로 가려 영역 밖 픽셀을 제거.
    const srcC = document.createElement("canvas");
    srcC.width = rect.w; srcC.height = rect.h;
    const sctx = srcC.getContext("2d", { willReadFrequently: true });
    const cut = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    if (mask) this._applyMaskToCut(cut, mask, rect);
    sctx.putImageData(cut, 0, 0);

    this.layer = layer;
    this.before = layer.snapshot();   // 전체 원본(커밋/취소 기준)
    this.src = srcC;
    this.srcRect = rect;
    this.angle = 0;
    // 초기 corners = rect 그대로(문서 좌표). [tl, tr, br, bl]
    this.corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ];

    // 변형 미리보기를 위해 원본 영역을 즉시 비운다(겹쳐 보이지 않게).
    this._clearSourceArea();

    this.active = true;
    // capture-phase로 캔버스 포인터를 가로챈다(tool-manager보다 먼저).
    const c = this.canvasEl;
    c.addEventListener("pointerdown", this._onDown, true);
    c.addEventListener("pointermove", this._onMove, true);
    c.addEventListener("pointerup", this._onUp, true);
    c.addEventListener("pointercancel", this._onUp, true);

    this.app.status("자유 변형: 드래그로 조절, Enter 적용 · Esc 취소 (Ctrl=왜곡/기울이기)");
    this.app.renderer.requestRender();
  }

  // 활성 레이어에서 알파>0 픽셀의 bounding box를 구한다. 없으면 null.
  _opaqueBounds(layer) {
    const W = layer.width, H = layer.height;
    const d = layer.ctx.getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (d[i * 4 + 3] > 0) {
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // 떠낸 픽셀(cut, rect 크기)에 선택 마스크(문서 전체 Uint8Array)를 곱해 영역 밖을 투명화.
  _applyMaskToCut(cut, mask, rect) {
    const W = this.app.layers.width;
    const d = cut.data;
    for (let row = 0; row < rect.h; row++) {
      for (let col = 0; col < rect.w; col++) {
        const m = mask[(rect.y + row) * W + (rect.x + col)];
        if (m < 255) {
          const i = (row * rect.w + col) * 4;
          // 부분 선택(0~255)은 알파에 곱해 부드러운 경계 유지
          d[i + 3] = (d[i + 3] * m / 255) | 0;
        }
      }
    }
  }

  // 원본 영역을 레이어에서 지운다(변형 미리보기와 겹치지 않도록).
  // 선택 마스크가 있으면 그 영역만, 없으면 srcRect 사각형을 지운다.
  _clearSourceArea() {
    const ctx = this.layer.ctx;
    if (this.useSelectionMask && this.app.selection.mask) {
      const r = this.srcRect, W = this.app.layers.width;
      const mask = this.app.selection.mask;
      const img = ctx.getImageData(r.x, r.y, r.w, r.h);
      const d = img.data;
      for (let row = 0; row < r.h; row++) {
        for (let col = 0; col < r.w; col++) {
          const m = mask[(r.y + row) * W + (r.x + col)];
          if (m > 0) {
            const i = (row * r.w + col) * 4;
            d[i + 3] = (d[i + 3] * (255 - m) / 255) | 0;
          }
        }
      }
      ctx.putImageData(img, r.x, r.y);
    } else {
      ctx.clearRect(this.srcRect.x, this.srcRect.y, this.srcRect.w, this.srcRect.h);
    }
    this.layer.thumbDirty = true;
  }

  // ── 종료: 적용 ──
  commit() {
    if (!this.active) return;
    const layer = this.layer;
    // 히스토리: 변형 전 전체 스냅샷(this.before)을 기준으로 PaintCommand 생성.
    // beginPixelEdit가 현재(원본 영역이 지워진) 상태를 떠버리면 안 되므로,
    // before를 직접 넣고 변형 결과를 그린 뒤 커밋한다.
    this.app.history._peLayer = layer;
    this.app.history._peBefore = this.before;

    // 변형 결과를 레이어에 합성(원본 영역은 start에서 이미 지움).
    this._renderTransformed(layer.ctx);
    layer.thumbDirty = true;

    // 변경 영역 = 원본 영역 ∪ 변형 결과 bbox (둘 다 포함해 저장).
    const box = this._dirtyBox();
    this.app.history.commitPixelEdit(box, "자유 변형");

    this.app.selection.clear(); // 변형 후 선택은 해제(픽셀 위치가 바뀌었으므로)
    this._teardown();
    this.app.status("자유 변형 적용");
  }

  // ── 종료: 취소 ──
  cancel() {
    if (!this.active) return;
    // 원본 전체 복원
    this.layer.ctx.putImageData(this.before, 0, 0);
    this.layer.thumbDirty = true;
    this.app.layers.notifyContent(this.layer.id);
    this._teardown();
    this.app.status("자유 변형 취소");
  }

  _teardown() {
    const c = this.canvasEl;
    c.removeEventListener("pointerdown", this._onDown, true);
    c.removeEventListener("pointermove", this._onMove, true);
    c.removeEventListener("pointerup", this._onUp, true);
    c.removeEventListener("pointercancel", this._onUp, true);
    this.active = false;
    this.layer = null;
    this.before = null;
    this.src = null;
    this.srcRect = null;
    this.corners = null;
    this._drag = null;
    this.app.renderer.requestRender();
  }

  // 변형 전(원본 영역) + 변형 후(corners bbox)를 합친 변경 영역(문서 좌표) → 히스토리 저장 범위.
  _dirtyBox() {
    let minX = this.srcRect.x, minY = this.srcRect.y;
    let maxX = this.srcRect.x + this.srcRect.w, maxY = this.srcRect.y + this.srcRect.h;
    for (const p of this.corners) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    // 픽셀 정수 경계로 약간 여유
    const x = Math.floor(minX) - 1, y = Math.floor(minY) - 1;
    const w = Math.ceil(maxX) - x + 1, h = Math.ceil(maxY) - y + 1;
    return { x, y, w, h };
  }

  // ───────────────────────────────────────────────────────────
  // 변형 결과 렌더링: corners(문서 좌표)에 src 이미지를 매핑해 그린다.
  // - 어파인(평행사변형: tl,tr,br,bl이 평행사변형이면) → setTransform 한 번.
  // - 비어파인(왜곡/원근 사다리꼴) → 사각형을 2개 삼각형으로 나눠 텍스처 매핑.
  // ctx는 문서 좌표계(1:1)여야 한다(레이어 ctx).
  // ───────────────────────────────────────────────────────────
  _renderTransformed(ctx) {
    const [tl, tr, br, bl] = this.corners;
    if (this._isAffine()) {
      this._drawAffine(ctx, tl, tr, bl);
    } else {
      // 두 삼각형으로 분할: (tl, tr, br) + (tl, br, bl)
      this._drawTexturedTriangle(ctx, this.src,
        { x: 0, y: 0 }, { x: this.src.width, y: 0 }, { x: this.src.width, y: this.src.height },
        tl, tr, br);
      this._drawTexturedTriangle(ctx, this.src,
        { x: 0, y: 0 }, { x: this.src.width, y: this.src.height }, { x: 0, y: this.src.height },
        tl, br, bl);
    }
  }

  // corners가 평행사변형인가(왜곡/원근이 아니라 scale/rotate/skew 결과인가).
  // tl+br ≈ tr+bl 이면 평행사변형(대각선 중점이 일치).
  _isAffine() {
    const [tl, tr, br, bl] = this.corners;
    const mx1 = (tl.x + br.x) / 2, my1 = (tl.y + br.y) / 2;
    const mx2 = (tr.x + bl.x) / 2, my2 = (tr.y + bl.y) / 2;
    return Math.abs(mx1 - mx2) < 0.5 && Math.abs(my1 - my2) < 0.5;
  }

  // 평행사변형 어파인 매핑: 소스 (0,0)-(w,0)-(0,h) → (tl, tr, bl).
  _drawAffine(ctx, tl, tr, bl) {
    const w = this.src.width, h = this.src.height;
    // 변환: [a c e; b d f] 에서
    //   (0,0)->tl, (w,0)->tr, (0,h)->bl
    const a = (tr.x - tl.x) / w;
    const b = (tr.y - tl.y) / w;
    const c = (bl.x - tl.x) / h;
    const d = (bl.y - tl.y) / h;
    const e = tl.x;
    const f = tl.y;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(this.src, 0, 0);
    ctx.restore();
  }

  // 텍스처 삼각형 매핑: 소스 삼각형(s0,s1,s2)을 대상 삼각형(d0,d1,d2)으로 어파인 변환해 그린다.
  // 대상 삼각형으로 클립한 뒤, 두 삼각형을 일치시키는 어파인 행렬을 setTransform으로 적용.
  // (원근/왜곡 사다리꼴을 부분 어파인 조각으로 근사 — 순수 Canvas2D로 CSP 안전)
  _drawTexturedTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
    ctx.save();
    // 대상 삼각형으로 클립
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();

    // 소스→대상 어파인 행렬 풀이.
    // [d0 d1 d2] = M * [s0 s1 s2] (동차). 소스 기저행렬의 역행렬로 M을 구한다.
    const x0 = s0.x, y0 = s0.y, x1 = s1.x, y1 = s1.y, x2 = s2.x, y2 = s2.y;
    const det = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
    if (Math.abs(det) < 1e-6) { ctx.restore(); return; } // 퇴화 삼각형

    const u0 = d0.x, v0 = d0.y, u1 = d1.x, v1 = d1.y, u2 = d2.x, v2 = d2.y;
    // 어파인 계수 (a,b,c,d,e,f): u = a*x + c*y + e, v = b*x + d*y + f
    const a = (u0 * (y1 - y2) - u1 * (y0 - y2) + u2 * (y0 - y1)) / det;
    const c = (x0 * (u1 - u2) - x1 * (u0 - u2) + x2 * (u0 - u1)) / det;
    const e = (x0 * (y1 * u2 - y2 * u1) - x1 * (y0 * u2 - y2 * u0) + x2 * (y0 * u1 - y1 * u0)) / det;
    const b = (v0 * (y1 - y2) - v1 * (y0 - y2) + v2 * (y0 - y1)) / det;
    const d = (x0 * (v1 - v2) - x1 * (v0 - v2) + x2 * (v0 - v1)) / det;
    const f = (x0 * (y1 * v2 - y2 * v1) - x1 * (y0 * v2 - y2 * v0) + x2 * (y0 * v1 - y1 * v0)) / det;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(a, b, c, d, e, f);
    // 클립 경계의 미세 틈(삼각형 사이 솔기) 완화를 위해 약간 확장해 그린다.
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // ───────────────────────────────────────────────────────────
  // 포인터 입력 (capture-phase: tool-manager보다 먼저 가로채 차단)
  // ───────────────────────────────────────────────────────────
  _ptWorld(e) {
    const r = this.canvasEl.getBoundingClientRect();
    return this.vp.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _onPointerDown(e) {
    if (!this.active) return;
    if (e.button !== 0) return; // 좌클릭만(팬/우클릭은 통과시키지 않고 무시)
    e.stopImmediatePropagation(); // tool-manager(bubble) 차단
    e.preventDefault();
    this.canvasEl.setPointerCapture(e.pointerId);

    const w = this._ptWorld(e);
    const hit = this._hitTest(w);
    const center = this._center();
    this._drag = {
      handle: hit,                 // "tl".."l" | "rotate" | "move" | null
      startWorld: w,
      startCorners: this.corners.map((p) => ({ ...p })),
      startAngle: this.angle,
      center,
      startAngleToPointer: Math.atan2(w.y - center.y, w.x - center.x),
    };
  }

  _onPointerMove(e) {
    if (!this.active) return;
    e.stopImmediatePropagation();
    if (!this._drag) {
      // 드래그 전: 호버에 따라 커서만 갱신
      this._updateCursor(this._ptWorld(e), e);
      return;
    }
    e.preventDefault();
    const w = this._ptWorld(e);
    const dr = this._drag;

    if (dr.handle === "rotate") {
      this._applyRotate(w, dr, e);
    } else if (dr.handle === "move" || dr.handle === null) {
      this._applyMove(w, dr);
    } else if (e.ctrlKey && e.altKey && e.shiftKey && this._isCorner(dr.handle)) {
      this._applyPerspective(w, dr);
    } else if (e.ctrlKey && this._isCorner(dr.handle)) {
      this._applyDistort(w, dr);
    } else if (e.ctrlKey && this._isEdge(dr.handle)) {
      this._applySkew(w, dr, e);
    } else {
      this._applyScale(w, dr, e);
    }
    this.app.renderer.requestRender();
  }

  _onPointerUp(e) {
    if (!this.active) return;
    e.stopImmediatePropagation();
    if (this._drag) {
      try { this.canvasEl.releasePointerCapture(e.pointerId); } catch {}
      this._drag = null;
    }
  }

  _isCorner(h) { return h === "tl" || h === "tr" || h === "br" || h === "bl"; }
  _isEdge(h) { return h === "t" || h === "r" || h === "b" || h === "l"; }

  // 핸들 8개의 현재 문서 좌표를 반환(코너는 corners 그대로, 변은 인접 코너 중점).
  _handlePoints() {
    const [tl, tr, br, bl] = this.corners;
    return {
      tl, tr, br, bl,
      t: { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 },
      r: { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 },
      b: { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 },
      l: { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 },
    };
  }

  _center() {
    const [tl, , br] = this.corners;
    return { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
  }

  // 월드 좌표 w가 어떤 핸들/영역에 해당하는지. 화면 픽셀 기준 거리로 판정.
  // 우선순위: 코너/변 핸들 → 박스 안(move) → 박스 밖 회전 밴드(rotate) → null.
  _hitTest(w) {
    const sp = this.vp.worldToScreen(w.x, w.y);
    const pts = this._handlePoints();
    const pad = (HANDLE_SIZE / 2 + HIT_PAD);
    for (const h of HANDLES) {
      const hp = this.vp.worldToScreen(pts[h].x, pts[h].y);
      if (Math.abs(sp.x - hp.x) <= pad && Math.abs(sp.y - hp.y) <= pad) return h;
    }
    // 박스 내부면 이동
    if (this._pointInQuad(w, this.corners)) return "move";
    // 박스 근처(밖) 회전 밴드
    if (this._nearBox(sp, ROTATE_BAND)) return "rotate";
    return null;
  }

  // 점(월드)이 사각형(평행/사다리꼴 모두) 내부인지 — 네 변에 대한 부호 일관성 검사.
  _pointInQuad(p, quad) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross !== 0) {
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s; else if (s !== sign) return false;
      }
    }
    return true;
  }

  // 화면 좌표 sp가 바운딩박스 외곽선에서 band(px) 이내인지(회전 핸들 영역 판정용).
  _nearBox(sp, band) {
    const c = this.corners.map((p) => this.vp.worldToScreen(p.x, p.y));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return sp.x >= minX - band && sp.x <= maxX + band &&
           sp.y >= minY - band && sp.y <= maxY + band;
  }

  // ── 각 변형 적용 ──

  // 전체 이동: 모든 코너를 동일 델타만큼 평행이동.
  _applyMove(w, dr) {
    const dx = w.x - dr.startWorld.x, dy = w.y - dr.startWorld.y;
    this.corners = dr.startCorners.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  // 회전: 중심 기준으로 시작 corners를 (현재각 − 시작각)만큼 회전.
  // Shift: 15° 스냅.
  _applyRotate(w, dr, e) {
    const cur = Math.atan2(w.y - dr.center.y, w.x - dr.center.x);
    let delta = cur - dr.startAngleToPointer;
    if (e.shiftKey) {
      const snap = Math.PI / 12; // 15°
      delta = Math.round((dr.startAngle + delta) / snap) * snap - dr.startAngle;
    }
    this.angle = dr.startAngle + delta;
    this.corners = dr.startCorners.map((p) => this._rotatePt(p, dr.center, delta));
  }

  _rotatePt(p, c, ang) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  }

  // 스케일: 핸들을 끌어 박스를 늘린다. 회전된 상태에서도 자연스럽도록
  // "회전 해제(로컬) 좌표계"에서 너비/높이를 조정한 뒤 다시 회전해 corners를 재구성.
  //   Shift = 비율 유지, Alt = 중심 고정(반대편도 함께 늘어남).
  _applyScale(w, dr, e) {
    const ang = dr.startAngle;
    const c0 = this._quadCenter(dr.startCorners);
    // 시작 corners를 로컬(축정렬) 좌표로 환원
    const local = dr.startCorners.map((p) => this._toLocal(p, c0, ang));
    // 로컬 박스 경계
    let x0 = local[0].x, y0 = local[0].y, x1 = local[2].x, y1 = local[2].y;
    // (local: [tl,tr,br,bl] → tl=min, br=max 가정)
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);

    // 포인터를 로컬로
    const wl = this._toLocal(w, c0, ang);

    let nMinX = minX, nMaxX = maxX, nMinY = minY, nMaxY = maxY;
    const h = dr.handle;
    if (h.includes("l")) nMinX = wl.x;
    if (h.includes("r")) nMaxX = wl.x;
    if (h.includes("t")) nMinY = wl.y;
    if (h.includes("b")) nMaxY = wl.y;

    // 로컬 중심(Alt=중심 고정 시 대칭 기준)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (e.altKey) {
      if (h.includes("l")) nMaxX = 2 * cx - nMinX;
      if (h.includes("r")) nMinX = 2 * cx - nMaxX;
      if (h.includes("t")) nMaxY = 2 * cy - nMinY;
      if (h.includes("b")) nMinY = 2 * cy - nMaxY;
    }

    // Shift: 비율 유지(코너에서만 의미). 변경된 폭/높이 비를 원본 비에 맞춘다.
    if (e.shiftKey && this._isCorner(h)) {
      const ow = maxX - minX, oh = maxY - minY;
      let nw = nMaxX - nMinX, nh = nMaxY - nMinY;
      const ratio = ow / oh;
      if (Math.abs(nw / nh) > Math.abs(ratio)) {
        // 너무 넓음 → 높이에 맞춤
        const sgnW = nw < 0 ? -1 : 1;
        nw = sgnW * Math.abs(nh) * Math.abs(ratio);
      } else {
        const sgnH = nh < 0 ? -1 : 1;
        nh = sgnH * Math.abs(nw) / Math.abs(ratio);
      }
      // 고정 모서리(드래그 반대편) 기준으로 다시 펼침
      if (h.includes("l")) nMinX = nMaxX - nw; else if (h.includes("r")) nMaxX = nMinX + nw;
      if (h.includes("t")) nMinY = nMaxY - nh; else if (h.includes("b")) nMaxY = nMinY + nh;
      if (e.altKey) { // 중심 고정 + 비율: 양쪽 대칭 재적용
        const ncx = cx, ncy = cy;
        const hw = nw / 2, hh = nh / 2;
        nMinX = ncx - hw; nMaxX = ncx + hw; nMinY = ncy - hh; nMaxY = ncy + hh;
      }
    }

    // 새 로컬 코너 → 다시 월드로
    const nl = [
      { x: nMinX, y: nMinY }, { x: nMaxX, y: nMinY },
      { x: nMaxX, y: nMaxY }, { x: nMinX, y: nMaxY },
    ];
    this.corners = nl.map((p) => this._fromLocal(p, c0, ang));
  }

  // 기울이기(Skew): Ctrl+변핸들. 끌리는 변을 변의 수직이 아닌 "변 방향"으로 민다.
  // 로컬 좌표에서 t/b 변은 x로, l/r 변은 y로 평행 이동시켜 평행사변형을 만든다.
  _applySkew(w, dr, e) {
    const ang = dr.startAngle;
    const c0 = this._quadCenter(dr.startCorners);
    const local = dr.startCorners.map((p) => this._toLocal(p, c0, ang));
    const wl = this._toLocal(w, c0, ang);
    const wl0 = this._toLocal(dr.startWorld, c0, ang);
    const dx = wl.x - wl0.x, dy = wl.y - wl0.y;
    const h = dr.handle;
    const nl = local.map((p) => ({ ...p }));
    // local 순서 [tl(0), tr(1), br(2), bl(3)]
    if (h === "t") { nl[0].x += dx; nl[1].x += dx; }       // 윗변을 x로 민다
    else if (h === "b") { nl[2].x += dx; nl[3].x += dx; }  // 아랫변
    else if (h === "l") { nl[0].y += dy; nl[3].y += dy; }  // 왼변을 y로 민다
    else if (h === "r") { nl[1].y += dy; nl[2].y += dy; }  // 오른변
    this.corners = nl.map((p) => this._fromLocal(p, c0, ang));
  }

  // 왜곡(Distort): Ctrl+코너. 끄는 코너 하나만 포인터 위치로 자유 이동.
  _applyDistort(w, dr) {
    const idx = { tl: 0, tr: 1, br: 2, bl: 3 }[dr.handle];
    const nc = dr.startCorners.map((p) => ({ ...p }));
    nc[idx] = { x: w.x, y: w.y };
    this.corners = nc;
  }

  // 원근(Perspective): Ctrl+Alt+Shift+코너. 끄는 코너와 같은 변을 공유하는
  // 인접 코너들을 대칭으로 함께 움직여 사다리꼴(원근) 모양을 만든다.
  // 구현: 끄는 코너의 델타(로컬)를 구해, 같은 가로변·세로변의 짝 코너를 대칭 이동.
  _applyPerspective(w, dr) {
    const ang = dr.startAngle;
    const c0 = this._quadCenter(dr.startCorners);
    const local = dr.startCorners.map((p) => this._toLocal(p, c0, ang));
    const wl = this._toLocal(w, c0, ang);
    const idx = { tl: 0, tr: 1, br: 2, bl: 3 }[dr.handle];
    const d = { x: wl.x - local[idx].x, y: wl.y - local[idx].y };
    const nl = local.map((p) => ({ ...p }));
    // 가로 짝(같은 위/아래 변): tl↔tr, bl↔br — x를 대칭(+d.x, -d.x)
    // 세로 짝(같은 좌/우 변): tl↔bl, tr↔br — y를 대칭(+d.y, -d.y)
    const horizPair = { 0: 1, 1: 0, 2: 3, 3: 2 }[idx]; // 같은 가로변 코너
    const vertPair = { 0: 3, 1: 2, 2: 1, 3: 0 }[idx];  // 같은 세로변 코너
    nl[idx].x += d.x; nl[horizPair].x -= d.x;
    nl[idx].y += d.y; nl[vertPair].y -= d.y;
    this.corners = nl.map((p) => this._fromLocal(p, c0, ang));
  }

  _quadCenter(quad) {
    return { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 };
  }

  // 월드 점 → 중심 c0, 각 ang 기준 로컬(회전 해제) 좌표.
  _toLocal(p, c0, ang) {
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    const dx = p.x - c0.x, dy = p.y - c0.y;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }
  // 로컬 → 월드 (역변환).
  _fromLocal(p, c0, ang) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    return { x: c0.x + p.x * cos - p.y * sin, y: c0.y + p.x * sin + p.y * cos };
  }

  // ── 커서 갱신(호버 시) ──
  _updateCursor(w, e) {
    const h = this._hitTest(w);
    let cur = "default";
    if (h === "rotate") cur = "crosshair";
    else if (h === "move") cur = "move";
    else if (this._isCorner(h)) cur = e.ctrlKey ? "crosshair" : "nwse-resize";
    else if (this._isEdge(h)) cur = e.ctrlKey ? "cell" : (h === "t" || h === "b" ? "ns-resize" : "ew-resize");
    this.canvasEl.style.cursor = cur;
  }

  // ───────────────────────────────────────────────────────────
  // 오버레이: 바운딩박스 + 8핸들 + 중심점. ctx는 화면(CSS) 좌표계.
  // ───────────────────────────────────────────────────────────
  drawOverlay(ctx, vp) {
    if (!this.active || !this.corners) return;
    const c = this.corners.map((p) => vp.worldToScreen(p.x, p.y));
    const pts = this._handlePoints();

    ctx.save();
    // 변형 사각형 외곽선(점선 + 흰 보강)
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.stroke();
    ctx.setLineDash([]);

    // 핸들 8개(흰 채움 + 검정 테두리 사각형)
    const hs = HANDLE_SIZE;
    for (const h of HANDLES) {
      const sp = vp.worldToScreen(pts[h].x, pts[h].y);
      const x = Math.round(sp.x - hs / 2), y = Math.round(sp.y - hs / 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, hs, hs);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeRect(x + 0.5, y + 0.5, hs - 1, hs - 1);
    }

    // 중심 표시(회전 기준점) — 작은 십자
    const ce = vp.worldToScreen(...(() => { const cc = this._center(); return [cc.x, cc.y]; })());
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.beginPath();
    ctx.moveTo(ce.x - 5, ce.y); ctx.lineTo(ce.x + 5, ce.y);
    ctx.moveTo(ce.x, ce.y - 5); ctx.lineTo(ce.x, ce.y + 5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ce.x, ce.y, 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
