import 'server-only'
/**
 * 달력 로더(SP5 A — 스펙 D11·D36·D13 ③·§4.1). holidays 판독의 유일한 자리(tests/invariants/holidays-reads)이고, 해석기 둘이 세 키
 * (calendar.timezone·working_days·week_start)로 WorkCalendar 를 만들 때 쓰는 순수 조립을 둔다.
 * 손상 키는 ConfigKeyError — 해석기는 로드를 멈추지 않고 calendar=null·calendarError 로 싣고(다른 키의 기능은 계속), 소비처가
 * requireCalendar 로 꺼낼 때 그 오류가 난다([RF4] — 기본값 UTC·일요일로 잇지 않는다).
 * 해석기 둘(projectConfig·workspaceConfig)이 이 파일을 import 하므로 이 파일은 해석기를 정적으로 import 하지 않는다(타입만) — 해석기를
 * 쓰는 resolveRequestCalendar 는 함수 안에서 동적 import 한다. 정적 순환이면 해석기를 vi.mock 하는 테스트의 목 공장이 픽스처(→ 이 파일
 * → 해석기 목)를 기다리며 멈춘다(과제 13 실측).
 */
import { fetchAllByKeyset } from '@/lib/data/paging'
import {
  calendarOf, DEFAULT_TIMEZONE, DEFAULT_WEEK_RULES, DEFAULT_WORKING_DAYS, type RequestCalendar, type WorkCalendar,
} from '@/lib/domain/calendar'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import type { ConfigReadClient, ProjectConfig } from '@/lib/settings/projectConfig'
import type { KeyState } from '@/lib/settings/resolve'
import type { WorkspaceConfig } from '@/lib/settings/workspaceConfig'

export interface HolidayRow { date: string; name: string; kind: 'off' | 'work' }
/** 평범한 객체 — 서버 컴포넌트가 클라이언트 props 로 넘긴다(Set 은 RSC 경계를 넘기지 않는다) */
export type CalendarInput = Parameters<typeof calendarOf>[0]

type HolidayRecord = { date: string; name: string | null; kind: string }

/** 프로젝트 holidays 를 끝까지(키 = PK 의 date, SP4 A2 P15) kind 와 함께. 실패·kind 이상은 ConfigUnavailableError(3원칙 ①) */
export async function loadProjectHolidays(client: ConfigReadClient, projectId: string): Promise<HolidayRow[]> {
  let rows: HolidayRecord[]
  try {
    rows = await fetchAllByKeyset<HolidayRecord>('[calendar] holidays', (r) => r.date, (after, limit) => {
      const q = client.from('holidays').select('date, name, kind', { count: 'exact' }).eq('project_id', projectId)
      return (after ? q.gt('date', after.date) : q).order('date').limit(limit)
    })
  } catch (e) {
    throw new ConfigUnavailableError(`휴일 조회 실패: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  return rows.map((r) => {
    if (r.kind !== 'off' && r.kind !== 'work') {
      throw new ConfigUnavailableError(`휴일 종류가 올바르지 않습니다(${projectId} ${r.date}: ${String(r.kind)})`)
    }
    return { date: r.date, name: r.name ?? '', kind: r.kind }
  })
}

/** valueOf 와 같은 규칙 — set·default 만 값, invalid → CONFIG_INVALID, required_missing → CONFIG_REQUIRED */
function settled<T>(key: string, s: KeyState<T> | undefined): T {
  if (s && (s.status === 'set' || s.status === 'default')) return s.value
  throw new ConfigKeyError(s?.status === 'required_missing' ? 'CONFIG_REQUIRED' : 'CONFIG_INVALID', key)
}

export function projectCalendarOf(keys: ProjectConfig['keys'], holidays: readonly HolidayRow[]): WorkCalendar {
  return calendarOf({
    timezone: settled('calendar.timezone', keys['calendar.timezone']),
    workingDays: settled('calendar.working_days', keys['calendar.working_days']),
    weekStart: settled('calendar.week_start', keys['calendar.week_start']),
    holidays,
  })
}

/** 워크스페이스에는 날짜 예외 표가 없다(D36) — 요일 하나를 규칙 하나로 승격한다 */
export function workspaceCalendarOf(keys: WorkspaceConfig['keys']): WorkCalendar {
  return calendarOf({
    timezone: settled('calendar.timezone', keys['calendar.timezone']),
    workingDays: settled('calendar.working_days', keys['calendar.working_days']),
    weekStart: [{ day: settled('calendar.week_start', keys['calendar.week_start']), from: null }],
    holidays: [],
  })
}

/** 설정 키 손상(ConfigKeyError)만 잡는다 — 그 밖의 예외는 결함이라 그대로 올린다 */
export function calendarOrError(build: () => WorkCalendar): { calendar: WorkCalendar | null; calendarError: ConfigKeyError | null } {
  try {
    return { calendar: build(), calendarError: null }
  } catch (e) {
    if (e instanceof ConfigKeyError) return { calendar: null, calendarError: e }
    throw e
  }
}

/** 소비처의 유일한 접근자 — cfg.calendar! 를 쓰지 않는다([RF4]) */
export function requireCalendar(cfg: { calendar: WorkCalendar | null; calendarError: ConfigKeyError | null }): WorkCalendar {
  if (cfg.calendar) return cfg.calendar
  throw cfg.calendarError ?? new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone')
}

export function toCalendarInput(cal: WorkCalendar): CalendarInput {
  return {
    timezone: cal.timezone,
    workingDays: [...cal.workingDays].sort((a, b) => a - b),
    weekStart: cal.weekStart.map((r) => ({ day: r.day, from: r.from })),
    holidays: [
      ...[...cal.offDates].map((date) => ({ date, kind: 'off' as const })),
      ...[...cal.workDates].map((date) => ({ date, kind: 'work' as const })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }
}

/** 범위를 정할 수 없는 요청(프로젝트 없음 + 워크스페이스를 하나로 못 정함 — 여러 워크스페이스 소속의 전역 화면)의 달력 = 제품 기본값.
 *  봇 스트림의 첫 라우팅(종류 판정 전용 — 인자는 쓰지 않는다)도 이것을 쓴다(과제 17) */
export const DEFAULT_REQUEST_CALENDAR: RequestCalendar = Object.freeze({
  timezone: DEFAULT_TIMEZONE, workingDays: new Set(DEFAULT_WORKING_DAYS), weekStart: DEFAULT_WEEK_RULES,
})

/**
 * 봇의 요청 범위 달력 한 벌(D13 ③) — 프로젝트가 있으면 그 프로젝트(workspaceId 는 보지 않는다), 없으면 워크스페이스, 둘 다 없으면
 * DEFAULT_REQUEST_CALENDAR. 날짜 앵커(오늘·이번 주)를 이것 하나로 정하고 도구는 자기 tz 로 '오늘'을 다시 계산하지 않는다.
 * 설정 조회 실패·손상은 그대로 던진다(호출부가 503·422 로).
 */
export async function resolveRequestCalendar(
  input: { projectId: string | null; workspaceId: string | null }, opts?: { client?: ConfigReadClient },
): Promise<RequestCalendar> {
  let cal: WorkCalendar
  if (input.projectId) {
    const { getProjectConfig } = await import('@/lib/settings/projectConfig')
    cal = requireCalendar(await getProjectConfig(input.projectId, opts))
  } else if (input.workspaceId) {
    const { getWorkspaceConfig } = await import('@/lib/settings/workspaceConfig')
    cal = requireCalendar(await getWorkspaceConfig(input.workspaceId, opts))
  } else return DEFAULT_REQUEST_CALENDAR
  return { timezone: cal.timezone, workingDays: cal.workingDays, weekStart: cal.weekStart }
}
