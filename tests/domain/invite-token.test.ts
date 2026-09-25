import { describe, it, expect } from 'vitest'
import { hashInviteToken } from '@/lib/domain/inviteToken'

// DB 에는 초대 토큰의 sha256(hex)만 있다(0003 project_invites.token_hash). 발급·조회·소비가 같은 해시를 써야
// 링크가 열린다 — 규칙이 한 글자라도 어긋나면 모든 초대가 '찾을 수 없음'이 된다.
describe('hashInviteToken', () => {
  it('sha256 hex(소문자 64자) — 표준 벡터', () => {
    expect(hashInviteToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('Postgres encode(sha256(token::bytea), \'hex\') 와 같은 값 — UUID 토큰', () => {
    // docker exec supabase_db_d-flow psql -Atc "select encode(sha256('11111111-2222-4333-8444-555555555555'::bytea),'hex')"
    expect(hashInviteToken('11111111-2222-4333-8444-555555555555'))
      .toBe('cf4c4732fd3b8f8a55b60871950a2f22c893ea7afd75d2146826534e3f67cc49')
  })

  it('다른 토큰은 다른 해시', () => {
    expect(hashInviteToken('11111111-2222-4333-8444-555555555555'))
      .not.toBe(hashInviteToken('11111111-2222-4333-8444-555555555556'))
  })
})
