// file-browser-panel.js — 최근 이미지 브라우저(썸네일 그리드).
//
// 사용자가 이미지를 열 때마다 ImageStore(IndexedDB)에 썸네일+메타가 쌓인다.
// 이 패널은 그것을 최신순 그리드로 보여주고:
//   - 셀 클릭   → 저장된 전체본을 다시 열기(app.placeImage). 전체본이 없으면 썸네일로 대체.
//   - 셀 우클릭 → 해당 항목 삭제(확인 없이; 부가 데이터라 가볍게).
//   - 휴지통(🗑) 버튼 → 전체 비우기.
//   - 새로고침(↻) 버튼 → 목록 다시 읽기.
//
// 저장 추가는 file-io.js의 로드 훅(app.imageStore.putFromImage)이 담당하고,
// 이 패널은 EVT.IMAGE_STORED 이벤트를 받아 자동 갱신한다.
//
// swatches-panel.js / brushes-panel.js의 인라인 스타일 패턴을 따른다(공유 CSS 없이도 동작).
// ⚠ .rightpanel 안에서 패널이 형제를 짜부시키지 않도록 본문은 flex:1 1 auto + min-height(메모리 사례).

import { EVT } from "../core/constants.js";
import { ImageStore } from "../io/image-store.js";

export class FileBrowserPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    // app.imageStore가 이미 있으면(다른 곳에서 생성) 공유, 없으면 새로 만들어 app에 노출.
    this.store = app.imageStore || (app.imageStore = new ImageStore());

    this._build();
    this._refresh();

    // 새 이미지가 저장되면 자동 갱신(file-io 훅이 emit). 상수에 없을 수 있어 문자열 폴백.
    const evtName = EVT.IMAGE_STORED || "image:stored";
    app.bus.on(evtName, () => this._refresh());
  }

  // ── DOM 골격 ──
  _build() {
    this.el.innerHTML = `
      <div class="panel-head">
        <span>최근 이미지</span>
        <span class="fb-tools">
          <button class="fb-refresh" title="새로고침">↻</button>
          <button class="fb-clear" title="모두 지우기">🗑</button>
        </span>
      </div>`;

    // panel-head의 우측 도구 묶음
    const tools = this.el.querySelector(".fb-tools");
    tools.style.cssText = "display:flex;gap:2px;";
    tools.querySelectorAll("button").forEach((b) => {
      b.style.cssText = "background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:0 4px;";
    });

    // 스크롤 가능한 썸네일 그리드 본문(형제를 밀어내지 않게 flex:1 1 auto + min-height).
    this.grid = document.createElement("div");
    this.grid.className = "fb-grid";
    this.grid.style.cssText =
      "flex:1 1 auto;min-height:120px;overflow-y:auto;padding:8px;" +
      "display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:6px;align-content:start;";
    this.el.appendChild(this.grid);

    this.el.querySelector(".fb-refresh").addEventListener("click", () => this._refresh());
    this.el.querySelector(".fb-clear").addEventListener("click", () => this._clearAll());
  }

  // ── 목록 읽어 그리드 렌더 ──
  async _refresh() {
    let items = [];
    try {
      items = await this.store.list(); // 썸네일+메타만(가벼움)
    } catch {
      this._renderEmpty("저장소를 열 수 없습니다.");
      return;
    }
    if (!items.length) { this._renderEmpty("아직 연 이미지가 없습니다."); return; }

    this.grid.innerHTML = "";
    for (const it of items) this.grid.appendChild(this._cell(it));
  }

  _renderEmpty(msg) {
    this.grid.innerHTML = "";
    const p = document.createElement("div");
    // 그리드 전체 폭을 차지하는 안내문
    p.style.cssText = "grid-column:1/-1;color:var(--text-dim);font-size:11px;text-align:center;padding:12px 4px;";
    p.textContent = msg;
    this.grid.appendChild(p);
  }

  // 썸네일 셀 하나 생성.
  _cell(item) {
    const cell = document.createElement("div");
    cell.className = "fb-cell";
    cell.style.cssText =
      "position:relative;aspect-ratio:1/1;border:1px solid var(--border);border-radius:3px;" +
      "overflow:hidden;cursor:pointer;background:var(--bg-panel-2);";
    cell.title = `${item.name} · ${item.w}×${item.h}\n클릭=열기 · 우클릭=삭제`;

    if (item.thumb) {
      const im = document.createElement("img");
      im.src = item.thumb;
      im.alt = item.name;
      im.draggable = false;
      im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      cell.appendChild(im);
    } else {
      // 썸네일이 없을 때(예: 생성 실패) 이름 머리글자 표시
      const ph = document.createElement("div");
      ph.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:11px;";
      ph.textContent = item.name.slice(0, 8);
      cell.appendChild(ph);
    }

    // 좌클릭: 재열기
    cell.addEventListener("click", () => this._reopen(item.id, item.name));
    // 우클릭: 삭제(기본 컨텍스트 메뉴 차단)
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this._remove(item.id, item.name);
    });
    return cell;
  }

  // ── 동작 ──
  // 저장된 전체본(없으면 썸네일)을 Image로 만들어 app.placeImage로 다시 연다.
  async _reopen(id, name) {
    let rec = null;
    try { rec = await this.store.get(id); } catch { /* 무시 */ }
    if (!rec) { this.app.status("이미지를 찾을 수 없습니다."); return; }
    const src = rec.full || rec.thumb;
    if (!src) { this.app.status("이미지 데이터가 없습니다."); return; }

    const img = new Image();
    img.onload = () => {
      this.app.placeImage(img, name || rec.name || "이미지");
      this.app.status(`다시 열기: ${name || rec.name}`);
    };
    img.onerror = () => this.app.status("이미지를 다시 열 수 없습니다.");
    img.src = src;
  }

  async _remove(id, name) {
    try {
      await this.store.delete(id);
      this.app.status(`삭제: ${name}`);
    } catch {
      this.app.status("삭제에 실패했습니다.");
    }
    this._refresh();
  }

  async _clearAll() {
    try {
      await this.store.clear();
      this.app.status("최근 이미지를 모두 지웠습니다.");
    } catch {
      this.app.status("비우기에 실패했습니다.");
    }
    this._refresh();
  }
}
