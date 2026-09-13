// helpers.js — 테스트 전용 유틸. engine/ 모듈은 브라우저 ImageData 클래스를 전제로 하지만
// Node에는 그 클래스가 없으므로 여기서 최소 호환 폴리필을 두고, 픽셀 조작 헬퍼도 함께 제공한다.

// Node 전역에 ImageData가 없으면 최소 호환 폴리필을 등록한다.
// (imagedata.js의 cropImageData, filters.js의 unsharpMask/highPass가 `new ImageData(...)`를 씀)
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(a, b, c) {
      if (a instanceof Uint8ClampedArray) {
        // new ImageData(data, width, height?)
        this.data = a;
        this.width = b;
        this.height = c ?? a.length / 4 / b;
      } else {
        // new ImageData(width, height)
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      }
    }
  };
}

// width x height 크기의 ImageData 호환 객체를 만든다.
// fill: [r,g,b,a] (기본 불투명 검정)로 전 픽셀을 채운다.
export function makeImageData(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3] ?? 255;
  }
  return { width, height, data };
}

// (x,y) 픽셀을 [r,g,b,a]로 설정
export function setPixel(img, x, y, rgba) {
  const i = (y * img.width + x) * 4;
  img.data[i] = rgba[0]; img.data[i + 1] = rgba[1]; img.data[i + 2] = rgba[2]; img.data[i + 3] = rgba[3] ?? 255;
}

// (x,y) 픽셀을 [r,g,b,a]로 읽기
export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// data 전체가 모두 같은 값인지(예: 단색 채우기 검증)
export function allPixelsEqual(img, rgba) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] !== rgba[0] || img.data[i + 1] !== rgba[1] || img.data[i + 2] !== rgba[2]) return false;
  }
  return true;
}
