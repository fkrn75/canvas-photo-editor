// file-io.js — 이미지 열기(파일 선택/드래그앤드롭)와 저장(PNG/JPG/WebP + 레이어 보존 PSD/PSB/ORA).
//
// 레이어 보존 포맷의 바이트 처리(파싱·직렬화)는 순수 데이터 모듈(psd.js / ora.js / zip.js)이 맡고,
// 여기서는 캔버스 ↔ RGBA 변환, 문서 교체(깨끗한 실행 취소 기록), 다운로드, 사용자 보고만 담당한다.

import { EVT } from "../core/constants.js";
import { Layer } from "../layers/layer.js";
import { hasAnyStyle } from "../layers/layer-styles.js";
import { buildEffectiveSource, clipAlphaByAlpha, normalizeBlendMode } from "../engine/blend.js";
import { readPsd, readPsdHeader, writePsd, cropToContent, DOC_LIMITS } from "./psd.js";
import { packOra, unpackOra } from "./ora.js";
import { runBusy } from "../ui/busy.js";

// 파일 선택 input 이 받는 형식. editor.html 의 accept 는 그대로 두고 런타임에 덮어쓴다.
const OPEN_ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp",
  "image/vnd.adobe.photoshop", "image/openraster", ".psd", ".psb", ".ora",
].join(",");

// 큰 문서 안전장치 — app.js 의 IMAGE_WARN_PIXELS / IMAGE_MAX_SIDE 와 같은 값(그쪽은 모듈 로컬 상수).
// 한 변 상한·레이어 수·메모리 예산은 psd.js 의 DOC_LIMITS 와 공유한다(읽기 계층도 같은 한도로 거부).
const IMAGE_WARN_PIXELS = 8192 * 8192;
const IMAGE_MAX_SIDE = DOC_LIMITS.maxSide;

// 파일명 sanitize: 경로구분자·제어문자 제거 + 앞뒤 공백/점 제거 + 빈 값 대체 + 길이 제한.
// 다운로드 파일명(문서명 기반)에 그대로 쓰면 OS별 금지문자나 숨김파일(.으로 시작) 문제가
// 생길 수 있어 file-io.js/save-for-web.js 양쪽에서 공용으로 사용한다.
export function sanitizeFileName(name) {
  let s = String(name ?? "")
    .replace(/[/\\:*?"<>|]/g, "")   // 경로구분자 + Windows 금지문자
    .replace(/[\x00-\x1f\x7f]/g, "") // 제어문자
    .trim()
    .replace(/^\.+|\.+$/g, "")      // 앞뒤 점 제거(숨김파일/확장자 오인 방지)
    .trim();
  if (!s) s = "untitled";
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

// 파일명 → 소문자 확장자("psd" 등, 없으면 "")
function extOf(name) {
  const m = /\.([^.]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}
// 파일명 → 확장자 뺀 문서명
function baseName(name, fallback) {
  return String(name || "").replace(/\.[^.]+$/, "") || fallback;
}

// 캔버스 → PNG 바이트
function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error("PNG 인코딩 실패")); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export class FileIO {
  constructor(app) {
    this.app = app;
    this.input = document.getElementById("file-input");
    this.input.accept = OPEN_ACCEPT;
    this.input.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files && files.length) this.openFiles([...files]);
      this.input.value = ""; // 같은 파일 재선택 허용
    });
    this._bindDragDrop();
  }

  openDialog() { this.input.click(); }

  _bindDragDrop() {
    const vp = document.getElementById("viewport");
    ["dragenter", "dragover"].forEach((ev) =>
      vp.addEventListener(ev, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; })
    );
    vp.addEventListener("drop", (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length) this.openFiles([...files]);
    });
  }

  // 확장자 우선으로 경로를 고른다(PSD 의 MIME 이 image/vnd.adobe.photoshop 이라 일반 이미지 경로로 새지 않게).
  async openFiles(files) {
    for (const f of files) {
      const ext = extOf(f.name);
      if (ext === "psd" || ext === "psb") await this.openPsd(f);
      else if (ext === "ora") await this.openOra(f);
      else if (f.type.startsWith("image/")) await this.openImage(f);
    }
  }

  openImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        this.app.placeImage(img, file.name?.replace(/\.[^.]+$/, "") || "이미지");
        this.app.status(`열기: ${file.name}`);
        // File Browser(IndexedDB)에 최근 이미지로 저장 + 패널 갱신 신호(워커F). 저장 실패는 무시.
        if (this.app.imageStore) {
          this.app.imageStore.putFromImage(img, file.name?.replace(/\.[^.]+$/, "") || "이미지")
            .then(() => this.app.bus.emit(EVT.IMAGE_STORED))
            .catch(() => {});
        }
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.app.status("이미지를 열 수 없습니다.");
        resolve();
      };
      img.src = url;
    });
  }

  // ── 레이어 문서 열기(PSD/PSB/ORA) ──────────────────────────────────────────

  // 저장 안 한 변경이 있으면 현재 문서를 닫을지 확인한다. → Promise<boolean>
  _confirmReplace(fileName) {
    const app = this.app;
    if (app.isBlankDoc || !app.dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.style.cssText = "max-width:340px;line-height:1.5;";
      body.textContent = `저장하지 않은 변경사항이 있습니다. 현재 문서를 닫고 '${fileName}' 을(를) 열까요?`;
      app.dialogs.custom("문서 열기", body, () => resolve(true), () => resolve(false), "열기");
    });
  }

  // 경고 목록을 줄바꿈 유지 모달로 보여준다(없으면 생략)
  _report(title, lines) {
    if (!lines.length) return;
    const body = document.createElement("div");
    body.style.cssText = "max-width:420px;line-height:1.6;white-space:pre-line;";
    body.textContent = lines.map((s) => `• ${s}`).join("\n");
    this.app.dialogs.custom(title, body, null, null, "확인");
  }

  _fail(title, err) {
    console.error(`[file-io] ${title}:`, err);
    const msg = err?.message || String(err);
    this.app.status(`${title}: ${msg}`);
    this.app.dialogs.alert(title, msg);
  }

  // 큰 문서 안전장치(app._guardLargeSize 와 같은 기준). 그쪽은 취소를 알려 주지 않아 열기 흐름이
  // 멈출 수 있으므로 여기서 Promise<boolean> 으로 따로 확인한다. (상수는 app.js 로컬 상수와 동일하게 유지)
  _confirmSize(w, h) {
    const app = this.app;
    if (w > IMAGE_MAX_SIDE || h > IMAGE_MAX_SIDE) {
      app.status(`이미지가 너무 큽니다(${w}×${h}). 한 변이 ${IMAGE_MAX_SIDE}px를 넘을 수 없습니다.`);
      return Promise.resolve(false);
    }
    if (w * h <= IMAGE_WARN_PIXELS) return Promise.resolve(true);
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.style.cssText = "max-width:320px;line-height:1.5;";
      body.textContent = `이미지가 매우 큽니다(${w}×${h}). 계속하면 느려지거나 멈출 수 있습니다. 계속하시겠습니까?`;
      app.dialogs.custom("큰 이미지 경고", body, () => resolve(true), () => resolve(false), "계속");
    });
  }

  // 여러 레이어로 새 문서를 만든다. specs(아래→위): [{ name, opacity, fillOpacity, visible, blendMode,
  //   clipped, lockTransparency, paint(layer) → void | Promise }]
  // 열기 결과는 실행 취소 기록이 비어 있는 깨끗한 새 문서다(app._createDocument 와 같은 절차).
  // LayerManager 에 "여러 레이어로 초기화" 공개 API 가 없어 init() 후 layers 배열을 통째로 교체한다
  // (커맨드를 거치지 않으므로 히스토리가 생기지 않는다 — 의도된 동작).
  // opts.sizeConfirmed: 호출자가 이미 크기 확인(_confirmSize)을 마쳤으면 true (PSD 는 디코드 전에 확인한다)
  async _loadLayeredDocument(name, width, height, specs, opts = {}) {
    const app = this.app;
    if (!opts.sizeConfirmed && !(await this._confirmSize(width, height))) return false;
    // 레이어 수·메모리 예산(레이어마다 문서 크기 캔버스가 생긴다) — 어떤 캔버스도 만들기 전에 거부
    if (specs.length > DOC_LIMITS.maxLayers) {
      this._fail("문서 열기 실패", new Error(`레이어가 너무 많습니다(${specs.length}개). 최대 ${DOC_LIMITS.maxLayers}개까지 열 수 있습니다.`));
      return false;
    }
    if (width * height * Math.max(1, specs.length) > DOC_LIMITS.maxTotalPixels) {
      this._fail("문서 열기 실패", new Error(`문서가 너무 커서 열 수 없습니다(${width}×${height}, 레이어 ${specs.length}개). 메모리 보호를 위해 레이어 수 × 픽셀 수가 제한됩니다.`));
      return false;
    }
    try {
      const built = [];
      for (const s of specs) {
        const L = new Layer(width, height, s.name || undefined);
        L.opacity = s.opacity ?? 1;
        L.fillOpacity = s.fillOpacity ?? 1;
        L.visible = s.visible !== false;
        L.blendMode = normalizeBlendMode(s.blendMode || "normal");
        L.clipped = !!s.clipped && built.length > 0;
        L.lockTransparency = !!s.lockTransparency;
        await s.paint(L);
        L.thumbDirty = true;
        built.push(L);
      }
      app.selection.clear();
      app.history.clear();
      const lm = app.layers;
      lm.init(width, height, { fillBackground: !built.length });
      if (built.length) {
        lm.layers = built;
        lm.activeId = built[built.length - 1].id;
      }
      app.docName = name;
      app.isBlankDoc = false;
      app.dirty = false;
      lm.notifyStructure();
      app.bus.emit(EVT.ACTIVE_LAYER_CHANGED, { id: lm.activeId });
      app.viewport.fit(width, height);
      app._updateSize();
      app.renderer.requestRender();
      // 문서가 통째로 교체됐음을 알린다(제자리에 붙여넣기 버퍼 등 문서 좌표에 묶인 상태를 비우도록)
      app.bus.emit(EVT.DOCUMENT_CHANGED, { width, height });
      return true;
    } catch (err) {
      this._fail("문서 열기 실패", err);
      return false;
    }
  }

  async openPsd(file) {
    const app = this.app;
    const ext = extOf(file.name).toUpperCase();
    if (!(await this._confirmReplace(file.name))) return;
    app.status(`${ext} 여는 중: ${file.name}…`);
    await new Promise((r) => setTimeout(r, 0)); // 상태 표시가 먼저 그려지도록 한 틱 양보
    let doc;
    try {
      const buf = await file.arrayBuffer();
      // 헤더만 먼저 읽어 크기 확인을 디코드 전에 한다(거대한 문서를 확인 없이 메모리에 올리지 않도록)
      const head = readPsdHeader(buf);
      if (!(await this._confirmSize(head.width, head.height))) return;
      doc = readPsd(buf);
    } catch (err) {
      this._fail(`${ext} 열기 실패`, err);
      return;
    }
    let specs;
    if (doc.layers.length) {
      specs = doc.layers.map((d) => ({
        ...d,
        paint: (L) => {
          if (d.width && d.height) L.ctx.putImageData(new ImageData(d.data, d.width, d.height), d.left, d.top);
          if (d.mask) {
            const m = d.mask;
            L.createMask(true);
            const dc = m.defaultColor ?? 255;
            L.maskCtx.fillStyle = `rgb(${dc},${dc},${dc})`;
            L.maskCtx.fillRect(0, 0, L.width, L.height);
            if (m.width && m.height) {
              const img = new ImageData(m.width, m.height);
              const px = img.data;
              for (let i = 0, j = 0; i < m.data.length; i++, j += 4) {
                const v = m.data[i];
                px[j] = v; px[j + 1] = v; px[j + 2] = v; px[j + 3] = 255;
              }
              L.maskCtx.putImageData(img, m.left, m.top);
            }
            L.maskEnabled = !m.disabled;
          }
        },
      }));
    } else {
      // 레이어 정보가 없는 평면 PSD → 합성 이미지 1장
      const c = doc.composite;
      specs = [{ name: "배경", paint: (L) => L.ctx.putImageData(new ImageData(c.data, c.width, c.height), 0, 0) }];
    }
    const ok = await this._loadLayeredDocument(baseName(file.name, "문서"), doc.width, doc.height, specs, { sizeConfirmed: true });
    if (!ok) return;
    app.status(`열기: ${file.name} (레이어 ${specs.length}개)`);
    this._report(`${ext} 열기 — 참고`, doc.warnings);
  }

  async openOra(file) {
    const app = this.app;
    if (!(await this._confirmReplace(file.name))) return;
    app.status(`ORA 여는 중: ${file.name}…`);
    let doc;
    try {
      doc = await unpackOra(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      this._fail("ORA 열기 실패", err);
      return;
    }
    const warnings = [...doc.warnings];
    let failed = 0;
    const decode = async (png) => {
      try { return await createImageBitmap(new Blob([png], { type: "image/png" })); }
      catch { failed++; return null; }
    };
    let specs = doc.layers.map((d) => ({
      ...d,
      paint: async (L) => {
        const bmp = await decode(d.png);
        if (bmp) { L.ctx.drawImage(bmp, d.x, d.y); bmp.close?.(); }
      },
    }));
    if (!specs.length && doc.mergedPng) {
      specs = [{ name: "배경", paint: async (L) => {
        const bmp = await decode(doc.mergedPng);
        if (bmp) { L.ctx.drawImage(bmp, 0, 0); bmp.close?.(); }
      } }];
    }
    const ok = await this._loadLayeredDocument(baseName(file.name, "문서"), doc.width, doc.height, specs);
    if (!ok) return;
    if (failed) warnings.push(`이미지를 해독하지 못한 레이어 ${failed}개는 비어 있습니다.`);
    app.status(`열기: ${file.name} (레이어 ${specs.length}개)`);
    this._report("ORA 열기 — 참고", warnings);
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────

  // Blob 을 다운로드하고 FILE_SAVED 를 발행한다(저장 완료 계약: app.dirty 해제 타이밍).
  _download(blob, ext) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFileName(this.app.docName)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.app.status(`저장: ${a.download}`);
    this.app.bus.emit(EVT.FILE_SAVED);
  }

  // 합성 결과를 파일로 저장. format: 'png' | 'jpg' | 'webp' (quality: 0~1, jpg/webp 에만 의미)
  save(format = "png", quality = 0.92) {
    const lm = this.app.layers;
    if (!lm.width) return;
    let canvas = lm.flatten();
    const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

    if (format === "jpg") {
      // JPG는 투명을 지원하지 않으므로 흰 배경 위에 합성
      const opaque = document.createElement("canvas");
      opaque.width = canvas.width;
      opaque.height = canvas.height;
      const octx = opaque.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, opaque.width, opaque.height);
      octx.drawImage(canvas, 0, 0);
      canvas = opaque;
    }

    canvas.toBlob((blob) => {
      if (!blob) { this.app.status("저장 실패"); return; }
      // 브라우저가 WebP 인코딩을 지원하지 않으면 toBlob 이 PNG 로 대체한다 → 확장자 오인 방지
      if (blob.type !== mime) { this.app.status(`이 브라우저는 ${format.toUpperCase()} 저장을 지원하지 않습니다.`); return; }
      this._download(blob, format);
    }, mime, quality);
  }

  // WebP 품질 선택 후 저장
  saveWebPDialog() {
    if (!this.app.layers.width) return;
    this.app.dialogs.form("WebP로 저장", [
      { key: "quality", label: "품질(1~100)", type: "number", value: 90, min: 1, max: 100, step: 1 },
    ], ({ quality }) => {
      const q = Math.max(1, Math.min(100, Number.isFinite(quality) ? quality : 90));
      this.save("webp", q / 100);
    }, "저장");
  }

  // 레이어 → PSD 레코드 데이터(문서 좌표 RGBA를 내용 사각형으로 잘라냄)
  _layerToPsd(L, W, H) {
    const rgba = L.ctx.getImageData(0, 0, W, H).data;
    const c = cropToContent(rgba, W, H);
    let mask = null;
    if (L.mask) {
      // 마스크 회색값 = 휘도 × 마스크 알파(합성 경로 buildEffectiveSource 와 같은 해석)
      const md = (L.maskCtx || L.mask.getContext("2d", { willReadFrequently: true })).getImageData(0, 0, W, H).data;
      const g = new Uint8Array(W * H);
      for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        g[i] = ((md[j] * 0.299 + md[j + 1] * 0.587 + md[j + 2] * 0.114) * md[j + 3]) / 255;
      }
      mask = { left: 0, top: 0, width: W, height: H, data: g, defaultColor: 0, disabled: L.maskEnabled === false };
    }
    return {
      name: L.name, left: c.left, top: c.top, width: c.width, height: c.height, data: c.data,
      opacity: L.opacity ?? 1, fillOpacity: L.fillOpacity ?? 1, visible: L.visible !== false,
      blendMode: normalizeBlendMode(L.blendMode || "normal"), clipped: !!L.clipped,
      lockTransparency: !!L.lockTransparency, mask,
    };
  }

  // PSD/PSB 저장(레이어 보존). version: 1=PSD, 2=PSB
  savePsd(version = 1) {
    const app = this.app;
    const lm = app.layers;
    if (!lm.width) return;
    const ext = version === 2 ? "psb" : "psd";
    runBusy(app, `${ext.toUpperCase()} 저장`, () => {
      const W = lm.width, H = lm.height;
      const notes = [];
      let skippedAdj = 0, styled = 0;
      const layers = [];
      for (const L of lm.layers) {
        if (L.type === "adjustment") { skippedAdj++; continue; }
        if (L.styles && hasAnyStyle(L.styles)) styled++;
        layers.push(this._layerToPsd(L, W, H));
      }
      if (layers.length) layers[0].clipped = false;
      const composite = { data: lm.flatten().getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data };
      let bytes;
      try {
        bytes = writePsd({ width: W, height: H, layers, composite, version });
      } catch (err) {
        this._fail(`${ext.toUpperCase()} 저장 실패`, err);
        return;
      }
      this._download(new Blob([bytes], { type: "image/vnd.adobe.photoshop" }), ext);
      if (skippedAdj) notes.push(`조정 레이어 ${skippedAdj}개는 PSD 조정 레이어로 저장하지 못해 생략했습니다(합성 이미지에는 반영됨).`);
      if (styled) notes.push(`레이어 스타일이 있는 레이어 ${styled}개 — 효과는 레이어에 저장되지 않습니다(합성 이미지에는 반영됨).`);
      if (lm.layers.some((L) => L.vectorText || L.vectorShape)) notes.push("텍스트/셰이프 레이어는 현재 렌더 결과(픽셀)로 저장했습니다.");
      // runBusy 종료 표시가 상태바를 덮어쓰므로 보고는 모달로만
      if (notes.length) setTimeout(() => this._report(`${ext.toUpperCase()} 저장 — 참고`, notes), 0);
    });
  }

  // ORA 저장. ORA 에는 마스크·클리핑·채우기 불투명도가 없으므로 픽셀에 구워 넣는다(보이는 결과 보존).
  async saveOra() {
    const app = this.app;
    const lm = app.layers;
    if (!lm.width) return;
    const W = lm.width, H = lm.height;
    app.status("ORA 저장 중…");
    const notes = [];
    let skippedAdj = 0, styled = 0, baked = 0;
    try {
      const metas = [];
      let clipBase = null; // 가장 최근의 비클립 레이어(합성 경로와 같은 규칙)
      for (const L of lm.layers) {
        if (L.type === "adjustment") { skippedAdj++; continue; }
        if (L.styles && hasAnyStyle(L.styles)) styled++;
        let src = buildEffectiveSource(L) || L.canvas;
        let isBaked = src !== L.canvas;
        let visible = L.visible !== false;
        if (L.clipped && clipBase) {
          if (src === L.canvas) {
            const copy = makeCanvas(W, H);
            copy.getContext("2d", { willReadFrequently: true }).drawImage(L.canvas, 0, 0);
            src = copy;
          }
          clipAlphaByAlpha(src, clipBase.canvas);
          // 포토샵 규칙: 클립 베이스가 숨김이면 클립 레이어도 보이지 않는다
          if (clipBase.visible === false) visible = false;
          isBaked = true;
        } else {
          clipBase = L;
        }
        if (isBaked) baked++;
        const rgba = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
        const c = cropToContent(rgba, W, H);
        const out = makeCanvas(c.width || 1, c.height || 1);
        if (c.width) out.getContext("2d").putImageData(new ImageData(c.data, c.width, c.height), 0, 0);
        metas.push({
          name: L.name, x: c.left, y: c.top, opacity: L.opacity ?? 1, visible,
          blendMode: normalizeBlendMode(L.blendMode || "normal"),
          png: await canvasToPngBytes(out),
        });
      }
      const merged = lm.flatten();
      const scale = Math.min(1, 256 / Math.max(W, H));
      const thumb = makeCanvas(Math.round(W * scale), Math.round(H * scale));
      const tctx = thumb.getContext("2d");
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(merged, 0, 0, thumb.width, thumb.height);
      const bytes = await packOra({
        width: W, height: H, layers: metas,
        mergedPng: await canvasToPngBytes(merged),
        thumbnailPng: await canvasToPngBytes(thumb),
      });
      this._download(new Blob([bytes], { type: "image/openraster" }), "ora");
    } catch (err) {
      this._fail("ORA 저장 실패", err);
      return;
    }
    if (skippedAdj) notes.push(`조정 레이어 ${skippedAdj}개는 ORA 에 저장할 수 없어 생략했습니다(합성 이미지에는 반영됨).`);
    if (baked) notes.push(`마스크·클리핑·채우기 불투명도가 있는 레이어 ${baked}개는 결과를 픽셀에 적용해 저장했습니다.`);
    if (styled) notes.push(`레이어 스타일이 있는 레이어 ${styled}개 — 효과는 레이어에 저장되지 않습니다(합성 이미지에는 반영됨).`);
    this._report("ORA 저장 — 참고", notes);
  }
}
