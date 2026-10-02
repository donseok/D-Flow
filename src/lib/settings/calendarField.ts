// 달력 설정 편집기의 입력 상태 — 서버 페이지(설정 화면 둘)가 해석기의 키 상태로 만들어 클라이언트 편집기(CalendarSettingsPanel)에 넘긴다.
// 'use client' 파일에 두면 서버가 부를 수 없다(클라이언트 참조가 된다 — 과제 25 눈확인에서 실측) — 그래서 순수 모듈에 둔다.
import type { KeyState } from './resolve'

export type CalendarFieldState<T> = { value: T | null; source: 'set' | 'default' | 'invalid'; error?: string }

/** 해석기의 키 상태 → 편집기 입력. required_missing 은 달력 키에 없다(기본값이 있다) — 와도 손상으로 보인다 */
export function calendarFieldOf<T>(state: KeyState<T>): CalendarFieldState<T> {
  if (state.status === 'set') return { value: state.value, source: 'set' }
  if (state.status === 'default') return { value: state.value, source: 'default' }
  if (state.status === 'invalid') return { value: null, source: 'invalid', error: state.error }
  return { value: null, source: 'invalid', error: '필수 설정이 없습니다.' }
}
