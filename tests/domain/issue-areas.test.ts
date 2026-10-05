import { describe, expect, it } from 'vitest'
import { activeIssueAreas, areaLabel, issueAreasOf, ISSUE_AREA_CODE_RE } from '@/lib/domain/issueAreas'
import type { ConfigArea } from '@/lib/settings/projectConfig'
const area = (code: string, sortOrder: number, active = true): ConfigArea => ({ id: code, kind: 'issue_area', code, name: `영역 ${code}`, sortOrder, active, teams: [] })
describe('프로젝트 이슈 영역', () => {
  it('정렬 순서와 코드순으로 읽고 팀 데이터는 제거한다', () => {
    const rows = issueAreasOf([area('B', 2), area('Z', 1, false), area('A', 2)])
    expect(rows.map(r => r.code)).toEqual(['Z', 'A', 'B'])
    expect(rows[0]).not.toHaveProperty('teams')
    expect(activeIssueAreas(rows).map(r => r.code)).toEqual(['A', 'B'])
  })
  it.each(['RND', '00', 'A1B2C3D4'])('허용 코드 %s', code => expect(ISSUE_AREA_CODE_RE.test(code)).toBe(true))
  it.each(['rnd', 'R&D', 'ABCDEFGHI', ''])('거부 코드 %s', code => expect(ISSUE_AREA_CODE_RE.test(code)).toBe(false))
  it('코드·이름 라벨과 누락 라벨', () => {
    expect(areaLabel(issueAreasOf([area('RND', 1)])[0], null)).toBe('RND · 영역 RND')
    expect(areaLabel(undefined, 'unknown')).toBe('알 수 없는 영역')
    expect(areaLabel(undefined, null)).toBe('미분류')
  })
})
