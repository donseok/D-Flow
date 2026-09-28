// domain/email canonicalEmail(P-1) — 인물 원장(명단·계정)과 초대 행이 같은 정규형(local@ASCII 호스트)을 쓴다.
// 수락 RPC 가 인물을 이메일 정확 일치로 찾으므로(0008) 두 값이 다르면 한 사람이 명단에 둘로 갈린다.
import { describe, expect, it } from 'vitest'
import { canonicalEmail } from '@/lib/domain/email'
import { canonicalInviteEmail } from '@/lib/domain/invites'

describe('canonicalEmail', () => {
  it('trim·소문자 뒤 호스트만 정규화한다(퓨니코드·끝 점 하나 제거)', () => {
    expect(canonicalEmail('kim@한글.kr')).toBe('kim@xn--bj0bj06e.kr')
    expect(canonicalEmail(' Alice@Acme.Test. ')).toBe('alice@acme.test')
    expect(canonicalEmail('kim@xn--bj0bj06e.kr')).toBe('kim@xn--bj0bj06e.kr')   // 멱등
  })
  it('로컬 파트 규칙은 초대보다 넓다 — 인물(외부 인력)은 호스트만 맞으면 매치된다', () => {
    expect(canonicalEmail('홍길동@acme.test')).toBe('홍길동@acme.test')
  })
  it('형식이 아니거나 호스트가 형태가 아니면 null', () => {
    expect(canonicalEmail('broken-email')).toBeNull()
    expect(canonicalEmail('kim@acme.test/x')).toBeNull()
    expect(canonicalEmail('a@b@acme.test')).toBeNull()
    expect(canonicalEmail('alice@127.0.0.1')).toBeNull()
  })
  it.each(['kim@한글.kr', 'alice@acme.test.', 'Alice@ACME.test', ' Bob@Acme.한국 '])('초대 행 이메일과 인물 이메일이 같은 문자열이다 — %s', (raw) => {
    expect(canonicalEmail(raw)).not.toBeNull()
    expect(canonicalEmail(raw)).toBe(canonicalInviteEmail(raw))
  })
})
