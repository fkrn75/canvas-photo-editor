// menus/layer-image.js — 이미지/레이어/편집 메뉴 확장(문서 연산·정렬·배치·클립보드·마스크).
// 단축키(shortcut)는 표시용이다. 실제 키 바인딩은 app.js _bindGlobalKeys 에서 한다.
import {
  openImageSize, openCanvasSize, openRotateArbitrary, openTrim, openDefinePattern,
} from "../doc-dialogs.js";
import {
  alignLayer, layerViaCopy, layerViaCut, maskFromTransparency, applyLayerMask,
} from "../../ops/layer-ops.js";

export default function menus(app) {
  const a = app;
  return {
    "편집": [
      { label: "잘라내기", shortcut: "Ctrl+X", fn: () => a.clipboard.cut() },
      { label: "병합 복사", shortcut: "Shift+Ctrl+C", fn: () => a.clipboard.copyMerged() },
      { label: "제자리에 붙여넣기", shortcut: "Shift+Ctrl+V", fn: () => a.clipboard.pasteInPlace() },
      { sep: true },
      { label: "패턴 정의…", fn: () => openDefinePattern(a) },
    ],
    "이미지": [
      // 기본 메뉴의 색상표 다음(회전 묶음 앞)에 끼워 넣는다
      ...[
        { sep: true },
        { label: "이미지 크기…", shortcut: "Alt+Ctrl+I", fn: () => openImageSize(a) },
        { label: "캔버스 크기…", shortcut: "Alt+Ctrl+C", fn: () => openCanvasSize(a) },
        { label: "임의 각도 회전…", fn: () => openRotateArbitrary(a) },
        { label: "재단…", fn: () => openTrim(a) },
      ].map((it, i) => ({ ...it, after: "색상표(Color Table)…", _offset: i })),
    ],
    "레이어": [
      { label: "복사한 레이어", shortcut: "Ctrl+J", fn: () => layerViaCopy(a) },
      { label: "잘라낸 레이어", shortcut: "Shift+Ctrl+J", fn: () => layerViaCut(a) },
      { sep: true },
      { label: "정렬", sub: [
        { label: "위쪽 가장자리", fn: () => alignLayer(a, "top") },
        { label: "세로 가운데", fn: () => alignLayer(a, "vcenter") },
        { label: "아래쪽 가장자리", fn: () => alignLayer(a, "bottom") },
        { sep: true },
        { label: "왼쪽 가장자리", fn: () => alignLayer(a, "left") },
        { label: "가로 가운데", fn: () => alignLayer(a, "hcenter") },
        { label: "오른쪽 가장자리", fn: () => alignLayer(a, "right") },
      ] },
      { label: "배치", sub: [
        { label: "맨 앞으로 가져오기", shortcut: "Shift+Ctrl+]", fn: () => a.layers.arrangeLayer("front") },
        { label: "앞으로 가져오기", shortcut: "Ctrl+]", fn: () => a.layers.arrangeLayer("forward") },
        { label: "뒤로 보내기", shortcut: "Ctrl+[", fn: () => a.layers.arrangeLayer("backward") },
        { label: "맨 뒤로 보내기", shortcut: "Shift+Ctrl+[", fn: () => a.layers.arrangeLayer("back") },
      ] },
      { sep: true },
      { label: "투명도에서 마스크 만들기", fn: () => maskFromTransparency(a) },
      { label: "레이어 마스크 적용", fn: () => applyLayerMask(a) },
      { sep: true },
      { label: "다른 레이어 숨기기", fn: () => a.layers.hideOtherLayers() },
      { label: "모든 레이어 보이기", fn: () => a.layers.showAllLayers() },
    ],
  };
}
