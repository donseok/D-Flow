import { describe, expect, it } from 'vitest'
import { ISSUE_ANALYSIS_PPTX_MIME, buildIssueAnalysisFilename } from '@/lib/report/issues/export'

describe('이슈 분석서 PPT 파일명·MIME', () => {
  it('프로젝트명과 프로젝트 tz(서울) 날짜로 안전한 파일명을 만든다', () => {
    expect(buildIssueAnalysisFilename(
      'Acme-Pro / 위젯',
      '2026-07-30T16:00:00Z',
      'Asia/Seoul',
    )).toBe('Acme-Pro_위젯_이슈분석서_2026-07-31.pptx')
  })

  it('파일명 날짜는 프로젝트 tz 의 날짜다 — 같은 instant 가 LA 에서는 하루 앞', () => {
    expect(buildIssueAnalysisFilename('Acme', '2026-07-30T16:00:00Z', 'America/Los_Angeles'))
      .toBe('Acme_이슈분석서_2026-07-30.pptx')
  })

  it('이름이 비면 대체 이름을 쓰고, 생성일시가 깨졌으면 던진다', () => {
    expect(buildIssueAnalysisFilename('  ', '2026-07-30T16:00:00Z', 'UTC')).toBe('프로젝트_이슈분석서_2026-07-30.pptx')
    expect(() => buildIssueAnalysisFilename('Acme', 'not-a-date', 'UTC')).toThrow()
  })

  it('MIME 은 pptx 다', () => {
    expect(ISSUE_ANALYSIS_PPTX_MIME).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  })
})
