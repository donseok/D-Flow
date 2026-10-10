// @vitest-environment jsdom
// 행 상세 패널의 하위 항목 추가(addWbsItem) 실패 문구 — 액션의 한국어 고정 문구를 사전 키로 바꿔 그린다(SP4 D21·D52, 계획 P12 —
// B-3 리뷰 P3: WBS 시트·칸반만 매핑되고 이 패널은 받은 문구를 그대로 그렸다). 표 밖 문구는 '추가 실패' 일반 키.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { t, type DictKey } from '@/lib/i18n/dict'
import { WBS_ACTION_ERRORS } from '@/lib/wbs/actionErrors'
import { withTeams } from '../fixtures/teams'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const locale = 'ko' as const
const addWbsItem = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn(async () => []),
  updateWbsFields: vi.fn(async () => ({ ok: true })),
  addWbsItem: (...a: unknown[]) => addWbsItem(...(a as [])),
  addSubAct: vi.fn(async () => ({ ok: true })),
  deleteWbsItem: vi.fn(async () => ({ ok: true })),
  moveWbsItem: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn(async () => ({ ok: true, rows: [], download: 'allowed' })),
  recordAttachment: vi.fn(async () => ({ ok: true })),
  removeAttachment: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({}) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale, t: (k: DictKey) => t(locale, k) }),
}))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const phase: ComputedItem = {
  id: 'p1-phase', parentId: null, code: '1', sortOrder: 0, name: 'Phase',
  biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10',
  weight: null, actualPct: 0, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0,
  achievement: null, status: 'not_started', children: [], depth: 0,
}

describe('RowDetailPanel — 하위 항목 추가 실패 문구(사전 매핑)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    addWbsItem.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function addChildFailing(error: string) {
    addWbsItem.mockResolvedValue({ ok: false, error })
    await act(async () =>
      root.render(withTeams(
        <RowDetailPanel levelLabels={['Phase', 'Task', 'Activity']} item={phase} onClose={() => {}} projectId="p1" editable timeZone="UTC" />,
      )),
    )
    const open = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(t(locale, 'wbs.addChild')))!
    await act(async () => open.click())
    const input = container.querySelector<HTMLInputElement>('input.app-input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Task A')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const add = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t(locale, 'common.add'))!
    await act(async () => add.click())
    expect(addWbsItem).toHaveBeenCalledWith('p1', 'p1-phase', 'Task A')
    // 구조 편집 절의 오류 줄(err) — 같은 패널의 다른 절(에이전트 주문 상태 등)의 오류 줄은 보지 않는다
    return [...container.querySelectorAll('p.mt-2.font-medium.text-danger')].map((p) => p.textContent ?? '')
  }

  it('표의 문구(SUB-ACT 형제)는 그 사전 문구로 보인다', async () => {
    const shown = await addChildFailing(WBS_ACTION_ERRORS.subActSibling)
    expect(shown).toEqual([t('ko', 'wbs.err.subActSibling')])
  })

  it('표 밖 문구는 받은 문구를 그리지 않고 추가 실패 일반 문구', async () => {
    const shown = await addChildFailing('표에 없는 서버 문구 — 원문')
    expect(shown).toEqual([t('ko', 'wbs.toastAddFail')])
  })

  it('표의 문구는 사전 문구와 같은 글자다', async () => {
    const shown = await addChildFailing(WBS_ACTION_ERRORS.nameRequired)
    expect(shown).toEqual([WBS_ACTION_ERRORS.nameRequired])
  })
})
