// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRunHubProcessOp = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({
  runHubProcessOp: (...args: unknown[]) => mockRunHubProcessOp(...args),
}))

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    t: (k: string) => {
      if (k === 'agent.queue.step') return '승인 {i}/{n} · {label}'
      return k
    },
  }),
}))

import { ApprovalQueue } from '@/components/agent-hub/ApprovalQueue'
import type { HubQueueEntry } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ApprovalQueue 승인 검토 화면 (개정 §5.9.1, D6-§2-approval, Q09)', () => {
  const sampleEntry: HubQueueEntry = {
    orderId: 'order-1',
    itemId: 'item-100',
    reportId: 'rep-100',
    code: '1.1.2',
    name: '화면 설계 작업',
    agent: 'AI-Coder',
    percent: 100,
    reportedAt: '2026-10-05T12:00:00Z',
    summary: '설계서 초안 작성 완료',
    links: [],
    canApprove: true,
    canManage: true,
    assigneeMine: false,
    approval: {
      step: 'review_1',
      index: 1,
      total: 2,
      label: '1차 검토',
    },
  }

  it('승인 대기 항목의 단계 정보 및 시각이 시간대 규칙에 맞게 렌더링된다', async () => {
    await act(async () => {
      root.render(
        <ApprovalQueue
          queue={[sampleEntry]}
          projectId="proj-1"
          isAdmin={true}
          onHub={() => {}}
          onChanged={() => {}}
          timeZone="UTC"
        />
      )
    })

    const card = document.querySelector('[data-queue-card="order-1"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('1.1.2')
    expect(card?.textContent).toContain('화면 설계 작업')
    expect(card?.textContent).toContain('승인 1/2 · 1차 검토')
  })

  it('승인 클릭 시 expectedReportId 및 expectedStep을 동봉하여 runHubProcessOp를 호출한다', async () => {
    mockRunHubProcessOp.mockResolvedValue({ ok: true, hub: {} })

    await act(async () => {
      root.render(
        <ApprovalQueue
          queue={[sampleEntry]}
          projectId="proj-1"
          isAdmin={true}
          onHub={() => {}}
          onChanged={() => {}}
          timeZone="UTC"
        />
      )
    })

    const approveBtn = document.querySelector('[data-queue-approve]') as HTMLButtonElement
    expect(approveBtn).not.toBeNull()

    await act(async () => {
      approveBtn.click()
    })

    expect(mockRunHubProcessOp).toHaveBeenCalledWith('proj-1', {
      kind: 'approve',
      orderId: 'order-1',
      expectedReportId: 'rep-100',
      expectedStep: 'review_1',
    })
  })

  it('검토 중 타인 처리 또는 재보고로 stale 응답이 오면 최신 현황(onChanged)을 호출하고 에러를 표시한다 (Q09)', async () => {
    const handleChanged = vi.fn()
    mockRunHubProcessOp.mockResolvedValue({
      ok: false,
      stale: true,
      error: '이미 다른 사용자가 처리했거나 새로운 보고가 올라왔습니다.',
    })

    await act(async () => {
      root.render(
        <ApprovalQueue
          queue={[sampleEntry]}
          projectId="proj-1"
          isAdmin={true}
          onHub={() => {}}
          onChanged={handleChanged}
          timeZone="UTC"
        />
      )
    })

    const approveBtn = document.querySelector('[data-queue-approve]') as HTMLButtonElement

    await act(async () => {
      approveBtn.click()
    })

    expect(handleChanged).toHaveBeenCalled()
    const errorMsg = document.querySelector('[data-queue-error]')
    expect(errorMsg?.textContent).toContain('이미 다른 사용자가 처리했거나')
  })
})
