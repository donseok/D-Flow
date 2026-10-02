// @vitest-environment jsdom
// BB4(U2b-4 충실도 리뷰 P3-3) — 범위 오류 화면의 실패 문구(h1)가 알림 영역 안에 있어 스크린리더가 '무엇이 실패했는지'를 읽는다.
// h1 은 하나(스펙 §9 ④), 표지 문구는 E2E PAGE_MARKERS 의 error-boundary 와 같다.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from './_dom'
import { ScopeError } from '@/components/app/ScopeError'

describe('ScopeError', () => {
  it('h1 하나가 role="alert" 영역 안에 있고, 다시 시도는 reset 을 부른다', () => {
    const reset = vi.fn()
    const { container } = render(<ScopeError reset={reset} />)
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('화면을 불러오지 못했습니다')
    expect(h1s[0].closest('[role="alert"]')).not.toBeNull()
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('다시 시도'))!)
    expect(reset).toHaveBeenCalledOnce()
  })
  // U2b-5 리뷰 수정 CC6 — 알림 영역은 하나다. h1 영역과 안내(StatusMessage) 영역이 따로 alert 면 오류 순간에 두 번 연달아 낭독된다
  it('알림 영역은 하나 — 실패 문구(h1)와 안내·다시 시도가 같은 영역 안에 있다', () => {
    const { container } = render(<ScopeError reset={vi.fn()} />)
    const regions = container.querySelectorAll('[role="alert"], [role="status"]')
    expect(regions).toHaveLength(1)
    expect(regions[0].getAttribute('role')).toBe('alert')
    expect(regions[0].querySelector('h1')).not.toBeNull()
    expect(regions[0].textContent).toContain('잠시 후 다시 시도해 주세요.')
  })
})
