import { describe, expect, it } from 'vitest'
import { matchesCustomFieldFilter as match } from '@/lib/domain/customFieldFilter'
import type { FieldDef } from '@/lib/domain/customFields'
const def = (type: FieldDef['type']): FieldDef => ({ key: 'value', label: 'Value', description: '', type, required: false, active: true, editable_by: 'member', show_in_list: true, searchable: false, sort: 0 })
describe('typed custom list filters', () => {
  it('does not collapse zero, false or absent criteria', () => {
    expect(match({value:0},def('number'),0)).toBe(true)
    expect(match({value:1},def('number'),0)).toBe(false)
    expect(match({value:false},def('boolean'),false)).toBe(true)
    expect(match({},def('boolean'),false)).toBe(false)
    expect(match({value:'0'},def('number'),0)).toBe(false)
    expect(match(null,def('number'),undefined)).toBe(true)
  })
  it('text contains without replacing stored values or guessing corrupt rows', () => {
    expect(match({value:'Alpha BETA'},def('text'),'beta')).toBe(true)
    expect(match({value:'beta'},def('text'),'gamma')).toBe(false)
    expect(match(null,def('text'),'beta')).toBe(false)
    expect(match({value:['beta']},def('text'),'beta')).toBe(false)
  })
  it('uses stable option codes and retains historical options for filters', () => {
    const d={...def('select'),options:[{code:'old',label:'Historical',active:false,color:'neutral' as const,sort:0}]}
    expect(match({value:'old'},d,'old')).toBe(true)
    expect(match({value:'old'},d,'Historical')).toBe(false)
    const multi={...d,type:'multiselect' as const,options:[...d.options,{...d.options[0],code:'new',active:true}]}
    expect(match({value:['old','new']},multi,['old'])).toBe(true)
    expect(match({value:['old']},multi,['old','new'])).toBe(false)
  })
  it('dates compare exactly; disabled/removed fields cannot keep a hidden filter', () => {
    expect(match({value:'2026-10-05'},def('date'),'2026-10-05')).toBe(true)
    expect(match({value:'2026-10-04'},def('date'),'2026-10-05')).toBe(false)
    expect(match({},undefined,0)).toBe(true)
    expect(match({},{...def('number'),active:false},0)).toBe(true)
  })
})
