'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { previewProjectSettingsImpact, type ProjectSettingsImpactResult } from '@/app/actions/settingsPreview'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { newUuid } from '@/lib/domain/uuid'

export interface ProjectModuleOption { id: ModuleId; label: string; allowed: boolean; available: boolean }
type Conflict = { revision: number; enabled: ModuleId[] | null }
const sameIds = (a: readonly ModuleId[], b: readonly ModuleId[]) => a.length === b.length && a.every(id => b.includes(id))

export function ModuleToggleEditor({ projectId, revision, initialEnabled, invalidReason, options }: {
  projectId: string; revision: number; initialEnabled: ModuleId[] | null; invalidReason?: string; options: ProjectModuleOption[]
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<ModuleId[]>(initialEnabled ?? [])
  const [selected, setSelected] = useState<ModuleId[]>(initialEnabled ?? [])
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialEnabled === null)
  const [review, setReview] = useState<Extract<ProjectSettingsImpactResult, { ok: true }> | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    setReview(null); setConflict(null); setError(null); setNotice(null)
  }

  function inspect() {
    setError(null); setNotice(null)
    startTransition(async () => {
      let result: ProjectSettingsImpactResult
      try { result = await previewProjectSettingsImpact(projectId, selected) }
      catch { setError('변경 영향을 확인하지 못했습니다. 다시 시도하세요.'); return }
      if (!result.ok) { setError(result.error); return }
      if (result.revision !== baseRevision) { setConflict({ revision: result.revision, enabled: result.before }); return }
      setReview(result)
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(selected); setBaseRevision(result.revision); setNeedsRepair(false); setReview(null); setUncertainPatch(null)
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '프로젝트 모듈을 저장했습니다.')
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['modules.enabled']
      setConflict({ revision: result.latest.revision, enabled: Array.isArray(value) ? value as ModuleId[] : null })
      setReview(null); setUncertainPatch(null); return
    }
    if (result && result.kind !== 'unavailable') {
      setReview(null); setUncertainPatch(null)
      setError(result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error)
      return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(selected); setBaseRevision(found.outcome.revision); setNeedsRepair(false); setReview(null); setUncertainPatch(null)
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (!review && !uncertainPatch) return
    setError(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'modules.enabled': selected }, unset: [] }
    startTransition(async () => submit(patch))
  }

  const row = (o: ProjectModuleOption) => <label key={o.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm">
    <input type="checkbox" checked={selected.includes(o.id)} disabled={pending || !!uncertainPatch} onChange={() => toggle(o.id)} />
    <span>{o.label}</span><span className="ml-auto text-xs text-ink-subtle">{o.id}</span>
  </label>

  return <div className="space-y-4">
    <p className="text-xs leading-5 text-ink-muted">사용할 프로젝트 모듈을 선택합니다. 꺼도 기존 데이터는 삭제되지 않습니다.</p>
    {invalidReason && !needsRepair ? null : invalidReason && <p role="alert" className="text-xs text-delayed">저장된 모듈 설정이 손상됐습니다: {invalidReason}. 다시 선택해 복구하세요.</p>}
    <div className="grid gap-2 sm:grid-cols-2">{enabledRows.map(row)}</div>
    {disabledRows.length > 0 && <details className="rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">꺼진 모듈 ({disabledRows.length})</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{disabledRows.map(row)}</div>
    </details>}
    {retained.length > 0 && <div className="rounded-xl border border-pending/30 bg-pending-weak p-3 text-xs">
      <p className="font-semibold">워크스페이스 미허용 또는 배포 비가용 — 저장값 유지</p>
      <p>{retained.map(o => o.label).join(', ')}</p>
    </div>}
    {unavailable.length > 0 && <p className="text-xs text-ink-subtle">이 배포/계약에서 사용할 수 없는 모듈: {unavailable.map(o => o.label).join(', ')}</p>}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>다른 사용자가 모듈 설정을 바꿨습니다.</strong>
      <p>내 선택: {selected.map(label).join(', ') || '없음'}</p>
      <p>최신 값: {conflict.enabled === null ? '설정 손상 — 복구 필요' : conflict.enabled.map(label).join(', ') || '없음'}</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.enabled ?? []); setNeedsRepair(conflict.enabled === null); setBaseRevision(conflict.revision); setConflict(null) }}>내 값 다시 검토</button>
        {conflict.enabled !== null && <button type="button" className="btn btn-ghost" onClick={() => { setSelected(conflict.enabled!); setBaseline(conflict.enabled!); setNeedsRepair(false); setBaseRevision(conflict.revision); setConflict(null) }}>최신 값 사용</button>}
      </div>
    </div>}
    {review && <div className="space-y-1 rounded-xl border border-brand-ring bg-brand-weak/30 p-4 text-sm">
      <strong>변경 내용 검토</strong>
      <p>추가: {selected.filter(id => !baseline.includes(id)).map(label).join(', ') || '없음'}</p>
      <p>제외: {baseline.filter(id => !selected.includes(id)).map(label).join(', ') || '없음'}</p>
      {review.impact === null ? <p>기존 설정이 손상되어 영향 수를 계산할 수 없습니다. 새 선택으로 복구됩니다.</p> :
        review.impact.removed.map(x => <p key={x.moduleId}>{label(x.moduleId)}: {x.dataCount === null ? x.dataLabel : `${x.dataLabel} ${x.dataCount}건`}</p>)}
      <p>기존 데이터는 삭제되지 않으며, 다음 요청부터 새 모듈 설정이 적용됩니다.</p>
    </div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost" disabled={pending || !dirty || !!conflict || !!uncertainPatch} onClick={inspect}>변경 내용 검토</button>
      {(review || uncertainPatch) && <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{uncertainPatch ? '저장 결과 확인 및 재시도' : '변경 저장'}</button>}
    </div>
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
  </div>
}
