import { NextRequest, NextResponse } from 'next/server'
import { requireSuperuser } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { moduleDef } from '@/lib/modules/registry'
import { createIndexJobModuleGate, enabledIndexProjectIds, keepEnabledMutations } from '@/lib/ai/index/moduleGate'
import {
  INDEX_BACKFILL_DOMAINS,
  createSupabaseIndexContentLoader,
  createSupabaseIndexJobQueue,
  createSupabaseIndexSourceLister,
  createSupabasePgvectorKnowledgeIndex,
  runIndexBackfill,
  runIndexWorkerOnce,
  runRepairOnce,
  type SupabaseKnowledgeClient,
} from '@/lib/ai/index'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

export const dynamic = 'force-dynamic'

// 사용자 요구가 자동/매일 유지보수에서 "필요할 때 버튼으로 수동 갱신"으로 바뀌었다.
// 크론 시크릿 라우트(/api/cron/ai-index)는 브라우저에서 부를 수 없어 이 세션 인가
// 라우트를 별도로 둔다. 조립(queue·index·loadContent)과 repair 로직은 그대로 재사용한다.

const STEP_BATCH_SIZE = 8
const REPAIR_LIMIT = 20

type ReindexAction = 'status' | 'enqueue' | 'step' | 'repair'

function parseAction(raw: unknown): ReindexAction | null {
  if (!raw || typeof raw !== 'object') return null
  const action = (raw as Record<string, unknown>).action
  return action === 'status' || action === 'enqueue' || action === 'step' || action === 'repair' ? action : null
}

/** 워커 라우트와 동일한 accessScope 조립 — chatbot 이 켜진 워크스페이스·프로젝트 + global(P29). */
async function loadAccessScope(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ allowedProjectIds: string[]; allowGlobal: true } | null> {
  const scope = await enabledIndexProjectIds(admin)
  return scope.ok ? { allowedProjectIds: scope.ids, allowGlobal: true } : null
}

export async function POST(req: NextRequest) {
  const t = await serverTranslator()
  // 크론 시크릿이 아니라 세션 인가다 — 브라우저에서 부르는 버튼이라서다.
  const guard = await requireSuperuser()
  if (!guard.ok) return NextResponse.json({ error: libText(t, guard.error) }, { status: denyStatus(guard, 503) })

  const raw = await req.json().catch(() => null)
  const action = parseAction(raw)
  if (!action) return NextResponse.json({ error: t('srv.api.wikiReindex.unknownAction') }, { status: 400 })

  const admin = createAdminClient()

  try {
    if (action === 'status') {
      const [pending, deadLetter, docs, chunks, embedded] = await Promise.all([
        admin.from('ai_index_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        admin.from('ai_index_jobs').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter'),
        // ai_documents 는 문서당 chunk_no=0 행이 정확히 하나다(consistency.ts 의 대표행 관례) — 그걸로 문서 수를 센다.
        admin.from('ai_documents').select('id', { count: 'exact', head: true }).eq('chunk_no', 0),
        admin.from('ai_documents').select('id', { count: 'exact', head: true }),
        admin.from('ai_documents').select('id', { count: 'exact', head: true }).not('embedding', 'is', null),
      ])
      const results = [pending, deadLetter, docs, chunks, embedded]
      // 조회 실패를 0건으로 위장하지 않는다(에러 처리 3원칙) — count 가 null 이면 실패다.
      if (results.some(r => r.error || typeof r.count !== 'number')) {
        return NextResponse.json({ error: t('srv.api.wikiReindex.couldNotQueryIndexStatus') }, { status: 503 })
      }
      return NextResponse.json({
        pending: pending.count, deadLetter: deadLetter.count,
        docs: docs.count, chunks: chunks.count, embedded: embedded.count,
      })
    }

    const scopedAdmin = admin as unknown as SupabaseKnowledgeClient

    if (action === 'repair') {
      const result = await runRepairOnce(scopedAdmin, REPAIR_LIMIT)
      if ('error' in result) return NextResponse.json({ error: libText(t, result.error) }, { status: result.status })
      return NextResponse.json(result)
    }

    // 정본 §3.2.7 규칙 2 — status·repair 는 위에서 처리하므로 배포 플래그가 꺼져도 남는다.
    if (!moduleDef('chatbot').envAvailable()) {
      return NextResponse.json({ error: t('srv.api.wikiReindex.chatbotIndexingNotAvailableDeployment') }, { status: 404 })
    }
    // enqueue/step 은 프로젝트 스코프가 필요하다 — 워커 라우트와 동일하게 조립.
    const accessScope = await loadAccessScope(admin)
    if (!accessScope) return NextResponse.json({ error: t('err.couldNotVerifyProjectScope') }, { status: 503 })
    const queue = createSupabaseIndexJobQueue(scopedAdmin, accessScope)
    const gate = createIndexJobModuleGate(admin)

    if (action === 'enqueue') {
      let enqueued = 0
      for (const domain of INDEX_BACKFILL_DOMAINS) {
        const summary = await runIndexBackfill({
          domain,
          list: createSupabaseIndexSourceLister(scopedAdmin),
          enqueue: async mutations => queue.enqueue(await keepEnabledMutations(gate, mutations)),
        })
        // 도메인 하나라도 조회/큐잉이 실패하면 부분 합계를 성공으로 위장하지 않는다.
        if (summary.listErrorCode || summary.enqueueErrorCode) {
          return NextResponse.json({ error: t('srv.api.wikiReindex.couldNotEnqueueIndexTargets') }, { status: 503 })
        }
        enqueued += summary.enqueued
      }
      return NextResponse.json({ enqueued })
    }

    // action === 'step'
    const summary = await runIndexWorkerOnce({
      queue,
      index: createSupabasePgvectorKnowledgeIndex(scopedAdmin, accessScope),
      loadContent: createSupabaseIndexContentLoader(scopedAdmin),
      batchSize: STEP_BATCH_SIZE,
      moduleGate: gate,
    })
    return NextResponse.json(summary)
  } catch (e) {
    console.error('[wiki] /api/wiki/reindex 오류:', e)
    return NextResponse.json({ error: t('srv.api.wikiReindex.reindexJobFailed') }, { status: 500 })
  }
}
