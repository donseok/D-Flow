import { describe, expect, it } from 'vitest'
import {
  ISSUE_ATTACHMENT_MAX_BYTES,
  ISSUE_ATTACHMENT_MAX_COUNT,
  isIssueAttachmentPathValid,
  isIssueAttachmentSizeAllowed,
  makeIssueAttachmentPath,
  remainingIssueAttachmentSlots,
} from '@/lib/domain/issueAttachments'
import { sanitizeFileName } from '@/lib/domain/minutes'

const ISSUE = '11111111-2222-3333-4444-555555555555'
const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const OTHER = '99999999-8888-4777-8666-555555555555'
const SCOPE = { workspaceId: WS, projectId: PID }

describe('ISSUE_ATTACHMENT 상한', () => {
  it('파일당 상한은 Supabase 전역 상한과 같은 52,428,800 바이트다', () => {
    // 이보다 크게 잡으면 버킷 설정과 무관하게 전역 상한에서 잘린다.
    expect(ISSUE_ATTACHMENT_MAX_BYTES).toBe(52_428_800)
  })

  it('이슈당 첨부 개수 상한은 10개다', () => {
    expect(ISSUE_ATTACHMENT_MAX_COUNT).toBe(10)
  })
})

describe('makeIssueAttachmentPath', () => {
  it('ws/<wid>/p/<pid>/issue-attachments/<이슈>/ 아래에 시각과 안전한 이름을 잇는다', () => {
    expect(makeIssueAttachmentPath(SCOPE, ISSUE, 'report.pdf', 1_700_000_000_000))
      .toBe(`ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/1700000000000-report.pdf`)
  })

  it('파일 세그먼트는 sanitizeFileName 결과에 시각 접두를 붙인 것이다', () => {
    const path = makeIssueAttachmentPath(SCOPE, ISSUE, '회의 자료 최종.xlsx', 1_700_000_000_000)
    expect(path.split('/')[6]).toBe(`1700000000000-${sanitizeFileName('회의 자료 최종.xlsx')}`)
    expect(/^[\x20-\x7e]+$/.test(path)).toBe(true)
  })

  it('같은 파일명이라도 시각이 다르면 다른 경로가 된다', () => {
    const a = makeIssueAttachmentPath(SCOPE, ISSUE, 'a.png', 1_700_000_000_000)
    const b = makeIssueAttachmentPath(SCOPE, ISSUE, 'a.png', 1_700_000_000_001)
    expect(a).not.toBe(b)
  })

  it('경로 구분자가 든 파일명이 상위 디렉터리로 새 나가지 않는다', () => {
    const path = makeIssueAttachmentPath(SCOPE, ISSUE, '../../etc/passwd', 1_700_000_000_000)
    expect(path.split('/')).toHaveLength(7)
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, path)).toBe(true)
  })

  it('만들어 낸 경로는 언제나 자기 이슈의 유효 경로다 — 긴 이름도 시각 접두까지 200자 안에 든다', () => {
    for (const name of ['a.txt', '표.hwp', '.hidden', '...', 'x'.repeat(300), `${'y'.repeat(250)}.pdf`]) {
      const path = makeIssueAttachmentPath(SCOPE, ISSUE, name, 1_700_000_000_000)
      expect(isIssueAttachmentPathValid(SCOPE, ISSUE, path)).toBe(true)
      expect(path.split('/')[6].length).toBeLessThanOrEqual(200)
    }
    expect(makeIssueAttachmentPath(SCOPE, ISSUE, `${'y'.repeat(250)}.pdf`, 1).endsWith('.pdf')).toBe(true)
  })
})

describe('isIssueAttachmentPathValid', () => {
  const ok = `ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/1-a.pdf`

  it('자기 워크스페이스·프로젝트·이슈 경로만 받는다', () => {
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, ok)).toBe(true)
  })

  it('다른 워크스페이스·다른 프로젝트·다른 이슈의 경로를 거부한다', () => {
    expect(isIssueAttachmentPathValid({ ...SCOPE, workspaceId: OTHER }, ISSUE, ok)).toBe(false)
    expect(isIssueAttachmentPathValid({ ...SCOPE, projectId: OTHER }, ISSUE, ok)).toBe(false)
    expect(isIssueAttachmentPathValid(SCOPE, OTHER, ok)).toBe(false)
  })

  it('다른 entity 세그먼트를 거부한다', () => {
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, ok.replace('/issue-attachments/', '/deliverables/'))).toBe(false)
  })

  it('옛 형식 <이슈>/<파일> 을 거부한다', () => {
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, `${ISSUE}/1-a.pdf`)).toBe(false)
  })

  it('상위 디렉터리 탈출·빈 파일 세그먼트를 거부한다', () => {
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, `ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/..`)).toBe(false)
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, `ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/../x/1-a.pdf`)).toBe(false)
    expect(isIssueAttachmentPathValid(SCOPE, ISSUE, `ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/`)).toBe(false)
  })

  it('빈 이슈 id 로는 어떤 경로도 통과하지 않는다', () => {
    expect(isIssueAttachmentPathValid(SCOPE, '', ok)).toBe(false)
  })
})

describe('isIssueAttachmentSizeAllowed', () => {
  it('상한과 정확히 같은 크기는 받는다', () => {
    expect(isIssueAttachmentSizeAllowed(ISSUE_ATTACHMENT_MAX_BYTES)).toBe(true)
  })

  it('상한을 1바이트라도 넘으면 거부한다', () => {
    expect(isIssueAttachmentSizeAllowed(ISSUE_ATTACHMENT_MAX_BYTES + 1)).toBe(false)
  })

  it('빈 파일은 받는다', () => {
    expect(isIssueAttachmentSizeAllowed(0)).toBe(true)
  })

  it('음수·NaN 같은 값은 거부한다', () => {
    expect(isIssueAttachmentSizeAllowed(-1)).toBe(false)
    expect(isIssueAttachmentSizeAllowed(Number.NaN)).toBe(false)
    expect(isIssueAttachmentSizeAllowed(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('remainingIssueAttachmentSlots', () => {
  it('첨부가 없으면 상한만큼 남는다', () => {
    expect(remainingIssueAttachmentSlots(0)).toBe(ISSUE_ATTACHMENT_MAX_COUNT)
  })

  it('상한을 채우면 0이다', () => {
    expect(remainingIssueAttachmentSlots(ISSUE_ATTACHMENT_MAX_COUNT)).toBe(0)
  })

  it('어떤 이유로 상한을 넘겨 저장돼 있어도 음수를 돌려주지 않는다', () => {
    expect(remainingIssueAttachmentSlots(ISSUE_ATTACHMENT_MAX_COUNT + 5)).toBe(0)
  })

  it('조회가 실패해 개수를 모르면 0으로 막는다', () => {
    // 보안·상한 판정은 fail-closed — 모르면 통과시키지 않는다.
    expect(remainingIssueAttachmentSlots(Number.NaN)).toBe(0)
  })
})
