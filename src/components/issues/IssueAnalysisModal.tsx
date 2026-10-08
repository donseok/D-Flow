'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Loader2,
  Presentation,
  Sparkles,
} from 'lucide-react'
import { ensureIssueAnalysisAction } from '@/app/actions/issueAnalysis'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import type { Issue } from '@/lib/domain/issues'
import {
  type IssueAreaFilter,
} from '@/lib/domain/issueAnalysis'
import {
  buildIssueAnalysisPreflight,
  type IssueAnalysisReport,
} from '@/lib/report/issues/model'
import type { IssueAnalysisPptExport } from '@/lib/report/forms/issueAnalysisExport'

interface AnalysisResult {
  runId: string
  analysis: IssueAnalysisReport
  pptExport: IssueAnalysisPptExport
}

export function IssueAnalysisModal({
  open,
  onClose,
  projectId,
  issues,
  areas,
  areaFilter = 'all',
}: {
  open: boolean
  onClose: () => void
  projectId: string
  areas: readonly IssueAreaRef[]
  issues: Issue[]
  areaFilter?: IssueAreaFilter
}) {
  const { t } = useLocale()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scopedIssues = useMemo(
    () => areaFilter === 'all'
      ? issues
      : issues.filter(issue => issue.areaId === areaFilter),
    [issues, areaFilter],
  )
  const preflight = useMemo(() => buildIssueAnalysisPreflight(scopedIssues, areas), [scopedIssues, areas])
  const populatedAreas = preflight.areas.filter(area => area.count > 0)
  const canGenerate = preflight.totalCount > 0 && preflight.blockedCount === 0
  const selectedArea = areaFilter === 'all'
    ? null
    : areas.find(area => area.id === areaFilter) ?? null
  const scopeLabel = selectedArea
    ? `${selectedArea.code} · ${selectedArea.name}`
    : t('issue.analysis.scopeAll')

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
  }, [open, issues, areaFilter])

  function generate() {
    if (!canGenerate || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const response = await ensureIssueAnalysisAction(projectId, areaFilter)
        if (
          response.ok
          && response.runId
          && response.analysis
          && (response.state === 'ready' || response.state === 'generated')
        ) {
          setResult({
            runId: response.runId,
            analysis: response.analysis,
            // 액션이 판정을 싣지 않았으면 모르는 상태다 — 닫는다
            pptExport: response.pptExport ?? { status: 'unavailable', reason: 'form_setting_unknown' },
          })
          return
        }
        setResult(null)
        setError(response.error ?? t('issue.analysis.unavailable'))
      } catch (cause) {
        setResult(null)
        setError(cause instanceof Error && cause.message
          ? cause.message
          : t('issue.analysis.unavailable'))
      }
    })
  }

  // 받을 수 있는 조건: 저장된 실행(runId)이 있고 양식 설정(forms.issue_analysis_pptx)이 읽힌다. 모듈은 액션이 이미 닫았다.
  const canDownload = result?.pptExport.status === 'ready'
  const exportBlocked = result && result.pptExport.status === 'unavailable'
    ? t(result.pptExport.reason === 'form_setting_invalid'
      ? 'issue.analysis.exportFormInvalid'
      : 'issue.analysis.exportFormUnknown')
    : undefined

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={onClose} disabled={pending} className="btn btn-ghost text-xs">
        {t('issue.analysis.close')}
      </button>
      {result && (
        canDownload ? (
          <a
            href={`/api/issue-analysis?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(result.runId)}`}
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            <Presentation className="h-3.5 w-3.5" />
            {t('issue.analysis.download')}
          </a>
        ) : (
          <button
            type="button"
            disabled
            title={exportBlocked}
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            <Presentation className="h-3.5 w-3.5" />
            {t('issue.analysis.download')}
          </button>
        )
      )}
      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate || pending}
        className="btn btn-primary inline-flex items-center gap-1.5 text-xs"
      >
        {pending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="h-3.5 w-3.5" />}
        {pending ? t('issue.analysis.generating') : t('issue.analysis.generate')}
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose() }}
      eyebrow="Issue analysis"
      title={t('issue.analysis.title')}
      size="lg"
      footer={footer}
    >
      <div className="space-y-5">
        <p className="text-sm leading-6 text-fg-secondary">{t('issue.analysis.desc')}</p>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-subtle px-4 py-3">
          <span className="text-xs font-medium text-fg-secondary">{t('issue.analysis.scope')}</span>
          <span className="chip bg-action-soft text-action">{scopeLabel}</span>
        </div>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-success/30 bg-success-weak p-4">
            <div className="text-xs font-semibold text-success">
              {t('issue.analysis.readyCount').replace('{n}', String(preflight.readyCount))}
            </div>
          </div>
          <div className={`rounded-2xl border p-4 ${
            preflight.blockedCount > 0
              ? 'border-danger/30 bg-danger-weak'
              : 'border-border bg-surface-subtle'
          }`}>
            <div className={`text-xs font-semibold ${
              preflight.blockedCount > 0 ? 'text-danger' : 'text-fg-secondary'
            }`}>
              {t('issue.analysis.blockedCount').replace('{n}', String(preflight.blockedCount))}
            </div>
          </div>
        </section>

        {populatedAreas.length > 0 && (
          <section>
            <div className="mb-2 text-meta font-semibold text-fg-muted">
              {t('issue.analysis.area')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {populatedAreas.map(area => (
                <span key={area.areaCode} className="chip bg-surface-subtle text-fg">
                  {area.areaCode} · {area.areaName} {area.count}
                </span>
              ))}
            </div>
          </section>
        )}

        {preflight.totalCount === 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-border bg-surface-subtle p-4 text-sm text-fg-secondary">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
            {t('issue.empty.title')}
          </div>
        ) : preflight.blockedCount === 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success-weak p-4 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {t('issue.analysis.preflightOk')}
          </div>
        ) : (
          <section className="rounded-2xl border border-danger/30 bg-danger-weak p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertTriangle className="h-4 w-4" />
              {t('issue.analysis.blockedTitle')}
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {preflight.blockedIssues.map(issue => (
                <Link
                  key={issue.id}
                  href={`/p/${encodeURIComponent(projectId)}/issues?focus=${encodeURIComponent(issue.id)}`}
                  className="block rounded-xl border border-danger/20 bg-surface px-3 py-2 transition hover:border-danger/50"
                  onClick={onClose}
                >
                  <div className="text-xs font-semibold text-fg">{issue.label}</div>
                  <div className="mt-1 text-meta leading-5 text-fg-secondary">
                    {issue.reasons.join(' · ')}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-danger/40 bg-danger-weak p-4 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-action" />
              <h3 className="text-sm font-semibold text-fg">{t('issue.analysis.opportunities')}</h3>
            </div>
            {result.analysis.areas.filter(area => area.opportunities.length > 0).map(area => (
              <div key={area.areaCode} className="rounded-2xl border border-border bg-surface-subtle p-4">
                <div className="text-xs font-semibold text-fg">
                  {area.areaCode} · {area.areaName}
                </div>
                <div className="mt-3 space-y-3">
                  {area.opportunities.map((opportunity, index) => {
                    const issueCodes = opportunity.issueIds
                      .map(id => area.issues.find(issue => issue.id === id)?.code)
                      .filter((code): code is string => Boolean(code))
                    return (
                      <article key={`${area.areaCode}-${index}`} className="rounded-xl border border-border bg-surface p-3">
                        <div className="text-sm font-semibold text-fg">{opportunity.title}</div>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-fg-secondary">
                          {opportunity.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {issueCodes.map(code => (
                            <span key={code} className="chip bg-action-soft text-action">{code}</span>
                          ))}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            ))}
            {exportBlocked && (
              <div className="flex items-start gap-2 rounded-2xl border border-pending/35 bg-pending-weak p-4 text-xs leading-5 text-pending">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">{t('issue.analysis.exportUnavailable')}</div>
                  <div className="mt-0.5">{exportBlocked}</div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
