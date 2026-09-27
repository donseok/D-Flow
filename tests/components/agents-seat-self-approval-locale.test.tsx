// @vitest-environment jsdom
// 좌석 결재의 자기 승인 안내(ERR_SELF_APPROVAL_HINT) — 순수 표(seatOps)는 상수를 돌려주고, 그리는 자리에서 사전 문구로 바꾼다.
// 영어 화면에 한국어 상수가 그대로 새지 않는다(최종 리뷰 UI M-1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeSeat } from '../fixtures/seat'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  return { useLocale: () => ({ locale: 'en', t: (k: string) => t('en', k as Parameters<typeof t>[1]) }) }
})

import { registerEn, t } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import { SeatOpsBar } from '@/components/agents/SeatOpsBar'
import { DetailPanel } from '@/components/agents/DetailPanel'
import { ERR_SELF_APPROVAL_HINT } from '@/components/agents/seatOps'

registerEn(EN)
// 서브트리 관리자이지만 자기 담당 리프 — 승인은 잠기고 자기 승인 안내가 뜬다.
const SELF = makeSeat({ state: 'WAIT', phase: 'reported', canManage: true, assigneeMine: true })
const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('자기 승인 안내 — 영어 화면', () => {
  it('SeatOpsBar 의 잠긴 승인 버튼 title 은 영어 사전 문구', () => {
    act(() => root.render(<SeatOpsBar seat={SELF} busy={false} onOp={() => {}} />))
    const approve = host.querySelector('[data-seat-op="approve"]') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toBe(t('en', 'agent.seat.selfApprovalHint'))
    expect(approve.title).not.toBe(ERR_SELF_APPROVAL_HINT)
  })
  it('DetailPanel 의 잠긴 승인 버튼 title 도 같은 문구', () => {
    act(() => root.render(<DetailPanel seat={SELF} nowMs={Date.parse('2026-09-27T00:00:00Z')} {...OPS} />))
    const approve = host.querySelector('[data-panel-op="approve"]') as HTMLButtonElement
    expect(approve.title).toBe(t('en', 'agent.seat.selfApprovalHint'))
  })
})
