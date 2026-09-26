// 0010 이슈 분석 코드 폭 — 일련번호 100 이상을 자르지 않는다(PI-I-99-100). 0000 의 lpad(…, 2) 는 100 을 '10' 으로 잘라
// 10번과 코드가 겹쳤고(23505 로 그 영역이 영구 차단), CHECK 도 같은 식이라 잘린 코드를 통과시켰다.
// 픽스처 영역 '99'(fixture-ws.sql:77)·대분류 …110e(:112)·카운터 (c1,'99')(:191)를 쓴다. 전부 begin…rollback 안이라
// 카운터 조작은 남지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const MAJOR = '00000000-0000-0000-7e57-00000000110e'
// last_no 는 CHECK(last_no > 0) 라 0 으로 못 돌린다 — 1번부터 보려면 행을 지워 트리거가 1 로 새로 만들게 한다.
const dropCounter = (c: PoolClient) =>
  c.query(`delete from public.issue_number_counters where project_id = $1 and mega_code = '99'`, [F.projects.a])
const setCounter = (c: PoolClient, n: number) =>
  c.query(`update public.issue_number_counters set last_no = $2 where project_id = $1 and mega_code = '99'`, [F.projects.a, n])
const classify = async (c: PoolClient, title: string) =>
  (await c.query<{ mega_seq: string; pi_issue_code: string }>(
    `insert into public.issues (project_id, title, mega_code, major_id, sub_process, owner_department, source_type)
     values ($1, $2, '99', $3, 'rls', 'rls', 'other') returning mega_seq, pi_issue_code`,
    [F.projects.a, title, MAJOR],
  )).rows[0]

describe('0010 이슈 코드 일련번호 폭', () => {
  it('한 자리는 01, 10·99 는 그대로, 100·101 은 자르지 않는다 — 10번이 있어도 23505 없이', async () => {
    await asService(pool, async (c) => {
      await dropCounter(c)
      expect((await classify(c, 'seq1')).pi_issue_code).toBe('PI-I-99-01')
      await setCounter(c, 9)
      expect((await classify(c, 'seq10')).pi_issue_code).toBe('PI-I-99-10')
      await setCounter(c, 98)
      expect((await classify(c, 'seq99')).pi_issue_code).toBe('PI-I-99-99')
      const r100 = await classify(c, 'seq100')
      expect([Number(r100.mega_seq), r100.pi_issue_code]).toEqual([100, 'PI-I-99-100'])
      expect((await classify(c, 'seq101')).pi_issue_code).toBe('PI-I-99-101')
      const { rows } = await c.query<{ last_no: string }>(
        `select last_no from public.issue_number_counters where project_id = $1 and mega_code = '99'`, [F.projects.a])
      expect(Number(rows[0].last_no)).toBe(101)
    })
  })

  it('CHECK 도 같은 폭 — 트리거를 끄고 넣어도 잘린 코드는 23514, 넓힌 코드는 통과', async () => {
    await asService(pool, async (c) => {
      await c.query(`set local session_replication_role = replica`) // 트리거를 끄고 CHECK 만 본다(postgres 롤)
      const insert = `insert into public.issues (project_id, title, mega_code, mega_seq, pi_issue_code, major_id, sub_process, owner_department, source_type)
                      values ($1, 'chk', '99', 100, $2, $3, 'rls', 'rls', 'other')`
      expect(await pgError(c, insert, [F.projects.a, 'PI-I-99-10', MAJOR])).toMatchObject({ code: '23514' })
      expect(await pgError(c, insert, [F.projects.a, 'PI-I-99-100', MAJOR])).toBeNull()
    })
  })
})
