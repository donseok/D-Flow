// 팀 유연화 2단계의 액션 — ① 코드 바꾸기(change_team_code RPC 한 길) ② 다른 팀으로 합치기(merge_teams)와 미리보기(team_reference_counts).
// 가드가 조회·RPC 보다 먼저인지, p_actor 가 가드 결과의 행위자인지, 그 범위의 팀이 아니면 RPC 를 부르지 않는지, 검증·DB 토큰의 문구,
// DB 원문을 응답에 싣지 않는지, 성공 뒤 재색인을 부르는지 본다. RPC 본문(잠금·등급 재판정·이전 규칙)은 tests/rls 가 실측한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const db = {
    teams: [] as Row[],
    rpcCalls: [] as Array<{ fn: string; args: Row }>,
    /** RPC 이름 → 응답. 없으면 기본 성공 응답 */
    rpcResult: new Map<string, { data: unknown; error: { message: string; code?: string } | null }>(),
    /** teams 조회를 실패시킨다 */
    failSelect: false,
  }
  const table = () => {
    const filters: Array<(r: Row) => boolean> = []
    const q: Record<string, unknown> = {}
    const add = (f: (r: Row) => boolean) => { filters.push(f); return q }
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => add((r) => (r[c] ?? null) === v),
      is: (c: string, v: unknown) => add((r) => (r[c] ?? null) === v),
      in: (c: string, v: unknown[]) => add((r) => v.includes(r[c])),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(db.failSelect
          ? { data: null, error: { message: 'connection reset by peer', code: '08006' } }
          : { data: db.teams.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null }).then(res, rej),
    })
    return q
  }
  const COUNTS = { item_owners: 3, project_member_teams: 2, area_teams: 1, minutes: 4, minute_folders: 1, invites: 0, credentials: 0 }
  const ZERO = { item_owners: 0, project_member_teams: 0, area_teams: 0, minutes: 0, minute_folders: 0, invites: 0, credentials: 0 }
  const MERGED = {
    status: 'merged',
    moved: { item_owners: 2, project_member_teams: 1, area_teams: 1, minutes: 4, invites: 0, credentials: 0 },
    deduped: { item_owners: 1, project_member_teams: 1, area_teams: 0 },
    folders: { roots_repointed: 0, roots_merged: 1, moved: 2, renamed: 1, minutes_moved: 1 },
    source_references: ZERO,
  }
  const rpc = vi.fn(async (fn: string, args: Row) => {
    db.rpcCalls.push({ fn, args })
    const fixed = db.rpcResult.get(fn)
    if (fixed) return fixed
    if (fn === 'change_team_code') return { data: { status: 'changed', code: args.p_code, minutes: 1 }, error: null }
    if (fn === 'team_reference_counts') return { data: COUNTS, error: null }
    if (fn === 'merge_teams') return { data: MERGED, error: null }
    return { data: null, error: { message: `unexpected rpc ${fn}` } }
  })
  return {
    db, rpc, COUNTS, MERGED,
    createAdminClient: vi.fn(() => ({ from: () => table(), rpc })),
    requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(), getActor: vi.fn(),
    getProjectConfig: vi.fn(), referenced: vi.fn(async (): Promise<Map<string, string>> => new Map()),
    reindex: vi.fn(async () => {}),
    profileSwap: vi.fn(async () => ({ swapped: 0, failed: 0 })),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin, requireProjectAdmin: h.requireProjectAdmin, getActor: h.getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes: h.referenced }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueTeamRenameIndexChange: h.reindex }))
vi.mock('@/lib/teams/excelProfileCode', () => ({ swapExcelProfileTeamCode: h.profileSwap }))

import { changeTeamCode, mergeTeams, previewTeamMerge } from '@/app/actions/teams'
import { changeProjectTeamCode, mergeProjectTeams, previewProjectTeamMerge } from '@/app/actions/projectTeams'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { checkTeamCodeChange } from '@/lib/domain/teamName'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import {
  ERR_TEAM_CODE_CHANGE, ERR_TEAM_CODE_SCOPE_CONFLICT, ERR_TEAM_CODE_TAKEN, ERR_TEAM_MERGE, ERR_TEAM_MERGE_PREVIEW, ERR_TEAM_MERGE_SAME, NOTICE_TEAM_CODE_PROFILE,
  ERR_TEAM_MERGE_SCOPE_CONFLICT, ERR_TEAM_MERGE_TARGET_INACTIVE, parseTeamMergeResult, parseTeamRefCounts, totalTeamRefs,
} from '@/lib/teams/teamOps'
import { makeActor, makeAdminActor, WS } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const P = 'p1'
const WS_ADMIN = makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WS, 'admin']]) })
const P_ADMIN = makeAdminActor(P, { userId: 'u-padmin' })
const common = (id: string, code: string, over: Record<string, unknown> = {}) =>
  ({ id, code, name: code, active: true, workspace_id: WS, project_id: null, ...over })
const own = (id: string, code: string, over: Record<string, unknown> = {}) => common(id, code, { project_id: P, ...over })
const rpcNames = () => h.db.rpcCalls.map((c) => c.fn)

beforeEach(() => {
  vi.clearAllMocks()
  h.db.teams = []; h.db.rpcCalls = []; h.db.rpcResult = new Map(); h.db.failSelect = false
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: WS_ADMIN })
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: P_ADMIN })
  h.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
  h.referenced.mockResolvedValue(new Map())
  h.profileSwap.mockResolvedValue({ swapped: 0, failed: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('코드 바꾸기 규칙(순수 — checkTeamCodeChange)', () => {
  const siblings = [{ id: 'a', code: 'DEV', name: '개발' }, { id: 'b', code: 'OPS', name: '운영팀' }]
  it('공백을 걷은 값이 새 코드 — 자기 이름과 같은 낱말은 겹침이 아니다', () => {
    expect(checkTeamCodeChange({ code: ' ENG ', selfId: 'a', siblings, reserved: [] })).toEqual({ ok: true, code: 'ENG', unchanged: false })
    expect(checkTeamCodeChange({ code: '개발', selfId: 'a', siblings, reserved: [] })).toEqual({ ok: true, code: '개발', unchanged: false })
    expect(checkTeamCodeChange({ code: 'DEV', selfId: 'a', siblings, reserved: [] })).toEqual({ ok: true, code: 'DEV', unchanged: true })
  })
  it('거부 — 빈 값·21자·예약어·다른 팀의 code(정확히·대소문자만 다른 것)·다른 팀의 이름', () => {
    const bad = (code: unknown) => { const r = checkTeamCodeChange({ code, selfId: 'a', siblings, reserved: EXCEL_HEADER_WORDS }); return r.ok ? null : r.error }
    expect(bad('  ')).toBe('팀 코드를 입력하세요.')
    expect(bad(7)).toBe('팀 코드를 입력하세요.')
    expect(bad('x'.repeat(21))).toBe('팀 코드는 20자 이하여야 합니다.')
    expect(bad(EXCEL_HEADER_WORDS[0])).toContain('예약어')
    expect(bad('OPS')).toBe(`'OPS' 코드를 쓰는 팀이 이미 있습니다.`)
    expect(bad('ops')).toContain('코드·이름과 겹칩니다')
    expect(bad('운영팀')).toContain('코드·이름과 겹칩니다')
  })
})

describe('changeTeamCode — 공용 팀', () => {
  it('가드가 먼저다 — 거부되면 조회도 RPC 도 없다', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await changeTeamCode(WS, 't1', 'ENG')).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.createAdminClient).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('워크스페이스가 비면 가드 전에 거부한다', async () => {
    expect((await changeTeamCode('', 't1', 'ENG')).ok).toBe(false)
    expect(h.requireWorkspaceAdmin).not.toHaveBeenCalled()
  })
  it('정상 — RPC 에 가드 결과의 행위자·공백 걷은 code 를 넘기고 그 팀을 재색인한다', async () => {
    h.db.teams = [common('t1', 'DEV'), common('t2', 'OPS')]
    expect(await changeTeamCode(WS, 't1', ' ENG ')).toEqual({ ok: true })
    expect(h.requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(h.db.rpcCalls).toEqual([{ fn: 'change_team_code', args: { p_actor: 'u-wsadmin', p_team_id: 't1', p_code: 'ENG' } }])
    expect(h.reindex).toHaveBeenCalledWith('t1')
    // 저장해 둔 엑셀 양식의 팀 열 — 옛 code → 새 code, 그 워크스페이스의 상속 프로젝트들(projectId null), 행위자는 가드 결과
    expect(h.profileSwap).toHaveBeenCalledWith(expect.anything(), { workspaceId: WS, projectId: null }, { from: 'DEV', to: 'ENG' }, 'u-wsadmin')
  })
  it('엑셀 양식을 맞추지 못한 프로젝트가 있으면 성공 + 알림 — 코드 변경은 되돌리지 않는다', async () => {
    h.db.teams = [common('t1', 'DEV')]
    h.profileSwap.mockResolvedValue({ swapped: 1, failed: 2 })
    expect(await changeTeamCode(WS, 't1', 'ENG')).toEqual({ ok: true, notice: NOTICE_TEAM_CODE_PROFILE })
    expect(h.reindex).toHaveBeenCalledWith('t1')
  })
  it('RPC 가 거부하면 엑셀 양식을 건드리지 않는다', async () => {
    h.db.teams = [common('t1', 'DEV')]
    h.db.rpcResult.set('change_team_code', { data: null, error: { message: 'TEAM_CODE_TAKEN', code: '23505' } })
    await changeTeamCode(WS, 't1', 'ENG')
    expect(h.profileSwap).not.toHaveBeenCalled()
  })
  it('그 워크스페이스의 공용 팀이 아니면(전용 팀·다른 워크스페이스·없는 id) RPC 를 부르지 않는다', async () => {
    h.db.teams = [own('p-team', 'DEV'), common('other', 'DEV', { workspace_id: 'ws-other' })]
    for (const id of ['p-team', 'other', 'nope', '']) {
      expect((await changeTeamCode(WS, id, 'ENG')).ok).toBe(false)
    }
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('검증 — 같은 값·같은 범위 겹침·예약어는 RPC 전에 거부한다', async () => {
    h.db.teams = [common('t1', 'DEV'), common('t2', 'OPS', { name: '운영' })]
    expect(await changeTeamCode(WS, 't1', 'DEV')).toEqual({ ok: false, error: '지금 코드와 같습니다.' })
    expect(await changeTeamCode(WS, 't1', 'OPS')).toEqual({ ok: false, error: `'OPS' 코드를 쓰는 팀이 이미 있습니다.` })
    expect((await changeTeamCode(WS, 't1', '운영')).ok).toBe(false)
    expect((await changeTeamCode(WS, 't1', EXCEL_HEADER_WORDS[0])).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.reindex).not.toHaveBeenCalled()
  })
  it('DB 판정 — 경합의 중복·M1 충돌·등급 재판정 거부는 고정 문구, 모르는 오류는 원문 없이 고정 문구', async () => {
    h.db.teams = [common('t1', 'DEV')]
    const fail = async (message: string, code: string) => {
      h.db.rpcResult.set('change_team_code', { data: null, error: { message, code } })
      return changeTeamCode(WS, 't1', 'ENG')
    }
    expect(await fail('TEAM_CODE_TAKEN', '23505')).toEqual({ ok: false, error: ERR_TEAM_CODE_TAKEN })
    expect(await fail('TEAM_CODE_SCOPE_CONFLICT', '23514')).toEqual({ ok: false, error: ERR_TEAM_CODE_SCOPE_CONFLICT })
    expect(await fail('TEAM_CODE_CHANGE_FORBIDDEN', '42501')).toEqual({ ok: false, error: ERR_DENIED })
    expect(await fail('TEAM_NOT_FOUND', 'P0002')).toEqual({ ok: false, error: ERR_MISSING })
    const unknown = await fail('duplicate key value violates unique constraint "teams_ws_project_code_key"', '23505')
    expect(unknown).toEqual({ ok: false, error: ERR_TEAM_CODE_CHANGE })
    expect(h.reindex).not.toHaveBeenCalled()
  })
  it('선행 조회가 실패하면 중단한다 — 원문은 응답에 없다', async () => {
    h.db.failSelect = true
    const r = await changeTeamCode(WS, 't1', 'ENG')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('connection reset')
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('changeProjectTeamCode — 전용 팀', () => {
  it('가드가 먼저다 — 거부되면 설정 조회도 RPC 도 없다', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await changeProjectTeamCode(P, 't1', 'ENG')).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('정상 — 그 프로젝트의 팀만, 행위자는 가드 결과', async () => {
    h.db.teams = [own('t1', 'DEV'), own('t2', 'QA'), common('c1', 'ENG')]
    expect(await changeProjectTeamCode(P, 't1', 'ENG')).toEqual({ ok: true })
    expect(h.db.rpcCalls).toEqual([{ fn: 'change_team_code', args: { p_actor: 'u-padmin', p_team_id: 't1', p_code: 'ENG' } }])
    expect(h.reindex).toHaveBeenCalledWith('t1')
    // 엑셀 양식은 그 프로젝트 하나만
    expect(h.profileSwap).toHaveBeenCalledWith(expect.anything(), { workspaceId: WS, projectId: P }, { from: 'DEV', to: 'ENG' }, 'u-padmin')
  })
  it('공용 팀·다른 프로젝트의 팀 id 는 거부한다(RPC 없음)', async () => {
    h.db.teams = [common('c1', 'DEV'), own('x1', 'DEV', { project_id: 'p-other' })]
    expect((await changeProjectTeamCode(P, 'c1', 'ENG')).ok).toBe(false)
    expect((await changeProjectTeamCode(P, 'x1', 'ENG')).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('이 프로젝트가 쓰는 공용 팀과 같은 code·같은 낱말이면 거부한다', async () => {
    h.db.teams = [own('t1', 'DEV')]
    h.referenced.mockResolvedValue(new Map([['OPS', 'OPS']]))
    expect(await changeProjectTeamCode(P, 't1', 'OPS')).toEqual({ ok: false, error: ERR_TEAM_CODE_SCOPE_CONFLICT })
    h.referenced.mockResolvedValue(new Map([['ops', 'OPS']]))
    expect((await changeProjectTeamCode(P, 't1', 'ops')).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('예약어는 그 프로젝트의 단계 이름까지 — 설정을 못 읽으면 바꾸지 않는다', async () => {
    h.db.teams = [own('t1', 'DEV')]
    expect((await changeProjectTeamCode(P, 't1', '단계')).ok).toBe(false)
    h.getProjectConfig.mockRejectedValue(new Error('settings down'))
    const r = await changeProjectTeamCode(P, 't1', 'ENG')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('settings down')
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('참조 조회가 실패하면 중단한다(쓰기 전 선행 조회)', async () => {
    h.db.teams = [own('t1', 'DEV')]
    h.referenced.mockRejectedValue(new Error('lookup down'))
    expect((await changeProjectTeamCode(P, 't1', 'ENG')).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('병합 미리보기·실행 — 공용 팀', () => {
  it('가드가 먼저다', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await previewTeamMerge(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_DENIED })
    expect(await mergeTeams(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })
  it('미리보기 — 원본 팀의 건수를 읽는다(쓰기 RPC 없음)', async () => {
    h.db.teams = [common('a', 'A'), common('b', 'B')]
    expect(await previewTeamMerge(WS, 'a', 'b')).toEqual({
      ok: true, counts: { itemOwners: 3, memberTeams: 2, areaTeams: 1, minutes: 4, minuteFolders: 1, invites: 0, credentials: 0 },
    })
    expect(h.db.rpcCalls).toEqual([{ fn: 'team_reference_counts', args: { p_team_id: 'a' } }])
  })
  it('자기 자신·범위 밖 팀·비활성 대상은 RPC 전에 거부한다', async () => {
    h.db.teams = [common('a', 'A'), common('b', 'B', { active: false }), own('p', 'P'), common('o', 'O', { workspace_id: 'ws-other' })]
    expect(await mergeTeams(WS, 'a', 'a')).toEqual({ ok: false, error: ERR_TEAM_MERGE_SAME })
    expect((await mergeTeams(WS, 'a', 'p')).ok).toBe(false)
    expect((await mergeTeams(WS, 'a', 'o')).ok).toBe(false)
    expect((await mergeTeams(WS, 'nope', 'a')).ok).toBe(false)
    expect(await mergeTeams(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_TEAM_MERGE_TARGET_INACTIVE })
    expect(await previewTeamMerge(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_TEAM_MERGE_TARGET_INACTIVE })
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('비활성 원본을 활성 대상으로 합칠 수 있다 — 행위자는 가드 결과, 대상 팀을 재색인한다', async () => {
    h.db.teams = [common('a', 'A', { active: false }), common('b', 'B')]
    const r = await mergeTeams(WS, 'a', 'b')
    expect(r).toEqual({
      ok: true,
      summary: {
        moved: { itemOwners: 2, memberTeams: 1, areaTeams: 1, minutes: 4, invites: 0, credentials: 0 },
        deduped: { itemOwners: 1, memberTeams: 1, areaTeams: 0 }, foldersRenamed: 1, sourceRefsLeft: 0,
      },
    })
    expect(h.db.rpcCalls).toEqual([{ fn: 'merge_teams', args: { p_actor: 'u-wsadmin', p_source_team_id: 'a', p_target_team_id: 'b' } }])
    expect(h.reindex).toHaveBeenCalledWith('b')
  })
  it('DB 판정의 거부는 고정 문구 — 원문은 싣지 않고, 실패하면 재색인하지 않는다', async () => {
    h.db.teams = [common('a', 'A'), common('b', 'B')]
    const fail = async (message: string, code: string) => {
      h.db.rpcResult.set('merge_teams', { data: null, error: { message, code } })
      return mergeTeams(WS, 'a', 'b')
    }
    expect(await fail('TEAM_MERGE_SCOPE_CONFLICT', '23514')).toEqual({ ok: false, error: ERR_TEAM_MERGE_SCOPE_CONFLICT })
    expect(await fail('TEAM_SCOPE_PROJECT_OWNED', '23514')).toEqual({ ok: false, error: ERR_TEAM_MERGE_SCOPE_CONFLICT })
    expect(await fail('TEAM_MERGE_FORBIDDEN', '42501')).toEqual({ ok: false, error: ERR_DENIED })
    expect(await fail('TEAM_MERGE_TARGET_INACTIVE', '23514')).toEqual({ ok: false, error: ERR_TEAM_MERGE_TARGET_INACTIVE })
    expect(await fail('update or delete on table "teams" violates foreign key constraint', '23503')).toEqual({ ok: false, error: ERR_TEAM_MERGE })
    expect(h.reindex).not.toHaveBeenCalled()
  })
  it('결과의 모양이 다르면 성공으로 위장하지 않는다', async () => {
    h.db.teams = [common('a', 'A'), common('b', 'B')]
    h.db.rpcResult.set('merge_teams', { data: { status: 'weird' }, error: null })
    expect(await mergeTeams(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_TEAM_MERGE })
    h.db.rpcResult.set('team_reference_counts', { data: { item_owners: 'many' }, error: null })
    expect(await previewTeamMerge(WS, 'a', 'b')).toEqual({ ok: false, error: ERR_TEAM_MERGE_PREVIEW })
  })
})

describe('병합 — 전용 팀', () => {
  it('가드가 먼저다', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await previewProjectTeamMerge(P, 'a', 'b')).toEqual({ ok: false, error: ERR_DENIED })
    expect(await mergeProjectTeams(P, 'a', 'b')).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.createAdminClient).not.toHaveBeenCalled()
  })
  it('그 프로젝트의 전용 팀 둘이어야 한다 — 공용 팀·다른 프로젝트의 팀은 RPC 전에 거부', async () => {
    h.db.teams = [own('a', 'A'), own('b', 'B'), common('c', 'C'), own('x', 'X', { project_id: 'p-other' })]
    expect((await mergeProjectTeams(P, 'a', 'c')).ok).toBe(false)
    expect((await mergeProjectTeams(P, 'a', 'x')).ok).toBe(false)
    expect((await previewProjectTeamMerge(P, 'c', 'a')).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
    expect((await previewProjectTeamMerge(P, 'a', 'b')).ok).toBe(true)
    expect((await mergeProjectTeams(P, 'a', 'b')).ok).toBe(true)
    expect(h.db.rpcCalls.at(-1)).toEqual({ fn: 'merge_teams', args: { p_actor: 'u-padmin', p_source_team_id: 'a', p_target_team_id: 'b' } })
    expect(rpcNames()).toEqual(['team_reference_counts', 'merge_teams'])
    expect(h.reindex).toHaveBeenCalledWith('b')
  })
})

describe('RPC 결과 해석(순수)', () => {
  it('건수 — 숫자가 아닌 칸이 하나라도 있으면 null', () => {
    expect(parseTeamRefCounts(h.COUNTS)).toMatchObject({ itemOwners: 3, minutes: 4 })
    expect(totalTeamRefs(parseTeamRefCounts(h.COUNTS)!)).toBe(11)
    expect(parseTeamRefCounts({ ...h.COUNTS, minutes: -1 })).toBeNull()
    expect(parseTeamRefCounts({ ...h.COUNTS, invites: undefined })).toBeNull()
    expect(parseTeamRefCounts(null)).toBeNull()
  })
  it('병합 결과 — status·건수 모양이 다르면 null', () => {
    expect(parseTeamMergeResult(h.MERGED)).toMatchObject({ foldersRenamed: 1, sourceRefsLeft: 0 })
    expect(parseTeamMergeResult({ ...h.MERGED, status: 'already' })).toBeNull()
    expect(parseTeamMergeResult({ ...h.MERGED, moved: null })).toBeNull()
    expect(parseTeamMergeResult({ ...h.MERGED, source_references: {} })).toBeNull()
  })
})
