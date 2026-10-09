// 배포 환경 판정의 순수 조각 — 정본은 APP_ENV(production|staging|preview|development, next.config.ts 가 호스팅 플랫폼의 값에서 옮긴다).
// env 는 호출부가 이름을 적어 읽어 넘긴다(usageTracking.trackingEnabled 와 같은 관례 — process.env 객체째 넘기면 빌드 때 박히지 않는다).

/**
 * 로컬 개발인가 — 개발자에게만 뜻이 있는 안내(로컬 DB 를 켜라 등)를 보일지 정한다. 배포된 화면에서 그런 문구는 사용자가 할 수 있는 일이 아니다.
 * APP_ENV 가 있으면 그것이 정본이다('development' 일 때만). 없으면 next dev(NODE_ENV=development)일 때만 — 자체호스트가 APP_ENV 를
 * 빠뜨려도 빌드된 서버(NODE_ENV=production)는 로컬로 보지 않는다(모르면 배포로 본다 — 개발자 문구를 숨기는 쪽이 안전하다).
 */
export function isLocalDevEnv(env: { APP_ENV?: string; NODE_ENV?: string }): boolean {
  const app = env.APP_ENV?.trim()
  if (app) return app === 'development'
  return env.NODE_ENV === 'development'
}
