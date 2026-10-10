// 엑셀의 팀 글자 → 프로젝트 팀의 code(BUG-10). 예전에는 code 가 정확히 같을 때만 "아는 팀"이라, 팀 이름(코드와 다른)을 적은 파일이
// 새 팀으로 넘어갔다가 자기 자신과의 겹침 오류("'플랫폼개발팀'는 같은 범위의 다른 팀(DEV)의 코드·이름과 겹칩니다")로 전체가 실패했다.
import { describe, expect, it } from 'vitest'
import { resolveOwnerTeams, resolveTeamRef, teamCodeClashError } from '@/lib/domain/teamName'

const team = (code: string, name = code, active = true) => ({ code, name, active })
/** 상속 프로젝트가 쓰는 워크스페이스 공용 팀(projectTeams 의 결과) */
const COMMON = [team('DEV', '플랫폼개발팀'), team('OPS', '운영팀'), team('OLD', '옛 팀', false)]

describe('resolveTeamRef — code·이름을 낱말로 대조한다', () => {
  it('리포트의 재현 — 팀 이름(플랫폼개발팀)은 그 팀(DEV)이다. 새 팀이 아니다', () => {
    expect(resolveTeamRef('플랫폼개발팀', COMMON)).toBe('DEV')
  })
  it('code 는 정확히 같으면 그대로, 대소문자·앞뒤 공백·전각이 달라도 같은 팀이다', () => {
    expect(resolveTeamRef('DEV', COMMON)).toBe('DEV')
    expect(resolveTeamRef('dev', COMMON)).toBe('DEV')
    expect(resolveTeamRef('  Dev ', COMMON)).toBe('DEV')
    expect(resolveTeamRef('ＤＥＶ', COMMON)).toBe('DEV')
    expect(resolveTeamRef(' 운영팀 ', COMMON)).toBe('OPS')
  })
  it('어느 팀도 아니면 null — 그때만 새 팀 후보다', () => {
    expect(resolveTeamRef('신규팀', COMMON)).toBeNull()
    expect(resolveTeamRef('', COMMON)).toBeNull()
    expect(resolveTeamRef('플랫폼개발', COMMON)).toBeNull()   // 부분 일치는 보지 않는다
  })
  it('code 가 이름보다 먼저다 — 한 팀의 code 와 다른 팀의 이름이 같은 낱말이면 code 쪽', () => {
    expect(resolveTeamRef('ops', [team('OPS', '운영'), team('X', 'ops')])).toBe('OPS')
  })
  it('비활성 팀도 그 프로젝트의 팀이다(대조 통과). 활성 팀과 같은 낱말이면 활성 팀', () => {
    expect(resolveTeamRef('옛 팀', COMMON)).toBe('OLD')
    expect(resolveTeamRef('qa팀', [team('Q1', 'QA팀', false), team('Q2', 'QA팀')])).toBe('Q2')
  })
  it('같은 낱말의 서로 다른 팀 둘이면 고르지 않는다(null) — 뒤의 겹침 판정이 사유를 말한다', () => {
    expect(resolveTeamRef('qa팀', [team('Q1', 'QA팀'), team('Q2', 'QA팀')])).toBeNull()
  })
})

describe('resolveOwnerTeams — 행의 담당을 프로젝트 팀의 code 로', () => {
  it('글자를 code 로 바꾸고, 못 찾은 글자는 그대로 둔다(새 팀 후보)', () => {
    expect(resolveOwnerTeams([{ team: '플랫폼개발팀', kind: 'primary' }, { team: '신규팀', kind: 'support' }], COMMON))
      .toEqual([{ team: 'DEV', kind: 'primary' }, { team: '신규팀', kind: 'support' }])
  })
  it('같은 팀을 두 번 가리키면 하나로 합친다 — 주관이 이긴다(복수 담당 분리가 같은 팀의 sub-act 를 둘 만들지 않게)', () => {
    expect(resolveOwnerTeams([{ team: 'dev', kind: 'support' }, { team: '플랫폼개발팀', kind: 'primary' }, { team: '운영팀', kind: 'support' }], COMMON))
      .toEqual([{ team: 'DEV', kind: 'primary' }, { team: 'OPS', kind: 'support' }])
  })
})

describe('BUG-27 — 겹침 문구의 조사', () => {
  it("받침 있는 이름은 '은', 없는 이름은 '는', 읽는 법을 모르는 글자는 '은(는)'", () => {
    expect(teamCodeClashError('플랫폼개발팀', 'DEV')).toBe("'플랫폼개발팀'은 같은 범위의 다른 팀(DEV)의 코드·이름과 겹칩니다.")
    expect(teamCodeClashError('기획부', 'PLAN')).toBe("'기획부'는 같은 범위의 다른 팀(PLAN)의 코드·이름과 겹칩니다.")
    expect(teamCodeClashError('ops', 'OPS')).toBe("'ops'은(는) 같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다.")
  })
})
