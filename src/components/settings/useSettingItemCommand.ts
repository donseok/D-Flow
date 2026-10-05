'use client'
/**
 * 설정 한 키의 저장 규약(SP3b UI-3 W20) — MenuOrderEditor 의 submit 을 옮긴 것: expectedRevision CAS, 명령 id, 409 → 비교,
 * 결과 불명 → 같은 명령의 결과 확인 → 그래도 모르면 같은 명령으로 한 번 재전송 → 그래도 모르면 '결과 확인 및 재시도'.
 * 쓰기는 설정 액션(updateWorkspaceSettings·updateProjectSettings → apply_*_settings RPC) 한 길이다(CLAUDE.md 권한 절).
 * C 의 편집기는 이 훅으로 바꾸지 않는다(기능 무변경 — 스펙 §6.4). 새 편집기 둘(UI-3)만 쓴다.
 * 저장 뒤 동기화 후속이 있는 키에는 쓰지 않는다. appliedRevision(저장 성공·동기화 실패) 채택은 지원하지 않는다(U3-3 P2-10a).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import type { SettingKey } from '@/lib/settings/registry'
import { newUuid } from '@/lib/domain/uuid'

type Scope = { workspaceId: string } | { projectId: string }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useSettingItemCommand<T>({ scope, key, revision, initial, empty, fromLatest }: {
  scope: Scope; key: SettingKey; revision: number; initial: T | null; empty: T; fromLatest(v: unknown): T | null
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<T>(initial ?? empty)
  const [draft, setDraft] = useState<T>(initial ?? empty)
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initial === null)
  const [conflict, setConflict] = useState<{ revision: number; value: T | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || !same(baseline, draft)
  const send = (patch: SettingsPatch) => ('workspaceId' in scope ? updateWorkspaceSettings(scope.workspaceId, patch) : updateProjectSettings(scope.projectId, patch))

  async function submit(patch: SettingsPatch, saved: T, resendCount = 0): Promise<void> {
    const applied = (rev: number, msg: string) => {
      setBaseline(saved); setBaseRevision(rev); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null); setNotice(msg); router.refresh()
    }
    let result: SettingsCommandResult | null = null
    try { result = await send(patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) { applied(result.revision, result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '저장했습니다.'); return }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, value: result.latest.invalidKeys.includes(key) ? null : fromLatest(result.latest.values[key]) })
      setUncertainPatch(null); setFieldError(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const field = result.kind === 'invalid' ? result.fieldErrors.find((e) => e.key === key) : undefined
      setFieldError(field?.message ?? null)
      setError(field ? null : (result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error))
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome(scope, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') { applied(found.outcome.revision, '저장된 명령을 확인했습니다.'); return }
    } catch { /* 같은 명령으로 재전송 */ }
    if (resendCount === 0) return submit(patch, saved, 1)
    setUncertainPatch(patch); setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }
  function save() {
    if (!dirty && !uncertainPatch) return
    setError(null); setFieldError(null); setNotice(null)
    const patch: SettingsPatch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { [key]: draft }, unset: [] }
    const saved = draft
    startTransition(async () => submit(patch, saved))
  }
  /** 편집 — 지난 저장 알림·필드 오류를 지운다(다음 저장의 결과와 섞이지 않게) */
  function edit(next: T) { setDraft(next); setNotice(null); setFieldError(null) }
  return {
    draft, setDraft: edit, dirty, needsRepair, pending, uncertain: !!uncertainPatch, conflict, error, fieldError, notice, save,
    /** 내 값 다시 적용 — 초안은 그대로, 기준 revision 만 최신으로 */
    keepMine: () => { if (!conflict) return; setBaseline(conflict.value ?? empty); setBaseRevision(conflict.revision); setNeedsRepair(conflict.value === null); setConflict(null); setError(null) },
    /** 최신 값 사용 — 초안·기준을 최신 값으로(최신 값이 손상이면 쓸 수 없다) */
    useLatest: () => { if (!conflict?.value) return; setDraft(conflict.value); setBaseline(conflict.value); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null); setError(null) },
  }
}
