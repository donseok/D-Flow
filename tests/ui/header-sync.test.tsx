// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('@/components/app/NotificationBell', () => ({
  NotificationBell: () => <span data-bell />,
}))
vi.mock('@/components/app/AccountMenu', () => ({
  AccountMenu: () => <span data-account />,
}))

import { GlobalBar } from '@/components/app/GlobalBar'
import { PageHeader } from '@/components/app/PageHeader'
import { editSessionStore } from '@/lib/sync/editSession'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  editSessionStore.clearAll()
  editSessionStore.setConnectionState('online')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('헤더 동기화 상태 연동 (GlobalBar & PageHeader)', () => {
  const brand = { productName: 'D-Flow', workspaceId: 'w1', hasFull: false, hasFullDark: false, hasMark: false }
  const crumbs = { scope: 'workspace' as const, workspace: null, project: null, screen: null }

  it('GlobalBar는 기본적으로 data-slot="sync-status"에 SyncStatus를 렌더링한다', async () => {
    editSessionStore.setSession('s-1', 'wbs', 'item-1', 'saving')

    await act(async () => {
      root.render(
        <GlobalBar
          scope="workspace"
          brand={brand}
          homeHref="/"
          crumbs={crumbs}
          identity={null}
          staging={false}
          onOpenDrawer={() => {}}
        />
      )
    })

    const slot = container.querySelector('[data-slot="sync-status"]')
    expect(slot).not.toBeNull()
    expect(slot?.textContent).toContain('저장 중...')
  })

  it('GlobalBar에 커스텀 syncStatus를 전달하면 해당 내용이 렌더링된다', async () => {
    await act(async () => {
      root.render(
        <GlobalBar
          scope="workspace"
          brand={brand}
          homeHref="/"
          crumbs={crumbs}
          identity={null}
          staging={false}
          onOpenDrawer={() => {}}
          syncStatus={<span data-testid="custom-sync">커스텀 상태</span>}
        />
      )
    })

    const custom = container.querySelector('[data-testid="custom-sync"]')
    expect(custom).not.toBeNull()
    expect(custom?.textContent).toBe('커스텀 상태')
  })

  it('PageHeader에 syncStatus가 제공되면 data-slot="sync-status"에 렌더링된다', async () => {
    await act(async () => {
      root.render(
        <PageHeader
          title="테스트 페이지"
          syncStatus={<span data-testid="header-sync">동기화됨</span>}
        />
      )
    })

    const slot = container.querySelector('[data-slot="sync-status"]')
    expect(slot).not.toBeNull()
    expect(slot?.textContent).toBe('동기화됨')
  })
})
