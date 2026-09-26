import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAdmin } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { ingestProject } from '@/lib/ai/ingest'

export const dynamic = 'force-dynamic'

/** 프로젝트 색인 재생성 — 그 프로젝트의 관리자(SP2 §4.1). 판정 대상이 본문에 있어 본문을 먼저 읽는다(형식 검사만, DB 접근은 가드 뒤). */
export async function POST(req: NextRequest) {
  let body: { projectId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'projectId 가 필요합니다.' }, { status: 400 })

  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g.error) })

  try {
    const result = await ingestProject(projectId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[assistant] /api/chat/reindex 오류:', e)
    return NextResponse.json({ error: '색인에 실패했습니다.' }, { status: 500 })
  }
}
