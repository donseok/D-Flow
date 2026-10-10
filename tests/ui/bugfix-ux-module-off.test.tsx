// 사용자 테스트 BUG-22(꺼진 모듈 화면의 안내)·BUG-19(/p/{id} 리다이렉트) — 화면 쪽.
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ pathname: '/p/p1/issues', requireModulePage: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }) }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, redirect: h.redirect }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))

import { ModuleOffSwap } from '@/components/errors/ModuleOffSwap'
import ProjectRootPage from '@/app/(app)/p/[projectId]/page'

describe('[BUG-22] ModuleOffSwap — 404 본문 자리', () => {
  let host: HTMLDivElement, root: Root
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); h.pathname = '/p/p1/issues'
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
  const render = () => act(async () => { root.render(<ModuleOffSwap><p data-plain-404>페이지를 찾을 수 없습니다</p></ModuleOffSwap>) })
  const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body })

  it('서버가 꺼진 모듈이라고 확인하면 안내로 바꾼다 — 관리자에게는 설정 링크', async () => {
    answer({ off: true, layer: 'project', module: 'issues', settingsHref: '/p/p1/settings#project-modules' })
    await render()
    expect(fetchMock).toHaveBeenCalledWith('/api/nav/module-off?path=%2Fp%2Fp1%2Fissues', { cache: 'no-store' })
    expect(host.querySelector('[data-plain-404]')).toBeNull()
    expect(host.querySelector('[data-module-off]')!.getAttribute('data-module-off')).toBe('issues')
    expect(host.textContent).toContain('이 기능은 꺼져 있습니다')
    expect(host.textContent).toContain('이슈 기능은 이 프로젝트에서 꺼져 있습니다.')
    expect(host.querySelector('[data-module-off-settings]')!.getAttribute('href')).toBe('/p/p1/settings#project-modules')
  })
  it('설정 링크가 없으면(관리자가 아니면) 관리자에게 요청하라는 안내', async () => {
    h.pathname = '/w/default/minutes'
    answer({ off: true, layer: 'workspace', module: 'minutes', settingsHref: null })
    await render()
    expect(host.textContent).toContain('회의록 기능은 이 워크스페이스에서 꺼져 있습니다.')
    expect(host.textContent).toContain('쓰려면 관리자에게 켜 달라고 요청하세요.')
    expect(host.querySelector('[data-module-off-settings]')).toBeNull()
  })
  it('off:false·실패 응답·모르는 모듈이면 받은 404 본문 그대로다', async () => {
    for (const body of [{ off: false }, null, { off: true, layer: 'project', module: 'not-a-module', settingsHref: null }]) {
      answer(body, body !== null)
      await render()
      expect(host.querySelector('[data-plain-404]'), JSON.stringify(body)).not.toBeNull()
      expect(host.querySelector('[data-module-off]')).toBeNull()
      act(() => root.unmount()); root = createRoot(host)
    }
  })
  it('/p·/w 밖의 404 는 서버에 묻지 않는다', async () => {
    h.pathname = '/nowhere'
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(host.querySelector('[data-plain-404]')).not.toBeNull()
  })
})

describe('[BUG-19] /p/{projectId} — 프로젝트의 기본 화면(개요)으로', () => {
  beforeEach(() => { h.requireModulePage.mockReset(); h.redirect.mockClear() })
  it('관문(숨김 재판정)을 지난 뒤 개요로 리다이렉트한다', async () => {
    h.requireModulePage.mockResolvedValue(undefined)
    await expect(ProjectRootPage({ params: Promise.resolve({ projectId: 'p1' }) })).rejects.toThrow('REDIRECT:/p/p1/dashboard')
    expect(h.requireModulePage).toHaveBeenCalledWith({ projectId: 'p1' }, 'dashboard')
  })
  it('숨김·없는 프로젝트는 관문이 404 로 닫는다 — 리다이렉트하지 않는다(있는 프로젝트의 오라클이 되지 않게)', async () => {
    h.requireModulePage.mockRejectedValue(new Error('NEXT_NOT_FOUND'))
    await expect(ProjectRootPage({ params: Promise.resolve({ projectId: 'gone' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.redirect).not.toHaveBeenCalled()
  })
})
