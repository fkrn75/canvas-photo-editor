// image-mode-dialog.js — 이미지 모드 변환 진입 다이얼로그(메뉴 "이미지 > 모드"에서 호출).
//
// 각 모드의 옵션을 dialogs.form 으로 받아 app.imageMode 컨트롤러의 변환 메서드를 호출한다.
//   - 회색조      : 옵션 없음 → 즉시 변환(다이얼로그 생략)
//   - 비트맵      : 방식(임계값/디더) + 임계값
//   - 인덱스 색상 : 색 수 + 디더링
//   - RGB 색상    : 옵션 없음 → 즉시 모드 복귀
//
// 컨트롤러 미배선 시(앵커 통합 전) 안전 가드를 둔다.

// app.imageMode 컨트롤러 확보(미배선 시 안내)
function ctrl(app) {
  if (!app.imageMode) {
    app.status("이미지 모드 컨트롤러가 아직 연결되지 않았습니다.");
    return null;
  }
  return app.imageMode;
}

// 회색조: 즉시 변환
export function convertGrayscale(app) {
  const c = ctrl(app); if (!c) return;
  c.convertToGrayscale();
}

// RGB 색상: 즉시 복귀
export function convertRGB(app) {
  const c = ctrl(app); if (!c) return;
  c.convertToRGB();
}

// 비트맵: 방식/임계값 옵션
export function openBitmapDialog(app) {
  const c = ctrl(app); if (!c) return;
  app.dialogs.form("비트맵 변환", [
    { key: "method", label: "방식", type: "select", value: "threshold",
      options: [["threshold", "50% 임계값"], ["diffusion", "오차 확산(디더)"]] },
    { key: "level", label: "임계값", type: "number", value: 128, min: 1, max: 255, step: 1 },
  ], (v) => {
    c.convertToBitmap({ method: v.method, level: v.level });
  }, "변환");
}

// 인덱스 색상: 색 수/디더링 옵션
export function openIndexedDialog(app) {
  const c = ctrl(app); if (!c) return;
  app.dialogs.form("인덱스 색상 변환", [
    { key: "colors", label: "색 수", type: "select", value: "256",
      options: [["256", "256색"], ["128", "128색"], ["64", "64색"], ["32", "32색"], ["16", "16색"], ["8", "8색"], ["4", "4색"], ["2", "2색"]] },
    { key: "dither", label: "디더링", type: "select", value: "none",
      options: [["none", "없음"], ["diffusion", "오차 확산"]] },
  ], (v) => {
    c.convertToIndexed({ colors: parseInt(v.colors, 10), dither: v.dither === "diffusion" });
    // 변환 직후 Color Table 을 열어 결과 팔레트를 바로 확인/편집할 수 있게 한다.
    openColorTableAfterIndex(app);
  }, "변환");
}

// 인덱스 변환 직후 Color Table 자동 오픈(선택). color-table-dialog 를 동적 import 하여
// 모듈 순환 의존을 피한다.
function openColorTableAfterIndex(app) {
  import("./color-table-dialog.js").then((m) => m.openColorTable(app)).catch(() => {});
}
