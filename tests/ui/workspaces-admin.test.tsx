// @vitest-environment jsdom
// /admin/workspaces(개정 §5.3.2) — 플랫폼 관리자만(나머지·열화 = 404). 목록(이름·slug·멤버·프로젝트·만든 날·허용 모듈·이동)과 생성 폼,
// 행 작업(이름 바꾸기·삭제 — 0055)과 워크스페이스 설정 '일반'의 이름 편집.
import { act, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fireEvent, render } from '../shell/_dom'
import { makeActor, makeSuperuser } from '../fixtures/actor'
import { KO } from '@/lib/i18n/dict/ko'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'
import type { PlatformWorkspaceRow } from '@/app/actions/platformWorkspaces'
import { archivedRowVerdict } from '../../scripts/lib/e2e.mjs'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(), listPlatformWorkspaces: vi.fn(), createPlatformWorkspace: vi.fn(), readCurrentWorkspace: vi.fn(),
  renameWorkspace: vi.fn(), deletePlatformWorkspace: vi.fn(), archivePlatformWorkspace: vi.fn(), restorePlatformWorkspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }), refresh: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/app/actions/platformWorkspaces', () => ({
  listPlatformWorkspaces: mocks.listPlatformWorkspaces, createPlatformWorkspace: mocks.createPlatformWorkspace,
  renameWorkspace: mocks.renameWorkspace, deletePlatformWorkspace: mocks.deletePlatformWorkspace,
  archivePlatformWorkspace: mocks.archivePlatformWorkspace, restorePlatformWorkspace: mocks.restorePlatformWorkspace,
}))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: mocks.readCurrentWorkspace }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', setLocale: vi.fn(), t: (k: keyof typeof KO) => KO[k] ?? k }) }))

import WorkspacesAdminPage from '@/app/(app)/(global)/admin/workspaces/page'
import { WorkspacesManager } from '@/components/admin/WorkspacesManager'
import { WorkspaceNameEditor } from '@/components/settings/WorkspaceNameEditor'

const ROWS: PlatformWorkspaceRow[] = [
  { id: 'w1', slug: 'alpha', name: '알파', createdAt: '2026-09-01T03:00:00Z', memberCount: 12, projectCount: 3, allowedModules: [...NON_CORE_MODULES], archivedAt: null, archiveReason: null },
  { id: 'w2', slug: 'beta', name: '베타', createdAt: '2026-10-01T03:00:00Z', memberCount: 1, projectCount: 0, allowedModules: [], archivedAt: null, archiveReason: null },
  { id: 'w3', slug: 'gamma', name: '감마', createdAt: '2026-10-02T03:00:00Z', memberCount: 2, projectCount: 1, allowedModules: ['kanban', 'wiki'], archivedAt: null, archiveReason: null },
  { id: 'w4', slug: 'delta', name: '델타', createdAt: '2026-10-03T03:00:00Z', memberCount: 0, projectCount: 0, allowedModules: null, archivedAt: null, archiveReason: null },
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
    expect(cells(0).slice(0, 7)).toEqual(['알파', 'alpha', '사용 중', '12', '3', '2026-09-01', `전체 ${NON_CORE_MODULES.length}개`])   // 셋째 칸은 상태(0056)
    expect(cells(1)[6]).toBe('기본 기능만')
    expect(cells(2)[6]).toBe(`2/${NON_CORE_MODULES.length}개`)
    expect(cells(3)[6]).toBe('확인 불가')                       // 설정을 못 읽은 워크스페이스 — 빈 목록으로 그리지 않는다
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

describe('WorkspacesManager — 행 작업: 이름 바꾸기', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const open = (slug: string) => {
    const { container } = render(<WorkspacesManager rows={ROWS} accountsHref={null} />)
    fireEvent.click(container.querySelector(`[data-workspace-row="${slug}"] [data-workspace-rename]`)!)
    return { container, input: dialog()!.querySelector<HTMLInputElement>('[data-rename-input]')!, confirm: dialog()!.querySelector<HTMLButtonElement>('[data-rename-confirm]')! }
  }
  it('행마다 이름 바꾸기·삭제 단추 — 이름이 든 라벨', () => {
    const { container } = render(<WorkspacesManager rows={ROWS} accountsHref={null} />)
    const row = container.querySelector('[data-workspace-row="gamma"]')!
    expect(row.querySelector('[data-workspace-rename]')!.getAttribute('aria-label')).toBe('감마 워크스페이스 이름 바꾸기')
    expect(row.querySelector('[data-workspace-delete]')!.getAttribute('aria-label')).toBe('감마 워크스페이스 삭제')
    expect(dialog()).toBeNull()
  })
  it('대화상자 — 지금 이름이 채워져 있고, 주소는 바뀌지 않는다고 알린다', () => {
    const f = open('beta')
    expect(f.input.value).toBe('베타')
    expect(dialog()!.textContent).toContain('주소(beta)는 바뀌지 않습니다')
  })
  it('저장 — 다듬은 이름으로 액션을 부르고, 성공하면 닫고 알림·새로 고침', async () => {
    mocks.renameWorkspace.mockResolvedValue({ ok: true, name: '베타 2', unchanged: false })
    const f = open('beta')
    setValue(f.input, '  베타 2 ')
    fireEvent.click(f.confirm)
    await flush()
    expect(mocks.renameWorkspace).toHaveBeenCalledExactlyOnceWith('w2', '베타 2')
    expect(dialog()).toBeNull()
    expect(f.container.querySelector('[data-workspace-row-notice]')!.textContent).toBe('워크스페이스 이름을 바꿨습니다: 베타 2')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('화면 검증 — 비우면 서버를 부르지 않고 사유를 보인다. 이름이 그대로면 부르지 않고 닫는다', () => {
    const f = open('beta')
    setValue(f.input, '   ')
    fireEvent.click(f.confirm)
    expect(mocks.renameWorkspace).not.toHaveBeenCalled()
    expect(f.input.getAttribute('aria-invalid')).toBe('true')
    expect(dialog()!.textContent).toContain('이름을 입력하세요.')
    setValue(f.input, '베타')
    fireEvent.click(f.confirm)
    expect(mocks.renameWorkspace).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })
  it('거부 — 대화상자를 닫지 않고 사유를 보인다(이름 변경의 권한 문구는 생성의 것과 다르다)', async () => {
    mocks.renameWorkspace.mockResolvedValue({ ok: false, code: 'denied' })
    const f = open('beta')
    setValue(f.input, '베타 2')
    fireEvent.click(f.confirm)
    await flush()
    expect(dialog()!.textContent).toContain('이 워크스페이스의 관리자만 이름을 바꿀 수 있습니다.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})

describe('WorkspacesManager — 행 작업: 삭제', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const open = (slug: string) => {
    const { container } = render(<WorkspacesManager rows={ROWS} accountsHref={null} />)
    fireEvent.click(container.querySelector(`[data-workspace-row="${slug}"] [data-workspace-delete]`)!)
    return { container, input: dialog()!.querySelector<HTMLInputElement>('[data-delete-slug]')!, confirm: () => dialog()!.querySelector<HTMLButtonElement>('[data-delete-confirm]')! }
  }
  it('대화상자 — 대상·되돌릴 수 없음·삭제 조건을 알리고, 주소를 직접 적기 전에는 확정 단추가 잠겨 있다', () => {
    const f = open('beta')
    const text = dialog()!.textContent!
    expect(dialog()!.querySelector('[data-delete-target]')!.textContent).toBe('베타 (beta)')
    expect(text).toContain('삭제는 되돌릴 수 없습니다')
    expect(text).toContain('비어 있는 워크스페이스만 삭제됩니다')
    expect(f.input.value).toBe('')
    expect(f.confirm().disabled).toBe(true)
  })
  it('적은 주소가 한 글자라도 다르면 잠긴 채다 — 대소문자·앞뒤 공백을 맞춰 주지 않는다', () => {
    const f = open('beta')
    for (const typed of ['bet', 'Beta', ' beta', 'beta ', 'alpha']) {
      setValue(f.input, typed)
      expect(f.confirm().disabled, typed).toBe(true)
    }
    fireEvent.click(f.confirm())
    expect(mocks.deletePlatformWorkspace).not.toHaveBeenCalled()
    setValue(f.input, 'beta')
    expect(f.confirm().disabled).toBe(false)
  })
  it('확정 — 그 워크스페이스 id 와 적은 주소로 액션을 부르고, 성공하면 닫고 알림·새로 고침', async () => {
    mocks.deletePlatformWorkspace.mockResolvedValue({ ok: true, workspace: { slug: 'beta', name: '베타' } })
    const f = open('beta')
    setValue(f.input, 'beta')
    fireEvent.click(f.confirm())
    await flush()
    expect(mocks.deletePlatformWorkspace).toHaveBeenCalledExactlyOnceWith('w2', 'beta')
    expect(dialog()).toBeNull()
    expect(f.container.querySelector('[data-workspace-row-notice]')!.textContent).toBe('워크스페이스를 삭제했습니다: 베타')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('비어 있지 않으면 닫지 않고 남은 것을 항목별로 보인다 — 모르는 표는 이름과 함께', async () => {
    mocks.deletePlatformWorkspace.mockResolvedValue({
      ok: false, code: 'not_empty',
      remaining: [{ key: 'projects', count: 3 }, { key: 'members', count: 11 }, { key: 'minutes', count: 5 }, { key: 'other', count: 2, table: 'zz_new' }],
    })
    const f = open('alpha')
    setValue(f.input, 'alpha')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('비어 있지 않아 삭제하지 않았습니다.')
    expect([...dialog()!.querySelectorAll('[data-delete-remaining] li')].map((li) => li.textContent))
      .toEqual(['프로젝트 3개', '다른 멤버 11명', '회의록 5건', '그 밖의 자료 2건 (zz_new)'])
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(f.container.querySelector('[data-workspace-row-notice]')).toBeNull()
  })
  it.each([
    ['slug_mismatch', '입력한 주소가 이 워크스페이스의 주소와 다릅니다. 삭제하지 않았습니다.'],
    ['denied', '플랫폼 관리자만 워크스페이스를 삭제할 수 있습니다.'],
    ['delete_failed', '워크스페이스를 삭제하지 못했습니다. 아무것도 지워지지 않았습니다. 잠시 뒤 다시 시도하세요.'],
  ])('거부 %s — 사유를 보이고 남은 것 목록은 그리지 않는다', async (code, message) => {
    mocks.deletePlatformWorkspace.mockResolvedValue({ ok: false, code })
    const f = open('beta')
    setValue(f.input, 'beta')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe(message)
    expect(dialog()!.querySelector('[data-delete-remaining]')).toBeNull()
  })
  it('요청 자체가 실패하면 고정 문구 — 닫지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.deletePlatformWorkspace.mockRejectedValue(new Error('network down'))
    const f = open('beta')
    setValue(f.input, 'beta')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.')
    spy.mockRestore()
  })
})

// 보관·복원(0056) — 보관 = 숨김 + 동결. 보관된 행은 "보관됨"으로 보이고 열기·이름 바꾸기 대신 복원만 있다(삭제는 그대로)
describe('WorkspacesManager — 보관·복원', () => {
  const AT = '2026-10-09T01:02:03Z'
  const WITH_ARCHIVED: PlatformWorkspaceRow[] = [
    ROWS[0],
    { ...ROWS[1], archivedAt: AT, archiveReason: '계약 종료' },
    { ...ROWS[2], archivedAt: AT, archiveReason: null },
  ]
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const setArea = (el: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const rowOf = (container: HTMLElement, slug: string) => container.querySelector<HTMLElement>(`[data-workspace-row="${slug}"]`)!

  it('상태 칸 — 활성은 "사용 중", 보관된 행은 "보관됨" 배지와 보관 날짜·사유(사유가 없으면 그 줄이 없다)', () => {
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    expect(rowOf(container, 'alpha').querySelector('[data-workspace-status]')!.textContent).toBe('사용 중')
    expect(rowOf(container, 'alpha').hasAttribute('data-workspace-archived')).toBe(false)
    const beta = rowOf(container, 'beta').querySelector('[data-workspace-status]')!.textContent!
    expect(beta).toContain('보관됨')
    expect(beta).toContain('2026-10-09 보관')
    expect(beta).toContain('사유: 계약 종료')
    expect(rowOf(container, 'beta').getAttribute('data-workspace-archived')).toBe('true')
    expect(rowOf(container, 'gamma').querySelector('[data-workspace-status]')!.textContent).not.toContain('사유')
  })

  it('보관된 행 — 열기·이름 바꾸기·보관이 없고 복원과 삭제만 있다. 활성 행에는 보관이 있고 복원이 없다', () => {
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    const beta = rowOf(container, 'beta')
    expect(beta.querySelector('a')).toBeNull()                            // 그 화면은 플랫폼 관리자에게도 404 다
    expect(beta.querySelector('[data-workspace-rename]')).toBeNull()
    expect(beta.querySelector('[data-workspace-archive]')).toBeNull()
    expect(beta.querySelector('[data-workspace-restore]')!.getAttribute('aria-label')).toBe('베타 워크스페이스 복원')
    expect(beta.querySelector('[data-workspace-delete]')).not.toBeNull()   // 보관된 워크스페이스도 비어 있으면 지울 수 있다
    const alpha = rowOf(container, 'alpha')
    expect(alpha.querySelector('a')!.getAttribute('href')).toBe('/w/alpha')
    expect(alpha.querySelector('[data-workspace-archive]')!.getAttribute('aria-label')).toBe('알파 워크스페이스 보관')
    expect(alpha.querySelector('[data-workspace-restore]')).toBeNull()
  })

  it('E2E 의 목록 판정(archivedRowVerdict)이 실제 화면의 표지를 읽는다 — 스크립트와 화면이 따로 놀지 않게', () => {
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    const html = container.innerHTML
    expect(archivedRowVerdict(html, 'alpha', false)).toEqual([])
    expect(archivedRowVerdict(html, 'beta', true)).toEqual([])
    expect(archivedRowVerdict(html, 'gamma', true)).toEqual([])
    expect(archivedRowVerdict(html, 'alpha', true).length).toBeGreaterThan(0)
  })

  it('보관 대화상자 — 무엇이 닫히고 무엇이 남는지 알리고, 주소를 직접 적기 전에는 확정 단추가 잠겨 있다', () => {
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'alpha').querySelector('[data-workspace-archive]')!)
    const d = dialog()!
    expect(d.querySelector('[data-archive-target]')!.textContent).toBe('알파 (alpha)')
    expect(d.textContent).toContain('멤버와 관리자에게 보이지 않게')
    expect(d.textContent).toContain('자료는 지워지지 않습니다')
    const input = d.querySelector<HTMLInputElement>('[data-archive-slug]')!
    const confirm = () => dialog()!.querySelector<HTMLButtonElement>('[data-archive-confirm]')!
    expect(confirm().disabled).toBe(true)
    for (const typed of ['alph', 'Alpha', ' alpha', 'beta']) {
      setValue(input, typed)
      expect(confirm().disabled, typed).toBe(true)
    }
    fireEvent.click(confirm())
    expect(mocks.archivePlatformWorkspace).not.toHaveBeenCalled()
    setValue(input, 'alpha')
    expect(confirm().disabled).toBe(false)
  })

  it('보관 확정 — 그 워크스페이스 id·적은 주소·다듬은 사유로 액션을 부르고, 성공하면 닫고 알림·새로 고침', async () => {
    mocks.archivePlatformWorkspace.mockResolvedValue({ ok: true, workspace: { slug: 'alpha', name: '알파' }, archivedAt: AT, unchanged: false })
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'alpha').querySelector('[data-workspace-archive]')!)
    setValue(dialog()!.querySelector<HTMLInputElement>('[data-archive-slug]')!, 'alpha')
    setArea(dialog()!.querySelector<HTMLTextAreaElement>('[data-archive-reason]')!, '  계약 종료  ')
    fireEvent.click(dialog()!.querySelector('[data-archive-confirm]')!)
    await flush()
    expect(mocks.archivePlatformWorkspace).toHaveBeenCalledExactlyOnceWith('w1', 'alpha', '계약 종료')
    expect(dialog()).toBeNull()
    expect(container.querySelector('[data-workspace-row-notice]')!.textContent).toBe('워크스페이스를 보관했습니다: 알파')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('사유를 비우면 null 로 넘긴다. 이미 보관이었으면(unchanged) 그 사실을 알린다', async () => {
    mocks.archivePlatformWorkspace.mockResolvedValue({ ok: true, workspace: { slug: 'alpha', name: '알파' }, archivedAt: AT, unchanged: true })
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'alpha').querySelector('[data-workspace-archive]')!)
    setValue(dialog()!.querySelector<HTMLInputElement>('[data-archive-slug]')!, 'alpha')
    fireEvent.click(dialog()!.querySelector('[data-archive-confirm]')!)
    await flush()
    expect(mocks.archivePlatformWorkspace).toHaveBeenCalledExactlyOnceWith('w1', 'alpha', null)
    expect(container.querySelector('[data-workspace-row-notice]')!.textContent).toBe('이미 보관된 워크스페이스입니다: 알파')
  })

  it.each([
    ['slug_mismatch', '입력한 주소가 이 워크스페이스의 주소와 다릅니다. 보관하지 않았습니다.'],
    ['denied', '플랫폼 관리자만 워크스페이스를 보관할 수 있습니다.'],
    ['reason_too_long', '사유는 500자 이하여야 합니다.'],
    ['archive_failed', '워크스페이스를 보관하지 못했습니다. 바뀐 것은 없습니다. 잠시 뒤 다시 시도하세요.'],
  ])('보관 거부 %s — 닫지 않고 그 조작의 사유를 보인다(삭제의 문구가 아니다)', async (code, text) => {
    mocks.archivePlatformWorkspace.mockResolvedValue({ ok: false, code })
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'alpha').querySelector('[data-workspace-archive]')!)
    setValue(dialog()!.querySelector<HTMLInputElement>('[data-archive-slug]')!, 'alpha')
    fireEvent.click(dialog()!.querySelector('[data-archive-confirm]')!)
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe(text)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('복원 — 단순 확인(주소를 적지 않는다). 대상·효과·보관 사유를 보이고, 확정하면 그 id 로 액션을 부른 뒤 닫고 알림·새로 고침', async () => {
    mocks.restorePlatformWorkspace.mockResolvedValue({ ok: true, workspace: { slug: 'beta', name: '베타' }, unchanged: false })
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'beta').querySelector('[data-workspace-restore]')!)
    const d = dialog()!
    expect(d.querySelector('[data-restore-target]')!.textContent).toBe('베타 (beta)')
    expect(d.querySelector('[data-restore-reason]')!.textContent).toBe('사유: 계약 종료')
    expect(d.querySelector('input')).toBeNull()
    const confirm = d.querySelector<HTMLButtonElement>('[data-restore-confirm]')!
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await flush()
    expect(mocks.restorePlatformWorkspace).toHaveBeenCalledExactlyOnceWith('w2')
    expect(dialog()).toBeNull()
    expect(container.querySelector('[data-workspace-row-notice]')!.textContent).toBe('워크스페이스를 복원했습니다: 베타')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it.each([
    ['denied', '플랫폼 관리자만 워크스페이스를 복원할 수 있습니다.'],
    ['not_found', '워크스페이스를 찾지 못했습니다. 목록을 새로고침한 뒤 다시 시도하세요.'],
    ['restore_failed', '워크스페이스를 복원하지 못했습니다. 바뀐 것은 없습니다. 잠시 뒤 다시 시도하세요.'],
  ])('복원 거부 %s — 닫지 않고 사유를 보인다', async (code, text) => {
    mocks.restorePlatformWorkspace.mockResolvedValue({ ok: false, code })
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'beta').querySelector('[data-workspace-restore]')!)
    fireEvent.click(dialog()!.querySelector('[data-restore-confirm]')!)
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe(text)
  })

  it('요청 자체가 실패하면 고정 문구 — 닫지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.restorePlatformWorkspace.mockRejectedValue(new Error('network'))
    const { container } = render(<WorkspacesManager rows={WITH_ARCHIVED} accountsHref={null} />)
    fireEvent.click(rowOf(container, 'beta').querySelector('[data-workspace-restore]')!)
    fireEvent.click(dialog()!.querySelector('[data-restore-confirm]')!)
    await flush()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.')
    spy.mockRestore()
  })
})

describe("WorkspaceNameEditor — 워크스페이스 설정 '일반'의 이름", () => {
  const setup = () => {
    const { container } = render(<WorkspaceNameEditor workspaceId="w1" slug="alpha" initialName="알파" />)
    const form = container.querySelector('[data-workspace-name-editor]') as HTMLFormElement
    const submit = () => { act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
    return { form, input: form.querySelector('input')!, button: form.querySelector<HTMLButtonElement>('button[type="submit"]')!, submit }
  }
  it('지금 이름이 채워져 있고 주소는 바뀌지 않는다고 알린다 — 바꾸기 전에는 저장이 잠겨 있다', () => {
    const f = setup()
    expect(f.input.value).toBe('알파')
    expect(f.form.textContent).toContain('주소(alpha)는 바뀌지 않습니다')
    expect(f.button.disabled).toBe(true)
  })
  it('저장 — 다듬은 이름으로 액션을 부르고, 성공하면 알림·새로 고침', async () => {
    mocks.renameWorkspace.mockResolvedValue({ ok: true, name: '알파 연구소', unchanged: false })
    const f = setup()
    setValue(f.input, ' 알파 연구소 ')
    expect(f.button.disabled).toBe(false)
    f.submit()
    await flush()
    expect(mocks.renameWorkspace).toHaveBeenCalledExactlyOnceWith('w1', '알파 연구소')
    expect(f.form.querySelector('[role="status"]')!.textContent).toBe('이름을 저장했습니다.')
    expect(f.input.value).toBe('알파 연구소')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('검증·거부 — 비우면 서버를 부르지 않고, 거부되면 사유를 보이고 입력은 그대로 둔다', async () => {
    const f = setup()
    setValue(f.input, '   ')
    f.submit()
    expect(mocks.renameWorkspace).not.toHaveBeenCalled()
    expect(f.form.textContent).toContain('이름을 입력하세요.')
    mocks.renameWorkspace.mockResolvedValue({ ok: false, code: 'rename_failed' })
    setValue(f.input, '알파 2')
    f.submit()
    await flush()
    expect(f.form.textContent).toContain('이름을 바꾸지 못했습니다. 잠시 뒤 다시 시도하세요.')
    expect(f.input.value).toBe('알파 2')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
