'use client'

// WBS 단계(레벨) 편집 — 라벨 배열이 곧 깊이(labels.length = max_depth).
// 축소·중복·빈 라벨 검증의 정본은 설정 엔진(registry parse + validateConfig)이며 여기서는 입력 UI 와 결과 표시만 한다.
// 실패를 조용히 삼키지 않는다(표시 = 로깅 원칙). 충돌이면 문구를 보이고 최신 값을 다시 읽는다(비교 화면은 Phase C).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'
import { ConfigStateNotice } from './ConfigStateNotice'
import { ConflictCompare } from './ConflictCompare'
import { SettingsSaveBar } from './SettingsSaveBar'

export function messageOf(r: SettingsCommandResult): string | null {
  if (r.ok) return null
  return r.kind === 'invalid' ? (r.fieldErrors[0]?.message ?? r.error) : r.error
}

export function LevelSettingsManager({ projectId, levelLabels, revision }: {
  projectId: string
  levelLabels: string[]
  revision: number
}) {
  const router = useRouter()
  const [labels, setLabels] = useState<string[]>(levelLabels)
  // 편집 세션의 기준 revision — 초안을 읽은 시점. 렌더마다 오는 revision prop 으로 보내면 형제 편집기 저장·refresh 뒤
  // 옛 초안이 충돌 없이 최신 revision 으로 덮는다(최종 리뷰 FN-2). base 로 보내면 서버 재기준이 겹침을 가른다.
  // 자기 저장 성공·충돌 때만 올린다(충돌 뒤 다시 저장하면 알린 뒤의 덮어쓰기 — 영구 충돌에 갇히지 않는다). key 재마운트는 충돌 문구를 지워 쓰지 않는다
  const [base, setBase] = useState(revision)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 응답 유실 — 같은 명령으로 결과를 다시 확인해야 한다(멱등). 확정되면 비운다.
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [conflict, setConflict] = useState<{ revision: number; latest: string[] | null } | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let r: SettingsCommandResult | null = null
    try { r = await updateProjectSettings(projectId, patch) } catch { /* 결과 불명 — 이력으로 판정 */ }
    if (r?.ok) {
      setBase(r.revision); setUncertainPatch(null); setFieldError(null)
      setNotice(r.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : 'WBS 단계를 저장했습니다.')
      router.refresh(); return
    }
    if (r?.kind === 'conflict') {
      const value = r.latest.values['core.level_labels']
      setConflict({ revision: r.latest.revision, latest: r.latest.invalidKeys.includes('core.level_labels') ? null : Array.isArray(value) ? value as string[] : null })
      setUncertainPatch(null); setFieldError(null); setError(r.error)
      router.refresh(); return
    }
    if (r && (r.kind !== 'unavailable' || !r.retryable)) {
      const field = r.kind === 'invalid' ? r.fieldErrors.find(e => e.key === 'core.level_labels') : undefined
      setFieldError(field?.message ?? null)
      setError(field ? null : (r.kind === 'invalid' ? (r.fieldErrors[0]?.message ?? r.error) : r.error))
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBase(found.outcome.revision); setUncertainPatch(null); setFieldError(null)
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (conflict) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: base, commandId: newUuid(), set: { 'core.level_labels': labels }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {labels.map((label, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{i + 1}단</span>
            <input
              data-level-label
              className="app-input h-8 flex-1 text-sm"
              value={label}
              onChange={(e) => setLabels(labels.map((l, j) => (j === i ? e.target.value : l)))}
              disabled={pending}
            />
            {labels.length > 1 && (
              <button
                type="button"
                data-remove-level
                className="btn btn-ghost h-8 w-8 shrink-0 p-0"
                aria-label={`${i + 1}단 삭제`}
                onClick={() => setLabels(labels.filter((_, j) => j !== i))}
                disabled={pending}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ol>
      {labels.length < LEVEL_LABELS_MAX && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-add-level
            className="btn btn-ghost h-8 text-sm"
            onClick={() => setLabels([...labels, ''])}
            disabled={pending}
          >
            <Plus className="h-4 w-4" /> 단계 추가
          </button>
        </div>
      )}
      {conflict && <ConflictCompare rows={[{ key: 'core.level_labels', label: 'WBS 단계', mine: labels.join(' → '), latest: conflict.latest?.join(' → ') ?? '설정 손상' }]}
        latestAvailable={conflict.latest !== null}
        onMine={() => { setBase(conflict.revision); setConflict(null); setError(null) }}
        onLatest={() => { setLabels(conflict.latest ?? labels); setBase(conflict.revision); setConflict(null); setError(null) }} />}
      {fieldError && <ConfigStateNotice kind="field" locale="ko" message={fieldError} />}
      {error && <ConfigStateNotice kind="patch" locale="ko" message={error} />}
      <SettingsSaveBar notice={notice}>
        <button type="button" data-save-levels className="btn btn-primary h-8 text-sm" onClick={save} disabled={pending || !!conflict}>
          {uncertainPatch ? '저장 결과 확인 및 재시도' : '저장'}
        </button>
      </SettingsSaveBar>
    </div>
  )
}
