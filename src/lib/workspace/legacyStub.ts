/**
 * 옛 경로 스텁의 본문(스펙 §5.3, D5) — src/app/(legacy)/<옛 경로>/route.ts 가 모두 이 함수 하나를 부른다(계획 V11).
 * 응답은 307 + no-store(대상이 쿠키·소속으로 달라진다 — 308·permanentRedirect 금지).
 * Location 은 **상대 경로**다(컨트롤러 W2) — req.nextUrl.origin 은 Host 와 무관하게 localhost 로 나와(스파이크 S-1 ②), 127.0.0.1 에서
 * 들어온 브라우저를 다른 호스트로 보내 세션 쿠키를 잃게 한다. NEXT_PUBLIC_APP_URL 도 같은 이유로 쓰지 않는다.
 * 스텁은 화면을 그리지 않는다 — 해석 오류·소속 0 은 / (리졸버가 오류·소속 없음 화면을 그린다).
 * 워크스페이스 해석 조회 말고는 데이터를 읽지 않는다. 비로그인은 미들웨어가 먼저 /login 으로 보낸다.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { getActorViewState } from '@/lib/authz'
import { UUID_RE } from '@/lib/domain/validate'
import { createServerClient } from '@/lib/supabase/server'
import { readCurrentWorkspace } from './current'
import { LEGACY_ROUTES, legacyTarget, type LegacyKind } from './legacy'
import { workspaceRefById } from './resolve'

async function currentSlug(): Promise<string | null> {
  const cur = await readCurrentWorkspace()
  if (!cur.ok) throw new Error(`현재 워크스페이스를 읽지 못했다: ${cur.error}`)
  return cur.ws?.slug ?? null
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return '' }
}

/** 회의록 행의 워크스페이스 슬러그 — 세션 클라이언트(RLS)로 읽히지 않으면 null(존재를 드러내지 않는다) */
async function minuteSlug(pathname: string): Promise<string | null> {
  const id = safeDecode(pathname.split('/')[2] ?? '')
  if (!UUID_RE.test(id)) return null
  const sb = await createServerClient()
  const { data, error } = await sb.from('minutes').select('workspace_id, workspaces!inner(slug)').eq('id', id).maybeSingle()
  if (error) { console.error('[legacy] 회의록 행 조회 실패 — 현재 워크스페이스로:', error.message); return null }
  const ws = (data as { workspaces?: { slug: string } | { slug: string }[] } | null)?.workspaces
  return (Array.isArray(ws) ? ws[0]?.slug : ws?.slug) ?? null
}

/** /admin/accounts?project=<pid> — 그 사람이 아는 프로젝트(권한 맵)면 그 프로젝트의 워크스페이스(W11 — 판정은 대상 화면이 다시 한다) */
async function accountsProjectSlug(search: URLSearchParams): Promise<string | null> {
  const pid = search.get('project')
  if (!pid || !UUID_RE.test(pid)) return null
  const { actor } = await getActorViewState()
  const wid = actor?.projectWorkspace.get(pid)
  if (!wid) return null
  const ref = await workspaceRefById(wid)
  return ref.ok ? ref.ws.slug : null
}

export async function legacyRedirect(req: NextRequest, kind: LegacyKind): Promise<NextResponse> {
  const { pathname, search, searchParams } = req.nextUrl
  let slug: string | null = null
  let failed = false
  try {
    const how = LEGACY_ROUTES[kind].resolve
    if (how === 'minuteRow') slug = (await minuteSlug(pathname)) ?? (await currentSlug())
    else if (how === 'accountsProject') slug = (await accountsProjectSlug(searchParams)) ?? (await currentSlug())
    else if (how === 'current') slug = await currentSlug()
  } catch (e) {
    console.error('[legacy] 워크스페이스 해석 실패 — / 로:', kind, e instanceof Error ? e.message : e)
    failed = true
  }
  const target = failed ? { path: '/', search: '' } : legacyTarget(kind, pathname, search, slug)
  return new NextResponse(null, { status: 307, headers: { Location: `${target.path}${target.search}`, 'Cache-Control': 'no-store' } })
}
