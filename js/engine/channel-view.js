// channel-view.js — 채널 격리 렌더링 순수 함수 모음.
// 입력 캔버스(문서 합성 결과 등)에서 특정 채널만 떼어 새 캔버스로 그리거나(extractChannel),
// 채널 값을 선택 마스크로 변환한다(channelToMask). renderer/상태를 건드리지 않는 순수 함수.
//
// 채널 식별자: "rgb"(원본 컬러) | "r" | "g" | "b" | "a" | "l"(휘도).
//   - "rgb": 원본 그대로 복제(합성 미리보기 기준)
//   - "r"/"g"/"b": 해당 채널만 추출. 포토샵처럼 "그레이스케일"로 보여주는 게 기본이며,
//                  colorized=true면 해당 채널 색으로 착색해 보여준다.
//   - "a": 알파 채널을 그레이스케일(흰=불투명/검=투명)로 시각화.
//   - "l": 휘도(0.299R+0.587G+0.114B)를 그레이스케일로.

// 휘도 계수(포토샵/adjustments.js와 동일)
const LR = 0.299, LG = 0.587, LB = 0.114;

// 빈 캔버스 생성 헬퍼(읽기 잦으므로 willReadFrequently)
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

// 특정 채널만 격리해 새 캔버스로 반환한다.
//   src       : 원본 캔버스(HTMLCanvasElement/OffscreenCanvas 등 drawImage 가능 객체)
//   channel   : "rgb" | "r" | "g" | "b" | "a" | "l"
//   colorized : true면 r/g/b 채널을 해당 색으로 착색(false=그레이스케일). a/l/rgb엔 무관.
// 반환: 원본과 동일 크기의 새 캔버스. 알파는 항상 255(불투명)로 채워 채널 자체를 또렷이 본다.
export function extractChannel(src, channel = "rgb", colorized = false) {
  const w = src.width, h = src.height;
  const out = makeCanvas(w, h);
  const octx = out.getContext("2d", { willReadFrequently: true });

  // rgb는 원본 복제(가장 빠른 경로). 단 배경 투명이 보이도록 그대로 둔다.
  if (channel === "rgb") {
    octx.drawImage(src, 0, 0);
    return out;
  }

  // 원본 픽셀 읽기
  const sctx = src.getContext ? src.getContext("2d", { willReadFrequently: true }) : null;
  // src가 getContext를 제공하지 않을 수 있으니(이미지 등) 임시 캔버스로 한 번 복사
  let sd;
  if (sctx) {
    sd = sctx.getImageData(0, 0, w, h);
  } else {
    const tmp = makeCanvas(w, h);
    tmp.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0);
    sd = tmp.getContext("2d").getImageData(0, 0, w, h);
  }
  const s = sd.data;
  const od = octx.createImageData(w, h);
  const o = od.data;

  if (channel === "a") {
    // 알파 → 그레이스케일(흰=불투명). 결과 자체는 불투명하게.
    for (let i = 0; i < s.length; i += 4) {
      const v = s[i + 3];
      o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
    }
  } else if (channel === "l") {
    // 휘도 → 그레이스케일
    for (let i = 0; i < s.length; i += 4) {
      const v = (LR * s[i] + LG * s[i + 1] + LB * s[i + 2]) | 0;
      o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
    }
  } else {
    // r/g/b 단일 채널
    const off = { r: 0, g: 1, b: 2 }[channel];
    if (off === undefined) { octx.drawImage(src, 0, 0); return out; } // 알 수 없는 채널 → 원본
    if (colorized) {
      // 해당 채널 값을 그 색 위치에만 넣어 착색(나머지 0). 예: R채널 → (v,0,0)
      for (let i = 0; i < s.length; i += 4) {
        o[i] = o[i + 1] = o[i + 2] = 0;
        o[i + off] = s[i + off];
        o[i + 3] = 255;
      }
    } else {
      // 그레이스케일: 채널 값을 R=G=B에 복제
      for (let i = 0; i < s.length; i += 4) {
        const v = s[i + off];
        o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
      }
    }
  }

  octx.putImageData(od, 0, 0);
  return out;
}

// 채널 값을 선택 마스크로 변환한다. (포토샵 "채널을 선택영역으로": 채널 밝기=선택 강도)
//   src     : 원본 캔버스
//   channel : "rgb"|"l" → 휘도, "r"/"g"/"b" → 해당 채널, "a" → 알파
// 반환: { mask: Uint8Array(w*h, 0~255), bounds: {x,y,w,h}|null }
//   - mask 값은 채널 밝기 그대로(부분 선택 알파). bounds는 값>0 픽셀의 경계(없으면 null).
//   - SelectionManager.setMask(mask, bounds)에 그대로 넘길 수 있다.
export function channelToMask(src, channel = "l") {
  const w = src.width, h = src.height;
  const n = w * h;
  const mask = new Uint8Array(n);

  const sctx = src.getContext ? src.getContext("2d", { willReadFrequently: true }) : null;
  let sd;
  if (sctx) {
    sd = sctx.getImageData(0, 0, w, h);
  } else {
    const tmp = makeCanvas(w, h);
    tmp.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0);
    sd = tmp.getContext("2d").getImageData(0, 0, w, h);
  }
  const s = sd.data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  // 채널별 값 추출 함수
  let valAt;
  if (channel === "a") valAt = (j) => s[j + 3];
  else if (channel === "r") valAt = (j) => s[j];
  else if (channel === "g") valAt = (j) => s[j + 1];
  else if (channel === "b") valAt = (j) => s[j + 2];
  else valAt = (j) => (LR * s[j] + LG * s[j + 1] + LB * s[j + 2]) | 0; // rgb/l → 휘도

  for (let i = 0; i < n; i++) {
    const v = valAt(i * 4);
    if (v > 0) {
      mask[i] = v;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  const bounds = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  return { mask, bounds };
}
