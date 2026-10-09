// 위키 워커의 워크스페이스 공정성(정본 §3.2.7·§5.4.4) — 순수. 전역 큐를 run_after 순으로만 소비하면 큐가 깊은 워크스페이스 하나가
// 매 실행의 몫을 다 쓰고 다른 워크스페이스는 밀린다. 후보를 워크스페이스별로 묶어 한 바퀴에 하나씩 번갈아 집는다.

export interface Scoped { workspaceId: string | null }

/**
 * 후보(급한 순)를 워크스페이스끼리 번갈아 세운다 — 각 워크스페이스 안의 순서와, 워크스페이스가 처음 나온 순서는 그대로 둔다.
 * 워크스페이스를 모르는 후보(null)는 한 묶음으로 본다.
 */
export function interleaveByWorkspace<T extends Scoped>(candidates: readonly T[]): T[] {
  const queues = new Map<string, T[]>()
  for (const candidate of candidates) {
    const key = candidate.workspaceId ?? ''
    const queue = queues.get(key)
    if (queue) queue.push(candidate)
    else queues.set(key, [candidate])
  }
  const out: T[] = []
  for (let depth = 0; out.length < candidates.length; depth += 1) {
    for (const queue of queues.values()) if (depth < queue.length) out.push(queue[depth])
  }
  return out
}

/** PostgREST 임베드(`projects!inner(workspace_id)`)의 한 행에서 워크스페이스를 꺼낸다 — 형이 어긋나면 null */
export function workspaceOfEmbed(projects: unknown): string | null {
  const row = Array.isArray(projects) ? projects[0] : projects
  const id = (row as { workspace_id?: unknown } | null | undefined)?.workspace_id
  return typeof id === 'string' && id ? id : null
}
