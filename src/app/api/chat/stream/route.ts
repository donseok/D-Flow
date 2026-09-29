import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { legacyChatProjectGate } from '@/lib/ai/legacyChatGate'
import { denyStatus } from '@/lib/authz/errors'
import { requireSessionModule } from '@/lib/modules/gate'
import { streamAnswer, sanitizeHistory } from '@/lib/ai/answer'

export const dynamic = 'force-dynamic'

/** 답변 토큰 스트리밍(text/plain). 본문은 /api/chat 과 동일 스키마. */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { projectId?: unknown; message?: unknown; history?: unknown }
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
  // 옛 챗도 chatbot 관문(스펙 §4.2 챗 위젯 행) — 프로젝트 없는 전체 질문은 세션 유일 워크스페이스(P13)
  const mod = await requireSessionModule(projectId, 'chatbot')
  if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: denyStatus(mod.error) })

  try {
    const stream = await streamAnswer({ projectId, message, history })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    console.error('[assistant] /api/chat/stream 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
