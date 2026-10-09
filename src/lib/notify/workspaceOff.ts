/**
 * 내 계정의 "워크스페이스에서 꺼짐" 표시(개정 §4.10) — 내가 속한 워크스페이스가 정책(notify.policy)으로 끈 유형을 개인 토글 옆에 알린다.
 * 발행 판정이 아니다(그 관문은 policy.ts → emit.ts 한 길). 여기는 "개인 토글을 켜 두었는데 왜 안 오는가"를 설명하는 읽기 전용 요약이다.
 *
 * 정책을 못 읽은 워크스페이스는 표시에서 뺀다 + 로그 — 켜졌는지 꺼졌는지 모르는 것을 어느 쪽으로도 그리지 않는다. 그래서 하나라도 못 읽었으면
 * 어떤 유형도 "전부 꺼짐"으로 단정하지 않고, 읽은 것 중 끈 워크스페이스의 이름만 적는다.
 */
import 'server-only'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { valueOf } from '@/lib/settings/registry'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { isNotifyTypeEnabled, type NotifyPolicy } from '@/lib/settings/defs/notify'

/** 유형 → 끈 워크스페이스. all = 소속 전부가 껐다(전부 읽혔을 때만 참). 켜진 유형·필수 유형은 키가 없다 */
export type WorkspaceNotifyOff = Partial<Record<NotificationType, { all: boolean; names: string[] }>>

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]

/** 순수 요약 — policy 가 null 인 항목은 읽지 못한 워크스페이스다. 이름 순서는 받은 순서(가입 순) 그대로 */
export function summarizeWorkspaceNotifyOff(
  workspaces: readonly { name: string; policy: NotifyPolicy | null }[],
): WorkspaceNotifyOff {
  const read = workspaces.filter((w): w is { name: string; policy: NotifyPolicy } => w.policy !== null)
  const complete = read.length === workspaces.length
  const out: WorkspaceNotifyOff = {}
  for (const type of TYPES) {
    const names = read.filter((w) => !isNotifyTypeEnabled(w.policy, type)).map((w) => w.name)
    if (names.length > 0) out[type] = { all: complete && names.length === read.length, names }
  }
  return out
}

/** 소속 워크스페이스들의 정책을 세션으로 읽어 요약한다. 조회 실패·값 손상(CONFIG_INVALID)은 그 워크스페이스만 빠진다 */
export async function loadWorkspaceNotifyOff(workspaces: readonly { id: string; name: string }[]): Promise<WorkspaceNotifyOff> {
  const loaded = await Promise.all(workspaces.map(async (w) => {
    try {
      return { name: w.name, policy: valueOf(await getWorkspaceConfig(w.id), 'notify.policy') as NotifyPolicy }
    } catch (e) {
      console.error('[account] 워크스페이스 알림 정책 조회 실패 — 꺼짐 표시에서 뺀다:', w.id, e instanceof Error ? e.message : e)
      return { name: w.name, policy: null }
    }
  }))
  return summarizeWorkspaceNotifyOff(loaded)
}
