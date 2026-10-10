// @vitest-environment jsdom
// 회의록 화면의 "팀 없음" 필터 탭(0052) — 팀 없는 회의록이 하나라도 있을 때만 보이고, 고르면 탐색기 리프를 팀 없는 것만으로 거르고
// 월 목록을 NO_TEAM_FILTER 로 다시 읽는다. 팀 행이 지워진 옛 회의록(team_id null, 원문 code 가 남음)은 팀 없음에 들지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerData, ExplorerLeaf } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
const chatProps = vi.hoisted(() => vi.fn())
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({ ArchiveChatPanel: (p: unknown) => { chatProps(p); return null } }))

const fetchMinutesRange = vi.fn<(scope: unknown, rs: string, re: string, teamId: string | null) => Promise<{ ok: true; rows: never[] }>>(
  async () => ({ ok: true, rows: [] }))
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: (...a: unknown[]) => fetchMinutesRange(...(a as [unknown, string, string, string | null])),
  fetchMinutesSearch: vi.fn(async () => ({ ok: true, rows: [] })),
  fetchMinutesExplorer: vi.fn(async () => null),
  fetchMinuteFavorites: vi.fn(async () => []),
  toggleMinuteFavorite: vi.fn(async () => true),
}))

import { MinutesView } from '@/components/minutes/MinutesView'
import { SUNDAY_CAL } from '../fixtures/calendarView'

const T_QA = '00000000-0000-4000-8000-0000000000a1'
const leaf = (id: string, title: string, teamCode: string, teamId: string | null): ExplorerLeaf => ({
  id, minuteDate: '2026-10-01', teamCode, teamId, title, fileCount: 0, createdBy: null, createdByName: null,
  bodyPreview: '', meetingCategory: null, folderId: null,
})
const tree = (leaves: ExplorerLeaf[]): ExplorerData => ({ folders: [], leaves, total: leaves.length, truncated: false })
const WITH_TEAM = leaf('m-qa', '품질 주간회의', 'QA', T_QA)
const NO_TEAM = leaf('m-none', '전체 타운홀', '', null)
const ORPHAN = leaf('m-old', '옛 조직 회의', 'OLD', null)     // 팀 행이 지워진 옛 회의록

describe('MinutesView — "팀 없음" 필터 탭(0052)', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    fetchMinutesRange.mockClear(); chatProps.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesView>[0]> = {}) {
    await act(async () => root.render(
      <MinutesView calendar={SUNDAY_CAL} scope={{ workspaceId: 'ws-1', projectId: null }} initialMinutes={[]} todayIso="2026-10-09"
        initialView="tree" projects={[]} currentUserId="u1" canEdit initialFavorites={[]}
        teamOptions={[{ id: T_QA, code: 'QA', name: '품질팀' }]} initialTree={tree([WITH_TEAM])} {...over} />,
    ))
  }
  const tab = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)

  it('팀 없는 회의록이 없으면 탭이 없다 — 팀 행이 지워진 옛 회의록만 있어도 없다', async () => {
    await mount({ initialTree: tree([WITH_TEAM, ORPHAN]) })
    expect(tab('min.team.all')).toBeTruthy()
    expect(tab('품질팀')).toBeTruthy()
    expect(tab('min.team.none')).toBeUndefined()
  })
  it('받은 트리에 팀 없는 회의록이 있으면 탭이 생긴다 — 서버가 있다고 알려 줘도(트리 밖) 생긴다', async () => {
    await mount({ initialTree: tree([WITH_TEAM, NO_TEAM]) })
    expect(tab('min.team.none')).toBeTruthy()
    act(() => root.unmount()); root = createRoot(container)
    await mount({ hasNoTeamMinutes: true })
    expect(tab('min.team.none')).toBeTruthy()
  })
  it('탭을 고르면 탐색기는 팀 없는 회의록만 남기고(옛 code 회의록 제외) 월 목록을 팀 없음 필터로 다시 읽는다', async () => {
    await mount({ initialTree: tree([WITH_TEAM, NO_TEAM, ORPHAN]) })
    for (const title of ['품질 주간회의', '전체 타운홀', '옛 조직 회의']) expect(container.textContent).toContain(title)
    await act(async () => tab('min.team.none')!.click())
    expect(container.textContent).toContain('전체 타운홀')
    expect(container.textContent).not.toContain('품질 주간회의')
    expect(container.textContent).not.toContain('옛 조직 회의')
    expect(fetchMinutesRange).toHaveBeenLastCalledWith({ workspaceId: 'ws-1', projectId: null }, '2026-10-01', '2026-10-31', 'none')
    // 보관함 챗에는 "팀 없음" 필터가 없다 — 전체로 연다(엉뚱한 팀으로 좁히지 않는다)
    expect(chatProps).toHaveBeenLastCalledWith(expect.objectContaining({ team: null }))
    await act(async () => tab('min.team.all')!.click())
    expect(container.textContent).toContain('품질 주간회의')
  })
  it('?team=none 으로 들어오면 그 탭이 골라진 채 열린다 — 결과가 비어도 탭은 남는다', async () => {
    await mount({ initialTeamId: 'none', initialTree: tree([WITH_TEAM]) })
    expect(tab('min.team.none')).toBeTruthy()
    expect(container.textContent).not.toContain('품질 주간회의')
  })
  it('탐색기 줄의 팀 막대는 팀 없는 회의록에서 "팀 없음" 사전 키를 그린다', async () => {
    await mount({ initialTree: tree([NO_TEAM]) })
    const bar = container.querySelector('[data-team-bar=""]')
    expect(bar?.textContent).toBe('min.team.none')
  })
})
