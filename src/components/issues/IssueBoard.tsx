'use client'
// 이슈 보드(SPU2 이월 — 개정 §3.5 보드 행) — 열 = 프로젝트의 표시 상태 정의(workflow.issue_statuses). 드래그는 없고,
// 카드의 '상태 변경' 메뉴가 전이표가 허용하는 상태만 보이며 저장은 목록·상세와 같은 updateIssueProgress 한 길이다.
// 시각 패턴은 WBS 보드(KanbanBoard·KanbanCard)를 따른다. 최종 전이 판정은 DB 트리거 — 거부는 카드에 표시한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, CalendarRange, Loader2, TriangleAlert, X } from 'lucide-react'
import { updateIssueProgress } from '@/app/actions/issues'
import { useLocale } from '@/components/providers/LocaleProvider'
import { IssueStatusPill } from '@/components/ui/StatusPill'
import { ISSUE_BOARD_PAGE, issueBoardColumns, issueMoveTargets, issueStatusCode } from '@/lib/domain/issueBoard'
import { dueDaysLeft, isDueUrgent, isOverdue, type Issue } from '@/lib/domain/issues'
import { areaLabel, type IssueAreaRef } from '@/lib/domain/issueAreas'
import { VOCAB_COLOR_CLASS, vocabLabel, vocabView, type IssueStatusDef, type SeverityDef } from '@/lib/settings/vocab'

export function IssueBoard({
  issues, statuses, severities, areas, assigneeLabel, today, canMove, onOpen,
}: {
  /** 필터·정렬이 끝난 이슈 — 목록과 같은 집합을 받는다(필터는 보드에도 적용된다) */
  issues: Issue[]
  statuses: readonly IssueStatusDef[]
  severities: readonly SeverityDef[]
  areas: readonly IssueAreaRef[]
  /** 담당자 표기(목록 셀과 같은 규칙) — 없으면 null */
  assigneeLabel: (issue: Issue) => string | null
  today: string
  /** 프로젝트 멤버 이상 — 조회 전용에게는 이동 메뉴를 그리지 않는다(서버 updateIssueProgress 는 requireProjectMember) */
  canMove: boolean
  onOpen: (issueId: string) => void
}) {
  const { t } = useLocale()
  const router = useRouter()
  const columns = useMemo(() => issueBoardColumns(statuses, issues), [statuses, issues])
  const [shown, setShown] = useState<Record<string, number>>({})
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [liveMsg, setLiveMsg] = useState('')
  // 같은 카드의 재진입(더블클릭)을 막는다 — 두 번째 요청이 낡은 기준 상태로 나가 충돌로 읽히지 않게
  const inFlight = useRef<Set<string>>(new Set())
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (!menuFor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      triggerRefs.current.get(menuFor)?.focus()
      setMenuFor(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuFor])

  async function move(issue: Issue, target: IssueStatusDef) {
    if (inFlight.current.has(issue.id)) return
    inFlight.current.add(issue.id)
    setMenuFor(null)
    setSavingIds(s => new Set(s).add(issue.id))
    setFailed(f => { const next = { ...f }; delete next[issue.id]; return next })
    const label = vocabLabel('workflow.issue_statuses', statuses, target.code, t)
    try {
      const res = await updateIssueProgress(issue.id, { status: target.code, expectedStatus: issueStatusCode(issue) })
      if (res.ok) {
        setLiveMsg(t('issue.board.moved').replace('{code}', issue.code).replace('{status}', label))
        router.refresh()
      } else {
        // 거부(전이표 밖·권한·모듈 꺼짐)와 충돌은 카드에 그대로 남긴다 — 충돌이면 최신 상태를 받아 다시 고를 수 있게 한다
        setFailed(f => ({ ...f, [issue.id]: res.error ?? t('issue.board.moveFailed') }))
        if (res.conflict) router.refresh()
      }
    } catch (e) {
      console.error('[issues] 보드 상태 변경 — 응답을 받지 못했다', issue.id, e)
      setFailed(f => ({ ...f, [issue.id]: t('issue.bulk.noResponse') }))
    } finally {
      inFlight.current.delete(issue.id)
      setSavingIds(s => { const next = new Set(s); next.delete(issue.id); return next })
    }
  }

  return (
    <div data-issue-board className="flex items-start gap-4 overflow-x-auto pb-2">
      {columns.map(col => {
        const limit = shown[col.code] ?? ISSUE_BOARD_PAGE
        const rest = col.cards.length - limit
        const dot = VOCAB_COLOR_CLASS[col.def?.color ?? 'neutral'].dot
        return (
          <section
            key={col.code}
            data-issue-column={col.code}
            data-column-kind={col.kind}
            aria-label={vocabLabel('workflow.issue_statuses', statuses, col.code, t)}
            className="card flex w-[290px] min-w-[290px] flex-col border-border/70 bg-surface/90 p-3 shadow-xs"
          >
            <header className="flex flex-col gap-1 px-1 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-fg">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
                  <IssueStatusPill category={col.category} code={col.code} defs={statuses} />
                </h3>
                <span className="badge shrink-0 bg-surface-subtle font-semibold tabular-nums text-fg-secondary" data-testid="issue-column-count">{col.cards.length}</span>
              </div>
              {col.kind !== 'active' && (
                <p className="text-xs text-fg-muted">{t(col.kind === 'inactive' ? 'issue.board.columnInactive' : 'issue.board.columnUnknown')}</p>
              )}
            </header>

            <div className="flex flex-col gap-2.5">
              {col.cards.length === 0 ? (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-border/70 py-8 text-center text-xs text-fg-muted">
                  {t('issue.board.empty')}
                </div>
              ) : col.cards.slice(0, limit).map(issue => {
                const area = areas.find(a => a.id === issue.areaId)
                const severity = vocabView('issues.severities', severities, issue.severity, t)
                const daysLeft = dueDaysLeft(issue, today)
                const urgent = isOverdue(issue, today) || isDueUrgent(daysLeft)
                const targets = canMove ? issueMoveTargets(statuses, issue) : []
                const saving = savingIds.has(issue.id)
                const open = menuFor === issue.id
                const error = failed[issue.id]
                return (
                  <article
                    key={issue.id}
                    data-issue-card={issue.id}
                    className={`relative shrink-0 overflow-hidden rounded-xl border p-3.5 shadow-xs transition duration-(--motion-fast) ${error ? 'border-warning/80 bg-warning/5' : 'border-border/80 bg-surface'}`}
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${dot}`} aria-hidden />
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${issue.code} ${issue.title}`}
                      onClick={() => onOpen(issue.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(issue.id) } }}
                      className="cursor-pointer rounded pl-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-all text-xs font-semibold tabular-nums text-fg-secondary">{issue.code}</span>
                        <span className={`chip shrink-0 px-2 py-0.5 ${severity.chip}`}>{severity.label}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-fg" title={issue.title}>{issue.title}</p>
                      <p className="mt-2 truncate text-xs text-fg-muted">{areaLabel(area, issue.areaId)}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                        <span className="min-w-0 truncate">{assigneeLabel(issue) ?? t('issue.unassigned')}</span>
                        <span className={`flex shrink-0 items-center gap-1 tabular-nums ${urgent ? 'font-semibold text-delayed' : ''}`}>
                          <CalendarRange className="h-3 w-3" aria-hidden />
                          {issue.dueDate ?? '—'}
                        </span>
                      </div>
                    </div>

                    {/* 이동 메뉴 — 카드 안에서 아래로 펼친다(떠 있는 층을 만들지 않는다: 스크롤 상자에 잘리지 않고 z 를 다투지 않는다) */}
                    {targets.length > 0 && (
                      <div className="mt-2.5 border-t border-border/60 pt-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" aria-label={t('issue.board.saving')} />}
                          <button
                            type="button"
                            ref={el => { if (el) triggerRefs.current.set(issue.id, el); else triggerRefs.current.delete(issue.id) }}
                            className="btn btn-ghost h-7 gap-1 px-2 text-xs"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            aria-label={t('issue.board.moveMenu').replace('{code}', issue.code)}
                            disabled={saving}
                            onClick={() => setMenuFor(open ? null : issue.id)}
                            data-testid="issue-card-move-trigger"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
                            {t('issue.board.move')}
                          </button>
                        </div>
                        {open && (
                          <div role="menu" aria-label={t('issue.board.moveMenu').replace('{code}', issue.code)} className="mt-1.5 rounded-xl border border-border bg-surface p-1">
                            {targets.map(target => (
                              <button
                                key={target.code}
                                type="button"
                                role="menuitem"
                                disabled={saving}
                                onClick={() => void move(issue, target)}
                                data-testid={`issue-card-move-${target.code}`}
                                className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-fg transition hover:bg-surface-hover"
                              >
                                {vocabLabel('workflow.issue_statuses', statuses, target.code, t)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {error && (
                      <div role="alert" data-testid="issue-card-move-error" className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-surface p-2 text-xs text-warning">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 leading-snug">{error}</span>
                        <button
                          type="button"
                          aria-label={t('issue.board.dismiss')}
                          onClick={() => setFailed(f => { const next = { ...f }; delete next[issue.id]; return next })}
                          className="shrink-0 rounded p-0.5 text-fg-secondary hover:bg-surface-hover"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
              {rest > 0 && (
                <button
                  type="button"
                  onClick={() => setShown(s => ({ ...s, [col.code]: limit + ISSUE_BOARD_PAGE }))}
                  className="btn btn-ghost w-full justify-center text-xs"
                  data-testid="issue-column-more"
                >
                  {t('issue.board.more').replace('{n}', String(Math.min(rest, ISSUE_BOARD_PAGE))).replace('{rest}', String(rest))}
                </button>
              )}
            </div>
          </section>
        )
      })}
      <div aria-live="polite" className="sr-only">{liveMsg}</div>
    </div>
  )
}
