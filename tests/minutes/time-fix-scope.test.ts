// 녹취 보정은 회의록 범위 tz(프로젝트 회의록 = 프로젝트, 무프로젝트 = 워크스페이스)로 한다(스펙 D13 ④·§8 #6).
// 액션 전체를 돌리지 않고, 액션이 쓰는 범위 해석기 minuteScopeTimezone 만 본다 — 해석은 resolveRequestCalendar 한 곳이다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ resolveRequestCalendar: vi.fn() }))
vi.mock('@/lib/calendar/load', () => ({ resolveRequestCalendar: m.resolveRequestCalendar }))

import { minuteScopeTimezone } from '@/lib/minutes/timeFix.server'

beforeEach(() => vi.clearAllMocks())

describe('minuteScopeTimezone', () => {
  it('프로젝트 회의록은 그 프로젝트의 달력', async () => {
    m.resolveRequestCalendar.mockResolvedValue({ timezone: 'America/Los_Angeles', workingDays: new Set([1, 2, 3, 4, 5]), weekStart: [{ day: 'sunday', from: null }] })
    await expect(minuteScopeTimezone({ projectId: 'p-1', workspaceId: 'ws-1' })).resolves.toBe('America/Los_Angeles')
    expect(m.resolveRequestCalendar).toHaveBeenCalledWith({ projectId: 'p-1', workspaceId: 'ws-1' }, undefined)
  })
  it('무프로젝트 회의록은 워크스페이스 달력(projectId null)', async () => {
    m.resolveRequestCalendar.mockResolvedValue({ timezone: 'Asia/Seoul', workingDays: new Set([1, 2, 3, 4, 5]), weekStart: [{ day: 'sunday', from: null }] })
    await expect(minuteScopeTimezone({ projectId: null, workspaceId: 'ws-1' })).resolves.toBe('Asia/Seoul')
    expect(m.resolveRequestCalendar).toHaveBeenCalledWith({ projectId: null, workspaceId: 'ws-1' }, undefined)
  })
  it('달력을 못 읽으면 throw — 보정을 조용히 건너뛰거나 서울로 대체하지 않는다', async () => {
    m.resolveRequestCalendar.mockRejectedValue(new Error('설정을 불러오지 못해 중단했습니다.'))
    await expect(minuteScopeTimezone({ projectId: 'p-1', workspaceId: 'ws-1' })).rejects.toThrow('설정')
  })
})
