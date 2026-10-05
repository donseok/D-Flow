import { describe, expect, it } from 'vitest'
import { hasCustomFieldReindexChange, type FieldDef } from '@/lib/domain/customFields'

const baseField = (over: Partial<FieldDef> = {}): FieldDef => ({
  key: 'cf_test',
  label: '테스트 필드',
  description: '설명',
  type: 'text',
  required: false,
  editable_by: 'member',
  show_in_list: true,
  searchable: true,
  sort: 1,
  active: true,
  ...over,
})

describe('hasCustomFieldReindexChange (SP5c §3.6.6 reindexOn: label, searchable, options.label)', () => {
  it('빈 목록끼리 비교 시 false', () => {
    expect(hasCustomFieldReindexChange([], [])).toBe(false)
  })

  it('동일한 정의 비교 시 false', () => {
    const defs = [baseField()]
    expect(hasCustomFieldReindexChange(defs, defs)).toBe(false)
  })

  it('비색인(searchable: false) 필드의 추가는 false', () => {
    const f = baseField({ searchable: false })
    expect(hasCustomFieldReindexChange([], [f])).toBe(false)
  })

  it('비활성(active: false) 색인 필드의 추가는 false', () => {
    const f = baseField({ active: false, searchable: true })
    expect(hasCustomFieldReindexChange([], [f])).toBe(false)
  })

  it('활성 색인(searchable: true) 필드의 추가는 true', () => {
    const f = baseField({ active: true, searchable: true })
    expect(hasCustomFieldReindexChange([], [f])).toBe(true)
  })

  it('활성 색인 필드의 삭제는 true', () => {
    const f = baseField({ active: true, searchable: true })
    expect(hasCustomFieldReindexChange([f], [])).toBe(true)
  })

  it('비색인 필드의 삭제는 false', () => {
    const f = baseField({ active: true, searchable: false })
    expect(hasCustomFieldReindexChange([f], [])).toBe(false)
  })

  it('searchable 플래그 변경(false -> true)은 true', () => {
    const prev = [baseField({ searchable: false })]
    const next = [baseField({ searchable: true })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(true)
  })

  it('searchable 플래그 변경(true -> false)은 true', () => {
    const prev = [baseField({ searchable: true })]
    const next = [baseField({ searchable: false })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(true)
  })

  it('활성 색인 필드의 active 토글은 true', () => {
    const prev = [baseField({ active: true, searchable: true })]
    const next = [baseField({ active: false, searchable: true })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(true)
  })

  it('비색인 필드의 active 토글은 false', () => {
    const prev = [baseField({ active: true, searchable: false })]
    const next = [baseField({ active: false, searchable: false })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(false)
  })

  it('활성 색인 필드의 label 변경은 true', () => {
    const prev = [baseField({ label: '기존 라벨', searchable: true })]
    const next = [baseField({ label: '새 라벨', searchable: true })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(true)
  })

  it('비색인 필드의 label 변경은 false', () => {
    const prev = [baseField({ label: '기존 라벨', searchable: false })]
    const next = [baseField({ label: '새 라벨', searchable: false })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(false)
  })

  it('색인 필드의 설명/필수/권한/목록표시/정렬 변경은 false (reindexOn 대상 아님)', () => {
    const prev = [baseField({ description: '구설명', required: false, editable_by: 'member', show_in_list: false, sort: 1 })]
    const next = [baseField({ description: '신설명', required: true, editable_by: 'admin', show_in_list: true, sort: 2 })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(false)
  })

  it('활성 색인 select 필드의 옵션 label 변경은 true', () => {
    const prev = [baseField({
      type: 'select',
      searchable: true,
      options: [{ code: 'opt1', label: '옵션 1', sort: 1, active: true }],
    })]
    const next = [baseField({
      type: 'select',
      searchable: true,
      options: [{ code: 'opt1', label: '변경된 옵션 1', sort: 1, active: true }],
    })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(true)
  })

  it('비색인 select 필드의 옵션 label 변경은 false', () => {
    const prev = [baseField({
      type: 'select',
      searchable: false,
      options: [{ code: 'opt1', label: '옵션 1', sort: 1, active: true }],
    })]
    const next = [baseField({
      type: 'select',
      searchable: false,
      options: [{ code: 'opt1', label: '변경된 옵션 1', sort: 1, active: true }],
    })]
    expect(hasCustomFieldReindexChange(prev, next)).toBe(false)
  })
})
