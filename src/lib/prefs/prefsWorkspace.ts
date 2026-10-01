import type { SupabaseClient } from '@supabase/supabase-js'

/** 현재 워크스페이스를 모를 때의 폴백(첫 소속 — created_at → workspace_id, 0006 백필·0013 이행과 같은 규칙).
 *  소비처는 src/lib/workspace/current.ts 와 이 계획 이전의 경로뿐이다 — 개인 설정 저장은 더 이상 이 함수로 행을 고르지 않는다(SP3b D9). */
export async function prefsWorkspaceId(db: Pick<SupabaseClient, 'from'>, userId: string): Promise<string | null> {
  const { data, error } = await db.from('workspace_members').select('workspace_id')
    .eq('user_id', userId).order('created_at', { ascending: true }).order('workspace_id', { ascending: true })
    .limit(1).maybeSingle()
  if (error) throw new Error('선호값 워크스페이스 조회 실패: ' + error.message)
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null
}
