import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { UUID_RE } from '@/lib/domain/validate'
import { ROSTER_SELECT, personOf, toRosterMember } from '@/lib/data/memberSelect'
import { fetchAllPages } from '@/lib/data/paging'
import { projectsWithModule } from '@/lib/modules/gate'
import { getActorViewState } from '@/lib/authz'
import { canSeeProject } from '@/lib/domain/authz'
import { getProjectVocabs } from '@/lib/settings/projectConfig'
import type { VocabByProject, VocabValues } from '@/lib/settings/vocab'
import type {
  Meeting, MeetingAttendeeInfo, MeetingCategory, MeetingException, MeetingRecurrence,
} from '@/lib/domain/types'

type Row = Record<string, unknown>
type ServerClient = Awaited<ReturnType<typeof createServerClient>>

function mapMeeting(r: Row, attendeeIds: string[], extra: Partial<Meeting> = {}): Meeting {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    meetingDate: r.meeting_date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory,
    body: (r.body as string) ?? '',
    recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    attendeeIds,
    ...extra,
  }
}

function attendeeIdsFrom(r: Row): string[] {
  const raw = (r.meeting_attendees as { member_id: string }[] | null) ?? []
  return raw.map(a => a.member_id)
}

/**
 * 취소 회차를 부모 회의 조회에 함께 싣는 FK 임베드(0013_meetings.sql:47 의 meeting_id FK).
 * 별도 `.in()` 왕복 1회를 없앤다 — 회의 화면이 앱에서 가장 직렬 체인이 길다.
 */
const EXCEPTION_EMBED = 'meeting_exceptions(meeting_id, occurrence_date, kind)'

function toException(e: Row): MeetingException {
  return {
    meetingId: e.meeting_id as string,
    occurrenceDate: e.occurrence_date as string,
    kind: 'cancelled' as const,
  }
}

/** 임베드로 함께 온 예외들을 평탄화. */
function exceptionsFrom(rows: Row[]): MeetingException[] {
  return rows.flatMap(r => ((r.meeting_exceptions as Row[] | null) ?? []).map(toException))
}

/** 임베드가 불가했을 때만 쓰는 폴백 — 예외를 별도 왕복으로 읽는다. 실패면 null — 취소 회차가 되살아나 보이지 않게
 *  호출부가 회의 일정 전체를 실패로 보인다(에러 처리 3원칙 ①).
 *  끝까지 읽는다(fetchAllPages): 한 응답은 max_rows(1000)에서 오류 없이 잘리고, 임베드는 회의마다 따로 세지만 이 폴백은
 *  결과에 든 회의 전체의 합이라 먼저 닿는다. 잘린 채 돌려주면 잘려 나간 취소 회차가 살아 있는 일정으로 보인다.
 *  정렬은 유일 키(PK: meeting_id, occurrence_date). 잘림을 확인할 수 없거나(count 없음) 끝까지 못 읽은 것도 실패다.
 *  tag 는 로그 머리 — 로더 이름과 함께 어느 프로젝트·어느 범위의 조회였는지를 싣는다(selectMeetings 도 같다). */
async function fetchExceptionsByIds(
  sb: ServerClient, ids: string[], tag: string,
): Promise<MeetingException[] | null> {
  if (!ids.length) return []
  try {
    const rows = await fetchAllPages<Row>('meeting_exceptions', (from, to) => sb
      .from('meeting_exceptions')
      .select('meeting_id, occurrence_date, kind', { count: 'exact' })
      .in('meeting_id', ids)
      .order('meeting_id').order('occurrence_date')
      .range(from, to))
    return rows.map(toException)
  } catch (e) {
    console.error(`[${tag}] meeting_exceptions 조회 실패 — 회의 일정을 실패로 보인다:`, e instanceof Error ? e.message : e)
    return null
  }
}

type RowsResult = { data: Row[] | null; error: { message: string } | null }

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const ERR_MEETINGS_LOAD = '회의 일정을 불러오지 못했습니다.'

/** 내 회의 조회 결과 — 회의 조회 실패·예외 폴백 실패·내 명단 행 조회 실패는 ok:false(ERR_MEETINGS_LOAD). '이번 달 회의 없음'과 '못 읽음'을 가른다.
 *  단 meetings 모듈 판정 실패(설정 조회·손상)는 ok:false 가 아니라 그 프로젝트의 행 생략이다 — 로그는 [requireModule](스펙 §3 modules.* fail-closed, P13). */
export type MyMeetingsResult =
  /** categories = 보이는 회의의 프로젝트별 회의 범주(설정 meetings.categories). 못 읽은 프로젝트는 null — 화면은 code 를 보인다 */
  | { ok: true; meetings: Meeting[]; exceptions: MeetingException[]; categories: VocabByProject<'meetings.categories'> }
  | { ok: false; error: string }

/**
 * 예외 임베드를 태워 회의를 조회하고, 임베드가 원인일 수 있는 실패면 임베드 없이 1회 재시도한다.
 * 임베드는 관계 미탐지 시 **부모 쿼리 전체를 에러로 만들기** 때문에, 재시도가 없으면
 * 회의가 하나도 없는 것처럼 보인다(정상 상태와 구별 불가).
 * `embedded=false` 로 돌아오면 호출부가 예외를 별도 조회해야 한다. 재시도까지 실패하면 `failed=true`(rows 는 빈 배열) —
 * 호출부가 '회의 0건'과 구분해 처리한다.
 *
 * build 가 select 문자열을 받는 콜백인 이유: 임베드 유무로 PostgREST 의 추론 행 타입이 갈려
 * 같은 변수에 재대입할 수 없다. 호출부마다 필터가 달라 빌더 자체를 넘겨받는다.
 */
async function selectMeetings(
  build: (select: string) => PromiseLike<unknown>,
  cols: string,
  tag: string,
  consequence: string,
): Promise<{ rows: Row[]; embedded: boolean; failed: boolean }> {
  const first = await build(`${cols}, ${EXCEPTION_EMBED}`) as RowsResult
  if (!first.error) return { rows: (first.data ?? []) as Row[], embedded: true, failed: false }

  console.error(`[${tag}] 예외 임베드 조회 실패, 임베드 없이 재시도:`, first.error.message)
  const retry = await build(cols) as RowsResult
  if (retry.error) {
    console.error(`[${tag}] meetings 조회 실패 — ${consequence}:`, retry.error.message)
    return { rows: [], embedded: false, failed: true }
  }
  return { rows: (retry.data ?? []) as Row[], embedded: false, failed: false }
}

/** 프로젝트 전체 회의 시리즈 + 예외. body 제외(상세 모달에서 로드).
 *  회의 조회 실패는 결과로 돌려준다(members.ts 의 getProjectRoster 관례) — 달력·대시보드·보고서·회의록의 '회의 연결'
 *  드롭다운이 '회의 없음'과 '못 읽음'을 구분해 보인다(에러 처리 3원칙 ①).
 *  예외(취소 회차) 폴백 조회의 실패도 같은 실패다 — 예외 없이 회의만 돌려주면 취소된 회차가 살아 있는 일정으로 보인다. */
export const getProjectMeetingData = cache(async (
  projectId: string,
): Promise<{ ok: true; meetings: Meeting[]; exceptions: MeetingException[] } | { ok: false; error: string }> => {
  // 이 로더를 쓰는 화면(대시보드·프로젝트 회의)은 회의 조회 실패를 따로 로그로 남기지 않는다 — 어느 프로젝트의 실패인지는 여기서 싣는다.
  // projectId 는 URL 조각(/p/[projectId]/…)이나 서버 액션 인자로 와 형식이 보장되지 않는다: UUID 꼴이 아니면 그대로 찍지 않는다
  // (getMyMeetings 의 range 와 같다 — 줄바꿈으로 로그 줄을 지어낼 수 없게).
  const isUuid = UUID_RE.test(projectId)
  const tag = `getProjectMeetingData project=${isUuid ? projectId : '(id 아님)'}`

  // tag 만 가려서는 부족하다 — 조회가 나가면 Postgres 가 22P02 문구에 입력을 그대로 인용하고, 그 문구가 아래 실패 로그의
  // 둘째 인자로 실린다. UUID 꼴이 아니면 어차피 실패할 조회이므로 보내지 않는다(getMyMeetings 가 날짜 인자를 거르는 것과 같다).
  if (!isUuid) {
    console.error(`[${tag}] UUID 꼴이 아닌 프로젝트 id — 조회하지 않는다`)
    return { ok: false, error: ERR_MEETINGS_LOAD }
  }

  const sb = await createServerClient()
  const COLS = 'id, project_id, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)'

  // 예외를 임베드해 왕복 2회 → 1회.
  const { rows, embedded, failed } = await selectMeetings(
    select => sb.from('meetings').select(select)
      .eq('project_id', projectId).order('meeting_date', { ascending: true }),
    COLS, tag,
    '호출부가 회의 일정 대신 사유를 보인다',
  )
  if (failed) return { ok: false, error: ERR_MEETINGS_LOAD }

  const meetings = rows.map((r: Row) => mapMeeting(r, attendeeIdsFrom(r)))
  const exceptions = embedded
    ? exceptionsFrom(rows)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), tag)
  if (exceptions === null) return { ok: false, error: ERR_MEETINGS_LOAD }
  return { ok: true, meetings, exceptions }
})

/** 상세 모달 — body + 참석자 표시 정보. 없으면 null. */
export const getMeetingDetail = cache(async (
  id: string,
): Promise<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null> => {
  const sb = await createServerClient()
  const { data: r, error } = await sb
    .from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id)')
    .eq('id', id)
    .maybeSingle()

  // 조회 실패가 null 폴백을 타면 호출부(상세 모달)는 '삭제된 회의'로 오인한다 — 원인을 로그로 남긴다.
  if (error) console.error('[getMeetingDetail] 조회 실패:', error.message)
  if (!r) return null

  const attendeeIds = attendeeIdsFrom(r as Row)
  let attendees: MeetingAttendeeInfo[] = []
  if (attendeeIds.length) {
    const { data: mem, error: memErr } = await sb
      .from('project_members')
      .select(ROSTER_SELECT)
      .in('id', attendeeIds)
    // 참석자 조회 실패 = 참석자가 지정돼 있는데도 '참석자 없음'으로 보인다.
    if (memErr) console.error('[getMeetingDetail] 참석자 조회 실패:', memErr.message)
    // `.in()` 은 순서를 보장하지 않는다 — 정렬하지 않으면 참석자 칩과 안내 메일의 이름 순서가
    // 조회할 때마다 달라진다. 상세 모달·메일 본문·챗봇이 전부 이 배열을 그대로 쓰므로 여기서 가나다순으로 고정.
    // id tiebreak — `.in()` 결과에는 기준 순서가 없어, 이름만으로 정렬하면 동명이인의 앞뒤가 요청마다 뒤집힌다.
    attendees = ((mem ?? []) as Row[]).map(toRosterMember)
      .sort((x, y) => compareKoreanName(x.name, y.name) || x.id.localeCompare(y.id))
      .map(m => ({ id: m.id, name: m.name, email: m.email, teamCodes: m.teams.map(t => t.code) }))
  }
  return { meeting: mapMeeting(r as Row, attendeeIds), attendees }
})

/**
 * 로그인 계정에 연결된 활성 명단 행 id 집합(크로스 프로젝트) — '내 담당 이슈'·'내 회의' 판정 재료.
 * 계정 연결 정본은 `people.user_id` 하나다(SP1: 이메일 폴백 매칭 폐지). 비활성 명단 행·비활성 인물은
 * buildActor 와 같이 빼서, 빠진 사람의 옛 행이 '나'로 잡히지 않게 한다.
 * 외부 인력 행은 people.user_id NULL 이라 걸리지 않는다.
 * 조회 실패는 null — 무매칭([])과 갈라, 호출부가 '내 것 없음'으로 그릴지 실패로 보일지 정한다(에러 처리 3원칙 ①).
 */
export async function resolveMemberIds(
  sb: ServerClient,
  user: { id: string },
): Promise<string[] | null> {
  const { data, error } = await sb.from('project_members')
    .select('id, people!inner(user_id, active)')
    .eq('people.user_id', user.id).eq('active', true).eq('people.active', true)
  if (error) {
    console.error('[resolveMemberIds] 조회 실패:', error.message)
    return null
  }
  return [...new Set(((data ?? []) as Row[]).map(r => r.id as string))]
}

/**
 * 크로스 프로젝트 '내 회의' 범위 조회. body/location 제외(캘린더 필드만),
 * isMine(작성자==나 or 참석자에 내 member 포함) + projectName 세팅.
 * fetch 조건: 비반복은 [start,end], 반복은 meeting_date<=end AND (until IS NULL OR until>=start).
 * 비로그인은 빈 성공 결과(세션은 호출부가 따로 본다). 회의 조회 실패·예외 폴백 실패·내 명단 행 조회 실패는 ok:false —
 * 호출부가 '이번 달 회의 없음'·KPI 0 대신 사유를 보인다(에러 처리 3원칙 ①).
 * meetings 모듈이 꺼졌거나 판정이 실패한(설정 조회·손상) 프로젝트의 행은 뺀다(스펙 §4.2·§3 modules.* fail-closed, P13) — 그래서 판정이
 * 실패하면 달력이 비거나 일부가 빠진다. 그 원인은 [requireModule] 로그(범위 포함)에 남는다. /w/[slug]/meetings 진입의 워크스페이스 층 장애는
 * 페이지 관문이 404 로 먼저 닫으므로 빈 달력은 프로젝트 판정의 부분 실패(와 월 이동 새로고침)에서 생긴다. 화면 사유 표시는 SP3b(판정 [B3 F1]).
 * 범위는 그 워크스페이스 프로젝트의 회의만(D26 — 여러 소속의 회의를 한 달력에 섞지 않는다). workspaceId 는 호출부가 소속을 확인한 값이다.
 * 비공개 프로젝트(0070)의 회의는 명단 밖(워크스페이스·플랫폼 관리자 제외)에게 뺀다 — 숨김 규칙의 정본은 포털(portal.ts visibleProjectIds)과 같다:
 * 명단 밖이면 숨기고(canSeeProject), 권한 조회가 열화면 막는다(fail-closed — 숨길 것을 못 숨기느니 ok:false). 임베드한 is_private 로 같은 왕복에서 판정한다.
 */
export const getMyMeetings = cache(async (
  workspaceId: string,
  gridStartIso: string,
  gridEndIso: string,
): Promise<MyMeetingsResult> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const user = u.user
  const uid = user?.id ?? null
  if (!user || !uid) return { ok: true, meetings: [], exceptions: [], categories: {} }

  // 프로젝트를 가로지르는 조회라 로그에 실을 id 가 없다 — 어느 달력 범위였는지를 싣는다.
  // 두 인자는 서버 액션(fetchMyMeetings)을 거쳐 오므로 형식이 보장되지 않는다: 날짜 꼴이 아니면 그대로 찍지 않는다.
  const logDay = (s: string) => (ISO_DAY_RE.test(s) ? s : '(날짜 아님)')
  const tag = `getMyMeetings ws=${UUID_RE.test(workspaceId) ? workspaceId : '(형식 밖)'} range=${logDay(gridStartIso)}..${logDay(gridEndIso)}`

  // 두 인자는 아래 or() 필터 문자열에 그대로 끼워진다. 날짜 꼴이 아니면 필터를 만들기 전에 거부한다 —
  // RLS 가 읽을 수 있는 범위를 막아 주지만, 호출자가 필터 조건을 덧붙이게 두지는 않는다.
  if (!ISO_DAY_RE.test(gridStartIso) || !ISO_DAY_RE.test(gridEndIso)) {
    console.error(`[${tag}] 날짜 꼴이 아닌 인자 — 조회하지 않는다`)
    return { ok: false, error: ERR_MEETINGS_LOAD }
  }

  const orClause =
    `and(recurrence.eq.none,meeting_date.gte.${gridStartIso},meeting_date.lte.${gridEndIso}),` +
    `and(recurrence.neq.none,meeting_date.lte.${gridEndIso},or(recurrence_until.is.null,recurrence_until.gte.${gridStartIso}))`

  const COLS = 'id, project_id, title, meeting_date, start_time, end_time, category, recurrence, recurrence_until, created_by, created_by_name, created_at, updated_at, meeting_attendees(member_id), projects!inner(name, workspace_id, is_private)'

  // 멤버 ID 조회와 회의 조회는 서로 무관하다(멤버 ID 는 isMine 계산에만 쓰임) — 병렬로 묶고
  // 예외는 임베드로 같은 왕복에 태워 직렬 4단(getUser→멤버→회의→예외)을 2단으로 줄인다.
  // resolveMemberIds 를 직접 부른다: 예전의 getMyMemberIds() 래퍼는 자체 클라이언트로 getUser 를
  // 한 번 더 했다. 인자화한 cache() 로 바꾸면 안 된다 — React cache 는 인자의 참조 동일성으로
  // 키를 만드는데 user 객체가 호출마다 새로 만들어져 영구 미스가 된다.
  const [myMemberIdList, { rows, embedded, failed }, view] = await Promise.all([
    resolveMemberIds(sb, user),
    selectMeetings(
      select => sb.from('meetings').select(select).eq('projects.workspace_id', workspaceId).or(orClause).order('meeting_date', { ascending: true }),
      COLS, tag,
      '호출부가 내 회의 달력 대신 사유를 보인다',
    ),
    getActorViewState(),
  ])
  // 내 명단 행을 못 읽으면 참석자로만 든 회의가 전부 isMine=false 가 된다 — 회의는 읽었어도 '내 회의 없음'·KPI 0 으로
  // 그려지므로 같은 실패로 돌려준다. 원인은 resolveMemberIds 가 남기지만 그 로그에는 로더 이름도 범위도 없고
  // 호출부가 둘이라(이슈 화면) 이 화면의 실패로 짚을 수 없다 — 같은 tag 로 한 줄 더 남긴다.
  if (myMemberIdList === null) {
    console.error(`[${tag}] 내 명단 행 조회 실패 — 호출부가 내 회의 달력 대신 사유를 보인다(원인은 [resolveMemberIds] 로그)`)
  }
  if (failed || myMemberIdList === null) return { ok: false, error: ERR_MEETINGS_LOAD }
  // 비공개 거르기(FA1) — 권한 조회가 열화면 누가 명단에 있는지 모른다: 막는다(포털 visibleProjectIds 와 같은 fail-closed)
  if (view.degraded) {
    console.error(`[${tag}] 권한 조회 열화 — 비공개 프로젝트를 거를 수 없어 회의를 돌려주지 않는다`)
    return { ok: false, error: ERR_MEETINGS_LOAD }
  }
  const shown = rows.filter((r: Row) => canSeeProject(view.actor, {
    id: r.project_id as string, is_private: ((r.projects as { is_private?: boolean | null } | null)?.is_private) ?? null,
  }))
  // 목록형 응답은 meetings 모듈이 꺼진 프로젝트의 행을 뺀다(스펙 §4.2). 판정 실패도 뺀다(관문이 로그를 남긴다 — fail-closed)
  const on = new Set(await projectsWithModule([...new Set(shown.map((r: Row) => r.project_id as string))], 'meetings'))
  const visible = shown.filter((r: Row) => on.has(r.project_id as string))
  const myMemberIds = new Set(myMemberIdList)

  const meetings = visible.map((r: Row) => {
    const attendeeIds = attendeeIdsFrom(r)
    const projectName = ((r.projects as { name: string } | null)?.name) ?? null
    const isMine = (r.created_by as string | null) === uid || attendeeIds.some(id => myMemberIds.has(id))
    // 목록 payload 는 body/location 미포함(상세에서 로드)
    return mapMeeting({ ...r, body: '', location: null }, attendeeIds, {
      projectName: projectName ?? undefined,
      isMine,
    })
  })

  const exceptions = embedded
    ? exceptionsFrom(visible)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), tag)
  if (exceptions === null) return { ok: false, error: ERR_MEETINGS_LOAD }
  // 범주 라벨·색은 곁가지 — 못 읽어도 회의는 그린다(라벨 자리에 code). 실패는 로그로 남긴다(3원칙 ①)
  const categories: Record<string, VocabValues['meetings.categories'] | null> = {}
  try {
    for (const [pid, list] of await getProjectVocabs([...on], 'meetings.categories', { client: sb })) categories[pid] = list
  } catch (e) {
    console.error(`[${tag}] 회의 범주 조회 실패 — 범주는 code 로 보인다`, e)
  }
  return { ok: true, meetings, exceptions, categories }
})

/**
 * 대시보드 회의 행에 얹는 body(메모)·참석자 이름 — **표시되는 행의 시리즈만** 대상으로 왕복 2회(병렬).
 * getProjectMeetingData 에 body 를 싣지 않는 이유: 그 결과는 달력·회의록 드롭다운이 공유하는데
 * 회의록 본문이 긴 시리즈가 많아 프로젝트 전체를 실으면 payload 가 불필요하게 커진다.
 * 실패는 로깅하고 빈 맵 — 참석자·메모 칸만 비어 보이고 일정 자체는 살아남는다(표시=로깅).
 */
export async function getMeetingRowExtras(
  seriesIds: string[],
  memberIds: string[],
): Promise<{ bodies: Record<string, string>; memberNames: Record<string, string> }> {
  if (!seriesIds.length && !memberIds.length) return { bodies: {}, memberNames: {} }
  const sb = await createServerClient()
  const none = (): RowsResult => ({ data: [], error: null })
  const [b, m] = await Promise.all([
    seriesIds.length ? sb.from('meetings').select('id, body').in('id', seriesIds) as PromiseLike<RowsResult> : none(),
    memberIds.length ? sb.from('project_members').select('id, people!inner(display_name)').in('id', memberIds) as PromiseLike<RowsResult> : none(),
  ])
  if (b.error) console.error('[getMeetingRowExtras] 메모 조회 실패(대시보드 회의 행 메모가 비어 보임):', b.error.message)
  if (m.error) console.error('[getMeetingRowExtras] 참석자 조회 실패(대시보드 회의 행 참석자가 비어 보임):', m.error.message)

  const bodies: Record<string, string> = {}
  for (const r of b.data ?? []) bodies[r.id as string] = (r.body as string | null) ?? ''
  const memberNames: Record<string, string> = {}
  for (const r of m.data ?? []) {
    const name = personOf(r)?.display_name
    if (name) memberNames[r.id as string] = name
  }
  return { bodies, memberNames }
}
