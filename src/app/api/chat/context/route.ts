import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { legacyChatProjectGate } from '@/lib/ai/legacyChatGate'
import { denyStatus } from '@/lib/authz/errors'
import { requireSessionModule } from '@/lib/modules/gate'
import { buildBotContext } from '@/lib/ai/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('projectId')
  const projectId = raw && raw !== 'null' && raw !== 'undefined' ? raw : null
  // 볼 수 없는 프로젝트면 컨텍스트(service_role 팀 캐시로 만든 분석)를 만들지 않는다.
  const gate = await legacyChatProjectGate(projectId)
  if (gate) return gate
  // 옛 챗도 chatbot 관문(스펙 §4.2 챗 위젯 행) — 프로젝트 없는 전체 질문은 세션 유일 워크스페이스(P13)
  const mod = await requireSessionModule(projectId, 'chatbot')
  if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: denyStatus(mod.error) })
  // 위젯 탐침(P12) — 관문만 지나고 문맥(service_role 분석)을 만들지 않는다
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true })

  try {
    const ctx = await buildBotContext(projectId)
    return NextResponse.json(ctx)
  } catch (e) {
    console.error('[assistant] /api/chat/context 오류:', e)
    return NextResponse.json({ error: '컨텍스트 로드에 실패했습니다.' }, { status: 500 })
  }
}
