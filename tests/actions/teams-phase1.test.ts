// 팀 유연화 1단계의 액션 — ① 추가: 이름과 코드를 따로 받는다(코드를 비우면 이름에서 만든 기본값) ② 색: 테마 슬롯 번호만 받아 팔레트 hex 로 저장
// ③ 순서 맞바꾸기: 한 액션이 두 행을 바꾸고 둘째가 실패하면 첫 행을 되돌린다 ④ 개명: 그 팀의 색인 문서를 다시 넣는다.
// 스키마는 그대로다 — 공용 팀은 create_team RPC(p_code·p_name), 전용 팀은 teams insert, 색은 기존 color 열.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const db = {
    teams: [] as Row[],
    rpcCalls: [] as Array<{ fn: string; args: Row }>,
    inserted: [] as Row[],
    /** n 번째 update(1부터)를 실패시킨다 — 'error' 는 DB 오류, 'zero' 는 0행 */
    failUpdate: new Map<number, 'error' | 'zero'>(),
    updates: 0,
  }
  const matcher = (filters: Array<(r: Row) => boolean>) => (r: Row) => filters.every((f) => f(r))
  const table = () => {
    const filters: Array<(r: Row) => boolean> = []
    const q: Record<string, unknown> = {}
    const add = (f: (r: Row) => boolean) => { filters.push(f); return q }
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => add((r) => (r[c] ?? null) === v),
      is: (c: string, v: unknown) => add((r) => (r[c] ?? null) === v),
      in: (c: string, v: unknown[]) => add((r) => v.includes(r[c])),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const rows = db.teams.filter(matcher(filters)).sort((a, b) => Number(b.sort_order) - Number(a.sort_order))
        return { data: rows[0] ?? null, error: null }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: db.teams.filter(matcher(filters)).map((r) => ({ ...r })), error: null }).then(res, rej),
      insert: async (row: Row) => { db.inserted.push(row); db.teams.push({ id: `t-new-${db.inserted.length}`, ...row }); return { error: null } },
      update: (patch: Row) => {
        const where: Array<(r: Row) => boolean> = []
        const upd: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { where.push((r) => (r[c] ?? null) === v); return upd },
          is: (c: string, v: unknown) => { where.push((r) => (r[c] ?? null) === v); return upd },
          select: async () => {
            const n = ++db.updates
            const fail = db.failUpdate.get(n)
            if (fail === 'error') return { data: null, error: { message: 'boom', code: '08006' } }
            if (fail === 'zero') return { data: [], error: null }
            const hit = db.teams.filter(matcher(where))
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return upd
      },
    })
    return q
  }
  const rpc = vi.fn(async (fn: string, args: Row) => {
    db.rpcCalls.push({ fn, args })
    db.teams.push({ id: 't-rpc', code: args.p_code, name: args.p_name, color: args.p_color, sort_order: args.p_sort_order, workspace_id: args.p_workspace_id, project_id: null })
    return { data: 't-rpc', error: null }
  })
  return {
    db, rpc,
    createAdminClient: vi.fn(() => ({ from: () => table(), rpc })),
    requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(), getActor: vi.fn(),
    getProjectConfig: vi.fn(), referenced: vi.fn(async (): Promise<Map<string, string>> => new Map()),
    reindex: vi.fn(async () => {}),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin, requireProjectAdmin: h.requireProjectAdmin, getActor: h.getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes: h.referenced }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueTeamRenameIndexChange: h.reindex }))

import { addTeam, updateTeam } from '@/app/actions/teams'
import { addProjectTeam, updateProjectTeam } from '@/app/actions/projectTeams'
import { ERR_DENIED } from '@/lib/authz/errors'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'
import { checkNewTeam, defaultTeamCode, newTeamNameClash } from '@/lib/domain/teamName'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import { ERR_TEAM_ORDER_STALE } from '@/lib/teams/swapOrder'
import { makeActor, makeAdminActor, WS } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const P = 'p1'
const WS_ADMIN = makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WS, 'admin']]) })
const P_ADMIN = makeAdminActor(P, { userId: 'u-padmin' })
const common = (id: string, code: string, over: Record<string, unknown> = {}) =>
  ({ id, code, name: code, color: '#6b7280', sort_order: 0, active: true, progress_visible: true, workspace_id: WS, project_id: null, ...over })
const own = (id: string, code: string, over: Record<string, unknown> = {}) => common(id, code, { project_id: P, ...over })
const teamOf = (id: string) => h.db.teams.find((t) => t.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  h.db.teams = []; h.db.rpcCalls = []; h.db.inserted = []; h.db.failUpdate = new Map(); h.db.updates = 0
  h.getActor.mockResolvedValue(WS_ADMIN)
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: WS_ADMIN })
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: P_ADMIN })
  h.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
  h.referenced.mockResolvedValue(new Map())
})

describe('이름·코드 규칙(순수)', () => {
  it('기본 코드는 이름 그대로(앞뒤 공백만 걷는다) — 20자를 넘으면 글자 단위로 자른다', () => {
    expect(defaultTeamCode(' 기획팀 ')).toBe('기획팀')
    expect(defaultTeamCode('가'.repeat(25))).toBe('가'.repeat(20))
    expect(defaultTeamCode('Team Alpha Planning Division')).toBe('Team Alpha Planning')   // 자른 끝의 공백도 걷는다
    expect(defaultTeamCode('   ')).toBe('')
  })
  it('코드를 비우면 기본 코드, 주면 그 값(공백만 걷는다) — 이름은 NFKC 로 고르게', () => {
    expect(checkNewTeam({ name: ' 기획팀 ', reserved: EXCEL_HEADER_WORDS })).toEqual({ ok: true, name: '기획팀', code: '기획팀' })
    expect(checkNewTeam({ name: '기획팀', code: ' TEAM_A ', reserved: EXCEL_HEADER_WORDS })).toEqual({ ok: true, name: '기획팀', code: 'TEAM_A' })
    expect(checkNewTeam({ name: '기획팀', code: '  ', reserved: EXCEL_HEADER_WORDS })).toMatchObject({ ok: true, code: '기획팀' })
    expect(checkNewTeam({ name: 'ＡＢ팀', code: null, reserved: [] })).toEqual({ ok: true, name: 'AB팀', code: 'ＡＢ팀' })
  })
  it('거부 — 빈 이름·40자 초과 이름·예약어 이름·20자 초과 코드·예약어 코드·문자열이 아닌 값. 문구가 어느 칸인지 가린다', () => {
    const bad = (input: Parameters<typeof checkNewTeam>[0]) => { const r = checkNewTeam(input); return r.ok ? null : r.error }
    expect(bad({ name: '   ', reserved: [] })).toBe('팀 이름을 입력하세요.')
    expect(bad({ name: 42, reserved: [] })).toBe('팀 이름을 입력하세요.')
    expect(bad({ name: '가'.repeat(41), reserved: [] })).toBe('팀 이름은 40자 이하여야 합니다.')
    expect(bad({ name: '산출물', reserved: EXCEL_HEADER_WORDS })).toBe("'산출물'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.")
    expect(bad({ name: '기획팀', code: 'X'.repeat(21), reserved: [] })).toBe('팀 코드는 20자 이하여야 합니다.')
    expect(bad({ name: '기획팀', code: '산출물', reserved: EXCEL_HEADER_WORDS })).toBe("'산출물'는 엑셀 양식 예약어라 팀 코드로 쓸 수 없습니다.")
    expect(bad({ name: '기획팀', code: 7, reserved: [] })).toBe('팀 코드가 올바르지 않습니다.')
  })
  it('이름 겹침 — 다른 팀의 code·이름과 대소문자·전각만 달라도 겹침. 이름이 자기 code 와 같은 낱말이면 code 판정에 맡긴다', () => {
    const siblings = [{ code: 'OPS', name: '운영' }]
    expect(newTeamNameClash('운영', 'OPS2', siblings)).toBe('OPS')
    expect(newTeamNameClash('ｏｐｓ', 'X1', siblings)).toBe('OPS')
    expect(newTeamNameClash('기획팀', 'TEAM_A', siblings)).toBeNull()
    expect(newTeamNameClash('ops', 'OPS', siblings)).toBeNull()
  })
})

describe('addTeam — 공용 팀: 이름과 코드를 따로', () => {
  it('create_team 에 p_code·p_name 을 따로 넘긴다 — 이름의 오타가 코드로 굳지 않는다', async () => {
    expect(await addTeam(WS, '기획팀', 'TEAM_A')).toEqual({ ok: true })
    expect(h.db.rpcCalls).toEqual([{ fn: 'create_team', args: expect.objectContaining({ p_code: 'TEAM_A', p_name: '기획팀', p_workspace_id: WS, p_actor: 'u-wsadmin' }) }])
  })
  it('코드를 생략하면(undefined·null·빈 문자열) 이름에서 만든 기본 코드 — 긴 이름은 20자로 자른 코드와 온전한 이름', async () => {
    for (const code of [undefined, null, '', '  ']) {
      h.db.teams = []; h.db.rpcCalls = []
      expect(await addTeam(WS, '기획팀', code)).toEqual({ ok: true })
      expect(h.db.rpcCalls[0].args).toMatchObject({ p_code: '기획팀', p_name: '기획팀' })
    }
    h.db.teams = []; h.db.rpcCalls = []
    const long = '가'.repeat(30)
    expect(await addTeam(WS, long)).toEqual({ ok: true })
    expect(h.db.rpcCalls[0].args).toMatchObject({ p_code: '가'.repeat(20), p_name: long })
  })
  it('코드 겹침·예약어, 이름 겹침은 거부 — RPC 를 부르지 않는다', async () => {
    h.db.teams = [common('t-ops', 'OPS', { name: '운영' })]
    expect(await addTeam(WS, '기획팀', 'OPS')).toEqual({ ok: false, error: "'OPS' 팀이 이미 존재합니다." })
    expect(await addTeam(WS, '기획팀', 'ops')).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(OPS)') })
    expect(await addTeam(WS, '기획팀', '운영')).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(OPS)') })
    expect(await addTeam(WS, '기획팀', '산출물')).toMatchObject({ ok: false, error: expect.stringContaining('팀 코드로 쓸 수 없습니다') })
    expect(await addTeam(WS, '운영', 'TEAM_B')).toEqual({ ok: false, error: "'운영'는 같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다." })
    expect(await addTeam(WS, 'ops', 'TEAM_B')).toMatchObject({ ok: false, error: expect.stringContaining('겹칩니다') })
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('자동 색은 여덟 색을 돈다 — 여섯째 팀(순번 5)은 여섯째 슬롯', async () => {
    h.db.teams = [common('t-5', 'E', { sort_order: 4 })]
    expect(await addTeam(WS, '기획팀', 'TEAM_F')).toEqual({ ok: true })
    expect(h.db.rpcCalls[0].args).toMatchObject({ p_sort_order: 5, p_color: TEAM_PALETTE[5] })
  })
  it('권한이 없으면 거부 — DB 를 건드리지 않는다', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await addTeam(WS, '기획팀', 'TEAM_A')).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('addProjectTeam — 전용 팀: 이름과 코드를 따로', () => {
  it('code·name 을 따로 넣는다 · 코드를 생략하면 기본 코드', async () => {
    expect(await addProjectTeam(P, '기획팀', 'TEAM_A')).toEqual({ ok: true })
    expect(h.db.inserted[0]).toMatchObject({ code: 'TEAM_A', name: '기획팀', project_id: P, workspace_id: WS, color: TEAM_PALETTE[0] })
    expect(await addProjectTeam(P, '품질관리')).toEqual({ ok: true })
    expect(h.db.inserted[1]).toMatchObject({ code: '품질관리', name: '품질관리', sort_order: 1, color: TEAM_PALETTE[1] })
  })
  it('예약어는 그 프로젝트의 단계 이름까지 — 코드 칸에도 같다. 이름 겹침은 그 프로젝트 팀끼리', async () => {
    h.db.teams = [own('t-ops', 'OPS', { name: '운영' }), common('t-pub', 'PUB', { name: '공용 이름' })]
    expect(await addProjectTeam(P, '기획팀', '작업')).toEqual({ ok: false, error: "'작업'는 엑셀 양식 예약어라 팀 코드로 쓸 수 없습니다." })
    expect(await addProjectTeam(P, '운영', 'TEAM_B')).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(OPS)') })
    expect(h.db.inserted).toEqual([])
    // 공용 팀의 이름과는 겹침을 보지 않는다(범위가 다르다 — 화면이 `이름 (code)` 로 가른다)
    expect(await addProjectTeam(P, '공용 이름', 'TEAM_C')).toEqual({ ok: true })
  })
  it('이 프로젝트가 이미 쓰는 공용 팀 판정은 코드로 한다(이름이 아니라)', async () => {
    await addProjectTeam(P, '기획팀', 'TEAM_A')
    expect(h.referenced).toHaveBeenCalledWith({ projectId: P, workspaceId: WS }, ['TEAM_A'])
  })
})

describe('색 선택 — 슬롯 번호만 받아 팔레트 hex 로 저장한다', () => {
  it('공용 팀 — colorSlot 1~8 은 그 자리의 hex, 범위 밖·hex 문자열은 거부', async () => {
    h.db.teams = [common('t-ops', 'OPS')]
    expect(await updateTeam('t-ops', { colorSlot: 7 })).toEqual({ ok: true })
    expect(teamOf('t-ops').color).toBe(TEAM_PALETTE[6])
    for (const bad of [0, 9, 2.5, '#ff0000' as unknown as number]) {
      expect(await updateTeam('t-ops', { colorSlot: bad })).toEqual({ ok: false, error: '고를 수 없는 색입니다.' })
    }
    expect(teamOf('t-ops').color).toBe(TEAM_PALETTE[6])
    expect(h.reindex).not.toHaveBeenCalled()   // 색은 색인 본문에 없다
  })
  it('공용 팀 — 워크스페이스 관리자가 아니면 거부(기존 팀 수정과 같은 가드), 색은 그대로', async () => {
    h.db.teams = [common('t-ops', 'OPS')]
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await updateTeam('t-ops', { colorSlot: 3 })).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(teamOf('t-ops').color).toBe('#6b7280')
  })
  it('전용 팀 — 프로젝트 관리자만, 그 프로젝트의 행만(공용 행·다른 프로젝트 행은 0행)', async () => {
    h.db.teams = [own('t-own', 'OPS'), common('t-pub', 'PUB'), own('t-else', 'ELSE', { project_id: 'p2' })]
    expect(await updateProjectTeam(P, 't-own', { colorSlot: 8 })).toEqual({ ok: true })
    expect(teamOf('t-own').color).toBe(TEAM_PALETTE[7])
    expect((await updateProjectTeam(P, 't-pub', { colorSlot: 2 })).ok).toBe(false)
    expect((await updateProjectTeam(P, 't-else', { colorSlot: 2 })).ok).toBe(false)
    expect(teamOf('t-pub').color).toBe('#6b7280')
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await updateProjectTeam(P, 't-own', { colorSlot: 1 })).toEqual({ ok: false, error: ERR_DENIED })
    expect(teamOf('t-own').color).toBe(TEAM_PALETTE[7])
  })
})

describe('순서 맞바꾸기 — 한 액션, 실패하면 되돌린다', () => {
  const seed = () => { h.db.teams = [common('t-a', 'A', { sort_order: 0 }), common('t-b', 'B', { sort_order: 1 }), own('t-p', 'P', { sort_order: 5 })] }
  const orders = () => [teamOf('t-a').sort_order, teamOf('t-b').sort_order]
  it('두 행의 순번을 맞바꾼다', async () => {
    seed()
    expect(await updateTeam('t-a', { swapOrderWith: 't-b' })).toEqual({ ok: true })
    expect(orders()).toEqual([1, 0])
  })
  it('둘째 쓰기가 실패하면 첫 행을 원래 순번으로 되돌린다 — 두 팀이 같은 순번으로 남지 않는다', async () => {
    seed()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.db.failUpdate.set(2, 'error')
    const r = await updateTeam('t-a', { swapOrderWith: 't-b' })
    expect(r).toEqual({ ok: false, error: '팀을 수정하지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(orders()).toEqual([0, 1])
    expect(h.db.updates).toBe(3)   // 첫 행 → 둘째(실패) → 보상
    err.mockRestore()
  })
  it('그새 순서가 바뀌었으면(조건 불일치 0행) 덮지 않고 멈춘다 — 둘째가 0행이어도 첫 행을 되돌린다', async () => {
    seed()
    h.db.failUpdate.set(1, 'zero')
    expect(await updateTeam('t-a', { swapOrderWith: 't-b' })).toEqual({ ok: false, error: ERR_TEAM_ORDER_STALE })
    expect(h.db.updates).toBe(1)
    h.db.failUpdate = new Map([[3, 'zero']]); h.db.updates = 1
    expect(await updateTeam('t-a', { swapOrderWith: 't-b' })).toEqual({ ok: false, error: ERR_TEAM_ORDER_STALE })
    expect(orders()).toEqual([0, 1])
  })
  it('보상까지 실패하면 숨기지 않는다 — 실패로 답하고 원인을 로그에 남긴다', async () => {
    seed()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.db.failUpdate = new Map([[2, 'error'], [3, 'error']])
    expect((await updateTeam('t-a', { swapOrderWith: 't-b' })).ok).toBe(false)
    expect(err.mock.calls.some((c) => String(c[0]).includes('보상 실패'))).toBe(true)
    err.mockRestore()
  })
  it('범위 밖 팀과는 바꾸지 않는다 — 공용 팀 화면은 전용 팀과, 프로젝트 화면은 공용·다른 프로젝트 팀과', async () => {
    seed()
    expect(await updateTeam('t-a', { swapOrderWith: 't-p' })).toEqual({ ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' })
    expect(await updateTeam('t-a', { swapOrderWith: 't-a' })).toMatchObject({ ok: false })
    expect(await updateProjectTeam(P, 't-p', { swapOrderWith: 't-a' })).toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
    expect(h.db.updates).toBe(0)
  })
  it('전용 팀끼리 — 프로젝트 관리자 가드 뒤에 바꾼다', async () => {
    h.db.teams = [own('t-1', 'ONE', { sort_order: 0 }), own('t-2', 'TWO', { sort_order: 1 })]
    expect(await updateProjectTeam(P, 't-2', { swapOrderWith: 't-1' })).toEqual({ ok: true })
    expect([teamOf('t-1').sort_order, teamOf('t-2').sort_order]).toEqual([1, 0])
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await updateProjectTeam(P, 't-2', { swapOrderWith: 't-1' })).toEqual({ ok: false, error: ERR_DENIED })
    expect([teamOf('t-1').sort_order, teamOf('t-2').sort_order]).toEqual([1, 0])
  })
})

describe('개명 — 그 팀의 색인 문서를 다시 넣는다', () => {
  it('이름이 실제로 바뀌면 팀 id 로 재색인을 등록한다(공용·전용) — 같은 이름·다른 변경은 등록하지 않는다', async () => {
    h.db.teams = [common('t-ops', 'OPS'), own('t-own', 'DEV')]
    expect(await updateTeam('t-ops', { name: '운영' })).toEqual({ ok: true })
    expect(h.reindex).toHaveBeenCalledWith('t-ops')
    expect(await updateProjectTeam(P, 't-own', { name: '개발' })).toEqual({ ok: true })
    expect(h.reindex).toHaveBeenCalledWith('t-own')
    h.reindex.mockClear()
    expect(await updateTeam('t-ops', { name: ' 운영 ' })).toEqual({ ok: true })
    expect(await updateTeam('t-ops', { active: false })).toEqual({ ok: true })
    expect(await updateProjectTeam(P, 't-own', { progressVisible: false })).toEqual({ ok: true })
    expect(h.reindex).not.toHaveBeenCalled()
  })
  it('개명이 거부되면(겹침) 등록하지 않는다', async () => {
    h.db.teams = [common('t-ops', 'OPS'), common('t-res', 'RES')]
    expect((await updateTeam('t-ops', { name: 'res' })).ok).toBe(false)
    expect(h.reindex).not.toHaveBeenCalled()
  })
})
