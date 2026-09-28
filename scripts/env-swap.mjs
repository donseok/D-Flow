// scripts/env-swap.mjs — .env.local 대상을 바꾼다. local 은 supabase status 에서 생성, 원격은 .env.local.<대상> 복사.
// ⚠ 파일 교체는 이 PC 의 모든 병렬 세션에 즉시 영향을 준다.
// local 은 모듈 플래그 8개도 true 로 쓴다(스펙 §4.1) — 사용자 dev 서버가 쓰는 메인 체크아웃이 아니라 스크래치 워크트리에서 돌린다.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { detectEnvTarget, localEnvFromStatus, mergeEnv } from './lib/targets.mjs'
import { localModuleFlagEnv } from './lib/settings-consts.mjs'

const target = process.argv[2]
if (!['local', 'staging', 'prod'].includes(target)) { console.error('사용법: npm run env:local | env:staging | env:prod'); process.exit(1) }

if (target === 'local') {
  const status = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
  writeFileSync('.env.local', mergeEnv(existing, { ...localEnvFromStatus(status), ...localModuleFlagEnv() }))
} else {
  const src = `.env.local.${target}`
  if (!existsSync(src)) { console.error(`✗ ${src} 없음 — 원격 ${target} 은 아직 없다`); process.exit(1) }
  copyFileSync(src, '.env.local')
}
const got = detectEnvTarget(readFileSync('.env.local', 'utf8'))
if (got !== target) { console.error(`✗ 전환 검증 실패 — .env.local 이 ${got} 을 가리킴`); process.exit(1) }
if (target === 'local') console.log('✓ 모듈 플래그 8개 = true')
console.log(`✓ .env.local → ${target}`)
