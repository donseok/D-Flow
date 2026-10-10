// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { toastFn, refreshFn } = vi.hoisted(() => ({ toastFn: vi.fn(), refreshFn: vi.fn() }))

const updateActual = vi.fn(async (): Promise<{ ok: boolean; error?: string; conflict?: boolean; code?: 'actual_locked' }> => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: (...a: unknown[]) => updateActual(...(a as [])) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshFn, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamLabel: () => (c: string) => c, useTeamCodes: () => ['PMO', 'ERP'], useTeams: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: toastFn }) }))

import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { makeProjectActorView } from '../fixtures/actor'

function n(id: string, over: Partial<ComputedItem> = {}, children: ComputedItem[] = []): ComputedItem {
  return {
    id, parentId: null, code: id, sortOrder: 0, name: id,
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30', weight: null,
    actualPct: children.length ? null : (over.rolledActualPct ?? 0), owners: over.owners ?? [{ team: 'PMO', kind: 'primary' }],
    isOwnerSplit: over.isOwnerSplit ?? false,
    plannedPct: 0, rolledActualPct: over.rolledActualPct ?? 0, achievement: null, status: over.status ?? 'in_progress', children, depth: 0,
  }
}
const ADMIN = makeProjectActorView({ userId: 'u-admin', projectRole: 'admin', memberId: 'm-admin', rosterTeamIds: ['t-pmo'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })

function tree(): ComputedItem[] {
  return [n('Phase', {}, [
    n('L0', { rolledActualPct: 0, status: 'not_started' }),
    n('L50', { rolledActualPct: 50, status: 'in_progress' }),
    n('L100', { rolledActualPct: 100, status: 'done' }),
  ])]
}

describe('KanbanBoard — 진행 모드 기본', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { updateActual.mockClear(); toastFn.mockClear(); refreshFn.mockClear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  afterEach(() => window.localStorage.clear())

  it('기본 뷰에서 시작전/진행중/완료 3컬럼과 각 카드 수를 보여준다', async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const heads = [...container.querySelectorAll('h3')].map(h => h.textContent)
    expect(heads).toEqual(['status.not_started', 'status.in_progress', 'status.done'])
  })

  it("진행중 카드의 '완료' 액션은 updateActual(id, 100, prev)를 부른다", async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const complete = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!
    await act(async () => complete.click())
    expect(updateActual).toHaveBeenCalledWith('L50', 100, 50)
  })

  it('저장 실패 시 낙관적 이동을 롤백하고 토스트를 부른다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    await act(async () => inc.click())
    // 실패 후 카드 %는 원복(50%)이어야 한다
    expect(container.textContent).toContain('50%')
    expect(toastFn).toHaveBeenCalled()
  })

  // 잠금 거부는 액션의 한국어 문구가 아니라 사전 문구로 — 영어 화면에 한국어 토스트가 뜨지 않게(사유는 code 로 고른다).
  // 그 밖의 실패도 액션 문구를 사전 키로 바꿔 그린다(SP4 D21 — src/lib/wbs/actionErrors.ts, tests/ui/wbs-toast-dict.test.tsx).
  it('잠금 거부(code=actual_locked)의 토스트는 사전 문구다 — 그 밖의 실패도 액션 문구의 사전 키', async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    updateActual.mockResolvedValueOnce({ ok: false, error: '완료는 승인 버튼으로 처리합니다', code: 'actual_locked' })
    await act(async () => inc.click())
    expect(toastFn).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'wbs.actualLocked', variant: 'error' }))
    updateActual.mockResolvedValueOnce({ ok: false, error: '담당 작업이 아님' })
    await act(async () => inc.click())
    expect(toastFn).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'wbs.err.notOwner', variant: 'error' }))
  })

  it('같은 카드에 대한 재진입(빠른 연속 클릭)은 updateActual을 한 번만 부른다', async () => {
    let resolvePending!: (v: { ok: boolean }) => void
    updateActual.mockImplementationOnce(() => new Promise(res => { resolvePending = res }))
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const complete = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!
    // 첫 요청이 아직 in-flight인 동안(동일 act 배치 내) 같은 버튼을 한 번 더 클릭.
    await act(async () => {
      complete.click()
      complete.click()
    })
    expect(updateActual).toHaveBeenCalledTimes(1)
    // 첫 요청을 정상 완료시켜 정리(펜딩 프라미스/act 경고 방지).
    await act(async () => { resolvePending({ ok: true }) })
  })

  it('내 팀 렌즈는 내 팀 담당 카드만 남긴다(명단 member)', async () => {
    const items = [n('P', {}, [
      n('mine', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
      n('other', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ])]
    const EDITOR = makeProjectActorView({ userId: 'u-editor', projectRole: 'member', memberId: 'm-editor', rosterTeamIds: ['t-erp'], rosterTeamCodes: ['ERP'], primaryTeamCode: 'ERP' })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={items} actorView={EDITOR} today="2026-07-25" />,
    ))
    // 기본 렌즈=myTeam(ERP) → 'mine'만, 'other' 없음
    expect(container.textContent).toContain('mine')
    expect(container.textContent).not.toContain('other')
  })

  it('여러 팀 소속이면 내 팀 렌즈가 그 팀들 담당 카드를 전부 보인다(대표 팀만이 아니다)', async () => {
    const items = [n('P', {}, [
      n('erp', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
      n('mes', { rolledActualPct: 50, owners: [{ team: 'MES', kind: 'support' }] }),
      n('pmo', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ])]
    const MULTI = makeProjectActorView({ projectRole: 'member', rosterTeamIds: ['t-erp', 't-mes'], rosterTeamCodes: ['ERP', 'MES'], primaryTeamCode: 'ERP' })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={items} actorView={MULTI} today="2026-07-25" />,
    ))
    expect(container.textContent).toContain('erp')
    expect(container.textContent).toContain('mes')
    expect(container.textContent).not.toContain('pmo')
  })

  it('명단 팀이 없는 멤버는 전체 렌즈로 시작한다', async () => {
    const items = [n('P', {}, [
      n('erp', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
      n('pmo', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ])]
    const NO_TEAM = makeProjectActorView({ projectRole: 'member' })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={items} actorView={NO_TEAM} today="2026-07-25" />,
    ))
    expect(container.textContent).toContain('erp')
    expect(container.textContent).toContain('pmo')
  })

  it('관리자는 팀이 있어도 전체 렌즈로 시작한다', async () => {
    const items = [n('P', {}, [
      n('erp', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
      n('pmo', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ])]
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={items} actorView={ADMIN} today="2026-07-25" />,
    ))
    expect(container.textContent).toContain('erp')
    expect(container.textContent).toContain('pmo')
  })

  it('최초 방문(로컬 플래그 없음·편집 가능)엔 코치마크가 뜨고, 닫으면 플래그가 저장된다', async () => {
    window.localStorage.removeItem('kanban.coach.v1')
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    expect(container.textContent).toContain('kanban.coachTitle')
    const dismiss = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.coachDismiss'))!
    await act(async () => dismiss.click())
    expect(window.localStorage.getItem('kanban.coach.v1')).toBe('1')
    expect(container.textContent).not.toContain('kanban.coachTitle')
  })

  it('빠른 필터로 모든 컬럼이 비면(지연 카드 없음) 필터 결과 0건 안내를 보여준다', async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    // tree()엔 delayed 상태 카드가 없으므로 '지연' 빠른필터를 켜면 세 컬럼 모두 0건이 된다.
    const overdueChip = [...container.querySelectorAll('button')].find(b => b.textContent === 'kanban.qfOverdue')!
    await act(async () => overdueChip.click())
    expect(container.textContent).toContain('kanban.noMatchTitle')
  })

  it('CAS 충돌(conflict) 응답 시 새로고침을 요청하고 충돌 토스트를 띄운다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, conflict: true })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    await act(async () => inc.click())
    expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ description: 'kanban.conflict' }))
    expect(refreshFn).toHaveBeenCalled()
  })

  it("시작전 카드의 '착수' 클릭은 진척 입력 팝오버(ProgressPopover)를 연다", async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} actorView={ADMIN} today="2026-07-25" />,
    ))
    const start = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.start'))!
    await act(async () => start.click())
    // Modal은 document.body로 포탈되므로 컨테이너가 아닌 body에서 확인한다.
    expect(document.body.textContent).toContain('kanban.progressTitle')
  })
})
