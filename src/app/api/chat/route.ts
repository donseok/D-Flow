import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { legacyChatProjectGate } from '@/lib/ai/legacyChatGate'
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { answerQuestion, sanitizeHistory } from '@/lib/ai/answer'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { projectId?: unknown; workspaceId?: unknown; message?: unknown; history?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  const history = sanitizeHistory(body.history)
  // 볼 수 없는 프로젝트면 파이프라인(service_role 팀 캐시·자가 치유 색인)에 들이지 않는다.
  const gate = await legacyChatProjectGate(projectId)
  if (gate) return gate
  // 옛 챗도 chatbot 관문(스펙 §4.2 챗 위젯 행) — 프로젝트 없는 전체 질문은 요청의 워크스페이스(셸 범위, 소속 확인 — D26). 둘 다 없으면 400
  const mod = await requireScopedSessionModule({ projectId, workspaceId: body.workspaceId }, 'chatbot')
  if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status })

  try {
    const result = await answerQuestion({ projectId, message, history })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[assistant] /api/chat 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
