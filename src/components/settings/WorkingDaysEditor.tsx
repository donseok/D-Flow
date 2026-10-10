'use client'
// 근무 요일 편집기(설정 키 calendar.working_days 의 custom 위젯 — 판정 J1). 프로젝트·워크스페이스가 같이 쓴다.
// 값 검증은 calendar.ts 의 parseWorkingDays(서버와 같은 규칙 — 하나 이상, 1..7) — 저장은 오름차순 ISO 목록.
import { parseWorkingDays, type IsoDow } from '@/lib/domain/calendar'
import type { DictKey} from '@/lib/i18n/dict'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

const ISO_ORDER: readonly IsoDow[] = [1, 2, 3, 4, 5, 6, 7]
const ISO_LABEL: Readonly<Record<IsoDow, DictKey>> = { 1: 'att.weekday.mon', 2: 'att.weekday.tue', 3: 'att.weekday.wed', 4: 'att.weekday.thu', 5: 'att.weekday.fri', 6: 'att.weekday.sat', 7: 'att.weekday.sun' }

export function WorkingDaysEditor({ value, onChange, disabled }: {
  value: readonly IsoDow[]
  onChange: (days: IsoDow[]) => void
  disabled: boolean
}) {
  const { t } = useLocale()
  const check = parseWorkingDays([...value])
  function toggle(iso: IsoDow) {
    const next = value.includes(iso) ? value.filter(d => d !== iso) : [...value, iso]
    onChange([...next].sort((a, b) => a - b))
  }
  return (
    <div className="space-y-2">
      <div id="calendar-working-days" role="group" aria-label={t('settings.calendar.working_days.label')} className="flex flex-wrap gap-3">
        {ISO_ORDER.map(iso => (
          <label key={iso} className="flex items-center gap-1 text-sm text-fg">
            <input type="checkbox" name="calendar-working-day" value={iso} checked={value.includes(iso)} disabled={disabled}
              onChange={() => toggle(iso)} />
            {t(ISO_LABEL[iso])}
          </label>
        ))}
      </div>
      {!check.ok && <ConfigStateNotice kind="field" message={t('settings.workingDays.required')} />}
    </div>
  )
}
