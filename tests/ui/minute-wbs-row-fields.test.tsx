// @vitest-environment jsdom
// 회의록 → WBS 등록 창의 줄 하나(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.1·§4.2) — 작업명·넣을 위치·계획 종료일·담당자.
// 초안 → 줄 상태(rowStateFromDraft), 하위 없는 작업을 위치로 고를 때 영향 안내와 확인(confirmParentLeaf), onChange 는 늘 줄 전체를 낸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WBS_ROOT_PARENT, type MinuteWbsDraftRow, type MinuteWbsParentOption } from '@/lib/domain/minuteWbs'
import { WBS_NAME_MAX } from '@/lib/domain/wbsValueRules'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 키를 돌려주되 {n} 이 든 두 문구는 자리를 남긴다 — 호출부가 숫자를 채우는지 본다
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'min.wbs.leafActual' || k === 'min.wbs.leafDeps' ? `${k} {n}` : k) }),
}))

import { MinuteWbsRowFields, rowStateFromDraft, type MinuteWbsRowState } from '@/components/minutes/MinuteWbsRowFields'

const opt = (id: string, path: string, extra: Partial<MinuteWbsParentOption> = {}): MinuteWbsParentOption => ({
  id, path, depth: path.split(' › ').length - 1, leaf: false, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames: [], ...extra,
})
const PARENTS: MinuteWbsParentOption[] = [
  opt('a', '2 개발 › 2.1 인증'),
  opt('b', '2 개발 › 2.3 회원관리'),
  opt('leafFull', '2 개발 › 2.4 알림 발송', { leaf: true, actualPct: 40, assigneeMemberId: 'm2', dependencyCount: 2 }),
  opt('leafBare', '3 운영', { leaf: true }),
]
const MEMBERS = [{ id: 'm1', name: '김민수' }, { id: 'm2', name: '이영희' }]
const DRAFT: MinuteWbsDraftRow = {
  row: 0, blockIndex: 4, blockHash: 'h4', excerpt: '김민수가 10/31 까지 로그인 API 개발', name: '로그인 API 개발',
  parentIds: ['a', 'b'], plannedEnd: '2026-10-31', assigneeMemberId: 'm1', registered: null,
}

describe('rowStateFromDraft', () => {
  it('위치는 첫 추천(parentIds[0]) — 마지막으로 고른 위치보다 앞선다. 초안 값은 그대로, 확인은 false', () => {
    expect(rowStateFromDraft(DRAFT, null)).toEqual({
      name: '로그인 API 개발', parentValue: 'a', plannedEnd: '2026-10-31', assigneeMemberId: 'm1', confirmParentLeaf: false,
    })
    expect(rowStateFromDraft(DRAFT, 'last').parentValue).toBe('a')
  })

  it('추천이 없으면 마지막으로 고른 위치, 그것도 없으면 null — 빈 날짜·담당자는 빈 글자(입력 칸의 값)', () => {
    const bare: MinuteWbsDraftRow = { ...DRAFT, parentIds: [], plannedEnd: null, assigneeMemberId: null }
    expect(rowStateFromDraft(bare, 'last')).toEqual({
      name: '로그인 API 개발', parentValue: 'last', plannedEnd: '', assigneeMemberId: '', confirmParentLeaf: false,
    })
    expect(rowStateFromDraft(bare, null).parentValue).toBeNull()
  })
})

describe('MinuteWbsRowFields', () => {
  let container: HTMLDivElement, root: Root
  let emitted: MinuteWbsRowState[]

  function Harness({ draft, initial }: { draft: MinuteWbsDraftRow; initial: MinuteWbsRowState }) {
    const [state, setState] = useState(initial)
    return <MinuteWbsRowFields state={state} draft={draft} parents={PARENTS} members={MEMBERS}
      onChange={next => { emitted.push(next); setState(next) }} />
  }

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    emitted = []
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(initial: MinuteWbsRowState, draft: MinuteWbsDraftRow = DRAFT) {
    await act(async () => root.render(<Harness draft={draft} initial={initial} />))
  }
  /** 보이는 이름표(첫 span)가 key 인 label 안의 입력 칸 */
  const field = <T extends HTMLElement>(key: string): T => {
    const label = [...container.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === key)
    if (!label) throw new Error(`label ${key} 없음`)
    return label.querySelector<T>('input, select')!
  }
  const confirmBox = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find(c => c.closest('label')?.textContent?.includes('min.wbs.leafConfirm')) ?? null
  const text = () => container.textContent ?? ''
  async function type(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  async function choose(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  /** 「다른 위치 찾기…」를 펼쳐 검색 목록에서 id 를 고른다 */
  async function pickFromSearch(id: string) {
    const toggle = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('min.wbs.parentSearch'))!
    if (toggle.getAttribute('aria-expanded') !== 'true') await act(async () => toggle.click())
    const radio = container.querySelector<HTMLInputElement>(`[data-wbs-parent-results] input[type="radio"][value="${id}"]`)!
    await act(async () => radio.click())
  }

  it('칸 넷 — 작업명(WBS_NAME_MAX 상한)·넣을 위치(추천 선택)·계획 종료일(date)·담당자(없음 = 빈 값), 고치면 줄 전체를 낸다', async () => {
    const initial = rowStateFromDraft(DRAFT, null)
    await mount(initial)
    const name = field<HTMLInputElement>('min.wbs.name')
    expect(name.value).toBe('로그인 API 개발')
    expect(name.maxLength).toBe(WBS_NAME_MAX)
    expect(text()).toContain('min.wbs.parent')
    const checked = container.querySelector<HTMLInputElement>('[data-wbs-parent-choices] input[type="radio"]:checked')!
    expect(checked.value).toBe('a')
    const end = field<HTMLInputElement>('min.wbs.plannedEnd')
    expect(end.type).toBe('date')
    expect(end.value).toBe('2026-10-31')
    const who = field<HTMLSelectElement>('min.wbs.assignee')
    expect(who.value).toBe('m1')
    expect([...who.options].map(o => [o.value, o.textContent])).toEqual([['', 'min.wbs.assigneeNone'], ['m1', '김민수'], ['m2', '이영희']])
    expect(text()).not.toContain('min.wbs.parentPlaceholder')
    expect(emitted).toEqual([])   // 그리기만으로는 내지 않는다

    await type(name, '로그인 API 개발 2차')
    expect(emitted.at(-1)).toEqual({ ...initial, name: '로그인 API 개발 2차' })
    await type(end, '2026-11-07')
    expect(emitted.at(-1)).toEqual({ ...initial, name: '로그인 API 개발 2차', plannedEnd: '2026-11-07' })
    await choose(who, '')
    expect(emitted.at(-1)).toEqual({ ...initial, name: '로그인 API 개발 2차', plannedEnd: '2026-11-07', assigneeMemberId: '' })
  })

  it('하위 없는 작업(leaf)을 고르면 묶음 항목으로 바뀌는 영향을 모두 보이고, 확인 체크가 confirmParentLeaf 를 올린다', async () => {
    const initial = rowStateFromDraft(DRAFT, null)
    await mount(initial)
    expect(text()).not.toContain('min.wbs.leafNotice')
    expect(confirmBox()).toBeNull()

    await pickFromSearch('leafFull')
    expect(emitted.at(-1)).toEqual({ ...initial, parentValue: 'leafFull', confirmParentLeaf: false })
    expect(text()).toContain('min.wbs.leafNotice')
    expect(text()).toContain('min.wbs.leafActual 40.0')   // 실적 칸과 같은 소수 1자리
    expect(text()).toContain('min.wbs.leafAssignee')
    expect(text()).toContain('min.wbs.leafDeps 2')
    const box = confirmBox()!
    expect(box.checked).toBe(false)
    await act(async () => box.click())
    expect(emitted.at(-1)).toEqual({ ...initial, parentValue: 'leafFull', confirmParentLeaf: true })
    expect(confirmBox()!.checked).toBe(true)
  })

  it('실적·담당자·선행 연결이 없는 말단이면 그 문장은 빼고 안내와 확인만', async () => {
    await mount(rowStateFromDraft(DRAFT, null))
    await pickFromSearch('leafBare')
    expect(text()).toContain('min.wbs.leafNotice')
    expect(text()).not.toContain('min.wbs.leafActual')
    expect(text()).not.toContain('min.wbs.leafAssignee')
    expect(text()).not.toContain('min.wbs.leafDeps')
    expect(container.querySelector('ul')).toBeNull()   // 빈 목록을 그리지 않는다
    expect(confirmBox()).not.toBeNull()
  })

  it('묶음(하위가 있는) 위치면 안내가 없다 — 말단에서 묶음으로 바꾸면 확인도 풀린다', async () => {
    const initial = { ...rowStateFromDraft(DRAFT, null), parentValue: 'leafFull', confirmParentLeaf: true }
    await mount(initial)
    expect(text()).toContain('min.wbs.leafNotice')
    expect(confirmBox()!.checked).toBe(true)

    const bundle = container.querySelector<HTMLInputElement>('[data-wbs-parent-choices] input[type="radio"][value="a"]')!
    await act(async () => bundle.click())
    expect(emitted.at(-1)).toEqual({ ...initial, parentValue: 'a', confirmParentLeaf: false })
    expect(text()).not.toContain('min.wbs.leafNotice')
    expect(confirmBox()).toBeNull()
  })

  it('다른 말단으로 바꾸면 확인을 다시 받는다', async () => {
    await mount({ ...rowStateFromDraft(DRAFT, null), parentValue: 'leafFull', confirmParentLeaf: true })
    await pickFromSearch('leafBare')
    expect(emitted.at(-1)).toMatchObject({ parentValue: 'leafBare', confirmParentLeaf: false })
    expect(confirmBox()!.checked).toBe(false)
  })

  it('위치가 없으면(추천·마지막 선택 없음) min.wbs.parentPlaceholder — 맨 위를 고르면 사라진다', async () => {
    const bare: MinuteWbsDraftRow = { ...DRAFT, parentIds: [] }
    await mount(rowStateFromDraft(bare, null), bare)
    expect(text()).toContain('min.wbs.parentPlaceholder')
    expect(container.querySelector('[data-wbs-parent-choices] input[type="radio"]:checked')).toBeNull()

    const rootRadio = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${WBS_ROOT_PARENT}"]`)!
    await act(async () => rootRadio.click())
    expect(emitted.at(-1)).toMatchObject({ parentValue: WBS_ROOT_PARENT, confirmParentLeaf: false })
    expect(text()).not.toContain('min.wbs.parentPlaceholder')
    expect(text()).not.toContain('min.wbs.leafNotice')
  })

  it('disabled 면 칸이 모두 잠긴다', async () => {
    await act(async () => root.render(
      <MinuteWbsRowFields state={{ ...rowStateFromDraft(DRAFT, null), parentValue: 'leafFull' }} draft={DRAFT} parents={PARENTS}
        members={MEMBERS} onChange={() => {}} disabled />,
    ))
    const controls = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
    expect(controls.length).toBeGreaterThan(4)
    expect(controls.filter(c => !c.disabled).map(c => c.outerHTML)).toEqual([])
  })
})
