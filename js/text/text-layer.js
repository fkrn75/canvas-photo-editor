// text-layer.js — 벡터(재편집 가능) 텍스트 레이어 모델 + 렌더러.
//
// [설계 의도]
//   기존 text-tool.js는 텍스트를 즉시 래스터화해 다시 못 고친다. 여기서는 텍스트의 "소스 데이터"
//   (문자열/폰트/크기/색/자간/행간/정렬/좌상단 위치)를 레이어에 보존(layer.vectorText)하고,
//   화면에는 그 데이터를 레이어 캔버스에 래스터로 렌더한다. 더블클릭/팔레트로 데이터를 바꾸면
//   캔버스를 다시 그린다. → 합성/블렌드/마스크/내보내기 파이프라인은 일반 픽셀 레이어와 100% 동일하게
//   동작하므로 layer-manager / blend.js / renderer 를 건드릴 필요가 없다(비파괴 + 무충돌).
//
// [좌표계] vectorText.x / y 는 문서(월드) 좌표의 텍스트 좌상단. 렌더는 레이어 캔버스(=문서 1:1)에 직접.
//
// [공유 Layer 비수정 원칙] layer.js 는 읽기 전용. 레이어에 vectorText 프로퍼티를 "바깥에서" 붙이는
//   방식만 쓴다(JS 동적 프로퍼티). 일반 레이어는 vectorText 가 undefined 이므로 영향 없음.

// 기본 텍스트 데이터(새 텍스트 생성 시 state 값으로 일부 덮어씀)
export function defaultTextData(overrides = {}) {
  return {
    text: "",
    fontFamily: "Malgun Gothic, sans-serif",
    fontSize: 36,
    bold: false,
    italic: false,
    color: "#000000",
    align: "left",        // left | center | right
    letterSpacing: 0,     // 자간(px)
    lineHeight: 1.2,      // 행간 배수(폰트 크기 대비)
    x: 0,                 // 텍스트 블록 좌상단(문서 좌표)
    y: 0,
    ...overrides,
  };
}

// CSS/Canvas font 문자열 구성
export function cssFontFromData(d) {
  return `${d.italic ? "italic " : ""}${d.bold ? "bold " : ""}${d.fontSize}px ${d.fontFamily}`;
}

// 레이어가 벡터 텍스트 레이어인지
export function isTextLayer(layer) {
  return !!(layer && layer.vectorText);
}

// ── 측정: 줄 배열과 각 줄의 폭, 전체 블록 크기 ──
// 자간을 직접 적용하므로 문자 단위로 폭을 누적한다.
function measureLine(ctx, line, letterSpacing) {
  if (!line) return 0;
  if (!letterSpacing) return ctx.measureText(line).width;
  let w = 0;
  for (const ch of line) w += ctx.measureText(ch).width + letterSpacing;
  // 마지막 글자 뒤 자간은 시각적 폭에서 빼준다
  return Math.max(0, w - letterSpacing);
}

// 텍스트 데이터의 측정 결과 반환 { lines, lineWidths, width, height, lh }
export function measureText(ctx, d) {
  ctx.save();
  ctx.font = cssFontFromData(d);
  const lines = (d.text || "").split("\n");
  const lh = d.fontSize * (d.lineHeight || 1.2);
  const ls = d.letterSpacing || 0;
  const lineWidths = lines.map((ln) => measureLine(ctx, ln, ls));
  const width = lineWidths.reduce((m, w) => Math.max(m, w), 0);
  const height = lines.length * lh;
  ctx.restore();
  return { lines, lineWidths, width, height, lh };
}

// 한 줄을 자간 적용해 (sx, y) 기준으로 그린다. align 에 따라 sx 가 줄 시작 x.
function fillLineWithSpacing(ctx, line, sx, y, letterSpacing) {
  if (!letterSpacing) { ctx.fillText(line, sx, y); return; }
  let x = sx;
  for (const ch of line) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + letterSpacing;
  }
}

// ── 렌더: 레이어 캔버스를 비우고 vectorText 를 그린다 ──
// clip: 선택 영역 클립을 적용할지(보통 false — 텍스트 레이어는 자체 레이어라 클립 불필요).
export function renderTextLayer(layer, { selection = null } = {}) {
  const d = layer.vectorText;
  if (!d) return;
  const ctx = layer.ctx;
  ctx.clearRect(0, 0, layer.width, layer.height);
  if (!d.text) { layer.thumbDirty = true; return; }

  ctx.save();
  if (selection?.active) selection.applyClipPath(ctx);
  ctx.font = cssFontFromData(d);
  ctx.fillStyle = d.color;
  ctx.textBaseline = "top";
  const m = measureText(ctx, d);
  m.lines.forEach((line, i) => {
    const lw = m.lineWidths[i];
    let sx = d.x;
    if (d.align === "center") sx = d.x + (m.width - lw) / 2;
    else if (d.align === "right") sx = d.x + (m.width - lw);
    fillLineWithSpacing(ctx, line, sx, d.y + i * m.lh, d.letterSpacing || 0);
  });
  ctx.restore();
  layer.thumbDirty = true;
}

// 텍스트 블록의 문서 좌표 경계 박스(여유 pad). 히스토리 커밋/적중판정용.
export function textBounds(layer, pad = 2) {
  const d = layer.vectorText;
  if (!d) return null;
  // 측정엔 임시 캔버스 컨텍스트 사용(레이어 ctx 상태 오염 방지)
  const ctx = layer.ctx;
  const m = measureText(ctx, d);
  return {
    x: d.x - pad,
    y: d.y - pad,
    w: m.width + pad * 2,
    h: m.height + pad * 2,
  };
}

// (wx,wy) 문서좌표가 텍스트 블록 안쪽인지(더블클릭 재편집 적중판정용)
export function hitText(layer, wx, wy, pad = 4) {
  const b = textBounds(layer, pad);
  if (!b) return false;
  return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
}
