// 가져오기 백업 파일 이름(§6.6-2). 날짜 = 백업이 만들어진 순간(generatedAt)의 그 프로젝트 달력 tz 날짜(SP5 — 범위 tz).
// tz 를 못 읽었으면(페이지가 null 을 내린다 — 로그는 서버) 날짜를 빼고 짓는다: UTC·서울로 날짜를 지어내지 않는다(3원칙 ①).
import { ymdIn } from '@/lib/domain/calendar'

export function backupFileName(projectId: string, generatedAt: string, timeZone: string | null, label?: string): string {
  const date = timeZone ? `-${ymdIn(timeZone, new Date(generatedAt))}` : ''
  return `wbs-backup-${projectId}${date}${label ? `-${label}` : ''}.json`
}
