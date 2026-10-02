import { beforeEach, describe, expect, it, vi } from 'vitest'

// 팀 개명(SP4 D37) — code 는 그대로, 이름만. 규칙: 앞뒤 공백 제거(NFKC)·1~40자·예약어 아님(D38)·같은 범위의 다른 팀 code·name 과
// 겹치지 않음(대소문자·전각 무시 — 계획 P5). 선행 조회(설정·형제 팀) 실패는 중단한다(3원칙 ②). 화면의 개명 입력은 B.
const m = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const db = { teams: [] as Row[], updates: [] as Array<{ id: unknown; patch: Row }>, failSelect: false }
  const from = (table: string) => {
    if (table !== 'teams') throw new Error(`unexpected ${table}`)
    const filters: Array<(r: Row) => boolean> = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q }
    q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q }
    q.order = () => q
    q.maybeSingle = async () => db.failSelect ? { data: null, error: { message: 'boom' } } : { data: db.teams.find((r) => filters.every((f) => f(r))) ?? null, error: null }
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(db.failSelect
      ? { data: null, error: { message: 'boom' } } : { data: db.teams.filter((r) => filters.every((f) => f(r))), error: null }).then(res)
    q.update = (patch: Row) => {
      const uf: Array<(r: Row) => boolean> = []
      const u: Record<string, unknown> = {}
      u.eq = (c: string, v: unknown) => { uf.push((r) => r[c] === v); return u }
      u.is = (c: string, v: unknown) => { uf.push((r) => (r[c] ?? null) === v); return u }
      u.select = async () => {
        const hit = db.teams.filter((r) => uf.every((f) => f(r)))
        for (const r of hit) { Object.assign(r, patch); db.updates.push({ id: r.id, patch }) }
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }
      return u
    }
    return q
  }
  return { db, client: { from }, requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), getActor: vi.fn(), getProjectConfig: vi.fn() }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: m.requireProjectAdmin, requireWorkspaceAdmin: m.requireWorkspaceAdmin, getActor: m.getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => m.client }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => ({ admin: m.client }) }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))

import { checkTeamRename, firstNewCodeClash, newTeamCodeClash, teamCodeClashError } from '@/lib/domain/teamName'
import { updateProjectTeam } from '@/app/actions/projectTeams'
import { updateTeam } from '@/app/actions/teams'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeAdminActor, makeSuperuser } from '../fixtures/actor'

const P = '00000000-0000-0000-7e57-000000001940'
const W = '00000000-0000-0000-7e57-000000001941'
const row = (id: string, code: string, name = code, over: Record<string, unknown> = {}) =>
  ({ id, code, name, project_id: P, workspace_id: W, active: true, sort_order: 0, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  m.db.teams = [row('t-ops', 'OPS'), row('t-res', 'RES', '연구팀'), row('g-civ', 'CIV', 'CIV', { project_id: null })]
  m.db.updates = []
  m.db.failSelect = false
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeAdminActor(P) })
  m.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser() })
  m.getActor.mockResolvedValue(makeSuperuser())
  m.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
})

describe('checkTeamRename — 순수 규칙(D37·P5)', () => {
  const base = { selfId: 't-ops', selfCode: 'OPS', siblings: [{ id: 't-ops', code: 'OPS', name: 'OPS' }, { id: 't-res', code: 'RES', name: '연구팀' }], reserved: ['산출물', '단계'] }
  it('앞뒤 공백·전각을 정규화해 받는다', () => {
    expect(checkTeamRename({ ...base, name: '  운영팀 ' })).toEqual({ ok: true, name: '운영팀' })
    expect(checkTeamRename({ ...base, name: 'ＯＰＳ 운영' })).toEqual({ ok: true, name: 'OPS 운영' })
  })
  it('빈 값·문자열 아님·40자 초과는 거부', () => {
    for (const name of ['   ', '', 42, null]) expect(checkTeamRename({ ...base, name }).ok, String(name)).toBe(false)
    expect(checkTeamRename({ ...base, name: '가'.repeat(41) }).ok).toBe(false)
    expect(checkTeamRename({ ...base, name: '가'.repeat(40) }).ok).toBe(true)
  })
  it('예약어(머리 낱말·단계 이름)는 대소문자·전각을 무시하고 거부', () => {
    expect(checkTeamRename({ ...base, name: '산출물' })).toEqual({ ok: false, error: "'산출물'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다." })
    expect(checkTeamRename({ ...base, name: '단계' }).ok).toBe(false)
  })
  it('[RF1] 같은 범위 다른 팀의 code·name 과 겹치면 거부 — 대소문자·전각만 다른 것도', () => {
    for (const name of ['RES', 'res', 'ＲＥＳ', '연구팀', ' 연구팀 ']) {
      expect(checkTeamRename({ ...base, name }), name).toEqual({ ok: false, error: '같은 범위의 다른 팀(RES)의 코드·이름과 겹칩니다.' })
    }
  })
  it('자기 code·이름으로 되돌리는 개명은 허용한다', () => {
    expect(checkTeamRename({ ...base, name: 'OPS' })).toEqual({ ok: true, name: 'OPS' })
    expect(checkTeamRename({ ...base, name: 'ops' })).toEqual({ ok: true, name: 'ops' })
  })
})

describe('updateProjectTeam — name(전용 팀)', () => {
  it('이름만 바꾸고 code 는 그대로 — 같은 범위는 그 프로젝트의 전용 팀', async () => {
    expect(await updateProjectTeam(P, 't-ops', { name: '운영팀' })).toEqual({ ok: true })
    expect(m.db.updates).toEqual([{ id: 't-ops', patch: { name: '운영팀' } }])
    expect(m.db.teams.find((t) => t.id === 't-ops')).toMatchObject({ code: 'OPS', name: '운영팀' })
  })
  it('공용 팀(CIV)과 같은 이름은 범위가 달라 허용한다 — 범위 밖 겹침은 봇의 모호 거부가 맡는다(K14)', async () => {
    expect(await updateProjectTeam(P, 't-ops', { name: 'CIV' })).toEqual({ ok: true })
  })
  it('프로젝트 단계 이름은 예약어 — 거부하고 쓰지 않는다', async () => {
    expect((await updateProjectTeam(P, 't-ops', { name: '작업' })).ok).toBe(false)
    expect(m.db.updates).toEqual([])
  })
  it('설정·형제 팀 조회 실패는 중단 — 원문을 싣지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getProjectConfig.mockRejectedValueOnce(new Error('db down'))
    const a = await updateProjectTeam(P, 't-ops', { name: '운영팀' })
    m.db.failSelect = true
    const b = await updateProjectTeam(P, 't-ops', { name: '운영팀' })
    for (const r of [a, b]) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).not.toMatch(/boom|db down/)
    }
    expect(m.db.updates).toEqual([])
    err.mockRestore()
  })
  it('다른 프로젝트의 팀 id 는 이 범위의 팀이 아니다 — 0행 거부', async () => {
    m.db.teams.push(row('t-x', 'X', 'X', { project_id: 'other' }))
    expect(await updateProjectTeam(P, 't-x', { name: '새이름' })).toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
  })
})

describe('updateTeam — name(공용 팀, 머리 낱말만 예약어)', () => {
  it('공용 팀 이름을 바꾼다 — 같은 범위는 그 워크스페이스의 공용 팀', async () => {
    m.db.teams.push(row('g-mep', 'MEP', 'MEP', { project_id: null }))
    expect(await updateTeam('g-civ', { name: '토목' })).toEqual({ ok: true })
    expect(m.db.teams.find((t) => t.id === 'g-civ')).toMatchObject({ code: 'CIV', name: '토목' })
    expect((await updateTeam('g-civ', { name: 'mep' })).ok).toBe(false)
  })
  it('공용 팀은 프로젝트 단계 이름을 보지 않는다(한계 K14) — 머리 낱말은 거부', async () => {
    expect(await updateTeam('g-civ', { name: '단계' })).toEqual({ ok: true })
    expect((await updateTeam('g-civ', { name: '담당' })).ok).toBe(false)
  })
})

// 개명 규칙의 대칭(A2-1 리뷰 정확성 P3) — 새 팀 code 가 같은 범위 다른 팀의 code·이름(개명 포함)과 정규화 키로 겹치면 거부. 정확히 같은 code 는 호출부의 "이미 있음"
describe('newTeamCodeClash — 생성 경로의 겹침', () => {
  const sib = [{ code: 'RES', name: '운영' }, { code: 'LAB', name: 'LAB' }]
  it.each([['운영', 'RES'], ['ＲＥＳ', 'RES'], ['res', 'RES'], ['lab', 'LAB'], [' 운영 ', 'RES']])('%s → %s', (code, clash) => {
    expect(newTeamCodeClash(code, sib)).toBe(clash)
  })
  it('정확히 같은 code·겹치지 않는 code 는 null', () => {
    expect(newTeamCodeClash('RES', sib)).toBeNull()
    expect(newTeamCodeClash('OPS', sib)).toBeNull()
    expect(teamCodeClashError('운영', 'RES')).toContain('다른 팀(RES)')
  })
})

// A2-2 리뷰 보안 P3(U4) — 한 번의 가져오기 안의 새 code 끼리도 겹침을 본다(액션 두 번이면 둘째가 막히는데 가져오기 길만 비켜 갔다)
describe('firstNewCodeClash — 새 code 끼리와 기존 팀', () => {
  it('앞서 통과한 새 code 와 키가 같으면 그 뒤 code 가 겹친다(대소문자·전각)', () => {
    expect(firstNewCodeClash(['ab', 'AB'], [])).toEqual({ code: 'AB', clash: 'ab' })
    expect(firstNewCodeClash(['AB', 'ＡＢ'], [])).toEqual({ code: 'ＡＢ', clash: 'AB' })
  })
  it('기존 팀과의 겹침은 newTeamCodeClash 와 같다, 겹치지 않으면 null', () => {
    expect(firstNewCodeClash(['OPS', 'res'], [{ code: 'RES', name: '연구' }])).toEqual({ code: 'res', clash: 'RES' })
    expect(firstNewCodeClash(['OPS', 'LAB'], [{ code: 'RES', name: '연구' }])).toBeNull()
    expect(firstNewCodeClash(['RES'], [{ code: 'RES', name: 'RES' }])).toBeNull()   // 정확히 같은 code 는 호출부의 "이미 있음"
  })
})
