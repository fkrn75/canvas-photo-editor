// event-bus.js — 단순 발행/구독(pub-sub) 버스
// 모듈 간 결합도를 낮추기 위해 모든 통신은 이 버스를 거친다.

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} 이벤트명 → 핸들러 집합 */
    this._handlers = new Map();
  }

  // 이벤트 구독. 해제 함수를 반환한다.
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  // 구독 해제
  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) set.delete(handler);
  }

  // 이벤트 발행. 핸들러 예외가 다른 핸들러를 막지 않도록 격리한다.
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] '${event}' 핸들러 오류:`, err);
      }
    }
  }
}
