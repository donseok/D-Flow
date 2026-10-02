'use client'
// 근무 요일 편집기(설정 키 calendar.working_days 의 custom 위젯 — 판정 J1). 프로젝트·워크스페이스가 같이 쓴다.
// 값 검증은 calendar.ts 의 parseWorkingDays(서버와 같은 규칙 — 하나 이상, 1..7) — 저장은 오름차순 ISO 목록.
import { parseWorkingDays, type IsoDow } from '@/lib/domain/calendar'
import type { Locale } from '@/lib/i18n/dict'
import { ConfigStateNotice } from './ConfigStateNotice'

const ISO_ORDER: readonly IsoDow[] = [1, 2, 3, 4, 5, 6, 7]
const ISO_LABEL: Readonly<Record<IsoDow, string>> = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' }

export function WorkingDaysEditor({ value, onChange, disabled, locale }: {
  value: readonly IsoDow[]
  onChange: (days: IsoDow[]) => void
  disabled: boolean
  locale: Locale
}) {
  const check = parseWorkingDays([...value])
  function toggle(iso: IsoDow) {
    const next = value.includes(iso) ? value.filter(d => d !== iso) : [...value, iso]
    onChange([...next].sort((a, b) => a - b))
  }
  return (
    <div className="space-y-2">
      <div id="calendar-working-days" role="group" aria-label="근무 요일" className="flex flex-wrap gap-3">
        {ISO_ORDER.map(iso => (
          <label key={iso} className="flex items-center gap-1 text-sm text-fg">
            <input type="checkbox" name="calendar-working-day" value={iso} checked={value.includes(iso)} disabled={disabled}
              onChange={() => toggle(iso)} />
            {ISO_LABEL[iso]}
          </label>
        ))}
      </div>
      {!check.ok && <ConfigStateNotice kind="field" locale={locale} message="근무 요일을 하나 이상 고르세요." />}
    </div>
  )
}
