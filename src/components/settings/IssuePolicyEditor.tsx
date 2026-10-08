'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsPatch, type SettingsCommandResult } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { activeIssueAreas, type IssueAreaRef } from '@/lib/domain/issueAreas'
import { codeExample, parseIdPolicy, type IdPolicy } from '@/lib/issues/idPolicy'
import type { IssueAnalysisSetting } from '@/lib/settings/defs/project'
import type { Locale } from '@/lib/i18n/dict'

export function IssuePolicyEditor({ projectId, policy, revision, areas, year, canEdit, analysis, analysisEnabled, locale = 'ko' }: {
  projectId: string; policy: IdPolicy; revision: number; areas: readonly IssueAreaRef[]; year: number; canEdit: boolean
  analysis: IssueAnalysisSetting; analysisEnabled: boolean; locale?: Locale
}) {
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
  const labels = locale === 'ko' ? { prefix: '접두', pattern: '패턴', scope: '번호 범위', project: '프로젝트 전체', area: '영역별', reset: '번호 초기화', never: '초기화하지 않음', yearly: '매년', example: '코드 예시', immutable: '기존 이슈의 코드는 바뀌지 않습니다.', analysis: '분석 분류 입력', optional: '선택', required: '필수', save: '저장', disabled: '분석 모듈이 꺼져 있습니다. 모듈·메뉴에서 켜세요.', tokens: '사용할 수 있는 토큰: {prefix}, {area}, {yyyy}, {yy}, {seq:n} (n은 2~6)' } : { prefix: 'Prefix', pattern: 'Pattern', scope: 'Counter scope', project: 'Project', area: 'Area', reset: 'Reset', never: 'Never', yearly: 'Yearly', example: 'Code example', immutable: 'Existing issue codes do not change.', analysis: 'Analysis fields on issue entry', optional: 'Optional', required: 'Required', save: 'Save', disabled: 'Issue analysis is off. Turn it on under Modules & menu.', tokens: 'Tokens: {prefix}, {area}, {yyyy}, {yy}, {seq:n} (n is 2–6)' }
  async function submit(patch: SettingsPatch): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 명령 이력에서 반영 여부를 확인한다 */ }
    if (result?.ok) {
      const next = (patch.set['issues.id_policy'] as IdPolicy | undefined) ?? baseline
      const nextMode = (patch.set['issues.analysis'] as IssueAnalysisSetting | undefined) ?? baseMode
      setBaseline(next); setDraft(next); setBaseMode(nextMode); setMode(nextMode); setBaseRevision(result.revision)
      setUncertainPatch(null); setError(''); setNotice(locale === 'ko' ? '이슈 설정을 저장했습니다.' : 'Issue settings saved.')
      router.refresh(); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) { setError(result.error); setUncertainPatch(null); return }
    try {
      const outcome = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (outcome.ok && outcome.outcome.status === 'applied') {
        const next = (patch.set['issues.id_policy'] as IdPolicy | undefined) ?? baseline
        const nextMode = (patch.set['issues.analysis'] as IssueAnalysisSetting | undefined) ?? baseMode
        setBaseline(next); setDraft(next); setBaseMode(nextMode); setMode(nextMode); setBaseRevision(outcome.outcome.revision)
        setUncertainPatch(null); setError(''); setNotice(locale === 'ko' ? '저장된 이슈 설정을 확인했습니다.' : 'Confirmed saved issue settings.')
        router.refresh(); return
      }
    } catch { /* 같은 명령을 다시 보내도록 보류한다 */ }
    setUncertainPatch(patch); setError(locale === 'ko' ? '저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.' : 'Could not confirm the save. Retry the same command to check it.')
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
    <button type="button" className="btn btn-primary" disabled={!canEdit || pending || !dirty || !parsed.ok} onClick={save}>{pending ? '…' : uncertainPatch ? (locale === 'ko' ? '저장 결과 확인 및 재시도' : 'Confirm or retry save') : labels.save}</button>
  </div>
}
