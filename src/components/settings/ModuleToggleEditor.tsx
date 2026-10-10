'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { previewProjectSettingsImpact, type ProjectSettingsImpactResult } from '@/app/actions/settingsPreview'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { newUuid } from '@/lib/domain/uuid'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface ProjectModuleOption { id: ModuleId; label: string; allowed: boolean; available: boolean }
type Conflict = { revision: number; enabled: ModuleId[] | null }
const sameIds = (a: readonly ModuleId[], b: readonly ModuleId[]) => a.length === b.length && a.every(id => b.includes(id))

export function ModuleToggleEditor({ projectId, revision, initialEnabled, invalidReason, requiredMissing = false, options }: {
  projectId: string; revision: number; initialEnabled: ModuleId[] | null; invalidReason?: string; requiredMissing?: boolean
  options: ProjectModuleOption[];
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [baseline, setBaseline] = useState<ModuleId[]>(initialEnabled ?? [])
  const [selected, setSelected] = useState<ModuleId[]>(initialEnabled ?? [])
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialEnabled === null)
  const [review, setReview] = useState<Extract<ProjectSettingsImpactResult, { ok: true }> | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const option = new Map(options.map(o => [o.id, o]))
  const editable = options.filter(o => o.allowed && o.available)
  const enabledRows = editable.filter(o => selected.includes(o.id))
  const disabledRows = editable.filter(o => !selected.includes(o.id))
  const retained = options.filter(o => selected.includes(o.id) && (!o.allowed || !o.available))
  const unavailable = options.filter(o => !selected.includes(o.id) && (!o.allowed || !o.available))
  const dirty = needsRepair || !sameIds(baseline, selected)
  const label = (id: ModuleId) => option.get(id)?.label ?? id

  function toggle(id: ModuleId) {
    setSelected(PROJECT_TOGGLABLE.has(id) ? (selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]) : selected)
    setReview(null); setConflict(null); setError(null); setFieldError(null); setNotice(null)
  }

  function inspect() {
    setError(null); setNotice(null)
    startTransition(async () => {
      let result: ProjectSettingsImpactResult
      try { result = await previewProjectSettingsImpact(projectId, selected) }
      catch { setError(t('settings.modules.impactFailed')); return }
      if (!result.ok) { setError(result.error); return }
      // 충돌은 문서 revision 이 아니라 이 키의 값으로 본다 — 같은 문서의 다른 편집기를 먼저 저장해도 revision 만 오른다.
      const latestSame = result.before === null ? needsRepair : sameIds(result.before, baseline)
      if (!latestSame) { setConflict({ revision: result.revision, enabled: result.before }); return }
      setBaseRevision(result.revision)
      setReview(result)
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(selected); setBaseRevision(result.revision); setNeedsRepair(false); setReview(null); setUncertainPatch(null); setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.moduleToggle.saved'))
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['modules.enabled']
      setConflict({ revision: result.latest.revision, enabled: Array.isArray(value) ? value as ModuleId[] : null })
      setReview(null); setUncertainPatch(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      setReview(null); setUncertainPatch(null)
      if (result.kind === 'unavailable' && result.appliedRevision !== undefined) {
        // 값은 저장됐다 — 그 revision 을 기준으로 채택해야 안내된 복구(껐다 다시 켜기)가 저장 가능하다
        setBaseline(selected); setBaseRevision(result.appliedRevision); setNeedsRepair(false)
        setError(result.error); router.refresh(); return
      }
      setFieldError(result.kind === 'invalid' ? (result.fieldErrors.find(e => e.key === 'modules.enabled')?.message ?? null) : null)
      setError(result.kind === 'invalid' && result.fieldErrors.some(e => e.key === 'modules.enabled') ? null : result.error)
      return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(selected); setBaseRevision(found.outcome.revision); setNeedsRepair(false); setReview(null); setUncertainPatch(null); setFieldError(null)
        setNotice(t('settings.save.confirmed')); router.refresh(); return
      }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if (!review && !uncertainPatch) return
    setError(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'modules.enabled': selected }, unset: [] }
    startTransition(async () => submit(patch))
  }

  const row = (o: ProjectModuleOption) => <label key={o.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
    <input type="checkbox" checked={selected.includes(o.id)} disabled={pending || !!uncertainPatch} onChange={() => toggle(o.id)} />
    <span className="shrink-0 whitespace-nowrap">{o.label}</span><span className="ml-auto min-w-0 truncate text-xs text-fg-muted" title={o.id}>{o.id}</span>
  </label>

  return <div className="space-y-4">
    <p className="text-xs leading-5 text-fg-secondary">{t('settings.moduleToggle.desc')}</p>
    {needsRepair && (invalidReason || requiredMissing) && <ConfigStateNotice kind={requiredMissing ? 'required' : 'invalid'}
      keyName="modules.enabled" message={invalidReason} isAdmin settingsHref="#project-modules" />}
    <div className="grid gap-2 sm:grid-cols-2">{enabledRows.map(row)}</div>
    {disabledRows.length > 0 && <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium text-fg">{t('settings.moduleToggle.offCount').replace('{n}', String(disabledRows.length))}</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{disabledRows.map(row)}</div>
    </details>}
    {retained.length > 0 && <div className="rounded-xl border border-pending/30 bg-pending-weak p-3 text-xs">
      <p className="font-semibold">{t('settings.moduleToggle.keptNote')}</p>
      <p>{retained.map(o => o.label).join(', ')}</p>
    </div>}
    {unavailable.length > 0 && <p className="text-xs text-fg-muted">{t('settings.moduleToggle.unavailable').replace('{v}', String(unavailable.map(o => o.label).join(', ')))}</p>}
    {fieldError && <ConfigStateNotice kind="field" message={fieldError} />}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>{t('settings.moduleToggle.conflict')}</strong>
      <p>{t('settings.modules.mine')} {selected.map(label).join(', ') || t('common.none')}</p>
      <p>{t('settings.modules.latest')} {conflict.enabled === null ? t('settings.modules.corruptedRepair') : conflict.enabled.map(label).join(', ') || t('common.none')}</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.enabled ?? []); setNeedsRepair(conflict.enabled === null); setBaseRevision(conflict.revision); setConflict(null) }}>{t('settings.modules.reviewMine')}</button>
        {conflict.enabled !== null && <button type="button" className="btn btn-ghost" onClick={() => { setSelected(conflict.enabled!); setBaseline(conflict.enabled!); setNeedsRepair(false); setBaseRevision(conflict.revision); setConflict(null) }}>{t('settings.conflict.useLatest')}</button>}
      </div>
    </div>}
    {review && <div className="space-y-1 rounded-xl border border-border-focus bg-action-soft/30 p-4 text-sm">
      <strong>{t('settings.review.title')}</strong>
      <p>{t('settings.modules.added')} {selected.filter(id => !baseline.includes(id)).map(label).join(', ') || t('common.none')}</p>
      <p>{t('settings.modules.removed')} {baseline.filter(id => !selected.includes(id)).map(label).join(', ') || t('common.none')}</p>
      {review.impact === null ? <p>{t('settings.moduleToggle.corruptedImpact')}</p> :
        review.impact.removed.map(x => <p key={x.moduleId}>{label(x.moduleId)}: {x.dataCount === null ? x.dataLabel : t('settings.moduleToggle.dataCount').replace('{dataLabel}', String(x.dataLabel)).replace('{dataCount}', String(x.dataCount))}</p>)}
      <p>{t('settings.moduleToggle.note')}</p>
    </div>}
    {error && <ConfigStateNotice kind="patch" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-ghost" disabled={pending || !dirty || !!conflict || !!uncertainPatch} onClick={inspect}>{t('settings.review.title')}</button>
      {(review || uncertainPatch) && <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{uncertainPatch ? t('settings.workflow.retry') : t('settings.modules.saveChanges')}</button>}
    </SettingsSaveBar>
  </div>
}
