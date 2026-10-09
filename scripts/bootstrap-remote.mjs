// scripts/bootstrap-remote.mjs — 원격(스테이징·운영·자체호스트) DB 에 첫 플랫폼 관리자와 첫 워크스페이스를 만든다.
//   npm run remote:bootstrap -- --target staging|prod [--yes]
// 로컬은 scripts/dev-bootstrap.mjs(.env.local 이 로컬일 때만 도는 가드)가 맡고, 이 스크립트는 그 가드를 건드리지 않는 별도 경로다.
// 대상은 scripts/lib/targets.mjs 로 해석한다 — 원본 DB ref(금지 목록)는 어떤 값으로 들어와도 멈추고, 그 검사를 끄는 인자는 없다.
// 멱등: 플랫폼 관리자가 이미 있으면 아무것도 하지 않고 0 으로 끝난다(재실행 안전). 그 수를 읽지 못하면 만들지 않고 멈춘다.
// 비밀값: service_role 키와 비밀번호는 환경 변수(BOOTSTRAP_SERVICE_ROLE_KEY·BOOTSTRAP_PASSWORD) 또는 가린 프롬프트로만 받는다.
//   인자로 받지 않고, .env 파일을 읽거나 쓰지 않으며, 출력·오류 문구에 싣지 않는다.
// 하는 일은 dev-bootstrap 과 같다(워크스페이스 → 계정 → profiles·platform_admins·workspace_members·people → 워크스페이스 설정 RPC).
//   로컬 전용 가드를 그대로 두려고 그 파일을 고치지 않고 단계를 여기 한 번 더 적었다 — 한쪽을 바꾸면 다른 쪽도 본다.
// 원격이 아직 없어 실제 대상에 돌려 보지 못했다(순수 부분만 tests/scripts/bootstrap-remote.test.ts 가 덮는다) — docs/runbook-selfhost.md.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { parseBootstrapModules } from './lib/bootstrap-modules.mjs'
import { parseBootstrapTimezone } from './lib/bootstrap-timezone.mjs'
import {
  bootstrapDecision, bootstrapInputProblems, bootstrapPlanLines, parseBootstrapArgs, resolveBootstrapTarget,
} from './lib/bootstrap-remote.mjs'
import { SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }
const USAGE = '사용법: npm run remote:bootstrap -- --target staging|prod [--yes]'

const parsedArgs = parseBootstrapArgs(process.argv.slice(2))
if (!parsedArgs.ok) fail(`${parsedArgs.error}\n  ${USAGE}`)
let target
try { target = resolveBootstrapTarget(parsedArgs.target) } catch (e) { fail(e.message) }

/** 값이 화면에 찍히지 않는 프롬프트 — 터미널이 아니면(파이프·CI) 환경 변수로 주게 한다 */
async function askHidden(label, envName) {
  if (!process.stdin.isTTY) fail(`${envName} 환경 변수가 없다 — 터미널이 아니라 물어볼 수 없다`)
  process.stdout.write(label)
  return new Promise((resolve) => {
    let value = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData)
          process.stdout.write('\n'); resolve(value); return
        }
        if (ch === '\u0003') { process.stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130) }   // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.on('data', onData)
  })
}
async function ask(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return await rl.question(label) } finally { rl.close() }
}

console.log(`대상: ${target.name} (ref ${target.ref}) — ${target.host}`)
const serviceRoleKey = (process.env.BOOTSTRAP_SERVICE_ROLE_KEY || await askHidden('service_role 키(입력이 보이지 않는다): ', 'BOOTSTRAP_SERVICE_ROLE_KEY')).trim()
if (!serviceRoleKey) fail('service_role 키가 비어 있다')
const admin = createClient(target.url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

// 멱등 판정 — 먼저 본다. 이미 관리자가 있으면 계정 정보를 묻지도 않는다
{
  const { count, error } = await admin.from('platform_admins').select('user_id', { count: 'exact', head: true })
  const decision = bootstrapDecision({ count, error })
  if (decision.action === 'abort') fail(`${decision.reason} — 아무것도 만들지 않았다(주소·키·마이그레이션 적용 여부를 확인한다)`)
  if (decision.action === 'skip') { console.log(`· ${decision.reason} — 아무것도 하지 않는다`); process.exit(0) }
}

const email = (process.env.BOOTSTRAP_EMAIL || await ask('첫 플랫폼 관리자 이메일: ')).trim().toLowerCase()
const password = process.env.BOOTSTRAP_PASSWORD || await askHidden('비밀번호(8자 이상, 입력이 보이지 않는다): ', 'BOOTSTRAP_PASSWORD')
const slug = (process.env.BOOTSTRAP_WORKSPACE_SLUG || await ask('첫 워크스페이스 slug(소문자·숫자·하이픈): ')).trim()
const workspaceName = (process.env.BOOTSTRAP_WORKSPACE_NAME || await ask('첫 워크스페이스 이름: ')).trim()
const problems = bootstrapInputProblems({ email, password, slug, workspaceName })
if (problems.length) fail(problems.join('\n✗ '))
// 허용 모듈·시간대는 dev-bootstrap 과 같은 규칙(BOOTSTRAP_MODULES 없으면 비core 전부, 빈 문자열은 core 만 / BOOTSTRAP_TIMEZONE 은 줬을 때만 쓴다)
const modules = parseBootstrapModules(process.env.BOOTSTRAP_MODULES)
if (!modules.ok) fail(`BOOTSTRAP_MODULES 에 모르는 모듈 ${modules.unknown.join(', ')} — 허용: ${modules.allowed.join(', ')}`)
const tz = parseBootstrapTimezone(process.env.BOOTSTRAP_TIMEZONE)
if (!tz.ok) fail(`BOOTSTRAP_TIMEZONE — ${tz.error}`)
const timezone = process.env.BOOTSTRAP_TIMEZONE !== undefined ? tz.value : null

for (const line of bootstrapPlanLines({ target, email, slug, workspaceName, modules: modules.modules, timezone })) console.log(line)
if (!parsedArgs.yes) {
  const answer = await ask(`계속하려면 대상 ref "${target.ref}" 를 입력: `)
  if (answer.trim() !== target.ref) fail('중단 — 아무것도 만들지 않았다')
}

const { data: ws, error: wErr } = await admin.from('workspaces').upsert({ slug, name: workspaceName }, { onConflict: 'slug' }).select('id').single()
if (wErr) fail(`워크스페이스 생성 실패: ${wErr.message}`)

const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (uErr) fail(`계정 생성 실패: ${uErr.message}`)
const uid = created.user.id

// 중간 단계가 실패하면 만든 계정을 지운다 — 고아 계정이 다음 실행의 "이미 있는 이메일"이 되지 않게(워크스페이스는 멱등이라 둔다)
const rollback = async (name, error) => {
  const { error: dErr } = await admin.auth.admin.deleteUser(uid)
  fail(`${name} 저장 실패: ${error.message} — ` + (dErr
    ? `만든 계정도 지우지 못했다: ${dErr.message}. 대시보드에서 그 계정을 지운 뒤 다시 실행한다`
    : '만든 계정은 지웠다. 원인을 고친 뒤 다시 실행한다'))
}

const displayName = email.split('@')[0]
const steps = [
  ['profiles', () => admin.from('profiles').upsert({ user_id: uid, email, display_name: displayName })],
  ['platform_admins', () => admin.from('platform_admins').upsert({ user_id: uid })],
  ['workspace_members', () => admin.from('workspace_members').upsert({ workspace_id: ws.id, user_id: uid, role: 'admin' })],
]
for (const [name, run] of steps) {
  const { error } = await run()
  if (error) await rollback(name, error)
}

// people(workspace_id, email) 은 부분 유니크 인덱스라 upsert 의 onConflict 대상이 못 된다(42P10) — select 후 insert/update(dev-bootstrap 과 같다)
{
  const { data: existing, error: selErr } = await admin.from('people').select('id, user_id').eq('workspace_id', ws.id).eq('email', email).maybeSingle()
  if (selErr) await rollback('people(조회)', selErr)
  if (!existing) {
    const { error } = await admin.from('people').insert({ workspace_id: ws.id, email, display_name: displayName, user_id: uid })
    if (error) await rollback('people', error)
  } else if (!existing.user_id) {
    const { error } = await admin.from('people').update({ user_id: uid }).eq('id', existing.id)
    if (error) await rollback('people', error)
  }
}

// 워크스페이스 설정 — 설정 RPC 한 길. 다시 돌린 경우(워크스페이스가 이미 있고 값도 있다)에는 허용 모듈을 덮지 않는다
{
  const { data: row, error: rErr } = await admin.from('workspace_settings').select('revision, values').eq('workspace_id', ws.id).maybeSingle()
  if (rErr || !row) await rollback('workspace_settings(조회)', rErr ?? new Error('설정 행이 없다 — 마이그레이션이 끝까지 적용됐는지 확인'))
  const set = {}
  const hasModules = Object.prototype.hasOwnProperty.call(row.values ?? {}, 'modules.allowed')
  if (process.env.BOOTSTRAP_MODULES !== undefined || !hasModules) set['modules.allowed'] = modules.modules
  else console.log('· 허용 모듈은 그대로 둔다 — 워크스페이스에 이미 값이 있다. 바꾸려면 BOOTSTRAP_MODULES 를 준다')
  if (timezone) set['calendar.timezone'] = timezone
  if (Object.keys(set).length > 0) {
    const { error: aErr } = await admin.rpc('apply_workspace_settings', {
      p_workspace_id: ws.id, p_expected_revision: row.revision, p_command_id: randomUUID(),
      p_set: set, p_unset: [], p_actor: uid, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal',
    })
    if (aErr) await rollback(Object.keys(set).join('·'), aErr)
  }
}

console.log(`✓ 플랫폼 관리자 ${email} · 워크스페이스 ${slug}(${workspaceName}) 관리자 — 배포 주소에서 로그인해 확인한다`)
