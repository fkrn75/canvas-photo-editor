// blur.js — StackBlur 알고리즘 (Mario Klingemann). 반지름과 무관하게 O(n)으로 가우시안에 근사.
// ImageData를 제자리(in-place)에서 흐린다. 큰 반지름도 빠르다.

const MUL = [
  512, 512, 456, 512, 328, 456, 335, 512, 405, 328, 271, 456, 388, 335, 292, 512,
  454, 405, 364, 328, 298, 271, 496, 456, 420, 388, 360, 335, 312, 292, 273, 512,
  482, 454, 428, 405, 383, 364, 345, 328, 312, 298, 284, 271, 259, 496, 475, 456,
  437, 420, 404, 388, 374, 360, 347, 335, 323, 312, 302, 292, 282, 273, 265, 512,
  497, 482, 468, 454, 441, 428, 417, 405, 394, 383, 373, 364, 354, 345, 337, 328,
  320, 312, 305, 298, 291, 284, 278, 271, 265, 259, 507, 496, 485, 475, 465, 456,
  446, 437, 428, 420, 412, 404, 396, 388, 381, 374, 367, 360, 354, 347, 341, 335,
  329, 323, 318, 312, 307, 302, 297, 292, 287, 282, 278, 273, 269, 265, 261, 512,
  505, 497, 489, 482, 475, 468, 461, 454, 447, 441, 435, 428, 422, 417, 411, 405,
  399, 394, 389, 383, 378, 373, 368, 364, 359, 354, 350, 345, 341, 337, 332, 328,
  324, 320, 316, 312, 309, 305, 301, 298, 294, 291, 287, 284, 281, 278, 274, 271,
  268, 265, 262, 259, 257, 507, 501, 496, 491, 485, 480, 475, 470, 465, 460, 456,
  451, 446, 442, 437, 433, 428, 424, 420, 416, 412, 408, 404, 400, 396, 392, 388,
  385, 381, 377, 374, 370, 367, 363, 360, 357, 354, 350, 347, 344, 341, 338, 335,
  332, 329, 326, 323, 320, 318, 315, 312, 310, 307, 304, 302, 299, 297, 294, 292,
  289, 287, 285, 282, 280, 278, 275, 273, 271, 269, 267, 265, 263, 261, 259];

const SHG = [
  9, 11, 12, 13, 13, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16, 17, 17, 17, 17, 17,
  17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19,
  19, 19, 19, 19, 19, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
  20, 20, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21,
  21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22,
  22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22,
  22, 22, 22, 22, 22, 22, 22, 22, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23,
  23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23,
  23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 24, 24, 24, 24,
  24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24,
  24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24,
  24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24,
  24, 24, 24, 24, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25,
  25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25,
  25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25,
  25, 25, 25, 25, 25, 25, 25, 25];

// imageData 제자리 가우시안 근사 블러. radius: 정수 픽셀.
export function stackBlur(imageData, radius) {
  radius = Math.round(radius);
  if (radius < 1) return imageData;
  // 방어 가드: MUL/SHG 룩업테이블은 인덱스 0~254까지만 유효하다.
  // radius가 이를 넘으면 MUL[radius]=undefined → NaN → 화면 전체 검정이 된다.
  // (현재 UI 슬라이더 상한은 100이라 도달 불가지만 무회귀 안전망으로 클램프)
  if (radius > 254) radius = 254;
  const px = imageData.data;
  const w = imageData.width, h = imageData.height;
  const div = radius + radius + 1;
  const widthMinus1 = w - 1, heightMinus1 = h - 1;
  const radiusPlus1 = radius + 1;
  const sumFactor = radiusPlus1 * (radiusPlus1 + 1) / 2;

  const mulSum = MUL[radius], shgSum = SHG[radius];
  const stack = new Array(div);
  for (let i = 0; i < div; i++) stack[i] = [0, 0, 0, 0];

  // 가로 패스
  for (let y = 0; y < h; y++) {
    let rIn = 0, gIn = 0, bIn = 0, aIn = 0;
    let rOut = 0, gOut = 0, bOut = 0, aOut = 0;
    let rSum, gSum, bSum, aSum;
    let p = y * w * 4;
    let sp = stack;

    const pr = px[p], pg = px[p + 1], pb = px[p + 2], pa = px[p + 3];
    for (let i = 0; i < radiusPlus1; i++) { sp[i][0] = pr; sp[i][1] = pg; sp[i][2] = pb; sp[i][3] = pa; }
    rSum = sumFactor * pr; gSum = sumFactor * pg; bSum = sumFactor * pb; aSum = sumFactor * pa;
    rOut = radiusPlus1 * pr; gOut = radiusPlus1 * pg; bOut = radiusPlus1 * pb; aOut = radiusPlus1 * pa;

    for (let i = 1; i <= radius; i++) {
      const pp = p + (Math.min(widthMinus1, i) << 2);
      const s = sp[radiusPlus1 - 1 + i] = [px[pp], px[pp + 1], px[pp + 2], px[pp + 3]];
      const mul = radiusPlus1 - i;
      rSum += s[0] * mul; gSum += s[1] * mul; bSum += s[2] * mul; aSum += s[3] * mul;
      rIn += s[0]; gIn += s[1]; bIn += s[2]; aIn += s[3];
    }

    let stackIn = radius, stackOut = 0;
    for (let x = 0; x < w; x++) {
      px[p] = (rSum * mulSum) >> shgSum;
      px[p + 1] = (gSum * mulSum) >> shgSum;
      px[p + 2] = (bSum * mulSum) >> shgSum;
      px[p + 3] = (aSum * mulSum) >> shgSum;
      rSum -= rOut; gSum -= gOut; bSum -= bOut; aSum -= aOut;

      let sOut = sp[stackOut];
      rOut -= sOut[0]; gOut -= sOut[1]; bOut -= sOut[2]; aOut -= sOut[3];

      const pp = (y * w + Math.min(x + radiusPlus1, widthMinus1)) << 2;
      sOut[0] = px[pp]; sOut[1] = px[pp + 1]; sOut[2] = px[pp + 2]; sOut[3] = px[pp + 3];
      rIn += sOut[0]; gIn += sOut[1]; bIn += sOut[2]; aIn += sOut[3];
      rSum += rIn; gSum += gIn; bSum += bIn; aSum += aIn;

      stackIn = (stackIn + 1) % div;
      const sIn = sp[stackIn];
      rOut += sIn[0]; gOut += sIn[1]; bOut += sIn[2]; aOut += sIn[3];
      rIn -= sIn[0]; gIn -= sIn[1]; bIn -= sIn[2]; aIn -= sIn[3];
      stackOut = (stackOut + 1) % div;
      p += 4;
    }
  }

  // 세로 패스
  for (let x = 0; x < w; x++) {
    let rIn = 0, gIn = 0, bIn = 0, aIn = 0;
    let rOut = 0, gOut = 0, bOut = 0, aOut = 0;
    let p = x << 2;
    let sp = stack;

    const pr = px[p], pg = px[p + 1], pb = px[p + 2], pa = px[p + 3];
    for (let i = 0; i < radiusPlus1; i++) { sp[i][0] = pr; sp[i][1] = pg; sp[i][2] = pb; sp[i][3] = pa; }
    let rSum = sumFactor * pr, gSum = sumFactor * pg, bSum = sumFactor * pb, aSum = sumFactor * pa;
    rOut = radiusPlus1 * pr; gOut = radiusPlus1 * pg; bOut = radiusPlus1 * pb; aOut = radiusPlus1 * pa;

    for (let i = 1; i <= radius; i++) {
      const pp = (Math.min(heightMinus1, i) * w + x) << 2;
      const s = sp[radiusPlus1 - 1 + i] = [px[pp], px[pp + 1], px[pp + 2], px[pp + 3]];
      const mul = radiusPlus1 - i;
      rSum += s[0] * mul; gSum += s[1] * mul; bSum += s[2] * mul; aSum += s[3] * mul;
      rIn += s[0]; gIn += s[1]; bIn += s[2]; aIn += s[3];
    }

    let stackIn = radius, stackOut = 0;
    for (let y = 0; y < h; y++) {
      px[p] = (rSum * mulSum) >> shgSum;
      px[p + 1] = (gSum * mulSum) >> shgSum;
      px[p + 2] = (bSum * mulSum) >> shgSum;
      px[p + 3] = (aSum * mulSum) >> shgSum;
      rSum -= rOut; gSum -= gOut; bSum -= bOut; aSum -= aOut;

      let sOut = sp[stackOut];
      rOut -= sOut[0]; gOut -= sOut[1]; bOut -= sOut[2]; aOut -= sOut[3];

      const pp = (x + (Math.min(y + radiusPlus1, heightMinus1) * w)) << 2;
      sOut[0] = px[pp]; sOut[1] = px[pp + 1]; sOut[2] = px[pp + 2]; sOut[3] = px[pp + 3];
      rIn += sOut[0]; gIn += sOut[1]; bIn += sOut[2]; aIn += sOut[3];
      rSum += rIn; gSum += gIn; bSum += bIn; aSum += aIn;

      stackIn = (stackIn + 1) % div;
      const sIn = sp[stackIn];
      rOut += sIn[0]; gOut += sIn[1]; bOut += sIn[2]; aOut += sIn[3];
      rIn -= sIn[0]; gIn -= sIn[1]; bIn -= sIn[2]; aIn -= sIn[3];
      stackOut = (stackOut + 1) % div;
      p += w << 2;
    }
  }
  return imageData;
}
