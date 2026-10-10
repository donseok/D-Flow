'use client'
// 시간대 편집기(설정 키 calendar.timezone 의 custom 위젯 — 판정 J1). 프로젝트·워크스페이스가 같이 쓴다.
// 입력 + 보조 목록(datalist). 검증은 parseTimezone(서버·PG 와 같은 규칙 — D54·L1) 이고 목록 포함 여부가 아니다.
// 목록도 같은 규칙이다 — '/' 없는 이름은 닫힌 허용 목록(NO_SLASH_TIMEZONES)만, 나머지는 이 브라우저가 아는 'Area/City' 이름.
import { NO_SLASH_TIMEZONES, parseTimezone } from '@/lib/domain/calendar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 보조 목록 — 허용 목록 먼저, 그다음 이 런타임의 IANA 이름 중 '/' 가 든 것(약칭·GMT0 같은 '/' 없는 이름은 빠진다) */
export function timezoneOptions(supported: readonly string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []): string[] {
  return [...NO_SLASH_TIMEZONES, ...supported.filter(n => n.includes('/') && !NO_SLASH_TIMEZONES.includes(n))]
}

export function TimezoneSelect({ value, onChange, disabled, suggestion = null }: {
  value: string
  onChange: (tz: string) => void
  disabled: boolean
  /** 제안 버튼(워크스페이스 — 브라우저 시간대, 과제 26). null 이면 그리지 않는다 */
  suggestion?: { label: string; value: string } | null
}) {
  const { t } = useLocale()
  const check = parseTimezone(value.trim())
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input id="calendar-timezone" className="app-input w-full max-w-sm text-sm" value={value} disabled={disabled}
          placeholder={t('settings.tz.placeholder')} list="calendar-timezone-names" autoComplete="off"
          onChange={e => onChange(e.target.value)} />
        {suggestion && (
          <button type="button" className="btn btn-ghost h-9 px-3 text-[13px]" disabled={disabled} onClick={() => onChange(suggestion.value)}>
            {suggestion.label}
          </button>
        )}
      </div>
      <datalist id="calendar-timezone-names">{timezoneOptions().map(n => <option key={n} value={n} />)}</datalist>
      {!check.ok && <ConfigStateNotice kind="field" message={t('settings.tz.invalid').replace('{error}', String(check.error))} />}
    </div>
  )
}
