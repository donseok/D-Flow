'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { ConflictCompare } from './ConflictCompare'

const lines = (text: string) => text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
const display = (values: readonly string[]) => values.join('\n')

export function MilestoneKeywordsEditor({ projectId, revision, initial, source, invalidReason }: {
  projectId: string; revision: number; initial: string[]; source: string; invalidReason?: string
}) {
  const router = useRouter()
  const [text, setText] = useState(() => display(initial))
  const [baseline, setBaseline] = useState(() => display(initial))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [repair, setRepair] = useState(Boolean(invalidReason))
  const [conflict, setConflict] = useState<{ revision: number; latest: string[] | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = repair || text !== baseline

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 이력에서 결과 확인 */ }
    if (result?.ok) {
      setBaseline(text); setBaseRevision(result.revision); setRepair(false); setConflict(null); setUncertainPatch(null)
      setNotice('마일스톤 키워드를 저장했습니다. 대시보드에 즉시 적용됩니다.')
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['core.milestone_keywords']
      setConflict({ revision: result.latest.revision,
        latest: result.latest.invalidKeys.includes('core.milestone_keywords') ? null : Array.isArray(value) ? value as string[] : null })
      setUncertainPatch(null); return
    }
    if (result && result.kind !== 'unavailable') {
      setError(result.kind === 'invalid' ? result.fieldErrors[0]?.message ?? result.error : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(text); setBaseRevision(found.outcome.revision); setRepair(false); setUncertainPatch(null)
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재시도 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (!dirty && !uncertainPatch) return
    const values = lines(text)
    if (values.length > 50 || values.some(value => value.length > 40)) {
      setError('키워드는 최대 50개, 각 40자까지 입력할 수 있습니다.'); return
    }
    setError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'core.milestone_keywords': values }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="milestone-keywords" className="text-sm font-semibold text-ink">마일스톤 키워드</label>
      <span className="text-xs text-ink-subtle">{repair ? '설정 손상' : source} · 즉시 적용</span>
    </div>
    <p className="text-xs text-ink-muted">작업 이름에 포함된 단어로 대시보드의 마일스톤을 표시합니다. 비우면 마커가 표시되지 않습니다.</p>
    {repair && <p role="alert" className="text-xs text-delayed">저장된 키워드가 손상됐습니다: {invalidReason}. 새 값을 저장해 복구하세요.</p>}
    <textarea id="milestone-keywords" className="input min-h-28 w-full text-sm" value={text}
      disabled={pending || !!uncertainPatch} onChange={event => { setText(event.target.value); setError(null); setNotice(null) }} placeholder="한 줄에 한 키워드" />
    <p className="text-[11px] text-ink-subtle">저장 시 소문자로 바뀝니다.</p>
    {conflict && <ConflictCompare rows={[{ key: 'keywords', label: '마일스톤 키워드',
      mine: lines(text).join(', '), latest: conflict.latest?.join(', ') ?? '설정 손상',
    }]} latestAvailable={conflict.latest !== null}
      onMine={() => { setBaseline(display(conflict.latest ?? [])); setBaseRevision(conflict.revision); setConflict(null) }}
      onLatest={() => { const next = display(conflict.latest ?? []); setText(next); setBaseline(next); setBaseRevision(conflict.revision); setRepair(false); setConflict(null) }} />}
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict} onClick={save}>
      {uncertainPatch ? '저장 결과 확인 및 재시도' : '변경 저장'}
    </button>
  </div>
}
