// tests/setup/rate-limit.ts — 단위 테스트는 요청 제한(src/lib/http/rateLimit.ts)을 끈다. vitest.config.ts 의 setupFiles 가 모든 테스트 파일 앞에 싣는다.
// 켜 두면 한 파일이 실패 경로(없는 초대·틀린 자격증명)를 수십 번 부르는 기존 테스트가 서로의 카운터에 걸리고, 요청 밖이라 next/headers 도 던진다.
// 제한 자체를 보는 테스트는 process.env.RATE_LIMIT 을 지우고 next/headers 를 mock 한다(tests/http/rate-limit-wiring.test.ts).
// 'off' 는 로컬 개발·단위 테스트에서만 듣는다 — 배포된 서버에서는 꺼지지 않는다(rateLimitEnabled).
process.env.RATE_LIMIT = 'off'
