// WBS 값 규칙의 단일 출처(BUG-01·02·09) — 화면 편집(셀 편집기·범위 붙여넣기), 서버 액션(updateActual·updateWeight), 엑셀 가져오기가
// 같은 함수로 판정한다. 경로마다 규칙을 따로 적으면 한쪽이 빠진다(가져오기만 음수 가중치·범위 밖 실적%를 통과시켰다).
//
// ── 단위(정본) ──
// · 실적%(wbs_items.actual_pct): 0~100 의 % 값 그대로. 화면·엑셀·DB 가 같은 수다. DB CHECK(0~100)가 최종 관문이다.
// · 가중치(wbs_items.weight): **분수로 저장한다 — 1 = 100%**(0.5 = 50%). 화면은 % 로 보이고 입력받는다(format.ts weightToPct —
//   입력 60 → 저장 0.6 → 표시 60%). null = 형제 균등. 롤업은 형제 사이의 비율만 쓰므로 배율과 무관하지만, 표시는 배율을 그대로 드러낸다
//   (50 을 그대로 저장하면 5000% 로 보인다).
// · 엑셀의 가중치 열은 "엑셀에 보이는 %" 로 읽는다(importedWeightScale) — 에이전트 가져오기(wbs.md 의 weight)는 계약이 동결이라 받은 수를
//   그대로 저장한다(양수만 — src/lib/agent/wbsImport.ts). 두 경로 모두 저장 단위는 위의 분수다.

/** 규칙 위반 종류 — 문구는 호출부가 붙인다(화면은 사전, 가져오기는 행 오류 문구) */
export type WbsValueViolation = 'range' | 'weightMin'

/** 실적% — 유한한 수이고 0~100. 아니면 'range' */
export function actualPctViolation(value: number): 'range' | null {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? null : 'range'
}

/** 가중치 — 유한한 수이고 0 이상(상한 없음). 아니면 'weightMin'. 부호 판정이라 % 값·분수 어느 쪽을 넘겨도 결과가 같다.
 *  Infinity 는 JSON 직렬화에서 null(균등)로 둔갑해 이력과 어긋나므로 같이 막는다 */
export function weightViolation(value: number): 'weightMin' | null {
  return Number.isFinite(value) && value >= 0 ? null : 'weightMin'
}

/** 화면의 % 입력 → 저장 분수(60 → 0.6). 화면 편집과 엑셀 가져오기가 같은 환산을 쓴다 */
export function weightPctToFraction(pct: number): number {
  return pct / 100
}

/** 엑셀 가중치 칸 하나 — value 는 셀의 원래 수, percentFormat 은 그 칸이 % 서식(엑셀이 0.5 를 50% 로 보인다)인지 */
export interface ImportedWeightCell { value: number; percentFormat: boolean }

/**
 * 엑셀 가중치 열의 배율 — 파일 하나에 하나만 정한다(행마다 다르게 풀면 형제 비율이 깨진다).
 *  · % 서식 칸은 엑셀이 보여 주는 % 가 뜻이다: 값(분수)을 그대로 저장한다(0.5 → 50%).
 *  · 서식 없는 칸은 **화면과 같은 % 로 읽는다**(50 → 0.5 저장 → 50%). 화면에 50 을 넣은 것과 같은 결과다.
 *  · 예외 하나 — 서식 없는 값이 **전부 0~1** 이면 분수(합 1 관례)로 읽는다: 이전 양식·이전 내보내기 파일이 분수를 서식 없이 적었다.
 *    그 파일을 % 로 읽으면 50% 가 0.5% 로 보인다. 1 이하의 값만 있는 파일을 % 로 쓰는 경우(0.5% 같은 가중치)는 사실상 없다.
 * 어느 쪽이든 한 파일 안에서는 같은 배율이라 형제 비율(롤업)은 바뀌지 않는다. 반환 = 서식 없는 칸에 곱할 값(1 또는 1/100).
 */
export function importedWeightScale(cells: readonly ImportedWeightCell[]): 1 | 0.01 {
  const plain = cells.filter((c) => !c.percentFormat && Number.isFinite(c.value) && c.value >= 0)
  if (plain.length === 0) return 1
  return plain.every((c) => c.value <= 1) ? 1 : 0.01
}

/** 엑셀 가중치 칸 → 저장 분수. % 서식 칸은 그대로, 서식 없는 칸은 파일의 배율(importedWeightScale)로 — 환산은 화면과 같은 함수
 *  (weightPctToFraction)라 같은 수를 화면에 넣은 것과 같은 값이 저장된다 */
export function importedWeightToFraction(cell: ImportedWeightCell, scale: 1 | 0.01): number {
  return cell.percentFormat || scale === 1 ? cell.value : weightPctToFraction(cell.value)
}
