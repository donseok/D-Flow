import { describe, expect, it } from 'vitest'
import { parseWbsTsv, previewWbsPaste } from '@/lib/domain/wbsPaste'
import type { WbsBulkSnapshotRow } from '@/app/actions/wbsBulk'

const rows = ['first', 'second'].map(id => ({ id, name: id, updatedAt: '2026-10-05T00:00:00Z' })) as WbsBulkSnapshotRow[]
describe('WBS 붙여넣기 범위와 미리보기', () => {
  it('인용된 탭·줄바꿈·따옴표와 Excel 마지막 줄바꿈을 보존한다', () => {
    expect(parseWbsTsv('"보고\t서"\t"줄1\n줄2 ""인용"""\r\n다음\t값\r\n')).toEqual([['보고\t서', '줄1\n줄2 "인용"'], ['다음', '값']])
  })
  it('보이는 행 순서와 서버 revision을 고정하고 빈 셀만 clear 한다', () => {
    const preview = previewWbsPaste('산출물\t\n다음\t2026-10-06', rows, ['deliverable', 'plannedStart'])
    expect(preview[0]).toMatchObject({ target: { id: 'first', updatedAt: rows[0].updatedAt }, changes: { deliverable: { mode: 'set', value: '산출물' }, plannedStart: { mode: 'clear' } } })
    expect(preview[1].target.id).toBe('second')
  })
  it('숨긴 열/필터 밖 행을 자동 확장하지 않는다', () => {
    expect(() => previewWbsPaste('1\t2', rows, ['deliverable'])).toThrow('열 범위')
    expect(() => previewWbsPaste('1\n2\n3', rows, ['deliverable'])).toThrow('행 범위')
  })
  it('닫히지 않은 인용과 과도한 배치를 거부하고 빈 입력은 저장하지 않는다', () => {
    expect(() => parseWbsTsv('"열림')).toThrow('인용')
    expect(() => previewWbsPaste('x'.repeat(200001), rows, ['deliverable'])).toThrow('너무 큽니다')
    expect(previewWbsPaste('', rows, ['deliverable'])).toEqual([])
  })
})
