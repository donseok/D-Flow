// tests/lib/staging-core.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseDsnRef, maskDsn,
} from '../../scripts/lib/staging-core.mjs'

const cfg = { stagingRef: 'stgrefstgrefstgrefst', prodRef: 'abcdefghijklmnopqrst' }
const dsn = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`

describe('parseDsnRef', () => {
  it('풀러 사용자명에서 ref를 뽑는다', () => {
    expect(parseDsnRef(dsn(cfg.stagingRef))).toBe(cfg.stagingRef)
    expect(parseDsnRef(`postgresql://staging_reader.${cfg.prodRef}:pw@h:5432/postgres`)).toBe(cfg.prodRef)
  })
  it('직결 호스트에서도 ref를 뽑는다', () => {
    expect(parseDsnRef(`postgresql://postgres:pw@db.${cfg.stagingRef}.supabase.co:5432/postgres`)).toBe(cfg.stagingRef)
  })
  it('못 찾으면 null', () => { expect(parseDsnRef('postgresql://x:y@localhost:5432/db')).toBeNull() })
})

describe('maskDsn', () => {
  it('비밀번호를 가린다', () => {
    expect(maskDsn(dsn(cfg.stagingRef))).not.toContain(':pw@')
    expect(maskDsn(dsn(cfg.stagingRef))).toContain('***')
  })
  it('[회귀] @ 포함 비밀번호도 전부 가린다', () => {
    // 버그: [^@]+이 첫 @에서 멈춰 'my@pass@host...' → '***@pass@host...'로 pass가 유출
    const dsnWithAtInPw = `postgresql://postgres.${cfg.stagingRef}:my@pass@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`
    const masked = maskDsn(dsnWithAtInPw)
    expect(masked).not.toContain('my@pass')
    expect(masked).not.toContain('pass') // 비밀번호 일부 노출 금지
    expect(masked).toContain('***@')
    expect(masked).toContain('aws-0-ap-northeast-2.pooler.supabase.com') // 호스트는 남음
  })
})
