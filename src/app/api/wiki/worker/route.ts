import { NextRequest, NextResponse } from 'next/server'
import { runWikiWorkerOnce } from '@/lib/ai/wiki-ingest'
import { authorizeJob } from '@/lib/jobs/auth'

export const dynamic = 'force-dynamic'

async function runWorker(limit: number): Promise<NextResponse> {
  try {
    return NextResponse.json(await runWikiWorkerOnce(limit))
  } catch (error) {
    console.error('[wiki] worker 실행 실패:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Wiki 처리 작업 실행에 실패했습니다.' }, { status: 500 })
  }
}

/**
 * 잡 `wiki-worker`(잡 레지스트리 — @/lib/jobs/registry). 실패/지연된 Wiki 처리 작업 재시도용 보호 라우트.
 * - GET: 스케줄 실행(고정 배치 10).
 * - POST: 운영자의 수동 재시도. body 는 { mode?: 'worker', limit?: 1~20 }.
 * 인증은 둘 다 Authorization: Bearer <CRON_SECRET>. 시크릿 미설정·WIKI_WORKER_ENABLED 꺼짐은 404, 불일치는 401.
 */
export async function POST(req: NextRequest) {
  const denied = authorizeJob(req, 'wiki-worker')
  if (denied) return denied

  let limit = 5
  try {
    const body = await req.json() as unknown
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const { mode, limit: requested } = body as Record<string, unknown>
      // 수동 모드는 worker 하나다(레지스트리 manualModes). 생략하면 worker 로 본다.
      if (mode !== undefined && mode !== 'worker') {
        return NextResponse.json({ error: 'mode 는 worker 만 받습니다.' }, { status: 400 })
      }
      if (requested !== undefined) {
        if (!Number.isInteger(requested) || Number(requested) < 1 || Number(requested) > 20) {
          return NextResponse.json({ error: 'limit은 1~20 정수여야 합니다.' }, { status: 400 })
        }
        limit = requested as number
      }
    }
  } catch {
    // 빈 body는 기본 limit으로 실행한다.
  }

  return runWorker(limit)
}

export async function GET(req: NextRequest) {
  const denied = authorizeJob(req, 'wiki-worker')
  if (denied) return denied
  return runWorker(10)
}
