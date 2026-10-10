import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  ListTodo,
  LockKeyhole,
  Scale,
  ShieldAlert,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react'
import type { DictKey} from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
// 상태 판정은 순수 도메인 모듈에서 직접 가져온다. lib/data/wiki를 값으로 import하면
// 클라이언트 번들에 서버 전용 supabase 클라이언트가 딸려 들어와 빌드가 깨진다.
import { isConflictedWikiItem } from '@/lib/domain/wikiView'
import type {
  WikiChangeEvent,
  WikiItem,
  WikiItemKind,
  WikiSource,
} from '@/lib/data/wiki'
import { WikiItemActions } from './WikiItemActions'
import { WikiTrackedLink } from './WikiTrackedLink'
import { MINUTES_PERMALINK_BASE } from '@/lib/minutes/permalink'
import { KO_LOCALE } from '@/lib/i18n/format'

/**
 * 회의록 원문 블록 링크. lib/minutes/source의 minuteSourceHref와 같은 형식이지만 직접 만든다.
 *
 * 이 파일은 'use client' 컴포넌트들이 import하면서 클라이언트 모듈
 * 그래프에 들어간다. minutes/source는 blocks.ts를 값으로 가져오고 blocks.ts는 unified·remark-parse·
 * remark-gfm을 끌어오므로, 링크 문자열 몇 줄 때문에 마크다운 파서 100KB가 Wiki 홈 번들에 실린다.
 * 형식이 갈리지 않도록 tests/ui/wiki-safety.test.tsx가 두 구현의 결과를 대조한다.
 * base 는 minuteSourceHref 와 같이 필수다(CC6). 이 파일은 서버 컴포넌트(위키 주제)로도 그려져 useScope 를 읽을 수 없으므로, 페이지가
 * 슬러그 워크스페이스의 회의록 경로를 minutesBase 로 내려 준다(D38 ①, 과제 35). 컴포넌트의 minutesBase 를 받지 못하면(범위 조회 실패) 영구 링크
 * 형식(MINUTES_PERMALINK_BASE — 스텁이 행의 워크스페이스로, D6)이다.
 */
export function wikiMinuteSourceHref(
  minuteId: string,
  source: { blockIndex: number; blockHash: string; bodyHash: string },
  minuteVersionId: string | null | undefined,
  base: string,
): string {
  const params = new URLSearchParams({
    block: String(source.blockIndex),
    hash: source.blockHash,
    body: source.bodyHash,
  })
  if (minuteVersionId) params.set('version', minuteVersionId)
  return `${base}/${minuteId}?${params.toString()}`
}

interface KindMeta {
  icon: LucideIcon
  labelKey: DictKey
  chip: string
  iconWrap: string
}

const KIND_META: Record<string, KindMeta> = {
  decision: {
    icon: CheckCircle2,
    labelKey: 'wiki.kind.decision',
    chip: 'bg-success-weak text-success',
    iconWrap: 'bg-success-weak text-success',
  },
  fact: {
    icon: Info,
    labelKey: 'wiki.kind.fact',
    chip: 'bg-progress-weak text-progress',
    iconWrap: 'bg-progress-weak text-progress',
  },
  action: {
    icon: ListTodo,
    labelKey: 'wiki.kind.action',
    chip: 'bg-progress-weak text-progress',
    iconWrap: 'bg-progress-weak text-progress',
  },
  question: {
    icon: CircleHelp,
    labelKey: 'wiki.kind.question',
    chip: 'bg-pending-weak text-pending',
    iconWrap: 'bg-pending-weak text-pending',
  },
  risk: {
    icon: AlertTriangle,
    labelKey: 'wiki.kind.risk',
    chip: 'bg-danger-weak text-danger',
    iconWrap: 'bg-danger-weak text-danger',
  },
  constraint: {
    icon: ShieldAlert,
    labelKey: 'wiki.kind.constraint',
    chip: 'bg-warning/15 text-warning',
    iconWrap: 'bg-warning/15 text-warning',
  },
  rationale: {
    icon: Lightbulb,
    labelKey: 'wiki.kind.rationale',
    chip: 'bg-action-soft text-action',
    iconWrap: 'bg-action-soft text-action',
  },
}

const KNOWN_STATES = new Set([
  'active',
  'archived',
  'closed',
  'confirmed',
  'conflict',
  'conflicted',
  'disputed',
  'done',
  'on_hold',
  'open',
  'proposed',
  'reversed',
  'resolved',
  'superseded',
  'tentative',
  'withdrawn',
])

const CHANGE_KEYS = new Set([
  'new',
  'created',
  'reconfirmed',
  'confirmed',
  'reaffirm',
  'refined',
  'refine',
  'updated',
  'superseded',
  'supersede',
  'withdrawn',
  'reverse',
  'conflict',
  'conflicted',
  'resolved',
  'resolve',
  'retract',
  'curate',
])

const TERMINAL_LIFECYCLE_STATES = new Set([
  'conflicted',
  'superseded',
  'resolved',
  'archived',
])

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function kindMeta(kind: WikiItemKind): KindMeta {
  return KIND_META[kind] ?? {
    icon: FileText,
    labelKey: 'wiki.kind.other',
    chip: 'bg-surface-subtle text-fg-secondary',
    iconWrap: 'bg-surface-subtle text-fg-secondary',
  }
}

/**
 * 결정 상태는 결정의 의미를, lifecycle은 항목 자체의 현재 유효성을 나타낸다.
 * 이미 충돌·대체·해결·보관된 항목을 과거 decisionState="confirmed" 때문에
 * 여전히 "확정"으로 보이지 않게 종료 lifecycle을 우선한다.
 */
const KNOWLEDGE_KINDS = new Set(['fact', 'constraint', 'rationale'])

function displayedState(item: WikiItem): string {
  const lifecycle = normalized(item.lifecycleState)
  if (TERMINAL_LIFECYCLE_STATES.has(lifecycle)) return lifecycle
  const decision = normalized(item.decisionState)
  if (decision) return decision
  // 사실·제약·근거는 결정 상태가 없어 lifecycle만으로 표시되는데, 잠정 지식까지
  // "현재 유효"로 보이면 논의 중인 내용을 확정 사실로 읽게 된다.
  // (액션·질문·리스크는 '열림'이 그 자체로 미결 신호라 그대로 둔다.)
  if (KNOWLEDGE_KINDS.has(item.kind) && normalized(item.certainty) === 'tentative') {
    return 'tentative'
  }
  return lifecycle
}

function originalStateLabel(item: WikiItem): string {
  const state = displayedState(item)
  if (!KNOWN_STATES.has(state)) return state || t('wiki.state.unknown')
  return t(`wiki.state.${state}` as DictKey)
}

/** 화면 어휘는 다섯 상태로 접고, 원래 세부 상태는 chip title에 보존한다. */
function stateLabel(item: WikiItem): string {
  const state = displayedState(item)
  if (isConflictedWikiItem(item)) return t('wiki.state.conflict')
  if (['resolved', 'done', 'closed', 'superseded', 'withdrawn', 'reversed', 'archived'].includes(state)) {
    return t('wiki.state.ended')
  }
  if (state === 'open') return t('wiki.state.open')
  if (['tentative', 'proposed', 'on_hold'].includes(state)) return t('wiki.state.discussing')
  if (['active', 'confirmed'].includes(state)) return t('wiki.state.active')
  return t('wiki.state.unknown')
}

function stateChip(item: WikiItem): string {
  const state = displayedState(item)
  if (isConflictedWikiItem(item)) return 'bg-danger-weak text-danger'
  if (['resolved', 'done', 'confirmed'].includes(state)) return 'bg-success-weak text-success'
  if (state === 'reversed') return 'bg-danger-weak text-danger'
  if (['superseded', 'withdrawn', 'archived', 'closed'].includes(state)) return 'bg-surface-subtle text-fg-muted'
  if (['tentative', 'proposed', 'on_hold'].includes(state)) return 'bg-pending-weak text-pending'
  return 'bg-action-soft text-action'
}

/** 위키 날짜 표기 — date-only('YYYY-MM-DD')는 변환하지 않고(UTC 로 그대로 찍기), instant 는 프로젝트 tz 로(스펙 SP5 D60, 계획 D-21d) */
export function formatWikiDate(
  value: string | null | undefined,
  includeTime: boolean,
  timeZone: string,
): string {
  if (!value) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(KO_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    // date-only 는 변환하지 않는다(UTC 로 그대로 찍기 — D-21d), instant 는 프로젝트 tz
    timeZone: dateOnly ? 'UTC' : timeZone,
  }).format(parsed)
}

function sourceHref(source: WikiSource, base: string): string {
  if (
    source.bodyHash
    && source.blockHash
    && source.blockIndex !== null
  ) {
    return wikiMinuteSourceHref(source.minuteId, {
      blockIndex: source.blockIndex,
      blockHash: source.blockHash,
      bodyHash: source.bodyHash,
    }, source.minuteVersionId, base)
  }
  return source.minuteVersionId
    ? `${base}/${source.minuteId}?version=${encodeURIComponent(source.minuteVersionId)}`
    : `${base}/${source.minuteId}`
}

function changeSourceHref(change: WikiChangeEvent, base: string): string {
  if (
    change.minuteId
    && change.sourceBodyHash
    && change.sourceBlockHash
    && change.sourceBlockIndex !== null
    && change.sourceBlockIndex !== undefined
  ) {
    return wikiMinuteSourceHref(change.minuteId, {
      blockIndex: change.sourceBlockIndex,
      blockHash: change.sourceBlockHash,
      bodyHash: change.sourceBodyHash,
    }, change.minuteVersionId, base)
  }
  return change.minuteVersionId
    ? `${base}/${change.minuteId}?version=${encodeURIComponent(change.minuteVersionId)}`
    : `${base}/${change.minuteId}`
}

export function WikiSourceLinks({
  sources,
  showEvidence = false,
  timeZone,
  minutesBase = MINUTES_PERMALINK_BASE,
}: {
  sources: WikiSource[]
  showEvidence?: boolean
  /** instant 를 찍을 시간대(프로젝트 calendar.timezone) */
  timeZone: string
  /** 회의록 링크의 기준 경로 — 슬러그 워크스페이스의 '/w/<s>/minutes'. 없으면 영구 링크 형식 */
  minutesBase?: string
}) {
  if (sources.length === 0) return null
  return (
    <div className="mt-3 space-y-2 border-t border-border/80 pt-3">
      {sources.slice(0, showEvidence ? 4 : 2).map((source, index) => (
        <div key={source.id || `${source.minuteId}-${source.blockIndex ?? index}`}>
          <WikiTrackedLink
            href={sourceHref(source, minutesBase)}
            domain="minutes"
            className="group/source inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-action hover:text-action-hover"
            ariaLabel={`${source.minuteTitle ?? t('wiki.viewSource')} ${t('wiki.viewSource')}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {source.minuteDate ? `${formatWikiDate(source.minuteDate, false, timeZone)} · ` : ''}
              {source.minuteTitle ?? t('wiki.viewSource')}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60 transition group-hover/source:opacity-100" />
          </WikiTrackedLink>
          {showEvidence && source.evidenceExcerpt && (
            <blockquote className="mt-1.5 border-l-2 border-border-input pl-3 text-xs leading-5 text-fg-secondary">
              {source.evidenceExcerpt}
            </blockquote>
          )}
        </div>
      ))}
      {sources.length > (showEvidence ? 4 : 2) && (
        <span className="text-meta text-fg-muted">
          {t('wiki.sourceCount').replace('{n}', String(sources.length))}
        </span>
      )}
    </div>
  )
}

export function WikiItemCard({
  item,
  showEvidence = false,
  curateProjectId,
  timeZone,
  minutesBase,
}: {
  item: WikiItem
  showEvidence?: boolean
  /** instant 를 찍을 시간대(프로젝트 calendar.timezone) */
  timeZone: string
  /** 근거 회의록 링크의 기준 경로(WikiSourceLinks) */
  minutesBase?: string
  /** 넘기면 큐레이션 버튼이 붙는다. 읽기 전용 문맥(회의록 영향 카드 등)에서는 생략한다. */
  curateProjectId?: string
}) {
  const meta = kindMeta(item.kind)
  const Icon = meta.icon
  const date = item.dueDate ?? item.observedAt ?? item.validFrom
  const ownerName = typeof item.structuredData.owner_name === 'string'
    ? item.structuredData.owner_name.trim()
    : ''
  const owner = [item.ownerTeam, ownerName].filter(Boolean).join(' · ')

  return (
    <article id={`wiki-item-${item.id}`} className="scroll-mt-6 rounded-xl border border-border/80 bg-surface p-4 transition-[box-shadow,border-color] duration-(--motion-fast) hover:border-border-input">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${meta.chip}`}>{t(meta.labelKey)}</span>
            <span className={`chip ${stateChip(item)}`} title={originalStateLabel(item)}>{stateLabel(item)}</span>
            {item.autoUpdateLocked && (
              <span className="chip bg-surface-subtle text-fg-secondary">
                <LockKeyhole className="h-3 w-3" />
                {t('wiki.locked')}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-fg">{item.statement}</p>
          {(owner || date) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
              {owner && <span>{t('wiki.ownerTeam')} · {owner}</span>}
              {date && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {item.dueDate
                    ? t('wiki.dueDate').replace('{date}', formatWikiDate(date, false, timeZone))
                    : t('wiki.observedAt').replace('{date}', formatWikiDate(date, false, timeZone))}
                </span>
              )}
            </div>
          )}
          <WikiSourceLinks sources={item.sources} showEvidence={showEvidence} timeZone={timeZone} minutesBase={minutesBase} />
          {curateProjectId && (
            <WikiItemActions item={item} projectId={curateProjectId} />
          )}
        </div>
      </div>
    </article>
  )
}

function snapshotString(snapshot: Record<string, unknown> | null, keys: string[]): string | null {
  if (!snapshot) return null
  for (const key of keys) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function changeStatement(change: WikiChangeEvent): string | null {
  return snapshotString(change.afterSnapshot, ['statement', 'title', 'topic_title', 'topicTitle'])
    ?? snapshotString(change.beforeSnapshot, ['statement', 'title', 'topic_title', 'topicTitle'])
}

function changeLabel(type: string): string {
  const key = normalized(type)
  return CHANGE_KEYS.has(key)
    ? t(`wiki.change.${key}` as DictKey)
    : t('wiki.change.other')
}

function changeTone(type: string): { dot: string; badge: string; icon: LucideIcon } {
  const key = normalized(type)
  if (key === 'retract') {
    return { dot: 'bg-fg-muted', badge: 'bg-surface-subtle text-fg-muted', icon: FileText }
  }
  if (key === 'curate') {
    return { dot: 'bg-warning', badge: 'bg-warning/15 text-warning', icon: UserRoundCog }
  }
  if (['conflict', 'conflicted', 'withdrawn', 'reverse'].includes(key)) {
    return { dot: 'bg-danger', badge: 'bg-danger-weak text-danger', icon: AlertTriangle }
  }
  if (['resolved', 'resolve', 'confirmed', 'reconfirmed', 'reaffirm'].includes(key)) {
    return { dot: 'bg-success', badge: 'bg-success-weak text-success', icon: CheckCircle2 }
  }
  if (['superseded', 'supersede', 'updated', 'refined', 'refine'].includes(key)) {
    return { dot: 'bg-progress', badge: 'bg-progress-weak text-progress', icon: Scale }
  }
  return { dot: 'bg-action', badge: 'bg-action-soft text-action', icon: Lightbulb }
}

export function WikiChangeList({
  changes,
  limit,
  emptyText,
  timeZone,
  minutesBase = MINUTES_PERMALINK_BASE,
}: {
  changes: WikiChangeEvent[]
  limit?: number
  emptyText?: string
  /** instant 를 찍을 시간대(프로젝트 calendar.timezone) */
  timeZone: string
  /** 회의록 링크의 기준 경로 — 슬러그 워크스페이스의 '/w/<s>/minutes'. 없으면 영구 링크 형식 */
  minutesBase?: string
}) {
  const visible = typeof limit === 'number' ? changes.slice(0, limit) : changes
  if (visible.length === 0) {
    return <p className="py-5 text-center text-sm text-fg-secondary">{emptyText ?? t('wiki.noTimeline')}</p>
  }

  return (
    <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-border">
      {visible.map((change) => {
        const tone = changeTone(change.changeType)
        const Icon = tone.icon
        const statement = changeStatement(change)
        return (
          <li key={change.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
            <span className={`relative z-10 mt-1.5 h-[15px] w-[15px] rounded-full border-[4px] border-surface ${tone.dot}`} />
            <div className="min-w-0 rounded-xl border border-border/70 bg-surface-subtle/60 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`chip ${tone.badge}`}>
                  <Icon className="h-3 w-3" />
                  {changeLabel(change.changeType)}
                </span>
                <time className="text-meta tabular-nums text-fg-muted">
                  {formatWikiDate(change.createdAt, true, timeZone)}
                </time>
              </div>
              {statement && <p className="mt-2 text-sm font-medium leading-5 text-fg">{statement}</p>}
              <p className="mt-1 text-xs leading-5 text-fg-secondary">
                {change.reason ?? t('wiki.change.noReason')}
              </p>
              {change.minuteId && (
                <WikiTrackedLink
                  href={changeSourceHref(change, minutesBase)}
                  domain="minutes"
                  className="mt-2 inline-flex max-w-full items-center gap-1.5 text-meta font-medium text-action hover:text-action-hover"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {change.minuteDate ? `${formatWikiDate(change.minuteDate, false, timeZone)} · ` : ''}
                    {change.minuteTitle ?? t('wiki.viewSource')}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </WikiTrackedLink>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
