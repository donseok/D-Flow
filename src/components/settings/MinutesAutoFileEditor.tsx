'use client'
// 외부 업로드의 폴더 자동 편철(설정 minutes.auto_file_by_path) — 연동이 보낸 folder_path 대로 회의록을 폴더에 넣을지. 기본은 켬.
// 끄면 이 프로젝트의 업로드는 폴더 경로를 받지 않은 것처럼 다룬다(새 회의록은 팀 폴더, 다시 보낸 회의록은 지금 위치 그대로).
// 이후 업로드부터 적용되고 이미 편철된 회의록은 옮기지 않는다. 저장 흐름은 추가 축 이름 편집기와 같다(useSettingsCommand).
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useSettingsCommand } from './useSettingsCommand'

const KEY = 'minutes.auto_file_by_path'

export function MinutesAutoFileEditor({ projectId, value, revision, canEdit, invalid = false }: {
  projectId: string
  /** 지금 값(저장값 또는 기본값) — 손상이면 null(기본값 켬에서 다시 저장할 수 있다) */
  value: boolean | null
  revision: number
  canEdit: boolean
  invalid?: boolean
}) {
  const { t } = useLocale()
  const [baseline, setBaseline] = useState(value ?? true)
  const [draft, setDraft] = useState(value ?? true)
  // 손상된 값은 그대로 두지 않는다 — 같은 값이어도 다시 저장해 고칠 수 있게 한다
  const [repaired, setRepaired] = useState(false)
  const dirty = (invalid && !repaired) || draft !== baseline
  const cmd = useSettingsCommand(projectId, revision, () => { setBaseline(draft); setRepaired(true) })
  const locked = !canEdit || cmd.pending
  const failure = cmd.fieldErrors[KEY] ?? cmd.error

  return (
    <div data-minutes-auto-file className="space-y-2">
      {invalid && !repaired && <p role="alert" className="text-xs text-danger">{t('settings.minutes.auto_file_by_path.invalid')}</p>}
      <div className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
        <span className="min-w-0 flex-1 text-sm text-fg">{t('settings.minutes.auto_file_by_path.switch')}</span>
        <button type="button" role="switch" aria-checked={draft} aria-label={t('settings.minutes.auto_file_by_path.label')} disabled={locked}
          onClick={() => { setDraft(!draft); cmd.clear() }}
          className={`shrink-0 rounded-full px-3 py-1 text-meta font-semibold ${draft ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
          {t(draft ? 'settings.minutes.auto_file_by_path.on' : 'settings.minutes.auto_file_by_path.off')}
        </button>
      </div>
      <p className="text-meta text-fg-muted">{t(draft ? 'settings.minutes.auto_file_by_path.onHint' : 'settings.minutes.auto_file_by_path.offHint')}</p>
      {failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
      {cmd.saved && <p role="status" className="text-xs text-success">{t('settings.workflow.saved')}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary h-8 px-3 text-xs" data-minutes-auto-file-save disabled={locked || !dirty}
          onClick={() => cmd.save({ [KEY]: draft })}>
          {cmd.uncertain ? t('settings.workflow.retry') : t('settings.workflow.save')}
        </button>
      )}
    </div>
  )
}
