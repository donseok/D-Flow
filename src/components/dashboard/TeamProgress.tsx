import Link from 'next/link'
import { Users } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import type { Team } from '@/lib/domain/teams'
import { teamProgress } from '@/lib/domain/dashboard'
import { collectLeaves } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { teamSlotFor } from '@/lib/domain/teamColor'
import { teamLabelLookup } from '@/lib/domain/teamLabel'
import { t, type Locale } from '@/lib/i18n/dict'

/** 팀별 진척 — 팀 목록은 DashboardView 가 프로젝트 인식으로 주입한다(0071).
 *  주간 보고서 모달의 By owner 섹션과 같은 정의(teamProgress)를 대시보드에 상설 노출.
 *  담당 없는 팀은 바 0 + '-' 표기(0%와 구분). 글자는 팀 이름(집계 키는 code 그대로) — 긴 이름은 줄이고 title 로 전부 보인다.
 *  표시할 팀이 없으면(팀 0개·전부 비활성·전부 진척 숨김) 빈 카드 대신 사유와 팀 관리로 가는 길을 보인다 — 링크는 관리자에게만
 *  (teamSettingsHref — 설정의 팀 절은 관리자에게만 보인다). */
export function TeamProgress({ items, teams, locale = 'ko', teamSettingsHref = null }: {
  items: ComputedItem[]; teams: readonly Team[]; locale?: Locale; teamSettingsHref?: string | null
}) {
  // 표시 대상 = 활성 + progress_visible(팀 마스터) — 진척 제외 팀 규칙의 데이터화
  const shown = teams.filter(tm => tm.active && tm.progressVisible)
  const rows = teamProgress(collectLeaves(items), shown.map(tm => tm.code))
  const labelOf = teamLabelLookup(teams.filter(tm => tm.active))

  return (
    <SectionCard title={t(locale, 'dash.teamProgress.title')} icon={Users}>
      {rows.length === 0 ? (
        <EmptyState icon={Users} title={t(locale, 'dash.teamProgress.emptyTitle')} description={t(locale, 'dash.teamProgress.emptyDesc')}
          action={teamSettingsHref ? <Link href={teamSettingsHref} className="btn btn-primary">{t(locale, 'dash.teamProgress.emptyAction')}</Link> : undefined} />
      ) : (
      <div className="space-y-4">
        {rows.map(s => (
          <div key={s.team} data-team-progress={s.team} className="flex items-center gap-3">
            <span className="flex w-24 shrink-0 items-center gap-2 text-sm font-semibold text-fg sm:w-36" title={labelOf(s.team)}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${teamSlotFor(s.team, teams).bar}`} />
              <span className="truncate">{labelOf(s.team)}</span>
            </span>
            <span className="w-20 shrink-0 text-xs text-fg-muted">{t(locale, 'dash.teamProgress.taskCount').replace('{n}', String(s.count))}</span>
            <div className="min-w-0 flex-1">
              <ProgressBar value={s.pct ?? 0} tone={teamSlotFor(s.team, teams).bar} label={t(locale, 'dash.teamProgress.barLabel').replace('{pct}', String(s.pct ?? 0)).replace('{team}', () => labelOf(s.team))} />
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-fg">
              {s.pct == null ? '-' : `${s.pct}%`}
            </span>
          </div>
        ))}
      </div>
      )}
    </SectionCard>
  )
}
