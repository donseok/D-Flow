// 0041 drop_agent_legacy — 옛 에이전트 등록 표(agent_projects)·옛 PAT 저장소(agent_runners) 삭제(SP7).
//  ① 두 표가 없다  ② 사전검사 — 새 구조로 옮겨지지 않은 행이 있으면 AGENT_LEGACY_DROP_PRECHECK 로 멈춘다(조용히 버리지 않는다)
//  ③ 롤백 → 재적용 왕복 — 롤백은 0040 시점 구조를 되만든다(데이터는 복원하지 않는다).
// 마이그레이션 파일은 접미로 찾는다(번호는 재배정될 수 있다 — CLAUDE.md "데이터"). 두 파일은 자체 begin/commit 을 가지므로 그 두 줄을 걷어
// 케이스의 트랜잭션(asService — 늘 rollback) 안에서 돌린다: DB 에는 아무것도 남지 않는다.
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const raw = (dir: string, suffix: string) => {
  const hits = readdirSync(dir).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir}/*${suffix} 가 ${hits.length}개다`)
  return readFileSync(`${dir}/${hits[0]}`, 'utf8')
}
/** 파일의 최상위 begin;/commit; 두 줄만 걷는다(do 블록의 begin 은 세미콜론이 없다) — 바깥 트랜잭션을 커밋하지 않게 */
const inTx = (sql: string) => sql.replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
const MIGRATION_RAW = raw('supabase/migrations', '_drop_agent_legacy.sql')
const ROLLBACK_RAW = raw('supabase/rollbacks', '_drop_agent_legacy_rollback.sql')
const migration = inTx(MIGRATION_RAW)
const rollback = inTx(ROLLBACK_RAW)

const regclass = async (c: PoolClient | Pool, name: string) =>
  (await c.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${name}`])).rows[0].t
const PRECHECK = { code: 'P0001', message: expect.stringMatching(/^AGENT_LEGACY_DROP_PRECHECK: /) }

/** 프로젝트 설정의 modules.enabled 를 바꾼다(없애려면 undefined) — 트랜잭션 안, service 경로 */
async function setEnabled(c: PoolClient, projectId: string, value: unknown) {
  if (value === undefined) await c.query(`update public.project_settings set "values" = "values" - 'modules.enabled' where project_id = $1`, [projectId])
  else await c.query(`update public.project_settings set "values" = jsonb_set("values", '{modules.enabled}', $2::jsonb) where project_id = $1`, [projectId, JSON.stringify(value)])
}
const runner = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), name: 'legacy-pat', owner: F.users.aLoose, prefix: 'LegacyPatKey', hash: 'd'.repeat(64),
  enabled: true, revoked_at: null as string | null, expires_at: '2099-01-01', ...over,
})
async function insertRunner(c: PoolClient, r: ReturnType<typeof runner>) {
  await c.query(`insert into public.agent_runners(id, name, owner_user_id, token_prefix, token_hash, enabled, revoked_at, expires_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`, [r.id, r.name, r.owner, r.prefix, r.hash, r.enabled, r.revoked_at, r.expires_at])
}
/** 0035 가 옮긴 모양의 자격증명 행(같은 id·prefix·hash) */
async function insertCredential(c: PoolClient, r: ReturnType<typeof runner>, over: { hash?: string; prefix?: string } = {}) {
  await c.query(`insert into public.integration_credentials(id, workspace_id, kind, name, token_prefix, token_hash, scopes, owner_user_id, expires_at)
    values ($1, $2, 'agent_runner', $3, $4, $5, array['work:read'], $6, $7)`, [r.id, F.ws, r.name, over.prefix ?? r.prefix, over.hash ?? r.hash, r.owner, r.expires_at])
}

describe('0041 ① 두 표가 없다', () => {
  it('agent_projects·agent_runners 와 그 정책이 없고, 새 저장소(integration_credentials)·프로젝트 설정은 그대로다', async () => {
    expect(await regclass(pool, 'agent_projects')).toBeNull()
    expect(await regclass(pool, 'agent_runners')).toBeNull()
    expect((await pool.query(`select 1 from pg_policies where schemaname = 'public' and tablename in ('agent_projects', 'agent_runners')`)).rowCount).toBe(0)
    expect(await regclass(pool, 'integration_credentials')).toBe('integration_credentials')
    expect(await regclass(pool, 'project_settings')).toBe('project_settings')
    // 두 표를 가리키던 것이 남지 않았다 — 이름을 품은 public 함수·뷰가 없다
    expect((await pool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ 'agent_(projects|runners)'`)).rows).toEqual([])
    expect((await pool.query(`select viewname from pg_views where schemaname = 'public' and definition ~ 'agent_(projects|runners)'`)).rows).toEqual([])
  })
  it('authenticated 로 읽으면 없는 표다(42P01) — 권한 거부가 아니다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role authenticated')
      for (const t of ['agent_projects', 'agent_runners']) expect(await pgError(c, `select 1 from public.${t}`), t).toMatchObject({ code: '42P01' })
    })
  })
  it('두 파일은 최상위 begin;/commit; 을 한 번씩 가진다 — 걷어 낸 본문에는 commit 이 없다(테스트가 바깥 트랜잭션을 커밋하지 않는다)', () => {
    for (const [name, sql, body] of [['migration', MIGRATION_RAW, migration], ['rollback', ROLLBACK_RAW, rollback]] as const) {
      expect(sql.match(/^begin;[ \t]*$/gm), name).toHaveLength(1)
      expect(sql.match(/^commit;[ \t]*$/gm), name).toHaveLength(1)
      expect(body, name).not.toMatch(/^\s*(commit|begin)\s*;/im)
      expect(body.length, name).toBeGreaterThan(500)
    }
    // cascade 로 모르는 의존 객체를 함께 지우지 않는다(주석 밖 본문)
    expect(MIGRATION_RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).not.toMatch(/\bcascade\b/i)
  })
})

describe('0041 ② 사전검사 — AGENT_LEGACY_DROP_PRECHECK', () => {
  /** 롤백으로 두 표를 되만든 뒤 seed 를 넣고 마이그레이션 본문을 다시 돌린다. 오류(없으면 null)와 그 뒤 표의 존재를 돌려준다 */
  async function rerun(seed: (c: PoolClient) => Promise<void>) {
    return asService(pool, async (c) => {
      await c.query(rollback)
      await seed(c)
      const error = await pgError(c, migration)
      return { error, projects: await regclass(c, 'agent_projects'), runners: await regclass(c, 'agent_runners') }
    })
  }
  const kept = { projects: 'agent_projects', runners: 'agent_runners' }
  const dropped = { error: null, projects: null, runners: null }

  it('빈 두 표는 그대로 지운다(대조)', async () => {
    expect(await rerun(async () => {})).toEqual(dropped)
  })

  // ① 은 "표를 지우면 다시 열리는" 방향만 막는다 — 지금까지 두 원천의 AND 라 닫혀 있던 프로젝트가 모듈 하나 판정으로 열리는 경우다
  it('꺼 둔 등록 행(enabled=false)인데 설정에 agents 가 있으면 멈추고 두 표를 남긴다 — 멈춰 둔 것이 조용히 풀리지 않는다', async () => {
    const r = await rerun(async (c) => {
      await setEnabled(c, F.projects.a, ['kanban', 'agents'])
      await c.query(`insert into public.agent_projects(project_id, enabled, note) values ($1, false, '관리자가 멈춤')`, [F.projects.a])
    })
    expect(r.error).toMatchObject(PRECHECK)
    expect(r.error!.message).toContain('agent_projects 행 1건')
    expect(r).toMatchObject(kept)
  })
  it.each([
    ['modules.enabled 에 agents 가 없다', ['kanban', 'issues']],
    ['modules.enabled 가 빈 배열이다', []],
    ['modules.enabled 키가 없다', undefined],
    ['modules.enabled 가 배열이 아니다(손상)', { agents: true }],
  ])('꺼 둔 등록 행이고 %s → 지운다(닫힌 것은 닫힌 채다)', async (_n, value) => {
    const r = await rerun(async (c) => {
      await setEnabled(c, F.projects.a, value)
      await c.query('insert into public.agent_projects(project_id, enabled) values ($1, false)', [F.projects.a])
    })
    expect(r).toEqual(dropped)
  })
  it('켜진 등록 행이고 설정에도 agents 가 있으면 지운다 — 열린 것은 열린 채다', async () => {
    const r = await rerun(async (c) => {
      await setEnabled(c, F.projects.a, ['kanban', 'agents'])
      await c.query('insert into public.agent_projects(project_id) values ($1)', [F.projects.a])
    })
    expect(r).toEqual(dropped)
  })
  it('켜진 등록 행인데 설정에 agents 가 없어도 막지 않는다 — 모듈을 끄면 행은 켜진 채 남는 것이 기존 동작이고, 닫힌 것은 닫힌 채다', async () => {
    const r = await rerun(async (c) => {
      await setEnabled(c, F.projects.a, ['kanban'])
      await c.query('insert into public.agent_projects(project_id) values ($1)', [F.projects.a])
    })
    expect(r).toEqual(dropped)
  })
  it('여러 프로젝트 가운데 하나만 어긋나도 멈춘다 — 건수는 어긋난 행만 센다', async () => {
    const r = await rerun(async (c) => {
      await setEnabled(c, F.projects.a, ['agents'])
      await setEnabled(c, F.projects.b, ['agents'])
      await c.query('insert into public.agent_projects(project_id, enabled) values ($1, true), ($2, false)', [F.projects.a, F.projects.b])
    })
    expect(r.error).toMatchObject(PRECHECK)
    expect(r.error!.message).toContain('agent_projects 행 1건')
    expect(r).toMatchObject(kept)
  })

  it('살아 있는 옛 토큰이 새 저장소에 없으면 멈춘다', async () => {
    const r = await rerun(async (c) => { await insertRunner(c, runner()) })
    expect(r.error).toMatchObject(PRECHECK)
    expect(r.error!.message).toContain('agent_runners 토큰 1건')
    expect(r).toMatchObject(kept)
  })
  it('살아 있는 옛 토큰이 같은 id·prefix·hash 로 새 저장소에 있으면(0035 이관) 지운다 — 자격증명은 남는다', async () => {
    const row = runner()
    await asService(pool, async (c) => {
      await c.query(rollback)
      await insertRunner(c, row)
      await insertCredential(c, row)
      expect(await pgError(c, migration)).toBeNull()
      expect(await regclass(c, 'agent_runners')).toBeNull()
      expect((await c.query('select token_prefix, token_hash from public.integration_credentials where id = $1', [row.id])).rows)
        .toEqual([{ token_prefix: row.prefix, token_hash: row.hash }])
    })
  })
  it.each([
    ['hash 가 다르다', { hash: 'e'.repeat(64) }],
    ['prefix 가 다르다', { prefix: 'OtherPatKey1' }],
  ])('같은 id 의 자격증명이 있어도 %s → 이관된 토큰이 아니다, 멈춘다', async (_n, over) => {
    const row = runner()
    const r = await rerun(async (c) => { await insertRunner(c, row); await insertCredential(c, row, over) })
    expect(r.error).toMatchObject(PRECHECK)
    expect(r).toMatchObject(kept)
  })
  it.each([
    ['꺼졌다(enabled=false)', { enabled: false }],
    ['회수됐다(revoked_at)', { revoked_at: '2026-01-01T00:00:00Z' }],
    ['만료됐다(expires_at 과거)', { expires_at: '2020-01-01' }],
  ])('죽은 옛 토큰은 새 저장소에 없어도 막지 않는다 — %s(0035 의 "살아 있는" 판정과 같다)', async (_n, over) => {
    expect(await rerun(async (c) => { await insertRunner(c, runner(over)) })).toEqual(dropped)
  })
  it('사전검사에 걸리면 행도 그대로다 — 일부만 지우고 멈추지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(rollback)
      await setEnabled(c, F.projects.a, ['kanban', 'agents'])
      await c.query('insert into public.agent_projects(project_id, enabled) values ($1, false)', [F.projects.a])
      await insertRunner(c, runner({ enabled: false }))
      expect(await pgError(c, migration)).toMatchObject(PRECHECK)
      expect((await c.query('select count(*)::int as n from public.agent_projects')).rows[0].n).toBe(1)
      expect((await c.query('select count(*)::int as n from public.agent_runners')).rows[0].n).toBe(1)
      expect((await c.query(`select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_projects'`)).rowCount).toBe(1)
    })
  })
})

describe('0041 ③ 롤백 → 재적용 왕복', () => {
  const columns = (c: PoolClient, t: string) => c.query<{ c: string }>(
    `select column_name || ' ' || data_type || case when is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || column_default, '') as c
       from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t]).then((r) => r.rows.map((x) => x.c))
  const constraints = (c: PoolClient, t: string) => c.query<{ c: string }>(
    `select conname || ': ' || pg_get_constraintdef(oid) as c from pg_constraint where conrelid = $1::regclass order by conname`, [`public.${t}`]).then((r) => r.rows.map((x) => x.c))
  const grants = (c: PoolClient, t: string) => c.query<{ g: string }>(
    `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g from information_schema.role_table_grants
      where table_schema = 'public' and table_name = $1 and grantee <> 'postgres' group by grantee order by grantee`, [t]).then((r) => r.rows.map((x) => x.g))

  it('롤백은 0040 시점 구조(열·제약·인덱스·RLS·정책·권한)를 되만든다 — 행은 없다', async () => {
    await asService(pool, async (c) => {
      await c.query(rollback)
      expect(await columns(c, 'agent_projects')).toEqual([
        'project_id uuid not null', 'enabled boolean not null default true', 'note text', 'created_by uuid',
        'created_at timestamp with time zone not null default now()', 'updated_at timestamp with time zone not null default now()',
      ])
      expect(await columns(c, 'agent_runners')).toEqual([
        'id uuid not null default gen_random_uuid()', 'name text not null', "kind text not null default 'user_pat'::text", 'owner_user_id uuid not null',
        'token_prefix text not null', 'token_hash text not null', 'project_id uuid', "scopes ARRAY not null default '{work:read}'::text[]",
        'enabled boolean not null default true', 'revoked_at timestamp with time zone', 'expires_at timestamp with time zone not null',
        'last_seen_at timestamp with time zone', 'created_by uuid', 'created_at timestamp with time zone not null default now()',
      ])
      expect(await constraints(c, 'agent_projects')).toEqual([
        'agent_projects_created_by_fkey: FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL',   // 0012 가 바꾼 모양
        'agent_projects_pkey: PRIMARY KEY (project_id)',
        'agent_projects_project_id_fkey: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
      ])
      expect(await constraints(c, 'agent_runners')).toEqual([
        'agent_runners_created_by_fkey: FOREIGN KEY (created_by) REFERENCES auth.users(id)',
        "agent_runners_kind_check: CHECK ((kind = ANY (ARRAY['user_pat'::text, 'runner'::text])))",
        'agent_runners_owner_user_id_fkey: FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        'agent_runners_owner_user_id_name_key: UNIQUE (owner_user_id, name)',
        'agent_runners_pkey: PRIMARY KEY (id)',
        'agent_runners_project_id_fkey: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
        'agent_runners_token_prefix_key: UNIQUE (token_prefix)',
      ])
      expect((await c.query(`select indexname from pg_indexes where schemaname = 'public' and tablename in ('agent_projects', 'agent_runners') order by indexname`)).rows.map((r) => r.indexname))
        .toEqual(['agent_projects_pkey', 'agent_runners_owner_idx', 'agent_runners_owner_user_id_name_key', 'agent_runners_pkey', 'agent_runners_token_prefix_key'])
      expect((await c.query(`select indexdef from pg_indexes where indexname = 'agent_runners_owner_idx'`)).rows[0].indexdef)
        .toBe('CREATE INDEX agent_runners_owner_idx ON public.agent_runners USING btree (owner_user_id)')
      expect((await c.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class where oid in ('public.agent_projects'::regclass, 'public.agent_runners'::regclass) order by relname`)).rows)
        .toEqual([{ relname: 'agent_projects', relrowsecurity: true, relforcerowsecurity: false }, { relname: 'agent_runners', relrowsecurity: true, relforcerowsecurity: false }])
      expect((await c.query(`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('agent_projects', 'agent_runners')`)).rows)
        .toEqual([{ tablename: 'agent_projects', policyname: 'read_agent_projects', cmd: 'SELECT', roles: '{authenticated}', qual: 'is_project_member(project_id)', with_check: null }])
      // 스키마 기본 권한(anon·authenticated 전부)이 남지 않는다 — 0040 시점: service_role 전부, authenticated 는 agent_projects 읽기만
      expect(await grants(c, 'agent_projects')).toEqual(['authenticated:SELECT', 'service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'])
      expect(await grants(c, 'agent_runners')).toEqual(['service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'])
      // 데이터는 복원하지 않는다
      expect((await c.query('select (select count(*) from public.agent_projects)::int as p, (select count(*) from public.agent_runners)::int as r')).rows[0]).toEqual({ p: 0, r: 0 })
    })
  })

  it('되만든 표의 동작 — 정책은 프로젝트 멤버에게만 읽히고, 옛 PAT 저장소는 세션에 닫혀 있고, 계정을 지워도 등록 행은 남는다(created_by → null)', async () => {
    await asService(pool, async (c) => {
      await c.query(rollback)
      const U = randomUUID()
      await c.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
        values ($1, 'rls-0041-editor@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())`, [U])
      await c.query('insert into public.agent_projects(project_id, created_by) values ($1, $2), ($3, null)', [F.projects.a, U, F.projects.bWs])
      await insertRunner(c, runner({ enabled: false }))
      // 0012 의 FK(on delete set null) — 에이전트를 켠 계정을 지울 수 있다(tests/rls/settings-rows.test.ts 에서 옮긴 케이스)
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query('select created_by from public.agent_projects where project_id = $1', [F.projects.a])).rows).toEqual([{ created_by: null }])
      // bMember 는 워크스페이스 B 의 프로젝트(bWs) 명단뿐이다 — A 프로젝트의 등록 행은 보이지 않는다
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.bMember, role: 'authenticated' })])
      expect((await c.query('select project_id from public.agent_projects')).rows).toEqual([{ project_id: F.projects.bWs }])
      expect(await pgError(c, 'insert into public.agent_projects(project_id) values ($1)', [F.projects.aPrivate])).toMatchObject({ code: '42501' })
      expect(await pgError(c, 'select 1 from public.agent_runners')).toMatchObject({ code: '42501' })
    })
  })

  it('롤백 → 재적용 → 롤백 → 재적용 — 두 방향 모두 되풀이할 수 있고 끝 상태는 "표 없음"이다', async () => {
    await asService(pool, async (c) => {
      for (let round = 0; round < 2; round++) {
        await c.query(rollback)
        expect([await regclass(c, 'agent_projects'), await regclass(c, 'agent_runners')], `round ${round}`).toEqual(['agent_projects', 'agent_runners'])
        await c.query(migration)
        expect([await regclass(c, 'agent_projects'), await regclass(c, 'agent_runners')], `round ${round}`).toEqual([null, null])
      }
      // 마이그레이션을 표 없이 다시 돌리면 조용히 넘어가지 않는다(없는 표를 잠그려다 42P01) — 이미 적용된 상태를 성공으로 위장하지 않는다
      expect(await pgError(c, migration)).toMatchObject({ code: '42P01' })
      // 롤백도 표가 이미 있으면 덮어쓰지 않는다
      await c.query(rollback)
      expect(await pgError(c, rollback)).toMatchObject({ code: '42P07' })
    })
  })

  it('왕복은 새 저장소·프로젝트 설정을 건드리지 않는다', async () => {
    await asService(pool, async (c) => {
      const snap = async () => ({
        creds: (await c.query('select id, token_prefix, token_hash, enabled, revoked_at from public.integration_credentials order by id')).rows,
        settings: (await c.query('select project_id, "values", revision from public.project_settings order by project_id')).rows,
      })
      const before = await snap()
      await c.query(rollback)
      await c.query(migration)
      expect(await snap()).toEqual(before)
    })
  })
})
