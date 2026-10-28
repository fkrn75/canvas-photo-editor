// zip.js — OpenRaster(.ora) 왕복용 최소 ZIP 구현(외부 라이브러리 없음, DOM 미사용).
//
// 지원 범위
//  - 쓰기: 항목별 "저장(무압축, method 0)" 또는 "deflate(method 8)". deflate 는 브라우저/Node 내장
//    CompressionStream("deflate-raw") 를 쓰고, 없거나 실패하면 자동으로 무압축 저장으로 대체한다.
//    파일명은 UTF-8(범용 비트 11) 로 기록한다(한글 레이어 파일명 안전).
//  - 읽기: 중앙 디렉터리(Central Directory) 기준. method 0/8 만 지원하고 CRC32 를 검증한다.
//    ZIP64·암호화·분할 아카이브는 지원하지 않는다(명확한 오류).
//
// 순서 보존: ORA 규격상 "mimetype" 항목은 반드시 첫 항목 + 무압축이어야 하므로 entries 순서를
// 그대로 기록한다(호출자가 compress:false 로 넘김).

// ── CRC32(IEEE 802.3, 다항식 0xEDB88320) ─────────────────────────────────────
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return (_crcTable = t);
}

// bytes(Uint8Array)의 CRC32 를 부호 없는 32비트 정수로 반환한다.
export function crc32(bytes, crc = 0) {
  const t = crcTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipError extends Error {
  constructor(msg) { super(msg); this.name = "ZipError"; }
}

const textEncoder = new TextEncoder();

// ZIP 읽기 한도(압축 폭탄 방어). readZip 옵션으로 조정 가능.
export const ZIP_LIMITS = Object.freeze({
  maxEntryBytes: 256 * 1024 * 1024,  // 항목 1개의 해제 후 크기 상한
  maxTotalBytes: 768 * 1024 * 1024,  // 모든 항목 해제 후 크기 합계 상한
  maxEntries: 20000,                  // 항목 수 상한
});

// 스트림 변환(Compression/DecompressionStream) 1회 실행 헬퍼 → Uint8Array
// maxOut: 출력 누적 길이가 이 값을 넘으면 즉시 중단하고 ZipError(압축 폭탄 방어).
async function runStream(stream, bytes, maxOut = Infinity) {
  const writer = stream.writable.getWriter();
  // write/close 를 기다리지 않고 읽기와 병행해야 백프레셔로 교착되지 않는다.
  const done = writer.write(bytes).then(() => writer.close());
  done.catch(() => {}); // 중단·오류 시 쓰기 쪽 거부가 처리되지 않은 rejection 이 되지 않게(정상 경로는 아래 await done 이 던진다)
  const chunks = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    total += value.length;
    if (total > maxOut) {
      reader.cancel().catch(() => {});
      throw new ZipError("ZIP 항목의 압축 해제 크기가 한도를 넘었습니다(압축 폭탄이거나 손상된 파일).");
    }
    chunks.push(value);
  }
  await done;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// raw deflate 압축. 환경이 지원하지 않으면 null(호출자가 무압축으로 대체).
export async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    return await runStream(new CompressionStream("deflate-raw"), bytes);
  } catch {
    return null;
  }
}

// raw deflate 해제. 환경이 지원하지 않으면 오류. maxOut: 해제 후 크기 상한(넘으면 즉시 ZipError).
export async function inflateRaw(bytes, maxOut = ZIP_LIMITS.maxEntryBytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError("이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다.");
  }
  try {
    return await runStream(new DecompressionStream("deflate-raw"), bytes, maxOut);
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError("ZIP 항목의 압축을 풀 수 없습니다(손상된 파일).");
  }
}

// JS Date → MS-DOS 시간/날짜(2초 해상도). 1980 이전은 1980-01-01 로 고정.
function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

// entries: [{ name: string, data: Uint8Array, compress?: boolean(기본 true) }]
// 반환: ZIP 파일 바이트(Uint8Array)
export async function createZip(entries, { date = new Date() } = {}) {
  const { time, date: ddate } = dosDateTime(date);
  const records = [];
  let offset = 0;
  const parts = [];
  for (const e of entries) {
    const nameBytes = textEncoder.encode(e.name);
    const raw = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
    const crc = crc32(raw);
    let method = 0;
    let payload = raw;
    if (e.compress !== false && raw.length > 0) {
      const z = await deflateRaw(raw);
      // 압축 결과가 더 크면 굳이 쓰지 않는다(이미 압축된 PNG 는 대개 이쪽)
      if (z && z.length < raw.length) { method = 8; payload = z; }
    }
    if (payload.length > 0xfffffffe || offset > 0xfffffffe) {
      throw new ZipError("4GB 를 넘는 ZIP 은 지원하지 않습니다.");
    }
    // 로컬 파일 헤더(30바이트 + 이름)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // 필요 버전 2.0
    lv.setUint16(6, 0x0800, true);      // 범용 비트 11 = UTF-8 파일명
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, ddate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);          // extra 길이
    lh.set(nameBytes, 30);
    parts.push(lh, payload);
    records.push({ nameBytes, method, crc, csize: payload.length, usize: raw.length, offset });
    offset += lh.length + payload.length;
  }
  // 중앙 디렉터리
  const cdStart = offset;
  for (const r of records) {
    const ch = new Uint8Array(46 + r.nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // 만든 버전
    cv.setUint16(6, 20, true);          // 필요 버전
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, r.method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, ddate, true);
    cv.setUint32(16, r.crc, true);
    cv.setUint32(20, r.csize, true);
    cv.setUint32(24, r.usize, true);
    cv.setUint16(28, r.nameBytes.length, true);
    // extra/comment/disk/내부속성/외부속성 = 0
    cv.setUint32(42, r.offset, true);
    ch.set(r.nameBytes, 46);
    parts.push(ch);
    offset += ch.length;
  }
  const cdSize = offset - cdStart;
  if (records.length > 0xffff) throw new ZipError("ZIP 항목이 너무 많습니다.");
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, records.length, true);
  ev.setUint16(10, records.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  parts.push(eocd);
  offset += 22;

  const out = new Uint8Array(offset);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ZIP 파일 바이트 → [{ name, data: Uint8Array }] (중앙 디렉터리 순서)
// opts: { maxEntryBytes, maxTotalBytes, maxEntries } — 기본값은 ZIP_LIMITS. 해제 크기는 중앙 디렉터리의 선언값(usize)이
// 한도 이하여야 하고, 실제 해제는 선언값을 넘는 순간 중단한다(선언을 속인 압축 폭탄도 한도 안에서 끝남).
export async function readZip(bytes, opts = {}) {
  const maxEntryBytes = opts.maxEntryBytes ?? ZIP_LIMITS.maxEntryBytes;
  const maxTotalBytes = opts.maxTotalBytes ?? ZIP_LIMITS.maxTotalBytes;
  const maxEntries = opts.maxEntries ?? ZIP_LIMITS.maxEntries;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // EOCD 탐색(뒤에서부터, 코멘트 최대 65535바이트)
  let eocd = -1;
  const minPos = Math.max(0, u8.length - 22 - 0xffff);
  for (let i = u8.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("ZIP 형식이 아닙니다(끝 레코드 없음).");
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) throw new ZipError("ZIP64 형식은 지원하지 않습니다.");
  if (cdOff + cdSize > u8.length) throw new ZipError("ZIP 중앙 디렉터리가 손상되었습니다.");
  if (count > maxEntries) throw new ZipError(`ZIP 항목이 너무 많습니다(${count}개, 최대 ${maxEntries}개).`);

  const dec = new TextDecoder("utf-8");
  const out = [];
  let p = cdOff;
  let totalOut = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
      throw new ZipError("ZIP 중앙 디렉터리가 손상되었습니다.");
    }
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    // 비트 11 이 없어도 ASCII 이름이면 UTF-8 디코딩 결과가 같다(대부분의 ORA 는 ASCII)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw new ZipError(`암호화된 ZIP 항목은 지원하지 않습니다: ${name}`);
    if (lho + 30 > u8.length || dv.getUint32(lho, true) !== 0x04034b50) {
      throw new ZipError(`ZIP 로컬 헤더가 손상되었습니다: ${name}`);
    }
    const lnlen = dv.getUint16(lho + 26, true);
    const lxlen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lxlen;
    if (start + csize > u8.length) throw new ZipError(`ZIP 항목이 잘렸습니다: ${name}`);
    const comp = u8.subarray(start, start + csize);
    if (usize > maxEntryBytes) throw new ZipError(`ZIP 항목이 너무 큽니다(${usize}바이트, 최대 ${maxEntryBytes}바이트): ${name}`);
    totalOut += usize;
    if (totalOut > maxTotalBytes) throw new ZipError(`ZIP 해제 후 총 크기가 한도(${maxTotalBytes}바이트)를 넘습니다.`);
    let data;
    if (method === 0) data = comp.slice();
    else if (method === 8) data = await inflateRaw(comp, usize);
    else throw new ZipError(`지원하지 않는 ZIP 압축 방식(${method}): ${name}`);
    if (data.length !== usize) throw new ZipError(`ZIP 항목 크기가 맞지 않습니다: ${name}`);
    if (crc32(data) !== crc) throw new ZipError(`ZIP CRC 검사 실패: ${name}`);
    out.push({ name, data });
  }
  return out;
}
