// @vitest-environment jsdom
// 프로젝트 설정 '위험 구역'(BUG-18) — 프로젝트 삭제. 지워질 것의 건수, 이름을 그대로 적어야 열리는 확정 단추, 회의록이 있으면 단추 대신 막힌 이유,
// 성공하면 프로젝트 목록으로 이동 + 알림(남은 파일이 있으면 그 사실도), 실패는 대화상자에 사유.
// 누구에게 보이는지(워크스페이스 관리자만)는 tests/ui/settings-page-visibility.test.tsx 가 본다.
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '../shell/_dom'
import { KO } from '@/lib/i18n/dict/ko'
import type { ProjectDeleteSummaryResult } from '@/app/actions/projectDelete'

const mocks = vi.hoisted(() => ({ deleteProject: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), toast: vi.fn() }))
vi.mock('@/app/actions/projectDelete', () => ({ deleteProject: mocks.deleteProject }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: keyof typeof KO) => KO[k] ?? k }) }))

import { ProjectDeleteZone } from '@/components/settings/ProjectDeleteZone'

const ZERO = {
  wbs_items: 0, issues: 0, weekly_reports: 0, meetings: 0, wiki_items: 0, wiki_topics: 0, announcements: 0, attendance_records: 0,
  project_members: 0, teams: 0, form_templates: 0, attachments: 0,
}
const SUMMARY: ProjectDeleteSummaryResult = { ok: true, minutes: 0, minutesArchived: 0, counts: { ...ZERO, wbs_items: 12, issues: 3, attachments: 5, project_members: 4 } }
const REMOVED = { ...ZERO, wbs_items: 12 }

const setValue = (el: HTMLInputElement, value: string) => {
  // React 가 추적하는 값 setter 를 지나야 onChange 가 불린다
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const zone = (summary: ProjectDeleteSummaryResult = SUMMARY, name = '운영 개선') =>
  render(<ProjectDeleteZone projectId="p1" projectName={name} workspaceSlug="acme" summary={summary} />)
const open = (summary?: ProjectDeleteSummaryResult, name?: string) => {
  const { container } = zone(summary, name)
  fireEvent.click(container.querySelector('[data-danger-open]')!)
  return {
    container,
    input: dialog()!.querySelector<HTMLInputElement>('[data-danger-name]')!,
    confirm: () => dialog()!.querySelector<HTMLButtonElement>('[data-danger-confirm]')!,
  }
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('구역 — 지워질 것과 삭제 단추', () => {
  it('되돌릴 수 없음을 알리고, 0건이 아닌 항목만 건수와 함께 보인다', () => {
    const { container } = zone()
    expect(container.textContent).toContain('되돌릴 수 없습니다')
    expect([...container.querySelectorAll('[data-danger-count]')].map((li) => li.textContent))
      .toEqual(['작업 12건', '이슈 3건', '멤버 명단 4명', '첨부 파일 5개'])
    expect(container.querySelector('[data-danger-open]')).not.toBeNull()
    expect(container.querySelector('[data-danger-blocked]')).toBeNull()
    expect(dialog()).toBeNull()
  })
  it('딸린 자료가 없으면 그렇게 적는다', () => {
    const { container } = zone({ ok: true, minutes: 0, minutesArchived: 0, counts: ZERO })
    expect(container.querySelector('[data-danger-counts]')!.textContent).toContain('딸린 자료가 없습니다.')
  })
  it('지워질 것을 읽지 못했으면 삭제를 열지 않는다 — 단추도 건수도 없이 사유만', () => {
    const { container } = zone({ ok: false, code: 'lookup_failed', error: 'x' })
    expect(container.querySelector('[data-danger-summary-failed]')!.textContent).toContain('삭제를 열지 않았습니다')
    expect(container.querySelector('[data-danger-open]')).toBeNull()
    expect(container.querySelector('[data-danger-counts]')).toBeNull()
  })
})

describe('회의록이 있으면 막힌다', () => {
  it('단추 대신 건수와 옮기는 방법을 보인다', () => {
    const { container } = zone({ ...SUMMARY, ok: true, minutes: 7, minutesArchived: 0 } as ProjectDeleteSummaryResult)
    const blocked = container.querySelector('[data-danger-blocked]')!
    expect(blocked.textContent).toContain('회의록이 7건 있어 삭제할 수 없습니다.')
    expect(blocked.textContent).toContain('프로젝트 지정')
    expect(container.querySelector('[data-danger-blocked-archived]')).toBeNull()
    expect(container.querySelector('[data-danger-open]')).toBeNull()
  })
  it('보관된 회의록이 섞여 있으면 그 수와 "옮길 수 없다"를 함께 알린다', () => {
    const { container } = zone({ ...SUMMARY, ok: true, minutes: 7, minutesArchived: 2 } as ProjectDeleteSummaryResult)
    expect(container.querySelector('[data-danger-blocked-archived]')!.textContent).toContain('2건은 보관된 회의록입니다')
  })
  it('화면을 연 뒤 회의록이 생겨 서버가 거부하면 대화상자를 닫고 구역에 막힌 이유를 그린다', async () => {
    mocks.deleteProject.mockResolvedValue({ ok: false, code: 'has_minutes', error: '회의록이 1건 있어 삭제할 수 없습니다.', minutes: 1, minutesArchived: 0 })
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()).toBeNull()
    expect(f.container.querySelector('[data-danger-blocked]')!.textContent).toContain('회의록이 1건 있어 삭제할 수 없습니다.')
    expect(f.container.querySelector('[data-danger-open]')).toBeNull()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})

describe('확인 대화상자 — 이름을 그대로 적어야 한다', () => {
  it('대상과 되돌릴 수 없음을 알리고, 이름을 적기 전에는 확정 단추가 잠겨 있다', () => {
    const f = open()
    expect(dialog()!.querySelector('[data-danger-target]')!.textContent).toBe('“운영 개선” 프로젝트를 삭제합니다.')
    expect(dialog()!.textContent).toContain('삭제한 프로젝트는 되돌릴 수 없습니다.')
    expect(dialog()!.textContent).toContain('프로젝트 이름 “운영 개선”을 그대로 입력하세요')
    expect(f.input.value).toBe('')
    expect(f.confirm().disabled).toBe(true)
  })
  it('이름의 받침에 맞춰 조사를 고른다', () => {
    open(SUMMARY, '통합 테스트')
    expect(dialog()!.textContent).toContain('프로젝트 이름 “통합 테스트”를 그대로 입력하세요')
  })
  it('한 글자라도 다르면 잠긴 채다 — 대소문자·안쪽 공백을 맞춰 주지 않는다. 양끝 공백은 서버와 같이 뗀다', () => {
    const f = open(SUMMARY, 'Ops Plan')
    for (const typed of ['Ops', 'ops plan', 'Ops  Plan', 'OpsPlan', '   ']) {
      setValue(f.input, typed)
      expect(f.confirm().disabled, typed).toBe(true)
    }
    for (const typed of ['Ops Plan', ' Ops Plan ']) {
      setValue(f.input, typed)
      expect(f.confirm().disabled, typed).toBe(false)
    }
    expect(mocks.deleteProject).not.toHaveBeenCalled()
  })
  it('성공 — 적은 이름 그대로 액션에 넘기고, 알린 뒤 프로젝트 목록으로 이동한다(뒤로 가기로 돌아오지 않게 replace)', async () => {
    mocks.deleteProject.mockResolvedValue({ ok: true, name: '운영 개선', removed: REMOVED, orphanedFiles: 0, filesUnchecked: false })
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    await flush()
    expect(mocks.deleteProject).toHaveBeenCalledWith('p1', '운영 개선')
    expect(mocks.toast).toHaveBeenCalledWith({ title: '“운영 개선”을 삭제했습니다.', variant: 'success' })
    expect(mocks.replace).toHaveBeenCalledWith('/w/acme/projects')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('성공했지만 파일이 남았으면 그 사실을 알림에 함께 싣는다', async () => {
    mocks.deleteProject.mockResolvedValue({ ok: true, name: '운영 개선', removed: REMOVED, orphanedFiles: 3, filesUnchecked: true })
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    await flush()
    const arg = mocks.toast.mock.calls[0][0] as { title: string; description: string; variant: string }
    expect(arg.title).toBe('“운영 개선”을 삭제했습니다.')
    expect(arg.description).toContain('파일 3개가 남았습니다')
    expect(arg.description).toContain('파일을 다 확인하지 못했습니다')
    expect(arg.variant).toBe('info')
    expect(mocks.replace).toHaveBeenCalledWith('/w/acme/projects')
  })
  it('거부 — 대화상자를 닫지 않고 서버가 준 사유를 보인다. 이동하지 않는다', async () => {
    mocks.deleteProject.mockResolvedValue({ ok: false, code: 'name_mismatch', error: '입력한 이름이 프로젝트 이름과 다릅니다.' })
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()!.querySelector('[data-danger-error]')!.textContent).toBe('입력한 이름이 프로젝트 이름과 다릅니다.')
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    // 다시 적으면 사유가 지워진다
    setValue(f.input, '운영 개선 ')
    expect(dialog()!.querySelector('[data-danger-error]')).toBeNull()
  })
  it('요청이 끊기면 지워졌다고도 안 지워졌다고도 하지 않는다 — 목록에서 확인하게 한다', async () => {
    mocks.deleteProject.mockRejectedValue(new Error('network'))
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    await flush()
    expect(dialog()!.querySelector('[data-danger-error]')!.textContent).toContain('삭제됐는지 확인하세요')
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it('보내는 동안에는 다시 보내지 않는다', async () => {
    let done: (v: unknown) => void = () => {}
    mocks.deleteProject.mockReturnValue(new Promise((r) => { done = r }))
    const f = open()
    setValue(f.input, '운영 개선')
    fireEvent.click(f.confirm())
    fireEvent.click(f.confirm())
    expect(mocks.deleteProject).toHaveBeenCalledTimes(1)
    expect(f.confirm().getAttribute('aria-busy')).toBe('true')
    done({ ok: false, code: 'delete_failed', error: '실패' })
    await flush()
    expect(f.confirm().getAttribute('aria-busy')).toBeNull()
  })
})
