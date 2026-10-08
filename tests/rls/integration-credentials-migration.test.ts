import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const sql = (dir: string, suffix: string) => readFileSync(`${dir}/${readdirSync(dir).find(f => f.endsWith(suffix))}`, 'utf8')
const migration = sql('supabase/migrations', '_integration_credentials.sql')
const rollback = sql('supabase/rollbacks', '_integration_credentials_rollback.sql')
// 0041 이 옛 두 표를 지웠다 — 0035 의 이관·롤백은 agent_runners 를 전제하므로 롤백 순서대로(0041 → 0035) 먼저 0041 을 되돌려 표를 되만든다.
// 0041 롤백은 자체 begin;/commit; 을 가진다 — 그 두 줄을 걷어 이 연결의 트랜잭션 안에서 돈다(tests/rls/drop-agent-legacy.test.ts 와 같은 방식).
const dropLegacyRollback = sql('supabase/rollbacks', '_drop_agent_legacy_rollback.sql').replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
/** 옛 픽스처(fixture-ws.sql)에 있던 프로젝트 한정 PAT — 표가 없어져 케이스 안에서 넣는다 */
const FIXTURE_RUNNER = '00000000-0000-0000-7e57-000000001126'

async function beforeMigration(run: (c: PoolClient) => Promise<void>) {
  const c = await pool.connect()
  await c.query('begin')
  try {
    // DB DDL도 이 연결의 rollback 안에서만 변경한다. 다른 테스트/앱 DB를 재적용하지 않는다.
    await c.query(dropLegacyRollback)
    // created_at 은 과거로 못 박는다 — 기본값 now() 는 이 트랜잭션의 시작 시각이라, 아래 '이관 뒤 created_at = now() 변경' 케이스가 무변경이 된다
    await c.query(`insert into public.agent_runners (id, name, owner_user_id, token_prefix, token_hash, expires_at, project_id, created_at)
      values ($1, 'rls', $2, 'RlsAgentKey1', repeat('a',64), now() + interval '1 year', $3, '2026-01-01T00:00:00Z')`, [FIXTURE_RUNNER, F.users.member, F.projects.a])
    await c.query('drop table public.integration_credentials; drop function public.integration_credentials_guard()')
    await c.query('alter table public.agent_watchers drop constraint agent_watchers_workspace_user_agent_key; alter table public.agent_watchers add constraint agent_watchers_user_id_agent_key unique(user_id,agent)')
    await run(c)
  } finally { await c.query('rollback'); c.release() }
}

describe('SP7 deterministic migration and guarded rollback', () => {
  it('프로젝트 한정·단일 WS PAT를 원본 메타/해시 그대로 옮기고 무변경 왕복한다', async () => {
    await beforeMigration(async c => {
      const id = randomUUID()
      await c.query(`insert into public.agent_runners(id,name,owner_user_id,token_prefix,token_hash,expires_at,scopes)
        values($1,'sp7-single',$2,'SingleWsKey1',repeat('b',64),'2099-01-01',array['work:read'])`, [id, F.users.aLoose])
      const old = (await c.query('select * from public.agent_runners order by id')).rows
      await c.query(migration)
      const migrated = (await c.query('select * from public.integration_credentials where id = $1', [id])).rows[0]
      expect(migrated).toMatchObject({ id, workspace_id: F.ws, kind: 'agent_runner', project_ids: null, owner_user_id: F.users.aLoose, token_hash: 'b'.repeat(64) })
      expect((await c.query('select project_ids, default_project_id from public.integration_credentials where id = $1', [FIXTURE_RUNNER])).rows[0])
        .toEqual({ project_ids: [F.projects.a], default_project_id: F.projects.a })
      await c.query(rollback)
      expect((await c.query('select * from public.agent_runners order by id')).rows).toEqual(old)
      await c.query(migration)
      expect((await c.query('select count(*)::int n from public.integration_credentials')).rows[0].n).toBe(old.length)
    })
  })

  it('다중 WS 활성 무제한 PAT는 첫 소속을 고르거나 건너뛰지 않고 이관 전체를 거절한다', async () => {
    await beforeMigration(async c => {
      await c.query(`insert into public.agent_runners(name,owner_user_id,token_prefix,token_hash,expires_at)
        values('sp7-ambiguous',$1,'DualWsToken1',repeat('b',64),'2099-01-01')`, [F.users.dual])
      expect(await pgError(c, migration)).toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_WORKSPACE_SELECTION_REQUIRED' })
      expect((await c.query("select to_regclass('public.integration_credentials') as table_name")).rows[0].table_name).toBeNull()
      expect((await c.query("select enabled from public.agent_runners where name = 'sp7-ambiguous'")).rows[0].enabled).toBe(true)
    })
  })

  it('이관 후 새 발급/회수/사용/범위 변경은 손실 롤백으로 숨기지 않는다', async () => {
    for (const change of [
      "delete from public.integration_credentials",
      "update public.integration_credentials set created_at = now()",
      "update public.integration_credentials set enabled = false, revoked_at = now()",
      "update public.integration_credentials set last_used_at = now()",
      "update public.integration_credentials set project_ids = null, default_project_id = null",
      "insert into public.integration_credentials(workspace_id,kind,name,token_prefix,token_hash,expires_at) values('" + F.ws + "','minutes_api','new','NewMinutes01',repeat('c',64),'2099-01-01')",
    ]) {
      await beforeMigration(async c => {
        await c.query(migration)
        await c.query(change)
        expect(await pgError(c, rollback)).toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED' })
        expect((await c.query("select to_regclass('public.integration_credentials') as table_name")).rows[0].table_name).toBe('integration_credentials')
      })
    }
  })

  it('롤백 순서 0041 → 0035 — 0041 롤백이 되만든 빈 agent_runners 로는 자격증명이 남아 있는 한 0035 를 되돌리지 못한다(손실 없는 길이 없다)', async () => {
    const c = await pool.connect()
    await c.query('begin')
    try {
      await c.query(dropLegacyRollback)
      // 자격증명을 하나 둔다(0035 가 옮겼던 모양) — 원본 행은 0041 이 지웠고 롤백은 데이터를 되살리지 않는다
      await c.query(`insert into public.integration_credentials(workspace_id, kind, name, token_prefix, token_hash, scopes, owner_user_id, expires_at)
        values ($1, 'agent_runner', 'kept', 'KeptCredKey1', repeat('c',64), array['work:read'], $2, '2099-01-01')`, [F.ws, F.users.aLoose])
      expect(await pgError(c, rollback)).toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED' })
      expect((await c.query("select to_regclass('public.integration_credentials') as t")).rows[0].t).toBe('integration_credentials')
      // 자격증명이 하나도 없을 때만 0035 까지 내려간다
      await c.query('delete from public.integration_credentials')
      expect(await pgError(c, rollback)).toBeNull()
      expect((await c.query("select to_regclass('public.integration_credentials') as t")).rows[0].t).toBeNull()
      expect((await c.query("select to_regclass('public.agent_runners') as t")).rows[0].t).toBe('agent_runners')
    } finally { await c.query('rollback'); c.release() }
  })

  it('다중 WS 감시자 행도 원래 유니크 키로 압축하지 않는다', async () => {
    await beforeMigration(async c => {
      await c.query(migration)
      for (const ws of [F.ws, F.wsB]) await c.query("insert into public.agent_watchers(user_id,agent,workspace_id) values($1,'sp7-dual',$2)", [F.users.dual, ws])
      expect(await pgError(c, rollback)).toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED' })
    })
  })
})
