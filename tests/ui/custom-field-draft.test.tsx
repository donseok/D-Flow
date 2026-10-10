// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CustomFieldDraft } from '@/components/fields/CustomFieldDraft'
import type { FieldDef } from '@/lib/domain/customFields'
;(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true
it('a parent form displays protected stored/default values without presenting an unsaved draft as stored after permission narrowing',()=>{
  const c=document.createElement('div');document.body.append(c);const root=createRoot(c)
  const defs:FieldDef[]=[{key:'approved',label:'Approved',description:'',type:'boolean',required:true,default:false,active:true,editable_by:'admin',show_in_list:false,searchable:false,sort:0}]
  const onChange=vi.fn()
  try{
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{}} base={{}} creating canAdmin={false} disabled={false} locale="ko" errors={{}} onChange={onChange} />))
    expect(c.textContent).toContain('아니오');expect(c.querySelector('select')).toBeNull()
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{approved:true}} base={{approved:false}} creating={false} canAdmin={false} disabled={false} locale="ko" errors={{}} onChange={onChange} />))
    expect(c.textContent).toContain('아니오');expect(c.textContent).not.toContain('예');expect(onChange).not.toHaveBeenCalled()
    act(()=>root.render(<CustomFieldDraft defs={defs} values={{approved:true}} base={{approved:false}} creating={false} canAdmin disabled locale="ko" errors={{}} onChange={onChange} />))
    expect(c.querySelector('select')!.disabled).toBe(true)
  }finally{act(()=>root.unmount());c.remove()}
})
