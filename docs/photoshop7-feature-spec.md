# Adobe Photoshop 7.0 기능명세서 (전수)

> **목적** — 본 문서는 Adobe Photoshop 7.0(2002년 3월 출시)의 **모든 기능을 전수 정리한 기능명세서**다.
> 동시에, 이 프로젝트(`canvas-photo-editor`, Canvas 기반 크롬 확장 Photoshop 클론)의 구현 로드맵으로 쓰도록
> 각 기능에 **웹/Canvas 구현 우선순위**와 **현재 구현 여부**를 병기했다.
>
> **작성 근거** — `/deep-research` 하니스(에이전트 103개, 출처 21건, 주장 25건 적대적 검증)로 1차 출처를 확보하고,
> Adobe 공식 1차 문서(Quick Reference Card, Reviewer's Guide)와 공식 User Guide를 직접 대조해 항목을 확정했다.
> 자세한 출처·검증 내역은 문서 끝 [§13 출처 및 검증](#13-출처-및-검증) 참조.

---

## 0. 문서 정보 · 범례

### 0.1 검증 등급 (근거 강도)

| 표기 | 의미 |
|---|---|
| **✔** | Adobe 1차 문서(QRC/Reviewer's Guide) 또는 deep-research 교차검증으로 **축자 확인됨** |
| **○** | PS7 표준 지식 — 공식 User Guide 해당 챕터에 포함이 확인되었고, 항목 명칭/경로는 일반적으로 통용되는 PS7 지식 기반 |

> deep-research가 정직하게 남긴 한계: 공식 User Guide의 *존재·진본·챕터 구조·신기능*은 high 신뢰로 확정되나,
> "모든 메뉴 하위 명령의 축자 완전성"까지는 1라운드로 입증되지 않았다. 따라서 메뉴 하위 명령 표는 ○ 등급으로 두되,
> 도구/단축키/블렌드 모드/팔레트/신기능 등 **QRC에서 직접 읽어 확인된 항목은 ✔** 로 표시했다.

### 0.2 Canvas 구현 우선순위 범례

| 표기 | 뜻 | 기준 |
|---|---|---|
| 🟢 **핵심** | 포토샵의 정체성, 클론 필수. Canvas 2D로 쉬움~보통 | 그리기/선택/레이어/기본 보정 |
| 🟡 **중급** | 가치 높음. 구현 보통~다소 복잡 | 블렌드 모드 전체·레이어 스타일·다수 필터 |
| 🟠 **고급** | 복잡/전문. 선택적 구현 | 패스(베지어)·타이포 엔진·CMYK·Liquify |
| 🔴 **비현실** | 웹/Canvas에 부적합하거나 PS7 특수 환경 의존 | 인쇄 분판·ICC 정밀 색관리·플러그인 SDK·WebDAV |
| ✅ | **현재 `canvas-photo-editor`에 이미 구현됨** | 2026-06 기준 |

### 0.3 플랫폼 표기
단축키는 **Windows**(Ctrl/Alt) 기준. macOS는 Ctrl→⌘, Alt→⌥.

---

## 1. 제품 개요 ✔

| 항목 | 내용 |
|---|---|
| 제품명 | Adobe Photoshop 7.0 (+ 번들 ImageReady 7.0) |
| 출시 | **2002년 3월** (코드네임 *Liquid Sky*) |
| 플랫폼 | Windows, Mac OS 9 / **Mac OS X 최초 지원** |
| 헤드라인 신기능 | Healing Brush, Patch, File Browser, Tool Presets, 새 Painting Engine(Brushes 팔레트 복원), Auto Color, 맞춤법 검사/텍스트 찾기·바꾸기, 완전 벡터 텍스트 |
| 공식 매뉴얼 | *Adobe Photoshop 7.0: User Guide* (Adobe Systems, 2002 / 인쇄본 약 441쪽, 스캔 462쪽, 디지털 PDF 549쪽) |
| 후속 | 7.0.1 유지보수 업데이트에서 **Camera Raw** 플러그인 추가 |

> ⚠️ 식별자 주의: ISBN 9780321115621은 별개 도서 *Classroom in a Book*의 것이다. User Guide 식별자는 **LCCN 2002512603 / OCLC 1023763675**.

---

## 2. 메뉴 전수 명세

> 9개 최상위 메뉴: **File / Edit / Image / Layer / Select / Filter / View / Window / Help**.
> 메뉴 *구조*는 User Guide 챕터로 확인(○), 도구·단축키는 QRC 축자(✔).

### 2.1 File 메뉴

| 명령 | 단축키(Win) | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| New… | Ctrl+N | 새 문서 생성(크기/해상도/모드/배경) | ○ | ✅ 🟢 |
| Open… | Ctrl+O | 파일 열기 | ○ | ✅ 🟢 |
| **Browse…** | **Shift+Ctrl+O** | **File Browser 열기 (7.0 신기능)** | ✔ | 🟡 |
| Open As… | Alt+Ctrl+O | 포맷 지정해 열기 | ○ | 🟡 |
| Open Recent ▸ | — | 최근 파일 목록 | ○ | 🟢 |
| Edit in ImageReady | Shift+Ctrl+M | ImageReady로 전환 | ✔ | 🔴 |
| Close | Ctrl+W | 문서 닫기 | ○ | ✅ 🟢 |
| Save | Ctrl+S | 저장 | ○ | ✅ 🟢 (PNG/내부포맷) |
| Save As… | Shift+Ctrl+S | 다른 이름/포맷 저장 | ○ | ✅ 🟢 |
| Save for Web… | Alt+Shift+Ctrl+S | 웹용 최적화 내보내기 | ○ | 🟡 |
| Revert | F12 | 마지막 저장본으로 되돌림 | ○ | 🟡 |
| Place… | — | 외부 파일(EPS/PDF/AI)을 스마트 배치 | ○ | 🟡 |
| Import ▸ | — | PDF Image / Annotations / WIA / TWAIN(스캐너) | ○ | 🟠 |
| Export ▸ | — | Paths to Illustrator / ZoomView | ○ | 🟠 |
| Manage Workflow ▸ | — | Check In/Out, Undo Check Out (WebDAV) | ○ | 🔴 |
| Automate ▸ | — | Batch, Create Droplet, Conditional Mode Change, Contact Sheet II, Fit Image, Multi-Page PDF to PSD, **Picture Package**, **Web Photo Gallery** | ○ | 🟠 |
| File Info… | — | 메타데이터(IPTC/EXIF) 편집 | ○ | 🟠 |
| Page Setup… | Shift+Ctrl+P | 인쇄 페이지 설정 | ○ | 🔴 |
| Print with Preview… | Ctrl+P | 미리보기 포함 인쇄(스케일/위치/색관리) | ○ | 🔴 |
| Print… | Alt+Ctrl+P | 인쇄 | ○ | 🔴 |
| Print One Copy | Alt+Shift+Ctrl+P | 한 장 즉시 인쇄 | ○ | 🔴 |
| Jump To ▸ | — | 외부 편집기로 전달 | ○ | 🔴 |
| Exit | Ctrl+Q | 종료 | ○ | 🟢 |

### 2.2 Edit 메뉴

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| Undo / Redo | Ctrl+Z | 1단계 실행취소/재실행 토글 | ○ | ✅ 🟢 |
| Step Forward | Shift+Ctrl+Z | 히스토리 앞으로 | ○ | ✅ 🟢 |
| Step Backward | Alt+Ctrl+Z | 히스토리 뒤로 | ○ | ✅ 🟢 |
| Fade… | Shift+Ctrl+F | 직전 작업의 불투명도/모드 사후 조절 | ○ | 🟠 |
| Cut | Ctrl+X | 잘라내기 | ○ | ✅ 🟢 |
| Copy | Ctrl+C | 복사 | ○ | ✅ 🟢 |
| Copy Merged | Shift+Ctrl+C | 보이는 모든 레이어 병합 복사 | ○ | 🟡 |
| Paste | Ctrl+V | 붙여넣기 | ○ | ✅ 🟢 |
| Paste Into | Shift+Ctrl+V | 선택영역 안으로 붙여넣기(마스크 생성) | ○ | 🟡 |
| Clear | — | 지우기 | ○ | ✅ 🟢 |
| **Check Spelling…** | — | **맞춤법 검사 (7.0 신기능)** | ✔ | 🟠 |
| **Find and Replace Text…** | — | **텍스트 찾기·바꾸기 (7.0 신기능)** | ✔ | 🟠 |
| Fill… | Shift+F5 | 전경/배경/패턴/히스토리로 채우기 | ○ | ✅ 🟢 |
| Stroke… | — | 선택영역 외곽선 그리기 | ○ | 🟡 |
| Free Transform | Ctrl+T | 자유 변형(크기/회전/기울이기) | ○ | ✅ 🟡 |
| Transform ▸ | — | Again(Shift+Ctrl+T), Scale, Rotate, Skew, Distort, Perspective, Rotate 180°/90°CW/90°CCW, Flip H/V | ○ | ✅(일부) 🟡 |
| Define Brush… | — | 선택영역을 브러시 프리셋으로 정의 | ✔ | 🟡 |
| Define Pattern… | — | 선택영역을 패턴으로 정의 | ○ | 🟡 |
| Define Custom Shape… | — | 패스를 커스텀 셰이프로 정의 | ○ | 🟠 |
| Purge ▸ | — | Undo / Clipboard / Histories / All 메모리 비우기 | ○ | 🟢 |
| **Color Settings…** | Shift+Ctrl+K | 작업 색공간/ICC 정책 | ○ | 🔴 |
| Preset Manager… | — | 브러시/스와치/그라디언트/패턴 등 프리셋 관리 | ○ | 🟡 |
| Preferences ▸ | Ctrl+K | 환경설정(§11) | ○ | 🟡 |

### 2.3 Image 메뉴

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| Mode ▸ | — | 색상 모드 변환(§8) | ✔ | ✅(RGB) 🟡 |
| Adjustments ▸ | — | 색상/톤 보정(§7) | ✔(Auto Color) | ✅(다수) 🟢 |
| Duplicate… | — | 문서 복제 | ○ | 🟢 |
| Apply Image… | — | 채널 단위 합성 | ○ | 🟠 |
| Calculations… | — | 두 채널 블렌딩→새 채널/선택 | ○ | 🟠 |
| Image Size… | — | 픽셀 치수/해상도 리샘플 | ○ | ✅ 🟢 |
| Canvas Size… | — | 캔버스 크기/기준점 | ○ | ✅ 🟢 |
| Rotate Canvas ▸ | — | 180° / 90°CW / 90°CCW / Arbitrary / Flip H / Flip V | ○ | ✅ 🟢 |
| Crop | — | 선택영역으로 자르기 | ○ | 🟢 |
| Trim… | — | 투명/단색 여백 잘라내기 | ○ | 🟡 |
| Reveal All | — | 캔버스 밖 픽셀까지 캔버스 확장 | ○ | 🟡 |
| Trap… | — | (CMYK) 트래핑 | ○ | 🔴 |

### 2.4 Layer 메뉴 (§5와 연계)

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| New ▸ Layer… | Shift+Ctrl+N | 새 레이어 | ○ | ✅ 🟢 |
| New ▸ Layer From Background | — | 배경→일반 레이어 | ○ | 🟢 |
| New ▸ Layer Set… | — | 레이어 그룹 | ✔ | 🟡 |
| New ▸ Layer Set From Linked | — | 링크된 레이어로 그룹 | ○ | 🟡 |
| New ▸ Layer via Copy | Ctrl+J | 선택영역 복사 레이어 | ○ | 🟡 |
| New ▸ Layer via Cut | Shift+Ctrl+J | 선택영역 잘라 레이어 | ○ | 🟡 |
| Duplicate Layer… | — | 레이어 복제 | ○ | ✅ 🟢 |
| Delete ▸ Layer / Hidden Layers | — | 레이어 삭제 | ○ | ✅ 🟢 |
| Layer Properties… | — | 이름/색 라벨 | ○ | ✅ 🟢 |
| **Layer Style ▸** | — | 레이어 스타일(§5.3) | ✔ | 🟡 |
| New Fill Layer ▸ | — | Solid Color / Gradient / Pattern | ○ | 🟡 |
| New Adjustment Layer ▸ | — | 비파괴 보정 레이어(§5.4) | ○ | 🟠 |
| Change Layer Content ▸ | — | 채움/조정 레이어 종류 변경 | ○ | 🟠 |
| Layer Content Options… | — | 채움/조정 레이어 설정 | ○ | 🟠 |
| Type ▸ | — | Create Work Path, Convert to Shape, Horizontal/Vertical, Anti-Alias(None/Crisp/Strong/Smooth), Convert to Paragraph/Point Text, Warp Text…, Update All/Replace Missing Fonts | ○ | 🟠 |
| Rasterize ▸ | — | Type/Shape/Fill Content/Layer Clipping Path/Layer/Linked/All | ○ | 🟡 |
| New Layer Based Slice | — | 레이어 기반 슬라이스 | ○ | 🔴 |
| Add Layer Mask ▸ | — | Reveal All / Hide All / Reveal Selection / Hide Selection | ✔ | 🟡 |
| Enable/Disable Layer Mask | — | 마스크 on/off | ✔ | 🟡 |
| Add Vector Mask ▸ | — | Reveal All / Hide All / Current Path | ✔ | 🟠 |
| Group with Previous | Ctrl+G | **클리핑 마스크** 생성 | ✔ | 🟡 |
| Ungroup | Shift+Ctrl+G | 클리핑 해제 | ✔ | 🟡 |
| Arrange ▸ | Shift+Ctrl+] 등 | Bring to Front/Forward/Backward/Send to Back | ✔ | ✅ 🟢 |
| Align/Distribute Linked ▸ | — | 링크 레이어 정렬/분배 | ○ | 🟡 |
| Merge Down | Ctrl+E | 아래 레이어와 병합 | ✔ | ✅ 🟢 |
| Merge Visible | Shift+Ctrl+E | 보이는 레이어 병합 | ✔ | 🟢 |
| Flatten Image | — | 전체 배경으로 평탄화 | ○ | ✅ 🟢 |
| Matting ▸ | — | Defringe / Remove Black Matte / Remove White Matte | ○ | 🟠 |

### 2.5 Select 메뉴

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| All | Ctrl+A | 전체 선택 | ○ | ✅ 🟢 |
| Deselect | Ctrl+D | 선택 해제 | ○ | ✅ 🟢 |
| Reselect | Shift+Ctrl+D | 직전 선택 복원 | ○ | 🟢 |
| Inverse | Shift+Ctrl+I | 선택 반전 | ○ | ✅ 🟢 |
| Color Range… | — | 색상 기준 선택(허용치/미리보기) | ○ | 🟡 |
| Feather… | Alt+Ctrl+D | 선택 가장자리 페더 | ○ | ✅ 🟡 |
| Modify ▸ | — | Border / Smooth / Expand / Contract | ○ | 🟡 |
| Grow | — | 인접 유사색 확장 | ○ | 🟡 |
| Similar | — | 전체 유사색 선택 | ○ | 🟡 |
| Transform Selection | — | 선택영역만 변형 | ○ | 🟡 |
| Load Selection… | — | 채널/마스크→선택 | ○ | 🟡 |
| Save Selection… | — | 선택→알파 채널 | ○ | 🟡 |

### 2.6 Filter 메뉴 (§6 전체 목록)

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| Last Filter | Ctrl+F | 직전 필터 재적용 | ○ | 🟢 |
| Extract… | Alt+Ctrl+X | 외곽선 기반 오브젝트 추출(배경제거) | ✔(툴박스) | 🟠 |
| Liquify… | Shift+Ctrl+X | 픽셀 밀기/왜곡(Warp 등) | ✔(툴박스) | 🟠 |
| **Pattern Maker…** | Alt+Shift+Ctrl+X | **선택영역으로 타일 패턴 생성 (7.0 신기능)** | ✔ | 🟠 |
| Artistic ▸ … Other ▸ | — | 13개 카테고리 필터(§6) | ✔(카테고리) | ✅(일부) 🟡 |
| Digimarc ▸ | — | 워터마크 임베드/읽기 | ○ | 🔴 |

### 2.7 View 메뉴

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| Proof Setup ▸ | — | 교정 색공간 설정 | ○ | 🔴 |
| Proof Colors | Ctrl+Y | 교정 미리보기 | ○ | 🔴 |
| Gamut Warning | Shift+Ctrl+Y | CMYK 영역 밖 경고 | ○ | 🔴 |
| Zoom In | Ctrl++ | 확대 | ○ | ✅ 🟢 |
| Zoom Out | Ctrl+- | 축소 | ○ | ✅ 🟢 |
| Fit on Screen | Ctrl+0 | 창에 맞춤 | ○ | ✅ 🟢 |
| Actual Pixels | Alt+Ctrl+0 | 100% | ○ | ✅ 🟢 |
| Print Size | — | 인쇄 크기 미리보기 | ○ | 🔴 |
| Extras | Ctrl+H | 가이드/그리드/슬라이스 등 표시 토글 | ○ | 🟢 |
| Show ▸ | — | Selection Edges/Target Path/Grid/Guides/Slices/Notes/All/None | ○ | 🟢 |
| Rulers | Ctrl+R | 눈금자 | ○ | 🟢 |
| Snap | Shift+Ctrl+; | 스냅 on/off | ○ | 🟡 |
| Snap To ▸ | — | Guides/Grid/Slices/Document Bounds/All/None | ○ | 🟡 |
| Lock Guides | Alt+Ctrl+; | 가이드 잠금 | ○ | 🟢 |
| Clear Guides | — | 가이드 삭제 | ○ | 🟢 |
| New Guide… | — | 가이드 추가 | ○ | 🟢 |
| Lock/Clear Slices | — | 슬라이스 관리 | ○ | 🔴 |

### 2.8 Window 메뉴 (팔레트 표시 — §4)

| 명령 | 단축키 | 검증 | 명령 | 단축키 | 검증 |
|---|---|---|---|---|---|
| Documents ▸ (Cascade/Tile) | — | ○ | Actions | F9 | ✔ |
| Workspace ▸ (Save/Reset) | — | ○ | **Tool Presets** | — | ✔ |
| Tools / Options | — | ○ | Layers | F7 | ✔ |
| **File Browser** | — | ✔ | Channels | — | ✔ |
| Navigator | — | ✔ | Paths | — | ✔ |
| Info | F8 | ✔ | Brushes | F5 | ✔ |
| Color | F6 | ✔ | Character | — | ✔ |
| Swatches | — | ✔ | Paragraph | — | ✔ |
| Styles | — | ✔ | Status Bar | — | ○ |
| History | — | ✔ | (열린 문서 목록) | — | ○ |

### 2.9 Help 메뉴

| 명령 | 단축키 | 설명 | Canvas |
|---|---|---|---|
| Photoshop Help… | F1 | 도움말 | 🟢 |
| Welcome Screen… | — | 시작 화면 | 🟢 |
| Export Transparent Image… / Resize Image… | — | 도움말 마법사 | 🟠 |
| System Info… | — | 시스템 정보 | 🟢 |
| Registration / Updates / Support | — | Adobe Online 연동 | 🔴 |
| About Photoshop / About Plug-In ▸ | — | 정보 | 🟢 |

---

## 3. 툴박스 전수 명세 ✔

> **전부 QRC(Adobe 1차 문서)에서 축자 확인**. 같은 슬롯의 숨은 도구는 **Shift+키** 또는 **Alt+클릭**으로 순환.
> `‡` = 옵션바에만 나타나는 변형(그라디언트 종류 등).

| # | 도구 | 키 | 숨은(중첩) 도구 | 주요 옵션바 | Canvas |
|---|---|---|---|---|---|
| 1 | Move | **V** | — | Auto Select Layer, Show Bounding Box, 정렬/분배 | ✅ 🟢 |
| 2 | Rectangular Marquee | **M** | Elliptical, Single Row, Single Column Marquee | New/Add/Subtract/Intersect, Feather, Style(Normal/Fixed) | ✅(rect) 🟢 |
| 3 | Lasso | **L** | Polygonal Lasso, Magnetic Lasso | Feather, Anti-alias, (자력) Width/Contrast/Frequency | ✅ 🟢 |
| 4 | Magic Wand | **W** | — | Tolerance, Anti-alias, Contiguous, Use All Layers | ✅ 🟢 |
| 5 | Crop | **C** | — | Width/Height/Resolution, Shield 색/불투명도, Perspective | 🟢 |
| 6 | Slice | **K** | Slice Select | Style, 라인 색 | 🔴 |
| 7 | **Healing Brush** | **J** | **Patch**, (Color Replacement은 CS) | Brush, Mode, Source(Sampled/Pattern), Aligned | 🟠 |
| 8 | Brush | **B** | **Pencil** | Brush Preset, Mode, Opacity, Flow, Airbrush(‡) | ✅ 🟢 |
| 9 | Clone Stamp | **S** | Pattern Stamp | Brush, Mode, Opacity, Flow, Aligned, Use All Layers | 🟡 |
| 10 | History Brush | **Y** | Art History Brush | Brush, Mode, Opacity, (Art) Style/Area/Tolerance | 🟠 |
| 11 | Eraser | **E** | Background Eraser, Magic Eraser | Mode(Brush/Pencil/Block), Opacity, Flow, Erase to History | ✅ 🟢 |
| 12 | Gradient | **G** | Paint Bucket | Gradient, 종류(Linear/Radial‡/Angle‡/Reflected‡/Diamond‡), Mode, Opacity, Reverse/Dither/Transparency | 🟡(버킷만 ✅) |
| 13 | Blur | **R** | Sharpen, Smudge | Brush, Mode, Strength, Use All Layers, (스머지)Finger Painting | 🟡 |
| 14 | Dodge | **O** | Burn, Sponge | Brush, Range(Shadows/Midtones/Highlights), Exposure | 🟡 |
| 15 | Path Selection | **A** | Direct Selection | Show Bounding Box, 정렬/분배, 조합 모드 | 🟠 |
| 16 | Pen | **P** | Freeform Pen, Add/Delete Anchor, Convert Point | Shape Layers/Paths/Fill, Auto Add/Delete, Rubber Band | 🟠 |
| 17 | Horizontal Type | **T** | Vertical Type, Horizontal/Vertical Type **Mask** | Font/Style/Size/Anti-alias, 정렬, 색, Warp, 팔레트 토글 | ✅(기본) 🟠 |
| 18 | Rectangle (Shape) | **U** | Rounded Rectangle, Ellipse, Polygon, Line, Custom Shape | Shape Layers/Paths/Fill, 셰이프 옵션, Style, 색 | ✅(rect/ellipse/line) 🟡 |
| 19 | Notes | **N** | Audio Annotation | 작성자, 글꼴 크기, 색 | 🟠 |
| 20 | Eyedropper | **I** | Color Sampler, Measure | Sample Size(Point/3×3/5×5) | ✅ 🟢 |
| 21 | Hand | **H** | — | Actual Pixels/Fit/Print Size | ✅ 🟢 |
| 22 | Zoom | **Z** | — | Resize Windows to Fit, Ignore Palettes, Zoom In/Out | ✅ 🟢 |

**툴박스 하단 컨트롤** ✔
| 컨트롤 | 키 | 설명 | Canvas |
|---|---|---|---|
| Foreground / Background Color | — | 전경/배경 색상 스와치 | ✅ 🟢 |
| Switch Colors | **X** | 전경↔배경 교환 | ✅ 🟢 |
| Default Colors | **D** | 검정/흰색 초기화 | ✅ 🟢 |
| Standard / Quick Mask Mode | **Q** | 빠른 마스크 모드 토글 | 🟡 |
| Standard / Full Screen (w/ menu) | **F** | 화면 모드 순환 | 🟢 |

**툴박스 공통 단축** ✔: `Ctrl+Tab` 문서 순환 · 도구 선택 후 `Enter` 옵션바 포커스 · `Caps Lock` 정밀 십자 커서 · 페인팅 중 `숫자키` 불투명도(0=100%, 45=4→5 연타) · `Shift+숫자` Flow.

---

## 4. 팔레트(Palette) 전수 명세 ✔

> PS7의 팔레트는 우상단 **Palette Well**에 도킹 가능. 아래는 QRC에서 확인된 팔레트.

| 팔레트 | 단축키 | 핵심 기능 | 검증 | Canvas |
|---|---|---|---|---|
| **Layers** | F7 | 레이어 스택, 블렌드 모드, Opacity/Fill, Lock(투명/이미지/위치/전체), 마스크, 레이어 세트, 스타일 | ✔ | ✅ 🟢 |
| **Channels** | — | 색 채널(RGB/CMYK)·알파 채널·스폿 채널, 채널→선택 로드 | ✔ | ✅(편집 다이얼로그) 🟡 |
| **Paths** | — | 작업 패스 저장, 패스→선택, 채우기/스트로크 | ✔ | 🟠 |
| **History** | — | 작업 단계 기록, 스냅샷, 비선형 실행취소, 히스토리 브러시 소스 | ✔ | ✅(스택) 🟢 |
| **Actions** | F9 | 작업 녹화/재생, 배치 자동화 | ✔ | 🟠 |
| **Navigator** | — | 썸네일 보기, 줌 슬라이더, 뷰 박스 이동 | ✔ | 🟢 |
| **Info** | F8 | 좌표·RGB/CMYK 값·선택 크기 실시간 | ✔ | ✅(상태바) 🟢 |
| **Color** | F6 | 전경/배경 색 슬라이더(RGB/HSB/CMYK) | ✔ | ✅ 🟢 |
| **Swatches** | — | 색상 견본 추가/삭제, 라이브러리 | ✔ | ✅ 🟢 |
| **Styles** | — | 레이어 스타일 프리셋 | ✔ | 🟡 |
| **Brushes** | F5 | **새 Painting Engine** — Shape/Scatter/Texture/Dual/Color/Other Dynamics, Master Diameter (7.0 복원·개선) | ✔ | ✅(부분: 크기/경도/종류) 🟡 |
| **Tool Presets** | — | **임의 도구 옵션바 설정 저장/호출 (7.0 신기능)** | ✔ | 🟡 |
| **Character** | — | 글꼴/크기/행간/자간/베이스라인 등 | ✔ | 🟠 |
| **Paragraph** | — | 정렬/들여쓰기/하이픈/컴포저 | ✔ | 🟠 |
| **File Browser** | — | **이미지 탐색/순위/회전/EXIF/배치이름변경 (7.0 신기능)** | ✔ | 🟡 |
| (ImageReady) Rollovers/Animation/Image Map/Color Table/Slice | — | 웹 그래픽 전용(ImageReady) | ✔ | 🔴 |

---

## 5. 레이어 시스템 명세

### 5.1 레이어 종류 ○
일반 픽셀 레이어 · 배경(Background) · 텍스트(벡터) · 셰이프(벡터+레이어) · 채움 레이어(Solid/Gradient/Pattern) · 조정 레이어 · 레이어 세트(그룹).

### 5.2 블렌드 모드 전체 (24종) ✔
> **QRC 팔레트 순서대로 축자 확인.** ⚠️ **Hard Mix는 7.0에 없음**(Photoshop CS, 2003에서 추가).
> `[P]` = 페인팅 도구 전용 모드(레이어 모드 아님). 단축키는 **Shift+Alt+문자**.

| 그룹 | 모드(단축키) | Canvas `globalCompositeOperation` 대응 |
|---|---|---|
| 기본 | Normal(N), Dissolve(I) | `source-over` / **커스텀**(랜덤 디더) |
| 기본[P] | Behind(Q)`[P]`, Clear(R)`[P]` | `destination-over` / `destination-out` |
| 어둡게 | Darken(K), Multiply(M), Color Burn(B), **Linear Burn(A)** | `darken` / `multiply` / `color-burn` / **커스텀** |
| 밝게 | Lighten(G), Screen(S), Color Dodge(D), **Linear Dodge(W)** | `lighten` / `screen` / `color-dodge` / `lighter`(가산, 근사) |
| 대비 | Overlay(O), Soft Light(F), Hard Light(H), **Vivid Light(V)**, **Linear Light(J)**, **Pin Light(Z)** | `overlay` / `soft-light` / `hard-light` / **커스텀** ×3 |
| 비교 | Difference(E), Exclusion(X) | `difference` / `exclusion` |
| 색상 | Hue(U), Saturation(T), Color(C), Luminosity(Y) | `hue` / `saturation` / `color` / `luminosity` |

> **7.0 신규 블렌드 모드 5종** ✔: Linear Burn, Linear Dodge, Vivid Light, Linear Light, Pin Light.
> **Canvas 구현 핵심**: 16종은 `globalCompositeOperation`로 네이티브, Behind/Clear는 destination-* 합성으로,
> Dissolve·Linear Burn·Vivid·Linear·Pin Light(5종)는 **per-pixel 커스텀**이 필요(🟡~🟠).

### 5.3 레이어 스타일(Layer Style) ✔(존재)/○(항목)
Blending Options · **Drop Shadow** · Inner Shadow · **Outer Glow** · Inner Glow · **Bevel and Emboss**(+Contour/Texture) · Satin · **Color Overlay** · Gradient Overlay · Pattern Overlay · **Stroke**. (Global Light, Scale Effects, Create Layer 보조 명령 포함.) → Canvas 🟡(그림자/글로우/스트로크) ~ 🟠(베벨/새틴).

### 5.4 조정 레이어(Adjustment Layer) ○
Levels · Curves · Color Balance · Brightness/Contrast · Hue/Saturation · Selective Color · Channel Mixer · Gradient Map · Invert · Threshold · Posterize (비파괴, 마스크 동반). → Canvas 🟠.

### 5.5 마스크 · 클리핑 · 잠금 ✔
- **Layer Mask**(픽셀 마스크, 그레이스케일) / **Vector Mask**(패스 기반) — `\`로 루비리스 토글.
- **Clipping Mask** = *Group with Previous* (Ctrl+G).
- **Lock**: Transparency / Image / Position / All (`/`로 투명 잠금 토글).
- Opacity + **Fill Opacity** 분리.

---

## 6. 필터 전수 명세

> 카테고리 13종은 ✔(QRC/검색 교차확인), 개별 필터 항목은 ○(PS7 표준). 특수 필터는 메뉴 상단(§2.6).

| 카테고리 | 필터 항목 | Canvas |
|---|---|---|
| **Artistic**(15) | Colored Pencil, Cutout, Dry Brush, Film Grain, Fresco, Neon Glow, Paint Daubs, Palette Knife, Plastic Wrap, Poster Edges, Rough Pastels, Smudge Stick, Sponge, Underpainting, Watercolor | 🟠 |
| **Blur**(6) | Blur, Blur More, **Gaussian Blur**, Motion Blur, Radial Blur, Smart Blur | ✅(Gaussian) 🟡 |
| **Brush Strokes**(8) | Accented Edges, Angled Strokes, Crosshatch, Dark Strokes, Ink Outlines, Spatter, Sprayed Strokes, Sumi-e | 🟠 |
| **Distort**(12) | Diffuse Glow, Displace, Glass, Ocean Ripple, Pinch, Polar Coordinates, Ripple, Shear, Spherize, Twirl, Wave, ZigZag | 🟠 |
| **Noise**(4) | **Add Noise**, Despeckle, Dust & Scratches, Median | ✅(일부) 🟡 |
| **Pixelate**(7) | Color Halftone, Crystallize, Facet, Fragment, Mezzotint, Mosaic, Pointillize | 🟡 |
| **Render**(6) | 3D Transform, Clouds, Difference Clouds, **Lens Flare**, **Lighting Effects**, Texture Fill | 🟠 |
| **Sharpen**(4) | Sharpen, Sharpen Edges, Sharpen More, **Unsharp Mask** | ✅(일부) 🟡 |
| **Sketch**(14) | Bas Relief, Chalk & Charcoal, Charcoal, Chrome, Conté Crayon, Graphic Pen, Halftone Pattern, Note Paper, Photocopy, Plaster, Reticulation, Stamp, Torn Edges, Water Paper | 🟠 |
| **Stylize**(9) | Diffuse, Emboss, Extrude, Find Edges, Glowing Edges, Solarize, Tiles, Trace Contour, Wind | 🟡 |
| **Texture**(6) | Craquelure, Grain, Mosaic Tiles, Patchwork, Stained Glass, Texturizer | 🟠 |
| **Video**(2) | De-Interlace, NTSC Colors | 🔴 |
| **Other**(5) | **Custom**(컨볼루션 커널), High Pass, Maximum, Minimum, Offset | 🟡 |
| 특수 | Extract, Liquify, **Pattern Maker(신규)**, Digimarc | 🟠/🔴 |

> 다수 필터는 **Filter Gallery 이전** 시대라 개별 다이얼로그로 동작(PS7엔 통합 Filter Gallery 없음 — CS부터).

---

## 7. 색상/톤 보정 (Image ▸ Adjustments) 전수

| 명령 | 단축키 | 설명 | 검증 | Canvas |
|---|---|---|---|---|
| **Levels…** | Ctrl+L | 입출력 레벨/감마, 채널별 | ○ | ✅ 🟢 |
| Auto Levels | Shift+Ctrl+L | 채널별 자동 화이트/블랙 | ○ | ✅ 🟢 |
| Auto Contrast | Alt+Shift+Ctrl+L | 복합 대비 자동(색조 보존) | ○ | 🟢 |
| **Auto Color** | **Shift+Ctrl+B** | **자동 색 캐스트 제거 (7.0 신기능, Auto Levels와 다른 알고리즘)** | ✔ | 🟡 |
| **Curves…** | Ctrl+M | 톤 곡선, 채널별 | ○ | ✅ 🟢 |
| Color Balance… | Ctrl+B | 그림자/중간/하이라이트 색 균형 | ○ | 🟡 |
| Brightness/Contrast… | — | 밝기/대비(단순) | ○ | ✅ 🟢 |
| **Hue/Saturation…** | Ctrl+U | 색조/채도/명도, Colorize | ○ | ✅ 🟢 |
| Desaturate | Shift+Ctrl+U | 채도 제거(모드 유지) | ○ | ✅ 🟢 |
| Replace Color… | — | 색 선택→치환 | ○ | 🟡 |
| Selective Color… | — | 색군별 CMYK 가감 | ○ | 🟠 |
| **Channel Mixer…** | — | 채널 가중 혼합, Monochrome | ○ | ✅ 🟡 |
| Gradient Map… | — | 명도→그라디언트 매핑 | ○ | 🟡 |
| **Invert** | Ctrl+I | 반전 | ○ | ✅ 🟢 |
| Equalize | — | 히스토그램 평활화 | ○ | 🟡 |
| Threshold… | — | 흑백 2치화 | ○ | 🟡 |
| Posterize… | — | 계조 단순화 | ○ | 🟡 |
| Variations… | — | 썸네일 비교형 색 보정 | ○ | 🟠 |

> 현재 프로젝트는 Levels/Curves/Brightness·Contrast/Hue·Sat/Desaturate(Grayscale)/Invert/Channel Mixer/Auto Tone + **히스토그램**을 보유. 채널별(R/G/B/Alpha) Levels·Curves도 구현됨(✅).

---

## 8. 이미지 모드 (Image ▸ Mode) 전수 ✔(목록)

| 모드 | 설명 | Canvas |
|---|---|---|
| **Bitmap** | 1비트 흑/백 | 🟡 |
| **Grayscale** | 8/16비트 회색조 | ✅(보정으로) 🟢 |
| Duotone | 1~4 잉크(Mono/Du/Tri/Quadtone) | 🔴 |
| Indexed Color | 색상 룩업테이블(≤256색, GIF/PNG-8) | 🟡 |
| **RGB Color** | 화면 표준(클론 기본) | ✅ 🟢 |
| **CMYK Color** | 인쇄 4원색 | 🔴 |
| Lab Color | 장치 독립 색공간 | 🔴 |
| Multichannel | 스폿 컬러 분판 | 🔴 |
| 8 / 16 Bits/Channel | 비트 심도 | 🟡(8비트만 현실적) |
| Color Table… | 인덱스 색상표 편집 | 🟡 |
| Assign Profile / Convert to Profile | ICC 프로파일 | 🔴 |

> Canvas `ImageData`는 본질적으로 **8비트 RGBA**. RGB/Grayscale/Indexed는 현실적, CMYK/Lab/16비트/Duotone은 🔴.

---

## 9. Photoshop 7.0 신기능 정리 ✔

| 신기능 | 위치 | 핵심 | 검증 |
|---|---|---|---|
| **Healing Brush** | 툴박스 J | 소스의 **질감/조명/음영/투명도**를 대상에 맞춰 블렌딩(복제와 달리 자동 정합). 주름·잡티 제거 | ✔ |
| **Patch Tool** | 툴박스 J(숨김) | 선택영역 단위 healing, 옵션바 Source/Destination | ✔ |
| **File Browser** | File ▸ Browse (Shift+Ctrl+O) | 4-pane(tree/preview/metadata/thumbnail), 순위(rank)·정렬·회전·EXIF·키워드·Batch Rename | ✔ |
| **Tool Presets** | Window ▸ Tool Presets | 임의 도구 옵션 저장→1클릭 호출 | ✔ |
| **새 Painting Engine / Brushes 팔레트** | Window ▸ Brushes (F5) | shape/tilt/spacing/scatter/jitter/diameter/texture/shading + flow, **Master Diameter**로 커스텀 브러시 크기 최초 완전 제어. (PS5 존재→PS6 제거→**PS7 복원·개선**) | ✔ |
| **Auto Color** | Image ▸ Adjustments (Shift+Ctrl+B) | 자동 색 보정군 완성 | ✔ |
| **맞춤법 검사 / 텍스트 찾기·바꾸기** | Edit 메뉴 | 다국어 spell check, Find/Replace Text | ✔ |
| **완전 벡터 텍스트** | Type | 해상도 독립 텍스트(리샘플 무손실) | ✔ |
| **Pattern Maker** | Filter ▸ Pattern Maker | 선택영역 기반 타일 패턴 생성, Tile History | ✔ |
| 새 메뉴 명칭 | Image ▸ **Adjustments** | 이전 *Adjust* → 7.0 *Adjustments* | ✔ |
| Web 출력(ImageReady 7) | ImageReady | Rollover, Weighted Optimization, 투명 GIF Dithering, Save for Web | ○ |
| 7.0.1 추가 | 플러그인 | Camera Raw | ✔ |

---

## 10. 환경설정 · 색상 관리 · 단축키 체계 ○

- **Preferences (Ctrl+K)**: General / File Handling / Display & Cursors / Transparency & Gamut / Units & Rulers / Guides, Grid & Slices / Plug-Ins & Scratch Disks / Memory & Image Cache.
- **Color Settings (Shift+Ctrl+K)**: 작업 색공간(RGB/CMYK/Gray/Spot), 색관리 정책, 변환 옵션(엔진/의도/흑점보정).
- **Preset Manager**: Brushes/Swatches/Gradients/Styles/Patterns/Contours/Custom Shapes/Tools 일괄 관리.
- **단축키 체계** ✔: 도구=단일 영문키 · 메뉴=Ctrl 조합 · 팔레트 토글=F5/F6/F7/F8/F9 · 블렌드 모드=Shift+Alt+문자 · 페인팅 불투명도=숫자키. (PS7에는 *키보드 단축키 커스터마이즈 편집기*는 없음 — CS부터.)

---

## 11. 웹/Canvas 클론 구현 우선순위 종합 + 갭 분석

### 11.1 단계별 로드맵

**🟢 핵심 (MVP — 대부분 구현 완료)**
도구: Move/Marquee/Lasso/Wand/Brush/Pencil/Eraser/Bucket/Eyedropper/Shape/Type/Hand/Zoom ·
레이어 스택 + Opacity ·
선택(All/Deselect/Inverse/Feather) + Free Transform ·
보정: Levels/Curves/Brightness·Contrast/Hue·Sat/Desaturate/Invert ·
파일 Open/Save(PNG) · Undo/Redo · 줌/팬 · 전경·배경색.
→ **현재 프로젝트가 사실상 이 단계를 달성**(✅ 다수).

**🟡 중급 (차별화 — 권장 다음 목표)**
- **블렌드 모드 전체 24종**(16 네이티브 + 8 커스텀) — 현재 일부만.
- **레이어 마스크 / 클리핑 마스크 / Lock**.
- **Gradient 도구**(현재 버킷만 있음) + Stroke.
- **Crop / Trim / Image Size 다이얼로그 정비**.
- 필터: Stylize/Pixelate/Other(Custom 컨볼루션)/Noise/Sharpen 확장.
- 보정: Color Balance/Threshold/Posterize/Gradient Map/Equalize.
- **Save for Web**(품질/포맷 옵션), Tool Presets, Swatches 확장.
- Quick Mask 모드, Color Range.

**🟠 고급 (전문 — 장기)**
- **Pen/패스(베지어)** + Vector Mask + 셰이프 레이어.
- **타이포 엔진**(Character/Paragraph, Warp Text, 벡터 텍스트).
- **레이어 스타일**(Drop Shadow/Glow/Bevel) + Styles 팔레트.
- **조정 레이어**(비파괴) + History 팔레트/스냅샷.
- Healing Brush/Patch/Clone/Pattern Stamp, Dodge/Burn/Sponge, Blur/Sharpen/Smudge.
- Liquify, Pattern Maker, 예술계열 필터, Actions(매크로).

**🔴 비현실 / 부적합 (웹 환경 한계)**
CMYK·Lab·Duotone·Multichannel·16비트 · ICC 정밀 색관리/교정(Proof/Gamut) · 인쇄(Print/Page Setup/Trap) · WebDAV 워크플로 · ImageReady 통합 · TWAIN 스캐너 · Digimarc · 플러그인 SDK.

### 11.2 현재 `canvas-photo-editor` 갭 요약

| 영역 | 구현됨 ✅ | 다음 우선(🟡) | 비고 |
|---|---|---|---|
| 도구 | 13종(이동/선택3/브러시/연필/지우개/버킷/스포이드/셰이프/문자/손/줌) | **Gradient 분리**, Crop, Clone/Dodge·Burn | Pen·Healing은 🟠 |
| 레이어 | 스택·추가/삭제/복제·순서·병합·평탄화·블렌드(일부) | **블렌드 24종 완성**, 마스크, 클리핑, Lock | — |
| 선택 | All/Deselect/Inverse/Feather/Marquee/Lasso/Wand | Color Range, Modify, Quick Mask | — |
| 보정 | Levels/Curves(채널별+α)/B·C/Hue·Sat/Grayscale/Invert/ChannelMixer/AutoTone/히스토그램 | Color Balance, Threshold, Posterize, Gradient Map | 채널편집 ✅ 강점 |
| 필터 | Gaussian Blur(StackBlur), 일부 | Unsharp/Stylize/Pixelate/Custom | — |
| 색관리/인쇄 | (RGB 전용) | — | CMYK 등 🔴 |

> **권장 다음 스텝**: ① 블렌드 모드 24종 완성(`globalCompositeOperation` 16 + 커스텀 8) → ② 레이어 마스크 → ③ Gradient 도구. 이 3개가 "그림판 → 진짜 포토샵 클론"의 핵심 분기점.

---

## 12. 빠른 참조 — 단축키 요약표 ✔

| 카테고리 | 단축키 |
|---|---|
| 도구 | V/M/L/W/C/K/J/B/S/Y/E/G/R/O/A/P/T/U/N/I/H/Z · D(기본색)/X(교환)/Q(퀵마스크)/F(화면) |
| 파일 | New Ctrl+N · Open Ctrl+O · **Browse Shift+Ctrl+O** · Save Ctrl+S · Save As Shift+Ctrl+S · Save for Web Alt+Shift+Ctrl+S · Revert F12 |
| 편집 | Undo Ctrl+Z · Step Fwd Shift+Ctrl+Z · Step Back Alt+Ctrl+Z · Cut/Copy/Paste Ctrl+X/C/V · Fill Shift+F5 · Free Transform Ctrl+T |
| 선택 | All Ctrl+A · Deselect Ctrl+D · Inverse Shift+Ctrl+I · Feather Alt+Ctrl+D |
| 이미지/보정 | Levels Ctrl+L · Curves Ctrl+M · Color Balance Ctrl+B · Hue/Sat Ctrl+U · Desaturate Shift+Ctrl+U · **Auto Color Shift+Ctrl+B** · Invert Ctrl+I |
| 레이어 | New Shift+Ctrl+N · via Copy Ctrl+J · Group(클리핑) Ctrl+G · Merge Down Ctrl+E · Merge Visible Shift+Ctrl+E · 순서 (Shift+)Ctrl+[ / ] |
| 필터 | Last Ctrl+F · Extract Alt+Ctrl+X · Liquify Shift+Ctrl+X · Pattern Maker Alt+Shift+Ctrl+X |
| 보기 | Zoom In/Out Ctrl+ +/- · Fit Ctrl+0 · 100% Alt+Ctrl+0 · Extras Ctrl+H · Rulers Ctrl+R |
| 팔레트 | Brushes F5 · Color F6 · Layers F7 · Info F8 · Actions F9 · Tab(전체 토글) |
| 블렌드 모드 | Shift+Alt+ N/I/K/M/B/A/G/S/D/W/O/F/H/V/J/Z/E/X/U/T/C/Y |

---

## 13. 출처 및 검증

### 13.1 1차 출처 (Adobe 공식)
- **Adobe Photoshop 7.0: User Guide** (Adobe Systems, San Jose, 2002) — 진본 교차검증(Internet Archive 2개 독립 스캔, LCCN 2002512603, OCLC 1023763675).
  - `https://archive.org/details/adobephotoshop7000adob`
  - `https://archive.org/details/adobephotoshop700000titl`
  - `https://www.manualslib.com/products/Adobe-Photoshop-7-0-10136706.html` (549p PDF)
- **Adobe Photoshop 7.0 Quick Reference Card for Windows** (Part Number 90036794, 04/02W, ©2002) — **본 명세서의 도구·블렌드 모드·팔레트·단축키 ✔ 항목의 직접 근거**.
  - `http://www.cheat-sheets.org/saved-copy/Photoshop.pdf`
- **Adobe Photoshop 7.0 Reviewer's Guide** — 신기능(Healing Brush/File Browser/Auto Color/Painting Engine) 축자 근거.
  - `https://intercadsys.com/uploads/brochure/AdobeR%20Photoshop%207.0%20-%20Reviewer's%20Guide.pdf`

### 13.2 보조 출처 (교차검증)
- CreativePro "Photoshop 7 first look" (2002) · Macworld(2002) · Web Design Museum · O'Reilly *Photoshop 7 for the Web* / *Adobe Photoshop 7.0 Classroom in a Book*.
- 블렌드 모드 7.0 신규 5종 확인: photoshoptrainingchannel.com 외 다수 — **Hard Mix는 CS(2003)에서 추가**됨을 확인.
- Canvas 구현: MDN `globalCompositeOperation`(16종 네이티브), W3C *Compositing and Blending Level 1*.

### 13.3 검증 한계 (정직성 고지)
- deep-research(에이전트 103, 주장 25건 중 23 confirmed / 2 refuted)는 **User Guide의 존재·진본·챕터 구조·신기능을 high 신뢰로 확정**했으나, "모든 메뉴 하위 명령의 축자 완전성"은 1라운드로 입증되지 않았다. 따라서:
  - **✔ 항목**(도구/블렌드 모드/팔레트/신기능/주요 단축키): Adobe 1차 문서에서 직접 읽어 확정.
  - **○ 항목**(메뉴 하위 명령 세부·필터 개별 항목·보정 명령·이미지 모드 세부): User Guide 챕터 포함은 확인, 명칭/경로는 PS7 표준 지식 기반. 픽셀 단위로 100% 보장이 필요하면 archive.org 462p 스캔 또는 549p PDF를 페이지 단위로 재대조 권장.
- 반박(refuted)된 주장: "context-blender 등 보조 라이브러리가 모든 PS 블렌드 모드를 완벽 재현한다" → **거짓**. 비네이티브 블렌드 모드는 per-pixel 직접 구현이 안전.

---

*문서 생성: 2026-06-14 · 도구: Claude Code `/deep-research` 하니스 + Adobe 1차 문서 대조 · 대상 프로젝트: `canvas-photo-editor` v0.1.0*
