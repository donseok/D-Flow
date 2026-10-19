import { describe, expect, it, vi } from 'vitest'
import { requestCache, withRequestCache } from '@/lib/server/requestCache'

describe('요청 안 중복 조회', () => {
  it('동시 호출도 같은 조회·같은 거절 프라미스를 공유한다', async () => {
    const query = vi.fn(async (id: string) => ({ id }))
    const read = requestCache(query)
    await withRequestCache(async () => {
      const [a, b] = await Promise.all([read('a'), read('a')])
      expect(a).toBe(b)
      expect(query).toHaveBeenCalledTimes(1)
      await read('b')
      expect(query).toHaveBeenCalledTimes(2)
    })
    const failure = vi.fn(async () => { throw new Error('DB unavailable') })
    const fail = requestCache(failure)
    await withRequestCache(async () => {
      const results = await Promise.allSettled([fail(), fail()])
      expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
      expect(failure).toHaveBeenCalledTimes(1)
    })
  })

  it('동시에 실행되는 사용자 요청과 다음 요청 사이에는 값을 공유하지 않는다', async () => {
    const query = vi.fn(async () => ({}))
    const read = requestCache(query)
    const values = await Promise.all([0, 1].map(() => withRequestCache(async () => {
      const first = await read()
      await new Promise(resolve => setTimeout(resolve, 1))
      expect(await read()).toBe(first)
      return first
    })))
    expect(values[0]).not.toBe(values[1])
    expect(query).toHaveBeenCalledTimes(2)
    await withRequestCache(() => read())
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('주입한 DB 클라이언트·인자 개수·함수가 다르면 다른 조회다', async () => {
    const query = vi.fn(async (...args: unknown[]) => args)
    const a = requestCache(query), b = requestCache(query)
    const client = {}, other = {}
    await withRequestCache(async () => {
      await Promise.all([a(client), a(client), a(other), a(client, undefined), b(client)])
      expect(query).toHaveBeenCalledTimes(4)
    })
  })

  it('명시적 요청 경계 밖에서는 값을 보관하지 않는다', async () => {
    const query = vi.fn(async () => ({}))
    const read = requestCache(query)
    expect(await read()).not.toBe(await read())
    expect(query).toHaveBeenCalledTimes(2)
  })
})
