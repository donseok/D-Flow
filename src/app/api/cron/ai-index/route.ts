import { createHash, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { runIndexWorkerOnce } from '@/lib/ai/index/worker'
import {
  createSupabaseIndexContentLoader,
  createSupabaseIndexJobQueue,
  createSupabasePgvectorKnowledgeIndex,
} from '@/lib/ai/index'
import { createAdminClient } from '@/lib/supabase/admin'
import { chatIndexWorkerEnabled } from '@/lib/modules/flags'
import { moduleDef } from '@/lib/modules/registry'
import { createIndexJobModuleGate, enabledIndexProjectIds } from '@/lib/ai/index/moduleGate'
import type { SupabaseKnowledgeClient } from '@/lib/ai/index/pgvector'

/**
 * Vercel 크론 → 색인 워커 어댑터.
 *
 * 기존 /api/chat/index/worker 는 POST + x-cron-secret 헤더로 인증하는데
 * Vercel 크론은 GET + Authorization: Bearer $CRON_SECRET 을 보낸다. 규약이
 * 달라 크론이 그 라우트를 직접 못 부른다. 로직은 중복하지 않고 그대로 위임한다.
 */

export const dynamic = 'force-dynamic'

const BATCH = 25

/** 시크릿 비교는 길이 노출·타이밍 채널을 피하기 위해 해시 후 상수시간으로 비교한다. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  // 시크릿이 없으면 존재 자체를 숨긴다. 기존 워커 라우트와 다르게 404 를 낸다 —
  // 그 이유는 워커 라우트도 같은 태도를 보이기 때문이다(route.ts:70-74).
  // inbox-retention 은 503 을 내는데 그건 다른 서비스이고, 이건 워커 라우트를 따른다.
  if (!secret) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!chatIndexWorkerEnabled()) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  if (!moduleDef('chatbot').envAvailable()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Authorization: Bearer <secret> 규약으로 들어온다(Vercel 크론).
  const authHeader = request.headers.get('authorization')
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!secretMatches(providedSecret, secret)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  // runIndexWorkerOnce 는 모든 I/O 를 주입받는 순수 오케스트레이션이다.
  // 어댑터 3종 조립은 /api/chat/index/worker/route.ts:101-107 과 동일하게 한다.
  const db = createAdminClient()
  const admin = db as unknown as SupabaseKnowledgeClient
  const scope = await enabledIndexProjectIds(db)
  if (!scope.ok) return NextResponse.json({ error: 'PROJECTS_READ_FAILED' }, { status: 503 })
  const accessScope = { allowedProjectIds: scope.ids, allowGlobal: true }

  const summary = await runIndexWorkerOnce({
    queue: createSupabaseIndexJobQueue(admin, accessScope),
    index: createSupabasePgvectorKnowledgeIndex(admin, accessScope),
    loadContent: createSupabaseIndexContentLoader(admin),
    batchSize: BATCH,
    moduleGate: createIndexJobModuleGate(db),
  })
  return NextResponse.json({ ok: true, ...summary })
}
