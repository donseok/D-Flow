// WBS 「상태」 컬럼을 「진척」으로(스펙 2026-09-15 D6) — 에이전트 「단계」와 헷갈리지 않게 한다. 칩 값 4개는 그대로다.
import { describe, expect, it } from 'vitest'
import { wbsKo } from '@/lib/i18n/dict/wbs'

describe('WBS 진척 헤더', () => {
  it('「진척」', () => {
    expect(wbsKo['wbs.colStatus']).toBe('진척')
  })
})
