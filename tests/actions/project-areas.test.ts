import { describe, it, expect, vi, beforeEach } from 'vitest'

// 담당 영역 관리 — 가드·검증·code 불변(액션 사전검사 + 트리거 오류 매핑)·area_teams 동기화 순서를 고정한다.
// 가드와 admin 클라이언트를 모킹한다(roster.test.ts 관례). 테이블마다 호출 순서대로 결과를 꺼내 쓴다.
const { guards, admin, revalidatePath } = vi.hoisted(() => ({
  guards: { requireProjectAdmin: vi.fn() },
  admin: { from: vi.fn() },
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => guards)
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('next/cache', () => ({ revalidatePath }))

import { listAreas, upsertArea } from '@/app/actions/projectAreas'
import { ERR_AREA_CODE_IMMUTABLE, type AreaInput } from '@/lib/domain/areas'
import { makeAdminActor } from '../fixtures/actor'

const P1 = 'p1'
const A1 = '00000000-0000-4000-8000-00000000a001'
const T1 = '00000000-0000-4000-8000-0000000000a1'
const T2 = '00000000-0000-4000-8000-0000000000a2'
const DENIED = { ok: false as const, error: '권한 없음' }

type Result = { data: unknown; error: { code?: string; message: string } | null }
type Chain = Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result>
function chain(result: Result): Chain {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'delete', 'update', 'insert', 'upsert']) c[m] = vi.fn(() => c)
  c.single = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Chain
}
/** 테이블별 결과 큐 — from(t) 가 불릴 때마다 다음 체인을 꺼내고, 불린 체인을 calls 에 남긴다. */
let queues: Record<string, Result[]>
let calls: Array<{ table: string; c: Chain }>
const ok = (data: unknown = null): Result => ({ data, error: null })

const INPUT: AreaInput = {
  kind: 'weekly_section', code: 'PLAN', name: '생산계획', sortOrder: 1, active: true,
  teams: [{ teamId: T1, kind: 'primary' }, { teamId: T2, kind: 'support' }],
}

beforeEach(() => {
  guards.requireProjectAdmin.mockReset(); admin.from.mockReset(); revalidatePath.mockReset()
  queues = {}; calls = []
  admin.from.mockImplementation((t: string) => {
    const r = queues[t]?.shift()
    if (!r) throw new Error('예상치 못한 테이블 접근: ' + t)
    const c = chain(r); calls.push({ table: t, c }); return c
  })
  guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeAdminActor(P1) })
})

describe('listAreas', () => {
  it('가드 거부면 조회하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await listAreas(P1, 'issue_area')).toEqual(DENIED)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('프로젝트·kind 로 좁혀 camelCase 로 돌려준다', async () => {
    queues.project_areas = [ok([{
      id: A1, kind: 'weekly_section', code: 'PLAN', name: '생산계획', sort_order: 1, active: true,
      area_teams: [{ team_id: T1, kind: 'primary' }],
    }])]
    const r = await listAreas(P1, 'weekly_section')
    expect(r).toEqual({ ok: true, areas: [{
      id: A1, kind: 'weekly_section', code: 'PLAN', name: '생산계획', sortOrder: 1, active: true,
      teams: [{ teamId: T1, kind: 'primary' }],
    }] })
    expect(calls[0].c.eq).toHaveBeenCalledWith('project_id', P1)
    expect(calls[0].c.eq).toHaveBeenCalledWith('kind', 'weekly_section')
  })

  it('조회 실패를 빈 목록으로 위장하지 않는다', async () => {
    queues.project_areas = [{ data: null, error: { message: 'boom' } }]
    expect((await listAreas(P1, 'weekly_section')).ok).toBe(false)
  })
})

describe('upsertArea', () => {
  it('가드 거부면 DB 를 건드리지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await upsertArea(P1, INPUT)).toEqual(DENIED)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('형상이 틀린 팀 id 는 DB 앞에서 거부', async () => {
    const r = await upsertArea(P1, { ...INPUT, teams: [{ teamId: 'x', kind: 'primary' }] })
    expect(r.ok).toBe(false)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('새 영역: 기존 목록 대조 → insert(project_id 포함) → 담당 팀 upsert → 목록 밖 팀 삭제', async () => {
    queues.project_areas = [ok([]), { data: { id: A1 }, error: null }]
    queues.area_teams = [ok(), ok()]
    expect(await upsertArea(P1, { ...INPUT, code: ' PLAN ' })).toEqual({ ok: true, id: A1 })
    const [, ins] = calls
    expect(ins.c.insert).toHaveBeenCalledWith({
      project_id: P1, kind: 'weekly_section', code: 'PLAN', name: '생산계획', sort_order: 1, active: true,
    })
    const [up, del] = calls.filter(x => x.table === 'area_teams')
    expect(up.c.upsert).toHaveBeenCalledWith(
      [{ area_id: A1, team_id: T1, kind: 'primary' }, { area_id: A1, team_id: T2, kind: 'support' }],
      { onConflict: 'area_id,team_id' },
    )
    expect(del.c.delete).toHaveBeenCalled()
    expect(del.c.eq).toHaveBeenCalledWith('area_id', A1)
    expect(del.c.not).toHaveBeenCalledWith('team_id', 'in', `(${T1},${T2})`)
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/settings`)
  })

  it('같은 kind 의 코드 중복은 쓰기 전에 거부', async () => {
    queues.project_areas = [ok([{ id: 'other', kind: 'weekly_section', code: 'PLAN' }])]
    const r = await upsertArea(P1, INPUT)
    expect(r).toEqual({ ok: false, error: "'PLAN' 코드가 이미 있습니다." })
    expect(calls).toHaveLength(1)
  })

  it('기존 영역의 코드 변경은 사전검사로 거부(트리거까지 가지 않는다)', async () => {
    queues.project_areas = [ok([{ id: A1, kind: 'weekly_section', code: 'PLAN' }])]
    const r = await upsertArea(P1, { ...INPUT, id: A1, code: 'PLAN2' })
    expect(r).toEqual({ ok: false, error: ERR_AREA_CODE_IMMUTABLE })
    expect(ERR_AREA_CODE_IMMUTABLE).toBe('영역 코드는 바꿀 수 없습니다. 새 영역을 만들고 이전 영역을 비활성으로 두세요.')
    expect(calls).toHaveLength(1)
  })

  it('이 프로젝트에 없는 id 는 거부', async () => {
    queues.project_areas = [ok([])]
    expect((await upsertArea(P1, { ...INPUT, id: A1 })).ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('기존 영역: code 를 보내지 않고 이 프로젝트 행만 update, 팀 0개면 전부 삭제', async () => {
    queues.project_areas = [ok([{ id: A1, kind: 'weekly_section', code: 'PLAN' }]), ok([{ id: A1 }])]
    queues.area_teams = [ok()]
    expect(await upsertArea(P1, { ...INPUT, id: A1, active: false, teams: [] })).toEqual({ ok: true, id: A1 })
    const upd = calls[1]
    expect(upd.c.update).toHaveBeenCalledWith({ name: '생산계획', sort_order: 1, active: false })
    expect(upd.c.eq).toHaveBeenCalledWith('id', A1)
    expect(upd.c.eq).toHaveBeenCalledWith('project_id', P1)
    const del = calls[2]
    expect(del.table).toBe('area_teams')
    expect(del.c.delete).toHaveBeenCalled()
    expect(del.c.not).not.toHaveBeenCalled()
  })

  it('트리거의 code 불변 오류는 같은 안내 문구로 바꾼다(경쟁 조건 대비)', async () => {
    queues.project_areas = [
      ok([{ id: A1, kind: 'weekly_section', code: 'PLAN' }]),
      { data: null, error: { code: '23514', message: 'PROJECT_AREA_CODE_IMMUTABLE' } },
    ]
    expect(await upsertArea(P1, { ...INPUT, id: A1 })).toEqual({ ok: false, error: ERR_AREA_CODE_IMMUTABLE })
  })

  it('유니크 위반(23505)은 코드 중복 문구로', async () => {
    queues.project_areas = [ok([]), { data: null, error: { code: '23505', message: 'dup' } }]
    expect(await upsertArea(P1, INPUT)).toEqual({ ok: false, error: "'PLAN' 코드가 이미 있습니다." })
  })

  it('다른 프로젝트 팀(AREA_TEAM_SCOPE)은 안내 문구로, 담당 팀 삭제 단계로 가지 않는다', async () => {
    queues.project_areas = [ok([]), { data: { id: A1 }, error: null }]
    queues.area_teams = [{ data: null, error: { code: '23514', message: 'AREA_TEAM_SCOPE' } }]
    const r = await upsertArea(P1, INPUT)
    expect(r).toEqual({ ok: false, error: '영역은 저장했지만 담당 팀을 저장하지 못했습니다: 이 프로젝트에서 쓸 수 없는 팀입니다.' })
    expect(calls.filter(x => x.table === 'area_teams')).toHaveLength(1)
  })

  it('선행 조회 실패면 쓰지 않는다', async () => {
    queues.project_areas = [{ data: null, error: { message: 'boom' } }]
    expect((await upsertArea(P1, INPUT)).ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
