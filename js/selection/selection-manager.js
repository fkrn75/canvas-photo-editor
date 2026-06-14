// selection-manager.js — 선택 영역 관리.
// mask: Uint8Array(문서 w*h), 값 255=선택/0=비선택. mask가 null이면 "선택 없음(=전체)".
// outline: 마칭앤츠 시각화를 위한 월드 좌표 폴리곤 링 배열.

import { EVT } from "../core/constants.js";

export class SelectionManager {
  constructor(app) {
    this.app = app;
    this.mask = null;
    this.bounds = null;   // {x,y,w,h}
    this.outline = null;  // [[{x,y}, ...], ...]
    this._dash = 0;
    this._timer = null;
  }

  get active() { return this.mask !== null; }

  clear() {
    if (!this.mask) return;
    this.mask = null; this.bounds = null; this.outline = null;
    this._stopAnts();
    this.app.renderer?.requestRender();
    this.app.bus.emit(EVT.SELECTION_CHANGED, { active: false });
  }

  _commit(mask, bounds, outline) {
    this.mask = mask; this.bounds = bounds; this.outline = outline;
    this._startAnts();
    this.app.renderer?.requestRender();
    this.app.bus.emit(EVT.SELECTION_CHANGED, { active: true, bounds });
  }

  selectAll() {
    const w = this.app.layers.width, h = this.app.layers.height;
    const mask = new Uint8Array(w * h).fill(255);
    this._commit(mask, { x: 0, y: 0, w, h },
      [[{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]]);
  }

  // 사각형 선택
  setRect(x, y, w, h) {
    const W = this.app.layers.width, H = this.app.layers.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) { this.clear(); return; }
    const mask = new Uint8Array(W * H);
    for (let yy = y0; yy < y1; yy++) mask.fill(255, yy * W + x0, yy * W + x1);
    this._commit(mask, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]);
  }

  // 타원 선택: 드래그 사각형(x,y,w,h)에 내접하는 타원. 안티에일리어싱 가장자리는
  // 임시 캔버스의 알파를 0~255 부분선택 마스크로 그대로 보존한다(페더처럼 부드러운 경계).
  setEllipse(x, y, w, h) {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (w < 1 || h < 1) { this.clear(); return; }
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.beginPath();
    // ellipse(cx, cy, rx, ry, ...) — 사각형 중심·반지름으로 내접 타원을 그린다
    g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    const data = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      const a = data[i * 4 + 3];
      if (a > 0) {
        mask[i] = a; // 알파(0~255)를 선택 강도로 사용 → 부드러운 가장자리
        const px = i % W, py = (i / W) | 0;
        if (px < minX) minX = px; if (py < minY) minY = py;
        if (px > maxX) maxX = px; if (py > maxY) maxY = py;
      }
    }
    if (maxX < 0) { this.clear(); return; }
    // 외곽선은 마칭앤츠용으로 마스크에서 추출(임계 128 → 타원 윤곽)
    const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    this._commit(mask, bounds, this._outlineFromMask(mask, bounds, 128));
  }

  // 단일 행/열 선택: row=클릭한 y행 전체(폭=문서폭, 높이 1px),
  // col=클릭한 x열 전체(높이=문서높이, 폭 1px). 포토샵 한 줄 선택 도구와 동일.
  setRowCol(mode, x, y) {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (mode === "row") {
      const yy = Math.max(0, Math.min(H - 1, Math.round(y)));
      this.setRect(0, yy, W, 1);
    } else { // col
      const xx = Math.max(0, Math.min(W - 1, Math.round(x)));
      this.setRect(xx, 0, 1, H);
    }
  }

  // 폴리곤(올가미) 선택: 임시 캔버스에 채운 뒤 알파를 마스크로 추출
  setPolygon(points) {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (!points || points.length < 3) { this.clear(); return; }
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.beginPath();
    x.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) x.lineTo(points[i].x, points[i].y);
    x.closePath();
    x.fill();
    const data = x.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] >= 128) {
        mask[i] = 255;
        const px = i % W, py = (i / W) | 0;
        if (px < minX) minX = px; if (py < minY) minY = py;
        if (px > maxX) maxX = px; if (py > maxY) maxY = py;
      }
    }
    if (maxX < 0) { this.clear(); return; }
    this._commit(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, [points.slice()]);
  }

  // 마스크 직접 설정(매직완드 등). 외곽선은 bounds 사각형으로 근사.
  setMask(mask, bounds) {
    const b = bounds;
    this._commit(mask, b,
      [[{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]]);
  }

  // ───────────────────────────────────────────────────────────
  // 선택 영역 연산 (Inverse / Feather / Modify: Expand/Contract/Border/Smooth)
  // 모두 mask(Uint8Array, 0~255) 표현 위에서 동작한다. 0/255 이진뿐 아니라
  // 페더로 생긴 0~255 부분 선택 알파도 그대로 보존·전파한다.
  // ───────────────────────────────────────────────────────────

  // 주어진 mask(0~255)에서 임계값(thr) 이상인 픽셀들의 bounding box를 구한다.
  // 반환: {x,y,w,h} 또는 비선택이면 null.
  _maskBounds(mask, thr = 1) {
    const W = this.app.layers.width, H = this.app.layers.height;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (mask[row + x] >= thr) {
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // 마스크(0~255)의 외곽선 링들을 마칭센터 방식으로 추출한다.
  // 임계값(thr) 이상인 셀을 "안쪽"으로 보고, 안/밖 경계가 되는 픽셀 변(edge)을
  // 모아 작은 정사각형 윤곽으로 만든다. (완전 추적은 아니지만 마칭앤츠 표시용으로 충분)
  // 너무 큰 선택은 변이 폭증하므로, 변 개수가 한계를 넘으면 bounds 사각형으로 폴백한다.
  _outlineFromMask(mask, bounds, thr = 128) {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (!bounds) return null;
    const inside = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? false : mask[y * W + x] >= thr;
    const rings = [];
    const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w, y1 = bounds.y + bounds.h;
    const MAX_EDGES = 200000; // 안전 한계
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(x, y)) continue;
        // 네 방향 중 바깥과 맞닿은 변만 1px 선분(짧은 4점 링)으로 추가
        if (!inside(x, y - 1)) { rings.push([{ x, y }, { x: x + 1, y }]); count++; }
        if (!inside(x, y + 1)) { rings.push([{ x, y: y + 1 }, { x: x + 1, y: y + 1 }]); count++; }
        if (!inside(x - 1, y)) { rings.push([{ x, y }, { x, y: y + 1 }]); count++; }
        if (!inside(x + 1, y)) { rings.push([{ x: x + 1, y }, { x: x + 1, y: y + 1 }]); count++; }
        if (count > MAX_EDGES) {
          // 너무 복잡 → bounds 사각형으로 폴백
          return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
        }
      }
    }
    if (rings.length === 0) {
      return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
    }
    return rings;
  }

  // mask를 받아 bounds·outline을 자동 계산해 commit한다. (연산 결과 공통 마무리)
  // 선택이 모두 사라졌으면 clear.
  _commitMask(mask) {
    const bounds = this._maskBounds(mask, 1);
    if (!bounds) { this.clear(); return; }
    const outline = this._outlineFromMask(mask, bounds, 128);
    this._commit(mask, bounds, outline);
  }

  // ── 1) Inverse: 선택 반전 (문서 전체 − 현재 선택) ──
  // 알파도 반전한다(255−v). 선택이 없으면(=전체) 반전 결과는 빈 선택이므로 무시한다.
  invert() {
    const W = this.app.layers.width, H = this.app.layers.height;
    if (!this.mask) {
      // 선택 없음(=전체) 상태의 반전은 "아무것도 선택 안 함"이라 의미가 없다 → 무시.
      this.app.status?.("선택 영역이 없어 반전할 수 없습니다.");
      return;
    }
    const n = W * H;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = 255 - this.mask[i];
    this._commitMask(out);
  }

  // ── 2) Feather: 가우시안 블러로 가장자리 부드럽게(부분 선택 알파 생성) ──
  // 이진(0/255) 마스크라도 블러 후 0~255 알파 마스크로 자연히 승격된다.
  // radius<=0 이면 무시. bounds는 블러로 번지는 만큼 여유를 둬 재계산한다.
  feather(radius) {
    const r = Math.round(radius);
    if (!this.mask || r <= 0) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const blurred = this._gaussianBlurMask(this.mask, W, H, r);
    this._commitMask(blurred);
  }

  // 마스크 전용 분리형(separable) 가우시안 블러. 입력/출력 모두 0~255.
  // 컬러가 아닌 단일 채널이라 ImageData 경유 없이 직접 계산한다.
  _gaussianBlurMask(src, W, H, radius) {
    // 가우시안 커널 생성 (sigma ≈ radius/3, Photoshop 페더 느낌)
    const sigma = Math.max(0.5, radius / 3);
    const ksize = radius * 2 + 1;
    const kernel = new Float32Array(ksize);
    const denom = 2 * sigma * sigma;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / denom);
      kernel[i + radius] = v; sum += v;
    }
    for (let i = 0; i < ksize; i++) kernel[i] /= sum;

    // 수평 패스: Uint8 → Float32(tmp)
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          let sx = x + k;
          if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1; // 가장자리 클램프
          acc += src[row + sx] * kernel[k + radius];
        }
        tmp[row + x] = acc;
      }
    }
    // 수직 패스: Float32(tmp) → Uint8(out)
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          let sy = y + k;
          if (sy < 0) sy = 0; else if (sy >= H) sy = H - 1;
          acc += tmp[sy * W + x] * kernel[k + radius];
        }
        let v = acc + 0.5;
        out[y * W + x] = v < 0 ? 0 : (v > 255 ? 255 : v | 0);
      }
    }
    return out;
  }

  // ── 3) Modify ──

  // 거리 변환 기반 모폴로지 헬퍼.
  // binSrc: 임계값(thr) 기준 이진화한 Uint8(0/1). 반환: 각 픽셀의 "가장 가까운
  // 배경(0) 픽셀까지의 유클리드 거리". 안쪽 깊은 곳일수록 값이 크다.
  // 2-pass chamfer 근사(거리 정확도는 1px 내외; 모폴로지엔 충분).
  _distanceToOutside(binSrc, W, H) {
    const INF = 1e9;
    const dist = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) dist[i] = binSrc[i] ? INF : 0;
    const d1 = 1, d2 = Math.SQRT2;
    // 정방향 패스 (좌상 → 우하)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (dist[i] === 0) continue;
        let m = dist[i];
        if (x > 0) m = Math.min(m, dist[i - 1] + d1);
        if (y > 0) m = Math.min(m, dist[i - W] + d1);
        if (x > 0 && y > 0) m = Math.min(m, dist[i - W - 1] + d2);
        if (x < W - 1 && y > 0) m = Math.min(m, dist[i - W + 1] + d2);
        dist[i] = m;
      }
    }
    // 역방향 패스 (우하 → 좌상)
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (dist[i] === 0) continue;
        let m = dist[i];
        if (x < W - 1) m = Math.min(m, dist[i + 1] + d1);
        if (y < H - 1) m = Math.min(m, dist[i + W] + d1);
        if (x < W - 1 && y < H - 1) m = Math.min(m, dist[i + W + 1] + d2);
        if (x > 0 && y < H - 1) m = Math.min(m, dist[i + W - 1] + d2);
        dist[i] = m;
      }
    }
    return dist; // 내부 픽셀의 경계까지 거리
  }

  // 현재 마스크를 임계값 128로 이진화한 Uint8(0/1)을 만든다.
  _binarize(thr = 128) {
    const n = this.app.layers.width * this.app.layers.height;
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = this.mask[i] >= thr ? 1 : 0;
    return bin;
  }

  // Expand(px): 선택을 px만큼 팽창(dilate).
  // 바깥 픽셀(배경)에서 "선택까지의 거리"가 px 이하인 곳을 새로 선택에 포함한다.
  expand(px) {
    const p = Math.round(px);
    if (!this.mask || p <= 0) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const bin = this._binarize(128);
    // 배경(0)→선택(1)까지의 거리: bin을 반전해 거리 변환
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inv[i] = bin[i] ? 0 : 1;
    const distToInside = this._distanceToOutside(inv, W, H); // 배경에서 선택 경계까지 거리
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      out[i] = (bin[i] || distToInside[i] <= p) ? 255 : 0;
    }
    this._commitMask(out);
  }

  // Contract(px): 선택을 px만큼 침식(erode).
  // 선택 내부에서 "경계까지 거리"가 px 이하인 가장자리 픽셀을 제거한다.
  contract(px) {
    const p = Math.round(px);
    if (!this.mask || p <= 0) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const bin = this._binarize(128);
    const distToOutside = this._distanceToOutside(bin, W, H); // 선택 내부→경계 거리
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      out[i] = (bin[i] && distToOutside[i] > p) ? 255 : 0;
    }
    this._commitMask(out);
  }

  // Border(px): 현재 선택 경계 양옆 px 폭의 "테두리"만 선택으로 남긴다.
  // (expand 결과 − contract 결과) 영역. 결과는 이진.
  border(px) {
    const p = Math.round(px);
    if (!this.mask || p <= 0) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const bin = this._binarize(128);
    // 바깥쪽 p: 배경에서 선택 경계까지 거리 ≤ p
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inv[i] = bin[i] ? 0 : 1;
    const distOut = this._distanceToOutside(inv, W, H);   // 배경 픽셀의 경계 거리
    const distIn = this._distanceToOutside(bin, W, H);    // 내부 픽셀의 경계 거리
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      let on;
      if (bin[i]) on = distIn[i] <= p;       // 안쪽 테두리
      else on = distOut[i] <= p;             // 바깥쪽 테두리
      out[i] = on ? 255 : 0;
    }
    this._commitMask(out);
  }

  // Stroke 헬퍼: 현재 선택 경계를 따라 폭 width(px)의 "테두리 마스크"(Uint8Array 0/255)를
  // 만들어 반환한다. 선택 자체는 바꾸지 않는다(외곽선 fill 전용).
  //   position: "inside"  = 경계 안쪽으로만 width
  //             "outside" = 경계 바깥쪽으로만 width
  //             "center"  = 안/밖으로 각각 width/2 (포토샵 중앙 정렬)
  // border()와 같은 거리 변환을 쓰되, 안/밖 폭을 위치에 맞춰 비대칭으로 적용한다.
  // 반환: {mask, bounds} 또는 테두리가 비면 {mask:null, bounds:null}.
  strokeMaskFromSelection(width, position = "center") {
    if (!this.mask) return { mask: null, bounds: null };
    const w = Math.max(1, Math.round(width));
    const W = this.app.layers.width, H = this.app.layers.height;
    const bin = this._binarize(128);
    // 안/밖으로 칠할 폭 결정
    let inAmt, outAmt;
    if (position === "inside") { inAmt = w; outAmt = 0; }
    else if (position === "outside") { inAmt = 0; outAmt = w; }
    // center: 안/밖을 반폭으로 "대칭" 분배한다. 예전 ceil/floor 분배는 홀수폭일 때
    // 안쪽이 1px 더 두꺼워(예: w=3 → 안2·밖1) 경계 기준 좌우/상하가 비대칭이었다.
    // 반폭(w/2, 실수)을 양쪽에 동일 적용하면 거리비교가 대칭이 되어 비대칭 1px이 사라진다.
    else { inAmt = w / 2; outAmt = w / 2; } // center(대칭)

    const inv = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inv[i] = bin[i] ? 0 : 1;
    const distIn = inAmt > 0 ? this._distanceToOutside(bin, W, H) : null;  // 내부→경계 거리
    const distOut = outAmt > 0 ? this._distanceToOutside(inv, W, H) : null; // 배경→경계 거리

    const out = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      let on = false;
      if (bin[i]) { if (distIn && distIn[i] <= inAmt) on = true; }      // 안쪽 테두리
      else { if (distOut && distOut[i] <= outAmt) on = true; }          // 바깥쪽 테두리
      if (on) {
        out[i] = 255;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { mask: null, bounds: null };
    return { mask: out, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  }

  // Smooth(radius): 선택 경계를 둥글게. 거리 변환 기반 open→close 근사.
  // radius만큼 침식 후 다시 팽창(= 작은 돌기 제거), 이어서 팽창 후 침식(= 작은 구멍 메움).
  // 간단·견고하게: "경계로부터의 부호거리"에 임계 0을 적용하기 전, 평균 필터로 둥글린다.
  smooth(radius) {
    const r = Math.round(radius);
    if (!this.mask || r <= 0) return;
    const W = this.app.layers.width, H = this.app.layers.height;
    const bin = this._binarize(128);
    // 선택=+거리, 배경=−거리 인 부호거리장(signed distance) 구성
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inv[i] = bin[i] ? 0 : 1;
    const dIn = this._distanceToOutside(bin, W, H);
    const dOut = this._distanceToOutside(inv, W, H);
    const sdf = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) sdf[i] = bin[i] ? dIn[i] : -dOut[i];
    // 반경 r 박스 평균으로 부호거리장을 매끈하게(돌기/만입 깎임) → 0 이상이면 선택.
    const sm = this._boxBlurF32(sdf, W, H, r);
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = sm[i] >= 0 ? 255 : 0;
    this._commitMask(out);
  }

  // Float32 분리형 박스 블러 (Smooth용). 반경 r, 가장자리 클램프.
  _boxBlurF32(src, W, H, r) {
    const win = r * 2 + 1;
    const tmp = new Float32Array(W * H);
    // 수평
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          let sx = x + k; if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
          acc += src[row + sx];
        }
        tmp[row + x] = acc / win;
      }
    }
    // 수직
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          let sy = y + k; if (sy < 0) sy = 0; else if (sy >= H) sy = H - 1;
          acc += tmp[sy * W + x];
        }
        out[y * W + x] = acc / win;
      }
    }
    return out;
  }

  // (x,y) 픽셀이 선택 영역인가
  isSelected(x, y) {
    if (!this.mask) return true;
    const W = this.app.layers.width;
    return this.mask[y * W + x] > 0;
  }

  // 선택 영역 밖 픽셀을 원본(original)으로 되돌려 modified를 선택 영역으로 한정한다.
  // box는 modified/original이 대응하는 문서상의 {x,y,w,h}.
  clipImageData(modified, original, box) {
    if (!this.mask) return modified;
    const W = this.app.layers.width;
    const md = modified.data, od = original.data;
    for (let row = 0; row < box.h; row++) {
      for (let col = 0; col < box.w; col++) {
        const gx = box.x + col, gy = box.y + row;
        if (this.mask[gy * W + gx] === 0) {
          const i = (row * box.w + col) * 4;
          md[i] = od[i]; md[i + 1] = od[i + 1]; md[i + 2] = od[i + 2]; md[i + 3] = od[i + 3];
        }
      }
    }
    return modified;
  }

  // 도구가 선택 영역으로 클립 패스를 적용할 때 사용 (브러시 등). ctx는 문서 좌표계.
  applyClipPath(ctx) {
    if (!this.outline) return false;
    ctx.beginPath();
    for (const ring of this.outline) {
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
      ctx.closePath();
    }
    ctx.clip();
    return true;
  }

  drawOverlay(ctx, vp) {
    if (!this.outline) return;
    ctx.save();
    ctx.lineWidth = 1;
    for (const ring of this.outline) {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const p = vp.worldToScreen(ring[i].x, ring[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this._dash;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.stroke();
    }
    ctx.restore();
  }

  _startAnts() {
    this._stopAnts();
    // 마칭앤츠 애니메이션: 주기적으로 점선 오프셋을 바꾸며 재렌더 요청
    this._timer = setInterval(() => {
      this._dash = (this._dash + 1) % 8;
      this.app.renderer?.requestRender();
    }, 90);
  }
  _stopAnts() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  // ═══════════════════════════════════════════════════════════
  // 고급 선택 (Color Range / Grow / Similar / 선택 저장·불러오기)
  // 모두 mask(Uint8Array, 0~255) 모델 위에서 동작한다.
  // ═══════════════════════════════════════════════════════════

  // ── Color Range: 기준색과 유사한 픽셀을 0~255 마스크로 생성 ──
  // imageData : 활성 레이어의 ImageData(문서 전체 크기)
  // refColor  : {r,g,b} 기준색
  // tolerance : 0~255 허용치(fuzziness). 색차가 0이면 255, tolerance면 ~0으로 부드럽게 감쇠.
  // 반환: {mask, bounds} — bounds는 선택(>0)된 픽셀의 경계. 없으면 bounds=null.
  // ※ 화면을 갱신하지 않는다(미리보기용). 실제 적용은 호출측에서 setMask/_commitMask로.
  fromColorMatch(imageData, refColor, tolerance) {
    const W = this.app.layers.width, H = this.app.layers.height;
    const d = imageData.data;
    const n = W * H;
    const mask = new Uint8Array(n);
    const tr = refColor.r, tg = refColor.g, tb = refColor.b;
    // tolerance를 "최대 허용 색거리"로 본다. 색거리는 RGB 채널 최대 절대차(체비셰프)
    // — floodfill/매직완드의 비교 방식과 일치시켜 일관된 느낌을 준다.
    const tol = Math.max(0, tolerance);
    // 부분 선택(소프트 에지): 색거리 0 → 255, tol → 0 으로 선형 감쇠.
    // tol 너머는 0(비선택). tol=0이면 정확히 일치하는 픽셀만 255.
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const dr = Math.abs(d[j] - tr);
      const dg = Math.abs(d[j + 1] - tg);
      const db = Math.abs(d[j + 2] - tb);
      const dist = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
      let v;
      if (tol === 0) v = dist === 0 ? 255 : 0;
      else if (dist >= tol) v = 0;
      else v = 255 - ((dist * 255 / tol) | 0); // 선형 페더
      if (v > 0) {
        mask[i] = v;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    const bounds = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    return { mask, bounds };
  }

  // ── Grow: 현재 선택의 경계에 인접한 유사색 픽셀로 확장(인접/연속) ──
  // 현재 선택된 각 픽셀에서 출발해, 색거리가 tolerance 이내인 이웃을 따라 영역을 넓힌다.
  // (floodfill의 스캔라인 확장 로직을 "다중 시드"로 재사용. 시드 색 자신과의 비교로 자연 확장)
  // imageData : 활성 레이어 ImageData, tolerance : 0~255.
  // 결과를 바로 _commitMask 한다. 선택이 없으면 무시.
  grow(imageData, tolerance) {
    if (!this.mask) { this.app.status?.("먼저 영역을 선택하세요."); return; }
    const W = this.app.layers.width, H = this.app.layers.height;
    const d = imageData.data;
    const n = W * H;
    const tol = Math.max(0, tolerance);

    // 결과 마스크: 현재 선택을 이진(>0 → 255)으로 시작 + 방문 표시 겸용.
    const out = new Uint8Array(n);
    // 색 비교: 두 픽셀 인덱스의 RGBA 체비셰프 거리 ≤ tol?
    const close = (a, b) => {
      const ia = a * 4, ib = b * 4;
      return Math.abs(d[ia] - d[ib]) <= tol &&
             Math.abs(d[ia + 1] - d[ib + 1]) <= tol &&
             Math.abs(d[ia + 2] - d[ib + 2]) <= tol &&
             Math.abs(d[ia + 3] - d[ib + 3]) <= tol;
    };

    // 스택에 현재 선택된 모든 픽셀을 시드로 넣는다(다중 시드 BFS/DFS).
    // 각 픽셀은 "자기 색" 기준으로 이웃을 흡수하므로, 경계 너머 유사색이 자연스럽게 붙는다.
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (this.mask[i] > 0) { out[i] = 255; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      // 4-이웃 검사
      if (x > 0)     { const k = i - 1; if (!out[k] && close(i, k)) { out[k] = 255; stack.push(k); } }
      if (x < W - 1) { const k = i + 1; if (!out[k] && close(i, k)) { out[k] = 255; stack.push(k); } }
      if (y > 0)     { const k = i - W; if (!out[k] && close(i, k)) { out[k] = 255; stack.push(k); } }
      if (y < H - 1) { const k = i + W; if (!out[k] && close(i, k)) { out[k] = 255; stack.push(k); } }
    }
    this._commitMask(out);
  }

  // ── Similar: 선택 내부의 색과 유사한 "전역" 픽셀을 모두 선택(비연속) ──
  // 현재 선택 안의 색들을 16단계 양자화해 유니크 색 집합을 만든 뒤,
  // 문서 전체에서 그 집합 중 하나라도 tolerance 이내인 픽셀을 선택한다.
  // imageData : 활성 레이어 ImageData, tolerance : 0~255. 결과를 바로 _commitMask.
  similar(imageData, tolerance) {
    if (!this.mask) { this.app.status?.("먼저 영역을 선택하세요."); return; }
    const W = this.app.layers.width, H = this.app.layers.height;
    const d = imageData.data;
    const n = W * H;
    const tol = Math.max(0, tolerance);

    // ── tol=0 특례: 정확히 같은 색만 선택 ──
    // 양자화(>>4) 경로는 대표색을 버킷 중앙값(…,8,24,40)으로 환산하므로,
    // tol=0이면 "버킷 중앙값과 정확히 일치"라는 비현실적 조건이 되어 원래
    // 선택된 픽셀조차 거의 매칭되지 않는다(빈 선택 버그). tol=0일 때는 양자화 없이
    // 선택 내부의 "정확한 RGB"를 모아, 문서 전체에서 동일 RGB만 선택한다.
    if (tol === 0) {
      const exact = new Set();
      for (let i = 0; i < n; i++) {
        if (this.mask[i] === 0) continue;
        const j = i * 4;
        if (d[j + 3] === 0) continue; // 투명은 무시(기존 동작과 일관)
        exact.add((d[j] << 16) | (d[j + 1] << 8) | d[j + 2]);
      }
      if (exact.size === 0) { this.app.status?.("선택 영역에 색이 없습니다."); return; }
      const out = new Uint8Array(n);
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        if (exact.has((d[j] << 16) | (d[j + 1] << 8) | d[j + 2])) {
          out[i] = 255;
          const x = i % W, y = (i / W) | 0;
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) { this.clear(); return; }
      this._commitMask(out);
      return;
    }

    // 1) 선택 내부 색을 양자화(>>4 → 0~15)해 대표색 집합 수집(성능상 색 종류를 압축).
    //    키: r4<<8 | g4<<4 | b4 (알파>0 픽셀만; 투명은 무시).
    const set = new Set();
    for (let i = 0; i < n; i++) {
      if (this.mask[i] === 0) continue;
      const j = i * 4;
      if (d[j + 3] === 0) continue;
      const key = ((d[j] >> 4) << 8) | ((d[j + 1] >> 4) << 4) | (d[j + 2] >> 4);
      set.add(key);
    }
    if (set.size === 0) { this.app.status?.("선택 영역에 색이 없습니다."); return; }
    // 대표색을 빠른 비교용 평탄 배열(각 양자화 버킷의 중앙값 8+r,g,b)로 변환.
    const refs = [];
    for (const key of set) {
      refs.push(((key >> 8) & 15) * 16 + 8, ((key >> 4) & 15) * 16 + 8, (key & 15) * 16 + 8);
    }
    const rn = refs.length;

    // 2) 전역 스캔: 어떤 대표색과도 tol 이내(체비셰프)면 선택.
    const out = new Uint8Array(n);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const r = d[j], g = d[j + 1], b = d[j + 2];
      let hit = false;
      for (let t = 0; t < rn; t += 3) {
        if (Math.abs(r - refs[t]) <= tol && Math.abs(g - refs[t + 1]) <= tol && Math.abs(b - refs[t + 2]) <= tol) {
          hit = true; break;
        }
      }
      if (hit) {
        out[i] = 255;
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) { this.clear(); return; }
    this._commitMask(out);
  }

  // ── 선택 저장 / 불러오기 (명명된 마스크 저장소) ──
  // this.saved : Map<name, {mask:Uint8Array, bounds}> — 마스크는 복사본으로 보관(원본 변형 방지).

  // 현재 선택을 name으로 저장. 선택이 없으면 false 반환.
  saveSelection(name) {
    if (!this.saved) this.saved = new Map();
    if (!this.mask || !this.bounds) return false;
    this.saved.set(name, { mask: this.mask.slice(), bounds: { ...this.bounds } });
    return true;
  }

  // 저장된 선택을 불러와 현재 선택으로 만든다. 없으면 false.
  // 문서 크기가 저장 당시와 다르면(리사이즈됨) 불러오지 않는다.
  loadSelection(name) {
    if (!this.saved) return false;
    const rec = this.saved.get(name);
    if (!rec) return false;
    const W = this.app.layers.width, H = this.app.layers.height;
    if (rec.mask.length !== W * H) {
      this.app.status?.("문서 크기가 달라 선택을 불러올 수 없습니다.");
      return false;
    }
    this._commit(rec.mask.slice(),
      { ...rec.bounds },
      this._outlineFromMask(rec.mask, rec.bounds, 128));
    return true;
  }

  // 저장된 선택 이름 목록(배열). 없으면 빈 배열.
  listSaved() {
    return this.saved ? [...this.saved.keys()] : [];
  }

  // 저장된 선택 삭제. 있었으면 true.
  deleteSaved(name) {
    return this.saved ? this.saved.delete(name) : false;
  }
}
