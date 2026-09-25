import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerClient, requireProjectAdmin } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireProjectAdmin: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { searchMemberCandidates } from '@/app/actions/memberSearch'
import { makeAdminActor } from '../fixtures/actor'
import type { Actor } from '@/lib/domain/authz'

const PROJECT_ID = 'project-1'
const LOOKUP_ERROR = '멤버 후보를 조회할 수 없습니다.'

type TeamEmbed = { code: string } | { code: string }[] | null

interface CandidateInput {
  id: string
  name: string
  personId?: string
  email?: string | null
  title?: string | null
  role_label?: string | null
  created_at?: string
  /** 대표 팀 하나 — 안쪽 teams 임베드를 객체/배열 어느 모양으로 줄지 그대로 따른다. */
  teams?: TeamEmbed
}
type CandidateRow = Record<string, unknown>

/** ROSTER_SELECT 모양의 명단 행 — 이름·이메일은 people 임베드, 팀은 project_member_teams 배열. */
function row(o: CandidateInput): CandidateRow {
  const teamLinks = o.teams == null ? [] : [{
    team_id: 't1', is_primary: true,
    teams: Array.isArray(o.teams)
      ? o.teams.map(t => ({ id: 't1', code: t.code, name: t.code }))
      : { id: 't1', code: o.teams.code, name: o.teams.code },
  }]
  return {
    id: o.id, project_id: PROJECT_ID, person_id: o.personId ?? `pe-${o.id}`,
    access_role: null, role_label: o.role_label ?? null, title: o.title ?? null,
    active: true, sort_order: 0, created_at: o.created_at ?? '2026-01-01T00:00:00Z',
    people: { display_name: o.name, email: o.email ?? null, user_id: null, kind: 'external', active: true },
    project_member_teams: teamLinks,
  }
}

interface ClientOptions {
  rows?: CandidateRow[]
  queryError?: { message: string } | null
}

function makeClient(options: ClientOptions = {}) {
  const limit = vi.fn(async () => ({
    data: options.queryError ? null : options.rows ?? [],
    error: options.queryError ?? null,
  }))
  const builder = {
    select: vi.fn(),
    ilike: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit,
  }
  builder.select.mockReturnValue(builder)
  builder.ilike.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.order.mockReturnValue(builder)

  const from = vi.fn((table: string) => {
    if (table !== 'project_members') throw new Error('예상치 못한 테이블: ' + table)
    return builder
  })
  createServerClient.mockResolvedValue({ from } as never)
  return { from, builder }
}

function makeActor(overrides: Partial<Actor> = {}) {
  return makeAdminActor(PROJECT_ID, { userId: 'admin-1', ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor() })
})

describe('searchMemberCandidates — 멤버 이름 자동완성 후보 검색', () => {
  it('가드 실패 시 그 오류를 그대로 돌려주고 DB를 조회하지 않는다', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const db = makeClient()

    expect(await searchMemberCandidates(PROJECT_ID, '홍길')).toEqual({
      ok: false,
      error: '권한 없음',
    })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('trim 후 2자 미만이면 DB 조회 없이 빈 후보를 돌려준다', async () => {
    expect(await searchMemberCandidates(PROJECT_ID, '  홍 ')).toEqual({
      ok: true,
      candidates: [],
    })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('일반 관리자는 자기 역할이 있는 프로젝트들로만 검색을 좁힌다', async () => {
    requireProjectAdmin.mockResolvedValue({
      ok: true,
      actor: makeActor({
        projectRoles: new Map([[PROJECT_ID, 'admin'], ['project-2', 'member']]),
      }),
    })
    const db = makeClient({ rows: [row({ id: 'm1', name: '홍길동' })] })

    const result = await searchMemberCandidates(PROJECT_ID, '홍길')

    expect(result.ok).toBe(true)
    expect(db.builder.in).toHaveBeenCalledWith('project_id', [PROJECT_ID, 'project-2'])
    // 빠진 사람(비활성 명단 행·비활성 인물)은 후보가 아니다.
    expect(db.builder.eq.mock.calls).toEqual([['active', true], ['people.active', true]])
  })

  it('슈퍼유저는 프로젝트 필터 없이 전체 로스터를 검색한다', async () => {
    requireProjectAdmin.mockResolvedValue({
      ok: true,
      actor: makeActor({ isSuperuser: true, projectRoles: new Map() }),
    })
    const db = makeClient({ rows: [row({ id: 'm1', name: '홍길동' })] })

    const result = await searchMemberCandidates(PROJECT_ID, '홍길')

    expect(result.ok).toBe(true)
    expect(db.builder.in).not.toHaveBeenCalled()
    expect(db.builder.eq.mock.calls).toEqual([['active', true], ['people.active', true]])
  })

  it('같은 이메일(대소문자 무시)은 정본 한 명으로 dedupe 하고 정본 이름을 쓴다', async () => {
    // DB 가 created_at ASC, id ASC 로 정렬해 주므로 첫 등장 행이 정본이다.
    const db = makeClient({
      rows: [
        row({ id: 'm1', name: '홍길동', email: 'hong@company.com', title: 'PM', created_at: '2026-01-01T00:00:00Z' }),
        row({ id: 'm2', name: '홍길동(외주)', email: 'HONG@Company.com', created_at: '2026-02-01T00:00:00Z' }),
      ],
    })

    const result = await searchMemberCandidates(PROJECT_ID, '홍길')

    expect(result.candidates).toEqual([
      { name: '홍길동', email: 'hong@company.com', teamCode: null, title: 'PM', roleLabel: null },
    ])
    expect(db.builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(db.builder.order).toHaveBeenCalledWith('id', { ascending: true })
  })

  it('같은 사람(person_id)이 여러 프로젝트 명단에 있으면 한 번만 — 첫 등장 행의 직함을 쓴다', async () => {
    makeClient({
      rows: [
        row({ id: 'm1', personId: 'pe-1', name: '김외주', email: null, title: '설계' }),
        row({ id: 'm2', personId: 'pe-1', name: '김외주', email: null, title: '개발' }),
      ],
    })

    const result = await searchMemberCandidates(PROJECT_ID, '김외')

    expect(result.candidates).toEqual([
      { name: '김외주', email: null, teamCode: null, title: '설계', roleLabel: null },
    ])
  })

  it('이메일 없는 다른 사람(person_id 다름)은 이름이 같아도 각각 후보로 남긴다', async () => {
    makeClient({
      rows: [
        row({ id: 'm1', name: '김외주', email: null }),
        row({ id: 'm2', name: '김외주', email: null }),
      ],
    })

    const result = await searchMemberCandidates(PROJECT_ID, '김외')

    expect(result.candidates).toHaveLength(2)
  })

  it('project_member_teams 임베드의 대표 팀을 teamCode 로 편다 (객체·배열 양쪽 모양)', async () => {
    makeClient({
      rows: [
        row({ id: 'm1', name: '김철수', teams: { code: 'DEV' } }),
        row({ id: 'm2', name: '박영희', teams: [{ code: 'QA' }] }),
      ],
    })

    const result = await searchMemberCandidates(PROJECT_ID, '철수')

    expect(result.candidates?.map(c => ({ name: c.name, teamCode: c.teamCode }))).toEqual([
      { name: '김철수', teamCode: 'DEV' },
      { name: '박영희', teamCode: 'QA' },
    ])
  })

  it('ilike 특수문자(% _ \\)를 이스케이프해 리터럴로 검색한다', async () => {
    const db = makeClient()

    await searchMemberCandidates(PROJECT_ID, '50%_\\')

    // 이름은 people 이 정본 — !inner 임베드 필터로 건다.
    expect(db.builder.ilike).toHaveBeenCalledWith('people.display_name', '%50\\%\\_\\\\%')
    expect(String(db.builder.select.mock.calls[0][0])).toContain('people!inner(')
  })

  it('조회 실패를 빈 결과로 위장하지 않는다 — 로깅하고 ok:false', async () => {
    makeClient({ queryError: { message: 'db unavailable' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await searchMemberCandidates(PROJECT_ID, '홍길')).toEqual({
      ok: false,
      error: LOOKUP_ERROR,
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('DB 에서 30건을 가져와 가나다순 정렬 후 최대 8명만 돌려준다', async () => {
    const names = ['하나', '가나', '다라', '마바', '사아', '자차', '카타', '파하', '나다', '바사']
    const db = makeClient({
      rows: names.map((name, i) => row({ id: `m${i}`, name })),
    })

    const result = await searchMemberCandidates(PROJECT_ID, '이름')

    expect(db.builder.limit).toHaveBeenCalledWith(30)
    expect(result.candidates).toHaveLength(8)
    expect(result.candidates?.map(c => c.name)).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'ko-KR')).slice(0, 8),
    )
  })
})
