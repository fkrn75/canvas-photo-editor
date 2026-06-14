// save-for-web.js — "Save for Web" 다이얼로그.
// 포맷(PNG/JPEG) 선택, JPEG 품질 슬라이더, 합성 결과 미리보기, 예상 용량(KB) 표시,
// 다운로드 버튼을 제공한다. 합성은 app.layers.flatten()을 재사용하며(파일 저장 로직과 동일),
// 예상 용량은 canvas.toBlob로 실제 blob.size를 측정해 표시한다.
// select-dialogs.js의 모달 패턴(custom body + app.dialogs.custom)을 따른다.

// 합성 결과 캔버스를 만든다. JPEG는 투명을 지원하지 않으므로 흰 배경 위에 합성한다.
// (file-io.js의 save()와 동일한 정책)
function compositeCanvas(app, format) {
  const flat = app.layers.flatten();
  if (format !== "jpeg") return flat;
  const opaque = document.createElement("canvas");
  opaque.width = flat.width;
  opaque.height = flat.height;
  const octx = opaque.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, opaque.width, opaque.height);
  octx.drawImage(flat, 0, 0);
  return opaque;
}

// 바이트 → 사람이 읽기 쉬운 용량 문자열(KB/MB).
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(kb < 10 ? 1 : 0) + " KB";
  return (kb / 1024).toFixed(2) + " MB";
}

export function openSaveForWeb(app) {
  if (!app.layers.width) { app.status("저장할 문서가 없습니다."); return; }

  const docW = app.layers.width, docH = app.layers.height;

  // 현재 다이얼로그 상태
  let format = "png";       // png | jpeg
  let quality = 80;         // 0~100 (JPEG 전용)
  let lastBlob = null;      // 마지막으로 측정한 blob(다운로드 시 재사용)
  let measureTimer = null;  // 용량 측정 디바운스 타이머

  const body = document.createElement("div");
  body.style.width = "320px";

  // ── 포맷 선택 줄 ──
  const rowFmt = document.createElement("div");
  rowFmt.className = "row";
  const labFmt = document.createElement("label");
  labFmt.textContent = "포맷"; labFmt.style.width = "60px";
  const fmtSel = document.createElement("select");
  fmtSel.style.flex = "1";
  for (const [val, text] of [["png", "PNG (무손실)"], ["jpeg", "JPEG (손실)"]]) {
    const o = document.createElement("option");
    o.value = val; o.textContent = text; fmtSel.appendChild(o);
  }
  fmtSel.value = format;
  rowFmt.append(labFmt, fmtSel);
  body.appendChild(rowFmt);

  // ── 품질 슬라이더 줄 (JPEG일 때만 표시) ──
  const rowQ = document.createElement("div");
  rowQ.className = "row";
  const labQ = document.createElement("label");
  labQ.textContent = "품질"; labQ.style.width = "60px";
  const qSlider = document.createElement("input");
  qSlider.type = "range"; qSlider.min = 0; qSlider.max = 100; qSlider.step = 1; qSlider.value = quality;
  qSlider.style.flex = "1";
  const qBadge = document.createElement("span");
  qBadge.className = "val-badge";
  qBadge.textContent = quality;
  rowQ.append(labQ, qSlider, qBadge);
  body.appendChild(rowQ);

  // ── 미리보기 캔버스 (체커보드 배경 위에 합성 결과 축소 표시) ──
  const preview = document.createElement("canvas");
  preview.className = "dialog-preview";
  // 최대 표시 영역(다이얼로그 폭에 맞춤)에 비율 유지로 축소.
  const maxW = 300, maxH = 200;
  const ratio = Math.min(maxW / docW, maxH / docH, 1);
  preview.width = Math.max(1, Math.round(docW * ratio));
  preview.height = Math.max(1, Math.round(docH * ratio));
  body.appendChild(preview);

  // ── 정보 줄: 크기 + 예상 용량 ──
  const info = document.createElement("div");
  info.style.cssText = "display:flex;justify-content:space-between;color:var(--text-dim);font-size:11px;margin-top:2px;";
  const dimSpan = document.createElement("span");
  dimSpan.textContent = `${docW} × ${docH} px`;
  const sizeSpan = document.createElement("span");
  sizeSpan.textContent = "용량 계산 중…";
  info.append(dimSpan, sizeSpan);
  body.appendChild(info);

  // 미리보기 캔버스에 현재 포맷의 합성 결과를 그린다.
  // (JPEG의 흰 배경 합성까지 반영해 실제 결과와 동일하게 보이도록)
  const drawPreview = () => {
    const c = compositeCanvas(app, format);
    const pctx = preview.getContext("2d");
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(c, 0, 0, preview.width, preview.height);
  };

  // 예상 용량을 측정한다. toBlob은 비동기이므로 콜백에서 라벨/lastBlob을 갱신한다.
  // 슬라이더 연속 조작 시 과도한 인코딩을 막기 위해 디바운스한다.
  const measureSize = () => {
    sizeSpan.textContent = "용량 계산 중…";
    clearTimeout(measureTimer);
    measureTimer = setTimeout(() => {
      const c = compositeCanvas(app, format);
      const mime = format === "jpeg" ? "image/jpeg" : "image/png";
      const q = format === "jpeg" ? quality / 100 : undefined;
      c.toBlob((blob) => {
        if (!blob) { sizeSpan.textContent = "측정 실패"; lastBlob = null; return; }
        lastBlob = blob;
        sizeSpan.textContent = "약 " + formatBytes(blob.size);
      }, mime, q);
    }, 120);
  };

  // 포맷에 따라 품질 슬라이더 표시/숨김을 갱신하고 다시 측정.
  const syncFormatUI = () => {
    rowQ.style.display = format === "jpeg" ? "" : "none";
    drawPreview();
    measureSize();
  };

  fmtSel.addEventListener("change", () => { format = fmtSel.value; syncFormatUI(); });
  qSlider.addEventListener("input", () => {
    quality = parseInt(qSlider.value, 10);
    qBadge.textContent = quality;
    measureSize();
  });

  // 첫 진입: 미리보기 + 용량 측정
  syncFormatUI();

  // 확인 버튼 = "다운로드". 측정해 둔 blob이 있으면 재사용하고, 없으면 즉시 생성.
  const download = (blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${app.docName || "untitled"}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    app.status(`저장: ${a.download}`);
  };

  app.dialogs.custom("웹용으로 저장", body,
    () => { // 확인 = 다운로드
      clearTimeout(measureTimer);
      if (lastBlob) { download(lastBlob); return; }
      const c = compositeCanvas(app, format);
      const mime = format === "jpeg" ? "image/jpeg" : "image/png";
      const q = format === "jpeg" ? quality / 100 : undefined;
      c.toBlob((blob) => {
        if (!blob) { app.status("저장 실패"); return; }
        download(blob);
      }, mime, q);
    },
    () => { clearTimeout(measureTimer); }, // 취소: 진행 중 측정만 정리
    "다운로드");
}
