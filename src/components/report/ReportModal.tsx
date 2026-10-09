'use client'

import { useEffect, useState } from 'react'
import { useTeamLabel, useTeamSlot, useTeams } from '@/components/app/TeamsProvider'
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  FileSpreadsheet,
  Layers,
  Loader2,
  Presentation,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ensureProjectBriefAction, getProjectBriefAction } from '@/app/actions/brief'
import { buildReportModel } from '@/lib/report/model'
import { Modal } from '@/components/ui/Modal'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { StatusPill } from '@/components/ui/StatusPill'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

/** 'YYYY-MM-DD' → '2026년 9월 15일'(꼴은 사전의 reportUi.dateFull) */
function fmtFull(d: string | null | undefined, t: (k: DictKey) => string): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return t('reportUi.dateFull').replace('{y}', y).replace('{m}', String(Number(m))).replace('{d}', String(Number(day)))
}

/**
 * 주간 보고서 모달 — Excel·PPT 다운로드 가능한 보고서 본문. (인쇄/PDF 버튼은 사용자 요청으로 제거)
 * 화면은 buildReportModel(전체 실적/계획·편차는 대시보드와 같은 소수 1자리, 나머지 표는 정수),
 * Excel은 buildWeeklyReportModel(소수 1자리)을 사용한다.
 */
export function ReportModal({
  open,
  onClose,
  projectId,
  items,
  projectName,
  projectDescription,
  today,
  startDate,
  endDate,
  canGenerate,
  topLevelLabel = null,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  items: ComputedItem[]
  projectName: string
  projectDescription?: string | null
  today: string
  startDate?: string | null
  endDate?: string | null
  /** 인라인 'AI 브리핑 생성' 노출 여부 = isProjectAdmin(actor, projectId).
   *  ensureProjectBriefAction 은 requireProjectAdmin 이라 권한이 없으면 항상 실패한다 —
   *  버튼을 남겨 두면 그 거부가 '생성 실패 — 다시 시도'로 표시돼 장애로 오인된다. */
  canGenerate: boolean
  /** 1레벨 단계 이름(core.level_labels 첫 값) — 진척 표의 머리·제목에 쓴다. 못 받으면(설정 손상 등) 유형 중립 문구 */
  topLevelLabel?: string | null
}) {
  const { t } = useLocale()
  const topLabel = topLevelLabel?.trim() || t('reportUi.topFallback')
  // '팀별 진척' 대상 = 활성 + progressVisible(팀 마스터) — 대시보드 카드와 동일 기준
  const progressTeams = useTeams().filter(tm => tm.progressVisible).map(tm => tm.code)
  const slotOf = useTeamSlot()
  const teamLabelOf = useTeamLabel()   // 팀별 표의 글자는 팀 이름 — 모델의 키(team)는 code 그대로
  const model = buildReportModel(
    items,
    { name: projectName, description: projectDescription, start_date: startDate, end_date: endDate },
    today,
    progressTeams,
  )
  const { meta, kpi, phases, delayed, teams } = model

  // ── PPT 'AI 코멘트 포함' — 신선한 캐시가 있을 때만 활성(LLM 0콜 조회). stale/부재면
  // 인라인 생성 버튼을 노출한다. 409 최종 방어는 서버(/api/report ai=1)가 담당하고
  // 여기는 평시 게이트만 — 실패는 문구로 정직하게 표시(조용한 비활성 금지).
  const [aiStatus, setAiStatus] = useState<'loading' | 'fresh' | 'stale' | 'none' | 'failed'>('loading')
  const [aiChecked, setAiChecked] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [pptBusy, setPptBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setAiStatus('loading')
    setAiChecked(false)
    setAiError(null)
    getProjectBriefAction(projectId)
      .then(r => { if (alive) setAiStatus(r.failed ? 'failed' : r.fresh ? 'fresh' : r.hasBrief ? 'stale' : 'none') })
      .catch(() => { if (alive) setAiStatus('failed') })
    return () => { alive = false }
  }, [open, projectId])

  const generateBrief = async () => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const r = await ensureProjectBriefAction(projectId)
      if (r.state !== 'unavailable' && r.fresh) { setAiStatus('fresh'); setAiChecked(true) }
      else setAiStatus('failed')
    } catch {
      setAiStatus('failed')
    } finally {
      setAiBusy(false)
    }
  }

  const withAi = aiChecked && aiStatus === 'fresh'
  const pptHref = `/api/report?projectId=${encodeURIComponent(projectId)}&format=pptx${withAi ? '&ai=1' : ''}`

  // ai=1 다운로드는 fetch 경유 — <a download> 는 서버 409(브리핑 stale)의 JSON 안내를
  // 사용자에게 보여줄 수 없어 무설명 실패가 된다(리뷰 확정). 모달을 열어둔 사이 데이터가
  // 바뀌는 레이스에서 409 원인을 인라인으로 표시하고 신선도 게이트를 되돌린다.
  const downloadAiPpt = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!withAi || pptBusy) { if (pptBusy) e.preventDefault(); return }
    e.preventDefault()
    setPptBusy(true)
    setAiError(null)
    try {
      const res = await fetch(pptHref)
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        setAiError(j?.error ?? t('reportUi.ai.downloadFailed'))
        if (res.status === 409) { setAiStatus('stale'); setAiChecked(false) }
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''([^;]+)/)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m ? decodeURIComponent(m[1]) : 'report.pptx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setAiError(t('reportUi.downloadFailed'))
    } finally {
      setPptBusy(false)
    }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className="no-print btn btn-ghost">
        {t('common.close')}
      </button>
      <label className={`no-print flex items-center gap-1.5 text-xs ${aiStatus === 'fresh' ? 'text-fg-secondary' : 'text-fg-muted'}`}
        title={aiStatus === 'fresh' ? t('reportUi.ai.includeHintFresh') : t('reportUi.ai.includeHintStale')}>
        <input type="checkbox" checked={withAi} disabled={aiStatus !== 'fresh'}
          onChange={e => setAiChecked(e.target.checked)} className="h-3.5 w-3.5 accent-(--color-action)" />
        {t('reportUi.ai.include')}
      </label>
      {(aiStatus === 'stale' || aiStatus === 'none' || aiStatus === 'failed') && (
        canGenerate ? (
          <button type="button" onClick={generateBrief} disabled={aiBusy}
            className="no-print btn btn-ghost !text-xs disabled:opacity-60">
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiBusy ? t('reportUi.ai.generating') : aiStatus === 'failed' ? t('reportUi.ai.retry') : t('reportUi.ai.generate')}
          </button>
        ) : (
          <span className="no-print text-xs text-fg-muted">{t('reportUi.ai.adminOnly')}</span>
        )
      )}
      <a
        href={`/api/report?projectId=${encodeURIComponent(projectId)}&format=xlsx`}
        className="no-print btn btn-ghost"
        download
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </a>
      <a
        href={pptHref}
        onClick={downloadAiPpt}
        className={`no-print btn btn-ghost ${pptBusy ? 'pointer-events-none opacity-60' : ''}`}
        download
      >
        {pptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
        PPT
      </a>
      {aiError && <span className="no-print w-full text-right text-xs text-warning">{aiError}</span>}
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title={t('reportUi.title')} size="lg" footer={footer}>
      <div className="print-area space-y-6">
        {/* ── 보고서 헤더 ── */}
        <header className="card overflow-hidden p-6">
          <div className="eyebrow">{t('reportUi.title')}</div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-fg">{meta.projectName}</h2>
          {meta.description && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">{meta.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-muted">
            <span>
              {t('reportUi.meta.created')} <span className="font-semibold text-fg-secondary">{fmtFull(meta.today, t)}</span>
            </span>
            {(meta.startDate || meta.endDate) && (
              <span>
                {t('reportUi.meta.period')}{' '}
                <span className="font-semibold text-fg-secondary">
                  {fmtFull(meta.startDate, t)} ~ {fmtFull(meta.endDate, t)}
                </span>
              </span>
            )}
            <span>
              {t('reportUi.meta.totalTasks')} <span className="font-semibold text-fg-secondary">{t('reportUi.count').replace('{n}', String(meta.totalLeaves))}</span>
            </span>
          </div>
        </header>

        {/* ── 전체 요약 KPI ── */}
        {/* 열 수는 모달 폭(672px)에 맞춘다 — 4열이면 28px 수치가 칸을 넘고 아이콘과 겹친다(U1b 수정 G4) */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard label={t('reportUi.kpi.actual')} value={`${kpi.actual}%`} sub={t('reportUi.kpi.actualSub')} icon={Activity} tone="brand" />
          <KpiCard label={t('reportUi.kpi.planned')} value={`${kpi.planned}%`} sub={t('reportUi.kpi.plannedSub')} icon={CalendarRange} tone="default" />
          <KpiCard
            label={t('reportUi.kpi.variance')}
            value={`${kpi.variance > 0 ? '+' : ''}${kpi.variance}%p`}
            sub={kpi.variance >= 0 ? t('reportUi.kpi.ahead') : t('reportUi.kpi.behind')}
            icon={kpi.variance >= 0 ? TrendingUp : TrendingDown}
            tone={kpi.variance >= 0 ? 'success' : 'danger'}
          />
          <KpiCard
            label={t('reportUi.kpi.delayed')}
            value={String(kpi.delayedCount)}
            sub={t('reportUi.kpi.delayedSub').replace('{n}', String(meta.totalLeaves))}
            icon={AlertTriangle}
            tone="danger"
          />
        </section>

        {/* ── 1레벨 단계별 진척 ── */}
        <SectionCard title={t('reportUi.phase.title').replace('{label}', () => topLabel)} icon={Layers}>
          {phases.length === 0 ? (
            <p className="text-sm text-fg-secondary">{t('reportUi.phase.empty').replace('{label}', () => topLabel)}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-meta leading-4 text-fg-muted">
                  <th className="py-2 pr-3 font-semibold">{topLabel}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('reportUi.col.plan')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('reportUi.col.actual')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('reportUi.col.variance')}</th>
                  <th className="py-2 pl-3 text-right font-semibold">{t('reportUi.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p, i) => (
                  <tr key={i} className="border-b border-border/70 last:border-0">
                    <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-fg" title={p.name}>
                      {p.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{p.plannedPct}%</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-fg">{p.actualPct}%</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${p.variance >= 0 ? 'text-success' : 'text-danger'}`}>
                      {p.variance > 0 ? '+' : ''}
                      {p.variance}%p
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── 지연 작업 목록 ── */}
        <SectionCard title={t('reportUi.delayed.title')} icon={AlertTriangle}>
          {delayed.length === 0 ? (
            <p className="text-sm text-fg-secondary">{t('reportUi.delayed.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-meta leading-4 text-fg-muted">
                  <th className="py-2 pr-3 font-semibold">{t('reportUi.col.task')}</th>
                  <th className="px-3 py-2 font-semibold">{t('reportUi.col.owner')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('reportUi.col.end')}</th>
                  <th className="py-2 pl-3 text-right font-semibold">{t('reportUi.col.actual')}</th>
                </tr>
              </thead>
              <tbody>
                {delayed.map((l, i) => (
                  <tr key={i} className="border-b border-border/70 last:border-0">
                    <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-fg" title={l.name}>
                      {l.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <OwnerBadges owners={l.owners} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-danger">{fmtDate(l.plannedEnd)}</td>
                    <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-fg">{l.actualPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── 팀별 진척현황 ── */}
        <SectionCard title={t('reportUi.team.title')} icon={Users}>
          <div className="space-y-4">
            {teams.map(s => (
              <div key={s.team} className="flex items-center gap-3">
                <span className="flex w-24 shrink-0 items-center gap-2 text-sm font-semibold text-fg sm:w-36" title={teamLabelOf(s.team)}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${slotOf(s.team).bar}`} />
                  <span className="truncate">{teamLabelOf(s.team)}</span>
                </span>
                <span className="w-20 shrink-0 text-xs text-fg-muted">{t('reportUi.team.count').replace('{n}', String(s.count))}</span>
                <div className="min-w-0 flex-1">
                  <ProgressBar value={s.pct ?? 0} tone={slotOf(s.team).bar} />
                </div>
                <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-fg">
                  {s.pct == null ? '-' : `${s.pct}%`}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </Modal>
  )
}
