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
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))

import UiStatesPage from '@/app/(app)/(global)/admin/ui-states/page'

const render = async () => {
  const d = document.createElement('div')
  d.innerHTML = renderToStaticMarkup((await UiStatesPage()) as ReactElement)
  return d
}
beforeEach(() => { vi.clearAllMocks() })

describe('/admin/ui-states', () => {
  it('플랫폼 관리자 — 한 열(라이트 전용 2026-10-10 — 다크 열·.dark 컨테이너가 없다), 상태 8종', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const d = await render()
    const cols = [...d.querySelectorAll('[data-showcase-column]')]
    expect(cols.map((c) => c.getAttribute('data-showcase-column'))).toEqual(['light'])
    expect(d.querySelector('.dark, [data-theme-scope]')).toBeNull()
    for (const c of cols) expect(new Set([...c.querySelectorAll('[data-status-kind]')].map((e) => e.getAttribute('data-status-kind'))).size).toBe(8)
  })
  it('accent 표본 10 — 통과 6·거부 4, 통과 표본은 여섯 변수를 style 로, 거부는 hue 거리를 보인다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const light = (await render()).querySelector('[data-showcase-column="light"]')!
    const samples = [...light.querySelectorAll<HTMLElement>('[data-accent-sample]')]
    expect(samples).toHaveLength(10)
    expect(samples.filter((s) => s.dataset.accentOk === 'true')).toHaveLength(6)
    const ok = samples.find((s) => s.dataset.accentSample === '#2456e6')!
    for (const v of ['--color-action', '--color-action-fg', '--color-action-hover', '--color-action-pressed', '--color-action-soft', '--color-border-focus']) {
      expect(ok.getAttribute('style')).toContain(`${v}:`)
    }
    const rejected = samples.find((s) => s.dataset.accentSample === '#e03131')!
    expect(rejected.textContent).toMatch(/hue 거리/)
  })
  it('UI-5 표본 — 페이지 머리(일반·컴팩트)·아이콘 버튼·모달 닫기·KPI·구역 카드·빈 상태가 열에, 겹침(모달·충돌 비교)은 열 밖 버튼으로', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const d = await render()
    for (const col of d.querySelectorAll('[data-showcase-column]')) {
      for (const name of ['page-header', 'page-header-compact', 'icon-button', 'modal-close', 'kpi-cards', 'section-card', 'empty-state']) {
        expect(col.querySelector(`[data-sample="${name}"]`), name).not.toBeNull()
      }
      expect(col.querySelector('[data-sample="page-header"] [data-page-header]')?.getAttribute('data-preview')).toBe('default')
      expect(col.querySelector('[data-sample="page-header-compact"] [data-page-header]')?.className).toContain('min-h-12')
      expect(col.querySelector('[data-sample="modal-close"] button')?.className).toContain('before:size-11')
      expect(col.querySelector('[data-sample="icon-button"]')?.className ?? col.querySelector('[data-sample="icon-button"] button')?.className).toContain('before:size-11')
      expect(col.querySelectorAll('[data-sample="kpi-cards"] .kpi-card').length).toBeGreaterThanOrEqual(4)
    }
    const overlays = d.querySelector('[data-showcase-overlays]')!
    expect(overlays.closest('[data-showcase-column]')).toBeNull()
    expect(overlays.querySelector('[data-sample="open-modal"]')).not.toBeNull()
    expect(overlays.querySelector('[data-sample="open-conflict"]')).not.toBeNull()
    expect(d.querySelector('[role="dialog"]')).toBeNull()                 // 닫힌 채로 시작한다(화면을 덮지 않는다)
  })
  it('타이포 스케일 표본 — 여덟 단계가 열에, 단계마다 그 크기 토큰 클래스로 그린다(가장 작은 단계는 text-meta)', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const d = await render()
    for (const col of d.querySelectorAll('[data-showcase-column]')) {
      const steps = [...col.querySelectorAll<HTMLElement>('[data-sample="type-scale"] [data-type-step]')]
      expect(steps.map((s) => s.dataset.typeStep)).toEqual(['text-title', 'text-title-sm', 'text-kpi', 'text-section', 'text-doc', 'text-body', 'text-control', 'text-meta'])
      for (const s of steps) expect(s.firstElementChild?.classList.contains(s.dataset.typeStep!), s.dataset.typeStep).toBe(true)
    }
  })
  it('화면의 h1 은 하나 — 표본 머리는 h2 로 그린다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const d = await render()
    expect(d.querySelectorAll('h1')).toHaveLength(1)
    expect(d.querySelector('h1')?.textContent).toBe('컴포넌트 상태 점검')
  })
  it('표본 문구가 페이지 상태 표식(PAGE_MARKERS — 열화·오류 경계)과 겹치지 않는다 — 겹치면 캡처·e2e 가 정상 쇼케이스를 열화로 읽는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const text = (await render()).textContent ?? ''
    for (const [name, marker] of PAGE_MARKERS) expect(text, name).not.toContain(marker)
  })
  it.each([
    ['워크스페이스 관리자', makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })],
    ['일반 멤버(워크스페이스 member·프로젝트 member)', makeActor({ projectRoles: new Map([['p-1', 'member']]), projectWorkspace: new Map([['p-1', WS]]) })],
    ['권한 조회 실패(null)', null],
  ])('%s → notFound(존재 은닉 — fail-closed)', async (_n, actor) => {
    mocks.getActorForView.mockResolvedValue(actor)
    await expect(render()).rejects.toThrow(/404/)
    expect(mocks.notFound).toHaveBeenCalled()
  })
})
