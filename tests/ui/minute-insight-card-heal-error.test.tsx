// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 요약 self-heal 이 조회 실패로 끝나면 서버가 실어 보낸 사유를 보인다 — 일반 '만들지 못했습니다' 로 뭉개지 않는다(3원칙 ①).
const mocks = vi.hoisted(() => ({ ensure: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/minutes', () => ({ ensureMinuteInsightsAction: mocks.ensure }))

import { MinuteInsightCard } from '@/components/minutes/MinuteInsightCard'

const BLOCKS = [{ index: 0, hash: 'h0', text: '결정 사항', kind: 'p', rendered: true }] as never

describe('MinuteInsightCard — self-heal 실패 사유', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    mocks.ensure.mockReset()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mountAndOpen() {
    await act(async () => root.render(
      <MinuteInsightCard minuteId="m1" insights={[]} highlights={[]} blocks={BLOCKS} bodyHash="b1" onJump={() => {}} />,
    ))
    const expand = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('min.insight.expand'))!
    await act(async () => expand.click())
  }

  it('서버가 조회 실패 사유를 주면 그 문구를 보인다', async () => {
    mocks.ensure.mockResolvedValue({ status: 'unavailable', error: '회의록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' })
    await mountAndOpen()
    expect(container.textContent).toContain('회의록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(container.textContent).not.toContain('min.insight.unavailable')
  })

  it('사유가 없으면(자격 없음·생성 실패) 종전 일반 문구', async () => {
    mocks.ensure.mockResolvedValue({ status: 'unavailable' })
    await mountAndOpen()
    expect(container.textContent).toContain('min.insight.unavailable')
  })
})
