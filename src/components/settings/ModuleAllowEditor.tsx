'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { previewSettingsImpact, type SettingsImpactResult } from '@/app/actions/settingsPreview'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { NON_CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import { MODULE_LABEL } from '@/lib/modules/labels'
import { newUuid } from '@/lib/domain/uuid'
import type { Locale } from '@/lib/i18n/dict'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

const LABEL = MODULE_LABEL

const sameIds = (a: readonly ModuleId[], b: readonly ModuleId[]) => a.length === b.length && a.every(id => b.includes(id))
type Conflict = { revision: number; allowed: ModuleId[] | null }

export function ModuleAllowEditor({ workspaceId, initialAllowed, revision, invalidReason, requiredMissing = false, locale = 'ko' }: {
  workspaceId: string; initialAllowed: ModuleId[] | null; revision: number; invalidReason?: string; requiredMissing?: boolean; locale?: Locale
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [baseline, setBaseline] = useState<ModuleId[]>(initialAllowed ?? [])
  const [selected, setSelected] = useState<ModuleId[]>(initialAllowed ?? [])
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialAllowed === null)
  // 저장은 됐지만 백필이 실패한 상태 — 같은 값을 새 명령으로 다시 저장해야 백필이 다시 돈다
  const [needsResync, setNeedsResync] = useState(false)
  const [review, setReview] = useState<Extract<SettingsImpactResult, { ok: true }> | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || needsResync || !sameIds(baseline, selected)

  function toggle(id: ModuleId) {
    setSelected(NON_CORE_MODULES.filter(m => m === id ? !selected.includes(m) : selected.includes(m)))
    setReview(null)
    setConflict(null)
    setError(null)
    setFieldError(null)
  }

  function inspect() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      let result: SettingsImpactResult
      try { result = await previewSettingsImpact(workspaceId, selected) }
      catch { setError(t('settings.modules.impactFailed')); return }
      if (!result.ok) { setError(result.error); return }
      // 충돌은 문서 revision 이 아니라 이 키의 값으로 본다 — 같은 문서의 다른 편집기를 먼저 저장해도 revision 만 오른다.
      const latestSame = result.before === null ? needsRepair : sameIds(result.before, baseline)
      if (!latestSame) {
        setConflict({ revision: result.revision, allowed: result.before })
        return
      }
      setBaseRevision(result.revision)
      setReview(result)
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 결과 불명 — 이력에서 판정 */ }
    if (result?.ok) {
      setBaseline(selected)
      setBaseRevision(result.revision)
      setNeedsRepair(false)
      setNeedsResync(false)
      setFieldError(null)
      setReview(null)
      setUncertainPatch(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.moduleAllow.saved'))
      router.refresh()
      return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['modules.allowed']
      setConflict({ revision: result.latest.revision, allowed: Array.isArray(value) ? value as ModuleId[] : null })
      setReview(null)
      setUncertainPatch(null)
      return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      setReview(null)
      setUncertainPatch(null)
      if (result.kind === 'unavailable' && result.appliedRevision !== undefined) {
        // 값은 저장됐다 — 그 revision 을 기준으로 채택하고, 같은 값 재저장(백필 재시도)을 열어 둔다
        setBaseline(selected); setBaseRevision(result.appliedRevision); setNeedsRepair(false); setNeedsResync(true)
        setError(result.error); router.refresh(); return
      }
      setFieldError(result.kind === 'invalid' ? (result.fieldErrors.find(e => e.key === 'modules.allowed')?.message ?? null) : null)
      setError(result.kind === 'invalid' && result.fieldErrors.some(e => e.key === 'modules.allowed') ? null : result.error)
      return
    }
    // 응답 유실은 명령 이력을 먼저 확인한다.
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(selected)
        setBaseRevision(found.outcome.revision)
        setNeedsRepair(false)
        setNeedsResync(false)
        setFieldError(null)
        setReview(null)
        setUncertainPatch(null)
        setNotice(t('settings.save.confirmed'))
        router.refresh()
        return
      }
    } catch { /* 조회 불명도 같은 명령으로 다시 보낸다 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.moduleAllow.uncertain'))
  }

  function save() {
    if (!review && !uncertainPatch) return
    setError(null)
    startTransition(async () => {
      await submit(uncertainPatch ?? {
        expectedRevision: baseRevision, commandId: newUuid(), set: { 'modules.allowed': selected }, unset: [],
      })
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-fg-secondary">{t('settings.moduleAllow.desc')}</p>
      {needsRepair && (invalidReason || requiredMissing) && <ConfigStateNotice kind={requiredMissing ? 'required' : 'invalid'} locale={locale}
        keyName="modules.allowed" message={invalidReason} isAdmin settingsHref="#workspace-modules" />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {NON_CORE_MODULES.map(id => (
          <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg">
            <input type="checkbox" checked={selected.includes(id)} disabled={pending || !!uncertainPatch} onChange={() => toggle(id)} />
            <span>{LABEL[id as keyof typeof LABEL]}</span>
            <span className="ml-auto text-meta text-fg-muted">{id}</span>
          </label>
        ))}
      </div>
      {fieldError && <ConfigStateNotice kind="field" locale={locale} message={fieldError} />}
      {conflict && (
        <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
          <strong>{t('settings.moduleAllow.conflict')}</strong>
          <p>{t('settings.modules.mine')} {selected.map(id => LABEL[id as keyof typeof LABEL]).join(', ') || t('common.none')}</p>
          <p>{t('settings.modules.latest')} {conflict.allowed === null ? t('settings.modules.corruptedRepair') : conflict.allowed.map(id => LABEL[id as keyof typeof LABEL]).join(', ') || t('common.none')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.allowed ?? []); setNeedsRepair(conflict.allowed === null); setBaseRevision(conflict.revision); setConflict(null); setError(null) }}>{t('settings.modules.reviewMine')}</button>
            {conflict.allowed !== null && <button type="button" className="btn btn-ghost" onClick={() => { setSelected(conflict.allowed!); setBaseline(conflict.allowed!); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null); setError(null) }}>{t('settings.conflict.useLatest')}</button>}
          </div>
        </div>
      )}
      {review && (
        <div className="space-y-2 rounded-xl border border-border-focus bg-action-soft/30 p-4 text-sm">
          <strong>{t('settings.review.title')}</strong>
          <p>{t('settings.modules.added')} {selected.filter(id => !baseline.includes(id)).map(id => LABEL[id as keyof typeof LABEL]).join(', ') || t('common.none')}</p>
          <p>{t('settings.modules.removed')} {baseline.filter(id => !selected.includes(id)).map(id => LABEL[id as keyof typeof LABEL]).join(', ') || t('common.none')}</p>
          {review.impact === null ? <p>{t('settings.moduleAllow.corruptedImpact')}</p> : <>
            <p>{t('settings.moduleAllow.affected').replace('{affectedProjects}', String(review.impact.affectedProjects))}</p>
            {review.impact.removed.map(row => <p key={row.moduleId}>{t('settings.moduleAllow.perModule').replace('{v}', String(LABEL[row.moduleId as keyof typeof LABEL])).replace('{projectCount}', String(row.projectCount))}</p>)}
          </>}
          <p>{t('settings.moduleAllow.note')}</p>
        </div>
      )}
      {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
      <SettingsSaveBar notice={notice}>
        <button type="button" className="btn btn-ghost" disabled={pending || !dirty || !!conflict || !!uncertainPatch} onClick={inspect}>{t('settings.review.title')}</button>
        {(review || uncertainPatch) && <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{uncertainPatch ? t('settings.workflow.retry') : t('settings.modules.saveChanges')}</button>}
      </SettingsSaveBar>
    </div>
  )
}
