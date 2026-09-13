// busy.js — 무거운 연산(필터 최종 적용 등) 실행 중임을 커서·상태바로 알리는 진행 표시 유틸리티.
//
// runBusy(app, label, fn): 커서를 wait로 바꾸고 상태바에 "처리 중: label…"을 띄운 뒤,
// 다음 프레임(rAF)과 그 다음 매크로태스크(setTimeout 0) — 2단계를 건너뛰어 브라우저가
// 그 상태를 실제로 화면에 그릴 시간을 준 다음에 fn을 실행한다. fn이 동기 함수라 메인 스레드를
// 오래 막더라도, 그 전에 이미 "처리 중" 표시가 페인트되어 있어야 사용자가 멈춘 게 아니라
// 작업 중임을 알 수 있다. 완료되면 소요 시간(ms)을 상태바에 남기고 커서를 되돌리며,
// fn에서 예외가 나도 반드시 해제한다(무통지 고착 방지, app.js의 전역 오류 핸들러와 별개로
// 여기서도 커서만은 확실히 되돌린다).
//
// ⚠️ 액션(매크로) 재생 경로(actions-manager.js → app.applyFilter)는 이 2단계 지연을 타면
// 스텝 순서가 깨질 수 있다(다음 스텝이 "이전 스텝이 이미 커밋됐다"고 가정하고 레이어 픽셀을
// 읽는데, 지연 중엔 아직 커밋 전이다). 그 경로는 runBusySync(같은 틱에서 즉시 실행)를 쓴다.
// 자세한 판단 근거는 app.js의 applyFilter 주석 참고.

// 커서: body 전체 + 캔버스(도구가 canvas.style.cursor를 직접 지정하므로 body보다 우선함) 둘 다 바꾼다.
function _enter(app, label) {
  document.body.classList.add("busy"); // ui가 CSS로 추가 연출(스피너 등)을 걸 수 있는 훅
  document.body.style.cursor = "wait";
  if (app.canvas) app.canvas.style.cursor = "wait";
  app.status(`처리 중: ${label}…`);
}

function _exit(app, label, ms) {
  document.body.classList.remove("busy");
  document.body.style.cursor = "";
  // 캔버스 커서는 활성 도구 기준으로 되돌린다(직접 복원값을 들고 있지 않고 도구 매니저의
  // 계산 로직을 재사용 — tool-manager.js는 건드리지 않고 그냥 호출만 한다).
  app.tools?._applyCursor?.();
  app.status(`${label} 완료 (${Math.round(ms)}ms)`);
}

// 비동기(2단계 지연) 버전 — 사용자가 다이얼로그에서 [적용]을 누르는 등 단발성 상호작용에 사용.
export function runBusy(app, label, fn) {
  _enter(app, label);
  requestAnimationFrame(() => {
    setTimeout(() => {
      const t0 = Date.now();
      try {
        fn();
      } catch (err) {
        console.error(`[runBusy] '${label}' 처리 중 오류:`, err);
        app.status(`오류: ${label} 처리 실패`);
      } finally {
        _exit(app, label, Date.now() - t0);
      }
    }, 0);
  });
}

// 동기 버전 — 순서가 절대 깨지면 안 되는 경로(액션 재생 등)에서 지연 없이 같은 틱에 실행.
// 프레임을 건너뛰지 않으므로 아주 무거운 연산에서는 "처리 중" 표시가 실제로 페인트되기 전에
// 메인 스레드가 막힐 수 있다(그래도 완료 후 소요 시간 표시는 남는다).
export function runBusySync(app, label, fn) {
  _enter(app, label);
  const t0 = Date.now();
  try {
    fn();
  } finally {
    _exit(app, label, Date.now() - t0);
  }
}
