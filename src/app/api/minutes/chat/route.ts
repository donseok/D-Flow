import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getActor } from '@/lib/authz'
import { sanitizeHistory } from '@/lib/ai/answer'
import { streamDocAnswer, streamArchiveAnswer } from '@/lib/ai/minutes-answer'
import { folderSubtreeIds } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'
import { ancestorIdsOf, loadFolderSnapshot, seedRootIdOf } from '@/lib/minutes/folders'
import { activeTeamCodesForWorkspacesSync } from '@/lib/minutes/teamScope'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 회의록 Q&A 스트리밍(text/plain). mode=doc(문서 전문) | archive(RAG+키워드). */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: {
    mode?: unknown; minuteId?: unknown; message?: unknown; history?: unknown
    filters?: { team?: unknown; from?: unknown; to?: unknown; folderId?: unknown }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })
  const history = sanitizeHistory(body.history)
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  }

  try {
    if (body.mode === 'doc') {
      const minuteId = typeof body.minuteId === 'string' ? body.minuteId : ''
      if (!minuteId) return NextResponse.json({ error: 'minuteId가 필요합니다.' }, { status: 400 })
      const stream = await streamDocAnswer({ minuteId, message, history })
      if (!stream) return NextResponse.json({ error: '회의록을 찾을 수 없습니다.' }, { status: 404 })
      return new Response(stream, { headers })
    }
    if (body.mode === 'archive') {
      const f = body.filters ?? {}
      // 담당 필터는 호출자 워크스페이스들의 활성 공용 팀으로 본다 — 전 워크스페이스 목록이면 다른 워크스페이스의 팀 코드가
      // 통과한다. 권한 조회·팀 캐시 실패는 throw → 아래 catch 의 500(빈 목록으로 위장하지 않는다).
      const actor = await getActor()
      if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      const team = typeof f.team === 'string' && activeTeamCodesForWorkspacesSync(actor.workspaceRoles.keys()).includes(f.team)
        ? (f.team as TeamCode) : null
      const from = typeof f.from === 'string' && DATE_RE.test(f.from) ? f.from : null
      const to = typeof f.to === 'string' && DATE_RE.test(f.to) ? f.to : null

      // 폴더 필터 — 선택 폴더의 하위 트리 전체로 확장해 전달한다(설계 2026-08-04).
      // 검증 실패를 조용히 무시하면 필터가 소리 없이 팀 전체로 넓어지므로 fail-closed(400/500).
      const folderIdRaw = typeof f.folderId === 'string' && f.folderId.trim() ? f.folderId : null
      let folderIds: string[] | null = null
      if (folderIdRaw) {
        if (!team) {
          return NextResponse.json({ error: '폴더 필터는 담당 선택과 함께 보내야 합니다.' }, { status: 400 })
        }
        const sb = await createServerClient()
        const snap = await loadFolderSnapshot(sb)
        if (!snap) {
          return NextResponse.json({ error: '폴더 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
        }
        // 담당 루트는 그 폴더 범위(프로젝트, 미지정이면 워크스페이스)의 팀 시드 루트다 — 시드 루트 키가 범위를 품으므로
        // 팀 코드만으로는 찾을 수 없다.
        const folder = snap.byId.get(folderIdRaw)
        const rootId = folder ? seedRootIdOf(snap, folder, team) : null
        if (!folder || !rootId || !ancestorIdsOf(snap, folderIdRaw).has(rootId)) {
          return NextResponse.json({ error: '선택한 폴더가 담당 범위에 없습니다. 폴더를 다시 선택해 주세요.' }, { status: 400 })
        }
        folderIds = folderSubtreeIds([...snap.byId.values()], folderIdRaw)
      }
      const stream = await streamArchiveAnswer({ message, history, filters: { team, from, to, folderIds } })
      return new Response(stream, { headers })
    }
    return NextResponse.json({ error: 'mode 는 doc|archive 여야 합니다.' }, { status: 400 })
  } catch (e) {
    console.error('[minutes] /api/minutes/chat 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
