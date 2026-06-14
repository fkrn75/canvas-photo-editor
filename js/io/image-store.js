// image-store.js — File Browser용 최근 이미지 영속 저장소(IndexedDB 래퍼).
//
// 왜 IndexedDB인가:
//   - localStorage는 ~5MB 한도라 이미지 dataURL을 몇 장만 담아도 넘친다.
//   - MV3 확장에서 blob: URL은 세션/탭이 닫히면 무효화되어 "최근 이미지"로 부적합하다.
//   - IndexedDB는 dataURL/Blob을 용량 여유 있게 영속 저장할 수 있고 MV3 확장에서도 동작한다.
//
// 저장 정책:
//   - 한 레코드 = { id, name, w, h, bytes, thumb, full, createdAt }
//   - thumb : 그리드 표시용 축소 dataURL(JPEG, 한 변 max 160px). 항상 저장(가볍다).
//   - full  : 재열기용 전체 이미지 dataURL. 너무 크면(아래 한도 초과) 생략하고 thumb만 보관.
//   - 최대 N개(LRU): 넘치면 createdAt이 가장 오래된 레코드부터 삭제.
//
// 외부 의존 0(순수 IndexedDB). 모든 메서드는 Promise를 반환한다.

const DB_NAME = "cpe_filebrowser";   // canvas-photo-editor File Browser
const DB_VERSION = 1;
const STORE = "images";

// 운영 한도 (재량 판단값)
const MAX_ITEMS = 30;                 // 최근 이미지 보관 개수(LRU)
const THUMB_MAX = 160;                // 썸네일 한 변 최대 px
const THUMB_QUALITY = 0.7;            // 썸네일 JPEG 품질
const FULL_MAX_BYTES = 8 * 1024 * 1024; // 전체본 dataURL이 이보다 크면 저장 생략(8MB)

export class ImageStore {
  constructor() {
    this._dbPromise = null;
  }

  // IndexedDB를 사용할 수 있는 환경인지(테스트/구형 대비).
  static isSupported() {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  }

  // DB 연결(최초 호출 시 생성, 이후 캐시된 Promise 재사용).
  _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (!ImageStore.isSupported()) { reject(new Error("IndexedDB 미지원")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 열기 실패"));
    });
    return this._dbPromise;
  }

  // 트랜잭션 헬퍼. mode: "readonly" | "readwrite"
  async _tx(mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      Promise.resolve(fn(store))
        .then((r) => { result = r; })
        .catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("트랜잭션 실패"));
      tx.onabort = () => reject(tx.error || new Error("트랜잭션 중단"));
    });
  }

  // ── 저장 ──
  // <img>(로드 완료) 또는 캔버스에서 썸네일+전체본을 만들어 저장한다.
  // 같은 시각 충돌을 피하려고 id는 시각+난수로 생성. 반환: 저장된 레코드 메타.
  async putFromImage(img, name) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("이미지 크기를 읽을 수 없습니다.");

    const thumb = this._makeThumb(img, w, h);
    // 전체본은 PNG로 무손실 저장하되, 너무 크면 생략(용량 보호).
    let full = null;
    try {
      const fullData = this._toDataURL(img, w, h, "image/png", 1);
      if (fullData && fullData.length <= FULL_MAX_BYTES) full = fullData;
    } catch { /* 전체본 생성 실패는 무시(썸네일만으로도 목록 표시는 가능) */ }

    const rec = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || "이미지",
      w, h,
      bytes: full ? full.length : (thumb ? thumb.length : 0),
      thumb,
      full,
      createdAt: Date.now(),
    };

    await this._tx("readwrite", (store) => store.put(rec));
    await this._enforceLimit();
    // 본문(full)은 호출부에 돌려줄 필요가 없어 메타만 반환(메모리 절약).
    return { id: rec.id, name: rec.name, w, h, createdAt: rec.createdAt, hasFull: !!full };
  }

  // ── 조회 ──
  // 최신순(createdAt desc) 레코드 목록. 기본은 그리드 표시에 필요한 필드만(전체본 제외)로 가볍게.
  async list({ withFull = false } = {}) {
    const recs = await this._tx("readonly", (store) =>
      new Promise((resolve, reject) => {
        const out = [];
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { out.push(c.value); c.continue(); }
          else resolve(out);
        };
        cur.onerror = () => reject(cur.error);
      })
    );
    recs.sort((a, b) => b.createdAt - a.createdAt); // 최신이 앞
    if (withFull) return recs;
    // 전체본(full)은 무거우므로 목록에서는 제거하고 메타+썸네일만 반환.
    return recs.map(({ full, ...meta }) => meta);
  }

  // 단일 레코드(전체본 포함) 조회. 재열기 시 사용.
  async get(id) {
    return this._tx("readonly", (store) =>
      new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
    );
  }

  // ── 삭제 ──
  async delete(id) {
    return this._tx("readwrite", (store) => store.delete(id));
  }

  async clear() {
    return this._tx("readwrite", (store) => store.clear());
  }

  // ── 내부: LRU 한도 적용 ──
  async _enforceLimit() {
    const recs = await this._tx("readonly", (store) =>
      new Promise((resolve, reject) => {
        const out = [];
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { out.push({ id: c.value.id, createdAt: c.value.createdAt }); c.continue(); }
          else resolve(out);
        };
        cur.onerror = () => reject(cur.error);
      })
    );
    if (recs.length <= MAX_ITEMS) return;
    recs.sort((a, b) => a.createdAt - b.createdAt); // 오래된 순
    const remove = recs.slice(0, recs.length - MAX_ITEMS);
    await this._tx("readwrite", (store) => {
      for (const r of remove) store.delete(r.id);
    });
  }

  // ── 내부: 캔버스로 dataURL 만들기 ──
  // 원본을 (maxW×maxH 안에 맞춘 비율)로 그려 dataURL 반환. dw/dh 미지정 시 원본 크기.
  _toDataURL(img, sw, sh, mime, quality, dw = sw, dh = sh) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(dw));
    canvas.height = Math.max(1, Math.round(dh));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(mime, quality);
  }

  // 썸네일 dataURL(JPEG). 한 변이 THUMB_MAX를 넘으면 비율 유지 축소.
  _makeThumb(img, w, h) {
    const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    try {
      return this._toDataURL(img, w, h, "image/jpeg", THUMB_QUALITY, dw, dh);
    } catch {
      return null; // toDataURL 실패(예: 오염된 캔버스)는 null 처리
    }
  }
}
