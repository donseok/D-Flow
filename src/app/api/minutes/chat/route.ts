import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getActor, resolveScope } from '@/lib/authz'
import { denyStatus, ERR_MISSING } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { sanitizeHistory } from '@/lib/ai/answer'
import { streamDocAnswer, streamArchiveAnswer } from '@/lib/ai/minutes-answer'
import { teamViewOf } from '@/lib/domain/authz'
import { folderSubtreeIds } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'
import { ancestorIdsOf, loadFolderSnapshot, seedRootIdOf } from '@/lib/minutes/folders'
import { createServerClient } from '@/lib/supabase/server'
import { teamCodesVisibleTo } from '@/lib/teams/source'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 회의록 Q&A 스트리밍(text/plain). mode=doc(문서 전문) | archive(RAG+키워드). */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: {
    mode?: unknown; minuteId?: unknown; message?: unknown; history?: unknown; workspaceId?: unknown
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
      // 회의록 행의 워크스페이스로 minutes 관문(스펙 §4.2) — 볼 수 없는 행은 404, 조회 실패는 500(없는 회의록으로 위장하지 않는다)
      const s = await resolveScope('minutes', minuteId)
      if (!s.ok) return NextResponse.json({ error: s.error === ERR_MISSING ? '회의록을 찾을 수 없습니다.' : s.error }, { status: denyStatus(s.error) })
      const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')
      if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: denyStatus(mod.error) })
      const stream = await streamDocAnswer({ minuteId, message, history })
      if (!stream) return NextResponse.json({ error: '회의록을 찾을 수 없습니다.' }, { status: 404 })
      return new Response(stream, { headers })
    }
    if (body.mode === 'archive') {
      // 보관함 전체 Q&A — 대상 행이 없어 요청의 워크스페이스(회의록 화면 범위, 소속 확인 — D26)로 minutes 관문. 없으면 400(추측하지 않는다).
      // 검색·AI 판정도 그 워크스페이스로 — 두 워크스페이스 소속자의 답에 다른 워크스페이스 회의록이 섞이지 않는다
      const g = await requireScopedSessionModule({ projectId: null, workspaceId: body.workspaceId }, 'minutes')
      if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status })
      const workspaceId = g.workspaceId
      if (!workspaceId) return NextResponse.json({ error: '워크스페이스를 확인할 수 없습니다.' }, { status: 400 })
      const f = body.filters ?? {}
      // 담당 필터는 호출자가 볼 수 있는 활성 팀으로 본다 — 소속 워크스페이스들의 공용 팀 + 볼 수 있는 프로젝트의 전용 팀,
      // 플랫폼 관리자는 전부(teamViewOf). 전 워크스페이스 목록이면 다른 워크스페이스의 팀 코드가 통과한다.
      // 권한 조회·팀 원천 실패는 throw → 아래 catch 의 500(필터를 버리지 않는다).
      const actor = await getActor()
      if (!actor) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      const team = typeof f.team === 'string'
        && (await teamCodesVisibleTo(teamViewOf(actor, await getHiddenProjectIds()))).includes(f.team)
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
        // 그 워크스페이스의 폴더만 — 다른 워크스페이스 폴더는 담당 범위 밖과 같은 400(검색이 그 워크스페이스로 걸려 조용히 0건이 되지 않게)
        const folder = snap.byId.get(folderIdRaw)
        const rootId = folder && folder.workspaceId === workspaceId ? seedRootIdOf(snap, folder, team) : null
        if (!folder || !rootId || !ancestorIdsOf(snap, folderIdRaw).has(rootId)) {
          return NextResponse.json({ error: '선택한 폴더가 담당 범위에 없습니다. 폴더를 다시 선택해 주세요.' }, { status: 400 })
        }
        folderIds = folderSubtreeIds([...snap.byId.values()], folderIdRaw)
      }
      const stream = await streamArchiveAnswer({ workspaceId, message, history, filters: { team, from, to, folderIds } })
      return new Response(stream, { headers })
    }
    return NextResponse.json({ error: 'mode 는 doc|archive 여야 합니다.' }, { status: 400 })
  } catch (e) {
    console.error('[minutes] /api/minutes/chat 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
