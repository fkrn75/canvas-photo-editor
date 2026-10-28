// menus/file.js — 파일 메뉴 확장: 레이어 보존 포맷(PSD/PSB/ORA)과 WebP 저장.
// 열기는 기본 "열기"(Ctrl+O)·드래그앤드롭이 .psd/.psb/.ora 도 받는다(file-io.js 가 확장자로 분기).
export default function menus(app) {
  return {
    "파일": [
      { label: "다른 형식으로 저장", sub: [
        { label: "Photoshop (PSD)", fn: () => app.fileIO.savePsd(1) },
        { label: "Photoshop 대형 문서 (PSB)", fn: () => app.fileIO.savePsd(2) },
        { label: "OpenRaster (ORA)", fn: () => app.fileIO.saveOra() },
        { sep: true },
        { label: "WebP…", fn: () => app.fileIO.saveWebPDialog() },
      ] },
    ],
  };
}
