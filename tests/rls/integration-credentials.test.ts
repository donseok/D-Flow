import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

function insert(overrides: Record<string, unknown> = {}) {
  const value = {
    workspace_id: F.ws, kind: 'minutes_api', name: randomUUID(), token_prefix: randomBytes(6).toString('hex'),
    token_hash: 'a'.repeat(64), expires_at: '2099-01-01T00:00:00Z', ...overrides,
  }
  const cols = Object.keys(value)
  return { sql: `insert into public.integration_credentials (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, values: Object.values(value) }
}
async function rejected(c: PoolClient, overrides: Record<string, unknown>) {
  const q = insert(overrides)
  return pgError(c, q.sql, q.values)
}

describe('SP7 integration_credentials storage boundary', () => {
  it('플랫폼/WS 관리자·멤버도 해시를 읽거나 직접 쓸 수 없다', async () => {
    for (const uid of [F.users.platform, F.users.wsAdmin, F.users.member, F.users.bAdmin]) {
      await asUser(pool, uid, async c => {
        for (const sql of [
          'select token_hash from public.integration_credentials',
          "update public.integration_credentials set enabled = false",
          'delete from public.integration_credentials',
        ]) expect(await pgError(c, sql)).toMatchObject({ code: '42501' })
        const q = insert()
        expect(await pgError(c, q.sql, q.values)).toMatchObject({ code: '42501' })
      })
    }
  })

  it('정상 서비스 발급은 WS·종류·소유자·프로젝트 범위를 보존한다', async () => {
    await asService(pool, async c => {
      const q = insert({ kind: 'agent_runner', owner_user_id: F.users.member, project_ids: [F.projects.a], default_project_id: F.projects.a, scopes: ['work:read'] })
      const { rows } = await c.query(q.sql, q.values)
      expect((await c.query('select workspace_id, kind, owner_user_id, project_ids from public.integration_credentials where id = $1', [rows[0].id])).rows[0])
        .toMatchObject({ workspace_id: F.ws, kind: 'agent_runner', owner_user_id: F.users.member, project_ids: [F.projects.a] })
    })
  })

  it('소유자·프로젝트·기본 프로젝트·팀은 다른 WS나 허용 밖 자원을 가리킬 수 없다', async () => {
    await asService(pool, async c => {
      for (const bad of [
        { kind: 'agent_runner', owner_user_id: F.users.bMember },
        { project_ids: [F.projects.bWs] },
        { default_project_id: F.projects.bWs },
        { project_ids: [F.projects.a], default_project_id: F.projects.aPrivate },
        { default_team_id: F.teams.ops },
        { project_ids: [F.projects.aPrivate], default_team_id: F.teams.erp },
        { team_map: JSON.stringify({ ops: F.teams.ops }) },
        { project_ids: [F.projects.aPrivate], team_map: JSON.stringify({ erp: F.teams.erp }) },
      ]) expect(await rejected(c, bad)).toMatchObject({ code: '23514' })
    })
  })

  it('손상된 값·종류별 금지 값은 서비스 경로도 거절한다', async () => {
    await asService(pool, async c => {
      for (const bad of [
        { kind: 'agent_runner' },
        { owner_user_id: F.users.member },
        { scopes: ['work:read'] },
        { kind: 'agent_runner', owner_user_id: F.users.member, scopes: ['admin:all'] },
        { kind: 'agent_runner', owner_user_id: F.users.member, scopes: [null] },
        { kind: 'agent_runner', owner_user_id: F.users.member, default_team_id: F.teams.aShared },
        { token_hash: 'a'.repeat(64) + 'z' },
        { token_prefix: 'not-a-prefix' },
        { project_ids: [null] },
        { team_map: '[]' },
        { team_map: JSON.stringify({ dev: null }) },
        { team_map: JSON.stringify({ dev: 'not-uuid' }) },
      ]) expect(await rejected(c, bad)).toMatchObject({ code: '23514' })
    })
  })

  it('이름은 WS/종류별 부분 유니크이며 서로 다른 소유자의 PAT는 공존한다', async () => {
    await asService(pool, async c => {
      const name = randomUUID()
      for (const owner of [F.users.member, F.users.aLoose]) {
        const q = insert({ kind: 'agent_runner', owner_user_id: owner, name })
        await c.query(q.sql, q.values)
      }
      expect(await rejected(c, { kind: 'agent_runner', owner_user_id: F.users.member, name }))
        .toMatchObject({ code: '23505', constraint: 'integration_credentials_runner_name_uq' })
      expect(await rejected(c, { name: 'rls-minutes' }))
        .toMatchObject({ code: '23505', constraint: 'integration_credentials_minutes_name_uq' })
    })
  })

  it('소속 회수 후에도 토큰을 닫을 수 있지만 구조 변경/재활성화는 거절한다', async () => {
    await asService(pool, async c => {
      const q = insert({ kind: 'agent_runner', owner_user_id: F.users.aLoose })
      const { rows } = await c.query(q.sql, q.values)
      await c.query('delete from public.workspace_members where user_id = $1 and workspace_id = $2', [F.users.aLoose, F.ws])
      await c.query('update public.integration_credentials set enabled = false, revoked_at = now() where id = $1', [rows[0].id])
      expect(await pgError(c, 'update public.integration_credentials set enabled = true, revoked_at = null where id = $1', [rows[0].id]))
        .toMatchObject({ code: '23514' })
    })
  })

  it('동일한 사용자·감시자 이름은 다른 WS에서 서로 덮어쓰지 않는다', async () => {
    await asService(pool, async c => {
      for (const ws of [F.ws, F.wsB]) {
        await c.query(`insert into public.agent_watchers(user_id, agent, workspace_id) values ($1, 'sp7-dual-watch', $2)
          on conflict(workspace_id,user_id,agent) do update set workspace_id = excluded.workspace_id`, [F.users.dual, ws])
      }
      expect((await c.query("select workspace_id from public.agent_watchers where user_id = $1 and agent = 'sp7-dual-watch' order by workspace_id", [F.users.dual])).rows)
        .toEqual([{ workspace_id: F.ws }, { workspace_id: F.wsB }])
    })
  })
})
