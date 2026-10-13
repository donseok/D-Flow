'use client'
// 시간대 편집기(설정 키 calendar.timezone 의 custom 위젯 — 판정 J1). 프로젝트·워크스페이스가 같이 쓴다.
// 입력 + 보조 목록(datalist). 검증은 parseTimezone(서버·PG 와 같은 규칙 — D54·L1) 이고 목록 포함 여부가 아니다.
// 목록도 같은 규칙이다 — '/' 없는 이름은 닫힌 허용 목록(NO_SLASH_TIMEZONES)만, 나머지는 이 브라우저가 아는 'Area/City' 이름.
import { useSyncExternalStore } from 'react'
import { NO_SLASH_TIMEZONES, parseTimezone } from '@/lib/domain/calendar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 보조 목록 — 허용 목록 먼저, 그다음 이 런타임의 IANA 이름 중 '/' 가 든 것(약칭·GMT0 같은 '/' 없는 이름은 빠진다) */
export function timezoneOptions(supported: readonly string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []): string[] {
  return [...NO_SLASH_TIMEZONES, ...supported.filter(n => n.includes('/') && !NO_SLASH_TIMEZONES.includes(n))]
}

// 엔진마다 아는 이름이 다르다(WebKit 은 Etc/GMT±N 을 더 준다 — Node 는 안 준다). 서버가 그린 목록을 그대로 이어받으면
// Safari 에서 매번 하이드레이션이 어긋나므로(#418), 서버·첫 하이드레이션은 허용 목록만 그리고 이 브라우저의 이름은 그 뒤에 채운다.
const SERVER_OPTIONS: readonly string[] = NO_SLASH_TIMEZONES
let browserOptions: readonly string[] | null = null
const subscribeNever = () => () => {}
const clientOptions = () => (browserOptions ??= timezoneOptions())
const serverOptions = () => SERVER_OPTIONS

export function TimezoneSelect({ value, onChange, disabled, suggestion = null }: {
  value: string
  onChange: (tz: string) => void
  disabled: boolean
  /** 제안 버튼(워크스페이스 — 브라우저 시간대, 과제 26). null 이면 그리지 않는다 */
  suggestion?: { label: string; value: string } | null
}) {
  const { t } = useLocale()
  const check = parseTimezone(value.trim())
  const options = useSyncExternalStore(subscribeNever, clientOptions, serverOptions)
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
      <datalist id="calendar-timezone-names">{options.map(n => <option key={n} value={n} />)}</datalist>
      {!check.ok && <ConfigStateNotice kind="field" message={t('settings.tz.invalid').replace('{error}', String(check.error))} />}
    </div>
  )
}
