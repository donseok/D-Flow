import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { UUID_RE } from '@/lib/domain/validate'
import { VOCAB_CODE_RE } from '@/lib/settings/vocab'
import { MINUTE_FOLDER_NAME_MAX, normalizeFolderName, validateMinuteFields } from '@/lib/domain/minutes'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { ingestMinute } from '@/lib/ai/minutes-ingest'
import { generateMinuteInsights } from '@/lib/ai/minutes-insights'
import { enqueueAndProcessMinuteWiki, processMinuteWikiJob } from '@/lib/ai/wiki-ingest'
import type { MeetingCategory, TeamCode } from '@/lib/domain/types'

/**
 * 회의록 외부 업로드 API(/api/v1/minutes*) 공용 유틸 — 또박또박 연동.
 * 계약: docs/design/dflow-minutes-upload-api-spec.md (§3 인증, §4 upsert, §6 에러 규격).
 * 이 경로는 세션 인증이 아니라 연동 자격증명(integration_credentials kind='minutes_api') + user_email 매칭 2계층이며, DB 접근은 전부
 * service_role(createAdminClient)이다 — RLS insert_own_minutes 가 세션 없는 insert 를 막기 때문.
 */

export type AdminClient = ReturnType<typeof createAdminClient>

export const EXTERNAL_ID_MAX = 128
/** Vercel serverless 바디 한도(~4.5MB) 이내의 공표용 제한값 — meta 응답에 노출. */
export const MINUTES_API_MAX_REQUEST_BYTES = 4_194_304

/** D-Flow 자신의 uuid PK 참조(meeting_id·minute_id·project_id) 형식 검증 — 비형식은 DB에서
 *  22P02(500)가 되므로 계약 §6 '형식 오류=400'에 맞게 사전 거절한다. external_id는 불투명(§4.6) — 적용 금지. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** 킬스위치 — 꺼져 있으면 라우트 존재 자체를 숨긴다(404). 인증은 자격증명 행이 한다(SP7 §5.1.4 — 배포 전역 시크릿은 삭제됐다). */
export function minutesApiEnabled(): boolean {
  return process.env.MINUTES_API_ENABLED === 'true'
}

/**
 * W25(결정 §2-A) — `POST /minutes` 의 folder_path 편철을 배포 전체에서 끄는 운영자 차단 스위치.
 *
 * 편철 여부의 정본은 프로젝트 설정 `minutes.auto_file_by_path`(기본 true)다 — 판독은 lib/minutes/autoFile.ts.
 * 이 env 는 한 단계 호환으로 남긴다: **명시적으로 `false` 일 때만** 의미가 있고 설정보다 먼저 이긴다(배포 전체 끔).
 * 없거나 `true` 면 설정을 따른다(예전에는 `true` 일 때만 켜졌다 — 기본이 꺼짐에서 켜짐으로 뒤집혔다. 계약 §4.8).
 *
 * 꺼져 있으면 `folder_path` 를 **키 부재와 완전히 동일하게** 취급한다(검증 400 조차 내지 않는다).
 *
 * 왜 스위치가 필요한가: 진짜 위험은 W3(등록 편철)가 아니라 **W5(재전송 폴더 동기화)** 다.
 * folder_path 가 실려 오기 시작하면 재전송 1건마다 D-Flow 위치가 덮이고, 또박또박에서 폴더에
 * 안 들어 있는 회의는 `[]` 를 보내므로 **사람이 정리해 둔 편철이 팀 루트로 평평화**된다.
 * `overwrite_manual` 은 배치에만 걸리는 플래그라 이 경로를 못 막는다.
 * 배치(W6)와 보관 상태 노출(W24)은 이 스위치·설정과 **무관하게 항상 활성**이다.
 */
export function folderPathKillSwitch(): boolean {
  return process.env.MINUTES_FOLDER_PATH_ENABLED === 'false'
}

export const apiNotFound = () =>
  NextResponse.json({ error: 'Not Found' }, { status: 404 })
export const apiUnauthorized = () =>
  NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
export const apiBadRequest = (error: string) =>
  NextResponse.json({ error, code: 'validation_failed' }, { status: 400 })
export const apiFail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })
export const apiInternalError = (error = '서버 오류가 발생했습니다.') =>
  NextResponse.json({ error, code: 'internal_error' }, { status: 500 })
/** minutes_integration 모듈이 꺼진 워크스페이스(스펙 §4.2 회의록 업로드 행) — 409 module_disabled. 킬스위치(minutesApiEnabled)와 다르다: 그건 배포 전체 404 */
export const ERR_MINUTES_INTEGRATION_OFF = '이 워크스페이스에서 회의록 연동이 꺼져 있습니다.'
export const apiModuleDisabled = () => apiFail(409, 'module_disabled', ERR_MINUTES_INTEGRATION_OFF)

import { resolveCredential, type ResolvedCredential } from '@/lib/authz/credentials'

/** 회의록 API 의 신원은 integration_credentials(kind='minutes_api') 행 하나뿐이다(SP7 §5.1.4 — 단일 시크릿 principal 삭제). */
export type MinutesPrincipal = { kind: 'minutes_api'; credential: ResolvedCredential }

export const ERR_PROJECT_NOT_ALLOWED = '이 자격증명으로 접근할 수 없는 프로젝트입니다.'
export const apiProjectNotAllowed = () => apiFail(403, 'project_not_allowed', ERR_PROJECT_NOT_ALLOWED)

/** SP7 §5.1.3: 회의록 v3 자격증명 리졸버. 킬스위치 꺼짐 404 → Bearer 없음·형식 불일치·행 없음·회수·만료·해시 불일치 전부 401. */
export async function resolveMinutesPrincipal(
  req: Request,
  getAdmin: () => AdminClient,
): Promise<MinutesPrincipal | NextResponse> {
  if (!minutesApiEnabled()) return apiNotFound()
  const header = req.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  // 자격증명 형식이 아닌 Bearer 는 조회 없이 401 — service_role 클라이언트도 만들지 않는다.
  if (!bearer?.startsWith('dflow_int_')) return apiUnauthorized()
  const cred = await resolveCredential(req, getAdmin(), 'minutes_api')
  if (cred instanceof NextResponse) return cred
  return { kind: 'minutes_api', credential: cred }
}

/** 워크스페이스 소속 여부 확인 — v3 §5.2.2 ④ (사용자가 해당 워크스페이스 멤버여야 함). */
export async function isMinutesWorkspaceMember(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`workspace_members 조회 실패: ${error.message}`)
  return !!data
}

export interface ResolvedUser {
  id: string
  name: string | null
}

/**
 * user_email → D-Flow 계정 매칭 — 계약 §3.3. lower(trim()) 정규화(0019 관례).
 * 계정 표는 profiles(0003) — email 은 lower(btrim()) CHECK + unique 라 한 건 조회로 끝나고,
 * 삭제된 계정은 auth.users cascade 로 행이 없다. 이름은 profiles.display_name 이 정본이다.
 * 조회 실패는 '사용자 없음(403)'과 구별해야 하므로 throw(fail-loud) — 호출부가 500으로 변환.
 */
export async function resolveUserByEmail(admin: AdminClient, email: string): Promise<ResolvedUser | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const { data, error } = await admin
    .from('profiles').select('user_id, display_name').eq('email', normalized).maybeSingle()
  if (error) throw new Error(`계정 조회 실패: ${error.message}`)
  if (!data) return null
  const row = data as { user_id: string; display_name: string | null }
  return { id: row.user_id, name: row.display_name ?? null }
}

/** 바디에서 user_email만 선추출 — 계약 §9.3 흐름(사용자 매칭 403이 필드 검증 400보다 먼저). */
export function parseUserEmail(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = (raw as Record<string, unknown>).user_email
  const email = typeof v === 'string' ? v.trim() : ''
  return email || null
}

/** v2.5 §4.2 — inline `meeting`(회의 생성+연결) 입력. 파싱을 통과하면 title 은 trim 완료 상태다. */
export interface ExternalMeetingInput {
  projectId: string
  title: string
  date: string
  /** null = 생략 — 회의 확보 단계가 프로젝트 설정의 기본 범주로 정한다(SP5 B4) */
  category: MeetingCategory | null
}

/** 내부 회의 생성의 제목 상한과 동일(actions/meetings.ts TITLE_MAX=200 — 'use server' 파일이라 import 불가). */
const MEETING_TITLE_MAX = 200
/** 날짜 형식 — 리포 관례상 로컬 재선언(route.ts·actions/meetings.ts 와 동일 패턴). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ExternalMinutePayload {
  minuteDate: string
  /** 요청의 team(앞뒤 공백 정리). 키 부재면 빈 값 — 라우트(resolveWriteTarget)가 범위를 정한 뒤 실제 팀 code 또는 빈 값(팀 없음)으로 확정한다 */
  teamCode: TeamCode
  /**
   * 0052 3값 규약(meetingIdProvided·folderPathProvided 와 동형) — team 은 선택이다.
   * 키 부재(false): 새 회의록은 자격증명의 기본 팀, 없으면 팀 없음 / 재전송(replace)은 기존 담당 유지.
   * `""`(true + 빈 값): 팀 없음을 명시(재전송이면 해제). 값(true): 그 팀 — 맞는 팀이 없으면 400(오타를 팀 없음으로 삼키지 않는다).
   */
  teamProvided: boolean
  title: string
  bodyMd: string
  externalId: string
  meetingId: string | null
  /** §0 D3(v2.2): meeting_id 필드 부재=기존 값 유지, 명시적 null=해제 — replace 갱신 범위 판정용. */
  meetingIdProvided: boolean
  /**
   * v2.5 §4.2: inline meeting — 키 존재 기준 추적(meetingIdProvided 와 동형)이며 meeting_id 와
   * 상호배타. 라우트가 회의를 확보한 뒤 meetingId/meetingIdProvided 에 주입해 이후 흐름은
   * meeting_id 전송과 완전히 같게 동작한다.
   */
  meetingProvided: boolean
  meeting: ExternalMeetingInput | null
  /** §3.1(v2.3): 정규화 전 원본 경로(btrim 완료). 키 부재면 null. */
  folderPath: string[] | null
  /**
   * §3.1(v2.3) 3값 규약 — 키 부재 / `[]` / 비어있지 않은 배열을 구분하는 플래그.
   * meetingIdProvided 와 동형이되 `[]` 가 "명시적 폴더 없음(팀 루트로 되돌림)"이라는
   * **유의미한 값**인 점이 다르다. `[]` 를 미전송과 뭉개면 또박또박에서 회의를 폴더 밖으로
   * 뺀 조작만 영영 전파되지 않는다.
   */
  folderPathProvided: boolean
  /** 요청에 실린 folder_path 원문(키 부재·배포 차단 스위치면 undefined) — 검증 전이다. 쓰기 대상의 설정을 안 뒤 settleFolderPath 가 위 두 칸을 채운다 */
  folderPathRaw: unknown
  onConflict: 'replace' | 'skip' | 'error'
}

/**
 * folder_path 검증 결과 — 성공하면 btrim 된 세그먼트, 실패하면 400 메시지(error)와
 * 배치 응답의 results[].reason(reason)을 함께 준다.
 * POST /minutes(§3.1)와 배치 POST /minutes/folder(§8.2 요건 11)가 **같은 판정**을 쓰도록
 * 한 곳에 둔다 — 두 경로가 갈라지면 마이그레이션 결과와 이후 전송 결과가 어긋난다.
 */
export type FolderPathParse =
  | { ok: true; path: string[] }
  | { ok: false; error: string; reason: string }

/** §3.1 folder_path 원소 검증 — 타입 · btrim 후 1~60자. 절단하지 않는다(D3). */
export function parseFolderPathValue(raw: unknown): FolderPathParse {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'folder_path는 문자열 배열이어야 합니다.',
      reason: 'validation_failed: folder_path는 배열이어야 합니다.',
    }
  }
  const path: string[] = []
  for (const seg of raw) {
    if (typeof seg !== 'string') {
      return {
        ok: false,
        error: 'folder_path의 각 원소는 문자열이어야 합니다.',
        reason: 'validation_failed: folder_path 원소는 문자열이어야 합니다.',
      }
    }
    // NFC 정규화 — macOS 에서 만든 한글 폴더명은 NFD 로 오는 경우가 있다. 그대로 비교·생성하면
    // 눈에 같은 이름의 폴더가 두 개 생긴다(부분 유니크 인덱스도 바이트가 달라 막지 못한다).
    // 계약 §4.9 가 "외부 API 원소와 UI 폴더 생성·개명이 모두 같은 함수를 통과한다"고 약속하므로
    // 인라인 복제(`seg.trim().normalize('NFC')`)가 아니라 그 함수를 그대로 쓴다 — 결과는 같지만
    // 한쪽만 바뀌면 조용히 갈라지고, 그 순간 계약이 거짓이 된다.
    const name = normalizeFolderName(seg)
    if (!name) {
      return {
        ok: false,
        error: 'folder_path에 빈 폴더 이름이 있습니다.',
        reason: 'validation_failed: 빈 폴더 이름',
      }
    }
    // D3 = 400 거절. 절단하면 긴 이름끼리 같은 60자로 뭉개져 서로 다른 폴더가 한 폴더로
    // 합쳐지는 조용한 사고가 난다 — 사용자가 또박또박에서 이름을 줄이면 된다.
    if (name.length > MINUTE_FOLDER_NAME_MAX) {
      return {
        ok: false,
        error: `폴더 이름은 ${MINUTE_FOLDER_NAME_MAX}자 이하여야 합니다: ${name}(${name.length}자)`,
        reason: `folder_name_too_long: ${name}(${name.length}자)`,
      }
    }
    path.push(name)
  }
  return { ok: true, path }
}

/**
 * POST /minutes 페이로드 검증 — 수동 타입가드(레포 관례) + validateMinuteFields 재사용.
 * 담당 팀(team)은 여기서 형식만 본다(선택 — 있으면 문자열. 0052) — 회의록이 속할 범위(연결할 회의의 프로젝트·기존 행·자격증명 범위)가
 * 정해져야 그 범위의 팀으로 판정할 수 있어서, 라우트가 범위를 확정한 뒤 자격증명의 팀 해석(resolveCredentialTeam)으로 본다(같은 400).
 * §0 D4: 이 경로는 correctMinuteBodyTime(UTC → 회의록 범위 tz 보정)을 적용하지 않는다 — 또박또박이 이미 현지 시각을
 * 보내므로 기존 UI 경로의 보정을 재사용하면 이중 보정으로 시간이 밀린다(§1.4).
 */
export function parseMinutePayload(raw: unknown): { payload: ExternalMinutePayload } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '잘못된 요청입니다.' }
  const b = raw as Record<string, unknown>

  const externalId = b.external_id
  if (typeof externalId !== 'string' || !externalId) return { error: 'external_id가 필요합니다.' }
  if (externalId.length > EXTERNAL_ID_MAX) return { error: `external_id는 ${EXTERNAL_ID_MAX}자 이하여야 합니다.` }

  if (
    typeof b.date !== 'string' ||
    typeof b.title !== 'string' || typeof b.body_markdown !== 'string'
  ) return { error: 'date, title, body_markdown은 필수입니다.' }
  // team 은 선택(0052) — 키가 있으면 문자열이어야 한다. 명시적 null 은 3값 규약에 없는 값이라 거절한다(folder_path 와 같은 이유 —
  // 조용히 '키 부재'로 뭉개면 "기존 담당 유지"와 "팀 없음"이 갈리지 않는다). 팀 없음은 빈 문자열로 보낸다.
  const teamProvided = b.team !== undefined
  if (teamProvided && typeof b.team !== 'string') return { error: 'team은 문자열이어야 합니다(팀 없음은 빈 문자열, 생략 가능).' }
  const team = (teamProvided ? (b.team as string).trim() : '') as TeamCode

  let meetingId: string | null = null
  const meetingIdProvided = b.meeting_id !== undefined
  if (meetingIdProvided && b.meeting_id !== null) {
    if (typeof b.meeting_id !== 'string' || !isUuid(b.meeting_id)) return { error: 'meeting_id 형식이 올바르지 않습니다.' }
    meetingId = b.meeting_id
  }

  // v2.5 §4.2 — inline meeting. meeting_id 와는 키 존재 기준 상호배타다: `meeting_id: null`(해제)과
  // meeting(신규 연결)을 함께 보내는 것도 의도가 상충하므로 거절한다.
  let meeting: ExternalMeetingInput | null = null
  const meetingProvided = b.meeting !== undefined
  if (meetingProvided) {
    if (meetingIdProvided) return { error: 'meeting과 meeting_id는 함께 보낼 수 없습니다.' }
    if (typeof b.meeting !== 'object' || b.meeting === null || Array.isArray(b.meeting)) {
      return { error: 'meeting은 객체여야 합니다.' }
    }
    const m = b.meeting as Record<string, unknown>
    if (typeof m.project_id !== 'string' || !isUuid(m.project_id)) {
      return { error: 'meeting.project_id 형식이 올바르지 않습니다.' }
    }
    const title = typeof m.title === 'string' ? m.title.trim() : ''
    if (!title) return { error: 'meeting.title이 필요합니다.' }
    if (title.length > MEETING_TITLE_MAX) {
      return { error: `meeting.title은 ${MEETING_TITLE_MAX}자 이하여야 합니다.` }
    }
    if (typeof m.date !== 'string' || !DATE_RE.test(m.date)) {
      return { error: 'meeting.date 형식이 올바르지 않습니다.' }
    }
    // 형식만 여기서 — 그 프로젝트에서 활성인지는 회의 확보 단계가 설정(meetings.categories)으로 판정한다(SP5 B4, 하드코딩 금지 §2.1)
    let category: MeetingCategory | null = null
    if (m.category !== undefined) {
      if (typeof m.category !== 'string' || !VOCAB_CODE_RE.test(m.category)) {
        return { error: 'meeting.category가 올바르지 않습니다.' }
      }
      category = m.category as MeetingCategory
    }
    meeting = { projectId: m.project_id, title, date: m.date, category }
  }

  let onConflict: ExternalMinutePayload['onConflict'] = 'replace'
  if (b.on_conflict !== undefined) {
    if (b.on_conflict !== 'replace' && b.on_conflict !== 'skip' && b.on_conflict !== 'error') {
      return { error: 'on_conflict는 replace, skip, error 중 하나여야 합니다.' }
    }
    onConflict = b.on_conflict
  }

  // §3.1 3값 규약 — 키 부재(=구버전 또박또박, 기존 동작) / [](=팀 루트) / 경로.
  // 명시적 null 은 배열이 아니므로 400 — 3값 규약에 없는 값을 조용히 '키 부재'로 뭉개면
  // 구버전 폴백과 구분이 사라진다.
  // W25 — 여기서는 키가 실렸는지만 본다. 편철 여부는 프로젝트 설정(minutes.auto_file_by_path)이라 쓰기 대상이 정해진 뒤에야 알 수 있고,
  // 꺼져 있으면 검증조차 하지 않아야 하므로(61자 폴더명이 섞인 회의가 400 으로 깨지는 회귀 창을 막는다) 검증도 그때 한다(settleFolderPath).
  // 배포 차단 스위치(env false)는 설정보다 먼저다 — 키를 읽기 전에 버린다.
  const folderPathRaw: unknown = folderPathKillSwitch() ? undefined : b.folder_path

  const err = validateMinuteFields({
    minuteDate: b.date, teamCode: team, title: b.title, bodyMd: b.body_markdown, meetingId,
  })
  if (err) return { error: err }

  return {
    payload: {
      minuteDate: b.date, teamCode: team, teamProvided, title: b.title.trim(),
      bodyMd: b.body_markdown, externalId, meetingId, meetingIdProvided,
      meetingProvided, meeting, folderPath: null, folderPathProvided: false, folderPathRaw, onConflict,
    },
  }
}

/**
 * folder_path 의 확정 — 쓰기 대상(프로젝트)의 자동 편철 설정을 안 뒤에 부른다(계약 §4.5-10 · §4.8).
 * 꺼져 있으면 키 부재와 완전히 같다(검증하지 않는다). 켜져 있으면 그때 형식을 검증한다(§3.1 3값 규약 — 400).
 * 같은 요청에서 대상이 다시 정해지면(경합으로 생긴 행) 원문에서 다시 판정한다 — 그래서 원문(folderPathRaw)을 지니고 있다.
 */
export function settleFolderPath(p: ExternalMinutePayload, autoFileEnabled: boolean): { ok: true } | { ok: false; error: string } {
  p.folderPath = null
  p.folderPathProvided = false
  if (!autoFileEnabled || p.folderPathRaw === undefined) return { ok: true }
  const parsed = parseFolderPathValue(p.folderPathRaw)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  p.folderPath = parsed.path
  p.folderPathProvided = true
  return { ok: true }
}

/**
 * actions/minutes.ts rematchMinuteHighlights 의 복제 — 스펙 §9.2의 '복제' 선택지.
 * export 승격 대안은 기각: actions 파일은 'use server' 라 export 하는 순간 인증 검사 없는
 * 공개 Server Action 엔드포인트(service_role 로 minute_highlights delete/insert)가 된다.
 */
async function rematchExternalMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  // env 판정은 try 밖에서 한다 — 아래 catch 가 모든 예외를 삼키므로 안에 두면
  // 판정 함수 자체의 부재·예외(모킹 문맥 등)가 '미설정'으로 위장돼 조용히 건너뛴다.
  if (!serviceRoleConfigured()) return
  try {
    const admin = createAdminClient()
    const { data: rows, error: rowsErr } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (rowsErr) { console.error('[minutes-api] 재매칭 대상 하이라이트 조회 실패:', rowsErr.message); return }
    if (!rows || rows.length === 0) return
    const { reinserts, deleteIds } = rematchHighlights(rows as unknown as HighlightRow[], splitMinuteBlocks(newBodyMd))
    if (deleteIds.length === 0 && reinserts.length === 0) return
    // delete 선실행 → insert — unique (minute_id, created_by, block_index) 충돌 원천 차단
    if (deleteIds.length) {
      const { error } = await admin.from('minute_highlights').delete().in('id', deleteIds)
      if (error) { console.error('[minutes-api] 재매칭 삭제 실패:', error.message); return }
    }
    if (reinserts.length) {
      const { error } = await admin.from('minute_highlights').insert(
        reinserts.map(r => ({ ...r, minute_id: minuteId })),
      )
      if (error) console.error('[minutes-api] 재매칭 삽입 실패:', error.message)
    }
  } catch (e) {
    console.error('[minutes-api] 재매칭 실패(무시):', e instanceof Error ? e.message : e)
  }
}

/**
 * 저장 후처리 파이프라인 — 계약 §4.5-7. 누락 시 검색·AI 챗·인사이트가 낡은 본문을 참조한다.
 * 신규: ingest → insights / replace: rematch → ingest → insights (actions/minutes.ts 순서 그대로).
 * 세 함수 모두 내부 try/catch 로 절대 throw 하지 않는 계약이라 순차 await 만 한다.
 */
export async function runMinutePostProcessing(
  minuteId: string,
  bodyMd: string,
  opts: {
    rematch: boolean
    projectId?: string | null
    minuteVersionId?: string | null
    wikiJobId?: number | null
  },
): Promise<void> {
  if (opts.rematch) await rematchExternalMinuteHighlights(minuteId, bodyMd)
  await Promise.all([
    ingestMinute(minuteId, bodyMd),
    generateMinuteInsights(minuteId, bodyMd),
    opts.wikiJobId === undefined
      ? enqueueAndProcessMinuteWiki({
        projectId: opts.projectId ?? null,
        minuteId,
        minuteVersionId: opts.minuteVersionId ?? null,
        bodyMd,
      })
      : opts.wikiJobId === null
        ? Promise.resolve(null)
        : processMinuteWikiJob(opts.wikiJobId),
  ])
}
