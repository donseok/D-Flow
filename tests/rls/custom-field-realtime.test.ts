import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { asService, F, loadFixture, openPool } from './harness'
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const P = F.projects.b
const def = { key: 'quantity', label: 'Quantity', description: '', type: 'number', required: false, active: true, editable_by: 'member', show_in_list: false, searchable: false, sort: 0 }
const define = (c: PoolClient, entity: string, defs: unknown[]) => c.query(`update public.project_settings set "values"="values" || jsonb_build_object($2::text,$3::jsonb) where project_id=$1`, [P, `fields.${entity}`, JSON.stringify(defs)])
const jwt = async (c: PoolClient) => {
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: F.users.member, role: 'authenticated' })])
  await c.query('set local role authenticated')
}
const messages = (c: PoolClient) => c.query(`select id::text as id,payload from realtime.messages where topic=$1 and event='wbs_changed' and payload->>'id'=$2`, [`project-${P}-wbs`,F.leaf.bOwnTeam])
const stamp = async (c: PoolClient, id: string) => (await c.query('select updated_at::text as ts from public.issues where id=$1',[id])).rows[0].ts as string
const advanced = async (c: PoolClient, id: string, before: string) => (await c.query('select updated_at>$2::timestamptz as changed from public.issues where id=$1',[id,before])).rows[0].changed
const sql = (dir:string,suffix:string) => readFileSync(join(process.cwd(),dir,readdirSync(join(process.cwd(),dir)).find(f=>f.endsWith(suffix))!), 'utf8')
describe('custom value propagation', () => {
  it('a direct JWT issue custom edit advances the stored timestamp; a no-op leaves it alone', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[def])
      const id=(await c.query(`insert into public.issues(project_id,title,custom) values($1,'timestamp','{"quantity":0}') returning id`,[P])).rows[0].id
      const before=await stamp(c,id)
      await jwt(c)
      await c.query(`update public.issues set custom='{"quantity":1}' where id=$1`,[id])
      expect(await advanced(c,id,before)).toBe(true)
      const after=await stamp(c,id)
      await c.query('update public.issues set custom=custom where id=$1',[id])
      expect(await stamp(c,id)).toBe(after)
    })
  })
  it('service backfill and purge also advance issue timestamps without a UI action', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[def])
      const id=(await c.query(`insert into public.issues(project_id,title) values($1,'bulk timestamp') returning id`,[P])).rows[0].id
      const revision=async()=>Number((await c.query('select revision from public.project_settings where project_id=$1',[P])).rows[0].revision)
      const before=await stamp(c,id)
      await c.query(`select public.backfill_custom_field($1,$2,$3,'issue','quantity','0'::jsonb,$4)`,[P,await revision(),randomUUID(),F.users.wsAdmin])
      expect(await advanced(c,id,before)).toBe(true)
      const filled=await stamp(c,id)
      const count=Number((await c.query(`select count(*) from public.issues where project_id=$1 and custom ? 'quantity'`,[P])).rows[0].count)
      await c.query(`select public.purge_custom_field($1,$2,$3,'issue','quantity',$4,$5)`,[P,await revision(),randomUUID(),count,F.users.wsAdmin])
      expect(await advanced(c,id,filled)).toBe(true)
    })
  })
  it('custom-only JWT WBS edits emit one private snapshot containing zero/false and the current core fields', async () => {
    await asService(pool, async c => {
      await define(c,'wbs_item',[def,{...def,key:'approved',type:'boolean'}])
      const held=(await c.query('select updated_at::text as ts from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].ts
      const before=new Set((await messages(c)).rows.map(r=>r.id))
      await jwt(c)
      await c.query(`update public.wbs_items set custom='{"quantity":0,"approved":false}' where id=$1`,[F.leaf.bOwnTeam])
      await c.query('reset role')
      expect((await c.query('select updated_at>$2::timestamptz as advanced from public.wbs_items where id=$1',[F.leaf.bOwnTeam,held])).rows[0].advanced).toBe(true)
      const fresh=(await messages(c)).rows.filter(r=>!before.has(r.id))
      expect(fresh).toHaveLength(1)
      const row=(await c.query('select stage,actual_pct,custom,updated_at from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0]
      expect(fresh[0].payload).toMatchObject({id:F.leaf.bOwnTeam,project_id:P,custom:row.custom,stage:row.stage})
      expect(fresh[0].payload.custom).toEqual({quantity:0,approved:false})
      expect(Number(fresh[0].payload.actual_pct)).toBe(Number(row.actual_pct))
      expect(Date.parse(fresh[0].payload.updated_at)).toBe(row.updated_at.getTime())
      const count=(await messages(c)).rowCount
      await c.query('update public.wbs_items set custom=custom where id=$1',[F.leaf.bOwnTeam])
      expect((await messages(c)).rowCount).toBe(count)
    })
  })
  it('a combined core/custom change emits a single snapshot, avoiding duplicate events with the same timestamp', async () => {
    await asService(pool, async c => {
      await define(c,'wbs_item',[def])
      const before=new Set((await messages(c)).rows.map(r=>r.id))
      await c.query(`update public.wbs_items set actual_pct=17,custom='{"quantity":2}' where id=$1`,[F.leaf.bOwnTeam])
      expect((await messages(c)).rows.filter(r=>!before.has(r.id))).toHaveLength(1)
    })
  })
  it('the new trigger helper exposes no anonymous/authenticated RPC privilege', async () => {
    await asService(pool,async c=>{
      expect((await c.query(`select has_function_privilege('anon','public.touch_issue_custom_fields()','execute') as anon,
        has_function_privilege('authenticated','public.touch_issue_custom_fields()','execute') as member,
        has_function_privilege('service_role','public.touch_issue_custom_fields()','execute') as service`)).rows[0]).toEqual({anon:false,member:false,service:true})
    })
  })
  it('rollback preserves values and restores the previous broadcast, then reapply restores propagation', async () => {
    await asService(pool, async c => {
      await define(c,'wbs_item',[def])
      await c.query(`update public.wbs_items set custom='{"quantity":0}' where id=$1`,[F.leaf.bOwnTeam])
      await c.query(sql('supabase/rollbacks','_custom_field_wbs_clock_rollback.sql'))
      await c.query(sql('supabase/rollbacks','_custom_field_realtime_rollback.sql'))
      expect((await c.query('select custom from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].custom).toEqual({quantity:0})
      expect((await c.query(`select to_regprocedure('public.touch_issue_custom_fields()') as fn`)).rows[0].fn).toBeNull()
      const before=new Set((await messages(c)).rows.map(r=>r.id))
      await c.query(`update public.wbs_items set custom='{"quantity":1}' where id=$1`,[F.leaf.bOwnTeam])
      expect((await messages(c)).rows.filter(r=>!before.has(r.id))).toHaveLength(0)
      await c.query(sql('supabase/migrations','_custom_field_realtime.sql'))
      await c.query(`update public.wbs_items set custom='{"quantity":2}' where id=$1`,[F.leaf.bOwnTeam])
      expect((await messages(c)).rows.filter(r=>!before.has(r.id))).toHaveLength(1)
    })
  })
  it('WBS bulk backfill/purge advance the clock while no-op writes preserve it', async () => {
    await asService(pool, async c => {
      await define(c,'wbs_item',[def])
      const stampWbs=async()=>(await c.query('select updated_at::text as ts from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].ts as string
      const isAdvanced=async(before:string)=>(await c.query('select updated_at>$2::timestamptz as changed from public.wbs_items where id=$1',[F.leaf.bOwnTeam,before])).rows[0].changed
      const revision=async()=>Number((await c.query('select revision from public.project_settings where project_id=$1',[P])).rows[0].revision)
      const before=await stampWbs()
      await c.query(`select public.backfill_custom_field($1,$2,$3,'wbs_item','quantity','0'::jsonb,$4)`,[P,await revision(),randomUUID(),F.users.wsAdmin])
      expect(await isAdvanced(before)).toBe(true)
      const filled=await stampWbs()
      await c.query('update public.wbs_items set custom=custom where id=$1',[F.leaf.bOwnTeam])
      expect(await stampWbs()).toBe(filled)
      const count=Number((await c.query(`select count(*) from public.wbs_items where project_id=$1 and custom ? 'quantity'`,[P])).rows[0].count)
      await c.query(`select public.purge_custom_field($1,$2,$3,'wbs_item','quantity',$4,$5)`,[P,await revision(),randomUUID(),count,F.users.wsAdmin])
      expect(await isAdvanced(filled)).toBe(true)
    })
  })
  it('WBS clock helper is private and rollback/reapply preserve values', async () => {
    await asService(pool,async c=>{
      expect((await c.query(`select has_function_privilege('anon','public.touch_wbs_custom_fields()','execute') as anon,
        has_function_privilege('authenticated','public.touch_wbs_custom_fields()','execute') as member,
        has_function_privilege('service_role','public.touch_wbs_custom_fields()','execute') as service`)).rows[0]).toEqual({anon:false,member:false,service:true})
      await define(c,'wbs_item',[def])
      await c.query(`update public.wbs_items set custom='{"quantity":0}' where id=$1`,[F.leaf.bOwnTeam])
      const held=(await c.query('select updated_at::text as ts from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].ts
      await c.query(sql('supabase/rollbacks','_custom_field_wbs_clock_rollback.sql'))
      expect((await c.query('select custom from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].custom).toEqual({quantity:0})
      await c.query(`update public.wbs_items set custom='{"quantity":1}' where id=$1`,[F.leaf.bOwnTeam])
      expect((await c.query('select updated_at::text as ts from public.wbs_items where id=$1',[F.leaf.bOwnTeam])).rows[0].ts).toBe(held)
      await c.query(sql('supabase/migrations','_custom_field_wbs_clock.sql'))
      await c.query(`update public.wbs_items set custom='{"quantity":2}' where id=$1`,[F.leaf.bOwnTeam])
      expect((await c.query('select updated_at>$2::timestamptz as changed from public.wbs_items where id=$1',[F.leaf.bOwnTeam,held])).rows[0].changed).toBe(true)
    })
  })

})
