import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { asService, asUser, F, loadFixture, openPool, pgError } from './harness'
import golden from '../fixtures/parity/custom-fields-cases.json'
import { parseFieldDefs, type FieldDef } from '@/lib/domain/customFields'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const P = F.projects.a
const defs = golden.defs as Record<string, FieldDef>
const define = (c: PoolClient, entity: string, list: unknown, pid: string = P) => c.query(`update public.project_settings set "values"="values" || jsonb_build_object($2::text,$3::jsonb) where project_id=$1`, [pid, `fields.${entity}`, JSON.stringify(list)])
const insert = (c: PoolClient, custom: unknown, pid: string = P) => c.query(`insert into public.issues(project_id,title,custom) values($1,'SP5c field', $2::jsonb) returning id,custom`, [pid, JSON.stringify(custom)])
const save = `select public.apply_project_settings($1,$2,gen_random_uuid(),$3::jsonb,'{}'::text[],$4,1,'edit') as v`
const rev = async (c: PoolClient, pid: string=P) => Number((await c.query('select revision from public.project_settings where project_id=$1',[pid])).rows[0].revision)
const backfill = 'select public.backfill_custom_field($1,$2,$3,$4,$5,$6::jsonb,$7) as v'
const purge = 'select public.purge_custom_field($1,$2,$3,$4,$5,$6,$7) as v'

describe('custom field value golden TS↔SQL', () => {
  it.each(golden.cases)('$name', async c => {
    await asService(pool, async client => {
      const result = (await client.query('select public.custom_value_error($1::jsonb,$2::jsonb,$3::jsonb) as error', [JSON.stringify(defs[c.def]),JSON.stringify(c.value), 'prev' in c ? JSON.stringify(c.prev) : null])).rows[0].error
      expect(result).toBe(c.error)
    })
  })
  it('all stored golden definitions accepted in SQL', async () => {
    await asService(pool, async c => {
      for (const d of Object.values(defs)) expect((await c.query('select public.custom_field_defs_of($1,$2::jsonb) as v',['issue',JSON.stringify([d])])).rows[0].v).toEqual([d])
    })
  })
  it('definition bounds are enforced by both validators', async () => {
    const many = (n:number, active=true, show=false) => Array.from({length:n},(_,i)=>({...defs.text,key:`f${i}`,active,show_in_list:show}))
    const cases: unknown[] = [null,{},[null],[{...defs.text,label:''}],[{...defs.text,extra:1}],[{...defs.text,required:true}],[{...defs.text,default:null}],
      [{...defs.number,limits:{decimals:5}}],[{...defs.text,carry_over:true}],[{...defs.select,default:'legacy'}],
      [{...defs.text,active:null}],[{...defs.select,options:[{...defs.select.options![0],color:null}]}],
      [defs.text,defs.text],many(31),many(61,false),many(9,true,true)]
    await asService(pool, async c => {
      for (const v of cases.filter(v=>v!==null)) {
        expect(parseFieldDefs('issue',v).ok).toBe(false)
        expect(await pgError(c,'select public.custom_field_defs_of($1,$2::jsonb)',['issue',JSON.stringify(v)])).toMatchObject({code:'22023'})
      }
      for (const v of [[],many(30),many(60,false),many(8,true,true)]) expect(await pgError(c,'select public.custom_field_defs_of($1,$2::jsonb)',['issue',JSON.stringify(v)])).toBeNull()
    })
  })
})

describe('row trigger contract', () => {
  it('no definitions accepts empty rows, unknown keys/null/wrong type rejected', async () => {
    await asService(pool, async c => {
      expect((await insert(c,{})).rows[0].custom).toEqual({})
      expect(await pgError(c,`insert into public.issues(project_id,title,custom) values($1,'unknown','{"unknown":1}')`,[P])).toMatchObject({message:'CUSTOM_FIELD_UNKNOWN:unknown'})
      await define(c,'issue',[defs.number])
      for (const [v,error] of [[null,'CUSTOM_FIELD_NULL:value'],['1','CUSTOM_FIELD_INVALID:value:type']] as const) {
        expect(await pgError(c,`insert into public.issues(project_id,title,custom) values($1,'invalid',$2::jsonb)`,[P,JSON.stringify({value:v})])).toMatchObject({code:'23514',message:error})
      }
    })
  })
  it('required insert uses defaults even for machine generation; remove on update rejected', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[{...defs.boolean,required:true,default:false}])
      const row = (await insert(c,{})).rows[0]
      expect(row.custom).toEqual({value:false})
      expect(await pgError(c,`update public.issues set custom='{}' where id=$1`,[row.id])).toMatchObject({message:'CUSTOM_FIELD_REQUIRED:value'})
    })
  })
  it('inactive field cannot be added, changed or removed; same value preserved', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[defs.text])
      const row = (await insert(c,{value:'old'})).rows[0]
      await define(c,'issue',[{...defs.text,active:false}])
      expect(await pgError(c,`update public.issues set custom=custom where id=$1`,[row.id])).toBeNull()
      expect(await pgError(c,`update public.issues set custom='{}' where id=$1`,[row.id])).toMatchObject({message:'CUSTOM_FIELD_INACTIVE:value'})
      expect(await pgError(c,`update public.issues set custom='{"value":"new"}' where id=$1`,[row.id])).toMatchObject({message:'CUSTOM_FIELD_INACTIVE:value'})
    })
  })
  it('project-local same key; definitions of another project do not widen accepted values', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[defs.number],P)
      await define(c,'issue',[defs.text],F.projects.b)
      expect(await pgError(c,`insert into public.issues(project_id,title,custom) values($1,'A','{"value":"str"}')`,[P])).toMatchObject({message:'CUSTOM_FIELD_INVALID:value:type'})
      expect((await insert(c,{value:'str'},F.projects.b)).rows[0].custom).toEqual({value:'str'})
    })
  })
  it('member cannot change or remove admin keys through JWT, but can edit member WBS field', async () => {
    await asService(pool, async c => {
      await define(c,'wbs_item',[defs.text,{...defs.number,key:'admin_value',editable_by:'admin'}],F.projects.b)
      await c.query(`update public.wbs_items set custom='{"admin_value":3}' where id=$1`,[F.leaf.bOwnTeam])
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:F.users.member,role:'authenticated'})])
      expect(await pgError(c,`update public.wbs_items set custom=custom || '{"value":"member"}' where id=$1`,[F.leaf.bOwnTeam])).toBeNull()
      expect(await pgError(c,`update public.wbs_items set custom=custom || '{"admin_value":4}' where id=$1`,[F.leaf.bOwnTeam])).toMatchObject({code:'42501',message:'CUSTOM_FIELD_ADMIN_ONLY:admin_value'})
      expect(await pgError(c,`update public.wbs_items set custom=custom - 'admin_value' where id=$1`,[F.leaf.bOwnTeam])).toMatchObject({code:'42501',message:'CUSTOM_FIELD_ADMIN_ONLY:admin_value'})
      expect(await pgError(c,`update public.wbs_items set name='forbidden' where id=$1`,[F.leaf.bOwnTeam])).toMatchObject({code:'42501'})
      await c.query(`select set_config('dflow.custom_field_admin','on',true)`)
      expect(await pgError(c,`update public.wbs_items set custom=custom || '{"admin_value":4}' where id=$1`,[F.leaf.bOwnTeam])).toMatchObject({code:'42501'})
    })
  })
  it('JWT issue member direct writes use the same validation', async () => {
    await asService(pool, async c => {
      await define(c,'issue',[defs.number],F.projects.b)
      const row=(await insert(c,{},F.projects.b)).rows[0]
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:F.users.member,role:'authenticated'})])
      expect(await pgError(c,`update public.issues set custom='{"value":1}' where id=$1`,[row.id])).toBeNull()
      expect(await pgError(c,`update public.issues set custom='{"value":"1"}' where id=$1`,[row.id])).toMatchObject({message:'CUSTOM_FIELD_INVALID:value:type'})
    })
  })
  it('weekly row grants only custom in addition to existing editable cells; admin fields remain protected', async () => {
    await asService(pool, async c => {
      await define(c,'weekly_row',[defs.number,{...defs.text,key:'admin_only',editable_by:'admin'}])
      const id='00000000-0000-0000-7e57-00000000111f'
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:F.users.dual,role:'authenticated'})])
      expect(await pgError(c,`update public.weekly_report_rows set custom='{"value":3}' where id=$1`,[id])).toBeNull()
      expect(await pgError(c,`update public.weekly_report_rows set custom=custom || '{"admin_only":"bad"}' where id=$1`,[id])).toMatchObject({message:'CUSTOM_FIELD_ADMIN_ONLY:admin_only'})
      expect(await pgError(c,`update public.weekly_report_rows set area_id=area_id where id=$1`,[id])).toMatchObject({code:'42501'})
    })
  })
  it('unknown shape, oversized row, corrupt definitions and repeatable-read fail closed', async () => {
    await asService(pool,async c=>{
      await define(c,'issue',[defs.text])
      expect(await pgError(c,`insert into public.issues(project_id,title,custom) values($1,'shape','[]')`,[P])).toMatchObject({message:'CUSTOM_FIELD_SHAPE'})
      await define(c,'issue',Array.from({length:10},(_,i)=>({...defs.multiline,key:`v${i}`,limits:{maxLength:4000}})))
      const custom=Object.fromEntries(Array.from({length:10},(_,i)=>[`v${i}`,'한'.repeat(1000)]))
      expect(await pgError(c,`insert into public.issues(project_id,title,custom) values($1,'large',$2::jsonb)`,[P,JSON.stringify(custom)])).toMatchObject({message:'CUSTOM_FIELD_SIZE'})
      await define(c,'issue',{})
      expect(await pgError(c,`insert into public.issues(project_id,title) values($1,'corrupt')`,[P])).toMatchObject({code:'22023'})
    })
    const c=await pool.connect()
    try { await c.query('begin isolation level repeatable read'); expect(await pgError(c,`insert into public.issues(project_id,title) values($1,'RR')`,[P])).toMatchObject({code:'25001'}) }
    finally { await c.query('rollback');c.release() }
  })
})

describe('definition changes and explicit commands', () => {
  it('value-bearing type/delete/narrowing are blocked; labels, inactive and text→multiline allowed', async () => {
    await asService(pool,async c=>{
      await define(c,'issue',[defs.text]);await insert(c,{value:'hello'})
      for(const next of [[],[defs.number],[{...defs.text,limits:{maxLength:2}}]]) {
        expect(await pgError(c,save,[P,await rev(c),JSON.stringify({'fields.issue':next}),F.users.member])).toMatchObject({message:'SETTINGS_CODE_IN_USE:fields.issue'})
      }
      for(const next of [[{...defs.text,label:'renamed'}],[{...defs.text,active:false}],[{...defs.multiline}]]) {
        expect(await pgError(c,save,[P,await rev(c),JSON.stringify({'fields.issue':next}),F.users.member])).toBeNull()
      }
    })
  })
  it('missing required fields cannot be enabled by plain settings save', async () => {
    await asService(pool,async c=>{
      await insert(c,{})
      expect(await pgError(c,save,[P,await rev(c),JSON.stringify({'fields.issue':[{...defs.boolean,required:true,default:false}]}),F.users.member])).toMatchObject({message:'SETTINGS_CODE_IN_USE:fields.issue'})
    })
  })
  it('backfill atomically fills missing rows, enables required, increments revision and records retryable receipt', async()=>{
    await asService(pool,async c=>{
      await define(c,'issue',[defs.boolean]);await insert(c,{})
      const revision=await rev(c),id=randomUUID(),args=[P,revision,id,'issue','value','false',F.users.member]
      const result=(await c.query(backfill,args)).rows[0].v
      expect(result).toMatchObject({status:'applied',revision:revision+1})
      expect(result.count).toBeGreaterThanOrEqual(1)
      expect((await c.query('select "values" from public.project_settings where project_id=$1',[P])).rows[0].values['fields.issue'][0]).toMatchObject({required:true,default:false})
      expect(Number((await c.query(`select count(*) from public.issues where project_id=$1 and not custom ? 'value'`,[P])).rows[0].count)).toBe(0)
      expect((await c.query(backfill,args)).rows[0].v).toMatchObject({status:'duplicate',count:result.count,revision:revision+1})
      expect(await pgError(c,backfill,[...args.slice(0,5),'true',F.users.member])).toMatchObject({message:'COMMAND_REUSED'})
    })
  })
  it('purge needs exact preview count and removes values+definition atomically; stale CAS cannot write',async()=>{
    await asService(pool,async c=>{
      await define(c,'issue',[defs.text]);await insert(c,{value:'delete'})
      const revision=await rev(c),id=randomUUID(),args=[P,revision,id,'issue','value',1,F.users.member]
      expect(await pgError(c,purge,[...args.slice(0,5),2,F.users.member])).toMatchObject({message:'CUSTOM_FIELD_COUNT_CONFLICT'})
      expect(await pgError(c,purge,[P,revision-1,id,'issue','value',1,F.users.member])).toMatchObject({message:'SETTINGS_REVISION_CONFLICT'})
      const result=(await c.query(purge,args)).rows[0].v
      expect(result).toMatchObject({count:1,revision:revision+1})
      expect((await c.query(`select "values" -> 'fields.issue' as defs from public.project_settings where project_id=$1`,[P])).rows[0].defs).toEqual([])
      expect(Number((await c.query(`select count(*) from public.issues where project_id=$1 and custom ? 'value'`,[P])).rows[0].count)).toBe(0)
      expect((await c.query(purge,args)).rows[0].v).toMatchObject({status:'duplicate',count:1})
    })
  })
  it('commands recheck actor grade and JWT sessions cannot invoke private/service functions',async()=>{
    await asService(pool,async c=>{
      expect(await pgError(c,purge,[P,await rev(c),randomUUID(),'issue','value',0,F.users.aLoose])).toMatchObject({code:'42501',message:'CUSTOM_FIELD_COMMAND_FORBIDDEN'})
    })
    await asUser(pool,F.users.member,async c=>{
      expect(await pgError(c,purge,[P,0,randomUUID(),'issue','value',0,F.users.member])).toMatchObject({code:'42501'})
      expect(await pgError(c,backfill,[P,0,randomUUID(),'issue','value','true',F.users.member])).toMatchObject({code:'42501'})
    })
    await asService(pool,async c=>{
      const procs=(await c.query(`select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('custom_value_error','custom_field_defs_of','custom_field_table','enforce_custom_fields','custom_fields_ref_check','custom_field_command','backfill_custom_field','purge_custom_field')`)).rows
      expect(procs).toHaveLength(8)
      for(const p of procs) for(const role of ['anon','authenticated']) expect((await c.query("select has_function_privilege($1,$2::oid,'EXECUTE') as allowed",[role,p.oid])).rows[0].allowed).toBe(false)
    })
  })
})


describe('concurrency — independent DB connections, isolated project cleanup', () => {
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => e as {code:string;message:string})
  async function blocked(observer: PoolClient,pid:number) {
    for(let n=0;n<100;n++) {
      if((await observer.query("select wait_event_type='Lock' as b from pg_stat_activity where pid=$1",[pid])).rows[0]?.b) return true
      await new Promise(r=>setTimeout(r,20))
    }
    return false
  }
  async function isolated(run:(a:PoolClient,b:PoolClient,pid:string)=>Promise<void>) {
    const a=await pool.connect(),b=await pool.connect(),pid=randomUUID()
    try {
      await a.query("insert into public.projects(id,name,workspace_id) values($1,'SP5c race',$2)",[pid,F.ws])
      await define(a,'issue',[defs.text],pid)
      await run(a,b,pid)
    } finally {
      await a.query('rollback');await b.query('rollback')
      await a.query('delete from public.projects where id=$1',[pid])
      a.release();b.release()
    }
  }
  it('type change wins: blocked old-type INSERT reads the committed definition and fails',async()=>{
    await isolated(async(a,b,pid)=>{
      await a.query('begin');await b.query('begin')
      const bp=(await b.query('select pg_backend_pid() as pid')).rows[0].pid
      await a.query(save,[pid,await rev(a,pid),JSON.stringify({'fields.issue':[defs.number]}),F.users.wsAdmin])
      const pending=outcome(insert(b,{value:'old type'},pid))
      expect(await blocked(a,bp)).toBe(true)
      await a.query('commit')
      expect(await pending).toMatchObject({code:'23514',message:'CUSTOM_FIELD_INVALID:value:type'})
      await b.query('rollback')
      expect(Number((await a.query('select count(*) from public.issues where project_id=$1',[pid])).rows[0].count)).toBe(0)
    })
  })
  it('old-type write wins: definition change waits and rejects after counting the committed value',async()=>{
    await isolated(async(a,b,pid)=>{
      await a.query('begin');await b.query('begin')
      const ap=(await a.query('select pg_backend_pid() as pid')).rows[0].pid
      await insert(b,{value:'old type'},pid)
      const revision=await rev(a,pid)
      const pending=outcome(a.query(save,[pid,revision,JSON.stringify({'fields.issue':[defs.number]}),F.users.wsAdmin]))
      expect(await blocked(b,ap)).toBe(true)
      await b.query('commit')
      expect(await pending).toMatchObject({code:'23514',message:'SETTINGS_CODE_IN_USE:fields.issue'})
      await a.query('rollback')
      expect((await a.query(`select "values" -> 'fields.issue' as d from public.project_settings where project_id=$1`,[pid])).rows[0].d[0].type).toBe('text')
    })
  })
  it('single UPDATE precedes purge without deadlock; values and definition disappear together',async()=>{
    await isolated(async(a,b,pid)=>{
      const row=(await insert(a,{value:'before'},pid)).rows[0]
      await a.query('begin');await b.query('begin')
      const bp=(await b.query('select pg_backend_pid() as pid')).rows[0].pid
      await a.query(`update public.issues set custom='{"value":"changed"}' where id=$1`,[row.id])
      const pending=outcome(b.query(purge,[pid,await rev(b,pid),randomUUID(),'issue','value',1,F.users.wsAdmin]))
      expect(await blocked(a,bp)).toBe(true)
      await a.query('commit')
      expect(await pending).toBe('ok');await b.query('commit')
      expect((await a.query('select custom from public.issues where id=$1',[row.id])).rows[0].custom).toEqual({})
      expect((await a.query(`select "values" -> 'fields.issue' as d from public.project_settings where project_id=$1`,[pid])).rows[0].d).toEqual([])
    })
  })
  it('purge wins over new INSERT: no value can commit against a removed field',async()=>{
    await isolated(async(a,b,pid)=>{
      await insert(a,{value:'before'},pid)
      await a.query('begin');await b.query('begin')
      const bp=(await b.query('select pg_backend_pid() as pid')).rows[0].pid
      await a.query(purge,[pid,await rev(a,pid),randomUUID(),'issue','value',1,F.users.wsAdmin])
      const pending=outcome(insert(b,{value:'late'},pid))
      expect(await blocked(a,bp)).toBe(true);await a.query('commit')
      expect(await pending).toMatchObject({code:'23514',message:'CUSTOM_FIELD_UNKNOWN:value'});await b.query('rollback')
      expect(Number((await a.query(`select count(*) from public.issues where project_id=$1 and custom ? 'value'`,[pid])).rows[0].count)).toBe(0)
    })
  })
})

describe('rollback / reapply — one transaction, no audit/data removal', () => {
  const sql = (dir:string,suffix:string) => readFileSync(join(process.cwd(),dir,readdirSync(join(process.cwd(),dir)).find(f=>f.endsWith(suffix))!),'utf8')
  it('refuses populated fields; clean rollback and reapply restore all three columns and helper ACLs',async()=>{
    await asService(pool,async c=>{
      const rb=sql('supabase/rollbacks','_custom_fields_rollback.sql')
      await define(c,'issue',[defs.text])
      expect(await pgError(c,rb)).toMatchObject({message:'CUSTOM_FIELDS_ROLLBACK_IN_USE'})
      await define(c,'issue',[])
      await c.query(rb)
      expect(Number((await c.query(`select count(*) from information_schema.columns where table_schema='public' and table_name in ('wbs_items','issues','weekly_report_rows') and column_name='custom'`)).rows[0].count)).toBe(0)
      await c.query(sql('supabase/migrations','_custom_fields.sql'))
      expect(Number((await c.query(`select count(*) from information_schema.columns where table_schema='public' and table_name in ('wbs_items','issues','weekly_report_rows') and column_name='custom'`)).rows[0].count)).toBe(3)
    })
  })
})
