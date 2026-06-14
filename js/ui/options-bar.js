// options-bar.js — 활성 도구에 맞는 옵션 컨트롤을 보여준다. 도구가 바뀌면 다시 그린다.

import { EVT, TOOL } from "../core/constants.js";

export class OptionsBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this._updaters = {}; // 외부(state)에서 값이 바뀔 때 컨트롤을 갱신하는 함수들
    app.bus.on(EVT.TOOL_CHANGED, () => this._render());
    app.bus.on(EVT.STATE_CHANGED, ({ key }) => {
      // 브러시 종류가 바뀌면 경도 표시 여부가 달라지므로 옵션바를 다시 구성한다
      if (key === "brushType" || key === "shapeType" || key === "dodgeBurnMode") this._render();
      else this._updaters[key]?.();
    });
    this._render();
  }

  _render() {
    this.el.innerHTML = "";
    this._updaters = {};
    const tool = this.app.tools.activeId;

    switch (tool) {
      case TOOL.BRUSH:
      case TOOL.PENCIL:
      case TOOL.ERASER:
        if (tool === TOOL.BRUSH) {
          this._select("브러시", "brushType", [
            ["round", "둥근"],
            ["square", "사각"],
            ["spatter", "스패터"],
            ["chalk", "분필"],
            ["calligraphy", "캘리그래피"],
          ]);
        }
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        if (tool !== TOOL.PENCIL) {
          // 경도는 둥근 브러시(및 지우개)에만 의미가 있다
          if (tool !== TOOL.BRUSH || this.app.state.brushType === "round") {
            this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100, "낮을수록 가장자리가 부드러워집니다 (0%=매우 부드러움, 100%=선명)");
          }
          this._slider("불투명도", "brushOpacity", 0, 1, 0.01, "%", 100);
        }
        break;
      case TOOL.BUCKET:
        this._slider("허용오차", "tolerance", 0, 255, 1);
        this._slider("불투명도", "brushOpacity", 0, 1, 0.01, "%", 100);
        this._checkbox("인접 영역만", "contiguous");
        break;
      case TOOL.GRADIENT:
        this._select("종류", "gradientType", [
          ["linear", "선형"], ["radial", "방사형"], ["angle", "각도"],
          ["reflected", "반사"], ["diamond", "다이아몬드"],
        ]);
        this._select("모드", "gradientColorMode", [
          ["fg-bg", "전경→배경"], ["fg-transparent", "전경→투명"],
        ]);
        this._slider("불투명도", "gradientOpacity", 0, 1, 0.01, "%", 100);
        this._checkbox("반전", "gradientReverse");
        break;
      case TOOL.WAND:
        this._slider("허용오차", "tolerance", 0, 255, 1);
        this._checkbox("인접 영역만", "contiguous");
        break;
      case TOOL.SHAPE:
        this._select("종류", "shapeType", [
          ["rect", "사각형"], ["ellipse", "타원"], ["line", "직선"],
          ["polygon", "다각형"], ["rounded", "둥근 사각형"],
        ]);
        this._checkbox("채우기", "shapeFill");
        this._checkbox("외곽선", "shapeStroke");
        this._slider("선 두께", "shapeStrokeWidth", 1, 100, 1, "px");
        if (this.app.state.shapeType === "polygon") this._slider("변 수", "polygonSides", 3, 12, 1);
        if (this.app.state.shapeType === "rounded") this._slider("모서리", "cornerRadius", 0, 100, 1, "px");
        break;
      case TOOL.SHAPELAYER:
        this._select("종류", "shapeType", [
          ["rect", "사각형"], ["ellipse", "타원"],
          ["polygon", "다각형"], ["rounded", "둥근 사각형"],
        ]);
        this._checkbox("채우기", "shapeFill");
        this._checkbox("외곽선", "shapeStroke");
        this._slider("선 두께", "shapeStrokeWidth", 1, 100, 1, "px");
        if (this.app.state.shapeType === "polygon") this._slider("변 수", "polygonSides", 3, 12, 1);
        if (this.app.state.shapeType === "rounded") this._slider("모서리", "cornerRadius", 0, 100, 1, "px");
        this._hint("드래그=셰이프 레이어 생성, 기존 셰이프 클릭=선택(셰이프 패널에서 색/획 재편집).");
        break;
      case TOOL.ZOOM:
        this._hint("클릭=확대, Alt+클릭=축소, 드래그=영역 확대.");
        break;
      case TOOL.TEXT:
        this._slider("크기", "fontSize", 6, 300, 1, "px");
        this._select("글꼴", "fontFamily", [
          ["Malgun Gothic, sans-serif", "맑은 고딕"],
          ["'Nanum Gothic', sans-serif", "나눔고딕"],
          ["'Batang', serif", "바탕"],
          ["'Gulim', sans-serif", "굴림"],
          ["Arial, sans-serif", "Arial"],
          ["'Times New Roman', serif", "Times"],
          ["'Courier New', monospace", "Courier"],
        ]);
        this._checkbox("굵게", "fontBold");
        this._checkbox("기울임", "fontItalic");
        break;
      case TOOL.MOVE:
        this._hint("드래그하여 현재 레이어를 이동합니다. (Shift: 수평/수직 고정)");
        break;
      case TOOL.MARQUEE:
        this._select("모양", "marqueeMode", [
          ["rect", "사각형"], ["ellipse", "타원"], ["row", "단일 행"], ["col", "단일 열"],
        ]);
        this._hint("드래그=사각형/타원 (Shift 정사각, Alt 중심) · 클릭=행/열. Ctrl+D 해제");
        break;
      case TOOL.LASSO:
        this._hint("자유롭게 드래그하여 영역을 선택합니다.");
        break;
      case TOOL.EYEDROPPER:
        this._hint("클릭하여 색을 추출합니다. (Alt+클릭: 배경색)");
        break;
      case TOOL.HAND:
        this._hint("드래그하여 화면을 이동합니다. (스페이스로 임시 전환 가능)");
        break;
      case TOOL.CLONE:
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("불투명도", "cloneOpacity", 0, 1, 0.01, "%", 100);
        this._checkbox("정렬", "cloneAligned");
        this._hint("Alt+클릭=소스 지정 후 드래그하여 복제.");
        break;
      case TOOL.DODGEBURN:
        this._select("모드", "dodgeBurnMode", [
          ["dodge", "닷지(밝게)"], ["burn", "번(어둡게)"], ["sponge", "스펀지(채도)"],
        ]);
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("노출", "dodgeExposure", 0, 1, 0.01, "%", 100);
        if (this.app.state.dodgeBurnMode === "sponge") {
          this._checkbox("채도 증가", "spongeSaturate");
        } else {
          this._select("범위", "dodgeRange", [
            ["shadows", "어두운 영역"], ["midtones", "중간 영역"], ["highlights", "밝은 영역"],
          ]);
        }
        break;
      case TOOL.RETOUCH:
        this._select("모드", "retouchMode", [
          ["blur", "흐리게"], ["sharpen", "선명하게"], ["smudge", "번짐"],
        ]);
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("강도", "retouchStrength", 0, 1, 0.01, "%", 100);
        break;
      case TOOL.HEALING:
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("불투명도", "healOpacity", 0, 1, 0.01, "%", 100);
        this._checkbox("정렬", "healAligned");
        this._hint("Alt+클릭=소스 지정 후 드래그하여 복구(주변 톤에 맞춰 자연 블렌드).");
        break;
      case TOOL.PATCH:
        this._hint("먼저 영역을 선택 → 선택 안을 잡고 깨끗한 영역으로 드래그하여 치환.");
        break;
      case TOOL.PEN:
        this._hint("클릭=앵커 추가, 드래그=곡선 핸들, 시작점 클릭=닫기, 앵커 클릭=삭제. 패스 패널에서 선택/채우기/획.");
        break;
      case TOOL.HISTORYBRUSH: {
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("불투명도", "brushOpacity", 0, 1, 0.01, "%", 100);
        const snaps = this.app.historyPanel?.snapshots || [];
        if (snaps.length === 0) {
          this._hint("히스토리 팔레트에서 스냅샷을 만든 뒤 사용하세요.");
        } else {
          const g = this._group();
          const lb = document.createElement("label"); lb.textContent = "소스"; g.appendChild(lb);
          const sel = document.createElement("select");
          snaps.forEach((s, i) => {
            const o = document.createElement("option"); o.value = i; o.textContent = s.name; sel.appendChild(o);
          });
          let cur = this.app.state.historyBrushSource ?? 0;
          if (cur >= snaps.length) cur = snaps.length - 1;
          sel.value = cur;
          sel.addEventListener("change", () => this.app.state.set("historyBrushSource", parseInt(sel.value, 10)));
          g.appendChild(sel);
        }
        break;
      }
      case TOOL.PATTERNSTAMP: {
        const pats = this.app.state.patterns || [];
        const g = this._group();
        const lb = document.createElement("label"); lb.textContent = "패턴"; g.appendChild(lb);
        const sel = document.createElement("select");
        pats.forEach((p, i) => {
          const o = document.createElement("option"); o.value = i; o.textContent = p.name; sel.appendChild(o);
        });
        sel.value = this.app.state.patternIndex ?? 0;
        sel.addEventListener("change", () => this.app.state.set("patternIndex", parseInt(sel.value, 10)));
        g.appendChild(sel);
        this._slider("크기", "brushSize", 1, 500, 1, "px");
        this._slider("경도", "brushHardness", 0, 1, 0.01, "%", 100);
        this._slider("불투명도", "patternOpacity", 0, 1, 0.01, "%", 100);
        this._checkbox("정렬", "patternAligned");
        break;
      }
      default:
        this._hint("도구를 선택하세요.");
    }
  }

  _group() {
    const g = document.createElement("div");
    g.className = "opt-group";
    this.el.appendChild(g);
    return g;
  }

  // 슬라이더. scale: 표시 단위 환산(예: 0~1 값을 % 100배). suffix: 뱃지 단위. hint: 그룹 툴팁.
  _slider(label, key, min, max, step, suffix = "", scale = 1, hint = "") {
    const g = this._group();
    if (hint) g.title = hint;
    const lb = document.createElement("label"); lb.textContent = label; g.appendChild(lb);
    const input = document.createElement("input");
    input.type = "range"; input.min = min; input.max = max; input.step = step;
    const badge = document.createElement("span"); badge.className = "val-badge";
    const fmt = () => (scale === 1 ? this.app.state[key] : Math.round(this.app.state[key] * scale)) + suffix;
    const sync = () => { input.value = this.app.state[key]; badge.textContent = fmt(); };
    input.addEventListener("input", () => { this.app.state.set(key, parseFloat(input.value)); badge.textContent = fmt(); });
    g.appendChild(input); g.appendChild(badge);
    this._updaters[key] = sync;
    sync();
  }

  _checkbox(label, key) {
    const g = this._group();
    const id = "cb_" + key;
    const input = document.createElement("input");
    input.type = "checkbox"; input.id = id; input.checked = !!this.app.state[key];
    input.addEventListener("change", () => this.app.state.set(key, input.checked));
    const lb = document.createElement("label"); lb.htmlFor = id; lb.textContent = label; lb.style.cursor = "pointer";
    g.appendChild(input); g.appendChild(lb);
    this._updaters[key] = () => { input.checked = !!this.app.state[key]; };
  }

  _select(label, key, options) {
    const g = this._group();
    const lb = document.createElement("label"); lb.textContent = label; g.appendChild(lb);
    const sel = document.createElement("select");
    for (const [val, text] of options) {
      const o = document.createElement("option"); o.value = val; o.textContent = text; sel.appendChild(o);
    }
    sel.value = this.app.state[key];
    sel.addEventListener("change", () => this.app.state.set(key, sel.value));
    g.appendChild(sel);
    this._updaters[key] = () => { sel.value = this.app.state[key]; };
  }

  _hint(text) {
    const g = this._group();
    g.style.color = "var(--text-dim)";
    g.textContent = text;
  }
}
