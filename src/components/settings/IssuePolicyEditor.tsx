'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsPatch, type SettingsCommandResult } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { activeIssueAreas, type IssueAreaRef } from '@/lib/domain/issueAreas'
import { codeExample, parseIdPolicy, type IdPolicy } from '@/lib/issues/idPolicy'
import type { IssueAnalysisSetting } from '@/lib/settings/defs/project'
import { t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

export function IssuePolicyEditor({ projectId, policy, revision, areas, year, canEdit, analysis, analysisEnabled, locale = 'ko' }: {
  projectId: string; policy: IdPolicy; revision: number; areas: readonly IssueAreaRef[]; year: number; canEdit: boolean
  analysis: IssueAnalysisSetting; analysisEnabled: boolean; locale?: Locale
}) {
  useLocale()   // 영어 사전이 늦게 실리면 다시 그리게 구독만 한다 — 글자는 넘겨받은 locale 을 따른다
  const t = (k: DictKey) => translate(locale, k)
  const router = useRouter()
  const [draft, setDraft] = useState<IdPolicy>(policy)
  const [baseline, setBaseline] = useState(policy)
  const [mode, setMode] = useState(analysis)
  const [baseMode, setBaseMode] = useState(analysis)
  const [baseRevision, setBaseRevision] = useState(revision)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const parsed = parseIdPolicy(draft)
  const active = activeIssueAreas(areas)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || mode !== baseMode
  const labels = { prefix: t('settings.issuePolicy.prefix'), pattern: t('settings.issuePolicy.pattern'), scope: t('settings.issuePolicy.scope'), project: t('settings.issuePolicy.project'), area: t('settings.issuePolicy.area'), reset: t('settings.issuePolicy.reset'), never: t('settings.issuePolicy.never'), yearly: t('settings.issuePolicy.yearly'), example: t('settings.issuePolicy.example'), immutable: t('settings.issuePolicy.immutable'), analysis: t('settings.issuePolicy.analysis'), optional: t('settings.issuePolicy.optional'), required: t('settings.issuePolicy.required'), save: t('common.save'), disabled: t('settings.issuePolicy.disabled'), tokens: t('settings.issuePolicy.tokens') }
  async function submit(patch: SettingsPatch): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 명령 이력에서 반영 여부를 확인한다 */ }
    if (result?.ok) {
      const next = (patch.set['issues.id_policy'] as IdPolicy | undefined) ?? baseline
      const nextMode = (patch.set['issues.analysis'] as IssueAnalysisSetting | undefined) ?? baseMode
      setBaseline(next); setDraft(next); setBaseMode(nextMode); setMode(nextMode); setBaseRevision(result.revision)
      setUncertainPatch(null); setError(''); setNotice(t('settings.issuePolicy.saved'))
      router.refresh(); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) { setError(result.error); setUncertainPatch(null); return }
    try {
      const outcome = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (outcome.ok && outcome.outcome.status === 'applied') {
        const next = (patch.set['issues.id_policy'] as IdPolicy | undefined) ?? baseline
        const nextMode = (patch.set['issues.analysis'] as IssueAnalysisSetting | undefined) ?? baseMode
        setBaseline(next); setDraft(next); setBaseMode(nextMode); setMode(nextMode); setBaseRevision(outcome.outcome.revision)
        setUncertainPatch(null); setError(''); setNotice(t('settings.issuePolicy.confirmed'))
        router.refresh(); return
      }
    } catch { /* 같은 명령을 다시 보내도록 보류한다 */ }
    setUncertainPatch(patch); setError(t('settings.rootFolders.uncertain'))
  }
  function save() {
    if (!parsed.ok) { setError(parsed.error); return }
    const set: Record<string, unknown> = {}
    if (JSON.stringify(draft) !== JSON.stringify(baseline)) set['issues.id_policy'] = parsed.value
    if (mode !== baseMode) set['issues.analysis'] = mode
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set, unset: [] }
    setError(''); setNotice('')
    startTransition(() => { void submit(patch) })
  }
  function change<K extends keyof IdPolicy>(key: K, value: IdPolicy[K]) { setDraft(previous => ({ ...previous, [key]: value })); setError(''); setNotice('') }
  return <div className="space-y-4" data-issue-policy-editor>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{labels.prefix}<input aria-label={labels.prefix} className="app-input" value={draft.prefix} disabled={!canEdit || pending || !!uncertainPatch} maxLength={8} onChange={e => change('prefix', e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{labels.pattern}<input aria-label={labels.pattern} className="app-input" value={draft.pattern} disabled={!canEdit || pending || !!uncertainPatch} onChange={e => change('pattern', e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{labels.scope}<select aria-label={labels.scope} className="app-input" value={draft.counter_scope} disabled={!canEdit || pending || !!uncertainPatch} onChange={e => change('counter_scope', e.target.value as IdPolicy['counter_scope'])}><option value="project">{labels.project}</option><option value="area">{labels.area}</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{labels.reset}<select aria-label={labels.reset} className="app-input" value={draft.reset} disabled={!canEdit || pending || !!uncertainPatch} onChange={e => change('reset', e.target.value as IdPolicy['reset'])}><option value="never">{labels.never}</option><option value="yearly">{labels.yearly}</option></select></label>
    </div>
    <p className="text-xs text-fg-muted">{labels.tokens}</p>
    {!parsed.ok && <p role="alert" className="text-sm text-danger">{parsed.error}</p>}
    {parsed.ok && <p className="text-sm font-semibold text-fg">{labels.example}: {codeExample(parsed.value, { areaCode: active[0]?.code ?? null, year })}</p>}
    <p className="text-xs text-fg-secondary">{labels.immutable}</p>
    {analysisEnabled ? <label className="flex items-center gap-3 text-sm text-fg"><span>{labels.analysis}</span><select aria-label={labels.analysis} className="app-input w-auto" value={mode} disabled={!canEdit || pending || !!uncertainPatch} onChange={e => setMode(e.target.value as IssueAnalysisSetting)}><option value="optional">{labels.optional}</option><option value="required">{labels.required}</option></select></label> : <p className="text-xs text-fg-muted">{labels.disabled}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={!canEdit || pending || !dirty || !parsed.ok} onClick={save}>{pending ? '…' : uncertainPatch ? t('settings.workflow.retry') : labels.save}</button>
  </div>
}
