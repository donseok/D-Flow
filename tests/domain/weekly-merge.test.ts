// 실시간 병합(스펙 §4.1.7, D32·D44) — 표시 집합은 페이지를 읽을 때 정해지고, 같은 화면 안에서는 빼지 않는다.
// 모르는 영역의 INSERT(관리자가 방금 영역을 더해 RPC 가 이번 주 문서에 행을 넣은 경우)는 그리지 않고 새로고침을 알린다.
import { describe, expect, it } from 'vitest'
import {
  applyServerRow, areaGroupOf, mergeRefreshedRows, mergeServerRow, type WeeklyArea, type WeeklyAreaRow,
} from '@/lib/domain/weeklySheet'

const area = (id: string, name: string, sortOrder: number, active = true): WeeklyArea =>
  ({ id, code: id.toUpperCase(), name, sortOrder, active, teams: [] })
const AREAS: WeeklyArea[] = [
  area('a-exp', '실험', 1), area('a-data', '데이터', 2), area('a-ops', '운영', 3), area('a-old', '구 영역', 0, false),
]
const row = (id: string, areaId: string, over: Partial<WeeklyAreaRow> = {}): WeeklyAreaRow => ({
  id, reportId: 'rep', areaId, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('applyServerRow — 영역 행에서도 dirty 셀만 로컬 값', () => {
  it('dirty 인 칸은 로컬, 나머지 칸과 영역 id 는 서버 값', () => {
    const local = row('r1', 'a-exp', { thisContent: '로컬 입력', nextContent: '로컬 계획' })
    const server = row('r1', 'a-exp', { thisContent: '서버 값', nextContent: '서버 계획', thisIssue: '서버 이슈' })
    expect(applyServerRow(local, server, new Set(['r1:this_content']))).toEqual({
      ...server, thisContent: '로컬 입력',
    })
    expect(applyServerRow(local, server, new Set())).toEqual(server)
  })
})

describe('mergeServerRow — 실시간 병합(D32·D44)', () => {
  const shown = [row('r-exp', 'a-exp'), row('r-ops', 'a-ops'), row('r-old', 'a-old', { thisContent: '남은 내용' })]

  it('있는 행은 자리를 지키고 dirty 칸만 로컬 값이다', () => {
    const local = [...shown]
    local[0] = row('r-exp', 'a-exp', { thisContent: '입력 중' })
    const out = mergeServerRow(local, row('r-exp', 'a-exp', { thisContent: '서버', thisIssue: '이슈' }), AREAS, new Set(['r-exp:this_content']))
    expect(out.refresh).toBe(false)
    expect(out.rows.map(r => r.id)).toEqual(['r-exp', 'r-ops', 'r-old'])
    expect(out.rows[0]).toMatchObject({ thisContent: '입력 중', thisIssue: '이슈' })
  })

  it('비활성 영역 행의 마지막 칸이 비어도 그 화면에서 행이 남는다(D32 — 다음에 페이지를 읽을 때 숨긴다)', () => {
    const out = mergeServerRow(shown, row('r-old', 'a-old'), AREAS, new Set())
    expect(out.refresh).toBe(false)
    expect(out.rows.map(r => r.id)).toEqual(['r-exp', 'r-ops', 'r-old'])
    expect(out.rows[2].thisContent).toBe('')
  })

  it('[RF2] 모르는 area_id 의 INSERT 는 행을 더하지 않고 refresh 를 알린다(D44)', () => {
    const out = mergeServerRow(shown, row('r-new', 'a-new'), AREAS, new Set())
    expect(out.refresh).toBe(true)
    expect(out.rows.map(r => r.id)).toEqual(['r-exp', 'r-ops', 'r-old'])
  })

  it('아는 활성 영역의 INSERT 는 영역 순서 자리에 끼운다(활성 → 비활성 순)', () => {
    const out = mergeServerRow(shown, row('r-data', 'a-data'), AREAS, new Set())
    expect(out.refresh).toBe(false)
    expect(out.rows.map(r => r.id)).toEqual(['r-exp', 'r-data', 'r-ops', 'r-old'])
  })

  it('화면에 없는 행이 비활성으로 아는 영역의 빈 행이면 끼우지 않고 refresh — RPC 는 활성 영역에만 행을 넣으므로 그 영역은 재활성됐다', () => {
    const out = mergeServerRow([row('r-exp', 'a-exp')], row('r-old', 'a-old'), AREAS, new Set())
    expect(out).toEqual({ rows: [row('r-exp', 'a-exp')], refresh: true })
  })

  it('내용 있는 비활성 영역의 INSERT 는 활성 영역 뒤에 끼운다', () => {
    const out = mergeServerRow([row('r-exp', 'a-exp'), row('r-ops', 'a-ops')], row('r-old', 'a-old', { nextIssue: '메모' }), AREAS, new Set())
    expect(out.rows.map(r => r.id)).toEqual(['r-exp', 'r-ops', 'r-old'])
  })

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [row('r-exp', 'a-exp')]
    const copy = structuredClone(input)
    mergeServerRow(input, row('r-data', 'a-data'), AREAS, new Set())
    mergeServerRow(input, row('r-exp', 'a-exp', { thisContent: 'x' }), AREAS, new Set())
    expect(input).toEqual(copy)
  })
})

describe('mergeRefreshedRows — 새로고침(router.refresh) 반영도 같은 문서에서는 행을 빼지 않는다(D32)', () => {
  it('페이지가 다시 정한 집합·순서를 따르고 dirty 칸만 로컬이다(영역 순서가 바뀌면 화면도 바뀐다)', () => {
    const local = [row('r-exp', 'a-exp', { thisContent: '입력 중' }), row('r-ops', 'a-ops')]
    const server = [row('r-ops', 'a-ops', { thisIssue: '서버 이슈' }), row('r-exp', 'a-exp', { thisContent: '서버', nextIssue: '행사' })]
    const reordered = AREAS.map(a => (a.id === 'a-ops' ? { ...a, sortOrder: 0 } : a))
    const out = mergeRefreshedRows(local, server, reordered, new Set(['r-exp:this_content']))
    expect(out.map(r => r.id)).toEqual(['r-ops', 'r-exp'])
    expect(out[0].thisIssue).toBe('서버 이슈')
    expect(out[1]).toMatchObject({ thisContent: '입력 중', nextIssue: '행사' })
  })

  it('새 영역의 행(D44 의 새로고침이 받아 온 것)이 그 자리에 들어온다', () => {
    const areas = [...AREAS, area('a-new', '신규', 2.5)]
    const out = mergeRefreshedRows(
      [row('r-exp', 'a-exp'), row('r-ops', 'a-ops')],
      [row('r-exp', 'a-exp'), row('r-new', 'a-new'), row('r-ops', 'a-ops')], areas, new Set())
    expect(out.map(r => r.id)).toEqual(['r-exp', 'r-new', 'r-ops'])
  })

  it('지금 보이는데 다시 정한 집합에 없는 행(그새 마지막 칸이 빈 비활성 영역 행)은 영역 순서 자리에 남는다', () => {
    const local = [row('r-exp', 'a-exp'), row('r-ops', 'a-ops'), row('r-old', 'a-old')]
    const out = mergeRefreshedRows(local, [row('r-exp', 'a-exp'), row('r-data', 'a-data'), row('r-ops', 'a-ops')], AREAS, new Set())
    expect(out.map(r => r.id)).toEqual(['r-exp', 'r-data', 'r-ops', 'r-old'])
  })

  it('local 이 비면(문서가 바뀌었다 — 호출부가 [] 를 넘긴다) 받은 집합 그대로다', () => {
    const server = [row('r-exp', 'a-exp'), row('r-ops', 'a-ops')]
    expect(mergeRefreshedRows([], server, AREAS, new Set(['r-exp:this_content']))).toEqual(server)
  })

  it('입력 배열을 바꾸지 않는다', () => {
    const local = [row('r-old', 'a-old'), row('r-exp', 'a-exp')]
    const server = [row('r-exp', 'a-exp', { thisContent: 'x' })]
    const copies = [structuredClone(local), structuredClone(server)]
    mergeRefreshedRows(local, server, AREAS, new Set())
    expect([local, server]).toEqual(copies)
  })
})

describe('areaGroupOf — 점검 묶음 키 = 영역 id, 라벨 = 행 라벨(D22)', () => {
  it('활성 영역은 이름, 비활성 영역은 비활성 표지, 모르는 영역은 알 수 없는 영역', () => {
    const groupOf = areaGroupOf(AREAS)
    expect(groupOf(row('r1', 'a-exp'))).toEqual({ key: 'a-exp', label: '실험' })
    expect(groupOf(row('r2', 'a-old'))).toEqual({ key: 'a-old', label: '구 영역 (비활성)' })
    expect(groupOf(row('r3', 'a-new'))).toEqual({ key: 'a-new', label: '알 수 없는 영역' })
  })
  it('개명해도 키는 같다 — 라벨만 바뀐다(W14)', () => {
    const renamed = AREAS.map(a => (a.id === 'a-exp' ? { ...a, name: '실험·검증' } : a))
    expect(areaGroupOf(renamed)(row('r1', 'a-exp'))).toEqual({ key: 'a-exp', label: '실험·검증' })
  })
})
