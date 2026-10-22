'use client'
import { useState } from 'react'
import { Check, Copy, Download, FileCode, FileText } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  formatDesignSpecMarkdown,
  type DesignPriority,
  type DesignRuleKind,
  type DesignSpec,
} from '@/lib/domain/mockup'

const PRIORITY_CHIP: Record<DesignPriority, string> = {
  high: 'bg-danger-weak text-danger',
  medium: 'bg-progress-weak text-progress',
  low: 'bg-surface-subtle text-fg-secondary',
}

const RULE_CHIP: Record<DesignRuleKind, string> = {
  data: 'bg-progress-weak text-progress',
  api: 'bg-success-weak text-success',
  auth: 'bg-warning/15 text-warning',
  constraint: 'bg-danger-weak text-danger',
}

/**
 * 추출된 프로그램 설계서(DesignSpec) 미리보기 및 내보내기(마크다운 복사·다운로드·원문 보기).
 * 모든 텍스트는 순수 텍스트 노드로만 렌더해 스크립트·HTML 주입을 원천 차단한다.
 */
export function DesignSpecPreview({ spec }: { spec: DesignSpec }) {
  const { t } = useLocale()
  const [rawMode, setRawMode] = useState(false)
  const [copied, setCopied] = useState(false)
  const markdown = formatDesignSpecMarkdown(spec)

  async function onCopyMarkdown() {
    try {
      if (!navigator.clipboard?.writeText) {
        setRawMode(true)
        return
      }
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // 클립보드 권한이 없는 환경에서는 원문 보기로 전환해 직접 복사할 수 있게 한다
      setRawMode(true)
    }
  }

  function onDownloadMarkdown() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = (spec.title || 'design-spec').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'design-spec'
    a.download = `${safeName}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-testid="design-spec-preview" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <h3 className="text-base font-bold text-fg">{spec.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRawMode(v => !v)}
            className="btn btn-ghost h-8 px-2.5 text-xs"
          >
            {rawMode ? <FileText aria-hidden className="h-3.5 w-3.5" /> : <FileCode aria-hidden className="h-3.5 w-3.5" />}
            {rawMode ? t('min.spec.viewFormatted') : t('min.spec.viewRaw')}
          </button>
          <button
            type="button"
            onClick={() => void onCopyMarkdown()}
            className="btn btn-ghost h-8 px-2.5 text-xs"
          >
            {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-success" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
            {copied ? t('min.spec.copied') : t('min.spec.copyMd')}
          </button>
          <button
            type="button"
            onClick={onDownloadMarkdown}
            className="btn btn-ghost h-8 px-2.5 text-xs"
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            {t('min.spec.downloadMd')}
          </button>
        </div>
      </div>

      {rawMode ? (
        <pre
          data-testid="design-spec-markdown"
          className="max-h-[28rem] overflow-auto rounded-xl border border-border bg-surface-subtle p-3 text-xs leading-relaxed text-fg whitespace-pre-wrap"
        >
          {markdown}
        </pre>
      ) : (
        <div className="space-y-4">
          {spec.overview && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold text-fg">{t('min.spec.secOverview')}</h4>
              <p className="rounded-xl border border-border bg-surface-subtle p-3 text-sm leading-relaxed text-fg-secondary">
                {spec.overview}
              </p>
            </section>
          )}

          {spec.requirements.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold text-fg">{t('min.spec.secRequirements')}</h4>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-left text-xs font-semibold text-fg-secondary">
                      <th className="px-2.5 py-2">{t('min.spec.colId')}</th>
                      <th className="px-2.5 py-2">{t('min.spec.colCategory')}</th>
                      <th className="px-2.5 py-2">{t('min.spec.colPriority')}</th>
                      <th className="px-2.5 py-2">{t('min.spec.colRequirement')}</th>
                      <th className="px-2.5 py-2">{t('min.spec.colDetail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.requirements.map((r, i) => (
                      <tr key={`${r.id}-${i}`} className="border-b border-border last:border-b-0">
                        <td className="whitespace-nowrap px-2.5 py-2 font-mono text-xs text-fg-muted">{r.id}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-xs text-fg-secondary">{r.category}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">
                          <span className={`chip ${PRIORITY_CHIP[r.priority]}`}>
                            {t(`min.spec.priority.${r.priority}`)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2 font-medium text-fg">{r.title}</td>
                        <td className="px-2.5 py-2 text-fg-secondary">{r.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {spec.screens.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold text-fg">{t('min.spec.secScreens')}</h4>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {spec.screens.map((s, idx) => (
                  <div key={`${s.id}-${idx}`} className="rounded-xl border border-border bg-surface p-3 space-y-1.5">
                    <div className="font-semibold text-sm text-fg">{s.name}</div>
                    {s.purpose && (
                      <p className="text-xs text-fg-secondary">
                        <span className="font-medium text-fg-muted">{t('min.spec.screenPurpose')}: </span>
                        {s.purpose}
                      </p>
                    )}
                    {s.elements.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {s.elements.map((el, i) => (
                          <span key={i} className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-secondary">
                            {el}
                          </span>
                        ))}
                      </div>
                    )}
                    {s.flow && (
                      <p className="text-xs text-fg-muted">
                        <span className="font-medium">{t('min.spec.screenFlow')}: </span>
                        {s.flow}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {spec.rules.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold text-fg">{t('min.spec.secRules')}</h4>
              <ul className="space-y-1.5">
                {spec.rules.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2 rounded-xl border border-border bg-surface p-2.5 text-sm">
                    <span className={`chip shrink-0 ${RULE_CHIP[r.kind]}`}>
                      {t(`min.spec.rule.${r.kind}`)}
                    </span>
                    <span className="font-medium text-fg">{r.title}</span>
                    {r.detail && <span className="text-fg-secondary">— {r.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {spec.openQuestions.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold text-fg">{t('min.spec.secQuestions')}</h4>
              <ul className="list-disc space-y-1 rounded-xl border border-border bg-surface-subtle py-2.5 pl-7 pr-3 text-sm text-fg-secondary">
                {spec.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
