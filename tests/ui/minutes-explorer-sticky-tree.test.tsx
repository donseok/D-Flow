// @vitest-environment jsdom
// BB2(U2b-4 충실도 리뷰 P2-2) — 회의록이 많으면 문서형(main 하나가 스크롤) 탐색기에서 폴더 트리가 목록과 함께 위로 사라졌다(시드 24건 측정).
// 트리만 고정한다: lg 에서 sticky, 필터 바(자기 높이를 --minutes-bar-h 로 내린다) 아래에 붙고 결과보다 길면 안에서 스크롤.
// 폴더를 바꾸면 결과 머리가 필터 바 아래로 오게 스크롤한다(안쪽 scrollTop=0 은 문서형에서 효과가 없다).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerLeaf, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({ ArchiveChatPanel: () => null }))
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => ({ ok: true, rows: [] })), fetchMinutesSearch: vi.fn(async () => ({ ok: true, rows: [] })),
  fetchMinutesExplorer: vi.fn(async () => ({ folders: [], leaves: [], total: 0, truncated: false })), fetchMinuteFavorites: vi.fn(async () => []),
  toggleMinuteFavorite: vi.fn(async () => true), createMinuteFolder: vi.fn(), renameMinuteFolder: vi.fn(), deleteMinuteFolder: vi.fn(),
  moveMinuteToFolder: vi.fn(), moveMinuteFolder: vi.fn(),
}))
import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'
import { MinutesView } from '@/components/minutes/MinutesView'
import { MinutesScopeProvider } from '@/components/minutes/MinutesScopeContext'
import { SUNDAY_CAL } from '../fixtures/calendarView'

const folders: MinuteFolder[] = [{ id: 'f-a', name: 'A', parentId: null, sort: 0, createdBy: 'u1', projectId: null }, { id: 'f-b', name: 'B', parentId: null, sort: 1, createdBy: 'u1', projectId: null }]
const leaves: ExplorerLeaf[] = [{ id: 'm1', minuteDate: '2026-07-22', teamCode: 'MES', title: '회의', fileCount: 0, createdBy: 'u1', createdByName: 'u', bodyPreview: '', meetingCategory: null, folderId: 'f-a' }]

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function mountExplorer() {
  await act(async () => root.render(
    <main><MinutesScopeProvider scope={{ workspaceId: 'ws-1', projectId: null }}>
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set()} onToggleFavorite={vi.fn()} onRetryFavorites={vi.fn()}
        layout="grid" currentUserId="u1" onChanged={vi.fn()} onFolderSelect={vi.fn()} />
    </MinutesScopeProvider></main>,
  ))
}
const nav = () => container.querySelector('[data-minutes-navigation]') as HTMLElement
const results = () => container.querySelector('[data-minutes-results-scroll-region]') as HTMLElement
const folderButton = (name: string) => [...nav().querySelectorAll('button')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement

describe('회의록 탐색기 — 폴더 트리 고정(BB2)', () => {
  it('트리는 lg 에서 sticky — 필터 바 아래(--frame-sticky-top + --minutes-bar-h), 결과 높이로 늘지 않고(self-start) 길면 안에서 스크롤', async () => {
    await mountExplorer()
    const cls = nav().className
    for (const c of ['lg:sticky', 'lg:self-start', 'lg:top-[calc(var(--frame-sticky-top)+var(--minutes-bar-h,0px))]', 'lg:overflow-y-auto']) expect(cls).toContain(c)
    expect(cls).toMatch(/lg:max-h-\[calc\(100dvh-/)
    expect(results().className).toContain('scroll-mt-[calc(var(--frame-sticky-top)+var(--minutes-bar-h,0px)+0.5rem)]')
  })
  it('폴더를 바꿀 때 결과 머리가 필터 바 위로 지나가 있으면 결과로 스크롤하고, 보이면 그대로 둔다', async () => {
    await mountExplorer()
    const into = vi.fn()
    Object.defineProperty(results(), 'scrollIntoView', { configurable: true, value: into })
    const main = container.querySelector('main') as HTMLElement
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ top: 48 } as DOMRect)
    const rr = vi.spyOn(results(), 'getBoundingClientRect')
    rr.mockReturnValue({ top: -400 } as DOMRect)
    await act(async () => folderButton('B').click())
    expect(into).toHaveBeenCalledWith({ block: 'start' })
    into.mockClear(); rr.mockReturnValue({ top: 300 } as DOMRect)
    await act(async () => folderButton('A').click())
    expect(into).not.toHaveBeenCalled()
  })
})

describe('MinutesView — 필터 바 높이를 --minutes-bar-h 로 내린다(BB2)', () => {
  it('ResizeObserver 의 테두리 상자 높이를 루트에 쓴다', async () => {
    let cb: ((entries: unknown[]) => void) | null = null
    vi.stubGlobal('ResizeObserver', class { constructor(f: (e: unknown[]) => void) { cb = f } observe() {} disconnect() {} })
    await act(async () => root.render(
      <MinutesView calendar={SUNDAY_CAL} scope={{ workspaceId: 'ws-1', projectId: null }} initialMinutes={[]} todayIso="2026-07-23" initialView="list" projects={[]} currentUserId="u1" canEdit />,
    ))
    const view = container.querySelector('[data-minutes-view]') as HTMLElement
    expect(view.style.getPropertyValue('--minutes-bar-h')).toBe('0px')
    act(() => cb?.([{ borderBoxSize: [{ blockSize: 104.4 }], contentRect: { height: 90 } }]))
    expect(view.style.getPropertyValue('--minutes-bar-h')).toBe('105px')
  })
})
