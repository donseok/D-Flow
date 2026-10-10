import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import { ISSUE_STATUSES, ISSUE_STATUS_META, type IssueStatus } from '@/lib/domain/issues'
import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import {
  issueKpis, issueAreaBreakdown, issueStatusCounts, topSeverity, RESOLVED_WINDOW_DAYS,
  type DashboardIssue, type IssueStatusCounts,
} from '@/lib/domain/issueDashboard'
import { DEFAULT_ISSUE_STATUSES, DEFAULT_SEVERITIES, VOCAB_COLOR_CLASS, vocabLabel, type IssueStatusDef, type SeverityDef } from '@/lib/settings/vocab'
import { addDaysIso } from '@/lib/domain/dates'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t} from '@/lib/i18n/dict'
import { MiniEmpty } from './bits'
import { RingGauge } from './RingGauge'

/**
 * 이슈 현황 카드(A안 · 링 게이지, 2026-08-28) — 큰 해결률 링 + KPI 2×2 + Mega 영역별 미니 링 타일.
 * 집계는 전부 domain/issueDashboard 가 하고 여기서는 표시만 한다(재계산 금지).
 * 색은 이슈관리 화면의 ISSUE_STATUS_META dot 토큰 그대로 — 두 화면의 색 언어를 맞춘다.
 * 동기 컴포넌트다 — renderToStaticMarkup 으로 검증 가능.
 */

/** 타일 상태 점 상한 — 넘치면 +N. 점 하나가 이슈 하나라 수십 건 영역에서 줄이 길어지는 것을 막는다. */
const DOT_CAP = 14

/** 이슈 1건 = 점 1개(상태색, ISSUE_STATUSES 순). 색만으로 읽히지 않게 타일 title 이 건수를 글로 나른다. */
function StatusDots({ counts, total, dotOf }: { counts: IssueStatusCounts; total: number; dotOf: (s: IssueStatus) => string }) {
  const dots: IssueStatus[] = []
  for (const s of ISSUE_STATUSES) for (let i = 0; i < counts[s] && dots.length < DOT_CAP; i += 1) dots.push(s)
  const rest = total - dots.length
  return (
    <div className="flex flex-wrap items-center gap-[3px]" aria-hidden>
      {dots.map((s, i) => <i key={i} data-dot={s} className={`inline-block h-[7px] w-[7px] rounded-[2px] ${dotOf(s)}`} />)}
      {rest > 0 && <span className="ml-0.5 text-meta font-semibold text-fg-muted">+{rest}</span>}
    </div>
  )
}

/**
 * 범주(제품 고정 4종)의 표시 — 집계는 범주로 하지만, 그 범주의 활성 상태가 하나뿐인 프로젝트(이름·색만 바꾼 흔한 경우)는 그 상태의 이름·색으로 그린다
 * (설정 workflow.issue_statuses). 한 범주에 상태가 여럿이면 묶음 이름이 따로 없어 범주 기본 이름을 쓴다. 기본 정의 그대로면 종전 표시와 같다.
 */
function categoryView(statuses: readonly IssueStatusDef[] | undefined, tr: typeof t): (s: IssueStatus) => { label: string; dot: string } {
  return (s) => {
    const base = { label: tr(ISSUE_STATUS_META[s].labelKey), dot: ISSUE_STATUS_META[s].dot }
    const inCat = (statuses ?? []).filter(d => d.active && d.category === s)
    if (inCat.length !== 1) return base
    const def = inCat[0], std = DEFAULT_ISSUE_STATUSES.find(d => d.code === s)
    if (std && def.code === std.code && def.label === std.label && def.color === std.color) return base
    return { label: vocabLabel('workflow.issue_statuses', inCat, def.code, tr), dot: VOCAB_COLOR_CLASS[def.color].dot }
  }
}

export function IssueStatusCard({ issues, projectId, today, timeZone, areas, severities = DEFAULT_SEVERITIES, statuses }: {
  /** 이 프로젝트의 이슈 표시 상태(설정 workflow.issue_statuses) — 범주 이름·색에 쓴다. 넘기지 않으면 제품 기본 이름 */
  statuses?: readonly IssueStatusDef[]
  /** 이 프로젝트의 이슈 심각도(설정 issues.severities) — '가장 높은 심각도 · 미해결' 칸의 기준과 이름. 넘기지 않으면 제품 기본 3단계 */
  severities?: readonly SeverityDef[]
  areas: readonly IssueAreaRef[]
  issues: DashboardIssue[]
  projectId: string
  /** 실제 오늘(그 프로젝트 tz 의 todayIn) — 공정율 base_date 가 아니다. */
  today: string
  /** 프로젝트 calendar.timezone — 해결 시각을 날짜로 바꾼다 */
  timeZone: string
}) {
  const tr = t
  const unit = tr('dash.unitCount')
  const viewOf = categoryView(statuses, tr)
  const statusLabel = (s: IssueStatus) => viewOf(s).label
  const dotOf = (s: IssueStatus) => viewOf(s).dot
  const countsText = (c: IssueStatusCounts) =>
    ISSUE_STATUSES.filter(s => c[s] > 0).map(s => `${statusLabel(s)} ${c[s]}`).join(' · ')

  const kpi = issueKpis(issues, today, timeZone, severities)
  // 기본 심각도(높음)면 종전 문구, 이름·단계를 바꾼 프로젝트는 그 프로젝트의 최상위 심각도 이름으로 적는다
  const top = topSeverity(severities)
  const defaultTop = DEFAULT_SEVERITIES.find(d => d.code === top?.code)
  const topLabel = !top || (defaultTop && defaultTop.label === top.label)
    ? tr('dash.issues.kpiHigh') : tr('dash.issues.kpiTop').replace('{label}', () => top.label)
  const all = issueStatusCounts(issues)
  const rows = issueAreaBreakdown(issues, areas)
  const resolvedPct = kpi.total ? Math.round((all.resolved / kpi.total) * 100) : 0
  const windowStart = addDaysIso(today, -(RESOLVED_WINDOW_DAYS - 1))

  const actions = (
    <>
      <span className="chip bg-surface-subtle text-fg-muted">{tr('dash.issues.totalPrefix')}{kpi.total}{unit}</span>
      <Link href={`/p/${projectId}/issues`} className="text-xs font-semibold text-action hover:underline">
        {tr('dash.issues.open')} →
      </Link>
    </>
  )

  if (issues.length === 0) {
    return (
      <SectionCard title={tr('dash.issues.title')} icon={CircleAlert} actions={actions}>
        <MiniEmpty text={tr('dash.issues.empty')} />
      </SectionCard>
    )
  }

  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: tr('dash.issues.kpiUnresolved'), value: kpi.unresolved },
    { label: tr('dash.issues.kpiOverdue'), value: kpi.overdue, tone: kpi.overdue > 0 ? 'text-danger' : undefined },
    { label: topLabel, value: kpi.highUnresolved, tone: kpi.highUnresolved > 0 ? 'text-warning' : undefined },
    { label: tr('dash.issues.kpiResolved7d'), value: kpi.resolved7d, tone: 'text-success' },
  ]

  return (
    <SectionCard title={tr('dash.issues.title')} icon={CircleAlert} actions={actions}>
      <div className="space-y-5">
        {/* 히어로 — 해결률 링 + KPI 2×2. sm 미만은 링을 위에 가운데로, KPI 를 아래로 쌓는다(360px 에서 2×2 가 넘치지 않게).
            서브라인은 히어로 블록 안에 둔다 — space-y 의 margin 이 이기므로 음수 마진으로 당기지 않는다. */}
        <div className="space-y-2">
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5">
            <div className="justify-self-center">
              <RingGauge pct={resolvedPct} size={132} stroke={12} label={`${tr('dash.issues.resolvedRate')} ${resolvedPct}%`}>
                <div>
                  <b className="block text-[30px] font-extrabold leading-none tracking-tight text-fg">{resolvedPct}%</b>
                  <span className="mt-1 block text-meta font-semibold text-fg-muted">{tr('dash.issues.resolvedRate')}</span>
                </div>
              </RingGauge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map(k => (
                <div key={k.label} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-surface-subtle/50 px-3 py-2">
                  <span className="truncate text-meta text-fg-secondary">{k.label}</span>
                  <b className={`shrink-0 text-lg font-bold leading-none ${k.tone ?? 'text-fg'}`}>{k.value}</b>
                </div>
              ))}
            </div>
          </div>
          <p className="text-meta text-fg-muted">
            {tr('dash.issues.kpiUnresolvedSub').replace('{n}', String(kpi.total))} · {tr('dash.issues.kpiResolved7d')} {fmtDate(windowStart)}–{fmtDate(today)}
          </p>
        </div>

        {/* Mega 업무영역별 — 미니 링 타일(8영역 코드순 고정 + 미분류는 있을 때만). 이슈 없는 영역은 흐리게. */}
        <div>
          <div className="mb-2 flex justify-between text-meta text-fg-muted">
            <span>{tr('dash.issues.byAreaRate')}</span><span>{tr('dash.issues.ringHint')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
            {rows.map(r => {
              const area = areas.find(a => a.id === r.areaId)
              const name = area?.name ?? r.label
              const empty = r.total === 0
              const title = empty ? `${name}: ${tr('dash.issues.noIssues')}` : `${name}: ${countsText(r.counts)}`
              return (
                <div key={r.areaId ?? 'none'} title={title}
                  className={`flex min-w-0 flex-col gap-1.5 rounded-xl border border-border p-2.5 ${empty ? 'opacity-60' : ''}`}>
                  {/* 상태 내역은 글로도 — 점(aria-hidden)·title(호버 전용)만으론 키보드·스크린리더 경로가 없다 */}
                  {!empty && <span className="sr-only">{countsText(r.counts)}</span>}
                  <div className="flex min-w-0 items-center gap-2">
                    <RingGauge pct={r.resolvedPct} size={34} stroke={5}
                      label={r.resolvedPct === null ? `${name} ${tr('dash.issues.noIssues')}` : `${name} ${tr('dash.issues.resolvedRate')} ${r.resolvedPct}%`}>
                      <b className="text-[9px] font-bold tracking-tighter text-fg">{r.resolvedPct === null ? '–' : `${r.resolvedPct}%`}</b>
                    </RingGauge>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-fg">
                        <span className="mr-1 text-meta font-semibold tabular-nums text-fg-muted">{area?.code ?? '–'}</span>{name}
                      </div>
                      <div className="text-meta text-fg-muted">
                        {empty ? tr('dash.issues.noIssues') : `${r.total}${unit} · ${tr('dash.issues.trendResolvedShort')} ${r.counts.resolved}`}
                      </div>
                    </div>
                  </div>
                  {!empty && <StatusDots counts={r.counts} total={r.total} dotOf={dotOf} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* 범례 — 점 순서(ISSUE_STATUSES 고정)를 글로도 알린다(적록 색각 보강). */}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-meta text-fg-secondary">
          <span className="text-fg-muted">{tr('dash.issues.legendOrder')}</span>
          {ISSUE_STATUSES.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-[2px] ${dotOf(s)}`} aria-hidden />
              <span>{statusLabel(s)}</span> <b className="font-semibold tabular-nums text-fg">{all[s]}</b>
            </span>
          ))}
        </div>

        <p className="text-meta leading-4 text-fg-muted">{tr('dash.issues.caption').replace('{d}', fmtDate(today))}</p>
      </div>
    </SectionCard>
  )
}
