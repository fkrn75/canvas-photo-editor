// blend.js — 레이어 블렌드 모드(Photoshop 7 레이어 모드 22종).
// 네이티브 16종은 Canvas globalCompositeOperation으로, 커스텀 6종은 per-pixel로 합성한다.
// per-pixel은 W3C Compositing & Blending 1 명세의 블렌드식 + source-over 합성식(straight alpha)을 따른다.
//
// 좌표계 주의: per-pixel 정확성을 위해 합성은 반드시 "문서 좌표계"(레이어 캔버스와 1:1)에서 수행한다.
// 따라서 layer-manager.compositeTo는 문서 크기 오프스크린에 이 함수로 합성한 뒤 결과를 한 번에 표시 ctx로 그린다.

// ── 드롭다운 구성 ──────────────────────────────────────────────────────────
// id: 내부 식별자(layer.blendMode 값) / label: 화면 표시(영문+한글 병기) / sep: 그룹 구분선
// PS7 레이어 모드 22종. (Behind/Clear=페인팅 전용, Hard Mix=PS7 미존재 → 제외)
export const BLEND_MODES = [
  { id: "normal",       label: "Normal · 표준" },
  { id: "dissolve",     label: "Dissolve · 디졸브" },
  { sep: true },
  { id: "darken",       label: "Darken · 어둡게 하기" },
  { id: "multiply",     label: "Multiply · 곱하기" },
  { id: "color-burn",   label: "Color Burn · 색상 번" },
  { id: "linear-burn",  label: "Linear Burn · 선형 번" },
  { sep: true },
  { id: "lighten",      label: "Lighten · 밝게 하기" },
  { id: "screen",       label: "Screen · 스크린" },
  { id: "color-dodge",  label: "Color Dodge · 색상 닷지" },
  { id: "linear-dodge", label: "Linear Dodge · 선형 닷지(추가)" },
  { sep: true },
  { id: "overlay",      label: "Overlay · 오버레이" },
  { id: "soft-light",   label: "Soft Light · 소프트 라이트" },
  { id: "hard-light",   label: "Hard Light · 하드 라이트" },
  { id: "vivid-light",  label: "Vivid Light · 비비드 라이트" },
  { id: "linear-light", label: "Linear Light · 선형 라이트" },
  { id: "pin-light",    label: "Pin Light · 핀 라이트" },
  { sep: true },
  { id: "difference",   label: "Difference · 차이" },
  { id: "exclusion",    label: "Exclusion · 제외" },
  { sep: true },
  { id: "hue",          label: "Hue · 색조" },
  { id: "saturation",   label: "Saturation · 채도" },
  { id: "color",        label: "Color · 색상" },
  { id: "luminosity",   label: "Luminosity · 광도" },
];

// 네이티브 모드 → Canvas globalCompositeOperation 매핑.
// (여기 없는 id는 커스텀 per-pixel 처리 대상)
const NATIVE_GCO = {
  normal: "source-over",
  darken: "darken",
  multiply: "multiply",
  "color-burn": "color-burn",
  lighten: "lighten",
  screen: "screen",
  "color-dodge": "color-dodge",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

// 커스텀(per-pixel) 모드 집합
const CUSTOM = new Set([
  "dissolve", "linear-burn", "linear-dodge",
  "vivid-light", "linear-light", "pin-light",
]);

// 유효성 검사용(드롭다운/마이그레이션). 알 수 없는 값은 normal로 취급.
const VALID = new Set(BLEND_MODES.filter((m) => !m.sep).map((m) => m.id));
export function isValidBlendMode(id) { return VALID.has(id); }
export function normalizeBlendMode(id) { return VALID.has(id) ? id : "normal"; }

// 라벨 조회(상태바 등 표시용)
export function blendModeLabel(id) {
  const m = BLEND_MODES.find((x) => x.id === id);
  return m ? m.label : id;
}

// 0~1 clamp
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── per-pixel 채널 블렌드식 ────────────────────────────────────────────────
// cb=배경 채널(0~1), cs=소스 채널(0~1). 반환=블렌드 결과 채널(0~1, clamp).
function colorBurnCh(cb, cs) {
  // W3C: cs==0 → 0, else 1 - min(1, (1-cb)/cs)
  if (cs <= 0) return 0;
  return 1 - Math.min(1, (1 - cb) / cs);
}
function colorDodgeCh(cb, cs) {
  // W3C: cs==1 → 1, else min(1, cb/(1-cs))
  if (cs >= 1) return 1;
  return Math.min(1, cb / (1 - cs));
}
function linearBurnCh(cb, cs)  { return clamp01(cb + cs - 1); }
function linearDodgeCh(cb, cs) { return clamp01(cb + cs); }
function vividLightCh(cb, cs) {
  // cs<=0.5 → colorBurn(cb, 2cs) / else colorDodge(cb, 2(cs-0.5))
  return cs <= 0.5 ? colorBurnCh(cb, 2 * cs) : colorDodgeCh(cb, 2 * (cs - 0.5));
}
function linearLightCh(cb, cs) { return clamp01(cb + 2 * cs - 1); }
function pinLightCh(cb, cs) {
  // cs<=0.5 → min(cb, 2cs) / else max(cb, 2(cs-0.5))
  return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * (cs - 0.5));
}

// id → 채널 블렌드 함수 (dissolve 제외: dissolve는 채널식이 아니라 알파 마스킹 방식)
const CH_FN = {
  "linear-burn": linearBurnCh,
  "linear-dodge": linearDodgeCh,
  "vivid-light": vividLightCh,
  "linear-light": linearLightCh,
  "pin-light": pinLightCh,
};

// ── per-pixel 합성 본체 ────────────────────────────────────────────────────
// 배경 ImageData(backdrop)와 소스 ImageData(src) + layerOpacity(0~1)를 받아
// 채널 블렌드식 모드를 W3C 합성식으로 합쳐 backdrop을 in-place 갱신한다.
//
// W3C 합성(straight alpha, co-glow 표기):
//   αs = src.a * layerOpacity, αb = backdrop.a, αo = αs + αb*(1-αs)
//   blended = (1-αb)*Cs + αb*B(Cb,Cs)        (블렌드는 αb 가중)
//   Co' = αs*blended + (1-αs)*αb*Cb          (premultiplied 출력)
//   Co  = Co' / αo                           (다시 straight alpha)
function blendChannelMode(backdrop, src, fn, layerOpacity) {
  const b = backdrop.data, s = src.data, n = b.length;
  for (let i = 0; i < n; i += 4) {
    const as = (s[i + 3] / 255) * layerOpacity;
    if (as <= 0) continue;            // 소스 완전 투명 → 배경 유지
    const ab = b[i + 3] / 255;
    const ao = as + ab * (1 - as);
    if (ao <= 0) { b[i] = b[i + 1] = b[i + 2] = b[i + 3] = 0; continue; }

    for (let c = 0; c < 3; c++) {
      const cs = s[i + c] / 255;
      const cb = b[i + c] / 255;
      // 배경이 있는(αb>0) 영역만 블렌드, 그 외엔 소스 원색이 보이도록 처리
      const blended = (1 - ab) * cs + ab * fn(cb, cs);
      const co = (as * blended + (1 - as) * ab * cb) / ao;
      b[i + c] = Math.round(clamp01(co) * 255);
    }
    b[i + 3] = Math.round(ao * 255);
  }
}

// dissolve: 픽셀별로 (소스알파 × opacity) 확률로 소스를 "완전 불투명"하게 찍고,
// 나머지 확률에서는 배경을 그대로 둔다(노이즈 디더링 형태). 표준 PS 동작.
function blendDissolve(backdrop, src, layerOpacity) {
  const b = backdrop.data, s = src.data, n = b.length;
  for (let i = 0; i < n; i += 4) {
    const as = (s[i + 3] / 255) * layerOpacity;
    if (as <= 0) continue;
    if (Math.random() < as) {
      // 소스 픽셀을 불투명(α=255)으로 확정 적용
      b[i]     = s[i];
      b[i + 1] = s[i + 1];
      b[i + 2] = s[i + 2];
      b[i + 3] = 255;
    }
    // else: 배경 유지
  }
}

// ── 마스크/클리핑/FillOpacity 통합 헬퍼 ─────────────────────────────────────
// 레이어 픽셀에 (1) 마스크 휘도, (2) fillOpacity 를 알파에 곱한 "유효 소스 캔버스"를 만든다.
// 원본 layer.canvas는 건드리지 않는다(비파괴). 둘 다 적용 대상이 없으면 null을 반환해
// 호출자가 원본 캔버스를 그대로 쓰게 한다(불필요한 복사 방지).
//
// 마스크 휘도: ITU-R BT.601(0.299R+0.587G+0.114B). 마스크 픽셀의 알파도 함께 곱해
// (마스크가 부분 투명일 경우) 자연스럽게 처리한다. 흰=1(불투명 유지) / 검=0(가림).
export function buildEffectiveSource(layer, scratchCanvas = null) {
  const mask = (layer.mask && layer.maskEnabled !== false) ? layer.mask : null;
  const fill = layer.fillOpacity ?? 1;
  const needMask = !!mask;
  const needFill = fill < 1;
  if (!needMask && !needFill) return null; // 적용할 것 없음 → 원본 사용

  const w = layer.canvas.width, h = layer.canvas.height;
  // 소스 픽셀 복사(원본 보존)
  const out = layer.ctx
    ? layer.ctx.getImageData(0, 0, w, h)
    : layer.canvas.getContext("2d").getImageData(0, 0, w, h);
  const od = out.data;

  // 마스크 픽셀(크기 동일 가정 — 레이어와 마스크는 항상 문서 크기로 동기화)
  let md = null;
  if (needMask) {
    const mc = layer.maskCtx || mask.getContext("2d", { willReadFrequently: true });
    md = mc.getImageData(0, 0, w, h).data;
  }

  for (let i = 0; i < od.length; i += 4) {
    let a = od[i + 3];
    if (a === 0) continue; // 이미 투명한 픽셀은 건드릴 것 없음
    if (needMask) {
      // 마스크 휘도(0~1) × 마스크 자체 알파(0~1)
      const lum = (md[i] * 0.299 + md[i + 1] * 0.587 + md[i + 2] * 0.114) / 255;
      const ma = md[i + 3] / 255;
      a = a * lum * ma;
    }
    if (needFill) a = a * fill;
    od[i + 3] = a;
  }

  // 결과를 캔버스에 실어 반환(blendLayerOnto가 canvas/ctx로 읽을 수 있게)
  const c = scratchCanvas || document.createElement("canvas");
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const cc = c.getContext("2d", { willReadFrequently: true });
  cc.clearRect(0, 0, w, h);
  cc.putImageData(out, 0, 0);
  return c;
}

// destCanvas의 알파를 maskCanvas(클립 베이스)의 알파로 곱한다(in-place, 클리핑 마스크용).
// 클리핑된 레이어의 합성 결과를 "베이스가 불투명한 곳"으로만 제한할 때 쓴다.
export function clipAlphaByAlpha(destCanvas, baseAlphaCanvas) {
  const w = destCanvas.width, h = destCanvas.height;
  const dctx = destCanvas.getContext("2d", { willReadFrequently: true });
  const dimg = dctx.getImageData(0, 0, w, h);
  const dd = dimg.data;
  const bctx = baseAlphaCanvas.getContext("2d", { willReadFrequently: true });
  const bd = bctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < dd.length; i += 4) {
    if (dd[i + 3] === 0) continue;
    dd[i + 3] = dd[i + 3] * (bd[i + 3] / 255);
  }
  dctx.putImageData(dimg, 0, 0);
}

// ── 공개 API ──────────────────────────────────────────────────────────────
// blendLayerOnto(ctx, layer)
//   ctx: 이미 아래 레이어들이 그려진 "문서 크기" 2D 컨텍스트(willReadFrequently 권장).
//   layer: { canvas, blendMode, opacity, visible } 형태의 레이어.
//   layer를 자신의 blendMode + opacity로 ctx 위에 합성한다.
export function blendLayerOnto(ctx, layer) {
  const op = layer.opacity ?? 1;
  if (op <= 0) return;
  const mode = normalizeBlendMode(layer.blendMode || "normal");
  const w = ctx.canvas.width, h = ctx.canvas.height;

  // 1) 네이티브 16종: globalCompositeOperation 그대로 사용 (GPU 가속, 정확)
  if (NATIVE_GCO[mode]) {
    ctx.save();
    ctx.globalAlpha = op;
    ctx.globalCompositeOperation = NATIVE_GCO[mode];
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
    return;
  }

  // 2) 커스텀 6종: per-pixel 합성
  if (CUSTOM.has(mode)) {
    const backdrop = ctx.getImageData(0, 0, w, h);
    // 소스(레이어) 픽셀. 레이어 캔버스는 문서와 동일 크기이므로 그대로 읽는다.
    const src = layer.ctx
      ? layer.ctx.getImageData(0, 0, w, h)
      : layer.canvas.getContext("2d").getImageData(0, 0, w, h);

    if (mode === "dissolve") blendDissolve(backdrop, src, op);
    else blendChannelMode(backdrop, src, CH_FN[mode], op);

    ctx.putImageData(backdrop, 0, 0);
    return;
  }

  // 3) 안전망: 알 수 없는 모드 → normal
  ctx.save();
  ctx.globalAlpha = op;
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}
