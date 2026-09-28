// 0012 설정 쓰기 계약 — 설정·이력 표의 직접 쓰기는 세션에서 전부 42501 이다(쓰기는 SECURITY DEFINER RPC 뿐, 개정 §2.11 ②).
// 권한은 asService(postgres — 슈퍼유저)가 아니라 asUser 와 set local role 로 확인한다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const DENIED = { code: '42501', message: expect.stringContaining('permission denied') }
/** anon 롤로 한 문장 — 끝나면 롤을 되돌린다 */
async function asAnon(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query('set local role anon')
  const e = await pgError(c, sql, params)
  await c.query('reset role')
  return e
}
const HISTORY = [
  { table: 'project_settings_history', key: 'project_id', id: F.projects.a },
  { table: 'workspace_settings_history', key: 'workspace_id', id: F.ws },
] as const

describe('0012 ④ 설정 이력 두 표', () => {
  it('A 멤버는 A 의 이력을 읽고 B 계정은 0행이다', async () => {
    for (const h of HISTORY) {
      await asUser(pool, F.users.aLoose, async (c) =>
        expect((await c.query(`select 1 from public.${h.table} where ${h.key} = $1`, [h.id])).rowCount, h.table).toBeGreaterThan(0))
      await asUser(pool, F.users.bAdmin, async (c) =>
        expect((await c.query(`select 1 from public.${h.table} where ${h.key} = $1`, [h.id])).rowCount, h.table).toBe(0))
    }
  })

  it('세션(authenticated)은 관리자여도 이력을 쓰지 못한다 — insert·update·delete 42501', async () => {
    for (const h of HISTORY) {
      await asUser(pool, F.users.platform, async (c) => {
        for (const sql of [
          `insert into public.${h.table} (${h.key}, revision, key, source, command_id) values ($1, 99, 'rls.probe', 'edit', gen_random_uuid())`,
          `update public.${h.table} set key = 'rls.probe' where ${h.key} = $1`,
          `delete from public.${h.table} where ${h.key} = $1`,
        ]) expect(await pgError(c, sql, [h.id]), `${h.table}: ${sql.slice(0, 6)}`).toMatchObject(DENIED)
      })
    }
  })

  it('anon 은 이력을 읽지도 쓰지도 못하고, 두 롤 모두 id 시퀀스를 만지지 못한다', async () => {
    await asService(pool, async (c) => {
      for (const h of HISTORY) {
        expect(await asAnon(c, `select 1 from public.${h.table} limit 1`), h.table).toMatchObject(DENIED)
        expect(await asAnon(c, `insert into public.${h.table} (${h.key}, revision, key, source, command_id)
          values ($1, 99, 'rls.probe', 'edit', gen_random_uuid())`, [h.id]), h.table).toMatchObject(DENIED)
        const { rows } = await c.query<{ anon: boolean; auth: boolean }>(
          `select has_sequence_privilege('anon', $1, 'USAGE') or has_sequence_privilege('anon', $1, 'SELECT') as anon,
                  has_sequence_privilege('authenticated', $1, 'USAGE') or has_sequence_privilege('authenticated', $1, 'SELECT') as auth`,
          [`public.${h.table}_id_seq`])
        expect(rows[0], h.table).toEqual({ anon: false, auth: false })
      }
    })
  })

  it('service_role 은 이력을 읽고 쓴다(RPC 가 이 권한으로 돈다 — SP2 불변식 ⓘ)', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const h of HISTORY) {
        expect(await pgError(c, `insert into public.${h.table} (${h.key}, revision, key, source, command_id)
          values ($1, 99, 'rls.probe', 'internal', gen_random_uuid())`, [h.id]), h.table).toBeNull()
        expect((await c.query(`select 1 from public.${h.table} where key = 'rls.probe'`)).rowCount, h.table).toBe(1)
      }
    })
  })

  it('source 는 다섯 값뿐이고 (범위, revision, key) 는 유일하다', async () => {
    await asService(pool, async (c) => {
      for (const h of HISTORY) {
        const ins = `insert into public.${h.table} (${h.key}, revision, key, source, command_id) values ($1, 98, 'rls.probe', $2, gen_random_uuid())`
        expect(await pgError(c, ins, [h.id, 'import']), h.table).toMatchObject({ code: '23514' })
        expect(await pgError(c, ins, [h.id, 'edit']), h.table).toBeNull()
        expect(await pgError(c, ins, [h.id, 'edit']), h.table).toMatchObject({ code: '23505', constraint: `${h.table}_rev_key_uq` })
      }
    })
  })
})

const SETTINGS = [
  { table: 'project_settings', key: 'project_id', id: F.projects.a },
  { table: 'workspace_settings', key: 'workspace_id', id: F.ws },
] as const
/** 0012 가 만든 함수 — 뒤 과제(20·21)가 자기 함수를 이 목록에 더한다. service 는 service_role 에 grant 한 명령 */
const FUNCTIONS_0012: Array<{ fn: string; service: boolean }> = [
  { fn: 'public.settings_ref_check(uuid, text, jsonb, jsonb)', service: false },
  { fn: 'public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', service: true },
  { fn: 'public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', service: true },
  { fn: 'public.copy_project_config(uuid, uuid)', service: true },
  { fn: 'public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int)', service: true },
  { fn: 'public.ensure_project_settings_row()', service: false },
  { fn: 'public.ensure_workspace_settings_row()', service: false },
  { fn: 'public.settings_row_keep()', service: false },
  { fn: 'public.settings_row_reject_truncate()', service: false },
  { fn: 'public.settings_history_reject_mutation()', service: false },
  { fn: 'public.history_reject_truncate()', service: false },
  { fn: 'public.authz_events_reject_mutation()', service: false },
  { fn: 'public.purge_authz_events(uuid)', service: true },
  { fn: 'public.purge_workspace_authz_events()', service: false },
  { fn: 'public.record_authz_event()', service: false },
  { fn: 'public.workspace_members_stamp_inviter()', service: false },
  { fn: 'public.authz_tables_reject_truncate()', service: false },
  { fn: 'public.set_platform_admin(uuid, uuid, boolean, uuid)', service: true },
  { fn: 'public.set_workspace_role(uuid, uuid, uuid, text, uuid)', service: true },
  { fn: 'public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid)', service: true },
]

describe('0012 ⑨-2 설정 표 — 쓰기는 RPC 뿐', () => {
  it('세션은 워크스페이스 관리자·플랫폼 관리자여도 설정 두 표를 직접 쓰지 못한다 — insert·update·upsert·delete 42501', async () => {
    for (const uid of [F.users.wsAdmin, F.users.platform, F.users.member]) {
      await asUser(pool, uid, async (c) => {
        for (const s of SETTINGS) {
          for (const sql of [
            `insert into public.${s.table} (${s.key}) values ($1)`,
            `insert into public.${s.table} (${s.key}, "values") values ($1, '{}') on conflict (${s.key}) do update set "values" = excluded."values"`,
            `update public.${s.table} set "values" = '{}'::jsonb where ${s.key} = $1`,
            `update public.${s.table} set revision = revision + 1 where ${s.key} = $1`,
            `delete from public.${s.table} where ${s.key} = $1`,
          ]) expect(await pgError(c, sql, [s.id]), `${uid} ${s.table}: ${sql.slice(0, 24)}`).toMatchObject(DENIED)
        }
      })
    }
  })

  it('anon 은 설정 두 표를 읽지도 쓰지도 못한다', async () => {
    await asService(pool, async (c) => {
      for (const s of SETTINGS) {
        expect(await asAnon(c, `select 1 from public.${s.table} limit 1`), s.table).toMatchObject(DENIED)
        expect(await asAnon(c, `update public.${s.table} set "values" = '{}'::jsonb where ${s.key} = $1`, [s.id]), s.table).toMatchObject(DENIED)
      }
    })
  })

  it('설정 두 표의 표 권한 — authenticated 는 SELECT 뿐(과도기 쓰기 권한이 닫혔다), anon 은 없다', async () => {
    const { rows } = await pool.query<{ t: string; role: string; priv: string; has: boolean }>(
      `select t, r as role, p as priv, has_table_privilege(r, ('public.' || t)::regclass, p) as has
         from unnest(array['project_settings', 'workspace_settings']) as t,
              unnest(array['anon', 'authenticated']) as r,
              unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
        order by 1, 2, 3`)
    expect(rows.filter((r) => r.has).map((r) => `${r.t} ${r.role} ${r.priv}`))
      .toEqual(['project_settings authenticated SELECT', 'workspace_settings authenticated SELECT'])
  })

  it('service_role 도 설정 두 표를 TRUNCATE 하지 못한다(SETTINGS_ROW_REQUIRED) — 행 유지 트리거는 TRUNCATE 에 불리지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const s of SETTINGS) {
        expect(await pgError(c, `truncate public.${s.table}`), s.table).toMatchObject({ code: '23514', message: 'SETTINGS_ROW_REQUIRED' })
      }
    })
  })

  it('설정·이력 네 표의 정책은 읽기 하나씩이다 — workspace_settings_write 0건, 쓰기 정책 0건', async () => {
    const { rows } = await pool.query<{ t: string; p: string; cmd: string }>(
      `select tablename::text as t, policyname::text as p, cmd from pg_policies
        where schemaname = 'public' and tablename = any($1::name[]) order by 1, 2`,
      [['project_settings', 'workspace_settings', 'project_settings_history', 'workspace_settings_history']])
    expect(rows).toEqual([
      { t: 'project_settings', p: 'project_settings_ws_read', cmd: 'SELECT' },
      { t: 'project_settings_history', p: 'project_settings_history_read', cmd: 'SELECT' },
      { t: 'workspace_settings', p: 'workspace_settings_read', cmd: 'SELECT' },
      { t: 'workspace_settings_history', p: 'workspace_settings_history_read', cmd: 'SELECT' },
    ])
  })

  it('세션은 워크스페이스 관리자여도 projects 에 insert 하지 못한다(스펙 D6) — 고치기·지우기는 그대로다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `insert into public.projects (name, workspace_id) values ('RLS 세션 생성', $1)`, [F.ws])).toMatchObject(DENIED)
      expect((await c.query(`update public.projects set description = 'rls' where id = $1`, [F.projects.b])).rowCount).toBe(1)
    })
    const { rows } = await pool.query(
      `select policyname::text as p from pg_policies where schemaname = 'public' and tablename = 'projects' and cmd in ('INSERT', 'ALL')`)
    expect(rows).toEqual([])
  })

  it('0012 의 함수는 anon·authenticated 가 실행하지 못한다(실효 권한) — service_role 은 서버가 부르는 명령만', async () => {
    const { rows } = await pool.query<{ fn: string; anon: boolean; auth: boolean; service: boolean }>(
      `select f.fn, has_function_privilege('anon', f.fn::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', f.fn::regprocedure, 'EXECUTE') as auth,
              has_function_privilege('service_role', f.fn::regprocedure, 'EXECUTE') as service
         from unnest($1::text[]) as f(fn)`, [FUNCTIONS_0012.map((f) => f.fn)])
    expect(rows.filter((r) => r.anon || r.auth).map((r) => r.fn), 'anon·authenticated 가 실행한다').toEqual([])
    const must = new Set(FUNCTIONS_0012.filter((f) => f.service).map((f) => f.fn))
    expect(rows.filter((r) => must.has(r.fn) && !r.service).map((r) => r.fn), 'service_role 이 실행하지 못한다').toEqual([])
  })
})

describe('0012 ⑪ 잡 표 status 는 skipped 를 받는다(스펙 D16)', () => {
  it('세 잡 표 모두 status = skipped · last_error = module_disabled 로 닫을 수 있고, 모르는 값은 여전히 거부한다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const [table, where, id] of [
        ['ai_index_jobs', 'id = $1', 7057001], ['wiki_processing_jobs', 'id = $1', 7057001],
        ['wiki_project_rebuild_jobs', 'project_id = $1', F.projects.a],
      ] as const) {
        const r = await c.query(`update public.${table} set status = 'skipped', last_error = 'module_disabled' where ${where} returning status, last_error`, [id])
        expect(r.rows, table).toEqual([{ status: 'skipped', last_error: 'module_disabled' }])
        expect(await pgError(c, `update public.${table} set status = 'paused' where ${where}`, [id]), table)
          .toMatchObject({ code: '23514', constraint: `${table}_status_check` })
      }
    })
  })
})
