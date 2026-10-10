import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeJob } from '@/lib/jobs/auth'
import { runFormTemplatesGc } from '@/lib/forms/incomingGc'
import { archivedWorkspaceIds } from '@/lib/workspace/archived'

/**
 * 잡 `form-templates-gc`(잡 레지스트리) — 양식 업로드의 고아 incoming 객체 정리(정본 §4.7.1). core 잡이라 모듈 판정 없이 돈다.
 * 응답은 수량뿐이다(경로·파일 이름을 싣지 않는다).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const denied = authorizeJob(req, 'form-templates-gc')
  if (denied) return denied

  const admin = createAdminClient()
  // 보관된 워크스페이스(0056)는 건너뛴다 — 동결이라 그 파일을 지우지 않는다. 목록을 못 읽으면 이번 실행은 아무것도 지우지 않는다(fail-closed)
  let archived: Set<string>
  try {
    archived = await archivedWorkspaceIds(admin)
  } catch (e) {
    console.error('[forms] 보관된 워크스페이스 조회 실패 — incoming 정리를 건너뛴다:', e instanceof Error ? e.message : e)
    return Response.json({ error: 'LIST_FAILED' }, { status: 500 })
  }
  const result = await runFormTemplatesGc(admin, Date.now(), archived)
  if (!result.ok) {
    console.error('[forms] incoming 정리 목록 조회 실패:', result.error)
    return Response.json({ error: 'LIST_FAILED' }, { status: 500 })
  }
  const { scanned, deleted, failed, skippedYoung, skippedNoTime } = result
  const counts = { scanned, deleted, failed, skippedYoung, skippedNoTime }
  // 일부 삭제 실패도 성공으로 위장하지 않는다 — 수량은 그대로 싣고 500 으로 알린다.
  if (counts.failed > 0) return Response.json({ error: 'REMOVE_FAILED', ...counts }, { status: 500 })
  return Response.json({ ok: true, ...counts })
}
