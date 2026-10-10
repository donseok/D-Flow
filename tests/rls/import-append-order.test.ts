// *_import_append_order — WBS 가져오기의 추가(append)는 기존 트리 **뒤에** 붙는다(사용자 테스트 BUG-03). 예전엔 import_wbs 가 파일 안 순번
// (0부터)을 sort_order 에 그대로 써, 화면에서 만든 기존 항목(1부터)보다 앞서 기존 WBS 번호가 전부 밀렸다. 형제 정렬은 sort_order 다
// (computeTree — 동률은 입력 순). 케이스마다 begin…rollback 이다(asService).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P = F.projects.a
const node = (tempId: string, sortOrder: number, o: Record<string, unknown> = {}) =>
  ({ tempId, parentTempId: null, code: `NEW-${tempId}`, sortOrder, name: `새 ${tempId}`, owners: [], isOwnerSplit: false, ...o })
/** 최상위 항목의 이름 — 화면과 같은 순서(sort_order) */
const roots = async (c: PoolClient) =>
  (await c.query<{ name: string }>('select name from public.wbs_items where project_id = $1 and parent_id is null order by sort_order, id', [P])).rows.map((r) => r.name)
const childrenOf = async (c: PoolClient, parentName: string) =>
  (await c.query<{ name: string }>(
    `select w.name from public.wbs_items w join public.wbs_items p on p.id = w.parent_id
      where p.project_id = $1 and p.name = $2 order by w.sort_order, w.id`, [P, parentName])).rows.map((r) => r.name)
const IMPORT = `select public.import_wbs($1, $2::jsonb, '[]'::jsonb) as n`

describe('import_wbs — 추가는 기존 항목 뒤', () => {
  it('기존 최상위(화면에서 만든 순번 1·2)와 그 자식의 순서가 그대로이고, 새 항목은 파일 순서로 그 뒤에 온다', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.wbs_items where project_id = $1', [P])
      // 화면의 항목 추가와 같은 순번 — 형제 안에서 max + 1(1부터)
      const old1 = (await c.query<{ id: string }>(
        `insert into public.wbs_items (project_id, parent_id, code, sort_order, name) values ($1, null, '1', 1, '1. 착수준비') returning id`, [P])).rows[0].id
      await c.query(`insert into public.wbs_items (project_id, parent_id, code, sort_order, name) values ($1, null, '2', 2, '2. 설계')`, [P])
      await c.query(`insert into public.wbs_items (project_id, parent_id, code, sort_order, name) values ($1, $2, '1.1', 1, '요구사항 분석'), ($1, $2, '1.2', 2, '환경 구성')`, [P, old1])

      const items = [node('a', 0), node('a1', 1, { parentTempId: 'a' }), node('b', 2), node('b1', 3, { parentTempId: 'b' })]
      expect((await c.query<{ n: number }>(IMPORT, [P, JSON.stringify(items)])).rows[0].n).toBe(4)

      expect(await roots(c)).toEqual(['1. 착수준비', '2. 설계', '새 a', '새 b'])
      expect(await childrenOf(c, '1. 착수준비')).toEqual(['요구사항 분석', '환경 구성'])
      expect(await childrenOf(c, '새 a')).toEqual(['새 a1'])
    })
  })

  it('두 번 이어서 추가해도 먼저 가져온 묶음이 앞이다(리포트의 재현 — 두 번째 묶음이 첫 묶음 사이에 끼지 않는다)', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.wbs_items where project_id = $1', [P])
      await c.query(IMPORT, [P, JSON.stringify([node('a', 0), node('a1', 1, { parentTempId: 'a' })])])
      await c.query(IMPORT, [P, JSON.stringify([node('b', 0), node('b1', 1, { parentTempId: 'b' })])])
      expect(await roots(c)).toEqual(['새 a', '새 b'])
    })
  })

  it('빈 프로젝트는 지금처럼 0부터 매긴다', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.wbs_items where project_id = $1', [P])
      await c.query(IMPORT, [P, JSON.stringify([node('a', 0), node('b', 1)])])
      const orders = (await c.query<{ sort_order: number }>('select sort_order from public.wbs_items where project_id = $1 order by sort_order', [P])).rows.map((r) => r.sort_order)
      expect(orders).toEqual([0, 1])
    })
  })

  it('전체 교체(replace_wbs)는 먼저 다 지우므로 0부터 그대로다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.wbs_items (project_id, parent_id, code, sort_order, name) values ($1, null, 'X', 9, '지워질 항목')`, [P])
      await c.query(`select public.replace_wbs($1, $2::jsonb, '[]'::jsonb)`, [P, JSON.stringify([node('a', 0), node('b', 1)])])
      expect(await roots(c)).toEqual(['새 a', '새 b'])
    })
  })
})
