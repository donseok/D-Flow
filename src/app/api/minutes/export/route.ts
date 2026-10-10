import { Readable } from 'node:stream'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { jsonError } from '@/lib/api/http'
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { ymdIn } from '@/lib/domain/calendar'
import { resolveRequestCalendar } from '@/lib/calendar/load'
import { ConfigKeyError, ConfigUnavailableError, configStatus } from '@/lib/settings/errors'
import { createServerClient } from '@/lib/supabase/server'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import {
  createMinutesExportArchive,
  MINUTES_EXPORT_SOURCE_MAX_BYTES,
  minutesExportFileNames,
  utf8ByteLength,
  type MinuteExportRow,
} from '@/lib/minutes/export'
import { serverTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 500
const SELECT_COLUMNS = [
  'id', 'project_id', 'minute_date', 'team_code', 'title', 'body_md', 'meeting_id',
  'created_by_name', 'created_at', 'updated_at',
].join(', ')

type DbRow = Record<string, unknown>


function requiredString(row: DbRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`회의록 export 행의 ${key} 값이 올바르지 않습니다.`)
  return value
}

function mapRow(row: DbRow): MinuteExportRow {
  const meetingId = row.meeting_id ?? null
  const createdByName = row.created_by_name ?? null
  if (meetingId !== null && typeof meetingId !== 'string') {
    throw new Error('회의록 export 행의 meeting_id 값이 올바르지 않습니다.')
  }
  if (createdByName !== null && typeof createdByName !== 'string') {
    throw new Error('회의록 export 행의 created_by_name 값이 올바르지 않습니다.')
  }
  return {
    id: requiredString(row, 'id'),
    minuteDate: requiredString(row, 'minute_date'),
    teamCode: requiredString(row, 'team_code'),
    title: requiredString(row, 'title'),
    bodyMd: requiredString(row, 'body_md'),
    meetingId: meetingId as string | null,
    createdByName: createdByName as string | null,
    createdAt: requiredString(row, 'created_at'),
    updatedAt: requiredString(row, 'updated_at'),
  }
}

/**
 * UUID PK keyset으로 전 건을 읽는다. UI 트리의 1,000건 cap/offset pagination을 재사용하지 않는다.
 * 시작 시각 이후 생성된 행은 다음 export로 넘겨 한 번의 ZIP 범위를 고정한다.
 * hidden — 명단 밖 비공개 프로젝트(FA1). 비공개는 RLS 경계가 아니라 회의록 목록·검색·탐색기처럼 행마다 거른다(CC1).
 * 숨긴 행은 용량 합계에도 넣지 않는다(413 판정이 숨은 본문의 크기를 드러내지 않게).
 */
async function loadAllMinutes(cutoffIso: string, workspaceId: string, hidden: ReadonlySet<string>): Promise<MinuteExportRow[]> {
  const sb = await createServerClient()
  const rows: MinuteExportRow[] = []
  let cursor: string | null = null
  let sourceBytes = 0

  for (;;) {
    let query = sb.from('minutes')
      .select(SELECT_COLUMNS)
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .lte('created_at', cutoffIso)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error) throw new Error(`회의록 조회 실패: ${error.message}`)
    const page = (data ?? []) as unknown as DbRow[]

    for (const raw of page) {
      const projectId = raw.project_id ?? null
      if (projectId !== null && typeof projectId !== 'string') throw new Error('회의록 export 행의 project_id 값이 올바르지 않습니다.')
      if (projectId !== null && hidden.has(projectId)) continue
      const mapped = mapRow(raw)
      sourceBytes += utf8ByteLength(mapped.bodyMd)
      if (sourceBytes > MINUTES_EXPORT_SOURCE_MAX_BYTES) {
        const tooLarge = new Error('회의록 본문 전체 용량이 동기 내보내기 한도를 초과했습니다.')
        tooLarge.name = 'MinutesExportTooLargeError'
        throw tooLarge
      }
      rows.push(mapped)
    }

    if (page.length < PAGE_SIZE) break
    const nextCursor = requiredString(page[page.length - 1], 'id')
    if (cursor !== null && nextCursor <= cursor) throw new Error('회의록 페이지 순서가 올바르지 않습니다.')
    cursor = nextCursor
  }

  return rows
}


/** 로그인 사용자가 그 워크스페이스의 회의록 화면에서 볼 수 있는 회의록 본문을 분석용 ZIP으로 받는다(?workspaceId= — 회의록 화면의 슬러그 워크스페이스).
 *  명단 밖 비공개 프로젝트의 회의록은 회의록 목록·검색과 같이 뺀다(FA1, CC1) — 그 판정이 실패하면 ZIP 을 만들지 않는다(503). */
export async function GET(req: NextRequest) {
  const t = await serverTranslator()
  if (!(await getSession())) return jsonError(t('err.authenticationRequired'), 401)
  // 대상 행이 없는 ZIP — 요청의 워크스페이스(소속 확인, D26)로 minutes 관문. 없으면 400(추측하지 않는다). 첫 DB 접근 앞.
  // 브랜딩·행 거르기 모두 그 워크스페이스 — 두 워크스페이스 소속자의 ZIP 에 다른 워크스페이스 회의록이 섞이지 않는다.
  const g = await requireScopedSessionModule({ projectId: null, workspaceId: req.nextUrl.searchParams.get('workspaceId') }, 'minutes')
  if (!g.ok) return jsonError(g.error, g.status)
  const workspaceId = g.workspaceId
  if (!workspaceId) return jsonError(t('err.couldNotVerifyWorkspace'), 400)   // 프로젝트 없는 판정의 통과는 늘 워크스페이스를 낸다
  const { productName } = await loadDisplayBranding(workspaceId)
  // 파일명 날짜의 tz = 내보내기 범위(그 워크스페이스)의 달력(SP5 계획 D-22d). 못 읽거나 손상이면 고정 문구로 멈춘다
  let timeZone: string
  try {
    timeZone = (await resolveRequestCalendar({ projectId: null, workspaceId })).timezone
  } catch (e) {
    if (e instanceof ConfigUnavailableError) {
      console.error('[minutes-export] 워크스페이스 설정 조회 실패:', e.message)
      return jsonError(t('srv.api.minutesExport.couldNotVerifyWorkspaceSettings'), 503)
    }
    if (e instanceof ConfigKeyError) return jsonError(e.message, configStatus(e.code), e.code)
    throw e
  }

  // 비공개 숨김 판정 — 실패하면 막는다(fail-closed, FA1). 숨길 것을 못 숨긴 ZIP 을 내보내느니 내려받기를 닫는다. 원인은 getHiddenProjectIds 가 로그로 남긴다
  let hidden: ReadonlySet<string>
  try { hidden = await getHiddenProjectIds() } catch {
    return jsonError(t('srv.api.minutesExport.couldNotDeterminePrivateProjects'), 503)
  }

  const exportedAt = new Date()
  try {
    const rows = await loadAllMinutes(exportedAt.toISOString(), workspaceId, hidden)
    if (rows.length === 0) return jsonError(t('srv.api.minutesExport.noMinutesDownload'), 404)

    const { zip } = createMinutesExportArchive(rows, exportedAt, productName)
    // 결과 Buffer를 한 번 더 만들지 않고 압축 결과를 스트림으로 응답한다.
    const nodeStream = zip.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'UNIX',
    })
    const stream = Readable.toWeb(nodeStream as unknown as Readable) as ReadableStream<Uint8Array>
    const { utf8Name, fallbackName } = minutesExportFileNames(ymdIn(timeZone, exportedAt), productName)

    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'MinutesExportTooLargeError') {
      return jsonError(
        t('srv.api.minutesExport.totalMinutesSizeTooLarge'),
        413,
      )
    }
    console.error('[minutes/export] 일괄 다운로드 실패:', error instanceof Error ? error.message : error)
    return jsonError(t('srv.api.minutesExport.errorOccurredWhileBuildingMinutes'), 500)
  }
}
