import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ config: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.config }))

import { loadLocalDraftPolicy } from '@/lib/drafts/policy'
import { DRAFTS_OFF_POLICY } from '@/lib/drafts/storage'
import { settingDef } from '@/lib/settings/registry'
import { ConfigUnavailableError } from '@/lib/settings/errors'

const cfg = (state: Record<string, unknown>) => ({ keys: { 'security.local_drafts': state } })

describe('loadLocalDraftPolicy — 워크스페이스 security.local_drafts 의 서버 읽기(개정 §5.8.5)', () => {
  beforeEach(() => { h.config.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('저장된 값을 그대로 내린다', async () => {
    h.config.mockResolvedValue(cfg({ status: 'set', value: { allowed: false, retention_days: 14 } }))
    expect(await loadLocalDraftPolicy('ws-1')).toEqual({ allowed: false, retention_days: 14 })
    expect(h.config).toHaveBeenCalledWith('ws-1')
  })
  it('미설정이면 레지스트리 기본값(허용·7일)', async () => {
    const def = settingDef('workspace', 'security.local_drafts')!
    expect(def.default).toEqual({ allowed: true, retention_days: 7 })
    h.config.mockResolvedValue(cfg({ status: 'default', value: def.default }))
    expect(await loadLocalDraftPolicy('ws-1')).toEqual({ allowed: true, retention_days: 7 })
  })
  it('설정 조회 실패·손상 값·워크스페이스 모름은 초안을 끈다(fail-closed)와 로그', async () => {
    h.config.mockRejectedValue(new ConfigUnavailableError('down'))
    expect(await loadLocalDraftPolicy('ws-1')).toEqual(DRAFTS_OFF_POLICY)
    h.config.mockResolvedValue(cfg({ status: 'invalid', error: 'retention_days 는 정수여야 합니다.' }))
    expect(await loadLocalDraftPolicy('ws-1')).toEqual(DRAFTS_OFF_POLICY)
    h.config.mockClear()
    expect(await loadLocalDraftPolicy(null)).toEqual(DRAFTS_OFF_POLICY)
    expect(h.config).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(3)
  })
})
