import 'server-only'

// 팀 코드를 바꾼 뒤, 저장해 둔 엑셀 양식(wbs.excel_profile)의 팀 열 이름표를 새 code 로 맞춘다(팀 유연화 2단계).
// 양식의 teamColumns 는 [열, 팀 code] 다 — 옛 code 가 남으면 다음 가져오기가 그 열을 "없는 팀"으로 읽고, 내보내기는 그 팀을 양식 밖 팀으로
// 맨 끝 열에 덧붙인다. 설정 쓰기는 RPC 한 길이라(apply_project_settings — revision·이력) 팀 코드 변경 RPC 안에서 같이 바꾸지 못한다:
// 코드 변경이 커밋된 뒤 프로젝트마다 내부 쓰기(writeProjectSettingsInternal)로 바꾼다. 그래서 원자적이지 않다 — 실패한 프로젝트 수를 돌려주고
// 호출부가 사용자에게 알린다(양식은 가져오기 화면에서 다시 저장하면 고쳐진다). 코드 변경 자체는 되돌리지 않는다.
// 가드 없는 통과 함수다 — 호출부(팀 코드 변경 액션 둘)가 등급 가드와 change_team_code RPC(등급 재판정)를 지난 뒤에만 부른다.
// tests/invariants/settings-writes.test.ts 의 PROFILE_SWAP_CALLERS 가 호출부를 닫는다.
import type { AdminClient } from '@/lib/supabase/adminFor'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { writeProjectSettingsInternal } from '@/lib/settings/write'

export interface ProfileSwapResult {
  /** 양식을 새 code 로 바꾼 프로젝트 수 */
  swapped: number
  /** 바꾸지 못한 프로젝트 수(읽기·쓰기 실패, 새 code 의 열이 이미 있어 겹치는 양식) — 0 이 아니면 호출부가 알린다 */
  failed: number
}

/**
 * scope.projectId 가 있으면(전용 팀) 그 프로젝트 하나, 없으면(공용 팀) 그 워크스페이스에서 **전용 팀이 없는**(공용 팀을 상속하는) 프로젝트 전부.
 * 전용 팀이 있는 프로젝트의 양식에 적힌 code 는 그 프로젝트의 전용 팀을 가리키므로 건드리지 않는다.
 */
export async function swapExcelProfileTeamCode(
  admin: AdminClient,
  scope: { workspaceId: string; projectId: string | null },
  codes: { from: string; to: string },
  actorUserId: string,
): Promise<ProfileSwapResult> {
  let projectIds: string[]
  if (scope.projectId) {
    projectIds = [scope.projectId]
  } else {
    const [prj, own] = await Promise.all([
      admin.from('projects').select('id').eq('workspace_id', scope.workspaceId),
      admin.from('teams').select('project_id').eq('workspace_id', scope.workspaceId).not('project_id', 'is', null),
    ])
    if (prj.error || own.error) {
      // 대상 프로젝트를 모르면 어느 양식도 바꾸지 않는다 — 한 건 실패로 알린다(조용히 0건으로 위장하지 않는다)
      console.error('[teams.profileSwap] 대상 프로젝트 조회 실패:', prj.error?.message ?? own.error?.message)
      return { swapped: 0, failed: 1 }
    }
    const withOwn = new Set(((own.data ?? []) as { project_id: string | null }[]).map((r) => r.project_id))
    projectIds = ((prj.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !withOwn.has(id))
  }
  let swapped = 0
  let failed = 0
  for (const projectId of projectIds) {
    try {
      const profile = valueOf(await getProjectConfig(projectId, { client: admin }), 'wbs.excel_profile')
      if (!profile || !profile.teamColumns.some(([, code]) => code === codes.from)) continue
      // 새 code 의 열이 이미 양식에 있으면 치환이 같은 팀의 열 둘을 만든다 — 어느 열이 맞는지 추측하지 않고 그대로 둔다
      if (profile.teamColumns.some(([, code]) => code === codes.to)) {
        console.error('[teams.profileSwap] 새 코드의 팀 열이 이미 있어 양식을 바꾸지 않았다:', projectId)
        failed += 1
        continue
      }
      const next = { ...profile, teamColumns: profile.teamColumns.map(([col, code]) => [col, code === codes.from ? codes.to : code] as [number, string]) }
      const w = await writeProjectSettingsInternal(admin, projectId, { set: { 'wbs.excel_profile': next } }, actorUserId)
      if (w.ok) swapped += 1
      else {
        console.error('[teams.profileSwap] 양식 저장 실패:', projectId, w.code)
        failed += 1
      }
    } catch (e) {
      console.error('[teams.profileSwap] 양식 치환 예외:', projectId, e instanceof Error ? e.message : e)
      failed += 1
    }
  }
  return { swapped, failed }
}
