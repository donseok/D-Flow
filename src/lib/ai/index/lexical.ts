import { CURRENT_INDEX_VERSION } from './content'
import type { FusionCandidate } from '@/lib/domain/searchFusion'
import type { SupabaseKnowledgeClient } from './pgvector'

/**
 * 어휘 다리 — match_ai_documents_lexical 어댑터(현재 시그니처는 0042).
 * 토큰을 OR 로 매칭해 다중 키워드 질의를 지원한다.
 * 벡터가 어휘 불일치를 풀고, 이쪽이 고유명사·ID·약어 같은 정확 검색을 맡는다.
 */
export type LexicalSearchResult =
  | { ok: true; candidates: FusionCandidate[] }
  | { ok: false; errorCode: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toFusionCandidate(row: Record<string, unknown>): FusionCandidate | null {
  const domain = str(row.domain)
  const entityType = str(row.entity_type)
  const entityId = str(row.entity_id)
  const href = str(row.href)
  if (!domain || !entityType || !entityId || !href) return null
  return {
    domain,
    entityType,
    entityId,
    projectId: str(row.project_id),
    chunkNo: typeof row.chunk_no === 'number' ? row.chunk_no : 0,
    title: str(row.title) ?? '',
    content: str(row.content) ?? '',
    href,
    occurredOn: str(row.occurred_on),
  }
}

export function createLexicalSearch(client: SupabaseKnowledgeClient) {
  return async (input: {
    /** 서버가 확정한 워크스페이스(0042 — RPC 의 p_workspace_id 필수). 요청이 보낸 값을 그대로 넣지 않는다. */
    workspaceId: string
    tokens: string[]
    projectIds: string[]
    /** 그 워크스페이스의 프로젝트 없는(전역) 문서도 포함한다. 기본은 제외. */
    includeGlobal?: boolean
    limit: number
  }): Promise<LexicalSearchResult> => {
    // 워크스페이스를 모르면 검색하지 않는다 — 빈 결과가 아니라 실패다(에러 처리 3원칙).
    if (typeof input.workspaceId !== 'string' || !UUID_RE.test(input.workspaceId)) {
      console.error('[search] 어휘 검색 범위 미확정 — 워크스페이스 없음')
      return { ok: false, errorCode: 'SEARCH_SCOPE_UNAVAILABLE' }
    }
    const includeGlobal = input.includeGlobal === true
    // 빈 스코프 또는 토큰 없음 — RPC 를 부르지 않는다.
    if (!input.tokens.length || (input.projectIds.length === 0 && !includeGlobal)) return { ok: true, candidates: [] }

    const { data, error } = await client.rpc('match_ai_documents_lexical', {
      p_tokens: input.tokens,
      match_count: Math.max(1, Math.min(Math.floor(input.limit), 100)),
      p_workspace_id: input.workspaceId,
      p_project_ids: input.projectIds,
      p_include_global: includeGlobal,
      p_domains: null,
      p_entity_types: null,
      p_index_version: CURRENT_INDEX_VERSION,
    })

    // 조회 실패를 "결과 없음" 으로 위장하지 않는다(에러 처리 3원칙).
    if (error) {
      console.error('[search] 어휘 검색 실패:', error)
      return { ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' }
    }

    const rows = Array.isArray(data) ? data as Row[] : []
    return { ok: true, candidates: rows.flatMap(row => {
      const candidate = toFusionCandidate(row)
      return candidate ? [candidate] : []
    }) }
  }
}
