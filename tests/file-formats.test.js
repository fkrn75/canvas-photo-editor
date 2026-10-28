// file-formats.test.js — 레이어 보존 포맷(PSD/PSB/ORA)과 ZIP·PackBits 의 순수 데이터 계층 테스트.
// DOM 캔버스 없이 psd.js / ora.js / zip.js 만으로 쓰기→읽기 왕복을 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";

import { crc32, createZip, readZip, inflateRaw, deflateRaw, ZipError } from "../js/io/zip.js";
import {
  packBitsEncode, packBitsDecode, writePsd, readPsd, readPsdHeader, cropToContent, PsdError, DOC_LIMITS,
  PSD_BLEND_TO_ID, ID_TO_PSD_BLEND,
} from "../js/io/psd.js";
import {
  buildStackXml, parseStackXml, packOra, unpackOra, blendToOraOp, oraOpToBlend, ORA_MIMETYPE, OraError,
} from "../js/io/ora.js";
import { EventBus } from "../js/core/event-bus.js";
import { EVT } from "../js/core/constants.js";
import { Clipboard } from "../js/io/clipboard.js";
import { BLEND_MODES } from "../js/engine/blend.js";

const enc = new TextEncoder();

// 결정적 의사난수(재현 가능한 테스트 데이터)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// w×h RGBA 레이어 데이터(패턴 + 일부 반투명)
function makeRgba(w, h, seed) {
  const r = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    // 행 단위 반복 구간과 무작위 구간을 섞어 RLE 의 두 경로(반복/리터럴)를 모두 탄다
    const px = i / 4;
    const flat = (px % w) < w / 2;
    d[i] = flat ? 200 : (r() * 256) | 0;
    d[i + 1] = flat ? 10 : (r() * 256) | 0;
    d[i + 2] = flat ? 77 : (r() * 256) | 0;
    d[i + 3] = flat ? 255 : (r() * 256) | 0;
  }
  return d;
}

// ── CRC32 / ZIP ─────────────────────────────────────────────────────────────
test("crc32: 표준 검사값(\"123456789\" → 0xCBF43926)", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("zip: 저장/deflate 항목 왕복 + UTF-8 이름 + 순서 보존", async () => {
  const big = enc.encode("반복되는 텍스트 ".repeat(500)); // 잘 압축됨 → deflate 경로
  const rand = new Uint8Array(1000);
  const r = rng(7);
  for (let i = 0; i < rand.length; i++) rand[i] = (r() * 256) | 0;
  const entries = [
    { name: "mimetype", data: enc.encode("image/openraster"), compress: false },
    { name: "data/레이어.txt", data: big },
    { name: "rand.bin", data: rand },
    { name: "empty", data: new Uint8Array(0) },
  ];
  const zip = await createZip(entries);
  // ORA 규격: 첫 항목 mimetype 은 무압축이라 로컬 헤더 바로 뒤(오프셋 38)에 평문으로 보인다
  assert.equal(new TextDecoder().decode(zip.subarray(38, 38 + 16)), "image/openraster");
  // deflate 가 실제로 쓰였는지(전체 크기가 원본 합보다 작음)
  assert.ok(zip.length < big.length);
  const out = await readZip(zip);
  assert.deepEqual(out.map((e) => e.name), entries.map((e) => e.name));
  for (let i = 0; i < entries.length; i++) assert.deepEqual(out[i].data, entries[i].data);
});

test("zip: CRC 불일치(손상)를 감지한다", async () => {
  const zip = await createZip([{ name: "a.txt", data: enc.encode("hello world"), compress: false }]);
  zip[30 + 5] ^= 0xff; // 로컬 헤더(30) + 이름(5) 뒤 첫 데이터 바이트 변조
  await assert.rejects(readZip(zip), (e) => e instanceof ZipError && /CRC/.test(e.message));
});

test("zip: ZIP 이 아니면 오류", async () => {
  await assert.rejects(readZip(enc.encode("not a zip file at all, just text....")), ZipError);
});

// ── PackBits ────────────────────────────────────────────────────────────────
test("PackBits: 다양한 패턴 인코딩→디코딩 왕복", () => {
  const r = rng(42);
  const cases = [
    new Uint8Array(0),
    new Uint8Array([5]),
    new Uint8Array([1, 1]),
    new Uint8Array(300).fill(9),                          // 128 초과 반복
    Uint8Array.from({ length: 300 }, (_, i) => i & 0xff), // 128 초과 리터럴
    Uint8Array.from({ length: 1000 }, () => (r() < 0.5 ? 0 : (r() * 4) | 0)),
    Uint8Array.from({ length: 777 }, () => (r() * 256) | 0),
  ];
  for (const src of cases) {
    const packed = packBitsEncode(src);
    assert.ok(packed.length <= src.length + Math.ceil(src.length / 128) + 1);
    assert.deepEqual(packBitsDecode(packed, src.length), src);
  }
});

test("PackBits: 알려진 벡터(Apple TN1023 예시) 디코드", () => {
  const packed = new Uint8Array([0xfe, 0xaa, 0x02, 0x80, 0x00, 0x2a, 0xfd, 0xaa, 0x03, 0x80, 0x00, 0x2a, 0x22, 0xf7, 0xaa]);
  const expected = new Uint8Array([
    0xaa, 0xaa, 0xaa, 0x80, 0x00, 0x2a, 0xaa, 0xaa, 0xaa, 0xaa, 0x80, 0x00, 0x2a, 0x22,
    0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa,
  ]);
  assert.deepEqual(packBitsDecode(packed, expected.length), expected);
});

// ── PSD ─────────────────────────────────────────────────────────────────────
function sampleDoc(version = 1) {
  const W = 37, H = 23;
  const comp = makeRgba(W, H, 99);
  const maskData = Uint8Array.from({ length: 10 * 6 }, (_, i) => (i * 17) & 0xff);
  return {
    width: W, height: H, version,
    composite: { data: comp },
    layers: [
      { name: "배경", left: 0, top: 0, width: W, height: H, data: makeRgba(W, H, 1), opacity: 1, visible: true, blendMode: "normal" },
      { name: "곱하기 레이어 ✨", left: 5, top: 3, width: 20, height: 11, data: makeRgba(20, 11, 2),
        opacity: 128 / 255, visible: false, blendMode: "multiply", fillOpacity: 51 / 255, lockTransparency: true },
      { name: "clip", left: 10, top: 8, width: 12, height: 9, data: makeRgba(12, 9, 3),
        opacity: 1, visible: true, blendMode: "linear-burn", clipped: true,
        mask: { left: 2, top: 4, width: 10, height: 6, data: maskData, defaultColor: 255, disabled: true } },
      { name: "빈 레이어", left: 0, top: 0, width: 0, height: 0, data: new Uint8ClampedArray(0), opacity: 1, visible: true, blendMode: "screen" },
    ],
  };
}

for (const version of [1, 2]) {
  const label = version === 1 ? "PSD" : "PSB";
  test(`${label}: 쓰기→읽기 왕복(레이어 수·이름·불투명도·표시·블렌드·클리핑·마스크·픽셀)`, () => {
    const doc = sampleDoc(version);
    const bytes = writePsd(doc);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "8BPS");
    assert.equal((bytes[4] << 8) | bytes[5], version);
    const back = readPsd(bytes, { composite: true });
    assert.equal(back.width, doc.width);
    assert.equal(back.height, doc.height);
    assert.equal(back.version, version);
    assert.equal(back.layers.length, doc.layers.length);
    assert.deepEqual(back.warnings, []);
    doc.layers.forEach((src, i) => {
      const L = back.layers[i];
      assert.equal(L.name, src.name);
      assert.equal(L.left, src.left);
      assert.equal(L.top, src.top);
      assert.equal(L.width, src.width);
      assert.equal(L.height, src.height);
      assert.ok(Math.abs(L.opacity - src.opacity) < 1 / 255);
      assert.equal(L.visible, src.visible);
      assert.equal(L.blendMode, src.blendMode);
      assert.equal(L.clipped, !!src.clipped);
      assert.equal(L.lockTransparency, !!src.lockTransparency);
      assert.ok(Math.abs(L.fillOpacity - (src.fillOpacity ?? 1)) < 1 / 255);
      assert.deepEqual(L.data, src.data);
      if (src.mask) {
        assert.equal(L.mask.left, src.mask.left);
        assert.equal(L.mask.top, src.mask.top);
        assert.equal(L.mask.width, src.mask.width);
        assert.equal(L.mask.height, src.mask.height);
        assert.equal(L.mask.defaultColor, 255);
        assert.equal(L.mask.disabled, true);
        assert.deepEqual(L.mask.data, src.mask.data);
      } else {
        assert.equal(L.mask, null);
      }
    });
    // 합성 이미지(투명 포함 → 알파 채널 + 음수 레이어 수)
    assert.deepEqual(back.composite.data, doc.composite.data);
  });
}

test("PSD: 레이어 없는 문서는 합성 이미지로 읽힌다(불투명 → 3채널)", () => {
  const W = 9, H = 4;
  const comp = makeRgba(W, H, 5);
  for (let i = 3; i < comp.length; i += 4) comp[i] = 255;
  const back = readPsd(writePsd({ width: W, height: H, layers: [], composite: { data: comp } }));
  assert.equal(back.layers.length, 0);
  assert.deepEqual(back.composite.data, comp);
});

test("PSD: 그룹(섹션 구분자)은 평탄하게 펼치고, 숨긴 그룹의 자식은 숨김", () => {
  const W = 4, H = 4;
  const px = (seed) => ({ left: 0, top: 0, width: W, height: H, data: makeRgba(W, H, seed), opacity: 1, visible: true, blendMode: "normal" });
  const empty = { left: 0, top: 0, width: 0, height: 0, data: new Uint8ClampedArray(0), opacity: 1, blendMode: "normal" };
  // 파일 순서(아래→위): 바닥, [구분자, 자식A, 자식B, 그룹머리(숨김)], 맨위
  const layers = [
    { ...px(1), name: "바닥" },
    { ...empty, name: "</Layer group>", section: 3, visible: true },
    { ...px(2), name: "자식A" },
    { ...px(3), name: "자식B" },
    { ...empty, name: "그룹", section: 1, visible: false },
    { ...px(4), name: "맨위" },
  ];
  const back = readPsd(writePsd({ width: W, height: H, layers, composite: { data: makeRgba(W, H, 9) } }));
  assert.deepEqual(back.layers.map((l) => l.name), ["바닥", "자식A", "자식B", "맨위"]);
  assert.deepEqual(back.layers.map((l) => l.visible), [true, false, false, true]);
  assert.equal(back.groupCount, 1);
  assert.ok(back.warnings.some((w) => /그룹 1개/.test(w)));
});

test("PSD: 16비트·CMYK·서명 불일치는 명확한 오류", () => {
  const ok = writePsd({ width: 2, height: 2, layers: [], composite: { data: makeRgba(2, 2, 1) } });
  const depth16 = ok.slice(); depth16[23] = 16;           // 비트 깊이(오프셋 22~23)
  assert.throws(() => readPsd(depth16), (e) => e instanceof PsdError && /16비트/.test(e.message));
  const cmyk = ok.slice(); cmyk[25] = 4;                  // 컬러 모드(오프셋 24~25)
  assert.throws(() => readPsd(cmyk), (e) => e instanceof PsdError && /CMYK/.test(e.message));
  assert.throws(() => readPsd(enc.encode("hello world, not a psd file")), PsdError);
  assert.throws(() => readPsd(ok.subarray(0, 40)), PsdError); // 잘린 파일
});

test("PSD: 블렌드 모드 키 매핑이 앱 BLEND_MODES 전부를 덮는다(왕복 가능)", () => {
  for (const m of BLEND_MODES) {
    if (m.sep) continue;
    const key = ID_TO_PSD_BLEND[m.id];
    assert.ok(key && key.length === 4, `${m.id} 키 없음`);
    assert.equal(PSD_BLEND_TO_ID[key], m.id);
  }
});

test("cropToContent: 알파>0 최소 사각형, 빈 이미지는 크기 0", () => {
  const W = 6, H = 5;
  const d = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, a) => { d[(y * W + x) * 4 + 3] = a; d[(y * W + x) * 4] = 11; };
  assert.equal(cropToContent(d, W, H).width, 0);
  set(1, 2, 255); set(4, 3, 1);
  const c = cropToContent(d, W, H);
  assert.deepEqual([c.left, c.top, c.width, c.height], [1, 2, 4, 2]);
  assert.equal(c.data[3], 255);
  assert.equal(c.data[(1 * 4 + 3) * 4 + 3], 1);
});

// ── ORA ─────────────────────────────────────────────────────────────────────
test("ORA: stack.xml 생성→파싱 왕복(순서·이스케이프·표시·블렌드)", () => {
  const layers = [
    { name: "배경", src: "data/layer0.png", x: 0, y: 0, opacity: 1, visible: true, blendMode: "normal" },
    { name: "a<b>&\"c\"", src: "data/layer1.png", x: 3, y: -2, opacity: 0.5, visible: false, blendMode: "multiply" },
    { name: "선형 번", src: "data/layer2.png", x: 10, y: 20, opacity: 0.25, visible: true, blendMode: "linear-burn" },
  ];
  const xml = buildStackXml({ width: 640, height: 480, layers });
  // 규격: 위 레이어가 먼저
  assert.ok(xml.indexOf("layer2.png") < xml.indexOf("layer0.png"));
  assert.match(xml, /composite-op="svg:multiply"/);
  const p = parseStackXml(xml);
  assert.equal(p.width, 640);
  assert.equal(p.height, 480);
  assert.equal(p.groupCount, 0);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.layers, layers);
});

test("ORA: 외부 stack.xml(중첩 그룹·오프셋·숨김·미지원 op) 파싱", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 다른 프로그램이 만든 파일 -->
<image w='100' h='50' version="0.0.3">
  <stack>
    <layer src="data/top.png" name="Top &amp; &#xD55C;" opacity="0.8" composite-op="krita:weird"/>
    <stack name="그룹" visibility="hidden" x="5" y="6">
      <layer src="data/in.png" name="안쪽" x="1" y="2" composite-op="svg:screen"/>
    </stack>
    <layer src="data/bottom.png" name="Bottom"></layer>
  </stack>
</image>`;
  const p = parseStackXml(xml);
  assert.equal(p.width, 100);
  assert.equal(p.groupCount, 1);
  assert.deepEqual(p.layers.map((l) => l.name), ["Bottom", "안쪽", "Top & 한"]);
  const inner = p.layers[1];
  assert.deepEqual([inner.x, inner.y, inner.visible, inner.blendMode], [6, 8, false, "screen"]);
  assert.equal(p.layers[2].blendMode, "normal");
  assert.equal(p.layers[2].opacity, 0.8);
  assert.ok(p.warnings.some((w) => /krita:weird/.test(w)));
  assert.throws(() => parseStackXml("<stack></stack>"));
});

test("ORA: 블렌드 op 매핑 왕복(모든 앱 블렌드 모드)", () => {
  for (const m of BLEND_MODES) {
    if (m.sep) continue;
    assert.equal(oraOpToBlend(blendToOraOp(m.id)), m.id);
  }
  assert.equal(oraOpToBlend("cpe:없는모드"), null);
});

test("ORA: pack→unpack 왕복(mimetype 첫 항목·무압축, 레이어 PNG 바이트 보존)", async () => {
  const fakePng = (n) => Uint8Array.from({ length: 50 + n }, (_, i) => (i * (n + 3)) & 0xff);
  const layers = [
    { name: "아래", x: 0, y: 0, opacity: 1, visible: true, blendMode: "normal", png: fakePng(1) },
    { name: "위", x: 4, y: 5, opacity: 0.3, visible: false, blendMode: "overlay", png: fakePng(2) },
  ];
  const zip = await packOra({ width: 8, height: 9, layers, mergedPng: fakePng(3), thumbnailPng: fakePng(4) });
  const entries = await readZip(zip);
  assert.equal(entries[0].name, "mimetype");
  assert.equal(new TextDecoder().decode(zip.subarray(30, 38)), "mimetype");
  assert.equal(new TextDecoder().decode(zip.subarray(38, 38 + ORA_MIMETYPE.length)), ORA_MIMETYPE);
  assert.ok(entries.some((e) => e.name === "Thumbnails/thumbnail.png"));
  const back = await unpackOra(zip);
  assert.equal(back.width, 8);
  assert.equal(back.height, 9);
  assert.deepEqual(back.warnings, []);
  assert.equal(back.layers.length, 2);
  back.layers.forEach((L, i) => {
    const s = layers[i];
    assert.equal(L.name, s.name);
    assert.equal(L.x, s.x);
    assert.equal(L.y, s.y);
    assert.equal(L.opacity, s.opacity);
    assert.equal(L.visible, s.visible);
    assert.equal(L.blendMode, s.blendMode);
    assert.deepEqual(L.png, s.png);
  });
  assert.deepEqual(back.mergedPng, fakePng(3));
});

test("ORA: mimetype 불일치는 오류", async () => {
  const zip = await createZip([
    { name: "mimetype", data: enc.encode("application/zip"), compress: false },
    { name: "stack.xml", data: enc.encode("<image w='1' h='1'><stack/></image>") },
  ]);
  await assert.rejects(unpackOra(zip), /OpenRaster/);
});

// ── 안전 한도: 악성/손상 입력(메모리 폭탄) ───────────────────────────────────
// 손으로 만든 최소 PSD 바이트. layers: [{ rect:[top,left,bottom,right], channels:[{ id, bytes }] }]
// (bytes 는 압축 필드 2바이트 + 데이터. 채널 데이터는 레코드 뒤에 순서대로 이어 붙는다.)
function concat(arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function rawPsd({ w, h, channelCount = 3, layers = [], mode = 3 }) {
  const parts = [];
  const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
  const i16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return b; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
  const i32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return b; };
  parts.push(enc.encode("8BPS"), u16(1), new Uint8Array(6), u16(channelCount), u32(h), u32(w), u16(8), u16(mode));
  parts.push(u32(0), u32(0)); // 컬러 모드 데이터 / 이미지 리소스
  if (!layers.length) {
    parts.push(u32(0)); // 레이어·마스크 정보 없음
  } else {
    const li = [i16(layers.length)];
    for (const L of layers) {
      const [t, l, b, r] = L.rect;
      li.push(i32(t), i32(l), i32(b), i32(r), u16(L.channels.length));
      for (const c of L.channels) li.push(i16(c.id), u32(c.bytes.length));
      li.push(enc.encode("8BIM"), enc.encode("norm"), new Uint8Array([255, 0, 0, 0]));
      li.push(u32(12), u32(0), u32(0), new Uint8Array(4)); // extra: 마스크 없음, 블렌딩 범위 없음, 빈 Pascal 이름(4바이트)
    }
    for (const L of layers) for (const c of L.channels) li.push(c.bytes);
    const liBytes = concat(li);
    parts.push(u32(4 + liBytes.length + 4), u32(liBytes.length), liBytes, u32(0));
  }
  return concat(parts);
}
const rawCh = (id, n) => ({ id, bytes: concat([new Uint8Array([0, 0]), new Uint8Array(n)]) }); // Raw 압축 + n바이트
const emptyCh = (id) => ({ id, bytes: new Uint8Array([0, 0]) }); // 데이터 없는 채널
const fastly = (fn) => { const t = performance.now(); try { return fn(); } finally { assert.ok(performance.now() - t < 1500, "폭탄 입력은 빠르게 끝나야 한다"); } };

test("PSD 한도: 헤더 20000×20000 이면 readPsd 는 즉시 PsdError, readPsdHeader 는 크기만 돌려준다(디코드 없음)", () => {
  const bomb = rawPsd({ w: 20000, h: 20000, channelCount: 0 });
  assert.ok(bomb.length < 200);
  assert.throws(() => fastly(() => readPsd(bomb)), (e) => e instanceof PsdError && /너무 큽니다/.test(e.message));
  const head = readPsdHeader(bomb);
  assert.equal(head.width, 20000);
  assert.equal(head.height, 20000);
  assert.equal(head.colorMode, "rgb");
  // 형식 오류는 헤더 단계에서도 PsdError
  assert.throws(() => readPsdHeader(enc.encode("not a psd, just text........")), PsdError);
});

test("PSD 한도: 채널 0개인 거대 레이어 사각형은 픽셀을 할당하지 않고 빈 레이어로 열린다", () => {
  const bytes = rawPsd({ w: 16, h: 16, layers: [{ rect: [0, 0, 16384, 16384], channels: [] }] });
  const back = fastly(() => readPsd(bytes));
  assert.equal(back.layers.length, 1);
  assert.equal(back.layers[0].width, 0);
  assert.equal(back.layers[0].height, 0);
  assert.equal(back.layers[0].data.length, 0);
});

test("PSD 한도: 데이터가 거의 없는데 큰 사각형을 선언한 채널(Raw/RLE)은 할당 전에 PsdError", () => {
  const raw = rawPsd({ w: 16, h: 16, layers: [{ rect: [0, 0, 16384, 16384], channels: [emptyCh(0), emptyCh(1), emptyCh(2)] }] });
  assert.throws(() => fastly(() => readPsd(raw)), PsdError);
  // RLE: 행 길이 표만 있고 본문이 없는 16384×16384 (선언 268M 픽셀 vs 실제 32KB)
  const rle = new Uint8Array(2 + 16384 * 2); rle[1] = 1; // 압축=1
  const rleBomb = rawPsd({ w: 16, h: 16, layers: [{ rect: [0, 0, 16384, 16384], channels: [{ id: 0, bytes: rle }] }] });
  assert.throws(() => fastly(() => readPsd(rleBomb)), (e) => e instanceof PsdError && /너무 작습니다/.test(e.message));
});

test("PSD 한도: 레이어 사각형 한 변이 16384 초과면 PsdError", () => {
  const bytes = rawPsd({ w: 8, h: 8, layers: [{ rect: [0, 0, 1, 20000], channels: [rawCh(0, 20000)] }] });
  assert.throws(() => readPsd(bytes), (e) => e instanceof PsdError && /16384/.test(e.message));
});

test("PSD 한도: 레이어 수 상한(1000) 초과와 문서×레이어 메모리 예산 초과는 PsdError", () => {
  const one = () => ({ rect: [0, 0, 1, 1], channels: [rawCh(0, 1), rawCh(1, 1), rawCh(2, 1)] });
  const many = rawPsd({ w: 1, h: 1, layers: Array.from({ length: DOC_LIMITS.maxLayers + 1 }, one) });
  assert.throws(() => fastly(() => readPsd(many)), (e) => e instanceof PsdError && /레이어가 너무 많습니다/.test(e.message));
  // 정확히 상한 개수는 열린다
  const ok = rawPsd({ w: 1, h: 1, layers: Array.from({ length: DOC_LIMITS.maxLayers }, one) });
  assert.equal(readPsd(ok).layers.length, DOC_LIMITS.maxLayers);
  // 16384×16384 문서 + 레이어 2개 = 레이어 캔버스 5억 픽셀 → 거부
  const budget = rawPsd({ w: 16384, h: 16384, layers: [one(), one()] });
  assert.throws(() => fastly(() => readPsd(budget)), (e) => e instanceof PsdError && /메모리/.test(e.message));
});

test("PSD: RGB 인데 채널 수가 3 미만인 합성 이미지는 TypeError 가 아니라 PsdError", () => {
  const comp = makeRgba(4, 4, 1);
  for (let i = 3; i < comp.length; i += 4) comp[i] = 255;
  const ok = writePsd({ width: 4, height: 4, layers: [], composite: { data: comp } });
  assert.equal(readPsd(ok).composite.width, 4);
  const bad = ok.slice(); bad[12] = 0; bad[13] = 1; // 채널 수(오프셋 12~13) = 1
  assert.throws(() => readPsd(bad), (e) => e instanceof PsdError && /채널 수/.test(e.message));
  const gray = ok.slice(); gray[12] = 0; gray[13] = 1; gray[25] = 1; // 회색조는 채널 1개면 충분(경로가 여전히 동작)
  assert.doesNotThrow(() => readPsd(gray));
  // 합성 본문이 선언 크기보다 모자란 Raw 도 PsdError
  const raw = rawPsd({ w: 100, h: 100, channelCount: 3 });
  assert.throws(() => readPsd(concat([raw, new Uint8Array([0, 0])])), PsdError);
});

test("PSD 한도: 정상 파일 왕복은 한도 도입 후에도 그대로(레이어 다수·마스크·PSB)", () => {
  for (const version of [1, 2]) {
    const doc = sampleDoc(version);
    const back = readPsd(writePsd(doc), { composite: true });
    assert.equal(back.layers.length, doc.layers.length);
    assert.deepEqual(back.layers[0].data, doc.layers[0].data);
    assert.deepEqual(back.composite.data, doc.composite.data);
  }
});

// ZIP 폭탄: 64MB 의 0 은 수십 KB 로 압축된다
async function makeBombZip() {
  const zeros = new Uint8Array(64 * 1024 * 1024);
  return createZip([{ name: "bomb.bin", data: zeros }]);
}
function patchUsize(zip, value) { // 중앙 디렉터리·로컬 헤더의 비압축 크기 필드를 위조
  const z = zip.slice();
  const dv = new DataView(z.buffer);
  for (let i = 0; i + 46 < z.length; i++) {
    if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, value, true);
    if (dv.getUint32(i, true) === 0x04034b50) dv.setUint32(i + 22, value, true);
  }
  return z;
}

test("ZIP 폭탄: 선언 크기를 속인 deflate 항목은 선언 크기를 넘는 즉시 중단", async () => {
  const bomb = await makeBombZip();
  assert.ok(bomb.length < 200 * 1024, `압축 결과가 충분히 작아야 한다(${bomb.length})`);
  const t = performance.now();
  await assert.rejects(readZip(patchUsize(bomb, 1000)), (e) => e instanceof ZipError && /한도|압축 폭탄/.test(e.message));
  assert.ok(performance.now() - t < 3000, "전체를 다 풀지 않고 빠르게 끝나야 한다");
});

test("ZIP 폭탄: 항목/총합/개수 한도 옵션과 inflateRaw 출력 상한", async () => {
  const bomb = await makeBombZip();
  // 선언 크기가 한도 초과 → 풀기 전에 거부
  await assert.rejects(readZip(bomb, { maxEntryBytes: 1024 * 1024 }), (e) => e instanceof ZipError && /너무 큽니다/.test(e.message));
  // 정상 선언 + 한도 이내면 풀린다
  const [e0] = await readZip(bomb, { maxEntryBytes: 128 * 1024 * 1024 });
  assert.equal(e0.data.length, 64 * 1024 * 1024);
  // 총합 한도 / 항목 수 한도
  const two = await createZip([{ name: "a", data: new Uint8Array(1000) }, { name: "b", data: new Uint8Array(1000) }]);
  await assert.rejects(readZip(two, { maxTotalBytes: 1500 }), /총 크기/);
  await assert.rejects(readZip(two, { maxEntries: 1 }), /너무 많습니다/);
  // inflateRaw 직접: 출력 상한
  const z = await deflateRaw(new Uint8Array(32 * 1024 * 1024));
  await assert.rejects(inflateRaw(z, 1024), (e) => e instanceof ZipError && /한도/.test(e.message));
  assert.equal((await inflateRaw(z, 64 * 1024 * 1024)).length, 32 * 1024 * 1024);
});

test("ZIP: 정상 압축 항목 왕복은 한도 도입 후에도 그대로", async () => {
  const data = enc.encode("반복 ".repeat(5000));
  const [e] = await readZip(await createZip([{ name: "t.txt", data }]));
  assert.deepEqual(e.data, data);
});

// ORA 레이어 수 폭탄
test("ORA 한도: <layer/> 20만 개는 상한 도달 즉시 OraError", async () => {
  const xml = `<image w="10" h="10"><stack>${'<layer src="a.png"/>'.repeat(200000)}</stack></image>`;
  const t = performance.now();
  assert.throws(() => parseStackXml(xml), (e) => e instanceof OraError && /레이어가 너무 많습니다/.test(e.message));
  assert.ok(performance.now() - t < 1500);
  const zip = await createZip([
    { name: "mimetype", data: enc.encode(ORA_MIMETYPE), compress: false },
    { name: "stack.xml", data: enc.encode(xml) },
  ]);
  await assert.rejects(unpackOra(zip), OraError);
});

test("ORA 한도: 문서 한 변 초과·문서×레이어 메모리 예산 초과는 OraError, 정상 크기는 통과", () => {
  assert.throws(() => parseStackXml('<image w="20000" h="10"><stack/></image>'), (e) => e instanceof OraError && /16384/.test(e.message));
  const layers = (n) => '<layer src="a.png"/>'.repeat(n);
  assert.throws(() => parseStackXml(`<image w="16384" h="16384"><stack>${layers(2)}</stack></image>`), (e) => e instanceof OraError && /메모리/.test(e.message));
  assert.equal(parseStackXml(`<image w="16384" h="16384"><stack>${layers(1)}</stack></image>`).layers.length, 1);
  assert.equal(parseStackXml(`<image w="100" h="100"><stack>${layers(DOC_LIMITS.maxLayers)}</stack></image>`).layers.length, DOC_LIMITS.maxLayers);
});

// 클립보드: 제자리에 붙여넣기 버퍼의 수명
function fakeClipboardApp(w = 100, h = 80) {
  const added = [];
  const app = {
    bus: new EventBus(),
    layers: { width: w, height: h, addLayer: (o) => added.push(o) },
    status: () => {},
  };
  return { app, added };
}

test("클립보드: 문서 크기 변경/교체(DOCUMENT_CHANGED) 시 제자리 붙여넣기 버퍼를 비우고, 일반 편집 이벤트에서는 유지", () => {
  const prevWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const { app, added } = fakeClipboardApp();
    const cb = new Clipboard(app);
    const fill = () => { cb.buffer = { canvas: {}, x: 5, y: 6, w: 10, h: 10, docW: 100, docH: 80 }; };
    // 같은 문서 안의 일반 편집(레이어/선택/히스토리/색 변경)은 버퍼를 건드리지 않는다
    fill();
    for (const ev of [EVT.LAYERS_CHANGED, EVT.ACTIVE_LAYER_CHANGED, EVT.SELECTION_CHANGED, EVT.HISTORY_CHANGED, EVT.COLOR_CHANGED]) app.bus.emit(ev, {});
    cb.pasteInPlace();
    assert.equal(added.length, 1);
    assert.equal(added[0].x, 5);
    assert.equal(added[0].y, 6);
    // 문서 크기 변경/교체 이벤트 → 버퍼 폐기, 붙여넣기는 안내만 하고 레이어를 만들지 않음
    fill();
    app.bus.emit(EVT.DOCUMENT_CHANGED, { width: 50, height: 40 });
    assert.equal(cb.buffer, null);
    cb.pasteInPlace();
    assert.equal(added.length, 1);
    // 이벤트 없이 문서 크기만 달라진 경우(새 문서 경로)도 붙여넣기 시점에 걸러낸다
    fill();
    app.layers.width = 200;
    cb.pasteInPlace();
    assert.equal(added.length, 1);
    assert.equal(cb.buffer, null);
  } finally {
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
});
