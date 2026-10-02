// 달력 설정 영향 미리보기(스펙 D38·D53·W20) — 서버가 그 프로젝트의 tz 로 '오늘'을 정하고, 문서 키를 끝까지 읽어
// previewWeekStart 로 계산한다. 화면이 보이는 E 는 저장 때 edit.toStored(applyWeekStartChange)가 만드는 E 와 같아야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyWeekStartChange, calendarOf, todayIn } from '@/lib/domain/calendar'

const m = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), getProjectConfig: vi.fn(), listWeekKeys: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz', async (orig) => ({ ...(await orig<Record<string, unknown>>()), requireProjectAdmin: m.requireProjectAdmin }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => ({ admin: { from: vi.fn() } }) }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/settings/weekKeys', () => ({ listWeekKeys: m.listWeekKeys }))

import { previewWeekStartChange } from '@/app/actions/settingsPreview'
import { previewWeekStartImpact } from '@/lib/settings/impactPreview'
import { ConfigKeyError } from '@/lib/settings/errors'

const PID = '00000000-0000-0000-7e57-0000000019a1'
const TZ = 'America/Los_Angeles'
const MONDAY = [{ day: 'monday' as const, from: null }]
const cfgWith = (weekStart = MONDAY) => ({
  projectId: PID, calendarError: null,
  calendar: calendarOf({ timezone: TZ, workingDays: [1, 2, 3, 4, 5], weekStart }),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
  m.getProjectConfig.mockResolvedValue(cfgWith())
  m.listWeekKeys.mockResolvedValue(['2026-09-14', '2026-09-21'])
})

describe('previewWeekStartImpact — 서버 계산(W20)', () => {
  // 2026-09-23T18:00Z = LA 09-23(수) 11:00 — 개정 §4.2.4 예시 첫 행(월→일, T=09-23 → E=09-27)
  const NOW = new Date('2026-09-23T18:00:00Z')

  it('E 가 applyWeekStartChange 의 새 원소 from 과 같다', async () => {
    const p = await previewWeekStartImpact({ from: vi.fn() } as never, { projectId: PID, day: 'sunday', now: NOW })
    const today = todayIn(TZ, NOW)
    const stored = applyWeekStartChange(MONDAY, 'sunday', today, 2)
    expect(stored.ok).toBe(true)
    const e = stored.ok ? stored.rules[stored.rules.length - 1].from : null
    expect(p.effectiveFrom).toBe(e)
    expect(p.effectiveFrom).toBe('2026-09-27')
    expect(p.transitionDays).toBe(6)
    expect(p.keptDocs).toBe(2)
    expect(p.blockingWeeks).toEqual([])
  })

  it('오늘은 프로젝트 tz 로 정한다 — UTC 로는 이미 목요일이어도 LA 가 수요일이면 같은 E', async () => {
    const lateUtc = new Date('2026-09-24T06:30:00Z')   // UTC 09-24(목) · LA 09-23(수) 23:30
    expect((await previewWeekStartImpact({ from: vi.fn() } as never, { projectId: PID, day: 'sunday', now: lateUtc })).effectiveFrom).toBe('2026-09-27')
  })

  it('E 뒤의 미래 문서가 있으면 막는 주차로 보인다(D53 과 같은 정의)', async () => {
    m.listWeekKeys.mockResolvedValue(['2026-09-21', '2026-09-28'])
    const p = await previewWeekStartImpact({ from: vi.fn() } as never, { projectId: PID, day: 'sunday', now: NOW })
    expect(p.blockingWeeks).toEqual(['2026-09-28'])
  })

  it('문서가 0건이면 즉시 교체 — E 없음', async () => {
    m.listWeekKeys.mockResolvedValue([])
    const p = await previewWeekStartImpact({ from: vi.fn() } as never, { projectId: PID, day: 'sunday', now: NOW })
    expect(p).toMatchObject({ effectiveFrom: null, transitionDays: null, keptDocs: 0, blockingWeeks: [] })
  })
})

describe('previewWeekStartChange — 가드·입력·실패 문구', () => {
  it('가드가 먼저 — 거부면 설정·문서를 읽지 않는다', async () => {
    m.requireProjectAdmin.mockResolvedValue({ ok: false, error: 'ERR_DENIED' })
    expect(await previewWeekStartChange(PID, 'sunday')).toEqual({ ok: false, error: 'ERR_DENIED' })
    expect(m.getProjectConfig).not.toHaveBeenCalled()
  })

  it('요일 밖 입력은 거부(목록·다른 요일)', async () => {
    for (const bad of ['tuesday', [{ day: 'sunday', from: null }]] as unknown[]) {
      expect(await previewWeekStartChange(PID, bad as 'sunday')).toMatchObject({ ok: false })
    }
    expect(m.getProjectConfig).not.toHaveBeenCalled()
  })

  it('달력 키가 손상이면 그 키를 밝힌 고정 문구 — 기본값으로 계산하지 않는다', async () => {
    m.getProjectConfig.mockResolvedValue({ projectId: PID, calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start') })
    const r = await previewWeekStartChange(PID, 'sunday')
    expect(r).toMatchObject({ ok: false })
    expect(r.ok ? '' : r.error).toContain('calendar.week_start')
  })

  it('조회 실패는 고정 문구(원문 0)', async () => {
    m.listWeekKeys.mockRejectedValue(new Error('select failed: relation "weekly_reports"'))
    const r = await previewWeekStartChange(PID, 'sunday')
    expect(r).toEqual({ ok: false, error: '영향을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
  })
})
