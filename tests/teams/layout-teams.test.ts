// 범위 레이아웃이 TeamsProvider 로 내리는 활성 팀(SP4 계획 P3) — 실패는 로그 + 빈 목록(셸·복구 화면 유지), Next 제어 신호는 다시 던진다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeTeamsForLayout } from '@/lib/teams/layoutTeams'
import { teamRows } from '../helpers/teams-source-mock'

afterEach(() => { vi.restoreAllMocks() })

describe('activeTeamsForLayout', () => {
  it('활성 팀만 — 순서는 원천 그대로, 이름·색이 실린다(Q23)', async () => {
    const rows = [...teamRows(['RES', 'OPS']), ...teamRows(['OLD'], { active: false })]
    const got = await activeTeamsForLayout(async () => rows, 't')
    expect(got.map((t) => t.code)).toEqual(['RES', 'OPS'])
    expect(got[0]).toMatchObject({ name: 'RES', color: '#6b7280' })
  })
  it('[RF2] 원천 실패(TeamsUnavailableError 류)는 로그 + 빈 목록 — 레이아웃이 던지지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await activeTeamsForLayout(async () => { throw new Error('팀 목록을 불러오지 못했습니다.') }, 'project layout')
    expect(got).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[project layout] 팀 조회 실패'), expect.stringContaining('팀 목록'))
  })
  it('[RF2] Next 의 동적 신호(DynamicServerError)는 삼키지 않고 다시 던진다 — 로그도 없다', async () => {
    const { DynamicServerError } = await import('next/dist/client/components/hooks-server-context')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const signal = new DynamicServerError("Route /p/x couldn't be rendered statically because it used `cookies`.")
    await expect(activeTeamsForLayout(async () => { throw signal }, 't')).rejects.toBe(signal)
    expect(err).not.toHaveBeenCalled()
  })
  it('[RF2] 원천이 Next 신호를 TeamsUnavailableError 의 cause 로 감싸 던져도 그 신호를 다시 던진다 — 로그·빈 목록으로 삼키지 않는다', async () => {
    const { DynamicServerError } = await import('next/dist/client/components/hooks-server-context')
    const { TeamsUnavailableError } = await import('@/lib/teams/source')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const signal = new DynamicServerError("Route /p/x couldn't be rendered statically because it used `cookies`.")
    const wrapped = new TeamsUnavailableError(undefined, { cause: signal })
    await expect(activeTeamsForLayout(async () => { throw wrapped }, 't')).rejects.toBe(signal)
    expect(err).not.toHaveBeenCalled()
  })
})
