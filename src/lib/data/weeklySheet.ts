import { createServerClient } from '@/lib/supabase/server'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

export interface WeeklyReportDoc { id: string; projectId: string; weekStart: string; title: string }

/** 영역 행의 열(SP4 — 지운 section·module·sort_order 대신 area_id, Q35). getWeeklySheet·findCarryOverSource 가 같이 쓴다 */
export const AREA_ROW_COLS = 'id, report_id, area_id, this_content, this_issue, next_content, next_issue'

type AreaRowRecord = {
  id: string; report_id: string; area_id: string
  this_content: string; this_issue: string; next_content: string; next_issue: string
}

export function mapAreaRow(r: AreaRowRecord): WeeklySheetRow {
  return {
    id: r.id, reportId: r.report_id, areaId: r.area_id,
    thisContent: r.this_content, thisIssue: r.this_issue,
    nextContent: r.next_content, nextIssue: r.next_issue,
  }
}

/** 해당 주차 문서+행 — 읽기만 한다(쓰기 0, W16). 없으면 null(문서는 자동 생성하지 않는다 — 생성은 RPC 한 길, D22).
 *  문서를 먼저 읽고(project_id·week_start) 행은 그 문서(report_id)·그 프로젝트(project_id)로 거른다 — 임베드를 쓰지 않아
 *  직렬 2왕복이다(스펙 §4.1.2). 행은 정렬하지 않는다 — 보이는 행·순서는 호출부가 영역으로 정한다(visibleRows, D32).
 *  조회 실패는 throw — 행 없음으로 위장하면 이월·PPT 가 빈 시트로 대체된다(3원칙 ①). */
export async function getWeeklySheet(
  projectId: string, weekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const rep = await sb.from('weekly_reports').select('id, project_id, week_start, title')
    .eq('project_id', projectId).eq('week_start', weekStartIso).maybeSingle()
  if (rep.error) throw new Error(rep.error.message)
  if (!rep.data) return null
  const report: WeeklyReportDoc = {
    id: rep.data.id as string, projectId: rep.data.project_id as string,
    weekStart: rep.data.week_start as string, title: (rep.data.title as string | null) ?? '',
  }
  const rowsRes = await sb.from('weekly_report_rows').select(AREA_ROW_COLS)
    .eq('report_id', report.id).eq('project_id', projectId)
  if (rowsRes.error) throw new Error(rowsRes.error.message)
  return { report, rows: ((rowsRes.data ?? []) as AreaRowRecord[]).map(mapAreaRow) }
}

/** 해당 주차 문서의 id(없으면 null) — 이월 판정 앞의 존재 확인(A1-4 리뷰 P7: 이미 있는 주차에 매핑 창을 띄우지 않는다).
 *  읽기만 한다. 조회 실패는 throw — 없음으로 위장하면 있는 주차에 이월 판정·매핑을 다시 요구한다(3원칙 ①). */
export async function findWeeklyReportId(projectId: string, weekStartIso: string): Promise<string | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_reports').select('id')
    .eq('project_id', projectId).eq('week_start', weekStartIso).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? (data.id as string) : null
}

/** 이월 원본: 해당 주 이전 가장 최근 week_start 문서(직전 주 한정 아님 — 연휴 건너뜀 대응, 스펙 §4).
 *  행은 영역 행(WeeklySheetRow)이고 순서를 정하지 않는다 — 이월(carryOverRows)이 영역 순서로 내놓는다(옛 sort_order 참조 정렬 삭제, Q35).
 *  임베드 weekly_reports → weekly_report_rows 의 FK 는 복합 FK 하나(weekly_report_rows_report_fk)라 모호하지 않다(W21). */
export async function findCarryOverSource(
  projectId: string, beforeWeekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_reports')
    .select(`id, project_id, week_start, title, weekly_report_rows(${AREA_ROW_COLS})`)
    .eq('project_id', projectId).lt('week_start', beforeWeekStartIso)
    .order('week_start', { ascending: false }).limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message) // null(원본 없음)과 조회 실패를 구분 — 실패 시 이월 폴백 금지. 원문은 호출부가 로그로만(failWith)
  if (!data) return null
  const report = {
    id: data.id as string, projectId: data.project_id as string,
    weekStart: data.week_start as string, title: (data.title as string | null) ?? '',
  }
  const rows = (((data as { weekly_report_rows?: unknown }).weekly_report_rows ?? []) as AreaRowRecord[]).map(mapAreaRow)
  return { report, rows }
}

/** 이월 '제안 노출' 판정 전용 경량 조회 — findCarryOverSource 와 같은 원본 선택 규칙
 *  (해당 주 이전 가장 최근 week_start 문서 하나)에 행 '개수'만 임베드해 한 왕복으로 판정한다.
 *  셀 내용(최대 44셀×20,000자)을 전혀 싣지 않는다. 판정 시맨틱은 소비처(weekly/page.tsx)의
 *  `!!src && src.rows.length > 0` 와 동일: 이전 문서가 있고 그 문서에 행이 1개 이상일 때만 true.
 *  (0행이어도 더 오래된 문서로 내려가지 않는다 — findCarryOverSource 와 같은 규칙.)
 *  조회 실패는 throw — false(제안 숨김)로 위장하면 이월 제안이 조용히 사라진다. */
export async function hasCarryOverSource(
  projectId: string, beforeWeekStartIso: string,
): Promise<boolean> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_reports')
    .select('id, weekly_report_rows(count)')
    .eq('project_id', projectId).lt('week_start', beforeWeekStartIso)
    .order('week_start', { ascending: false }).limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false
  const counts = ((data as { weekly_report_rows?: unknown }).weekly_report_rows ?? []) as Array<{ count: number | null }>
  return (counts[0]?.count ?? 0) > 0
}
