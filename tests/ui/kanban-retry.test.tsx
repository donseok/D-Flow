// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})
import { KanbanCard } from '@/components/kanban/KanbanCard'
import { editSessionStore } from '@/lib/sync/editSession'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const dummyCard: ComputedItem = {
  id: 'card-1',
  parentId: null,
  code: 'TSK-01',
  sortOrder: 0,
  name: 'API 구현',
  biz: null,
  deliverable: null,
  stage: 'dev',
  owners: [],
  isOwnerSplit: false,
  weight: null,
  plannedStart: '2026-10-01',
  plannedEnd: '2026-10-10',
  plannedPct: 50,
  actualPct: 30,
  rolledActualPct: 30,
  achievement: null,
  status: 'in_progress',
  children: [],
  depth: 0,
}

beforeEach(() => {
  editSessionStore.clearAll()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('칸반 이동 실패 보존 및 재시도 (D6-§2-kanban)', () => {
  it('실패 상태가 아니면 실패 배너가 노출되지 않는다', async () => {
    await act(async () => {
      root.render(
        <KanbanCard
          card={dummyCard}
          bucket="in_progress"
        />
      )
    })

    expect(container.querySelector('[data-testid="kanban-failed-move"]')).toBeNull()
  })

  it('이동 실패 시 실패 배너와 재시도/원위치 액션이 렌더링된다', async () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()

    await act(async () => {
      root.render(
        <KanbanCard
          card={dummyCard}
          bucket="done"
          failed={{
            error: '서버 연결 실패',
            onRetry,
            onDismiss,
          }}
        />
      )
    })

    const banner = container.querySelector('[data-testid="kanban-failed-move"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('서버 연결 실패')
    expect(banner?.textContent).toContain('원위치')
    expect(banner?.textContent).toContain('재시도')

    // 재시도 클릭
    const retryBtn = Array.from(banner!.querySelectorAll('button')).find(b => b.textContent?.includes('재시도'))
    await act(async () => {
      retryBtn?.click()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)

    // 원위치 클릭
    const dismissBtn = Array.from(banner!.querySelectorAll('button')).find(b => b.textContent?.includes('원위치'))
    await act(async () => {
      dismissBtn?.click()
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('이동 실패 시 editSessionStore에 failed 상태로 등록되어 확인 필요 수가 증가한다', () => {
    const sessionId = `kanban:${dummyCard.id}`
    editSessionStore.setSession(sessionId, 'kanban', dummyCard.id, 'failed', {
      error: { kind: 'server_reject', message: '잠금 오류' },
    })

    const summary = editSessionStore.getSummary()
    expect(summary.failedCount).toBe(1)
    expect(summary.needsAttentionCount).toBe(1)
    expect(summary.isFullySynced).toBe(false)
  })
})
