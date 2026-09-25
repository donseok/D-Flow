// 스키마 불변식 — 로컬 DB 카탈로그(pg_constraint)에서 본다. npm run test:rls 로 돈다(DB 가 떠 있어야 한다).
//
// 같은 public 표 쌍(자식 → 부모) 사이의 FK 는 하나다. 둘 이상이면 PostgREST 가 그 쌍의 임베드(`select('…, meetings(…)')`)를
// PGRST201("more than one relationship was found")로 거부해 조회가 통째로 실패한다 — 0003 이 단일 FK 를 남긴 채 복합 FK 를
// 더해 회의 목록·알림함이 빈 값이 된 결함(SP1 Task 11 E2E 실측, Task 3d 에서 수정)이 다시 들어오지 않게 막는다.
//
// 허용 목록은 기준선(0000)부터 있던 두 쌍뿐이다. 둘 다 서로 다른 컬럼(선행·후행, from·to)이 같은 부모를 가리키는 정당한
// 이중 관계이고, src 는 이 쌍을 임베드하지 않는다(2026-09-25 grep — task_dependencies 조회는 평면 컬럼만, wiki_item_relations
// 는 src 에서 읽지 않는다). 임베드가 필요해지면 `wbs_items!task_dependencies_predecessor_fk(…)` 처럼 FK 이름 힌트를 쓴다.
// 허용 쌍도 FK 이름 목록까지 고정한다 — 같은 쌍에 세 번째 FK 가 붙으면 실패한다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, openPool } from './harness'

let pool: Pool

beforeAll(() => {
  pool = openPool()
})

afterAll(async () => {
  await pool?.end()
})

const ALLOWED_MULTI_FK_PAIRS: Record<string, string[]> = {
  'task_dependencies → wbs_items': ['task_dependencies_predecessor_fk', 'task_dependencies_successor_fk'],
  'wiki_item_relations → wiki_items': ['wiki_item_relations_from_item_id_fkey', 'wiki_item_relations_to_item_id_fkey'],
}

const MULTI_FK_PAIRS_SQL = `
  select ch.relname as child, pa.relname as parent, array_agg(c.conname::text order by c.conname) as fks
    from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_class pa on pa.oid = c.confrelid
   where c.contype = 'f'
     and ch.relnamespace = 'public'::regnamespace
     and pa.relnamespace = 'public'::regnamespace
   group by ch.relname, pa.relname
  having count(*) >= 2
   order by ch.relname, pa.relname`

describe('스키마 불변식', () => {
  it('같은 public 표 쌍 사이 FK 는 하나(기준선 허용 2쌍 제외) — PostgREST 임베드 모호성(PGRST201) 방지', async () => {
    const rows = await asService(pool, async (c) =>
      (await c.query<{ child: string; parent: string; fks: string[] }>(MULTI_FK_PAIRS_SQL)).rows)

    const found = new Map(rows.map((r) => [`${r.child} → ${r.parent}`, r.fks]))
    const violations = [...found]
      .filter(([pair, fks]) => JSON.stringify(ALLOWED_MULTI_FK_PAIRS[pair]) !== JSON.stringify(fks))
      .map(([pair, fks]) => `${pair}: ${fks.join(', ')}`)
    expect(violations, `같은 표 쌍에 FK 가 2개 이상(허용 목록 밖):\n  ${violations.join('\n  ')}`).toEqual([])

    // 허용 목록이 낡으면(쌍이 사라지거나 FK 가 하나로 줄면) 목록도 줄인다 — 죽은 예외를 남기지 않는다
    const stale = Object.keys(ALLOWED_MULTI_FK_PAIRS).filter((pair) => !found.has(pair))
    expect(stale, `허용 목록의 쌍이 더는 FK 2개 이상이 아니다 — 목록에서 뺀다: ${stale.join(', ')}`).toEqual([])
  })
})
