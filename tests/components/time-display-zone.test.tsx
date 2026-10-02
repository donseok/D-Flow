// @vitest-environment jsdom
// 시각 표시는 유효 tz·locale 인자를 따르고 서울 고정이 없다(스펙 D60·§7 A — W21 ①, 개정 §5.12.5 SP5 ①).
// 같은 instant 가 LA·서울 프로젝트에서 다른 날짜로 보이고, timeZone 은 필수 prop 이다(빠뜨리면 타입 오류 — K7).
// [RF1] date-only 값('YYYY-MM-DD')은 어느 브라우저 tz 에서도 같은 날짜·요일로 보인다(K15) — DayPopover.
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/' }))
vi.mock('@/app/actions/agentHub', () => ({ runHubProcessOp: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn() }))
vi.mock('@/app/actions/authzEvents', () => ({ listAuthzEvents: vi.fn() }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ApprovalQueue } from '@/components/agent-hub/ApprovalQueue'
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
import { formatWikiDate } from '@/components/wiki/WikiShared'
import { DayPopover } from '@/components/ui/DayPopover'
import { ChangeHistoryList } from '@/components/wbs/ChangeHistoryList'
import { MinuteVersionPanel } from '@/components/minutes/MinuteVersionPanel'
import type { HubQueueEntry } from '@/lib/domain/agentHub'

// 2026-10-03T23:30:00Z = 서울 10-04 08:30 / LA 10-03 16:30
const AT = '2026-10-03T23:30:00.000Z'
let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = (node: ReactNode) => act(() => root.render(<LocaleProvider initialLocale="ko">{node}</LocaleProvider>))

describe('승인 큐 — 보고 시각이 프로젝트 tz 를 따른다', () => {
  const q: HubQueueEntry = {
    orderId: 'o1', itemId: 'i1', code: 'T-1', name: '빌드', agent: 'alice', percent: 50, summary: '', links: [],
    reportedAt: AT, reportId: 'r1', assigneeMine: false, canManage: false, canApprove: false,
  }
  it('서울 10. 4. / LA 10. 3.', () => {
    render(<ApprovalQueue queue={[q]} projectId="p1" isAdmin={false} onHub={() => {}} onChanged={() => {}} timeZone="Asia/Seoul" />)
    expect(host.textContent).toMatch(/2026\. 10\. 4\./)
    render(<ApprovalQueue queue={[q]} projectId="p1" isAdmin={false} onHub={() => {}} onChanged={() => {}} timeZone="America/Los_Angeles" />)
    expect(host.textContent).toMatch(/2026\. 10\. 3\./)
  })
  it('locale 인자 — en-US 면 영어 꼴', () => {
    render(<ApprovalQueue queue={[q]} projectId="p1" isAdmin={false} onHub={() => {}} onChanged={() => {}} timeZone="America/Los_Angeles" locale="en-US" />)
    expect(host.textContent).toContain('10/3/2026')
  })
})

describe('설정 이력 — stampIn(tz)', () => {
  const row = {
    id: 3, revision: 3, key: 'calendar.timezone', oldValue: null, newValue: 'UTC', source: 'edit' as const,
    commandId: null, changedBy: null, changedByName: '시스템', changedAt: AT, copiedFrom: null,
  }
  it('같은 instant 가 서울 10-04 08:30, LA 10-03 16:30', () => {
    render(<SettingsHistoryList scope={{ projectId: 'p1' }} initial={{ ok: true, rows: [row as never], nextBefore: null }} timeZone="Asia/Seoul" />)
    expect(host.textContent).toContain('2026-10-04 08:30')
    render(<SettingsHistoryList scope={{ projectId: 'p1' }} initial={{ ok: true, rows: [row as never], nextBefore: null }} timeZone="America/Los_Angeles" />)
    expect(host.textContent).toContain('2026-10-03 16:30')
  })
})

describe('위키 날짜 — instant 는 tz, date-only 는 변환하지 않는다(D-21d)', () => {
  it('instant', () => {
    expect(formatWikiDate(AT, 'ko', false, 'Asia/Seoul')).toContain('4')
    expect(formatWikiDate(AT, 'ko', false, 'America/Los_Angeles')).toContain('3')
    expect(formatWikiDate(AT, 'ko', false, 'Asia/Seoul')).not.toBe(formatWikiDate(AT, 'ko', false, 'America/Los_Angeles'))
  })
  it('date-only 는 tz 와 무관', () => {
    expect(formatWikiDate('2026-10-04', 'ko', false, 'America/Los_Angeles')).toBe(formatWikiDate('2026-10-04', 'ko', false, 'Asia/Seoul'))
  })
})

describe('timeZone 은 필수 prop — 빠뜨리면 타입 오류(K7)', () => {
  it('타입 단언(이 블록은 typecheck 가 본다)', () => {
    // @ts-expect-error timeZone 이 없다
    const a = <ApprovalQueue queue={[]} projectId="p1" isAdmin={false} onHub={() => {}} onChanged={() => {}} />
    // @ts-expect-error timeZone 이 없다
    const b = <SettingsHistoryList scope={{ projectId: 'p1' }} initial={{ ok: true, rows: [], nextBefore: null }} />
    // @ts-expect-error 넷째 인자(timeZone)가 없다
    formatWikiDate(AT, 'ko', false)
    expect([a, b]).toHaveLength(2)
  })
})

describe('[RF1] DayPopover — date-only 의 요일은 브라우저 tz 와 무관하다', () => {
  const ORIGINAL_TZ = process.env.TZ
  afterEach(() => {
    // TZ 가 원래 없었으면 지운다 — undefined 를 대입하면 문자열 'undefined' 가 박힌다
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })
  for (const tz of ['America/Los_Angeles', 'Asia/Seoul', 'Pacific/Kiritimati']) {
    it(`브라우저 tz ${tz} 에서 2026-10-04 는 일요일`, () => {
      process.env.TZ = tz          // Node 는 실행 중 TZ 대입을 반영한다 — 반영되지 않는 환경이어도 아래 단언은 isoDowOf(순수)라 같은 값이다
      render(<DayPopover anchor={{ date: '2026-10-04', rect: { top: 0, bottom: 10, left: 0 } }} count={2} onClose={() => {}}>x</DayPopover>)
      expect(host.textContent).toContain('26.10.04')
      expect(host.textContent).toMatch(/\(일\)/)
    })
  }
})

describe('A-4 리뷰 N7 — 브라우저 tz 로 찍던 표시 넷이 서버 tz 를 따른다', () => {
  it('WBS 변경 이력 — 서울 2026.10.04 08:30 / LA 2026.10.03 16:30', () => {
    const log = { id: 'l1', field: 'name', oldValue: 'a', newValue: 'b', at: AT, actorTeam: null, actorRole: null } as never
    render(<ChangeHistoryList logs={[log]} timeZone="Asia/Seoul" />)
    expect(host.textContent).toContain('2026.10.04 08:30')
    render(<ChangeHistoryList logs={[log]} timeZone="America/Los_Angeles" />)
    expect(host.textContent).toContain('2026.10.03 16:30')
  })
  it('회의록 버전 — LA 면 10월 3일, 범위 달력을 못 읽으면(null) 시각 대신 —', () => {
    const v = { id: 'v1', versionNo: 1, createdAt: AT, createdByName: 'alice', fileName: 'a.md', title: null, bodyHash: 'h' } as never
    const expand = () => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('펼치기'))?.click() })
    render(<MinuteVersionPanel versions={[v]} currentVersionNo={1} timeZone="America/Los_Angeles" />)
    expand()
    expect(host.textContent).toMatch(/10월 3일/)
    act(() => root.unmount()); root = createRoot(host)
    render(<MinuteVersionPanel versions={[v]} currentVersionNo={1} timeZone={null} />)
    expand()
    expect(host.textContent).not.toMatch(/10월 [34]일/)
    expect(host.textContent).toContain('—')
  })
})
