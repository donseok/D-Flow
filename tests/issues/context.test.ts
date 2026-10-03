import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
const h = vi.hoisted(() => ({ config: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.config }))
import { loadIssueEntryContext, ERR_ISSUE_CONTEXT } from '@/lib/issues/context'
import { moduleState } from '@/lib/modules/gate'
beforeEach(() => { h.config.mockResolvedValue(makeProjectConfig()); vi.mocked(moduleState).mockResolvedValue('on') })
describe('등록 문맥', () => {
  it('모듈이 꺼지면 required 설정도 분석 off로 해석한다', async () => {
    h.config.mockResolvedValue(makeProjectConfig({ 'issues.analysis': 'required' }))
    vi.mocked(moduleState).mockResolvedValue('off')
    expect(await loadIssueEntryContext('p1')).toMatchObject({ ok: true, value: { rules: { analysis: 'off', areaRequired: false } } })
  })
  it('모듈 상태를 모르면 문맥을 제공하지 않는다', async () => {
    vi.mocked(moduleState).mockResolvedValue('unknown')
    expect(await loadIssueEntryContext('p1')).toEqual({ ok: false, error: ERR_ISSUE_CONTEXT })
  })
  it('설정 읽기 실패는 원문 없이 실패한다', async () => {
    h.config.mockRejectedValue(new Error('private DB detail'))
    expect(await loadIssueEntryContext('p1')).toEqual({ ok: false, error: ERR_ISSUE_CONTEXT })
  })
  it('손상된 정책을 기본값으로 대체하지 않는다', async () => {
    h.config.mockResolvedValue(makeProjectConfig({ 'issues.id_policy': null }))
    expect(await loadIssueEntryContext('p1')).toMatchObject({ ok: false })
  })
})
