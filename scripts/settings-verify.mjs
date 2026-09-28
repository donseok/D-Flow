// npm run settings:verify — 로컬 DB 의 모든 설정 행을 레지스트리로 검사한다(스펙 §3.2). 검사 본문은 TS(레지스트리를 import 해야 한다)라
// vitest 러너로 scripts/settings-verify.check.ts 를 돌리고 종료 코드를 그대로 낸다. 로컬 전용(harness 의 LOCAL_DSN).
import { spawnSync } from 'node:child_process'
const r = spawnSync('npx', ['vitest', 'run', '-c', 'vitest.config.verify.ts'], { stdio: 'inherit' })
process.exit(r.status ?? 1)
