#!/usr/bin/env node
// 회의록 첨부 청소 잡(SP5 B3 과제10, D23) — ① 고아 minute-files 객체 ② 미정리 톰스톤(객체 삭제 실패분)을 정리한다.
//
// 기본은 dry-run(읽기만 하고 무엇을 할지 보고). --apply 일 때만 지운다.
// 대상은 minutes 버킷의 minute-files 세그먼트뿐 — 본문(minutes 세그먼트)·과거 버전 원본은 판정(scripts/lib/attachmentSweep.mjs)에서 0건이다.
// 읽기(버킷 전체 목록·minute_files·minute_versions 전 페이지)가 하나라도 실패하면 아무것도 지우지 않고 멈춘다.
// 로그에는 파일 이름을 싣지 않는다(회의록 id 까지만 — safePathLabel).
//
// 사용법:
//   node scripts/minutes/sweep-attachments.mjs --target local            # dry-run
//   node scripts/minutes/sweep-attachments.mjs --target local --apply
//   node scripts/minutes/sweep-attachments.mjs --target staging|prod [--apply]   # .env.local.<target> 와 STAGING_REF/PROD_REF 필요
//
// 스케줄 배선(크론)은 첫 배포 SP 의 몫이다 — 지금은 사람이 돌린다.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  assertNotForbidden, classifySupabaseUrl, localAdminEnv, parseEnvFile, resolveTarget,
} from '../lib/targets.mjs'
import { runSweep } from '../lib/attachmentSweepRun.mjs'

const args = process.argv.slice(2)
const flagValue = name => {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}
const TARGET = flagValue('target')
const APPLY = args.includes('--apply')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** 대상 가드 — 로컬은 .env.local 이 정말 로컬인지, 원격은 .env.local.<target> 의 URL 이 그 대상 ref 인지 확인한다. */
function adminEnv(target) {
  if (target === 'local') {
    resolveTarget('local')
    try { return localAdminEnv(readFileSync('.env.local', 'utf8')) } catch (e) { fail(`.env.local 대상 확인 실패: ${e.message}`) }
  }
  if (target === 'staging' || target === 'prod') {
    try { resolveTarget(target) } catch (e) { fail(e.message) }
    let text
    try { text = readFileSync(`.env.local.${target}`, 'utf8') } catch { fail(`.env.local.${target} 가 없다`) }
    try { assertNotForbidden(text) } catch (e) { fail(e.message) }
    const { values, duplicates } = parseEnvFile(text)
    for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (duplicates.includes(k) || !values[k]) fail(`.env.local.${target} 의 ${k} 가 없거나 중복이다`)
    }
    if (classifySupabaseUrl(values.NEXT_PUBLIC_SUPABASE_URL) !== target) fail(`.env.local.${target} 의 URL 이 ${target} 대상이 아니다`)
    return { url: values.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY }
  }
  return fail('--target 은 local|staging|prod 중 하나여야 한다')
}

async function main() {
  const env = adminEnv(TARGET)
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const res = await runSweep(admin, { apply: APPLY })
  if (!res.ok) return fail(`읽기 실패 — 아무것도 지우지 않았다: ${res.error}`)
  console.log(JSON.stringify({ target: TARGET, mode: APPLY ? 'apply' : 'dry-run', ...res.summary }))
  if (!APPLY) { console.log('dry-run — 지우려면 --apply'); return }
  if (res.failures > 0) fail(`실패 ${res.failures}건 — 다음 실행이 다시 시도한다`)
  console.log('✓ 완료')
}

main().catch(e => fail(e instanceof Error ? e.message : String(e)))
