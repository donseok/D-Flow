// NNNN_calendar ⑤ — 사용현황 RPC 5종이 tz 를 인자로 받는다(스펙 D14·E32). language sql·INVOKER 유지(DEFINER 면 usage_events 의 RLS —
// read_usage_events(슈퍼유저) — 가 빠져 비슈퍼유저에게 열린다), 기본값 없음(빠뜨린 호출은 실패 — 조용히 UTC 가 되지 않는다), 잘못된 tz 는
// 행이 0이어도 22023(계획 P5 의 판정 케이스). 케이스는 begin…rollback, 시각은 2001-03 의 빈 창을 쓴다(다른 테스트·E2E 의 행과 겹치지 않는다).
import { type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

/** P5 의 판정 결과 — 과제 10 Step 6 이 plpgsql 대안으로 갔으면 'plpgsql' 로 바꾼다(그 사실을 커밋 ③ 메시지와 리허설 기록에 남긴다) */
const EXPECTED_LANG = 'sql'
const FNS = [
  'public.usage_daily_actives(date, date, text)',
  'public.usage_menu_ranking(date, date, text)',
  'public.usage_sessions(date, date, text, integer)',
  'public.usage_summary(date, date, date, text)',
  'public.usage_user_rollup(date, date, text)',
] as const
const OLD = ['public.usage_daily_actives(date, date)', 'public.usage_menu_ranking(date, date)', 'public.usage_sessions(date, date, integer)',
  'public.usage_summary(date, date, date)', 'public.usage_user_rollup(date, date)']
const LA = 'America/Los_Angeles'
// 2001-03-10 06:00Z = LA 03-09 22:00(PST, UTC−8), 20:00Z = LA 03-10 12:00 — UTC 로는 둘 다 03-10
const AT = ['2001-03-10T06:00:00Z', '2001-03-10T20:00:00Z']
const CALLS = (tz: string) => [
  ['select d::text as d, active_users, events from public.usage_daily_actives(p_from => $1, p_to => $2, p_timezone => $3) order by d', ['2001-03-09', '2001-03-10', tz]],
  ['select menu_key, events, active_users from public.usage_menu_ranking(p_from => $1, p_to => $2, p_timezone => $3)', ['2001-03-09', '2001-03-10', tz]],
  ['select public.usage_sessions(p_from => $1, p_to => $2, p_timezone => $3) as n', ['2001-03-09', '2001-03-10', tz]],
  ['select total_events::int, active_users::int, today_users::int from public.usage_summary(p_from => $1, p_to => $2, p_today => $3, p_timezone => $4)', ['2001-03-09', '2001-03-10', '2001-03-09', tz]],
  ['select user_id, events, active_days from public.usage_user_rollup(p_from => $1, p_to => $2, p_timezone => $3)', ['2001-03-09', '2001-03-10', tz]],
] as const

async function seed(c: PoolClient) {
  for (const at of AT) {
    await c.query(`insert into public.usage_events (user_id, menu_key, path, occurred_at) values ($1, 'rls-usage-tz', '/rls/usage-tz', $2)`,
      [F.users.platform, at])
  }
}
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}

describe('⑤ 일자 경계 — 같은 사건이 tz 에 따라 다른 날짜로 묶인다', () => {
  it('LA 는 03-09·03-10 이틀, UTC 는 03-10 하루(일별·요약·사용자 집계)', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      const daily = async (tz: string) => (await c.query(CALLS(tz)[0][0], [...CALLS(tz)[0][1]])).rows
      expect(await daily(LA)).toEqual([{ d: '2001-03-09', active_users: 1, events: 1 }, { d: '2001-03-10', active_users: 1, events: 1 }])
      expect(await daily('UTC')).toEqual([{ d: '2001-03-10', active_users: 1, events: 2 }])
      const summary = async (tz: string) => (await c.query(CALLS(tz)[3][0], [...CALLS(tz)[3][1]])).rows[0]
      expect(await summary(LA)).toEqual({ total_events: 2, active_users: 1, today_users: 1 })     // p_today = 03-09 — LA 로는 첫 사건이 그날
      expect(await summary('UTC')).toEqual({ total_events: 2, active_users: 1, today_users: 0 })
      const rollup = async (tz: string) => (await c.query(CALLS(tz)[4][0], [...CALLS(tz)[4][1]])).rows
      expect(await rollup(LA)).toEqual([{ user_id: F.users.platform, events: 2, active_days: 2 }])
      expect(await rollup('UTC')).toEqual([{ user_id: F.users.platform, events: 2, active_days: 1 }])
      expect((await c.query(CALLS(LA)[2][0], [...CALLS(LA)[2][1]])).rows).toEqual([{ n: 2 }])   // 14시간 간격 — 세션 둘(기본 30분)
      expect((await c.query(CALLS(LA)[1][0], [...CALLS(LA)[1][1]])).rows).toEqual([{ menu_key: 'rls-usage-tz', events: 2, active_users: 1 }])
    })
  })

  it('창의 경계도 tz 를 따른다 — LA 03-10 하루 창에 UTC 03-10 06:00(LA 03-09 밤)은 들지 않는다', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      const { rows } = await c.query('select d::text as d, events from public.usage_daily_actives($1, $2, $3)', ['2001-03-10', '2001-03-10', LA])
      expect(rows).toEqual([{ d: '2001-03-10', events: 1 }])
    })
  })
})

describe('⑤ 잘못된 tz — 행이 0이어도 22023(P5)', () => {
  for (const tz of ['Mars/Olympus', 'Asia/Seol']) {
    it(`${tz}: 표를 비운 트랜잭션·빈 창·행이 있는 창 모두에서 다섯 함수가 22023`, async () => {
      await asService(pool, async (c) => {
        await c.query('delete from public.usage_events')                       // 롤백된다 — 빈 표에서의 판정
        for (const [sql, args] of CALLS(tz)) {
          expect(await pgError(c, sql, [...args]), `빈 표 ${sql.slice(0, 48)}`).toMatchObject({ code: '22023' })
        }
        await seed(c)
        for (const [sql, args] of CALLS(tz)) {
          expect(await pgError(c, sql, [...args]), `행 있음 ${sql.slice(0, 48)}`).toMatchObject({ code: '22023' })
        }
      })
    })
  }

  it('tz 를 빠뜨리면 함수를 찾지 못한다(42883 — 기본값 없음), 옛 시그니처는 남지 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, 'select * from public.usage_daily_actives($1::date, $2::date)', ['2001-03-09', '2001-03-10'])).toMatchObject({ code: '42883' })
      expect(await pgError(c, 'select public.usage_sessions(p_from => $1::date, p_to => $2::date)', ['2001-03-09', '2001-03-10'])).toMatchObject({ code: '42883' })
      const { rows } = await c.query<{ fn: string; oid: string | null }>(
        'select x.fn, to_regprocedure(x.fn)::text as oid from unnest($1::text[]) as x(fn)', [OLD])
      expect(rows.filter((r) => r.oid !== null)).toEqual([])
    })
  })
})

describe('⑤ RLS 는 그대로 — INVOKER 라 비슈퍼유저 세션은 0을 센다', () => {
  it('슈퍼유저 세션은 행을 보고, 일반 멤버 세션은 0행·0건(D14 — DEFINER 로 바꾸면 이 케이스가 깨진다)', async () => {
    const run = async (userId: string) => asService(pool, async (c) => {
      await seed(c)
      await toSession(c, userId)
      const daily = (await c.query('select count(*)::int as n from public.usage_daily_actives($1, $2, $3)', ['2001-03-09', '2001-03-10', LA])).rows[0].n
      const total = (await c.query('select total_events::int as t from public.usage_summary($1, $2, $3, $4)', ['2001-03-09', '2001-03-10', '2001-03-09', LA])).rows[0].t
      return { daily, total }
    })
    expect(await run(F.users.platform)).toEqual({ daily: 2, total: 2 })
    expect(await run(F.users.member)).toEqual({ daily: 0, total: 0 })
  })
})

describe('⑤ 실행 권한·언어·보안 속성(EXECUTE 기대표 — §3.1 예외 ①)', () => {
  it('public·anon 거짓, authenticated·service_role 참, INVOKER, 언어 = EXPECTED_LANG', async () => {
    const { rows } = await pool.query(
      `select x.fn,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as pub,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
              p.prosecdef as secdef, l.lanname as lang, p.provolatile as vol
         from unnest($1::text[]) as x(fn) join pg_proc p on p.oid = x.fn::regprocedure join pg_language l on l.oid = p.prolang`, [FNS])
    expect(rows).toEqual(FNS.map((fn) => ({ fn, pub: false, anon: false, auth: true, svc: true, secdef: false, lang: EXPECTED_LANG, vol: 's' })))
  })

  it('usage_sessions 의 p_gap_minutes 는 끝에서 기본값 30 을 유지한다 — 이름 인자로 빼면 30분 간격', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.usage_events (user_id, menu_key, path, occurred_at) values
        ($1, 'rls-usage-tz', '/x', '2001-03-10T10:00:00Z'), ($1, 'rls-usage-tz', '/x', '2001-03-10T10:20:00Z'),
        ($1, 'rls-usage-tz', '/x', '2001-03-10T11:00:00Z')`, [F.users.platform])
      expect((await c.query('select public.usage_sessions(p_from => $1, p_to => $2, p_timezone => $3) as n', ['2001-03-10', '2001-03-10', 'UTC'])).rows)
        .toEqual([{ n: 2 }])
      expect((await c.query('select public.usage_sessions($1, $2, $3, 10) as n', ['2001-03-10', '2001-03-10', 'UTC'])).rows).toEqual([{ n: 3 }])
    })
  })
})
