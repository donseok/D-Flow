'use server'

import { createServerClient } from '@/lib/supabase/server'
import { wbsItemHref } from '@/lib/ai/chat/deep-links'
import { getActor } from '@/lib/authz'
import { ERR_DENIED } from '@/lib/authz/errors'

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

export interface GlobalSearchResponse {
  ok: boolean
  error?: string
  projects: SearchProjectItem[]
  wbsItems: SearchWbsItem[]
}

/**
 * 전역 ⌘K 제목 검색 액션 (개정 §5.3.7, UX-04, SPU2)
 * - RLS 및 세션 클라이언트를 통해 권한 있는 프로젝트와 WBS 항목만 검색.
 * - 본문이 아닌 "제목 검색" 전용 (프로젝트명, WBS 코드/이름).
 * - 미색인·실패·0건 명확한 결과 반환.
 */
export async function searchTitles(params?: {
  workspaceId: string
  query: string
  scope: 'workspace' | 'project'
  projectId?: string | null
}): Promise<GlobalSearchResponse> {
  const actor = await getActor()
  if (!actor) {
    return { ok: false, error: ERR_DENIED, projects: [], wbsItems: [] }
  }

  const q = params?.query?.trim() ?? ''
  if (!params || !q) {
    return { ok: true, projects: [], wbsItems: [] }
  }

  // 특수문자 제거하여 안전한 ilike 패턴 생성
  const escaped = q.replace(/[%_,()]/g, '')
  if (!escaped) {
    return { ok: true, projects: [], wbsItems: [] }
  }

  try {
    const supabase = await createServerClient()

    let projects: SearchProjectItem[] = []
    // 1. 프로젝트 검색: 워크스페이스 스코프일 때만
    if (params.scope === 'workspace') {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('workspace_id', params.workspaceId)
        .ilike('name', `%${escaped}%`)
        .limit(10)

      if (error) {
        console.error('[searchTitles] projects query error:', error)
      } else if (data) {
        projects = data.map((p) => ({
          type: 'project',
          id: p.id,
          name: p.name,
          href: `/p/${encodeURIComponent(p.id)}/dashboard`,
        }))
      }
    }

    // 2. WBS 항목 검색
    let wbsItems: SearchWbsItem[] = []
    let wbsQuery = supabase
      .from('wbs_items')
      .select('id, code, name, project_id')

    if (params.scope === 'project' && params.projectId) {
      wbsQuery = wbsQuery.eq('project_id', params.projectId)
    }

    wbsQuery = wbsQuery
      .or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`)
      .limit(20)

    const { data: wbsData, error: wbsError } = await wbsQuery
    if (wbsError) {
      console.error('[searchTitles] wbs_items query error:', wbsError)
      return {
        ok: false,
        error: 'WBS 항목 검색 중 오류가 발생했습니다.',
        projects,
        wbsItems: [],
      }
    }

    if (wbsData) {
      wbsItems = wbsData.map((w) => ({
        type: 'wbs',
        id: w.id,
        code: w.code,
        title: w.name,
        projectId: w.project_id,
        href: wbsItemHref(w.project_id, w.id),
      }))
    }

    return {
      ok: true,
      projects,
      wbsItems,
    }
  } catch (err) {
    console.error('[searchTitles] exception:', err)
    return {
      ok: false,
      error: '검색 서비스를 이용할 수 없습니다.',
      projects: [],
      wbsItems: [],
    }
  }
}
