import { describe, it, expect } from 'vitest'
import {
  hasMyProjects, pickDefaultProjectId, sortMyProjectsFirst,
} from '@/lib/domain/projectPick'

const P = (id: string) => ({ id, name: id.toUpperCase() })
const delta = P('p-delta')
const alpha = P('p-alpha')
const beta = P('p-beta')

describe('pickDefaultProjectId', () => {
  it('내가 멤버인 프로젝트가 하나면 그것으로 정한다', () => {
    expect(pickDefaultProjectId([delta, alpha], ['p-delta'])).toBe('p-delta')
  })

  it('내 프로젝트가 여럿이면 정하지 않는다 — 틀린 기본값이 미연결보다 나쁘다', () => {
    expect(pickDefaultProjectId([delta, alpha, beta], ['p-delta', 'p-alpha'])).toBeNull()
  })

  it('멤버가 아니어도 등록된 프로젝트가 하나뿐이면 그것 — 다른 답이 없다', () => {
    expect(pickDefaultProjectId([delta], [])).toBe('p-delta')
    expect(pickDefaultProjectId([delta], ['p-other'])).toBe('p-delta')
  })

  it('멤버가 아니고 프로젝트가 여럿이면 정하지 않는다', () => {
    expect(pickDefaultProjectId([delta, alpha], [])).toBeNull()
  })

  it('소속 조회 실패(null)는 멤버 아님과 같은 폴백 — 근거가 없기는 마찬가지', () => {
    expect(pickDefaultProjectId([delta], null)).toBe('p-delta')
    expect(pickDefaultProjectId([delta, alpha], null)).toBeNull()
  })

  it('프로젝트가 하나도 없으면 null', () => {
    expect(pickDefaultProjectId([], ['p-delta'])).toBeNull()
  })

  it('내 소속 id 가 등록 목록에 없으면 무시한다 — 없는 프로젝트를 고를 수는 없다', () => {
    expect(pickDefaultProjectId([alpha, beta], ['p-delta'])).toBeNull()
  })
})

describe('sortMyProjectsFirst', () => {
  it('내 프로젝트를 앞으로 보내되 그룹 안 순서는 지킨다', () => {
    expect(sortMyProjectsFirst([alpha, delta, beta], ['p-delta', 'p-beta']).map(p => p.id))
      .toEqual(['p-delta', 'p-beta', 'p-alpha'])
  })

  it('소속이 없거나 조회 실패면 원래 순서 그대로', () => {
    expect(sortMyProjectsFirst([alpha, delta], []).map(p => p.id)).toEqual(['p-alpha', 'p-delta'])
    expect(sortMyProjectsFirst([alpha, delta], null).map(p => p.id)).toEqual(['p-alpha', 'p-delta'])
  })

  it('원본 배열을 바꾸지 않는다', () => {
    const src = [alpha, delta]
    sortMyProjectsFirst(src, ['p-delta'])
    expect(src.map(p => p.id)).toEqual(['p-alpha', 'p-delta'])
  })
})

describe('hasMyProjects', () => {
  it('등록 목록과 교집합이 있을 때만 true', () => {
    expect(hasMyProjects([delta, alpha], ['p-delta'])).toBe(true)
    expect(hasMyProjects([delta, alpha], ['p-other'])).toBe(false)
    expect(hasMyProjects([delta], null)).toBe(false)
  })
})
