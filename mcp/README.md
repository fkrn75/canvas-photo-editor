# Canvas Photo Editor MCP 서버

AI(Claude Code·Claude Desktop 등 MCP 클라이언트)가 에디터를 직접 조작할 수 있게 하는 MCP 서버입니다.
외부 의존성 없이 Node 18+ 내장 모듈만 사용합니다.

```
AI 클라이언트 ──stdio(MCP)──▶ mcp/server.mjs ──HTTP 롱폴링 127.0.0.1:8131──▶ 에디터 탭(js/io/mcp-bridge.js)
```

에디터 탭이 서버를 폴링해 명령을 받아 실행하는 구조라, 크롬 확장으로 연 에디터와 로컬 정적 서버로 연 에디터 모두 동작합니다.

## 연결 방법

1. **MCP 서버 등록** (한 번만)
   - Claude Code:
     ```bash
     claude mcp add canvas-photo-editor --scope user -- node <저장소 경로>/mcp/server.mjs
     ```
   - Claude Desktop 등 JSON 설정을 쓰는 클라이언트:
     ```json
     { "mcpServers": { "canvas-photo-editor": { "command": "node", "args": ["<저장소 경로>/mcp/server.mjs"] } } }
     ```
   - 등록 후에는 클라이언트를 재시작해야 도구가 나타납니다.
2. **에디터에서 연결 켜기**: 메뉴 **[도움말 > AI 연결(MCP) 켜기/끄기]**. 확장으로 열었다면 처음 켤 때 `127.0.0.1` 접근 권한을 묻습니다.
   - 상태바 오른쪽 끝에 `AI 대기 중`(노랑)은 서버를 기다리는 상태, `AI 연결됨`(초록)은 연결된 상태입니다. 상태 표시를 클릭해도 켜고 끌 수 있습니다.
   - 켠 상태는 저장되어 다음에 열 때도 유지됩니다. URL에 `?mcp=1`을 붙이면 저장 없이 이번만 켭니다.
3. AI에게 요청합니다. 예: "에디터에 800×600 새 문서 만들고 하늘색 그라디언트 배경에 노란 별 셰이프 레이어 올려줘. 결과 보여줘."

## 도구 (21개)

| 분류 | 도구 |
|---|---|
| 상태·확인 | `bridge_status`, `get_state`, `get_image`(미리보기 이미지) |
| 파일 | `new_document`, `open_image`(로컬 경로), `export_image`(로컬 경로에 PNG/JPG 저장) |
| 레이어 | `layer_add`, `layer_update`(이름·불투명도·표시·블렌드), `layer_op`(선택·삭제·복제·순서·병합·평탄화), `set_layer_style`(드롭섀도 등 10종), `add_adjustment_layer` |
| 선택 | `select`(사각형·타원·다각형·전체·해제·반전·불투명 영역, 페더·확장·축소) |
| 그리기 | `fill`(단색·그라디언트), `draw_shape`, `draw_stroke`(브러시/지우개), `add_text`(벡터 텍스트 레이어), `add_shape_layer`(벡터 셰이프 레이어) |
| 보정·필터 | `apply_filter`(21종: 흑백·레벨·색조/채도·블러·언샤프 마스크·모자이크 등) |
| 문서 | `transform`(회전·뒤집기·자르기·크기 변경), `set_colors`, `history`(undo/redo) |

모든 편집은 에디터의 실행 취소 기록에 들어가므로 사람이 Ctrl+Z로 되돌릴 수 있습니다.
좌표는 문서 픽셀 좌표(왼쪽 위 0,0)이고, 선택 영역이 있으면 그리기·필터는 그 안에만 적용됩니다.

## 설정

| 항목 | 기본값 | 변경 |
|---|---|---|
| 포트 | `8131` | 서버: 환경변수 `CPE_MCP_PORT` / 에디터: `?mcp=<포트>` 또는 localStorage `cpe.mcp.port` |

Windows는 Hyper-V/WinNAT가 포트 범위를 예약하는 경우가 있습니다. 서버가 `EACCES`로 열리지 않으면
`netsh interface ipv4 show excludedportrange protocol=tcp`로 예약 범위를 확인하고 바깥 포트를 쓰세요.

## 보안·개인정보

- 서버는 `127.0.0.1`에만 바인딩합니다(외부 네트워크에서 접근 불가).
- HTTP 브리지는 `chrome-extension://`, `http://localhost`, `http://127.0.0.1` origin만 허용합니다. 일반 웹사이트가 브리지에 붙지 못합니다.
- 에디터는 AI 연결을 켰을 때만 통신합니다. 꺼져 있으면 네트워크 호출이 없습니다.
- `open_image`·`export_image`의 파일 읽기/쓰기는 MCP 서버(로컬 Node 프로세스) 권한으로 수행됩니다.

## 한계

- 서버 하나에 에디터 탭 하나를 기준으로 합니다. 여러 탭을 켜면 먼저 폴링한 탭이 명령을 받습니다.
- MCP 클라이언트 세션 두 개가 동시에 서버를 띄우면 두 번째 서버는 포트 충돌로 브리지를 열지 못합니다(도구가 이유를 알려 줍니다).
- 다이얼로그가 필요한 기능(유동화·패턴 메이커·커브 편집 UI 등)은 도구로 노출하지 않았습니다.

## 테스트

`npm test`에 서버 프로토콜 테스트(`tests/mcp-server.test.js`)가 포함되어 있습니다. 초기화·도구 목록·미연결 오류·origin 차단·가짜 에디터 왕복을 검증하며, 도구 정의와 브리지 핸들러가 1:1로 대응하는지도 확인합니다.
