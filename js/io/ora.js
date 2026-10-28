// ora.js — OpenRaster(.ora) 읽기·쓰기(순수 데이터 계층, DOM 미사용 → node 테스트 가능).
//
// ORA = ZIP(첫 항목 "mimetype" 무압축 = "image/openraster") + stack.xml + data/*.png
//       + Thumbnails/thumbnail.png(최대 256px) + mergedimage.png(전체 합성).
// PNG 인코딩/디코딩은 캔버스가 필요하므로 file-io.js 가 담당하고, 여기서는 PNG 바이트만 다룬다.
//
// [레이어 메타 형식] (아래→위 순서, 앱 LayerManager 와 같은 방향)
//   { name, src, x, y, opacity(0~1), visible, blendMode(앱 블렌드 id), png?: Uint8Array }
// stack.xml 은 규격대로 "위 레이어가 먼저" 나오므로 쓰기/읽기에서 순서를 뒤집는다.
// 중첩 <stack>(그룹)은 평탄하게 펼치고(숨긴 그룹의 자식은 숨김, x/y 오프셋 누적) 개수를 보고한다.

import { createZip, readZip } from "./zip.js";
import { normalizeBlendMode } from "../engine/blend.js";
import { DOC_LIMITS } from "./psd.js"; // 문서 크기·레이어 수·메모리 한도(PSD 와 공유)

export class OraError extends Error {
  constructor(msg) { super(msg); this.name = "OraError"; }
}

export const ORA_MIMETYPE = "image/openraster";

// 앱 블렌드 id ↔ ORA composite-op. 규격(svg:*)에 없는 모드는 자체 네임스페이스 "cpe:" 로 왕복한다
// (다른 프로그램은 모르는 값을 표준(src-over)으로 취급한다).
const ID_TO_OP = {
  "normal": "svg:src-over", "multiply": "svg:multiply", "screen": "svg:screen", "overlay": "svg:overlay",
  "darken": "svg:darken", "lighten": "svg:lighten", "color-dodge": "svg:color-dodge", "color-burn": "svg:color-burn",
  "hard-light": "svg:hard-light", "soft-light": "svg:soft-light", "difference": "svg:difference",
  "exclusion": "svg:exclusion", "hue": "svg:hue", "saturation": "svg:saturation", "color": "svg:color",
  "luminosity": "svg:luminosity", "linear-dodge": "svg:plus",
};
const OP_TO_ID = Object.fromEntries(Object.entries(ID_TO_OP).map(([k, v]) => [v, k]));

export function blendToOraOp(id) {
  const m = normalizeBlendMode(id);
  return ID_TO_OP[m] || `cpe:${m}`;
}
// 알 수 없는 op 면 null
export function oraOpToBlend(op) {
  if (!op) return "normal";
  if (OP_TO_ID[op]) return OP_TO_ID[op];
  if (op.startsWith("cpe:")) {
    const id = op.slice(4);
    if (normalizeBlendMode(id) === id) return id;
  }
  return null;
}

// ── XML 유틸 ────────────────────────────────────────────────────────────────
function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
function unescXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return "\"";
    if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return ""; }
  });
}
function parseAttrs(s) {
  const out = {};
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = unescXml(m[3] ?? m[4] ?? "");
  return out;
}
function num(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

// 레이어 메타(아래→위) → stack.xml 문자열
export function buildStackXml({ width, height, layers }) {
  const lines = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<image version="0.0.5" w="${width | 0}" h="${height | 0}" xres="72" yres="72">`,
    "  <stack>",
  ];
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    const op = Math.max(0, Math.min(1, L.opacity ?? 1));
    lines.push(
      `    <layer name="${escAttr(L.name)}" src="${escAttr(L.src)}" x="${L.x | 0}" y="${L.y | 0}"` +
      ` opacity="${op.toFixed(3)}" visibility="${L.visible === false ? "hidden" : "visible"}"` +
      ` composite-op="${escAttr(blendToOraOp(L.blendMode))}"/>`,
    );
  }
  lines.push("  </stack>", "</image>", "");
  return lines.join("\n");
}

// stack.xml 문자열 → { width, height, layers(아래→위), groupCount, warnings }
export function parseStackXml(xml) {
  const src = String(xml)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<![^>]*>/g, "");
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let width = 0, height = 0;
  let sawImage = false;
  const stacks = []; // { hidden, x, y }
  const topFirst = [];
  let groupCount = 0;
  const unknownOps = new Set();
  let m;
  while ((m = tagRe.exec(src))) {
    const closing = m[1] === "/";
    const tag = m[2];
    const selfClose = m[4] === "/";
    if (tag === "image" && !closing) {
      const a = parseAttrs(m[3]);
      width = Math.round(num(a.w, 0));
      height = Math.round(num(a.h, 0));
      sawImage = true;
    } else if (tag === "stack") {
      if (closing) { stacks.pop(); continue; }
      const a = parseAttrs(m[3]);
      const parent = stacks[stacks.length - 1] || { hidden: false, x: 0, y: 0 };
      if (stacks.length >= 1) groupCount++; // 루트 stack 은 그룹이 아님
      const st = {
        hidden: parent.hidden || a.visibility === "hidden",
        x: parent.x + Math.round(num(a.x, 0)),
        y: parent.y + Math.round(num(a.y, 0)),
      };
      if (!selfClose) stacks.push(st);
    } else if (tag === "layer" && !closing) {
      // 레이어 수 폭탄 방어: 한도를 넘는 순간 중단(수십만 개를 끝까지 파싱하지 않는다)
      if (topFirst.length >= DOC_LIMITS.maxLayers) {
        throw new OraError(`레이어가 너무 많습니다. 최대 ${DOC_LIMITS.maxLayers}개까지 열 수 있습니다.`);
      }
      const a = parseAttrs(m[3]);
      const parent = stacks[stacks.length - 1] || { hidden: false, x: 0, y: 0 };
      let blendMode = oraOpToBlend(a["composite-op"]);
      if (!blendMode) { unknownOps.add(a["composite-op"]); blendMode = "normal"; }
      topFirst.push({
        name: a.name ?? "",
        src: a.src ?? "",
        x: parent.x + Math.round(num(a.x, 0)),
        y: parent.y + Math.round(num(a.y, 0)),
        opacity: Math.max(0, Math.min(1, num(a.opacity, 1))),
        visible: a.visibility !== "hidden" && !parent.hidden,
        blendMode,
      });
    }
  }
  if (!sawImage) throw new OraError("stack.xml 에 <image> 요소가 없습니다.");
  if (!width || !height) throw new OraError("stack.xml 의 문서 크기(w/h)가 올바르지 않습니다.");
  if (width > DOC_LIMITS.maxSide || height > DOC_LIMITS.maxSide) {
    throw new OraError(`문서가 너무 큽니다(${width}×${height}). 한 변이 ${DOC_LIMITS.maxSide}px 를 넘는 문서는 열 수 없습니다.`);
  }
  if (width * height * Math.max(1, topFirst.length) > DOC_LIMITS.maxTotalPixels) {
    throw new OraError(`문서가 너무 커서 열 수 없습니다(${width}×${height}, 레이어 ${topFirst.length}개). 메모리 보호를 위해 레이어 수 × 픽셀 수가 제한됩니다.`);
  }
  const warnings = [];
  if (groupCount) warnings.push(`레이어 그룹 ${groupCount}개를 펼쳤습니다(그룹 불투명도·블렌드 모드는 적용되지 않음).`);
  if (unknownOps.size) warnings.push(`지원하지 않는 합성 방식(${[...unknownOps].join(", ")})은 표준으로 바꿨습니다.`);
  return { width, height, layers: topFirst.reverse(), groupCount, warnings };
}

// ORA 패키징. layers: 메타 + png(Uint8Array), 아래→위. src 는 여기서 data/layerN.png 로 정한다.
export async function packOra({ width, height, layers, mergedPng, thumbnailPng }) {
  const metas = layers.map((L, i) => ({ ...L, src: `data/layer${i}.png` }));
  const xml = buildStackXml({ width, height, layers: metas });
  const enc = new TextEncoder();
  const entries = [
    { name: "mimetype", data: enc.encode(ORA_MIMETYPE), compress: false },
    { name: "stack.xml", data: enc.encode(xml) },
  ];
  // PNG 는 이미 압축돼 있으므로 무압축 저장(재압축 시간 절약)
  for (const L of metas) entries.push({ name: L.src, data: L.png, compress: false });
  if (thumbnailPng) entries.push({ name: "Thumbnails/thumbnail.png", data: thumbnailPng, compress: false });
  if (mergedPng) entries.push({ name: "mergedimage.png", data: mergedPng, compress: false });
  return createZip(entries);
}

// ORA 해체 → { width, height, layers(아래→위, png 포함), mergedPng, warnings, groupCount }
export async function unpackOra(bytes) {
  const entries = await readZip(bytes);
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const warnings = [];
  const mt = files.get("mimetype");
  if (!mt) warnings.push("mimetype 항목이 없습니다(비표준 ORA).");
  else if (new TextDecoder().decode(mt).trim() !== ORA_MIMETYPE) {
    throw new OraError("OpenRaster 파일이 아닙니다(mimetype 불일치).");
  }
  const xmlBytes = files.get("stack.xml");
  if (!xmlBytes) throw new OraError("stack.xml 이 없습니다.");
  const parsed = parseStackXml(new TextDecoder().decode(xmlBytes));
  warnings.push(...parsed.warnings);
  const layers = [];
  let missing = 0, nonPng = 0;
  for (const L of parsed.layers) {
    const png = files.get(L.src) ?? files.get(L.src.replace(/^\.?\//, ""));
    if (!png) { missing++; continue; }
    if (!/\.png$/i.test(L.src)) nonPng++;
    layers.push({ ...L, png });
  }
  if (missing) warnings.push(`이미지 파일이 없는 레이어 ${missing}개를 건너뛰었습니다.`);
  if (nonPng) warnings.push(`PNG 가 아닌 레이어 ${nonPng}개가 있습니다(열리지 않을 수 있음).`);
  return {
    width: parsed.width, height: parsed.height, layers,
    mergedPng: files.get("mergedimage.png") || null,
    warnings, groupCount: parsed.groupCount,
  };
}
