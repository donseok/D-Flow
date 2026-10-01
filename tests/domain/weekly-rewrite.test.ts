import { describe, expect, it } from 'vitest'
import {
  buildWeeklyRewriteSelection, prepareApplicableWeeklyRewriteEdits,
  type WeeklyRewriteCandidate,
} from '@/lib/domain/weeklyRewrite'
import { rowLabel, type WeeklyAreaRow } from '@/lib/domain/weeklySheet'

const A_EXP = '00000000-0000-0000-7e57-0000000018d1'
const A_DATA = '00000000-0000-0000-7e57-0000000018d2'
const AREAS = [{ id: A_EXP, name: '실험', active: true }, { id: A_DATA, name: '데이터', active: false }]
const labelOf = (r: WeeklyAreaRow) => rowLabel(r, AREAS)

const row = (id: string, over: Partial<WeeklyAreaRow> = {}): WeeklyAreaRow => ({
  id,
  reportId: 'report-1',
  areaId: id === 'r1' ? A_EXP : A_DATA,
  thisContent: '',
  thisIssue: '',
  nextContent: '',
  nextIssue: '',
  ...over,
})

describe('buildWeeklyRewriteSelection', () => {
  it('선택 범위에서 빈 셀을 제외하고 행 우선 순서를 보존한다 — 라벨은 호출부의 labelOf(영역 이름·비활성 표지)', () => {
    const rows = [
      row('r1', { thisContent: '금주 실험', nextContent: '차주 실험' }),
      row('r2', { thisIssue: '데이터 이슈', nextContent: '   ' }),
    ]
    expect(buildWeeklyRewriteSelection(rows, { top: 0, left: 0, bottom: 1, right: 2 }, labelOf)).toEqual([
      { rowId: 'r1', cellKey: 'this_content', section: '실험', label: '금주실적 내용', original: '금주 실험' },
      { rowId: 'r1', cellKey: 'next_content', section: '실험', label: '차주계획 내용', original: '차주 실험' },
      { rowId: 'r2', cellKey: 'this_issue', section: '데이터 (비활성)', label: '금주 이슈·이벤트', original: '데이터 이슈' },
    ])
  })
})

describe('prepareApplicableWeeklyRewriteEdits', () => {
  const rows = [row('r1', { thisContent: '원문 A', thisIssue: '원문 B' })]
  const candidates: WeeklyRewriteCandidate[] = [
    { rowId: 'r1', cellKey: 'this_content', original: '원문 A', content: '정리한 A' },
    { rowId: 'r1', cellKey: 'this_issue', original: '원문 B', content: '정리한 B' },
  ]

  it('원문이 그대로인 변경만 저장 edit으로 만든다', () => {
    expect(prepareApplicableWeeklyRewriteEdits(rows, candidates)).toEqual({
      ok: true,
      edits: [
        { rowId: 'r1', cellKey: 'this_content', content: '정리한 A' },
        { rowId: 'r1', cellKey: 'this_issue', content: '정리한 B' },
      ],
    })
  })

  it('행 삭제나 동시 수정이 하나라도 있으면 전체 적용을 막는다', () => {
    expect(prepareApplicableWeeklyRewriteEdits([] as WeeklyAreaRow[], candidates)).toEqual({ ok: false })
    expect(prepareApplicableWeeklyRewriteEdits(
      [row('r1', { thisContent: '다른 사용자가 수정', thisIssue: '원문 B' })],
      candidates,
    )).toEqual({ ok: false })
  })

  it('중복 주소는 거부하고 동일·빈 제안은 저장에서 제외한다', () => {
    expect(prepareApplicableWeeklyRewriteEdits(rows, [candidates[0], candidates[0]])).toEqual({ ok: false })
    expect(prepareApplicableWeeklyRewriteEdits(rows, [
      { ...candidates[0], content: '원문 A' },
      { ...candidates[1], content: '   ' },
    ])).toEqual({ ok: true, edits: [] })
  })
})
