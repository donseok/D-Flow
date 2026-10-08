'use client'
// 단계 이름(SP5b W2 — 설정 workflow.wbs_stage_labels). 단계 code(as/ip/im/xx)는 제품 고정이고 여기서는 표시 이름만 바꾼다(개정 §2.8.2).
// 빈 칸 = 로케일 사전의 기본 이름. 모두 비우면 키를 지운다(unset — 기본값). 즉시 적용·표시 전용(impact none).
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { STAGE_LABEL_SLOTS, parseStageLabels, type StageLabelSlot, type StageLabels } from '@/lib/settings/defs/project'
import { useSettingsCommand } from './useSettingsCommand'

const DEFAULT_KEY: Record<StageLabelSlot, DictKey> = {
  none: 'wbs.stageNoneOption', as: 'wbs.stageAs', ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}

export function StageLabelsEditor({ projectId, value, revision, canEdit, invalid = false }: {
  projectId: string
  /** 저장된 값 — 손상이면 null(빈 칸에서 다시 쓸 수 있다) */
  value: StageLabels | null
  revision: number
  canEdit: boolean
  invalid?: boolean
}) {
  const { t } = useLocale()
  const [baseline, setBaseline] = useState<StageLabels>(() => ({ ...(value ?? {}) }))
  const [draft, setDraft] = useState<Record<StageLabelSlot, string>>(() =>
    Object.fromEntries(STAGE_LABEL_SLOTS.map((k) => [k, value?.[k] ?? ''])) as Record<StageLabelSlot, string>)
  const next: StageLabels = Object.fromEntries(STAGE_LABEL_SLOTS.filter((k) => draft[k].trim() !== '').map((k) => [k, draft[k].trim()]))
  const parsed = parseStageLabels(next)
  const dirty = invalid || JSON.stringify(next) !== JSON.stringify(Object.fromEntries(STAGE_LABEL_SLOTS.filter((k) => baseline[k]).map((k) => [k, baseline[k]])))
  const cmd = useSettingsCommand(projectId, revision, () => setBaseline(next))
  const locked = !canEdit || cmd.pending

  return (
    <div data-stage-labels-editor className="space-y-3">
      {invalid && <p role="alert" className="text-xs text-danger">{t('settings.workflow.stageLabelsInvalid')}</p>}
      <div className="grid gap-2 sm:grid-cols-5">
        {STAGE_LABEL_SLOTS.map((k) => (
          <label key={k} className="flex flex-col gap-1 text-meta text-fg-secondary">
            <span className="font-mono">{k === 'none' ? '—' : k}</span>
            <input className="app-input h-9 text-xs" maxLength={20} value={draft[k]} placeholder={t(DEFAULT_KEY[k])} disabled={locked}
              data-stage-label={k} aria-label={`${k} ${t(DEFAULT_KEY[k])}`}
              onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [k]: v })); cmd.clear() }} />
          </label>
        ))}
      </div>
      <p className="text-meta text-fg-muted">{t('settings.workflow.stageLabelsHint')}</p>
      {!parsed.ok && <p role="alert" className="text-xs text-danger">{parsed.error}</p>}
      {(cmd.fieldErrors['workflow.wbs_stage_labels'] ?? cmd.error) && <p role="alert" className="text-xs text-danger">{cmd.fieldErrors['workflow.wbs_stage_labels'] ?? cmd.error}</p>}
      {cmd.saved && <p role="status" className="text-xs text-success">{t('settings.workflow.saved')}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary h-8 px-3 text-xs" data-stage-labels-save disabled={locked || !dirty || !parsed.ok}
          onClick={() => Object.keys(next).length ? cmd.save({ 'workflow.wbs_stage_labels': next }) : cmd.save({}, ['workflow.wbs_stage_labels'])}>
          {cmd.uncertain ? t('settings.workflow.retry') : t('settings.workflow.save')}
        </button>
      )}
    </div>
  )
}
