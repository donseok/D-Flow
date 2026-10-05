import { TEST_ENTRY_CONTEXT } from '../fixtures/issue-areas'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/p1/issues',
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/components/issues/IssueModals', () => ({
  DeleteIssueModal: () => null,
  IssueDetailModal: ({issue,onEdit}:{issue:Issue|null;onEdit:()=>void}) => issue ? <button onClick={onEdit}>Edit selected issue</button> : null,
  IssueFormModal: ({open,initial}:{open:boolean;initial:Issue|null}) => open ? <div data-issue-form={initial?.id ?? 'new'} /> : null,
}))
vi.mock('@/components/issues/IssueAnalysisModal', () => ({
  IssueAnalysisModal: ({ open, areaFilter }: { open: boolean; areaFilter: string }) => (
    open ? <div data-analysis-mega={areaFilter} /> : null
  ),
}))

import { IssuesView } from '@/components/issues/IssuesView'
import { SEVERITIES, SOURCES } from '../fixtures/vocab'

function issue(id: string, areaId: '00' | '02', title: string): Issue {
  return {
    codeAreaId: null,
    id,
    issueNo: areaId === '00' ? 1 : 2,
    code: `PI-I-${areaId}-01`,
    projectId: 'project-1',
    areaId,

    title,
    body: '본문',
    status: 'open',
    severity: 'medium',
    assigneeMemberIds: [],
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    subProcess: '업무 처리',
    ownerDepartment: 'PI팀',
    relatedSystems: ['ERP'],
    sourceType: 'interview',
    sourceDetail: '현업 인터뷰',
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '테스터',
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
  }
}

describe('IssuesView Mega 필터', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.toast.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('Mega 전체에서는 분석서 모달을 열지 않고 한 가지 선택 경고를 표시한다', async () => {
    await act(async () => {
      root.render(
        <IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="Asia/Seoul"
          projectId="project-1"
          currentUserId="user-1"
          canEdit
          isProjectAdmin={false}
          myMemberIds={[]}
          today="2026-07-31"
          members={[]}
          issues={[issue('issue-00', '00', '기준정보 중복')]} severities={SEVERITIES} sources={SOURCES} />,
      )
    })

    const analysisButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.open'))
    await act(async () => analysisButton?.click())

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'issue.analysis.selectOneArea',
      variant: 'error',
    })
    expect(container.querySelector('[data-analysis-mega]')).toBeNull()
  })

  it('선택 Mega로 목록을 좁히고 같은 범위를 분석서 모달에 전달한다', async () => {
    await act(async () => {
      root.render(
        <IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="Asia/Seoul"
          projectId="project-1"
          currentUserId="user-1"
          canEdit
          isProjectAdmin={false}
          myMemberIds={[]}
          today="2026-07-31"
          members={[]}
          issues={[
            issue('issue-00', '00', '기준정보 중복'),
            issue('issue-02', '02', '주문 승인 지연'),
          ]} severities={SEVERITIES} sources={SOURCES} />,
      )
    })

    const mega = container.querySelector<HTMLSelectElement>(
      'select[aria-label="issue.filter.area"]',
    )
    expect(mega).not.toBeNull()
    expect(mega?.textContent).toContain('00 · 기준관리')
    expect(mega?.textContent).toContain('02 · 영업')
    expect(container.textContent).toContain('issue.col.area')
    expect(container.textContent).toContain('00 · 기준관리')
    expect(container.textContent).toContain('02 · 영업')

    const titleCell = [...container.querySelectorAll('td')]
      .find(cell => cell.textContent === '기준정보 중복')
    expect(titleCell?.className).toContain('whitespace-normal')
    expect(titleCell?.className).toContain('break-words')
    expect(titleCell?.className).not.toContain('whitespace-nowrap')
    expect(container.querySelector('table')?.className).toContain('table-fixed')
    expect(container.querySelectorAll('colgroup col')).toHaveLength(10)
    expect(container.querySelector('table')?.className).toContain('min-w-[')
    expect(container.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto')
    expect(container.textContent).toContain('issue.col.endDate')
    expect(container.textContent).toContain('2026-08-31')
    expect(container.textContent).toContain('2026-07-01') // 시작일자 열 — 2026-08-28 사용자 요청으로 표시
    expect(container.textContent).not.toContain('2026-07-31')
    expect(container.textContent).toContain('테스터')
    const reporterCell = [...container.querySelectorAll('td')]
      .find(cell => cell.textContent === '테스터')
    expect(reporterCell?.className).toContain('break-words')
    expect(reporterCell?.className).not.toContain('overflow-hidden')

    await act(async () => {
      if (!mega) return
      mega.value = '02'
      mega.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('주문 승인 지연')
    expect(container.textContent).not.toContain('기준정보 중복')

    const analysisButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.open'))
    await act(async () => analysisButton?.click())

    expect(container.querySelector('[data-analysis-mega="02"]')).not.toBeNull()
  })
  it('entry context failure retains the list and blocks write affordances', async () => {
    await act(async () => root.render(<IssuesView entryContext={null} entryError="entry unavailable" timeZone="UTC" projectId="project-1" currentUserId="u" canEdit isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]} issues={[issue('i1', '00', 'readable issue')]} severities={SEVERITIES} sources={SOURCES} />))
    expect(container.textContent).toContain('readable issue')
    expect(container.querySelector('[data-status-kind="partial_error"]')?.textContent).toContain('entry unavailable')
    expect(container.textContent).not.toContain('issue.new')
    expect(container.textContent).not.toContain('issue.analysis.open')
  })
  it('내 명단 행 조회 실패면 \'내 담당\' 옆에 사유를 보인다 — 빈 결과로 위장하지 않는다(SP5 B2 — D39)', async () => {
    await act(async () => root.render(<IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="UTC" projectId="project-1" currentUserId="u" canEdit isProjectAdmin={false} myMemberIds={[]} myMemberIdsFailed today="2026-07-31" members={[]} issues={[issue('i1', '00', 'readable issue')]} severities={SEVERITIES} sources={SOURCES} />))
    expect(container.textContent).toContain('issue.filter.mineFailed')
    await act(async () => root.render(<IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="UTC" projectId="project-1" currentUserId="u" canEdit isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]} issues={[issue('i1', '00', 'readable issue')]} severities={SEVERITIES} sources={SOURCES} />))
    expect(container.textContent).not.toContain('issue.filter.mineFailed')
  })

  it('analysis off hides report action and filters out unused inactive areas', async () => {
    const entry = { ...TEST_ENTRY_CONTEXT, rules: { areaRequired: false, analysis: 'off' as const }, areas: TEST_ENTRY_CONTEXT.areas.map(a => ({ ...a, active: a.id !== '02' && a.id !== '03' })) }
    await act(async () => root.render(<IssuesView entryContext={entry} timeZone="UTC" projectId="project-1" currentUserId="u" canEdit isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]} issues={[issue('i1', '02', 'historic area issue')]} severities={SEVERITIES} sources={SOURCES} />))
    expect(container.textContent).not.toContain('issue.analysis.open')
    const options = [...container.querySelectorAll('select[aria-label="issue.filter.area"] option')].map(o => (o as HTMLOptionElement).value)
    expect(options).toContain('02')
    expect(options).not.toContain('03')
  })

  it('renders configured custom columns and filters typed false without hiding historical option labels', async () => {
    const defs = [
      { key: 'approved', label: '검증 여부', description: '', type: 'boolean' as const, active: true, required: false, editable_by: 'member' as const, show_in_list: true, searchable: false, sort: 0 },
      { key: 'result', label: '결과', description: '', type: 'select' as const, active: true, required: false, editable_by: 'member' as const, show_in_list: true, searchable: false, sort: 1,
        options: [{code:'old',label:'이전 결과',active:false,color:'neutral' as const,sort:0}] },
      { key: 'hidden', label: '숨긴 열', description: '', type: 'text' as const, active: true, required: false, editable_by: 'member' as const, show_in_list: false, searchable: false, sort: 2 },
    ]
    await act(async()=>root.render(<IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="Asia/Seoul" projectId="project-1" currentUserId="user-1" canEdit isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]}
      issues={[{...issue('a','00','거짓 행'),custom:{approved:false,result:'old'}},{...issue('b','02','참 행'),custom:{approved:true}}]} severities={SEVERITIES} sources={SOURCES} customFields={defs} />))
    expect([...container.querySelectorAll('th')].map(el=>el.textContent)).toContain('검증 여부')
    expect([...container.querySelectorAll('th')].map(el=>el.textContent)).not.toContain('숨긴 열')
    expect(container.textContent).toContain('이전 결과')
    const choose=async(label:string,value:string)=>act(async()=>{
      const el=container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
      el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))
    })
    await choose('추가 정보 필터','approved'); await choose('검증 여부','false')
    expect(container.textContent).toContain('거짓 행');expect(container.textContent).not.toContain('참 행')
    await choose('추가 정보 필터','');expect(container.textContent).toContain('참 행')
    await choose('추가 정보 필터','result');await choose('결과','old')
    expect(container.textContent).toContain('거짓 행');expect(container.textContent).not.toContain('참 행')
  })

  it('refreshes an open edit by id and never converts a vanished edited row into a create form',async()=>{
    const render=(issues:Issue[])=>act(async()=>root.render(<IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="UTC" projectId="project-1" currentUserId="user-1" canEdit isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]} issues={issues} severities={SEVERITIES} sources={SOURCES} />))
    await render([issue('a','00','Editable')])
    await act(async()=>(container.querySelector('tbody tr') as HTMLElement).click())
    await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Edit selected issue')!.click())
    expect(container.querySelector('[data-issue-form]')?.getAttribute('data-issue-form')).toBe('a')
    await render([]);expect(container.querySelector('[data-issue-form]')).toBeNull()
  })

})
