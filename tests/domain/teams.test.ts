import { describe, expect, it } from 'vitest'
import {
  activeCodes, normalizeNewTeamCode, reservedTeamNames, teamOrderMap, validateNewTeamCodes,
  type Team,
} from '@/lib/domain/teams'
import { FIXTURE_TEAMS, FIXTURE_TEAM_CODES } from '../fixtures/teams'

describe('domain/teams', () => {
  it('FIXTURE_TEAM_CODES 는 옛 기본 5팀 순서 — 픽스처 값 보존', () => {
    expect(FIXTURE_TEAM_CODES).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
    expect(FIXTURE_TEAMS.find(t => t.code === 'MDM')?.progressVisible).toBe(false)
  })

  it('activeCodes는 active만 sortOrder→code 순 정렬', () => {
    const teams: Team[] = [
      { id: '3', code: 'C', name: 'C', color: '#6b7280', sortOrder: 2, active: false, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
      { id: '2', code: 'B', name: 'B', color: '#6b7280', sortOrder: 1, active: true, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
      { id: '1', code: 'A', name: 'A', color: '#6b7280', sortOrder: 1, active: true, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
    ]
    expect(activeCodes(teams)).toEqual(['A', 'B'])
  })

  it('teamOrderMap은 코드→인덱스', () => {
    expect(teamOrderMap(['X', 'Y']).get('Y')).toBe(1)
    expect(teamOrderMap(['X']).get('없음')).toBeUndefined()
  })

  it('normalizeNewTeamCode: 공백 트림·빈값/초과/예약어 거부(예약어는 호출부가 파생해 넘긴다 — D38)', () => {
    const reserved = reservedTeamNames({ levelLabels: ['Phase', 'Task', 'Activity'], extraAxisLabel: null })
    expect(normalizeNewTeamCode(' 신팀 ', reserved)).toEqual({ ok: true, code: '신팀' })
    expect(normalizeNewTeamCode('  ', reserved).ok).toBe(false)
    expect(normalizeNewTeamCode('a'.repeat(21), reserved).ok).toBe(false)
    expect(normalizeNewTeamCode('산출물', reserved).ok).toBe(false) // 엑셀 헤더 예약어
    expect(normalizeNewTeamCode('Activity', reserved).ok).toBe(false) // 이 프로젝트의 단계 이름
  })

  it('validateNewTeamCodes: 입력 순서로 정규화(중복 제거), 첫 불가 이름을 입력 그대로 돌려준다(전환·등록 앞의 사전 검사 — SP4 R1)', () => {
    const reserved = reservedTeamNames({ levelLabels: ['단계', '작업'], extraAxisLabel: null })
    expect(validateNewTeamCodes([' 신팀 ', 'CIV', '신팀'], reserved)).toEqual({ ok: true, codes: ['신팀', 'CIV'] })
    expect(validateNewTeamCodes([], reserved)).toEqual({ ok: true, codes: [] })
    const bad = validateNewTeamCodes(['CIV', '산출물', 'a'.repeat(21)], reserved)
    expect(bad).toMatchObject({ ok: false, team: '산출물' })
    expect(validateNewTeamCodes(['  ', 'CIV'], reserved)).toMatchObject({ ok: false, team: '  ' })
    // 예약어는 호출부가 넘긴 것(그 프로젝트의 단계 이름 포함, 대소문자 무시 — D38)
    expect(validateNewTeamCodes(['CIV', '작업'], reserved)).toMatchObject({ ok: false, team: '작업' })
    expect(validateNewTeamCodes(['CIV', 'START'], reserved)).toMatchObject({ ok: false, team: 'START' })
  })
})
