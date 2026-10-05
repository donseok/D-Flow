/**
 * 이슈 업무 흐름 — 표시 상태 전이 판정(SP5b 스펙 D1·D4, 개정 §3.2.4). 순수 함수만.
 * 표시 상태 정의는 설정 `workflow.issue_statuses`(src/lib/settings/vocab.ts). 범주 사이 이동은 제품 고정 범주 전이표
 * (STATUS_TRANSITIONS — 11간선)를 따르고, 같은 범주 안 표시 상태끼리는 자유롭게 옮긴다(W2). 같은 규칙을 DB 트리거
 * enforce_issue_workflow 가 최종 판정한다(tests/fixtures/parity/issue-workflow.json 이 두 쪽을 실행 결과로 대조).
 * 역할 인자는 없다(W4 — 프로젝트별 전이표가 없다).
 */
import { STATUS_TRANSITIONS } from './issues'
import { orderedVocab, type IssueCategory, type IssueStatusDef } from '@/lib/settings/vocab'

/** 표시 상태 code — 기본 4개는 범주 code 와 같다. 이슈 행의 status_code 열 값 */
export type IssueStatusCode = string

const find = (defs: readonly IssueStatusDef[], code: string | null | undefined) =>
  code == null ? undefined : defs.find((d) => d.code === code)

/** code 의 범주. 정의에 없는 code(지워진·모르는 값)는 null — 호출부가 표시·로깅한다(기본값으로 풀지 않는다) */
export function categoryOf(defs: readonly IssueStatusDef[], code: string | null | undefined): IssueCategory | null {
  return find(defs, code)?.category ?? null
}

/** 새 이슈의 첫 상태 — open 범주의 첫 활성(sort 순). 정의가 불변식(open 활성 ≥1)을 어기면 null */
export function initialStatus(defs: readonly IssueStatusDef[]): IssueStatusDef | null {
  return orderedVocab(defs.filter((d) => d.active && d.category === 'open'))[0] ?? null
}

/** 범주 이동 허용 — 같은 범주면 참, 다르면 고정 전이표 */
export function categoryTransitionOk(from: IssueCategory, to: IssueCategory): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to)
}

/**
 * from → to 표시 상태 전이 허용. 대상은 정의에 있고 활성이어야 한다(비활성에서 나가는 것은 허용 — 옛 이슈가 갇히지 않게).
 * from 범주는 정의에서 읽되 정의에 없으면(지워진 code) fromCategory 로 준 행의 범주(issues.status)를 쓴다 — DB 트리거가 old.status 를 쓰는 것과 같다.
 */
export function canTransitionCode(
  defs: readonly IssueStatusDef[], fromCode: string, toCode: string, fromCategory?: IssueCategory,
): boolean {
  if (fromCode === toCode) return false
  const to = find(defs, toCode)
  if (!to || !to.active) return false
  const fromCat = fromCategory ?? categoryOf(defs, fromCode)
  if (!fromCat) return false
  return categoryTransitionOk(fromCat, to.category)
}

/** 화면 선택지 — 현재 상태에서 갈 수 있는 활성 표시 상태(정렬, 자기 제외) */
export function allowedTargets(defs: readonly IssueStatusDef[], fromCode: string, fromCategory?: IssueCategory): IssueStatusDef[] {
  return orderedVocab(defs).filter((d) => canTransitionCode(defs, fromCode, d.code, fromCategory))
}
