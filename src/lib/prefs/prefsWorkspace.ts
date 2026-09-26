import type { SupabaseClient } from '@supabase/supabase-js'

/** 선호값(user_preferences)의 워크스페이스 키 — 가장 먼저 가입한 소속. 0006 백필과 같은 규칙이라 기존 행을 그대로 찾는다.
 *  선호값은 보안 경계가 아니다(스펙 §2.3). 전환 UI 는 SP3 — 그때 이 함수가 "현재 워크스페이스" 로 바뀐다. */
export async function prefsWorkspaceId(db: Pick<SupabaseClient, 'from'>, userId: string): Promise<string | null> {
  const { data, error } = await db.from('workspace_members').select('workspace_id')
    .eq('user_id', userId).order('created_at', { ascending: true }).order('workspace_id', { ascending: true })
    .limit(1).maybeSingle()
  if (error) throw new Error('선호값 워크스페이스 조회 실패: ' + error.message)
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null
}
