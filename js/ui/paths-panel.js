// paths-panel.js — 패스 팔레트(Paths Palette).
// PathManager(app.paths)의 패스 목록을 보여주고, 선택영역 변환 / 채우기 / 획(Stroke) 동작을 제공한다.
//
// history-panel.js / layers-panel.js의 패널 구조(.panel / .panel-head + 인라인 기본 스타일)를 따랐다.
// 공유 CSS가 없어도 동작하도록 핵심 레이아웃은 인라인으로 보장하고, 클래스는 세부 스타일링용으로 둔다.
//
// 갱신: PathManager가 바뀔 때마다(_changed) onChange 콜백으로 _render를 호출하도록 연결한다.

export class PathsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._build();
    // PathManager 변경 → 목록 갱신 (별도 EVT 상수 없이 가벼운 콜백 훅 사용)
    if (this.app.paths) this.app.paths.onChange = () => this._render();
  }

  get pm() { return this.app.paths; }

  _build() {
    this.el.innerHTML = `
      <div class="panel-head">패스</div>
      <div class="paths-list"></div>
      <div class="paths-toolbar">
        <button class="path-sel"   title="현재 패스를 선택 영역으로 변환">⬚ 선택</button>
        <button class="path-fill"  title="현재 패스를 전경색으로 채우기">⬛ 채우기</button>
        <button class="path-stroke" title="현재 패스에 전경색 획 그리기">〰 획</button>
        <button class="path-del"   title="현재 패스 삭제">🗑</button>
      </div>`;

    this.list = this.el.querySelector(".paths-list");
    this.list.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:4px;";

    const tb = this.el.querySelector(".paths-toolbar");
    tb.style.cssText =
      "display:flex;flex-wrap:wrap;gap:2px;padding:4px 6px;border-top:1px solid var(--border);background:var(--bg-panel-2);";

    this.el.querySelector(".path-sel").addEventListener("click", () => this._toSelection());
    this.el.querySelector(".path-fill").addEventListener("click", () => this._fill());
    this.el.querySelector(".path-stroke").addEventListener("click", () => this._stroke());
    this.el.querySelector(".path-del").addEventListener("click", () => this._delete());

    this._render();
  }

  _render() {
    const pm = this.pm;
    this.list.innerHTML = "";
    if (!pm || pm.paths.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "펜 도구(P)로 패스를 그리세요.";
      empty.style.cssText = "color:var(--text-dim);font-size:11px;padding:8px 6px;";
      this.list.appendChild(empty);
      return;
    }

    pm.paths.forEach((path, i) => {
      const row = document.createElement("div");
      const isCur = path === pm.current;
      row.className = "path-row" + (isCur ? " active" : "");
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:4px 6px;margin-bottom:1px;" +
        "border-radius:3px;cursor:pointer;" +
        (isCur ? "background:var(--accent);color:#fff;" : "");

      // 미니 미리보기 썸네일
      const thumb = this._makeThumb(path);
      thumb.style.cssText =
        "width:34px;height:26px;flex:none;border:1px solid var(--border);background:#fff;";

      const name = document.createElement("span");
      name.textContent = `패스 ${i + 1}` + (path.closed ? " (닫힘)" : "") + ` · 앵커 ${path.anchors.length}`;
      name.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;";

      row.append(thumb, name);
      row.title = "클릭하면 이 패스를 작업 대상으로 선택";
      row.addEventListener("click", () => { pm.setCurrent(path); /* setCurrent가 _changed→_render */ });
      this.list.appendChild(row);
    });
  }

  // 패스 한 개를 작은 캔버스에 그려 미리보기로 만든다(문서 bounds를 썸네일에 맞춤).
  _makeThumb(path) {
    const W = 34, H = 26, pad = 3;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    if (path.anchors.length < 1) return c;

    // 패스 bounding box(앵커+핸들)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of path.anchors) {
      for (const [x, y] of [[a.x, a.y], [a.inX, a.inY], [a.outX, a.outY]]) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const scale = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    const ox = (W - bw * scale) / 2 - minX * scale;
    const oy = (H - bh * scale) / 2 - minY * scale;
    const tx = (x) => x * scale + ox;
    const ty = (y) => y * scale + oy;

    const A = path.anchors;
    g.beginPath();
    g.moveTo(tx(A[0].x), ty(A[0].y));
    for (let i = 1; i < A.length; i++) {
      const prev = A[i - 1], cur = A[i];
      g.bezierCurveTo(tx(prev.outX), ty(prev.outY), tx(cur.inX), ty(cur.inY), tx(cur.x), ty(cur.y));
    }
    if (path.closed && A.length >= 2) {
      const last = A[A.length - 1], first = A[0];
      g.bezierCurveTo(tx(last.outX), ty(last.outY), tx(first.inX), ty(first.inY), tx(first.x), ty(first.y));
      g.closePath();
    }
    g.strokeStyle = "#0078ff";
    g.lineWidth = 1;
    g.stroke();
    return c;
  }

  // ── 툴바 동작 ──
  _toSelection() {
    if (!this.pm) return;
    this.pm.toSelection();
  }

  _fill() {
    if (!this.pm) return;
    this.pm.fillPath();
  }

  // 획: 두께를 다이얼로그로 물어보고 적용(없으면 기본 2px).
  _stroke() {
    const pm = this.pm;
    if (!pm) return;
    const target = pm.current || pm.paths[pm.paths.length - 1];
    if (!target || target.anchors.length < 2) { this.app.status("획을 그릴 패스가 없습니다."); return; }
    this.app.dialogs.form("패스 획", [
      { key: "w", label: "두께(px)", type: "number", value: 2, min: 1, max: 200 },
    ], (v) => { pm.strokePath(target, v.w); }, "적용");
  }

  _delete() {
    const pm = this.pm;
    if (!pm) return;
    const target = pm.current || pm.paths[pm.paths.length - 1];
    if (!target) { this.app.status("삭제할 패스가 없습니다."); return; }
    pm.removePath(target);
    this.app.status("패스를 삭제했습니다.");
  }
}
