// scripts/check-env-target.mjs — predev 가드. 잘못된 DB 를 향한 dev 서버를 띄우지 못하게 한다.
// .env.local 을 따로 읽지 않고 Next 가 쓰는 바로 그 로더(@next/env, next 의 의존성)로 읽는다 — 셸 환경변수가 파일을 이기고
// .env.development.local 이 .env.local 을 이기는 우선순위, dotenv 의 줄 해석까지 Next 와 같은 값을 판정한다.
import nextEnv from '@next/env'
import { devEnvVerdict } from './lib/targets.mjs'

const shellUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// forceReload — 부모 프로세스가 남긴 __NEXT_PROCESSED_ENV 때문에 파일을 건너뛰지 않게.
const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: (...a) => console.error(...a) }, true)
const { verdict, source } = devEnvVerdict({ files: loadedEnvFiles, shellUrl, url: process.env.NEXT_PUBLIC_SUPABASE_URL })

if (verdict === 'forbidden') {
  console.error(`\n████ 차단: ${source} 에 원본 DB 좌표가 있습니다 — 우회 불가 ████`)
  console.error('  그 좌표를 언급하는 줄·주석을 모두 지우고, 로컬로: npm run db:start && npm run env:local\n')
  process.exit(1)
}
if (verdict === 'ambiguous') {
  console.error(`\n✗ ${source} 에 NEXT_PUBLIC_SUPABASE_URL 이 두 번 이상 있다 — 어느 줄이 쓰일지 모호하다. 하나만 남기세요\n`)
  process.exit(1)
}
if (verdict === 'prod' && process.env.FORCE_PROD_DEV !== '1') {
  console.error(`\n████ 차단: ${source} 의 NEXT_PUBLIC_SUPABASE_URL 이 D-Flow 운영 DB 를 가리킵니다 ████`)
  console.error('  의도적 운영 접속만: FORCE_PROD_DEV=1 npm run dev\n')
  process.exit(1)
}
if (verdict === 'unknown') {
  console.error(`\n✗ Next 가 쓸 NEXT_PUBLIC_SUPABASE_URL(출처: ${source}) 대상 판독 불가 — npm run db:start && npm run env:local 로 만드세요\n`)
  process.exit(1)
}
console.log(`dev 대상: ${verdict}`)
