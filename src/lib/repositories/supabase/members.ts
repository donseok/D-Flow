import { ROSTER_SELECT_NO_EMAIL, mapRosterRows } from '@/lib/data/memberSelect'
import {
  repositoryError,
  repositoryOk,
  type MemberRepository,
  type MemberRepositoryRecord,
} from '@/lib/repositories/types'
import { isRetryableReadError, type SupabaseServerClient } from './common'

// email은 select 절 자체에서 제외한다(ROSTER_SELECT_NO_EMAIL) — 챗봇 계약(MemberRepositoryRecord)에 이메일이 존재하지 않는다.
// user_id는 hasAccount 판정에만 쓰고 원시값을 반환 계약 밖으로 내보내지 않는다.
export function createSupabaseMemberRepository(client: SupabaseServerClient): MemberRepository {
  return {
    async listMembers(projectId) {
      const result = await client
        .from('project_members')
        .select(ROSTER_SELECT_NO_EMAIL)
        .eq('project_id', projectId)
        // 이름 정렬은 mapRosterRows(sortByKoreanName)가 한다(DB collation 은 가나다순을 보장하지 않는다).
        // created_at 은 동명이인 순서를 고정하는 tiebreak 로만 남긴다.
        .order('created_at', { ascending: true })

      if (result.error) {
        return repositoryError('MEMBERS_READ_FAILED', isRetryableReadError(result.error))
      }

      // 챗봇이 읽어주는 멤버 명단도 화면과 같은 가나다순이어야 한다.
      // 계약 필드를 하나씩 옮긴다 — RosterMember 를 펼치면 userId(auth uuid)가 계약 밖으로 샌다.
      const records: MemberRepositoryRecord[] = mapRosterRows(result.data as unknown[] | null).map(m => ({
        id: m.id,
        projectId: m.projectId,
        name: m.name,
        teamCode: m.teamCode,
        accessRole: m.accessRole,
        title: m.title,
        hasAccount: m.hasAccount,
        createdAt: m.createdAt,
      }))
      return repositoryOk(records)
    },
  }
}
