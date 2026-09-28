// 합성 구성의 TS↔SQL 패리티(개정 §6.5.7·§6.5.8) — 세 구성(기본·R·C)의 크레딧 표를 설정 RPC 로 넣고, 전이 RPC 가 쓰는 실적이
// TS creditForKey 와 같은지 본다. SP3a 에서 SQL 이 읽는 등록 키는 workflow.stage_credits 하나다. 전부 begin…rollback.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS, EVENT_CREDIT, creditForKey, validateStageCredits, type CreditEvent } from '@/lib/domain/stageCredits'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { F, asService, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LEAF = F.leaf.aErp
const ORDER = '00000000-0000-0000-7e57-000000001326'
const START = 40   // 어느 크레딧과도 다른 출발 실적 — 적용됐는지가 값으로 드러난다
const EVENT_RPC = 'select public.apply_workflow_event($1, $2, $3, $4, null, null, null, null) as r'
/** 사건 → 그 사건이 기대하는 주문의 출발 상태(주문 사건만. assign 은 주문 없이 항목으로 부른다) */
const FROM: Partial<Record<CreditEvent, string>> = {
  claim: 'ready', report_completion: 'claimed', release: 'claimed', approve: 'reported', reject: 'reported', unapprove: 'approved', rework: 'approved',
}
async function arrange(c: PoolClient, status: string | null) {
  await c.query(`update public.wbs_items set dev_workflow = true, tags = '{}', stage = null, actual_pct = $2 where id = $1`, [LEAF, START])
  await c.query('delete from public.agent_work_orders where id = $1', [ORDER])
  if (status) {
    await c.query('insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, $4)',
      [ORDER, F.projects.a, LEAF, status])
  }
}

describe.each(SYNTHETIC_CONFIGS.map((cfg) => [cfg.id, cfg] as const))('합성 구성 %s — 크레딧 패리티', (_id, cfg) => {
  const credits = cfg.project['workflow.stage_credits'] ?? null

  it('구성의 크레딧 표는 TS 검증을 통과한다(표가 없으면 기본값을 쓴다)', () => {
    if (credits) expect(validateStageCredits(credits)).toEqual({ ok: true, credits })
    expect(Object.values((credits ?? DEFAULT_STAGE_CREDITS).default)).not.toContain(START)
  })

  it('설정 RPC 로 넣은 표로 전이 사건 여덟이 TS creditForKey 와 같은 실적을 쓴다', async () => {
    await asService(pool, async (c) => {
      const patch = credits
        ? { set: JSON.stringify({ 'workflow.stage_credits': credits }), unset: null }
        : { set: '{}', unset: ['workflow.stage_credits'] }
      // 기대 revision 은 호출 직전에 읽는다 — 픽스처가 설정 행을 몇 번 고쳤는지에 기대지 않는다
      const revision = (await c.query('select revision from public.project_settings where project_id = $1', [F.projects.a])).rows[0].revision
      const applied = (await c.query('select public.apply_project_settings($1, $2, gen_random_uuid(), $3::jsonb, $4::text[], $5, 1, $6) as r',
        [F.projects.a, revision, patch.set, patch.unset, F.users.member, 'edit'])).rows[0].r as Record<string, unknown>
      expect(applied, cfg.id).toMatchObject({ status: 'applied' })
      for (const event of Object.keys(EVENT_CREDIT) as CreditEvent[]) {
        const status = FROM[event] ?? null
        await arrange(c, status)
        const r = (await c.query(EVENT_RPC, [event, F.users.member, status ? null : LEAF, status ? ORDER : null])).rows[0].r as Record<string, unknown>
        const want = creditForKey(EVENT_CREDIT[event], credits)
        expect(r, `${cfg.id} ${event}`).toMatchObject({ ok: true, skipped: null })
        expect(Number(r.actual_pct), `${cfg.id} ${event}`).toBe(want)
      }
    })
  })
})
