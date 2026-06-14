// history-panel.js — 히스토리 팔레트(History Palette)
// CommandManager의 undo/redo 스택을 "선형 타임라인"으로 시각화한다.
//
// [선형 타임라인 모델]
//   command-manager는 undoStack(끝이 최신) + redoStack(끝이 다음에 다시 실행될 항목) 2개로 동작한다.
//   이를 사람이 보는 한 줄 타임라인으로 환산하면:
//     - 스텝 0           : "원본"(어떤 커맨드도 적용되기 전 상태)
//     - 스텝 1..N        : undoStack을 오래된→최신 순으로 나열한 각 커맨드
//     - 스텝 N+1..N+M    : redoStack을 "다시 실행될 순서"(redoStack의 끝→앞)로 이어 붙인 미래 커맨드
//   현재 위치(currentIndex) = undoStack.length. (0이면 원본 상태)
//   목표 스텝으로 점프 = 현재 인덱스와 목표 인덱스 차이만큼 undo()/redo()를 반복 호출.
//   → command-manager를 수정하지 않고 기존 undo()/redo()만으로 인덱스 점프를 구현한다.
//
// [스냅샷]
//   현재 합성 결과(app.layers.flatten())를 캡처해 보관한다. 클릭하면 활성 레이어에 그 이미지를
//   다시 그려 복원하는데, 이 복원 자체도 beginPixelEdit/commitPixelEdit로 히스토리에 한 단계로 남는다.
//   (스냅샷은 PaintCommand로 기록되므로 타임라인 모델과 자연스럽게 어우러진다.)
//
// layers-panel.js / swatches-panel.js의 패널 구조·클래스(.panel/.panel-head/툴바)를 참고했다.

import { EVT } from "../core/constants.js";

export class HistoryPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    // 스냅샷 목록: { name, canvas(전체 합성), thumb(작은 미리보기 canvas) }
    this.snapshots = [];
    this._snapSeq = 0;
    this._build();
    // 히스토리 스택이 바뀔 때마다(추가/undo/redo/clear) 목록을 다시 그린다.
    this.app.bus.on(EVT.HISTORY_CHANGED, () => this._render());
  }

  // ── DOM 골격 ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">작업 내역</div>
      <div class="history-list"></div>
      <div class="history-snapshots"></div>
      <div class="history-toolbar">
        <button class="hist-snap" title="현재 상태를 스냅샷으로 저장">📷 스냅샷</button>
        <button class="hist-clear" title="작업 내역 모두 지우기">🗑</button>
      </div>`;

    this.list = this.el.querySelector(".history-list");
    this.snapBox = this.el.querySelector(".history-snapshots");

    // 핵심 레이아웃은 공유 CSS가 없어도 동작하도록 인라인으로 보장(클래스는 추가 스타일링용).
    this.list.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:4px;";
    this.snapBox.style.cssText = "max-height:120px;overflow-y:auto;padding:0 4px;";

    const tb = this.el.querySelector(".history-toolbar");
    tb.style.cssText =
      "display:flex;gap:2px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";

    this.el.querySelector(".hist-snap").addEventListener("click", () => this._makeSnapshot());
    this.el.querySelector(".hist-clear").addEventListener("click", () => this._clearHistory());

    this._render();
  }

  // ── 선형 타임라인 계산 ──
  // 반환: { steps: [{label}], currentIndex }
  //   steps[0] 은 항상 "원본". 이후 undoStack(과거→현재) + redoStack(미래) 순.
  _timeline() {
    const h = this.app.history;
    const steps = [{ label: "원본" }];
    // 적용된 커맨드(오래된→최신)
    for (const cmd of h.undoStack) steps.push({ label: cmd.label || "작업" });
    // 미래 커맨드: redoStack은 끝이 "다음에 다시 실행될 항목"이므로 끝→앞 순으로 이어 붙인다.
    for (let i = h.redoStack.length - 1; i >= 0; i--) {
      steps.push({ label: h.redoStack[i].label || "작업", future: true });
    }
    return { steps, currentIndex: h.undoStack.length };
  }

  // ── 렌더 ──
  _render() {
    const { steps, currentIndex } = this._timeline();
    this.list.innerHTML = "";

    steps.forEach((step, idx) => {
      const row = document.createElement("div");
      row.className = "history-step"
        + (idx === currentIndex ? " active" : "")
        + (step.future ? " future" : "");
      // 인라인 기본 스타일(공유 CSS 없이도 보이도록). 클래스로 세부 톤 조정.
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:3px 6px;margin-bottom:1px;" +
        "border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        (idx === currentIndex ? "background:var(--accent);color:#fff;" : "") +
        (step.future ? "opacity:.5;" : "");

      const icon = document.createElement("span");
      icon.textContent = idx === 0 ? "▣" : "•";
      icon.style.cssText = "flex:none;width:14px;text-align:center;opacity:.8;";

      const label = document.createElement("span");
      label.textContent = step.label;
      label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;";

      row.append(icon, label);
      // 클릭 → 해당 스텝으로 점프(undo/redo 반복)
      row.addEventListener("click", () => this._jumpTo(idx));
      this.list.appendChild(row);
    });

    this._renderSnapshots();
  }

  _renderSnapshots() {
    this.snapBox.innerHTML = "";
    if (this.snapshots.length === 0) return;

    const head = document.createElement("div");
    head.textContent = "스냅샷";
    head.style.cssText =
      "font-size:11px;color:var(--text-dim);padding:4px 2px 2px;border-top:1px solid var(--border);";
    this.snapBox.appendChild(head);

    this.snapshots.forEach((snap, i) => {
      const row = document.createElement("div");
      row.className = "history-snap-row";
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:3px 4px;margin-bottom:1px;" +
        "border-radius:3px;cursor:pointer;";

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "history-snap-thumb";
      thumbWrap.style.cssText =
        "width:32px;height:32px;flex:none;border:1px solid var(--border);" +
        "background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;";
      thumbWrap.appendChild(snap.thumb);

      const name = document.createElement("span");
      name.textContent = snap.name;
      name.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      // 삭제 버튼(우측)
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "스냅샷 삭제";
      del.style.cssText = "flex:none;padding:0 5px;line-height:1.6;";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.snapshots.splice(i, 1);
        this._renderSnapshots();
      });

      row.append(thumbWrap, name, del);
      row.title = "클릭하면 이 스냅샷으로 복원";
      // 클릭 → 스냅샷 복원(되돌릴 수 있는 한 단계로 기록)
      row.addEventListener("click", () => this._restoreSnapshot(snap));
      this.snapBox.appendChild(row);
    });
  }

  // ── 스텝 점프: 현재 인덱스와 목표 인덱스 차이만큼 undo()/redo() 반복 ──
  _jumpTo(targetIndex) {
    const h = this.app.history;
    let cur = h.undoStack.length;
    if (targetIndex === cur) return;
    // (HISTORY_CHANGED가 매 호출마다 발생해 _render가 반복 호출되지만 비용은 작다.)
    while (cur > targetIndex) { h.undo(); cur = h.undoStack.length; }
    while (cur < targetIndex) {
      const before = cur;
      h.redo();
      cur = h.undoStack.length;
      // redoStack이 비어 더 못 나아가면 무한 루프 방지
      if (cur === before) break;
    }
  }

  // ── 스냅샷 만들기: 현재 합성 결과를 캡처 ──
  _makeSnapshot() {
    const lm = this.app.layers;
    if (!lm.width || !lm.height) { this.app.status("문서가 없습니다."); return; }

    // 전체 합성본(원본 해상도)
    const full = lm.flatten();

    // 작은 미리보기(32px 박스에 맞춤)
    const ratio = Math.min(32 / lm.width, 32 / lm.height);
    const thumb = document.createElement("canvas");
    thumb.width = Math.max(1, Math.round(lm.width * ratio));
    thumb.height = Math.max(1, Math.round(lm.height * ratio));
    thumb.getContext("2d").drawImage(full, 0, 0, thumb.width, thumb.height);
    thumb.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";

    this._snapSeq += 1;
    this.snapshots.push({ name: `스냅샷 ${this._snapSeq}`, canvas: full, thumb });
    this._renderSnapshots();
    this.app.status(`스냅샷 ${this._snapSeq} 저장됨`);
  }

  // ── 스냅샷 복원: 활성 레이어에 스냅샷 이미지를 그려 넣음(undo 가능한 한 단계) ──
  _restoreSnapshot(snap) {
    const layer = this.app.layers.activeLayer;
    if (!layer) { this.app.status("복원할 레이어가 없습니다."); return; }

    // 문서 크기가 스냅샷과 다르면(자르기/리사이즈 후) 안전하게 막는다.
    if (snap.canvas.width !== layer.width || snap.canvas.height !== layer.height) {
      this.app.status("문서 크기가 달라 이 스냅샷으로 복원할 수 없습니다.");
      return;
    }

    this.app.history.beginPixelEdit(layer);
    layer.ctx.clearRect(0, 0, layer.width, layer.height);
    layer.ctx.drawImage(snap.canvas, 0, 0);
    layer.thumbDirty = true;
    // 레이어 전체가 바뀌므로 box=null(전체) 로 커밋
    this.app.history.commitPixelEdit(null, `${snap.name} 복원`);
    this.app.status(`${snap.name}(으)로 복원했습니다.`);
  }

  _clearHistory() {
    this.app.history.clear();
    this.app.status("작업 내역을 지웠습니다.");
  }
}
