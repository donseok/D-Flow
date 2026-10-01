// @vitest-environment jsdom
// 선택 세그먼트는 색만으로 전달하지 않는다 — surface-selected + 체크(SP3b 스펙 §4.1 블록 8·개정 §5.5.3·§5.5.4).
// 체크는 globals.css 의 ::before 규칙이 그린다. jsdom 은 의사 요소를 계산하지 않으므로, 렌더된 버튼의 클래스에
// 걸리는 @layer components 의 ::before 규칙을 원문에서 찾는다(U1a 리뷰 R1·R3 P1 — 체크 content 가 .seg-item 에만 있어
// .seg-item 을 달지 않은 SegmentedTabs 7화면에서 체크가 그려지지 않았다).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { readGlobals, stripComments, topBlocks } from '../css/lib/cssTokens'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const components = topBlocks(stripComments(readGlobals())).filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
/** 클래스 목록에 걸리는 단일 클래스 `::before` 규칙 본문들 */
const beforeRules = (classes: string[]) =>
  components.filter((b) => b.prelude.split(',').map((s) => s.trim()).some((sel) => {
    const m = /^\.([\w-]+)::before$/.exec(sel)
    return m !== null && classes.includes(m[1])
  })).map((b) => b.body)
const hasCheckGlyph = (classes: string[]) => beforeRules(classes).some((body) => /content\s*:\s*"✓"/.test(body))
const checkVisible = (classes: string[]) => {
  const rules = beforeRules(classes)
  // 같은 층·같은 특이성 — 뒤 규칙이 이긴다. 마지막 visibility 선언이 visible 이어야 보인다
  const last = rules.map((body) => /visibility\s*:\s*(\w+)/.exec(body)?.[1]).filter(Boolean).at(-1)
  return last === undefined || last === 'visible'
}

describe('SegmentedTabs 선택 체크', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const render = (size?: 'sm' | 'md') => {
    act(() => {
      root.render(<SegmentedTabs tabs={[{ key: 'all', label: '전체' }, { key: 'open', label: '진행' }, { key: 'done', label: '완료' }]} value="open" onChange={() => {}} size={size} />)
    })
    return [...container.querySelectorAll('button')].map((b) => ({ selected: b.getAttribute('aria-selected') === 'true', classes: b.className.split(/\s+/) }))
  }

  it.each(['md', 'sm'] as const)('size=%s — 활성 항목에 보이는 체크, 비활성 항목은 같은 자리(숨은 체크)로 폭이 고정된다', (size) => {
    const buttons = render(size)
    expect(buttons.filter((b) => b.selected)).toHaveLength(1)
    for (const b of buttons) {
      expect(hasCheckGlyph(b.classes), `${b.classes.join(' ')} 에 체크 ::before 규칙이 없다`).toBe(true)
      expect(checkVisible(b.classes), b.classes.join(' ')).toBe(b.selected)
    }
  })

  it('검사가 살아 있다 — 체크 규칙이 없는 클래스는 잡는다', () => {
    expect(hasCheckGlyph(['seg-item-active'])).toBe(false)
    expect(hasCheckGlyph(['seg-item', 'seg-item-active'])).toBe(true)
    expect(checkVisible(['seg-item'])).toBe(false)
  })
})
