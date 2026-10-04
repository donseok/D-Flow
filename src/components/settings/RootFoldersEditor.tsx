'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import type { RootFoldersSetting } from '@/lib/minutes/rootFolders'
import { useLocale } from '@/components/providers/LocaleProvider'

const KEY = 'minutes.root_folders'

/**
 * 회의록 최상위 폴더 모드(SP5 B2 — D21). 화면은 teams 만 고르게 한다 — custom 은 v2.9 송부(SP7) 전까지 플랫폼 관리자가 설정 RPC 로만 넣는다.
 * 그래서 이 편집기의 쓰기는 "custom → teams 되돌리기" 하나다(키 editor = platform_admin — 액션이 다시 판정한다). 손상 값도 같은 단추로 고친다.
 * 저장 뒤의 루트 보장(ensure_team_roots)은 설정 액션의 후처리다 — 실패해도 편철·업로드의 지연 수렴이 메운다(D50 ④).
 */
export function RootFoldersEditor({ workspaceId, value, invalid = false, revision, canEdit }: {
  workspaceId: string
  /** 저장된(또는 기본) 값. 손상이면 null 과 invalid=true */
  value: RootFoldersSetting | null
  invalid?: boolean
  revision: number
  /** 플랫폼 관리자인가(키 editor) */
  canEdit: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [current, setCurrent] = useState<RootFoldersSetting | null>(value)
  const [broken, setBroken] = useState(invalid)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const isTeams = !broken && current?.mode === 'teams'

  function applied() {
    setCurrent({ mode: 'teams' }); setBroken(false); setUncertainPatch(null); setError(''); setNotice(t('settings.rootFolders.saved'))
    router.refresh()
  }
  async function submit(patch: SettingsPatch): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 명령 이력에서 반영 여부를 확인한다 */ }
    if (result?.ok) { applied(); return }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) { setError(result.error); setUncertainPatch(null); return }
    try {
      const outcome = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (outcome.ok && outcome.outcome.status === 'applied') { applied(); return }
    } catch { /* 같은 명령을 다시 보내도록 보류한다 */ }
    setUncertainPatch(patch); setError(t('settings.rootFolders.uncertain'))
  }
  function toTeams() {
    const patch = uncertainPatch ?? { expectedRevision: revision, commandId: newUuid(), set: { [KEY]: { mode: 'teams' } }, unset: [] }
    setError(''); setNotice('')
    startTransition(() => { void submit(patch) })
  }

  return <div className="space-y-3" data-root-folders-editor>
    {broken && <p role="alert" className="rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{t('settings.rootFolders.invalid')}</p>}
    <p className="text-sm text-ink">
      <span className="text-ink-muted">{t('settings.rootFolders.current')}: </span>
      <span className="font-medium">{isTeams || broken ? t('settings.rootFolders.teams') : t('settings.rootFolders.custom')}</span>
    </p>
    {!broken && current?.mode === 'custom' && <div>
      <p className="text-xs text-ink-muted">{t('settings.rootFolders.names')}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {current.names.map(n => <li key={n} className="rounded-md bg-surface-subtle px-2 py-0.5 text-xs text-ink">{n}</li>)}
      </ul>
    </div>}
    {!isTeams && (canEdit
      ? <div className="space-y-1">
          <button type="button" className="btn btn-ghost border border-line" disabled={pending} onClick={toTeams}>
            {t('settings.rootFolders.toTeams')}
          </button>
          <p className="text-xs text-ink-subtle">{t('settings.rootFolders.toTeamsHint')}</p>
        </div>
      : <p className="text-xs text-ink-subtle">{t('settings.rootFolders.platformOnly')}</p>)}
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
  </div>
}
