import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeJob } from '@/lib/jobs/auth'

/** 잡 `inbox-retention`(잡 레지스트리) — 읽은 알림 90일 정리. core 잡이라 모듈 판정 없이 돈다. */
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const denied = authorizeJob(req, 'inbox-retention')
  if (denied) return denied

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('purge_read_notifications', { retention_days: 90 })
  if (error) {
    console.error('[inbox] retention purge 실패', error.message)
    return new Response('purge failed', { status: 500 })
  }
  return Response.json({ ok: true, result: data })
}
