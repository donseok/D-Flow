import { beforeEach, describe, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({guard:vi.fn(),mod:vi.fn(),rpc:vi.fn(),from:vi.fn(),range:vi.fn(),revalidate:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:h.revalidate}))
vi.mock('@/lib/authz',()=>({requireProjectAdmin:h.guard}))
vi.mock('@/lib/modules/gate',()=>({requireModule:h.mod}))
vi.mock('@/lib/supabase/adminFor',()=>({adminFor:()=>({admin:{rpc:h.rpc,from:h.from}})}))
import { backfillCustomField, getCustomFieldUsage, purgeCustomField } from '@/app/actions/customFields'
import type { FieldEntity } from '@/lib/domain/customFields'
const P='00000000-0000-0000-7e57-000000001432'
const input={expectedRevision:4,commandId:'00000000-0000-0000-7e57-000000001431',key:'quantity'}
beforeEach(()=>{
  vi.clearAllMocks();h.guard.mockResolvedValue({ok:true,actor:{userId:'guard-actor'}});h.mod.mockResolvedValue({ok:true})
  h.rpc.mockResolvedValue({data:{status:'applied',revision:5,count:2},error:null})
  const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),gt:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),then:(resolve: (v: unknown)=>unknown,reject: (e: unknown)=>unknown)=>h.range().then(resolve,reject)}
  h.from.mockReturnValue(q);h.range.mockResolvedValue({data:[{id:'1',custom:{quantity:0,constructor:false}},{id:'2',custom:{quantity:1}}],count:2,error:null})
})

describe('field administration gate and actor source',()=>{
  it.each([['wbs_item','wbs'],['issue','issues'],['weekly_row','weekly']] as const)('%s uses its own module before access',async(entity,module)=>{
    h.mod.mockResolvedValue({ok:false,error:'off'})
    expect(await getCustomFieldUsage(P,entity)).toEqual({ok:false,error:'off'})
    expect(await backfillCustomField(P,entity,{...input,value:0})).toMatchObject({ok:false,error:'off'})
    expect(await purgeCustomField(P,entity,{...input,expectedCount:0})).toMatchObject({ok:false,error:'off'})
    expect(h.mod).toHaveBeenCalledWith({projectId:P},module);expect(h.from).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled()
  })
  it('guard denial precedes all module/read/RPC access',async()=>{
    h.guard.mockResolvedValue({ok:false,error:'denied'})
    expect(await getCustomFieldUsage(P,'issue')).toEqual({ok:false,error:'denied'})
    expect(await purgeCustomField(P,'issue',{...input,expectedCount:0})).toMatchObject({ok:false,error:'denied'})
    expect(h.mod).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();expect(h.from).not.toHaveBeenCalled()
  })
  it('guard actor, revision, stable command ID and scope are the only command identity',async()=>{
    expect(await backfillCustomField(P,'weekly_row',{...input,value:0})).toEqual({ok:true,status:'applied',revision:5,count:2})
    expect(h.rpc).toHaveBeenCalledWith('backfill_custom_field',{p_actor:'guard-actor',p_project_id:P,p_entity:'weekly_row',p_expected_revision:4,p_command_id:input.commandId,p_key:'quantity',p_value:0})
    expect(await purgeCustomField(P,'issue',{...input,expectedCount:2})).toMatchObject({ok:true,count:2})
    expect(h.rpc).toHaveBeenCalledWith('purge_custom_field',{p_actor:'guard-actor',p_project_id:P,p_entity:'issue',p_expected_revision:4,p_command_id:input.commandId,p_key:'quantity',p_expected_count:2})
    expect(h.revalidate).toHaveBeenCalledWith(`/p/${P}`,'layout')
  })
  it('invalid entity/command/count/value fail before RPC (including prototype names)',async()=>{
    for(const entity of ['constructor','__proto__','meeting']) expect((await getCustomFieldUsage(P,entity as FieldEntity)).ok).toBe(false)
    for(const patch of [{key:'A'},{expectedRevision:-1},{expectedRevision:Infinity},{commandId:'x'}]) expect((await backfillCustomField(P,'issue',{...input,...patch,value:0})).ok).toBe(false)
    expect((await backfillCustomField(P,'issue',{...input,value:NaN})).ok).toBe(false)
    expect((await purgeCustomField(P,'issue',{...input,expectedCount:-1})).ok).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('field usage previews',()=>{
  it('counts keys without truthiness/prototype errors, scoped by project',async()=>{
    expect(await getCustomFieldUsage(P,'issue')).toEqual({ok:true,usage:{total:2,counts:{quantity:2,constructor:1}}})
    expect(h.from).toHaveBeenCalledWith('issues')
    expect(h.from.mock.results[0].value.eq).toHaveBeenCalledWith('project_id',P)
  })
  it('keyset pagination reads every page; read failure, shape corruption or truncation stays an error',async()=>{
    h.range.mockResolvedValueOnce({data:[{id:'1',custom:{quantity:1}}],count:2,error:null}).mockResolvedValueOnce({data:[{id:'2',custom:{quantity:2}}],count:1,error:null}).mockResolvedValueOnce({data:[],count:0,error:null})
    expect(await getCustomFieldUsage(P,'wbs_item')).toEqual({ok:true,usage:{total:2,counts:{quantity:2}}})
    expect(h.from.mock.results[1].value.gt).toHaveBeenCalledWith('id','1')
    h.range.mockResolvedValueOnce({data:null,count:2,error:{message:'private DB detail'}})
    const error=await getCustomFieldUsage(P,'issue');expect(error.ok).toBe(false);expect(JSON.stringify(error)).not.toContain('private DB detail')
    h.range.mockResolvedValueOnce({data:[{id:'1',custom:null}],count:1,error:null});expect((await getCustomFieldUsage(P,'issue')).ok).toBe(false)
    h.range.mockResolvedValueOnce({data:[],count:3,error:null});expect((await getCustomFieldUsage(P,'issue')).ok).toBe(false)
  })
})

describe('command failures and idempotent retries',()=>{
  it('duplicate is a successful result with original revision/count',async()=>{
    h.rpc.mockResolvedValue({data:{status:'duplicate',revision:5,count:2},error:null})
    expect(await purgeCustomField(P,'issue',{...input,expectedCount:2})).toEqual({ok:true,status:'duplicate',revision:5,count:2})
  })
  it.each([
    ['CUSTOM_FIELD_COUNT_CONFLICT','P0001','CONFIG_STALE',false],['SETTINGS_REVISION_CONFLICT','P0001','CONFIG_CONFLICT',false],
    ['CUSTOM_FIELD_COMMAND_FORBIDDEN','42501','ERR_DENIED',false],['deadlock','40P01','CONFIG_BUSY',true],['timeout','55P03','CONFIG_BUSY',true],
    ['CUSTOM_FIELD_INVALID:quantity:type','23514','CONFIG_INVALID',false],
  ])('maps %s without leaking raw details',async(message,code,expected,retryable)=>{
    h.rpc.mockResolvedValue({data:null,error:{message,code,details:'private'}})
    const r=await purgeCustomField(P,'issue',{...input,expectedCount:2})
    expect(r).toMatchObject({ok:false,code:expected,retryable});expect(JSON.stringify(r)).not.toContain('private')
  })
  it('unknown outcome is retryable with same ID; malformed result is never success',async()=>{
    h.rpc.mockRejectedValueOnce(new Error('private transport detail'))
    expect(await backfillCustomField(P,'issue',{...input,value:0})).toMatchObject({ok:false,code:'CONFIG_UNAVAILABLE',retryable:true})
    h.rpc.mockResolvedValueOnce({data:{status:'applied',revision:5,count:-1},error:null})
    expect(await backfillCustomField(P,'issue',{...input,value:0})).toMatchObject({ok:false,retryable:true})
  })
})
