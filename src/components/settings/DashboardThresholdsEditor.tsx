'use client'
// 대시보드 판정 기준(설정 dashboard.due_soon_days·dashboard.delayed_red_count) — '마감 임박'으로 볼 남은 일수와 지연 작업이 몇 건부터 '위험'인지.
// 표시·판정 전용이라 저장 데이터를 바꾸지 않고, 저장하면 다음 화면부터 적용된다. 기본값(7일·4건)은 설정이 생기기 전의 고정값과 같다.
// 저장 흐름은 추가 축 이름 편집기와 같다(useSettingsCommand) — 바뀐 키만 보내고, 기본값으로 되돌리면 그 키를 지운다(unset).
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { DEFAULT_DUE_SOON_DAYS, DELAYED_RED_COUNT, DELAYED_RED_COUNT_MAX, DUE_SOON_DAYS_MAX } from '@/lib/domain/dashboard'
import type { SettingKey } from '@/lib/settings/registry'
import { useSettingsCommand } from './useSettingsCommand'

const DAYS_KEY = 'dashboard.due_soon_days'
const RED_KEY = 'dashboard.delayed_red_count'

/** 입력 글자 → 범위 안의 정수 또는 null(빈 칸·소수·범위 밖) */
function toInt(text: string, max: number): number | null {
  const s = text.trim()
  if (!/^\d{1,4}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= max ? n : null
}

export function DashboardThresholdsEditor({ projectId, dueSoonDays, delayedRedCount, revision, canEdit, invalid = false }: {
  projectId: string
  /** 지금 값(저장값 또는 기본값) — 손상이면 null(기본값에서 다시 저장할 수 있다) */
  dueSoonDays: number | null
  delayedRedCount: number | null
  revision: number
  canEdit: boolean
  /** 두 키 중 하나라도 손상 — 저장 버튼을 열어 다시 쓰게 한다 */
  invalid?: boolean
}) {
  const { t } = useLocale()
  const [base, setBase] = useState({ days: dueSoonDays ?? DEFAULT_DUE_SOON_DAYS, red: delayedRedCount ?? DELAYED_RED_COUNT })
  const [days, setDays] = useState(String(base.days))
  const [red, setRed] = useState(String(base.red))
  const nextDays = toInt(days, DUE_SOON_DAYS_MAX)
  const nextRed = toInt(red, DELAYED_RED_COUNT_MAX)
  const valid = nextDays !== null && nextRed !== null
  const dirty = invalid || nextDays !== base.days || nextRed !== base.red
  const cmd = useSettingsCommand(projectId, revision, () => { if (valid) setBase({ days: nextDays, red: nextRed }) })
  const locked = !canEdit || cmd.pending
  const failure = cmd.fieldErrors[DAYS_KEY] ?? cmd.fieldErrors[RED_KEY] ?? cmd.error

  function save() {
    if (!valid) return
    // 기본값과 같은 칸은 키를 지운다 — 제품 기본값이 바뀌면 따라간다. 손상 복구는 두 키를 모두 다시 쓴다
    const set: Record<string, unknown> = {}
    const unset: SettingKey[] = []
    const put = (key: SettingKey, value: number, def: number, changed: boolean) => {
      if (!changed && !invalid) return
      if (value === def) unset.push(key); else set[key] = value
    }
    put(DAYS_KEY, nextDays, DEFAULT_DUE_SOON_DAYS, nextDays !== base.days)
    put(RED_KEY, nextRed, DELAYED_RED_COUNT, nextRed !== base.red)
    cmd.save(set, unset)
  }

  return (
    <div data-dashboard-thresholds-editor className="space-y-4">
      {invalid && <p role="alert" className="text-xs text-danger">{t('settings.dashboard.thresholds.invalid')}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-fg">{t('settings.dashboard.due_soon_days.label')}</span>
          <span className="flex items-center gap-2">
            <input className="app-input h-9 w-24 text-xs tabular-nums" inputMode="numeric" maxLength={4} value={days} disabled={locked} data-due-soon-days
              aria-invalid={nextDays === null} onChange={(e) => { setDays(e.target.value); cmd.clear() }} />
            <span className="text-xs text-fg-secondary">{t('settings.dashboard.due_soon_days.unit')}</span>
          </span>
          <span className="block text-meta text-fg-muted">{t('settings.dashboard.due_soon_days.desc')}</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-fg">{t('settings.dashboard.delayed_red_count.label')}</span>
          <span className="flex items-center gap-2">
            <input className="app-input h-9 w-24 text-xs tabular-nums" inputMode="numeric" maxLength={4} value={red} disabled={locked} data-delayed-red-count
              aria-invalid={nextRed === null} onChange={(e) => { setRed(e.target.value); cmd.clear() }} />
            <span className="text-xs text-fg-secondary">{t('settings.dashboard.delayed_red_count.unit')}</span>
          </span>
          <span className="block text-meta text-fg-muted">{t('settings.dashboard.delayed_red_count.desc')}</span>
        </label>
      </div>
      {!valid && <p role="alert" className="text-xs text-danger">
        {t('settings.dashboard.thresholds.range').replace('{days}', String(DUE_SOON_DAYS_MAX)).replace('{count}', String(DELAYED_RED_COUNT_MAX))}
      </p>}
      {failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
      {cmd.saved && <p role="status" className="text-xs text-success">{t('settings.workflow.saved')}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary h-8 px-3 text-xs" data-dashboard-thresholds-save disabled={locked || !dirty || !valid} onClick={save}>
          {cmd.uncertain ? t('settings.workflow.retry') : t('settings.workflow.save')}
        </button>
      )}
    </div>
  )
}
