// scripts/dev-bootstrap.mjs — 로컬 빈 DB 에 워크스페이스 + 플랫폼 관리자를 만든다. 로컬 전용.
// 0003(조직 코어) 이후: memberships.team_id 전역 팀 대신 workspaces 한 개를 만들고, 그 관리자로
// platform_admins·profiles·workspace_members·people 을 함께 채운다. 워크스페이스 선택 UI 는 SP2 몫이라
// 여기서 만든 워크스페이스 하나가 첫 계정의 소속이다(워크스페이스는 화면·자격증명이 명시한다 — 소속 개수로 짐작하지 않는다).
// 순서: 워크스페이스(멱등 upsert) → 계정 → profiles·platform_admins·workspace_members·people → 워크스페이스 설정(허용 모듈·시간대 — apply_workspace_settings 한 번).
// 중간 단계가 실패하면 만든 계정을 지운다 — 고아 계정이 재실행을 막지 않게(워크스페이스는 멱등이라 그대로 둔다).
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { bootstrapModulesAction, parseBootstrapModules } from './lib/bootstrap-modules.mjs'
import { bootstrapTimezonePlan, parseBootstrapTimezone } from './lib/bootstrap-timezone.mjs'
import { SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'
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
rl.close()
if (password.length < MIN_PASSWORD) fail(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다`)

// 워크스페이스 slug·이름은 프롬프트로 묻지 않는다 — env 없으면 로컬 개발 기본값(`default`/`기본 워크스페이스`).
const slug = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()
const wsName = (process.env.BOOTSTRAP_WORKSPACE_NAME || '기본 워크스페이스').trim()
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) fail('워크스페이스 slug 형식: 소문자·숫자·하이픈 2~63자')
// 허용 모듈(스펙 §3.7)은 BOOTSTRAP_MODULES(쉼표 목록). 없으면 비core 전부, 빈 문자열은 core 만. 목록 밖 id 는 계정을 만들기 전에
// 여기서 멈춘다(오타로 만든 계정을 지우는 일이 없게) — 파싱은 lib/bootstrap-modules.mjs.
const parsed = parseBootstrapModules(process.env.BOOTSTRAP_MODULES)
if (!parsed.ok) fail(`BOOTSTRAP_MODULES 에 모르는 모듈 ${parsed.unknown.join(', ')} — 허용: ${parsed.allowed.join(', ')}`)
// 시간대(스펙 D13 ②)는 BOOTSTRAP_TIMEZONE(IANA 이름) — 줬을 때만 쓴다(없으면 제품 기본값 UTC 그대로 — 설정 화면이 브라우저 시간대를 제안한다).
// 형식이 틀리면 계정을 만들기 전에 멈춘다 — 판정은 lib/bootstrap-timezone.mjs.
const tzParsed = parseBootstrapTimezone(process.env.BOOTSTRAP_TIMEZONE)
if (!tzParsed.ok) fail(`BOOTSTRAP_TIMEZONE — ${tzParsed.error}`)

const admin = createClient(target.url, target.serviceRoleKey, { auth: { persistSession: false } })

const { data: ws, error: wErr } = await admin.from('workspaces')
  .upsert({ slug, name: wsName }, { onConflict: 'slug' }).select('id').single()
if (wErr) fail(`워크스페이스 생성 실패: ${wErr.message}`)

const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (uErr) fail(`계정 생성 실패: ${uErr.message}`)
const uid = created.user.id

const rollback = async (name, error) => {
  const { error: dErr } = await admin.auth.admin.deleteUser(uid)
  fail(`${name} 저장 실패: ${error.message} — ` + (dErr
    ? `만든 계정도 지우지 못했다: ${dErr.message}. npm run db:reset 뒤 다시`
    : '만든 계정은 지웠다. 원인을 고친 뒤 다시 실행한다'))
}

const steps = [
  ['profiles', () => admin.from('profiles').upsert({ user_id: uid, email, display_name: email.split('@')[0] })],
  ['platform_admins', () => admin.from('platform_admins').upsert({ user_id: uid })],
  ['workspace_members', () => admin.from('workspace_members').upsert({ workspace_id: ws.id, user_id: uid, role: 'admin' })],
]
for (const [name, run] of steps) {
  const { error } = await run()
  if (error) await rollback(name, error)
}

// people(workspace_id, email) 은 부분 유니크 인덱스(email is not null)라 supabase-js upsert 의
// onConflict 가 못 쓴다(ON CONFLICT 대상이 부분 인덱스와 일치하지 않아 42P10) — select 후 insert/update.
{
  const { data: existing, error: selErr } = await admin.from('people')
    .select('id, user_id').eq('workspace_id', ws.id).eq('email', email).maybeSingle()
  if (selErr) await rollback('people(조회)', selErr)
  if (!existing) {
    const { error } = await admin.from('people')
      .insert({ workspace_id: ws.id, email, display_name: email.split('@')[0], user_id: uid })
    if (error) await rollback('people', error)
  } else if (!existing.user_id) {
    const { error } = await admin.from('people').update({ user_id: uid }).eq('id', existing.id)
    if (error) await rollback('people', error)
  }
  // existing.user_id 가 이미 있으면(동일 이메일의 외부 인력이 이미 계정과 연결됨) 손대지 않는다 — 덮어쓰면 다른 계정의 연결이 끊긴다.
}

// 워크스페이스 설정 — 계정을 만든 뒤 그 계정을 행위자로 apply_workspace_settings 를 한 번 부른다(설정 행은 워크스페이스 트리거가 만들었다).
// 허용 모듈·시간대 둘 다: 기존 워크스페이스에 다시 돌릴 때 env 를 명시하지 않았고 값이 이미 있으면 덮지 않고 알린다(같은 revision 에서 CAS 한 번).
{
  const { data: row, error: rErr } = await admin.from('workspace_settings').select('revision, values').eq('workspace_id', ws.id).maybeSingle()
  if (rErr || !row) await rollback('workspace_settings(조회)', rErr ?? new Error('설정 행이 없다 — 0012 가 적용됐는지 확인'))
  const set = {}
  if (bootstrapModulesAction({ explicit: process.env.BOOTSTRAP_MODULES !== undefined, existingValues: row.values }) === 'keep') {
    const cur = row.values['modules.allowed']
    console.log(`· 허용 모듈은 그대로 둔다 — 워크스페이스 ${slug} 에 이미 ${Array.isArray(cur) ? `${cur.length}개` : '값(형식 이상 — npm run settings:verify 로 확인)'}가 있다. 바꾸려면 BOOTSTRAP_MODULES 를 준다`)
  } else {
    set['modules.allowed'] = parsed.modules
  }
  const tz = bootstrapTimezonePlan({ envValue: process.env.BOOTSTRAP_TIMEZONE, existingValues: row.values })
  if (!tz.ok) await rollback('calendar.timezone', new Error(tz.error))       // 위에서 이미 걸렀다 — 방어
  if (tz.write) set['calendar.timezone'] = tz.value
  else if (Object.prototype.hasOwnProperty.call(row.values ?? {}, 'calendar.timezone')) {
    console.log(`· 시간대는 그대로 둔다 — 워크스페이스 ${slug} 에 이미 ${JSON.stringify(row.values['calendar.timezone'])} 가 있다. 바꾸려면 BOOTSTRAP_TIMEZONE 을 준다`)
  } else {
    console.log(`· 시간대는 쓰지 않는다 — 제품 기본값(${tz.value}). 워크스페이스 설정 화면이 브라우저 시간대를 제안한다. 고정하려면 BOOTSTRAP_TIMEZONE 을 준다`)
  }
  if (Object.keys(set).length > 0) {
    const { data: applied, error: aErr } = await admin.rpc('apply_workspace_settings', {
      p_workspace_id: ws.id, p_expected_revision: row.revision, p_command_id: randomUUID(),
      p_set: set, p_unset: [], p_actor: uid, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal',
    })
    if (aErr) await rollback(Object.keys(set).join('·'), aErr)
    if ('modules.allowed' in set) console.log(`✓ 허용 모듈 ${parsed.modules.length}개 (revision ${applied.revision})`)
    if ('calendar.timezone' in set) console.log(`✓ 시간대 ${set['calendar.timezone']} (revision ${applied.revision})`)
  }
}

console.log(`✓ 플랫폼 관리자 ${email} · 워크스페이스 ${slug}(${wsName}) 관리자 — npm run dev 후 로그인`)
