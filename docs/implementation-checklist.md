# canvas-photo-editor 구현 체크리스트

> [photoshop7-feature-spec.md](photoshop7-feature-spec.md) 기준, **실제 코드 인벤토리**(2026-06-14, 파일:라인 근거)로 작성한 구현 체크리스트.
> `[x]` = 구현 완료 / `[ ]` = 미구현(할 일) / `◐` = 부분구현(보강 필요).
> 우선순위: 🟢핵심 · 🟡중급 · 🟠고급 · 🔴제외(웹/Canvas 비현실).

---

## 📊 현황 대시보드

| 단계 | 완료 | 부분 | 미구현 |
|---|---|---|---|
| 🟢 핵심(MVP) | 대부분 ✅ | Marquee/Shape/Text | Gradient, 줌도구 |
| 🟡 중급 | **iteration 1 완료(블렌드·보정·필터·선택)** | — | 마스크·Gradient 등 |
| 🟠 고급 | — | — | 20개+ 항목 |
| 🔴 제외 | — | — | (의도적 스킵) |

## ✅ iteration 1 완료 (2026-06-14, 팀 오케스트라 4워커 병렬 + 브라우저 검증)

> 전부 실제 브라우저(8124) 런타임 검증 통과 — 콘솔 에러 0, 픽셀 단위 정확성·다이얼로그 오픈 확인.

- [x] **블렌드 모드 22종** — 네이티브 16(`globalCompositeOperation`) + 커스텀 6(dissolve/linear-burn/linear-dodge/vivid-light/linear-light/pin-light), 레이어 패널 드롭다운(27항목), `setBlendMode` undo, 복제/Merge Down/flatten 블렌드 인식 *(검증: multiply `[128,0,0]`, linear-dodge `[255,128,128]`, pin-light `[255,1,1]`)*
- [x] **보이는 레이어 병합 (Merge Visible, Shift+Ctrl+E)**
- [x] **보정 6종** — Color Balance / Threshold / Posterize / Gradient Map / Equalize / **Channel Mixer UI**(엔진 기존, UI 신규). 전부 실시간 미리보기 + undo *(검증: threshold 200→255·50→0, 다이얼로그 10종 오픈 무에러)*
- [x] **필터 6종** — Unsharp Mask / Motion Blur / Median / Mosaic / Find Edges / High Pass *(검증: findEdges end-to-end 픽셀 변화, 전 필터 실행 무에러)*
- [x] **선택 연산** — 선택 반전(Shift+Ctrl+I) / 페더(Alt+Ctrl+D) / Modify(확장·축소·테두리·둥글리기) *(검증: 반전 in/out 토글, 페더 graded alpha `[252,51,163]`)*

## ✅ iteration 2 완료 (2026-06-14, 팀 오케스트라 4워커 병렬 + 브라우저 검증)

> 전부 브라우저(8124) 런타임 검증 — 콘솔 에러 0.

- [x] **레이어 마스크** — 그레이스케일 마스크, 추가/삭제/사용토글, 마스크 페인팅, 블렌드와 정합 *(검증: 마스크 검정→alpha 0·흰→255)*
- [x] **클리핑 마스크** (이전 레이어와 클리핑, Ctrl+G)
- [x] **레이어 Lock**(투명/이미지/위치) + **Fill Opacity**(별도 슬라이더)
- [x] **Gradient 도구** — 선형/방사형/각도/반사/다이아몬드 5종, 전경→배경·전경→투명, Reverse/Opacity, Shift 45°, 선택 클립(페더 반영) *(검증: 흑→백 21→248)* · G 슬롯 버킷↔그라디언트 순환
- [x] **고급 선택** — 색상 범위(스포이드+허용치) / 확대(Grow) / 유사 영역(Similar) / 선택 저장·불러오기 *(검증: fromColorMatch mask 생성)*
- [x] **눈금자(Ctrl+R) / 그리드 / 가이드**(표시·새 가이드·지우기) *(검증: 토글·렌더 무에러)*

### iteration 3 완료 (🟡 중급 + 🟢 잔여 종료) — 전부 8124 런타임 검증, 콘솔 에러 0

- [x] **Marquee 확장**: 타원 · 단일 행 · 단일 열 (옵션바 모양 선택) *(검증: 타원 중심255·모서리0, 행/열 on255·off0)*
- [x] **Shape 확장**: 정다각형(변 수 3~12) · 둥근 사각형(모서리 반경) *(검증: polygon 빨강 채움, rounded 중심 파랑·둥근 모서리 비움)*
- [x] **Zoom 도구 분리**(Z): 클릭 확대 · Alt+클릭 축소 · 드래그 영역 줌 *(검증: 0.235→0.294 / →0.188)*
- [x] **Stroke**(선택 윤곽): 폭/색/위치(안쪽·가운데·바깥쪽), 히스토리 연동 *(검증: 테두리 마스크 bounds 정확)*
- [x] **Quick Mask 모드**(Q): 빨강 반투명 오버레이 페인팅 ↔ 선택 환원 *(검증: 토글 enter/exit, 오버레이 800×600)*
- [x] **Save for Web**: PNG/JPEG·품질 슬라이더·미리보기·예상 용량·다운로드 *(검증: 모달 컨트롤 정상)*
- [x] **Swatches 팔레트**: 기본 14견본 + 현재색 추가/우클릭 삭제/초기화, 클릭=전경색, localStorage 영속 *(검증: 클릭→#000/#f00, 강조)*

**🟡 중급 전체 완료.**

### iteration 4 완료 (🟠 고급 1차) — 전부 8124 런타임 검증, 콘솔 에러 0

- [x] **리터칭 도구**: 복제 도장(S) · 닷지/번/스펀지(O) · 흐리게/선명/번짐(R) *(검증: dodge 128→223·burn→32·sponge 무채색·blur 경계혼합·smudge 끌림·clone 복제)*
- [x] **자유 변형(Free Transform, Ctrl+T)**: 8핸들 Scale/Rotate/Skew/Distort/Perspective, Enter 확정·Esc 취소 *(검증: start→active·commit→해제, 19/19 단위 + 통합 무에러)*
- [x] **레이어 스타일**: Drop Shadow / Outer Glow / Stroke(안·가운데·바깥) / Color Overlay, 비파괴 합성 + fx 버튼/다이얼로그 *(검증: 4효과 픽셀 정확)*
- [x] **히스토리 팔레트**(작업 내역): 스텝 클릭 점프 + 스냅샷 *(검증: 스텝 렌더·무한루프 없음)*

### iteration 5 완료 (🟠 고급 2차) — 전부 8124 런타임 검증, 콘솔 에러 0

- [x] **Pen 도구 + 베지어 패스 + Paths 팔레트**(P): 앵커/제어핸들, 패스→선택/채우기/획 *(검증: 4앵커→선택 bounds[50,50,100,100])*
- [x] **조정 레이어**(비파괴): 밝기대비·색조채도·레벨·포스터화·한계값·반전·흑백, opacity/마스크 강도 *(검증: b=80→255·b=20→115 비례, 2레이어 비파괴)*
- [x] **채널 팔레트**: R/G/B/A 채널 보기·채널→선택 *(검증: R채널→선택 active 800×600)*
- [x] **History Brush(J)**: 스냅샷 소스 복원 / **Pattern Stamp(Y)**: 패턴 타일 *(검증: 체커 Δ62, HB 전환)*

### iteration 6 완료 (🟠 고급 잔여 완결) — 전부 8124 런타임 검증, 콘솔 에러 0

- [x] **벡터 텍스트 레이어(재편집)** + Character 팔레트(V): 텍스트 데이터 보존, T 다시 클릭 재편집(TextToolV 교체) *(검증: "가나다"→재편집→"라마바사")*
- [x] **셰이프 레이어**(V, 단축키 A): 채움+벡터윤곽(사각/타원/다각형/둥근사각) 재편집, 셰이프 패널 *(검증: 드래그 생성+vectorShape 보존+초록 채움)*
- [x] **벡터 마스크**(V): 펜 패스→그레이스케일 마스크 클립(비파괴)·편집·삭제
- [x] **복구 브러시(Healing, K) / 패치(Patch, C)**(H): 질감유지 톤매칭 블렌드 / 선택영역 드래그 치환
- [x] **픽셀 유동화(Liquify)**(H): 모달 밀기/오목/볼록/소용돌이 워핑
- [x] **Pattern Maker / Actions(매크로)**(A): 타일 패턴 생성·저장 / 작업 녹화·재생 팔레트
- [x] **이미지 모드 변환**(I): 회색조·인덱스(median-cut+디더)·비트맵(1bit)·RGB복귀 + Color Table *(검증: 회색[76,76,76]·인덱스순색·비트맵1bit)*

**🟠 고급 잔여 완결(v0.6.0).**

### iteration 7 완료 (🟠 후속 선택기능, v0.7.0) — 전부 8124 런타임 검증, 콘솔 에러 0

- [x] **레이어 스타일 확장**(S): 기존 4종→10종(Inner Shadow/Glow · Bevel/Emboss · Satin · Gradient/Pattern Overlay) + Styles 팔레트(프리셋 9종 · 절차적 패턴 6종 · localStorage) *(검증: 프리셋 9개 적용·layer.styles 설정)*
- [x] **브러시 동역학 팔레트**(B): Shape/Scatter/Color/Dual Dynamics(OFF·연필·지우개 회귀0) + **Art History Brush(F)**
- [x] **Freeform/Convert Point 펜**(P): 펜 모드 토글(표준/자유곡선), Alt+앵커 코너↔곡선
- [x] **레벨/커브 조정 레이어**(P): 채널별 레벨/커브 비파괴 조정레이어 + 전용 에디터 *(검증: curves/levels 레이어 생성+복합UI 다이얼로그)*
- [x] **Tool Presets 팔레트**(T): 도구 옵션 저장/적용(localStorage) *(검증: 브러시 프리셋 4종 적용)*. File Browser는 MV3 제약상 보류

**남은 후속(선택, 미착수)**: 추가 브러시 동역학 세부(Texture/Noise) · Notes/Color Sampler · Measure 도구 · File Browser(IndexedDB). CMYK·16bit·ICC·인쇄·ImageReady 등은 🔴 제외 유지.

> ⚠️ 알려진 한계(후속): 이미지 크기/자르기/회전/뒤집기 시 레이어 마스크가 함께 변형되지 않음(캔버스 크기 변경은 동기화됨). 🟠 진입 전/후속 iteration에서 app.js 변형부에 마스크 동반 처리 예정.

---

## ✅ 이미 구현됨 (재작업 금지 — 보강만)

### 도구
- [x] Move(이동) · Lasso(올가미) · Magic Wand(마술봉) · Brush(5종: round/square/spatter/chalk/calligraphy) · Pencil · Eraser · Bucket(페인트통) · Eyedropper(스포이드) · Hand(손)
- [x] 전경/배경색 스와치, 교환(X)/기본값(D), 네이티브 컬러피커
- [x] 줌(휠·Ctrl+/-·Ctrl+0·Ctrl+1) / 팬(Space·중간버튼)

### 레이어
- [x] 추가 / 삭제 / 복제 / 순서이동 / Merge Down / Flatten / Opacity / 표시토글 / 이름변경 / 썸네일

### 선택
- [x] All(Ctrl+A) / Deselect(Ctrl+D) / 불투명영역 선택 / 선택삭제 / 선택채우기 / 마칭앤츠

### 보정 (채널별 R/G/B/Alpha 지원이 강점)
- [x] 밝기·대비 / 색조·채도 / 흑백 / 색반전 / 자동레벨 / **레벨(채널별+히스토그램)** / **커브(채널별, Catmull-Rom)**

### 필터
- [x] 가우시안 블러(StackBlur) / 샤픈 / 노이즈 추가 / 세피아 / 엠보스

### 변형 · IO · 히스토리
- [x] 이미지 크기 / 캔버스 크기 / Crop(선택영역) / 회전 90°·180° / 뒤집기 H·V
- [x] 열기(드래그&드롭 포함) / PNG·JPG 저장 / 클립보드 복사·붙여넣기
- [x] Undo·Redo(Command 패턴, 256MB/50스텝 상한) + 취소/다시실행 버튼

---

## 🟢 핵심(MVP) — 부분구현 보강

- [x] **Marquee 확장**: 타원형 · 단일 행 · 단일 열 추가 `js/tools/marquee-tool.js` *(iter3 완료)*
- [x] **Shape 확장**: 다각형(Polygon) · 둥근 사각형 `js/tools/shape-tool.js` *(iter3 완료; 커스텀 셰이프는 🟠)*
- [x] **Zoom 도구**: 툴박스 분리(`TOOL.ZOOM` 등록 + Z 단축키) *(iter3 완료)*
- [ ] **Text 보강**: 확정 후 재편집(현재 래스터 확정 후 수정 불가) → 텍스트 레이어 데이터 보존

---

## 🟡 중급 — "그림판 → 진짜 포토샵 클론" 핵심 (16)

### 레이어 합성
- [ ] **블렌드 모드 24종** ⭐최우선
  - [ ] `js/layers/layer.js`에 `blendMode` 속성 추가
  - [ ] `js/layers/layer-manager.js:134` `compositeTo()`에 `ctx.globalCompositeOperation = ...` 적용 (현재 없음 → Normal만 동작)
  - [ ] 네이티브 16종 매핑: multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion/hue/saturation/color/luminosity(+normal)
  - [ ] per-pixel 커스텀 8종: Dissolve, Behind(`destination-over`), Clear(`destination-out`), **Linear Burn**, **Linear Dodge**(`lighter` 근사), **Vivid Light**, **Linear Light**, **Pin Light**
  - [ ] `js/ui/layers-panel.js`에 블렌드 모드 드롭다운 UI + `LayerPropCommand` undo 연동
- [ ] **레이어 마스크** ⭐
  - [ ] `js/layers/layer.js`에 마스크 캔버스 속성
  - [ ] `compositeTo()`에서 마스크 알파 적용
  - [ ] layers-panel 마스크 썸네일 + 추가/삭제/활성화, 마스크에 브러시 페인팅
- [ ] **클리핑 마스크** (Group with Previous, Ctrl+G) — 아래 레이어 알파로 클립
- [ ] **Merge Visible**(Shift+Ctrl+E) `js/layers/layer-manager.js`(현재 Merge Down만)
- [ ] **레이어 Lock**: 투명/이미지/위치 잠금 + **Fill Opacity**(opacity와 분리)

### 도구
- [ ] **Gradient 도구** ⭐: `js/tools/gradient-tool.js` 신설, `TOOL.GRADIENT` 추가
  - [ ] Linear/Radial(+ Angle/Reflected/Diamond), 전경→배경/전경→투명, Reverse/Dither, 옵션바
- [x] **Stroke**(선택영역 외곽선 그리기) — Edit 메뉴 *(iter3 완료)*

### 선택
- [ ] **Inverse**(Shift+Ctrl+I) — ⚠️ 미구현 (명세서엔 오기였음)
- [ ] **Feather**(Alt+Ctrl+D) — 선택 가장자리 흐리기
- [ ] **Modify**: Border / Smooth / Expand / Contract
- [ ] **Grow / Similar** (인접·전체 유사색)
- [ ] **Color Range**(색상 기준 선택)
- [ ] **Save/Load Selection**(알파 채널 ↔ 선택)
- [x] **Quick Mask 모드**(Q) *(iter3 완료)*

### 보정 (메뉴 연결)
- [ ] **Channel Mixer UI** — 엔진(`adjustments.channelMixer`) 이미 완성, **다이얼로그만 연결**하면 됨 (가성비 최고)
- [ ] Color Balance(Ctrl+B) / Threshold / Posterize / Gradient Map / Equalize

### 필터
- [ ] Unsharp Mask(다이얼로그) / Motion Blur / Median / Dust & Scratches
- [ ] Pixelate(Mosaic/Crystallize/Color Halftone) / Stylize(Find Edges/Solarize/Diffuse)
- [ ] Other(High Pass / **Custom 컨볼루션 커널**) / Invert는 보정에 있음

### 기타
- [ ] **눈금자/가이드/그리드** (`state.pixelGrid` 필드만 존재, 렌더러 미사용)
- [x] **Save for Web** 다이얼로그(포맷/품질/미리보기) *(iter3 완료)*
- [x] **Swatches 팔레트** 확장(견본 추가/삭제/초기화·localStorage) *(iter3 완료)*

---

## 🟠 고급 — 전문 기능 (장기, 20+)

### 벡터 · 타이포
- [x] **Pen 도구 + 패스**(베지어): Pen + Add·Delete Anchor + Paths 팔레트(선택/채우기/획) *(iter5)*. (Freeform/Convert Point는 후속)
- [ ] **Vector Mask / 셰이프 레이어**
- [ ] **벡터 텍스트 레이어**(재편집 가능) + **Character/Paragraph 팔레트** + Warp Text + 안티앨리어스 모드

### 레이어 고급
- [◐] **레이어 스타일**: Drop Shadow / Outer Glow / Stroke / Color Overlay 구현 *(iter4)*. (Inner Shadow/Glow · Bevel/Emboss · Satin · Gradient/Pattern Overlay · Styles 팔레트는 후속)
- [x] **조정 레이어**(비파괴 보정 + 마스크) *(iter5: 밝기대비·색조채도·레벨·포스터화·한계값·반전·흑백)*
- [x] **채널 팔레트** UI(채널별 LUT 엔진은 이미 존재) *(iter5: R/G/B/A 보기·채널→선택)*

### 히스토리
- [x] **히스토리 팔레트**(단계 목록 클릭 이동) + **스냅샷** *(iter4)* + Step Forward/Backward UI

### 리터칭 · 페인팅 도구
- [ ] Healing Brush / Patch (7.0 간판 기능)
- [x] Clone Stamp *(iter4)* / Pattern Stamp *(iter5)*
- [◐] History Brush *(iter5)* / Art History Brush(후속)
- [x] Dodge / Burn / Sponge *(iter4)*
- [x] Blur / Sharpen / Smudge (도구형) *(iter4)*

### 변형 · 자르기
- [x] **Free Transform**(핸들 UI): Scale / Rotate / Skew / Distort / Perspective *(iter4)*
- [ ] Crop 도구(드래그 핸들·Shield) / Trim / Reveal All

### 필터 · 자동화
- [ ] 예술계열 필터: Artistic(15) / Sketch(14) / Brush Strokes(8) / Texture(6) / Distort(12)
- [ ] Render: Lens Flare / Lighting Effects / Clouds
- [ ] **Liquify** / **Pattern Maker**(7.0 신기능)
- [ ] **Actions(매크로)** 녹화·재생 + Batch

### 7.0 신기능 · 모드
- [ ] File Browser / Tool Presets 팔레트
- [ ] Brushes 팔레트 풀(Scatter/Texture/Dual/Color Dynamics) — 현재 크기/경도/타입만
- [ ] 이미지 모드: Grayscale/Indexed Color/Bitmap 변환 + Color Table
- [ ] Notes/Audio Annotation, Measure/Color Sampler 도구

---

## 🔴 제외 — 웹/Canvas 비현실 (의도적 스킵)

> Canvas `ImageData`는 8비트 RGBA 고정. 인쇄·정밀 색관리·외부 연동은 브라우저 환경 밖.

- [ ] ~~CMYK / Lab / Duotone / Multichannel / 16비트 모드~~
- [ ] ~~ICC 색관리·Color Settings·Proof Colors·Gamut Warning~~
- [ ] ~~인쇄: Print / Print with Preview / Page Setup / Trap~~
- [ ] ~~ImageReady: Rollover / Animation / Image Map / Slice~~
- [ ] ~~WebDAV(Manage Workflow) / TWAIN 스캐너 / Digimarc 워터마크~~
- [ ] ~~PDF Import·Export / Multi-Page PDF / 플러그인 SDK / Jump To~~
- [ ] ~~PSD 네이티브 포맷 저장~~ (선택적: 단순 레이어 직렬화는 🟠 가능)

---

## 🚀 추천 작업 순서

| 스프린트 | 항목 | 이유 |
|---|---|---|
| **1** | 블렌드 모드 24종 | 단일 함수(`compositeTo`) 수정으로 임팩트 최대. 포토샵 정체성 |
| **1** | Channel Mixer UI 연결 | 엔진 완성됨 — UI만, 가성비 최고 |
| **2** | 레이어 마스크 → 클리핑 마스크 | 비파괴 합성의 토대 |
| **2** | 선택 Inverse/Feather/Modify | 선택 워크플로 완성(저비용·고빈도) |
| **3** | Gradient 도구 + Stroke | 그리기 도구 공백 메우기 |
| **3** | 보정 확장(Color Balance/Threshold/Posterize/Gradient Map) | 패턴 동일, 빠른 추가 |
| **4** | Free Transform(핸들) | UX 큰 향상, 구현 난이도 중상 |
| **5+** | 레이어 스타일 / 패스(Pen) / 히스토리 팔레트 | 고급, 독립적으로 진행 |

---

*기준 문서: [photoshop7-feature-spec.md](photoshop7-feature-spec.md) · 코드 인벤토리: 2026-06-14 · 대상: canvas-photo-editor v0.1.0*
