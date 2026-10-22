'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CircleAlert, ExternalLink, FileText, Highlighter, LayoutTemplate, ListPlus, LoaderCircle, Users } from 'lucide-react'
import type { InsightKind } from '@/lib/domain/types'
import type { MinuteLinkedIssue } from '@/lib/domain/issueMinuteSource'
import { displayWbsCode, type MinuteLinkedWbsItem } from '@/lib/domain/minuteWbs'
import { IssueStatusPill } from '@/components/ui/StatusPill'
import { useLocale } from '@/components/providers/LocaleProvider'
import { fill } from '@/lib/i18n/translate'

/** 연결된 작업 목록에 바로 보이는 수 — 나머지는 「외 N건」(연결된 이슈와 같은 꼴) */
const LINKED_WBS_SHOWN = 2
/** 연결된 이슈 목록에 바로 보이는 수 */
const LINKED_ISSUES_SHOWN = 2

/** 칸마다의 어림 높이(px) — 안쪽 여백 p-3·테두리, 인사이트 칩 줄, h-9 단추, 구역 가름(mt-2 border-t pt-2), 목록 머리·항목·「외 N건」, 명단 */
const EST = { frame: 26, kinds: 24, button: 36, divider: 17, listLabel: 24, listItem: 60, listMore: 24, listGap: 8, names: 62 }

/**
 * 팝오버의 어림 높이 — 잰 높이가 없을 때(첫 그리기·잴 수 없는 환경)만 쓴다. 칸마다 실제 높이에 가깝게 더한다: 예전 어림(320 + 목록마다 120)은
 * 실제보다 커서 위로 뒤집을 때 팝오버가 문단에서 165~260px 떠 있었다. 목록은 둘까지만 보이고 나머지는 「외 N건」 한 줄이다
 */
export function estimatePopoverHeight(c: { kinds: number; linkedIssues: number; linkedWbs: number; wbsButton: boolean; names: number }): number {
  const list = (n: number, shown: number) =>
    (n > 0 ? EST.listLabel + Math.min(n, shown) * EST.listItem + (n > shown ? EST.listMore : 0) + EST.listGap : 0)
  const wbsSection = c.wbsButton || c.linkedWbs > 0
  return EST.frame + (c.kinds > 0 ? EST.kinds : 0) + EST.button
    + EST.divider + list(c.linkedIssues, LINKED_ISSUES_SHOWN) + EST.button
    + (wbsSection ? EST.divider + list(c.linkedWbs, LINKED_WBS_SHOWN) + (c.wbsButton ? EST.button : 0) : 0)
    + (c.names > 0 ? EST.divider + EST.names : 0)
}

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
  specBusy = false, mockupBusy = false, canCreateBlueprint = true, onExtractSpec, onCreateMockup,
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
  specBusy?: boolean
  mockupBusy?: boolean
  canCreateBlueprint?: boolean
  onExtractSpec?: () => void
  onCreateMockup?: () => void
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

  // 그린 뒤의 실제 높이 — 위로 뒤집을 때 이 높이로 놓아 아래 끝이 문단 바로 위에 붙는다. 높이를 바꾸는 내용(문단·인사이트 칩·연결 목록·
  // WBS 단추·명단)이 바뀌면 다시 잰다. 같은 값이면 상태를 바꾸지 않아 다시 그리지 않는다. 잴 수 없으면(0) 어림값을 쓴다
  const [measuredH, setMeasuredH] = useState<number | null>(null)
  const contentKey = [
    state.blockIndex, insKinds.join(), linkedIssues.map(issue => issue.linkId).join(), linkedWbsItems.map(item => item.linkId).join(),
    onCreateWbs !== undefined, names.join('\u0000'),
  ].join('|')
  useLayoutEffect(() => {
    const height = boxRef.current?.getBoundingClientRect().height ?? 0
    const next = height > 0 ? Math.ceil(height) : null
    setMeasuredH(prev => (prev === next ? prev : next))
  }, [contentKey])

  const W = 300
  const wbsSection = onCreateWbs !== undefined || linkedWbsItems.length > 0
  // 화면 밖 플립 기준 높이 — 잰 높이, 없으면 칸별 어림. 화면보다 크면 카드 자체가 스크롤한다(max-h)
  const H = Math.min(
    measuredH ?? estimatePopoverHeight({
      kinds: insKinds.length, linkedIssues: linkedIssues.length, linkedWbs: linkedWbsItems.length,
      wbsButton: onCreateWbs !== undefined, names: names.length,
    }),
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
                {linkedIssues.slice(0, LINKED_ISSUES_SHOWN).map(issue => {
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
                {linkedIssues.length > LINKED_ISSUES_SHOWN && (
                  <p className="px-1 text-meta text-fg-muted">
                    {t('min.issue.more').replace('{n}', String(linkedIssues.length - LINKED_ISSUES_SHOWN))}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            onClick={onCreateIssue}
            disabled={issueBusy || wbsBusy || specBusy || mockupBusy || !canCreateIssue}
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
                  {linkedWbsItems.slice(0, LINKED_WBS_SHOWN).map(item => {
                    // 코드가 이름의 첫 낱말·화자 이름표면 같은 글이 두 번 보이므로 이름만(이름이 첫 줄)
                    const code = displayWbsCode(item.code, item.name)
                    return (
                      <Link
                        key={item.linkId}
                        href={`/p/${item.projectId}/wbs?focus=${encodeURIComponent(item.itemId)}`}
                        onClick={onClose}
                        className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-2.5 py-2 text-xs text-fg transition hover:border-action/40 hover:text-action"
                      >
                        <span className="min-w-0 flex-1">
                          {code && <span className="block truncate font-medium">{code}</span>}
                          <span className={code ? 'mt-0.5 block truncate text-meta text-fg-secondary' : 'block truncate font-medium'}>{item.name}</span>
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </Link>
                    )
                  })}
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
                disabled={wbsBusy || issueBusy || specBusy || mockupBusy || !canCreateWbs}
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
        {(onExtractSpec || onCreateMockup) && (
          <div className="mt-2 flex gap-1.5 border-t border-border pt-2">
            {onExtractSpec && (
              <button
                type="button"
                onClick={onExtractSpec}
                disabled={wbsBusy || issueBusy || specBusy || mockupBusy || !canCreateBlueprint}
                className="btn btn-ghost h-9 min-w-0 flex-1 px-2.5 text-xs"
              >
                {specBusy
                  ? <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                  : <FileText aria-hidden className="h-4 w-4 shrink-0" />}
                <span className="truncate">{specBusy ? t('min.spec.preparing') : t('min.spec.create')}</span>
              </button>
            )}
            {onCreateMockup && (
              <button
                type="button"
                onClick={onCreateMockup}
                disabled={wbsBusy || issueBusy || specBusy || mockupBusy || !canCreateBlueprint}
                className="btn btn-ghost h-9 min-w-0 flex-1 px-2.5 text-xs"
              >
                {mockupBusy
                  ? <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                  : <LayoutTemplate aria-hidden className="h-4 w-4 shrink-0" />}
                <span className="truncate">{mockupBusy ? t('min.mockup.preparing') : t('min.mockup.create')}</span>
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
