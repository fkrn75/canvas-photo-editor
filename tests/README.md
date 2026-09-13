# tests/

실행: `npm test` (= `node --test tests/**/*.test.js`). 외부 의존성 없음(Node 내장 `node:test`).
(이 Node v24.13.0/Windows 환경에서는 `node --test tests/`처럼 디렉터리를 직접 넘기면 CJS 로더가 그 경로를 모듈로 require하려다 MODULE_NOT_FOUND로 실패하는 버그가 있어 glob 패턴을 대신 사용한다. `node --test`를 인자 없이 실행하면 기본 재귀 탐색으로도 정상 동작한다.)

범위: DOM 참조가 없는 `js/engine/` 순수 함수만 대상(adjustments/color/floodfill/imagedata/image-mode/filters/blur 전체, blend는 DOM 미사용 부분만).

제외: `blend.js`의 `buildEffectiveSource`/`clipAlphaByAlpha`/`blendLayerOnto`(canvas/document 직접 호출), 그 외 `js/engine/`의 blur.js를 제외한 캔버스·DOM 의존 모듈(channel-view, image-mode-controller, patterns, brush-dynamics, brush-textures) — 신규 테스트 추가 시 이 원칙을 유지할 것.

규칙: Node에 없는 브라우저 `ImageData`가 필요한 모듈은 `tests/helpers.js`의 폴리필/헬퍼를 임포트해 사용한다.
