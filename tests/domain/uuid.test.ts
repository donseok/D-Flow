// 요청 번호 발급(M-3) — http 로 LAN IP 에 접속하면 보안 컨텍스트가 아니라 crypto.randomUUID 가 없다. getRandomValues 로 v4 를 만든다.
import { describe, expect, it, vi } from 'vitest'
import { newUuid } from '@/lib/domain/uuid'
import { isUuidLike } from '@/lib/domain/validate'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newUuid', () => {
  it('randomUUID 가 있으면 그것을 쓴다', () => {
    const c = { randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'), getRandomValues: vi.fn() }
    expect(newUuid(c)).toBe('11111111-1111-4111-8111-111111111111')
    expect(c.getRandomValues).not.toHaveBeenCalled()
  })
  it('randomUUID 가 없으면 getRandomValues 로 v4 를 만든다(버전·변형 니블 포함)', () => {
    const c = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => globalThis.crypto.getRandomValues(a as Uint8Array) as unknown as T }
    const ids = new Set(Array.from({ length: 50 }, () => newUuid(c)))
    expect(ids.size).toBe(50)
    for (const id of ids) { expect(id).toMatch(V4); expect(isUuidLike(id)).toBe(true) }
  })
  it('바이트가 모두 0xff 여도 버전·변형 비트를 강제한다', () => {
    const c = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => { (a as unknown as Uint8Array).fill(0xff); return a } }
    expect(newUuid(c)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })
})
