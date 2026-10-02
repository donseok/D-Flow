// 녹취 보정은 회의록 범위 tz(프로젝트 회의록 = 프로젝트, 무프로젝트 = 워크스페이스)로 한다(스펙 D13 ④·§8 #6).
// 액션 전체를 돌리지 않고, 액션이 쓰는 범위 해석기 minuteScopeTimezone 만 본다 — 해석은 resolveRequestCalendar 한 곳이다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ resolveRequestCalendar: vi.fn() }))
vi.mock('@/lib/calendar/load', () => ({ resolveRequestCalendar: m.resolveRequestCalendar }))

import { applyScopeTimeFix, minuteScopeTimezone } from '@/lib/minutes/timeFix.server'

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

describe('applyScopeTimeFix — 보정은 업로드를 막지 않는다(A-4 리뷰 N4)', () => {
  const SIGNED = ['- **날짜**: 2026-07-15', '- **시간**: 01:00 ~ 02:00', '- **상태**: 완료', '- **생성자**: 관리자'].join('\n')
  const SCOPE = { projectId: 'p-1', workspaceId: 'ws-1' }
  it('서명 없는 손글 md 는 범위 달력을 읽지 않는다(달력이 손상이어도 업로드된다)', async () => {
    const r = await applyScopeTimeFix('# 손으로 쓴 회의록', SCOPE, '2026-07-15')
    expect(r).toEqual({ fix: { body: '# 손으로 쓴 회의록', corrected: false } })
    expect(m.resolveRequestCalendar).not.toHaveBeenCalled()
  })
  it('서명이 있으면 범위 tz 로 보정', async () => {
    m.resolveRequestCalendar.mockResolvedValue({ timezone: 'Asia/Seoul', workingDays: new Set([1]), weekStart: [{ day: 'sunday', from: null }] })
    const r = await applyScopeTimeFix(SIGNED, SCOPE, '2026-07-15')
    expect(r.fix).toMatchObject({ corrected: true, to: '10:00 ~ 11:00', tz: 'Asia/Seoul' })
    expect(r.warning).toBeUndefined()
  })
  it('범위 달력을 못 읽으면 보정만 건너뛰고 경고 — 원문 그대로, 로그', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.resolveRequestCalendar.mockRejectedValue(new Error('설정을 불러오지 못해 중단했습니다.'))
    const r = await applyScopeTimeFix(SIGNED, SCOPE, '2026-07-15')
    expect(r).toEqual({ fix: { body: SIGNED, corrected: false }, warning: 'calendar_unavailable' })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('시각이 범위를 벗어나면 원문 그대로 + 경고 invalid_time', async () => {
    m.resolveRequestCalendar.mockResolvedValue({ timezone: 'Asia/Seoul', workingDays: new Set([1]), weekStart: [{ day: 'sunday', from: null }] })
    const r = await applyScopeTimeFix(SIGNED.replace('01:00 ~ 02:00', '25:00 ~ 26:00'), SCOPE, '2026-07-15')
    expect(r.fix.corrected).toBe(false)
    expect(r.warning).toBe('invalid_time')
  })
})
