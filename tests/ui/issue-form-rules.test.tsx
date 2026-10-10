// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENTRY_CONTEXT, TEST_AREAS } from '../fixtures/issue-areas'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import type { IssueEntryContext } from '@/lib/issues/context'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/p/p1/issues' }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
const h = vi.hoisted(() => ({ createIssue: vi.fn(), updateIssue: vi.fn() }))
vi.mock('@/app/actions/issues', () => ({ ...h, fetchIssueMajorProcesses: vi.fn(async () => ({ ok: true, majors: [] })), fetchIssueEntryContext: vi.fn(), deleteIssue: vi.fn(), updateIssueProgress: vi.fn() }))
vi.mock('@/app/actions/issueUpdates', () => ({ listIssueUpdates: vi.fn(async () => ({ ok: true, items: [] })) }))
import { IssueFormModal } from '@/components/issues/IssueModals'

describe('issue form entry rules', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => { h.createIssue.mockReset(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  async function render(context: IssueEntryContext, canManage = false) {
    await act(async () => { root.render(<IssueFormModal open initial={null} workspaceId={null} projectId="p1" members={[]} onClose={() => {}} entryContext={context} canManage={canManage} />) })
  }
  function areaSelect() { const label = [...document.querySelectorAll('label')].find(l => l.textContent?.startsWith('issue.analysis.area')); return label ? document.getElementById(label.htmlFor) as HTMLSelectElement : null }
  it('analysis off with plain policy renders neither area nor analysis fields', async () => {
    await render({ ...TEST_ENTRY_CONTEXT, policy: DEFAULT_ID_POLICY, rules: { areaRequired: false, analysis: 'off' } })
    expect(areaSelect()).toBeNull()
    expect(document.querySelector('input[list="issue-major-process-options"]')).toBeNull()
  })
  it('required analysis shows required area and rejects empty submission', async () => {
    await render({ ...TEST_ENTRY_CONTEXT, rules: { areaRequired: true, analysis: 'required' } })
    expect(areaSelect()?.required).toBe(true)
    expect(document.querySelector('input[list="issue-major-process-options"]')).not.toBeNull()
    const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'issue.form.save')!
    await act(async () => save.click())
    expect(h.createIssue).not.toHaveBeenCalled()
  })
  it('missing required active areas offers setup to admins and disables save', async () => {
    await render({ ...TEST_ENTRY_CONTEXT, policy: { ...DEFAULT_ID_POLICY, pattern: '{prefix}-{area}-{seq:3}' }, areas: TEST_AREAS.map(a => ({ ...a, active: false })), rules: { areaRequired: true, analysis: 'off' } }, true)
    expect(document.querySelector('[data-status-kind="needs_setup"]')).not.toBeNull()
    expect(document.querySelector('a[href="/p/p1/settings#project-team"]')).not.toBeNull()
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'issue.form.save')?.disabled).toBe(true)
  })
  it('non-admins get a request for administrator help without settings link', async () => {
    await render({ ...TEST_ENTRY_CONTEXT, policy: { ...DEFAULT_ID_POLICY, pattern: '{prefix}-{area}-{seq:3}' }, areas: [], rules: { areaRequired: true, analysis: 'off' } })
    expect(document.body.textContent).toContain('issue.analysis.askAreaAdmin')
    expect(document.querySelector('a[href="/p/p1/settings#project-team"]')).toBeNull()
  })
})
