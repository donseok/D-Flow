// 외부 API 테스트 공용 — resolveUserByEmail 은 profiles 를 eq('email', 정규화 값)으로 한 건 읽는다(0003).
// 기존 테스트가 쓰던 계정 목록 fixture(listUsers 시절 모양)를 그 조회의 응답 행으로 바꿔 준다.
import { displayNameFrom } from '@/lib/domain/display-name'

export interface FakeAccount {
  id: string
  email: string
  user_metadata?: Record<string, unknown>
  /** 삭제된 계정 — profiles 는 auth.users 삭제에 cascade 되므로 행이 없다. */
  deleted_at?: string
}

/** eq('email', email) 로 찾은 profiles 행. 없으면 null. */
export function profileRowFor(
  users: readonly FakeAccount[], email: unknown,
): { user_id: string; display_name: string } | null {
  if (typeof email !== 'string') return null
  const u = users.find(x => !x.deleted_at && x.email.toLowerCase() === email)
  return u ? { user_id: u.id, display_name: displayNameFrom(u.user_metadata, u.email) ?? u.email } : null
}

/**
 * 큐 스텁용 — profiles 조회에 큐 응답이 없으면 eq('email', 값) 시점에 계정 fixture 에서 찾아 응답 객체를 채운다.
 * 반환한 eq 를 빌더의 eq 자리에 끼운다. 다른 표·큐 응답이 있는 경우는 원래 eq(체인 반환)를 그대로 쓴다.
 */
export function profileEq<B>(
  b: B, resp: { data?: unknown }, users: readonly FakeAccount[],
): (col: string, val: unknown) => B {
  return (col, val) => { if (col === 'email') resp.data = profileRowFor(users, val); return b }
}
