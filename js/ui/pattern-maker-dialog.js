// pattern-maker-dialog.js — 패턴 메이커 모달 UI.
//
// 현재 레이어(선택 영역이 있으면 그 영역)를 소스로, 타일 크기·오프셋·엣지 스무딩을
// 슬라이더로 조절하며 "이어붙인 미리보기"를 실시간으로 보여준다.
// [패턴으로 저장]을 누르면 app.state.patterns 배열에 {id,name,tile} 을 추가한다.
//
// dialogs.custom(title, bodyEl, onOk, onCancel)을 사용한다(레벨/커브 다이얼로그와 동일 패턴).
// 공유 파일(state.js/options-bar.js)은 수정하지 않는다. patterns 배열에 push 후,
// 패턴 도장 도구가 활성 상태면 옵션바를 다시 그려 새 패턴이 즉시 목록에 보이게 한다.

import { generateTile, tilePreview } from "../patterns/pattern-maker.js";

let _patSeq = 0; // 사용자 패턴 이름 일련번호

export function openPatternMaker(app) {
  const layer = app.layers.activeLayer;
  if (!layer) { app.status("패턴으로 만들 레이어가 없습니다."); return; }

  // ── 소스 박스 결정: 선택 영역 bounds 우선, 없으면 레이어 전체 ──
  const sel = app.selection;
  let box;
  if (sel?.active && sel.bounds && sel.bounds.w > 0 && sel.bounds.h > 0) {
    box = { ...sel.bounds };
  } else {
    box = { x: 0, y: 0, w: layer.width, h: layer.height };
  }
  // 너무 큰 소스는 샘플링 부담이 크므로 적당히 축소(최대 변 512)해 소스 ImageData 확보
  const SRC_MAX = 512;
  const srcImg = extractSource(layer, box, SRC_MAX);
  if (!srcImg) { app.status("소스 영역이 비어 있습니다."); return; }

  // ── 다이얼로그 본문 DOM ──
  const body = document.createElement("div");
  body.style.cssText = "display:flex;gap:14px;min-width:480px;";

  // 좌: 컨트롤
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-direction:column;gap:8px;width:200px;flex:none;";

  // 우: 미리보기(타일 1개 + 타일링 결과)
  const previewWrap = document.createElement("div");
  previewWrap.style.cssText = "flex:1;display:flex;flex-direction:column;gap:6px;align-items:center;";

  const tileLabel = document.createElement("div");
  tileLabel.textContent = "타일 1개";
  tileLabel.style.cssText = "font-size:11px;color:var(--text-dim);align-self:flex-start;";
  const tileCanvasEl = document.createElement("canvas");
  tileCanvasEl.style.cssText = "border:1px solid var(--border);background:#fff;image-rendering:pixelated;max-width:128px;max-height:128px;";

  const tiledLabel = document.createElement("div");
  tiledLabel.textContent = "이어붙인 미리보기";
  tiledLabel.style.cssText = "font-size:11px;color:var(--text-dim);align-self:flex-start;margin-top:4px;";
  const tiledCanvasEl = document.createElement("canvas");
  tiledCanvasEl.width = 256; tiledCanvasEl.height = 160;
  tiledCanvasEl.style.cssText = "border:1px solid var(--border);background:#fff;image-rendering:pixelated;width:256px;height:160px;";

  previewWrap.append(tileLabel, tileCanvasEl, tiledLabel, tiledCanvasEl);

  // ── 슬라이더 상태값 ──
  const maxTile = Math.min(256, Math.max(srcImg.width, srcImg.height));
  const st = {
    tileW: Math.min(96, srcImg.width),
    tileH: Math.min(96, srcImg.height),
    offsetX: 0,
    offsetY: 0,
    smooth: 0.3,
  };

  let lastTile = null; // 마지막 생성 타일 canvas(저장 시 사용)

  // 슬라이더 생성 헬퍼(다이얼로그 어디서도 공유 CSS 없이 동작하도록 인라인)
  const mkSlider = (label, key, min, max, step, fmt) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;";
    const lb = document.createElement("label");
    lb.textContent = label;
    lb.style.cssText = "width:54px;flex:none;font-size:12px;";
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = st[key];
    inp.style.cssText = "flex:1;min-width:0;";
    const badge = document.createElement("span");
    badge.style.cssText = "width:40px;flex:none;text-align:right;font-size:11px;color:var(--text-dim);";
    badge.textContent = fmt(st[key]);
    inp.addEventListener("input", () => {
      st[key] = parseFloat(inp.value);
      badge.textContent = fmt(st[key]);
      render();
    });
    row.append(lb, inp, badge);
    controls.appendChild(row);
  };

  mkSlider("폭", "tileW", 8, maxTile, 1, (v) => `${Math.round(v)}px`);
  mkSlider("높이", "tileH", 8, maxTile, 1, (v) => `${Math.round(v)}px`);
  mkSlider("X 오프셋", "offsetX", 0, srcImg.width, 1, (v) => `${Math.round(v)}`);
  mkSlider("Y 오프셋", "offsetY", 0, srcImg.height, 1, (v) => `${Math.round(v)}`);
  mkSlider("엣지 스무딩", "smooth", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);

  const hint = document.createElement("div");
  hint.textContent = "엣지 스무딩을 올리면 타일 이음매가 부드럽게 이어집니다.";
  hint.style.cssText = "font-size:11px;color:var(--text-dim);margin-top:2px;line-height:1.4;";
  controls.appendChild(hint);

  body.append(controls, previewWrap);

  // ── 렌더(슬라이더 변경마다 타일 재생성 + 미리보기 갱신) ──
  function render() {
    const { tile } = generateTile(srcImg, {
      tileW: st.tileW, tileH: st.tileH,
      offsetX: st.offsetX, offsetY: st.offsetY,
      smooth: st.smooth,
    });
    lastTile = tile;

    // 타일 1개 미리보기(원본 크기, 최대 128 박스에서 픽셀 또렷이)
    tileCanvasEl.width = tile.width;
    tileCanvasEl.height = tile.height;
    tileCanvasEl.getContext("2d").drawImage(tile, 0, 0);

    // 이어붙인 미리보기
    tilePreview(tile, tiledCanvasEl, tiledCanvasEl.width, tiledCanvasEl.height);
  }
  render();

  // ── 모달 열기 ──
  app.dialogs.custom("패턴 메이커", body,
    () => savePattern(app, lastTile),
    null,
    "패턴으로 저장");
}

// 활성 레이어의 box 영역을 ImageData로 추출(최대 변 maxSide로 축소). 빈 영역이면 null.
function extractSource(layer, box, maxSide) {
  const bw = Math.max(1, Math.round(box.w));
  const bh = Math.max(1, Math.round(box.h));
  // 원본 크롭
  const crop = layer.ctx.getImageData(box.x, box.y, bw, bh);
  // 완전 투명인지 간단 체크(알파 합 0이면 빈 영역)
  let anyAlpha = false;
  const d = crop.data;
  for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) { anyAlpha = true; break; } }
  if (!anyAlpha) return null;

  // 축소 필요 없으면 그대로
  if (bw <= maxSide && bh <= maxSide) return crop;

  const scale = Math.min(maxSide / bw, maxSide / bh);
  const nw = Math.max(1, Math.round(bw * scale));
  const nh = Math.max(1, Math.round(bh * scale));
  const tmp = document.createElement("canvas");
  tmp.width = bw; tmp.height = bh;
  tmp.getContext("2d").putImageData(crop, 0, 0);
  const out = document.createElement("canvas");
  out.width = nw; out.height = nh;
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(tmp, 0, 0, nw, nh);
  return g.getImageData(0, 0, nw, nh);
}

// 생성한 타일을 app.state.patterns 목록에 추가. 패턴 도장 도구가 활성이면 옵션바를 갱신한다.
function savePattern(app, tile) {
  if (!tile) { app.status("저장할 패턴이 없습니다."); return; }
  _patSeq += 1;
  const id = "user-" + Date.now() + "-" + _patSeq;
  const name = `사용자 패턴 ${_patSeq}`;
  // patterns 배열은 set()을 거치지 않으므로 직접 push(배열 참조 유지 → 도장 도구가 그대로 인식).
  app.state.patterns.push({ id, name, tile });

  // 새로 만든 패턴을 현재 패턴으로 선택(set이 STATE_CHANGED 발행 → 옵션바 _updaters 동기화).
  const newIndex = app.state.patterns.length - 1;
  app.state.set("patternIndex", newIndex);

  // 패턴 도장 도구가 이미 활성화돼 있으면 select 목록 자체를 다시 그려야 새 항목이 보인다.
  if (app.tools.activeId === "patternstamp") {
    app.optionsBar?._render();
  }
  app.status(`"${name}"을(를) 패턴 목록에 추가했습니다. (패턴 도장 도구 Y에서 사용)`);
}
