// 대시보드 판정 기준 두 키(dashboard.due_soon_days·dashboard.delayed_red_count) — 정의·parse·해석(dashboardThresholdsOf).
import { describe, expect, it } from 'vitest'
import { settingDef } from '@/lib/settings/registry'
import { dashboardThresholdsOf } from '@/lib/settings/dashboardThresholds'
import { DEFAULT_DASHBOARD_THRESHOLDS } from '@/lib/domain/dashboard'
import type { ProjectConfig } from '@/lib/settings/projectConfig'

const cfg = (keys: Record<string, unknown>) => ({ keys }) as unknown as Pick<ProjectConfig, 'keys'>

describe('dashboard.* 정의', () => {
  const days = settingDef('project', 'dashboard.due_soon_days')!
  const red = settingDef('project', 'dashboard.delayed_red_count')!
  it('기본값은 설정 전의 코드 상수(7일·4건) — 프로젝트 관리자, 즉시, 표시·판정 전용', () => {
    expect([days.default, red.default]).toEqual([7, 4])
    for (const d of [days, red]) {
      expect([d.scope, d.module, d.editor, d.apply, [...d.impact], d.sql]).toEqual(['project', 'dashboard', 'project_admin', 'immediate', ['recompute'], null])
      expect(d.widget).toEqual({ kind: 'custom', component: 'DashboardThresholdsEditor' })
    }
  })
  it('parse — 범위 안의 정수만. 문자열·소수·0·음수·상한 초과는 거부한다(조용히 고치지 않는다)', () => {
    expect(days.parse(1)).toEqual({ ok: true, value: 1 })
    expect(days.parse(60)).toEqual({ ok: true, value: 60 })
    expect(red.parse(999)).toEqual({ ok: true, value: 999 })
    for (const bad of [0, -1, 61, 7.5, '7', null, undefined, NaN, [7]]) expect(days.parse(bad).ok, String(bad)).toBe(false)
    for (const bad of [0, 1000, 2.5, '4', null]) expect(red.parse(bad).ok, String(bad)).toBe(false)
  })
})

describe('dashboardThresholdsOf', () => {
  it('저장값·기본값 상태를 읽는다', () => {
    expect(dashboardThresholdsOf(cfg({
      'dashboard.due_soon_days': { status: 'set', value: 14 }, 'dashboard.delayed_red_count': { status: 'default', value: 4 },
    }))).toEqual({ dueSoonDays: 14, delayedRedCount: 4 })
  })
  it('손상·누락은 그 키만 제품 기본값 — 던지지 않는다(WBS 로더가 부른다)', () => {
    expect(dashboardThresholdsOf(cfg({
      'dashboard.due_soon_days': { status: 'invalid', error: 'x' }, 'dashboard.delayed_red_count': { status: 'set', value: 2 },
    }))).toEqual({ dueSoonDays: DEFAULT_DASHBOARD_THRESHOLDS.dueSoonDays, delayedRedCount: 2 })
    expect(dashboardThresholdsOf(cfg({}))).toEqual(DEFAULT_DASHBOARD_THRESHOLDS)
    expect(dashboardThresholdsOf({} as unknown as Pick<ProjectConfig, 'keys'>)).toEqual(DEFAULT_DASHBOARD_THRESHOLDS)
  })
})
