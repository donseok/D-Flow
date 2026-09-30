'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { ConflictCompare } from './ConflictCompare'

export type SimpleWorkspaceKey = 'ai.enabled' | 'invites.allowed_domains' | 'branding.product_name' | 'branding.mail_from_name'
export interface WorkspaceField {
  key: SimpleWorkspaceKey
  label: string
  description: string
  kind: 'boolean' | 'text' | 'domains'
  value: string | boolean
  source: '워크스페이스 설정' | '배포 기본값' | '제품 기본값' | '설정 손상'
  error?: string
}
type Draft = Record<string, string | boolean>
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
export function WorkspaceFieldsEditor({ workspaceId, revision, fields }: { workspaceId: string; revision: number; fields: WorkspaceField[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(() => initial(fields))
  const [baseline, setBaseline] = useState<Draft>(() => initial(fields))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [repaired, setRepaired] = useState<string[]>([])
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const changed = fields.filter(f => !same(draft[f.key], baseline[f.key]) || (f.source === '설정 손상' && !repaired.includes(f.key)))

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline({ ...draft }); setBaseRevision(result.revision); setRepaired([...repaired, ...changed.map(f => f.key)])
      setUncertainPatch(null); setConflict(null)
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : `${changed.length}개 설정을 저장했습니다.`)
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, values: result.latest.values, invalidKeys: result.latest.invalidKeys })
      setUncertainPatch(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      setError(result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline({ ...draft }); setBaseRevision(found.outcome.revision); setRepaired([...repaired, ...changed.map(f => f.key)])
        setUncertainPatch(null); setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (changed.length === 0 && !uncertainPatch) return
    setError(null); setNotice(null)
    const set = Object.fromEntries(changed.map(f => [f.key, stored(f, draft[f.key])]))
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set, unset: [] }
    startTransition(async () => submit(patch))
  }

  function chooseMine() {
    if (!conflict) return
    const next = { ...baseline }
    for (const f of fields) {
      if (conflict.invalidKeys.includes(f.key)) continue
      if (Object.prototype.hasOwnProperty.call(conflict.values, f.key)) next[f.key] = inputValue(f, conflict.values[f.key])
    }
    setBaseline(next); setBaseRevision(conflict.revision); setConflict(null); setError(null)
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
    {fields.map(field => <div key={field.key} className="space-y-1.5 border-b border-line pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`workspace-${field.key}`} className="text-sm font-semibold text-ink">{field.label}</label>
        <span className="text-xs text-ink-subtle">{field.source} · 즉시 적용</span>
      </div>
      <p className="text-xs text-ink-muted">{field.description}</p>
      {field.error && !repaired.includes(field.key) && <p role="alert" className="text-xs text-delayed">설정 손상: {field.error}. 새 값을 저장해 복구하세요.</p>}
      {field.kind === 'boolean' ?
        <input id={`workspace-${field.key}`} type="checkbox" checked={draft[field.key] === true}
          disabled={pending || !!uncertainPatch} onChange={e => setDraft({ ...draft, [field.key]: e.target.checked })} /> :
        field.kind === 'domains' ?
          <textarea id={`workspace-${field.key}`} className="input min-h-24 w-full text-sm" value={String(draft[field.key])}
            disabled={pending || !!uncertainPatch} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} placeholder="한 줄에 한 도메인" /> :
          <input id={`workspace-${field.key}`} className="input w-full text-sm" value={String(draft[field.key])}
            maxLength={40} disabled={pending || !!uncertainPatch} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />}
      <p className="text-[11px] text-ink-subtle">{field.key}</p>
    </div>)}
    {conflict && <ConflictCompare rows={changed.map(f => ({ key: f.key, label: f.label,
      mine: String(draft[f.key]), latest: conflict.invalidKeys.includes(f.key) ? '설정 손상' : String(inputValue(f, conflict.values[f.key])),
    }))} onMine={chooseMine} onLatest={chooseLatest} latestAvailable={changed.every(f => !conflict.invalidKeys.includes(f.key))} />}
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
    <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 p-3 shadow-sm">
      <span className="text-xs text-ink-muted">변경 {changed.length}개</span>
      <button type="button" className="btn btn-primary" disabled={pending || (!changed.length && !uncertainPatch) || !!conflict} onClick={save}>
        {uncertainPatch ? '저장 결과 확인 및 재시도' : '저장'}
      </button>
    </div>
  </div>
}
