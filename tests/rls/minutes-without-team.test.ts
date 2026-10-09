// 팀 없는 회의록(*_minutes_without_team — 팀 유연화 2단계 ③). 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
// "팀 없음"은 team_code '' + team_id null 이다. 생성·메타 RPC 가 빈 값을 받는지, 값이 있는 틀린 코드는 지금처럼 거부되는지,
// 지정 ↔ 해제 왕복에서 메아리 트리거가 team_id 를 맞추는지, 팀 행이 지워진 옛 회의록의 team_code 원문은 그대로인지(해제와 구분),
// 빈 값에서도 색인 큐가 등록되는지, 세션은 여전히 이 RPC·표를 직접 쓰지 못하는지 본다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000052${nn}`
const W = ID('00')                       // 케이스 전용 워크스페이스(롤백) — 팀이 하나도 없다
/** $1 id · $2 팀 코드 · $3 프로젝트 · $4 워크스페이스(프로젝트가 있으면 null) */
const CREATE = `select * from public.create_minute_with_version($1, '2026-10-09', $2, '팀 없는 회의록', '# t', public.wiki_fnv1a64('# t'),
  null, $3, null, null, null, $5, 'alice', null, null, null, null, $4)`
const META = 'select * from public.update_minute_metadata_with_wiki_retraction($1, $2::jsonb)'
const TEAM_OF = 'select team_id, team_code from public.minutes where id = $1'
const INVALID_TEAM = { code: '23503', message: 'MINUTE_TEAM_INVALID' }

const create = (c: PoolClient, id: string, code: string | null, project: string | null, ws: string | null) =>
  pgError(c, CREATE, [id, code, project, ws, F.users.member])
const meta = (c: PoolClient, id: string, patch: Record<string, unknown>) => pgError(c, META, [id, JSON.stringify(patch)])
const teamOf = async (c: PoolClient, id: string) => (await c.query<{ team_id: string | null; team_code: string }>(TEAM_OF, [id])).rows[0]
const indexJob = async (c: PoolClient, project: string | null, id: string) =>
  (await c.query<{ workspace_id: string; operation: string; generation: number }>(
    'select workspace_id, operation, generation::int as generation from public.ai_index_jobs where job_key = $1',
    [`v1:${project ?? 'global'}:minutes:minute:${id}`])).rows[0]

describe('실행권 — 세션은 회의록 RPC·표를 직접 쓰지 못한다(기존과 같다)', () => {
  it('JWT 세션은 생성·메타 RPC 를 실행하지 못한다(42501) — 플랫폼 관리자여도, 빈 팀 코드여도', async () => {
    for (const user of [F.users.platform, F.users.wsAdmin, F.users.member]) {
      await asUser(pool, user, async (c) => {
        // 해시는 글자로 — 인자 식의 wiki_fnv1a64 도 세션이 실행하지 못해 그쪽 거부가 먼저 난다
        expect(await pgError(c, CREATE.replaceAll(`public.wiki_fnv1a64('# t')`, `'0'`), [ID('01'), '', F.projects.a, null, user]))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function create_minute_with_version') })
        expect(await pgError(c, META, [F.rows.minute, JSON.stringify({ team_code: '' })]))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function update_minute_metadata_with_wiki_retraction') })
      })
    }
  })
  it('세션의 직접 UPDATE 로 팀을 비우지 못한다(쓰기 정책 없음 — 0행 또는 42501)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const err = await pgError(c, `update public.minutes set team_code = '' where id = $1`, [F.rows.minute])
      if (err) expect(err.code).toBe('42501')
    })
    await asService(pool, async (c) => {
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: F.teams.erp, team_code: 'ERP' })
    })
  })
})

describe('create_minute_with_version — 빈 팀 코드', () => {
  it('프로젝트 회의록·무프로젝트 회의록을 팀 없이 만든다 — team_id null, team_code 빈 값, v1 스냅샷도 빈 값', async () => {
    await asService(pool, async (c) => {
      expect(await create(c, ID('01'), '', F.projects.a, null)).toBeNull()
      expect(await create(c, ID('02'), '', null, F.ws)).toBeNull()
      for (const id of [ID('01'), ID('02')]) {
        expect(await teamOf(c, id)).toEqual({ team_id: null, team_code: '' })
        expect((await c.query('select version_no, team_code from public.minute_versions where minute_id = $1', [id])).rows)
          .toEqual([{ version_no: 1, team_code: '' }])
      }
      expect((await c.query('select project_id, workspace_id from public.minutes where id = $1', [ID('01')])).rows[0])
        .toEqual({ project_id: F.projects.a, workspace_id: F.ws })
    })
  })
  it('팀이 하나도 없는 워크스페이스에서도 만든다 — 팀 코드를 적으면 지금처럼 MINUTE_TEAM_INVALID', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-no-team', '팀 없는 곳')`, [W])
      expect((await c.query('select count(*)::int as n from public.teams where workspace_id = $1', [W])).rows[0].n).toBe(0)
      expect(await create(c, ID('03'), 'ERP', null, W)).toMatchObject(INVALID_TEAM)
      expect(await create(c, ID('03'), '', null, W)).toBeNull()
      expect(await teamOf(c, ID('03'))).toEqual({ team_id: null, team_code: '' })
    })
  })
  it('null·공백뿐인 값은 입력 오류 그대로이고, 값이 있는 틀린 코드·다른 워크스페이스의 코드·비활성 팀은 MINUTE_TEAM_INVALID 그대로다', async () => {
    await asService(pool, async (c) => {
      const INPUT = { code: '22023', message: 'MINUTE_CREATE_INPUT_INVALID' }
      expect(await create(c, ID('04'), null, F.projects.a, null)).toMatchObject(INPUT)
      expect(await create(c, ID('04'), '  ', F.projects.a, null)).toMatchObject(INPUT)
      expect(await create(c, ID('04'), 'NOPE', F.projects.a, null)).toMatchObject(INVALID_TEAM)
      expect(await create(c, ID('04'), 'OPS', F.projects.a, null)).toMatchObject(INVALID_TEAM)       // B 워크스페이스의 팀 코드
      await c.query('update public.teams set active = false where id = $1', [F.teams.mes])
      expect(await create(c, ID('04'), 'MES', F.projects.a, null)).toMatchObject(INVALID_TEAM)
      expect((await c.query('select 1 from public.minutes where id = $1', [ID('04')])).rowCount).toBe(0)
      expect(await create(c, ID('04'), 'ERP', F.projects.a, null)).toBeNull()                        // 양성 대조 — 팀 있는 생성은 그대로
      expect(await teamOf(c, ID('04'))).toEqual({ team_id: F.teams.erp, team_code: 'ERP' })
    })
  })
})

describe('update_minute_metadata_with_wiki_retraction — 팀 지정 ↔ 해제', () => {
  it('지정 → 해제 → 재지정 왕복 — 메아리 트리거가 team_id 를 null·그 팀으로 맞추고, 그때마다 색인 큐에 오른다', async () => {
    await asService(pool, async (c) => {
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: F.teams.erp, team_code: 'ERP' })
      expect(await meta(c, F.rows.minute, { team_code: '' })).toBeNull()
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: null, team_code: '' })
      const released = await indexJob(c, F.projects.a, F.rows.minute)
      expect(released).toMatchObject({ workspace_id: F.ws, operation: 'upsert' })
      expect(await meta(c, F.rows.minute, { team_code: 'ERP' })).toBeNull()
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: F.teams.erp, team_code: 'ERP' })
      expect((await indexJob(c, F.projects.a, F.rows.minute)).generation).toBe(released.generation + 1)
      // 같은 값(빈 값 → 빈 값)은 색인 본문이 바뀌지 않았다 — 큐 세대가 오르지 않는다
      await meta(c, F.rows.minute, { team_code: '' })
      const again = (await indexJob(c, F.projects.a, F.rows.minute)).generation
      expect(await meta(c, F.rows.minute, { team_code: '' })).toBeNull()
      expect((await indexJob(c, F.projects.a, F.rows.minute)).generation).toBe(again)
    })
  })
  it('무프로젝트 회의록도 해제·재지정된다 — 색인 큐는 회의록 행의 워크스페이스로 오른다', async () => {
    await asService(pool, async (c) => {
      expect(await meta(c, F.rows.nullMinute, { team_code: 'SHR' })).toBeNull()             // 공용 팀으로 지정
      expect(await teamOf(c, F.rows.nullMinute)).toEqual({ team_id: F.teams.aShared, team_code: 'SHR' })
      expect(await meta(c, F.rows.nullMinute, { team_code: '' })).toBeNull()
      expect(await teamOf(c, F.rows.nullMinute)).toEqual({ team_id: null, team_code: '' })
      expect(await indexJob(c, null, F.rows.nullMinute)).toMatchObject({ workspace_id: F.ws, operation: 'upsert' })
      expect(await meta(c, F.rows.nullMinute, { team_code: 'SHR' })).toBeNull()
      expect(await teamOf(c, F.rows.nullMinute)).toEqual({ team_id: F.teams.aShared, team_code: 'SHR' })
    })
  })
  it('팀 없는 회의록의 다른 메타(제목·폴더 해제)와 본문 새 버전이 통과하고 팀 없음을 유지한다 — 새 버전 스냅샷도 빈 값', async () => {
    await asService(pool, async (c) => {
      await meta(c, F.rows.minute, { team_code: '' })
      expect(await meta(c, F.rows.minute, { title: '팀 없이 바꾼 제목', folder_id: null })).toBeNull()
      expect((await c.query('select title, team_id, team_code, folder_id from public.minutes where id = $1', [F.rows.minute])).rows[0])
        .toEqual({ title: '팀 없이 바꾼 제목', team_id: null, team_code: '', folder_id: null })
      const body = '# 팀 없는 새 본문'
      await c.query(
        `select * from public.commit_minute_body_version($1, $2, public.wiki_fnv1a64($2), null, null, null, null, $3, 'alice')`,
        [F.rows.minute, body, F.users.member])
      const versions = (await c.query('select team_code from public.minute_versions where minute_id = $1 order by version_no', [F.rows.minute])).rows
      expect(versions[0].team_code).toBe('ERP')            // 옛 버전 스냅샷은 그대로다
      expect(versions.at(-1)!.team_code).toBe('')
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: null, team_code: '' })
    })
  })
  it('JSON null 은 MINUTE_METADATA_REQUIRED, 값이 있는 틀린 코드·비활성 팀은 MINUTE_TEAM_INVALID 그대로 — 거부되면 행이 그대로다', async () => {
    await asService(pool, async (c) => {
      expect(await meta(c, F.rows.minute, { team_code: null })).toMatchObject({ code: '23502', message: 'MINUTE_METADATA_REQUIRED' })
      expect(await meta(c, F.rows.minute, { team_code: 'NOPE' })).toMatchObject(INVALID_TEAM)
      await c.query('update public.teams set active = false where id = $1', [F.teams.mes])
      expect(await meta(c, F.rows.minute, { team_code: 'MES' })).toMatchObject(INVALID_TEAM)
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: F.teams.erp, team_code: 'ERP' })
      // 팀 없는 상태에서 틀린 코드로 가는 것도 막힌다(빈 값 허용이 검증을 통째로 끄지 않았다)
      await meta(c, F.rows.minute, { team_code: '' })
      expect(await meta(c, F.rows.minute, { team_code: 'NOPE' })).toMatchObject(INVALID_TEAM)
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: null, team_code: '' })
    })
  })
})

describe('"사용자가 해제함"과 "팀 행이 지워짐"은 다른 상태다', () => {
  it('팀이 SQL 로 지워진 옛 회의록은 team_id 만 null 이 되고 team_code 원문이 남는다 — 팀 없음(빈 값)으로 바뀌지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-no-team', '팀 없는 곳')`, [W])
      const team = (await c.query<{ id: string }>(
        `insert into public.teams (workspace_id, project_id, code, name) values ($1, null, 'OLD', '옛 팀') returning id`, [W])).rows[0].id
      expect(await create(c, ID('05'), 'OLD', null, W)).toBeNull()
      expect(await create(c, ID('06'), '', null, W)).toBeNull()
      expect(await teamOf(c, ID('05'))).toEqual({ team_id: team, team_code: 'OLD' })
      await c.query('delete from public.minute_folders where team_id = $1', [team])   // 팀 루트가 있으면 FK 가 삭제를 막는다
      await c.query('delete from public.teams where id = $1', [team])
      expect(await teamOf(c, ID('05'))).toEqual({ team_id: null, team_code: 'OLD' })   // 원문 보존
      expect(await teamOf(c, ID('06'))).toEqual({ team_id: null, team_code: '' })
      // "팀 없음" 필터(team_id is null and team_code = '')는 지워진 팀의 옛 회의록을 고르지 않는다
      expect((await c.query(`select id from public.minutes where workspace_id = $1 and team_id is null and team_code = '' order by id`, [W])).rows)
        .toEqual([{ id: ID('06') }])
      // 옛 회의록의 메타 변경은 지금처럼 살아 있는 팀을 요구한다(원문이 조용히 지워지지 않는다) — 명시적으로 해제하면 팀 없음이 된다
      expect(await meta(c, ID('05'), { title: '제목만' })).toMatchObject(INVALID_TEAM)
      expect(await teamOf(c, ID('05'))).toEqual({ team_id: null, team_code: 'OLD' })
      expect(await meta(c, ID('05'), { title: '제목과 해제', team_code: '' })).toBeNull()
      expect(await teamOf(c, ID('05'))).toEqual({ team_id: null, team_code: '' })
    })
  })
  it('team_id 만 null 로 바꾸는 직접 UPDATE(service_role)도 team_code 원문을 건드리지 않는다 — 해제는 RPC 가 빈 값을 적는 길 하나다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.minutes set team_id = null where id = $1', [F.rows.minute])
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: null, team_code: 'ERP' })
    })
  })
  it('팀 없는 회의록은 팀 병합·코드 변경·참조 건수의 대상이 아니다', async () => {
    await asService(pool, async (c) => {
      await meta(c, F.rows.minute, { team_code: '' })
      await c.query('select public.change_team_code($1, $2, $3)', [F.users.member, F.teams.erp, 'FIN'])
      expect(await teamOf(c, F.rows.minute)).toEqual({ team_id: null, team_code: '' })
      expect((await c.query<{ r: { minutes: number } }>('select public.team_reference_counts($1) as r', [F.teams.erp])).rows[0].r.minutes).toBe(0)
    })
  })
})
