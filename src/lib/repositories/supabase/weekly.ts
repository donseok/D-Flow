import {
  repositoryError,
  repositoryOk,
  type WeeklyRepository,
  type WeeklyRepositoryRow,
  type WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import { visibleRows, type WeeklyArea } from '@/lib/domain/weeklySheet'
import { parseCustomValues } from '@/lib/domain/customFieldValues'
import { isRetryableReadError, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

const REPORT_COLUMNS = 'id, project_id, week_start, title, updated_at'
// 주간 행은 영역 id 로 묶인다(SP4) — 지운 열(section·module·sort_order)을 고르면 PostgREST 가 42703 으로 조회 전체를 실패시킨다
const ROW_COLUMNS = [
  'id', 'report_id', 'area_id', 'this_content', 'this_issue', 'next_content', 'next_issue', 'updated_at',
  'custom', // 사용자 정의 필드 값 — 주간 읽기 도구가 searchable 필드를 덧붙인다(SP5c §3.6.9)
].join(', ')
const AREA_COLUMNS = 'id, code, name, sort_order, active, area_teams(team_id, kind)'

function mapRow(row: Row): WeeklyRepositoryRow {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    areaId: row.area_id as string,
    thisContent: (row.this_content as string) ?? '',
    thisIssue: (row.this_issue as string) ?? '',
    nextContent: (row.next_content as string) ?? '',
    nextIssue: (row.next_issue as string) ?? '',
    updatedAt: (row.updated_at as string | null) ?? null,
    // 손상된 값은 빈 객체로 풀지 않는다 — null 로 실어 도구가 '읽지 못함'을 알린다
    custom: customOf(row.custom),
  }
}

function customOf(raw: unknown): WeeklyRepositoryRow['custom'] {
  const parsed = parseCustomValues(raw)
  return parsed.ok ? parsed.value : null
}

function mapArea(row: Row): WeeklyArea {
  const teams = Array.isArray(row.area_teams) ? (row.area_teams as Row[]) : []
  return {
    id: row.id as string,
    code: (row.code as string) ?? '',
    name: (row.name as string) ?? '',
    sortOrder: Number(row.sort_order) || 0,
    active: row.active !== false,
    teams: teams.map(t => ({ teamId: t.team_id as string, kind: t.kind === 'support' ? 'support' as const : 'primary' as const })),
  }
}

/**
 * 봇 읽기는 업무 데이터를 쓰지 않는다 — 빠진 행을 채우지 않고(백필 없음), 문서·행·영역을 select 만 한다.
 * 행은 그 문서·그 프로젝트로 거르고, 영역은 같은 클라이언트(요청 세션 — RLS)로 그 프로젝트의 주간 영역을 읽는다.
 */
export function createSupabaseWeeklyRepository(client: SupabaseServerClient): WeeklyRepository {
  return {
    async getSheet(projectId, weekStart) {
      const reportResult = await client
        .from('weekly_reports')
        .select(REPORT_COLUMNS)
        .eq('project_id', projectId)
        .eq('week_start', weekStart)
        .maybeSingle()

      if (reportResult.error) {
        return repositoryError('WEEKLY_REPORT_READ_FAILED', isRetryableReadError(reportResult.error))
      }
      if (!reportResult.data) return repositoryOk(null)

      const reportRow = reportResult.data as Row
      const [rowsResult, areasResult] = await Promise.all([
        client.from('weekly_report_rows').select(ROW_COLUMNS)
          .eq('report_id', reportRow.id as string)
          .eq('project_id', projectId),
        client.from('project_areas').select(AREA_COLUMNS)
          .eq('project_id', projectId)
          .eq('kind', 'weekly_section'),
      ])

      if (rowsResult.error) {
        return repositoryError('WEEKLY_ROWS_READ_FAILED', isRetryableReadError(rowsResult.error))
      }
      // 영역을 못 읽으면 라벨·순서가 없는 시트가 된다 — 빈 영역으로 위장하지 않는다(3원칙)
      if (areasResult.error) {
        return repositoryError('WEEKLY_AREAS_READ_FAILED', isRetryableReadError(areasResult.error))
      }

      const areas = ((areasResult.data ?? []) as unknown as Row[]).map(mapArea)
      const snapshot: WeeklySheetSnapshot = {
        report: {
          id: reportRow.id as string,
          projectId: reportRow.project_id as string,
          weekStart: reportRow.week_start as string,
          title: (reportRow.title as string | null) ?? '',
          updatedAt: (reportRow.updated_at as string | null) ?? null,
        },
        rows: visibleRows(((rowsResult.data ?? []) as unknown as Row[]).map(mapRow), areas),
        areas,
      }
      return repositoryOk(snapshot)
    },
  }
}
