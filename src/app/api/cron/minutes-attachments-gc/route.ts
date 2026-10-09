import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeJob } from '@/lib/jobs/auth'
import { runSweep } from '@/lib/minutes/attachmentSweepRun.mjs'

/**
 * 잡 `minutes-attachments-gc`(잡 레지스트리) — 회의록 첨부 청소(SP5 D26). core 잡이라 모듈 판정 없이 돈다.
 * 본체는 수동 스크립트(npm run minutes:sweep)와 같은 runSweep 이다 — 잡은 항상 apply 로 부른다(dry-run 점검은 스크립트 몫).
 * 읽기(버킷 목록·minute_files·minute_versions)가 하나라도 실패하면 아무것도 지우지 않는다. 응답은 수량뿐이다(경로·파일 이름을 싣지 않는다).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const denied = authorizeJob(req, 'minutes-attachments-gc')
  if (denied) return denied

  const result = await runSweep(createAdminClient(), { apply: true })
  if (!result.ok) {
    console.error('[minutes] 첨부 청소 읽기 실패 — 아무것도 지우지 않았다:', result.error)
    return Response.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  const counts = { ...result.summary, failed: result.failures }
  // 일부 삭제·기록 실패도 성공으로 위장하지 않는다 — 수량은 그대로 싣고 500 으로 알린다. 남은 것은 다음 실행이 다시 시도한다.
  if (result.failures > 0) return Response.json({ error: 'REMOVE_FAILED', ...counts }, { status: 500 })
  return Response.json({ ok: true, ...counts })
}
