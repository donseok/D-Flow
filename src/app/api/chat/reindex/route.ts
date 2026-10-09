import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAdmin } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { ingestProject } from '@/lib/ai/ingest'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

export const dynamic = 'force-dynamic'

/** 프로젝트 색인 재생성 — 그 프로젝트의 관리자(SP2 §4.1). 판정 대상이 본문에 있어 본문을 먼저 읽는다(형식 검사만, DB 접근은 가드 뒤). */
export async function POST(req: NextRequest) {
  const t = await serverTranslator()
  let body: { projectId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: t('err.invalidRequest') }, { status: 400 })
  }
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: t('srv.api.chatReindex.projectidRequired') }, { status: 400 })

  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return NextResponse.json({ error: libText(t, g.error) }, { status: denyStatus(g) })
  // chatbot 관문 — 가드 뒤(정본 §3.2.4)
  const mod = await requireModule({ projectId }, 'chatbot')
  if (!mod.ok) return NextResponse.json({ error: libText(t, mod.error) }, { status: denyStatus(mod) })

  try {
    const result = await ingestProject(projectId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[assistant] /api/chat/reindex 오류:', e)
    return NextResponse.json({ error: t('err.indexingFailed') }, { status: 500 })
  }
}
