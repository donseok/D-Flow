// WF-GAP-2 — 크레딧 기본값·잠금·선행 도달 판정의 TS↔SQL 현행 고정 패리티(스펙 §3.0·§8.1 #4). WF-GAP-1 — 위임·점유 항목에 세션이
// 직접 실적 100 을 쓰면 guard_workflow_actual 이 WORKFLOW_ACTUAL_LOCKED(앱 updateActual 잠금의 DB 판). 패리티 케이스는 현행을 고정하므로
// 처음부터 통과할 수 있다 — 실패부터 봐야 하는 것은 잠금 절 케이스다. 단계 ≥ 2 절(WORKFLOW_APPROVAL_REQUIRED)은 SP5b 다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS, EVENT_CREDIT } from '@/lib/domain/stageCredits'
import { STAGE_ORDER, predecessorReached, stageLockedForHuman } from '@/lib/domain/agentWork'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LEAF = F.leaf.aErp
const ORDER = '00000000-0000-0000-7e57-000000001280'
const STATUSES = [null, 'ready', 'claimed', 'reported', 'approved', 'cancelled'] as const
const RPC = 'select public.apply_workflow_event($1, $2, $3, $4, $5, null, null, null) as r'
/** 실적 잠금 경계(앱 wbs.ts:146 `newPct > 99` = DB 가드). TS 쪽은 tests/actions/wbs-update-actual-lock.test.ts 의 같은 세 값이다. */
const ACTUAL_BOUNDARY = [[99, false], [99.5, true], [100, true]] as const   // [값, 잠긴 항목에서 막히는가]
const LOCKED = { code: '42501', message: 'WORKFLOW_ACTUAL_LOCKED' }
const CLAIMS = JSON.stringify({ sub: F.users.member, role: 'authenticated' })

type Arrange = {
  delegated: boolean; status: string | null; devWorkflow?: boolean; stage?: string | null
  /** 출발 실적(기본 0) */ pct?: number
  /** 기본은 프로젝트 A 의 LEAF — 멤버 경로 케이스만 프로젝트 B 의 리프를 준다 */ leaf?: string; project?: string
}
/** postgres 로 리프 상태를 맞춘다 — 매번 같은 출발점(단계 없음, 실적 0, 주문 하나 또는 없음) */
async function arrange(c: PoolClient, o: Arrange) {
  const leaf = o.leaf ?? LEAF
  await c.query('update public.wbs_items set dev_workflow = $2, tags = $3, stage = $4, actual_pct = $5 where id = $1',
    [leaf, o.devWorkflow ?? true, o.delegated ? ['agent'] : [], o.stage ?? null, o.pct ?? 0])
  await c.query('delete from public.agent_work_orders where id = $1', [ORDER])
  if (o.status) {
    await c.query('insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, $4)',
      [ORDER, o.project ?? F.projects.a, leaf, o.status])
  }
}
/**
 * 세션이 관리자가 아닌 프로젝트의 리프를 맞춘다. claims 가 남은 채로는 auth.uid() 가 세션 사용자라 열 범위 가드
 * (guard_non_admin_column_scope)가 준비 UPDATE(dev_workflow·tags·stage)를 42501 로 막는다 — claims 를 비우고 맞춘 뒤 세션으로 돌아온다.
 */
async function arrangeAsServer(c: PoolClient, o: Arrange) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
  await arrange(c, o)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [CLAIMS])
  await c.query('set local role authenticated')
}
const rpc = async (c: PoolClient, event: string, o: { item?: string | null; order?: string | null; stage?: string | null } = {}) =>
  (await c.query(RPC, [event, F.users.member, o.item ?? null, o.order ?? null, o.stage ?? null])).rows[0].r as Record<string, unknown>
const leafState = async (c: PoolClient, id: string = LEAF) =>
  (await c.query<{ stage: string | null; pct: number | null }>(
    'select stage, actual_pct::float8 as pct from public.wbs_items where id = $1', [id])).rows[0]

describe('WF-GAP-2 TS↔SQL 현행 패리티', () => {
  it('크레딧 기본값 — RPC 의 c_default = DEFAULT_STAGE_CREDITS', async () => {
    const { rows: [r] } = await pool.query<{ src: string }>(
      `select prosrc as src from pg_proc where oid = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)'::regprocedure`)
    const m = r.src.match(/c_default constant jsonb := '([^']+)'::jsonb/)
    expect(m, 'c_default 선언을 찾지 못했다').not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(DEFAULT_STAGE_CREDITS)
  })

  it('사건별 크레딧 — 각 주문 사건의 결과 실적 = EVENT_CREDIT 의 키(approve 는 100)', async () => {
    const from: Record<string, string> = {
      claim: 'ready', report_completion: 'claimed', release: 'claimed', approve: 'reported', reject: 'reported', unapprove: 'approved', rework: 'approved',
    }
    // 출발 실적은 어느 크레딧과도 다른 값이다 — 0 에서 출발하면 크레딧 0(as: release·assign)을 적용한 것과 아무것도 하지 않은 것
    // (건너뜀·크레딧 누락)이 같은 0 으로 보인다. 적용됐다면 값이 바뀌고(actual_changed) 건너뛴 사유(skipped)가 없다.
    const START = 40
    expect(Object.values(DEFAULT_STAGE_CREDITS.default)).not.toContain(START)
    const applied = async (c: PoolClient, event: keyof typeof EVENT_CREDIT, r: Record<string, unknown>) => {
      const key = EVENT_CREDIT[event]
      const credit = key === 'xx' ? 100 : DEFAULT_STAGE_CREDITS.default[key]
      expect(r, event).toMatchObject({ ok: true, skipped: null, actual_changed: true })
      expect(Number(r.actual_pct), event).toBe(credit)
      expect((await leafState(c)).pct, event).toBe(credit)
    }
    await asService(pool, async (c) => {
      await c.query('update public.project_settings set stage_credits = null where project_id = $1', [F.projects.a])
      for (const [event, status] of Object.entries(from)) {
        await arrange(c, { delegated: false, status, pct: START })
        await applied(c, event as keyof typeof EVENT_CREDIT, await rpc(c, event, { order: ORDER }))
      }
      await arrange(c, { delegated: false, status: null, pct: START })
      await applied(c, 'assign', await rpc(c, 'assign', { item: LEAF }))
    })
  })

  it('잠금 — RPC set_stage 의 locked = stageLockedForHuman(위임됨 × 주문 상태 12칸)', async () => {
    await asService(pool, async (c) => {
      for (const delegated of [false, true]) {
        for (const status of STATUSES) {
          await arrange(c, { delegated, status })
          const r = await rpc(c, 'set_stage', { item: LEAF, stage: 'im' })
          expect(r.reason === 'locked', `delegated=${delegated} status=${status}`).toBe(stageLockedForHuman({ delegated, orderStatus: status }))
        }
      }
    })
  })

  it('선행 도달 — reached_first = 새 단계는 도달(predecessorReached)이고 옛 단계는 아니다(출발 단계 5 × 새 단계 4)', async () => {
    // 미착수에서만 출발하면 SQL 식의 뒤쪽 절(옛 단계가 이미 도달이면 처음이 아니다)이 빠져도 같은 값이다 — im·xx 에서도 출발한다
    await asService(pool, async (c) => {
      for (const from of [null, ...STAGE_ORDER]) {
        for (const stage of STAGE_ORDER) {
          await arrange(c, { delegated: false, status: null, stage: from })
          const r = await rpc(c, 'set_stage', { item: LEAF, stage })
          expect(r, `${from} → ${stage}`).toMatchObject({ ok: true, stage, stage_changed: from !== stage })
          expect(r.reached_first, `${from} → ${stage}`)
            .toBe(predecessorReached({ stage }) && !predecessorReached({ stage: from }))
        }
      }
    })
  })
})

describe('WF-GAP-1 guard_workflow_actual(잠금 절)', () => {
  const SET = 'update public.wbs_items set actual_pct = $2 where id = $1'
  it('세션이 잠긴 항목(위임됨 ∨ 주문 claimed·reported)에 99 를 넘는 값(99.5·100)을 쓰면 WORKFLOW_ACTUAL_LOCKED — 99 와 안 잠긴 항목은 된다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      for (const delegated of [false, true]) {
        for (const status of STATUSES) {
          const locked = stageLockedForHuman({ delegated, orderStatus: status })
          for (const [pct, blockedWhenLocked] of ACTUAL_BOUNDARY) {
            await c.query('reset role'); await arrange(c, { delegated, status }); await c.query('set local role authenticated')
            const label = `pct=${pct} delegated=${delegated} status=${status}`
            const err = await pgError(c, SET, [LEAF, pct])
            if (locked && blockedWhenLocked) {
              expect(err, label).toMatchObject(LOCKED)
              expect((await leafState(c)).pct, label).toBe(0)   // 거절된 쓰기는 값을 남기지 않는다
            } else {
              expect(err, label).toBeNull()
              expect((await leafState(c)).pct, label).toBe(pct)   // 통과는 0행 갱신이 아니라 실제로 쓰인 것이다
            }
          }
        }
      }
    })
  })

  it('잠긴 항목이라도 99 를 넘지 않는 값과 값이 바뀌지 않는 쓰기(이미 100)는 막지 않는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await arrange(c, { delegated: true, status: 'claimed' }); await c.query('set local role authenticated')
      for (const pct of [0, 50, 99, null]) expect(await pgError(c, SET, [LEAF, pct]), `pct=${pct}`).toBeNull()
    })
    // 승인으로 이미 100 인 항목 — 같은 값을 다시 쓰는 것은 새 완료 입력이 아니다. 100 → 99.5 는 99 초과로의 변경이라 막힌다
    await asService(pool, async (c) => {
      await arrange(c, { delegated: true, status: 'claimed' })
      await c.query('update public.wbs_items set actual_pct = 100 where id = $1', [LEAF])
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [CLAIMS])
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
      expect(await pgError(c, SET, [LEAF, 99.5])).toMatchObject(LOCKED)
      expect(await pgError(c, SET, [LEAF, 99])).toBeNull()
    })
  })

  it('개발 워크플로 대상이 아니면(dev_workflow=false) 위임 태그가 있어도 막지 않는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await arrange(c, { delegated: true, status: 'claimed', devWorkflow: false }); await c.query('set local role authenticated')
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
    })
  })

  it('가드는 옛 행(old.tags·old.dev_workflow)으로 판정한다 — 한 문장에서 위임 태그를 지우거나 개발 워크플로를 끄면서 100 을 써도 WORKFLOW_ACTUAL_LOCKED', async () => {
    const UNTAG = `update public.wbs_items set tags = '{}', actual_pct = 100 where id = $1`
    const UNFLOW = 'update public.wbs_items set dev_workflow = false, actual_pct = 100 where id = $1'
    const cases = [
      [UNTAG, { delegated: true, status: null }],
      [UNFLOW, { delegated: true, status: null }],
      [UNFLOW, { delegated: false, status: 'claimed' }],
    ] as const
    await asUser(pool, F.users.member, async (c) => {
      for (const [sql, o] of cases) {
        const label = `${sql} delegated=${o.delegated} status=${o.status}`
        await c.query('reset role'); await arrange(c, o); await c.query('set local role authenticated')
        expect(await pgError(c, sql, [LEAF]), label).toMatchObject(LOCKED)
        // 거절된 문장은 태그·개발 워크플로·실적 어느 것도 남기지 않는다
        expect((await c.query('select dev_workflow as wf, tags, actual_pct::float8 as pct from public.wbs_items where id = $1', [LEAF])).rows[0], label)
          .toEqual({ wf: true, tags: o.delegated ? ['agent'] : [], pct: 0 })
      }
    })
  })

  it('멤버 경로(member_update_actual) — 프로젝트 관리자가 아닌 담당 팀 멤버도 잠긴 항목에는 99.5·100 을 못 쓰고 99 는 쓴다', async () => {
    // 위의 케이스는 모두 alice 가 관리자인 프로젝트 A 다(admin_write_items, 열 범위 가드는 첫 줄에서 반환). 스펙 §3.0 이 구멍으로
    // 적은 것은 담당 팀 멤버의 직접 PATCH 다 — alice 가 멤버인 프로젝트 B 의 자기 팀 리프로 같은 경계를 본다.
    const leaf = F.leaf.bOwnTeam
    const at = { leaf, project: F.projects.b }
    await asUser(pool, F.users.member, async (c) => {
      expect((await c.query('select public.is_project_admin($1) as admin, public.is_project_member($1) as member', [F.projects.b])).rows[0])
        .toEqual({ admin: false, member: true })
      for (const [delegated, status] of [[true, null], [false, 'claimed'], [false, 'reported']] as const) {
        expect(stageLockedForHuman({ delegated, orderStatus: status })).toBe(true)
        for (const [pct, blocked] of ACTUAL_BOUNDARY) {
          const label = `pct=${pct} delegated=${delegated} status=${status}`
          await arrangeAsServer(c, { delegated, status, ...at })
          const err = await pgError(c, SET, [leaf, pct])
          if (blocked) expect(err, label).toMatchObject(LOCKED)
          else expect(err, label).toBeNull()
          expect((await leafState(c, leaf)).pct, label).toBe(blocked ? 0 : pct)
        }
      }
      // 안 잠긴 항목에는 멤버가 100 을 쓴다 — 가드가 멤버 경로를 통째로 막는 것이 아니다
      for (const status of [null, 'ready', 'approved']) {
        await arrangeAsServer(c, { delegated: false, status, ...at })
        expect(await pgError(c, SET, [leaf, 100]), `status=${status}`).toBeNull()
        expect((await leafState(c, leaf)).pct, `status=${status}`).toBe(100)
      }
    })
  })

  it('다른 항목의 주문(claimed)은 이 항목을 잠그지 않는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      await arrange(c, { delegated: false, status: null })
      await c.query('insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, $4)',
        [ORDER, F.projects.a, F.leaf.aDep1, 'claimed'])
      await c.query('set local role authenticated')
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
    })
  })

  it('RPC·서버 경로(auth.uid() null)는 잠금과 무관하다 — 승인 사건이 100 을 쓴다', async () => {
    await asService(pool, async (c) => {
      await arrange(c, { delegated: true, status: 'claimed' })
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
    })
  })

  it('승인 RPC 는 잠긴 항목(위임됨 ∨ 주문 reported)에서도 끝까지 간다 — service_role 실제 롤, 단계 xx·실적 100', async () => {
    for (const delegated of [true, false]) {
      await asService(pool, async (c) => {
        await arrange(c, { delegated, status: 'reported' })
        expect(stageLockedForHuman({ delegated, orderStatus: 'reported' })).toBe(true)
        await c.query('set local role service_role')
        expect((await c.query<{ r: string; uid: string | null }>('select current_user::text as r, auth.uid()::text as uid')).rows[0])
          .toEqual({ r: 'service_role', uid: null })
        const r = await rpc(c, 'approve', { order: ORDER })
        expect(r, `delegated=${delegated}`).toMatchObject({ ok: true, order_status: 'approved', stage: 'xx', actual_changed: true })
        expect(Number(r.actual_pct), `delegated=${delegated}`).toBe(100)
        expect(await leafState(c), `delegated=${delegated}`).toEqual({ stage: 'xx', pct: 100 })
      })
    }
  })

  it('점유(claimed) 중인 항목의 주문 사건(보고·반려 뒤 재보고·승인)도 RPC 로는 실적을 쓴다', async () => {
    await asService(pool, async (c) => {
      await arrange(c, { delegated: true, status: 'claimed' })
      await c.query('set local role service_role')
      const steps = [
        ['report_completion', { order_status: 'reported', stage: 'im' }],
        ['reject', { order_status: 'claimed', stage: 'ip' }],
        ['report_completion', { order_status: 'reported', stage: 'im' }],   // 반려 뒤 재보고
        ['approve', { order_status: 'approved', stage: 'xx' }],
      ] as const
      for (const [i, [event, expected]] of steps.entries()) {
        expect(await rpc(c, event, { order: ORDER }), `${i} ${event}`)
          .toMatchObject({ ok: true, skipped: null, stage_changed: true, actual_changed: true, ...expected })
        expect((await leafState(c)).stage, `${i} ${event}`).toBe(expected.stage)
      }
      expect(await leafState(c)).toEqual({ stage: 'xx', pct: 100 })
    })
  })

  it('가드는 DEFINER·search_path 고정·실행 권한 없음, 트리거는 actual_pct 를 쓰는 UPDATE 에만 건다', async () => {
    const { rows: [r] } = await pool.query(`select
      p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_grants,
      (select pg_get_triggerdef(t.oid) from pg_trigger t
        where t.tgrelid = 'public.wbs_items'::regclass and t.tgname = 'guard_workflow_actual' and not t.tgisinternal) as trg
      from pg_proc p where p.oid = 'public.guard_workflow_actual()'::regprocedure`)
    expect(r).toMatchObject({ definer: true, config: ['search_path=""'], auth: false, anon: false, public_grants: 0 })
    expect(r.trg).toMatch(/BEFORE UPDATE OF actual_pct ON public\.wbs_items FOR EACH ROW EXECUTE FUNCTION (public\.)?guard_workflow_actual\(\)/)
  })

  it('read committed 가 아닌 트랜잭션은 주문을 읽기 전에 WORKFLOW_ACTUAL_ISOLATION(25001) — repeatable read·serializable·read uncommitted. read committed 는 통과', async () => {
    // serializable 도 트랜잭션 스냅샷 하나로 읽는다. SSI 가 한쪽을 중단하는 것은 상대도 serializable 일 때뿐이고 점유(PostgREST)는 read committed 다
    const ISOLATION = { code: '25001', message: 'WORKFLOW_ACTUAL_ISOLATION' }
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const LEVELS = [...REFUSED, 'read committed']
    const results: Record<string, unknown> = {}
    for (const level of LEVELS) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        await arrange(c, { delegated: false, status: 'ready' })
        await c.query('set local role authenticated')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [CLAIMS])
        results[`${level} 100`] = await pgError(c, SET, [LEAF, 100])
        // 다른 행을 읽지 않는 분기는 격리 수준과 무관하다: 99 이하, 개발 워크플로 아님, 위임 태그(이 행의 값)
        results[`${level} 99`] = await pgError(c, SET, [LEAF, 99])
        await c.query('reset role'); await arrange(c, { delegated: true, status: 'ready' }); await c.query('set local role authenticated')
        results[`${level} delegated`] = await pgError(c, SET, [LEAF, 100])
        await c.query('reset role'); await arrange(c, { delegated: false, status: 'claimed', devWorkflow: false }); await c.query('set local role authenticated')
        results[`${level} not-workflow`] = await pgError(c, SET, [LEAF, 100])
        await c.query('reset role'); await c.query(`select set_config('request.jwt.claims', '', true)`)
        await arrange(c, { delegated: false, status: 'claimed' })
        results[`${level} service`] = await pgError(c, SET, [LEAF, 100])
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) expect(results[`${level} 100`], level).toMatchObject(ISOLATION)
    expect(results['read committed 100']).toBeNull()
    for (const level of LEVELS) {
      expect(results[`${level} 99`], level).toBeNull()
      expect(results[`${level} delegated`], level).toMatchObject(LOCKED)
      expect(results[`${level} not-workflow`], level).toBeNull()
      expect(results[`${level} service`], level).toBeNull()
    }
  })

  it('행 잠금을 기다리는 사이 점유(claim)가 커밋되면 가드가 새 주문 상태를 보고 WORKFLOW_ACTUAL_LOCKED 로 거절한다', async () => {
    // 두 연결 사이의 커밋이 필요해 이 케이스만 데이터를 커밋한다 — 전용 항목·주문을 만들고 finally 에서 지운다(픽스처 행은 건드리지 않는다).
    // 준비는 try 안이고, 넣기 전에 같은 id 를 지운다 — 앞선 실행이 준비 도중 실패했거나 죽어서 남긴 행이 다음 실행을 막지 않는다.
    // 실적·단계가 이미 점유 사건의 결과값(ip·30)이라 claim 은 항목 행을 잠그기만 하고 바꾸지 않는다 — 가드의 주문 조회만이 점유를 알아챈다.
    const ITEM = '00000000-0000-0000-7e57-000000001281'
    const O = '00000000-0000-0000-7e57-000000001282'
    const cleanup = async () => {
      await pool.query('delete from public.agent_work_orders where id = $1', [O])
      await pool.query('delete from public.change_logs where wbs_item_id = $1', [ITEM])
      await pool.query('delete from public.wbs_items where id = $1', [ITEM])
    }
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      const { rows: [{ ip }] } = await pool.query<{ ip: number }>(
        `select coalesce((select (s.stage_credits -> 'default' ->> 'ip')::numeric from public.project_settings s where s.project_id = $1), $2)::float8 as ip`,
        [F.projects.a, DEFAULT_STAGE_CREDITS.default.ip])
      await pool.query(`insert into public.wbs_items (id, project_id, code, name, dev_workflow, stage, actual_pct)
        values ($1, $2, 'h2-wf', 'H2 잠금 경합', true, 'ip', $3)`, [ITEM, F.projects.a, ip])
      await pool.query(`insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, 'ready')`,
        [O, F.projects.a, ITEM])
      s1 = await pool.connect()
      s2 = await pool.connect()
      await s1.query('begin')
      const claimed = (await s1.query(RPC, ['claim', F.users.member, null, O, null])).rows[0].r as Record<string, unknown>
      expect(claimed).toMatchObject({ ok: true, order_status: 'claimed', stage_changed: false, actual_changed: false })
      const pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s2.query('begin')
      await s2.query('set local role authenticated')
      await s2.query(`select set_config('request.jwt.claims', $1, true)`, [CLAIMS])
      // s2 가 이 문장을 시작할 때 주문은 ready 다(claim 은 미커밋) — 잠금 전 스냅샷으로 판정했다면 통과했을 쓰기
      const pending = s2.query(SET, [ITEM, 100]).then(
        (res) => ({ rowCount: res.rowCount }) as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      let waiting = false
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await s1.query<{ w: string | null }>('select wait_event_type as w from pg_stat_activity where pid = $1', [pid])).rows[0]?.w === 'Lock'
        if (!waiting) await new Promise((r) => setTimeout(r, 50))
      }
      expect(waiting, 's2 가 항목 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await pending).toMatchObject(LOCKED)
      await s2.query('rollback')
      expect(await leafState(s1, ITEM)).toEqual({ stage: 'ip', pct: ip })
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
  })
})
