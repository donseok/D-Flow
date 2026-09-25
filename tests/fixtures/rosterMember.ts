// 테스트 공용 명단 행 fixture — RosterMember(= ProjectMember) 모양이 바뀌면 이 파일만 고친다.
// teamCode 만 넘기면 그 code 를 대표 팀 하나로 가진 teams 배열을 만든다(매퍼의 teams[0]?.code 규칙과 같다).
// hasAccount 만 넘기면 userId 를 지어 채운다 — 계정 연결 여부는 userId 가 정본이다.
import type { RosterMember, RosterTeam } from '@/lib/data/memberSelect'

export function makeRosterMember(over: Partial<RosterMember> = {}): RosterMember {
  const id = over.id ?? 'm1'
  const teams: RosterTeam[] = over.teams
    ?? (over.teamCode ? [{ id: `t-${over.teamCode}`, code: over.teamCode, name: over.teamCode, isPrimary: true }] : [])
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
    ...over,
    userId,
    teams,
    teamCode: teams[0]?.code ?? null,
    hasAccount: userId != null,
  }
}
