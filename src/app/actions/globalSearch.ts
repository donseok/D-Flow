'use server'

import { createServerClient } from '@/lib/supabase/server'
import { wbsItemHref } from '@/lib/ai/chat/deep-links'
import { getActor } from '@/lib/authz'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { canSeeProject, workspaceRoleIn, type Actor } from '@/lib/domain/authz'
import { SAFE_ID_RE } from '@/lib/domain/validate'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'

export interface SearchProjectItem {
  type: 'project'
  id: string
  name: string
  href: string
}

export interface SearchWbsItem {
  type: 'wbs'
  id: string
  code: string
  title: string
  projectId: string
  href: string
}

const ERR_SEARCH_FAILED = 'srv.globalSearch.couldNotSearch'

/** 실패와 0건을 가른다 — 0건은 ok:true 에 빈 배열, 조회 오류·범위 거부는 ok:false(빈 결과로 위장하지 않는다) */
export type GlobalSearchResponse =
  | { ok: true; projects: SearchProjectItem[]; wbsItems: SearchWbsItem[] }
  | { ok: false; reason: 'denied' | 'failed'; error: string }

const PROJECT_LIMIT = 10
const WBS_LIMIT = 20
const EMPTY: GlobalSearchResponse = { ok: true, projects: [], wbsItems: [] }
const denied = (error: string): GlobalSearchResponse => ({ ok: false, reason: 'denied', error })
const failed = (t: ServerTranslate): GlobalSearchResponse => ({ ok: false, reason: 'failed', error: t(ERR_SEARCH_FAILED) })
const absent = (v: unknown) => v === undefined || v === null || v === ''

/**
 * 전역 ⌘K 제목 검색 액션 (개정 §5.3.7, UX-04, SPU2)
 * - 찾기 대상은 둘뿐이다: 워크스페이스 범위 = 그 워크스페이스의 프로젝트 이름, 프로젝트 범위 = 그 프로젝트의 WBS 항목 이름·코드.
 *   범위 없는 WBS 검색은 없다(호출자가 볼 수 있는 전 워크스페이스를 뒤지지 않는다).
 * - 범위는 서버가 다시 판정한다: 워크스페이스는 소속(플랫폼 관리자는 보기 축), 프로젝트는 액터가 아는 프로젝트이고 요청이 실어 온
 *   워크스페이스와 같아야 한다. 명단 밖 비공개 프로젝트는 숨긴다(canSeeProject). 조회는 세션 클라이언트(RLS).
 * - wbs·프로젝트 목록은 core 모듈이라 모듈 관문이 없다.
 * - 본문 검색이 아니다(색인 없음 — 미색인 상태는 SP8 본문 검색에서 생긴다).
 */
export async function searchTitles(params?: {
  workspaceId?: string | null
  query: string
  scope: 'workspace' | 'project'
  projectId?: string | null
}): Promise<GlobalSearchResponse> {
  let actor: Actor | null
  try { actor = await getActor() } catch (e) {
    console.error('[searchTitles] 권한 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'failed', error: ERR_LOOKUP }
  }
  if (!actor) return denied(ERR_ANON)

  const q = typeof params?.query === 'string' ? params.query.trim() : ''
  if (!params || !q) return EMPTY
  // PostgREST or()·ilike 패턴을 깨는 문자를 뺀다
  const escaped = q.replace(/[%_,()\\"*]/g, '').slice(0, 100)
  if (!escaped) return EMPTY

  const rawWs: unknown = params.workspaceId
  if (!absent(rawWs) && (typeof rawWs !== 'string' || !SAFE_ID_RE.test(rawWs))) return denied(ERR_MISSING)
  const wid = absent(rawWs) ? null : (rawWs as string)

  if (params.scope === 'project') {
    const pid = params.projectId
    if (typeof pid !== 'string' || !SAFE_ID_RE.test(pid)) return denied(ERR_MISSING)
    const projectWs = actor.projectWorkspace.get(pid)
    if (projectWs === undefined || (wid !== null && projectWs !== wid)) return denied(ERR_MISSING)   // 타 워크스페이스·미존재 — 존재 은닉
    return searchWbs(actor, pid, escaped)
  }
  if (params.scope !== 'workspace') return denied(ERR_MISSING)
  if (wid === null) return denied(ERR_WORKSPACE_REQUIRED)
  if (workspaceRoleIn(actor, wid) === null) return denied(ERR_MISSING)                                // 비소속 — 존재 은닉
  return searchProjects(actor, wid, escaped)
}

async function searchProjects(actor: Actor, workspaceId: string, pattern: string): Promise<GlobalSearchResponse> {
  const t = await serverTranslator()
  try {
    const supabase = await createServerClient()
    // 비공개를 거른 뒤에도 PROJECT_LIMIT 를 채우도록 넉넉히 읽는다
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, is_private')
      .eq('workspace_id', workspaceId)
      .ilike('name', `%${pattern}%`)
      .order('name')
      .limit(PROJECT_LIMIT * 5)
    if (error) {
      console.error('[searchTitles] projects 조회 실패:', error.message)
      return failed(t)
    }
    const rows = (data ?? []) as Array<{ id: string; name: string; is_private: boolean | null }>
    const projects = rows.filter((p) => canSeeProject(actor, p)).slice(0, PROJECT_LIMIT).map((p): SearchProjectItem => ({
      type: 'project',
      id: p.id,
      name: p.name,
      href: `/p/${encodeURIComponent(p.id)}/dashboard`,
    }))
    return { ok: true, projects, wbsItems: [] }
  } catch (e) {
    console.error('[searchTitles] projects 예외:', e instanceof Error ? e.message : e)
    return failed(t)
  }
}

async function searchWbs(actor: Actor, projectId: string, pattern: string): Promise<GlobalSearchResponse> {
  const t = await serverTranslator()
  try {
    const supabase = await createServerClient()
    // 선행 조회 — 비공개 판정. 실패하면 중단한다(막는다)
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, is_private')
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) {
      console.error('[searchTitles] 프로젝트 조회 실패:', projectError.message)
      return failed(t)
    }
    if (!project || !canSeeProject(actor, project as { id: string; is_private: boolean | null })) return denied(ERR_MISSING)

    const { data, error } = await supabase
      .from('wbs_items')
      .select('id, code, name, project_id')
      .eq('project_id', projectId)
      .or(`name.ilike.%${pattern}%,code.ilike.%${pattern}%`)
      .order('code')
      .limit(WBS_LIMIT)
    if (error) {
      console.error('[searchTitles] wbs_items 조회 실패:', error.message)
      return failed(t)
    }
    const rows = (data ?? []) as Array<{ id: string; code: string; name: string; project_id: string }>
    const wbsItems = rows.filter((w) => w.project_id === projectId).map((w): SearchWbsItem => ({
      type: 'wbs',
      id: w.id,
      code: w.code,
      title: w.name,
      projectId: w.project_id,
      href: wbsItemHref(w.project_id, w.id),
    }))
    return { ok: true, projects: [], wbsItems }
  } catch (e) {
    console.error('[searchTitles] wbs_items 예외:', e instanceof Error ? e.message : e)
    return failed(t)
  }
}
