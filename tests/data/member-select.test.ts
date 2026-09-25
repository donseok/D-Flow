import { describe, it, expect } from 'vitest'
import { mapRosterRows, toRosterMember } from '@/lib/data/memberSelect'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1', project_id: 'p1', person_id: 'pe1', access_role: 'member', role_label: 'PM', title: null,
  active: true, sort_order: 0, created_at: '2026-09-24T00:00:00Z',
  people: { display_name: '홍길동', email: 'alice@example.com', user_id: 'u1', kind: 'account', active: true },
  project_member_teams: [
    { team_id: 't2', is_primary: false, teams: { id: 't2', code: 'MES', name: 'MES' } },
    { team_id: 't1', is_primary: true, teams: { id: 't1', code: 'ERP', name: 'ERP' } },
  ],
  ...over,
})
describe('toRosterMember', () => {
  it('people 조인과 팀 배열(대표 팀 우선)을 편다', () => {
    const m = toRosterMember(row())
    expect(m.name).toBe('홍길동'); expect(m.kind).toBe('account'); expect(m.hasAccount).toBe(true)
    expect(m.teams.map(t => t.code)).toEqual(['ERP', 'MES']); expect(m.teams[0].isPrimary).toBe(true)
    expect(m.accessRole).toBe('member')
  })
  it('외부 인력은 userId null·kind external·팀 없음', () => {
    const m = toRosterMember(row({ access_role: null, people: { display_name: '박외주', email: null, user_id: null, kind: 'external', active: true }, project_member_teams: [] }))
    expect(m.kind).toBe('external'); expect(m.hasAccount).toBe(false); expect(m.teams).toEqual([]); expect(m.accessRole).toBe(null)
  })
  it('mapRosterRows 는 가나다순', () => {
    const out = mapRosterRows([row({ id: 'b', people: { display_name: '나', email: null, user_id: null, kind: 'external', active: true } }), row({ id: 'a', people: { display_name: '가', email: null, user_id: null, kind: 'external', active: true } })])
    expect(out.map(m => m.id)).toEqual(['a', 'b'])
  })
})

describe('ROSTER_SELECT_NO_EMAIL·personOf', () => {
  it('챗봇 경계용 select 는 ROSTER_SELECT 에서 people.email 만 뺀 모양이다', async () => {
    const { ROSTER_SELECT, ROSTER_SELECT_NO_EMAIL } = await import('@/lib/data/memberSelect')
    expect(ROSTER_SELECT).toBe(
      'id, project_id, person_id, access_role, role_label, title, active, sort_order, created_at, ' +
      'people!inner(display_name, email, user_id, kind, active), ' +
      'project_member_teams(team_id, is_primary, teams(id, code, name))',
    )
    expect(ROSTER_SELECT_NO_EMAIL).not.toContain('email')
    expect(ROSTER_SELECT_NO_EMAIL).toBe(ROSTER_SELECT.replace('display_name, email, ', 'display_name, '))
  })
  it('이메일 없이 읽은 행은 email=null 로 편다', () => {
    const m = toRosterMember(row({ people: { display_name: '홍길동', user_id: 'u1', kind: 'account', active: true } }))
    expect(m.email).toBe(null); expect(m.userId).toBe('u1')
  })
  it('personOf 는 객체·배열 임베드를 같게 펴고 없으면 null', async () => {
    const { personOf } = await import('@/lib/data/memberSelect')
    expect(personOf({ people: { user_id: 'u1' } })).toEqual({ user_id: 'u1' })
    expect(personOf({ people: [{ user_id: 'u2' }] })).toEqual({ user_id: 'u2' })
    expect(personOf({ people: null })).toBe(null)
    expect(personOf({ id: 'm1' })).toBe(null)
  })
  it('people 이 없는 행은 조용히 빈 이름을 만들지 않고 던진다', () => {
    expect(() => toRosterMember(row({ people: null }))).toThrow(/people/)
  })
})

describe('primaryTeamCode', () => {
  it('대표 팀 code 를 먼저, 없으면 code 순 첫째, 팀이 없으면 null', async () => {
    const { primaryTeamCode } = await import('@/lib/data/memberSelect')
    expect(primaryTeamCode([
      { is_primary: false, teams: { code: 'MES' } },
      { is_primary: true, teams: [{ code: 'QA' }] },
    ])).toBe('QA')
    expect(primaryTeamCode([
      { is_primary: false, teams: { code: 'MES' } },
      { is_primary: false, teams: { code: 'ERP' } },
    ])).toBe('ERP')
    expect(primaryTeamCode([])).toBe(null)
    expect(primaryTeamCode(null)).toBe(null)
    expect(primaryTeamCode([{ is_primary: true, teams: null }])).toBe(null)
  })
})
