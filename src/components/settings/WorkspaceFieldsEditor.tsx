'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import type { DictKey, Locale } from '@/lib/i18n/dict'
import { ConflictCompare } from './ConflictCompare'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

export type SimpleWorkspaceKey = 'ai.enabled' | 'invites.allowed_domains' | 'branding.product_name' | 'branding.mail_from_name'
export interface WorkspaceField {
  key: SimpleWorkspaceKey
  label: string
  description: string
  kind: 'boolean' | 'text' | 'domains'
  value: string | boolean
  source: 'workspace' | 'deploy' | 'product' | 'corrupted'
  error?: string
}
type Draft = Record<string, string | boolean>
/** 값 출처(페이지가 넘기는 코드값) → 화면 글자의 사전 키 */
const SOURCE_KEY: Readonly<Record<WorkspaceField['source'], DictKey>> = {
  'workspace': 'settings.wsFields.source.workspace', 'deploy': 'settings.wsFields.source.deploy',
  'product': 'settings.wsFields.source.product', 'corrupted': 'settings.notify.policy.corrupted',
}
type Conflict = { revision: number; values: Partial<Record<SimpleWorkspaceKey, unknown>>; invalidKeys: string[] }

function initial(fields: WorkspaceField[]): Draft { return Object.fromEntries(fields.map(f => [f.key, f.value])) }
function inputValue(field: WorkspaceField, value: unknown): string | boolean {
  if (field.kind === 'boolean') return value === true
  if (field.kind === 'domains') return Array.isArray(value) ? value.join('\n') : ''
  return typeof value === 'string' ? value : ''
}
function stored(field: WorkspaceField, value: string | boolean): unknown {
  if (field.kind === 'domains') return String(value).split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  if (field.key === 'branding.mail_from_name') return String(value).trim() || null
  return value
}
function same(a: string | boolean, b: string | boolean): boolean { return a === b }

/** 영향 검토가 필요 없는 워크스페이스 키를 범주 단위로 저장한다. */
export function WorkspaceFieldsEditor({ workspaceId, revision, fields, locale = 'ko' }: {
  workspaceId: string; revision: number; fields: WorkspaceField[]; locale?: Locale
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(() => initial(fields))
  const [baseline, setBaseline] = useState<Draft>(() => initial(fields))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [repaired, setRepaired] = useState<string[]>([])
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SimpleWorkspaceKey, string>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 저장되는 값으로 비교한다 — 공백만 넣은 메일 발신 이름(→ null)·빈 줄뿐인 도메인 목록이 '변경'으로 새지 않게
  const differs = (f: WorkspaceField) => !same(draft[f.key], baseline[f.key]) && JSON.stringify(stored(f, draft[f.key])) !== JSON.stringify(stored(f, baseline[f.key]))
  const changed = fields.filter(f => differs(f) || (f.source === 'corrupted' && !repaired.includes(f.key)))

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline({ ...draft }); setBaseRevision(result.revision); setRepaired([...repaired, ...changed.map(f => f.key)])
      setUncertainPatch(null); setConflict(null); setFieldErrors({})
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.wsFields.saved').replace('{n}', String(changed.length)))
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, values: result.latest.values, invalidKeys: result.latest.invalidKeys })
      setUncertainPatch(null); setFieldErrors({}); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const entries = result.kind === 'invalid' ? result.fieldErrors.filter(e => fields.some(f => f.key === e.key)).map(e => [e.key, e.message] as const) : []
      setFieldErrors(Object.fromEntries(entries))
      setError(entries.length > 0 ? null : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline({ ...draft }); setBaseRevision(found.outcome.revision); setRepaired([...repaired, ...changed.map(f => f.key)])
        setUncertainPatch(null); setFieldErrors({}); setNotice(t('settings.save.confirmed')); router.refresh(); return
      }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if (changed.length === 0 && !uncertainPatch) return
    setError(null); setFieldErrors({}); setNotice(null)
    const set = Object.fromEntries(changed.map(f => [f.key, stored(f, draft[f.key])]))
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set, unset: [] }
    startTransition(async () => submit(patch))
  }

  function edit(key: SimpleWorkspaceKey, value: string | boolean) {
    setDraft(current => ({ ...current, [key]: value }))
    setFieldErrors(current => { const next = { ...current }; delete next[key]; return next })
    setError(null); setNotice(null)
  }

  function chooseMine() {
    if (!conflict) return
    // 내가 고친 키만 내 값을 남긴다(baseline 만 최신으로). 안 고친 키는 draft 도 최신으로 올려 상대 변경을 되돌리지 않는다.
    const nextBaseline = { ...baseline }
    const nextDraft = { ...draft }
    for (const f of fields) {
      if (conflict.invalidKeys.includes(f.key)) continue
      if (!Object.prototype.hasOwnProperty.call(conflict.values, f.key)) continue
      const latest = inputValue(f, conflict.values[f.key])
      if (same(draft[f.key], baseline[f.key])) nextDraft[f.key] = latest
      nextBaseline[f.key] = latest
    }
    setDraft(nextDraft); setBaseline(nextBaseline); setBaseRevision(conflict.revision); setConflict(null); setError(null)
  }

  function chooseLatest() {
    if (!conflict) return
    const next = { ...draft }
    for (const f of fields) {
      if (conflict.invalidKeys.includes(f.key)) continue
      if (Object.prototype.hasOwnProperty.call(conflict.values, f.key)) next[f.key] = inputValue(f, conflict.values[f.key])
    }
    setDraft(next); setBaseline(next); setBaseRevision(conflict.revision); setConflict(null); setError(null)
  }

  return <div className="space-y-4">
    {fields.map(field => <div key={field.key} className="space-y-1.5 border-b border-border pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`workspace-${field.key}`} className="text-sm font-semibold text-fg">{field.label}</label>
        <span className="text-xs text-fg-muted">{t('settings.wsFields.sourceImmediate').replace('{source}', t(SOURCE_KEY[field.source]))}</span>
      </div>
      <p className="text-xs text-fg-secondary">{field.description}</p>
      {field.error && !repaired.includes(field.key) && <ConfigStateNotice kind="invalid" locale={locale} keyName={field.key}
        message={field.error} isAdmin settingsHref={`#workspace-${field.key}`} />}
      {field.kind === 'boolean' ?
        <input id={`workspace-${field.key}`} type="checkbox" checked={draft[field.key] === true}
          disabled={pending || !!uncertainPatch} onChange={e => edit(field.key, e.target.checked)} /> :
        field.kind === 'domains' ?
          <textarea id={`workspace-${field.key}`} className="app-textarea min-h-24 w-full text-sm" value={String(draft[field.key])}
            disabled={pending || !!uncertainPatch} onChange={e => edit(field.key, e.target.value)} placeholder={t('settings.wsFields.domainsPh')} /> :
          <input id={`workspace-${field.key}`} className="app-input w-full text-sm" value={String(draft[field.key])}
            disabled={pending || !!uncertainPatch} onChange={e => edit(field.key, e.target.value)} />}
      {fieldErrors[field.key] && <ConfigStateNotice kind="field" locale={locale} message={fieldErrors[field.key]} />}
      <p className="text-meta text-fg-muted">{field.key}</p>
    </div>)}
    {conflict && <ConflictCompare rows={changed.map(f => ({ key: f.key, label: f.label,
      mine: String(draft[f.key]), latest: conflict.invalidKeys.includes(f.key) ? t('settings.notify.policy.corrupted') : String(inputValue(f, conflict.values[f.key])),
    }))} onMine={chooseMine} onLatest={chooseLatest} latestAvailable={changed.every(f => !conflict.invalidKeys.includes(f.key))} />}
    {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
    {/* 공용 저장 바(data-save-bar — 셸의 떠 있는 버튼이 저장 바를 가리지 않게 찾는 표지, SP3b 알림 13·D33) */}
    <SettingsSaveBar notice={notice} summary={t('settings.wsFields.changed').replace('{n}', String(changed.length))}>
      <button type="button" className="btn btn-primary" disabled={pending || (!changed.length && !uncertainPatch) || !!conflict} onClick={save}>
        {uncertainPatch ? t('settings.workflow.retry') : t('common.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
