// @vitest-environment jsdom
// 회의록 → WBS 등록 창의 한꺼번에(bulk) 모양 — 창 단독(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.2).
// 처음 체크는 추천 위치가 있고 아직 등록되지 않은 줄만, 등록된 줄은 회색·체크 불가·「작업 계획에서 보기」, 「위치 한꺼번에 바꾸기」는
// 체크된 줄 전부(바뀐 줄의 말단 확인은 다시), 체크 0 이면 막힘, 거부의 줄 번호(보낸 배열의 자리)는 화면 줄로 되돌린다, 성공은
// onCreated(items, 공통 위치|null). 보내는 줄은 체크된 줄뿐이고 원문 앵커는 받은 그대로(kind action)다 — 전부 또는 전무는 RPC 몫.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  WBS_ROOT_PARENT, type MinuteWbsCreateRow, type MinuteWbsDraftRow, type MinuteWbsDrafts, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { escStack } from '@/lib/ui/escStack'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 키를 돌려주되 {n} 이 든 문구는 자리를 남긴다 — 호출부가 숫자를 채우는지 본다
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string) => (/^min\.wbs\.(selectedCount|submitN|rowFailed|leafActual|leafDeps)$/.test(key) ? `${key} {n}` : key),
  }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import { MinuteWbsRegisterModal } from '@/components/minutes/MinuteWbsRegisterModal'

type Props = Parameters<typeof MinuteWbsRegisterModal>[0]
type Created = { row: number; itemId: string; code: string }
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(onResolve => { resolve = onResolve })
  return { promise, resolve }
}

const opt = (id: string, path: string, extra: Partial<MinuteWbsParentOption> = {}): MinuteWbsParentOption => ({
  id, path, depth: path.split(' › ').length - 1, leaf: false, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames: [], ...extra,
})
const PARENTS = [
  opt('parent-1', '2 개발 › 2.1 인증'),
  opt('parent-2', '3 설계 › 3.2 화면설계'),
  opt('leaf-1', '4 운영 › 4.1 점검', { leaf: true, actualPct: 40 }),
  opt('leaf-2', '4 운영 › 4.2 백업', { leaf: true }),
]

const draftRow = (row: number, extra: Partial<MinuteWbsDraftRow> = {}): MinuteWbsDraftRow => ({
  row, blockIndex: row * 2, blockHash: `h${row * 2}`, excerpt: `문단 ${row} 원문`, name: `작업 ${row}`,
  parentIds: [], plannedEnd: null, assigneeMemberId: null, registered: null, ...extra,
})

/** 줄 넷 — 0·1 은 추천 위치가 있고, 2 는 추천이 없고, 3 은 이미 등록됐다(추천이 있어도 체크하지 않는다) */
const DRAFTS: MinuteWbsDrafts = {
  rows: [
    draftRow(0, {
      name: '로그인 API 개발', parentIds: ['parent-1'], plannedEnd: '2026-10-31', assigneeMemberId: 'member-1',
      excerpt: '김민수가 10/31 까지 로그인 API 를 개발한다.',
    }),
    draftRow(1, { name: '권한 화면 시안', parentIds: ['parent-2'] }),
    draftRow(2, { name: '서버 증설 검토' }),
    draftRow(3, { name: '백업 정책 정리', parentIds: ['parent-1'], registered: { itemId: 'item-9', code: '2.1.3', name: '백업 정책 정리' } }),
  ],
  parents: PARENTS,
  members: [{ id: 'member-1', name: '김민수' }],
  mode: 'ai',
}

/** 줄마다의 원문 앵커 — 뷰어가 준비에 보낸 배열 그대로(같은 순서). 한꺼번에 등록은 kind 'action' */
const SOURCES: MinuteIssueSourceInput[] = DRAFTS.rows.map(draft => ({
  minuteId: 'minute-1', minuteVersionId: 'version-2', bodyHash: 'body-hash', blockIndex: draft.blockIndex, blockHash: draft.blockHash, kind: 'action',
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  escStack.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount(extra: Partial<Props> = {}) {
  const onSubmit = vi.fn<Props['onSubmit']>()
  const onCreated = vi.fn<Props['onCreated']>()
  const onClose = vi.fn()
  await act(async () => {
    root.render(
      <MinuteWbsRegisterModal open mode="bulk" projectId="project-1" drafts={DRAFTS} sources={SOURCES} lastParentId={null}
        onClose={onClose} onSubmit={onSubmit} onCreated={onCreated} {...extra} />,
    )
  })
  return { onSubmit, onCreated, onClose }
}

/** 마이크로태스크·0ms 타이머까지 흘린다(등록 응답의 연속 코드, 창의 dirty 기준값) */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="min.wbs.bulkTitle"]')!
const row = (index: number) => dialog().querySelector<HTMLElement>(`[data-wbs-row="${index}"]`)!
/** 줄을 고르는 체크 — 말단 확인 체크(MinuteWbsRowFields)와 다르다 */
const rowCheck = (index: number) => row(index).querySelector<HTMLInputElement>('input[type="checkbox"][data-wbs-row-check]')!
const bulkPanel = () => dialog().querySelector<HTMLElement>('[data-wbs-bulk-parent]')
const buttonByText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text)) ?? null
const submitButton = () => buttonByText(dialog(), 'min.wbs.submitN')!
/** 그 범위에서 골라진 위치 — 찾기를 펼쳤으면 검색 목록의 라디오가 골라진 것을 보인다 */
const pickedParent = (scope: ParentNode) => scope.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? null
const confirmBox = (scope: ParentNode) => [...scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  .find(box => box.closest('label')?.textContent?.includes('min.wbs.leafConfirm')) ?? null
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
async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}
/** 범위 안의 「다른 위치 찾기…」를 펼쳐 검색 목록에서 id 를 고른다 */
async function pickFromSearch(scope: HTMLElement, id: string) {
  const toggle = buttonByText(scope, 'min.wbs.parentSearch')!
  if (toggle.getAttribute('aria-expanded') !== 'true') await click(toggle)
  await click(scope.querySelector<HTMLInputElement>(`[data-wbs-parent-results] input[type="radio"][value="${id}"]`)!)
}
const rootRadio = (scope: ParentNode) => scope.querySelector<HTMLInputElement>(`input[type="radio"][value="${WBS_ROOT_PARENT}"]`)!
/** 회색 — 그 범위에 opacity-NN 클래스가 있는가(찾기 단추의 disabled:opacity-50 같은 상태 변형은 세지 않는다) */
const greyed = (scope: Element) =>
  [scope, ...scope.querySelectorAll('*')].some(element => [...element.classList].some(name => /^opacity-\d+$/.test(name)))

describe('MinuteWbsRegisterModal — 한꺼번에(bulk)', () => {
  it('처음 체크는 추천 위치가 있고 아직 등록되지 않은 줄뿐 — 등록된 줄은 회색·체크 불가·작업 계획 링크(칸 없음), 머리에 선택 수', async () => {
    await mount()
    expect(dialog()).not.toBeNull()
    expect(rowCheck(0).checked).toBe(true)
    expect(rowCheck(1).checked).toBe(true)
    expect(rowCheck(2).checked).toBe(false)
    expect(rowCheck(2).disabled).toBe(false)
    expect(rowCheck(3).checked).toBe(false)
    expect(rowCheck(3).disabled).toBe(true)

    // 등록된 줄 — 회색(opacity), 등록됨 표시, 작업 계획의 그 작업으로 가는 링크, 고칠 칸은 없다
    expect(row(3).hasAttribute('data-registered')).toBe(true)
    expect(greyed(row(3))).toBe(true)
    expect(row(3).textContent).toContain('min.wbs.registered')
    expect(row(3).textContent).toContain('2.1.3')
    const planLink = row(3).querySelector('a')!
    expect(planLink.getAttribute('href')).toBe('/p/project-1/wbs?focus=item-9')
    expect(planLink.textContent).toContain('min.wbs.viewInPlan')
    expect(row(3).querySelector('input:not([type="checkbox"]), select')).toBeNull()
    // 체크하려 해도 체크되지 않는다
    await click(rowCheck(3))
    expect(rowCheck(3).checked).toBe(false)
    expect(row(0).hasAttribute('data-registered')).toBe(false)
    expect(greyed(row(0))).toBe(false)

    expect(dialog().textContent).toContain('min.wbs.selectedCount 2')
    expect(submitButton().textContent).toContain('min.wbs.submitN 2')
    expect(submitButton().disabled).toBe(false)
    expect(dialog().textContent).not.toContain('min.wbs.nothingSelected')

    // 줄마다 칸 전부(작업명·위치·종료일·담당자) — 추천 위치가 골라져 있고, 추천 없는 줄은 「위치를 골라 주세요」
    expect(field<HTMLInputElement>(row(0), 'min.wbs.name').value).toBe('로그인 API 개발')
    expect(field<HTMLInputElement>(row(0), 'min.wbs.plannedEnd').value).toBe('2026-10-31')
    expect(field<HTMLSelectElement>(row(0), 'min.wbs.assignee').value).toBe('member-1')
    expect(pickedParent(row(0))).toBe('parent-1')
    expect(pickedParent(row(1))).toBe('parent-2')
    expect(pickedParent(row(2))).toBeNull()
    expect(row(2).textContent).toContain('min.wbs.parentPlaceholder')
    expect(dialog().textContent).not.toContain('min.wbs.fallbackMode')
  })

  it('원문은 접혀 있다가 줄의 「원문」을 누르면 그 줄만 펼쳐진다', async () => {
    await mount()
    const toggle = buttonByText(row(0), 'min.wbs.excerpt')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row(0).textContent).not.toContain('김민수가 10/31 까지 로그인 API 를 개발한다.')
    await click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row(0).textContent).toContain('김민수가 10/31 까지 로그인 API 를 개발한다.')
    expect(row(1).textContent).not.toContain('문단 1 원문')
    // 등록된 줄도 원문을 볼 수 있다(어느 문단인지)
    await click(buttonByText(row(3), 'min.wbs.excerpt')!)
    expect(row(3).textContent).toContain('문단 3 원문')
  })

  it('결정형 초안이면 안내가 보인다', async () => {
    await mount({ drafts: { ...DRAFTS, mode: 'fallback' } })
    expect(dialog().textContent).toContain('min.wbs.fallbackMode')
  })

  it('「위치 한꺼번에 바꾸기」 — 추천 없이 펼치고(아무 줄도 바뀌지 않는다), 고른 위치를 체크된 줄 전부에 넣는다. 위치가 바뀐 줄은 말단 확인을 다시 받는다', async () => {
    const { onSubmit } = await mount()
    onSubmit.mockResolvedValueOnce({ ok: true, items: [{ row: 0, itemId: 'item-1', code: '4.2.1' }, { row: 1, itemId: 'item-2', code: '4.2.2' }] })

    // 첫 줄은 자기 칸에서 말단(leaf-1)을 골라 확인해 둔다
    await pickFromSearch(row(0), 'leaf-1')
    await click(confirmBox(row(0))!)
    expect(confirmBox(row(0))!.checked).toBe(true)

    expect(bulkPanel()).toBeNull()
    const toggle = buttonByText(dialog(), 'min.wbs.changeParentAll')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const panel = bulkPanel()!
    expect(panel).not.toBeNull()
    // 추천을 주지 않는다 — 펼치기만으로는 아무것도 고르지 않고 줄도 그대로다
    expect(pickedParent(panel)).toBeNull()
    expect(panel.textContent).not.toContain('min.wbs.parentRecommended')
    expect(pickedParent(row(0))).toBe('leaf-1')
    expect(pickedParent(row(1))).toBe('parent-2')

    // 다른 말단(leaf-2)을 고르면 체크된 줄 0·1 이 그 위치 — 확인은 풀리고, 체크 안 된 줄 2·등록된 줄 3 은 그대로
    await pickFromSearch(panel, 'leaf-2')
    expect(pickedParent(row(0))).toBe('leaf-2')
    expect(pickedParent(row(1))).toBe('leaf-2')
    expect(pickedParent(row(2))).toBeNull()
    expect(rowCheck(2).checked).toBe(false)
    expect(confirmBox(row(0))!.checked).toBe(false)
    expect(confirmBox(row(1))!.checked).toBe(false)
    expect(submitButton().disabled).toBe(true)

    // 줄마다 확인해야 열린다
    await click(confirmBox(row(0))!)
    expect(submitButton().disabled).toBe(true)
    await click(confirmBox(row(1))!)
    expect(submitButton().disabled).toBe(false)

    await click(submitButton())
    await settle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ source: SOURCES[0], parentId: 'leaf-2', confirmParentLeaf: true }),
      expect.objectContaining({ source: SOURCES[1], parentId: 'leaf-2', confirmParentLeaf: true }),
    ])
  })

  it('체크가 하나도 없으면 등록 단추와 한꺼번에 바꾸기가 막히고 min.wbs.nothingSelected — 체크된 줄 하나라도 위치·이름이 없으면 막힌다', async () => {
    const { onSubmit } = await mount()
    await click(rowCheck(0))
    await click(rowCheck(1))
    expect(dialog().textContent).toContain('min.wbs.selectedCount 0')
    expect(submitButton().textContent).toContain('min.wbs.submitN 0')
    expect(submitButton().disabled).toBe(true)
    expect(dialog().textContent).toContain('min.wbs.nothingSelected')
    expect(buttonByText(dialog(), 'min.wbs.changeParentAll')!.disabled).toBe(true)
    await click(submitButton())
    expect(onSubmit).not.toHaveBeenCalled()

    // 위치를 고르지 않은 줄 2 를 체크 — 안내는 사라지지만 막힌다. 눌러도 보내지 않는다(고르지 않은 위치가 맨 위로 가지 않는다)
    await click(rowCheck(2))
    expect(dialog().textContent).toContain('min.wbs.selectedCount 1')
    expect(dialog().textContent).not.toContain('min.wbs.nothingSelected')
    expect(pickedParent(row(2))).toBeNull()
    expect(submitButton().disabled).toBe(true)
    await click(submitButton())
    expect(onSubmit).not.toHaveBeenCalled()
    // 맨 위를 고르면 열린다
    await click(rootRadio(row(2)))
    expect(submitButton().disabled).toBe(false)

    // 체크된 줄의 이름이 비면(공백만도) 막히고, 그 줄을 빼면 다시 열린다(체크 안 된 줄은 보지 않는다)
    await click(rowCheck(0))
    await typeInto(field<HTMLInputElement>(row(0), 'min.wbs.name'), '   ')
    expect(submitButton().disabled).toBe(true)
    await click(rowCheck(0))
    expect(submitButton().disabled).toBe(false)
  })

  it('추천이 없어 빠진 줄은 위치를 고르면 체크된다(설계 §3.2)', async () => {
    await mount()
    expect(rowCheck(2).checked).toBe(false)
    await click(rootRadio(row(2)))
    expect(rowCheck(2).checked).toBe(true)
    expect(dialog().textContent).toContain('min.wbs.selectedCount 3')
  })

  it('성공 — 체크된 줄만 보낸다(등록된 줄은 보내지 않는다): 앵커는 그 줄의 것 그대로(kind action), 빈 칸 null, 이름은 앞뒤 공백을 뺀다. 같은 틱의 두 번 누름은 한 번. 위치가 서로 다르면 공통 위치 null', async () => {
    const items: Created[] = [{ row: 0, itemId: 'item-1', code: '2.1.4' }, { row: 1, itemId: 'item-2', code: '3.2.1' }]
    const { onSubmit, onCreated, onClose } = await mount()
    const pending = deferred<{ ok: true; items: Created[] }>()
    onSubmit.mockReturnValueOnce(pending.promise)
    await typeInto(field<HTMLInputElement>(row(1), 'min.wbs.name'), '  권한 화면 시안 검토  ')

    await act(async () => { submitButton().click(); submitButton().click() })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // 보내는 동안에는 체크·한꺼번에 바꾸기·칸이 잠긴다
    expect(rowCheck(2).disabled).toBe(true)
    expect(buttonByText(dialog(), 'min.wbs.changeParentAll')!.disabled).toBe(true)
    expect(field<HTMLInputElement>(row(0), 'min.wbs.name').disabled).toBe(true)
    expect(submitButton().disabled).toBe(true)

    await act(async () => { pending.resolve({ ok: true, items }); await pending.promise })
    const sent = onSubmit.mock.calls[0][0] as MinuteWbsCreateRow[]
    expect(sent).toEqual([
      {
        source: SOURCES[0], name: '로그인 API 개발', parentId: 'parent-1',
        plannedStart: null, plannedEnd: '2026-10-31', assigneeMemberId: 'member-1', confirmParentLeaf: false,
      },
      {
        source: SOURCES[1], name: '권한 화면 시안 검토', parentId: 'parent-2',
        plannedStart: null, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: false,
      },
    ])
    expect(sent.every(line => line.source.kind === 'action')).toBe(true)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(items, null)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('공통 위치 — 한꺼번에 같은 곳으로 보내면 onCreated 가 그 id 를, 맨 위로 보내면 parentId 는 null·공통 위치는 WBS_ROOT_PARENT(맨 위도 고른 위치다)', async () => {
    const items: Created[] = [{ row: 0, itemId: 'item-1', code: '2.1.4' }, { row: 1, itemId: 'item-2', code: '2.1.5' }]
    const first = await mount()
    first.onSubmit.mockResolvedValueOnce({ ok: true, items })
    await click(buttonByText(dialog(), 'min.wbs.changeParentAll')!)
    await pickFromSearch(bulkPanel()!, 'parent-1')
    await click(submitButton())
    await settle()
    expect(first.onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ source: SOURCES[0], parentId: 'parent-1' }),
      expect.objectContaining({ source: SOURCES[1], parentId: 'parent-1' }),
    ])
    expect(first.onCreated).toHaveBeenCalledWith(items, 'parent-1')

    act(() => root.unmount())
    root = createRoot(container)
    const second = await mount()
    second.onSubmit.mockResolvedValueOnce({ ok: true, items })
    await click(buttonByText(dialog(), 'min.wbs.changeParentAll')!)
    await click(rootRadio(bulkPanel()!))
    expect(pickedParent(row(0))).toBe(WBS_ROOT_PARENT)
    expect(pickedParent(row(1))).toBe(WBS_ROOT_PARENT)
    await click(submitButton())
    await settle()
    expect(second.onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ source: SOURCES[0], parentId: null }),
      expect.objectContaining({ source: SOURCES[1], parentId: null }),
    ])
    expect(second.onCreated).toHaveBeenCalledWith(items, WBS_ROOT_PARENT)
  })

  it('거부 — RPC 의 줄 번호(보낸 배열의 자리)를 화면 줄로 되돌려 그 줄을 빨갛게, 사유는 그 줄 밑과 알림에, 입력·체크는 그대로', async () => {
    const { onSubmit, onCreated } = await mount()
    onSubmit.mockResolvedValueOnce({ ok: false, error: '넣을 위치의 하위 작업이 그새 사라졌습니다.', row: 1 })
    // 줄 0 을 빼고 줄 2 에 위치를 준다(자동 체크) — 보내는 줄은 화면 줄 [1, 2], RPC 의 row 1 은 화면 줄 2
    await click(rowCheck(0))
    await click(rootRadio(row(2)))
    expect(rowCheck(2).checked).toBe(true)
    await typeInto(field<HTMLInputElement>(row(2), 'min.wbs.name'), '서버 증설 검토(1차)')

    await click(submitButton())
    await settle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((onSubmit.mock.calls[0][0] as MinuteWbsCreateRow[]).map(line => line.source.blockIndex)).toEqual([2, 4])

    expect(row(2).hasAttribute('data-row-failed')).toBe(true)
    expect(row(1).hasAttribute('data-row-failed')).toBe(false)
    expect(row(2).textContent).toContain('넣을 위치의 하위 작업이 그새 사라졌습니다.')
    const alert = dialog().querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('min.wbs.rowFailed 3')
    expect(alert.textContent).toContain('넣을 위치의 하위 작업이 그새 사라졌습니다.')
    expect(field<HTMLInputElement>(row(2), 'min.wbs.name').value).toBe('서버 증설 검토(1차)')
    expect(rowCheck(0).checked).toBe(false)
    expect(rowCheck(1).checked).toBe(true)
    expect(rowCheck(2).checked).toBe(true)
    expect(submitButton().disabled).toBe(false)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('줄과 무관한 거부는 줄을 표시하지 않고 사유만, 요청이 reject 되면 common.err.tryAgain', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { onSubmit, onCreated } = await mount()
    onSubmit
      .mockResolvedValueOnce({ ok: false, error: '이미 등록된 문단이 있습니다.' })
      .mockRejectedValueOnce(new Error('network down'))

    await click(submitButton())
    await settle()
    expect(dialog().querySelector('[data-row-failed]')).toBeNull()
    const alert = dialog().querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('이미 등록된 문단이 있습니다.')
    expect(alert.textContent).not.toContain('min.wbs.rowFailed')

    await click(submitButton())
    await settle()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('common.err.tryAgain')
    expect(onCreated).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('체크만 바꿔도 닫을 때 버릴지 묻는다(dirty 에 체크 상태가 든다)', async () => {
    const { onClose } = await mount()
    // 기준값은 열린 다음 틱에 잡힌다(useModalDirty)
    await settle()
    await click(rowCheck(0))
    act(() => { dialog().querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!.click() })
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
