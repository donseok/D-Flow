// 2026-10-11 사용자 테스트(UAT)에서 나온 표시 결함의 순수 조각 — 제목 중복(DF-019)·'워크스페이스' 접미 중복(DF-022)·프로젝트 이름 상한(DF-011)
import { describe, expect, it } from 'vitest'
import { wbsDisplayTitle } from '@/lib/domain/wbsTitle'
import { nameBeforeWorkspaceWord } from '@/lib/workspace/constants'
import { PROJECT_NAME_MAX, isProjectNameWithinLimit } from '@/lib/domain/project-status'

describe('wbsDisplayTitle', () => {
  it('이름이 코드로 시작하면 이름만 — 화면에서 추가한 항목은 코드가 이름의 첫 토막이다', () => {
    expect(wbsDisplayTitle('임시', '임시 지연 점검 작업')).toBe('임시 지연 점검 작업')
    expect(wbsDisplayTitle('1', '1.2 설계')).toBe('1.2 설계')
    expect(wbsDisplayTitle('단일', '단일')).toBe('단일')
  })
  it('가져온 항목(코드가 이름과 무관)은 코드 + 이름, 코드가 없으면 이름', () => {
    expect(wbsDisplayTitle('W-1', '설계')).toBe('W-1 설계')
    expect(wbsDisplayTitle('인증', '인증서 갱신')).toBe('인증 인증서 갱신')   // 낱말 경계가 아니면 접두로 보지 않는다
    expect(wbsDisplayTitle(null, '설계')).toBe('설계')
    expect(wbsDisplayTitle('', ' 설계 ')).toBe('설계')
  })
})

describe('nameBeforeWorkspaceWord', () => {
  it("'{name} 워크스페이스' 문구에 넣을 때 이름 끝의 같은 말을 뗀다", () => {
    expect(nameBeforeWorkspaceWord('기본 워크스페이스')).toBe('기본')
    expect(nameBeforeWorkspaceWord('Alpha')).toBe('Alpha')
    expect(nameBeforeWorkspaceWord('워크스페이스')).toBe('워크스페이스')   // 이름 전체가 그 말이면 그대로
  })
})

describe('프로젝트 이름 상한', () => {
  it('100자까지, 한 줄', () => {
    expect(isProjectNameWithinLimit('가'.repeat(PROJECT_NAME_MAX))).toBe(true)
    expect(isProjectNameWithinLimit('가'.repeat(PROJECT_NAME_MAX + 1))).toBe(false)
    expect(isProjectNameWithinLimit('두\n줄')).toBe(false)
  })
})
