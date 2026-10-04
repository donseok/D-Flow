import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { F, asService, loadFixture, openPool, pgError } from './harness'
import golden from '../fixtures/parity/custom-fields-cases.json'
let pool: Pool
beforeAll(async () => { pool=openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const CALL = `select * from public.create_issue_from_minute_block(
  p_project_id=>$1,p_title=>'Linked custom',p_body=>'',p_severity=>'medium',p_assignee_member_ids=>$5::uuid[],
  p_start_date=>null,p_due_date=>null,p_area_id=>null,p_major_name=>null,p_sub_process=>null,p_owner_department=>null,
  p_related_systems=>null,p_source_type=>null,p_source_detail=>null,p_actor_id=>$2,p_created_by_name=>'QA',
  p_minute_id=>$3,p_minute_version_id=>$4,p_body_hash=>'rls-h',p_block_index=>50,p_block_hash=>'rls-b2',
  p_excerpt_snapshot=>'발췌',p_source_kind=>'manual',p_source_key=>null,p_custom=>$6::jsonb)`
const args = (custom:unknown, actor:string=F.users.dual, minute:string=F.rows.minute) =>
  [F.projects.a,actor,minute,F.rows.minuteVersion,[],JSON.stringify(custom)]
const setup = async (c:PoolClient, defs:unknown[]) => {
  await c.query(`update public.project_settings set "values"=jsonb_set("values",'{modules.enabled}',
    (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements("values"->'modules.enabled') x where x <> '"issue_analysis"'))
    || jsonb_build_object('fields.issue',$2::jsonb) where project_id=$1`,[F.projects.a,JSON.stringify(defs)])
}
const sig='public.create_issue_from_minute_block(uuid,text,text,text,uuid[],date,date,uuid,text,text,text,text[],text,text,uuid,text,uuid,uuid,text,integer,text,text,text,text,jsonb)'
describe('minute issue custom transaction',()=>{
  it('member false/zero and omitted protected required defaults are one insert with the source link',async()=>{
    await asService(pool,async c=>{
      await setup(c,[{...golden.defs.number,key:'amount'},{...golden.defs.boolean,key:'flag'},
        {...golden.defs.boolean,key:'approved',editable_by:'admin',required:true,default:false},
        {...golden.defs.number,key:'legacy',active:false,required:true,default:0}])
      const row=(await c.query(CALL,args({amount:0,flag:false}))).rows[0]
      expect((await c.query('select custom from public.issues where id=$1',[row.issue_id])).rows[0].custom)
        .toEqual({amount:0,flag:false,approved:false,legacy:0})
      expect((await c.query('select excerpt_snapshot from public.issue_links where issue_id=$1',[row.issue_id])).rows)
        .toEqual([{excerpt_snapshot:'발췌'}])
    })
  })
  it('service privileges cannot grant an ordinary actor explicit admin fields, even the same default',async()=>{
    await asService(pool,async c=>{
      await setup(c,[{...golden.defs.boolean,editable_by:'admin',required:true,default:false}])
      expect(await pgError(c,CALL,args({value:false}))).toMatchObject({code:'42501',message:'CUSTOM_FIELD_ADMIN_ONLY:value'})
      expect(await pgError(c,CALL,args({value:true},F.users.member))).toBeNull()
    })
  })
  it('rejects inactive/unknown/null/bad values and unaffiliated actors',async()=>{
    await asService(pool,async c=>{
      await setup(c,[{...golden.defs.number}])
      for(const [value,message] of [[{unknown:0},'CUSTOM_FIELD_UNKNOWN:unknown'],[{value:null},'CUSTOM_FIELD_NULL:value'],[{value:'bad'},'CUSTOM_FIELD_INVALID:value:type']] as const)
        expect(await pgError(c,CALL,args(value))).toMatchObject({code:'23514',message})
      expect(await pgError(c,CALL,args({},F.users.aLoose))).toMatchObject({code:'42501',message:'ISSUE_ACTOR_FORBIDDEN'})
      await setup(c,[{...golden.defs.number,active:false}])
      expect(await pgError(c,CALL,args({value:0}))).toMatchObject({code:'23514',message:'CUSTOM_FIELD_INACTIVE:value'})
    })
  })
  it('bad source or assignee rolls back core/custom/link together',async()=>{
    await asService(pool,async c=>{
      await setup(c,[golden.defs.number])
      const before=(await c.query('select count(*)::int as n from public.issues')).rows[0].n
      const bad:unknown[]=args({value:0});bad[4]=['00000000-0000-0000-0000-000000000001']
      expect(await pgError(c,CALL,bad)).toMatchObject({message:'ISSUE_ASSIGNEE_PROJECT_MISMATCH'})
      expect(await pgError(c,CALL,args({value:0},F.users.dual,'00000000-0000-0000-0000-000000000001'))).toMatchObject({message:'MINUTE_NOT_FOUND'})
      expect((await c.query('select count(*)::int as n from public.issues')).rows[0].n).toBe(before)
    })
  })
  it('new overload is service only; rollback retains legacy API, stored fields and source links',async()=>{
    await asService(pool,async c=>{
      await setup(c,[golden.defs.number])
      const row=(await c.query(CALL,args({value:0}))).rows[0]
      const acl=(await c.query(`select has_function_privilege('anon',$1,'EXECUTE') as anon,
        has_function_privilege('authenticated',$1,'EXECUTE') as auth,has_function_privilege('service_role',$1,'EXECUTE') as svc`,[sig])).rows[0]
      expect(acl).toEqual({anon:false,auth:false,svc:true})
      const dir='supabase/rollbacks';const file=readdirSync(dir).find(f=>f.endsWith('_minute_issue_custom_fields_rollback.sql'))!
      await c.query(readFileSync(join(dir,file),'utf8').replace(/^begin;|^commit;/gmi,''))
      expect((await c.query('select to_regprocedure($1) as rpc',[sig])).rows[0].rpc).toBeNull()
      expect((await c.query('select custom from public.issues where id=$1',[row.issue_id])).rows[0].custom).toEqual({value:0})
      expect((await c.query('select count(*)::int as n from public.issue_links where issue_id=$1',[row.issue_id])).rows[0].n).toBe(1)
      expect(await pgError(c,CALL.replace(',p_custom=>$6::jsonb',''),args({}).slice(0,5))).toBeNull()
    })
  })
})
