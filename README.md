# Canvas Photo Editor

크롬/엣지 확장프로그램(Manifest V3)으로 동작하는 **포토샵 7 수준의 기본 기능 이미지 에디터**입니다.
외부 라이브러리·빌드 도구 없이 순수 HTML/CSS/JavaScript + Canvas API로만 작성했습니다. 완전 오프라인으로 동작합니다.

> 대상 OS: Windows 10 / 11 · 대상 브라우저: Chrome, Edge (Chromium 계열)

---

## 설치 (압축해제 로드)

1. 크롬 주소창에 `chrome://extensions` 입력 (엣지는 `edge://extensions`)
2. 우측 상단 **개발자 모드**를 켭니다
3. **압축해제된 확장 프로그램을 로드** 버튼 클릭
4. 이 폴더(`canvas-photo-editor`, `manifest.json`이 있는 폴더)를 선택
5. 툴바의 퍼즐 아이콘에서 **Canvas Photo Editor**를 고정(pin)

설치하면 안내용으로 에디터 탭이 한 번 열립니다. 이후에는 **툴바 아이콘을 클릭**하면 새 탭에서 에디터가 열립니다.

> 코드를 수정한 뒤에는 `chrome://extensions` 카드의 새로고침(↻) 버튼을 누르면 반영됩니다.

---

## 주요 기능

- **레이어**: 다중 레이어, 표시/숨김, 불투명도, 순서 변경, 복제, 아래로 병합, 평탄화, 썸네일
- **그리기 도구**: 브러시(팁 5종 — 둥근·사각·스패터·분필·캘리그래피, 경도·불투명도), 연필, 지우개, 페인트 버킷(허용오차), 스포이드, 이동
- **도형**: 사각형 / 타원 / 직선 (채우기·외곽선·선 두께, Shift로 정형)
- **텍스트**: 클릭 입력(한글 IME 지원) 후 래스터화, 글꼴·크기·굵게·기울임
- **선택**: 사각형 선택, 올가미, 매직완드 — 선택 영역 한정 편집/삭제/채우기
- **변형**: 이미지 크기, 캔버스 크기, 90°/180° 회전, 좌우/상하 뒤집기, 선택 영역으로 자르기
- **색보정**: 레벨(채널 RGB/빨강/녹색/파랑/알파 + 히스토그램), 커브(채널별 톤 곡선 편집), 밝기/대비, 색조/채도, 자동 레벨, 흑백, 색 반전 (실시간 미리보기)
- **채널·알파**: 레벨·커브를 R/G/B/알파 채널별로 개별 적용, 불투명(알파) 영역을 선택으로 변환
- **필터**: 가우시안 블러, 샤픈, 노이즈, 세피아, 엠보스
- **파일**: 이미지 열기(파일 선택·드래그앤드롭·클립보드 붙여넣기), PNG/JPG 저장
- **편집**: 실행 취소/다시 실행(다단계), 줌(5%~3200%)/팬

---

## 단축키

| 도구 | 키 | | 동작 | 키 |
|---|---|---|---|---|
| 이동 | V | | 실행 취소 | Ctrl+Z |
| 사각형 선택 | M | | 다시 실행 | Ctrl+Shift+Z |
| 올가미 | L | | 열기 | Ctrl+O |
| 매직완드 | W | | PNG 저장 | Ctrl+S |
| 브러시 | B | | 새 문서 | Ctrl+N |
| 연필 | N | | 모두 선택 | Ctrl+A |
| 지우개 | E | | 선택 해제 | Ctrl+D |
| 페인트 버킷 | G | | 선택 영역 삭제 | Delete |
| 스포이드 | I | | 복사 | Ctrl+C / 붙여넣기 Ctrl+V |
| 도형 | U | | 화면 맞춤 | Ctrl+0 |
| 텍스트 | T | | 실제 크기 | Ctrl+1 |
| 손(팬) | H / 스페이스 | | 확대/축소 | Ctrl+`+` / Ctrl+`-`, 마우스 휠 |

- 브러시 크기: `[` `]` · 전경/배경 교환: `X` · 기본 흑백: `D`

---

## 기술 메모 (개발자용)

- **빌드 불필요**: `<script type="module">`로 ES 모듈을 직접 로드. MV3 CSP(`script-src 'self'`)에 그대로 부합
- **CSP 준수**: `eval`/`new Function`/인라인 스크립트/외부 CDN 전혀 사용하지 않음
- **아키텍처**: EventBus(pub-sub) + AppState(단일 상태) 중심의 단방향 의존. 렌더는 `requestAnimationFrame` + dirty 플래그
- **레이어**: 레이어 1장 = 분리된 `<canvas>` 1장. 표시 캔버스에 순서대로 합성
- **Undo/Redo**: 픽셀 편집은 변경 영역(bbox)의 before/after만 저장, 구조 변경은 경량 커맨드
- **필터 엔진**: StackBlur(가우시안 근사), 스캔라인 flood fill, 256-LUT 색보정 — 모두 DOM 무관 순수 함수

### 폴더 구조

```
canvas-photo-editor/
├─ manifest.json        # MV3 매니페스트
├─ background.js        # 서비스 워커 (아이콘 클릭 → 새 탭)
├─ editor.html          # 단일 페이지 셸
├─ css/style.css
├─ icons/
└─ js/
   ├─ app.js            # 진입점·조립·전역 단축키·고수준 액션
   ├─ core/             # event-bus, state, constants
   ├─ layers/           # layer, layer-manager
   ├─ render/           # viewport, renderer
   ├─ history/          # command-manager, commands/
   ├─ tools/            # 도구 12종 + tool-manager
   ├─ selection/        # selection-manager
   ├─ engine/           # color, floodfill, blur, adjustments, filters, imagedata
   ├─ io/               # file-io, clipboard
   └─ ui/               # toolbar, options-bar, color-panel, layers-panel, menu-bar, dialogs
```

라이선스: 자유 사용. 참고 오픈소스(패턴 참조): miniPaint(MIT), StackBlur.
