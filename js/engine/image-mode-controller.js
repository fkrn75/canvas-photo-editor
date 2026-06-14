// image-mode-controller.js — 이미지 모드 상태 보관 + 변환 실행 진입점.
//
// "현재 이미지 모드"(rgb/grayscale/indexed/bitmap)와 인덱스 모드의 팔레트를 한곳에서
// 관리한다. 공유 state.js 를 수정하지 않기 위해 app 객체에 controller 인스턴스를 붙여
// (배선 스니펫으로 app.imageMode = new ImageModeController(app)) 거기서 상태를 들고 있는다.
//
// 변환은 전 레이어 픽셀에 영향 → ImageModeCommand 로 한 번에 undo 되게 한다.
// 모드 메타(라벨)도 여기서 제공해 메뉴/상태바 표시에 재사용한다.

import {
  toGrayscale, toBitmap, buildPalette, applyPalette, toIndexed,
} from "./image-mode.js";
import { ImageModeCommand, ImageModeStateCommand } from "../history/commands/image-mode-command.js";

// 모드 식별자 → 표시 라벨
export const IMAGE_MODE_LABELS = {
  rgb: "RGB 색상",
  grayscale: "회색조",
  indexed: "인덱스 색상",
  bitmap: "비트맵",
};

export class ImageModeController {
  constructor(app) {
    this.app = app;
    // 현재 모드 상태. palette 는 indexed 모드일 때만 의미(편집/Color Table 용).
    //   mode    : "rgb" | "grayscale" | "indexed" | "bitmap"
    //   palette : [[r,g,b], ...] | null
    this.mode = "rgb";
    this.palette = null;
  }

  // 모드 상태 라벨(상태바/메뉴 표시용)
  get label() { return IMAGE_MODE_LABELS[this.mode] || "RGB 색상"; }

  // 내부: 모드 상태 객체를 통째로 교체(커맨드 undo/redo 가 호출). 레이어 패널 등은
  // 커맨드가 notifyStructure 로 따로 갱신하므로 여기선 상태만 바꾼다.
  _applyModeState(modeObj) {
    if (!modeObj) return;
    this.mode = modeObj.mode;
    this.palette = modeObj.palette ? modeObj.palette.map((c) => c.slice()) : null;
  }

  // 변환 공통 실행: transform(ImageData) 을 전 레이어에 적용하는 커맨드를 만들고
  // 모드 상태도 함께 prev/next 로 저장해 한 단계로 되돌린다.
  //   transform : (ImageData)=>void
  //   nextMode  : { mode, palette } 변환 후 모드 상태
  //   label     : 히스토리/상태바 라벨
  _run(transform, nextMode, label) {
    if (!this.app.layers || !this.app.layers.count) {
      this.app.status("변환할 이미지가 없습니다.");
      return;
    }
    const prevMode = { mode: this.mode, palette: this.palette ? this.palette.map((c) => c.slice()) : null };
    const modeInfo = {
      setMode: (m) => this._applyModeState(m),
      prevMode,
      nextMode,
    };
    const cmd = new ImageModeCommand(this.app.layers, transform, label, modeInfo);
    // 대상 레이어가 하나도 없으면(전부 조정 레이어 등) 무동작
    if (!cmd.targets.length) { this.app.status("변환할 픽셀 레이어가 없습니다."); return; }
    this.app.history.execute(cmd);
    this.app.status(`${label} 완료 (${IMAGE_MODE_LABELS[nextMode.mode] || ""})`);
  }

  // ── 공개 변환 API ──────────────────────────────────────────────────────────

  // 회색조 변환
  convertToGrayscale() {
    this._run((img) => toGrayscale(img),
      { mode: "grayscale", palette: null },
      "회색조 변환");
  }

  // 비트맵(1비트) 변환. opts: { method:"threshold"|"diffusion", level:1~255 }
  convertToBitmap(opts = {}) {
    const o = { method: opts.method || "threshold", level: opts.level ?? 128 };
    this._run((img) => toBitmap(img, o),
      { mode: "bitmap", palette: null },
      "비트맵 변환");
  }

  // 인덱스 색상 변환. opts: { colors:2~256, dither:bool }
  // 팔레트는 "전 레이어를 합성한 결과"에서 생성해야 화면과 일치한다(레이어별로 따로
  // 만들면 팔레트가 제각각이 됨). 합성 결과로 팔레트를 만든 뒤 그 팔레트를 모든
  // 레이어에 동일 적용한다.
  convertToIndexed(opts = {}) {
    const colors = Math.max(2, Math.min(256, opts.colors ?? 256));
    const dither = !!opts.dither;
    if (!this.app.layers?.count) { this.app.status("변환할 이미지가 없습니다."); return; }

    // 합성 결과(평탄화)에서 팔레트 산출
    const flat = this.app.layers.flatten();
    const fctx = flat.getContext("2d", { willReadFrequently: true });
    const flatImg = fctx.getImageData(0, 0, flat.width, flat.height);
    const palette = buildPalette(flatImg, colors);

    this._run((img) => applyPalette(img, palette, { dither }),
      { mode: "indexed", palette },
      "인덱스 색상 변환");
  }

  // Color Table 에서 편집된 팔레트를 다시 적용한다(인덱스 모드 한정).
  // 디더링은 재적용 시 보통 끄는 게 자연스럽지만 호출 측 선택을 따른다.
  reapplyPalette(palette, { dither = false } = {}) {
    if (this.mode !== "indexed") { this.app.status("인덱스 색상 모드가 아닙니다."); return; }
    if (!palette || !palette.length) { this.app.status("팔레트가 비어 있습니다."); return; }
    const pal = palette.map((c) => c.slice());
    this._run((img) => applyPalette(img, pal, { dither }),
      { mode: "indexed", palette: pal },
      "색상 테이블 적용");
  }

  // RGB 색상으로 복귀(픽셀은 그대로, 모드 표식만 rgb 로). 인덱스 팔레트는 해제.
  // 실제 픽셀 변경이 없으므로 전 레이어 스냅샷 없이 모드 상태만 바꾸는 경량 커맨드를 쓴다.
  convertToRGB() {
    if (this.mode === "rgb") { this.app.status("이미 RGB 색상 모드입니다."); return; }
    const prevMode = { mode: this.mode, palette: this.palette ? this.palette.map((c) => c.slice()) : null };
    const nextMode = { mode: "rgb", palette: null };
    const cmd = new ImageModeStateCommand(
      this.app.layers,
      (m) => this._applyModeState(m),
      prevMode, nextMode, "RGB 색상 변환",
    );
    this.app.history.execute(cmd);
    this.app.status("RGB 색상 변환 완료");
  }
}
