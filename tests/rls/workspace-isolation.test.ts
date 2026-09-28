// SP2 done_when 본체: B 워크스페이스 계정이 A 의 전 public 표를 0행 읽고, 쓰기가 전부 거부되는가.
// 표 목록은 카탈로그에서 읽는다(pg_class relkind r·p — RLS 를 켰는지와 무관하게 전부). 새 표는 isolation-map 에 판별식이 없으면 실패하고,
// RLS 를 켜지 않았으면 아래 관계 검사가 실패한다(뷰는 security_invoker, 구체화 뷰·외부 표는 허용 목록).
// 읽기: A 행의 PK 튜플 집합 ∩ B 세션이 보는 PK 튜플 집합 = ∅. 쓰기: A 행 한 개를 복사 insert·자기 자신으로 update·delete.
// 복사 insert 는 authenticated 가 INSERT 할 수 있는 컬럼만 싣는다 — 권한 없는 컬럼이 끼면 권한 오류(42501 permission denied)가
// RLS 보다 먼저 나서 정책이 평가되지 않는다. 42501 은 문구로 가른다: 'row-level security' = RLS 가 막음, 'permission denied' = 권한이 막음.
// 쓰기 판정: RLS 거부·트리거 거부면 막힌 것, 23505·23503·23502·23P01·CHECK 위반(제약 이름 있음)이면 RLS 를 통과한 것.
// 복사 insert 를 트리거·권한이 RLS 보다 먼저 거부한 표, 그리고 INSERT·ALL 정책의 WITH CHECK 가 자기 컬럼을 auth.uid() 와 비교하는 표는
// OWN_INSERT_PROBES 로 따로 덮여 있어야 한다. update·delete 는 RLS 가 행을 걸러 내면 0행·무오류다 — 42501 밖의 오류는 행이 정책을 통과했다는 뜻이라 누설로 센다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
import { A_ROW_FILTER, KNOWN_LEAKS, OPEN_BY_DESIGN, OWN_INSERT_PROBES, RLS_EXEMPT, UNFILLED, UPDATE_DENIED_BY_GRANT } from './isolation-map'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const TABLES_SQL = `
  select c.relname::text as name,
         array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                where i.indrelid = c.oid and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)) as pk,
         array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and a.attgenerated = '' and has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
                order by a.attnum) as cols,
         (select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and a.attgenerated = '' and has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
           order by a.attnum limit 1) as upd
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1`

/** public 의 표·뷰·구체화 뷰·외부 표 — RLS·security_invoker 여부와 함께 */
const RELATIONS_SQL = `
  select c.relname::text as name, c.relkind::text as kind, c.relrowsecurity as rls,
         exists (select 1 from pg_options_to_table(c.reloptions) o
                  where o.option_name = 'security_invoker' and o.option_value in ('true', 'on', '1', 'yes')) as invoker
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`

/**
 * INSERT·ALL 정책의 WITH CHECK 가 자기 컬럼을 auth.uid() 와 비교하는 표(`created_by = auth.uid()` 처럼 한정자 없는 컬럼) — 복사 행의
 * 소유자(A 사용자·null)에서 비교가 먼저 떨어져 뒤의 스코프 판정이 평가되지 않는다. 부모 행의 소유자 비교(`m.created_by = auth.uid()`,
 * 서브쿼리 안)는 부모를 RLS 로 읽으므로 해당하지 않는다.
 */
const OWNER_CHECK_TABLES_SQL = `
  select distinct tablename::text as name from pg_policies
   where schemaname = 'public' and cmd in ('INSERT', 'ALL')
     and with_check ~ '(^|[^.[:alnum:]_])[[:alnum:]_]+ = auth\\.uid\\(\\)' order by 1`

type Tbl = { name: string; pk: string[]; cols: string[]; /** authenticated 가 UPDATE 할 수 있는 첫 열. 없으면 null */ upd: string | null }
type Rel = { name: string; kind: string; rls: boolean; invoker: boolean }
const q = (id: string) => `"${id}"`
const keyOf = (t: Tbl) => `row(${t.pk.map((c) => `t.${q(c)}`).join(', ')})::text`

/** RLS 를 통과한 뒤에야 나는 오류(=쓰기가 정책에서 막히지 않았다) */
function passedRls(e: DatabaseError): boolean {
  return ['23505', '23503', '23502', '23P01'].includes(e.code ?? '') || (e.code === '23514' && Boolean(e.constraint))
}
/** RLS 가 막았다 — 같은 42501 이라도 'permission denied'(권한)는 정책이 평가되지 않은 것이다 */
const isRlsDenial = (e: DatabaseError) => e.code === '42501' && e.message.includes('row-level security')

/** 관계 검사 — 표는 RLS, 뷰는 security_invoker, 구체화 뷰·외부 표는 허용 목록에만. 어긋난 관계를 '이름: 사유' 로. */
function rlsGaps(rels: Rel[]): string[] {
  const gaps: string[] = []
  for (const r of rels) {
    if (r.name in RLS_EXEMPT) continue
    if ((r.kind === 'r' || r.kind === 'p') && !r.rls) gaps.push(`${r.name}: RLS 꺼짐`)
    else if (r.kind === 'v' && !r.invoker) gaps.push(`${r.name}: 뷰가 security_invoker 가 아님`)
    else if (r.kind === 'm' || r.kind === 'f') gaps.push(`${r.name}: RLS 를 걸 수 없는 관계(${r.kind})`)
  }
  return gaps
}

async function probe(c: PoolClient, sql: string, params: unknown[]): Promise<{ err: DatabaseError | null; rowCount: number }> {
  await c.query('savepoint probe')
  try {
    const r = await c.query(sql, params)
    return { err: null, rowCount: r.rowCount ?? 0 }
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e
    return { err: e, rowCount: 0 }
  } finally {
    await c.query('rollback to savepoint probe')
  }
}

/** 세션이 보는 PK 튜플. 표 권한이 없으면(42501) null = 0행과 같다. 그 밖의 오류는 던진다(조용히 0행으로 삼지 않는다). */
async function readKeys(c: PoolClient, t: Tbl): Promise<string[] | null> {
  await c.query('savepoint probe')
  try {
    const { rows } = await c.query<{ k: string }>(`select ${keyOf(t)} as k from public.${q(t.name)} t`)
    await c.query('release savepoint probe')
    return rows.map((r) => r.k)
  } catch (e) {
    await c.query('rollback to savepoint probe')
    if (e instanceof DatabaseError && e.code === '42501') return null
    throw e
  }
}

async function scanUser(label: 'bea' | 'ben', userId: string, tables: Tbl[], aRows: Map<string, { keys: string[]; json: unknown }>) {
  const leaks: string[] = []
  const masked: string[] = []      // 복사 insert 를 트리거·권한이 RLS 보다 먼저 거부한 표 — OWN_INSERT_PROBES 로 덮여야 한다
  const badProbes: string[] = []   // RLS 거부가 아닌 오류로 끝난 탐침 — 정책까지 가지 못했다
  const grantDenied: string[] = []  // update 할 열이 없어 권한(permission denied)이 막은 표 — UPDATE_DENIED_BY_GRANT 와 같아야 한다
  await asUser(pool, userId, async (c) => {
    for (const t of tables) {
      const a = aRows.get(t.name)!
      const seen = await readKeys(c, t)
      if (seen && !OPEN_BY_DESIGN.has(t.name) && a.keys.some((k) => seen.includes(k))) leaks.push(`${t.name}:read`)
      if (a.keys.length === 0) continue
      // INSERT 할 수 있는 컬럼이 하나도 없으면 권한이 온전한 벽이다 — 복사 insert 를 만들 수 없다
      if (t.cols.length > 0) {
        const cols = t.cols.map(q).join(', ')
        const ins = await probe(c,
          `insert into public.${q(t.name)} (${cols}) select ${cols} from json_populate_record(null::public.${q(t.name)}, $1::json)`, [a.json])
        if (!ins.err || passedRls(ins.err)) leaks.push(`${t.name}:insert`)
        else if (!isRlsDenial(ins.err)) masked.push(t.name)
      }
      // update 탐침은 authenticated 가 UPDATE 할 수 있는 열로 한다 — PK 열의 권한이 없으면 42501 로 멈춰 정책이 평가되지 않는다(H2 이월).
      // 그런 열이 없는 표는 권한이 온전한 벽이다: 42501(permission denied)을 기대하고 표를 기록한다.
      if (t.upd) {
        const upd = await probe(c, `update public.${q(t.name)} t set ${q(t.upd)} = t.${q(t.upd)} where ${keyOf(t)} = $1`, [a.keys[0]])
        if (upd.err ? upd.err.code !== '42501' : upd.rowCount > 0) leaks.push(`${t.name}:update`)
        else if (upd.err && !isRlsDenial(upd.err)) badProbes.push(`${t.name}:update ${upd.err.code} ${upd.err.message}`)
      } else {
        // `= default` — identity(GENERATED ALWAYS) PK 는 `= t.id` 를 권한 검사 전에 428C9 로 거절한다(0012 이력 표). default 는 ACL 까지 간다
        const upd = await probe(c, `update public.${q(t.name)} t set ${q(t.pk[0])} = default where ${keyOf(t)} = $1`, [a.keys[0]])
        if (upd.err?.code === '42501' && upd.err.message.includes('permission denied')) grantDenied.push(t.name)
        else leaks.push(`${t.name}:update`)
      }
      const del = await probe(c, `delete from public.${q(t.name)} t where ${keyOf(t)} = $1`, [a.keys[0]])
      if (del.err ? del.err.code !== '42501' : del.rowCount > 0) leaks.push(`${t.name}:delete`)
    }
    for (const p of OWN_INSERT_PROBES) {
      const r = await probe(c, p.sql, [userId])
      if (!r.err || passedRls(r.err)) leaks.push(`${p.table}:insert-own`)
      else if (!isRlsDenial(r.err)) badProbes.push(`${p.table}: ${r.err.code} ${r.err.message}`)
    }
  })
  return { label, leaks: leaks.sort(), masked, badProbes, grantDenied: grantDenied.sort() }
}

describe('워크스페이스 전수 교차(SP2 §5.1)', () => {
  it('public 의 표는 전부 RLS, 뷰는 security_invoker — 허용 목록(RLS_EXEMPT) 밖 0건', async () => {
    const rels = await asService(pool, async (c) => (await c.query<Rel>(RELATIONS_SQL)).rows)
    expect(rlsGaps(rels), 'RLS 가 걸리지 않은 관계').toEqual([])
    expect(Object.keys(RLS_EXEMPT).filter((n) => !rels.some((r) => r.name === n)), '죽은 예외').toEqual([])
    for (const [name, reason] of Object.entries(RLS_EXEMPT)) expect(reason.length, name).toBeGreaterThan(10)
  })

  it('민감도 — RLS 를 끈 표·security_invoker 없는 뷰를 만들면 관계 검사가 잡고, 그 표는 스캔 목록에도 들어간다', async () => {
    await asService(pool, async (c) => {
      await c.query('create table public.rls_probe_open (id int primary key)')
      await c.query('create view public.rls_probe_view as select 1 as x')
      expect(rlsGaps((await c.query<Rel>(RELATIONS_SQL)).rows))
        .toEqual(['rls_probe_open: RLS 꺼짐', 'rls_probe_view: 뷰가 security_invoker 가 아님'])
      expect((await c.query<Tbl>(TABLES_SQL)).rows.map((t) => t.name)).toContain('rls_probe_open')
    })
  })

  it('카탈로그의 표 = 판별 맵의 표(새 표는 스코프를 정해야 한다)', async () => {
    const names = await asService(pool, async (c) => (await c.query<Tbl>(TABLES_SQL)).rows.map((t) => t.name))
    expect(names.filter((n) => !(n in A_ROW_FILTER)), '판별식 없는 새 표').toEqual([])
    expect(Object.keys(A_ROW_FILTER).filter((n) => !names.includes(n)), '사라진 표(맵에서 뺀다)').toEqual([])
  })

  it('INSERT·ALL 정책의 WITH CHECK 가 자기 컬럼을 auth.uid() 와 비교하는 표는 자기 이름 insert 탐침이 있다(소유자 비교가 스코프 판정을 가린다)', async () => {
    const owned = await asService(pool, async (c) => (await c.query<{ name: string }>(OWNER_CHECK_TABLES_SQL)).rows.map((r) => r.name))
    const probeTables = new Set(OWN_INSERT_PROBES.map((p) => p.table))
    expect(owned.filter((t) => !probeTables.has(t)), '탐침 없음').toEqual([])
  })

  it('B 계정(bea·ben)이 A 의 행을 읽거나 쓰는 경로 = KNOWN_LEAKS(0006 뒤에는 없음)', async () => {
    const tables = await asService(pool, async (c) => (await c.query<Tbl>(TABLES_SQL)).rows)
    const aRows = new Map<string, { keys: string[]; json: unknown }>()
    await asService(pool, async (c) => {
      for (const t of tables) {
        const { rows } = await c.query<{ k: string; j: unknown }>(
          `select ${keyOf(t)} as k, row_to_json(t) as j from public.${q(t.name)} t where ${A_ROW_FILTER[t.name]} order by 1`)
        aRows.set(t.name, { keys: rows.map((r) => r.k), json: rows[0]?.j ?? null })
      }
    })
    // 비어 있는 표는 UNFILLED 에 사유가 있어야 하고, UNFILLED 는 실제로 비어 있어야 한다(죽은 예외 금지)
    const empty = tables.filter((t) => aRows.get(t.name)!.keys.length === 0).map((t) => t.name)
    expect(empty.filter((n) => !(n in UNFILLED)), '픽스처가 A 행을 못 넣은 표').toEqual([])
    expect(Object.keys(UNFILLED).filter((n) => !empty.includes(n)), 'UNFILLED 인데 행이 있다').toEqual([])

    const results = [
      await scanUser('bea', F.users.bAdmin, tables, aRows),
      await scanUser('ben', F.users.bMember, tables, aRows),
    ]
    const probeTables = new Set(OWN_INSERT_PROBES.map((p) => p.table))
    for (const r of results) {
      expect(r.leaks, `${r.label} 의 누설`).toEqual([...KNOWN_LEAKS[r.label]].sort())
      expect(r.badProbes, `${r.label}: RLS 거부로 끝나지 않은 탐침(정책까지 가지 못했다)`).toEqual([])
      expect(r.masked.filter((t) => !probeTables.has(t)), `${r.label}: 트리거·권한이 복사 insert 를 먼저 막았는데 탐침 없음`).toEqual([])
      // A 행이 있는 표만 탐침한다 — UNFILLED 가 비어 있으므로 목록 전체가 나와야 한다
      expect(r.grantDenied, `${r.label}: update 가 권한으로 막힌 표`).toEqual([...UPDATE_DENIED_BY_GRANT].sort())
    }
  })

  it('대조: B 계정은 자기 워크스페이스 프로젝트를 본다 — 위 0행이 세션 흉내 실패가 아니다', async () => {
    for (const uid of [F.users.bAdmin, F.users.bMember]) {
      await asUser(pool, uid, async (c) => {
        const { rows } = await c.query('select id from public.projects where id = $1', [F.projects.bWs])
        expect(rows).toHaveLength(1)
      })
    }
  })

  it('update 할 열이 하나도 없는 표 = UPDATE_DENIED_BY_GRANT(실측 has_any_column_privilege) — 새 표가 끼거나 권한이 열리면 목록을 고쳐야 한다', async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname::text as name from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
          and not has_any_column_privilege('authenticated', c.oid, 'UPDATE') order by 1`)
    expect(rows.map((r) => r.name)).toEqual([...UPDATE_DENIED_BY_GRANT].sort())
  })

  it('민감도 — 열 권한만 있는 표(workspace_members)의 쓰기 정책을 열면 고친 탐침이 잡는다. PK 탐침은 권한에서 멈춰 못 잡았다', async () => {
    await asService(pool, async (c) => {
      await c.query('drop policy workspace_members_write on public.workspace_members')
      await c.query('create policy workspace_members_write on public.workspace_members for all to authenticated using (true) with check (true)')
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.bAdmin, role: 'authenticated' })])
      const key = `(${F.ws},${F.users.aLoose})`
      expect(await pgError(c, `update public.workspace_members t set workspace_id = t.workspace_id where row(t.workspace_id, t.user_id)::text = $1`, [key]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
      const upd = await c.query(`update public.workspace_members t set role = t.role where row(t.workspace_id, t.user_id)::text = $1`, [key])
      expect(upd.rowCount, 'role 열 탐침은 열린 정책을 지나 행을 고친다').toBe(1)
    })
  })
})
