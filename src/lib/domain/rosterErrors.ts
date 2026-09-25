// 명단 쓰기(RPC upsert_project_member·명단 행 삭제)의 DB 오류 → 사용자 문구. 순수 모듈.
// 'use server' 파일(actions/roster.ts)은 async 함수만 내보낼 수 있어 매퍼를 여기 둔다.
//
// RPC·트리거는 SQLSTATE 를 여러 사유가 나눠 쓰므로(42501·23514) 코드가 아니라 메시지 토큰으로 가른다.
// 원시 Postgres 문자열은 화면에 올리지 않는다 — 제약·표 이름이 새고, 사용자는 다음 행동을 알 수 없다.
import { ERR_DENIED } from '@/lib/authz/errors'

export const ROSTER_WRITE_FAILED = '명단을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'

const BY_TOKEN: ReadonlyArray<readonly [string, string]> = [
  ['PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT',
    '계정이 연결되지 않은 사람에게는 권한을 줄 수 없습니다. 이메일로 초대하거나 계정을 먼저 만드세요.'],
  ['PROJECT_MEMBER_ADMIN_SLOT', '관리자 권한은 워크스페이스 관리자만 부여·회수할 수 있습니다.'],
  ['PROJECT_MEMBER_SELF_DEMOTE', '본인의 권한은 회수할 수 없습니다.'],
  ['PROJECT_MEMBER_CROSS_WORKSPACE', '다른 워크스페이스의 인물입니다.'],
  // 가드는 통과했는데 RPC 가 호출자 등급을 다시 보고 거부했다(그 사이 권한이 바뀐 경우) — 가드와 같은 문구.
  ['PROJECT_MEMBER_FORBIDDEN', ERR_DENIED],
  ['PROJECT_MEMBER_TEAM_SCOPE', '이 프로젝트에서 쓸 수 없는 팀입니다.'],
  ['PERSON_NOT_FOUND', '인물을 찾을 수 없습니다.'],
  ['PERSON_NAME_REQUIRED', '이름을 입력하세요.'],
  ['PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.'],
]

export function rosterWriteError(e: { code?: string; message: string }): string {
  for (const [token, text] of BY_TOKEN) if (e.message.includes(token)) return text
  if (e.code === '23505' && e.message.includes('people_ws_email_uidx')) {
    return '같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.'
  }
  // 담당 FK(wbs·이슈 담당자 등, on delete restrict) — 행을 지우는 대신 비활성으로 남기라고 안내한다.
  if (e.code === '23503') return '담당·참석 기록이 있는 사람은 삭제할 수 없습니다. 비활성으로 바꾸세요.'
  console.error('[roster] 명단 쓰기 실패:', e.code ?? '', e.message)
  return ROSTER_WRITE_FAILED
}
