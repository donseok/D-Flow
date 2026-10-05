import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { asService, asUser, F, loadFixture, openPool, pgError } from './harness'
let pool:Pool
beforeAll(async()=>{pool=openPool();await loadFixture(pool)})
afterAll(async()=>{await pool?.end()})
const root=`ws/${F.ws}/p/${F.projects.a}`
const def={key:'shared_key',label:'Shared',description:'',type:'text',required:false,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:0}
describe('form storage and reference guards',()=>{
  it('form incoming and version paths are distinct from frozen attachment paths',async()=>{
    await asService(pool,async c=>{
      for(const [path,incoming,expected] of [
        [`${root}/weekly_report_pptx/incoming/${randomUUID()}.pptx`,true,F.projects.a],
        [`${root}/wbs_export_xlsx/v12.xlsx`,false,F.projects.a],
        [`${root}/wbs_export_xlsx/v12.xlsx`,true,null],
        [`${root}/wbs_export_xlsx/incoming/${randomUUID()}.pptx`,true,null],
        [`${root}/unknown/incoming/${randomUUID()}.pptx`,true,null],
        [`${root}/weekly_report_pptx/incoming/not-a-uuid.pptx`,true,null],
        [`${root}/weekly_report_pptx/incoming/${randomUUID()}.pptx/extra`,true,null],
      ] as const){
        expect((await c.query('select public.form_template_path_project($1,$2) as p',[path,incoming])).rows[0].p).toBe(expected)
        expect((await c.query('select public.storage_project($1) as p',[path])).rows[0].p).toBeNull()
      }
    })
  })
  it('reference protection follows the field entity and only active templates',async()=>{
    await asService(pool,async c=>{
      await c.query(`update public.project_settings set "values"="values" || jsonb_build_object(
        'fields.issue',$2::jsonb,'fields.wbs_item',$2::jsonb) where project_id=$1`,[F.projects.a,JSON.stringify([def])])
      const id=randomUUID()
      await c.query(`insert into public.form_templates(id,project_id,form_kind,file_name,storage_path,size_bytes,version,placeholders,active)
        values($1,$2,'issue_analysis_pptx','f.pptx',$3,100,1,$4::jsonb,true)`,[id,F.projects.a,`${root}/issue_analysis_pptx/v1.pptx`,JSON.stringify({placeholders:[{path:'.custom.shared_key'}]})])
      await c.query(`update public.project_settings set "values"="values" || jsonb_build_object('forms.issue_analysis_pptx',
        jsonb_build_object('template_id',$2::text,'mapping',jsonb_build_object('field','.custom.shared_key'))) where project_id=$1`,[F.projects.a,id])
      const remove=async(entity:string)=>{
        const revision=Number((await c.query('select revision from public.project_settings where project_id=$1',[F.projects.a])).rows[0].revision)
        return pgError(c,`select public.apply_project_settings($1,$2,gen_random_uuid(),$3::jsonb,'{}'::text[],$4,1,'edit')`,
          [F.projects.a,revision,JSON.stringify({['fields.'+entity]:[]}),F.users.member])
      }
      expect(await remove('issue')).toMatchObject({code:'23514',message:'FORM_MAPPING_IN_USE'})
      expect(await remove('wbs_item')).toBeNull()
      await c.query('update public.form_templates set active=false where id=$1',[id])
      expect(await remove('issue')).toBeNull()
    })
  })
  it('an ordinary session cannot call the definer reference probe',async()=>{
    await asUser(pool,F.users.member,async c=>{
      expect(await pgError(c,'select public.form_template_key_in_use($1,$2,$3)',[F.projects.a,'issue','shared_key']))
        .toMatchObject({code:'42501'})
    })
  })
})
