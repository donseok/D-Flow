// @vitest-environment jsdom
// /admin/workspaces(개정 §5.3.2) — 플랫폼 관리자만(나머지·열화 = 404). 목록(이름·slug·멤버·프로젝트·만든 날·허용 모듈·이동)과 생성 폼.
import { act, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fireEvent, render } from '../shell/_dom'
import { makeActor, makeSuperuser } from '../fixtures/actor'
import { KO } from '@/lib/i18n/dict/ko'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'
import type { PlatformWorkspaceRow } from '@/app/actions/platformWorkspaces'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(), listPlatformWorkspaces: vi.fn(), createPlatformWorkspace: vi.fn(), readCurrentWorkspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }), refresh: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/app/actions/platformWorkspaces', () => ({ listPlatformWorkspaces: mocks.listPlatformWorkspaces, createPlatformWorkspace: mocks.createPlatformWorkspace }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: mocks.readCurrentWorkspace }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', setLocale: vi.fn(), t: (k: keyof typeof KO) => KO[k] ?? k }) }))

import WorkspacesAdminPage from '@/app/(app)/(global)/admin/workspaces/page'
import { WorkspacesManager } from '@/components/admin/WorkspacesManager'

const ROWS: PlatformWorkspaceRow[] = [
  { id: 'w1', slug: 'alpha', name: '알파', createdAt: '2026-09-01T03:00:00Z', memberCount: 12, projectCount: 3, allowedModules: [...NON_CORE_MODULES] },
  { id: 'w2', slug: 'beta', name: '베타', createdAt: '2026-10-01T03:00:00Z', memberCount: 1, projectCount: 0, allowedModules: [] },
  { id: 'w3', slug: 'gamma', name: '감마', createdAt: '2026-10-02T03:00:00Z', memberCount: 2, projectCount: 1, allowedModules: ['kanban', 'wiki'] },
  { id: 'w4', slug: 'delta', name: '델타', createdAt: '2026-10-03T03:00:00Z', memberCount: 0, projectCount: 0, allowedModules: null },
]
const setValue = (el: HTMLInputElement, value: string) => {
  // React 가 추적하는 값 setter 를 지나야 onChange 가 불린다
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: 'w1', slug: 'alpha', name: '알파' } })
  mocks.listPlatformWorkspaces.mockResolvedValue({ ok: true, rows: ROWS })
})

describe('/admin/workspaces 페이지', () => {
  const html = async () => renderToStaticMarkup((await WorkspacesAdminPage()) as ReactElement)
  it('플랫폼 관리자가 아니면 404 — 목록 액션을 부르지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeActor())
    await expect(WorkspacesAdminPage()).rejects.toThrow('404')
    expect(mocks.listPlatformWorkspaces).not.toHaveBeenCalled()
  })
  it('권한 조회 열화(actor null)도 404(fail-closed)', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    await expect(WorkspacesAdminPage()).rejects.toThrow('404')
  })
  it('플랫폼 관리자 — h1 하나, 목록과 생성 폼', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    const out = await html()
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(out).toContain('워크스페이스 관리')
    expect(out).toContain('data-workspace-list')
    expect(out).toContain('data-workspace-create')
  })
  it('목록 조회 실패는 "0개"가 아니라 오류 화면 — 생성 폼도 그리지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    mocks.listPlatformWorkspaces.mockResolvedValue({ ok: false, error: '워크스페이스 목록을 불러오지 못했습니다.' })
    const out = await html()
    expect(out).toContain('role="alert"')
    expect(out).toContain('워크스페이스 목록을 불러오지 못했습니다')
    expect(out).not.toContain('data-workspace-list')
    expect(out).not.toContain('아직 워크스페이스가 없습니다')
  })
})

describe('WorkspacesManager — 목록', () => {
  it('행마다 이름·slug·멤버 수·프로젝트 수·만든 날·허용 모듈 요약과 그 워크스페이스로 가는 링크', () => {
    const { container } = render(<WorkspacesManager rows={ROWS} accountsHref="/w/alpha/admin/accounts" />)
    const rows = [...container.querySelectorAll('[data-workspace-row]')]
    expect(rows.map((r) => r.getAttribute('data-workspace-row'))).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    const cells = (i: number) => [...rows[i].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells(0).slice(0, 6)).toEqual(['알파', 'alpha', '12', '3', '2026-09-01', `전체 ${NON_CORE_MODULES.length}개`])
    expect(cells(1)[5]).toBe('기본 기능만')
    expect(cells(2)[5]).toBe(`2/${NON_CORE_MODULES.length}개`)
    expect(cells(3)[5]).toBe('확인 불가')                       // 설정을 못 읽은 워크스페이스 — 빈 목록으로 그리지 않는다
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/w/alpha')
    expect(rows[2].querySelector('a')!.getAttribute('aria-label')).toBe('감마 워크스페이스 열기')
    expect(container.querySelector('[data-workspace-list] h2')!.textContent).toBe('워크스페이스 4개')
  })
  it('0개면 빈 상태 안내 — 생성 폼은 그대로 있다', () => {
    const { container } = render(<WorkspacesManager rows={[]} accountsHref={null} />)
    expect(container.querySelector('[data-status-kind="empty"]')!.textContent).toContain('아직 워크스페이스가 없습니다')
    expect(container.querySelector('[data-workspace-create] form')).not.toBeNull()
  })
})

describe('WorkspacesManager — 생성 폼', () => {
  const setup = (accountsHref: string | null = '/w/alpha/admin/accounts') => {
    const { container } = render(<WorkspacesManager rows={ROWS} accountsHref={accountsHref} />)
    const form = container.querySelector('[data-workspace-create] form') as HTMLFormElement
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')]
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    const submit = () => { act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
    return { container, form, name: inputs[0], slug: inputs[1], email: inputs[2], tz: inputs[3], domains: inputs[4], boxes, submit }
  }
  it('필드 — 이름·주소·첫 관리자 이메일·시간대·초대 허용 도메인(선택), 허용 모듈은 비core 전부가 기본으로 켜져 있다', () => {
    const f = setup()
    expect([...f.form.querySelectorAll('label[for]')].map((l) => l.textContent)).toEqual(['이름', '주소(slug)', '첫 관리자 이메일', '시간대', '초대 허용 도메인 (선택)'])
    expect(f.domains.value).toBe('')                             // 비워 둔 채 시작한다 — 정책 기본값(초대 불가)을 폼이 바꾸지 않는다
    expect(f.boxes).toHaveLength(NON_CORE_MODULES.length)
    expect(f.boxes.every((b) => b.checked)).toBe(true)
    expect(f.email.value).toBe('')                               // 비우면 만드는 사람 자신(안내 문구)
    expect(f.form.textContent).toContain('비워 두면 내가 첫 관리자가 됩니다')
  })
  it('화면 검증 — slug 형식 밖이면 서버를 부르지 않고 그 필드에 사유를 보인다', () => {
    const f = setup()
    setValue(f.name, '새 조직'); setValue(f.slug, 'Bad Slug')
    f.submit()
    expect(mocks.createPlatformWorkspace).not.toHaveBeenCalled()
    expect(f.slug.getAttribute('aria-invalid')).toBe('true')
    expect(f.form.textContent).toContain('주소는 영소문자·숫자·하이픈 2~63자')
  })
  it('제출 — 고른 값 그대로 액션에 넘기고, 성공하면 알림과 새 워크스페이스 링크·새로 고침', async () => {
    mocks.createPlatformWorkspace.mockResolvedValue({ ok: true, workspace: { id: 'w9', slug: 'new-org', name: '새 조직' } })
    const f = setup()
    setValue(f.name, '새 조직'); setValue(f.slug, 'new-org'); setValue(f.email, 'owner@example.com'); setValue(f.tz, 'Asia/Tokyo')
    fireEvent.click(f.boxes[0])                                   // 첫 모듈 해제
    f.submit()
    await flush()
    expect(mocks.createPlatformWorkspace).toHaveBeenCalledExactlyOnceWith({
      name: '새 조직', slug: 'new-org', adminEmail: 'owner@example.com', timezone: 'Asia/Tokyo', modules: NON_CORE_MODULES.slice(1), inviteDomains: [],
    })
    const status = f.form.querySelector('p[role="status"]')!
    expect(status.textContent).toContain('새 조직 워크스페이스를 만들었습니다.')
    expect(status.querySelector('a')!.getAttribute('href')).toBe('/w/new-org')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(f.name.value).toBe('')
  })
  it('초대 허용 도메인 — 첫 관리자 이메일의 도메인을 제안만 한다(자동으로 채우지 않는다). 누르면 들어가고, 이미 있으면 제안이 사라진다', () => {
    const f = setup()
    const suggest = () => f.form.querySelector<HTMLButtonElement>('[data-domain-suggest]')
    expect(suggest()).toBeNull()                                 // 이메일이 없으면 제안도 없다
    setValue(f.email, 'Owner@Example.com')
    expect(f.domains.value).toBe('')                             // 자동으로 채우지 않는다
    expect(suggest()!.textContent).toBe('제안: example.com 넣기')
    fireEvent.click(suggest()!)
    expect(f.domains.value).toBe('example.com')
    expect(suggest()).toBeNull()
    setValue(f.domains, 'partner.co.kr')
    fireEvent.click(suggest()!)
    expect(f.domains.value).toBe('partner.co.kr, example.com')   // 적어 둔 것을 지우지 않고 덧붙인다
  })
  it('초대 허용 도메인 — 적은 값은 나눠서 목록으로 넘기고, 형식 밖이면 서버를 부르지 않고 그 필드에 사유를 보인다', async () => {
    mocks.createPlatformWorkspace.mockResolvedValue({ ok: true, workspace: { id: 'w9', slug: 'new-org', name: '새 조직' } })
    const f = setup()
    setValue(f.name, '새 조직'); setValue(f.slug, 'new-org'); setValue(f.tz, ''); setValue(f.domains, '*, example.com')
    f.submit()
    expect(mocks.createPlatformWorkspace).not.toHaveBeenCalled()
    expect(f.domains.getAttribute('aria-invalid')).toBe('true')
    expect(f.form.textContent).toContain('도메인 형식이 올바르지 않습니다.')
    setValue(f.domains, 'example.com  partner.co.kr')
    f.submit()
    await flush()
    expect(mocks.createPlatformWorkspace.mock.calls[0][0]).toMatchObject({ inviteDomains: ['example.com', 'partner.co.kr'] })
    expect(f.domains.value).toBe('')                             // 성공하면 비운다
  })
  it('모두 해제 → 빈 배열(core 만)을 넘긴다', async () => {
    mocks.createPlatformWorkspace.mockResolvedValue({ ok: true, workspace: { id: 'w9', slug: 'core-only', name: 'x' } })
    const f = setup()
    setValue(f.name, 'x'); setValue(f.slug, 'core-only'); setValue(f.tz, '')
    fireEvent.click([...f.form.querySelectorAll('button')].find((b) => b.textContent === '모두 해제')!)
    f.submit()
    await flush()
    expect(mocks.createPlatformWorkspace.mock.calls[0][0]).toMatchObject({ modules: [], timezone: '' })
  })
  it('서버 거부 — slug 중복은 주소 필드에, 입력은 유지된다', async () => {
    mocks.createPlatformWorkspace.mockResolvedValue({ ok: false, code: 'slug_taken', field: 'slug' })
    const f = setup()
    setValue(f.name, '새 조직'); setValue(f.slug, 'alpha'); setValue(f.tz, '')
    f.submit()
    await flush()
    expect(f.form.textContent).toContain('이미 쓰고 있는 주소입니다')
    expect(f.slug.value).toBe('alpha')
    expect(f.name.value).toBe('새 조직')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('첫 관리자 계정이 없으면 사유와 계정 관리 화면 링크를 보인다(소속이 없으면 링크 없이 문구만)', async () => {
    mocks.createPlatformWorkspace.mockResolvedValue({ ok: false, code: 'admin_not_found', field: 'adminEmail' })
    const f = setup()
    setValue(f.name, '새 조직'); setValue(f.slug, 'new-org'); setValue(f.email, 'ghost@example.com'); setValue(f.tz, '')
    f.submit()
    await flush()
    expect(f.form.textContent).toContain('그 이메일의 계정이 없습니다')
    expect([...f.form.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/w/alpha/admin/accounts')

    const g = setup(null)
    setValue(g.name, '새 조직'); setValue(g.slug, 'new-org'); setValue(g.email, 'ghost@example.com'); setValue(g.tz, '')
    g.submit()
    await flush()
    expect(g.form.textContent).toContain('그 이메일의 계정이 없습니다')
    expect(g.form.querySelector('a')).toBeNull()
  })
  it('필드에 묶이지 않는 실패(생성 실패·요청 예외)는 알림 영역에 고정 문구로', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const [arrange, text] of [
      [() => mocks.createPlatformWorkspace.mockResolvedValueOnce({ ok: false, code: 'create_failed', field: null }), '워크스페이스를 만들지 못했습니다'],
      [() => mocks.createPlatformWorkspace.mockRejectedValueOnce(new Error('fetch failed: internal-host')), '요청을 처리하지 못했습니다'],
    ] as const) {
      arrange()
      const f = setup()
      setValue(f.name, '새 조직'); setValue(f.slug, 'new-org'); setValue(f.tz, '')
      f.submit()
      await flush()
      const alert = f.form.querySelector('[role="alert"]')!
      expect(alert.textContent).toContain(text)
      expect(f.form.textContent).not.toContain('internal-host')
    }
    spy.mockRestore()
  })
})
