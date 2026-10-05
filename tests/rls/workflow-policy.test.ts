// SP5b W1 — *_workflow_policy 의 DB 계약(스펙 §3.3·§6.1, done_when #3·#5·#7). 골든 tests/fixtures/parity/workflow.json 을 TS(tests/domain/
// approval-steps.test.ts)와 같이 읽는다. 사건은 service_role 경로(postgres 롤, auth.uid() null — 앱의 admin 클라이언트와 같은 판정)로 부르고,
// 흐름 열 가드·실적 가드는 authenticated 세션(PostgREST 흉내)으로 본다. 경합 케이스만 커밋하는 두 연결을 쓰고 끝에 되돌린다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import golden from '../fixtures/parity/workflow.json'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LEAF = F.leaf.aErp
const ORDER = '00000000-0000-0000-7e57-000000001290'
const REPORT = '00000000-0000-0000-7e57-000000001291'
const ALICE = F.users.member      // A 관리자(명단 admin)
const WSADMIN = F.users.wsAdmin   // A 워크스페이스 관리자 — 프로젝트 관리자를 승계
const DANA = F.users.dual         // A 명단 member — 프로젝트 관리자가 아니다
const TWO = [{ code: 'internal', label: '내부 검토', approver: 'subtree_or_admin' }, { code: 'client', label: '고객 승인', approver: 'admin' }]
const EVENT = `select public.apply_workflow_event(p_event => $1, p_actor => $2, p_item_id => $3, p_order_id => $4, p_stage => $5,
  p_expected_report_id => $6, p_expected_step => $7) as r`

type Ev = { item?: string | null; order?: string | null; stage?: string | null; report?: string | null; step?: string | null }
const ev = async (c: PoolClient, event: string, actor: string, o: Ev = {}) =>
  (await c.query(EVENT, [event, actor, o.item ?? null, o.order ?? null, o.stage ?? null, o.report ?? null, o.step ?? null])).rows[0].r as Record<string, unknown>
const item = async (c: PoolClient) => (await c.query<{ stage: string | null; pct: number | null; round: number; steps: string[] | null }>(
  'select stage, actual_pct::float8 as pct, review_round as round, review_steps as steps from public.wbs_items where id = $1', [LEAF])).rows[0]
const live = async (c: PoolClient) => (await c.query<{ round: number; step: string; via: string; by: string }>(
  `select round, step_code as step, via, approved_by::text as by from public.wbs_stage_approvals
    where wbs_item_id = $1 and revoked_at is null and round < 999 order by round, step_code`, [LEAF])).rows
const revoked = async (c: PoolClient) => (await c.query<{ step: string; reason: string }>(
  `select step_code as step, revoke_reason as reason from public.wbs_stage_approvals
    where wbs_item_id = $1 and revoked_at is not null and round < 999 order by step_code`, [LEAF])).rows

async function setSetting(c: PoolClient, key: string, value: unknown | undefined) {
  if (value === undefined) await c.query(`update public.project_settings set "values" = "values" - $2 where project_id = $1`, [F.projects.a, key])
  else await c.query(`update public.project_settings set "values" = "values" || jsonb_build_object($2::text, $3::jsonb) where project_id = $1`,
    [F.projects.a, key, JSON.stringify(value)])
}
/** postgres 로 리프를 맞춘다 — 흐름 켬·단계·라운드 초기화·주문 하나(선택)·완료 보고 하나(reported 면) */
async function arrange(c: PoolClient, o: { stage?: string | null; order?: string | null; steps?: string[] | null; round?: number; pct?: number }) {
  await c.query(`update public.wbs_items set dev_workflow = true, tags = '{}', stage = $2, actual_pct = $3, review_round = $4, review_steps = $5 where id = $1`,
    [LEAF, o.stage ?? null, o.pct ?? 0, o.round ?? 0, o.steps ?? null])
  await c.query('delete from public.wbs_stage_approvals where wbs_item_id = $1 and round < 999', [LEAF])
  await c.query('delete from public.agent_work_orders where wbs_item_id = $1', [LEAF])
  if (o.order) {
    await c.query('insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, $4)', [ORDER, F.projects.a, LEAF, o.order])
  }
}
/** claimed 주문에서 완료 보고까지(보고 행 + report_completion 사건) — 라운드가 열린다 */
async function toReported(c: PoolClient) {
  await arrange(c, { stage: 'ip', order: 'claimed', pct: 30 })
  await c.query(`insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent) values ($1, $2, 'completion', 100, 'done', 'rls')`, [REPORT, ORDER])
  expect(await ev(c, 'report_completion', ALICE, { order: ORDER })).toMatchObject({ ok: true, order_status: 'reported', stage: 'im' })
}

describe('판독 헬퍼 — 골든(TS 와 같은 파일)', () => {
  it('workflow_value_of 기본값 = 골든 defaults(키 없음·JSON null)', async () => {
    for (const [key, v] of Object.entries(golden.defaults)) {
      const { rows: [r] } = await pool.query(`select public.workflow_value_of('{}'::jsonb, $1) as a, public.workflow_value_of(jsonb_build_object($1::text, null), $1) as b`, [key])
      expect(r.a, key).toEqual(v)
      expect(r.b, key).toEqual(v)
    }
  })
  it('모양 검사 — 골든 shape 의 ok 와 같다(TS parse 통과 ⇔ SQL 통과), 손상 = 22023 CONFIG_INVALID:<key>', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      for (const [key, cases] of Object.entries(golden.shape)) {
        for (const x of cases) {
          const err = await pgError(c, 'select public.workflow_value_of(jsonb_build_object($1::text, $2::jsonb), $1)', [key, JSON.stringify(x.value)])
          if (x.ok) expect(err, `${key} ${JSON.stringify(x.value)}`).toBeNull()
          else expect(err, `${key} ${JSON.stringify(x.value)}`).toMatchObject({ code: '22023', message: `CONFIG_INVALID:${key}` })
        }
      }
    } finally { await c.query('rollback'); c.release() }
  })
  it('wbs_predecessor_reached 120 조합·wbs_stage_reaches_gate = 골든', async () => {
    const { rows } = await pool.query<{ i: number; r: boolean }>(
      `select (x.ord - 1)::int as i, public.wbs_predecessor_reached(x.e ->> 'gate', x.e ->> 'stage', (x.e ->> 'approved')::boolean,
              (x.e ->> 'actual')::numeric, (x.e ->> 'dev')::boolean) as r
         from jsonb_array_elements($1::jsonb) with ordinality as x(e, ord)`, [JSON.stringify(golden.predecessor)])
    for (const row of rows) expect(row.r, JSON.stringify(golden.predecessor[row.i])).toBe(golden.predecessor[row.i].reached)
    for (const c of golden.stageReaches) {
      const { rows: [r] } = await pool.query('select public.wbs_stage_reaches_gate($1, $2) as v', [c.stage, c.gate])
      expect(r.v, JSON.stringify(c)).toBe(c.reaches)
    }
  })
})

describe('승인 단계 — 2단계 한 바퀴(done_when #3)', () => {
  it('첫 승인 뒤 reported·im·실적 불변·remaining 1 / 둘째(관리자 단계) 뒤 approved·xx·100, 원장 via=approve', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await toReported(c)
      expect(await item(c)).toMatchObject({ stage: 'im', round: 1, steps: ['internal', 'client'] })
      const pctAtIm = (await item(c)).pct
      const r1 = await ev(c, 'approve', DANA, { order: ORDER, report: REPORT, step: 'internal' })
      expect(r1).toMatchObject({ ok: true, order_status: 'reported', stage: 'im', stage_changed: false, actual_changed: false,
        approval: { round: 1, step_code: 'internal', remaining: 1 } })
      expect((await c.query('select status from public.agent_work_orders where id = $1', [ORDER])).rows[0].status).toBe('reported')
      expect((await item(c)).pct).toBe(pctAtIm)
      const r2 = await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })
      expect(r2).toMatchObject({ ok: true, order_status: 'approved', stage: 'xx', actual_changed: true, approval: { step_code: 'client', remaining: 0 } })
      expect(await item(c)).toMatchObject({ stage: 'xx', pct: 100, round: 1, steps: ['internal', 'client'] })
      expect(await live(c)).toEqual([
        { round: 1, step: 'client', via: 'approve', by: ALICE }, { round: 1, step: 'internal', via: 'approve', by: DANA }])
    })
  })
  it('대기 단계 CAS — 다른 단계·null(유효 단계 ≥2)은 approval_stale, 아무것도 쓰지 않는다', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await toReported(c)
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })).toMatchObject({ ok: false, reason: 'approval_stale' })
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: null })).toMatchObject({ ok: false, reason: 'approval_stale' })
      expect(await live(c)).toEqual([])
      expect((await c.query('select status from public.agent_work_orders where id = $1', [ORDER])).rows[0].status).toBe('reported')
    })
  })
  it('admin 단계를 관리자 아닌 사람이 → approval_forbidden, 같은 사람의 두 단계 → approval_same_actor(설정 끄면 허용)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await toReported(c)
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'internal' })).toMatchObject({ ok: true, approval: { remaining: 1 } })
      expect(await ev(c, 'approve', DANA, { order: ORDER, report: REPORT, step: 'client' })).toMatchObject({ ok: false, reason: 'approval_forbidden' })
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })).toMatchObject({ ok: false, reason: 'approval_same_actor' })
      await setSetting(c, 'workflow.approval_distinct_approvers', false)
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })).toMatchObject({ ok: true, order_status: 'approved', stage: 'xx' })
    })
  })
  it('반려 → 라운드 승인 전부 철회(reject)·스냅샷 null, 재보고 → 새 라운드(2)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await toReported(c)
      await ev(c, 'approve', DANA, { order: ORDER, report: REPORT, step: 'internal' })
      expect(await ev(c, 'reject', ALICE, { order: ORDER, report: REPORT })).toMatchObject({ ok: true, order_status: 'claimed', stage: 'ip' })
      expect(await item(c)).toMatchObject({ stage: 'ip', round: 1, steps: null })
      expect(await revoked(c)).toEqual([{ step: 'internal', reason: 'reject' }])
      expect(await ev(c, 'report_completion', ALICE, { order: ORDER })).toMatchObject({ ok: true, stage: 'im' })
      expect(await item(c)).toMatchObject({ stage: 'im', round: 2, steps: ['internal', 'client'] })
    })
  })
  it('승인 취소(unapprove) → 마지막 단계만 철회·스냅샷 유지, 그 단계가 다시 대기 / 재작업(rework) → 전부 철회', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await toReported(c)
      await ev(c, 'approve', DANA, { order: ORDER, report: REPORT, step: 'internal' })
      await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })
      expect(await ev(c, 'unapprove', ALICE, { order: ORDER })).toMatchObject({ ok: true, order_status: 'reported', stage: 'im' })
      expect(await item(c)).toMatchObject({ round: 1, steps: ['internal', 'client'] })
      expect((await live(c)).map((x) => x.step)).toEqual(['internal'])
      expect(await revoked(c)).toEqual([{ step: 'client', reason: 'unapprove' }])
      expect(await ev(c, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'client' })).toMatchObject({ ok: true, order_status: 'approved' })
      expect(await ev(c, 'rework', ALICE, { order: ORDER })).toMatchObject({ ok: true, order_status: 'claimed', stage: 'ip' })
      expect(await live(c)).toEqual([])
      expect(await item(c)).toMatchObject({ steps: null })
    })
  })
  it('스냅샷 없는 im(서비스 가져오기) — 승인이 먼저 라운드를 연다(D15)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await arrange(c, { stage: 'im', order: 'reported', round: 0, steps: null })
      expect(await ev(c, 'approve', DANA, { order: ORDER, step: 'internal' })).toMatchObject({ ok: true, approval: { round: 1, step_code: 'internal', remaining: 1 } })
      expect(await item(c)).toMatchObject({ stage: 'im', round: 1, steps: ['internal', 'client'] })
    })
  })
})

describe('사람 경로 — set_stage·approve_step', () => {
  it('유효 단계 ≥2 면 xx 직행은 현재 stage 와 무관하게 approval_required', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      for (const stage of [null, 'as', 'ip', 'im']) {
        await arrange(c, { stage, steps: stage === 'im' ? ['internal', 'client'] : null, round: stage === 'im' ? 1 : 0 })
        expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'xx' }), String(stage)).toMatchObject({ ok: false, reason: 'approval_required' })
      }
    })
  })
  it('1단계 기본 — xx 직행이 라운드를 열고 승인 행(via=set_stage)을 남긴다. admin 단계면 비관리자의 xx 지정 거부', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', undefined)
      await arrange(c, { stage: 'ip' })
      expect(await ev(c, 'set_stage', DANA, { item: LEAF, stage: 'xx' })).toMatchObject({ ok: true, stage: 'xx', actual_pct: 100 })
      expect(await item(c)).toMatchObject({ round: 1, steps: ['review'] })
      expect(await live(c)).toEqual([{ round: 1, step: 'review', via: 'set_stage', by: DANA }])
      await setSetting(c, 'workflow.approval_steps', [{ code: 'review', label: null, approver: 'admin' }])
      await arrange(c, { stage: 'ip' })
      expect(await ev(c, 'set_stage', DANA, { item: LEAF, stage: 'xx' })).toMatchObject({ ok: false, reason: 'approval_forbidden' })
      expect(await ev(c, 'set_stage', WSADMIN, { item: LEAF, stage: 'xx' })).toMatchObject({ ok: true, stage: 'xx' })
    })
  })
  it('im 으로 올린 뒤 approve_step 두 번 → xx·100. 잠금(위임)이면 locked, im 아니면 not_in_review', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await arrange(c, { stage: 'ip', pct: 30 })
      expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'im' })).toMatchObject({ ok: true, stage: 'im' })
      expect(await item(c)).toMatchObject({ round: 1, steps: ['internal', 'client'] })
      expect(await ev(c, 'approve_step', ALICE, { item: LEAF, step: 'internal' })).toMatchObject({ ok: true, stage: 'im', approval: { remaining: 1 } })
      expect(await ev(c, 'approve_step', WSADMIN, { item: LEAF, step: 'client' })).toMatchObject({ ok: true, stage: 'xx', actual_pct: 100 })
      expect((await live(c)).map((a) => a.via)).toEqual(['approve_step', 'approve_step'])
      await arrange(c, { stage: 'ip' })
      expect(await ev(c, 'approve_step', ALICE, { item: LEAF, step: 'internal' })).toMatchObject({ ok: false, reason: 'not_in_review' })
      await c.query(`update public.wbs_items set tags = '{agent}', stage = 'im', review_round = 1, review_steps = '{internal,client}' where id = $1`, [LEAF])
      expect(await ev(c, 'approve_step', ALICE, { item: LEAF, step: 'internal' })).toMatchObject({ ok: false, reason: 'locked' })
    })
  })
  it('사람의 xx → im 은 새 라운드 + 옛 라운드 승인 철회(stage_reset, D16)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', undefined)
      await arrange(c, { stage: 'ip' })
      await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'xx' })
      expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'im' })).toMatchObject({ ok: true, stage: 'im' })
      expect(await item(c)).toMatchObject({ round: 2, steps: ['review'] })
      expect(await revoked(c)).toEqual([{ step: 'review', reason: 'stage_reset' }])
    })
  })
})

describe('흐름 열 가드(D13)·실적 가드(D14) — 세션 경로', () => {
  it('관리자 JWT 의 다섯 열 PATCH 는 42501 WORKFLOW_COLUMNS_RPC_ONLY, 다른 열은 된다', async () => {
    await asUser(pool, ALICE, async (c) => {
      for (const set of [`stage = 'xx'`, 'review_round = 5', `review_steps = '{a}'`, 'dev_workflow = not dev_workflow', `tags = '{agent}'`]) {
        expect(await pgError(c, `update public.wbs_items set ${set} where id = $1`, [LEAF]), set)
          .toMatchObject({ code: '42501', message: 'WORKFLOW_COLUMNS_RPC_ONLY' })
      }
      expect(await pgError(c, `update public.wbs_items set name = name where id = $1`, [LEAF])).toBeNull()
    })
  })
  it('JWT INSERT — 흐름이 꺼진 빈 행만(기존 앱 insert 꼴 통과), 다섯 열 중 하나라도 있으면 42501', async () => {
    await asUser(pool, ALICE, async (c) => {
      const ins = (extra: string, vals: string) =>
        `insert into public.wbs_items (project_id, code, name${extra}) values ('${F.projects.a}', 'W1-RLS', 'rls'${vals})`
      expect(await pgError(c, ins('', ''))).toBeNull()
      expect(await pgError(c, ins(', dev_workflow', ', false'))).toBeNull()
      for (const [col, val] of [['stage', `'as'`], ['dev_workflow', 'true'], ['tags', `'{agent}'`], ['review_round', '1'], ['review_steps', `'{a}'`]]) {
        expect(await pgError(c, ins(`, ${col}`, `, ${val}`)), col).toMatchObject({ code: '42501', message: 'WORKFLOW_COLUMNS_RPC_ONLY' })
      }
    })
  })
  it('유효 단계 ≥2 — 멤버·관리자의 실적 100 은 WORKFLOW_APPROVAL_REQUIRED, 서버 경로로 dev_workflow 를 꺼도 im 대기 라운드는 막힌다', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await setSetting(c, 'workflow.approval_steps', TWO)
      await arrange(c, { stage: 'ip', pct: 50 })
      const claims = JSON.stringify({ sub: ALICE, role: 'authenticated' })
      const asAlice = async () => { await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]); await c.query('set local role authenticated') }
      const asServer = async () => { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims', '', true)`) }
      await asAlice()
      expect(await pgError(c, 'update public.wbs_items set actual_pct = 100 where id = $1', [LEAF])).toMatchObject({ code: '42501', message: 'WORKFLOW_APPROVAL_REQUIRED' })
      expect(await pgError(c, 'update public.wbs_items set actual_pct = 99 where id = $1', [LEAF])).toBeNull()
      await asServer()
      await c.query(`update public.wbs_items set stage = 'im', review_round = 1, review_steps = '{internal,client}', dev_workflow = false where id = $1`, [LEAF])
      await asAlice()
      expect(await pgError(c, 'update public.wbs_items set actual_pct = 100 where id = $1', [LEAF])).toMatchObject({ code: '42501', message: 'WORKFLOW_APPROVAL_REQUIRED' })
      // 스냅샷 1단계 라운드는 설정이 2단계여도 막히지 않는다(흐름 꺼짐)
      await asServer()
      await c.query(`update public.wbs_items set review_steps = '{review}' where id = $1`, [LEAF])
      await asAlice()
      expect(await pgError(c, 'update public.wbs_items set actual_pct = 100 where id = $1', [LEAF])).toBeNull()
    } finally { await c.query('rollback'); c.release() }
  })
})

describe('설정 저장의 참조 검사(settings_ref_check)·크레딧·선행 기준', () => {
  const save = (c: PoolClient, key: string, val: unknown) =>
    pgError(c, 'select public.settings_ref_check($1, $2, (select "values" -> $2 from public.project_settings where project_id = $1), $3::jsonb)',
      [F.projects.a, key, JSON.stringify(val)])
  it('대기 라운드의 스냅샷 단계 삭제 → pending_round, 대기 단계 승인자 넓히기 → approver_widen, 좁히기는 허용', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.approval_steps', TWO)
      await arrange(c, { stage: 'im', round: 1, steps: ['internal', 'client'] })
      const removed = await save(c, 'workflow.approval_steps', [TWO[0]])
      expect(removed).toMatchObject({ code: '23514', message: 'SETTINGS_CODE_IN_USE:workflow.approval_steps' })
      expect(JSON.parse(removed!.detail!)).toMatchObject({ code: 'client', reason: 'pending_round', count: 1 })
      // internal 이 대기 — client 넓히기는 지금 대기가 아니라 허용, internal 좁히기도 허용
      expect(await save(c, 'workflow.approval_steps', [TWO[0], { ...TWO[1], approver: 'subtree_or_admin' }])).toBeNull()
      expect(await save(c, 'workflow.approval_steps', [{ ...TWO[0], approver: 'admin' }, TWO[1]])).toBeNull()
      await c.query(`insert into public.wbs_stage_approvals (project_id, wbs_item_id, round, step_code, via, approved_by) values ($1, $2, 1, 'internal', 'approve_step', $3)`,
        [F.projects.a, LEAF, ALICE])
      const widened = await save(c, 'workflow.approval_steps', [TWO[0], { ...TWO[1], approver: 'subtree_or_admin' }])
      expect(JSON.parse(widened!.detail!)).toMatchObject({ code: 'client', reason: 'approver_widen', count: 1 })
      // 모양이 틀린 새 값은 참조 검사 전에 22023
      expect(await save(c, 'workflow.approval_steps', [])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:workflow.approval_steps' })
      expect(await save(c, 'workflow.predecessor_gate', 'final')).toBeNull()
    })
  })
  it('크레딧 — 정책 {5,5} 의 0/20/25/90/100 표로 전이, 저장 값 손상은 22023(c_default 로 풀지 않는다 — D20)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.stage_credits', { default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } })
      await setSetting(c, 'workflow.credit_policy', { step: 5, min_gap: 5 })
      await arrange(c, { stage: null, order: 'ready', pct: 40 })
      expect(Number((await ev(c, 'claim', ALICE, { order: ORDER })).actual_pct)).toBe(20)
      await setSetting(c, 'workflow.stage_credits', { default: { as: 0, ip: 30, rw: 30, im: 90, xx: 100 } })
      await arrange(c, { stage: null, order: 'ready', pct: 40 })
      expect(await pgError(c, EVENT, ['claim', ALICE, null, ORDER, null, null, null])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:workflow.stage_credits' })
    })
  })
  it('선행 기준 final — 첫 도달은 xx 에서(im 은 reached_first 아님)', async () => {
    await asService(pool, async (c) => {
      await setSetting(c, 'workflow.predecessor_gate', 'final')
      await setSetting(c, 'workflow.approval_steps', undefined)
      await arrange(c, { stage: 'ip' })
      expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'im' })).toMatchObject({ ok: true, reached_first: false })
      expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'xx' })).toMatchObject({ ok: true, reached_first: true })
      await setSetting(c, 'workflow.predecessor_gate', undefined)
      await arrange(c, { stage: 'ip' })
      expect(await ev(c, 'set_stage', ALICE, { item: LEAF, stage: 'im' })).toMatchObject({ ok: true, reached_first: true })
    })
  })
  it('권한 — 새 함수·RPC 는 anon·authenticated 실행 0, 원장은 authenticated 읽기만', async () => {
    const { rows: [r] } = await pool.query(`select
      has_function_privilege('authenticated', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)', 'EXECUTE') as rpc,
      has_function_privilege('authenticated', 'public.workflow_value_of(jsonb, text)', 'EXECUTE') as wv,
      has_function_privilege('anon', 'public.wbs_predecessor_reached(text, text, boolean, numeric, boolean)', 'EXECUTE') as pr,
      has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'SELECT') as sel,
      has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'INSERT') as ins,
      to_regprocedure('public.set_dependency_waiver(uuid, text, boolean, text, uuid)') is null as waiver_gone`)
    expect(r).toEqual({ rpc: false, wv: false, pr: false, sel: true, ins: false, waiver_gone: true })
  })
})

describe('경합 — 커밋하는 두 연결', () => {
  it('같은 단계 동시 승인 → 하나만 기록, 다른 쪽은 approval_stale(주문 잠금 뒤 대기 단계를 다시 본다)', async () => {
    // 풀은 연결 둘(harness max 2) — 준비·정리도 a 로 한다
    const a = await pool.connect()
    const b = await pool.connect()
    // 커밋하는 케이스라 픽스처 리프의 원래 값을 잡아 두고 끝에 그대로 되돌린다(다른 파일이 실적 null 등을 전제한다)
    const { rows: [orig] } = await a.query(
      'select stage, actual_pct, dev_workflow, tags, review_round, review_steps from public.wbs_items where id = $1', [LEAF])
    const { rows: [origSettings] } = await a.query(`select "values" from public.project_settings where project_id = $1`, [F.projects.a])
    try {
      await a.query('begin')
      await setSetting(a, 'workflow.approval_steps', TWO)
      await toReported(a)
      await a.query('commit')
      await a.query('begin')
      await b.query('begin')
      const ra = await ev(a, 'approve', DANA, { order: ORDER, report: REPORT, step: 'internal' })
      const pb = ev(b, 'approve', ALICE, { order: ORDER, report: REPORT, step: 'internal' })   // 주문 잠금에서 기다린다
      await new Promise((r) => setTimeout(r, 150))
      await a.query('commit')
      const rb = await pb
      await b.query('commit')
      expect(ra).toMatchObject({ ok: true, approval: { step_code: 'internal', remaining: 1 } })
      expect(rb).toMatchObject({ ok: false, reason: 'approval_stale' })
      const { rows } = await a.query(`select count(*)::int as n from public.wbs_stage_approvals where wbs_item_id = $1 and round < 999 and revoked_at is null`, [LEAF])
      expect(rows[0].n).toBe(1)
    } finally {
      await b.query('rollback').catch(() => {})
      b.release()
      await a.query('rollback').catch(() => {})
      await a.query('begin')
      await a.query('delete from public.wbs_stage_approvals where wbs_item_id = $1 and round < 999', [LEAF])
      await a.query('delete from public.agent_work_orders where id = $1', [ORDER])   // 보고는 주문과 함께 지워진다(cascade)
      await a.query(`update public.wbs_items set stage = $2, actual_pct = $3, dev_workflow = $4, tags = $5, review_round = $6, review_steps = $7 where id = $1`,
        [LEAF, orig.stage, orig.actual_pct, orig.dev_workflow, orig.tags, orig.review_round, orig.review_steps])
      await a.query(`update public.project_settings set "values" = $2 where project_id = $1`, [F.projects.a, origSettings.values])
      await a.query('delete from public.change_logs where wbs_item_id = $1 and at > now() - interval \'10 minutes\' and field in (\'stage\', \'actual_pct\')', [LEAF])
      await a.query('commit')
      a.release()
    }
  })
})
