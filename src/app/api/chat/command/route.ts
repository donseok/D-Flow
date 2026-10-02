import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { getComputedWbs } from '@/lib/data/wbs'
import { runCommandPipeline } from '@/lib/ai/commands/pipeline'

export const dynamic = 'force-dynamic'

/** AI 어시스턴트 쓰기 명령 파이프라인(읽기 전용 제안 생성) — 얇은 접착층. 실제 쓰기는 별도 서버 액션이 담당. */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  let body: { projectId?: unknown; workspaceId?: unknown; message?: unknown; targetId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : null
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const targetId = typeof body.targetId === 'string' ? body.targetId : undefined
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }
  if (!projectId) {
    return NextResponse.json({
      kind: 'error', message: '프로젝트 화면에서만 명령을 사용할 수 있어요.',
    })
  }
  // chatbot 관문(스펙 §4.2 챗 위젯 행) — 명령은 프로젝트 화면 전용이라 그 프로젝트로(워크스페이스를 함께 실으면 그 프로젝트의 것이어야 한다)
  const mod = await requireScopedSessionModule({ projectId, workspaceId: body.workspaceId }, 'chatbot')
  if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: mod.status })

  const { items } = await getComputedWbs(projectId)
  const proposal = await runCommandPipeline(message, items, targetId)
  return NextResponse.json(proposal)
}
