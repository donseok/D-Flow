import 'server-only'
// 초대 토큰 해시 — DB(project_invites.token_hash)에는 평문 토큰을 두지 않는다(0003).
// 테이블을 읽을 수 있는 사람(백업·로그·service_role 조회)이 곧 가입 자격을 갖지 않게 하려는 것이다.
// 발급(projectInvites)·조회·소비(inviteRedeem)가 이 함수 하나를 공유한다 — 규칙이 어긋나면 모든 링크가 '없음'이 된다.
// node:crypto 를 쓰므로 순수 도메인 모듈(invites.ts, 클라이언트 공용)과 분리해 서버 전용으로 둔다.
import { createHash } from 'node:crypto'

/** sha256(utf-8) 소문자 hex 64자. Postgres 의 encode(sha256(token::bytea), 'hex') 와 같은 값이다. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
