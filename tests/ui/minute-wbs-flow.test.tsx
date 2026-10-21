// @vitest-environment jsdom
// 회의록 문단 하나 → WBS 작업(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.1) — 뷰어 조율·등록 창(한 건)·팝오버·선택 버블.
// 이슈 등록 흐름(minute-issue-draft-flow.test.tsx)의 mock·stub 을 따르되 본문은 실제 MarkdownView 로 그린다 — 문단 표시(data-wbs-count)가
// 연결된 작업(linkedWbsItems → activeLinkedWbs → marks)에서 끝까지 찍히는지 본다. 등록 창은 실제 컴포넌트다(빈 칸 null·맨 위 null·단추 조건).
// 한꺼번에 등록(§3.2)은 요약 카드 stub 의 「wbs-bulk」 단추에서 시작한다 — 액션 문단 전부(kind action·제목 줄 제외·문단 순서) → bulk 창 → 등록.
// 실제 요약 카드의 단추·칩·연결된 작업 목록은 아래 describe 가 vi.importActual 로 따로 본다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute, MinuteInsight } from '@/lib/domain/types'
import {
  WBS_ROOT_PARENT, type MinuteLinkedWbsItem, type MinuteWbsDraftRow, type MinuteWbsDrafts, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'
import { escStack } from '@/lib/ui/escStack'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  prepareMinuteIssueDraft: vi.fn(),
  fetchIssueProjectMembers: vi.fn(),
  createIssueFromMinuteBlock: vi.fn(),
  prepareMinuteWbsDrafts: vi.fn(),
  createWbsItemsFromMinute: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
  popoverProps: [] as Array<Record<string, unknown>>,
  cardProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
// 키를 돌려주되 {n} 이 든 문구(「외 {n}건」·「작업 {n}건을 등록했습니다」 …)는 자리를 남긴다 — 호출부가 숫자를 채우는지 본다
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string) => (/^min\.wbs\.(more|count|createdN|selectedCount|submitN|rowFailed)$/.test(key) ? `${key} {n}` : key),
  }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/app/actions/issues', () => ({
  prepareMinuteIssueDraft: mocks.prepareMinuteIssueDraft,
  fetchIssueProjectMembers: mocks.fetchIssueProjectMembers,
  createIssueFromMinuteBlock: mocks.createIssueFromMinuteBlock,
  fetchIssueMajorProcesses: vi.fn().mockResolvedValue({ ok: true, majors: [] }),
}))
vi.mock('@/app/actions/minuteWbs', () => ({
  prepareMinuteWbsDrafts: mocks.prepareMinuteWbsDrafts,
  createWbsItemsFromMinute: mocks.createWbsItemsFromMinute,
}))
vi.mock('@/components/minutes/useMinuteTocSpy', () => ({
  useMinuteTocSpy: () => ({ activeToc: null, jumpTo: vi.fn() }),
}))
// 요약 카드는 stub — 받은 props 를 남기고, 「WBS로 한꺼번에 등록」은 canBulkWbs 일 때만(준비 중이면 막힌 채) 그린다(실제 카드와 같은 규칙).
// 「wbs-bulk-force」 는 단추가 없을 때도 onBulkWbs 를 불러 보는 시험용 길이다(뷰어가 스스로도 막는지)
vi.mock('@/components/minutes/MinuteInsightCard', () => ({
  MinuteInsightCard: (props: { canBulkWbs?: boolean; wbsBusy?: boolean; bulkDisabled?: boolean; onBulkWbs?: () => void }) => {
    mocks.cardProps.push(props as unknown as Record<string, unknown>)
    return (
      <div data-testid="insight-card">
        {props.canBulkWbs && (
          <button data-testid="wbs-bulk" disabled={props.wbsBusy || props.bulkDisabled} onClick={props.onBulkWbs}>
            {props.wbsBusy ? 'min.wbs.preparing' : 'bulk'}
          </button>
        )}
        {props.onBulkWbs && <button data-testid="wbs-bulk-force" onClick={props.onBulkWbs}>force</button>}
      </div>
    )
  },
}))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteVersionPanel', () => ({ MinuteVersionPanel: () => null }))
vi.mock('@/components/minutes/MinuteWikiImpactCard', () => ({ MinuteWikiImpactCard: () => null }))
vi.mock('@/components/minutes/MinuteFontSizeControl', () => ({ MinuteFontSizeControl: () => null }))
// 팝오버는 stub — 받은 props 를 남기고, 「WBS로 등록」은 onCreateWbs 가 있을 때만 그린다. 두 등록 단추가 막히는 조건은 실제 팝오버와 같다
// (이슈: issueBusy·wbsBusy·canCreateIssue=false, WBS: wbsBusy·issueBusy·canCreateWbs=false). 실제 팝오버의 모양은 아래 describe 가 vi.importActual 로 본다.
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({
  MinuteBlockPopover: (props: {
    issueBusy?: boolean
    canCreateIssue?: boolean
    wbsBusy?: boolean
    canCreateWbs?: boolean
    onCreateWbs?: () => void
    onCreateIssue: () => void
    onClose: () => void
  }) => {
    mocks.popoverProps.push(props as unknown as Record<string, unknown>)
    return (
      <div data-testid="minute-block-popover">
        <span data-testid="wbs-busy">{props.wbsBusy ? 'busy' : 'idle'}</span>
        <button data-testid="create-minute-issue" disabled={props.issueBusy || props.wbsBusy || props.canCreateIssue === false}
          onClick={props.onCreateIssue}>create</button>
        {props.onCreateWbs && (
          <button data-testid="wbs-create" disabled={props.wbsBusy || props.issueBusy || props.canCreateWbs === false}
            onClick={props.onCreateWbs}>wbs</button>
        )}
        <button data-testid="close-minute-popover" onClick={props.onClose}>close</button>
      </div>
    )
  },
}))
vi.mock('@/components/issues/IssueModals', () => ({ IssueFormModal: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

// 문단 0 · 제목 1 · 문단 2 — 실제 splitMinuteBlocks 와 실제 MarkdownView 의 data-mblock 이 같은 번호다
const BODY = [
  '로그인 API 를 10월 말까지 개발하기로 했다.',
  '## 다음 회의',
  '권한 화면 시안은 다음 주에 검토한다.',
].join('\n\n')
const blocks = splitMinuteBlocks(BODY)
const bodyHash = fnv1a64(BODY)

const minute: Minute = {
  id: 'minute-1',
  minuteDate: '2026-10-20',
  teamCode: 'PMO',
  title: '주간 회의',
  bodyMd: BODY,
  meetingId: null,
  projectId: 'project-1',
  ownProjectId: 'project-1',
  workspaceId: 'ws-1',
  createdBy: 'user-1',
  createdByName: '작성자',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
}

const versions = [
  { id: 'version-2', versionNo: 2, title: '주간 회의', minuteDate: '2026-10-20', createdAt: '2026-10-20T09:00:00Z' },
  { id: 'version-1', versionNo: 1, title: '주간 회의', minuteDate: '2026-10-20', createdAt: '2026-10-20T08:00:00Z' },
]

/** 위험 인사이트가 붙은 문단 — 이슈 등록이면 kind 'risk' 로 가지만 WBS 문단 등록은 늘 'manual' 이다 */
const riskInsight: MinuteInsight = {
  id: 'ins-1', minuteId: 'minute-1', bodyHash, kind: 'risk', label: '로그인 일정 위험', blockIndex: 0, blockHash: blocks[0].hash,
}

const opt = (id: string, path: string, extra: Partial<MinuteWbsParentOption> = {}): MinuteWbsParentOption => ({
  id, path, depth: path.split(' › ').length - 1, leaf: false, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames: [], ...extra,
})
const PARENTS = [opt('parent-1', '2 개발 › 2.1 인증'), opt('leaf-1', '3 운영', { leaf: true, actualPct: 40 })]

function draftsFor(index: number, row: Partial<MinuteWbsDraftRow> = {}, rest: Partial<MinuteWbsDrafts> = {}): MinuteWbsDrafts {
  return {
    rows: [{
      row: 0, blockIndex: index, blockHash: blocks[index].hash, excerpt: blocks[index].text, name: '로그인 API 개발',
      parentIds: ['parent-1'], plannedEnd: null, assigneeMemberId: null, registered: null, ...row,
    }],
    parents: PARENTS,
    members: [{ id: 'member-1', name: '김민수' }],
    mode: 'ai',
    ...rest,
  }
}

const blockSource = (index: number) => ({
  minuteId: 'minute-1', minuteVersionId: 'version-2', bodyHash, blockIndex: index, blockHash: blocks[index].hash, kind: 'manual',
})

const link = (linkId: string, blockIndex: number, blockHash: string): MinuteLinkedWbsItem => ({
  linkId, itemId: `item-${linkId}`, code: `2.1.${linkId}`, name: `작업 ${linkId}`, projectId: 'project-1',
  minuteVersionId: 'version-1', bodyHash: 'old-body-hash', blockIndex, blockHash, sourceKind: 'manual',
})

/** AI 요약의 「액션」 항목 — 한꺼번에 등록의 원천(설계 §3.2) */
const actionInsight = (id: string, blockIndex: number, extra: Partial<MinuteInsight> = {}): MinuteInsight => ({
  id, minuteId: 'minute-1', bodyHash, kind: 'action', label: `액션 ${blockIndex}`, blockIndex, blockHash: blocks[blockIndex].hash, ...extra,
})
/**
 * 요약 — 액션은 문단 2·0(순서가 섞여 온다), 제목 줄 1 의 액션(준비가 제목 줄을 묶음째 거부하므로 뺀다), 위험(액션이 아니다),
 * 옛 본문의 액션(지금 본문의 요약이 아니다 — visibleInsights 가 뺀다)
 */
const BULK_INSIGHTS: MinuteInsight[] = [
  actionInsight('a2', 2), actionInsight('a0', 0), actionInsight('a1', 1), riskInsight,
  actionInsight('stale', 2, { bodyHash: 'old-body-hash' }),
]
const actionSource = (index: number) => ({ ...blockSource(index), kind: 'action' })

/** 한꺼번에 준비 응답 — 문단 0·2 두 줄, 둘 다 parent-1 추천 */
function bulkDrafts(rest: Partial<MinuteWbsDrafts> = {}): MinuteWbsDrafts {
  return {
    rows: [0, 2].map((index, row) => ({
      row, blockIndex: index, blockHash: blocks[index].hash, excerpt: blocks[index].text, name: `작업 ${index}`,
      parentIds: ['parent-1'], plannedEnd: null, assigneeMemberId: null, registered: null,
    })),
    parents: PARENTS,
    members: [{ id: 'member-1', name: '김민수' }],
    mode: 'ai',
    ...rest,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  escStack.clear()
  for (const fn of [
    mocks.prepareMinuteIssueDraft, mocks.fetchIssueProjectMembers, mocks.createIssueFromMinuteBlock,
    mocks.prepareMinuteWbsDrafts, mocks.createWbsItemsFromMinute, mocks.toast, mocks.refresh,
  ]) fn.mockReset()
  mocks.popoverProps.length = 0
  mocks.cardProps.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
})

async function mountViewer(extra: Partial<Parameters<typeof MinuteViewer>[0]> = {}) {
  await act(async () => {
    root.render(
      <MinuteViewer timeZone="Asia/Seoul"
        minute={minute}
        files={[]}
        canManage={false}
        annotations={{ highlights: [], insights: [] }}
        userId="user-1"
        projects={[{ id: 'project-1', name: '프로젝트 A' }]}
        versions={versions}
        wbsAdminProjectIds={['project-1']}
        projectWorkspaces={{ 'project-1': 'ws-1' }}
        {...extra}
      />,
    )
  })
}

/** 마이크로태스크·0ms 타이머까지 흘린다(준비·등록 응답의 연속 코드, 창의 dirty 기준값) */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function clickBlock(index: number) {
  act(() => { container.querySelector<HTMLElement>(`[data-mblock="${index}"]`)!.click() })
}
const popover = () => container.querySelector('[data-testid="minute-block-popover"]')
const wbsButton = () => container.querySelector<HTMLButtonElement>('[data-testid="wbs-create"]')
const lastPopover = () => mocks.popoverProps.at(-1)!
const wbsDialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="min.wbs.title"]')
const buttonByText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text)) ?? null
const submitButton = () => buttonByText(wbsDialog()!, 'min.wbs.submit')!
/** 보이는 이름표(첫 span)가 key 인 label 안의 입력 칸 */
function field<T extends HTMLElement>(scope: ParentNode, key: string): T {
  const label = [...scope.querySelectorAll('label')].find(candidate => candidate.firstElementChild?.textContent === key)
  if (!label) throw new Error(`label ${key} 없음`)
  return label.querySelector<T>('input, select')!
}
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function chooseOption(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => { setter.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })) })
}

/** 문단 index 에서 「WBS로 등록」 → 준비 응답(value) → 열린 창 */
async function openWbsModal(index: number, value: MinuteWbsDrafts) {
  mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: true, value })
  clickBlock(index)
  act(() => { wbsButton()!.click() })
  await settle()
  const dialog = wbsDialog()
  if (!dialog) throw new Error('WBS 등록 창이 열리지 않았다')
  return dialog
}

describe('MinuteViewer 문단 → WBS 작업(한 건)', () => {
  it('고정 프로젝트의 관리자 — 「WBS로 등록」 → 준비 1회(kind manual) → 한 건 창 → 등록(빈 칸 null) → 링크 달린 토스트·refresh', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-1', code: '2.1.4' }] })
    await mountViewer({ annotations: { highlights: [], insights: [riskInsight] } })

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    await act(async () => { await Promise.resolve() })

    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(1)
    // 위험 인사이트가 붙은 문단이어도 kind 는 manual — 'action' 은 한꺼번에 등록 몫, 'risk' 는 WBS 연결 종류가 아니다
    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-1', [blockSource(0)])
    expect(container.querySelector('[data-testid="wbs-busy"]')?.textContent).toBe('busy')
    expect(wbsDialog()).toBeNull()

    await act(async () => {
      pending.resolve({ ok: true, value: draftsFor(0) })
      await pending.promise
    })

    const dialog = wbsDialog()!
    expect(dialog).not.toBeNull()
    expect(popover()).toBeNull()
    expect(field<HTMLInputElement>(dialog, 'min.wbs.name').value).toBe('로그인 API 개발')
    expect(dialog.textContent).toContain('min.wbs.excerpt')
    expect(dialog.textContent).toContain(blocks[0].text)
    // 원문 상자는 스크롤되는 영역 — 키보드로도 닿고(tabIndex 0) 이름이 있다(axe scrollable-region-focusable)
    const excerpt = dialog.querySelector<HTMLElement>('[role="region"][aria-label="min.wbs.excerpt"]')!
    expect(excerpt).not.toBeNull()
    expect(excerpt.tabIndex).toBe(0)
    expect(excerpt.textContent).toContain(blocks[0].text)
    expect(dialog.textContent).not.toContain('min.wbs.fallbackMode')
    expect(submitButton().disabled).toBe(false)

    // 같은 틱에 두 번 눌러도(단추가 막히기 전) 한 번만 보낸다 — manual 줄은 DB 가 중복을 막지 않는다
    await act(async () => { submitButton().click(); submitButton().click() })
    await settle()

    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledTimes(1)
    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-1', [{
      source: blockSource(0), name: '로그인 API 개발', parentId: 'parent-1',
      plannedStart: null, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: false,
    }])
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.wbs.created',
      variant: 'success',
      action: { label: 'min.wbs.viewInPlan', href: '/p/project-1/wbs?focus=item-1' },
    })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(wbsDialog()).toBeNull()
  })

  it('맨 위를 고르면 parentId 는 null, 초안의 종료일·담당자는 그대로 실린다 — 결정형 초안이면 안내가 보인다', async () => {
    mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-2', code: '5' }] })
    await mountViewer()
    const dialog = await openWbsModal(0, draftsFor(0, { plannedEnd: '2026-10-31', assigneeMemberId: 'member-1' }, { mode: 'fallback' }))

    expect(dialog.textContent).toContain('min.wbs.fallbackMode')
    act(() => { dialog.querySelector<HTMLInputElement>(`input[type="radio"][value="${WBS_ROOT_PARENT}"]`)!.click() })
    await act(async () => { submitButton().click() })
    await settle()

    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-1', [{
      source: blockSource(0), name: '로그인 API 개발', parentId: null,
      plannedStart: null, plannedEnd: '2026-10-31', assigneeMemberId: 'member-1', confirmParentLeaf: false,
    }])
  })

  it('등록 단추 — 이름이 비었거나 위치가 없으면 막히고, 하위 없는 작업을 위치로 고르면 영향 확인까지 받아야 열린다', async () => {
    mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-3', code: '3.1' }] })
    await mountViewer()
    // 추천도 마지막 위치도 없다 — 위치 미선택
    const dialog = await openWbsModal(0, draftsFor(0, { parentIds: [] }))
    expect(dialog.textContent).toContain('min.wbs.parentPlaceholder')
    expect(submitButton().disabled).toBe(true)

    // 하위 없는 작업을 「다른 위치 찾기…」에서 고른다 — 확인 전에는 막힌다
    act(() => { buttonByText(dialog, 'min.wbs.parentSearch')!.click() })
    act(() => { dialog.querySelector<HTMLInputElement>('[data-wbs-parent-results] input[value="leaf-1"]')!.click() })
    expect(dialog.textContent).toContain('min.wbs.leafNotice')
    expect(submitButton().disabled).toBe(true)
    act(() => { dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
    expect(submitButton().disabled).toBe(false)

    // 이름을 비우면 다시 막힌다(공백만도 빈 이름)
    const name = field<HTMLInputElement>(dialog, 'min.wbs.name')
    await typeInto(name, '   ')
    expect(submitButton().disabled).toBe(true)
    await typeInto(name, '  운영 점검 자동화  ')
    expect(submitButton().disabled).toBe(false)

    await act(async () => { submitButton().click() })
    await settle()
    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-1', [{
      source: blockSource(0), name: '운영 점검 자동화', parentId: 'leaf-1',
      plannedStart: null, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: true,
    }])
  })

  it('마지막으로 고른 위치를 기억한다 — 추천이 없는 다음 등록에서 그 위치를 미리 고르고, 이 프로젝트에 없는 위치면 위치로 치지 않는다', async () => {
    mocks.createWbsItemsFromMinute
      .mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-4', code: '2.1.5' }] })
      .mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-5', code: '2.1.6' }] })
    await mountViewer()

    await openWbsModal(0, draftsFor(0))
    await act(async () => { submitButton().click() })
    await settle()
    expect(wbsDialog()).toBeNull()

    // 추천 없음 → 마지막 위치(parent-1)
    await openWbsModal(2, draftsFor(2, { parentIds: [] }))
    expect(submitButton().disabled).toBe(false)
    await act(async () => { submitButton().click() })
    await settle()
    expect(mocks.createWbsItemsFromMinute).toHaveBeenLastCalledWith('project-1', [expect.objectContaining({ source: blockSource(2), parentId: 'parent-1' })])

    // 위치 후보에 그 id 가 없으면(다른 프로젝트·그새 사라짐) 고르지 않은 것 — 단추가 막힌다
    const dialog = await openWbsModal(2, draftsFor(2, { parentIds: [] }, { parents: [opt('parent-9', '9 기타')] }))
    expect(dialog.textContent).toContain('min.wbs.parentPlaceholder')
    expect(submitButton().disabled).toBe(true)
  })

  it('맨 위로 등록하면 맨 위를 마지막 위치로 기억한다 — 앞서 기억한 위치를 비우지 않고 맨 위로 바꾼다(추천 없는 다음 등록이 맨 위로 열린다)', async () => {
    mocks.createWbsItemsFromMinute
      .mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-4', code: '2.1.5' }] })
      .mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-5', code: '6' }] })
    await mountViewer()

    // parent-1 로 등록(기억) → 다음은 맨 위로 등록
    await openWbsModal(0, draftsFor(0))
    await act(async () => { submitButton().click() })
    await settle()
    const second = await openWbsModal(2, draftsFor(2))
    act(() => { second.querySelector<HTMLInputElement>(`input[type="radio"][value="${WBS_ROOT_PARENT}"]`)!.click() })
    await act(async () => { submitButton().click() })
    await settle()
    expect(mocks.createWbsItemsFromMinute).toHaveBeenLastCalledWith('project-1', [expect.objectContaining({ source: blockSource(2), parentId: null })])

    // 추천 없는 다음 등록 — 맨 위가 골라져 있고(빈 칸이 아니다) 바로 등록할 수 있다
    const third = await openWbsModal(0, draftsFor(0, { parentIds: [] }))
    expect(third.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value).toBe(WBS_ROOT_PARENT)
    expect(third.textContent).not.toContain('min.wbs.parentPlaceholder')
    expect(submitButton().disabled).toBe(false)
  })

  it('거부 — 줄 번호가 있으면 그 줄을 빨갛게, 사유를 보이고 입력은 그대로 둔다(창도 열린 채). 줄과 무관한 거부·요청 실패도 사유를 보인다', async () => {
    mocks.createWbsItemsFromMinute
      .mockResolvedValueOnce({ ok: false, error: '넣을 위치의 하위 작업이 그새 사라졌습니다.', row: 0 })
      .mockResolvedValueOnce({ ok: false, error: 'WBS 등록에 실패했습니다.' })
      .mockRejectedValueOnce(new Error('network down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountViewer()
    const dialog = await openWbsModal(0, draftsFor(0))
    await typeInto(field<HTMLInputElement>(dialog, 'min.wbs.name'), '로그인 API 개발(보완)')

    await act(async () => { submitButton().click() })
    await settle()
    expect(wbsDialog()).not.toBeNull()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('넣을 위치의 하위 작업이 그새 사라졌습니다.')
    expect(dialog.querySelector('[data-row-failed]')).not.toBeNull()
    expect(field<HTMLInputElement>(dialog, 'min.wbs.name').value).toBe('로그인 API 개발(보완)')
    expect(submitButton().disabled).toBe(false)

    await act(async () => { submitButton().click() })
    await settle()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('WBS 등록에 실패했습니다.')
    expect(dialog.querySelector('[data-row-failed]')).toBeNull()

    await act(async () => { submitButton().click() })
    await settle()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('common.err.tryAgain')
    expect(spy).toHaveBeenCalled()

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('고친 입력이 있으면 닫을 때 버릴지 묻는다(dirty 확인)', async () => {
    await mountViewer()
    const dialog = await openWbsModal(0, draftsFor(0))
    // 기준값은 열린 다음 틱에 잡힌다(useModalDirty) — 사람이 입력하기 전의 그 틱을 흘린다
    await settle()
    await typeInto(field<HTMLInputElement>(dialog, 'min.wbs.name'), '다른 이름')

    act(() => { dialog.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!.click() })
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(wbsDialog()).not.toBeNull()
  })

  it('관리자인 프로젝트가 아니면(wbsAdminProjectIds 에 없다) 「WBS로 등록」이 없다', async () => {
    await mountViewer({ wbsAdminProjectIds: [] })
    clickBlock(0)
    expect(popover()).not.toBeNull()
    expect(wbsButton()).toBeNull()
    expect(lastPopover().onCreateWbs).toBeUndefined()
  })

  it('연결된 작업 목록을 못 읽었으면 단추가 없고 머리에 사유가 보인다', async () => {
    await mountViewer({ linkedWbsItemsError: '연결된 작업 목록을 읽지 못했습니다.' })
    expect(container.textContent).toContain('min.wbs.linksUnavailable')
    clickBlock(0)
    expect(popover()).not.toBeNull()
    expect(wbsButton()).toBeNull()
  })

  it('정상이면 머리에 연결 목록 사유가 없다', async () => {
    await mountViewer()
    expect(container.textContent).not.toContain('min.wbs.linksUnavailable')
  })

  it('연결 목록을 못 읽어도 원래 등록할 수 없던 화면(관리자 아님·지난 버전·보관된 회의록)에는 사유를 띄우지 않는다', async () => {
    const error = '연결된 작업 목록을 읽지 못했습니다.'
    await mountViewer({ linkedWbsItemsError: error, wbsAdminProjectIds: [] })
    expect(container.textContent).not.toContain('min.wbs.linksUnavailable')

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ linkedWbsItemsError: error, historicalVersion: { id: 'version-1', versionNo: 1 } })
    expect(container.textContent).not.toContain('min.wbs.linksUnavailable')

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ linkedWbsItemsError: error, minute: { ...minute, archivedAt: '2026-10-21T00:00:00Z' } })
    expect(container.textContent).not.toContain('min.wbs.linksUnavailable')
  })

  it('제목 줄은 단추가 막힌다(이슈와 같은 규칙)', async () => {
    await mountViewer()
    clickBlock(1)
    expect(wbsButton()).not.toBeNull()
    expect(wbsButton()!.disabled).toBe(true)
    clickBlock(0)
    expect(wbsButton()!.disabled).toBe(false)
  })

  it('준비 실패 — 사유 토스트(min.wbs.prepareFailed), 창은 열지 않는다. 요청이 reject 돼도 같다(클라이언트 폴백 없음)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prepareMinuteWbsDrafts
      .mockResolvedValueOnce({ ok: false, error: '작업 계획을 읽지 못해 등록 창을 열 수 없습니다.' })
      .mockRejectedValueOnce(new Error('network down'))
    await mountViewer()

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    await settle()
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: 'min.wbs.prepareFailed', description: '작업 계획을 읽지 못해 등록 창을 열 수 없습니다.', variant: 'error',
    })
    expect(wbsDialog()).toBeNull()
    expect(popover()).toBeNull()

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    await settle()
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'min.wbs.prepareFailed', variant: 'error' })
    expect(wbsDialog()).toBeNull()
    spy.mockRestore()
  })

  it('낡은 요청은 창을 열지 않는다 — 팝오버를 닫은 뒤 온 응답, 다른 문단으로 다시 시작한 뒤 온 앞 요청의 응답', async () => {
    const first = deferred<{ ok: false; error: string }>()
    const second = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    const third = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    await mountViewer()

    // ① 준비 중 팝오버를 닫는다 → 뒤늦은 응답은 버린다(실패여도 토스트를 띄우지 않는다)
    clickBlock(0)
    act(() => { wbsButton()!.click() })
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="close-minute-popover"]')!.click() })
    await act(async () => { first.resolve({ ok: false, error: '늦은 실패' }); await first.promise })
    expect(wbsDialog()).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()

    // ② 문단 0 으로 시작해 닫고, 문단 2 로 다시 시작 — 앞 요청이 늦게 와도 열지 않고 뒤 요청만 연다
    clickBlock(0)
    act(() => { wbsButton()!.click() })
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="close-minute-popover"]')!.click() })
    clickBlock(2)
    act(() => { wbsButton()!.click() })
    await act(async () => { second.resolve({ ok: true, value: draftsFor(0) }); await second.promise })
    expect(wbsDialog()).toBeNull()
    expect(container.querySelector('[data-testid="wbs-busy"]')?.textContent).toBe('busy')

    await act(async () => { third.resolve({ ok: true, value: draftsFor(2, { name: '권한 화면 시안 검토' }) }); await third.promise })
    expect(field<HTMLInputElement>(wbsDialog()!, 'min.wbs.name').value).toBe('권한 화면 시안 검토')
    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenLastCalledWith('project-1', [blockSource(2)])
  })

  it('연결된 작업은 버전이 아니라 문단 내용으로 붙는다 — 문단에 data-wbs-count 가 찍히고 팝오버가 그 문단의 연결을 받는다', async () => {
    // 옛 버전에서 문단 0 자리에 저장된 연결이라도 hash 가 문단 2 것이면 문단 2 로 옮겨 붙는다. 맞는 문단이 없는 연결은 빠진다
    const linkedWbsItems = [link('1', 0, blocks[2].hash), link('2', 2, blocks[2].hash), link('3', 0, 'gone-hash')]
    await mountViewer({ linkedWbsItems })

    expect(container.querySelector('[data-mblock="2"]')?.getAttribute('data-wbs-count')).toBe('2')
    expect(container.querySelector('[data-mblock="0"]')?.hasAttribute('data-wbs-count')).toBe(false)

    clickBlock(2)
    const received = lastPopover().linkedWbsItems as MinuteLinkedWbsItem[]
    expect(received.map(item => item.linkId)).toEqual(['1', '2'])
    expect(received.every(item => item.blockIndex === 2)).toBe(true)
    clickBlock(0)
    expect(lastPopover().linkedWbsItems).toEqual([])
  })
})

describe('MinuteViewer 프로젝트 없는 회의록 → WBS 선택 창', () => {
  const looseMinute: Minute = { ...minute, projectId: null, ownProjectId: null, meetingProjectId: null }
  const projects = [
    { id: 'project-1', name: '프로젝트 A' },
    { id: 'project-2', name: '프로젝트 B' },
    { id: 'project-3', name: '프로젝트 C' },
    { id: 'project-4', name: '다른 워크스페이스 D' },
  ]
  const projectWorkspaces = { 'project-1': 'ws-1', 'project-2': 'ws-1', 'project-3': 'ws-1', 'project-4': 'ws-2' }
  const pickerDialog = (title: string) => document.body.querySelector<HTMLElement>(`[role="dialog"][aria-label="${title}"]`)

  it('선택 창(min.wbs.projectTitle)이 먼저 뜨고 후보는 같은 워크스페이스에서 관리자인 프로젝트뿐 — 고른 프로젝트로 준비·등록한다', async () => {
    mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-7', code: '1.2' }] })
    await mountViewer({
      minute: looseMinute, projects, projectWorkspaces, wbsAdminProjectIds: ['project-1', 'project-2', 'project-4'],
    })

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    const picker = pickerDialog('min.wbs.projectTitle')!
    expect(picker).not.toBeNull()
    expect(mocks.prepareMinuteWbsDrafts).not.toHaveBeenCalled()
    expect(picker.textContent).not.toContain('min.issue.projectDesc')
    const select = picker.querySelector<HTMLSelectElement>('select')!
    expect([...select.options].map(option => option.value)).toEqual(['', 'project-1', 'project-2'])

    // 고르지 않고 계속 → 사유
    act(() => { buttonByText(picker, 'min.issue.continue')!.click() })
    expect(picker.textContent).toContain('min.issue.projectRequired')
    expect(mocks.prepareMinuteWbsDrafts).not.toHaveBeenCalled()

    await chooseOption(select, 'project-2')
    mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: true, value: draftsFor(0) })
    await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
    await settle()

    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-2', [blockSource(0)])
    expect(pickerDialog('min.wbs.projectTitle')).toBeNull()
    await act(async () => { submitButton().click() })
    await settle()
    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-2', [expect.objectContaining({ source: blockSource(0) })])
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      action: { label: 'min.wbs.viewInPlan', href: '/p/project-2/wbs?focus=item-7' },
    }))
  })

  it('선택 창에서 준비가 실패하면 창 안에 사유를 보이고 등록 창은 열지 않는다', async () => {
    mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: false, error: '담당자 명단을 읽지 못해 등록 창을 열 수 없습니다.' })
    await mountViewer({ minute: looseMinute, projects, projectWorkspaces, wbsAdminProjectIds: ['project-1'] })

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    const picker = pickerDialog('min.wbs.projectTitle')!
    // 후보가 하나뿐이면 미리 골라 둔다
    expect(picker.querySelector<HTMLSelectElement>('select')!.value).toBe('project-1')
    await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
    await settle()

    // 사유는 알림으로 읽힌다(role="alert")
    expect(picker.querySelector('[role="alert"]')?.textContent).toContain('담당자 명단을 읽지 못해 등록 창을 열 수 없습니다.')
    expect(wbsDialog()).toBeNull()
  })

  it('선택 창의 준비 중에 창을 닫으면 요청을 버린다 — 늦은 응답이 등록 창을 열지 않는다', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    await mountViewer({ minute: looseMinute, projects, projectWorkspaces, wbsAdminProjectIds: ['project-1'] })

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    const picker = pickerDialog('min.wbs.projectTitle')!
    await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(1)
    expect(buttonByText(picker, 'min.wbs.preparing')).not.toBeNull()

    act(() => { buttonByText(picker, 'common.cancel')!.click() })
    expect(pickerDialog('min.wbs.projectTitle')).toBeNull()
    await act(async () => { pending.resolve({ ok: true, value: draftsFor(0) }); await pending.promise })
    expect(wbsDialog()).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('같은 워크스페이스에 관리자인 프로젝트가 없으면 단추가 없다 — 이슈 선택 창은 그대로 모든 프로젝트를 보인다', async () => {
    await mountViewer({ minute: looseMinute, projects, projectWorkspaces, wbsAdminProjectIds: ['project-4'] })

    clickBlock(0)
    expect(wbsButton()).toBeNull()
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="create-minute-issue"]')!.click() })
    const picker = pickerDialog('min.issue.projectTitle')!
    expect(picker).not.toBeNull()
    expect(picker.textContent).toContain('min.issue.projectDesc')
    expect([...picker.querySelector<HTMLSelectElement>('select')!.options].map(option => option.value))
      .toEqual(['', 'project-1', 'project-2', 'project-3', 'project-4'])
  })
})

describe('MinuteViewer 드래그 선택 → WBS 작업', () => {
  type RectCarrier = { getBoundingClientRect?: () => DOMRect }
  const RECT = { top: 100, bottom: 120, left: 40, right: 240, width: 200, height: 20, x: 40, y: 100, toJSON: () => ({}) } as DOMRect

  beforeEach(() => { (Range.prototype as RectCarrier).getBoundingClientRect = () => RECT })
  afterEach(() => { delete (Range.prototype as RectCarrier).getBoundingClientRect })

  /** 문단 0 안의 한 구간을 고른다 */
  function selectInFirstParagraph() {
    const text = container.querySelector('[data-mblock="0"]')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 12)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { document.dispatchEvent(new Event('pointerup')) })
  }
  const bubbleWbsButton = () => buttonByText(container, 'min.wbs.create')

  it('버블에 「WBS로 등록」이 붙어 폭이 300 이 되고, 누르면 선택 발췌를 원문으로(kind manual) 준비해 창을 연다', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    await mountViewer()

    selectInFirstParagraph()
    const wbs = bubbleWbsButton()!
    expect(wbs).not.toBeNull()
    expect(wbs.parentElement!.style.width).toBe('300px')
    await act(async () => { wbs.click() })

    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(1)
    const [projectId, sources] = mocks.prepareMinuteWbsDrafts.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(projectId).toBe('project-1')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ ...blockSource(0), selection: { endBlockIndex: 0, endBlockHash: blocks[0].hash } })
    expect(String((sources[0].selection as { text: string }).text).length).toBeGreaterThan(0)
    // 준비 중에는 두 단추가 막히고 WBS 단추가 「작업 초안 준비 중…」
    expect(buttonByText(container, 'min.wbs.preparing')?.disabled).toBe(true)
    expect(buttonByText(container, 'min.sel.create')?.disabled).toBe(true)

    await act(async () => { pending.resolve({ ok: true, value: draftsFor(0) }); await pending.promise })
    expect(wbsDialog()).not.toBeNull()
  })

  it('선택 준비 중 버블을 벗어나면 요청을 취소한다 — 뒤늦은 응답이 창을 열지 않는다', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    await mountViewer()

    selectInFirstParagraph()
    await act(async () => { bubbleWbsButton()!.click() })
    act(() => { document.dispatchEvent(new Event('pointerdown')) })
    await act(async () => { pending.resolve({ ok: true, value: draftsFor(0) }); await pending.promise })

    expect(wbsDialog()).toBeNull()
  })

  it('한꺼번에 준비 중에는 버블의 두 단추가 막히되 「작업 초안 준비 중…」은 아니다(그 문구는 요약 카드 단추에만)', async () => {
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(new Promise(() => {}))
    await mountViewer({ annotations: { highlights: [], insights: BULK_INSIGHTS } })
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="wbs-bulk"]')!.click() })

    selectInFirstParagraph()
    // WBS 단추는 「WBS로 등록」 그대로(준비 중 문구면 이 단추를 찾지 못한다)이고 막혔다 — 이슈 단추도 막혔다
    expect(bubbleWbsButton()).not.toBeNull()
    expect(bubbleWbsButton()!.disabled).toBe(true)
    expect(buttonByText(container, 'min.sel.create')!.disabled).toBe(true)
  })

  it('지난 버전·보관된 회의록에서는 「WBS로 등록」이 없다 — 문단을 눌러도 팝오버가 없고, 골라도 버블이 없다', async () => {
    await mountViewer({ historicalVersion: { id: 'version-1', versionNo: 1 } })
    clickBlock(0)
    expect(popover()).toBeNull()
    expect(wbsButton()).toBeNull()
    selectInFirstParagraph()
    expect(bubbleWbsButton()).toBeNull()
    expect(buttonByText(container, 'min.sel.create')).toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ minute: { ...minute, archivedAt: '2026-10-21T00:00:00Z' } })
    clickBlock(0)
    expect(popover()).toBeNull()
    expect(wbsButton()).toBeNull()
    selectInFirstParagraph()
    expect(bubbleWbsButton()).toBeNull()
    expect(buttonByText(container, 'min.sel.create')).toBeNull()
  })

  it('관리자가 아니거나 연결 목록을 못 읽었으면 버블은 이슈 단추 하나(폭 180)', async () => {
    await mountViewer({ wbsAdminProjectIds: [] })
    selectInFirstParagraph()
    expect(bubbleWbsButton()).toBeNull()
    expect(buttonByText(container, 'min.sel.create')!.parentElement!.style.width).toBe('180px')

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ linkedWbsItemsError: '연결된 작업 목록을 읽지 못했습니다.' })
    selectInFirstParagraph()
    expect(bubbleWbsButton()).toBeNull()
  })
})

describe('MinuteBlockPopover — 연결된 작업·「WBS로 등록」(실제 컴포넌트)', () => {
  type PopoverModule = typeof import('@/components/minutes/MinuteBlockPopover')
  const STATE = { blockIndex: 0, rect: { top: 100, bottom: 120, left: 40, width: 200 } }

  async function renderPopover(props: Partial<Parameters<PopoverModule['MinuteBlockPopover']>[0]>) {
    const { MinuteBlockPopover } = await vi.importActual<PopoverModule>('@/components/minutes/MinuteBlockPopover')
    await act(async () => {
      root.render(
        <MinuteBlockPopover state={STATE} mine={false} names={[]} insKinds={[]} busy={false} linkedIssues={[]}
          linkedWbsItems={[]} onToggle={vi.fn()} onCreateIssue={vi.fn()} onClose={vi.fn()} {...props} />,
      )
    })
  }

  it('연결이 없으면 「WBS로 등록」, 누르면 onCreateWbs', async () => {
    const onCreateWbs = vi.fn()
    await renderPopover({ onCreateWbs })
    expect(container.textContent).not.toContain('min.wbs.linked')
    const button = buttonByText(container, 'min.wbs.create')!
    expect(button.disabled).toBe(false)
    act(() => { button.click() })
    expect(onCreateWbs).toHaveBeenCalledTimes(1)
  })

  it('연결이 있으면 「연결된 작업」 두 건 + 「외 N건」, 각 링크는 작업 계획의 그 작업 — 단추는 「WBS로 하나 더 등록」', async () => {
    const items = [link('1', 0, 'h'), link('2', 0, 'h'), link('3', 0, 'h')]
    await renderPopover({ onCreateWbs: vi.fn(), linkedWbsItems: items })
    expect(container.textContent).toContain('min.wbs.linked')
    const hrefs = [...container.querySelectorAll('a')].map(anchor => anchor.getAttribute('href'))
    expect(hrefs).toEqual(['/p/project-1/wbs?focus=item-1', '/p/project-1/wbs?focus=item-2'])
    expect(container.textContent).toContain('2.1.1')
    expect(container.textContent).toContain('작업 1')
    expect(container.textContent).toContain('min.wbs.more 1')
    expect(buttonByText(container, 'min.wbs.createAnother')).not.toBeNull()
  })

  it('canCreateWbs=false 면 막히고, 준비 중이면 「작업 초안 준비 중…」으로 두 등록 단추가 막힌다', async () => {
    await renderPopover({ onCreateWbs: vi.fn(), canCreateWbs: false })
    expect(buttonByText(container, 'min.wbs.create')!.disabled).toBe(true)

    await renderPopover({ onCreateWbs: vi.fn(), wbsBusy: true })
    expect(buttonByText(container, 'min.wbs.preparing')!.disabled).toBe(true)
    expect(buttonByText(container, 'min.issue.create')!.disabled).toBe(true)
  })

  it('onCreateWbs 가 없으면 단추는 없되 연결된 작업은 보인다(볼 수 있는 사람 모두)', async () => {
    await renderPopover({ linkedWbsItems: [link('1', 0, 'h')] })
    expect(buttonByText(container, 'min.wbs.create')).toBeNull()
    expect(buttonByText(container, 'min.wbs.createAnother')).toBeNull()
    expect(container.textContent).toContain('min.wbs.linked')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/p/project-1/wbs?focus=item-1')
  })
})

describe('MinuteViewer AI 요약 카드 → WBS 한꺼번에 등록', () => {
  const bulkButton = () => container.querySelector<HTMLButtonElement>('[data-testid="wbs-bulk"]')
  const forceBulk = () => container.querySelector<HTMLButtonElement>('[data-testid="wbs-bulk-force"]')
  const bulkDialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="min.wbs.bulkTitle"]')
  const lastCard = () => mocks.cardProps.at(-1)!
  const withActions = { annotations: { highlights: [], insights: BULK_INSIGHTS } }
  const twoItems = [{ row: 0, itemId: 'item-1', code: '2.1.4' }, { row: 1, itemId: 'item-2', code: '2.1.5' }]

  it('「WBS로 한꺼번에 등록」 → 액션 문단 전부(제목 줄·옛 본문 제외, 문단 순서, kind action)로 준비 1회 → bulk 창 → 등록 → createdN 토스트·refresh, 공통 위치를 기억한다', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: twoItems })
    await mountViewer(withActions)

    expect(lastCard().canBulkWbs).toBe(true)
    await act(async () => { bulkButton()!.click() })

    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(1)
    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-1', [actionSource(0), actionSource(2)])
    // 준비 중에는 카드 단추가 막히고 창은 아직 없다
    expect(lastCard().wbsBusy).toBe(true)
    expect(bulkButton()!.disabled).toBe(true)
    expect(bulkDialog()).toBeNull()

    await act(async () => { pending.resolve({ ok: true, value: bulkDrafts() }); await pending.promise })
    const dialog = bulkDialog()!
    expect(dialog).not.toBeNull()
    expect(lastCard().wbsBusy).toBe(false)
    expect(dialog.textContent).toContain('min.wbs.selectedCount 2')

    await act(async () => { buttonByText(dialog, 'min.wbs.submitN')!.click() })
    await settle()
    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledTimes(1)
    expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-1', [
      {
        source: actionSource(0), name: '작업 0', parentId: 'parent-1',
        plannedStart: null, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: false,
      },
      {
        source: actionSource(2), name: '작업 2', parentId: 'parent-1',
        plannedStart: null, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: false,
      },
    ])
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'min.wbs.createdN 2',
      variant: 'success',
      action: { label: 'min.wbs.viewInPlan', href: '/p/project-1/wbs?focus=item-1' },
    })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(bulkDialog()).toBeNull()

    // 두 줄의 공통 위치(parent-1)를 마지막 위치로 기억한다 — 추천 없는 다음 한 건 등록이 그 위치로 열린다
    const single = await openWbsModal(2, draftsFor(2, { parentIds: [] }))
    expect(single.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value).toBe('parent-1')
  })

  it('액션 항목이 없으면(위험·제목 줄 액션·옛 본문 요약뿐) 단추가 없다 — 그래도 불리면 min.wbs.noAction 토스트만, 준비하지 않는다', async () => {
    await mountViewer({
      annotations: {
        highlights: [],
        insights: [riskInsight, actionInsight('a1', 1), actionInsight('stale', 2, { bodyHash: 'old-body-hash' })],
      },
    })
    expect(lastCard().canBulkWbs).toBe(false)
    expect(bulkButton()).toBeNull()

    await act(async () => { forceBulk()!.click() })
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'min.wbs.noAction', variant: 'info' })
    expect(mocks.prepareMinuteWbsDrafts).not.toHaveBeenCalled()
    expect(bulkDialog()).toBeNull()
  })

  it('관리자가 아니거나 연결 목록을 못 읽었거나 보관된 회의록이면 단추가 없다(onBulkWbs 도 없다)', async () => {
    await mountViewer({ ...withActions, wbsAdminProjectIds: [] })
    expect(lastCard().canBulkWbs).toBe(false)
    expect(lastCard().onBulkWbs).toBeUndefined()
    expect(bulkButton()).toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ ...withActions, linkedWbsItemsError: '연결된 작업 목록을 읽지 못했습니다.' })
    expect(lastCard().canBulkWbs).toBe(false)
    expect(lastCard().onBulkWbs).toBeUndefined()

    act(() => root.unmount())
    root = createRoot(container)
    await mountViewer({ ...withActions, minute: { ...minute, archivedAt: '2026-10-21T00:00:00Z' } })
    expect(lastCard().canBulkWbs).toBe(false)
  })

  it('준비 실패 — 사유 토스트(min.wbs.prepareFailed), 창은 열지 않는다. 요청이 reject 돼도 같다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prepareMinuteWbsDrafts
      .mockResolvedValueOnce({ ok: false, error: '제목 줄은 WBS 작업으로 등록할 수 없습니다.' })
      .mockRejectedValueOnce(new Error('network down'))
    await mountViewer(withActions)

    await act(async () => { bulkButton()!.click() })
    await settle()
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: 'min.wbs.prepareFailed', description: '제목 줄은 WBS 작업으로 등록할 수 없습니다.', variant: 'error',
    })
    expect(bulkDialog()).toBeNull()
    expect(lastCard().wbsBusy).toBe(false)

    await act(async () => { bulkButton()!.click() })
    await settle()
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'min.wbs.prepareFailed', variant: 'error' })
    expect(bulkDialog()).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('준비 중에 문단 팝오버를 열고 닫아도 한꺼번에 준비는 이어진다(팝오버가 버리는 것은 그 문단의 준비뿐) — 창이 열리면 열린 팝오버는 닫힌다', async () => {
    const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    await mountViewer(withActions)

    await act(async () => { bulkButton()!.click() })
    clickBlock(0)
    expect(popover()).not.toBeNull()
    // 그동안 문단의 두 등록은 막히되 「작업 초안 준비 중…」은 아니다 — 그 문구는 준비 중인 흐름의 단추(카드)에만
    expect(lastPopover().wbsBusy).toBe(false)
    expect(container.querySelector('[data-testid="wbs-busy"]')?.textContent).toBe('idle')
    expect(wbsButton()!.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-testid="create-minute-issue"]')!.disabled).toBe(true)
    expect(bulkButton()!.textContent).toBe('min.wbs.preparing')
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="close-minute-popover"]')!.click() })
    expect(popover()).toBeNull()
    expect(lastCard().wbsBusy).toBe(true)

    clickBlock(2)
    expect(popover()).not.toBeNull()
    await act(async () => { pending.resolve({ ok: true, value: bulkDrafts() }); await pending.promise })
    expect(bulkDialog()).not.toBeNull()
    expect(popover()).toBeNull()
  })

  it('문단 한 건을 준비하는 중에는 카드 단추가 막히되 「작업 초안 준비 중…」은 아니다 — 끝나면 다시 열린다', async () => {
    const pending = deferred<{ ok: false; error: string }>()
    mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
    await mountViewer(withActions)

    clickBlock(0)
    act(() => { wbsButton()!.click() })
    expect(container.querySelector('[data-testid="wbs-busy"]')?.textContent).toBe('busy')
    expect(lastCard().wbsBusy).toBe(false)
    expect(lastCard().bulkDisabled).toBe(true)
    expect(bulkButton()!.disabled).toBe(true)
    expect(bulkButton()!.textContent).toBe('bulk')

    await act(async () => { pending.resolve({ ok: false, error: '작업 계획을 읽지 못했습니다.' }); await pending.promise })
    expect(lastCard().bulkDisabled).toBe(false)
    expect(bulkButton()!.disabled).toBe(false)
  })

  it('이슈 초안을 준비하는 중에는 카드 단추가 막혀 보인다(누를 수 없다) — 이슈 폼과 등록 창이 겹치지 않게. 준비가 끝나면 다시 열린다', async () => {
    const issueDraft = deferred<{ ok: false; error: string }>()
    mocks.prepareMinuteIssueDraft.mockReturnValueOnce(issueDraft.promise)
    await mountViewer(withActions)

    clickBlock(0)
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="create-minute-issue"]')!.click() })
    expect(mocks.prepareMinuteIssueDraft).toHaveBeenCalledTimes(1)
    expect(lastCard().bulkDisabled).toBe(true)
    expect(lastCard().wbsBusy).toBe(false)
    expect(bulkButton()!.disabled).toBe(true)
    await act(async () => { bulkButton()!.click() })
    expect(mocks.prepareMinuteWbsDrafts).not.toHaveBeenCalled()

    await act(async () => { issueDraft.resolve({ ok: false, error: '이슈 초안 실패' }); await issueDraft.promise })
    expect(bulkDialog()).toBeNull()
    expect(bulkButton()!.disabled).toBe(false)
  })

  it('이슈 초안 준비를 팝오버를 닫아 버린 뒤에도 한꺼번에 등록이 된다 — 막힌 채로 남지 않는다', async () => {
    mocks.prepareMinuteIssueDraft.mockReturnValueOnce(new Promise(() => {}))
    mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: true, value: bulkDrafts() })
    await mountViewer(withActions)

    clickBlock(0)
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="create-minute-issue"]')!.click() })
    expect(bulkButton()!.disabled).toBe(true)
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="close-minute-popover"]')!.click() })
    expect(popover()).toBeNull()
    expect(bulkButton()!.disabled).toBe(false)

    await act(async () => { bulkButton()!.click() })
    expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-1', [actionSource(0), actionSource(2)])
    await settle()
    expect(bulkDialog()).not.toBeNull()
  })

  it('요약 카드는 연결된 작업을 지금 문단 위치로 받는다(activeLinkedWbs — 맞는 문단이 없는 연결은 빠진다)', async () => {
    await mountViewer({ linkedWbsItems: [link('1', 0, blocks[2].hash), link('3', 0, 'gone-hash')] })
    const received = lastCard().linkedWbsItems as MinuteLinkedWbsItem[]
    expect(received.map(item => [item.linkId, item.blockIndex])).toEqual([['1', 2]])
  })

  describe('프로젝트 없는 회의록 — 선택 창 뒤 한꺼번에', () => {
    const looseMinute: Minute = { ...minute, projectId: null, ownProjectId: null, meetingProjectId: null }
    const projects = [{ id: 'project-1', name: '프로젝트 A' }, { id: 'project-2', name: '프로젝트 B' }]
    const projectWorkspaces = { 'project-1': 'ws-1', 'project-2': 'ws-1' }
    const loose = { ...withActions, minute: looseMinute, projects, projectWorkspaces, wbsAdminProjectIds: ['project-1', 'project-2'] }
    const pickerDialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="min.wbs.projectTitle"]')

    it('선택 창을 먼저 띄우고, 고른 프로젝트로 액션 문단 전부를 준비해 bulk 창을 연다 — 등록·토스트도 그 프로젝트', async () => {
      mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: true, value: bulkDrafts() })
      mocks.createWbsItemsFromMinute.mockResolvedValueOnce({ ok: true, items: twoItems })
      await mountViewer(loose)
      expect(lastCard().canBulkWbs).toBe(true)

      await act(async () => { bulkButton()!.click() })
      const picker = pickerDialog()!
      expect(picker).not.toBeNull()
      expect(mocks.prepareMinuteWbsDrafts).not.toHaveBeenCalled()
      await chooseOption(picker.querySelector<HTMLSelectElement>('select')!, 'project-2')
      await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
      await settle()

      expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-2', [actionSource(0), actionSource(2)])
      expect(pickerDialog()).toBeNull()
      const dialog = bulkDialog()!
      expect(dialog).not.toBeNull()
      await act(async () => { buttonByText(dialog, 'min.wbs.submitN')!.click() })
      await settle()
      expect(mocks.createWbsItemsFromMinute).toHaveBeenCalledWith('project-2', [
        expect.objectContaining({ source: actionSource(0) }), expect.objectContaining({ source: actionSource(2) }),
      ])
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'min.wbs.createdN 2', action: { label: 'min.wbs.viewInPlan', href: '/p/project-2/wbs?focus=item-1' },
      }))
    })

    it('한꺼번에 준비 중에 선택 창을 닫으면 요청을 버린다 — 늦은 응답이 bulk 창을 열지 않는다', async () => {
      const pending = deferred<{ ok: true; value: MinuteWbsDrafts }>()
      mocks.prepareMinuteWbsDrafts.mockReturnValueOnce(pending.promise)
      await mountViewer(loose)

      await act(async () => { bulkButton()!.click() })
      const picker = pickerDialog()!
      await chooseOption(picker.querySelector<HTMLSelectElement>('select')!, 'project-1')
      await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
      expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-1', [actionSource(0), actionSource(2)])

      act(() => { buttonByText(picker, 'common.cancel')!.click() })
      expect(pickerDialog()).toBeNull()
      await act(async () => { pending.resolve({ ok: true, value: bulkDrafts() }); await pending.promise })
      expect(bulkDialog()).toBeNull()
      expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('낡은 요청 — 선택 창을 닫고 다시 시작한 한꺼번에 등록은 앞 요청들의 늦은 응답(성공·reject)을 버리고 마지막 요청만 연다', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const first = deferred<{ ok: true; value: MinuteWbsDrafts }>()
      const second = deferred<{ ok: true; value: MinuteWbsDrafts }>()
      const third = deferred<{ ok: true; value: MinuteWbsDrafts }>()
      mocks.prepareMinuteWbsDrafts
        .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
      await mountViewer(loose)

      /** 카드 단추 → 선택 창에서 project-1 → 계속(준비 요청) — 그 선택 창을 돌려준다 */
      async function startAndContinue() {
        await act(async () => { bulkButton()!.click() })
        const picker = pickerDialog()!
        await chooseOption(picker.querySelector<HTMLSelectElement>('select')!, 'project-1')
        await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
        return picker
      }
      // 두 번은 준비 중에 선택 창을 닫고, 세 번째는 기다린다
      let picker = await startAndContinue()
      act(() => { buttonByText(picker, 'common.cancel')!.click() })
      picker = await startAndContinue()
      act(() => { buttonByText(picker, 'common.cancel')!.click() })
      picker = await startAndContinue()
      expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(3)

      // 앞 두 요청이 늦게 온다 — 성공도 reject 도 창·사유·로그·토스트를 남기지 않는다
      await act(async () => { first.resolve({ ok: true, value: bulkDrafts() }); await first.promise })
      await act(async () => { second.reject(new Error('network down')); await second.promise.catch(() => {}) })
      expect(bulkDialog()).toBeNull()
      expect(picker.querySelector('[role="alert"]')).toBeNull()
      expect(spy).not.toHaveBeenCalled()
      expect(mocks.toast).not.toHaveBeenCalled()

      // 마지막 요청만 창을 연다 — 그 초안으로
      const latest = bulkDrafts()
      latest.rows[0] = { ...latest.rows[0], name: '세 번째 준비의 작업' }
      await act(async () => { third.resolve({ ok: true, value: latest }); await third.promise })
      expect(pickerDialog()).toBeNull()
      const dialog = bulkDialog()!
      expect(field<HTMLInputElement>(dialog.querySelector('[data-wbs-row="0"]')!, 'min.wbs.name').value).toBe('세 번째 준비의 작업')
      spy.mockRestore()
    })

    it('한꺼번에의 선택 창을 닫은 뒤 문단에서 시작한 한 건 등록은 그 문단만 준비한다(한꺼번에의 원문을 이어 쓰지 않는다)', async () => {
      mocks.prepareMinuteWbsDrafts.mockResolvedValueOnce({ ok: true, value: draftsFor(0) })
      await mountViewer(loose)

      await act(async () => { bulkButton()!.click() })
      act(() => { buttonByText(pickerDialog()!, 'common.cancel')!.click() })
      expect(pickerDialog()).toBeNull()

      clickBlock(0)
      act(() => { wbsButton()!.click() })
      const picker = pickerDialog()!
      await chooseOption(picker.querySelector<HTMLSelectElement>('select')!, 'project-1')
      await act(async () => { buttonByText(picker, 'min.issue.continue')!.click() })
      await settle()
      expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledTimes(1)
      expect(mocks.prepareMinuteWbsDrafts).toHaveBeenCalledWith('project-1', [blockSource(0)])
      expect(wbsDialog()).not.toBeNull()
      expect(bulkDialog()).toBeNull()
    })
  })
})

describe('MinuteInsightCard — 한꺼번에 단추·작업 칩·연결된 작업(실제 컴포넌트)', () => {
  type CardModule = typeof import('@/components/minutes/MinuteInsightCard')
  // 지금 본문의 요약(ready) — 비었거나 낡은 요약이면 카드가 스스로 다시 만들러 간다(self-heal)
  const FRESH = [actionInsight('a0', 0)]

  async function renderCard(props: Partial<Parameters<CardModule['MinuteInsightCard']>[0]> = {}) {
    const { MinuteInsightCard } = await vi.importActual<CardModule>('@/components/minutes/MinuteInsightCard')
    await act(async () => {
      root.render(
        <MinuteInsightCard minuteId="minute-1" insights={FRESH} highlights={[]} blocks={blocks} bodyHash={bodyHash}
          onJump={vi.fn()} {...props} />,
      )
    })
  }

  it('canBulkWbs 면 머리에 「WBS로 한꺼번에 등록」 — 누르면 onBulkWbs, 준비 중이면 「작업 초안 준비 중…」으로 막힌다', async () => {
    const onBulkWbs = vi.fn()
    await renderCard({ canBulkWbs: true, onBulkWbs })
    const button = buttonByText(container, 'min.wbs.bulkButton')!
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(false)
    act(() => { button.click() })
    expect(onBulkWbs).toHaveBeenCalledTimes(1)

    await renderCard({ canBulkWbs: true, onBulkWbs, wbsBusy: true })
    expect(buttonByText(container, 'min.wbs.bulkButton')).toBeNull()
    expect(buttonByText(container, 'min.wbs.preparing')!.disabled).toBe(true)
  })

  it('다른 등록을 준비하는 중이면(bulkDisabled) 단추는 막히되 문구는 그대로다', async () => {
    const onBulkWbs = vi.fn()
    await renderCard({ canBulkWbs: true, onBulkWbs, bulkDisabled: true })
    const button = buttonByText(container, 'min.wbs.bulkButton')!
    expect(button.disabled).toBe(true)
    expect(buttonByText(container, 'min.wbs.preparing')).toBeNull()
    act(() => { button.click() })
    expect(onBulkWbs).not.toHaveBeenCalled()
  })

  it('canBulkWbs 가 아니면(관리자 아님·액션 없음 — 뷰어가 판정한다) 단추가 없다', async () => {
    await renderCard({ onBulkWbs: vi.fn() })
    expect(buttonByText(container, 'min.wbs.bulkButton')).toBeNull()
    expect(buttonByText(container, 'min.wbs.preparing')).toBeNull()
  })

  it('연결된 작업이 있으면 머리에 「작업 N」 칩 — 누르면 펼쳐 「연결된 작업」: 줄은 원문 위치로, 링크는 작업 계획의 그 작업', async () => {
    const onJump = vi.fn()
    await renderCard({ onJump, linkedWbsItems: [link('1', 2, blocks[2].hash), link('2', 0, blocks[0].hash)] })
    expect(container.textContent).not.toContain('min.wbs.linked')
    const chip = buttonByText(container, 'min.wbs.count 2')!
    expect(chip).not.toBeNull()
    act(() => { chip.click() })

    expect(container.textContent).toContain('min.wbs.linked')
    const planLinks = [...container.querySelectorAll('a')].filter(anchor => anchor.getAttribute('aria-label') === 'min.wbs.viewInPlan')
    expect(planLinks.map(anchor => anchor.getAttribute('href')))
      .toEqual(['/p/project-1/wbs?focus=item-1', '/p/project-1/wbs?focus=item-2'])
    act(() => { buttonByText(container, '작업 1')!.click() })
    expect(onJump).toHaveBeenCalledWith(2)
  })

  it('연결된 작업이 없으면 칩도 목록도 없다', async () => {
    await renderCard()
    expect(container.textContent).not.toContain('min.wbs.count')
    act(() => { buttonByText(container, 'min.insight.expand')!.click() })
    expect(container.textContent).not.toContain('min.wbs.linked')
  })
})
