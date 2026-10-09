// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CustomFieldDraft } from '@/components/fields/CustomFieldDraft'
import type { FieldDef } from '@/lib/domain/customFields'
// 필드 문구는 사전에서 온다(locale prop) — 영어 표를 등록해 영어 글자를 그대로 단언한다
import { registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
registerEn(EN)
;(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true
it('a parent form displays protected stored/default values without presenting an unsaved draft as stored after permission narrowing',()=>{
  const c=document.createElement('div');document.body.append(c);const root=createRoot(c)
  const defs:FieldDef[]=[{key:'approved',label:'Approved',description:'',type:'boolean',required:true,default:false,active:true,editable_by:'admin',show_in_list:false,searchable:false,sort:0}]
  const onChange=vi.fn()
  try{
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{}} base={{}} creating canAdmin={false} disabled={false} locale="en" errors={{}} onChange={onChange} />))
    expect(c.textContent).toContain('No');expect(c.querySelector('select')).toBeNull()
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{approved:true}} base={{approved:false}} creating={false} canAdmin={false} disabled={false} locale="en" errors={{}} onChange={onChange} />))
    expect(c.textContent).toContain('No');expect(c.textContent).not.toContain('Yes');expect(onChange).not.toHaveBeenCalled()
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{approved:true}} base={{approved:false}} creating={false} canAdmin disabled locale="en" errors={{}} onChange={onChange} />))
    expect(c.querySelector('select')!.disabled).toBe(true)
  }finally{act(()=>root.unmount());c.remove()}
})
