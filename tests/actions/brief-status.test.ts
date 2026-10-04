// AI 브리핑 상태 조회(SP5 B2 — D39, 개정 §8.1 #22): 회의·진척 이력 조회 실패를 '브리핑 없음'으로 보이지 않는다
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), loadProjectFacts: vi.fn(), getAiBrief: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: vi.fn() }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: h.loadProjectFacts }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: h.getAiBrief }))

import { getProjectBriefAction } from '@/app/actions/brief'

beforeEach(() => { vi.clearAllMocks(); h.getSession.mockResolvedValue({ id: 'u1' }) })

describe('getProjectBriefAction — 실패는 failed, 없음은 hasBrief:false', () => {
  it('사실 재료 조회가 던지면(회의 조회 실패 등) failed — 로그를 남긴다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.loadProjectFacts.mockRejectedValue(new Error('[projectFacts] 회의를 불러오지 못했습니다'))
    expect(await getProjectBriefAction('p1')).toEqual({ fresh: false, hasBrief: false, baseDate: null, failed: true })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('비로그인도 failed(상태를 판정하지 못했다)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getSession.mockResolvedValue(null)
    expect(await getProjectBriefAction('p1')).toMatchObject({ failed: true })
    err.mockRestore()
  })
  it('프로젝트가 없으면(볼 수 없음) 브리핑 없음 — failed 가 아니다', async () => {
    h.loadProjectFacts.mockResolvedValue(null)
    expect(await getProjectBriefAction('p1')).toEqual({ fresh: false, hasBrief: false, baseDate: null })
  })
})
