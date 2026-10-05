// 이슈 쓰기의 DB 토큰 → 고정 문구(계획 P11). 키 = dbToken(첫 낱말 — CONFIG_INVALID:… 는 'CONFIG_INVALID').
// 23505(issues_project_code_uidx)·40P01·55P03 은 SQLSTATE 라 호출부가 rpcFailure 앞에서 ERR_ISSUE_RETRY 로 거른다.
import type { OwnTokenTable } from '@/lib/errors/dbFail'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

export const ERR_ISSUE_RETRY = '다른 등록과 겹쳤습니다. 다시 시도하세요.'
export const ISSUE_DB_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  ISSUE_AREA_REQUIRED: '이 프로젝트는 이슈 영역을 골라야 코드가 매겨집니다.',
  ISSUE_AREA_INACTIVE: '비활성 영역에는 이슈를 등록할 수 없습니다.',
  ISSUE_AREA_NOT_FOUND: '영역을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.',
  ISSUE_AREA_IMMUTABLE: '영역으로 코드가 매겨진 이슈는 영역을 바꿀 수 없습니다.',
  ISSUE_CODE_EXHAUSTED: '이슈 코드 규칙으로 더 발번할 수 없습니다. 설정에서 코드 규칙을 바꾸세요.',
  CONFIG_INVALID: '이슈 코드 규칙 설정을 읽을 수 없습니다. 관리자에게 알리세요.',
  ISSUE_ANALYSIS_DISABLED: ERR_MODULE_DISABLED,
  ISSUE_ANALYSIS_REQUIRED: '분석 분류를 입력하세요.',
})
const STATUS: Readonly<Record<string, number>> = { ISSUE_AREA_NOT_FOUND: 404, ISSUE_ANALYSIS_DISABLED: 404, CONFIG_INVALID: 500 }
export const ISSUE_OWN_TOKENS: OwnTokenTable = Object.freeze(Object.fromEntries(
  Object.entries(ISSUE_DB_MESSAGES).map(([k, message]) => [k, { status: STATUS[k] ?? 400, code: k, message }])))
