'use client'
// 추가 축 이름(설정 core.extra_axis_label) — 작업의 업무 분류 칸을 이 프로젝트가 부르는 이름. 표시 전용(impact none)·즉시 적용이고
// 일괄 편집·변경 이력·엑셀 가져오기/내보내기의 그 열 이름이 이 값을 따른다. 비우면 키를 지운다(unset — 화면마다의 기본 문구).
// 저장 흐름은 단계 이름 편집기와 같다(useSettingsCommand).
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useSettingsCommand } from './useSettingsCommand'

const KEY = 'core.extra_axis_label'
const MAX = 20

export function ExtraAxisLabelEditor({ projectId, value, revision, canEdit, invalid = false }: {
  projectId: string
  /** 저장된 값 — 없거나 손상이면 null(빈 칸에서 다시 쓸 수 있다) */
  value: string | null
  revision: number
  canEdit: boolean
  invalid?: boolean
}) {
  const { t } = useLocale()
  const [baseline, setBaseline] = useState(value ?? '')
  const [draft, setDraft] = useState(value ?? '')
  const next = draft.trim()
  const dirty = invalid || next !== baseline
  const cmd = useSettingsCommand(projectId, revision, () => setBaseline(next))
  const locked = !canEdit || cmd.pending
  const failure = cmd.fieldErrors[KEY] ?? cmd.error

  return (
    <div data-extra-axis-editor className="space-y-2">
      {invalid && <p role="alert" className="text-xs text-danger">{t('settings.core.extra_axis_label.invalid')}</p>}
      <input className="app-input h-9 max-w-xs text-xs" maxLength={MAX} value={draft} disabled={locked} data-extra-axis-input
        placeholder={t('settings.core.extra_axis_label.placeholder')} aria-label={t('settings.core.extra_axis_label.label')}
        onChange={(e) => { setDraft(e.target.value); cmd.clear() }} />
      <p className="text-meta text-fg-muted">{t('settings.core.extra_axis_label.desc')}</p>
      {failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
      {cmd.saved && <p role="status" className="text-xs text-success">{t('settings.workflow.saved')}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary h-8 px-3 text-xs" data-extra-axis-save disabled={locked || !dirty}
          onClick={() => next ? cmd.save({ [KEY]: next }) : cmd.save({}, [KEY])}>
          {cmd.uncertain ? t('settings.workflow.retry') : t('settings.workflow.save')}
        </button>
      )}
    </div>
  )
}
