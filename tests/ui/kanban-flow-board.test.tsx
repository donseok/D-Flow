// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import {
  groupByFlow,
  formatApprovalStepsSubtitle,
  FLOW_STAGE_KEYS,
} from '@/lib/domain/kanban'
import type { ApprovalStepDef } from '@/lib/domain/approvalSteps'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { toastFn, refreshFn, setWbsStageMock, approveWbsStepMock } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  refreshFn: vi.fn(),
  setWbsStageMock: vi.fn(async () => ({ ok: true })),
  approveWbsStepMock: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/app/actions/wbsAssign', () => ({
  setWbsStage: (...a: unknown[]) => setWbsStageMock(...(a as [])),
  approveWbsStep: (...a: unknown[]) => approveWbsStepMock(...(a as [])),
}))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshFn, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('group=flow'),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({
  useTeamCodes: () => ['PMO', 'DEV'],
  useTeams: () => [],
  useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }),
}))
vi.mock('@/components/chat/BotPageContextProvider', () => ({
  useBotPageContext: () => {},
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { KanbanCard } from '@/components/kanban/KanbanCard'
import { makeProjectActorView } from '../fixtures/actor'

function n(id: string, over: Partial<ComputedItem> = {}, children: ComputedItem[] = []): ComputedItem {
  return {
    id, parentId: null, code: id, sortOrder: 0, name: id,
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30', weight: null,
    actualPct: children.length ? null : (over.rolledActualPct ?? 0),
    owners: over.owners ?? [{ team: 'PMO', kind: 'primary' }],
    isOwnerSplit: over.isOwnerSplit ?? false,
    plannedPct: 0, rolledActualPct: over.rolledActualPct ?? 0, achievement: null,
    status: over.status ?? 'in_progress', children, depth: 0, ...over,
  }
}

const ADMIN = makeProjectActorView({
  userId: 'u-admin',
  projectRole: 'admin',
  memberId: 'm-admin',
  rosterTeamIds: ['t-pmo'],
  rosterTeamCodes: ['PMO'],
  primaryTeamCode: 'PMO',
})

function sampleFlowTree(): ComputedItem[] {
  return [
    n('Phase', {}, [
      n('TaskNone', { stage: null, rolledActualPct: 0 }),
      n('TaskAs', { stage: 'as', rolledActualPct: 10 }),
      n('TaskIp', { stage: 'ip', rolledActualPct: 50 }),
      n('TaskIm', { stage: 'im', rolledActualPct: 90 }),
      n('TaskXx', { stage: 'xx', rolledActualPct: 100 }),
    ]),
  ]
}

describe('groupByFlow — 순수 도메인 함수', () => {
  it('5단계 컬럼(none, as, ip, im, xx)을 생성하고 각 카드를 올바른 단계에 배정한다', () => {
    const cols = groupByFlow(sampleFlowTree())
    expect(cols.map(c => c.key)).toEqual(FLOW_STAGE_KEYS)
    expect(cols.find(c => c.key === 'none')?.cards.map(c => c.id)).toEqual(['TaskNone'])
    expect(cols.find(c => c.key === 'as')?.cards.map(c => c.id)).toEqual(['TaskAs'])
    expect(cols.find(c => c.key === 'ip')?.cards.map(c => c.id)).toEqual(['TaskIp'])
    expect(cols.find(c => c.key === 'im')?.cards.map(c => c.id)).toEqual(['TaskIm'])
    expect(cols.find(c => c.key === 'xx')?.cards.map(c => c.id)).toEqual(['TaskXx'])
  })

  it('stage가 없는 항목이나 알 수 없는 stage는 none(미착수) 컬럼으로 안전하게 흡수한다', () => {
    const items = [
      n('TaskNoStage', { stage: undefined }),
      n('TaskUnknown', { stage: 'invalid_code' as unknown as string }),
    ]
    const cols = groupByFlow(items)
    const noneCol = cols.find(c => c.key === 'none')!
    expect(noneCol.cards.map(c => c.id)).toEqual(['TaskNoStage', 'TaskUnknown'])
    expect(noneCol.count).toBe(2)
  })

  it('사용자 정의 stageLabels를 컬럼 제목에 반영한다', () => {
    const labels = {
      none: '대기 중',
      as: '담당 배정',
      ip: '개발 진행',
      im: '코드 리뷰',
      xx: '배포 완료',
    }
    const cols = groupByFlow(sampleFlowTree(), labels)
    expect(cols.map(c => c.title)).toEqual(['대기 중', '담당 배정', '개발 진행', '코드 리뷰', '배포 완료'])
  })

  it('approvalSteps에 따라 im 컬럼의 subtitle을 알맞게 포맷한다', () => {
    expect(formatApprovalStepsSubtitle(null)).toBe('1단계 승인 (검토)')
    expect(formatApprovalStepsSubtitle([])).toBe('1단계 승인 (검토)')

    const steps1: ApprovalStepDef[] = [{ code: 'review', label: '코드 리뷰', approver: 'subtree_or_admin' }]
    expect(formatApprovalStepsSubtitle(steps1)).toBe('1단계 승인 (코드 리뷰)')

    const steps2: ApprovalStepDef[] = [
      { code: 'lead', label: '팀장 승인', approver: 'subtree_or_admin' },
      { code: 'pm', label: 'PM 최종 승인', approver: 'admin' },
    ]
    expect(formatApprovalStepsSubtitle(steps2)).toBe('2단계 승인 (팀장 승인 → PM 최종 승인)')

    const cols = groupByFlow(sampleFlowTree(), null, steps2)
    const imCol = cols.find(c => c.key === 'im')!
    expect(imCol.subtitle).toBe('2단계 승인 (팀장 승인 → PM 최종 승인)')
  })
})

describe('KanbanBoard — 흐름(flow) 모드 화면', () => {
  let container: HTMLDivElement, root: Root

  beforeEach(() => {
    setWbsStageMock.mockClear()
    approveWbsStepMock.mockClear()
    toastFn.mockClear()
    refreshFn.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('흐름 모드에서 5개 컬럼과 im 열의 승인 단계 부제를 표시한다', async () => {
    const steps: ApprovalStepDef[] = [
      { code: 'step1', label: '1차 검토', approver: 'subtree_or_admin' },
      { code: 'step2', label: '2차 승인', approver: 'admin' },
    ]

    await act(async () => {
      root.render(
        <KanbanBoard
          projectId="p1"
          items={sampleFlowTree()}
          actorView={ADMIN}
          today="2026-07-25"
          approvalSteps={steps}
        />,
      )
    })

    const board = container.querySelector('[data-kanban-board]')
    expect(board?.getAttribute('data-kanban-group')).toBe('flow')

    const subtitle = container.querySelector('[data-testid="kanban-col-subtitle"]')
    expect(subtitle?.textContent).toBe('2단계 승인 (1차 검토 → 2차 승인)')
  })

  it('흐름 모드에서는 드래그 앤 드롭이 비활성화된다 (draggable false)', async () => {
    await act(async () => {
      root.render(
        <KanbanBoard
          projectId="p1"
          items={sampleFlowTree()}
          actorView={ADMIN}
          today="2026-07-25"
        />,
      )
    })

    const draggableCards = container.querySelectorAll('[draggable="true"]')
    expect(draggableCards.length).toBe(0)
  })
})

describe('KanbanCard — 이동 메뉴 및 승인 액션', () => {
  let container: HTMLDivElement, root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('이동 메뉴 트리거 클릭 시 드롭다운이 열리고 단계 선택 시 콜백을 호출한다', async () => {
    const onMoveStage = vi.fn()
    const card = n('Task1', { stage: 'as' })
    const stageOptions = [
      { key: 'none', label: '미착수', current: false },
      { key: 'as', label: '할당됨', current: true },
      { key: 'ip', label: '작업 중', current: false },
      { key: 'im', label: '검수 대기', current: false },
      { key: 'xx', label: '완료', current: false },
    ]

    await act(async () => {
      root.render(
        <KanbanCard
          card={card}
          bucket="in_progress"
          editable={true}
          stageOptions={stageOptions}
          onMoveStage={onMoveStage}
        />,
      )
    })

    const trigger = container.querySelector('[data-testid="kanban-card-move-trigger"]') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      trigger.click()
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const menu = container.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()

    const asBtn = container.querySelector('[data-testid="kanban-card-move-stage-as"]') as HTMLButtonElement
    expect(asBtn.disabled).toBe(true)

    const ipBtn = container.querySelector('[data-testid="kanban-card-move-stage-ip"]') as HTMLButtonElement
    expect(ipBtn.disabled).toBe(false)

    await act(async () => {
      ipBtn.click()
    })
    expect(onMoveStage).toHaveBeenCalledWith('ip')
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('im 단계의 카드에 onApprove가 전달되면 승인 버튼이 렌더링되고 클릭 시 실행된다', async () => {
    const onApprove = vi.fn()
    const card = n('TaskIm', { stage: 'im' })

    await act(async () => {
      root.render(
        <KanbanCard
          card={card}
          bucket="in_progress"
          editable={true}
          onApprove={onApprove}
        />,
      )
    })

    const approveBtn = container.querySelector('[data-testid="kanban-card-approve-btn"]') as HTMLButtonElement
    expect(approveBtn).toBeTruthy()

    await act(async () => {
      approveBtn.click()
    })
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('Escape 키 입력 시 열려있는 이동 메뉴가 닫힌다', async () => {
    const card = n('Task1', { stage: 'as' })
    const stageOptions = [
      { key: 'none', label: '미착수', current: false },
      { key: 'as', label: '할당됨', current: true },
    ]

    await act(async () => {
      root.render(
        <KanbanCard
          card={card}
          bucket="in_progress"
          editable={true}
          stageOptions={stageOptions}
          onMoveStage={() => {}}
        />,
      )
    })

    const trigger = container.querySelector('[data-testid="kanban-card-move-trigger"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    expect(container.querySelector('[role="menu"]')).toBeTruthy()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
