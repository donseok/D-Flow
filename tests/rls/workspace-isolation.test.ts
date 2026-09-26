// SP2 done_when 본체: B 워크스페이스 계정이 A 의 전 RLS 표를 0행 읽고, 쓰기가 전부 거부되는가.
// 표 목록은 카탈로그에서 읽는다(pg_class.relrowsecurity) — 새 표는 isolation-map 에 판별식이 없으면 실패한다.
// 읽기: A 행의 PK 튜플 집합 ∩ B 세션이 보는 PK 튜플 집합 = ∅. 쓰기: A 행 한 개를 복사 insert·자기 자신으로 update·delete.
// 쓰기 판정: 오류가 RLS(42501)·트리거 거부면 막힌 것, 23505·23503·23502·23P01·CHECK 위반(제약 이름 있음)이면 RLS 를 통과한 것.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool } from './harness'
import { A_ROW_FILTER, KNOWN_LEAKS, OPEN_BY_DESIGN, OWN_INSERT_PROBES, UNFILLED } from './isolation-map'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const RLS_TABLES_SQL = `
  select c.relname::text as name,
         array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                where i.indrelid = c.oid and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)) as pk,
         array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and a.attgenerated = '' order by a.attnum) as cols
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity order by 1`

type Tbl = { name: string; pk: string[]; cols: string[] }
const q = (id: string) => `"${id}"`
const keyOf = (t: Tbl) => `row(${t.pk.map((c) => `t.${q(c)}`).join(', ')})::text`

/** RLS 를 통과한 뒤에야 나는 오류(=쓰기가 정책에서 막히지 않았다) */
function passedRls(e: DatabaseError): boolean {
  return ['23505', '23503', '23502', '23P01'].includes(e.code ?? '') || (e.code === '23514' && Boolean(e.constraint))
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
  const notes: string[] = []   // RLS 보다 트리거가 먼저 거부한 insert — 보고서용(단언 아님)
  await asUser(pool, userId, async (c) => {
    for (const t of tables) {
      const a = aRows.get(t.name)!
      const seen = await readKeys(c, t)
      if (seen && !OPEN_BY_DESIGN.has(t.name) && a.keys.some((k) => seen.includes(k))) leaks.push(`${t.name}:read`)
      if (a.keys.length === 0) continue
      const cols = t.cols.map(q).join(', ')
      const ins = await probe(c,
        `insert into public.${q(t.name)} (${cols}) select ${cols} from json_populate_record(null::public.${q(t.name)}, $1::json)`, [a.json])
      if (!ins.err || passedRls(ins.err)) leaks.push(`${t.name}:insert`)
      else if (ins.err.code !== '42501') notes.push(`${t.name}: ${ins.err.code} ${ins.err.message}`)
      const upd = await probe(c, `update public.${q(t.name)} t set ${q(t.pk[0])} = t.${q(t.pk[0])} where ${keyOf(t)} = $1`, [a.keys[0]])
      if (!upd.err && upd.rowCount > 0) leaks.push(`${t.name}:update`)
      const del = await probe(c, `delete from public.${q(t.name)} t where ${keyOf(t)} = $1`, [a.keys[0]])
      if (!del.err && del.rowCount > 0) leaks.push(`${t.name}:delete`)
    }
    for (const p of OWN_INSERT_PROBES) {
      const r = await probe(c, p.sql, [userId])
      if (!r.err || passedRls(r.err)) leaks.push(`${p.table}:insert-own`)
    }
  })
  if (notes.length) console.info(`[${label}] 트리거가 먼저 거부한 insert:\n  ${notes.join('\n  ')}`)
  return { label, leaks: leaks.sort() }
}

describe('워크스페이스 전수 교차(SP2 §5.1)', () => {
  it('카탈로그의 RLS 표 = 판별 맵의 표(새 표는 스코프를 정해야 한다)', async () => {
    const names = await asService(pool, async (c) => (await c.query<Tbl>(RLS_TABLES_SQL)).rows.map((t) => t.name))
    expect(names.filter((n) => !(n in A_ROW_FILTER)), '판별식 없는 새 RLS 표').toEqual([])
    expect(Object.keys(A_ROW_FILTER).filter((n) => !names.includes(n)), '사라진 표(맵에서 뺀다)').toEqual([])
  })

  it('B 계정(bea·ben)이 A 의 행을 읽거나 쓰는 경로 = KNOWN_LEAKS(0006 뒤에는 없음)', async () => {
    const tables = await asService(pool, async (c) => (await c.query<Tbl>(RLS_TABLES_SQL)).rows)
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
    for (const r of results) expect(r.leaks, `${r.label} 의 누설`).toEqual([...KNOWN_LEAKS[r.label]].sort())
  })

  it('대조: B 계정은 자기 워크스페이스 프로젝트를 본다 — 위 0행이 세션 흉내 실패가 아니다', async () => {
    for (const uid of [F.users.bAdmin, F.users.bMember]) {
      await asUser(pool, uid, async (c) => {
        const { rows } = await c.query('select id from public.projects where id = $1', [F.projects.bWs])
        expect(rows).toHaveLength(1)
      })
    }
  })
})
