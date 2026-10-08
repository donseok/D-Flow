// 이슈 보드 열 파생·이동 선택지·일괄 이동 판정(SPU2·SPU3 이월). 열과 선택지는 설정의 표시 상태 정의에서만 나온다 —
// 합성 구성 R 의 5상태(접수·검토·고객 승인·실행·종료)와 1상태·기본 4상태 구성으로 "코드에 상태가 박혀 있지 않다"를 본다.
import { describe, expect, it, vi } from 'vitest'
import {
  ISSUE_BOARD_PAGE, issueBoardColumns, issueMoveTargets, planBulkMove, runBulkMove,
} from '@/lib/domain/issueBoard'
import { DEFAULT_ISSUE_STATUSES, type IssueStatusDef } from '@/lib/settings/vocab'
import { RESEARCH_STATUSES, statusIssue } from '../fixtures/issue-statuses'

const codes = (defs: readonly IssueStatusDef[], issues = [] as ReturnType<typeof statusIssue>[]) =>
  issueBoardColumns(defs, issues).map(c => c.code)
const withInactive = (code: string) => RESEARCH_STATUSES.map(d => (d.code === code ? { ...d, active: false } : d))

describe('보드 열 = 활성 표시 상태(설정 순서)', () => {
  it('연구 5상태 — 이슈가 0건이어도 다섯 열이 설정 순서로 선다', () => {
    expect(codes(RESEARCH_STATUSES)).toEqual(['intake', 'review', 'client_approval', 'execution', 'done'])
    expect(issueBoardColumns(RESEARCH_STATUSES, []).every(c => c.kind === 'active' && c.cards.length === 0)).toBe(true)
  })
  it('순서는 배열 순서가 아니라 sort 다', () => {
    expect(codes([...RESEARCH_STATUSES].reverse())).toEqual(['intake', 'review', 'client_approval', 'execution', 'done'])
    const swapped = RESEARCH_STATUSES.map(d => (d.code === 'done' ? { ...d, sort: 0 } : d))
    expect(codes(swapped)[0]).toBe('done')
  })
  it('상태 1개 구성 — 열 하나', () => {
    const one: IssueStatusDef[] = [{ code: 'todo', label: '할 일', category: 'open', color: 'neutral', sort: 1, active: true }]
    const cols = issueBoardColumns(one, [statusIssue('a', 'todo'), statusIssue('b', 'todo')])
    expect(cols.map(c => [c.code, c.cards.length])).toEqual([['todo', 2]])
  })
  it('기본 4상태 — statusCode 가 없는 옛 행은 범주 code 열에 선다', () => {
    const legacy = { ...statusIssue('a', 'x'), statusCode: undefined, status: 'on_hold' as const }
    const cols = issueBoardColumns(DEFAULT_ISSUE_STATUSES, [legacy])
    expect(cols.map(c => c.code)).toEqual(['open', 'in_progress', 'resolved', 'on_hold'])
    expect(cols.find(c => c.code === 'on_hold')?.cards.map(i => i.id)).toEqual(['a'])
  })
  it('카드는 자기 표시 상태 열에, 넘겨받은 순서 그대로', () => {
    const cols = issueBoardColumns(RESEARCH_STATUSES, [statusIssue('b', 'review'), statusIssue('a', 'review'), statusIssue('c', 'done')])
    expect(cols.find(c => c.code === 'review')?.cards.map(i => i.id)).toEqual(['b', 'a'])
    expect(cols.find(c => c.code === 'done')?.cards.map(i => i.id)).toEqual(['c'])
  })
})

describe('비활성·정의에 없는 상태에 남은 이슈', () => {
  it('비활성 상태에 이슈가 없으면 열이 없다', () => {
    expect(codes(withInactive('review'))).toEqual(['intake', 'client_approval', 'execution', 'done'])
  })
  it('비활성 상태에 이슈가 남아 있으면 활성 열 뒤에 그 열을 둔다(감추지 않는다)', () => {
    const cols = issueBoardColumns(withInactive('review'), [statusIssue('a', 'review')])
    expect(cols.map(c => [c.code, c.kind])).toEqual([
      ['intake', 'active'], ['client_approval', 'active'], ['execution', 'active'], ['done', 'active'], ['review', 'inactive'],
    ])
    expect(cols.at(-1)?.cards.map(i => i.id)).toEqual(['a'])
  })
  it('정의에 없는 code 는 맨 뒤 unknown 열 — 범주는 그 행의 범주', () => {
    const cols = issueBoardColumns(RESEARCH_STATUSES, [statusIssue('a', 'gone', { status: 'in_progress' })])
    expect(cols.at(-1)).toMatchObject({ code: 'gone', kind: 'unknown', def: null, category: 'in_progress' })
    expect(cols).toHaveLength(6)
  })
})

describe('이동 선택지 = 전이표가 허용하는 활성 상태', () => {
  const targets = (defs: readonly IssueStatusDef[], code: string, over = {}) =>
    issueMoveTargets(defs, statusIssue('a', code, over)).map(d => d.code)
  it('접수에서는 나머지 넷 모두(같은 범주 검토 포함)', () => {
    expect(targets(RESEARCH_STATUSES, 'intake')).toEqual(['review', 'client_approval', 'execution', 'done'])
  })
  it('종료(resolved)에서 고객 승인(on_hold)은 전이표 밖이다', () => {
    expect(targets(RESEARCH_STATUSES, 'done')).toEqual(['intake', 'review', 'execution'])
  })
  it('자기 자신과 비활성 상태는 선택지에 없다', () => {
    expect(targets(withInactive('execution'), 'intake')).toEqual(['review', 'client_approval', 'done'])
  })
  it('비활성 상태에 남은 이슈는 나갈 수 있다(갇히지 않는다)', () => {
    expect(targets(withInactive('review'), 'review')).toEqual(['intake', 'client_approval', 'execution', 'done'])
  })
  it('정의에 없는 code 는 그 행의 범주로 판정한다', () => {
    expect(targets(RESEARCH_STATUSES, 'gone', { status: 'resolved' })).toEqual(['intake', 'review', 'execution', 'done'])
  })
  it('상태가 하나뿐이면 갈 곳이 없다', () => {
    const one: IssueStatusDef[] = [{ code: 'todo', label: '할 일', category: 'open', color: 'neutral', sort: 1, active: true }]
    expect(issueMoveTargets(one, statusIssue('a', 'todo'))).toEqual([])
  })
})

describe('일괄 이동 미리보기', () => {
  const picked = [statusIssue('a', 'intake'), statusIssue('b', 'done'), statusIssue('c', 'client_approval'), statusIssue('d', 'execution')]
  it('가능·불가를 건별로 나눈다 — 범주를 넘는 이동도 전이표대로', () => {
    const plan = planBulkMove(RESEARCH_STATUSES, picked, 'client_approval')
    expect(plan.target?.code).toBe('client_approval')
    expect(plan.movable.map(i => i.id)).toEqual(['a', 'd'])
    expect(plan.blocked.map(b => [b.issue.id, b.reason])).toEqual([['b', 'not_allowed'], ['c', 'same']])
  })
  it('비활성·정의에 없는 대상은 아무것도 옮기지 않는다', () => {
    for (const [defs, target] of [[withInactive('execution'), 'execution'], [RESEARCH_STATUSES, 'nope']] as const) {
      const plan = planBulkMove(defs, picked, target)
      expect(plan.target).toBeNull()
      expect(plan.movable).toEqual([])
      expect(plan.blocked).toHaveLength(4)
    }
  })
})

describe('일괄 이동 실행 — 건별로 같은 저장 한 길', () => {
  it('건마다 한 번, 화면이 본 상태를 기준값으로 보낸다', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    const progress: number[] = []
    const out = await runBulkMove([statusIssue('a', 'intake'), statusIssue('b', 'review')], 'execution', send, n => progress.push(n))
    expect(send.mock.calls).toEqual([
      ['a', { status: 'execution', expectedStatus: 'intake' }],
      ['b', { status: 'execution', expectedStatus: 'review' }],
    ])
    expect(out).toEqual([{ issueId: 'a', ok: true }, { issueId: 'b', ok: true }])
    expect(progress).toEqual([1, 2])
  })
  it('거부·충돌·예외가 나머지를 멈추지 않고 항목별 결과로 남는다', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: '허용되지 않는 상태 전환입니다.' })
      .mockResolvedValueOnce({ ok: false, conflict: true, error: '다른 사용자가 먼저 변경했습니다.' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true })
    const out = await runBulkMove(['a', 'b', 'c', 'd'].map(id => statusIssue(id, 'intake')), 'done', send)
    expect(send).toHaveBeenCalledTimes(4)
    expect(out).toEqual([
      { issueId: 'a', ok: false, error: '허용되지 않는 상태 전환입니다.', conflict: undefined },
      { issueId: 'b', ok: false, error: '다른 사용자가 먼저 변경했습니다.', conflict: true },
      { issueId: 'c', ok: false, error: null },
      { issueId: 'd', ok: true },
    ])
    quiet.mockRestore()
  })
})

it('열 상한은 양수다', () => { expect(ISSUE_BOARD_PAGE).toBeGreaterThan(0) })
