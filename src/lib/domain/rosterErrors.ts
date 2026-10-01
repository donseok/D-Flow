// 명단 쓰기(RPC upsert_project_member·consume_project_invite·명단 행 삭제)의 DB 오류 → 사용자 문구. 순수 모듈.
// 'use server' 파일(actions/roster.ts)은 async 함수만 내보낼 수 있어 매퍼를 여기 둔다.
//
// RPC·트리거는 SQLSTATE 를 여러 사유가 나눠 쓰므로(42501·23514) 코드가 아니라 메시지 토큰으로 가른다.
// 원시 Postgres 문자열은 화면에 올리지 않는다 — 제약·표 이름이 새고, 사용자는 다음 행동을 알 수 없다.
import { ERR_DENIED } from '@/lib/authz/errors'

export const ROSTER_WRITE_FAILED = '명단을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
/** 명단 행 삭제 거부 — 사전 검사(removeRosterMember)와 FK 위반(23503) 방어선이 같은 문구를 쓴다. */
export const ROSTER_HAS_RECORDS = '담당·참석 기록이 있는 사람은 삭제할 수 없습니다. 비활성으로 바꾸세요.'
/** 초대 수락의 INVITE_INACTIVE(0008) — RPC 가 비활성 인물과 비활성 명단 행을 한 토큰으로 내므로 어느 쪽인지 말하지 않는다.
 *  받는 사람은 초대 링크를 연 당사자라 조치는 관리자에게 맡긴다(관리자용 문구는 accounts.ts 의 ERR_INACTIVE). */
export const PERSON_INACTIVE = '비활성화된 인원입니다. 관리자에게 문의하세요.'

const BY_TOKEN: ReadonlyArray<readonly [string, string]> = [
  ['PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT',
    '계정이 연결되지 않은 사람에게는 권한을 줄 수 없습니다. 이메일로 초대하거나 계정을 먼저 만드세요.'],
  ['PROJECT_MEMBER_ADMIN_SLOT', '관리자 권한은 워크스페이스 관리자만 부여·회수할 수 있습니다.'],
  ['PROJECT_MEMBER_SELF_DEMOTE', '본인의 권한은 회수할 수 없습니다.'],
  ['PROJECT_MEMBER_CROSS_WORKSPACE', '다른 워크스페이스의 인물입니다.'],
  // 가드는 통과했는데 RPC 가 호출자 등급을 다시 보고 거부했다(그 사이 권한이 바뀐 경우) — 가드와 같은 문구.
  ['PROJECT_MEMBER_FORBIDDEN', ERR_DENIED],
  ['PROJECT_MEMBER_TEAM_SCOPE', '이 프로젝트에서 쓸 수 없는 팀입니다.'],
  // 같은 code 의 전용 팀이 있는 공용 팀을 새로 붙임(*_command_receipts ⑤′ team_ref_owned_scope) — 재시도로 풀리지 않는다
  ['TEAM_SCOPE_PROJECT_OWNED', '이 프로젝트에서 쓸 수 없는 팀입니다.'],
  ['PERSON_NOT_FOUND', '인물을 찾을 수 없습니다.'],
  ['PERSON_NAME_REQUIRED', '이름을 입력하세요.'],
  ['PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.'],
  ['INVITE_INACTIVE', PERSON_INACTIVE],
]

/**
 * RPC·트리거가 던진 명단 토큰만 문구로 바꾼다. 모르는 오류는 null — 호출부가 자기 맥락의 문구를 고른다
 * (초대 수락은 연결 오류를 '초대를 확인할 수 없어 중단했습니다.' 로 둔다). SQLSTATE 만으로는 판정하지 않는다.
 */
export function rosterTokenError(message: string): string | null {
  for (const [token, text] of BY_TOKEN) if (message.includes(token)) return text
  return null
}

export function rosterWriteError(e: { code?: string; message: string }): string {
  const byToken = rosterTokenError(e.message)
  if (byToken) return byToken
  if (e.code === '23505' && e.message.includes('people_ws_email_uidx')) {
    return '같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.'
  }
  // 0003 에서 project_members 를 참조하는 FK 는 전부 CASCADE·SET NULL 이라 지금은 23503 이 나지 않는다 —
  // removeRosterMember 가 삭제 전에 종속 행을 세어 같은 문구로 거부한다. 이 분기는 뒤에 RESTRICT FK 가 생길 때의 방어선이다.
  if (e.code === '23503') return ROSTER_HAS_RECORDS
  console.error('[roster] 명단 쓰기 실패:', e.code ?? '', e.message)
  return ROSTER_WRITE_FAILED
}
