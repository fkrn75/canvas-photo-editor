// MCP 도구 정의(이름·설명·입력 스키마). 실제 동작은 에디터 페이지의 js/io/mcp-bridge.js 가 수행한다.
// 도구 이름 = 브리지 명령 이름. 여기에 도구를 추가하면 mcp-bridge.js 의 HANDLERS 에도 같은 이름을 추가할 것.

const color = { type: "string", description: "CSS 색(#rrggbb, rgb(), 색 이름 등)" };
const layerId = { type: ["integer", "string"], description: "레이어 id(get_state의 layers[].id). 생략하면 활성 레이어" };
const num = (description, extra = {}) => ({ type: "number", description, ...extra });
const point = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };

export const TOOLS = [
  {
    name: "bridge_status",
    description: "MCP 브리지 상태(포트, 에디터 연결 여부). 에디터가 응답하지 않을 때 진단용.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_state",
    description: "문서 상태 조회: 문서 크기·이름, 레이어 목록(아래→위 순서, id·이름·종류·불투명도·표시·블렌드), 활성 레이어, 선택 영역, 전경/배경색, 실행취소 가능 단계 수.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_image",
    description: "현재 합성 결과(또는 특정 레이어)를 미리보기 이미지로 받아 눈으로 확인한다. 긴 변을 max_size로 축소한다.",
    inputSchema: {
      type: "object",
      properties: {
        max_size: num("미리보기 긴 변 최대 픽셀(기본 1024, 최대 2048)"),
        layer_id: { type: ["integer", "string"], description: "지정하면 그 레이어만 단독으로" },
      },
    },
  },
  {
    name: "export_image",
    description: "합성 결과를 원본 해상도로 로컬 파일에 저장한다(PNG/JPG). 저장 후 작은 미리보기를 함께 돌려준다.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "저장할 절대 경로(예: C:/Users/me/out.png)" },
        format: { type: "string", enum: ["png", "jpg"], description: "기본: 경로 확장자, 없으면 png" },
        quality: num("JPG 품질 0~1(기본 0.92)"),
        return_image: { type: "boolean", description: "미리보기 이미지 반환 여부(기본 true)" },
      },
      required: ["path"],
    },
    timeoutMs: 120000,
  },
  {
    name: "new_document",
    description: "새 문서를 만든다(기존 내용과 실행취소 기록은 사라짐).",
    inputSchema: {
      type: "object",
      properties: {
        width: num("가로 픽셀(1~16384)"),
        height: num("세로 픽셀(1~16384)"),
        background: { type: "string", description: "white(기본) | transparent | CSS 색" },
        name: { type: "string", description: "문서 이름(저장 파일명에 쓰임)" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "open_image",
    description: "이미지를 연다. 빈 문서면 그 이미지로 새 문서, 작업 중이면 새 레이어로 추가(as_layer로 강제 가능).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "로컬 이미지 파일 경로(png/jpg/webp/gif/bmp)" },
        data_url: { type: "string", description: "data:image/...;base64,... (path 대신)" },
        name: { type: "string", description: "문서/레이어 이름" },
        as_layer: { type: "boolean", description: "true면 항상 새 레이어로 추가" },
        x: num("as_layer일 때 배치 x(기본 0)"),
        y: num("as_layer일 때 배치 y(기본 0)"),
      },
    },
    timeoutMs: 120000,
  },
  {
    name: "layer_add",
    description: "활성 레이어 위에 새 픽셀 레이어를 추가하고 활성화한다.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, fill: color } },
  },
  {
    name: "layer_update",
    description: "레이어 속성 변경(undo 가능). 지정한 항목만 바뀐다.",
    inputSchema: {
      type: "object",
      properties: {
        id: layerId,
        name: { type: "string" },
        opacity: num("불투명도 0~100"),
        fill_opacity: num("채우기 불투명도 0~100(레이어 스타일은 유지)"),
        visible: { type: "boolean" },
        blend_mode: { type: "string", description: "normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity, dissolve, linear-burn, linear-dodge, vivid-light, linear-light, pin-light" },
      },
    },
  },
  {
    name: "layer_op",
    description: "레이어 구조 작업(undo 가능): select(활성화), delete, duplicate, up/down/top/bottom(순서), merge_down, merge_visible, flatten.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["select", "delete", "duplicate", "up", "down", "top", "bottom", "merge_down", "merge_visible", "flatten"] },
        id: layerId,
      },
      required: ["op"],
    },
  },
  {
    name: "set_layer_style",
    description: "레이어 스타일(비파괴 효과) 설정. effects에 넣은 효과만 기존 값에 병합된다. 효과 키: dropShadow, innerShadow, outerGlow, innerGlow, bevel, satin, colorOverlay, gradientOverlay, patternOverlay, stroke. 예: {\"dropShadow\":{\"enabled\":true,\"distance\":10,\"blur\":8}}. opacity 계열은 0~1.",
    inputSchema: {
      type: "object",
      properties: {
        id: layerId,
        effects: { type: "object", description: "효과키 → 파라미터 객체" },
        clear: { type: "boolean", description: "true면 모든 효과를 끈 뒤 effects 적용" },
      },
    },
  },
  {
    name: "select",
    description: "선택 영역 설정. 이후 그리기·채우기·필터는 선택 영역 안에만 적용된다. feather/expand/contract는 선택을 만든 뒤 차례로 적용.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["rect", "ellipse", "polygon", "all", "none", "invert", "opaque"] },
        x: num("rect/ellipse 좌상단 x"), y: num("rect/ellipse 좌상단 y"),
        width: num("rect/ellipse 가로"), height: num("rect/ellipse 세로"),
        points: { type: "array", items: point, description: "polygon 꼭짓점 [[x,y],...]" },
        feather: num("페더 반경(px)"),
        expand: num("확장(px)"),
        contract: num("축소(px)"),
      },
      required: ["mode"],
    },
  },
  {
    name: "fill",
    description: "활성 레이어의 선택 영역(없으면 레이어 전체)을 단색 또는 그라디언트로 채운다(undo 가능).",
    inputSchema: {
      type: "object",
      properties: {
        color,
        gradient: {
          type: "object",
          description: "그라디언트 채우기. type: linear|radial, from/to: [x,y], stops: [[0,\"#000\"],[1,\"#fff\"]] (radial은 from=중심, to=반경 끝점)",
          properties: {
            type: { type: "string", enum: ["linear", "radial"] },
            from: point, to: point,
            stops: { type: "array", items: { type: "array" } },
          },
        },
        opacity: num("0~1(기본 1)"),
      },
    },
  },
  {
    name: "draw_shape",
    description: "활성 레이어에 도형을 래스터로 그린다(undo 가능). rect/ellipse는 x,y,width,height, line/polyline/polygon은 points. 재편집 가능한 벡터 도형이 필요하면 add_shape_layer를 쓴다.",
    inputSchema: {
      type: "object",
      properties: {
        shape: { type: "string", enum: ["rect", "ellipse", "line", "polyline", "polygon"] },
        x: num("x"), y: num("y"), width: num("가로"), height: num("세로"),
        radius: num("rect 모서리 둥글기(px)"),
        points: { type: "array", items: point },
        fill: color,
        stroke: color,
        stroke_width: num("선 두께(기본 2)"),
        opacity: num("0~1(기본 1)"),
      },
      required: ["shape"],
    },
  },
  {
    name: "draw_stroke",
    description: "브러시처럼 점 목록을 따라 둥근 획을 그린다(undo 가능). erase=true면 지우개.",
    inputSchema: {
      type: "object",
      properties: {
        points: { type: "array", items: point, minItems: 1, description: "[[x,y],...] 문서 좌표" },
        color,
        size: num("붓 지름(px, 기본 전경 브러시 크기)"),
        opacity: num("0~1(기본 1)"),
        hardness: num("0~1 경도(1=선명, 낮을수록 가장자리 흐림, 기본 1)"),
        smooth: { type: "boolean", description: "점 사이를 곡선으로 보간(기본 true)" },
        erase: { type: "boolean" },
      },
      required: ["points"],
    },
  },
  {
    name: "add_text",
    description: "재편집 가능한 벡터 텍스트 레이어를 새로 만든다. x,y는 텍스트 블록 좌상단. 여러 줄은 \\n.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        x: num("x"), y: num("y"),
        font_size: num("글자 크기(px, 기본 36)"),
        font_family: { type: "string", description: "기본 Malgun Gothic" },
        color,
        bold: { type: "boolean" }, italic: { type: "boolean" },
        align: { type: "string", enum: ["left", "center", "right"] },
        line_height: num("행간 배수(기본 1.2)"),
        letter_spacing: num("자간(px)"),
        name: { type: "string", description: "레이어 이름(기본: 텍스트 내용)" },
      },
      required: ["text", "x", "y"],
    },
  },
  {
    name: "add_shape_layer",
    description: "재편집 가능한 벡터 셰이프 레이어를 새로 만든다. rect/ellipse/rounded는 x,y,width,height, polygon은 중심 x,y와 radius·sides.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["rect", "ellipse", "rounded", "polygon"] },
        x: num("x(polygon은 중심 x)"), y: num("y(polygon은 중심 y)"),
        width: num("가로"), height: num("세로"),
        radius: num("polygon 반지름"), sides: num("polygon 변 수(3~12, 기본 6)"), angle: num("polygon 회전(도)"),
        corner_radius: num("rounded 모서리(px)"),
        fill_color: color,
        stroke_color: color,
        stroke_width: num("선 두께(지정 시 외곽선 켜짐)"),
        no_fill: { type: "boolean" },
        name: { type: "string" },
      },
      required: ["kind", "x", "y"],
    },
  },
  {
    name: "apply_filter",
    description: "활성 레이어(선택 영역이 있으면 그 안)에 보정/필터를 적용한다(undo 가능). name과 params: "
      + "grayscale, invert, auto_tone, equalize, sepia, emboss, find_edges(파라미터 없음) | "
      + "brightness_contrast{brightness:-100~100, contrast:-100~100} | hue_saturation{hue:-180~180, saturation:-100~100, lightness:-100~100} | "
      + "levels{in_black:0, in_white:255, gamma:1, out_black:0, out_white:255, channel:rgb|r|g|b} | threshold{level:128} | posterize{levels:4} | "
      + "gradient_map{color_a, color_b} | gaussian_blur{radius:4} | sharpen{amount:0.8} | unsharp_mask{amount:50, radius:2, threshold:0} | "
      + "motion_blur{angle:0, distance:10} | median{radius:1} | mosaic{cell:10} | high_pass{radius:3} | add_noise{amount:24, mono:true}",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        params: { type: "object" },
        layer_id: { type: ["integer", "string"], description: "대상 레이어(생략 시 활성 레이어)" },
      },
      required: ["name"],
    },
    timeoutMs: 120000,
  },
  {
    name: "add_adjustment_layer",
    description: "비파괴 조정 레이어 추가. type: brightnessContrast{b,c} | hueSaturation{h,s,l} | posterize{levels} | threshold{level} | invert | grayscale | levels | curves(params 생략 시 기본값).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["brightnessContrast", "hueSaturation", "levels", "curves", "posterize", "threshold", "invert", "grayscale"] },
        params: { type: "object" },
      },
      required: ["type"],
    },
  },
  {
    name: "transform",
    description: "문서 전체 변형(undo 가능): rotate_cw, rotate_ccw, rotate_180, flip_h, flip_v, crop_to_selection, resize_image(리샘플), resize_canvas(좌상단 고정).",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["rotate_cw", "rotate_ccw", "rotate_180", "flip_h", "flip_v", "crop_to_selection", "resize_image", "resize_canvas"] },
        width: num("resize 가로"), height: num("resize 세로"),
        keep_aspect: { type: "boolean", description: "resize_image에서 width/height 중 하나만 줘도 비율 유지" },
      },
      required: ["op"],
    },
    timeoutMs: 120000,
  },
  {
    name: "set_colors",
    description: "전경색/배경색 설정(브러시·채우기 기본색).",
    inputSchema: { type: "object", properties: { foreground: color, background: color, swap: { type: "boolean" }, reset: { type: "boolean" } } },
  },
  {
    name: "history",
    description: "실행 취소/다시 실행. action: undo | redo, steps(기본 1).",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["undo", "redo"] }, steps: num("단계 수(기본 1)") },
      required: ["action"],
    },
  },
];
