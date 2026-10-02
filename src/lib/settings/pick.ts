// valueOf 를 상태로 감싼다 — 페이지(오류 상태)와 봇 도구(실패 응답)가 함께 쓴다. 해석기·세션 클라이언트를 끌어오지 않는다.
import { ConfigKeyError } from './errors'
import type { ProjectConfig } from './projectConfig'
import { valueOf, type ProjectSettingKey, type ProjectSettingValue } from './registry'
import type { WorkCalendar } from '@/lib/domain/calendar'

/** ConfigKeyError 의 구분을 유지한다 — 화면은 손상과 필요 설정 누락을 다른 상태로 표시한다. */
export function pick<K extends ProjectSettingKey>(cfg: ProjectConfig, key: K): { ok: true; value: ProjectSettingValue<K> } | { ok: false; error: string; key: K; kind: 'invalid' | 'required' } {
  try { return { ok: true, value: valueOf(cfg, key) } } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key, kind: e.code === 'CONFIG_REQUIRED' ? 'required' : 'invalid' }
    throw e
  }
}

/** 달력(세 키 + 날짜 예외)을 페이지 상태로(계획 D-21a) — 손상이면 그 화면이 ConfigLoadError 를 그린다(throw 로 error 경계에 보내지 않는다).
 *  해석기가 calendar=null·calendarError 를 실었다(과제 13). 액션·라우트·데이터 계층은 requireCalendar(throw)다 */
export function pickCalendar(cfg: { calendar: WorkCalendar | null; calendarError: ConfigKeyError | null }):
  { ok: true; calendar: WorkCalendar } | { ok: false; error: string; key: string; kind: 'invalid' } {
  if (cfg.calendar) return { ok: true, calendar: cfg.calendar }
  // 둘 다 null 인 상태는 해석기가 만들지 않는다 — 방어로 calendar.timezone 키를 단다
  const e = cfg.calendarError ?? new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone')
  return { ok: false, error: e.message, key: e.key, kind: 'invalid' }
}
