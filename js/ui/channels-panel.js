// channels-panel.js — 채널 팔레트(Channels Palette)
// 문서 합성 결과(app.layers.flatten())를 RGB·R·G·B·A 채널로 나눠 각 채널 썸네일을 보여주고,
// 채널 행 클릭 시 "채널 격리 미리보기"를 패널 내부 캔버스에 표시한다.
// "채널을 선택영역으로" 버튼은 현재 보고 있는 채널의 밝기를 선택 마스크로 만들어 app.selection에 적용한다.
//
// [renderer 최소 침습 설계]
//   메인 표시 캔버스(renderer)는 전혀 건드리지 않는다. 채널 격리는 이 패널 안의 별도 미리보기
//   캔버스(off-DOM 합성 → 패널 내 표시)로만 처리한다. 따라서 다른 워커의 renderer 오버레이와 충돌이 없다.
//
// history-panel.js / layers-panel.js의 패널 구조·클래스(.panel/.panel-head)와
// 인라인 기본 스타일(공유 CSS 없이도 동작) 관례를 따른다.

import { EVT } from "../core/constants.js";
import { extractChannel, channelToMask } from "../engine/channel-view.js";

// 표시할 채널 정의: [id, 라벨]. channel-dialogs.js의 CHANNELS와 일관(알파 포함).
const CHANNELS = [["rgb", "RGB"], ["r", "빨강"], ["g", "녹색"], ["b", "파랑"], ["a", "알파"]];
// 채널별 강조색(썸네일 라벨/테두리 톤). channel-dialogs.js의 CH_COLOR와 동일 팔레트.
const CH_COLOR = { rgb: "#eeeeee", r: "#e74c3c", g: "#2ecc71", b: "#3498db", a: "#bbbbbb" };
const THUMB_W = 44, THUMB_H = 28; // 썸네일 박스 크기(px). 우측 패널 세로 공간 절약을 위해 작게.

export class ChannelsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.activeChannel = null;   // 격리 미리보기 중인 채널 id. null=미리보기 꺼짐(원본)
    this.colorized = false;      // r/g/b를 해당 색으로 착색해 볼지 여부
    this._rows = new Map();      // channel id → { row, thumbCanvas }
    this._raf = 0;               // 썸네일 갱신 디바운스용

    this._build();

    // 문서/레이어/선택 변화 시 썸네일·미리보기 갱신(가벼운 디바운스).
    this.app.bus.on(EVT.LAYERS_CHANGED, () => this._scheduleRefresh());
    this.app.bus.on(EVT.ACTIVE_LAYER_CHANGED, () => this._scheduleRefresh());
    this.app.bus.on(EVT.DOCUMENT_CHANGED, () => this._scheduleRefresh());
  }

  // ── DOM 골격 ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">
        <span>채널</span>
        <label class="ch-colorize" title="단일 채널을 해당 색으로 표시" style="font-weight:400;font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer;color:var(--text-dim);">
          <input type="checkbox" class="ch-colorize-cb"> 색상
        </label>
      </div>
      <div class="channels-list"></div>
      <div class="channels-preview-wrap">
        <canvas class="channels-preview"></canvas>
        <div class="channels-preview-label"></div>
      </div>
      <div class="channels-toolbar">
        <button class="ch-to-selection" title="현재 채널의 밝기를 선택 영역으로 만든다">채널 → 선택</button>
        <button class="ch-reset" title="원본 보기로(격리 해제)">원본</button>
      </div>`;

    this.list = this.el.querySelector(".channels-list");
    this.previewWrap = this.el.querySelector(".channels-preview-wrap");
    this.preview = this.el.querySelector(".channels-preview");
    this.previewLabel = this.el.querySelector(".channels-preview-label");

    // 핵심 레이아웃은 공유 CSS가 없어도 동작하도록 인라인으로 보장.
    // 우측 패널 세로 공간이 빡빡하므로 목록은 작게 캡하고 내부 스크롤로 처리(다른 패널 압박 최소화).
    this.list.style.cssText = "padding:3px;overflow-y:auto;max-height:150px;";
    this.previewWrap.style.cssText =
      "padding:4px 6px;border-top:1px solid var(--border);display:none;flex-direction:column;gap:2px;";
    this.preview.style.cssText =
      "width:100%;max-height:120px;object-fit:contain;background:#1c1c1c;border:1px solid var(--border-light);display:block;image-rendering:pixelated;";
    this.previewLabel.style.cssText = "font-size:11px;color:var(--text-dim);text-align:center;";

    const tb = this.el.querySelector(".channels-toolbar");
    tb.style.cssText =
      "display:flex;gap:4px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";
    tb.querySelectorAll("button").forEach((b) => (b.style.flex = "1"));

    // 색상 착색 토글
    this._colorizeCb = this.el.querySelector(".ch-colorize-cb");
    this._colorizeCb.addEventListener("change", () => {
      this.colorized = this._colorizeCb.checked;
      this._refresh();             // 썸네일 + 미리보기 다시 그림
    });

    // 버튼: 채널→선택 / 원본 복귀
    this.el.querySelector(".ch-to-selection").addEventListener("click", () => this._channelToSelection());
    this.el.querySelector(".ch-reset").addEventListener("click", () => this._setActiveChannel(null));

    // 채널 행 생성
    CHANNELS.forEach(([id, label]) => this._addRow(id, label));

    this._refresh();
  }

  // 채널 한 행(썸네일 + 라벨) 생성
  _addRow(id, label) {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.dataset.channel = id;
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:2px 4px;margin-bottom:1px;" +
      "border-radius:3px;cursor:pointer;border:1px solid transparent;";

    // 썸네일 박스(체커보드 위에 채널 미리보기)
    const thumbWrap = document.createElement("div");
    thumbWrap.style.cssText =
      `width:${THUMB_W}px;height:${THUMB_H}px;flex:none;border:1px solid var(--border);` +
      "background:#1c1c1c;display:flex;align-items:center;justify-content:center;overflow:hidden;";
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_W; thumb.height = THUMB_H;
    thumb.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;image-rendering:auto;";
    thumbWrap.appendChild(thumb);

    const name = document.createElement("span");
    name.textContent = label;
    name.style.cssText = `flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${CH_COLOR[id]};`;

    row.append(thumbWrap, name);
    row.title = `${label} 채널 보기 (클릭=격리 미리보기 토글)`;
    row.addEventListener("click", () => {
      // 같은 채널 다시 클릭 → 토글로 원본 복귀
      this._setActiveChannel(this.activeChannel === id ? null : id);
    });

    this.list.appendChild(row);
    this._rows.set(id, { row, thumb });
  }

  // ── 현재 문서 합성 캔버스(없으면 null) ──
  _docCanvas() {
    const lm = this.app.layers;
    if (!lm || !lm.width || !lm.height) return null;
    return lm.flatten();   // 문서 좌표계 합성(블렌드 인식)
  }

  // ── 갱신 디바운스: 여러 이벤트가 몰려도 프레임당 1회만 다시 그림 ──
  _scheduleRefresh() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._refresh(); });
  }

  // ── 썸네일 + (미리보기 켜져 있으면) 격리 미리보기 다시 그림 ──
  _refresh() {
    const doc = this._docCanvas();
    // 행 강조 상태 갱신
    for (const [id, { row }] of this._rows) {
      const on = this.activeChannel === id;
      row.style.background = on ? "var(--accent)" : "transparent";
      row.style.borderColor = on ? "var(--accent-hover)" : "transparent";
    }
    if (!doc) {
      // 문서 없음: 썸네일 비우고 미리보기 숨김
      for (const { thumb } of this._rows.values()) {
        thumb.getContext("2d").clearRect(0, 0, thumb.width, thumb.height);
      }
      this.previewWrap.style.display = "none";
      return;
    }

    // 각 채널 썸네일 렌더(작게 축소해 extractChannel 비용 절감)
    const sw = doc.width, sh = doc.height;
    const ratio = Math.min(THUMB_W / sw, THUMB_H / sh, 1);
    const tw = Math.max(1, Math.round(sw * ratio));
    const th = Math.max(1, Math.round(sh * ratio));
    // 문서를 한 번 축소해 둔 뒤 채널 추출(작은 캔버스 기준 → 빠름)
    const small = document.createElement("canvas");
    small.width = tw; small.height = th;
    small.getContext("2d", { willReadFrequently: true }).drawImage(doc, 0, 0, tw, th);

    for (const [id, { thumb }] of this._rows) {
      const ch = extractChannel(small, id, this.colorized);
      const tctx = thumb.getContext("2d");
      tctx.clearRect(0, 0, thumb.width, thumb.height);
      // 썸네일 박스 가운데 정렬
      const ox = (thumb.width - ch.width) / 2, oy = (thumb.height - ch.height) / 2;
      tctx.drawImage(ch, ox, oy);
    }

    // 격리 미리보기(활성 채널이 있으면 원해상도로 표시)
    if (this.activeChannel) {
      this.previewWrap.style.display = "flex";
      const full = extractChannel(doc, this.activeChannel, this.colorized);
      this.preview.width = full.width;
      this.preview.height = full.height;
      this.preview.getContext("2d").drawImage(full, 0, 0);
      const label = (CHANNELS.find(([v]) => v === this.activeChannel) || [, ""])[1];
      this.previewLabel.textContent = `${label} 채널 격리 보기`;
    } else {
      this.previewWrap.style.display = "none";
    }
  }

  // ── 채널 격리 미리보기 토글 ──
  _setActiveChannel(id) {
    this.activeChannel = id;
    this._refresh();
    if (id) {
      const label = (CHANNELS.find(([v]) => v === id) || [, ""])[1];
      this.app.status?.(`${label} 채널 격리 보기 (패널)`);
    }
  }

  // ── 채널 → 선택 영역 ──
  // 현재 활성 채널(없으면 휘도)의 밝기를 선택 마스크로 만들어 app.selection에 적용.
  _channelToSelection() {
    const doc = this._docCanvas();
    if (!doc) { this.app.status?.("문서가 없습니다."); return; }
    const channel = this.activeChannel || "l";  // 미리보기 안 켰으면 휘도 기준
    const { mask, bounds } = channelToMask(doc, channel);
    if (!bounds) { this.app.status?.("선택할 픽셀이 없습니다(채널이 모두 0)."); return; }
    this.app.selection.setMask(mask, bounds);
    const label = (CHANNELS.find(([v]) => v === channel) || [, channel])[1];
    this.app.status?.(`${label} 채널을 선택 영역으로 만들었습니다.`);
  }
}
