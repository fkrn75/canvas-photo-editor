// liquify.js — 픽셀 유동화(Liquify) 워핑 엔진.
//
// "변위장(displacement field)" 방식을 쓴다. 결과 이미지의 각 픽셀 (x,y)가 원본의 어느
// 지점에서 색을 가져올지를 오프셋 (dispX, dispY)로 누적 저장한다.
//   결과(x,y) = bilinear( 원본, x + dispX[x,y], y + dispY[x,y] )
// 브러시를 칠할 때마다 영향 영역의 변위장을 갱신하고, 그 영역만 다시 렌더링한다(영역 한정).
//
// 브러시 모드(역방향 샘플 기준):
//   - forward(밀기): 브러시 이동 방향으로 픽셀을 민다 → 변위는 이동의 반대 방향으로 누적.
//   - pucker(오목/쪼그림): 중심으로 빨려든다 → 결과가 바깥에서 샘플하도록 중심 바깥 방향 변위.
//   - bloat(볼록/부풀림): pucker의 반대.
//   - twirl(소용돌이): 중심 기준 회전 변위(접선 방향).
//
// 변위장은 항상 원본 해상도 그대로 유지하므로 적용 결과가 미리보기와 정확히 일치한다.
// (모달 캔버스는 CSS로 축소 표시할 수 있으나 내부 버퍼/변위장은 원본 크기)

// 브러시 모드 상수
export const LIQUIFY_MODE = {
  FORWARD: "forward",
  PUCKER: "pucker",
  BLOAT: "bloat",
  TWIRL: "twirl",
};

export class LiquifyMesh {
  // src: 원본 ImageData (워핑 대상, 변하지 않음)
  constructor(src) {
    this.W = src.width;
    this.H = src.height;
    this.src = src;
    const n = this.W * this.H;
    // 누적 변위장(결과 픽셀 → 원본에서 가져올 오프셋). 초기 0 = 변형 없음.
    this.dispX = new Float32Array(n);
    this.dispY = new Float32Array(n);
    // 현재 결과 ImageData(미리보기/적용 공용). 초기엔 원본 복사.
    this.out = new ImageData(new Uint8ClampedArray(src.data), this.W, this.H);
  }

  // 변위장 전체 초기화(되돌리기 전체) 후 결과를 원본으로 리셋.
  reset() {
    this.dispX.fill(0);
    this.dispY.fill(0);
    this.out.data.set(this.src.data);
  }

  // 브러시 1회 적용.
  //   mode     : LIQUIFY_MODE.*
  //   cx,cy    : 브러시 중심(원본 픽셀 좌표)
  //   radius   : 브러시 반경(px)
  //   strength : 0~1 세기
  //   mdx,mdy  : 직전 위치→현재 위치 이동 벡터(forward 전용). 없으면 0.
  // 영향받은 사각 영역 {x,y,w,h}를 반환(없으면 null) → 호출측이 그 영역만 렌더.
  applyBrush(mode, cx, cy, radius, strength, mdx = 0, mdy = 0) {
    const W = this.W, H = this.H;
    const r = Math.max(1, radius);
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return null;

    const dX = this.dispX, dY = this.dispY;
    const r2 = r * r;
    // twirl 회전각(세기에 비례). forward 이동량 스케일.
    const twirlAng = strength * 0.6; // 한 번에 약 34도까지
    // pucker/bloat 흡입/팽창 비율.
    const radialAmt = strength * 0.5;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ox = x - cx, oy = y - cy;
        const d2 = ox * ox + oy * oy;
        if (d2 > r2) continue;
        const dist = Math.sqrt(d2);
        // 가장자리로 갈수록 0이 되는 부드러운 falloff(코사인^2 형태).
        const t = 1 - dist / r;            // 중심 1 → 가장자리 0
        const fall = t * t;                // 부드럽게
        const i = y * W + x;

        let ax = 0, ay = 0; // 이번 적용으로 더할 변위
        switch (mode) {
          case LIQUIFY_MODE.FORWARD:
            // 픽셀을 이동 방향으로 민다 → 결과는 원본의 반대쪽에서 샘플.
            // [강도 적용 횟수] strength는 여기서 "한 번"만 곱한다(× fall × strength).
            //   pucker/bloat: (strength*0.5=radialAmt) × dist × fall  → strength 1회
            //   twirl       : (strength*0.6=twirlAng) × fall          → strength 1회
            //   forward     : mdx × fall × strength                   → strength 1회 (동일)
            // 즉 정적분석이 지적한 "strength 이중 적용"은 오탐이며, 네 모드의 강도 적용
            // 횟수는 일관된다. 변위는 mdx(직전→현재 이동량)에 비례하는 표준 forward warp.
            ax = -mdx * fall * strength;
            ay = -mdy * fall * strength;
            break;
          case LIQUIFY_MODE.PUCKER: {
            // 중심으로 빨려듦 → 결과 픽셀은 더 바깥(중심에서 먼 쪽)에서 샘플.
            // 단위 방향(중심→픽셀) × 거리비례.
            const ux = dist > 0.001 ? ox / dist : 0;
            const uy = dist > 0.001 ? oy / dist : 0;
            ax = ux * dist * radialAmt * fall;
            ay = uy * dist * radialAmt * fall;
            break;
          }
          case LIQUIFY_MODE.BLOAT: {
            // 부풀림 → 결과 픽셀은 중심 쪽에서 샘플(pucker 반대 부호).
            const ux = dist > 0.001 ? ox / dist : 0;
            const uy = dist > 0.001 ? oy / dist : 0;
            ax = -ux * dist * radialAmt * fall;
            ay = -uy * dist * radialAmt * fall;
            break;
          }
          case LIQUIFY_MODE.TWIRL: {
            // 중심 기준 회전. 결과 픽셀은 반대 방향으로 회전된 위치에서 샘플.
            const ang = -twirlAng * fall;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            // 회전 후 위치 − 현재 위치 = 추가 변위
            const rx = ox * ca - oy * sa;
            const ry = ox * sa + oy * ca;
            ax = rx - ox;
            ay = ry - oy;
            break;
          }
        }
        dX[i] += ax;
        dY[i] += ay;
      }
    }

    this._render(x0, y0, x1, y1);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // [x0,y0]~[x1,y1] 영역만 변위장으로 다시 샘플링해 out에 쓴다(bilinear).
  _render(x0, y0, x1, y1) {
    const W = this.W, H = this.H;
    const sd = this.src.data, od = this.out.data;
    const dX = this.dispX, dY = this.dispY;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const sxf = x + dX[i];
        const syf = y + dY[i];
        // 원본 범위 클램프
        const sx = sxf < 0 ? 0 : sxf > W - 1 ? W - 1 : sxf;
        const sy = syf < 0 ? 0 : syf > H - 1 ? H - 1 : syf;
        const ix = Math.floor(sx), iy = Math.floor(sy);
        const fx = sx - ix, fy = sy - iy;
        const ix1 = ix < W - 1 ? ix + 1 : ix;
        const iy1 = iy < H - 1 ? iy + 1 : iy;
        const i00 = (iy * W + ix) * 4;
        const i10 = (iy * W + ix1) * 4;
        const i01 = (iy1 * W + ix) * 4;
        const i11 = (iy1 * W + ix1) * 4;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const di = i * 4;
        for (let c = 0; c < 4; c++) {
          od[di + c] = sd[i00 + c] * w00 + sd[i10 + c] * w10 +
                       sd[i01 + c] * w01 + sd[i11 + c] * w11;
        }
      }
    }
  }

  // 현재 결과 ImageData 반환(다이얼로그가 화면 표시/적용에 사용)
  result() { return this.out; }
}
