// scripts/dev-bootstrap.mjs — 로컬 빈 DB 에 첫 슈퍼유저를 만든다. 로컬 전용.
// memberships.team_id 가 not null(기준선 그대로, SP1 에서 폐기)이라 중립 전역 팀 1개를 함께 만든다.
// teams 의 유일 키는 (project_id, code) NULLS NOT DISTINCT 다(code 단독 아님) — 전역 팀은 project_id = null.
// 순서: 팀(멱등 upsert) → 계정 → 멤버십. 멤버십이 실패하면 만든 계정을 지운다 — 고아 계정이 재실행을 막지 않게.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { localAdminEnv } from './lib/targets.mjs'

const MIN_PASSWORD = 8 // 앱 규칙(src/lib/domain/accounts.ts isValidPassword)과 같다
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }

// 로컬 판정을 createClient 에 넘길 바로 그 값에 건다(localAdminEnv) — 첫 줄/끝 줄이 갈라지는 .env.local 은 거절.
// 처방은 원인별이다 — env:local 은 키를 덮어쓸 뿐 남는 줄·금지 좌표를 지우지 않는다.
const REMEDY = {
  forbidden: '.env.local 에서 그 좌표를 언급하는 줄·주석을 모두 지운다',
  duplicate: '.env.local 에서 남는 줄을 지우고 KEY=값 한 줄만 남긴다',
  noncanonical: '.env.local 에서 그 줄을 행 머리의 KEY=값 한 줄로 고치고 남는 줄은 지운다',
}
let target
try { target = localAdminEnv(readFileSync('.env.local', 'utf8')) } catch (e) {
  fail(`${e.message} — 부트스트랩은 로컬 전용이다. ${REMEDY[e.kind] ?? 'npm run db:start && npm run env:local 로 다시 만든다'}`)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const email = (process.env.BOOTSTRAP_EMAIL || await rl.question('슈퍼유저 이메일: ')).trim().toLowerCase()
const password = process.env.BOOTSTRAP_PASSWORD || await rl.question(`비밀번호(${MIN_PASSWORD}자 이상): `)
const teamCode = (process.env.BOOTSTRAP_TEAM || '운영').trim()
rl.close()
if (password.length < MIN_PASSWORD) fail(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다`)

const admin = createClient(target.url, target.serviceRoleKey, { auth: { persistSession: false } })
const { data: team, error: tErr } = await admin.from('teams')
  .upsert({ project_id: null, code: teamCode, name: teamCode }, { onConflict: 'project_id,code' }).select('id').single()
if (tErr) fail(`팀 생성 실패: ${tErr.message}`)

const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (uErr) fail(`계정 생성 실패: ${uErr.message}`)

const { error: mErr } = await admin.from('memberships').insert({ user_id: created.user.id, team_id: team.id, role: 'pmo_admin', is_superuser: true })
if (mErr) {
  const { error: dErr } = await admin.auth.admin.deleteUser(created.user.id)
  fail(`멤버십 생성 실패: ${mErr.message} — ` + (dErr
    ? `만든 계정(${email})도 지우지 못했다: ${dErr.message}. npm run db:reset 뒤 다시 실행한다`
    : `만든 계정은 지웠다. 원인을 고친 뒤 다시 실행한다`))
}
console.log(`✓ 슈퍼유저 ${email} (팀 ${teamCode}) — npm run dev 후 로그인`)
