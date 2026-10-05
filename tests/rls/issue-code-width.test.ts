// 0010 이슈 코드 폭 — 일련번호 100 이상을 자르지 않는다(PI-I-R99-100). 0000 의 lpad(…, 2) 는 100 을 '10' 으로 잘라 10번과 코드가 겹쳤다.
// 0010 의 폭 규칙(최소 n자리·절단 금지 — lpad(seq, greatest(n, 자릿수)))을 SP5 B1 채번 트리거(assign_issue_code·render_issue_code)가 잇는다.
// 픽스처 c1 에 롤백 트랜잭션 안에서 현 동작 재현 템플릿(PI-I-{area}-{seq:2}, 영역별 범위)을 쓰고, 이슈 영역 …1bf0(R99)·
// 카운터 (c1, a:…1bf0)(fixture-ws.sql)를 쓴다. 전부 begin…rollback 안이라 정책·카운터 조작은 남지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const AREA = '00000000-0000-0000-7e57-000000001bf0'
const SCOPE = `a:${AREA}`
const PI = { prefix: 'PI', pattern: '{prefix}-I-{area}-{seq:2}', counter_scope: 'area', reset: 'never' }
const usePolicy = (c: PoolClient) =>
  c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`, [F.projects.a, JSON.stringify({ 'issues.id_policy': PI })])
// last_no 는 CHECK(last_no > 0) 라 0 으로 못 돌린다 — 1번부터 보려면 행을 지워 트리거가 1 로 새로 만들게 한다.
const dropCounter = (c: PoolClient) =>
  c.query(`delete from public.issue_number_counters where project_id = $1 and scope_key = $2`, [F.projects.a, SCOPE])
const setCounter = (c: PoolClient, n: number) =>
  c.query(`update public.issue_number_counters set last_no = $3 where project_id = $1 and scope_key = $2`, [F.projects.a, SCOPE, n])
const classify = async (c: PoolClient, title: string) =>
  (await c.query<{ code_seq: string; code: string }>(
    `insert into public.issues (project_id, title, area_id) values ($1, $2, $3) returning code_seq, code`,
    [F.projects.a, title, AREA],
  )).rows[0]

describe('이슈 코드 일련번호 폭(0010 → SP5 B1 채번 트리거)', () => {
  it('한 자리는 01, 10·99 는 그대로, 100·101 은 자르지 않는다 — 10번이 있어도 23505 없이', async () => {
    await asService(pool, async (c) => {
      await usePolicy(c)
      await dropCounter(c)
      expect((await classify(c, 'seq1')).code).toBe('PI-I-R99-01')
      await setCounter(c, 9)
      expect((await classify(c, 'seq10')).code).toBe('PI-I-R99-10')
      await setCounter(c, 98)
      expect((await classify(c, 'seq99')).code).toBe('PI-I-R99-99')
      const r100 = await classify(c, 'seq100')
      expect([Number(r100.code_seq), r100.code]).toEqual([100, 'PI-I-R99-100'])
      expect((await classify(c, 'seq101')).code).toBe('PI-I-R99-101')
      const { rows } = await c.query<{ last_no: string }>(
        `select last_no from public.issue_number_counters where project_id = $1 and scope_key = $2`, [F.projects.a, SCOPE])
      expect(Number(rows[0].last_no)).toBe(101)
    })
  })

  it('코드는 트리거만 매긴다 — 직접 넣으면(넓힌 코드든 잘린 코드든) ISSUE_CODE_MANAGED', async () => {
    await asService(pool, async (c) => {
      await usePolicy(c)
      for (const code of ['PI-I-R99-10', 'PI-I-R99-100'])
        expect(await pgError(c, `insert into public.issues (project_id, title, area_id, code, code_seq, code_scope) values ($1, 'chk', $2, $3, 100, $4)`,
          [F.projects.a, AREA, code, SCOPE]), code).toMatchObject({ code: '23514', message: 'ISSUE_CODE_MANAGED' })
    })
  })
})
