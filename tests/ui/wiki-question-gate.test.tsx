// 위키 주제 상세의 '질문으로 남기기'는 답변 폼과 같은 조건으로만 보인다 — 구성원(canEditDocuments)이고 확장 스키마가 준비됐을 때.
// 위키는 RLS 쓰기 정책이 없어 서버 액션 가드가 관문이고(createWikiQuestion — requireProjectMember), 화면은 그 어포던스만 가린다.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WikiTopicDetailData, WikiTopicSummary } from '@/lib/data/wiki'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/project-1/wiki/topics/topic-1',
}))

import { WikiTopicDetail } from '@/components/wiki/WikiTopicDetail'

const topic: WikiTopicSummary = {
  id: 'topic-1', projectId: 'project-1', title: '연계 방식', normalizedTitle: '연계-방식', type: 'interface', ownerTeam: null,
  bodyMd: null, bodyUpdatedAt: null, bodyUpdatedBy: null, parentId: null, sort: 0, pinnedOrder: null, origin: 'ai', documentKind: null,
  verifiedAt: null, verifiedBy: null, reviewDueAt: null, lastChangedAt: '2026-07-25T00:00:00.000Z',
  createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
  itemCount: 0, activeDecisionCount: 0, openItemCount: 0, conflictCount: 0,
}
const data = (readState: WikiTopicDetailData['readState']): WikiTopicDetailData => ({
  available: true, readState, automationState: 'active', topic, items: [], proposals: [], revisions: [], questions: [],
  changes: [], changesTruncated: false, dataTruncated: false,
})
const html = (props: { canEditDocuments: boolean; readState?: WikiTopicDetailData['readState'] }) => renderToStaticMarkup(
  <WikiTopicDetail draftPolicy={{ allowed: true, retention_days: 7 }} projectId="project-1" data={data(props.readState ?? 'ready')}
    locale="ko" canCurate={false} canEditDocuments={props.canEditDocuments} userId={null} timeZone="Asia/Seoul" />,
)

describe('위키 주제 — 질문 남기기 어포던스', () => {
  it('구성원에게는 열린 질문이 0건이어도 보인다', () => {
    expect(html({ canEditDocuments: true })).toContain('질문으로 남기기')
  })
  it('조회 전용에게는 보이지 않는다', () => {
    expect(html({ canEditDocuments: false })).not.toContain('질문으로 남기기')
  })
  it('확장 스키마가 준비되지 않았으면 보이지 않는다', () => {
    expect(html({ canEditDocuments: true, readState: 'schema_missing' })).not.toContain('질문으로 남기기')
  })
})
