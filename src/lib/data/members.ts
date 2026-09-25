import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { ROSTER_SELECT, mapRosterRows } from '@/lib/data/memberSelect'
import type { ProjectMember } from '@/lib/domain/types'

/**
 * 옛 이름 호환 — 정본은 `@/lib/data/memberSelect` 의 ROSTER_SELECT·mapRosterRows 다(select 와 매퍼는 한 몸).
 * 호출부 import 를 한 번에 바꾸지 않기 위해 재export 로 남긴다. 새 코드는 memberSelect 를 직접 쓴다.
 */
export { ROSTER_SELECT as PROJECT_MEMBER_SELECT, mapRosterRows as mapProjectMemberRows } from '@/lib/data/memberSelect'

// 같은 요청 내 중복 호출 dedupe
export const getProjectMembers = cache(async (projectId: string): Promise<ProjectMember[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members')
    .select(ROSTER_SELECT)
    .eq('project_id', projectId)
    // 정렬은 mapRosterRows 의 sortByKoreanName 이 담당한다. created_at 은 동명이인의
    // 순서를 고정하기 위한 tiebreak.
    // (DB collation 에 이름 정렬을 맡기지 않는다 — 인스턴스 collation 에 따라 가나다순이 깨진다.)
    .order('created_at', { ascending: true })

  // 실패를 삼키면 '멤버 0명'이 정상 상태와 구별되지 않는다(스키마 드리프트가 조용히 빈 화면이 된다).
  if (error) console.error('[getProjectMembers] 조회 실패:', error.message)

  return mapRosterRows(data)
})

/**
 * 로그인한 사람이 명단에 올라 있는(활성 행) 프로젝트 id 목록 — 회의록 프로젝트 자동 선택의 근거.
 *
 * 계정↔사람 연결의 정본은 `people.user_id` 다(0003). 예전의 이메일 폴백 조회는 두지 않는다 —
 * 이메일이 같다는 이유로 연결되지 않은 외부 인력 행을 '나'로 삼으면 안 된다.
 *
 * 실패는 null — 빈 배열('어느 프로젝트에도 속하지 않음')과 구분한다. 호출부(pickDefaultProjectId)는
 * 둘을 같은 폴백으로 처리하지만, 그건 그쪽의 판단이고 여기서 실패를 '소속 없음'으로 위장하지는 않는다.
 */
export const getMyProjectIds = cache(async (): Promise<string[] | null> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  const user = u.user
  if (!user) return null
  const { data, error } = await sb
    .from('project_members')
    .select('project_id, people!inner(user_id)')
    .eq('people.user_id', user.id)
    .eq('active', true)
  if (error) {
    console.error('[getMyProjectIds] 조회 실패:', error.message)
    return null
  }
  const ids = new Set<string>()
  for (const r of (data ?? []) as Array<{ project_id?: string }>) {
    if (r.project_id) ids.add(r.project_id)
  }
  return [...ids]
})
