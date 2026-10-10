// 대시보드 판정 기준(설정 dashboard.due_soon_days·dashboard.delayed_red_count)과 이슈 심각도 설정이 판정에 닿는다.
// 기본 인자(넘기지 않음)는 설정이 생기기 전의 코드 상수와 같은 결과여야 한다(동작 변화 0).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_THRESHOLDS, DEFAULT_DUE_SOON_DAYS, DELAYED_RED_COUNT, buildExecSummary, dueSoonLeaves, riskModel,
} from '@/lib/domain/dashboard'
import { detectRiskSignals } from '@/lib/domain/riskSignals'
import { DUE_SOON_DAYS, issueKpis, issueQueue, topSeverity, type DashboardIssue } from '@/lib/domain/issueDashboard'
import { DUE_URGENT_DAYS, isDueUrgent } from '@/lib/domain/issues'
import type { ComputedItem } from '@/lib/domain/types'

const TODAY = '2026-08-10'
let n = 0
const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: `l${(n += 1)}`, parentId: 'p', code: 'x', sortOrder: n,
  name: `작업 ${n}`, biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], depth: 0, ...over,
})
const issue = (over: Partial<DashboardIssue> = {}): DashboardIssue => ({
  id: `i${(n += 1)}`, code: `IS-${n}`, areaId: null, title: `이슈 ${n}`, status: 'open', severity: 'medium', dueDate: null, resolvedAt: null,
  createdAt: '2026-07-01T00:00:00+00:00', ...over,
})

describe('기본값 — 설정 전의 코드 상수 그대로', () => {
  it('임박 7일 · 지연 위험 4건, 이슈·목록 강조도 같은 7일', () => {
    expect(DEFAULT_DASHBOARD_THRESHOLDS).toEqual({ dueSoonDays: 7, delayedRedCount: 4 })
    expect([DEFAULT_DUE_SOON_DAYS, DUE_SOON_DAYS, DUE_URGENT_DAYS, DELAYED_RED_COUNT]).toEqual([7, 7, 7, 4])
  })
})

describe('마감 임박 창(dashboard.due_soon_days)', () => {
  const leaves = [leaf({ plannedEnd: '2026-08-12' }), leaf({ plannedEnd: '2026-08-17' }), leaf({ plannedEnd: '2026-08-20' }), leaf({ plannedEnd: '2026-08-12', status: 'done' })]
  it('작업 — 인자가 없으면 D-7 까지, 주면 그 일수까지(완료는 늘 제외)', () => {
    expect(dueSoonLeaves(leaves, TODAY).map(l => l.plannedEnd)).toEqual(['2026-08-12', '2026-08-17'])
    expect(dueSoonLeaves(leaves, TODAY, 3).map(l => l.plannedEnd)).toEqual(['2026-08-12'])
    expect(dueSoonLeaves(leaves, TODAY, 10).map(l => l.plannedEnd)).toEqual(['2026-08-12', '2026-08-17', '2026-08-20'])
  })
  it('요약(riskModel·buildExecSummary)의 임박 건수가 같은 창을 쓴다', () => {
    expect(riskModel(leaves, TODAY).dueSoon).toBe(2)
    expect(riskModel(leaves, TODAY, { dueSoonDays: 3, delayedRedCount: 4 }).dueSoon).toBe(1)
    expect(buildExecSummary(leaves, { startDate: null, endDate: null, today: TODAY }, [], { dueSoonDays: 10, delayedRedCount: 4 }).risk.dueSoon).toBe(3)
  })
  it('이슈 조치 대기 — 임박 창이 설정을 따른다(지연은 그대로)', () => {
    const issues = [issue({ dueDate: '2026-08-05' }), issue({ dueDate: '2026-08-12' }), issue({ dueDate: '2026-08-17' })]
    expect(issueQueue(issues, TODAY)).toMatchObject({ overdueCount: 1, dueSoonCount: 2 })
    expect(issueQueue(issues, TODAY, undefined, undefined, 3)).toMatchObject({ overdueCount: 1, dueSoonCount: 1 })
  })
  it('이슈 목록의 남은 일수 강조', () => {
    expect([isDueUrgent(7), isDueUrgent(8), isDueUrgent(null)]).toEqual([true, false, false])
    expect([isDueUrgent(7, 3), isDueUrgent(3, 3), isDueUrgent(-2, 3), isDueUrgent(10, 14)]).toEqual([false, true, true, true])
  })
  it('위험 신호(마감 임박 + 진척 정체)의 창과 문구가 설정을 따른다', () => {
    const stalled = [leaf({ plannedEnd: '2026-08-20', plannedPct: 80, rolledActualPct: 40 })]
    const base = { items: stalled, today: TODAY, realToday: TODAY, snapshots: [], startDate: null, endDate: null, minuteSignals: [], teams: [] }
    expect(detectRiskSignals(base).signals.find(s => s.kind === 'deadline_stall')).toBeUndefined()
    const wide = detectRiskSignals({ ...base, thresholds: { dueSoonDays: 14, delayedRedCount: 4 } }).signals.find(s => s.kind === 'deadline_stall')
    expect(wide?.detail).toContain('14일 내 마감 1건')
  })
})

describe("지연 '위험' 건수(dashboard.delayed_red_count)", () => {
  const delayed = (k: number) => Array.from({ length: k }, () => leaf({ status: 'delayed' }))
  it('기본 4건 이상 위험, 1~3건 주의, 0건 정상', () => {
    expect([riskModel(delayed(0), TODAY).signal, riskModel(delayed(3), TODAY).signal, riskModel(delayed(4), TODAY).signal]).toEqual(['green', 'amber', 'red'])
  })
  it('설정한 건수부터 위험', () => {
    expect(riskModel(delayed(3), TODAY, { dueSoonDays: 7, delayedRedCount: 2 }).signal).toBe('red')
    expect(riskModel(delayed(5), TODAY, { dueSoonDays: 7, delayedRedCount: 10 }).signal).toBe('amber')
  })
  it('위험 신호(예정일 경과 누적)의 심각도도 같은 건수를 쓴다', () => {
    const overdue = Array.from({ length: 2 }, () => leaf({ status: 'delayed', plannedEnd: '2026-08-08', plannedPct: 100, rolledActualPct: 50 }))
    const base = { items: overdue, today: TODAY, realToday: TODAY, snapshots: [], startDate: null, endDate: null, minuteSignals: [], teams: [] }
    const sev = (th?: { dueSoonDays: number; delayedRedCount: number }) =>
      detectRiskSignals({ ...base, ...(th ? { thresholds: th } : {}) }).signals.find(s => s.kind === 'overdue_accumulation')?.severity
    expect(sev()).toBe('amber')
    expect(sev({ dueSoonDays: 7, delayedRedCount: 2 })).toBe('red')
  })
})

describe('이슈 심각도(issues.severities)가 대시보드 집계에 닿는다', () => {
  const CUSTOM = [
    { code: 'blocker', label: '차단', rank: 1, color: 'delayed' as const, active: true },
    { code: 'major', label: '중대', rank: 2, color: 'pending' as const, active: true },
    { code: 'minor', label: '경미', rank: 3, color: 'neutral' as const, active: true },
  ]
  it("'가장 높은 심각도 · 미해결' — code 'high' 가 아니라 설정의 rank 최소 활성 항목을 센다", () => {
    const issues = [issue({ severity: 'blocker' }), issue({ severity: 'blocker', status: 'resolved' }), issue({ severity: 'major' }), issue({ severity: 'high' })]
    expect(issueKpis(issues, TODAY, 'UTC', CUSTOM).highUnresolved).toBe(1)
    // 넘기지 않으면 제품 기본 3단계(높음)
    expect(issueKpis(issues, TODAY, 'UTC').highUnresolved).toBe(1)
    expect(issueKpis([issue({ severity: 'high' }), issue({ severity: 'high' })], TODAY, 'UTC').highUnresolved).toBe(2)
  })
  it('최상위가 비활성이면 그 다음 활성 항목, 목록이 비면 없음(0)', () => {
    expect(topSeverity([{ ...CUSTOM[0], active: false }, CUSTOM[1], CUSTOM[2]])?.code).toBe('major')
    expect(topSeverity(CUSTOM.map(s => ({ ...s, active: false })))?.code).toBe('blocker')
    expect(topSeverity([])).toBeNull()
    expect(issueKpis([issue({ severity: 'high' })], TODAY, 'UTC', []).highUnresolved).toBe(0)
  })
  it('조치 대기의 같은 일수 안 정렬이 설정 rank 를 따르고, 목록 밖 code 는 뒤로 간다(정렬이 깨지지 않는다)', () => {
    const issues = [
      issue({ id: 'unknown', dueDate: '2026-08-12', severity: 'legacy' }), issue({ id: 'minor', dueDate: '2026-08-12', severity: 'minor' }),
      issue({ id: 'blocker', dueDate: '2026-08-12', severity: 'blocker' }), issue({ id: 'unknown2', dueDate: '2026-08-12', severity: 'old' }),
    ]
    expect(issueQueue(issues, TODAY, 10, CUSTOM).rows.map(r => r.issue.id)).toEqual(['blocker', 'minor', 'unknown', 'unknown2'])
  })
})
