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

function baseOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'object' && value !== null && typeof (value as { base?: unknown }).base === 'string') {
    return (value as { base: string }).base
  }
  return null
}

/** 서버는 base 색 하나에서 라이트·다크 토큰을 파생한다. */
export function AccentEditor({ workspaceId, revision, initialAccent, invalidReason }: {
  workspaceId: string; revision: number; initialAccent: AccentValue | null; invalidReason?: string
}) {
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
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '강조색 설정을 저장했습니다.'); router.refresh(); return
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
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if ((!dirty && !uncertainPatch) || (preview && !preview.ok)) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'branding.accent': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-4 border-t border-border pt-5">
    <div>
      <h3 className="text-sm font-semibold text-fg">강조색</h3>
      <p className="mt-1 text-xs text-fg-secondary">기준 색 하나를 입력하면 밝은 화면과 어두운 화면에 쓸 색을 계산합니다. 저장하면 화면 전체에 바로 반영됩니다.</p>
    </div>
    {invalidReason && needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="branding.accent" message={invalidReason} isAdmin settingsHref="#workspace-accent" />}
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="workspace-accent" className="text-sm text-fg">기준 색</label>
      <input id="workspace-accent" className="app-input w-32 font-mono text-sm" value={draft ?? ''} placeholder={ACCENT_TOKENS.light.action} maxLength={7}
        disabled={pending || !!uncertainPatch} onChange={event => setDraft(event.target.value || null)} />
      <input type="color" aria-label="강조색 선택" value={/^#[0-9a-fA-F]{6}$/.test(draft ?? '') ? draft! : ACCENT_TOKENS.light.action}
        disabled={pending || !!uncertainPatch} onChange={event => setDraft(event.target.value)} />
      <button type="button" className="btn btn-ghost" disabled={pending || !!uncertainPatch || draft === null}
        onClick={() => setDraft(null)}>기본값으로</button>
    </div>
    {preview && !preview.ok && <ConfigStateNotice kind="field" locale="ko" message={`${preview.error} ${preview.failures.map(f => `${f.pair} ${f.contrast} (최소 ${f.min})`).join(', ')}`} />}
    {fieldError && <ConfigStateNotice kind="field" locale="ko" message={fieldError} />}
    {preview?.ok && <div className="grid gap-3 sm:grid-cols-2">
      {(['light', 'dark'] as const).map(mode => <div key={mode} className="overflow-hidden rounded-xl border border-border">
        <div className="p-4" style={{ backgroundColor: ACCENT_TOKENS[mode].surface }}>
          <span className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: preview.value[mode].bg, color: preview.value[mode].fg }}>
            {mode === 'light' ? '밝은 화면' : '어두운 화면'}
          </span>
        </div>
        <p className="bg-surface-subtle px-4 py-2 font-mono text-meta text-fg-secondary">{preview.value[mode].bg} · {preview.value[mode].fg}</p>
      </div>)}
    </div>}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>다른 사용자가 강조색을 바꿨습니다.</strong>
      <p>내 값: {draft ?? '기본값'} / 최신 값: {conflict.invalid ? '설정 손상' : conflict.value ?? '기본값'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.value); setBaseRevision(conflict.revision); setNeedsRepair(conflict.invalid); setConflict(null) }}>내 값 다시 적용</button>
        {!conflict.invalid && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.value); setBaseline(conflict.value); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>최신 값 사용</button>}
      </div>
    </div>}
    {error && <ConfigStateNotice kind="patch" locale="ko" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict || !!(preview && !preview.ok)} onClick={save}>
        {uncertainPatch ? '저장 결과 확인 및 재시도' : '강조색 저장'}
      </button>
    </SettingsSaveBar>
  </div>
}
