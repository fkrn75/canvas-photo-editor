// psd.js — Photoshop PSD/PSB 읽기·쓰기(순수 데이터 계층, DOM 미사용 → node 테스트 가능).
//
// [지원 범위]
//  - 읽기: 8비트 RGB/RGBA·회색조(Duotone 은 회색조로 취급), 압축 Raw(0)/RLE(PackBits, 1).
//    레이어별 이름(유니코드 이름 'luni' 우선)·사각형 위치·불투명도·표시 여부·블렌드 모드·클리핑·
//    투명 영역 잠금·채우기 불투명도('iOpa')·레이어 마스크(-2, 벡터 마스크가 함께 있으면 -3).
//    그룹(섹션 구분자 'lsct'/'lsdk')은 평탄하게 펼치고(숨긴 그룹의 자식은 숨김으로) 개수를 보고한다.
//    조정 레이어는 픽셀이 없어 건너뛰고 보고한다. 레이어 정보가 없으면 합성 이미지 데이터를 쓴다.
//    16/32비트·CMYK·Lab·인덱스·비트맵·멀티채널은 명확한 오류(PsdError).
//  - 쓰기: RGB 8비트, 레이어 레코드(이름 Pascal+'luni', 위치, 불투명도, 표시, 블렌드 모드, 클리핑,
//    채우기 불투명도, 레이어 마스크) + 합성 이미지, 모든 채널 RLE 압축. 해상도 리소스(72dpi) 포함.
//    version=2 면 PSB(대형 문서) 규격(길이 필드 8바이트, RLE 행 길이 4바이트)으로 쓴다.
//
// [데이터 형식] (readPsd 반환 / writePsd 입력 공통)
//   layers: 아래→위 순서(layers[0]=맨 아래, 앱의 LayerManager 와 같은 방향)
//   layer = { name, left, top, width, height, data: RGBA(Uint8ClampedArray, width*height*4),
//             opacity(0~1), fillOpacity(0~1), visible, blendMode(앱 블렌드 id), clipped,
//             lockTransparency, mask: null | { left, top, width, height, data: Uint8Array(회색 1채널),
//             defaultColor(0~255, 사각형 밖 값), disabled } }
//   (쓰기 전용 선택 필드) section: 1|2|3 — 그룹 머리/끝 구분자 레코드로 기록('lsct')

export class PsdError extends Error {
  constructor(msg) { super(msg); this.name = "PsdError"; }
}

// 문서 크기·레이어 수·메모리 안전 한도(악성/손상 파일의 메모리 폭탄 방어).
//  - maxSide: 한 변 절대 상한(app.js 의 IMAGE_MAX_SIDE 와 같은 값)
//  - maxLayers: 픽셀을 가진 레이어 수 상한(그룹 구분자·조정 레이어는 제외)
//  - maxTotalPixels: 문서 픽셀 × 레이어 수(= 앱이 만드는 레이어 캔버스 총 픽셀)와 레이어 사각형 픽셀 합계의 상한
export const DOC_LIMITS = Object.freeze({ maxSide: 16384, maxLayers: 1000, maxTotalPixels: 1 << 28 });

// ── 블렌드 모드 키 ↔ 앱 블렌드 id ───────────────────────────────────────────
export const PSD_BLEND_TO_ID = {
  "norm": "normal", "diss": "dissolve",
  "dark": "darken", "mul ": "multiply", "idiv": "color-burn", "lbrn": "linear-burn",
  "lite": "lighten", "scrn": "screen", "div ": "color-dodge", "lddg": "linear-dodge",
  "over": "overlay", "sLit": "soft-light", "hLit": "hard-light", "vLit": "vivid-light",
  "lLit": "linear-light", "pLit": "pin-light",
  "diff": "difference", "smud": "exclusion",
  "dkCl": "darker-color", "lgCl": "lighter-color", "hMix": "hard-mix", "fsub": "subtract", "fdiv": "divide",
  "hue ": "hue", "sat ": "saturation", "colr": "color", "lum ": "luminosity",
};
export const ID_TO_PSD_BLEND = Object.fromEntries(
  Object.entries(PSD_BLEND_TO_ID).map(([k, v]) => [v, k]),
);

// 조정·칠 레이어 추가 정보 키(픽셀이 없거나 의미가 없어 건너뛴다)
const ADJUSTMENT_KEYS = new Set([
  "brit", "levl", "curv", "expA", "vibA", "hue ", "hue2", "blnc", "blwh", "phfl",
  "mixr", "clrL", "nvrt", "post", "thrs", "grdm", "selc",
]);
// PSB 에서 길이 필드가 8바이트인 추가 정보 키
const PSB_LONG_KEYS = new Set([
  "LMsk", "Lr16", "Lr32", "Layr", "Mt16", "Mt32", "Mtrn", "Alph", "FMsk", "lnk2", "FEid", "FXid", "PxSD",
]);

// ── PackBits(RLE) ───────────────────────────────────────────────────────────
// src[off..off+len) 한 행을 out[outPos..] 에 PackBits 로 쓴다. 반환: 쓴 바이트 수.
// out 은 최소 len + ceil(len/128) 바이트 여유가 있어야 한다.
function packBitsRow(src, off, len, out, outPos) {
  const end = off + len;
  let i = off;
  let o = outPos;
  while (i < end) {
    // 같은 값 반복 길이
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out[o++] = (257 - run) & 0xff; // -(run-1)
      out[o++] = src[i];
      i += run;
      continue;
    }
    // 리터럴: 3연속 반복이 시작되기 전까지(최대 128바이트)
    let j = i;
    while (j < end && j - i < 128) {
      if (j + 2 < end && src[j] === src[j + 1] && src[j] === src[j + 2]) break;
      j++;
    }
    const n = j - i;
    out[o++] = n - 1;
    for (let k = i; k < j; k++) out[o++] = src[k];
    i = j;
  }
  return o - outPos;
}

// src[pos..srcEnd) 의 PackBits 를 dst[dstPos..dstPos+dstLen) 로 푼다(경계 초과분은 버림). 반환: 다음 src 위치.
function packBitsDecodeInto(src, pos, srcEnd, dst, dstPos, dstLen) {
  const dEnd = dstPos + dstLen;
  let d = dstPos;
  while (pos < srcEnd && d < dEnd) {
    let n = src[pos++];
    if (n > 127) n -= 256;
    if (n >= 0) {
      const cnt = n + 1;
      for (let k = 0; k < cnt && pos < srcEnd; k++, pos++) if (d < dEnd) dst[d++] = src[pos];
    } else if (n !== -128) {
      const cnt = 1 - n;
      const v = src[pos++];
      for (let k = 0; k < cnt && d < dEnd; k++) dst[d++] = v;
    }
  }
  return pos;
}

// 단독 사용(테스트·외부)용 API
export function packBitsEncode(bytes) {
  const out = new Uint8Array(bytes.length + Math.ceil(bytes.length / 128) + 1);
  const n = packBitsRow(bytes, 0, bytes.length, out, 0);
  return out.slice(0, n);
}
export function packBitsDecode(bytes, expectedLength) {
  const out = new Uint8Array(expectedLength);
  packBitsDecodeInto(bytes, 0, bytes.length, out, 0, expectedLength);
  return out;
}

// ── 읽기 커서 ───────────────────────────────────────────────────────────────
class Reader {
  constructor(u8) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.p = 0;
  }
  need(n) { if (this.p + n > this.u8.length) throw new PsdError("PSD 파일이 잘렸거나 손상되었습니다."); }
  byte() { this.need(1); return this.u8[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p); this.p += 4; return v; }
  u64() { const hi = this.u32(); const lo = this.u32(); return hi * 4294967296 + lo; }
  ascii(n) { this.need(n); let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8[this.p++]); return s; }
  skip(n) { this.need(n); this.p += n; }
}

// ── 쓰기 커서(자동 확장) ────────────────────────────────────────────────────
class Writer {
  constructor(cap = 1 << 16) {
    this.buf = new Uint8Array(cap);
    this.dv = new DataView(this.buf.buffer);
    this.p = 0;
  }
  ensure(n) {
    if (this.p + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.p + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.p));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v) { this.ensure(1); this.buf[this.p++] = v & 0xff; }
  u16(v) { this.ensure(2); this.dv.setUint16(this.p, v & 0xffff); this.p += 2; }
  i16(v) { this.ensure(2); this.dv.setInt16(this.p, v); this.p += 2; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.p, v >>> 0); this.p += 4; }
  i32(v) { this.ensure(4); this.dv.setInt32(this.p, v | 0); this.p += 4; }
  u64(v) { this.u32(Math.floor(v / 4294967296)); this.u32(v % 4294967296); }
  len(v, size) { if (size === 8) this.u64(v); else this.u32(v); }
  ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  bytes(b) { this.ensure(b.length); this.buf.set(b, this.p); this.p += b.length; }
  zeros(n) { this.ensure(n); this.buf.fill(0, this.p, this.p + n); this.p += n; }
  // 길이 필드를 예약하고, end() 때 (패딩 후) 실제 길이로 채운다.
  begin(size) { const at = this.p; this.zeros(size); return { at, size, start: this.p }; }
  end(m, pad = 1) {
    while ((this.p - m.start) % pad) this.u8(0);
    const n = this.p - m.start;
    if (m.size === 8) {
      this.dv.setUint32(m.at, Math.floor(n / 4294967296));
      this.dv.setUint32(m.at + 4, n % 4294967296);
    } else {
      this.dv.setUint32(m.at, n);
    }
  }
  result() { return this.buf.slice(0, this.p); }
}

// ── 공통 유틸 ───────────────────────────────────────────────────────────────
// 문서 크기 RGBA 에서 알파>0 인 최소 사각형을 잘라낸다. 완전히 비면 크기 0.
export function cropToContent(rgba, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    let row = y * width * 4 + 3;
    for (let x = 0; x < width; x++, row += 4) {
      if (rgba[row] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width: 0, height: 0, data: new Uint8ClampedArray(0) };
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((minY + y) * width + minX) * 4;
    data.set(rgba.subarray(s, s + w * 4), y * w * 4);
  }
  return { left: minX, top: minY, width: w, height: h, data };
}

// RGBA 에서 채널 c(0~3) 평면을 뽑는다
function extractPlane(rgba, count, c) {
  const p = new Uint8Array(count);
  for (let i = 0, j = c; i < count; i++, j += 4) p[i] = rgba[j];
  return p;
}

// 평면 행들을 PackBits 로 인코딩 → { counts: number[], data: Uint8Array }
function encodeRows(plane, w, h) {
  const out = new Uint8Array(h * (w + Math.ceil(w / 128) + 1));
  const counts = new Array(h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const n = packBitsRow(plane, y * w, w, out, p);
    counts[y] = n;
    p += n;
  }
  return { counts, data: out.subarray(0, p) };
}

// 레이어 채널 1개 인코딩(압축 필드 포함). 크기 0이면 Raw(0) 압축 필드만.
function encodeLayerChannel(plane, w, h, psb) {
  if (!w || !h) return new Uint8Array([0, 0]);
  const { counts, data } = encodeRows(plane, w, h);
  const cs = psb ? 4 : 2;
  const out = new Uint8Array(2 + h * cs + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1);
  for (let y = 0; y < h; y++) {
    if (psb) dv.setUint32(2 + y * 4, counts[y]); else dv.setUint16(2 + y * 2, counts[y]);
  }
  out.set(data, 2 + h * cs);
  return out;
}

// 유니코드 이름 → Pascal(ASCII 근사, 비ASCII 는 '?')
function toPascalBytes(name) {
  const s = String(name ?? "").slice(0, 255);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[i] = c >= 32 && c < 127 ? c : 0x3f;
  }
  return b;
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────
// doc = { width, height, layers, composite: { data: RGBA(width*height*4) }, version?: 1|2 }
// 반환: Uint8Array (PSD/PSB 파일 바이트)
export function writePsd(doc) {
  const { width, height } = doc;
  const layers = doc.layers || [];
  const maxSide = Math.max(width, height);
  const version = doc.version === 2 || maxSide > 30000 ? 2 : 1;
  const psb = version === 2;
  if (maxSide > 300000) throw new PsdError("문서가 너무 커서 PSB 로도 저장할 수 없습니다.");
  const comp = doc.composite?.data;
  if (!comp || comp.length !== width * height * 4) throw new PsdError("합성 이미지 데이터가 필요합니다.");
  const lsz = psb ? 8 : 4;

  // 합성 이미지에 투명 픽셀이 있으면 알파 채널 포함(레이어 수를 음수로 기록하는 관례)
  let hasAlpha = false;
  for (let i = 3; i < comp.length; i += 4) if (comp[i] !== 255) { hasAlpha = true; break; }

  const w = new Writer(Math.max(1 << 16, Math.min(width * height * 2, 1 << 26)));
  // 1) 파일 헤더
  w.ascii("8BPS");
  w.u16(version);
  w.zeros(6);
  w.u16(hasAlpha ? 4 : 3);
  w.u32(height);
  w.u32(width);
  w.u16(8);   // 비트 깊이
  w.u16(3);   // 컬러 모드 RGB
  // 2) 컬러 모드 데이터(없음)
  w.u32(0);
  // 3) 이미지 리소스: ResolutionInfo(0x03ED) 72dpi
  const res = w.begin(4);
  w.ascii("8BIM");
  w.u16(0x03ed);
  w.u16(0);             // 빈 Pascal 이름(길이 0 + 짝수 패딩)
  w.u32(16);
  w.u32(72 * 65536); w.u16(1); w.u16(1);
  w.u32(72 * 65536); w.u16(1); w.u16(1);
  w.end(res);

  // 4) 레이어·마스크 정보
  const lmi = w.begin(lsz);
  if (layers.length) {
    // 채널 데이터를 미리 인코딩(레코드에 길이가 먼저 나오므로)
    const encoded = layers.map((L) => {
      const n = L.width * L.height;
      const chans = [];
      const plane = (c) => (n ? extractPlane(L.data, n, c) : new Uint8Array(0));
      // 채널 순서 R,G,B,A(-1). 규격상 순서는 자유지만 채널 id 를 무시하고 RGBA 순으로 읽는
      // 단순 구현(예: Pillow)과도 맞도록 이 순서를 쓴다.
      for (let c = 0; c < 3; c++) chans.push({ id: c, bytes: encodeLayerChannel(plane(c), L.width, L.height, psb) });
      chans.push({ id: -1, bytes: encodeLayerChannel(plane(3), L.width, L.height, psb) });
      if (L.mask) {
        chans.push({ id: -2, bytes: encodeLayerChannel(L.mask.data, L.mask.width, L.mask.height, psb) });
      }
      return chans;
    });

    const li = w.begin(lsz);
    w.i16(hasAlpha ? -layers.length : layers.length);
    layers.forEach((L, idx) => {
      const chans = encoded[idx];
      w.i32(L.top); w.i32(L.left); w.i32(L.top + L.height); w.i32(L.left + L.width);
      w.u16(chans.length);
      for (const ch of chans) { w.i16(ch.id); w.len(ch.bytes.length, lsz); }
      w.ascii("8BIM");
      w.ascii(ID_TO_PSD_BLEND[L.blendMode] || "norm");
      w.u8(Math.round(Math.max(0, Math.min(1, L.opacity ?? 1)) * 255));
      w.u8(L.clipped ? 1 : 0);
      // 플래그: bit0 투명 영역 잠금, bit1 숨김, bit3 (PS5+ 표식)
      w.u8((L.lockTransparency ? 1 : 0) | (L.visible === false ? 2 : 0) | 8);
      w.u8(0);
      const extra = w.begin(4);
      // 레이어 마스크 데이터
      if (L.mask) {
        const m = L.mask;
        w.u32(20);
        w.i32(m.top); w.i32(m.left); w.i32(m.top + m.height); w.i32(m.left + m.width);
        w.u8(m.defaultColor ?? 0);
        w.u8(m.disabled ? 2 : 0);
        w.zeros(2);
      } else {
        w.u32(0);
      }
      // 블렌딩 범위: 합성 회색 + 4채널, 각각 원본/대상 [0,0,255,255]
      w.u32(40);
      for (let k = 0; k < 10; k++) { w.u8(0); w.u8(0); w.u8(255); w.u8(255); }
      // Pascal 이름(1+길이 를 4의 배수로 패딩)
      const pb = toPascalBytes(L.name);
      w.u8(pb.length);
      w.bytes(pb);
      w.zeros((4 - ((1 + pb.length) % 4)) % 4);
      // 유니코드 이름
      const name = String(L.name ?? "");
      w.ascii("8BIM"); w.ascii("luni");
      const lu = w.begin(4);
      w.u32(name.length);
      for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i));
      w.end(lu, 4);
      // 섹션 구분자(그룹): 1=열린 그룹 머리, 2=닫힌 그룹 머리, 3=그룹 끝 구분자. 앱은 그룹이 없어
      // 평소엔 쓰지 않지만 그룹 구조를 가진 데이터(테스트·향후 그룹 저장)를 위해 지원한다.
      if (L.section) {
        w.ascii("8BIM"); w.ascii("lsct");
        w.u32(4);
        w.u32(L.section);
      }
      // 채우기 불투명도
      if (L.fillOpacity != null && L.fillOpacity < 1) {
        w.ascii("8BIM"); w.ascii("iOpa");
        w.u32(4);
        w.u8(Math.round(Math.max(0, L.fillOpacity) * 255));
        w.zeros(3);
      }
      w.end(extra);
    });
    // 채널 이미지 데이터
    for (const chans of encoded) for (const ch of chans) w.bytes(ch.bytes);
    w.end(li, 4);
  } else {
    w.len(0, lsz); // 레이어 정보 없음
  }
  w.u32(0); // 전역 레이어 마스크 정보(없음)
  w.end(lmi);

  // 5) 합성 이미지 데이터(RLE: 전 채널 행 길이 → 전 채널 데이터)
  const n = width * height;
  const nch = hasAlpha ? 4 : 3;
  const rows = [];
  for (let c = 0; c < nch; c++) rows.push(encodeRows(extractPlane(comp, n, c), width, height));
  w.u16(1);
  for (const r of rows) for (const cnt of r.counts) { if (psb) w.u32(cnt); else w.u16(cnt); }
  for (const r of rows) w.bytes(r.data);
  return w.result();
}

// ── 읽기 ────────────────────────────────────────────────────────────────────
const COLOR_MODE_NAMES = { 0: "비트맵", 1: "회색조", 2: "인덱스 색상", 3: "RGB", 4: "CMYK", 7: "멀티채널", 8: "듀오톤", 9: "Lab" };

// 채널 1개 디코드 → Uint8Array(w*h) | null(지원하지 않는 압축)
function decodeChannel(r, compression, w, h, end, psb) {
  if (compression !== 0 && compression !== 1) return null; // 2/3 = ZIP(드묾, 주로 16/32비트)
  const n = w * h;
  // 실제 채널 데이터 바이트 수로 선언 크기를 검증한다(헤더만 큰 악성 파일이 거대한 할당을 못 하게).
  const avail = end - r.p;
  if (compression === 0) {
    if (avail < n) throw new PsdError("PSD 채널 데이터가 부족합니다(손상된 파일).");
  } else {
    // PackBits 는 2바이트로 최대 128 픽셀을 표현 → 압축비는 64:1 을 넘을 수 없다
    if (avail < h * (psb ? 4 : 2) || n > 64 * avail) throw new PsdError("PSD 채널 데이터가 선언된 크기에 비해 너무 작습니다(손상된 파일).");
  }
  const out = new Uint8Array(n);
  if (compression === 0) {
    out.set(r.u8.subarray(r.p, r.p + n));
    return out;
  }
  const counts = new Array(h);
  for (let y = 0; y < h; y++) counts[y] = psb ? r.u32() : r.u16();
  let pos = r.p;
  for (let y = 0; y < h; y++) {
    const rowEnd = Math.min(pos + counts[y], end);
    packBitsDecodeInto(r.u8, pos, rowEnd, out, y * w, w);
    pos += counts[y];
  }
  return out;
}

// 레이어 레코드 1개 파싱
function readLayerRecord(r, psb) {
  const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
  const nch = r.u16();
  const channels = [];
  for (let i = 0; i < nch; i++) channels.push({ id: r.i16(), length: psb ? r.u64() : r.u32() });
  const sig = r.ascii(4);
  if (sig !== "8BIM" && sig !== "8B64") throw new PsdError("PSD 레이어 레코드가 손상되었습니다.");
  const blendKey = r.ascii(4);
  const opacity = r.byte();
  const clipping = r.byte();
  const flags = r.byte();
  r.skip(1);
  const extraLen = r.u32();
  const extraEnd = r.p + extraLen;

  const rec = {
    top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
    channels, blendKey, opacity, clipping, flags,
    name: "", unicodeName: null, section: 0, fillOpacity: 1,
    mask: null, realMask: null, adjustment: false, effects: false, text: false,
  };

  // 레이어 마스크 데이터
  const maskLen = r.u32();
  const maskEnd = r.p + maskLen;
  if (maskLen >= 18) {
    const mt = r.i32(), ml = r.i32(), mb = r.i32(), mr = r.i32();
    const defaultColor = r.byte();
    const mflags = r.byte();
    rec.mask = { top: mt, left: ml, width: Math.max(0, mr - ml), height: Math.max(0, mb - mt), defaultColor, flags: mflags };
    if (maskLen >= 36) {
      // (bit4) 마스크 파라미터 → 실제 플래그/기본색/사각형(벡터 마스크와 공존 시 -3 채널용)
      if (mflags & 16) {
        const pf = r.byte();
        if (pf & 1) r.skip(1);
        if (pf & 2) r.skip(8);
        if (pf & 4) r.skip(1);
        if (pf & 8) r.skip(8);
      }
      if (maskEnd - r.p >= 18) {
        const realFlags = r.byte();
        const realDefault = r.byte();
        const rt = r.i32(), rl = r.i32(), rb = r.i32(), rr = r.i32();
        rec.realMask = { top: rt, left: rl, width: Math.max(0, rr - rl), height: Math.max(0, rb - rt), defaultColor: realDefault, flags: realFlags };
      }
    }
  }
  r.p = maskEnd;
  // 블렌딩 범위(건너뜀)
  const brLen = r.u32();
  r.skip(brLen);
  // Pascal 이름(4바이트 패딩)
  const nl = r.byte();
  rec.name = r.ascii(nl);
  r.skip((4 - ((1 + nl) % 4)) % 4);
  // 추가 레이어 정보 블록
  while (r.p + 12 <= extraEnd) {
    const bsig = r.ascii(4);
    if (bsig !== "8BIM" && bsig !== "8B64") break;
    const key = r.ascii(4);
    const len = psb && PSB_LONG_KEYS.has(key) ? r.u64() : r.u32();
    const start = r.p;
    if (start + len > extraEnd) break;
    if (key === "luni" && len >= 4) {
      const cnt = r.u32();
      let s = "";
      for (let i = 0; i < cnt && r.p + 2 <= start + len; i++) s += String.fromCharCode(r.u16());
      rec.unicodeName = s.replace(/\0+$/, "");
    } else if ((key === "lsct" || key === "lsdk") && len >= 4) {
      rec.section = r.u32();
    } else if (key === "iOpa" && len >= 1) {
      rec.fillOpacity = r.byte() / 255;
    } else if (ADJUSTMENT_KEYS.has(key)) {
      rec.adjustment = true;
    } else if (key === "lrFX" || key === "lfx2" || key === "lmfx") {
      rec.effects = true;
    } else if (key === "TySh" || key === "tySh") {
      rec.text = true;
    }
    r.p = start + len;
  }
  r.p = extraEnd;
  return rec;
}

// 레이어 정보 블록(레이어 수 + 레코드 + 채널 이미지 데이터) 파싱
// 그룹 구분자(1·2·3)·조정 레이어는 픽셀을 만들지 않는다(buildLayers 가 건너뜀)
function isPixelRecord(rec) {
  return !(rec.section === 1 || rec.section === 2 || rec.section === 3) && !rec.adjustment;
}

// 레이어 수·사각형 크기·메모리 예산 검사 — 어떤 픽셀 버퍼도 할당하기 전에 호출한다.
function checkLayerLimits(recs, docW, docH) {
  const { maxSide, maxLayers, maxTotalPixels } = DOC_LIMITS;
  let layerCount = 0;
  let pixels = 0; // 레이어 사각형 픽셀 합계(마스크는 1바이트라 1/4 로 환산)
  for (const rec of recs) {
    if (!isPixelRecord(rec)) continue;
    layerCount++;
    if (rec.width > maxSide || rec.height > maxSide) {
      throw new PsdError(`레이어 '${rec.unicodeName ?? rec.name}' 의 크기(${rec.width}×${rec.height})가 한 변 ${maxSide}px 를 넘어 열 수 없습니다.`);
    }
    if (rec.mask && (rec.mask.width > maxSide || rec.mask.height > maxSide)) {
      throw new PsdError(`레이어 마스크의 크기(${rec.mask.width}×${rec.mask.height})가 한 변 ${maxSide}px 를 넘어 열 수 없습니다.`);
    }
    if (rec.channels.length) {
      pixels += rec.width * rec.height;
      if (rec.mask) pixels += (rec.mask.width * rec.mask.height) / 4;
    }
  }
  if (layerCount > maxLayers) {
    throw new PsdError(`레이어가 너무 많습니다(${layerCount}개). 최대 ${maxLayers}개까지 열 수 있습니다.`);
  }
  if (docW * docH * Math.max(1, layerCount) > maxTotalPixels) {
    throw new PsdError(`문서가 너무 커서 열 수 없습니다(${docW}×${docH}, 레이어 ${layerCount}개). 메모리 보호를 위해 레이어 수 × 픽셀 수가 제한됩니다.`);
  }
  if (pixels > maxTotalPixels) {
    throw new PsdError("레이어 픽셀 합계가 너무 커서 열 수 없습니다(손상되었거나 악의적인 파일일 수 있습니다).");
  }
}

function readLayerInfo(r, end, psb, warnings, docW, docH) {
  let count = r.i16();
  const hasAlpha = count < 0;
  count = Math.abs(count);
  const recs = [];
  for (let i = 0; i < count; i++) recs.push(readLayerRecord(r, psb));
  checkLayerLimits(recs, docW, docH);
  let zipWarned = false;
  for (const rec of recs) {
    const planes = {};
    const skipPixels = !isPixelRecord(rec); // 구분자·조정 레이어는 채널을 디코드하지 않고 건너뜀
    for (const ch of rec.channels) {
      const start = r.p;
      const chEnd = start + ch.length;
      if (chEnd > r.u8.length) throw new PsdError("PSD 채널 데이터가 잘렸습니다.");
      if (ch.length >= 2 && !skipPixels) {
        const compression = r.u16();
        let w = rec.width, h = rec.height;
        if (ch.id === -2) { w = rec.mask?.width || 0; h = rec.mask?.height || 0; }
        else if (ch.id === -3) { w = rec.realMask?.width || 0; h = rec.realMask?.height || 0; }
        if (w > 0 && h > 0 && ch.id >= -3) {
          const plane = decodeChannel(r, compression, w, h, chEnd, psb);
          if (plane) planes[ch.id] = plane;
          else if (!zipWarned) { warnings.push("ZIP 압축 채널은 지원하지 않아 일부 레이어가 비어 있을 수 있습니다."); zipWarned = true; }
        }
      }
      r.p = chEnd;
    }
    rec.planes = planes;
  }
  r.p = end;
  return { recs, hasAlpha };
}

// 파싱된 레코드 → 앱 레이어 데이터. 그룹은 펼치고 조정 레이어는 건너뛴다.
function buildLayers(recs, isGray, stats) {
  const out = [];
  const groupHidden = []; // 위→아래 순회 중 열린 그룹들의 숨김 여부
  for (let i = recs.length - 1; i >= 0; i--) {
    const rec = recs[i];
    if (rec.section === 1 || rec.section === 2) {
      // 그룹 머리(위쪽). 바깥 그룹이 숨김이면 안쪽도 숨김.
      const parentHidden = groupHidden.length ? groupHidden[groupHidden.length - 1] : false;
      groupHidden.push(parentHidden || !!(rec.flags & 2));
      stats.groups++;
      continue;
    }
    if (rec.section === 3) { groupHidden.pop(); continue; } // 그룹 끝 구분자(아래쪽)
    if (rec.adjustment) { stats.adjustments++; continue; }
    if (rec.effects) stats.effects++;
    if (rec.text) stats.text++;

    const P = rec.planes || {};
    const R = P[0], G = isGray ? P[0] : P[1], B = isGray ? P[0] : P[2], A = P[-1];
    // 색·알파 채널이 하나도 없으면(채널 0개·ZIP 미지원 등) 빈 레이어로 둔다 — 사각형이 아무리 커도 픽셀을 할당하지 않는다.
    const hasPixels = !!(R || G || B || A);
    const lw = hasPixels ? rec.width : 0, lh = hasPixels ? rec.height : 0;
    const n = lw * lh;
    const data = new Uint8ClampedArray(n * 4);
    for (let k = 0, j = 0; k < n; k++, j += 4) {
      data[j] = R ? R[k] : 0;
      data[j + 1] = G ? G[k] : 0;
      data[j + 2] = B ? B[k] : 0;
      data[j + 3] = A ? A[k] : 255;
    }
    let blendMode = PSD_BLEND_TO_ID[rec.blendKey];
    if (!blendMode) { blendMode = "normal"; stats.unknownBlend.add(rec.blendKey); }

    // 마스크: 벡터 마스크와 공존하면 -3(실제 사각형), 아니면 -2
    let mask = null;
    const mm = P[-3] && rec.realMask ? { info: rec.realMask, plane: P[-3] } : (P[-2] && rec.mask ? { info: rec.mask, plane: P[-2] } : null);
    if (mm) {
      mask = {
        left: mm.info.left, top: mm.info.top, width: mm.info.width, height: mm.info.height,
        data: mm.plane, defaultColor: mm.info.defaultColor, disabled: !!(mm.info.flags & 2),
      };
    }

    const parentHidden = groupHidden.length ? groupHidden[groupHidden.length - 1] : false;
    out.unshift({
      name: rec.unicodeName ?? rec.name,
      left: rec.left, top: rec.top, width: lw, height: lh, data,
      opacity: rec.opacity / 255,
      fillOpacity: rec.fillOpacity,
      visible: !(rec.flags & 2) && !parentHidden,
      blendMode,
      clipped: rec.clipping === 1,
      lockTransparency: !!(rec.flags & 1),
      mask,
    });
  }
  // 펼침/생략으로 맨 아래가 된 레이어는 클리핑 베이스가 없다
  if (out.length) out[0].clipped = false;
  return out;
}

// 파일 헤더(26바이트) 파싱·형식 검증. 문서 크기 상한은 여기서 검사하지 않는다(호출자가 정책 결정).
function parseHeader(u8, r) {
  if (u8.length < 26 || r.ascii(4) !== "8BPS") throw new PsdError("PSD 파일이 아닙니다(서명 불일치).");
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new PsdError(`지원하지 않는 PSD 버전(${version})입니다.`);
  const psb = version === 2;
  r.skip(6);
  const channelCount = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  const warnings = [];

  const modeName = COLOR_MODE_NAMES[mode] || `알 수 없음(${mode})`;
  if (mode === 4) throw new PsdError("CMYK PSD 는 지원하지 않습니다. Photoshop 에서 [이미지 > 모드 > RGB 색상]으로 바꿔 저장해 주세요.");
  if (mode !== 3 && mode !== 1 && mode !== 8) {
    throw new PsdError(`${modeName} 모드 PSD 는 지원하지 않습니다. RGB 또는 회색조로 바꿔 저장해 주세요.`);
  }
  if (depth !== 8) {
    throw new PsdError(`${depth}비트/채널 PSD 는 지원하지 않습니다. Photoshop 에서 [이미지 > 모드 > 8비트/채널]로 바꿔 저장해 주세요.`);
  }
  if (!width || !height) throw new PsdError("PSD 문서 크기가 올바르지 않습니다.");
  const isGray = mode === 1 || mode === 8;
  if (mode === 8) warnings.push("듀오톤 문서는 회색조로 열었습니다.");
  return { version, psb, channelCount, width, height, depth, mode, isGray, warnings };
}

// 헤더만 읽어 { version, width, height, channelCount, depth, colorMode } 를 돌려준다(픽셀 디코드 없음).
// 큰 문서 확인 대화상자를 디코드보다 먼저 띄우는 데 쓴다. 서명·버전·색상 모드·비트 깊이 오류는 PsdError.
export function readPsdHeader(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const h = parseHeader(u8, new Reader(u8));
  return { version: h.version, width: h.width, height: h.height, channelCount: h.channelCount, depth: h.depth, colorMode: h.isGray ? "grayscale" : "rgb" };
}

// input: ArrayBuffer | Uint8Array
// opts.composite: true 면 레이어가 있어도 합성 이미지를 함께 디코드(기본: 레이어가 없을 때만)
export function readPsd(input, opts = {}) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new Reader(u8);
  const { version, psb, channelCount, width, height, depth, isGray, warnings } = parseHeader(u8, r);
  if (width > DOC_LIMITS.maxSide || height > DOC_LIMITS.maxSide) {
    throw new PsdError(`PSD 문서가 너무 큽니다(${width}×${height}). 한 변이 ${DOC_LIMITS.maxSide}px 를 넘는 문서는 열 수 없습니다.`);
  }

  // 컬러 모드 데이터 / 이미지 리소스(건너뜀)
  r.skip(r.u32());
  r.skip(r.u32());

  // 레이어·마스크 정보
  const lmLen = psb ? r.u64() : r.u32();
  const lmEnd = r.p + lmLen;
  if (lmEnd > u8.length) throw new PsdError("PSD 레이어 정보가 잘렸습니다.");
  let info = null;
  if (lmLen > 0) {
    const liLen = psb ? r.u64() : r.u32();
    const liEnd = r.p + liLen;
    if (liLen > 0) info = readLayerInfo(r, liEnd, psb, warnings, width, height);
    r.p = liEnd;
    // 전역 레이어 마스크 정보
    if (r.p + 4 <= lmEnd) { const g = r.u32(); r.p = Math.min(lmEnd, r.p + g); }
    // 전역 추가 정보: 레이어 정보가 'Layr' 블록에 들어 있는 경우 대비
    while (!info && r.p + 12 <= lmEnd) {
      let sig = r.ascii(4);
      // 4바이트 정렬 패딩 허용
      let guard = 0;
      while (sig !== "8BIM" && sig !== "8B64" && guard++ < 3 && r.p + 9 <= lmEnd) {
        r.p -= 3; sig = r.ascii(4);
      }
      if (sig !== "8BIM" && sig !== "8B64") break;
      const key = r.ascii(4);
      const len = psb && PSB_LONG_KEYS.has(key) ? r.u64() : r.u32();
      const start = r.p;
      if (start + len > lmEnd) break;
      if (key === "Layr" && len > 0) info = readLayerInfo(r, start + len, psb, warnings, width, height);
      r.p = start + len;
    }
  }
  r.p = lmEnd;

  const stats = { groups: 0, adjustments: 0, effects: 0, text: 0, unknownBlend: new Set() };
  const layers = info ? buildLayers(info.recs, isGray, stats) : [];
  if (stats.groups) warnings.push(`레이어 그룹 ${stats.groups}개를 펼쳤습니다(그룹 불투명도·블렌드 모드는 적용되지 않음).`);
  if (stats.adjustments) warnings.push(`조정 레이어 ${stats.adjustments}개는 지원하지 않아 생략했습니다.`);
  if (stats.text) warnings.push(`텍스트 레이어 ${stats.text}개는 래스터(픽셀) 레이어로 열었습니다.`);
  if (stats.effects) warnings.push(`레이어 효과(스타일)가 있는 레이어 ${stats.effects}개 — 효과는 적용되지 않습니다.`);
  if (stats.unknownBlend.size) warnings.push(`지원하지 않는 블렌드 모드(${[...stats.unknownBlend].map((k) => k.trim()).join(", ")})는 표준으로 바꿨습니다.`);

  // 합성 이미지 데이터
  let composite = null;
  if (!layers.length || opts.composite) {
    if (r.p + 2 > u8.length) throw new PsdError("PSD 합성 이미지 데이터가 없습니다.");
    const compression = r.u16();
    const colorCh = isGray ? 1 : 3;
    if (channelCount < colorCh) {
      throw new PsdError(`PSD 합성 이미지의 채널 수가 부족합니다(${channelCount}개, 최소 ${colorCh}개 필요).`);
    }
    // 알파: 레이어 수 음수 표식(합성에 투명도 포함)이 있을 때만 4번째 채널을 투명도로 쓴다.
    // (레이어 없는 평면 PSD 의 여분 채널은 저장된 선택 영역(알파 채널)이라 투명도가 아님)
    const useAlpha = channelCount > colorCh && (info ? info.hasAlpha : false);
    const need = Math.min(channelCount, colorCh + (useAlpha ? 1 : 0));
    const n = width * height;
    const planes = [];
    if (compression === 0) {
      if (u8.length - r.p < need * n) throw new PsdError("PSD 합성 이미지 데이터가 잘렸습니다.");
      for (let c = 0; c < need; c++) {
        const s = r.p + c * n;
        const pl = new Uint8Array(n);
        pl.set(u8.subarray(s, Math.min(s + n, u8.length)));
        planes.push(pl);
      }
    } else if (compression === 1) {
      const cs = psb ? 4 : 2;
      const total = channelCount * height;
      if (r.p + total * cs > u8.length) throw new PsdError("PSD 합성 이미지 데이터가 잘렸습니다.");
      const counts = new Array(total);
      for (let i = 0; i < total; i++) counts[i] = psb ? r.u32() : r.u16();
      // PackBits 압축비 상한(64:1)보다 큰 선언 크기는 거짓 헤더 → 할당 전에 거부
      if (need * n > 64 * (u8.length - r.p)) throw new PsdError("PSD 합성 이미지 데이터가 선언된 크기에 비해 너무 작습니다(손상된 파일).");
      let pos = r.p;
      for (let c = 0; c < need; c++) {
        const pl = new Uint8Array(n);
        for (let y = 0; y < height; y++) {
          const cnt = counts[c * height + y];
          packBitsDecodeInto(u8, pos, Math.min(pos + cnt, u8.length), pl, y * width, width);
          pos += cnt;
        }
        planes.push(pl);
      }
    } else {
      throw new PsdError("ZIP 압축된 합성 이미지는 지원하지 않습니다.");
    }
    const data = new Uint8ClampedArray(n * 4);
    const R = planes[0], G = isGray ? planes[0] : planes[1], B = isGray ? planes[0] : planes[2];
    const A = useAlpha ? planes[colorCh] : null;
    for (let k = 0, j = 0; k < n; k++, j += 4) {
      data[j] = R[k]; data[j + 1] = G[k]; data[j + 2] = B[k]; data[j + 3] = A ? A[k] : 255;
    }
    composite = { width, height, data };
  }

  return { width, height, version, colorMode: isGray ? "grayscale" : "rgb", depth, layers, composite, warnings, groupCount: stats.groups };
}
