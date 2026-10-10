'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { getActor, requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP, ERR_ANON, ERR_DENIED, guardCodeOf } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { enqueueIndexChange } from '@/lib/ai/index/enqueueChange'
import { isWorkspaceMember, type Actor } from '@/lib/domain/authz'
import { revalidatePath } from 'next/cache'
import { ERR_MEETING_DETAIL, ERR_MEETINGS_LOAD, getMyMeetings, getMeetingDetail, type MeetingDetailResult, type MyMeetingsResult } from '@/lib/data/meetings'
import { expandMeetings, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { checkProjectVocab, vocabWriteFailure } from '@/lib/settings/vocabGuard'
import { displayNameFrom } from '@/lib/domain/display-name'
import { SAFE_ID_RE } from '@/lib/domain/validate'
import type { Meeting, MeetingCategory, MeetingRecurrence } from '@/lib/domain/types'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'

export interface MeetingInput {
  title: string
  meetingDate: string           // 'YYYY-MM-DD'
  startTime: string | null      // 'HH:MM' | null(종일)
  endTime: string | null
  location: string | null
  category: MeetingCategory
  body: string
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null
  attendeeIds: string[]
}

export interface MeetingActionResult {
  ok: boolean
  error?: string
  id?: string
}

const TITLE_MAX = 200
const BODY_MAX = 20000
const LOCATION_MAX = 200
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(t: ServerTranslate, input: MeetingInput): string | null {
  const title = input.title.trim()
  if (!title) return t('err.enterTitle')
  if (title.length > TITLE_MAX) return fill(t('err.titleMustCharactersFewer'), { titleMax: TITLE_MAX })
  if (!DATE_RE.test(input.meetingDate)) return t('err.dateFormatNotValid')
  if (input.startTime !== null && !TIME_RE.test(input.startTime)) return t('srv.meetings.startTimeFormatNotValid')
  if (input.endTime !== null && !TIME_RE.test(input.endTime)) return t('srv.meetings.endTimeFormatNotValid')
  if (input.endTime !== null && input.startTime === null) return t('srv.meetings.endTimeCannotEnteredAlone')
  if (input.startTime && input.endTime && input.endTime <= input.startTime) return t('srv.meetings.endTimeMustAfterStart')
  if (input.body.length > BODY_MAX) return fill(t('srv.meetings.minutesMustCharactersFewer'), { bodyMax: BODY_MAX })
  if (input.location && input.location.length > LOCATION_MAX) return fill(t('srv.meetings.locationMustCharactersFewer'), { locationMax: LOCATION_MAX })
  if (typeof input.category !== 'string' || !input.category) return t('err.invalidCategory')   // 활성 여부는 checkProjectVocab(설정 meetings.categories)
  if (!RECURRENCE_ORDER.includes(input.recurrence)) return t('srv.meetings.invalidRepeatOption')
  if (input.recurrence === 'none' && input.recurrenceUntil !== null) return t('srv.meetings.endDateCannotSetWhen')
  if (input.recurrence !== 'none') {
    if (!input.recurrenceUntil || !DATE_RE.test(input.recurrenceUntil)) return t('srv.meetings.enterRepeatEndDate')
    if (input.recurrenceUntil < input.meetingDate) return t('srv.meetings.repeatEndDateMustAfter')
  }
  return null
}

function toRow(input: MeetingInput) {
  return {
    title: input.title.trim(),
    meeting_date: input.meetingDate,
    start_time: input.startTime,
    end_time: input.endTime,
    location: input.location?.trim() || null,
    category: input.category,
    body: input.body,
    recurrence: input.recurrence,
    recurrence_until: input.recurrence === 'none' ? null : input.recurrenceUntil,
  }
}

function revalidateMeetings(projectId: string) {
  revalidatePath(`/p/${projectId}/meetings`)
  revalidatePath('/(app)/w/[slug]/meetings', 'page')
}

/**
 * 수정·삭제 계열의 공통 게이트 — 대상 회의의 프로젝트를 먼저 확정한 뒤 그 프로젝트의
 * 관리자면 무조건 통과시키고, 아니면 '작성자 본인' 판정을 호출부로 넘긴다(각 액션이 이미
 * 자기 목적의 행을 조회하므로 created_by 비교는 거기서 한다).
 * 비로그인·권한 조회 실패는 가드 문구 그대로 중단한다(fail-closed).
 */
type OwnerGate = { ok: true; isAdmin: boolean; userId: string } | { ok: false; error: string }
async function adminOrOwnerGate(meetingId: string): Promise<OwnerGate> {
  const found = await resolveProjectId('meetings', meetingId)
  if (!found.ok) return { ok: false, error: found.error }
  if (!found.projectId) return { ok: false, error: ERR_LOOKUP }          // meetings.project_id 는 not null — 풀지 못하면 중단(3원칙 ②)
  const g = await requireProjectAdmin(found.projectId)
  let pass: OwnerGate
  if (g.ok) pass = { ok: true, isAdmin: true, userId: g.actor.userId }
  else {
    let actor: Awaited<ReturnType<typeof getActor>> = null
    try { actor = await getActor() } catch { actor = null }
    if (!actor) return { ok: false, error: g.error }
    pass = { ok: true, isAdmin: false, userId: actor.userId }
  }
  const mod = await requireModule({ projectId: found.projectId }, 'meetings')   // 스펙 §4.2 — 작성자 판정은 호출부가 한다(관문은 그 전)
  if (!mod.ok) return { ok: false, error: mod.error }
  return pass
}

/** 참석자 전체 교체(시리즈 단위). 소유권은 부모 RLS 가 강제. */
async function replaceAttendees(sb: Awaited<ReturnType<typeof createServerClient>>, meetingId: string, projectId: string, memberIds: string[]): Promise<string | null> {
  const unique = [...new Set(memberIds)]
  if (unique.length === 0) {
    const { error: clrErr } = await sb.from('meeting_attendees').delete().eq('meeting_id', meetingId)
    return clrErr ? clrErr.message : null
  }
  // 다른 프로젝트 멤버 혼입 방지 — meeting 의 project_id 에 속한 활성 명단 행·활성 인물만 허용
  // 유효성 검증을 delete 보다 먼저 수행해, 잘못된 id 목록이 기존 참석자를 먼저 지워버리는 것을 방지한다.
  const { data: valid, error: validErr } = await sb
    .from('project_members')
    .select('id, people!inner(active)')
    .eq('project_id', projectId)
    .eq('active', true)
    .eq('people.active', true)
    .in('id', unique)
  // 쓰기 선행 검증 조회 — 실패를 '유효 멤버 0명'으로 오인하면 참석자 변경이 통째로 유실되면서
  // 액션은 ok:true 로 성공을 보고한다. 실패는 실패로 올려 호출자가 ok:false 를 내게 한다.
  if (validErr) {
    console.error('[replaceAttendees] 멤버 검증 조회 실패:', validErr.message)
    return validErr.message
  }
  const validIds = (valid ?? []).map((r: { id: string }) => r.id)
  if (validIds.length === 0) return null
  const { error: delErr } = await sb.from('meeting_attendees').delete().eq('meeting_id', meetingId)
  if (delErr) return delErr.message // 삭제 실패를 삼키면 이어지는 insert 가 중복 참석자/unique 위반이 된다
  // project_id 필수(0003) — (meeting_id, project_id)·(member_id, project_id) 복합 FK 가 교차 프로젝트 참석을 DB 에서도 막는다.
  const { error } = await sb.from('meeting_attendees').insert(validIds.map(id => ({ meeting_id: meetingId, member_id: id, project_id: projectId })))
  return error ? error.message : null
}

export async function createMeeting(projectId: string, input: MeetingInput): Promise<MeetingActionResult> {
  const t = await serverTranslator()
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'meetings')                  // 스펙 §4.2 — 가드 뒤·입력 검증 앞(P17)
  if (!mod.ok) return { ok: false, error: mod.error }
  const err = validate(t, input)
  if (err) return { ok: false, error: err }
  const catErr = await checkProjectVocab(projectId, 'meetings.categories', input.category)
  if (catErr) return { ok: false, error: catErr }

  const user = await getSession()
  if (!user) return { ok: false, error: ERR_ANON }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('meetings')
    .insert({
      ...toRow(input),
      project_id: projectId,
      created_by: user.id,
      // full_name 이 1차 — 과거 .name 을 읽어 항상 이메일 폴백을 타던 버그(created_by_name 은 insert 시점 박제)
      created_by_name: displayNameFrom(user.user_metadata, user.email),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: vocabWriteFailure(error) ?? error.message }
  const meetingId = data.id as string
  const attErr = await replaceAttendees(sb, meetingId, projectId, input.attendeeIds)
  if (attErr) {
    // 참석자 저장 실패 시 방금 생성한 회의를 롤백(보상)해 고아 회의가 남지 않게 한다.
    const { error: rbErr } = await sb.from('meetings').delete().eq('id', meetingId)
    // 롤백까지 실패하면 참석자 0명짜리 회의가 DB 에 남는다. 이때 '생성 실패'로만 알리면
    // 사용자가 재시도해 중복 회의를 만들므로, 목록 확인을 유도하는 메시지로 바꾼다.
    if (rbErr) {
      console.error('[createMeeting] 참석자 저장 실패 후 회의 롤백 실패(고아 회의 잔존):', rbErr.message)
      revalidateMeetings(projectId)
      return { ok: false, error: fill(t('srv.meetings.couldNotSaveAttendees'), { attErr }) }
    }
    return { ok: false, error: attErr }
  }
  await enqueueIndexChange({ domain: 'meetings', projectId, entityId: meetingId })
  revalidateMeetings(projectId)
  return { ok: true, id: meetingId }
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<MeetingActionResult> {
  const t = await serverTranslator()
  const gate = await adminOrOwnerGate(id)
  if (!gate.ok) return { ok: false, error: gate.error }
  const err = validate(t, input)
  if (err) return { ok: false, error: err }

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0-row 무음 성공 방지) + 규칙 변경 감지
  const { data: cur, error: curErr } = await sb
    .from('meetings')
    .select('project_id, created_by, meeting_date, recurrence, recurrence_until, category')
    .eq('id', id)
    .maybeSingle()
  if (curErr) return { ok: false, error: ERR_LOOKUP } // 소유권 판정의 입력이다 — 실패를 '없음'으로 위장하지 않는다
  if (!cur) return { ok: false, error: t('err.meetingNotFound') }
  const isOwner = (cur.created_by as string | null) === gate.userId
  if (!gate.isAdmin && !isOwner) return { ok: false, error: ERR_DENIED }
  const projectId = cur.project_id as string
  // 범주를 그대로 두는 수정은 비활성 범주여도 통과(트리거와 같은 규칙)
  const catErr = await checkProjectVocab(projectId, 'meetings.categories', input.category, (cur.category as string | null) ?? null)
  if (catErr) return { ok: false, error: catErr }

  const { error } = await sb
    .from('meetings')
    .update({ ...toRow(input), updated_at: new Date().toISOString() }) // created_by 는 SET 하지 않음(불변)
    .eq('id', id)
    .select('id')
    .single()
  if (error) return { ok: false, error: vocabWriteFailure(error) ?? error.message }

  // 시작일/반복규칙/종료일이 바뀌면 취소 예외가 어긋나므로 전부 삭제(정직한 v1 의미)
  const ruleChanged =
    (cur.meeting_date as string) !== input.meetingDate ||
    (cur.recurrence as string) !== input.recurrence ||
    ((cur.recurrence_until as string | null) ?? null) !== input.recurrenceUntil
  if (ruleChanged) {
    const { error: exErr } = await sb.from('meeting_exceptions').delete().eq('meeting_id', id)
    if (exErr) return { ok: false, error: exErr.message }
  }

  await enqueueIndexChange({ domain: 'meetings', projectId, entityId: id })
  const attErr = await replaceAttendees(sb, id, projectId, input.attendeeIds)
  // 회의 본문 수정은 이미 커밋됨 — 참석자 저장이 실패해도 변경분이 반영되도록 revalidate 후 에러 보고.
  revalidateMeetings(projectId)
  if (attErr) return { ok: false, error: attErr }
  return { ok: true, id }
}

export async function deleteMeeting(id: string): Promise<MeetingActionResult> {
  const t = await serverTranslator()
  const gate = await adminOrOwnerGate(id)
  if (!gate.ok) return { ok: false, error: gate.error }
  const sb = await createServerClient()
  const { data: cur, error: curErr } = await sb.from('meetings').select('project_id, created_by').eq('id', id).maybeSingle()
  if (curErr) return { ok: false, error: ERR_LOOKUP }
  if (!cur) return { ok: false, error: t('err.meetingNotFound') }
  const isOwner = (cur.created_by as string | null) === gate.userId
  if (!gate.isAdmin && !isOwner) return { ok: false, error: ERR_DENIED }

  const { error } = await sb.from('meetings').delete().eq('id', id).select('id').single()
  if (error) return { ok: false, error: error.message }
  await enqueueIndexChange({ domain: 'meetings', projectId: cur.project_id as string, entityId: id, operation: 'delete' })
  revalidateMeetings(cur.project_id as string)
  return { ok: true }
}

/** occurrenceDate 가 실제 규칙상 회차인지 검증 후 취소 예외행 insert. */
export async function cancelOccurrence(meetingId: string, occurrenceDate: string): Promise<MeetingActionResult> {
  const gate = await occurrenceGate(meetingId, occurrenceDate)
  if (!gate.ok) return gate
  const sb = gate.sb
  const { error } = await sb
    .from('meeting_exceptions')
    .upsert({ meeting_id: meetingId, occurrence_date: occurrenceDate, kind: 'cancelled' }, { onConflict: 'meeting_id,occurrence_date' })
  if (error) return { ok: false, error: error.message }
  revalidateMeetings(gate.projectId)
  return { ok: true }
}

type Gate = { ok: true; sb: Awaited<ReturnType<typeof createServerClient>>; projectId: string } | { ok: false; error: string }
async function occurrenceGate(meetingId: string, occurrenceDate: string): Promise<Gate> {
  const t = await serverTranslator()
  const gate = await adminOrOwnerGate(meetingId)
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: t('err.invalidDate') }
  const sb = await createServerClient()
  const { data: r, error: rErr } = await sb
    .from('meetings')
    .select('project_id, created_by, title, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until, created_by_name, created_at, updated_at')
    .eq('id', meetingId)
    .maybeSingle()
  if (rErr) return { ok: false, error: ERR_LOOKUP }
  if (!r) return { ok: false, error: t('err.meetingNotFound') }
  const isOwner = (r.created_by as string | null) === gate.userId
  if (!gate.isAdmin && !isOwner) return { ok: false, error: ERR_DENIED }
  if (r.recurrence === 'none') return { ok: false, error: t('srv.meetings.onlyRepeatingMeetingsCanCancel') }
  // 규칙상 실제 회차인지 검증 — 해당 날짜만 전개해 매칭
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: r.created_by as string | null,
    createdByName: (r.created_by_name as string | null) ?? null, createdAt: r.created_at as string,
    updatedAt: r.updated_at as string, attendeeIds: [],
  } satisfies Meeting
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) return { ok: false, error: t('err.dateNotOccurrenceMeeting') }
  return { ok: true, sb, projectId: r.project_id as string }
}

/** 클라이언트(내 회의 뷰)에서 월 이동 시 호출하는 얇은 래퍼. 로더의 실패(ok:false)는 그대로 넘긴다 —
 *  뷰가 빈 달 대신 사유와 재시도를 보인다(에러 처리 3원칙 ①). 모듈 관문 거부(설정 조회 실패 포함)는 빈 값 — 로그는 관문이 남긴다
 *  (P13·Ruling B3 F1). 범위는 화면의 워크스페이스(인자) — 소속이 아니면 빈 달력(존재 은닉, D26). 관문은 소속 확인 뒤·입력 검증 앞(P17). */
export async function fetchMyMeetings(
  workspaceId: string,
  gridStartIso: string,
  gridEndIso: string,
): Promise<MyMeetingsResult> {
  const user = await getSession()
  if (!user) return { ok: true, meetings: [], exceptions: [], categories: {} }
  let actor: Actor | null
  try { actor = await getActor() } catch { return { ok: false, error: ERR_MEETINGS_LOAD } }
  // 플랫폼 관리자는 소속과 무관하게 참이라 임의 문자열이 관문 로그·설정 조회 오류에 실린다 — 그 입력만 모양(SAFE_ID_RE)을 먼저 본다(FA3)
  if (typeof workspaceId !== 'string' || !workspaceId || (actor?.isSuperuser && !SAFE_ID_RE.test(workspaceId)) || !isWorkspaceMember(actor, workspaceId)) return { ok: true, meetings: [], exceptions: [], categories: {} }
  const mod = await requireModule({ workspaceId }, 'meetings')
  if (!mod.ok) return { ok: true, meetings: [], exceptions: [], categories: {} }
  return await getMyMeetings(workspaceId, gridStartIso, gridEndIso)
}

/** 상세 모달에서 호출하는 얇은 래퍼 — getMeetingDetail(서버 전용)을 세션 게이트 후 위임.
 *  결과형(SP5 B2 — D39): 없음·거부·꺼진 모듈은 detail null(존재 은닉), 범위 조회 실패·상세 조회 실패는 ok:false(모달이 사유를 보인다) */
export async function fetchMeetingDetail(id: string): Promise<MeetingDetailResult> {
  const none: MeetingDetailResult = { ok: true, detail: null }
  const user = await getSession()
  if (!user) return none
  // 모듈 관문(스펙 §4.2) — 회의 행의 프로젝트로 판정한다. 범위 조회 실패는 실패, 없음·거부는 '없음'
  const scope = await resolveProjectId('meetings', id)
  if (!scope.ok) return guardCodeOf(scope) === 'lookup' ? { ok: false, error: ERR_MEETING_DETAIL } : none
  if (!scope.projectId) return none
  const mod = await requireModule({ projectId: scope.projectId }, 'meetings')
  if (!mod.ok) return none
  return await getMeetingDetail(id)
}
