// SP5 B2(스펙 §3.4·D18~D20·D49~D52) — 회의록 폴더·회의록의 팀 id. 케이스는 begin…rollback, 두 연결 경합만 전용 워크스페이스를 커밋하고 지운다.
// 공용 팀 생성 한 길(create_team·세션 INSERT 정책 삭제), 루트 보장·개명 동기, 세션 위조 다섯(D49), 범위 가드(D51), code 단위 해석(D18),
// M1 두 표, 전환 RPC 두 표(비활성 공용 팀만 가리키는 회의록 포함), 프로젝트 삭제 통과(E28), create_team 대 모드 전환 경합.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000024${nn}`
const W = ID('00')                       // 케이스 전용 워크스페이스(롤백)
const P = ID('01')
const Q = ID('02')
const CREATE = 'select public.create_team($1, $2, $3, $4, $5, $6) as id'
const ENSURE = 'select public.ensure_team_roots($1, $2) as n'
const ROOT_OF = `select id, name, kind from public.minute_folders where kind = 'team_root' and team_id = $1 and project_id is not distinct from $2`

async function seedWorkspace(c: PoolClient) {
  await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp5-b2', 'B2 회의록 팀')`, [W])
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3), ($4, $5, $3)', [P, 'B2 P', W, Q, 'B2 Q'])
}
const setMode = (c: PoolClient, ws: string, mode: unknown) => c.query(
  `update public.workspace_settings set "values" = "values" || jsonb_build_object('minutes.root_folders', $2::jsonb) where workspace_id = $1`,
  [ws, JSON.stringify(mode)])
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}
async function toServer(c: PoolClient) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}
const insertMinute = (c: PoolClient, v: { project: string | null; ws: string; code: string; id?: string }) => c.query<{ id: string; team_id: string | null; team_code: string }>(
  `insert into public.minutes (${v.id ? 'id, ' : ''}project_id, workspace_id, minute_date, team_code, title, body_md)
   values (${v.id ? '$5, ' : ''}$1, $2, '2026-10-04', $3, $4, '# b2') returning id, team_id, team_code`,
  v.id ? [v.project, v.ws, v.code, 'B2 회의록', v.id] : [v.project, v.ws, v.code, 'B2 회의록'])

describe('create_team — 공용 팀 생성 한 길(D19 ①·D50)', () => {
  it('세션은 실행하지 못하고, 워크스페이스 관리자가 아니면 TEAM_CREATE_FORBIDDEN', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      await toSession(c, F.users.platform)
      expect(await pgError(c, CREATE, [F.users.platform, W, 'RND', '연구', null, 0]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function create_team') })
      await toServer(c)
      expect(await pgError(c, CREATE, [F.users.member, W, 'RND', '연구', null, 0])).toMatchObject({ code: '42501', message: 'TEAM_CREATE_FORBIDDEN' })
      expect(await pgError(c, CREATE, [F.users.platform, W, ' ', '연구', null, 0])).toMatchObject({ code: '22023', message: 'TEAM_CREATE_INVALID_INPUT' })
    })
  })
  it('teams 모드: 팀과 워크스페이스 팀 루트(이름 = 팀 이름)가 한 트랜잭션에, custom 모드: 폴더 0', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const id = (await c.query(CREATE, [F.users.platform, W, 'RND', ' 연구 ', '#1d4ed8', 2])).rows[0].id
      expect((await c.query(ROOT_OF, [id, null])).rows).toEqual([expect.objectContaining({ name: '연구', kind: 'team_root' })])
      await setMode(c, W, { mode: 'custom', names: ['경영'] })
      const id2 = (await c.query(CREATE, [F.users.platform, W, 'OPS', '운영', null, 3])).rows[0].id
      expect((await c.query(ROOT_OF, [id2, null])).rowCount).toBe(0)
      expect((await c.query('select count(*)::int as n from public.teams where id = $1', [id2])).rows[0].n).toBe(1)
    })
  })
  it('루트 이름이 겹치거나 60자를 넘으면 팀도 만들지 않는다(원자성 — W35·R9)', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])
      expect(await pgError(c, CREATE, [F.users.platform, W, 'RND2', '연구', null, 1])).toMatchObject({ code: '23505', message: 'TEAM_ROOT_NAME_CONFLICT' })
      expect(await pgError(c, CREATE, [F.users.platform, W, 'LONG', 'x'.repeat(61), null, 1])).toMatchObject({ code: '23514', message: 'TEAM_ROOT_NAME_TOO_LONG' })
      expect((await c.query(`select count(*)::int as n from public.teams where workspace_id = $1 and code in ('RND2', 'LONG')`, [W])).rows[0].n).toBe(0)
    })
  })
  it('세션은 공용 팀을 직접 넣지 못한다(정책 삭제) — 프로젝트 팀 정책 경로는 남는다(R1)', async () => {
    await asService(pool, async (c) => {
      await toSession(c, F.users.wsAdmin)
      expect(await pgError(c, `insert into public.teams (workspace_id, project_id, code, name) values ($1, null, 'B2X', 'B2X')`, [F.ws]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, `insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'B2P', 'B2P')`, [F.ws, F.projects.a])).toBeNull()
    })
  })
})

describe('ensure_team_roots·개명 동기(D20·D50·D52)', () => {
  it('teams 모드면 루트 없는 활성 공용 팀만 만들고 멱등, custom 이면 0', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      await setMode(c, W, { mode: 'custom', names: ['경영'] })
      const a = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      await c.query(`insert into public.teams (workspace_id, code, name, active) values ($1, 'OFF', '꺼진 팀', false)`, [W])
      expect((await c.query(ENSURE, [F.users.platform, W])).rows[0].n).toBe(0)
      await setMode(c, W, { mode: 'teams' })
      expect((await c.query(ENSURE, [F.users.platform, W])).rows[0].n).toBe(1)
      expect((await c.query(ENSURE, [F.users.platform, W])).rows[0].n).toBe(0)
      expect((await c.query(ROOT_OF, [a, null])).rowCount).toBe(1)
      expect(await pgError(c, ENSURE, [F.users.member, W])).toMatchObject({ code: '42501', message: 'TEAM_ROOTS_FORBIDDEN' })
    })
  })
  it('개명하면 루트 이름이 따라오고 id 는 그대로, 겹치면 TEAM_ROOT_NAME_CONFLICT·61자는 TEAM_ROOT_NAME_TOO_LONG(팀 이름도 그대로)', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const a = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      await c.query(CREATE, [F.users.platform, W, 'OPS', '운영', null, 1])
      const before = (await c.query(ROOT_OF, [a, null])).rows[0]
      await c.query(`update public.teams set name = '연구개발' where id = $1`, [a])
      expect((await c.query(ROOT_OF, [a, null])).rows[0]).toEqual({ ...before, name: '연구개발' })
      expect(await pgError(c, `update public.teams set name = '운영' where id = $1`, [a])).toMatchObject({ code: '23505', message: 'TEAM_ROOT_NAME_CONFLICT' })
      expect(await pgError(c, `update public.teams set name = $2 where id = $1`, [a, 'y'.repeat(61)])).toMatchObject({ code: '23514', message: 'TEAM_ROOT_NAME_TOO_LONG' })
      expect((await c.query('select name from public.teams where id = $1', [a])).rows[0].name).toBe('연구개발')
    })
  })
})

describe('종류 가드 — 세션 위조 다섯(D49)', () => {
  /** A 워크스페이스 공용 팀 SHR 의 루트 + 그 아래 남(bea 아님 — 플랫폼 관리자)의 하위 폴더 */
  async function seedRoot(c: PoolClient) {
    const root = (await c.query(`select public.minute_team_root_insert($1, null, $2, 'SHR 루트', 100) as id`, [F.ws, F.teams.aShared])).rows[0].id
    const child = (await c.query(`insert into public.minute_folders (name, parent_id, workspace_id, created_by) values ('남의 하위', $1, $2, $3) returning id`,
      [root, F.ws, F.users.platform])).rows[0].id
    return { root, child }
  }
  it('① 팀·사용자 지정 루트를 만들지 못한다 ② 종류·팀을 바꾸지 못한다', async () => {
    await asService(pool, async (c) => {
      await seedRoot(c)
      await toSession(c, F.users.member)
      const FORBIDDEN = { code: '42501', message: 'MINUTE_FOLDER_KIND_FORBIDDEN' }
      expect(await pgError(c, `insert into public.minute_folders (name, workspace_id, created_by, kind, team_id) values ('선점', $1, $2, 'team_root', $3)`,
        [F.ws, F.users.member, F.teams.aShared])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, `insert into public.minute_folders (name, workspace_id, created_by, kind) values ('선점2', $1, $2, 'custom_root')`,
        [F.ws, F.users.member])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, `update public.minute_folders set kind = 'custom_root' where id = '00000000-0000-0000-7e57-00000000110d'`)).toMatchObject(FORBIDDEN)
      expect(await pgError(c, `update public.minute_folders set team_id = $1 where id = '00000000-0000-0000-7e57-00000000110d'`, [F.teams.aShared])).toMatchObject(FORBIDDEN)
    })
  })
  it('③ 팀 루트를 지우지 못하고 남의 하위 폴더도 남는다 — 루트 이름·위치도 못 바꾼다', async () => {
    await asService(pool, async (c) => {
      const { root, child } = await seedRoot(c)
      await toSession(c, F.users.wsAdmin)
      expect(await pgError(c, 'delete from public.minute_folders where id = $1', [root])).toMatchObject({ code: '42501', message: 'MINUTE_FOLDER_KIND_FORBIDDEN' })
      expect(await pgError(c, `update public.minute_folders set name = '바꿈' where id = $1`, [root])).toMatchObject({ code: '42501' })
      await toServer(c)
      expect((await c.query('select count(*)::int as n from public.minute_folders where id in ($1, $2)', [root, child])).rows[0].n).toBe(2)
    })
  })
  it('④ 비활성 팀 루트 아래로는 만들거나 옮기지 못한다(활성이면 된다)', async () => {
    await asService(pool, async (c) => {
      const { root } = await seedRoot(c)
      await toSession(c, F.users.member)
      expect(await pgError(c, `insert into public.minute_folders (name, parent_id, workspace_id, created_by) values ('활성 아래', $1, $2, $3)`,
        [root, F.ws, F.users.member])).toBeNull()
      await toServer(c)
      await c.query('update public.teams set active = false where id = $1', [F.teams.aShared])
      await toSession(c, F.users.member)
      expect(await pgError(c, `insert into public.minute_folders (name, parent_id, workspace_id, created_by) values ('꺼진 아래', $1, $2, $3)`,
        [root, F.ws, F.users.member])).toMatchObject({ code: '23514', message: 'MINUTE_FOLDER_ROOT_INACTIVE' })
      const mine = (await c.query(`select id from public.minute_folders where name = '활성 아래'`)).rows[0].id
      expect(await pgError(c, `update public.minute_folders set parent_id = $2 where id = $1`, [mine, root])).toBeNull()   // 같은 부모(이동 아님)
    })
  })
  it('⑤ 최상위 일반 폴더가 같은 범위 팀 이름을 선점하지 못한다(개명·최상위 이동으로도)', async () => {
    await asService(pool, async (c) => {
      await toSession(c, F.users.member)
      const RESERVED = { code: '23505', message: 'MINUTE_FOLDER_NAME_RESERVED' }
      expect(await pgError(c, `insert into public.minute_folders (name, workspace_id, created_by) values ('SHR', $1, $2)`, [F.ws, F.users.member])).toMatchObject(RESERVED)
      expect(await pgError(c, `update public.minute_folders set name = 'SHR' where id = '00000000-0000-0000-7e57-00000000112c'`)).toMatchObject(RESERVED)
    })
  })
})

describe('범위 가드(D51)·code 단위 해석(D18)·M1', () => {
  it('교차 워크스페이스·교차 프로젝트 team_id 는 MINUTE_TEAM_SCOPE(회의록·폴더 둘 다)', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const pTeam = (await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'PRJ', 'P 전용') returning id`, [W, P])).rows[0].id
      const m = (await insertMinute(c, { project: Q, ws: W, code: 'ZZZ' })).rows[0].id
      const SCOPE = { code: '23514', message: 'MINUTE_TEAM_SCOPE' }
      expect(await pgError(c, 'update public.minutes set team_id = $2 where id = $1', [m, pTeam]), '다른 프로젝트 전용').toMatchObject(SCOPE)
      expect(await pgError(c, 'update public.minutes set team_id = $2 where id = $1', [m, F.teams.aShared]), '다른 워크스페이스').toMatchObject(SCOPE)
      expect(await pgError(c, `insert into public.minute_folders (name, workspace_id, project_id, kind, team_id) values ('Q 루트', $1, $2, 'team_root', $3)`, [W, Q, pTeam]))
        .toMatchObject(SCOPE)
    })
  })
  it('code 단위: 그 프로젝트 전용 → 없으면 공용, 다른 프로젝트 전용은 고르지 않는다, 전용이 비활성이면 MINUTE_TEAM_INVALID', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const shared = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      const own = (await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RND', 'P 연구') returning id`, [W, P])).rows[0].id
      await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'QON', 'Q 전용')`, [W, Q])
      expect((await insertMinute(c, { project: P, ws: W, code: 'RND' })).rows[0].team_id).toBe(own)
      expect((await insertMinute(c, { project: Q, ws: W, code: 'RND' })).rows[0].team_id).toBe(shared)
      expect((await insertMinute(c, { project: null, ws: W, code: 'RND' })).rows[0].team_id).toBe(shared)
      expect((await insertMinute(c, { project: P, ws: W, code: 'QON' })).rows[0].team_id).toBeNull()
      await c.query('update public.teams set active = false where id = $1', [own])
      expect(await pgError(c, `insert into public.minutes (project_id, workspace_id, minute_date, team_code, title) values ($1, $2, '2026-10-04', 'RND', 'x')`, [P, W]))
        .toMatchObject({ code: '23503', message: 'MINUTE_TEAM_INVALID' })
    })
  })
  it('메아리 — team_id 를 바꾸면 team_code 가 따라오고, 프로젝트를 바꾸면 그 범위로 다시 해석한다(재편철 — S13)', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const shared = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      const ops = (await c.query(CREATE, [F.users.platform, W, 'OPS', '운영', null, 1])).rows[0].id
      const own = (await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RND', 'P 연구') returning id`, [W, P])).rows[0].id
      const m = (await insertMinute(c, { project: Q, ws: W, code: 'RND' })).rows[0]
      expect(m.team_id).toBe(shared)
      await c.query('update public.minutes set team_id = $2 where id = $1', [m.id, ops])
      expect((await c.query('select team_code from public.minutes where id = $1', [m.id])).rows[0].team_code).toBe('OPS')
      await c.query(`update public.minutes set team_code = 'RND' where id = $1`, [m.id])
      await c.query('update public.minutes set project_id = $2 where id = $1', [m.id, P])
      expect((await c.query('select team_id from public.minutes where id = $1', [m.id])).rows[0].team_id).toBe(own)
    })
  })
  it('M1 — 같은 code 전용 팀이 있는 프로젝트의 회의록·폴더가 공용 팀을 새로 가리키면 TEAM_SCOPE_PROJECT_OWNED, 그대로인 UPDATE 는 통과', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const shared = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      const m = (await insertMinute(c, { project: P, ws: W, code: 'RND' })).rows[0].id   // 전용 팀 생기기 전 — 공용
      await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RND', 'P 연구')`, [W, P])
      expect(await pgError(c, `update public.minutes set title = '그대로' where id = $1`, [m])).toBeNull()
      // 팀을 직접 고르는 쓰기(메아리의 재해석이 아니라) — 해석되지 않는 code 의 회의록에 공용 RND 를 붙인다
      const m2 = (await insertMinute(c, { project: P, ws: W, code: 'ZZZ' })).rows[0].id
      expect(await pgError(c, 'update public.minutes set team_id = $2 where id = $1', [m2, shared]))
        .toMatchObject({ code: '23514', message: 'TEAM_SCOPE_PROJECT_OWNED' })
      expect(await pgError(c, `insert into public.minute_folders (name, workspace_id, project_id, kind, team_id) values ('P 공용 루트', $1, $2, 'team_root', $3)`, [W, P, shared]))
        .toMatchObject({ code: '23514', message: 'TEAM_SCOPE_PROJECT_OWNED' })
    })
  })
})

describe('전환 RPC 두 표·프로젝트 삭제(D19 ③·E28)', () => {
  it('전환이 회의록·폴더를 새 전용 팀으로 옮긴다 — 비활성 공용 팀만 가리키는 회의록도 복사·이동', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const rnd = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      const old = (await c.query(`insert into public.teams (workspace_id, code, name) values ($1, 'OLD', '옛 팀') returning id`, [W])).rows[0].id
      const m1 = (await insertMinute(c, { project: P, ws: W, code: 'RND' })).rows[0].id
      const m2 = (await insertMinute(c, { project: P, ws: W, code: 'OLD' })).rows[0].id
      await c.query('update public.teams set active = false where id = $1', [old])
      const pRoot = (await c.query(`select public.minute_team_root_insert($1, $2, $3, '연구', 100) as id`, [W, P, rnd])).rows[0].id
      const r = (await c.query('select public.convert_inherited_teams($1, $2) as r', [F.users.platform, P])).rows[0].r
      expect(r).toMatchObject({ status: 'converted', moved: { minutes: 2, minute_folders: 1 } })
      const rows = (await c.query(`select m.id, t.project_id, t.code, t.active, m.team_code from public.minutes m join public.teams t on t.id = m.team_id
                                    where m.id in ($1, $2) order by t.code`, [m1, m2])).rows
      expect(rows).toEqual([
        { id: m2, project_id: P, code: 'OLD', active: false, team_code: 'OLD' },
        { id: m1, project_id: P, code: 'RND', active: true, team_code: 'RND' },
      ])
      expect((await c.query('select t.project_id from public.minute_folders f join public.teams t on t.id = f.team_id where f.id = $1', [pRoot])).rows[0].project_id).toBe(P)
    })
  })
  it('전용 팀·회의록·폴더가 있는 프로젝트를 지울 수 있다(회의록은 무프로젝트·공용 팀으로 남는다)', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const shared = (await c.query(CREATE, [F.users.platform, W, 'RND', '연구', null, 0])).rows[0].id
      const own = (await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RND', 'P 연구') returning id`, [W, P])).rows[0].id
      await c.query(`select public.minute_team_root_insert($1, $2, $3, 'P 연구', 100)`, [W, P, own])
      const m = (await insertMinute(c, { project: P, ws: W, code: 'RND' })).rows[0].id
      expect(await pgError(c, 'delete from public.projects where id = $1', [P])).toBeNull()
      expect((await c.query('select project_id, team_id, team_code from public.minutes where id = $1', [m])).rows[0])
        .toEqual({ project_id: null, team_id: shared, team_code: 'RND' })
    })
  })
})

describe('create_team 대 모드 전환 경합(D50 — 두 연결, 커밋)', () => {
  const WR = ID('10')
  it('전환(custom → teams)이 설정 행을 잡은 동안 create_team 은 기다렸다가 teams 모드로 루트를 만들고, 뒤따른 ensure 는 0 — 루트 없는 활성 팀 0', async () => {
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp5-b2-race', 'B2 경합')`, [WR])
      await setMode(a, WR, { mode: 'custom', names: ['경영'] })
      await a.query('begin')
      await setMode(a, WR, { mode: 'teams' })                 // 설정 쓰기 = 행 잠금(FOR UPDATE 와 같은 효과)
      const created = b.query(CREATE, [F.users.platform, WR, 'RND', '연구', null, 0])
      await new Promise((r) => setTimeout(r, 300))
      await a.query('commit')
      const id = (await created).rows[0].id
      expect((await a.query(ENSURE, [F.users.platform, WR])).rows[0].n).toBe(0)
      expect((await a.query(ROOT_OF, [id, null])).rowCount).toBe(1)
      expect((await a.query(`select count(*)::int as n from public.teams t where t.workspace_id = $1 and t.project_id is null and t.active
        and not exists (select 1 from public.minute_folders f where f.kind = 'team_root' and f.team_id = t.id and f.project_id is null)`, [WR])).rows[0].n).toBe(0)
    } finally {
      await a.query('rollback').catch(() => undefined)
      b.release()
      await a.query(`delete from public.minute_folders where workspace_id = $1`, [WR])
      await a.query('delete from public.workspaces where id = $1', [WR])
      a.release()
    }
  })
})
