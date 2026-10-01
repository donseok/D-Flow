'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { revalidatePath } from 'next/cache'
import { expandMeetings } from '@/lib/domain/meetings'
import { composeAnnouncementFromMeeting, isoMicros, validateAnnouncementInput, type AnnouncementInput } from '@/lib/domain/announcements'
import type { MeetingCategory, MeetingRecurrence } from '@/lib/domain/types'
import { seoulToday } from '@/lib/domain/dates'

// 입력 타입·검증은 도메인(순수)이 정본 — 폼과 액션이 같은 규칙을 쓴다(0091 마일스톤 일자 포함).
export type { AnnouncementInput }

export interface AnnouncementActionResult {
  ok: boolean
  error?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 공지 목록·대시보드 카드 동시 갱신 */
function revalidateAnnouncements(projectId: string) {
  revalidatePath(`/p/${projectId}/announcements`)
  revalidatePath(`/p/${projectId}/dashboard`)
}

export async function createAnnouncement(
  projectId: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'announcements')             // 스펙 §4.2 — 가드 뒤·입력 검증 앞(P17)
  if (!mod.ok) return { ok: false, error: mod.error }
  const err = validateAnnouncementInput(input)
  if (err) return { ok: false, error: err }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .insert({
      project_id: projectId,
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      milestone_date: input.milestoneDate,
      created_by: g.actor.userId,
    })
    .select('created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  // 작성자 본인에게 방금 쓴 공지가 '안읽음'(NEW 칩·배지)으로 잡히지 않도록 워터마크 전진
  if (data?.created_at) {
    await advanceSeenWatermark(projectId, g.actor.userId, data.created_at as string)
  }
  revalidateAnnouncements(projectId)
  return { ok: true }
}

export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<AnnouncementActionResult> {
  // projectId 를 인자로 받지 않으므로 대상 행에서 먼저 읽는다 — 선행 조회 실패는 쓰기 중단 사유.
  const found = await resolveProjectId('announcements', id)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!found.projectId) return { ok: false, error: ERR_LOOKUP }          // 플랫폼 관리자는 null 로도 가드를 지난다 — 풀지 못하면 중단(3원칙 ②)
  const mod = await requireModule({ projectId: found.projectId }, 'announcements')
  if (!mod.ok) return { ok: false, error: mod.error }
  const err = validateAnnouncementInput(input)
  if (err) return { ok: false, error: err }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .update({
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      milestone_date: input.milestoneDate,
      updated_at: new Date().toISOString(), // updated_at 트리거 없음 — 수동 갱신(wbs.ts 관례)
    })
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const found = await resolveProjectId('announcements', id)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!found.projectId) return { ok: false, error: ERR_LOOKUP }
  const mod = await requireModule({ projectId: found.projectId }, 'announcements')
  if (!mod.ok) return { ok: false, error: mod.error }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .delete()
    .eq('id', id)
    .select('project_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.project_id) revalidateAnnouncements(data.project_id as string)
  return { ok: true }
}

/**
 * 워터마크 전진 — 뒤로 가지 않는다(greatest). 오래된 탭의 늦은 호출이나 중복 방문이
 * 이미 앞선 워터마크를 되돌리지 않도록 기존 값과 비교 후 더 클 때만 기록한다.
 * (읽기→쓰기 2단계라 극단적 동시 호출에서 작은 값이 이길 수 있으나, 그 경우
 * 일부 공지가 다시 '안읽음'으로 보일 뿐 — 안전한 방향으로 실패한다.)
 */
async function advanceSeenWatermark(
  projectId: string,
  userId: string,
  seenAt: string,
): Promise<AnnouncementActionResult> {
  const sb = await createServerClient()
  const { data: existing } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle()
  const current = existing?.last_seen_at as string | undefined
  // µs 로 비교한다 — ms 로 비교하면 예전 코드가 잘라 둔 워터마크(.483)가 같은 공지의 µs 값(.483017)과 '같다'고 보여 앞으로 가지 않는다
  const cur = current ? isoMicros(current) : null
  const next = isoMicros(seenAt)
  if (cur !== null && next !== null && cur >= next) return { ok: true }
  const { error } = await sb.from('announcement_seen').upsert(
    { user_id: userId, project_id: projectId, last_seen_at: seenAt },
    { onConflict: 'user_id,project_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 공지 확인 처리 — 렌더 시점에 실제로 보인 마지막 공지 시각(seenAt)까지만 읽음 처리.
 * 액션 실행 시각이 아니라 스냅샷 기준이라, 렌더~호출 사이에 도착한 공지는
 * 안읽음으로 남는다. 게스트 포함 모든 인증 사용자.
 */
export async function markAnnouncementsSeen(
  projectId: string,
  seenAt: string,
): Promise<AnnouncementActionResult> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const mod = await requireModule({ projectId }, 'announcements')
  if (!mod.ok) return { ok: false, error: mod.error }
  const micros = typeof seenAt === 'string' ? isoMicros(seenAt) : null
  if (micros === null) return { ok: false, error: '잘못된 시각입니다.' }
  // 미래 시각 방지(클라이언트 값 신뢰 금지) — now 로 클램프. 과거 시각은 µs 그대로 둔다(DB created_at 과 같은 정밀도)
  const clamped = micros > BigInt(Date.now()) * BigInt(1000) ? new Date().toISOString() : seenAt
  return advanceSeenWatermark(projectId, user.id, clamped)
}

/**
 * 셸 배지용 안읽음 공지 수(/api/shell — 프로젝트 내비 '공지'·벨) — 워터마크 이후 생성된 "오늘 게시중" 공지 count.
 * 조회 오류는 던진다 — 셸 라우트가 null(모름)로 바꾼다. 0 으로 위장하지 않는다(3원칙 ①, D34). 모듈 꺼짐은 오류가 아니라 0.
 * 게시기간 필터가 없으면 만료 공지가 영구 안읽음으로 남는다(일반 사용자는 만료 공지를
 * 목록에서 볼 수 없어 워터마크가 그것을 넘지 못함). getTopAnnouncements와 같은 조건.
 */
export async function getUnreadAnnouncementCount(projectId: string): Promise<number> {
  const user = await getSession()
  if (!user) return 0
  const mod = await requireModule({ projectId }, 'announcements')            // 셸 배지 — 꺼지면 0(§4.2 셸 행)
  if (!mod.ok) return 0
  const sb = await createServerClient()
  const { data: seen, error: seenError } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle()
  // 워터마크를 못 읽으면 전부 안읽음으로 셀 수 없다 — 모름(throw)
  if (seenError) throw new Error(`공지 워터마크 조회 실패: ${seenError.message}`)

  const today = seoulToday()
  // 게시중만: (from is null 또는 from<=today) AND (to is null 또는 to>=today).
  // .or() 는 서로 AND 결합 — 각 경계를 별도 .or() 로 건다.
  let query = sb
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .or(`publish_from.is.null,publish_from.lte.${today}`)
    .or(`publish_to.is.null,publish_to.gte.${today}`)
  if (seen?.last_seen_at) query = query.gt('created_at', seen.last_seen_at as string)
  const { count, error } = await query
  if (error) throw new Error(`공지 안읽음 수 조회 실패: ${error.message}`)
  return count ?? 0
}

/**
 * 회의 1회차를 바탕으로 공지사항 1건을 생성한다(원클릭 등록). 회의는 그대로 둔다.
 * 해당 프로젝트의 관리자 전용. occurrenceDate 가 실제 규칙상 회차인지 서버에서 재검증하고
 * (클라이언트 값 불신), 본문은 composeAnnouncementFromMeeting 으로 조합한다.
 */
export async function createAnnouncementFromMeeting(
  meetingId: string,
  occurrenceDate: string,
): Promise<AnnouncementActionResult> {
  // 공지가 붙을 프로젝트는 회의 행이 정한다 — 클라이언트가 프로젝트를 고르게 하지 않는다.
  const found = await resolveProjectId('meetings', meetingId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!found.projectId) return { ok: false, error: ERR_LOOKUP }
  const mod = await requireModule({ projectId: found.projectId }, ['announcements', 'meetings'])   // 회의 → 공지 — 둘 다 켜져야
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!DATE_RE.test(occurrenceDate)) return { ok: false, error: '잘못된 날짜입니다.' }

  const sb = await createServerClient()
  const { data: r } = await sb
    .from('meetings')
    .select('project_id, title, body, meeting_date, start_time, end_time, location, category, recurrence, recurrence_until')
    .eq('id', meetingId)
    .maybeSingle()
  if (!r) return { ok: false, error: '회의를 찾을 수 없습니다.' }

  // 회차 검증 — 비반복/반복 모두 expandMeetings 로 동일하게 처리(해당 날짜만 전개).
  const meeting = {
    id: meetingId, projectId: r.project_id as string, title: r.title as string,
    meetingDate: r.meeting_date as string, startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null, location: (r.location as string | null) ?? null,
    category: r.category as MeetingCategory, body: '', recurrence: r.recurrence as MeetingRecurrence,
    recurrenceUntil: (r.recurrence_until as string | null) ?? null, createdBy: null,
    createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [],
  }
  const occ = expandMeetings([meeting], [], occurrenceDate, occurrenceDate)
  if (!occ.some(o => o.occurrenceDate === occurrenceDate)) {
    return { ok: false, error: '해당 날짜는 이 회의의 회차가 아닙니다.' }
  }

  const input = composeAnnouncementFromMeeting({
    title: r.title as string,
    occurrenceDate,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    body: (r.body as string | null) ?? '',
  }, seoulToday())

  const projectId = r.project_id as string
  const { data, error } = await sb
    .from('announcements')
    .insert({
      project_id: projectId,
      title: input.title,
      body: input.body,
      category: input.category,
      is_pinned: input.isPinned,
      publish_from: input.publishFrom,
      publish_to: input.publishTo,
      created_by: g.actor.userId,
    })
    .select('created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.created_at) {
    await advanceSeenWatermark(projectId, g.actor.userId, data.created_at as string)
  }
  revalidateAnnouncements(projectId)
  return { ok: true }
}
