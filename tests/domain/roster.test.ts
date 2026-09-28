import { describe, it, expect } from 'vitest'
import {
  draftFromMember, emptyDraft, validateDraft, canGrantAdmin, accessRoleLabel,
  toggleTeam, setPrimaryTeam, findRosterByEmail, isDraftDirty, ERR_ACCESS_NEEDS_EMAIL, ERR_DUPLICATE_EMAIL,
} from '@/lib/domain/roster'
import type { RosterMember } from '@/lib/data/memberSelect'
import { makeProjectActorView } from '../fixtures/actor'

function member(over: Partial<RosterMember> = {}): RosterMember {
  return {
    id: 'm-1', projectId: 'p-1', personId: 'pe-1',
    name: 'alice', email: 'alice@example.com', userId: 'u-alice', kind: 'account',
    accessRole: 'member', roleLabel: '개발', title: '책임', active: true, sortOrder: 0, createdAt: '2026-09-01T00:00:00Z',
    teams: [
      { id: 't-erp', code: 'ERP', name: 'ERP', isPrimary: true },
      { id: 't-mes', code: 'MES', name: 'MES', isPrimary: false },
    ],
    hasAccount: true,
    ...over,
  }
}

describe('draftFromMember', () => {
  it('명단 행을 편집 초안으로 편다 — 팀은 대표 팀이 첫 원소', () => {
    expect(draftFromMember(member())).toEqual({
      personId: 'pe-1', name: 'alice', email: 'alice@example.com', accessRole: 'member',
      roleLabel: '개발', title: '책임', teamIds: ['t-erp', 't-mes'], active: true,
    })
  })
  it('null 필드는 빈 문자열 입력값이 된다', () => {
    const d = draftFromMember(member({ email: null, roleLabel: null, title: null, teams: [], accessRole: null }))
    expect(d).toMatchObject({ email: '', roleLabel: '', title: '', teamIds: [], accessRole: null })
  })
})

describe('validateDraft', () => {
  const base = { ...emptyDraft(), name: 'bob' }

  it('이름이 공백이면 거부', () => {
    expect(validateDraft({ ...base, name: '   ' })).toEqual({ ok: false, error: '이름을 입력하세요.' })
  })
  it('이메일 형식이 틀리면 거부', () => {
    expect(validateDraft({ ...base, email: 'not-an-email' })).toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
  })
  it('권한이 있는데 이메일이 없으면 거부', () => {
    expect(validateDraft({ ...base, accessRole: 'member', email: ' ' })).toEqual({ ok: false, error: ERR_ACCESS_NEEDS_EMAIL })
    expect(ERR_ACCESS_NEEDS_EMAIL).toBe('권한을 주려면 이메일(계정)이 필요합니다.')
  })
  it('외부 인력 — 이름만으로 통과하고 빈 입력은 null 로 정규화한다', () => {
    expect(validateDraft({ ...base, name: '  bob ' })).toEqual({
      ok: true,
      input: { personId: null, name: 'bob', email: null, accessRole: null, roleLabel: null, title: null, teamIds: [], active: true },
    })
  })
  it('이메일은 소문자·trim, 라벨·직함은 trim', () => {
    const r = validateDraft({ ...base, email: ' Alice@Example.COM ', roleLabel: ' 개발 ', title: ' 책임 ', accessRole: 'admin' })
    expect(r).toMatchObject({ ok: true, input: { email: 'alice@example.com', roleLabel: '개발', title: '책임', accessRole: 'admin' } })
  })
  it('대표 팀 = teamIds[0] — 순서를 보존하고 중복을 뺀다', () => {
    const r = validateDraft({ ...base, teamIds: ['t-mes', 't-erp', 't-mes'] })
    expect(r.ok && r.input.teamIds).toEqual(['t-mes', 't-erp'])
  })
  it('기존 인물은 personId 와 활성 여부를 그대로 싣는다', () => {
    const r = validateDraft({ ...draftFromMember(member()), active: false })
    expect(r).toMatchObject({ ok: true, input: { personId: 'pe-1', active: false } })
  })
})

describe('명단 편집은 이메일을 다시 검증하지 않는다(R2)', () => {
  // 이메일 칸은 편집에서 읽기 전용이고 id 분기의 RPC 는 email 을 쓰지 않는다 — 정규형이 안 되는 기존 행도 이름·권한·팀을 고칠 수 있어야 한다
  it.each(['x@acme.123', 'x@corp_intra.com', 'admin@10.0.0.5'])('기존 이메일 %s 인 행을 편집하면 ok', (email) => {
    const r = validateDraft({ ...draftFromMember(member({ email })), name: '새 이름', title: '수석' })
    expect(r.ok).toBe(true)
  })
  it('새 인물 추가(personId 없음)는 여전히 검증한다', () => {
    expect(validateDraft({ ...emptyDraft(), name: 'x', email: 'x@acme.123' })).toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
  })
  it('편집이어도 권한을 주려면 이메일이 있어야 한다', () => {
    expect(validateDraft({ ...draftFromMember(member({ email: null })), accessRole: 'member' })).toEqual({ ok: false, error: ERR_ACCESS_NEEDS_EMAIL })
  })
})

describe('명단 이메일 계약(R3)', () => {
  it('findRosterByEmail 은 행 쪽도 정규화한다 — 유니코드로 저장된 옛 행을 퓨니코드 입력으로 찾는다(MP10)', () => {
    const row = member({ email: 'kim@한글.kr' })
    expect(findRosterByEmail([row], 'kim@xn--bj0bj06e.kr')).toBe(row)
  })
  it('findRosterByEmail 은 로컬 파트를 초대 규칙으로 좁히지 않는다 — 한글 로컬 파트 + IDN 호스트도 같은 행(Parked C2 m-2)', () => {
    const row = member({ email: '홍길동@xn--bj0bj06e.kr' })
    expect(findRosterByEmail([row], '홍길동@한글.kr')).toBe(row)
  })
  it('validateDraft 는 한글 로컬 파트를 받는다 — 명단 로컬 파트는 초대보다 넓다(MP7·MP8)', () => {
    const r = validateDraft({ ...emptyDraft(), name: '홍길동', email: '홍길동@acme.test' })
    expect(r.ok && r.input.email).toBe('홍길동@acme.test')
  })
})

describe('인물 이메일 정규형(P-1)', () => {
  const base = emptyDraft()
  it('validateDraft 는 호스트를 퓨니코드·끝 점 제거로 정규화한다', () => {
    const r = validateDraft({ ...base, name: 'kim', email: ' Kim@한글.KR ' })
    expect(r.ok && r.input.email).toBe('kim@xn--bj0bj06e.kr')
    const r2 = validateDraft({ ...base, name: 'alice', email: 'alice@acme.test.' })
    expect(r2.ok && r2.input.email).toBe('alice@acme.test')
    expect(validateDraft({ ...base, name: 'x', email: 'x@acme.test/y' })).toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
  })
  it('findRosterByEmail 은 정규형으로 비교한다 — 유니코드로 입력해도 퓨니코드로 저장된 행을 찾는다', () => {
    const row = { ...member(), email: 'kim@xn--bj0bj06e.kr' }
    expect(findRosterByEmail([row], 'kim@한글.kr')).toBe(row)
    expect(findRosterByEmail([row], 'KIM@xn--bj0bj06e.kr.')).toBe(row)
  })
})

describe('canGrantAdmin', () => {
  it('슈퍼유저는 가능', () => {
    expect(canGrantAdmin(makeProjectActorView({ isSuperuser: true, workspaceRole: null }))).toBe(true)
  })
  it('워크스페이스 관리자는 가능', () => {
    expect(canGrantAdmin(makeProjectActorView({ workspaceRole: 'admin' }))).toBe(true)
  })
  it('프로젝트 관리자(워크스페이스 멤버)·비로그인은 불가', () => {
    expect(canGrantAdmin(makeProjectActorView({ workspaceRole: 'member', projectRole: 'admin' }))).toBe(false)
    expect(canGrantAdmin(null)).toBe(false)
  })
})

describe('accessRoleLabel', () => {
  it('관리자 / 멤버 / 없음(조회 전용)', () => {
    expect(accessRoleLabel('admin')).toBe('관리자')
    expect(accessRoleLabel('member')).toBe('멤버')
    expect(accessRoleLabel(null)).toBe('없음(조회 전용)')
  })
})

describe('팀 선택', () => {
  it('toggleTeam — 없으면 뒤에 붙이고 있으면 뺀다(대표를 빼면 다음 팀이 대표)', () => {
    expect(toggleTeam([], 'a')).toEqual(['a'])
    expect(toggleTeam(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTeam(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('setPrimaryTeam — 그 팀을 맨 앞으로(없던 팀이면 추가하며 대표)', () => {
    expect(setPrimaryTeam(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(setPrimaryTeam(['a'], 'z')).toEqual(['z', 'a'])
  })
})

describe('findRosterByEmail', () => {
  const rows = [member(), member({ id: 'm-2', personId: 'pe-2', name: 'bob', email: null })]
  it('같은 이메일(대소문자·공백 무시)의 명단 행을 찾는다', () => {
    expect(findRosterByEmail(rows, ' ALICE@example.com ')?.id).toBe('m-1')
  })
  it('빈 이메일은 찾지 않는다(외부 인력끼리는 겹치지 않는다)', () => {
    expect(findRosterByEmail(rows, '')).toBeNull()
  })
  it('중복 안내 문구', () => {
    expect(ERR_DUPLICATE_EMAIL).toBe('같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.')
  })
})

describe('isDraftDirty', () => {
  it('원본과 같으면 false, 한 필드라도 다르면 true', () => {
    const m = member()
    expect(isDraftDirty(draftFromMember(m), m)).toBe(false)
    expect(isDraftDirty({ ...draftFromMember(m), title: '수석' }, m)).toBe(true)
    expect(isDraftDirty({ ...draftFromMember(m), teamIds: ['t-mes', 't-erp'] }, m)).toBe(true)
    expect(isDraftDirty({ ...draftFromMember(m), active: false }, m)).toBe(true)
  })
})
