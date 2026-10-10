import type { ComputedItem } from '@/lib/domain/types'
import { buildExecSummary, type DashboardThresholds, type Signal } from '@/lib/domain/dashboard'
import { formatPct1, formatPp1 } from '@/lib/domain/format'
import { t, type DictKey } from '@/lib/i18n/dict'
import { fmtDate } from '@/components/wbs/shared'
import { ProgressGauge } from './ProgressGauge'
import { SignalTile } from './SignalTile'
import { ReportButton } from '@/components/report/ReportButton'

const VERDICT_KEY: Record<Exclude<Signal, 'neutral'>, DictKey> = {
  green: 'dash.exec.verdictOnTrack',
  amber: 'dash.exec.verdictCaution',
  red: 'dash.exec.verdictAtRisk',
}
const statusWord = (sig: Signal, tr: (k: DictKey) => string): string =>
  sig === 'neutral' ? tr('dash.exec.early') : tr(VERDICT_KEY[sig])

export async function ExecSummary({
  items, projectId, projectName, projectDescription, startDate, endDate, today,
  milestoneKeywords,
  canGenerateBrief = false,
  topLevelLabel = null,
  thresholds,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate: string | null
  endDate: string | null
  today: string
  /** 프로젝트 설정(project_settings)의 마일스톤 키워드 — page.tsx 가 getProjectConfig 로 주입. */
  milestoneKeywords: readonly string[]
  /** 보고서 모달의 AI 브리핑 인라인 생성 권한(프로젝트 관리자 이상). 기본 false = fail-closed. */
  canGenerateBrief?: boolean
  /** 1레벨 단계 이름(core.level_labels 첫 값) — 보고서 모달의 진척 표 머리. 손상·미주입이면 null(모달이 중립 문구) */
  topLevelLabel?: string | null
  /** 그 프로젝트의 판정 기준(설정 dashboard.*) — 임박 창·지연 '위험' 건수. 없으면 제품 기본값 */
  thresholds?: DashboardThresholds
}) {
  const tr = t
  const s = buildExecSummary(items, { startDate, endDate, today }, milestoneKeywords, thresholds)

  // 게이지 중앙 배지는 진척(실적 vs 계획) 판정만 반영한다. 큰 실적%·편차와 같은 위계라
  // 종합(worst-of)을 얹으면 "+0.3%p 앞서는데 위험"처럼 수치와 모순돼 읽힌다.
  // 일정·리스크·마일스톤은 우측 3개 타일이 각자 신호로 담당한다.
  const verdict = statusWord(s.progress.signal, tr)
  const plannedText = `${tr('dash.plannedLabel')} ${formatPct1(s.progress.planned)}% · ${formatPp1(s.progress.variance)}%p`

  const schedValue =
    s.schedule.label === 'none' ? tr('dash.exec.noSchedule')
    : s.schedule.label === 'done' ? tr('dash.exec.doneLabel')
    : `D+${s.schedule.elapsed}`
  const schedSub =
    s.schedule.label === 'onTrack' && s.schedule.projectedEnd ? `${tr('dash.exec.projectedEnd')} ${fmtDate(s.schedule.projectedEnd)}`
    : s.schedule.label === 'early' ? tr('dash.exec.early')
    : s.schedule.label === 'none' ? null
    : `${s.schedule.remaining}${tr('dash.unitDays')}`

  // 마일스톤 타일: 값 슬롯에 정량 D-day(다른 타일과 동일 위계), 이름·날짜는 sub로.
  const hasMs = s.milestone.name != null
  const msValue = hasMs
    ? (s.milestone.overdue ? tr('dash.exec.overdue') : `D-${s.milestone.dday}`)
    : tr('dash.exec.noMilestone')
  const msSub = hasMs
    ? `${s.milestone.name}${s.milestone.date ? ` · ${fmtDate(s.milestone.date)}` : ''}`
    : null

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-meta font-semibold text-fg-muted">{tr('dash.exec.eyebrow')}</div>
          <h2 className="mt-0.5 truncate text-base font-bold text-fg">{projectName}</h2>
        </div>
        <ReportButton
          variant="surface" label={tr('dash.exec.reportTitle')} projectId={projectId} items={items} projectName={projectName}
          projectDescription={projectDescription} today={today} startDate={startDate} endDate={endDate}
          canGenerate={canGenerateBrief} topLevelLabel={topLevelLabel}
        />
      </div>

      <div className="grid items-center gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-center gap-4">
          <ProgressGauge
            actual={s.progress.actual} planned={s.progress.planned} variance={s.progress.variance}
            signal={s.progress.signal} verdictText={verdict} plannedText={plannedText}
            label={tr('dash.exec.progressLabel')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SignalTile label={tr('dash.exec.scheduleLabel')} value={schedValue} sub={schedSub}
            signal={s.schedule.signal} statusText={statusWord(s.schedule.signal, tr)} />
          <SignalTile label={tr('dash.exec.riskLabel')} value={`${s.risk.delayed + s.risk.dueSoon}${tr('dash.unitCount')}`}
            sub={`${tr('dash.exec.delayed')} ${s.risk.delayed} · ${tr('dash.exec.dueSoon')} ${s.risk.dueSoon}`}
            signal={s.risk.signal} statusText={statusWord(s.risk.signal, tr)} />
          <SignalTile label={tr('dash.exec.milestoneLabel')} value={msValue} sub={msSub}
            signal={s.milestone.signal} statusText={statusWord(s.milestone.signal, tr)} />
        </div>
      </div>
    </section>
  )
}
