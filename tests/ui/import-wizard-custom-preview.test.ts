import { describe, expect, it } from 'vitest'
// 가져오기 마법사 미리보기의 사용자 정의 필드 열 표시(개정 §3.6.7) — 제안된(또는 저장 양식의) customColumns 가 열 역할로 보인다.
import { deriveMappedPreview } from '@/lib/domain/importWizard'
import type { ExcelProfile } from '@/lib/excel/profile'

const PROFILE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 3, start: null, end: null, weight: null, actualPct: null },
  teamColumns: [[2, 'RES']], ownerMarks: { '●': 'primary' },
  customColumns: [[4, 'qty'], [5, 'result']],
}
const HEADERS = ['Phase', 'Activity', 'RES', '산출물', '검측 수량', 'result', '메모']

describe('deriveMappedPreview — 사용자 정의 필드 열', () => {
  it('customColumns 의 열은 custom 역할(필드 key)로, 매핑 없는 열은 역할 없음으로 보인다', () => {
    const { columns } = deriveMappedPreview(HEADERS, [['1', '', '●', '', 12.5, 'pass', 'x']], PROFILE)
    expect(columns.map(c => c.role)).toEqual([
      { kind: 'hierarchy' }, { kind: 'hierarchy' }, { kind: 'team', team: 'RES' }, { kind: 'logical', field: 'deliverable' },
      { kind: 'custom', key: 'qty' }, { kind: 'custom', key: 'result' }, null,
    ])
  })

  it('customColumns 가 없는 옛 양식은 종전과 같다', () => {
    const { customColumns: _drop, ...legacy } = PROFILE
    void _drop
    expect(deriveMappedPreview(HEADERS, [], legacy).columns.filter(c => c.role?.kind === 'custom')).toEqual([])
  })

  it('편집 중 한 열이 겹치면 계층·논리·팀이 먼저다', () => {
    const overlapped = { ...PROFILE, customColumns: [[3, 'qty'], [2, 'result'], [0, 'x']] as [number, string][] }
    expect(deriveMappedPreview(HEADERS, [], overlapped).columns.slice(0, 4).map(c => c.role?.kind)).toEqual(['hierarchy', 'hierarchy', 'team', 'logical'])
  })
})
