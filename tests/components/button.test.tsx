// @vitest-environment jsdom
// 버튼 상태(SP3b 스펙 §4.5·§8.1, 계획 판정 Q25) — busy·사유 있는 비활성은 aria-disabled + 차단, 초점 유지, 폭 유지
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let c: HTMLDivElement, root: Root
beforeEach(() => { c = document.createElement('div'); document.body.appendChild(c); root = createRoot(c) })
afterEach(() => { act(() => root.unmount()); c.remove() })
const r = async (node: React.ReactNode) => { await act(async () => root.render(<>{node}</>)) }
const btn = () => c.querySelector('button')!

describe('Button', () => {
  it('busy — 두 번 눌러도 핸들러 0회, aria-busy·aria-disabled, 초점을 잃지 않는다', async () => {
    const onClick = vi.fn()
    await r(<Button busy onClick={onClick}>저장</Button>)
    btn().focus()
    await act(async () => { btn().click(); btn().click() })
    expect(onClick).not.toHaveBeenCalled()
    expect(btn().getAttribute('aria-busy')).toBe('true')
    expect(btn().getAttribute('aria-disabled')).toBe('true')
    expect(btn().disabled).toBe(false)
    expect(document.activeElement).toBe(btn())
  })
  it('busy 제출 버튼은 폼 제출을 막는다(aria-disabled 만으로는 막히지 않는다)', async () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    await r(<form onSubmit={(e) => onSubmit(e.nativeEvent)}><Button type="submit" busy>보내기</Button></form>)
    await act(async () => btn().click())
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('busy 는 라벨을 DOM 에 남긴 채 가려 폭을 지킨다(접근 이름 유지)', async () => {
    await r(<Button busy>저장하기</Button>)
    const label = btn().querySelector('span')!
    expect(label.textContent).toBe('저장하기')
    expect(label.className).toMatch(/invisible/)
  })
  it('사유 있는 비활성 — 옆 글 + aria-describedby, 초점 가능(네이티브 disabled 아님)', async () => {
    const onClick = vi.fn()
    await r(<Button disabled disabledReason="관리자만 바꿀 수 있습니다" onClick={onClick}>삭제</Button>)
    const id = btn().getAttribute('aria-describedby')!
    expect(c.querySelector(`[id="${id}"]`)!.textContent).toBe('관리자만 바꿀 수 있습니다')
    expect(btn().disabled).toBe(false)
    await act(async () => btn().click())
    expect(onClick).not.toHaveBeenCalled()
  })
  it('사유 없는 비활성은 네이티브 disabled', async () => {
    await r(<Button disabled>삭제</Button>)
    expect(btn().disabled).toBe(true)
  })
  it('높이·반경·전환은 토큰, 이동 전환이 없다', async () => {
    await r(<Button variant="primary">확인</Button>)
    expect(btn().className).toMatch(/h-\(--control-h\)/)
    expect(btn().className).toMatch(/rounded-\(--radius-control\)/)
    expect(btn().className).toMatch(/duration-\(--motion-fast\)/)
    expect(btn().className).not.toMatch(/translate|scale/)
  })
})

describe('IconButton', () => {
  it('aria-label 이 접근 이름이다', async () => {
    await r(<IconButton icon={<svg />} aria-label="닫기" />)
    expect(btn().getAttribute('aria-label')).toBe('닫기')
  })
  it('aria-label 은 타입으로 필수다(npm run typecheck 가 강제한다)', () => {
    // @ts-expect-error — aria-label 없는 IconButton 은 타입 오류여야 한다
    const missing = () => <IconButton icon={<svg />} />
    expect(typeof missing).toBe('function')
  })
})
