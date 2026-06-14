// adjustment-layer-dialog.js — 조정 레이어 파라미터 편집 다이얼로그.
//
// 조정 레이어는 비파괴이므로 픽셀을 직접 건드리지 않는다. 대신 layer.adjustmentParams 를
// 실시간으로 바꿔 재렌더(미리보기)하고, 확인 시 AdjustmentParamsCommand 로 undo 등록한다.
// 취소 시 진입 당시 파라미터로 되돌린다.
//
// 슬라이더 정의는 adjustment-layer.js 의 ADJUSTMENT_TYPES 메타에서 가져오므로
// 타입이 늘어도 이 파일은 수정할 필요가 없다.

import { adjustmentSliders, adjustmentLabel } from "../layers/adjustment-layer.js";
import { AdjustmentParamsCommand } from "../history/commands/adjustment-command.js";

// app, 조정 레이어 id 를 받아 편집 다이얼로그를 연다.
// 슬라이더가 없는 타입(반전/흑백 등)은 편집할 것이 없으므로 호출 측에서 거른다.
export function openAdjustmentLayerDialog(app, id) {
  const layer = app.layers.byId(id);
  if (!layer || layer.type !== "adjustment") return;

  const sliders = adjustmentSliders(layer.adjustmentType);
  if (!sliders.length) {
    app.status(`${adjustmentLabel(layer.adjustmentType)} 보정은 편집할 설정이 없습니다.`);
    return;
  }

  // 진입 당시 파라미터(취소 복원/undo before 용) 사본
  const before = { ...layer.adjustmentParams };
  // 작업용 현재 값(기존 값으로 초기화, 누락 키는 안전 기본 0/슬라이더 기본으로 보정은 apply 쪽에서 ?? 처리)
  const cur = { ...before };

  const body = document.createElement("div");
  body.style.width = "300px";

  // 라벨+슬라이더+값뱃지 한 줄 생성. 변경 시 cur 갱신 후 즉시 미리보기 재렌더.
  for (const s of sliders) {
    const row = document.createElement("div");
    row.className = "row";
    const lb = document.createElement("label");
    lb.textContent = s.label;
    lb.style.width = "70px";
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = s.min; inp.max = s.max; inp.step = s.step;
    inp.value = cur[s.key] ?? s.min;
    inp.style.flex = "1";
    const badge = document.createElement("span");
    badge.className = "val-badge";
    const fmt = (v) => v + (s.suffix || "");
    badge.textContent = fmt(inp.value);
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      cur[s.key] = v;
      badge.textContent = fmt(v);
      // 비파괴: 파라미터만 바꾸고 재렌더 → 합성 루프가 보정을 다시 적용
      layer.adjustmentParams = { ...cur };
      app.renderer.requestRender();
    });
    row.append(lb, inp, badge);
    body.appendChild(row);
  }

  app.dialogs.custom(adjustmentLabel(layer.adjustmentType), body,
    () => { // 확인: 변경이 있으면 undo 커맨드로 등록(현재 화면 상태는 이미 cur 반영됨)
      const changed = sliders.some((s) => (before[s.key] ?? null) !== (cur[s.key] ?? null));
      if (!changed) return;
      // 커맨드 redo 가 cur 을 다시 적용하므로, 등록 전 상태를 before 로 되돌릴 필요 없이
      // execute → redo(after=cur) 로 일관되게 반영한다.
      app.history.execute(new AdjustmentParamsCommand(app.layers, id, before, cur));
    },
    () => { // 취소: 진입 당시 파라미터로 원복 + 재렌더
      layer.adjustmentParams = { ...before };
      app.renderer.requestRender();
    },
    "적용");
}
