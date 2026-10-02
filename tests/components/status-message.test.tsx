// @vitest-environment jsdom
// 표준 상태 8종(SP3b 스펙 §4.5·§8.1, 개정 §5.7.2 — Q14 의 단위 부분)
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { STATUS_KINDS, StatusMessage, type StatusKind } from '@/components/ui/StatusMessage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

const html = (kind: StatusKind, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<StatusMessage kind={kind} title="제목" detail="설명" {...extra} />)
const el = (s: string) => { const d = document.createElement('div'); d.innerHTML = s; return d.firstElementChild as HTMLElement }

describe('StatusMessage', () => {
  it('여덟 종이다', () => {
    expect(STATUS_KINDS).toEqual(['loading', 'empty', 'needs_setup', 'disabled', 'partial_error', 'conflict', 'offline', 'permission_changed'])
  })
  it.each(STATUS_KINDS.map((k) => [k, k === 'permission_changed' ? 'alert' : 'status']))('%s → role=%s', (kind, role) => {
    expect(el(html(kind as StatusKind)).getAttribute('role')).toBe(role)
  })
  it('화면 전체를 막는 부분 실패(blocking)는 alert, 위젯 카드의 부분 실패는 status', () => {
    expect(el(html('partial_error', { blocking: true })).getAttribute('role')).toBe('alert')
    expect(el(html('partial_error')).getAttribute('role')).toBe('status')
    expect(el(html('empty', { blocking: true })).getAttribute('role')).toBe('status')
  })
  it('announce=false 는 알림 영역을 만들지 않는다 — 감싸는 영역이 이미 알릴 때(범위 오류 화면, CC6). 기본은 알린다', () => {
    expect(el(html('partial_error', { blocking: true, announce: false })).hasAttribute('role')).toBe(false)
    expect(el(html('partial_error', { blocking: true, announce: true })).getAttribute('role')).toBe('alert')
  })
  it('loading 은 높이를 지키는 skeleton — 숫자 0 을 그리지 않고 aria-busy, 제목은 스크린리더에만', () => {
    const e = el(html('loading', { title: '불러오는 중' }))
    expect(e.getAttribute('aria-busy')).toBe('true')
    expect(e.className).toMatch(/min-h-24/)
    expect(e.textContent).toBe('불러오는 중')
    expect(e.querySelector('.sr-only')?.textContent).toBe('불러오는 중')
    expect(el(html('loading', { compact: true })).className).toMatch(/min-h-8/)
  })
  it('다음 행동은 하나 — 링크 또는 버튼', async () => {
    const link = el(html('needs_setup', { action: { label: '설정 열기', href: '/p/x/settings' } }))
    expect(link.querySelectorAll('a')).toHaveLength(1)
    expect(link.querySelector('a')!.getAttribute('href')).toBe('/p/x/settings')
    const onSelect = vi.fn()
    const c = document.createElement('div'); document.body.appendChild(c)
    const root = createRoot(c)
    await act(async () => root.render(<StatusMessage kind="partial_error" title="일부를 불러오지 못했습니다" action={{ label: '다시 시도', onSelect }} />))
    expect(c.querySelectorAll('button')).toHaveLength(1)
    await act(async () => c.querySelector('button')!.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    act(() => root.unmount()); c.remove()
  })
  it('compact 는 테두리 없는 한 줄 모양', () => {
    expect(el(html('empty', { compact: true })).className).not.toMatch(/border/)
    expect(el(html('empty')).className).toMatch(/border/)
  })
  it('기본 문구가 없다 — 넘긴 제목·설명만 보인다', () => {
    expect(el(html('offline', { title: '연결이 끊겼습니다', detail: undefined })).textContent).toBe('연결이 끊겼습니다')
  })
})
