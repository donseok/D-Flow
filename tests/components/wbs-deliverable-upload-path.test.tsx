// @vitest-environment jsdom
// 산출물 첨부 업로드 경로(SP2 B1) — ws/<wid>/p/<pid>/deliverables/<항목>/<시각-안전명>. 워크스페이스를 모르면 올리지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { t as realT } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { upload, remove, recordAttachment } = vi.hoisted(() => ({
  upload: vi.fn<(path: string, file: File, opts: unknown) => Promise<{ error: null }>>(async () => ({ error: null })),
  remove: vi.fn(async () => ({})),
  recordAttachment: vi.fn<(itemId: string, file: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue({ ok: true, rows: [], download: 'allowed' }), recordAttachment, removeAttachment: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload, remove }) } }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => realT('ko', k as Parameters<typeof realT>[1]) }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const ITEM = 'cccccccc-3333-4333-8333-333333333333'
const item: ComputedItem = {
  id: ITEM, parentId: null, code: 'A-1', sortOrder: 1, name: '대상 작업',
  biz: null, deliverable: null, plannedStart: '2026-08-31', plannedEnd: '2026-09-02',
  weight: null, actualPct: 100, owners: [], isOwnerSplit: false,
  plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done',
  children: [], depth: 0,
}

describe('RowDetailPanel 산출물 첨부 — 저장 경로 규약', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    upload.mockClear(); recordAttachment.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function renderAndPick(workspaceId: string | null) {
    await act(async () => {
      root.render(<RowDetailPanel timeZone="Asia/Seoul" levelLabels={['Phase', 'Task', 'Activity']} item={item} allItems={[item]} dependencies={[]} projectId={PID}
        workspaceId={workspaceId} canAttach onClose={() => {}} />)
    })
    await act(async () => {})
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], '계획서 최종.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }

  it('ws/<wid>/p/<pid>/deliverables/<항목>/ 아래 ASCII 안전명으로 올리고, 같은 경로를 기록한다', async () => {
    await renderAndPick(WS)
    const path = upload.mock.calls[0]![0] as string
    expect(path).toMatch(new RegExp(`^ws/${WS}/p/${PID}/deliverables/${ITEM}/\\d+-[A-Za-z0-9._-]+\\.xlsx$`))
    expect(recordAttachment).toHaveBeenCalledWith(ITEM, expect.objectContaining({ fileName: '계획서 최종.xlsx', filePath: path }))
  })

  it('워크스페이스를 모르면 올리지 않고 사유를 보인다', async () => {
    await renderAndPick(null)
    expect(upload).not.toHaveBeenCalled()
    expect(recordAttachment).not.toHaveBeenCalled()
    expect(container.textContent).toContain(realT('ko', 'wbs.attachNoWorkspace'))
  })
})
