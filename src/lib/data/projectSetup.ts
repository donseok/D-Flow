import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { projectSetupSteps, type SetupStep } from '@/lib/domain/projectSetup'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
import { adminFor } from '@/lib/supabase/adminFor'
import { createServerClient } from '@/lib/supabase/server'

type Count = { count: number | null; error: { message: string } | null }
/** 건수 하나 — 실패·행 수 없음은 null(그 단계가 "확인 불가"가 된다). 0 으로 위장하지 않는다. 원인은 로그 */
async function countOf(what: string, projectId: string, q: PromiseLike<Count>): Promise<number | null> {
  try {
    const { count, error } = await q
    if (error || typeof count !== 'number') {
      console.error(`[projectSetup] ${what} 건수 조회 실패:`, { projectId, cause: error?.message ?? '행 수 없음' })
      return null
    }
    return count
  } catch (e) {
    console.error(`[projectSetup] ${what} 건수 조회 실패:`, { projectId, cause: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * 프로젝트 준비 체크리스트의 단계 상태(첫 사용 흐름). **호출부가 프로젝트 관리자임을 확인한 뒤에만 부른다** — 수락 전 초대 수는 세션에 열려 있지
 * 않은 표(project_invites)라 service_role 로 그 프로젝트 id 하나에 좁혀 센다(행 내용은 읽지 않는다).
 * 설정은 호출부가 이미 읽은 해석기 결과(cfg — getProjectConfig)를 그대로 쓴다: 키 상태·팀·영역을 다시 읽지 않는다.
 * wbsItems 를 넘기면(개요 화면은 이미 트리를 읽었다) 그 수를 쓰고, 없으면 센다. 명단·작업 계획은 세션 클라이언트(RLS)로 센다.
 * 체크리스트는 부가 안내다 — 여기서 난 예외가 설정·개요 화면 본체를 막지 않게 null 로 돌린다(화면은 체크리스트를 그리지 않는다. 원인은 로그).
 * 건수 하나의 실패는 예외가 아니라 그 단계의 '확인 불가'다(countOf).
 */
export async function loadProjectSetupSteps(cfg: ProjectConfig, opts: {
  project: { name: string | null; startDate: string | null; endDate: string | null } | null
  weeklyEnabled: boolean
  wbsItems?: number
}): Promise<SetupStep[] | null> {
  try {
    return await load(cfg, opts)
  } catch (e) {
    unstable_rethrow(e)   // Next 의 제어 흐름 신호(동적 렌더 판정·리다이렉트)는 삼키지 않는다
    console.error('[projectSetup] 준비 단계 판정 실패 — 체크리스트를 그리지 않는다:', { projectId: cfg.projectId, cause: e instanceof Error ? e.message : String(e) })
    return null
  }
}

async function load(cfg: ProjectConfig, opts: {
  project: { name: string | null; startDate: string | null; endDate: string | null } | null
  weeklyEnabled: boolean
  wbsItems?: number
}): Promise<SetupStep[]> {
  const projectId = cfg.projectId
  const sb = await createServerClient()
  const { admin } = adminFor({ projectId })
  const [rosterCount, pendingInvites, wbsItems] = await Promise.all([
    countOf('명단', projectId, sb.from('project_members').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('active', true)),
    countOf('초대', projectId, admin.from('project_invites').select('id', { count: 'exact', head: true })
      .eq('project_id', projectId).is('redeemed_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())),
    opts.wbsItems !== undefined ? opts.wbsItems
      : countOf('작업 계획', projectId, sb.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', projectId)),
  ])
  const labels = cfg.keys['core.level_labels']
  return projectSetupSteps({
    projectId,
    project: opts.project,
    levelLabels: { status: labels.status, count: labels.status === 'set' ? labels.value.length : 0 },
    calendar: {
      timezone: cfg.keys['calendar.timezone'].status,
      workingDays: cfg.keys['calendar.working_days'].status,
      weekStart: cfg.keys['calendar.week_start'].status,
    },
    teams: cfg.teams,
    weeklyEnabled: opts.weeklyEnabled,
    weeklyAreas: cfg.areas.weekly_section,
    rosterCount, pendingInvites, wbsItems,
  })
}
