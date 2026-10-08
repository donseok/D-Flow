/**
 * 사용 기록 수집 여부.
 *
 * 개발·Preview·스테이징의 클릭이 운영 지표에 섞이지 않게 기본값은 "프로덕션에서만"이다.
 * 배포 환경은 APP_ENV(production|staging|preview|development)로 읽는다 — Vercel 에서는 next.config.ts 가 빌드 env 로 옮긴다.
 *   USAGE_TRACKING=on   로컬/Preview 검증용 명시적 opt-in
 *   USAGE_TRACKING=off  운영 긴급 차단(다른 무엇보다 우선)
 */
export function trackingEnabled(env: Record<string, string | undefined>): boolean {
  if (env.USAGE_TRACKING === 'off') return false
  if (env.USAGE_TRACKING === 'on') return true
  return env.APP_ENV === 'production'
}

/** 0079 배포 전 usage_events에는 제품 이벤트 차원이 없다. 다른 DB 오류와 혼동하지 않는다. */
export function usageEventDimensionsMissing(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  return (error.code === 'PGRST204' || error.code === '42703')
    && (message.includes('event_name') || message.includes('metadata'))
}
