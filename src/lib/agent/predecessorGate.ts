/**
 * 선행 충족 기준 판독(SP5b D21) — 설정 `workflow.predecessor_gate`(reached | final). 세션 없는 경로(PAT 라우트·알림)도 쓰므로
 * service_role 클라이언트를 받는다(getProjectConfig 의 { client } — 0행·조회 실패는 throw). 손상 값은 throw(ConfigKeyError) — 호출부는
 * 게이트 재료이므로 기본값으로 풀지 않는다(claim 은 500, 알림은 발행 생략 — 3원칙).
 */
import type { AdminClient } from '@/lib/minutes/externalApi'
import type { PredecessorGate } from '@/lib/domain/agentWork'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'

export async function loadPredecessorGate(admin: AdminClient, projectId: string): Promise<PredecessorGate> {
  return valueOf(await getProjectConfig(projectId, { client: admin }), 'workflow.predecessor_gate')
}

/** 여러 프로젝트의 기준(좌석표·포털처럼 프로젝트를 가로지르는 화면). 한 프로젝트라도 판독이 실패하면 throw */
export async function loadPredecessorGates(admin: AdminClient, projectIds: readonly string[]): Promise<Map<string, PredecessorGate>> {
  const ids = [...new Set(projectIds)]
  const gates = await Promise.all(ids.map((id) => loadPredecessorGate(admin, id)))
  return new Map(ids.map((id, i) => [id, gates[i]]))
}
