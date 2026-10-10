/**
 * 워크스페이스 알림 정책의 서버 읽기(개정 §4.10) — `notify.policy`. 판정 순서는 발행 시 워크스페이스 정책(끔 → 미발행) → 조회 시 개인 prefs 이고,
 * 이 파일은 앞쪽만 맡는다. 호출자는 emit.ts 하나다(발행 관문이 두 곳이면 한쪽만 끄는 불일치가 생긴다).
 *
 * 정책을 못 읽으면 발행한다(fail-open) + 로그. 보안 가드가 아니라 소음을 줄이는 정책이라, 설정 조회 장애가 배정·언급 알림의 유실로 번지는 쪽이
 * 더 나쁘다 — 과발행은 각자 알림함에서 끄면 되지만 유실은 되살릴 수 없다. 필수 유형은 정책을 읽지도 않는다.
 */
import 'server-only'
import { cache } from 'react'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { valueOf } from '@/lib/settings/registry'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { WorkspaceArchivedError } from '@/lib/settings/errors'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { isNotifyTypeEnabled, type NotifyPolicy } from '@/lib/settings/defs/notify'

// 요청 안 메모 — 한 액션이 여러 건을 발행해도(담당자 팬아웃·일괄 승인) 프로젝트의 워크스페이스와 정책을 한 번씩만 읽는다.
// 해석기의 react cache 는 클라이언트 인스턴스가 키라 발행마다 새로 만드는 service_role 클라이언트로는 맞지 않아 id 로 따로 묶는다.
// 요청 밖(워커·테스트)에서는 cache 가 매번 새 Map 을 주므로 메모 없이 매번 읽는다 — 프로세스 전역 캐시는 두지 않는다(바꾼 정책이 바로 먹게).
const requestMemo = cache(() => new Map<string, Promise<unknown>>())
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = requestMemo()
  let p = memo.get(key) as Promise<T> | undefined
  if (!p) { p = load(); memo.set(key, p) }
  return p
}

/** 프로젝트의 워크스페이스 — 프로젝트 설정 해석기(조회 넷)를 부르지 않고 한 칸만 읽는다. 행이 없으면 모르는 것이지 "워크스페이스 없음"이 아니다 */
async function workspaceOfProject(client: ConfigReadClient, projectId: string): Promise<string> {
  const { data, error } = await client.from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`프로젝트의 워크스페이스 조회 실패: ${error.message}`)
  const wid = (data as { workspace_id?: unknown } | null)?.workspace_id
  if (typeof wid !== 'string' || !wid) throw new Error(`프로젝트의 워크스페이스를 확정하지 못했다: ${projectId}`)
  return wid
}

/**
 * 이 알림을 발행해도 되는가. 프로젝트 알림은 프로젝트의 워크스페이스가 정본이고(이벤트 행의 workspace_id 도 트리거가 프로젝트에서 채운다),
 * 프로젝트 없는 알림은 호출자가 넘긴 workspaceId 를 쓴다. 둘 다 없으면 정책을 적용하지 않는다(그 알림의 거절은 emit 의 몫).
 */
export async function notifyPolicyAllows(
  client: ConfigReadClient, input: { type: NotificationType; projectId: string | null; workspaceId?: string },
): Promise<boolean> {
  // 필수 유형은 정책으로 끌 수 없다 — 다만 보관된 워크스페이스(0056)에는 필수 유형도 발행하지 않으므로 워크스페이스 설정까지는 읽는다
  const required = NOTIFICATION_CATALOG[input.type]?.required === true
  try {
    const projectId = input.projectId
    const workspaceId = projectId ? await once(`p:${projectId}`, () => workspaceOfProject(client, projectId)) : (input.workspaceId ?? null)
    if (!workspaceId) return true
    const config = await once(`c:${workspaceId}`, () => getWorkspaceConfig(workspaceId, { client }))   // 보관이면 WorkspaceArchivedError
    if (required) return true
    return isNotifyTypeEnabled(valueOf(config, 'notify.policy') as NotifyPolicy, input.type)
  } catch (e) {
    // 보관된 워크스페이스 — 동결이다. 이벤트·수신자 행을 쓰지 않는다(정책을 못 읽은 것과 다르다: 이쪽은 닫는다)
    if (e instanceof WorkspaceArchivedError) return false
    if (required) return true
    // 조회 실패·값 손상(CONFIG_INVALID) 모두 여기로 — 발행하되 조용히 넘기지 않는다(표시 = 로깅)
    console.error('[notify] notify.policy 를 읽지 못해 정책 없이 발행한다:', input.type,
      JSON.stringify({ projectId: input.projectId, workspaceId: input.workspaceId ?? null }), e instanceof Error ? e.message : e)
    return true
  }
}
