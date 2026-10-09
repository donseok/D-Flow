// AI 제안 적용의 기대값(SPU1 — 개정 §5.8). 제안을 만들 때 본 값(target)을 쓰기 액션에 실어, 확인을 누르는 사이 바뀐 값을 덮지 않는다.
import { describe, expect, it, vi } from 'vitest'
import { applyCommandProposal, type ProposalActions } from '@/lib/ai/commands/apply'
import type { CommandProposal } from '@/lib/ai/commands/types'

type Proposal = Extract<CommandProposal, { kind: 'proposal' }>
const target = { id: 'i1', name: '설계 검토', phaseName: '설계', ownersText: '미배정', currentActual: 42.5, displayActual: 43, plannedStart: '2026-08-10', plannedEnd: '2026-08-20' }
const proposal = (action: Proposal['action'], params: Proposal['params']): Proposal => ({ kind: 'proposal', action, target, params, changes: [] })
const actions = (over: Partial<ProposalActions> = {}) => ({
  updateActual: vi.fn<ProposalActions['updateActual']>(async () => ({ ok: true })),
  updateWbsFields: vi.fn<ProposalActions['updateWbsFields']>(async () => ({ ok: true })),
  ...over,
})

describe('applyCommandProposal', () => {
  it('실적 — 제안 때의 원시 실적(표시값 아님)을 기대값으로 싣는다', async () => {
    const act = actions()
    expect(await applyCommandProposal(proposal('set_actual', { actualPct: 80 }), act)).toEqual({ ok: true })
    expect(act.updateActual).toHaveBeenCalledWith('i1', 80, 42.5)
    expect(act.updateWbsFields).not.toHaveBeenCalled()
  })

  it('날짜 — 바꾸는 칸만, 제안 때 본 그 칸의 값을 기대값으로 싣는다', async () => {
    const act = actions()
    await applyCommandProposal(proposal('set_dates', { plannedEnd: '2026-08-25' }), act)
    expect(act.updateWbsFields).toHaveBeenCalledWith('i1', { plannedEnd: '2026-08-25' }, { plannedEnd: '2026-08-20' })
    await applyCommandProposal(proposal('set_dates', { plannedStart: null, plannedEnd: '2026-08-25' }), act)
    expect(act.updateWbsFields).toHaveBeenLastCalledWith('i1', { plannedStart: null, plannedEnd: '2026-08-25' }, { plannedStart: '2026-08-10', plannedEnd: '2026-08-20' })
  })

  it('서버가 충돌로 답하면 쓰지 않은 것이다 — 서버의 현재 값을 말로 돌려준다', async () => {
    const dates = actions({ updateWbsFields: vi.fn(async () => ({ ok: false, conflict: true, error: 'x', latest: { plannedEnd: '2026-09-01' } })) })
    expect(await applyCommandProposal(proposal('set_dates', { plannedEnd: '2026-08-25' }), dates)).toEqual({ ok: false, conflict: true, latestText: '종료일 2026-09-01' })
    const cleared = actions({ updateWbsFields: vi.fn(async () => ({ ok: false, conflict: true, latest: { plannedStart: null } })) })
    expect(await applyCommandProposal(proposal('set_dates', { plannedStart: '2026-08-11' }), cleared)).toMatchObject({ conflict: true, latestText: '시작일 미정' })
    const actual = actions({ updateActual: vi.fn(async () => ({ ok: false, conflict: true, error: 'x', latest: 70 })) })
    expect(await applyCommandProposal(proposal('complete', { actualPct: 100 }), actual)).toEqual({ ok: false, conflict: true, latestText: '실적 70%' })
  })

  it('그 밖의 실패는 액션의 문구 그대로다', async () => {
    const act = actions({ updateWbsFields: vi.fn(async () => ({ ok: false, error: '권한 없음' })) })
    expect(await applyCommandProposal(proposal('set_dates', { plannedEnd: '2026-08-25' }), act)).toEqual({ ok: false, error: '권한 없음' })
  })
})
