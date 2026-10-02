import { embedTexts } from './embeddings'
import { hasEmbeddings } from './provider'
import { isSchemaMissing } from './health'
import { passesSimilarity } from './similarity'
import { createServerClient } from '@/lib/supabase/server'

export interface Match {
  kind: string
  refId: string | null
  content: string
  similarity: number
  projectId: string
}

interface RawMatch {
  id: string
  project_id: string
  kind: string
  ref_id: string | null
  content: string
  similarity: number
}

/** 프로젝트 없는 검색은 거른 뒤 k 개를 남기려고 넉넉히 받는다 — 범위 밖 청크가 상위를 차지해 근거가 0 이 되지 않게 */
const CROSS_PROJECT_OVERFETCH = 4
const CROSS_PROJECT_MAX = 48

/**
 * 질문을 임베딩해 pgvector 의미검색(match_wbs_documents)으로 관련 문서 top-K 회수.
 * scope 가 문자열이면 그 프로젝트, `{ projectIds }` 면 그 집합 안의 프로젝트(옛 챗의 프로젝트 없는 질문 — 그 워크스페이스·볼 수 있는·chatbot 켜진
 * 프로젝트, CC2). 집합 거르기는 RPC 결과를 버리는 방식이다 — RPC 는 SECURITY INVOKER 라 RLS(워크스페이스 소속)만 거치고 비공개 명단은
 * 보지 않는다. 범위 없는 전사 검색 갈래는 없다. 임베딩 키 없음/오류 시 빈 배열(=구조화 답변만 사용).
 *
 * 읽기는 사용자 세션(RLS) 클라이언트로 수행한다 — service_role 로 RLS 를 우회하지 않으므로,
 * wbs_embeddings 의 행 수준 정책이 그대로 적용된다(앱의 read-all 정책과 일관, 향후 정책 강화 시 자동 반영).
 */
export async function retrieveContext(query: string, scope: string | { projectIds: ReadonlySet<string> }, k = 8): Promise<Match[]> {
  if (!hasEmbeddings()) return []
  const projectId = typeof scope === 'string' ? scope : null
  const allowed = typeof scope === 'string' ? null : scope.projectIds
  if (allowed && allowed.size === 0) return []
  const vecs = await embedTexts([query], 'RETRIEVAL_QUERY')
  if (!vecs || !vecs[0]?.length) return []

  // 의미검색은 부가 기능 — 어떤 실패(세션 없음, 마이그레이션 미적용, RPC 오류)든
  // 빈 배열로 강등해 결정형 답변 경로가 끊기지 않게 한다(/api/chat 가 500 나지 않도록).
  try {
    const sb = await createServerClient()
    const { data, error } = await sb.rpc('match_wbs_documents', {
      query_embedding: vecs[0],
      match_count: allowed ? Math.min(k * CROSS_PROJECT_OVERFETCH, CROSS_PROJECT_MAX) : k,
      p_project_id: projectId,
      p_kinds: null,
    })
    if (error) {
      if (isSchemaMissing(error)) {
        console.error(
          '[assistant] 의미검색 비활성: pgvector 마이그레이션(0010)이 적용되지 않은 것으로 보입니다. →',
          error.message,
        )
      } else {
        console.error('[assistant] match_wbs_documents 실패:', error.message)
      }
      return []
    }
    return ((data as RawMatch[] | null) ?? [])
      .filter(m => passesSimilarity(m.similarity)) // 약한 매칭은 근거에서 제외(임계값 해석은 similarity.ts 단일 출처)
      .filter(m => !allowed || allowed.has(m.project_id)) // 범위 밖(다른 워크스페이스·chatbot 꺼짐·명단 밖 비공개) 청크는 버린다
      .slice(0, k)
      .map(m => ({
        kind: m.kind,
        refId: m.ref_id,
        content: m.content,
        similarity: m.similarity,
        projectId: m.project_id,
      }))
  } catch (e) {
    console.error('[assistant] 의미검색 사용 불가(세션/연결 문제) → 결정형 답변으로 폴백:', e instanceof Error ? e.message : e)
    return []
  }
}
