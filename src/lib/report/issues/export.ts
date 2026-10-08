import { ymdIn } from '@/lib/domain/calendar'

export const ISSUE_ANALYSIS_PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function zonedDate(value: string, timeZone: string): string {
  const date = new Date(value)
  // 파일명에 'Invalid Date'가 박히면 안 되므로 유효성 가드는 유지 — 포맷만 정본(ymdIn)에 위임.
  if (Number.isNaN(date.getTime())) throw new Error('이슈 분석서 생성일시가 올바르지 않습니다.')
  return ymdIn(timeZone, date)
}

/** 파일명 날짜는 프로젝트 calendar.timezone 의 생성 날짜다 */
export function buildIssueAnalysisFilename(
  projectName: string,
  generatedAt: string,
  timeZone: string,
): string {
  const safeProject = projectName.trim() || '프로젝트'
  return `${safeProject}_이슈분석서_${zonedDate(generatedAt, timeZone)}.pptx`
    .replace(/[^\w가-힣.\-]+/g, '_')
}
