import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const apply = async (c: PoolClient, patch: unknown, stamp?: string | null, actor: string = F.users.member, project: string = F.projects.a) => {
  const revision = stamp === undefined ? (await c.query('select updated_at::text from public.wbs_items where id=$1', [F.leaf.aErp])).rows[0].updated_at : stamp
  return (await c.query('select public.apply_wbs_bulk_item($1,$2,$3,$4,$5::jsonb) result', [project, actor, F.leaf.aErp, revision, JSON.stringify(patch)])).rows[0].result
}
describe('SPU3 항목별 원자 저장/CAS', () => {
  it('JWT 관리자도 서비스 전용 RPC를 직접 실행할 수 없다', async () => {
    await asUser(pool, F.users.member, async c => {
      expect((await pgError(c, 'select public.apply_wbs_bulk_item($1,$2,$3,null,$4)', [F.projects.a, F.users.member, F.leaf.aErp, '{}']))?.code).toBe('42501')
    })
  })
  it('서비스 호출도 비관리자/타 프로젝트 행위자는 거부한다', async () => {
    await asService(pool, async c => {
      expect(await apply(c, { biz: '금지' }, undefined, F.users.aLoose)).toMatchObject({ ok: false, reason: 'permission' })
      expect(await apply(c, { biz: '금지' }, undefined, F.users.bAdmin)).toMatchObject({ ok: false, reason: 'permission' })
    })
  })
  it('스냅샷 이후 갱신된 revision은 저장·이력 모두 남기지 않는다', async () => {
    await asService(pool, async c => {
      const before = (await c.query('select count(*)::int n from public.change_logs where wbs_item_id=$1',[F.leaf.aErp])).rows[0].n
      expect(await apply(c, { deliverable: '새 값' }, '2000-01-01T00:00:00Z')).toMatchObject({ ok: false, reason: 'conflict' })
      expect((await c.query('select count(*)::int n from public.change_logs where wbs_item_id=$1',[F.leaf.aErp])).rows[0].n).toBe(before)
    })
  })
  it('날짜 역전 및 잘못된 담당자·팀은 정상 필드까지 저장하지 않는다', async () => {
    await asService(pool, async c => {
      for (const patch of [{ biz: '금지', planned_start: '2026-10-20', planned_end: '2026-10-01' }, { biz: '금지', assignee_member_id: F.members.benB }, { biz: '금지', team_code: '없는 팀' }]) {
        expect((await apply(c, patch)).ok).toBe(false)
        expect((await c.query('select biz from public.wbs_items where id=$1',[F.leaf.aErp])).rows[0].biz).not.toBe('금지')
      }
    })
  })
  it('필드·주관 팀·이력을 함께 저장하고 지원 팀을 보존한다', async () => {
    await asService(pool, async c => {
      await c.query("insert into public.item_owners(wbs_item_id,team_id,kind) values($1,$2,'support') on conflict do nothing", [F.leaf.aErp,F.teams.mes])
      expect(await apply(c,{ biz: 'SPU3', team_code: 'ERP' })).toMatchObject({ ok: true })
      const owners = (await c.query('select team_id,kind from public.item_owners where wbs_item_id=$1',[F.leaf.aErp])).rows
      expect(owners).toEqual(expect.arrayContaining([{ team_id: F.teams.erp, kind: 'primary' }, { team_id: F.teams.mes, kind: 'support' }]))
      expect((await c.query("select new_value from public.change_logs where wbs_item_id=$1 and field='biz' order by at desc limit 1",[F.leaf.aErp])).rows[0].new_value).toBe('SPU3')
    })
  })
  it('주관 팀 비우기는 지원 팀을 삭제하지 않는다', async () => {
    await asService(pool, async c => {
      await c.query("insert into public.item_owners(wbs_item_id,team_id,kind) values($1,$2,'support') on conflict do nothing",[F.leaf.aErp,F.teams.mes])
      expect(await apply(c,{ team_code: null })).toMatchObject({ ok: true })
      expect((await c.query('select kind from public.item_owners where wbs_item_id=$1',[F.leaf.aErp])).rows).toEqual([{kind:'support'}])
    })
  })
  it('단계 CAS wrapper는 오래된 화면에서 기존 승인 RPC를 실행하지 않는다', async () => {
    await asService(pool, async c => {
      const { rows } = await c.query("select public.apply_workflow_event_cas($1,$2,$3,'2000-01-01',null,null) result",[F.projects.a,F.users.member,F.leaf.aErp])
      expect(rows[0].result).toMatchObject({ ok:false, conflict:true })
    })
  })
  // 0048 — 단계 값 대조 래퍼. updated_at 이 아니라 화면이 본 단계 하나만 본다(실적 저장만으로 거짓 충돌이 나지 않는다)
  const stageCas = "select public.apply_workflow_event_stage_cas($1,$2,$3,$4,$5,null) result"
  it('단계 값 CAS: 본 단계가 서버와 다르면 실행하지 않고 서버의 단계를 돌려준다', async () => {
    await asService(pool, async c => {
      const now = (await c.query('select stage from public.wbs_items where id=$1', [F.leaf.aErp])).rows[0].stage as string | null
      const wrong = now === 'ip' ? 'td' : 'ip'
      const { rows } = await c.query(stageCas, [F.projects.a, F.users.member, F.leaf.aErp, wrong, null])
      expect(rows[0].result).toMatchObject({ ok: false, conflict: true, reason: 'conflict', latest_stage: now })
      expect((await c.query('select stage from public.wbs_items where id=$1', [F.leaf.aErp])).rows[0].stage).toBe(now)
    })
  })
  it('단계 값 CAS: 본 단계가 같으면 기존 사건 함수의 결과를 그대로 돌려준다(충돌 아님) · 다른 프로젝트의 항목은 없는 항목이다', async () => {
    await asService(pool, async c => {
      const now = (await c.query('select stage from public.wbs_items where id=$1', [F.leaf.aErp])).rows[0].stage as string | null
      const same = (await c.query(stageCas, [F.projects.a, F.users.member, F.leaf.aErp, now, now])).rows[0].result
      expect(same.conflict).not.toBe(true)
      const base = (await c.query("select public.apply_workflow_event(p_event => 'set_stage', p_actor => $1, p_item_id => $2, p_stage => $3) result", [F.users.member, F.leaf.aErp, now])).rows[0].result
      expect(same.ok).toBe(base.ok)
      expect((await c.query(stageCas, [F.projects.bWs, F.users.member, F.leaf.aErp, now, now])).rows[0].result).toMatchObject({ ok: false, reason: 'item_not_found' })
    })
  })
  it('단계 값 CAS 래퍼도 JWT 세션은 실행할 수 없다', async () => {
    await asUser(pool, F.users.member, async c => {
      expect((await pgError(c, stageCas, [F.projects.a, F.users.member, F.leaf.aErp, null, null]))?.code).toBe('42501')
    })
  })
})
