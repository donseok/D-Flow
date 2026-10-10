'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { deriveAccent } from '@/lib/settings/accent'
import type { AccentValue } from '@/lib/settings/accent'
import { newUuid } from '@/lib/domain/uuid'
import { ACCENT_TOKENS } from '@/lib/settings/accentTokens'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

function baseOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'object' && value !== null && typeof (value as { base?: unknown }).base === 'string') {
    return (value as { base: string }).base
  }
  return null
}

/** 서버는 base 색 하나에서 action 계열 토큰을 파생한다. */
export function AccentEditor({ workspaceId, revision, initialAccent, invalidReason }: {
  workspaceId: string; revision: number; initialAccent: AccentValue | null; invalidReason?: string
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [baseline, setBaseline] = useState<string | null>(initialAccent?.base ?? null)
  const [draft, setDraft] = useState<string | null>(initialAccent?.base ?? null)
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(!!invalidReason)
  const [conflict, setConflict] = useState<{ revision: number; value: string | null; invalid: boolean } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const preview = draft === null ? null : deriveAccent(draft)
  const dirty = needsRepair || draft !== baseline

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(draft); setBaseRevision(result.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.accent.saved')); router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, value: baseOf(result.latest.values['branding.accent']),
        invalid: result.latest.invalidKeys.includes('branding.accent') })
      setUncertainPatch(null); setFieldError(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const field = result.kind === 'invalid' ? result.fieldErrors.find(e => e.key === 'branding.accent') : undefined
      setFieldError(field?.message ?? null)
      setError(field ? null : (result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error))
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(draft); setBaseRevision(found.outcome.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
        setNotice(t('settings.save.confirmed')); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if ((!dirty && !uncertainPatch) || (preview && !preview.ok)) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'branding.accent': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-4 border-t border-border pt-5">
    <div>
      <h3 className="text-sm font-semibold text-fg">{t('settings.branding.accent.label')}</h3>
      <p className="mt-1 text-xs text-fg-secondary">{t('settings.accent.desc')}</p>
    </div>
    {invalidReason && needsRepair && <ConfigStateNotice kind="invalid" keyName="branding.accent" message={invalidReason} isAdmin settingsHref="#workspace-accent" />}
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="workspace-accent" className="text-sm text-fg">{t('settings.accent.base')}</label>
      <input id="workspace-accent" className="app-input w-32 font-mono text-sm" value={draft ?? ''} placeholder={ACCENT_TOKENS.light.action} maxLength={7}
        disabled={pending || !!uncertainPatch} onChange={event => setDraft(event.target.value || null)} />
      <input type="color" aria-label={t('settings.accent.pick')} value={/^#[0-9a-fA-F]{6}$/.test(draft ?? '') ? draft! : ACCENT_TOKENS.light.action}
        disabled={pending || !!uncertainPatch} onChange={event => setDraft(event.target.value)} />
      <button type="button" className="btn btn-ghost" disabled={pending || !!uncertainPatch || draft === null}
        onClick={() => setDraft(null)}>{t('settings.accent.reset')}</button>
    </div>
    {preview && !preview.ok && <ConfigStateNotice kind="field" message={`${preview.error} ${preview.failures.map(f => t('settings.accent.contrast').replace('{pair}', String(f.pair)).replace('{contrast}', String(f.contrast)).replace('{min}', String(f.min))).join(', ')}`} />}
    {fieldError && <ConfigStateNotice kind="field" message={fieldError} />}
    {preview?.ok && <div className="grid gap-3 sm:grid-cols-2">
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="p-4" style={{ backgroundColor: ACCENT_TOKENS.light.surface }}>
          <span className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: preview.value.light.bg, color: preview.value.light.fg }}>
            {t('settings.accent.light')}
          </span>
        </div>
        <p className="bg-surface-subtle px-4 py-2 font-mono text-meta text-fg-secondary">{preview.value.light.bg} · {preview.value.light.fg}</p>
      </div>
    </div>}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>{t('settings.accent.conflict')}</strong>
      <p>{t('settings.accent.conflictValues').replace('{draft}', String(draft ?? t('settings.accent.default'))).replace('{v}', String(conflict.invalid ? t('settings.notify.policy.corrupted') : conflict.value ?? t('settings.accent.default')))}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.value); setBaseRevision(conflict.revision); setNeedsRepair(conflict.invalid); setConflict(null) }}>{t('settings.conflict.reapplyMine')}</button>
        {!conflict.invalid && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.value); setBaseline(conflict.value); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>{t('settings.conflict.useLatest')}</button>}
      </div>
    </div>}
    {error && <ConfigStateNotice kind="patch" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict || !!(preview && !preview.ok)} onClick={save}>
        {uncertainPatch ? t('settings.workflow.retry') : t('settings.accent.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
