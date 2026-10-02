import 'server-only'
/**
 * 그 프로젝트 주간보고의 주 키 전부(SP5 스펙 §4.2 — EditCtx.loadWeekKeys). 주 시작 변경 연산의 "문서 0건" 판정과 미리보기(과제 25)가 쓴다.
 * 키셋 끝까지(week_start 는 프로젝트 안에서 유일 — UNIQUE (project_id, week_start)). 실패는 ConfigUnavailableError — 0건으로 위장하지 않는다(3원칙 ①).
 * 설정 4표를 읽지 않는다(tests/invariants/settings-writes 의 허용 파일이 아니다 — weekly_reports 만).
 */
import { fetchAllByKeyset, type PageResult } from '@/lib/data/paging'
import { ConfigUnavailableError } from './errors'
import type { ConfigReadClient } from './projectConfig'

type Row = { week_start: string }

export async function listWeekKeys(client: ConfigReadClient, projectId: string): Promise<string[]> {
  try {
    const rows = await fetchAllByKeyset<Row>('주간보고 주 키', (r) => r.week_start, (after, limit) => {
      const base = client.from('weekly_reports').select('week_start', { count: 'exact' }).eq('project_id', projectId)
      return (after ? base.gt('week_start', after.week_start) : base).order('week_start').limit(limit) as unknown as PromiseLike<PageResult<Row>>
    })
    return rows.map((r) => r.week_start)
  } catch (e) {
    throw new ConfigUnavailableError(`주간보고 주 키 조회 실패: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}
