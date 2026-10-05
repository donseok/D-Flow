// 이슈 분석서 분류 메타 — 순수 함수만(I/O 없음).
// 영역 정본은 프로젝트 영역(project_areas kind issue_area — SP5 B1)이다.

import { VOCAB_CODE_RE } from '@/lib/settings/vocab'

export type IssueAreaFilter = 'all' | string

/** 이슈 원천 code — 프로젝트 설정 issues.sources(SP5 B4, 'minutes' 는 예약). 목록·라벨은 설정에서 읽는다 */
export type IssueSourceType = string

export const ISSUE_MAJOR_NAME_MAX = 100
/**
 * 02.01 같은 체번 접두가 이름에 박히는 것을 막는다 — 번호 정본은 DB 체번 + formatIssueMajorCode.
 * 템플릿 표기('02.01 주문관리')를 복사해 붙이면 dedupe 키가 갈라져 같은 Major가 이중 체번된다.
 * 0062 테이블 check·RPC 검증과 같은 패턴을 사용한다.
 */
export const ISSUE_MAJOR_NAME_NUMBERED_RE = /^\s*[\[({（【]?\s*\d{2}(?:\.\d{2})+/
export const ISSUE_SUB_PROCESS_MAX = 200
export const ISSUE_OWNER_DEPARTMENT_MAX = 100
export const ISSUE_RELATED_SYSTEMS_MAX = 20
export const ISSUE_RELATED_SYSTEM_MAX = 100
export const ISSUE_SOURCE_DETAIL_MAX = 1000

/** 프로젝트×영역 범위의 Major Process 기준정보(0062). major_seq 는 DB 트리거만 발급한다. */
export interface IssueMajorProcess {
  id: string
  projectId: string
  areaId: string
  majorSeq: number
  name: string
}

export interface IssueAnalysisInput {
  /** Major Process 이름. 같은 이름은 기존 체번을 재사용하고 새 이름은 다음 번호를 받는다. */
  majorName: string
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  sourceType: IssueSourceType
  sourceDetail: string
}

export interface NormalizedIssueAnalysisInput extends IssueAnalysisInput {
  relatedSystems: string[]
}

export type IssueAnalysisValidationResult =
  | { ok: true; value: NormalizedIssueAnalysisInput }
  | { ok: false; error: string }

/** 원천 code 의 형식만 본다 — 그 프로젝트에서 활성인지는 서버 액션(설정 issues.sources)과 DB 트리거(enforce_project_vocab)가 판정한다 */
export function isIssueSourceType(value: unknown): value is IssueSourceType {
  return typeof value === 'string' && VOCAB_CODE_RE.test(value)
}

/**
 * 서버 액션 인자는 브라우저가 임의로 만들 수 있으므로 타입 선언과 별개로 런타임 검증한다.
 * 회의록 출처는 불변 원문 검증이 끝난 전용 생성 경로만 허용한다.
 */
export function normalizeIssueAnalysisInput(
  input: IssueAnalysisInput,
  options: { allowMinutesSource?: boolean } = {},
): IssueAnalysisValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: '분석 분류 형식이 올바르지 않습니다.' }
  if (typeof input.majorName !== 'string' || !input.majorName.trim()) {
    return { ok: false, error: 'Major Process를 입력하세요.' }
  }
  const majorName = input.majorName.trim()
  if (majorName.length > ISSUE_MAJOR_NAME_MAX) {
    return { ok: false, error: `Major Process는 ${ISSUE_MAJOR_NAME_MAX}자 이하여야 합니다.` }
  }
  if (ISSUE_MAJOR_NAME_NUMBERED_RE.test(majorName)) {
    return { ok: false, error: 'Major Process는 번호 없이 이름만 입력하세요. 번호(02.01…)는 저장 시 자동 채번됩니다.' }
  }

  if (typeof input.subProcess !== 'string' || !input.subProcess.trim()) {
    return { ok: false, error: 'Sub Process를 입력하세요.' }
  }
  const subProcess = input.subProcess.trim()
  if (subProcess.length > ISSUE_SUB_PROCESS_MAX) {
    return { ok: false, error: `Sub Process는 ${ISSUE_SUB_PROCESS_MAX}자 이하여야 합니다.` }
  }

  if (typeof input.ownerDepartment !== 'string' || !input.ownerDepartment.trim()) {
    return { ok: false, error: '주관부서를 입력하세요.' }
  }
  const ownerDepartment = input.ownerDepartment.trim()
  if (ownerDepartment.length > ISSUE_OWNER_DEPARTMENT_MAX) {
    return { ok: false, error: `주관부서는 ${ISSUE_OWNER_DEPARTMENT_MAX}자 이하여야 합니다.` }
  }

  if (!Array.isArray(input.relatedSystems) || input.relatedSystems.some(v => typeof v !== 'string')) {
    return { ok: false, error: '관련 시스템 형식이 올바르지 않습니다.' }
  }
  if (input.relatedSystems.length > ISSUE_RELATED_SYSTEMS_MAX) {
    return { ok: false, error: `관련 시스템은 최대 ${ISSUE_RELATED_SYSTEMS_MAX}개까지 입력할 수 있습니다.` }
  }
  const relatedSystems = input.relatedSystems.map(v => v.trim())
  if (relatedSystems.some(v => !v)) {
    return { ok: false, error: '관련 시스템의 빈 항목을 제거하세요.' }
  }
  if (relatedSystems.some(v => v.length > ISSUE_RELATED_SYSTEM_MAX)) {
    return { ok: false, error: `관련 시스템 이름은 ${ISSUE_RELATED_SYSTEM_MAX}자 이하여야 합니다.` }
  }

  if (!isIssueSourceType(input.sourceType)) return { ok: false, error: '잘못된 이슈 원천입니다.' }
  if (input.sourceType === 'minutes' && !options.allowMinutesSource) {
    return { ok: false, error: '회의록 원천은 회의록의 이슈 등록 기능에서만 선택할 수 있습니다.' }
  }

  if (typeof input.sourceDetail !== 'string') return { ok: false, error: '이슈 원천 상세 형식이 올바르지 않습니다.' }
  const sourceDetail = input.sourceDetail.trim()
  if (sourceDetail.length > ISSUE_SOURCE_DETAIL_MAX) {
    return { ok: false, error: `이슈 원천 상세는 ${ISSUE_SOURCE_DETAIL_MAX}자 이하여야 합니다.` }
  }

  return {
    ok: true,
    value: {
      majorName,
      subProcess,
      ownerDepartment,
      relatedSystems: [...new Set(relatedSystems)],
      sourceType: input.sourceType,
      sourceDetail,
    },
  }
}

/** 영역 코드와 대분류 순번. 최소 2자리이며 자리 올림을 자르지 않는다. */
export function formatIssueMajorCode(areaCode: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Major 일련번호는 양의 정수여야 합니다.')
  return `${areaCode}.${String(sequence).padStart(2, '0')}`
}
