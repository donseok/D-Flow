// npm run settings:verify 의 vitest 설정 — 로컬 DB 를 여러 번 왕복하는 점검이라 기본 타임아웃(5s·10s)으로는 느린 기계에서 끊긴다(N3).
import { describe, expect, it } from 'vitest'
import config from '../../vitest.config.verify'

describe('vitest.config.verify', () => {
  it('점검 한 건에 120초, 훅에 60초를 준다', () => {
    expect(config.test?.testTimeout).toBe(120_000)
    expect(config.test?.hookTimeout).toBe(60_000)
    expect(config.test?.include).toEqual(['scripts/settings-verify.check.ts'])
  })
})
