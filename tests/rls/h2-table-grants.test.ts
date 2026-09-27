// H2-b(AUTH-12) — anon·authenticated 는 public 관계에서 truncate·trigger·references·maintain 이 없고(postgres 기본 권한 포함),
// 정책이 없는 DML 은 권한도 없다(명령 단위). 쓰이는 명령(change_logs INSERT·issue_assignees INSERT/DELETE 등)은 정책과 함께 남는다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const EXTRA = ['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']
/**
 * anon·authenticated 의 실효 권한(has_table_privilege) 가운데 EXTRA 에 드는 (관계, 롤, 권한). 직접 grant 뿐 아니라 PUBLIC grant·롤 상속·
 * 열 단위 REFERENCES(has_any_column_privilege)까지 잡는다 — 0011 ② 사후검증과 같은 형태.
 */
const EXTRA_EFFECTIVE = `
  select c.relname::text as rel, r.role, p.priv
    from pg_class c
   cross join unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest($1::text[]) as p(priv)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege(r.role, c.oid, p.priv)
          or (p.priv = 'REFERENCES' and has_any_column_privilege(r.role, c.oid, 'REFERENCES')))
   order by 1, 2, 3`
/** authenticated 가 가진 DML 인데 그 명령(또는 ALL)의 정책이 없는 (표, 명령). INSERT·UPDATE 는 열 단위 권한도 센다. */
export const DML_WITHOUT_POLICY = `
  with t as (select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
       cmd(cmd) as (values ('INSERT'), ('UPDATE'), ('DELETE'))
  select t.relname::text as rel, cmd.cmd from t cross join cmd
   where (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[])
   order by 1, 2`

describe('H2-b 쓰지 않는 표 권한', () => {
  it('public 관계에서 anon·authenticated 의 truncate·trigger·references·maintain 0건(실효 권한)', async () => {
    expect((await pool.query(EXTRA_EFFECTIVE, [EXTRA])).rows).toEqual([])
  })

  it('민감도 — 실효 권한 검사는 PUBLIC grant 와 열 단위 REFERENCES 를 잡는다', async () => {
    await asService(pool, async (c) => {
      await c.query('grant trigger on public.holidays to public')
      await c.query('grant references (id) on public.announcements to authenticated')
      const { rows } = await c.query<{ rel: string; role: string; priv: string }>(EXTRA_EFFECTIVE, [EXTRA])
      expect(rows).toEqual([
        { rel: 'announcements', role: 'authenticated', priv: 'REFERENCES' },
        { rel: 'holidays', role: 'anon', priv: 'TRIGGER' },
        { rel: 'holidays', role: 'authenticated', priv: 'TRIGGER' },
      ])
    })
  })

  it('postgres 의 public 기본 권한(표)에도 없다 — PUBLIC(grantee 0)과 두 롤이 상속받는 롤의 항목 포함', async () => {
    const { rows } = await pool.query(`
      select a.grantee::text as grantee, a.privilege_type as priv
        from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
         and (case when a.grantee = 0 then true
                   else pg_has_role('anon', a.grantee, 'USAGE') or pg_has_role('authenticated', a.grantee, 'USAGE') end)
         and a.privilege_type = any($1::text[])`, [EXTRA])
    expect(rows).toEqual([])
  })

  it('민감도 — 새 표는 truncate·trigger 를 받지 않고 select 는 받는다(기본 권한이 실제로 바뀌었다)', async () => {
    await asService(pool, async (c) => {
      await c.query('create table public.rls_h2_probe (id int primary key)')
      const { rows: [r] } = await c.query(`select has_table_privilege('authenticated', 'public.rls_h2_probe', 'TRUNCATE') as t,
        has_table_privilege('authenticated', 'public.rls_h2_probe', 'SELECT') as s,
        has_table_privilege('anon', 'public.rls_h2_probe', 'TRIGGER') as a`)
      expect(r).toEqual({ t: false, s: true, a: false })
    })
  })

  it('authenticated 가 가진 DML 은 전부 그 명령의 정책이 있다(정책 없는 DML 권한 0)', async () => {
    expect((await pool.query(DML_WITHOUT_POLICY)).rows).toEqual([])
  })

  it('쓰이는 명령은 남는다 — change_logs INSERT, issue_assignees INSERT·DELETE, deliverable_attachments INSERT·DELETE, teams INSERT·UPDATE, minute_highlights INSERT·DELETE', async () => {
    const pairs: Array<[string, string]> = [
      ['change_logs', 'INSERT'], ['issue_assignees', 'INSERT'], ['issue_assignees', 'DELETE'],
      ['deliverable_attachments', 'INSERT'], ['deliverable_attachments', 'DELETE'],
      ['teams', 'INSERT'], ['teams', 'UPDATE'], ['minute_highlights', 'INSERT'], ['minute_highlights', 'DELETE'],
    ]
    const { rows } = await pool.query<{ t: string; p: string; ok: boolean }>(
      `select x.t, x.p, has_table_privilege('authenticated', ('public.' || x.t)::regclass, x.p) as ok
         from unnest($1::text[], $2::text[]) as x(t, p)`, [pairs.map((p) => p[0]), pairs.map((p) => p[1])])
    expect(rows.filter((r) => !r.ok).map((r) => `${r.t}:${r.p}`)).toEqual([])
  })
})
