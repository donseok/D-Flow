'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import type { Locale } from '@/lib/i18n/dict'
import { ConflictCompare } from './ConflictCompare'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

const lines = (text: string) => text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
const display = (values: readonly string[]) => values.join('\n')

export function MilestoneKeywordsEditor({ projectId, revision, initial, source, invalidReason, locale = 'ko' }: {
  projectId: string; revision: number; initial: string[]; source: string; invalidReason?: string; locale?: Locale
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [text, setText] = useState(() => display(initial))
  const [baseline, setBaseline] = useState(() => display(initial))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [repair, setRepair] = useState(Boolean(invalidReason))
  const [conflict, setConflict] = useState<{ revision: number; latest: string[] | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [pending, startTransition] = useTransition()
  const dirty = repair || text !== baseline

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 이력에서 결과 확인 */ }
    if (result?.ok) {
      setBaseline(text); setBaseRevision(result.revision); setRepair(false); setConflict(null); setUncertainPatch(null)
      setReviewing(false)
      setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.milestoneKw.saved'))
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['core.milestone_keywords']
      setConflict({ revision: result.latest.revision,
        latest: result.latest.invalidKeys.includes('core.milestone_keywords') ? null : Array.isArray(value) ? value as string[] : null })
      setUncertainPatch(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const fieldMessage = result.kind === 'invalid' ? result.fieldErrors.find(e => e.key === 'core.milestone_keywords')?.message : undefined
      setFieldError(fieldMessage ?? null)
      setError(fieldMessage ? null : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(text); setBaseRevision(found.outcome.revision); setRepair(false); setUncertainPatch(null); setFieldError(null)
        setNotice(found.outcome.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.save.confirmed')); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재시도 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if (!dirty && !uncertainPatch) return
    const values = lines(text)
    if (values.length > 50 || values.some(value => value.length > 40)) {
      setFieldError(t('settings.milestoneKw.limit')); return
    }
    if (!reviewing && !uncertainPatch) { setError(null); setReviewing(true); return }
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'core.milestone_keywords': values }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="milestone-keywords" className="text-sm font-semibold text-fg">{t('settings.core.milestone_keywords.label')}</label>
      <span className="text-xs text-fg-muted">{repair ? t('settings.notify.policy.corrupted') : source} {t('settings.appliesNowSuffix')}</span>
    </div>
    <p className="text-xs text-fg-secondary">{t('settings.milestoneKw.desc')}</p>
    {repair && <ConfigStateNotice kind="invalid" locale={locale} keyName="core.milestone_keywords" message={invalidReason}
      isAdmin settingsHref="#milestone-keywords" />}
    <textarea id="milestone-keywords" className="app-textarea min-h-28 w-full text-sm" value={text}
      disabled={pending || !!uncertainPatch} onChange={event => { setText(event.target.value); setReviewing(false); setError(null); setFieldError(null); setNotice(null) }} placeholder={t('settings.milestoneKw.placeholder')} />
    {fieldError && <ConfigStateNotice kind="field" locale={locale} message={fieldError} />}
    <p className="text-meta text-fg-muted">{t('settings.milestoneKw.lowercase')}</p>
    {reviewing && !conflict && !uncertainPatch && <section aria-label={t('settings.review.title')} className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3 text-sm">
      <h3 className="font-semibold text-fg">{t('settings.review.title')}</h3>
      <p className="text-fg-secondary">{t('settings.milestoneKw.current')} {lines(baseline).join(', ') || t('common.none')}</p>
      <p className="text-fg-secondary">{t('settings.milestoneKw.next')} {lines(text).join(', ') || t('common.none')}</p>
      <p className="text-fg-secondary">{t('settings.milestoneKw.reviewNote')}</p>
      <button type="button" className="btn btn-secondary" onClick={() => setReviewing(false)}>{t('settings.credits.keepEditing')}</button>
    </section>}
    {conflict && <ConflictCompare rows={[{ key: 'keywords', label: t('settings.core.milestone_keywords.label'),
      mine: lines(text).join(', '), latest: conflict.latest?.join(', ') ?? t('settings.notify.policy.corrupted'),
    }]} latestAvailable={conflict.latest !== null}
      onMine={() => { setBaseline(display(conflict.latest ?? [])); setBaseRevision(conflict.revision); setReviewing(false); setConflict(null) }}
      onLatest={() => { const next = display(conflict.latest ?? []); setText(next); setBaseline(next); setBaseRevision(conflict.revision); setRepair(false); setReviewing(false); setConflict(null) }} />}
    {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict} onClick={save}>
        {uncertainPatch ? t('settings.workflow.retry') : reviewing ? t('settings.review.saveAfter') : t('settings.review.title')}
      </button>
    </SettingsSaveBar>
  </div>
}
