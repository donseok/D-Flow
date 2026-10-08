import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeJob } from '@/lib/jobs/auth'
import { createIndexJobModuleGate, enabledIndexProjectIds, keepEnabledMutations } from '@/lib/ai/index/moduleGate'
import {
  INDEX_BACKFILL_DOMAINS,
  checkIndexConsistency,
  createSupabaseIndexContentLoader,
  createSupabaseIndexJobQueue,
  createSupabaseIndexSourceLister,
  createSupabasePgvectorKnowledgeIndex,
  listIndexedEntitySummaries,
  runIndexBackfill,
  runIndexWorkerOnce,
  runRepairOnce,
  type IndexBackfillDomain,
  type SupabaseKnowledgeClient,
} from '@/lib/ai/index'

/**
 * 잡 `ai-index`(잡 레지스트리 — @/lib/jobs/registry). AI 색인 큐 워커다.
 * - GET: 스케줄 실행. 큐를 한 배치 소비한다.
 * - POST: 수동 실행. body.mode = worker | consistency | backfill | repair(옛 색인 워커 라우트를 흡수했다 — 정본 §5.5.2 ①).
 * 인증은 둘 다 Authorization: Bearer <CRON_SECRET>. 시크릿 미설정·워커 플래그 꺼짐·배포에서 챗봇 불가는 404, 불일치는 401.
 */

export const dynamic = 'force-dynamic'

const BATCH = 25
const MAX_BATCH_SIZE = 200
// repair 모드는 임베딩 API 호출 1건당 지연이 커서(withTimeout) 워커/백필보다 상한을 낮게 잡는다.
const MAX_REPAIR_LIMIT = 100
const DEFAULT_REPAIR_LIMIT = 20

interface WorkerRequestBody {
  mode: 'worker' | 'consistency' | 'backfill' | 'repair'
  domain?: IndexBackfillDomain
  projectId?: string
  dryRun?: boolean
  batchSize?: number
}

function parseBody(raw: unknown): WorkerRequestBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  if (
    body.mode !== 'worker' && body.mode !== 'consistency'
    && body.mode !== 'backfill' && body.mode !== 'repair'
  ) return null

  const parsed: WorkerRequestBody = { mode: body.mode }
  if (body.domain !== undefined) {
    if (!(INDEX_BACKFILL_DOMAINS as readonly unknown[]).includes(body.domain)) return null
    parsed.domain = body.domain as IndexBackfillDomain
  }
  if (body.projectId !== undefined) {
    if (typeof body.projectId !== 'string' || !body.projectId.trim() || body.projectId.length > 64) return null
    parsed.projectId = body.projectId.trim()
  }
  if (body.dryRun !== undefined) {
    if (typeof body.dryRun !== 'boolean') return null
    parsed.dryRun = body.dryRun
  }
  if (body.batchSize !== undefined) {
    if (!Number.isInteger(body.batchSize) || Number(body.batchSize) < 1 || Number(body.batchSize) > MAX_BATCH_SIZE) return null
    parsed.batchSize = body.batchSize as number
  }
  // consistency/backfill은 도메인이 없으면 대상 자체가 정의되지 않는다. repair는 도메인 무관(전역 스캔).
  if ((parsed.mode === 'consistency' || parsed.mode === 'backfill') && !parsed.domain) return null
  return parsed
}

export async function GET(request: NextRequest) {
  const denied = authorizeJob(request, 'ai-index')
  if (denied) return denied

  // runIndexWorkerOnce 는 모든 I/O 를 주입받는 순수 오케스트레이션이다.
  const db = createAdminClient()
  const admin = db as unknown as SupabaseKnowledgeClient
  // 스코프는 워크스페이스 → 프로젝트 순으로 chatbot 이 켜진 것만(스펙 §4.2 워커 행, P29). 조회 실패를 빈 스코프로 위장하지 않는다(3원칙 ①).
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

export async function POST(req: NextRequest) {
  const denied = authorizeJob(req, 'ai-index')
  if (denied) return denied

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const body = parseBody(raw)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  try {
    // service-role 전용 조립. repair 는 전역 스캔이고, 그 밖의 어댑터는 아래에서 켜진 프로젝트 + global 로 좁힌다(P29).
    const db = createAdminClient()
    const admin = db as unknown as SupabaseKnowledgeClient

    if (body.mode === 'repair') {
      const limit = Math.min(body.batchSize ?? DEFAULT_REPAIR_LIMIT, MAX_REPAIR_LIMIT)
      const result = await runRepairOnce(admin, limit)
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json({ mode: 'repair', ...result })
    }

    // 전역 backfill·consistency 도 워크스페이스 → 프로젝트 관문을 통과한 범위만 큐에 넣는다(스펙 §4.2 워커 행).
    const scope = await enabledIndexProjectIds(db)
    if (!scope.ok) return NextResponse.json({ error: '프로젝트 범위를 확인하지 못했습니다.' }, { status: 503 })
    const accessScope = { allowedProjectIds: scope.ids, allowGlobal: true }
    const queue = createSupabaseIndexJobQueue(admin, accessScope)
    const gate = createIndexJobModuleGate(db)

    if (body.mode === 'worker') {
      const summary = await runIndexWorkerOnce({
        queue,
        index: createSupabasePgvectorKnowledgeIndex(admin, accessScope),
        loadContent: createSupabaseIndexContentLoader(admin),
        batchSize: body.batchSize,
        moduleGate: gate,
      })
      return NextResponse.json({ mode: 'worker', ...summary })
    }

    const domain = body.domain as IndexBackfillDomain
    if (body.mode === 'backfill') {
      const summary = await runIndexBackfill({
        domain,
        projectId: body.projectId,
        list: createSupabaseIndexSourceLister(admin),
        enqueue: async mutations => queue.enqueue(await keepEnabledMutations(gate, mutations)), // 켜진 것만(스펙 §4.2 워커 행)
        dryRun: body.dryRun,
        batchSize: body.batchSize,
      })
      return NextResponse.json({ mode: 'backfill', ...summary })
    }

    const [sourcesResult, indexedResult] = await Promise.all([
      createSupabaseIndexSourceLister(admin)(domain, body.projectId),
      listIndexedEntitySummaries(admin, { domain, projectId: body.projectId }),
    ])
    if (!sourcesResult.ok || !indexedResult.ok) {
      return NextResponse.json({ error: '정합성 검사 조회에 실패했습니다.' }, { status: 503 })
    }
    const report = await checkIndexConsistency({
      sources: sourcesResult.data,
      indexed: indexedResult.data,
      enqueue: body.dryRun ? undefined : async mutations => queue.enqueue(await keepEnabledMutations(gate, mutations)),
      limit: body.batchSize,
    })
    // 엔티티 목록은 응답에 싣지 않는다(내부 식별자 노출 최소화) — 수량 요약만.
    return NextResponse.json({
      mode: 'consistency',
      checked: report.checked,
      planned: report.mutations.length,
      enqueued: report.enqueued,
      enqueueErrorCode: report.enqueueErrorCode,
      dryRun: Boolean(body.dryRun),
    })
  } catch (e) {
    console.error('[assistant] /api/cron/ai-index POST 오류:', e)
    return NextResponse.json({ error: '색인 워커 실행에 실패했습니다.' }, { status: 500 })
  }
}
