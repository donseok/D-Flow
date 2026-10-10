import { describe, it, expect } from 'vitest'
import {
  projectLifecycleStatus,
  computeCompletionMap,
  leafStarted,
  type ProjectCompletion,
} from '@/lib/domain/project-status'

const done: ProjectCompletion = { hasWbs: true, allDone: true, anyStarted: true }
const notDone: ProjectCompletion = { hasWbs: true, allDone: false }
const started: ProjectCompletion = { hasWbs: true, allDone: false, anyStarted: true }
const noWbs: ProjectCompletion = { hasWbs: false, allDone: false }

describe('projectLifecycleStatus — 날짜+실제 완료율 결합 판정', () => {
  it('시작 전이면 ready', () => {
    expect(projectLifecycleStatus('2026-08-01', '2026-12-31', '2026-07-14', notDone)).toBe('ready')
  })
  it('기간 내면 active (완료율 무관)', () => {
    expect(projectLifecycleStatus('2026-07-01', '2026-12-31', '2026-07-14', notDone)).toBe('active')
  })
  it('종료일 경과 + 전 리프 완료면 done', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', done)).toBe('done')
  })
  it('종료일 경과 + 미완 리프 존재면 overdue (기존 결함의 수정 지점)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', notDone)).toBe('overdue')
  })
  it('종료일 경과 + WBS 없음이면 done (판단 근거 없음 — 날짜 기준 유지)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', noWbs)).toBe('done')
  })
  it('날짜 미설정이고 진행된 작업이 없으면 ready', () => {
    expect(projectLifecycleStatus(null, null, '2026-07-14', notDone)).toBe('ready')
    expect(projectLifecycleStatus(null, null, '2026-07-14', noWbs)).toBe('ready')
  })
})

describe('projectLifecycleStatus — WBS 진행이 날짜보다 먼저다(사용자 테스트 BUG-35)', () => {
  it('잎이 하나라도 진행됐으면 시작일 전·기간 미설정이어도 active (리포트: 진행 작업이 있는데 "시작 전")', () => {
    expect(projectLifecycleStatus('2026-10-12', '2026-12-31', '2026-10-10', started)).toBe('active')
    expect(projectLifecycleStatus(null, null, '2026-10-10', started)).toBe('active')
    expect(projectLifecycleStatus('2026-10-12', null, '2026-10-10', started)).toBe('active')
  })
  it('잎이 전부 완료면 날짜와 무관하게 done (홈: 진척 100% 인데 "시작 전")', () => {
    expect(projectLifecycleStatus(null, null, '2026-07-14', done)).toBe('done')
    expect(projectLifecycleStatus('2026-08-01', '2026-12-31', '2026-07-14', done)).toBe('done')
    expect(projectLifecycleStatus('2026-07-01', '2026-12-31', '2026-07-14', done)).toBe('done')
  })
  it('종료일이 지난 미완료는 진행 여부와 무관하게 기존 지연 규칙(overdue)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', started)).toBe('overdue')
  })
  it('진척을 모르면(null) 날짜만 본다 — 종료일 뒤는 unknown, 완료·진행으로 위장하지 않는다', () => {
    expect(projectLifecycleStatus('2026-08-01', '2026-12-31', '2026-07-14', null)).toBe('ready')
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', null)).toBe('unknown')
  })
  it('leafStarted — 실적 > 0 또는 진행 단계(ip·im·xx). 할당됨(as)·미착수는 아니다', () => {
    expect([leafStarted(0.1), leafStarted(0), leafStarted(null), leafStarted(0, 'ip'), leafStarted(null, 'im'), leafStarted(0, 'xx'), leafStarted(0, 'as'), leafStarted(0, null)])
      .toEqual([true, false, false, true, true, true, false, false])
  })
  it('computeCompletionMap — anyStarted 를 프로젝트별로 낸다', () => {
    const map = computeCompletionMap([
      { id: 'a', parentId: null, projectId: 'p1', actualPct: 0 },
      { id: 'b', parentId: null, projectId: 'p1', actualPct: 40 },
      { id: 'c', parentId: null, projectId: 'p2', actualPct: null, stage: 'ip' },
      { id: 'd', parentId: null, projectId: 'p3', actualPct: 0, stage: 'as' },
    ])
    expect([map.p1.anyStarted, map.p2.anyStarted, map.p3.anyStarted]).toEqual([true, true, false])
  })
})

describe('computeCompletionMap — 리프 판정(자식 유무) + 전량 완료', () => {
  it('자식 없는 행만 리프로 집계하고 프로젝트별로 묶는다', () => {
    const map = computeCompletionMap([
      { id: 'a', parentId: null, projectId: 'p1', actualPct: null }, // 부모
      { id: 'b', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'c', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'd', parentId: null, projectId: 'p2', actualPct: 50 }, // 단독 리프
    ])
    expect(map['p1']).toEqual({ hasWbs: true, allDone: true, anyStarted: true })
    expect(map['p2']).toEqual({ hasWbs: true, allDone: false, anyStarted: true })
  })
  it('done 판정은 원시값 >= 100 (99.5는 미완 — statusOf 규약과 동일)', () => {
    const map = computeCompletionMap([
      { id: 'x', parentId: null, projectId: 'p', actualPct: 99.5 },
    ])
    expect(map['p'].allDone).toBe(false)
  })
  it('빈 입력이면 빈 맵', () => {
    expect(computeCompletionMap([])).toEqual({})
  })
})
