import {
  repositoryError,
  repositoryOk,
  type ProjectSettingsRepository,
  type ProjectSettingsSnapshot,
} from '@/lib/repositories/types'
import { getProjectConfig as loadProjectConfig } from '@/lib/settings/projectConfig'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { isRetryableReadError, type SupabaseServerClient } from './common'

type Row = Record<string, unknown>

// 환경변수·API 키·서비스 계정 정보는 select 절 자체에 존재하지 않는다 — 프로젝트 운영 컬럼만 조회한다.
// projects 에는 updated_at 열이 없다(E30) — 고르면 조회 전체가 실패한다.
const PROJECT_COLUMNS = ['id', 'name', 'start_date', 'end_date', 'base_date'].join(', ')

/** Request-scoped Supabase adapter. All statements in this adapter are SELECTs. */
export function createSupabaseProjectSettingsRepository(
  client: SupabaseServerClient,
): ProjectSettingsRepository {
  return {
    async getSafeSettings(projectId) {
      const [projectResult, holidaysResult, wbsCountResult, memberCountResult] = await Promise.all([
        client.from('projects').select(PROJECT_COLUMNS).eq('id', projectId).maybeSingle(),
        client.from('holidays').select('date').eq('project_id', projectId).order('date'),
        client.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
        client.from('project_members').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      ])

      if (projectResult.error) {
        return repositoryError('PROJECT_SETTINGS_READ_FAILED', isRetryableReadError(projectResult.error))
      }
      if (holidaysResult.error) {
        return repositoryError('PROJECT_HOLIDAYS_READ_FAILED', isRetryableReadError(holidaysResult.error))
      }
      if (wbsCountResult.error) {
        return repositoryError('PROJECT_SETTINGS_COUNTS_READ_FAILED', isRetryableReadError(wbsCountResult.error))
      }
      if (memberCountResult.error) {
        return repositoryError('PROJECT_SETTINGS_COUNTS_READ_FAILED', isRetryableReadError(memberCountResult.error))
      }
      if (!projectResult.data) return repositoryOk(null)

      const project = projectResult.data as unknown as Row
      if (project.id !== projectId || typeof project.name !== 'string') {
        return repositoryError('PROJECT_SETTINGS_READ_FAILED', false)
      }

      // count:'exact' 응답에 count가 없으면 정상 0건과 구분되는 실패로 처리한다.
      const wbsItemCount = wbsCountResult.count
      const memberCount = memberCountResult.count
      if (typeof wbsItemCount !== 'number' || typeof memberCount !== 'number') {
        return repositoryError('PROJECT_SETTINGS_COUNTS_READ_FAILED', false)
      }

      const snapshot: ProjectSettingsSnapshot = {
        projectId,
        name: project.name,
        startDate: (project.start_date as string | null) ?? null,
        endDate: (project.end_date as string | null) ?? null,
        baseDate: (project.base_date as string | null) ?? null,
        holidays: ((holidaysResult.data ?? []) as Row[]).map(row => row.date as string),
        wbsItemCount,
        memberCount,
      }
      return repositoryOk(snapshot)
    },

    async getProjectConfig(projectId) {
      try {
        return repositoryOk(await loadProjectConfig(projectId, { client }))
      } catch (e) {
        // 조회 실패를 기본 설정으로 위장하지 않는다 — 봇이 화면과 다른 마일스톤을 답하게 된다(3원칙).
        // 예상 밖 오류는 재시도 가능으로 위장하지 않고 그대로 던진다.
        if (!(e instanceof ConfigUnavailableError)) throw e
        console.error('[settings-repo] 프로젝트 설정 조회 실패:', e.message)
        return repositoryError('PROJECT_SETTINGS_READ_FAILED', true)
      }
    },
  }
}
