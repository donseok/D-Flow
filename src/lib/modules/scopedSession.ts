/**
 * 세션 라우트의 범위 관문(D26 — UI-2b, 계획 과제 34). 가드가 아니다 — 라우트의 세션 확인 뒤, 입력 검증 앞에서 부른다(P17).
 * - 프로젝트가 있으면 그 프로젝트로 판정한다(지금과 같다). 요청이 워크스페이스도 실어 왔으면 그 프로젝트의 워크스페이스와 같아야 한다 —
 *   다르면 404(존재 은닉). 셸이 프로젝트 화면에서 워크스페이스를 싣지 않으므로(requestWorkspaceId) 정상 요청은 이 갈래를 타지 않는다.
 * - 프로젝트가 없으면 요청이 실어 온 워크스페이스(셸의 ShellScope)로 판정한다. 둘 다 없으면 400 — 세션 유일 워크스페이스로 추측하지 않는다
 *   (SP3a R15 를 닫는다).
 * - 워크스페이스는 모양(SAFE_ID_RE)부터 본다 — 줄바꿈·임의 길이 문자열을 소속 판정·관문 로그·설정 조회에 싣지 않는다. 그다음 실제 소속
 *   (workspace_members — 승계 없음). 플랫폼 관리자는 보기 축이라(loadWorkspaceScope·/api/shell 과 같다 — 비소속 워크스페이스 화면을 연다)
 *   통과하되, 소속 맵에 없는 id 는 소문자 uuid 일 때만 실제 존재를 한 번 확인한다(RLS my_workspace_ids() 가 전부를 준다). 본인 기록 쓰기의
 *   실제 소속 기준(AA6 — 개인 설정·방문·쿠키)과는 다른 축이다 — 여기는 그 화면에서 하는 읽기·질문의 관문이다.
 * 권한·존재 조회 오류는 503(ERR_LOOKUP) — 비소속·없음으로 위장하지 않는다.
 */
import { getActor } from '@/lib/authz'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING, denyStatus } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { hasWorkspaceMembership, type Actor } from '@/lib/domain/authz'
import { SAFE_ID_RE, UUID_RE } from '@/lib/domain/validate'
import { workspaceRefById } from '@/lib/workspace/resolve'
import type { ModuleId } from './defaults'
import { requireModule } from './gate'

export type ScopedSessionResult = { ok: true; workspaceId: string | null } | { ok: false; error: string; status: number }

const fail = (error: string, status: number): ScopedSessionResult => ({ ok: false, error, status })
const MISSING = (): ScopedSessionResult => fail(ERR_MISSING, 404)
/** 인자가 없음 — undefined·null·빈 문자열(쿼리 `?workspaceId=`) */
const absent = (v: unknown) => v === undefined || v === null || v === ''

async function actorOrFail(): Promise<{ actor: Actor } | { fail: ScopedSessionResult }> {
  let actor: Actor | null
  try { actor = await getActor() } catch (e) {
    console.error('[requireScopedSessionModule] 권한 조회 실패:', e instanceof Error ? e.message : e)
    return { fail: fail(ERR_LOOKUP, 503) }
  }
  return actor ? { actor } : { fail: fail(ERR_ANON, 401) }
}

/** 프로젝트 없는 요청의 워크스페이스 판정 — 소속이면 그 id, 플랫폼 관리자면 실제로 있는 워크스페이스의 id */
async function workspaceFor(actor: Actor, wid: string): Promise<{ ok: true; id: string } | { ok: false; result: ScopedSessionResult }> {
  if (hasWorkspaceMembership(actor, wid)) return { ok: true, id: wid }
  if (!actor.isSuperuser || !UUID_RE.test(wid) || wid !== wid.toLowerCase()) return { ok: false, result: MISSING() }
  let ref: Awaited<ReturnType<typeof workspaceRefById>>
  try { ref = await workspaceRefById(wid) } catch (e) {
    console.error('[requireScopedSessionModule] 워크스페이스 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, result: fail(ERR_LOOKUP, 503) }
  }
  if (ref.ok) return { ok: true, id: ref.ws.id }
  return { ok: false, result: ref.kind === 'missing' ? MISSING() : fail(ERR_LOOKUP, 503) }
}

export async function requireScopedSessionModule(
  input: { projectId: string | null; workspaceId: unknown },
  moduleId: ModuleId | readonly ModuleId[],
): Promise<ScopedSessionResult> {
  const { projectId, workspaceId: raw } = input
  if (!absent(raw) && (typeof raw !== 'string' || !SAFE_ID_RE.test(raw))) return MISSING()
  const wid = absent(raw) ? null : (raw as string)

  if (projectId) {
    if (wid !== null) {
      const a = await actorOrFail()
      if ('fail' in a) return a.fail
      if (a.actor.projectWorkspace.get(projectId) !== wid) return MISSING()
    }
    const r = await requireModule({ projectId }, moduleId)
    return r.ok ? { ok: true, workspaceId: wid } : fail(r.error, denyStatus(r.error))
  }

  if (wid === null) return fail(ERR_WORKSPACE_REQUIRED, 400)
  const a = await actorOrFail()
  if ('fail' in a) return a.fail
  const ws = await workspaceFor(a.actor, wid)
  if (!ws.ok) return ws.result
  const r = await requireModule({ workspaceId: ws.id }, moduleId)
  return r.ok ? { ok: true, workspaceId: ws.id } : fail(r.error, denyStatus(r.error))
}
