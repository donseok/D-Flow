// 계정 목록(profiles) 전량 수집 — 계정 관리 화면용. 'use server' 파일이 아니어서
// 클라이언트에서 직접 부를 수 없다(액션이 게이트를 통과한 뒤에만 호출).
// auth.users(GoTrue listUsers) 대신 앱 소유 표 profiles 를 읽는다(0003) — 이름·이메일의 정본이 여기 있다.
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ProfileRow {
  userId: string
  email: string
  displayName: string
  createdAt: string
}

/** PostgREST 기본 max_rows(1000) 이하로 끊어 읽는다 — 한 번에 읽으면 잘린 목록이 완전한 목록처럼 보인다. */
const PAGE = 500

/**
 * profiles 전체(페이지네이션). 실패는 throw — 잘린 목록을 완전한 목록처럼 돌려주면
 * 누락 계정이 '존재하지 않음'과 구별되지 않는다(권한 화면에서는 그것이 곧 오정보다).
 */
export async function listProfiles(admin: AdminClient): Promise<ProfileRow[]> {
  const out: ProfileRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('profiles').select('user_id, email, display_name, created_at')
      .order('created_at').order('user_id')
      .range(from, from + PAGE - 1)
    if (error || !data) {
      throw new Error(`계정 목록을 불러오지 못했습니다(from=${from}): ${error?.message ?? 'unknown'}`)
    }
    for (const r of data as Array<{ user_id: string; email: string; display_name: string; created_at: string }>) {
      out.push({ userId: r.user_id, email: r.email, displayName: r.display_name, createdAt: r.created_at })
    }
    if (data.length < PAGE) break
  }
  return out
}
