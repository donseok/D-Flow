import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import { chatIndexWorkerEnabled } from '@/lib/modules/flags'
import { createSupabaseIndexContentLoader } from './content'
import { createIndexJobModuleGate, enabledIndexProjectIds } from './moduleGate'
import { createSupabaseIndexJobQueue, createSupabasePgvectorKnowledgeIndex, type SupabaseKnowledgeClient } from './pgvector'
import { runIndexWorkerOnce } from './worker'

/**
 * 변경 등록 직후의 즉시 소비(2026-10-12 UAT WIKI-05) — 큐를 비우는 길이 하루 한 번 도는 스케줄(ai-index)뿐이라
 * 방금 쓴 회의·이슈·공지가 다음 날까지 검색에 나오지 않았다. 등록한 요청이 끝난 뒤(after) 한 배치를 그 자리에서 소비한다.
 * - 워커 플래그(CHAT_V2_INDEX_WORKER_ENABLED)가 꺼진 배포에서는 아무것도 하지 않는다 — 스케줄 잡과 같은 조건이다.
 * - 프로세스 안에서 한 번에 하나만 돈다. 도는 동안 들어온 요청은 "한 번 더"로 접는다(쓰기가 몰려도 소비가 겹치지 않는다).
 * - 범위·판정·선점은 스케줄 잡과 같다(켜진 프로젝트만, 보관된 워크스페이스는 선점 RPC 가 집지 않는다).
 * - 어떤 실패도 던지지 않는다. 남은 잡은 다음 변경이나 스케줄 잡이 가져간다.
 */
const BATCH = 25
/** 한 번 깨어나 도는 배치 수의 상한 — 대량 가져오기 뒤에 요청 하나가 큐 전체를 붙들지 않게 한다 */
const MAX_ROUNDS = 4

let inFlight = false
let again = false

export async function drainIndexQueueSoon(db: ReturnType<typeof createAdminClient>): Promise<void> {
  if (!chatIndexWorkerEnabled()) return
  if (inFlight) { again = true; return }
  inFlight = true
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      again = false
      const scope = await enabledIndexProjectIds(db)
      // 범위를 읽지 못하면 돌리지 않는다 — 일부만 읽은 범위로 선점하면 범위 밖 잡이 실패로 소모된다
      if (!scope.ok) return
      const admin = db as unknown as SupabaseKnowledgeClient
      const accessScope = { allowedProjectIds: scope.ids, allowGlobal: true }
      const summary = await runIndexWorkerOnce({
        queue: createSupabaseIndexJobQueue(admin, accessScope),
        index: createSupabasePgvectorKnowledgeIndex(admin, accessScope),
        loadContent: createSupabaseIndexContentLoader(admin),
        batchSize: BATCH,
        moduleGate: createIndexJobModuleGate(db),
      })
      if (summary.claimFailed) return
      if (summary.claimed < BATCH && !again) return
    }
  } catch (e) {
    console.error('[assistant] 색인 즉시 소비 예외(무시하고 계속):', e instanceof Error ? e.message : e)
  } finally {
    inFlight = false
  }
}
