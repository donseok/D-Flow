import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const call = 'select public.create_project_with_settings($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb) as r'
const oldCall = 'select public.create_project_with_settings($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) as r'
const receipt = 'select public.get_project_creation_receipt($1,$2,$3,$4::jsonb) as r'
const options = { max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)' }
async function seed(c: PoolClient) {
  const id = randomUUID(), destination = randomUUID(), command = randomUUID()
  const path = `ws/${F.ws}/p/${F.projects.a}/weekly_report_pptx/v1.pptx`
  const target = `ws/${F.ws}/p/${destination}/weekly_report_pptx/v1.pptx`
  const scan = { engineVersion: 'forms-engine.v1', format: 'pptx', placeholders: [], issues: [] }
  await c.query(`insert into public.form_templates(id,project_id,form_kind,file_name,storage_path,size_bytes,version,placeholders,active)
    values($1,$2,'weekly_report_pptx','검증.pptx',$3,100,1,$4::jsonb,true)`, [id,F.projects.a,path,JSON.stringify(scan)])
  const values = { 'core.level_labels': ['단계','작업'], 'modules.enabled': [], 'forms.weekly_report_pptx': { template_id:id,mapping:{},options } }
  await c.query('update public.project_settings set "values"="values" || $2::jsonb where project_id=$1',[F.projects.a,JSON.stringify(values)])
  const revision = Number((await c.query('select revision from public.project_settings where project_id=$1',[F.projects.a])).rows[0].revision)
  const manifest = (await c.query(`select id,form_kind,storage_path,size_bytes,version,placeholders,file_name from public.form_templates
    where project_id=$1 and active order by id`,[F.projects.a])).rows
  const request = { name:'양식 복사 검증',start_date:null,end_date:null,description:null,values,copy_from:F.projects.a }
  const args = [F.ws,request.name,null,null,null,JSON.stringify(values),F.projects.a,F.users.wsAdmin,command,1,destination,revision,JSON.stringify(manifest)]
  return {id,destination,command,target,scan,values,manifest,args,request}
}
async function object(c: PoolClient, path: string, size=100) {
  await c.query(`insert into storage.objects(bucket_id,name,metadata) values('form-templates',$1,jsonb_build_object('size',$2::int))`,[path,size])
}

describe('프로젝트 양식 실파일 복사 계약', () => {
  it('미리 복사한 파일·v1 메타·설정·이력과 행위자를 한 번에 연결하고 inactive 버전은 제외한다',async()=>{
    await asService(pool,async c=>{
      const s=await seed(c)
      await object(c,s.target)
      const r=(await c.query(call,s.args)).rows[0].r
      expect(r).toMatchObject({status:'applied',project_id:s.destination})
      const rows=(await c.query('select * from public.form_templates where project_id=$1',[s.destination])).rows
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({form_kind:'weekly_report_pptx',storage_path:s.target,version:1,active:true,uploaded_by:F.users.wsAdmin,placeholders:s.scan})
      expect(rows[0].id).not.toBe(s.id)
      const value=(await c.query('select "values" from public.project_settings where project_id=$1',[s.destination])).rows[0].values['forms.weekly_report_pptx']
      expect(value).toEqual({...s.values['forms.weekly_report_pptx'],template_id:rows[0].id})
      expect((await c.query("select new_value from public.project_settings_history where project_id=$1 and key='forms.weekly_report_pptx'",[s.destination])).rows[0].new_value).toEqual(value)
      const duplicate=[...s.args];duplicate[10]=randomUUID()
      expect((await c.query(call,duplicate)).rows[0].r).toMatchObject({status:'duplicate',project_id:s.destination})
      expect((await c.query(receipt,[F.ws,F.users.wsAdmin,s.command,JSON.stringify(s.request)])).rows[0].r).toMatchObject({status:'duplicate',project_id:s.destination})
      expect(await pgError(c,receipt,[F.ws,F.users.wsAdmin,s.command,JSON.stringify({...s.request,name:'다른 요청'})])).toMatchObject({code:'23505',message:'COMMAND_REUSED'})
    })
  })
  it('파일 없음·잘못된 파일 크기는 생성·이력·메타를 남기지 않는다',async()=>{
    await asService(pool,async c=>{
      const s=await seed(c)
      expect(await pgError(c,call,s.args)).toMatchObject({code:'22023',message:'FORM_TEMPLATE_COPY_MISSING'})
      await object(c,s.target,99)
      expect(await pgError(c,call,s.args)).toMatchObject({message:'FORM_TEMPLATE_COPY_MISSING'})
      expect((await c.query('select 1 from public.projects where id=$1',[s.destination])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.project_settings_history where command_id=$1',[s.command])).rowCount).toBe(0)
    })
  })
  it('설정 revision 또는 활성 양식 스냅샷이 바뀌면 복사를 확정하지 않는다',async()=>{
    await asService(pool,async c=>{
      const s=await seed(c);await object(c,s.target)
      const revision=[...s.args];revision[11]=Number(s.args[11])+1
      expect(await pgError(c,call,revision)).toMatchObject({code:'40001',message:'FORM_TEMPLATE_COPY_CHANGED'})
      const manifest=[...s.args];manifest[12]='[]'
      expect(await pgError(c,call,manifest)).toMatchObject({code:'40001',message:'FORM_TEMPLATE_COPY_CHANGED'})
      await c.query('update public.form_templates set active=false where id=$1',[s.id])
      expect(await pgError(c,call,s.args)).toMatchObject({message:'FORM_TEMPLATE_COPY_CHANGED'})
    })
  })
  it('권한 밖·교차 워크스페이스·세션 실행은 닫고 영수증도 같은 범위로 제한한다',async()=>{
    await asService(pool,async c=>{
      const s=await seed(c);const actor=[...s.args];actor[7]=F.users.member
      expect(await pgError(c,call,actor)).toMatchObject({code:'42501'})
      const other=[...s.args];other[0]=F.wsB
      expect(await pgError(c,call,other)).toMatchObject({code:'42501'})
      expect(await pgError(c,receipt,[F.ws,F.users.member,s.command,JSON.stringify(s.request)])).toMatchObject({code:'42501'})
    })
    await asUser(pool,F.users.wsAdmin,async c=>{
      expect(await pgError(c,receipt,[F.ws,F.users.wsAdmin,randomUUID(),'{}'])).toMatchObject({code:'42501'})
      expect((await c.query("select has_function_privilege(current_user,'public.create_project_with_settings(uuid,text,date,date,text,jsonb,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','EXECUTE') as allowed")).rows[0].allowed).toBe(false)
    })
  })
  it('기존 생성 API는 활성 양식의 메타만 복사하는 호출을 거부하고 롤백은 API를 복원한다',async()=>{
    await asService(pool,async c=>{
      const s=await seed(c)
      expect(await pgError(c,oldCall,s.args.slice(0,10))).toMatchObject({message:'FORM_TEMPLATE_COPY_REQUIRED'})
      const name=readdirSync('supabase/rollbacks').find(n=>n.endsWith('_project_form_file_copy_rollback.sql'))!
      await c.query(readFileSync(join('supabase/rollbacks',name),'utf8'))
      expect((await c.query(oldCall,s.args.slice(0,10))).rows[0].r.status).toBe('applied')
      expect((await c.query("select to_regprocedure('public.get_project_creation_receipt(uuid,uuid,uuid,jsonb)') as fn")).rows[0].fn).toBeNull()
    })
  })
})
