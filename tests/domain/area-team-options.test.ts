import { describe, expect, it } from 'vitest'
import { areaTeamOptions } from '@/lib/domain/areas'

const pt = (id: string, code: string, active = true) => ({ id, code, active })

describe('areaTeamOptions — 주간 영역 편집기의 팀 선택지(스펙 §4.1.8 — 프로젝트 팀 + 이미 배정된 목록 밖 팀)', () => {
  it('프로젝트 팀을 그 순서대로, 비활성도 싣는다 — 편집기가 활성만 새로 고르게 거른다', () => {
    expect(areaTeamOptions([pt('t-res', 'RES'), pt('t-arc', 'ARC', false)], [], [])).toEqual([
      { id: 't-res', code: 'RES', active: true }, { id: 't-arc', code: 'ARC', active: false },
    ])
  })

  it('영역에 배정됐지만 프로젝트 팀 목록 밖인 팀은 비활성 선택지로 한 번만 더한다(해제용) — code 는 해석기 팀에서', () => {
    const known = [{ id: 't-old', code: 'OLD' }, { id: 't-res', code: 'RES' }]
    const areas = [{ teams: [{ teamId: 't-res' }, { teamId: 't-old' }] }, { teams: [{ teamId: 't-old' }] }]
    expect(areaTeamOptions([pt('t-res', 'RES')], known, areas)).toEqual([
      { id: 't-res', code: 'RES', active: true }, { id: 't-old', code: 'OLD', active: false },
    ])
  })

  it('어디에도 없는 팀 id 는 선택지에 넣지 않는다(표는 알 수 없는 팀으로 보인다)', () => {
    expect(areaTeamOptions([pt('t-res', 'RES')], [], [{ teams: [{ teamId: 't-ghost' }] }])).toEqual([{ id: 't-res', code: 'RES', active: true }])
  })

  it('팀도 영역도 없으면 빈 목록', () => {
    expect(areaTeamOptions([], [], [])).toEqual([])
  })
})
