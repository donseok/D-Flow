// 달력 설정 편집기의 입력 상태 — 서버 페이지(설정 화면 둘)가 해석기의 키 상태로 만들어 클라이언트 편집기(CalendarSettingsPanel)에 넘긴다.
// 'use client' 파일에 두면 서버가 부를 수 없다(클라이언트 참조가 된다 — 과제 25 눈확인에서 실측) — 그래서 순수 모듈에 둔다.
import { parseTimezone, type IsoDow, type WeekStartRule } from '@/lib/domain/calendar'
import type { KeyState } from './resolve'
import type { WorkspaceConfig } from './workspaceConfig'

export type CalendarFieldState<T> = { value: T | null; source: 'set' | 'default' | 'invalid'; error?: string }

/** 해석기의 키 상태 → 편집기 입력. required_missing 은 달력 키에 없다(기본값이 있다) — 와도 손상으로 보인다 */
export function calendarFieldOf<T>(state: KeyState<T>): CalendarFieldState<T> {
  if (state.status === 'set') return { value: state.value, source: 'set' }
  if (state.status === 'default') return { value: state.value, source: 'default' }
  if (state.status === 'invalid') return { value: null, source: 'invalid', error: state.error }
  return { value: null, source: 'invalid', error: '필수 설정이 없습니다.' }
}

/** 워크스페이스 세 키 → 편집기 입력. 요일 하나를 규칙 하나([{ day, from: null }])로 승격해 두 범위가 같은 형을 받게 한다(과제 26) */
export function workspaceCalendarFieldsOf(keys: Pick<WorkspaceConfig['keys'], 'calendar.timezone' | 'calendar.working_days' | 'calendar.week_start'>): {
  timezone: CalendarFieldState<string>; workingDays: CalendarFieldState<IsoDow[]>; weekStart: CalendarFieldState<WeekStartRule[]>
} {
  const ws = calendarFieldOf(keys['calendar.week_start'])
  return {
    timezone: calendarFieldOf(keys['calendar.timezone']),
    workingDays: calendarFieldOf(keys['calendar.working_days']),
    weekStart: { ...ws, value: ws.value ? [{ day: ws.value, from: null }] : null },
  }
}

/** 브라우저 시간대 제안(D13 ② — 생성 폼이 앱에 없어 워크스페이스 설정 절이 맡는다). 서버와 같은 검증(parseTimezone — L1 포함)을 지나는
 *  이름만. 없거나 못 읽으면 null — UTC 로 메우지 않는다(제안할 것이 없으면 버튼을 숨긴다) */
export function browserTimezoneSuggestion(resolve: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  let raw: string | undefined
  try { raw = resolve() } catch { return null }
  if (!raw) return null
  const p = parseTimezone(raw)
  return p.ok ? p.value : null
}
