import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOT_FOLDERS, minuteTeamRequired, parseRootFolders, teamCreatesRoot } from '@/lib/minutes/rootFolders'

// SP5 B2 — minutes.root_folders 순수 계약(개정 §4.7, 스펙 D21)
describe('parseRootFolders', () => {
  it('teams 와 custom 을 받고 이름을 정리한다', () => {
    expect(parseRootFolders({ mode: 'teams' })).toEqual({ ok: true, value: { mode: 'teams' } })
    expect(parseRootFolders({ mode: 'custom', names: [' 경영 ', '현장'] })).toEqual({ ok: true, value: { mode: 'custom', names: ['경영', '현장'] } })
  })
  it.each([
    ['객체 아님', 'teams'], ['모르는 모드', { mode: 'x' }], ['teams 에 군더더기', { mode: 'teams', names: [] }],
    ['custom 빈 목록', { mode: 'custom', names: [] }], ['중복(대소문자 무시)', { mode: 'custom', names: ['A', 'a'] }],
    ['31자', { mode: 'custom', names: ['x'.repeat(31)] }], ['경로 구분자', { mode: 'custom', names: ['a/b'] }],
    ['모르는 필드', { mode: 'custom', names: ['a'], extra: 1 }],
  ])('%s → 거부', (_n, raw) => { expect(parseRootFolders(raw).ok).toBe(false) })
  it('사건 판정 — teams 만 팀 생성이 루트를 만들고 회의록 팀이 필수', () => {
    expect(teamCreatesRoot(DEFAULT_ROOT_FOLDERS)).toBe(true)
    expect(minuteTeamRequired(DEFAULT_ROOT_FOLDERS)).toBe(true)
    expect(teamCreatesRoot({ mode: 'custom', names: ['a'] })).toBe(false)
    expect(minuteTeamRequired({ mode: 'custom', names: ['a'] })).toBe(false)
  })
})
