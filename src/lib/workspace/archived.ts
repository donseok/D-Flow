/**
 * 보관된 워크스페이스(0056) id 집합 — service_role 클라이언트로 도는 순회(크론·워커의 후보 고르기)가 건너뛸 대상을 정할 때 쓴다.
 * 세션 경로의 판정이 아니다: 세션은 RLS 와 권한 스냅샷(buildActor)이 보관을 "없음"으로 만든다. 세션 클라이언트로 부르면 RLS 가 보관된 행을
 * 가려 늘 빈 집합이다(그래서 admin 클라이언트 전용).
 * 조회 실패는 throw — "보관된 워크스페이스 없음"으로 읽으면 건너뛰어야 할 순회가 그대로 돈다(호출부가 그 실행을 멈춘다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from '@/lib/data/paging'

export async function archivedWorkspaceIds(admin: Pick<SupabaseClient, 'from'>): Promise<Set<string>> {
  const rows = await fetchAllPages<{ id: string }>('보관된 워크스페이스', (from, to) =>
    admin.from('workspaces').select('id', { count: 'exact' }).not('archived_at', 'is', null).order('id').range(from, to))
  return new Set(rows.map((w) => w.id))
}
