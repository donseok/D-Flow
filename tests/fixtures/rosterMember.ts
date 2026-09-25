// 테스트 공용 명단 행 fixture — RosterMember(= ProjectMember) 모양이 바뀌면 이 파일만 고친다.
// 파생 필드는 호출자가 넘기지 않았을 때만 채운다 — 일부러 어긋난 행(예: userId 는 있는데 hasAccount=false)을
// 만드는 테스트가 조용히 교정된 객체를 받지 않게.
//   teams     ← team(대표 팀 code 줄임말, DTO 필드 아님)만 넘기면 그 code 를 대표 팀 하나로
//   userId    ← hasAccount 가 true 면 지어 채운다(계정 연결 정본은 userId)
//   hasAccount·kind ← userId
import type { RosterMember, RosterTeam } from '@/lib/data/memberSelect'

/** makeRosterMember 입력 — 명단 DTO 부분 + 대표 팀 하나를 code 로 주는 줄임말 team. */
export type RosterMemberOverrides = Partial<RosterMember> & { team?: string | null }

export function makeRosterMember({ team, ...over }: RosterMemberOverrides = {}): RosterMember {
  const id = over.id ?? 'm1'
  const teams: RosterTeam[] = over.teams
    ?? (team ? [{ id: `t-${team}`, code: team, name: team, isPrimary: true }] : [])
  const userId = over.userId !== undefined ? over.userId : over.hasAccount ? `u-${id}` : null
  return {
    id,
    projectId: 'p1',
    personId: `pe-${id}`,
    name: '홍길동',
    email: null,
    kind: userId ? 'account' : 'external',
    accessRole: null,
    roleLabel: null,
    title: null,
    active: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    userId,
    teams,
    hasAccount: userId != null,
    ...over,
  }
}
