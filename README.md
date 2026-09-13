# Canvas Photo Editor

크롬/엣지 확장프로그램(Manifest V3)으로 동작하는 **포토샵 7 수준의 이미지 에디터**입니다.
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

- **레이어**: 다중 레이어, 표시/숨김, 불투명도(Opacity)와 별도 채우기 불투명도(Fill Opacity), 순서 변경, 복제, 아래로 병합, 보이는 레이어 병합(Merge Visible), 평탄화, Lock(투명/이미지/위치), 이름변경, 썸네일
- **블렌드 모드 22종**: 네이티브 16종(곱하기·스크린·오버레이·닷지/번 계열·차이/제외·색조/채도/색상/광도 등) + 커스텀 6종(Dissolve·Linear Burn·Linear Dodge·Vivid/Linear/Pin Light) per-pixel 합성
- **레이어 마스크 · 클리핑 마스크**: 그레이스케일 마스크 추가/삭제/사용토글 + 브러시 페인팅, 이전 레이어와 클리핑(Ctrl+G)
- **조정 레이어**(비파괴): 밝기/대비·색조/채도·레벨·커브·포스터화·한계값·반전·흑백, opacity·마스크로 강도 조절
- **레이어 스타일 10종**: Drop Shadow · Inner Shadow · Outer Glow · Inner Glow · Bevel/Emboss · Satin · Color Overlay · Gradient Overlay · Pattern Overlay · Stroke — 비파괴 합성 + Styles 팔레트(프리셋 9종·절차적 패턴 6종, localStorage)
- **벡터**: 펜 도구(베지어 패스, 표준/자유곡선 모드, Alt+앵커로 코너↔곡선 전환) + Paths 팔레트(패스→선택/채우기/획), 벡터 텍스트 레이어(재편집 가능) + Character 팔레트, 셰이프 레이어(재편집 가능) + 벡터 마스크
- **그리기 도구**: 브러시(팁 5종 — 둥근·사각·스패터·분필·캘리그래피, 경도·불투명도) + 브러시 동역학 팔레트(Shape/Scatter/Color/Dual Dynamics, Texture/Noise 강도 변조), 연필, 지우개, 페인트 버킷(허용오차), 그라디언트(선형/방사형/각도/반사/다이아몬드 5종), 스포이드, 이동
- **도형**: 사각형 / 타원 / 직선 / 정다각형(변 수 3~12) / 둥근 사각형 (채우기·외곽선·선 두께, Shift로 정형)
- **텍스트**: 클릭 입력(한글 IME 지원), 글꼴·크기·굵게·기울임, 확정 후 재클릭으로 재편집
- **선택**: 사각형/타원/단일 행·열 선택, 올가미, 매직완드, 색상 범위·확대(Grow)·유사 영역, 선택 반전/페더/Modify(확장·축소·테두리·둥글리기), 선택 저장/불러오기, 선택 윤곽(Stroke), Quick Mask 모드(Q)
- **리터칭·페인팅 도구**: 복제 도장(Clone Stamp) · 복구 브러시(Healing) · 패치(Patch) · 닷지/번/스펀지 · 흐리게/선명/번짐(Blur/Sharpen/Smudge) · History Brush · Art History Brush · Pattern Stamp
- **변형**: 자유 변형(Free Transform — Scale/Rotate/Skew/Distort/Perspective), 이미지 크기, 캔버스 크기, 90°/180° 회전, 좌우/상하 뒤집기, 선택 영역으로 자르기
- **색보정**: 레벨(채널 RGB/빨강/녹색/파랑/알파 + 히스토그램), 커브(채널별 톤 곡선 편집), 밝기/대비, 색조/채도, 색상 균형, 채널 혼합(Channel Mixer), 그라디언트 맵, 한계값(Threshold), 포스터화, 균일화(Equalize), 자동 레벨, 흑백, 색 반전 (실시간 미리보기)
- **채널·알파**: 레벨·커브를 R/G/B/알파 채널별로 개별 적용, 채널 팔레트(R/G/B/A 보기·채널→선택), 불투명(알파) 영역을 선택으로 변환
- **필터**: 가우시안 블러, 샤픈, 언샤프 마스크, 모션 블러, 미디언, 하이 패스, 모자이크, 엣지 찾기, 노이즈 추가, 세피아, 엠보스, 픽셀 유동화(Liquify — 밀기/오목/볼록/소용돌이), 패턴 메이커
- **이미지 모드**: 회색조 / 인덱스 색상(median-cut 양자화+디더) / 비트맵(1bit) / RGB 복귀 변환 + Color Table
- **자동화**: Actions(작업 녹화·재생) 팔레트, Tool Presets(도구 옵션 저장/적용) 팔레트
- **정보·주석 도구**: Color Sampler(최대 4 샘플), Measure(거리·각도), Notes(메모 마커)
- **파일**: 이미지 열기(파일 선택·드래그앤드롭·클립보드 붙여넣기), PNG/JPG 저장, 웹용으로 저장(Save for Web — 포맷/품질/미리보기), File Browser(IndexedDB 최근 이미지 자동저장·재열기)
- **보기**: 눈금자(Ctrl+R) / 그리드 / 가이드, 줌(5%~3200%)/팬, 줌 도구(클릭 확대·Alt+클릭 축소·드래그 영역 줌)
- **팔레트/패널**: Swatches·History(작업 내역)·Channels·Paths·Character·Shape·Brushes·Actions·Tool Presets·Layer Styles·File Browser 등 다수 패널을 도킹/플로팅 배치, localStorage 영속
- **편집**: 실행 취소/다시 실행(Command 패턴, 최대 50단계/256MB 상한)

---

## 단축키

### 도구

| 도구 | 키 | | 도구 | 키 |
|---|---|---|---|---|
| 이동 | V | | 펜 | P |
| 사각형 선택 | M | | 복제 도장 | S |
| 올가미 | L | | 복구 브러시 | K |
| 매직완드 | W | | 패치 | C |
| 브러시 | B | | 히스토리 브러시 | J |
| 연필 | N | | 아트 히스토리 브러시 | F |
| 지우개 | E | | 패턴 스탬프 | Y |
| 페인트 버킷/그라디언트 | G (순환) | | 닷지/번/스펀지 | O |
| 스포이드/색상 샘플러/측정 | I (순환) | | 흐리게/선명/번짐 | R |
| 도형 | U | | 셰이프 레이어 | A |
| 텍스트 | T | | 퀵 마스크 전환 | Q |
| 손(팬) | H / 스페이스 | | 돋보기(줌) | Z |

- `G` 키는 페인트 버킷 ↔ 그라디언트를 눌러 반복할 때마다 순환합니다.
- `I` 키는 스포이드 → 색상 샘플러 → 측정 도구 순서로 순환합니다(누를 때마다 다음 도구로 전환).
- Notes(주석) 도구는 전용 단축키가 없고 툴바 버튼으로만 선택합니다(단축키 슬롯 전량 점유로 인한 의도적 설계).

### 편집 · 보기

| 동작 | 키 | | 동작 | 키 |
|---|---|---|---|---|
| 실행 취소 | Ctrl+Z | | 다시 실행 | Ctrl+Shift+Z |
| 새 문서 | Ctrl+N | | 열기 | Ctrl+O |
| PNG 저장 | Ctrl+S | | 복사 / 붙여넣기 | Ctrl+C / Ctrl+V |
| 모두 선택 | Ctrl+A | | 선택 해제 | Ctrl+D |
| 선택 반전 | Shift+Ctrl+I | | 페더 | Alt+Ctrl+D |
| 선택 영역 삭제 | Delete | | 보이는 레이어 병합 | Shift+Ctrl+E |
| 아래로 병합 | Ctrl+E | | 이전 레이어와 클리핑 | Ctrl+G |
| 자유 변형 | Ctrl+T | | 눈금자 | Ctrl+R |
| 화면 맞춤 | Ctrl+0 | | 실제 크기 | Ctrl+1 |
| 확대 / 축소 | Ctrl+`+` / Ctrl+`-`, 마우스 휠 | | | |

- 브러시 크기: `[` `]` · 전경/배경 교환: `X` · 기본 흑백: `D`
- 자유 변형 중: `Enter` 확정 · `Esc` 취소

---

## 기술 메모 (개발자용)

- **빌드 불필요**: `<script type="module">`로 ES 모듈을 직접 로드. MV3 CSP(`script-src 'self'`)에 그대로 부합
- **CSP 준수**: `eval`/`new Function`/인라인 스크립트/외부 CDN 전혀 사용하지 않음
- **아키텍처**: EventBus(pub-sub) + AppState(단일 상태) 중심의 단방향 의존. 렌더는 `requestAnimationFrame` + dirty 플래그
- **레이어**: 레이어 1장 = 분리된 `<canvas>` 1장(+ 선택적 마스크 캔버스). 표시 캔버스에 순서대로 블렌드 모드 합성
- **Undo/Redo**: 픽셀 편집은 변경 영역(bbox)의 before/after만 저장, 구조 변경은 경량 커맨드
- **필터·보정 엔진**: StackBlur(가우시안 근사), 스캔라인 flood fill, 256-LUT 색보정, W3C Compositing & Blending 블렌드식 — 모두 DOM 무관 순수 함수

### 폴더 구조

```
canvas-photo-editor/
├─ manifest.json        # MV3 매니페스트
├─ background.js        # 서비스 워커 (아이콘 클릭 → 새 탭)
├─ editor.html          # 단일 페이지 셸
├─ css/style.css
├─ icons/
├─ docs/                # 기능명세서·구현 체크리스트·사용자 매뉴얼
└─ js/
   ├─ app.js            # 진입점·조립·전역 단축키·고수준 액션
   ├─ core/             # event-bus, state, constants
   ├─ layers/           # layer, layer-manager, layer-styles, adjustment-layer, shape-layer, vector-mask
   ├─ render/           # viewport, renderer
   ├─ history/          # command-manager, commands/
   ├─ tools/            # 도구(브러시·선택·리터칭·펜·측정 등 20종+) + tool-manager
   ├─ selection/         # selection-manager, quick-mask
   ├─ engine/           # color, floodfill, blur, adjustments, filters, blend, image-mode, brush-dynamics, patterns 등
   ├─ paths/            # 펜 패스 관리
   ├─ patterns/         # Pattern Maker
   ├─ presets/          # Tool Presets
   ├─ styles/           # Layer Styles 프리셋·패턴
   ├─ text/             # 벡터 텍스트 레이어
   ├─ notes/            # Notes 주석 관리
   ├─ io/               # file-io, clipboard
   └─ ui/               # toolbar, options-bar, menu-bar, dialogs, 각종 팔레트(layers/channels/paths/history/swatches/styles/brushes/actions/tool-presets/file-browser 등), 패널 도킹/플로팅
```

## 개인정보

외부 네트워크 호출·텔레메트리는 전혀 없습니다(코드 전수 grep 결과, `fetch`/`XMLHttpRequest`/`WebSocket` 사용 0건). 이미지·설정·팔레트 프리셋 등 모든 데이터는 브라우저 로컬(localStorage/IndexedDB)에만 저장되며 외부로 전송되지 않습니다.

라이선스: 자유 사용. 참고 오픈소스(패턴 참조): miniPaint(MIT), StackBlur.
