// 이슈 추이의 주(SP5 A 과제 16 — 스펙 §4.4 issueTrend 행) — 현재 규칙의 시작 요일로 12주를 거슬러 올라간다(과거 전환은 보지 않는다 — 표시 전용).
import { describe, expect, it } from 'vitest'
import { issueTrend, type DashboardIssue } from '@/lib/domain/issueDashboard'

const issue = (createdAt: string): DashboardIssue => ({
  id: createdAt, code: 'ISS-001', areaId: null, title: 't', status: 'open', severity: 'low',
  dueDate: null, resolvedAt: null, createdAt,
}) as DashboardIssue

describe('issueTrend — 주 시작 규칙', () => {
  it('일요일 규칙: 마지막 주는 오늘(10-14 수)이 속한 10-11(일)~10-17', () => {
    const m = issueTrend([issue('2026-10-11')], [{ day: 'sunday', from: null }], '2026-10-14', 'UTC')
    const last = m.points[m.points.length - 1]
    expect([last.weekStart, last.weekEnd]).toEqual(['2026-10-11', '2026-10-17'])
    expect(last.createdNew).toBe(1)
    expect(m.points).toHaveLength(12)
  })
  it('월요일 규칙(회귀): 마지막 주는 10-12(월)~10-18 — 10-11(일) 등록은 그 앞 주', () => {
    const m = issueTrend([issue('2026-10-11')], [{ day: 'monday', from: null }], '2026-10-14', 'UTC')
    const [prev, last] = m.points.slice(-2)
    expect([last.weekStart, last.weekEnd]).toEqual(['2026-10-12', '2026-10-18'])
    expect(prev.createdNew).toBe(1)
  })
  it('전환 규칙이면 현재 규칙(마지막 원소의 요일)으로만 센다 — 과거 전환은 보지 않는다', () => {
    const m = issueTrend([], [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }], '2026-10-14', 'UTC')
    expect(m.points.map(p => p.weekStart).slice(-3)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11'])
  })
})
