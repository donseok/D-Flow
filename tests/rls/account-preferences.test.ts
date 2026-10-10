// account_preferences(SP3b D9) — 자기 행만 읽고 쓴다. 같은 워크스페이스 동료도 남의 계정 설정을 읽지 못한다(개정 권고 profiles.ui_prefs 를 버린 이유, E32).
// delete·anon 권한 없음(H2 규칙 2). 부트스트랩 계정에 기대지 않는다(H2 규칙 5 — CI db 잡은 부트스트랩 없이 돈다).
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ME = F.users.aLoose              // cy — A 멤버(A 전용)
const PEER = F.users.wsAdmin           // 같은 워크스페이스 A 의 동료
const DENIED = { code: '42501' }

describe('account_preferences RLS·권한', () => {
  it('① 자기 행 insert·select·update 성공', async () => {
    await asUser(pool, ME, async (c) => {
      await c.query(`insert into public.account_preferences (user_id, prefs) values ($1, '{"theme":"dark"}') on conflict (user_id) do update set prefs = excluded.prefs`, [ME])
      expect((await c.query('select prefs from public.account_preferences where user_id = $1', [ME])).rows).toEqual([{ prefs: { theme: 'dark' } }])
      const u = await c.query(`update public.account_preferences set prefs = prefs || '{"sidebarCollapsed":true}', updated_at = now() where user_id = $1`, [ME])
      expect(u.rowCount).toBe(1)
    })
  })
  it('② 같은 워크스페이스 동료는 남의 계정 설정을 읽지 못한다(0행), 남의 행 insert 는 42501, update 는 0행', async () => {
    // asService 는 끝에 rollback 한다 — 동료 행은 같은 트랜잭션 안에서 postgres 롤로 심는다(h2-attachment-guard 와 같은 꼴)
    await asUser(pool, ME, async (c) => {
      await c.query('reset role')
      await c.query(`insert into public.account_preferences (user_id, prefs) values ($1, '{"notif":{"x":false}}') on conflict (user_id) do update set prefs = excluded.prefs`, [PEER])
      await c.query('set local role authenticated')
      expect((await c.query('select 1 from public.account_preferences where user_id = $1', [PEER])).rowCount).toBe(0)
      expect(await pgError(c, `insert into public.account_preferences (user_id, prefs) values ($1, '{}')`, [PEER])).toMatchObject(DENIED)
      expect((await c.query(`update public.account_preferences set prefs = '{}' where user_id = $1`, [PEER])).rowCount).toBe(0)
      await c.query('reset role')
      // 민감도 — 행은 실제로 있고 바뀌지 않았다(0행이 "행 없음" 때문이 아니다)
      expect((await c.query('select prefs from public.account_preferences where user_id = $1', [PEER])).rows).toEqual([{ prefs: { notif: { x: false } } }])
    })
  })
  it('③ delete 권한 없음(42501), anon 은 아무것도 못 한다', async () => {
    await asUser(pool, ME, async (c) => {
      await c.query(`insert into public.account_preferences (user_id, prefs) values ($1, '{}') on conflict do nothing`, [ME])
      expect(await pgError(c, 'delete from public.account_preferences where user_id = $1', [ME])).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select 1 from public.account_preferences')).toMatchObject(DENIED)
      expect(await pgError(c, `insert into public.account_preferences (user_id, prefs) values ($1, '{}')`, [ME])).toMatchObject(DENIED)
      await c.query('reset role')
    })
  })
  it('④ 실효 권한 — authenticated = SELECT·INSERT·UPDATE 만, anon 없음, 정책 셋이 모두 자기 행', async () => {
    const { rows } = await pool.query(`
      select p.priv, has_table_privilege('authenticated', 'public.account_preferences', p.priv) as auth,
             has_table_privilege('anon', 'public.account_preferences', p.priv) as anon
        from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)`)
    expect(Object.fromEntries(rows.map((r) => [r.priv, [r.auth, r.anon]]))).toEqual({
      SELECT: [true, false], INSERT: [true, false], UPDATE: [true, false], DELETE: [false, false], TRUNCATE: [false, false], REFERENCES: [false, false], TRIGGER: [false, false],
    })
    const pol = await pool.query(`select policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies where schemaname = 'public' and tablename = 'account_preferences' order by policyname`)
    expect(pol.rows.map((r) => r.policyname)).toEqual(['account_preferences_insert_own', 'account_preferences_select_own', 'account_preferences_update_own'])
    for (const r of pol.rows) expect(r.expr, r.policyname).toMatch(/user_id = auth\.uid\(\)/)
  })
  it('⑤ prefs 는 객체만(check)', async () => {
    await asUser(pool, ME, async (c) => {
      expect(await pgError(c, `insert into public.account_preferences (user_id, prefs) values ($1, '[]') on conflict (user_id) do update set prefs = excluded.prefs`, [ME])).toMatchObject({ code: '23514' })
    })
  })
})
