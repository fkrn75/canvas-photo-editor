// actions-manager.js — Actions(매크로) 녹화·재생 엔진.
//
// [무엇을 녹화/재생하나]
//   포토샵 Actions처럼 "결정적(deterministic)으로 다시 실행 가능한 작업"을 시퀀스로 모아 재생한다.
//   클로저(함수)는 직렬화/재실행이 어렵기 때문에, 재생 가능한 작업을 ID로 식별되는
//   "액션 레지스트리"로 정의하고, 녹화에는 { actionId, params } 만 기록한다.
//   재생은 그 ID로 레지스트리에서 실행 함수를 찾아 순서대로 호출한다 → 완전히 결정적.
//
// [재생 트릭]
//   app.applyFilter(title, fn) 은 다이얼로그 없이 즉시 fn(imageData)을 적용하고 히스토리에 커밋한다.
//   따라서 값이 있는 보정/필터도 fn = (img)=>Adjust.brightnessContrast(img, v.b, v.c) 로 감싸면
//   다이얼로그를 거치지 않고 그대로 재생할 수 있다(runAdjustment는 모달을 띄우므로 재생엔 부적합).
//
// [녹화 소스]
//   1) Actions 팔레트에서 사용자가 명시적으로 고른 액션(권장, 항상 재생 가능)
//   2) (보너스) command-manager 옵저버 훅으로 들어온 커맨드 label을 레지스트리 label과 역매핑
//      → 메뉴/단축키로 실행한 결정적 액션도 자동 포착. 매핑 실패 시 "재생 불가"로만 표시.
//
// 이 모듈은 새 파일이며 공유 파일을 수정하지 않는다. command-manager 옵저버 훅은
// 배선 스니펫으로 지휘자에게 제안한다(없어도 1번 경로로 완전히 동작).

import * as Adjust from "../engine/adjustments.js";
import * as Filters from "../engine/filters.js";

// ── 재생 가능한 액션 레지스트리 ──
// 각 항목: { id, label, group, params?, run(app, values) }
//   params: [{key,label,min,max,step,value,scale,suffix}] (Actions 추가 시 다이얼로그로 값 입력)
//   run   : 실제 실행(재생/즉시실행 공용). values 는 params 키로 채워진 객체.
function buildRegistry() {
  // 보정/필터를 다이얼로그 없이 즉시 적용하는 헬퍼들(applyFilter 재사용 → 히스토리 1단계).
  const filterRun = (label, fn) => (app) => app.applyFilter(label, fn);
  const computedRun = (label, computeFn) => (app, v) => app.applyFilter(label, (img) => computeFn(img, v));

  const list = [
    // ── 즉시 보정(값 없음) ──
    { id: "adj.grayscale", label: "흑백", group: "보정", run: filterRun("흑백", Adjust.grayscale) },
    { id: "adj.invert", label: "색 반전", group: "보정", run: filterRun("색 반전", Adjust.invert) },
    { id: "adj.autoTone", label: "자동 레벨", group: "보정", run: filterRun("자동 레벨", Adjust.autoTone) },
    { id: "adj.equalize", label: "균일화", group: "보정", run: filterRun("균일화", Adjust.equalize) },

    // ── 값 있는 보정(슬라이더) ──
    {
      id: "adj.brightnessContrast", label: "밝기/대비", group: "보정",
      params: [
        { key: "b", label: "밝기", min: -100, max: 100, step: 1, value: 0 },
        { key: "c", label: "대비", min: -100, max: 100, step: 1, value: 0 },
      ],
      run: computedRun("밝기/대비", (img, v) => Adjust.brightnessContrast(img, v.b, v.c)),
    },
    {
      id: "adj.hueSaturation", label: "색조/채도", group: "보정",
      params: [
        { key: "h", label: "색조", min: -180, max: 180, step: 1, value: 0 },
        { key: "s", label: "채도", min: -100, max: 100, step: 1, value: 0 },
        { key: "l", label: "밝기", min: -100, max: 100, step: 1, value: 0 },
      ],
      run: computedRun("색조/채도", (img, v) => Adjust.hueSaturation(img, v.h, v.s, v.l)),
    },

    // ── 즉시 필터(값 없음) ──
    { id: "flt.sepia", label: "세피아", group: "필터", run: filterRun("세피아", Filters.sepia) },
    { id: "flt.emboss", label: "엠보스", group: "필터", run: filterRun("엠보스", Filters.emboss) },
    { id: "flt.findEdges", label: "엣지 찾기", group: "필터", run: filterRun("엣지 찾기", Filters.findEdges) },

    // ── 값 있는 필터(슬라이더) ──
    {
      id: "flt.gaussianBlur", label: "가우시안 블러", group: "필터",
      params: [{ key: "r", label: "반경", min: 1, max: 100, step: 1, value: 4, suffix: "px" }],
      run: computedRun("가우시안 블러", (img, v) => Filters.gaussianBlur(img, v.r)),
    },
    {
      id: "flt.sharpen", label: "샤픈", group: "필터",
      params: [{ key: "a", label: "강도", min: 0, max: 300, step: 1, value: 80, scale: 0.01, suffix: "%" }],
      run: computedRun("샤픈", (img, v) => Filters.sharpen(img, v.a / 100)),
    },
    {
      id: "flt.addNoise", label: "노이즈 추가", group: "필터",
      params: [{ key: "a", label: "양", min: 1, max: 100, step: 1, value: 24 }],
      // 노이즈는 Math.random 사용 → 결과는 매번 다르지만 "노이즈를 N만큼 추가" 자체는 재현(파라미터 결정적).
      run: computedRun("노이즈 추가", (img, v) => Filters.addNoise(img, v.a, true)),
    },

    // ── 이미지/문서 변형(값 없음) ──
    { id: "img.rotateCW", label: "시계 방향 90°", group: "이미지", run: (app) => app.rotate90(1) },
    { id: "img.rotateCCW", label: "반시계 방향 90°", group: "이미지", run: (app) => app.rotate90(-1) },
    { id: "img.rotate180", label: "180° 회전", group: "이미지", run: (app) => { app.rotate90(1); app.rotate90(1); } },
    { id: "img.flipH", label: "좌우 뒤집기", group: "이미지", run: (app) => app.flip("h") },
    { id: "img.flipV", label: "상하 뒤집기", group: "이미지", run: (app) => app.flip("v") },

    // ── 레이어(값 없음) ──
    { id: "layer.duplicate", label: "레이어 복제", group: "레이어", run: (app) => app.layers.duplicateLayer() },
    { id: "layer.mergeDown", label: "아래로 병합", group: "레이어", run: (app) => app.layers.mergeDown() },
    { id: "layer.mergeVisible", label: "보이는 레이어 병합", group: "레이어", run: (app) => app.layers.mergeVisible() },
    { id: "layer.flatten", label: "이미지 평탄화", group: "레이어", run: (app) => app.flattenImage() },

    // ── 선택(값 없음) ──
    { id: "sel.all", label: "모두 선택", group: "선택", run: (app) => app.selectAll() },
    { id: "sel.deselect", label: "선택 해제", group: "선택", run: (app) => app.deselect() },
    { id: "sel.invert", label: "선택 반전", group: "선택", run: (app) => app.invertSelection() },
    { id: "edit.fillFg", label: "전경색으로 채우기", group: "편집", run: (app) => app.fillSelection(app.state.foreground) },
    { id: "edit.fillBg", label: "배경색으로 채우기", group: "편집", run: (app) => app.fillSelection(app.state.background) },
  ];

  const byId = new Map();
  const byLabel = new Map(); // label → action (command-manager 훅 역매핑용)
  for (const a of list) {
    byId.set(a.id, a);
    byLabel.set(a.label, a);
  }
  return { list, byId, byLabel };
}

export class ActionsManager {
  constructor(app) {
    this.app = app;
    const reg = buildRegistry();
    this.registry = reg.list;       // 팔레트가 "액션 추가" 메뉴로 사용
    this._byId = reg.byId;
    this._byLabel = reg.byLabel;

    // 액션 세트 목록. 각 세트: { id, name, steps:[{actionId, params, label}] }
    this.sets = [];
    this._seq = 0;
    this._newSet("기본 세트");
    this.currentSetId = this.sets[0].id;

    // 녹화 상태
    this.recording = false;
    this._recordSet = null;

    // 변경 통지 콜백(패널이 구독). PathManager.onChange 패턴과 동일.
    this.onChange = null;
  }

  // ── 세트 관리 ──
  _newSet(name) {
    this._seq += 1;
    const set = { id: "set-" + this._seq, name: name || `세트 ${this._seq}`, steps: [] };
    this.sets.push(set);
    return set;
  }
  addSet(name) {
    const s = this._newSet(name);
    this.currentSetId = s.id;
    this._changed();
    return s;
  }
  getSet(id) { return this.sets.find((s) => s.id === id) || null; }
  get currentSet() { return this.getSet(this.currentSetId) || this.sets[0]; }
  setCurrent(id) { if (this.getSet(id)) { this.currentSetId = id; this._changed(); } }
  removeSet(id) {
    const i = this.sets.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.sets.splice(i, 1);
    if (this.sets.length === 0) this._newSet("기본 세트");
    if (this.currentSetId === id) this.currentSetId = this.sets[0].id;
    this._changed();
  }
  renameSet(id, name) {
    const s = this.getSet(id);
    if (s && name) { s.name = name; this._changed(); }
  }

  // ── 스텝 관리 ──
  removeStep(setId, index) {
    const s = this.getSet(setId);
    if (!s || index < 0 || index >= s.steps.length) return;
    s.steps.splice(index, 1);
    this._changed();
  }
  clearSteps(setId) {
    const s = this.getSet(setId);
    if (!s) return;
    s.steps = [];
    this._changed();
  }

  // 레지스트리 액션 1개를 현재(또는 지정) 세트에 스텝으로 추가.
  //   values: params 가 있는 액션의 입력값(없으면 {}). 추가 즉시 재생도 옵션.
  addStep(actionId, values = {}, { runNow = false, setId = this.currentSetId } = {}) {
    const action = this._byId.get(actionId);
    if (!action) { this.app.status("알 수 없는 액션입니다."); return null; }
    const set = this.getSet(setId) || this.currentSet;
    const step = { actionId, params: { ...values }, label: action.label };
    set.steps.push(step);
    this._changed();
    if (runNow) this._runStep(step);
    return step;
  }

  // ── 녹화 ──
  startRecording(setId = this.currentSetId) {
    this._recordSet = this.getSet(setId) || this.currentSet;
    this.currentSetId = this._recordSet.id;
    this.recording = true;
    this.app.status(`녹화 시작: "${this._recordSet.name}"`);
    this._changed();
  }
  stopRecording() {
    this.recording = false;
    const n = this._recordSet ? this._recordSet.steps.length : 0;
    this._recordSet = null;
    this.app.status(`녹화 정지 (${n}단계)`);
    this._changed();
  }

  // 외부(예: command-manager 옵저버 훅)에서 "결정적 커맨드가 실행됐다"고 알릴 때 호출.
  // label 로 레지스트리를 역매핑해 재생 가능한 액션이면 녹화에 자동 추가한다.
  //   values 를 알 수 없으면(메뉴는 클로저로 값을 넘기므로) 파라미터 없는 액션만 자동 포착한다.
  // 반환: 추가됐으면 step, 아니면 null.
  noteCommand(label, values = null) {
    if (!this.recording || !this._recordSet) return null;
    const action = this._byLabel.get(label);
    if (!action) return null;
    // 값이 필요한 액션인데 값을 못 받으면(메뉴 경유) 자동 녹화 생략(재생 시 잘못된 기본값 방지).
    if (action.params && action.params.length > 0 && !values) return null;
    const step = { actionId: action.id, params: values ? { ...values } : {}, label: action.label };
    this._recordSet.steps.push(step);
    this._changed();
    return step;
  }

  // ── 재생 ──
  // 한 스텝 실행. 누락 파라미터는 레지스트리 기본값으로 채운다(안전).
  _runStep(step) {
    const action = this._byId.get(step.actionId);
    if (!action) { this.app.status(`재생 불가 액션 건너뜀: ${step.label || step.actionId}`); return false; }
    const values = {};
    if (action.params) for (const p of action.params) values[p.key] = step.params?.[p.key] ?? p.value;
    try {
      action.run(this.app, values);
      return true;
    } catch (e) {
      this.app.status(`액션 실행 오류(${action.label}): ${e.message}`);
      return false;
    }
  }

  // 세트 전체를 순서대로 재생. 재생 중에는 자기 자신이 녹화되지 않도록 일시 중단.
  play(setId = this.currentSetId) {
    const set = this.getSet(setId) || this.currentSet;
    if (!set.steps.length) { this.app.status("재생할 단계가 없습니다."); return; }
    const wasRecording = this.recording;
    this.recording = false; // 재생이 다시 녹화되는 것 방지
    let ok = 0;
    for (const step of set.steps) { if (this._runStep(step)) ok += 1; }
    this.recording = wasRecording;
    this.app.status(`"${set.name}" 재생 완료 (${ok}/${set.steps.length}단계)`);
  }

  _changed() { this.onChange?.(); }
}
