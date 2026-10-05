import { describe, expect, it } from 'vitest'
import {
  SECURITY_LOCAL_DRAFTS_DEF,
  parseLocalDraftsSetting,
} from '@/lib/settings/defs/security'
import { KEY_PATTERN } from '@/lib/settings/registry'

describe('security.local_drafts 설정 정의 (개정 §5.8.5)', () => {
  it('키 이름이 KEY_PATTERN 을 준수하고 스코프/모듈/기본값이 올바르다', () => {
    expect(KEY_PATTERN.test(SECURITY_LOCAL_DRAFTS_DEF.key)).toBe(true)
    expect(SECURITY_LOCAL_DRAFTS_DEF.key).toBe('security.local_drafts')
    expect(SECURITY_LOCAL_DRAFTS_DEF.scope).toBe('workspace')
    expect(SECURITY_LOCAL_DRAFTS_DEF.module).toBe('settings')
    expect(SECURITY_LOCAL_DRAFTS_DEF.editor).toBe('workspace_admin')
    expect(SECURITY_LOCAL_DRAFTS_DEF.default).toEqual({
      allowed: true,
      retention_days: 7,
    })
  })

  it('기본값이 자기 parse 를 통과한다', () => {
    const parsed = SECURITY_LOCAL_DRAFTS_DEF.parse(SECURITY_LOCAL_DRAFTS_DEF.default)
    expect(parsed.ok).toBe(true)
  })

  it('parseLocalDraftsSetting 검증 로직이 올바르다', () => {
    // 1. 정상 파싱
    expect(parseLocalDraftsSetting({ allowed: false, retention_days: 14 })).toEqual({
      ok: true,
      value: { allowed: false, retention_days: 14 },
    })

    // 2. 객체 아님
    expect(parseLocalDraftsSetting('invalid').ok).toBe(false)
    expect(parseLocalDraftsSetting(null).ok).toBe(false)

    // 3. allowed 불리언 아님
    expect(parseLocalDraftsSetting({ allowed: 'yes', retention_days: 7 }).ok).toBe(false)

    // 4. retention_days 범위 위반 (1~30)
    expect(parseLocalDraftsSetting({ allowed: true, retention_days: 0 }).ok).toBe(false)
    expect(parseLocalDraftsSetting({ allowed: true, retention_days: 31 }).ok).toBe(false)
    expect(parseLocalDraftsSetting({ allowed: true, retention_days: 3.5 }).ok).toBe(false)
  })
})
