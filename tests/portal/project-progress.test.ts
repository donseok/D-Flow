// 프로젝트 진척(W5 — 완료 잎/전체 잎)과 현황 근거 한 줄(스펙 §6.1 projects 위젯)
import { describe, expect, it } from 'vitest'
import { projectProgressMap, statusReason } from '@/lib/portal/projectProgress'

const P = 'p1', Q = 'p2'
describe('projectProgressMap — 잎만 센다(완료 = actual_pct ≥ 100, W5)', () => {
  const rows = [
    { id: 'a', parentId: null, projectId: P, actualPct: 50, plannedEnd: '2026-10-30' },             // 부모 — 세지 않는다
    { id: 'a1', parentId: 'a', projectId: P, actualPct: 100, plannedEnd: '2026-09-01' },
    { id: 'a2', parentId: 'a', projectId: P, actualPct: 99.9, plannedEnd: '2026-09-20' },          // 반올림 금지 — 미완
    { id: 'a3', parentId: 'a', projectId: P, actualPct: null, plannedEnd: '2026-10-05' },
    { id: 'b', parentId: null, projectId: Q, actualPct: 100, plannedEnd: null },
  ]
  const m = projectProgressMap(rows, '2026-10-01')
  it('완료·전체·다음 기한(오늘 이후 미완 잎의 가장 이른 기한)·지난 미완', () => {
    expect(m[P]).toEqual({ hasWbs: true, allDone: false, anyStarted: true, done: 1, total: 3, nextDue: '2026-10-05', overdueOpen: 1 })
    expect(m[Q]).toEqual({ hasWbs: true, allDone: true, anyStarted: true, done: 1, total: 1, nextDue: null, overdueOpen: 0 })
  })
  it('WBS 가 없는 프로젝트는 키가 없다(computeCompletionMap 과 같은 규칙)', () => { expect(m.p3).toBeUndefined() })
  it('오늘이 기한인 미완 잎은 지난 것이 아니라 다음 기한이다', () => {
    expect(projectProgressMap([{ id: 'x', parentId: null, projectId: P, actualPct: 0, plannedEnd: '2026-10-01' }], '2026-10-01')[P])
      .toMatchObject({ nextDue: '2026-10-01', overdueOpen: 0 })
  })
  it('오늘을 모르면(null) 기한 판정을 하지 않는다 — 완료·전체만', () => {
    expect(projectProgressMap(rows, null)[P]).toEqual({ hasWbs: true, allDone: false, anyStarted: true, done: 1, total: 3, nextDue: null, overdueOpen: 0 })
  })
})

describe('statusReason — 현황의 근거 한 줄', () => {
  it('상태마다', () => {
    expect(statusReason('active', { done: 12, total: 40, overdueOpen: 3 })).toBe('완료 12/40 · 기한 지난 작업 3')
    expect(statusReason('active', { done: 12, total: 40, overdueOpen: 0 })).toBe('완료 12/40')
    expect(statusReason('active', null)).toBe('WBS 없음')
    expect(statusReason('overdue', { done: 39, total: 40, overdueOpen: 1 })).toBe('종료일 지남 · 미완료 1')
    expect(statusReason('done', { done: 4, total: 4, overdueOpen: 0 })).toBe('종료일 지남 · 완료 4/4')
    expect(statusReason('done', null)).toBe('종료일 지남 · WBS 없음')
    expect(statusReason('ready', null)).toBe('시작 전')
    expect(statusReason('unknown', null)).toBe('진척을 확인하지 못했습니다')
  })
  it('[BUG-35] 종료일 전에 전부 끝낸 완료는 "종료일 지남"을 붙이지 않는다', () => {
    expect(statusReason('done', { done: 4, total: 4, overdueOpen: 0 }, undefined, false)).toBe('모든 작업 완료 4/4')
  })
  it('[BUG-35] anyStarted — 실적이 0 보다 크거나 진행 단계인 잎이 있으면 참(부모 행은 보지 않는다)', () => {
    const none = projectProgressMap([{ id: 'p', parentId: null, projectId: P, actualPct: 50, plannedEnd: null }, { id: 'x', parentId: 'p', projectId: P, actualPct: 0, plannedEnd: null }], null)
    expect(none[P].anyStarted).toBe(false)
    const staged = projectProgressMap([{ id: 'x', parentId: null, projectId: P, actualPct: null, plannedEnd: null, stage: 'ip' }], null)
    expect(staged[P].anyStarted).toBe(true)
  })
})
