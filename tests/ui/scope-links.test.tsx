// @vitest-environment jsdom
// 화면 안 링크 — 범위 컨텍스트로 새 형식(D38 ①, 계획 과제 35). SSR 에도 값이 있는 useScope 만 읽어 첫 HTML 의 링크가 맞고, 범위가 없을 때만
// 옛 형식(스텁이 해석 — D5)이다. 서버 컴포넌트(위키 주제)는 페이지가 회의록 기준 경로(minutesBase)를 넘긴다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ push: vi.fn(), fetchMeetingDetail: vi.fn(), fetchMeetingMinutesLite: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }), usePathname: () => '/w/acme/agents' }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/meetings', () => ({ fetchMeetingDetail: h.fetchMeetingDetail, cancelOccurrence: vi.fn(), deleteMeeting: vi.fn() }))
vi.mock('@/app/actions/announcements', () => ({ createAnnouncementFromMeeting: vi.fn() }))
vi.mock('@/app/actions/minutes', async (orig) => ({ ...(await orig<typeof import('@/app/actions/minutes')>()), fetchMeetingMinutesLite: h.fetchMeetingMinutesLite }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => <p data-mblock="0">본문</p> }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { ScopeProvider, type ScopeValue } from '@/components/app/ScopeContext'
import { OfficeNav } from '@/components/agents/OfficeNav'
import { MeetingDetailModal } from '@/components/meetings/MeetingDetailModal'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { WikiChangeList, WikiItemCard } from '@/components/wiki/WikiShared'
import type { WikiItem, WikiSource } from '@/lib/data/wiki'
import type { Minute } from '@/lib/domain/types'

const ACME: ScopeValue = { workspace: { id: 'w', slug: 'acme', name: 'Acme' }, projectId: null }
const NONE: ScopeValue = { workspace: null, projectId: null }

describe('화면 안 링크 — 범위 컨텍스트로 새 형식(D38 ①)', () => {
  it('OfficeNav 의 프로젝트 목록 링크가 /w/<s>/projects, 범위가 없으면 옛 형식', () => {
    const html = renderToStaticMarkup(<ScopeProvider value={ACME}><OfficeNav floors={[]} tone="light" /></ScopeProvider>)
    expect(html).toContain('href="/w/acme/projects"'); expect(html).not.toContain('href="/projects"')
    expect(renderToStaticMarkup(<ScopeProvider value={NONE}><OfficeNav floors={[]} tone="light" /></ScopeProvider>)).toContain('href="/projects"')
  })

  it('위키 변경 타임라인의 회의록 링크는 페이지가 넘긴 기준 경로로(서버 컴포넌트) — 없으면 영구 링크 형식', () => {
    const change = {
      id: 'c1', projectId: 'p', wikiItemId: 'i', minuteId: 'minute-1', minuteVersionId: 'v-2', changeType: 'new',
      beforeSnapshot: null, afterSnapshot: { statement: 's' }, reason: null, createdAt: '2026-07-25T01:00:00.000Z', minuteTitle: 't', minuteDate: '2026-07-25',
    } as const
    expect(renderToStaticMarkup(<WikiChangeList locale="ko" changes={[change]} minutesBase="/w/acme/minutes" />)).toContain('href="/w/acme/minutes/minute-1?version=v-2"')
    expect(renderToStaticMarkup(<WikiChangeList locale="ko" changes={[change]} />)).toContain('href="/minutes/minute-1?version=v-2"')
  })

  // U2b-5 리뷰 수정 CC6 — 위키 근거 링크(WikiItemCard → WikiSourceLinks)도 기준 경로를 따른다. 블록 앵커가 있으면 원문 블록 링크, 없으면 회의록(판) 링크
  it('위키 근거 링크는 페이지가 넘긴 기준 경로로 — 블록 앵커·판 링크 둘 다, 없으면 영구 링크 형식', () => {
    const src = (o: Partial<WikiSource>): WikiSource => ({
      id: 's', wikiItemId: 'i', minuteId: 'minute-1', minuteVersionId: 'v-2', bodyHash: null, blockIndex: null, blockHash: null,
      evidenceExcerpt: null, relation: 'supports', createdAt: null, minuteTitle: '근거 회의', minuteDate: '2026-07-25', ...o,
    } as WikiSource)
    const item = {
      id: 'i', projectId: 'p', topicId: 't', kind: 'fact', statement: '사실', lifecycleState: 'active', certainty: 'explicit',
      decisionState: null, ownerTeam: null, ownerMemberId: null, dueDate: null, observedAt: null, validFrom: null, validTo: null,
      origin: 'ai', autoUpdateLocked: false, reviewState: 'accepted', structuredData: {}, createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
      sources: [
        src({ id: 's1', bodyHash: '0123456789abcdef', blockIndex: 2, blockHash: 'fedcba9876543210' }),
        src({ id: 's2', minuteId: 'minute-2', minuteVersionId: null }),
      ],
    } as unknown as WikiItem
    const scoped = renderToStaticMarkup(<WikiItemCard item={item} locale="ko" showEvidence minutesBase="/w/acme/minutes" />)
    expect(scoped).toContain('href="/w/acme/minutes/minute-1?block=2&amp;hash=fedcba9876543210&amp;body=0123456789abcdef&amp;version=v-2"')
    expect(scoped).toContain('href="/w/acme/minutes/minute-2"')
    expect(scoped).not.toMatch(/href="\/minutes\//)
    const fallback = renderToStaticMarkup(<WikiItemCard item={item} locale="ko" showEvidence />)
    expect(fallback).toContain('href="/minutes/minute-2"')
  })
})

describe('화면 안 링크 — 클라이언트(jsdom)', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    h.push.mockClear()
    h.fetchMeetingDetail.mockResolvedValue(null)
    h.fetchMeetingMinutesLite.mockResolvedValue([{ id: 'mn-1', title: '연결 회의록', minuteDate: '2026-09-01' }])
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('MeetingDetailModal 의 연결 회의록 링크가 /w/<s>/minutes/<id>', async () => {
    const occ = { occurrenceId: 's:2026-09-01', seriesId: 's', occurrenceDate: '2026-09-01', projectId: 'p', title: '주간', startTime: null, endTime: null, location: null, category: 'general', isRecurring: false, attendeeCount: 0 } as const
    await act(async () => {
      root.render(<ScopeProvider value={ACME}><MeetingDetailModal open occurrence={occ} currentUserId="u1" isAdmin={false} onClose={() => {}} onEditSeries={() => {}} onChanged={() => {}} /></ScopeProvider>)
      await new Promise((r) => setTimeout(r, 0))
    })
    const hrefs = [...document.body.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/w/acme/minutes/mn-1')
    expect(hrefs).not.toContain('/minutes/mn-1')
  })

  it('MinuteViewer 의 회의록 목록 돌아가기가 /w/<s>/minutes', () => {
    const minute: Minute = { id: 'm1', minuteDate: '2026-07-16', teamCode: 'PMO', title: '주간회의', bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: '작성자', createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z' }
    act(() => root.render(
      <ScopeProvider value={ACME}>
        <MinuteViewer minute={minute} files={[]} canManage={false} annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]} initialFontSize={null} />
      </ScopeProvider>,
    ))
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/w/acme/minutes')
    expect(hrefs).not.toContain('/minutes')
  })
})
