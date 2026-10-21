'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { CircleAlert, ExternalLink, Highlighter, ListPlus, LoaderCircle, Users } from 'lucide-react'
import type { InsightKind } from '@/lib/domain/types'
import type { MinuteLinkedIssue } from '@/lib/domain/issueMinuteSource'
import type { MinuteLinkedWbsItem } from '@/lib/domain/minuteWbs'
import { IssueStatusPill } from '@/components/ui/StatusPill'
import { useLocale } from '@/components/providers/LocaleProvider'
import { fill } from '@/lib/i18n/translate'

/** 연결된 작업 목록에 바로 보이는 수 — 나머지는 「외 N건」(연결된 이슈와 같은 꼴) */
const LINKED_WBS_SHOWN = 2

const KIND_CHIP: Record<InsightKind, string> = {
  decision: 'bg-success-weak text-success',
  action: 'bg-progress-weak text-progress',
  deadline: 'bg-warning/15 text-warning',
  risk: 'bg-danger-weak text-danger',
}

export interface PopoverState {
  blockIndex: number
  rect: { top: number; bottom: number; left: number; width: number }  // getBoundingClientRect 스냅샷
}

/** 블록 팝오버 — fixed 배치(블록 하단 우선·상단 플립·좌우 클램프), 스크롤/리사이즈/외부 클릭 시 닫힘. 스펙 §6.4. */
export function MinuteBlockPopover({
  state, mine, names, insKinds, busy, linkedIssues, issueBusy = false,
  canCreateIssue = true, linkedWbsItems, wbsBusy = false, canCreateWbs = true, onCreateWbs,
  onToggle, onCreateIssue, onClose,
}: {
  state: PopoverState
  mine: boolean
  names: string[]
  insKinds: InsightKind[]
  busy: boolean
  linkedIssues: MinuteLinkedIssue[]
  issueBusy?: boolean
  canCreateIssue?: boolean
  /** 이 문단에 연결된 WBS 작업 — 등록 권한과 무관하게 보인다(볼 수 있는 연결만 온다 — RLS) */
  linkedWbsItems: MinuteLinkedWbsItem[]
  /** WBS 초안 준비 중 — 단추가 「작업 초안 준비 중…」이 되고 이슈 등록도 막는다(두 흐름이 겹치지 않게) */
  wbsBusy?: boolean
  /** false = 단추는 보이되 막는다(제목 줄 — 이슈와 같은 규칙) */
  canCreateWbs?: boolean
  /** 없으면 「WBS로 등록」 단추가 없다(관리자가 아님·연결 목록 조회 실패 등 — 뷰어의 wbsEnabled) */
  onCreateWbs?: () => void
  onToggle: () => void
  onCreateIssue: () => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // capture — 본문 카드 내부 스크롤도 감지. 단, 팝오버 내부 스크롤(긴 명단)은 닫지 않는다.
    const close = (e: Event) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return
      onClose()
    }
    const closeAll = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', closeAll)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', closeAll)
    }
  }, [onClose])

  const W = 300
  const wbsSection = onCreateWbs !== undefined || linkedWbsItems.length > 0
  // 연결 이슈·WBS 구역이 붙으면 내용이 늘어난다. 화면 밖 플립 기준은 최대 높이로 잡고 카드 자체는 스크롤한다.
  const H = Math.min(
    320 + (linkedIssues.length > 0 ? 120 : 0) + (wbsSection ? 56 : 0) + (linkedWbsItems.length > 0 ? 120 : 0),
    window.innerHeight - 16,
  )
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - W - 8)
  const below = state.rect.bottom + H < window.innerHeight
  const pos = below
    ? { top: state.rect.bottom + 6, left }
    : { top: Math.max(8, state.rect.top - 6 - H), left }

  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label={t('common.close')} onClick={onClose} />
      <div ref={boxRef} style={{ position: 'fixed', width: W, ...pos }}
        className="z-[95] max-h-[calc(100vh-16px)] overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]">
        {insKinds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {insKinds.map(k => (
              <span key={k} className={`chip ${KIND_CHIP[k]}`}>{t(`min.insight.kind.${k}`)}</span>
            ))}
          </div>
        )}
        <button onClick={onToggle} disabled={busy}
          className={`btn h-9 w-full ${mine ? 'bg-warning/15 text-warning' : 'btn-ghost'}`}>
          <Highlighter className="h-4 w-4" />
          {mine ? t('min.hl.remove') : t('min.hl.add')}
        </button>
        <div className="mt-2 border-t border-border pt-2">
          {linkedIssues.length > 0 && (
            <div className="mb-2">
              <p className="mb-1.5 text-meta font-semibold text-fg-muted">{t('min.issue.linked')}</p>
              <div className="space-y-1.5">
                {linkedIssues.slice(0, 2).map(issue => {
                  return (
                    <Link
                      key={issue.linkId}
                      href={`/p/${issue.projectId}/issues?focus=${encodeURIComponent(issue.issueId)}`}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-2.5 py-2 text-xs text-fg transition hover:border-action/40 hover:text-action"
                    >
                                            <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {issue.code}
                        </span>
                        <span className="mt-0.5 block truncate text-meta text-fg-secondary">
                          {issue.title}
                        </span>
                      </span>
                      <span className="shrink-0"><IssueStatusPill category={issue.status} /></span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </Link>
                  )
                })}
                {linkedIssues.length > 2 && (
                  <p className="px-1 text-meta text-fg-muted">
                    {t('min.issue.more').replace('{n}', String(linkedIssues.length - 2))}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            onClick={onCreateIssue}
            disabled={issueBusy || wbsBusy || !canCreateIssue}
            className="btn btn-primary h-9 w-full"
          >
            {issueBusy
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <CircleAlert className="h-4 w-4" />}
            {issueBusy
              ? t('min.issue.summarizing')
              : linkedIssues.length > 0 ? t('min.issue.createAnother') : t('min.issue.create')}
          </button>
        </div>
        {/* 회의록 → WBS(설계 2026-10-21-minutes-to-wbs §3.1·§3.3) — 이슈 구역과 같은 꼴: 연결된 작업(≤2 + 외 N건) 다음 등록 단추 */}
        {wbsSection && (
          <div className="mt-2 border-t border-border pt-2">
            {linkedWbsItems.length > 0 && (
              <div className={onCreateWbs ? 'mb-2' : undefined}>
                <p className="mb-1.5 text-meta font-semibold text-fg-muted">{t('min.wbs.linked')}</p>
                <div className="space-y-1.5">
                  {linkedWbsItems.slice(0, LINKED_WBS_SHOWN).map(item => (
                    <Link
                      key={item.linkId}
                      href={`/p/${item.projectId}/wbs?focus=${encodeURIComponent(item.itemId)}`}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-2.5 py-2 text-xs text-fg transition hover:border-action/40 hover:text-action"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.code}</span>
                        <span className="mt-0.5 block truncate text-meta text-fg-secondary">{item.name}</span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </Link>
                  ))}
                  {linkedWbsItems.length > LINKED_WBS_SHOWN && (
                    <p className="px-1 text-meta text-fg-muted">
                      {fill(t('min.wbs.more'), { n: linkedWbsItems.length - LINKED_WBS_SHOWN })}
                    </p>
                  )}
                </div>
              </div>
            )}
            {onCreateWbs && (
              <button
                onClick={onCreateWbs}
                disabled={wbsBusy || issueBusy || !canCreateWbs}
                className="btn btn-ghost h-9 w-full"
              >
                {wbsBusy
                  ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                  : <ListPlus aria-hidden className="h-4 w-4" />}
                {wbsBusy
                  ? t('min.wbs.preparing')
                  : linkedWbsItems.length > 0 ? t('min.wbs.createAnother') : t('min.wbs.create')}
              </button>
            )}
          </div>
        )}
        {names.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <p className="mb-1 inline-flex items-center gap-1 text-meta font-semibold text-fg-muted">
              <Users className="h-3 w-3" />{t('min.hl.people')}
            </p>
            <p className="max-h-28 overflow-y-auto overscroll-contain text-xs leading-relaxed text-fg-secondary">{names.join(', ')}</p>
          </div>
        )}
      </div>
    </>
  )
}
