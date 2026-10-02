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

/** 두 달력이 '오늘'·주 계산에서 같은가 — tz·주 규칙·근무 요일(워크스페이스에는 날짜 예외가 없다) */
function sameRequestCalendar(a: RequestCalendar, b: RequestCalendar): boolean {
  const days = (c: RequestCalendar) => [...c.workingDays].sort((x, y) => x - y).join(',')
  return a.timezone === b.timezone && JSON.stringify(a.weekStart) === JSON.stringify(b.weekStart) && days(a) === days(b)
}

/**
 * 소속 워크스페이스들로 정하는 요청·화면 달력(A-3 리뷰 P2, 컨트롤러 판정 M3) — 소속이 없으면 제품 기본값, 하나면 그 워크스페이스,
 * 여럿이면 달력(tz·주 시작·근무 요일)이 모두 같을 때 그 달력, 다르면 제품 기본값(UTC — 전역 화면은 basis 로 '기준 시간대' 한 줄
 * (ViewBasisNotice), 봇 답은 기준 tz 이름을 적는다).
 * 이관 ⑨ 가 기존 워크스페이스 전부에 같은 tz 를 적으므로, 여러 곳에 속한 사람도 소속이 모두 같으면 UTC 로 떨어지지 않는다.
 * 판독 실패·손상(A-4 리뷰 P2, 판정 N2 (a)): 하나뿐인 소속이면 던진다(그 사용자의 유일한 달력 — 대체하지 않는다). 여럿 중 하나라도 판독할 수
 * 없으면 "같다를 판정할 수 없음 = 다름"으로 보고 제품 기본값 — 전역 화면 넷이 basis 'unreadable' 로 그 사실을 적고(A-5 리뷰 O2) 봇은 기준 tz 를
 * 적으므로 위장이 아니고, 실패는 로그에 남긴다
 * (3원칙 ① 표시 = 로깅). 다른 워크스페이스의 손상이 전역 화면 전부를 멈추지 않게 한다. 설정 오류가 아닌 예외(결함)는 그대로 던진다.
 */
export async function resolveMemberWorkspacesCalendar(
  workspaceIds: readonly string[], opts?: { client?: ConfigReadClient },
): Promise<RequestCalendar> {
  return (await resolveMemberWorkspacesCalendarBasis(workspaceIds, opts)).calendar
}

/** 전역 화면의 달력이 어디서 왔나 — member(소속 달력)·none(소속 없음)·differs(여럿이 서로 다름)·unreadable(여럿 중 판독 실패).
 *  뒤 둘은 제품 기본값으로 계산한 것이라 화면이 그 사실을 한 줄로 적는다(A-5 리뷰 O2 — 표시 = 로깅) */
export type MemberCalendarBasis = 'member' | 'none' | 'differs' | 'unreadable'

/** resolveMemberWorkspacesCalendar 와 같은 판정 + 그 근거(basis) */
export async function resolveMemberWorkspacesCalendarBasis(
  workspaceIds: readonly string[], opts?: { client?: ConfigReadClient },
): Promise<{ calendar: RequestCalendar; basis: MemberCalendarBasis }> {
  if (workspaceIds.length === 0) return { calendar: DEFAULT_REQUEST_CALENDAR, basis: 'none' }
  if (workspaceIds.length === 1) return { calendar: await resolveRequestCalendar({ projectId: null, workspaceId: workspaceIds[0] }, opts), basis: 'member' }
  // 해석기는 한 번만 불러온다(순환 회피의 동적 import — resolveRequestCalendar 주석) — 그 뒤 워크스페이스마다 병렬로 판독
  const { getWorkspaceConfig } = await import('@/lib/settings/workspaceConfig')
  const cals: (RequestCalendar | null)[] = await Promise.all(workspaceIds.map(async (id) => {
    try {
      const cal = requireCalendar(await getWorkspaceConfig(id, opts))
      return { timezone: cal.timezone, workingDays: cal.workingDays, weekStart: cal.weekStart }
    } catch (e) {
      if (!(e instanceof ConfigKeyError) && !(e instanceof ConfigUnavailableError)) throw e
      console.error('[calendar] 소속 워크스페이스 달력을 읽지 못해 기본값(UTC)으로 판정한다', { workspaceId: id, cause: e.message })
      return null
    }
  }))
  if (cals.some((c) => c === null)) return { calendar: DEFAULT_REQUEST_CALENDAR, basis: 'unreadable' }
  const [first, ...rest] = cals as RequestCalendar[]
  return rest.every((c) => sameRequestCalendar(first, c)) ? { calendar: first, basis: 'member' } : { calendar: DEFAULT_REQUEST_CALENDAR, basis: 'differs' }
}
