'use client'
// 설정 명령 한 번(SP5b W2 — 단계 이름·승인 단계 편집기 공용). IssuePolicyEditor 와 같은 흐름: updateProjectSettings → 실패가 재시도 가능한
// unavailable 이면 명령 이력(getSettingsCommandOutcome)으로 반영 여부를 확인하고, 그래도 모르면 같은 명령을 다시 보내도록 보류한다.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import type { SettingKey } from '@/lib/settings/registry'

export function useSettingsCommand(projectId: string, revision: number, onSaved: (set: Record<string, unknown>) => void) {
  const router = useRouter()
  const [base, setBase] = useState(revision)
  const [uncertain, setUncertain] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  async function submit(patch: SettingsPatch): Promise<void> {
    let r: SettingsCommandResult | null = null
    try { r = await updateProjectSettings(projectId, patch) } catch { /* 명령 이력에서 확인 */ }
    const done = (rev: number) => {
      setBase(rev); setUncertain(null); setError(''); setFieldErrors({}); setSaved(true); onSaved(patch.set); router.refresh()
    }
    if (r?.ok) return done(r.revision)
    if (r?.kind === 'conflict') { setBase(r.latest.revision); setError(`${r.error} — 새로고침한 값을 확인한 뒤 다시 저장하세요.`); setUncertain(null); router.refresh(); return }
    if (r && (r.kind !== 'unavailable' || !r.retryable)) {
      if (r.kind === 'invalid') setFieldErrors(Object.fromEntries(r.fieldErrors.map((f) => [f.key, f.message])))
      setError(r.error); setUncertain(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') return done(found.outcome.revision)
    } catch { /* 같은 명령으로 다시 */ }
    setUncertain(patch); setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }
  function save(set: Record<string, unknown>, unset: SettingKey[] = []) {
    const patch: SettingsPatch = uncertain ?? { expectedRevision: base, commandId: newUuid(), set, unset }
    setError(''); setFieldErrors({}); setSaved(false)
    startTransition(() => { void submit(patch) })
  }
  return { save, pending, error, fieldErrors, saved, uncertain: uncertain !== null, clear: () => { setError(''); setFieldErrors({}); setSaved(false) } }
}
