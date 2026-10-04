'use client'
// 이슈 목록 — 필터(상태·심각도·내담당) + 테이블 + ?focus= 딥링크. (KPI 3장은 사용자 요청으로 제거)
// 테이블 골격은 MeetingsView(가로 스크롤 + 행 키보드 패턴), 모달·focus 소비는 AnnouncementsView 복제.
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, CircleAlert, Paperclip, Plus, Presentation } from 'lucide-react'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { DeleteIssueModal, IssueDetailModal, IssueFormModal } from './IssueModals'
import { IssueAnalysisModal } from './IssueAnalysisModal'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import {
  type IssueAreaFilter,
} from '@/lib/domain/issueAnalysis'
import {
  ISSUE_STATUSES,
  canEditIssue, dueDaysLeft, filterIssues, isDueUrgent, isOverdue, sortIssues,
  type Issue, type IssueSeverityFilter, type IssueStatusFilter,
} from '@/lib/domain/issues'
import { areaLabel } from '@/lib/domain/issueAreas'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { IssueEntryContext } from '@/lib/issues/context'
import { activeVocab, orderedVocab, vocabLabel, vocabView, DEFAULT_ISSUE_STATUSES, type IssueStatusDef, type SeverityDef, type SourceDef } from '@/lib/settings/vocab'
import { IssueStatusPill } from '@/components/ui/StatusPill'
import type { ProjectMember } from '@/lib/domain/types'

/** 페이지당 행 수 선택지 — 'all' 은 페이징 없이 전량. 기본은 20(사용자 요청). */
const PAGE_SIZES = [10, 20, 30, 'all'] as const
type PageSize = (typeof PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: PageSize = 20

export function IssuesView({
  issues, members, projectId, workspaceId = null, currentUserId, canEdit, isProjectAdmin, myMemberIds, myMemberIdsFailed = false, today, timeZone, entryContext, entryError, severities, sources, statuses,
}: {
  entryContext: IssueEntryContext | null
  entryError?: string
  issues: Issue[]
  members: ProjectMember[]
  projectId: string
  /** 이 프로젝트의 워크스페이스(서버의 actor.projectWorkspace) — 첨부 저장 경로 scope. null 이면 첨부 업로드를 막는다. */
  workspaceId?: string | null
  currentUserId: string | null
  /** 이 프로젝트 멤버 이상(isProjectMember) — 등록 어포던스. 조회 전용은 false. */
  canEdit: boolean
  /** 프로젝트 관리자 이상(isProjectAdmin) — 남의 이슈 전체 편집·삭제. */
  isProjectAdmin: boolean
  myMemberIds: string[]
  /** 내 명단 행 조회가 실패했다 — '내 담당' 필터가 비어 보이는 이유를 표시한다(빈 결과로 위장하지 않는다) */
  myMemberIdsFailed?: boolean
  today: string
  /** 시각 표시의 시간대(프로젝트 calendar.timezone — 계획 P8) */
  timeZone: string
  /** 이 프로젝트의 심각도·출처(설정 어휘, SP5 B4) — 칩·정렬·필터·상세 라벨 */
  severities: readonly SeverityDef[]
  sources: readonly SourceDef[]
  /** 이 프로젝트의 표시 상태(SP5b — 설정 workflow.issue_statuses). 없으면 제품 기본 4정의 */
  statuses?: readonly IssueStatusDef[]
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const areas = entryContext?.areas ?? []
  const analysisVisible = !!entryContext && entryContext.rules.analysis !== 'off'
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>('all')
  // 필터 두 층(SP5b §5): 범주 4탭(제품 고정) + 표시 상태 드롭다운(설정 — 한 범주에 상태가 둘 이상인 프로젝트에서만 보인다)
  const [statusCodeFilter, setStatusCodeFilter] = useState<string>('all')
  const statusDefs = statuses ?? DEFAULT_ISSUE_STATUSES
  const showCodeFilter = new Set(statusDefs.map(d => d.category)).size < statusDefs.length
  const [severityFilter, setSeverityFilter] = useState<IssueSeverityFilter>('all')
  const [areaFilter, setAreaFilter] = useState<IssueAreaFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  // 페이징 — 필터를 바꾸면 1페이지로 돌아간다(안 그러면 결과가 줄었을 때 빈 페이지가 보인다).
  // 목록 자체가 줄어드는 경우(삭제·refresh)는 렌더 시점 clamp 로 잡는다.
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)
  // 딥링크 ?focus= — 최초 마운트에서 해당 이슈 상세를 연다. 무효 id 는 조용히 무시(공지·회의 관례).
  // viewing 은 id 만 상태로 갖고 issues 에서 파생한다 — conflict 후 router.refresh() 로 issues 가 새
  // 참조로 갱신되면 모달도 자동으로 최신값을 반영한다(객체 state 로 들고 있으면 refresh 가 못 미친다).
  const [viewingId, setViewingId] = useState<string | null>(() => searchParams.get('focus'))
  // 알림 클릭은 같은 라우트 소프트 내비게이션이라(HeaderChrome.tsx router.push) 위 useState
  // 초기화 함수가 다시 돌지 않는다 — 하필 이슈 화면에 머무는 사람이 조치 경과 알림의 주
  // 수신자라 마운트 이후 focus 변화도 여기서 잡아 모달을 연다.
  const focusParam = searchParams.get('focus')
  // 마지막으로 소비한 focus 값. 없으면 모달을 닫아도 같은 파라미터를 보고 곧바로 다시 열려
  // 무한 재오픈이 된다.
  const consumedFocus = useRef<string | null>(focusParam)
  // 반드시 추출한 원시값(focusParam)을 deps 에 둔다 — searchParams 자체를 넣지 않는다.
  // 실제 Next.js 의 useSearchParams() 는 재렌더마다 새 ReadonlyURLSearchParams 인스턴스를
  // 준다. 객체를 deps 에 두면 이 이펙트가 부모 재렌더마다(이슈 저장 후의 router.refresh()
  // 포함) 다시 돌게 되고, 그 순간부터 위 재오픈 가드가 닫힌 모달을 닫힌 채로 두는 유일한
  // 장치가 된다. 이 줄을 바꾸려면 그 결과를 먼저 이해할 것.
  useEffect(() => {
    if (focusParam === null) { consumedFocus.current = null; return }
    if (consumedFocus.current === focusParam) return
    consumedFocus.current = focusParam
    setViewingId(focusParam)
  }, [focusParam])
  const viewing = useMemo(
    () => (viewingId ? issues.find(i => i.id === viewingId) ?? null : null),
    [issues, viewingId],
  )
  const [formOpen, setFormOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [editing, setEditing] = useState<Issue | null>(null)
  const [deleting, setDeleting] = useState<Issue | null>(null)

  const myIds = useMemo(() => new Set(myMemberIds), [myMemberIds])
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.name])), [members])
  const memberName = (id: string | null) => (id ? memberNameById.get(id) ?? null : null)

  /** 테이블 셀용 담당자 표기 — 가나다순, 2명까지 이름·나머지는 개수. 없으면 null(셀이 '담당 없음' 폴백). */
  function assigneeLabel(issue: Issue): string | null {
    if (issue.assigneeMemberIds.length === 0) return null
    const names = sortByKoreanName(issue.assigneeMemberIds.map(id => memberNameById.get(id) ?? '—'), n => n)
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} ${t('issue.assigneeMore').replace('{n}', String(names.length - 2))}`
  }

  const visible = useMemo(
    () => sortIssues(filterIssues(issues, {
      status: statusFilter,
      severity: severityFilter,
      area: areaFilter,
      mineOnly,
      myMemberIds: myIds,
    }).filter(i => statusCodeFilter === 'all' || (i.statusCode ?? i.status) === statusCodeFilter), today, severities),
    [issues, statusFilter, statusCodeFilter, severityFilter, areaFilter, mineOnly, myIds, today, severities],
  )

  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize
  const paged = useMemo(
    () => (pageSize === 'all' ? visible : visible.slice(pageStart, pageStart + pageSize)),
    [visible, pageSize, pageStart],
  )

  const statusTabs = [
    { key: 'all' as const, label: t('issue.filter.all') },
    ...ISSUE_STATUSES.map(s => ({ key: s, label: t(`issue.status.${s}`) })),
  ]
  const severityTabs = [
    { key: 'all' as const, label: t('issue.filter.all') },
    ...activeVocab(severities).map(s => ({ key: s.code, label: vocabView('issues.severities', severities, s.code, t).label })),
  ]

  function openWrite() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(issue: Issue) {
    setViewingId(null)
    setEditing(issue)
    setFormOpen(true)
  }
  function openAnalysis() {
    if (areaFilter === 'all') {
      toast({ title: t('issue.analysis.selectOneArea'), variant: 'error' })
      return
    }
    setAnalysisOpen(true)
  }

  const filtered = statusFilter !== 'all'
    || statusCodeFilter !== 'all'
    || severityFilter !== 'all'
    || areaFilter !== 'all'
    || mineOnly
  // 조회 전용에게는 등록 어포던스를 숨긴다 — 서버 createIssue 는 requireProjectMember(스펙 §6.3).
  // 이슈별 전체 편집(canEditIssue — 작성자 또는 관리자)과는 다른 축이다.
  const canWrite = canEdit && !!entryContext

  return (
    <div className="space-y-4">
      {/* 툴바: 필터 + 등록 */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs
          tabs={statusTabs}
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1) }}
          size="sm"
        />
        {showCodeFilter && (
          <select
            aria-label={t('issue.col.status')}
            value={statusCodeFilter}
            onChange={event => { setStatusCodeFilter(event.target.value); setPage(1) }}
            className="app-input h-9 w-full min-w-[140px] text-xs sm:w-auto"
          >
            <option value="all">{t('issue.status.codeFilterAll')}</option>
            {orderedVocab(statusDefs).filter(d => statusFilter === 'all' || d.category === statusFilter).map(d => (
              <option key={d.code} value={d.code}>{vocabLabel('workflow.issue_statuses', statusDefs, d.code, t)}</option>
            ))}
          </select>
        )}
        <SegmentedTabs
          tabs={severityTabs}
          value={severityFilter}
          onChange={v => { setSeverityFilter(v); setPage(1) }}
          size="sm"
        />
        <select
          aria-label={t('issue.filter.area')}
          value={areaFilter}
          onChange={event => { setAreaFilter(event.target.value as IssueAreaFilter); setPage(1) }}
          className="app-input h-9 w-full min-w-[180px] text-xs sm:w-auto"
        >
          <option value="all">{t('issue.filter.areaAll')}</option>
          {areas.filter(area => area.active || issues.some(i => i.areaId === area.id)).map(area => (
            <option key={area.id} value={area.id}>
              {area.code} · {area.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => { setMineOnly(v => !v); setPage(1) }}
          aria-pressed={mineOnly}
          className={`chip cursor-pointer border transition ${mineOnly ? 'border-brand bg-brand-weak text-brand' : 'border-line bg-surface text-ink-muted hover:text-ink'}`}
        >
          {t('issue.filter.mine')}
        </button>
        {myMemberIdsFailed && <StatusMessage compact kind="partial_error" title={t('issue.filter.mineFailed')} />}
        {canEdit && entryError && <StatusMessage compact kind="partial_error" title={entryError} />}
        {canWrite && (
          <div className="ml-auto flex items-center gap-2">
            {analysisVisible && <button
              type="button"
              onClick={openAnalysis}
              className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
            >
              <Presentation className="h-3.5 w-3.5" />
              {t('issue.analysis.open')}
            </button>}
            <button onClick={openWrite} className="btn btn-primary inline-flex items-center gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />{t('issue.new')}
            </button>
          </div>
        )}
      </div>

      {/* 테이블 (MeetingsView 골격) */}
      {visible.length > 0 ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full table-fixed border-collapse text-[13px]">
              {/* 10열 폭 합 100 — 열을 더하거나 뺄 때 합이 어긋나면 table-fixed 가 조용히 뭉갠다. */}
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
              </colgroup>
              <thead>
                <tr className="whitespace-nowrap border-b border-line bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
                  <th className="px-2.5 py-2.5">{t('issue.col.no')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.area')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.title')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.status')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.severity')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.assignee')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.startDate')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.endDate')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.daysLeft')}</th>
                  <th className="px-2.5 py-2.5">{t('issue.col.created')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(issue => {
                  const overdue = isOverdue(issue, today)
                  // 남은일수(2026-08-28) — 오늘→종료일자 달력일. 7일 이내·경과는 빨강, 해결·기한 없음은 —.
                  const daysLeft = dueDaysLeft(issue, today)
                  const ddayText = daysLeft === null ? '—'
                    : daysLeft >= 0 ? t('issue.dday.left').replace('{n}', String(daysLeft))
                    : t('issue.dday.over').replace('{n}', String(-daysLeft))
                  const megaArea = areas.find(area => area.id === issue.areaId)
                  const assignees = assigneeLabel(issue) ?? t('issue.unassigned')
                  return (
                    <tr
                      key={issue.id}
                      onClick={() => setViewingId(issue.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setViewingId(issue.id) }}
                      className="cursor-pointer border-b border-line/70 transition last:border-0 hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
                    >
                      <td className="whitespace-normal break-all px-2.5 py-2.5 tabular-nums">
                        <span className="font-semibold text-ink">{issue.code}</span>
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-2.5 py-2.5">
                        {megaArea ? (
                          <span
                            className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-brand-ring bg-brand-weak px-2 py-1 text-[11px] font-semibold text-brand"
                            title={`${megaArea.code} · ${megaArea.name}`}
                          >
                            {megaArea.code} · {megaArea.name}
                          </span>
                        ) : (
                          <span className="text-ink-subtle">{areaLabel(undefined, issue.areaId)}</span>
                        )}
                      </td>
                      <td className="whitespace-normal break-words px-2.5 py-2.5 font-medium leading-5 text-ink" title={issue.title}>
                        {issue.title}
                        {/* 첨부 배지는 제목 셀 안에 둔다(열 추가는 colgroup 폭 재배분이 따른다 — 위 주석).
                            셀에 이미 title 이 걸려 있어 배지에 자체 title 을 준다.
                            표시 토글은 JSX 조건부 렌더로 한다. 상태 변형 display 유틸은 globals.css 끝의
                            unlayered 안전망에 져서 조용히 동작하지 않는다(breakpoint-safety-net 테스트가 검사). */}
                        {(issue.attachmentCount ?? 0) > 0 && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[11px] font-normal text-ink-subtle"
                            title={t('issue.attach.count').replace('{n}', String(issue.attachmentCount))}
                            aria-label={t('issue.attach.count').replace('{n}', String(issue.attachmentCount))}
                          >
                            <Paperclip className="h-3 w-3" aria-hidden />
                            {issue.attachmentCount}
                          </span>
                        )}
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-2.5 py-2.5">
                        <IssueStatusPill category={issue.status} code={issue.statusCode} defs={statusDefs} />
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-2.5 py-2.5">
                        <span className={`chip px-2 py-0.5 text-[11px] ${vocabView('issues.severities', severities, issue.severity, t).chip}`}>{vocabView('issues.severities', severities, issue.severity, t).label}</span>
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-2.5 py-2.5 text-ink-muted" title={assignees}>
                        <span className="block truncate">{assignees}</span>
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-2.5 py-2.5 tabular-nums text-ink-muted">
                        {issue.startDate ?? '—'}
                      </td>
                      <td className={`overflow-hidden whitespace-nowrap px-2.5 py-2.5 tabular-nums ${overdue ? 'font-semibold text-delayed' : 'text-ink-muted'}`}>
                        {issue.dueDate ?? '—'}
                      </td>
                      <td className={`overflow-hidden whitespace-nowrap px-2.5 py-2.5 tabular-nums ${isDueUrgent(daysLeft) ? 'font-semibold text-delayed' : 'text-ink-muted'}`}>
                        {ddayText}
                      </td>
                      <td className="whitespace-normal break-words px-2.5 py-2.5 text-ink-muted">
                        {issue.createdByName ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* 페이징 바 — 페이지당 행 수 + 범위 + 이전/다음.
              상태 변형 display 유틸은 쓰지 않는다(globals.css unlayered 안전망에 진다). */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface-2 px-2.5 py-2 text-xs text-ink-muted">
            <label className="flex items-center gap-1.5">
              <span>{t('issue.page.size')}</span>
              <select
                aria-label={t('issue.page.size')}
                value={String(pageSize)}
                onChange={event => {
                  const raw = event.target.value
                  setPageSize(raw === 'all' ? 'all' : (Number(raw) as PageSize))
                  setPage(1)
                }}
                className="app-input h-8 w-auto text-xs"
              >
                {PAGE_SIZES.map(size => (
                  <option key={String(size)} value={String(size)}>
                    {size === 'all' ? t('issue.page.all') : size}
                  </option>
                ))}
              </select>
            </label>
            <span className="tabular-nums">
              {t('issue.page.range')
                .replace('{from}', String(visible.length === 0 ? 0 : pageStart + 1))
                .replace('{to}', String(pageStart + paged.length))
                .replace('{total}', String(visible.length))}
            </span>
            {pageCount > 1 && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  {t('issue.page.prev')}
                </button>
                <span className="tabular-nums px-1">
                  {t('issue.page.of')
                    .replace('{page}', String(currentPage))
                    .replace('{pages}', String(pageCount))}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
                  disabled={currentPage >= pageCount}
                  className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('issue.page.next')}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CircleAlert}
          title={filtered ? t('issue.emptyFiltered.title') : t('issue.empty.title')}
          description={filtered ? t('issue.emptyFiltered.desc') : t('issue.empty.desc')}
          action={!filtered && canWrite ? (
            <button onClick={openWrite} className="btn btn-primary inline-flex items-center gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />{t('issue.new')}
            </button>
          ) : undefined}
        />
      )}

      <IssueDetailModal
        areas={areas}
        severities={severities}
        sources={sources}
        statuses={statusDefs}
        issue={viewing}
        members={members}
        memberName={memberName}
        canEdit={viewing && entryContext ? canEditIssue(viewing, currentUserId, isProjectAdmin) : false}
        canWrite={canWrite}
        currentUserId={currentUserId}
        isProjectAdmin={isProjectAdmin}
        today={today}
        timeZone={timeZone}
        onClose={() => {
          setViewingId(null)
          // 파라미터가 남아 있으면 다음 소프트 내비게이션에서 같은 이슈가 다시 열린다.
          if (focusParam !== null) {
            const next = new URLSearchParams(searchParams.toString())
            next.delete('focus')
            const qs = next.toString()
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
          }
        }}
        onEdit={() => viewing && openEdit(viewing)}
        onDelete={() => {
          if (!viewing) return
          setDeleting(viewing)
          setViewingId(null)
        }}
      />
      <IssueFormModal entryContext={entryContext ?? undefined} canManage={isProjectAdmin} open={formOpen} onClose={() => setFormOpen(false)} projectId={projectId} workspaceId={workspaceId} initial={editing} members={members} />
      <DeleteIssueModal issue={deleting} onClose={() => setDeleting(null)} />
      <IssueAnalysisModal
        areas={areas}
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        projectId={projectId}
        issues={issues}
        areaFilter={areaFilter}
      />
    </div>
  )
}
