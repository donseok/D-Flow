import { describe, it, expect } from 'vitest'
import {
  validateMinuteInput, validateMinuteFields, validateMinuteTeam, sanitizeFileName, stampedFileName, isMinuteFilePathValid, ilikeOrPattern,
  MINUTE_BODY_MAX, type MinuteInput,
} from '@/lib/domain/minutes'
import { makeStoragePath } from '@/lib/domain/storagePath'

const base: MinuteInput = {
  minuteDate: '2026-07-09', teamCode: 'ERP', title: '주간 정례회의',
  bodyMd: '# 안건\n- 진행 현황', meetingId: null,
}

describe('validateMinuteInput', () => {
  it('정상 입력은 null', () => expect(validateMinuteInput(base)).toBeNull())
  it('제목 없음', () => expect(validateMinuteInput({ ...base, title: '  ' })).toMatch(/제목/))
  it('제목 200자 초과', () =>
    expect(validateMinuteInput({ ...base, title: 'a'.repeat(201) })).toMatch(/200/))
  it('날짜 형식 오류', () =>
    expect(validateMinuteInput({ ...base, minuteDate: '2026/07/09' })).toMatch(/날짜/))
  it('잘못된 담당', () =>
    expect(validateMinuteInput({ ...base, teamCode: 'QA' as never })).toMatch(/담당/))
  it('본문 캡 초과', () =>
    expect(validateMinuteInput({ ...base, bodyMd: 'a'.repeat(MINUTE_BODY_MAX + 1) })).toMatch(/100,000/))
  it('빈 본문 허용', () => expect(validateMinuteInput({ ...base, bodyMd: '' })).toBeNull())
})

describe('validateMinuteFields / validateMinuteTeam — 담당 팀은 범위가 정해진 뒤 따로 본다', () => {
  it('필드 검증은 담당 팀을 보지 않는다', () => {
    expect(validateMinuteFields({ ...base, teamCode: 'QA' as never })).toBeNull()
    expect(validateMinuteFields({ ...base, title: '  ' })).toMatch(/제목/)
  })
  it('담당 팀은 넘긴 범위의 팀 목록으로만 판정한다', () => {
    expect(validateMinuteTeam('ERP', ['ERP'])).toBeNull()
    expect(validateMinuteTeam('ERP', ['PMO'])).toBe('잘못된 담당입니다.')
    expect(validateMinuteTeam('ERP', [])).toBe('잘못된 담당입니다.')
  })
})

describe('sanitizeFileName', () => {
  it('허용 외 문자 → _', () => expect(sanitizeFileName('weekly meeting(July).md')).toBe('weekly_meeting_July_.md'))
  it('영숫자/._- 보존', () => expect(sanitizeFileName('minutes-7.9_draft.md')).toBe('minutes-7.9_draft.md'))

  it('한글 파일명도 Supabase Storage 키에 안전한 ASCII로 변환하고 확장자를 보존', () => {
    const safe = sanitizeFileName('내수영업_인터뷰_임가공__2026-07-08.md')

    expect(safe).toBe('_2026-07-08.md')
    expect(safe).toMatch(/^[A-Za-z0-9_.-]+$/)
    expect(safe).toMatch(/\.md$/)
  })

  it('구분자만 남는 파일명은 안전한 기본값 사용', () =>
    expect(sanitizeFileName('한글파일')).toBe('file'))

  it('200자 초과 원본은 잘라내되 확장자는 보존한다(Storage 키 200자 상한과 호환)', () => {
    const safe = sanitizeFileName('a'.repeat(250) + '.pdf')
    expect(safe.length).toBeLessThanOrEqual(200)
    expect(safe.endsWith('.pdf')).toBe(true)
  })

  it('잘라낸 결과를 makeStoragePath 가 그대로 받아들인다', () => {
    const W = '11111111-1111-4111-8111-111111111111'
    const E = '33333333-3333-4333-8333-333333333333'
    const fileName = sanitizeFileName('a'.repeat(250) + '.pdf')
    expect(() => makeStoragePath({ workspaceId: W, projectId: null, entity: 'minutes', entityId: E, fileName }))
      .not.toThrow()
  })

  it('점·슬래시만 있는 긴 파일명도 안전한 기본값으로 수렴한다', () => {
    const safe = sanitizeFileName('.'.repeat(300) + '/'.repeat(50))
    expect(safe).toBe('file')
    expect(safe.length).toBeLessThanOrEqual(200)
  })
})

describe('isMinuteFilePathValid', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const ws = 'aaaaaaaa-1111-4111-8111-111111111111'
  const pid = 'bbbbbbbb-2222-4222-8222-222222222222'
  const other = '99999999-2222-4333-8444-555555555555'
  const withProject = { workspaceId: ws, projectId: pid }
  const noProject = { workspaceId: ws, projectId: null }
  const body = `ws/${ws}/p/${pid}/minutes/${id}/123-a.md`
  const loose = `ws/${ws}/p/_/minute-files/${id}/123-a.pdf`
  it('자기 스코프 경로 허용 — 프로젝트 있음(본문)·없음(첨부)', () => {
    expect(isMinuteFilePathValid(withProject, id, body, 'minutes')).toBe(true)
    expect(isMinuteFilePathValid(noProject, id, loose, 'minute-files')).toBe(true)
  })
  it('다른 워크스페이스·다른 프로젝트·다른 회의록 거부', () => {
    expect(isMinuteFilePathValid({ ...withProject, workspaceId: other }, id, body, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid({ ...withProject, projectId: other }, id, body, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid(noProject, id, body, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid(withProject, other, body, 'minutes')).toBe(false)
  })
  it('다른 entity 세그먼트 거부 — 본문 자리에 첨부 경로, 첨부 자리에 본문 경로', () => {
    expect(isMinuteFilePathValid(noProject, id, loose, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid(withProject, id, body, 'minute-files')).toBe(false)
  })
  it('옛 형식 <id>/<파일> 거부', () => expect(isMinuteFilePathValid(withProject, id, `${id}/123-a.md`, 'minutes')).toBe(false))
  it('경로 순회 거부', () => {
    expect(isMinuteFilePathValid(withProject, id, `ws/${ws}/p/${pid}/minutes/${id}/..`, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid(withProject, id, `ws/${ws}/p/${pid}/minutes/${id}/../etc/x`, 'minutes')).toBe(false)
  })
})

describe('stampedFileName', () => {
  it('sanitizeFileName 결과에 시각 접두를 붙인다', () =>
    expect(stampedFileName('회의 자료.md', 1700)).toBe(`1700-${sanitizeFileName('회의 자료.md')}`))
  it('긴 이름도 200자 안으로 — 확장자는 남는다', () => {
    const s = stampedFileName(`${'x'.repeat(300)}.md`, 1_700_000_000_000)
    expect(s.length).toBeLessThanOrEqual(200)
    expect(s.startsWith('1700000000000-')).toBe(true)
    expect(s.endsWith('.md')).toBe(true)
    expect(() => makeStoragePath({ workspaceId: 'aaaaaaaa-1111-4111-8111-111111111111', projectId: null,
      entity: 'minutes', entityId: '11111111-2222-4333-8444-555555555555', fileName: s })).not.toThrow()
  })
})

describe('ilikeOrPattern', () => {
  it('일반 문자열은 인용된 %패턴%', () => expect(ilikeOrPattern('예산')).toBe('"%예산%"'))
  it('쉼표/괄호는 인용부 안에서 그대로 안전', () =>
    expect(ilikeOrPattern('일정, 예산(안)')).toBe('"%일정, 예산(안)%"'))
  it('LIKE 와일드카드 이스케이프', () =>
    expect(ilikeOrPattern('100%_달성')).toBe('"%100\\\\%\\\\_달성%"'))
  it('역슬래시는 LIKE→인용 2단 이스케이프', () =>
    expect(ilikeOrPattern('a\\b')).toBe('"%a\\\\\\\\b%"'))
  it('큰따옴표 이스케이프', () => expect(ilikeOrPattern('회의"록"')).toBe('"%회의\\"록\\"%"'))
})
