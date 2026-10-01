// @vitest-environment jsdom
// /admin/ui-states(SP3b 스펙 D16·§4.6) — 플랫폼 관리자만(나머지·열화 = 404), 두 열·상태 8종·표본 10(통과 6·거부 4)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { WS, makeActor, makeSuperuser } from '../fixtures/actor'
import { PAGE_MARKERS } from '../../scripts/lib/e2e.mjs'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', setLocale: vi.fn(), t: (k: string) => k }) }))

import UiStatesPage from '@/app/(app)/(global)/admin/ui-states/page'

const render = async () => {
  const d = document.createElement('div')
  d.innerHTML = renderToStaticMarkup((await UiStatesPage()) as ReactElement)
  return d
}
beforeEach(() => { vi.clearAllMocks() })

describe('/admin/ui-states', () => {
  it('플랫폼 관리자 — 라이트·다크 두 열(data-theme-scope, 다크 열에 .dark), 열마다 상태 8종', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const d = await render()
    const cols = [...d.querySelectorAll('[data-showcase-column]')]
    expect(cols.map((c) => c.getAttribute('data-showcase-column'))).toEqual(['light', 'dark'])
    expect(cols.every((c) => c.hasAttribute('data-theme-scope'))).toBe(true)
    expect(cols[1].classList.contains('dark')).toBe(true)
    expect(cols[0].classList.contains('dark')).toBe(false)
    for (const c of cols) expect(new Set([...c.querySelectorAll('[data-status-kind]')].map((e) => e.getAttribute('data-status-kind'))).size).toBe(8)
  })
  it('accent 표본 10 — 통과 6·거부 4, 통과 표본은 여섯 변수를 style 로, 거부는 hue 거리를 보인다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const light = (await render()).querySelector('[data-showcase-column="light"]')!
    const samples = [...light.querySelectorAll<HTMLElement>('[data-accent-sample]')]
    expect(samples).toHaveLength(10)
    expect(samples.filter((s) => s.dataset.accentOk === 'true')).toHaveLength(6)
    const ok = samples.find((s) => s.dataset.accentSample === '#315cdb')!
    for (const v of ['--color-action', '--color-action-fg', '--color-action-hover', '--color-action-pressed', '--color-action-soft', '--color-border-focus']) {
      expect(ok.getAttribute('style')).toContain(`${v}:`)
    }
    const rejected = samples.find((s) => s.dataset.accentSample === '#e03131')!
    expect(rejected.textContent).toMatch(/hue 거리/)
  })
  it('표본 문구가 페이지 상태 표식(PAGE_MARKERS — 열화·오류 경계)과 겹치지 않는다 — 겹치면 캡처·e2e 가 정상 쇼케이스를 열화로 읽는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const text = (await render()).textContent ?? ''
    for (const [name, marker] of PAGE_MARKERS) expect(text, name).not.toContain(marker)
  })
  it.each([
    ['워크스페이스 관리자', makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })],
    ['권한 조회 실패(null)', null],
  ])('%s → notFound(존재 은닉 — fail-closed)', async (_n, actor) => {
    mocks.getActorForView.mockResolvedValue(actor)
    await expect(render()).rejects.toThrow(/404/)
    expect(mocks.notFound).toHaveBeenCalled()
  })
})
