// H2-i(H1 이월) — 승인·반려는 RPC 가 주문 행 잠금 아래에서 사람이 본 completion 보고 id 와 최신 보고를 비교한다. 앱 대조와 전이
// 사이에 재보고가 끼면 stale 로 거부되고 아무것도 쓰이지 않는다. 순서는 앱(latestCompletionReportId)과 같다: created_at 내림차순,
// 같으면 id 가 큰 쪽. 다른 사건은 인자를 보지 않는다. 새 시그니처는 service_role 만 실행한다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ORDER = '00000000-0000-0000-7e57-000000001270'
const R1 = '00000000-0000-0000-7e57-000000001271'
const R2 = '00000000-0000-0000-7e57-000000001272'
const RPC = 'select public.apply_workflow_event($1, $2, null, $3, null, null, null, $4) as r'
const STALE = { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' }
/**
 * 가드가 거절하는 격리 수준(read committed 가 아닌 것 전부 — 0011 ①·⑧·⑨·⑩ 공통 규칙). repeatable read·serializable 은 문장들이 트랜잭션
 * 스냅샷 하나를 같이 써 잠금을 기다린 뒤의 조회도 기다리기 전의 스냅샷으로 읽는다. read uncommitted 는 이름으로 판정해 함께 거절된다.
 */
const REFUSED_LEVELS = ['repeatable read', 'serializable', 'read uncommitted'] as const
const INSERT_REPORT = `insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent, created_at)
  values ($1, $2, 'completion', 100, 'h2', 'rls-agent', now() - make_interval(mins => $3))`

async function seed(c: PoolClient, reports: Array<[string, string]> = [[R1, "now() - interval '2 minutes'"], [R2, "now() - interval '1 minute'"]]) {
  await c.query('update public.wbs_items set dev_workflow = true where id = $1', [F.leaf.aErp])
  await c.query(`insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, 'reported')`,
    [ORDER, F.projects.a, F.leaf.aErp])
  for (const [id, at] of reports) {
    await c.query(`insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent, created_at)
      values ($1, $2, 'completion', 100, 'h2', 'rls-agent', ${at})`, [id, ORDER])
  }
}
const orderStatus = async (c: PoolClient, id: string = ORDER) =>
  (await c.query('select status from public.agent_work_orders where id = $1', [id])).rows[0].status

/** 격리 수준을 정한 트랜잭션 하나 — 늘 rollback 한다(하네스의 asService 는 격리 수준을 받지 않는다) */
async function inLevel<T>(level: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query(`begin isolation level ${level}`)
    return await fn(c)
  } finally {
    await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
  }
}

describe('H2-i apply_workflow_event p_expected_report_id', () => {
  it.each(['approve', 'reject'])('%s: 본 보고가 최신이 아니면 report_stale, 주문·단계 불변 — 최신이면 전이', async (event) => {
    await asService(pool, async (c) => {
      await seed(c)
      expect((await c.query(RPC, [event, F.users.member, ORDER, R1])).rows[0].r).toEqual(STALE)
      expect(await orderStatus(c)).toBe('reported')
      expect((await c.query('select stage, actual_pct from public.wbs_items where id = $1', [F.leaf.aErp])).rows[0])
        .toEqual({ stage: null, actual_pct: null })
      expect((await c.query(RPC, [event, F.users.member, ORDER, R2])).rows[0].r).toMatchObject({ ok: true })
      expect(await orderStatus(c)).toBe(event === 'approve' ? 'approved' : 'claimed')
    })
  })

  it('보고가 없으면 null 이 일치하고, 보고가 있는데 null(인자 생략)이면 stale', async () => {
    await asService(pool, async (c) => {
      await seed(c, [])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, null])).rows[0].r).toMatchObject({ ok: true })
    })
    await asService(pool, async (c) => {
      await seed(c)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, null])).rows[0].r).toEqual(STALE)
      expect((await c.query('select public.apply_workflow_event($1, $2, null, $3) as r', ['approve', F.users.member, ORDER])).rows[0].r)
        .toEqual(STALE)
    })
  })

  it('보고가 없는데 id 를 주면 stale 이다(null 과 다르다) — progress 보고는 최신 판정에 끼지 않는다', async () => {
    await asService(pool, async (c) => {
      await seed(c, [])
      await c.query(`insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent)
        values ($1, $2, 'progress', 50, 'h2', 'rls-agent')`, [R2, ORDER])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R2])).rows[0].r).toEqual(STALE)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, null])).rows[0].r).toMatchObject({ ok: true })
    })
  })

  it('created_at 이 같으면 id 가 큰 쪽이 최신이다(앱과 같은 순서)', async () => {
    await asService(pool, async (c) => {
      await seed(c, [[R1, "'2026-09-27T00:00:00Z'"], [R2, "'2026-09-27T00:00:00Z'"]])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R1])).rows[0].r).toEqual(STALE)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R2])).rows[0].r).toMatchObject({ ok: true })
    })
  })

  it('주문 상태가 기대와 다르면 보고 대조보다 먼저 conflict 다(0000 의 CAS 순서 유지)', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      await c.query(`update public.agent_work_orders set status = 'claimed' where id = $1`, [ORDER])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R1])).rows[0].r)
        .toEqual({ ok: false, conflict: true, order_status: 'claimed' })
    })
  })

  it('다른 사건은 인자를 보지 않는다 — unapprove 는 아무 id 로도 진행', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      await c.query(`update public.agent_work_orders set status = 'approved' where id = $1`, [ORDER])
      expect((await c.query(RPC, ['unapprove', F.users.member, ORDER, '00000000-0000-0000-7e57-0000000012fe'])).rows[0].r)
        .toMatchObject({ ok: true, order_status: 'reported' })
    })
  })

  // SP5b(D11 — 의도적 수정 표): 9인자(p_expected_step)가 지금 시그니처다 — 0011 의 8인자도 옛 것이 됐다
  it('새 시그니처만 있고 service_role 만 실행한다(authenticated·anon 없음)', async () => {
    const SIG = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)'
    const { rows: [r] } = await pool.query(`select
      to_regprocedure('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)') is null
        and to_regprocedure('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)') is null as old_gone,
      has_function_privilege('authenticated', '${SIG}', 'EXECUTE') as auth,
      has_function_privilege('anon', '${SIG}', 'EXECUTE') as anon,
      has_function_privilege('service_role', '${SIG}', 'EXECUTE') as svc`)
    expect(r).toEqual({ old_gone: true, auth: false, anon: false, svc: true })
  })

  it('ACL 은 0000 과 같다(postgres·service_role 만, PUBLIC 없음) — 함수는 하나뿐이고 INVOKER·search_path 없음 그대로', async () => {
    const { rows } = await pool.query<{ sig: string; definer: boolean; config: string[] | null; grantees: string[] }>(`
      select p.oid::regprocedure::text as sig, p.prosecdef as definer, p.proconfig as config,
             (select array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by 1)
                from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE') as grantees
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'apply_workflow_event'`)
    expect(rows).toEqual([{
      sig: 'apply_workflow_event(text,uuid,uuid,uuid,text,text,uuid,uuid,text)', definer: false, config: null,
      grantees: ['postgres', 'service_role'],
    }])
  })

  it('실제 롤로 부른다 — service_role 은 전이하고, authenticated·anon 은 함수 실행 권한이 없다(42501)', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      for (const role of ['authenticated', 'anon']) {
        await c.query(`set local role ${role}`)
        const err = await pgError(c, RPC, ['approve', F.users.member, ORDER, R2])
        expect(err, role).toMatchObject({ code: '42501' })
        expect(err?.message, role).toMatch(/permission denied for function apply_workflow_event/)
        await c.query('reset role')
      }
      await c.query('set local role service_role')
      expect((await c.query<{ r: string }>('select current_user::text as r')).rows[0].r).toBe('service_role')
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R1])).rows[0].r).toEqual(STALE)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R2])).rows[0].r).toMatchObject({ ok: true, order_status: 'approved' })
    })
  })

  it('read committed 가 아닌 트랜잭션의 승인·반려는 주문 행을 잠근 뒤 WORKFLOW_EVENT_ISOLATION(25001) — repeatable read·serializable·read uncommitted. read committed 는 통과', async () => {
    // serializable 도 트랜잭션 스냅샷 하나로 읽는다. SSI 가 한쪽을 중단하는 것은 상대도 serializable 일 때뿐이고 재보고(PostgREST)는 read committed 다
    const ISOLATION = { code: '25001', message: 'WORKFLOW_EVENT_ISOLATION' }
    for (const event of ['approve', 'reject']) {
      for (const level of REFUSED_LEVELS) {
        await inLevel(level, async (c) => {
          await seed(c)
          // 본 보고가 최신이어도, 아니어도 거절한다 — 대조 자체를 믿을 수 없다
          expect(await pgError(c, RPC, [event, F.users.member, ORDER, R2]), `${level} ${event}`).toMatchObject(ISOLATION)
          expect(await pgError(c, RPC, [event, F.users.member, ORDER, R1]), `${level} ${event}`).toMatchObject(ISOLATION)
          expect(await orderStatus(c), `${level} ${event}`).toBe('reported')
        })
      }
      await inLevel('read committed', async (c) => {
        await seed(c)
        expect((await c.query(RPC, [event, F.users.member, ORDER, R1])).rows[0].r, event).toEqual(STALE)
        expect((await c.query(RPC, [event, F.users.member, ORDER, R2])).rows[0].r, event).toMatchObject({ ok: true })
        expect(await orderStatus(c), event).toBe(event === 'approve' ? 'approved' : 'claimed')
      })
    }
  })

  it('read committed 가 아니어도 대조하지 않는 사건(unapprove·claim)은 그대로 진행한다', async () => {
    for (const level of REFUSED_LEVELS) {
      await inLevel(level, async (c) => {
        await seed(c)
        await c.query(`update public.agent_work_orders set status = 'approved' where id = $1`, [ORDER])
        expect((await c.query(RPC, ['unapprove', F.users.member, ORDER, null])).rows[0].r, level).toMatchObject({ ok: true, order_status: 'reported' })
      })
      await inLevel(level, async (c) => {
        await seed(c)
        await c.query(`update public.agent_work_orders set status = 'ready' where id = $1`, [ORDER])
        expect((await c.query(RPC, ['claim', F.users.member, ORDER, null])).rows[0].r, level).toMatchObject({ ok: true, order_status: 'claimed' })
      })
    }
  })

  it.each(['approve', 'reject'])('잔여 창(%s) — 주문 행 잠금을 기다리는 사이 재보고가 커밋되면 잠금 뒤 대조가 새 보고를 보고 stale 로 거절한다', async (event) => {
    // 두 연결 사이의 커밋이 필요해 이 케이스만 데이터를 커밋한다 — 전용 주문(항목 없음)·보고를 만들고 finally 에서 지운다(픽스처 행은 건드리지 않는다).
    // 준비는 try 안이고, 넣기 전에 같은 id 를 지운다 — 앞선 실행이 준비 도중 실패했거나 죽어서 남긴 행이 다음 실행을 막지 않는다.
    const O = '00000000-0000-0000-7e57-000000001273'
    const SEEN = '00000000-0000-0000-7e57-000000001274'
    const NEWER = '00000000-0000-0000-7e57-000000001275'
    const cleanup = async () => {
      await pool.query('delete from public.agent_work_reports where work_order_id = $1 or id in ($2, $3)', [O, SEEN, NEWER])
      await pool.query('delete from public.agent_work_orders where id = $1', [O])
    }
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query(`insert into public.agent_work_orders (id, project_id, status) values ($1, $2, 'reported')`, [O, F.projects.a])
      s1 = await pool.connect()
      s2 = await pool.connect()
      await s1.query(INSERT_REPORT, [SEEN, O, 2])
      await s1.query('begin')
      await s1.query('select 1 from public.agent_work_orders where id = $1 for update', [O])   // 재보고 쪽이 주문 행 잠금을 쥔다
      await s1.query(INSERT_REPORT, [NEWER, O, 1])
      const pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s2.query('begin')
      // s2 가 이 문장을 시작할 때의 최신 보고는 SEEN 이다(NEWER 는 미커밋) — 잠금 전에 대조했다면 통과했을 호출
      const pending = s2.query(RPC, [event, F.users.member, O, SEEN]).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      let waiting = false
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await s1.query<{ w: string | null }>('select wait_event_type as w from pg_stat_activity where pid = $1', [pid])).rows[0]?.w === 'Lock'
        if (!waiting) await new Promise((r) => setTimeout(r, 50))
      }
      expect(waiting, 's2 가 주문 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await pending).toEqual(STALE)
      await s2.query('commit')
      expect(await orderStatus(s1, O)).toBe('reported')
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
  })
})
