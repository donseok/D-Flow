import { describe, expect, it } from 'vitest'
import { generateCredentialToken } from '@/lib/agent/token'
import { isCredentialFormat, parseCredentialPrefix } from '@/lib/domain/agentToken'
import { credentialAllows, narrowActor, resolveCredentialTeam } from '@/lib/authz/credentials'
import { roleIn, type Actor } from '@/lib/domain/authz'

describe('generateCredentialToken & format', () => {
  it('agent_runner 는 dflow_pat_ 형식으로 발급된다', () => {
    const { token, prefix, hash } = generateCredentialToken('agent_runner')
    expect(token).toMatch(/^dflow_pat_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/)
    expect(isCredentialFormat(token, 'agent_runner')).toBe(true)
    expect(isCredentialFormat(token, 'minutes_api')).toBe(false)
    expect(parseCredentialPrefix(token, 'agent_runner')).toBe(prefix)
    expect(hash).toHaveLength(64)
  })

  it('minutes_api 는 dflow_int_ 형식으로 발급된다', () => {
    const { token, prefix, hash } = generateCredentialToken('minutes_api')
    expect(token).toMatch(/^dflow_int_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/)
    expect(isCredentialFormat(token, 'minutes_api')).toBe(true)
    expect(isCredentialFormat(token, 'agent_runner')).toBe(false)
    expect(parseCredentialPrefix(token, 'minutes_api')).toBe(prefix)
    expect(hash).toHaveLength(64)
  })

  it('잘못된 유형으로 PAT를 발급하거나 태그를 교차 인증하지 않는다', () => {
    expect(() => generateCredentialToken('unknown' as 'agent_runner')).toThrow('자격증명 유형')
    expect(parseCredentialPrefix('dflow_int_ABCDEFGHIJKL_' + 'a'.repeat(43), 'agent_runner')).toBeNull()
    expect(parseCredentialPrefix('dflow_pat_ABCDEFGHIJKL_' + 'a'.repeat(43), 'minutes_api')).toBeNull()
    expect(parseCredentialPrefix('dflow_pat_ABCDEFGHIJKL_' + 'a'.repeat(43), 'unknown' as 'agent_runner')).toBeNull()
  })
})

describe('credentialAllows', () => {
  it('projectIds 가 null 이면 모든 프로젝트 허용', () => {
    expect(credentialAllows({ projectIds: null }, 'p1')).toBe(true)
    expect(credentialAllows({ projectIds: null }, 'p2')).toBe(true)
  })

  it('projectIds 가 배열이면 포함 여부만 판정', () => {
    expect(credentialAllows({ projectIds: ['p1', 'p2'] }, 'p1')).toBe(true)
    expect(credentialAllows({ projectIds: ['p1', 'p2'] }, 'p3')).toBe(false)
  })

  it('빈 배열은 모든 프로젝트 거절이며 null과 다르다', () => {
    expect(credentialAllows({ projectIds: [] }, 'p1')).toBe(false)
  })
})

describe('resolveCredentialTeam', () => {
  const teams = [
    { id: 't1', code: 'DEV', active: true },
    { id: 't2', code: 'OPS', active: true },
    { id: 't3', code: 'OLD', active: false },
  ]

  it('① teamMap 에 매핑된 팀이 우선한다', () => {
    const cred = { teamMap: { '개발팀': 't1', '운영팀': 't2' }, defaultTeamId: null }
    expect(resolveCredentialTeam(cred, '개발팀', teams)).toEqual({ ok: true, teamId: 't1' })
    expect(resolveCredentialTeam(cred, '운영팀', teams)).toEqual({ ok: true, teamId: 't2' })
  })

  it('teamMap 매핑 팀이 비활성이면 inactive 반환', () => {
    const cred = { teamMap: { '구개발': 't3' }, defaultTeamId: null }
    expect(resolveCredentialTeam(cred, '구개발', teams)).toEqual({ ok: false, reason: 'inactive' })
  })

  it('② teamMap 에 없으면 코드 일치로 판정', () => {
    const cred = { teamMap: {}, defaultTeamId: null }
    expect(resolveCredentialTeam(cred, 'DEV', teams)).toEqual({ ok: true, teamId: 't1' })
    expect(resolveCredentialTeam(cred, 'OPS', teams)).toEqual({ ok: true, teamId: 't2' })
  })

  it('코드 일치 팀이 비활성이면 inactive 반환', () => {
    const cred = { teamMap: {}, defaultTeamId: null }
    expect(resolveCredentialTeam(cred, 'OLD', teams)).toEqual({ ok: false, reason: 'inactive' })
  })

  it('③ 코드 일치도 없으면 defaultTeamId 로 폴백', () => {
    const cred = { teamMap: {}, defaultTeamId: 't2' }
    expect(resolveCredentialTeam(cred, '알수없는팀', teams)).toEqual({ ok: true, teamId: 't2' })
  })

  it('defaultTeamId 도 없거나 셋 다 일치하지 않으면 not_found 반환', () => {
    const cred = { teamMap: {}, defaultTeamId: null }
    expect(resolveCredentialTeam(cred, 'UNKNOWN', teams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('명시된 매핑이 삭제·범위 밖 팀이면 코드/기본 팀으로 조용히 귀속하지 않는다', () => {
    const cred = { teamMap: { DEV: 'missing' }, defaultTeamId: 't2' }
    expect(resolveCredentialTeam(cred, 'DEV', teams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('상속된 객체 속성은 팀 매핑이 아니다', () => {
    const teamMap = Object.create({ DEV: 't2' }) as Record<string, string>
    expect(resolveCredentialTeam({ teamMap, defaultTeamId: null }, 'DEV', teams))
      .toEqual({ ok: true, teamId: 't1' })
    expect(resolveCredentialTeam({ teamMap: {}, defaultTeamId: null }, 'constructor', teams))
      .toEqual({ ok: false, reason: 'not_found' })
  })

  it('비활성 기본 팀과 모호한 코드 일치는 거절한다', () => {
    expect(resolveCredentialTeam({ teamMap: {}, defaultTeamId: 't3' }, 'UNKNOWN', teams))
      .toEqual({ ok: false, reason: 'inactive' })
    expect(resolveCredentialTeam({ teamMap: {}, defaultTeamId: 't2' }, 'DEV', [...teams, { id: 't4', code: 'DEV', active: true }]))
      .toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('narrowActor', () => {
  const baseActor: Actor = {
    userId: 'u1',
    isSuperuser: true, // 플랫폼 관리자라도
    workspaceRoles: new Map([['w1', 'admin'], ['w2', 'member']]),
    projectWorkspace: new Map([['p1', 'w1'], ['p2', 'w1'], ['p3', 'w2']]),
    projectRoles: new Map([['p1', 'admin'], ['p2', 'member'], ['p3', 'member']]),
    memberIds: new Map([['p1', 'm1'], ['p2', 'm2'], ['p3', 'm3']]),
    rosterTeams: new Map([
      ['p1', { teamIds: ['t1'], teamCodes: ['DEV'] }],
      ['p2', { teamIds: ['t2'], teamCodes: ['OPS'] }],
      ['p3', { teamIds: ['t3'], teamCodes: ['QA'] }],
    ]),
  }

  it('isSuperuser 는 항상 false 로 강제되며 타 워크스페이스 프로젝트는 제거된다', () => {
    const cred = { workspaceId: 'w1', projectIds: null }
    const narrowed = narrowActor(baseActor, cred)

    expect(narrowed.isSuperuser).toBe(false)
    expect([...narrowed.workspaceRoles.keys()]).toEqual(['w1'])
    expect(narrowed.workspaceRoles.get('w1')).toBe('admin')

    expect([...narrowed.projectWorkspace.keys()]).toEqual(['p1', 'p2'])
    expect([...narrowed.projectRoles.keys()]).toEqual(['p1', 'p2'])
    expect([...narrowed.memberIds.keys()]).toEqual(['p1', 'p2'])
    expect([...narrowed.rosterTeams.keys()]).toEqual(['p1', 'p2'])
  })

  it('projectIds 가 지정되면 같은 워크스페이스라도 그 프로젝트로만 한정된다', () => {
    const cred = { workspaceId: 'w1', projectIds: ['p2'] }
    const narrowed = narrowActor(baseActor, cred)

    expect([...narrowed.projectWorkspace.keys()]).toEqual(['p2'])
    expect([...narrowed.projectRoles.keys()]).toEqual(['p2'])
    expect(narrowed.projectRoles.get('p2')).toBe('member')
    expect([...narrowed.memberIds.keys()]).toEqual(['p2'])
  })

  it('워크스페이스 소속 회수 뒤 남은 명단도 플랫폼 관리자 PAT에 권한을 주지 않는다', () => {
    const actor = { ...baseActor, workspaceRoles: new Map() }
    const narrowed = narrowActor(actor, { workspaceId: 'w1', projectIds: null })
    expect(narrowed.isSuperuser).toBe(false)
    expect([...narrowed.projectRoles]).toEqual([])
    expect([...narrowed.memberIds]).toEqual([])
    expect([...narrowed.rosterTeams]).toEqual([])
    expect(roleIn(narrowed, 'p1')).toBeNull()
  })

  it('기존 roleIn 판정은 현재 역할과 토큰 범위의 교집합이다', () => {
    const actor: Actor = { ...baseActor, workspaceRoles: new Map([['w1', 'member']]) }
    const narrowed = narrowActor(actor, { workspaceId: 'w1', projectIds: ['p2', 'p3'] })
    expect(roleIn(narrowed, 'p1')).toBeNull() // 같은 WS여도 토큰 범위 밖
    expect(roleIn(narrowed, 'p2')).toBe('member') // 플랫폼 관리자 승격 없음
    expect(roleIn(narrowed, 'p3')).toBeNull() // 범위에 적혀도 다른 WS
    expect(roleIn(narrowActor({ ...actor, projectRoles: new Map() }, { workspaceId: 'w1', projectIds: ['p2'] }), 'p2'))
      .toBe('viewer') // 현재 명단 권한 회수
  })

  it('빈 프로젝트 범위는 모두 닫히며 원본 Actor를 변경하지 않는다', () => {
    const narrowed = narrowActor(baseActor, { workspaceId: 'w1', projectIds: [] })
    expect([...narrowed.projectWorkspace]).toEqual([])
    expect(roleIn(narrowed, 'p1')).toBeNull()
    expect(baseActor.isSuperuser).toBe(true)
    expect([...baseActor.projectWorkspace.keys()]).toEqual(['p1', 'p2', 'p3'])
    expect([...baseActor.workspaceRoles.keys()]).toEqual(['w1', 'w2'])
  })
})
