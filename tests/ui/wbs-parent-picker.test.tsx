// @vitest-environment jsdom
// 회의록 → WBS 등록 창의 「넣을 위치」 선택기(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §4.2) —
// 추천 위치(≤3)가 「추천」 칩과 함께 맨 위 라디오로 나오고 첫 추천이 미리 골라진다. 「다른 위치 찾기…」를 펼치면 고를 수 있는 위치 전부
// (하위 없는 작업 포함 — · 표시)를 경로로 거른다. 맨 위(최상위, WBS_ROOT_PARENT)는 위치 후보가 없어도 늘 고를 수 있다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WBS_ROOT_PARENT, type MinuteWbsParentOption } from '@/lib/domain/minuteWbs'
import { ESC_PRIORITY, escStack } from '@/lib/ui/escStack'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsParentPicker } from '@/components/minutes/WbsParentPicker'

const opt = (id: string, path: string, extra: Partial<MinuteWbsParentOption> = {}): MinuteWbsParentOption => ({
  id, path, depth: path.split(' › ').length - 1, leaf: false, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames: [], ...extra,
})
const OPTIONS: MinuteWbsParentOption[] = [
  opt('d', '1 설계'),
  opt('a', '2 개발 › 2.1 인증'),
  opt('a1', '2 개발 › 2.1 인증 › 2.1.1 로그인 화면', { leaf: true, actualPct: 40 }),
  opt('b', '2 개발 › 2.3 회원관리'),
  opt('c', '3 테스트'),
  opt('e', '3 테스트 › 3.1 인증 시험'),
]

type Props = Parameters<typeof WbsParentPicker>[0]

describe('WbsParentPicker — 추천 우선 라디오 + 다른 위치 찾기', () => {
  let container: HTMLDivElement, root: Root
  const onChange = vi.fn<(value: string) => void>()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onChange.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(props: Partial<Props> = {}) {
    await act(async () => root.render(
      <WbsParentPicker options={OPTIONS} value={null} recommendedIds={[]} onChange={onChange} {...props} />,
    ))
  }
  /** 값을 쥔 부모 — 고르면 값이 바뀐다(줄 편집 칸·등록 창처럼) */
  function Stateful({ initial, ...rest }: Omit<Props, 'value' | 'onChange'> & { initial: string | null }) {
    const [value, setValue] = useState(initial)
    return <WbsParentPicker {...rest} value={value} onChange={next => { onChange(next); setValue(next) }} />
  }
  const choices = () => [...container.querySelectorAll<HTMLInputElement>('[data-wbs-parent-choices] input[type="radio"]')]
  const results = () => [...container.querySelectorAll<HTMLInputElement>('[data-wbs-parent-results] input[type="radio"]')]
  const result = (id: string) => container.querySelector<HTMLInputElement>(`[data-wbs-parent-results] input[type="radio"][value="${id}"]`)!
  const labelOf = (input: HTMLInputElement) => input.closest('label')!.textContent ?? ''
  const chipOf = (input: HTMLInputElement) => input.closest('label')!.querySelector('.chip')!
  const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
  const searchToggle = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('min.wbs.parentSearch')) ?? null
  const searchInput = () => container.querySelector<HTMLInputElement>('input[type="search"]')
  async function type(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }

  it('추천 id 들이 「추천」 칩과 함께 맨 위 라디오로 — 옵션에 있는 것만 셋까지, 첫 추천이 골라진다', async () => {
    await mount({ recommendedIds: ['b', 'gone', 'a', 'c', 'e'] })
    const radios = choices()
    expect(radios.map(r => r.value)).toEqual(['b', 'a', 'c', WBS_ROOT_PARENT])
    expect(labelOf(radios[0])).toContain('2 개발 › 2.3 회원관리')
    for (const r of radios.slice(0, 3)) expect(labelOf(r)).toContain('min.wbs.parentRecommended')
    expect(labelOf(radios[3])).not.toContain('min.wbs.parentRecommended')
    expect(radios.map(r => r.checked)).toEqual([true, false, false, false])
    // 골라진 줄(bg-surface-selected)과 칩(bg-action-soft)은 같은 색이다 — 골라진 줄의 칩은 흰 바탕 + 테두리로 알약 모양을 지킨다
    expect(classes(radios[0].closest('label')!)).toContain('bg-surface-selected')
    expect(classes(chipOf(radios[0]))).toEqual(expect.arrayContaining(['bg-surface', 'ring-1']))
    expect(classes(chipOf(radios[0]))).not.toContain('bg-action-soft')
    expect(classes(chipOf(radios[1]))).toContain('bg-action-soft')
    // 화면에 골라진 라디오와 부모 상태가 어긋나지 않게 — 미선택(null)이면 첫 추천을 한 번 올린다
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('지금 값이 추천 밖이면(검색·마지막 선택) 그 위치도 칩 없이 골라진 라디오로 — 부모 상태는 건드리지 않는다', async () => {
    await mount({ recommendedIds: ['a', 'b'], value: 'a1' })
    const radios = choices()
    expect(radios.map(r => r.value)).toEqual(['a', 'b', 'a1', WBS_ROOT_PARENT])
    expect(radios.map(r => r.checked)).toEqual([false, false, true, false])
    expect(labelOf(radios[2])).toContain('·')   // 하위 없는 작업 표시
    expect(radios[2].closest('label')!.querySelector('.sr-only')?.textContent).toContain('min.wbs.parentLeaf')
    expect(labelOf(radios[2])).not.toContain('min.wbs.parentRecommended')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('라디오를 누르면 그 id 를 알린다', async () => {
    await mount({ recommendedIds: ['a', 'b'], value: 'a' })
    await act(async () => choices()[1].click())
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it("「다른 위치 찾기…」를 펼쳐 검색에 '인증' 을 치면 path 에 '인증' 이 든 위치만 남고(하위 없는 작업은 ·), 고르면 그 id 를 알린다", async () => {
    await mount({ recommendedIds: ['a'], value: 'a' })
    expect(searchInput()).toBeNull()
    const toggle = searchToggle()!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const search = searchInput()!
    expect(document.activeElement).toBe(search)   // 펼치면 검색 칸으로 — 바로 칠 수 있게
    // 무엇으로 찾는지 칸 안에 보인다(번호나 이름) — 이름표(aria-label)는 그대로
    expect(search.placeholder).toBe('min.wbs.parentSearchHint')
    expect(search.getAttribute('aria-label')).toBe('min.wbs.parentSearch')
    expect(results().map(r => r.value)).toEqual(OPTIONS.map(o => o.id))
    await type(search, '인증')
    const hits = results()
    expect(hits.map(r => r.value)).toEqual(['a', 'a1', 'e'])
    expect(hits.every(r => labelOf(r).includes('인증'))).toBe(true)
    expect(labelOf(hits[1])).toContain('·')
    expect(labelOf(hits[0])).not.toContain('·')
    // · 는 눈으로만 — 화면 낭독에는 「하위 없음」 글로, 마우스에는 title 로 알린다
    const dot = [...hits[1].closest('label')!.querySelectorAll('[aria-hidden]')].find(el => el.textContent === '·')!
    expect(dot.getAttribute('title')).toBe('min.wbs.parentLeaf')
    expect(hits[1].closest('label')!.querySelector('.sr-only')?.textContent).toContain('min.wbs.parentLeaf')
    expect(hits[0].closest('label')!.querySelector('.sr-only')).toBeNull()
    expect(hits[0].checked).toBe(true)   // 지금 값은 검색 목록에서도 골라진 채
    await act(async () => hits[2].click())
    expect(onChange).toHaveBeenLastCalledWith('e')
  })

  it('펼친 찾기는 Esc 로 먼저 접힌다 — 창(모달)은 그대로, 초점은 찾기 단추로. 한 번 더 누르면 창 차례', async () => {
    const modalEsc = vi.fn()
    const unregister = escStack.register({ priority: ESC_PRIORITY.MODAL, handler: modalEsc })
    try {
      await mount({ recommendedIds: ['a'], value: 'a' })
      const toggle = searchToggle()!
      await act(async () => toggle.click())
      const esc = () => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
      esc()
      expect(searchInput()).toBeNull()
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(toggle)
      expect(modalEsc).not.toHaveBeenCalled()
      esc()
      expect(modalEsc).toHaveBeenCalledTimes(1)
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it('한글 조합 중에는 목록이 비지 않는다 — 덜 된 글자(ㅇ·읹·인즈)에 min.wbs.parentNone 으로 뒤집히지 않고, 조합이 끝나면 온 낱말로 거른다', async () => {
    await mount({ recommendedIds: ['a'], value: 'a' })
    await act(async () => searchToggle()!.click())
    const search = searchInput()!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const composition = (type: 'compositionstart' | 'compositionend', data: string) =>
      act(() => { search.dispatchEvent(new CompositionEvent(type, { bubbles: true, data })) })
    // 조합 중 input — 값에 조합 중인 글자가 든다(isComposing)
    const composingInput = (value: string) =>
      act(() => { setter.call(search, value); search.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: value.slice(-1) })) })

    composition('compositionstart', '')
    for (const partial of ['ㅇ', '이', '인', '읹', '인즈', '인증']) {
      composingInput(partial)
      expect(container.textContent, partial).not.toContain('min.wbs.parentNone')
      expect(results().length, partial).toBeGreaterThan(0)
    }
    composition('compositionend', '인증')
    expect(search.value).toBe('인증')
    expect(results().map(r => r.value)).toEqual(['a', 'a1', 'e'])

    // 조합을 마친 글이 정말 아무것도 못 맞히면 그때는 min.wbs.parentNone
    composition('compositionstart', '')
    composingInput('인증없')
    expect(container.textContent).not.toContain('min.wbs.parentNone')
    composition('compositionend', '없')
    expect(results()).toEqual([])
    expect(container.textContent).toContain('min.wbs.parentNone')
  })

  it('찾기를 펼친 동안에는 위 라디오 줄이 그대로다 — 고를 때마다 줄이 끼거나 빠져 목록이 포인터 밑에서 밀리지 않게. 접으면 지금 값이 위로 올라온다', async () => {
    await act(async () => root.render(<Stateful options={OPTIONS} recommendedIds={['a']} initial="a" />))
    const top = () => choices().map(r => r.value)
    const toggle = searchToggle()!
    await act(async () => toggle.click())
    expect(top()).toEqual(['a', WBS_ROOT_PARENT])

    await act(async () => result('e').click())          // 추천 밖을 고른다
    expect(onChange).toHaveBeenLastCalledWith('e')
    expect(top()).toEqual(['a', WBS_ROOT_PARENT])        // 위에 줄이 끼지 않는다
    expect(result('e').checked).toBe(true)
    expect(choices().some(r => r.checked)).toBe(false)

    await act(async () => choices()[0].click())         // 추천으로 돌아간다
    expect(top()).toEqual(['a', WBS_ROOT_PARENT])
    await act(async () => result('d').click())
    expect(top()).toEqual(['a', WBS_ROOT_PARENT])

    await act(async () => toggle.click())                // 접으면 지금 값(d)이 위 라디오로
    expect(top()).toEqual(['a', 'd', WBS_ROOT_PARENT])
    expect(choices().map(r => r.checked)).toEqual([false, true, false])
  })

  it('펼칠 때 이미 있던 추천 밖 값의 줄은 펼친 동안 남는다 — 추천을 골라도 빠지지 않고, 접으면 빠진다', async () => {
    await act(async () => root.render(<Stateful options={OPTIONS} recommendedIds={['a']} initial="d" />))
    const top = () => choices().map(r => r.value)
    expect(top()).toEqual(['a', 'd', WBS_ROOT_PARENT])
    const toggle = searchToggle()!
    await act(async () => toggle.click())
    await act(async () => choices()[0].click())
    expect(onChange).toHaveBeenLastCalledWith('a')
    expect(top()).toEqual(['a', 'd', WBS_ROOT_PARENT])
    expect(choices().map(r => r.checked)).toEqual([true, false, false])
    await act(async () => toggle.click())
    expect(top()).toEqual(['a', WBS_ROOT_PARENT])
  })

  it('맞는 위치가 없으면 목록 대신 min.wbs.parentNone', async () => {
    await mount({ recommendedIds: ['a'], value: 'a' })
    await act(async () => searchToggle()!.click())
    expect(container.textContent).not.toContain('min.wbs.parentNone')
    await type(searchInput()!, '없는 이름')
    expect(results()).toEqual([])
    expect(container.textContent).toContain('min.wbs.parentNone')
  })

  it('WBS_ROOT_PARENT 옵션이 있다 — min.wbs.parentRoot, 고르면 WBS_ROOT_PARENT, 값이 그것이면 골라진 채', async () => {
    await mount({ recommendedIds: ['a'], value: 'a' })
    const rootRadio = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${WBS_ROOT_PARENT}"]`)!
    expect(labelOf(rootRadio)).toContain('min.wbs.parentRoot')
    expect(rootRadio.checked).toBe(false)
    await act(async () => rootRadio.click())
    expect(onChange).toHaveBeenCalledWith(WBS_ROOT_PARENT)

    onChange.mockClear()
    await mount({ recommendedIds: ['a'], value: WBS_ROOT_PARENT })
    expect(choices().map(r => [r.value, r.checked])).toEqual([['a', false], [WBS_ROOT_PARENT, true]])
    expect(onChange).not.toHaveBeenCalled()   // 맨 위도 고른 값이다 — 첫 추천으로 덮지 않는다
  })

  it('맨 위(최상위)는 위 묶음의 마지막(추천·지금 값 다음)이고 스스로 골라지지 않는다 — 값이 맨 위일 때만(사람이 골랐거나 기억한 선택) 골라진 채', async () => {
    const top = () => choices().map(r => r.value)
    const checked = () => choices().filter(r => r.checked).map(r => r.value)
    // 추천 셋 + 추천 밖 지금 값 — 맨 위는 그 뒤
    await mount({ recommendedIds: ['a', 'b', 'c'], value: 'e' })
    expect(top()).toEqual(['a', 'b', 'c', 'e', WBS_ROOT_PARENT])
    expect(checked()).toEqual(['e'])
    // 추천이 없고 값도 없으면 아무것도 고르지 않는다 — 맨 위가 하나뿐인 라디오여도 미리 고르지 않고 부모 상태도 건드리지 않는다
    onChange.mockClear()
    await mount({ recommendedIds: [], value: null })
    expect(top()).toEqual([WBS_ROOT_PARENT])
    expect(checked()).toEqual([])
    await mount({ options: [], recommendedIds: [], value: null })
    expect(checked()).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
    // 추천이 있으면 첫 추천(맨 위가 아니다)
    await mount({ recommendedIds: ['b'], value: null })
    expect(onChange).toHaveBeenLastCalledWith('b')
    expect(onChange).not.toHaveBeenCalledWith(WBS_ROOT_PARENT)
    // 기억한 맨 위(값 = WBS_ROOT_PARENT)는 그대로 골라진 채 — 추천으로 덮지 않는다(설계 §4.2)
    onChange.mockClear()
    await mount({ recommendedIds: [], value: WBS_ROOT_PARENT })
    expect(checked()).toEqual([WBS_ROOT_PARENT])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('옵션이 0개면 min.wbs.parentNone — 찾을 것이 없어 찾기 단추도 없고, 맨 위는 그래도 고를 수 있다', async () => {
    await mount({ options: [], recommendedIds: ['a'] })
    expect(container.textContent).toContain('min.wbs.parentNone')
    expect(choices().map(r => r.value)).toEqual([WBS_ROOT_PARENT])
    expect(searchToggle()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('모르는 값(다른 프로젝트에서 고른 마지막 위치 등)은 고르지 않은 것으로 본다 — 추천이 있으면 첫 추천으로 바로잡는다', async () => {
    await mount({ recommendedIds: [], value: 'elsewhere' })
    expect(choices().map(r => r.value)).toEqual([WBS_ROOT_PARENT])
    expect(choices().some(r => r.checked)).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    await mount({ recommendedIds: ['c'], value: 'elsewhere' })
    expect(choices().map(r => [r.value, r.checked])).toEqual([['c', true], [WBS_ROOT_PARENT, false]])
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('disabled 면 라디오·찾기 단추가 잠긴다', async () => {
    await mount({ recommendedIds: ['a'], value: 'a', disabled: true })
    expect(choices().every(r => r.disabled)).toBe(true)
    expect(searchToggle()!.disabled).toBe(true)
  })

  it('한 화면에 선택기가 여럿이어도(한꺼번에 등록) 라디오 묶음 이름이 겹치지 않는다', async () => {
    await act(async () => root.render(<>
      <WbsParentPicker options={OPTIONS} value="a" recommendedIds={['a']} onChange={onChange} />
      <WbsParentPicker options={OPTIONS} value="b" recommendedIds={['b']} onChange={onChange} />
    </>))
    const names = new Set(choices().map(r => r.name))
    expect(names.size).toBe(2)
    expect(choices().filter(r => r.checked).map(r => r.value)).toEqual(['a', 'b'])
  })
})
