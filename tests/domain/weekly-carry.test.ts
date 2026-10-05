// 이월 계약(스펙 §4.1.1 이월 규칙 표, D31·D33·Q37, W12·W13) — 영역 id 로 옮기고, 지금 비활성인 영역의 대기 내용은 명시 매핑으로만,
// 넘치면 거부(자르지 않음). 첫 영역·폴백 흡수·절단·원본 수정은 없다. 합성 구성의 영역만 쓴다.
import { describe, expect, it } from 'vitest'
import type { CustomValues } from '@/lib/domain/customFields'
import { CARRY_SKIP, carryOverRows, defaultWeeklyRows, seedOf, type CarryOverResult } from '@/lib/domain/weeklyCarry'
import { UNKNOWN_AREA_LABEL, orderAreas, type WeeklyArea, type WeeklyCells } from '@/lib/domain/weeklySheet'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const R = SYNTHETIC_WEEKLY_AREAS.research          // 실험(EXP, 1)·데이터(DATA, 2)·운영(RUN, 3) — 모두 활성
const [EXP, DATA, RUN] = R.map((a) => a.id)
const src = (areaId: string, over: Partial<WeeklyCells> = {}) =>
  ({ areaId, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over })
const deactivate = (areas: readonly WeeklyArea[], ...ids: string[]): WeeklyArea[] =>
  areas.map((a) => (ids.includes(a.id) ? { ...a, active: false } : a))
const okRows = (r: CarryOverResult) => { if (!r.ok) throw new Error(`이월 거부: ${JSON.stringify(r)}`); return r.rows }
const rowOf = (r: CarryOverResult, areaId: string) => okRows(r).find((x) => x.areaId === areaId)

describe('carryOverRows — 활성 영역은 자기 자리로(W12)', () => {
  it('[W12 반례] 두 영역의 대기 내용이 각자 자기 영역으로 간다 — 첫 영역·다른 영역으로 흡수되지 않는다', () => {
    const r = carryOverRows([src(RUN, { nextContent: '운영 계획', nextIssue: '운영 이슈' }), src(EXP, { nextContent: '실험 계획' })], R)
    expect(okRows(r)).toEqual([
      { areaId: EXP, thisContent: '실험 계획', thisIssue: '', nextContent: '', nextIssue: '' },
      { areaId: DATA, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' },
      { areaId: RUN, thisContent: '운영 계획', thisIssue: '운영 이슈', nextContent: '', nextIssue: '' },
    ])
  })

  it('원본에 행이 없는 활성 영역은 빈 행 — 오류가 아니다(그 뒤 추가·재활성, 연휴로 건너뛴 주)', () => {
    expect(okRows(carryOverRows([], R))).toEqual(defaultWeeklyRows(R))
    expect(rowOf(carryOverRows([src(EXP, { nextContent: '실험' })], R), DATA))
      .toEqual({ areaId: DATA, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' })
  })

  it('붙이는 값의 앞뒤 공백·개행을 걷는다 — 칸 안 문단의 빈 줄은 남긴다', () => {
    expect(rowOf(carryOverRows([src(EXP, { nextContent: '\n\n  하나\n\n둘  \n' })], R), EXP)?.thisContent).toBe('하나\n\n둘')
  })

  it('같은 영역의 원본 행이 여럿이면(유일 인덱스 이전 데이터) 입력 순으로 잇는다', () => {
    const r = carryOverRows([src(EXP, { nextContent: '둘째' }), src(EXP, { nextContent: '첫째', nextIssue: '이슈' })], R)
    expect(rowOf(r, EXP)).toEqual({ areaId: EXP, thisContent: '둘째\n첫째', thisIssue: '이슈', nextContent: '', nextIssue: '' })
  })

  it('carryCustom 주입 — 활성 같은 영역의 carry_over 필드만 새 행으로 복사된다', () => {
    const prev = [
      { ...src(EXP, { nextContent: '실험' }), custom: { keep: '유지값', drop: '버림값' } },
      { ...src(DATA, {}), custom: { keep: '데이터유지' } },
    ]
    const carryFn = (c: unknown): CustomValues => {
      const rec = (c as CustomValues) ?? {}
      return rec.keep ? { keep: rec.keep } : {}
    }
    const r = carryOverRows(prev, R, {}, carryFn)
    expect(rowOf(r, EXP)?.custom).toEqual({ keep: '유지값' })
    expect(rowOf(r, DATA)?.custom).toEqual({ keep: '데이터유지' })
    expect(rowOf(r, RUN)?.custom).toBeUndefined()
  })
})

describe('carryOverRows — 지금 비활성인 영역의 대기 내용(W13·Q37)', () => {
  it('[W13] 대기 내용 → pending, 매핑이 없으면 전체 거부(행을 돌려주지 않는다)', () => {
    const areas = deactivate(R, RUN)
    const r = carryOverRows([src(EXP, { nextContent: '실험' }), src(RUN, { nextContent: '운영', nextIssue: '이슈' })], areas)
    expect(r).toEqual({ ok: false, pending: [{ areaId: RUN, areaName: '운영', cells: ['nextContent', 'nextIssue'] }], overflow: [] })
  })

  it('[W13] 매핑 → 활성 영역 Y 에 덧붙인다, skip → 옮기지 않는다 — 원본은 바뀌지 않는다', () => {
    const areas = deactivate(R, RUN)
    const prev = [src(EXP, { nextContent: '실험' }), src(RUN, { nextContent: '운영', nextIssue: '이슈' })]
    const before = structuredClone(prev)
    expect(rowOf(carryOverRows(prev, areas, { [RUN]: DATA }), DATA))
      .toEqual({ areaId: DATA, thisContent: '운영', thisIssue: '이슈', nextContent: '', nextIssue: '' })
    expect(okRows(carryOverRows(prev, areas, { [RUN]: CARRY_SKIP })).map((x) => x.thisContent)).toEqual(['실험', ''])
    expect(prev).toEqual(before)
  })

  it('[Q37 값 규칙] 대기 키의 매핑 값이 이 프로젝트의 활성 영역 id 도 skip 도 아니면 그 영역을 다시 pending 으로 — 오류가 아니다', () => {
    const areas = deactivate(R, RUN, DATA)
    for (const dest of [RUN, DATA, 'issue-area-1', 'other-project-area', '']) {
      expect(carryOverRows([src(RUN, { nextContent: '운영' })], areas, { [RUN]: dest }), dest)
        .toEqual({ ok: false, pending: [{ areaId: RUN, areaName: '운영', cells: ['nextContent'] }], overflow: [] })
    }
  })

  it('[Q37] 덧붙임 순서 = Y 자신의 이월분 → 매핑된 영역을 영역 순서대로(원본 행 순서와 무관)', () => {
    const areas = deactivate(R, DATA, RUN)
    const prev = [src(RUN, { nextContent: '운영분' }), src(DATA, { nextContent: '데이터분' }), src(EXP, { nextContent: '실험분' })]
    expect(rowOf(carryOverRows(prev, areas, { [RUN]: EXP, [DATA]: EXP }), EXP)?.thisContent).toBe('실험분\n데이터분\n운영분')
  })

  it('[Q37] next_* 가 공백뿐이거나 this_* 만 있는 비활성 영역 행은 대기가 아니다 — 무시한다', () => {
    const areas = deactivate(R, RUN)
    expect(okRows(carryOverRows([src(RUN, { nextContent: ' \n　', nextIssue: '\t', thisContent: '지난 실적' })], areas)))
      .toEqual(defaultWeeklyRows(areas))
  })

  it('[§4.1.1 키 규칙] 매핑의 키(원본 영역)가 대기 목록에 없으면 그 키는 무시한다 — 오류가 아니다(값 규칙과 따로)', () => {
    const areas = deactivate(R, RUN)
    // EXP = 활성(자기 자리로 감), RUN = 비활성이지만 대기 내용 없음(this_* 만), 'no-such-area' = 모르는 id, constructor = 프로토타입 이름
    const prev = [src(EXP, { nextContent: '실험' }), src(RUN, { thisContent: '지난 실적' })]
    const r = carryOverRows(prev, areas, { [EXP]: DATA, [RUN]: DATA, 'no-such-area': DATA, constructor: DATA })
    expect(okRows(r)).toEqual([
      { areaId: EXP, thisContent: '실험', thisIssue: '', nextContent: '', nextIssue: '' },
      { areaId: DATA, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' },
    ])
  })

  it('원본 행의 영역이 목록에 없으면(FK 가 막아 정상 경로에서는 없다) pending 과 같게 — 알 수 없는 영역', () => {
    expect(carryOverRows([src('gone', { nextIssue: '고아' })], R))
      .toEqual({ ok: false, pending: [{ areaId: 'gone', areaName: UNKNOWN_AREA_LABEL, cells: ['nextIssue'] }], overflow: [] })
  })
})

describe('carryOverRows — 20,000자 넘침은 거부한다(D31·E25 — 자르지 않음)', () => {
  it('매핑으로 모인 칸이 상한을 넘으면 overflow — 행을 돌려주지 않는다', () => {
    const areas = deactivate(R, RUN)
    const r = carryOverRows([src(EXP, { nextContent: 'a'.repeat(15000) }), src(RUN, { nextContent: 'b'.repeat(6000) })], areas, { [RUN]: EXP })
    expect(r).toEqual({ ok: false, pending: [], overflow: [{ areaId: EXP, areaName: '실험', cell: 'this_content', length: 21001 }] })
  })

  it('[K3] 경계 — 이은 길이가 정확히 20,000 이면 통과, 20,001 이면 넘침(저장 상한 WEEKLY_CELL_MAX 와 같은 값은 이월도 받는다)', () => {
    const areas = deactivate(R, DATA)
    const at = (n: number) => carryOverRows([src(EXP, { nextIssue: 'a'.repeat(n) }), src(DATA, { nextIssue: 'b' })], areas, { [DATA]: EXP })
    const ok = at(19998)   // 'a'×19998 + '\n' + 'b' = 20,000
    expect(rowOf(ok, EXP)?.thisIssue).toHaveLength(20000)
    expect(at(19999)).toEqual({ ok: false, pending: [], overflow: [{ areaId: EXP, areaName: '실험', cell: 'this_issue', length: 20001 }] })
  })

  it('대기와 넘침이 함께면 둘 다 싣는다(한 번에 다시 고르게)', () => {
    const areas = deactivate(R, DATA, RUN)
    const r = carryOverRows([
      src(EXP, { nextIssue: 'a'.repeat(19999) }), src(DATA, { nextIssue: 'b' }), src(RUN, { nextContent: '운영' }),
    ], areas, { [DATA]: EXP })
    expect(r).toEqual({
      ok: false,
      pending: [{ areaId: RUN, areaName: '운영', cells: ['nextContent'] }],
      overflow: [{ areaId: EXP, areaName: '실험', cell: 'this_issue', length: 20001 }],
    })
  })
})

describe('사용자 정의 값·시드', () => {
  it('carryCustom — 행에는 custom 이 실리고, seedOf 는 RPC 계약대로 네 칸만 유지(SP5c, 스펙 E28)', () => {
    const rows = okRows(carryOverRows([src(EXP, { nextContent: 'x' })], R, {}, () => ({ k: 1 })))
    expect(rows.find((r) => r.areaId === EXP)?.custom).toEqual({ k: 1 })
    expect(seedOf(rows).every((s) => !('custom' in s))).toBe(true)
  })

  it('seedOf — RPC create_weekly_report 의 p_seed 모양(영역 id + 네 칸, snake)', () => {
    expect(seedOf([{ areaId: EXP, thisContent: 'a', thisIssue: 'b', nextContent: 'c', nextIssue: 'd' }]))
      .toEqual([{ area_id: EXP, this_content: 'a', this_issue: 'b', next_content: 'c', next_issue: 'd' }])
  })

  it('defaultWeeklyRows — 활성 영역마다 빈 행, 영역 순(비활성은 빠진다)', () => {
    expect(defaultWeeklyRows(deactivate(R, DATA)).map((r) => r.areaId)).toEqual([EXP, RUN])
  })
})

describe.each(SYNTHETIC_CONFIGS.map((c) => [c.id] as const))('합성 구성 %s — 이월 계약', (id) => {
  const areas = SYNTHETIC_WEEKLY_AREAS[id]
  it('모든 영역이 활성이면 각 영역의 차주계획이 자기 영역의 금주실적이 된다(흡수 0, 영역 순)', () => {
    const prev = [...areas].reverse().map((a) => src(a.id, { nextContent: `${a.code} 계획`, nextIssue: `${a.code} 이슈` }))
    const rows = okRows(carryOverRows(prev, areas))
    expect(rows.map((r) => r.areaId)).toEqual(orderAreas(areas).map((a) => a.id))
    for (const a of areas) {
      expect(rows.find((r) => r.areaId === a.id), a.code)
        .toEqual({ areaId: a.id, thisContent: `${a.code} 계획`, thisIssue: `${a.code} 이슈`, nextContent: '', nextIssue: '' })
    }
  })
  it('마지막 영역을 끄면 그 영역의 대기만 pending', () => {
    const last = orderAreas(areas).at(-1)!
    expect(carryOverRows(areas.map((a) => src(a.id, { nextContent: 'x' })), deactivate(areas, last.id)))
      .toEqual({ ok: false, pending: [{ areaId: last.id, areaName: last.name, cells: ['nextContent'] }], overflow: [] })
  })
})
