import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldDef } from '@/lib/domain/customFields'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'
import { TEST_ENTRY_CONTEXT } from '../fixtures/issue-areas'
const h=vi.hoisted(()=>({context:vi.fn(),member:vi.fn(),admin:vi.fn(),actor:vi.fn(),mod:vi.fn(),insert:vi.fn(),update:vi.fn(),eq:vi.fn(),adminClient:vi.fn(),tables:[] as string[],
  result:{data:{id:'i1',code:'ISS-001'} as Record<string,unknown>|null,error:null as {code:string;message:string}|null}}))
vi.mock('@/lib/issues/context',()=>({loadIssueEntryContext:h.context}))
vi.mock('@/lib/auth',()=>({getSession:async()=>({id:'me',email:'me@example.com',user_metadata:{}})}))
vi.mock('@/lib/authz',()=>({requireProjectMember:h.member,requireProjectAdmin:h.admin,getActor:h.actor,resolveProjectId:async()=>({ok:true,projectId:'p1'})}))
vi.mock('@/lib/modules/gate',()=>({requireModule:h.mod}))
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:h.adminClient}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:async()=>({from:(table:string)=>{
  h.tables.push(table);let writing=false
  const q={insert:vi.fn((v:unknown)=>{h.insert(v);writing=true;return q}),update:vi.fn((v:unknown)=>{h.update(v);writing=true;return q}),
    delete:()=>q,select:()=>q,eq:vi.fn((key:string,v:unknown)=>{h.eq(key,v);return q}),
    single:async()=>h.result,maybeSingle:async()=>writing?h.result:{data:{project_id:'p1',created_by:'me',area_id:null,code_area_id:null,major_id:null,source_type:null,severity:'medium'},error:null},
    then:(resolve:(v:{error:null})=>unknown)=>Promise.resolve({error:null}).then(resolve)}
  return q
}})}))
import { createIssue, updateIssue } from '@/app/actions/issues'
const d=(patch:Partial<FieldDef>={}):FieldDef=>({key:'quantity',label:'Quantity',description:'',type:'number',active:true,required:false,editable_by:'member',show_in_list:false,searchable:false,sort:0,...patch})
const input={title:'Title',body:'Body',severity:'medium' as const,assigneeMemberIds:[],startDate:null,dueDate:null,areaId:null,analysis:null}
beforeEach(()=>{vi.clearAllMocks();h.tables=[];h.result={data:{id:'i1',code:'ISS-001'},error:null};h.member.mockResolvedValue({ok:true,actor:makeMemberActor('p1',[],{userId:'me'})});h.admin.mockResolvedValue({ok:false,error:'denied'});h.actor.mockResolvedValue(makeMemberActor('p1',[],{userId:'me'}));h.mod.mockResolvedValue({ok:true});h.context.mockResolvedValue({ok:true,value:{...TEST_ENTRY_CONTEXT,customFields:[d()]}})})
describe('issue form custom JWT writes',()=>{
  it('creates core/custom together, preserving zero and using no service client',async()=>{
    expect(await createIssue('p1',{...input,custom:{quantity:0}})).toMatchObject({ok:true})
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({title:'Title',custom:{quantity:0}}));expect(h.adminClient).not.toHaveBeenCalled()
  })
  it('leaves required admin defaults to INSERT and refuses explicit member admin values',async()=>{
    h.context.mockResolvedValue({ok:true,value:{...TEST_ENTRY_CONTEXT,customFields:[d({editable_by:'admin',required:true,default:0})]}})
    expect(await createIssue('p1',{...input,custom:{}})).toMatchObject({ok:true})
    h.insert.mockClear();expect(await createIssue('p1',{...input,custom:{quantity:0}})).toMatchObject({ok:false});expect(h.insert).not.toHaveBeenCalled()
  })
  it('uses id, project and full old JSONB for the atomic core/custom update',async()=>{
    expect(await updateIssue('i1',{...input,custom:{quantity:2},expectedCustom:{quantity:0}})).toMatchObject({ok:true})
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({title:'Title',custom:{quantity:2}}));expect(h.eq).toHaveBeenCalledWith('custom','{"quantity":0}');expect(h.eq).toHaveBeenCalledWith('project_id','p1');expect(h.adminClient).not.toHaveBeenCalled()
  })
  it('CAS zero rows reports conflict before changing assignees',async()=>{
    h.result.data=null
    expect(await updateIssue('i1',{...input,custom:{quantity:2},expectedCustom:{quantity:0}})).toMatchObject({ok:false,conflict:true})
    expect(h.tables).not.toContain('issue_assignees')
  })
  it('missing/corrupt base or required removal stops before UPDATE',async()=>{
    expect(await updateIssue('i1',{...input,custom:{quantity:2}})).toMatchObject({ok:false});expect(h.update).not.toHaveBeenCalled()
    h.context.mockResolvedValue({ok:true,value:{...TEST_ENTRY_CONTEXT,customFields:[d({required:true,default:0})]}})
    expect(await updateIssue('i1',{...input,custom:{},expectedCustom:{quantity:0}})).toMatchObject({ok:false});expect(h.update).not.toHaveBeenCalled()
  })
  it('admin authority is rechecked and guard/module failures precede field validation',async()=>{
    h.context.mockResolvedValue({ok:true,value:{...TEST_ENTRY_CONTEXT,customFields:[d({editable_by:'admin'})]}})
    expect(await updateIssue('i1',{...input,custom:{quantity:2},expectedCustom:{quantity:0}})).toMatchObject({ok:false})
    h.admin.mockResolvedValue({ok:true,actor:makeAdminActor('p1',{userId:'me'})})
    expect(await updateIssue('i1',{...input,custom:{quantity:2},expectedCustom:{quantity:0}})).toMatchObject({ok:true})
    h.context.mockClear();h.member.mockResolvedValue({ok:false,error:'denied'})
    expect(await createIssue('p1',{...input,custom:{quantity:2}})).toMatchObject({ok:false});expect(h.context).not.toHaveBeenCalled()
    h.mod.mockResolvedValue({ok:false,error:'off'})
    expect(await updateIssue('i1',{...input,custom:{quantity:2},expectedCustom:{quantity:0}})).toMatchObject({ok:false});expect(h.context).not.toHaveBeenCalled()
  })
})
