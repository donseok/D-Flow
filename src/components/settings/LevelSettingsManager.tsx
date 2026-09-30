'use client'

// WBS 단계(레벨) 편집 — 라벨 배열이 곧 깊이(labels.length = max_depth).
// 축소·중복·빈 라벨 검증의 정본은 설정 엔진(registry parse + validateConfig)이며 여기서는 입력 UI 와 결과 표시만 한다.
// 실패를 조용히 삼키지 않는다(표시 = 로깅 원칙). 충돌이면 문구를 보이고 최신 값을 다시 읽는다(비교 화면은 Phase C).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { updateProjectSettings, type SettingsCommandResult } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'
import { ConflictCompare } from './ConflictCompare'

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
  const [conflict, setConflict] = useState<{ revision: number; latest: string[] | null } | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    if (conflict) return
    setError(null)
    startTransition(async () => {
      const r = await updateProjectSettings(projectId, {
        expectedRevision: base, commandId: newUuid(), set: { 'core.level_labels': labels }, unset: [],
      })
      if (!r.ok) {
        setError(messageOf(r))
        if (r.kind === 'conflict') {
          const value = r.latest.values['core.level_labels']
          setConflict({ revision: r.latest.revision, latest: r.latest.invalidKeys.includes('core.level_labels') ? null : Array.isArray(value) ? value as string[] : null })
          router.refresh()
        }
        return
      }
      setBase(r.revision)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {labels.map((label, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-subtle">{i + 1}단</span>
            <input
              data-level-label
              className="input h-8 flex-1 text-sm"
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
      <div className="flex items-center gap-2">
        {labels.length < LEVEL_LABELS_MAX && (
          <button
            type="button"
            data-add-level
            className="btn btn-ghost h-8 text-sm"
            onClick={() => setLabels([...labels, ''])}
            disabled={pending}
          >
            <Plus className="h-4 w-4" /> 단계 추가
          </button>
        )}
        <button type="button" data-save-levels className="btn btn-primary h-8 text-sm" onClick={save} disabled={pending || !!conflict}>
          저장
        </button>
      </div>
      {conflict && <ConflictCompare rows={[{ key: 'core.level_labels', label: 'WBS 단계', mine: labels.join(' → '), latest: conflict.latest?.join(' → ') ?? '설정 손상' }]}
        latestAvailable={conflict.latest !== null}
        onMine={() => { setBase(conflict.revision); setConflict(null); setError(null) }}
        onLatest={() => { setLabels(conflict.latest ?? labels); setBase(conflict.revision); setConflict(null); setError(null) }} />}
      {error && <p role="alert" className="text-xs text-delayed">{error}</p>}
    </div>
  )
}
