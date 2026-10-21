// @vitest-environment jsdom
// WBS 작업 상세의 「회의록 원문」(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3 WBS 쪽 · 계획 과제 9).
// 열리면 그 작업의 연결을 한 번 읽는다. 연결이 있으면 이슈 상세와 같은 원문 카드(제목·날짜·판 칩·발췌·원문 위치 링크), 없으면 아무것도 그리지 않는다.
// 읽기 실패는 '연결 없음'으로 위장하지 않는다(3원칙 ①) — 명단 밖 조회 전용의 거부도 첨부 구역처럼 오류다. 회의록 모듈이 꺼졌으면 구역을 닫는다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WbsItemMinuteSourcesResult } from '@/app/actions/minuteWbs'
import type { WbsItemMinuteSource } from '@/lib/domain/minuteWbs'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ getWbsItemMinuteSources: vi.fn<(itemId: string) => Promise<WbsItemMinuteSourcesResult>>() }))
vi.mock('@/app/actions/minuteWbs', () => ({ getWbsItemMinuteSources: h.getWbsItemMinuteSources }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}))
// 사전은 키 그대로 — 판 칩만 {n} 자리를 남겨 채움을 본다
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'wbs.minuteSource.version' ? `${k}:{n}` : k) }),
}))
// 상세 패널 배치 확인용(마지막 describe) — 첨부 구역 테스트(tests/components/wbs-row-detail-attachments.test.tsx)와 같은 대역
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue({ ok: true, rows: [], download: 'denied' }),
  recordAttachment: vi.fn(), removeAttachment: vi.fn(), getAttachmentUrl: vi.fn(),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamLabel: () => (c: string) => c, useTeamCodes: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { WbsMinuteSourceSection } from '@/components/wbs/WbsMinuteSourceSection'
import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { minuteSourceHref } from '@/lib/minutes/source'
import { ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const source = (over: Partial<WbsItemMinuteSource> = {}): WbsItemMinuteSource => ({
  linkId: 'link-1', minuteId: 'minute-1', minuteVersionId: 'version-2', minuteVersionNo: 2,
  minuteTitle: '주간 회의', minuteDate: '2026-10-20', bodyHash: '0123456789abcdef', blockIndex: 4, blockHash: 'fedcba9876543210',
  excerpt: '김OO이 10/31까지 로그인 API 를 정리한다\n둘째 줄', createdAt: '2026-10-21T01:00:00Z',
  ...over,
})
const anchorOf = (s: WbsItemMinuteSource) => ({ blockIndex: s.blockIndex, blockHash: s.blockHash, bodyHash: s.bodyHash })
const deferred = () => {
  let resolve!: (v: WbsItemMinuteSourcesResult) => void
  const promise = new Promise<WbsItemMinuteSourcesResult>(r => { resolve = r })
  return { promise, resolve }
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WbsMinuteSourceSection — 작업의 회의록 원문', () => {
  /** 범위 컨텍스트(워크스페이스 acme) 안에 그린다 — slug=null 이면 범위 밖(셸 밖) */
  async function render(itemId = 'item-1', slug: string | null = 'acme') {
    const section = <WbsMinuteSourceSection itemId={itemId} />
    await act(async () => {
      root.render(slug ? <ScopeProvider value={{ workspace: { id: 'ws-1', slug, name: 'ACME' }, projectId: 'project-1' }}>{section}</ScopeProvider> : section)
    })
    await act(async () => {})
  }
  const section = () => container.querySelector('[data-wbs-minute-sources]')
  const cards = () => [...container.querySelectorAll('[data-minute-source]')]
  const alert = () => section()?.querySelector('[role="alert"]') ?? null

  it('열리면 그 작업의 연결을 한 번 읽는다', async () => {
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: true, rows: [] })
    await render('item-1')
    expect(h.getWbsItemMinuteSources).toHaveBeenCalledTimes(1)
    expect(h.getWbsItemMinuteSources).toHaveBeenCalledWith('item-1')
  })

  it('연결이 있으면 구역 제목과 연결마다 카드 하나 — 회의록 제목·날짜·판 칩·발췌(세 줄)·원문 위치 링크(범위의 회의록 경로)', async () => {
    const a = source()
    const b = source({
      linkId: 'link-2', minuteId: 'minute-9', minuteVersionId: 'version-7', minuteVersionNo: 7, minuteTitle: '착수 회의',
      minuteDate: '2026-10-01', blockIndex: 0, blockHash: 'aaaaaaaaaaaaaaaa', bodyHash: 'bbbbbbbbbbbbbbbb', excerpt: '두 번째 근거',
    })
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: true, rows: [a, b] })
    await render()
    expect(section()?.textContent).toContain('wbs.minuteSource.title')
    expect(alert()).toBeNull()
    expect(cards().map(c => c.getAttribute('data-minute-source'))).toEqual(['link-1', 'link-2'])   // 받은 순서(연결을 만든 순서) 그대로

    const [first, second] = cards()
    expect(first.textContent).toContain('주간 회의')
    expect(first.textContent).toContain('2026-10-20')
    expect(first.querySelector('.chip')?.textContent).toBe('wbs.minuteSource.version:2')
    const excerpt = first.querySelector('p')!
    expect(excerpt.textContent).toBe(a.excerpt)
    expect(excerpt.classList.contains('line-clamp-3')).toBe(true)
    const link = first.querySelector('a')!
    expect(link.textContent).toContain('wbs.minuteSource.open')
    expect(link.getAttribute('href')).toBe(minuteSourceHref('minute-1', anchorOf(a), 'version-2', '/w/acme/minutes'))
    expect(link.getAttribute('href')).toBe('/w/acme/minutes/minute-1?block=4&hash=fedcba9876543210&body=0123456789abcdef&version=version-2')

    expect(second.textContent).toContain('착수 회의')
    expect(second.textContent).toContain('2026-10-01')
    expect(second.querySelector('.chip')?.textContent).toBe('wbs.minuteSource.version:7')
    expect(second.querySelector('p')?.textContent).toBe('두 번째 근거')
    expect(second.querySelector('a')?.getAttribute('href')).toBe(minuteSourceHref('minute-9', anchorOf(b), 'version-7', '/w/acme/minutes'))
  })

  it('범위 밖(셸 밖)이면 링크 기준 경로는 useMinuteLinks 의 옛 형식 /minutes', async () => {
    const a = source()
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: true, rows: [a] })
    await render('item-1', null)
    expect(container.querySelector('a')?.getAttribute('href')).toBe(minuteSourceHref('minute-1', anchorOf(a), 'version-2', '/minutes'))
  })

  it('연결이 없으면 아무것도 그리지 않는다 — 구역 제목도 빈 안내도 없다', async () => {
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: true, rows: [] })
    await render()
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['읽기 실패', '회의록 원문 연결을 읽지 못했습니다.'],
    ['명단 밖 조회 전용의 거부 — 첨부 구역처럼 오류로 보인다', ERR_DENIED],
    ['대상 없음', ERR_MISSING],
    ['권한 확인 실패', ERR_LOOKUP],
  ])('ok:false(%s)는 오류다 — "연결 없음"으로 위장하지 않고, 액션의 사유 대신 사전 문구', async (_name, error) => {
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: false, error })
    await render()
    expect(section()?.textContent).toContain('wbs.minuteSource.title')
    expect(alert()?.textContent).toContain('wbs.minuteSource.error')
    expect(cards()).toHaveLength(0)
    expect(container.textContent).not.toContain('wbs.minuteSource.empty')
    expect(container.textContent).not.toContain(error)
  })

  it('호출이 던지면 오류다(로그를 남긴다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getWbsItemMinuteSources.mockRejectedValue(new Error('network'))
    await render()
    expect(alert()?.textContent).toContain('wbs.minuteSource.error')
    expect(cards()).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('회의록 모듈이 꺼졌으면(관문의 module_disabled) 구역을 그리지 않는다 — 꺼진 모듈은 오류로도 자리를 드러내지 않는다', async () => {
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await render()
    expect(container.innerHTML).toBe('')
  })

  it('읽는 동안은 그리지 않고, 다른 작업으로 바뀌면 앞 작업의 카드를 걷고 그 작업을 다시 읽는다', async () => {
    h.getWbsItemMinuteSources.mockResolvedValueOnce({ ok: true, rows: [source()] })
    await render('item-1')
    expect(cards()).toHaveLength(1)

    const next = deferred()
    h.getWbsItemMinuteSources.mockReturnValueOnce(next.promise)
    await render('item-2')
    expect(container.innerHTML).toBe('')
    expect(h.getWbsItemMinuteSources.mock.calls).toEqual([['item-1'], ['item-2']])

    await act(async () => { next.resolve({ ok: true, rows: [source({ linkId: 'link-9' })] }) })
    expect(cards().map(c => c.getAttribute('data-minute-source'))).toEqual(['link-9'])
  })

  it('늦게 온 앞 작업의 응답은 버린다 — 지금 작업의 카드만 남는다', async () => {
    const first = deferred()
    const second = deferred()
    h.getWbsItemMinuteSources.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render('item-1')
    await render('item-2')
    await act(async () => { second.resolve({ ok: true, rows: [source({ linkId: 'link-b' })] }) })
    await act(async () => { first.resolve({ ok: false, error: '회의록 원문 연결을 읽지 못했습니다.' }) })
    expect(cards().map(c => c.getAttribute('data-minute-source'))).toEqual(['link-b'])
    expect(alert()).toBeNull()
  })

  it('재시도는 다시 읽는다 — 도는 중엔 버튼이 남아 포커스를 쥐고(aria-busy), 성공해 알림이 사라지면 포커스는 구역 머리로', async () => {
    h.getWbsItemMinuteSources.mockResolvedValueOnce({ ok: false, error: '회의록 원문 연결을 읽지 못했습니다.' })
    await render()
    const retry = alert()!.querySelector('button') as HTMLButtonElement
    expect(retry.textContent).toContain('common.retry')
    retry.focus()
    const next = deferred()
    h.getWbsItemMinuteSources.mockReturnValueOnce(next.promise)
    await act(async () => { retry.click() })
    expect(retry.isConnected).toBe(true)
    expect(retry.getAttribute('aria-busy')).toBe('true')
    await act(async () => { retry.click() })   // 도는 중에는 다시 부르지 않는다
    expect(h.getWbsItemMinuteSources).toHaveBeenCalledTimes(2)
    expect(h.getWbsItemMinuteSources).toHaveBeenLastCalledWith('item-1')

    await act(async () => { next.resolve({ ok: true, rows: [source()] }) })
    expect(alert()).toBeNull()
    expect(cards()).toHaveLength(1)
    expect(document.activeElement).toBe(section()?.querySelector('[data-minute-source-heading]'))
  })
})

describe('RowDetailPanel — 회의록 원문 구역의 자리', () => {
  const item: ComputedItem = {
    id: 'item-1', parentId: null, code: 'A-1', sortOrder: 1, name: '대상 작업',
    biz: null, deliverable: null, plannedStart: '2026-10-01', plannedEnd: '2026-10-31',
    weight: null, actualPct: 0, owners: [], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started',
    children: [], depth: 0,
  }

  it('산출물 첨부 뒤·변경 이력 앞에 놓이고, 패널의 항목 id 로 읽는다', async () => {
    h.getWbsItemMinuteSources.mockResolvedValue({ ok: true, rows: [source()] })
    await act(async () => {
      root.render(<RowDetailPanel timeZone="Asia/Seoul" levelLabels={['Phase', 'Task', 'Activity']} item={item} allItems={[item]} dependencies={[]} projectId="project-1" onClose={() => {}} />)
    })
    await act(async () => {})
    expect(h.getWbsItemMinuteSources).toHaveBeenCalledTimes(1)
    expect(h.getWbsItemMinuteSources).toHaveBeenCalledWith('item-1')
    const sections = [...container.querySelectorAll('section')]
    const at = (key: string) => sections.findIndex(s => s.textContent?.includes(key))
    const attachments = at('wbs.attachments')
    const minutes = sections.indexOf(container.querySelector<HTMLElement>('[data-wbs-minute-sources]')!)
    const history = at('wbs.changeHistory')
    expect(attachments).toBeGreaterThanOrEqual(0)
    expect(minutes).toBe(attachments + 1)
    expect(history).toBe(minutes + 1)
  })
})
