// scripts/e2e-local.mjs — SP0 done_when 1번 흐름 + SP1 조직 코어 흐름을 로컬 스택에서 HTTP 로 완주한다. 로컬 전용.
//   SP0: 로그인 → 프로젝트 생성(단계 라벨 입력) → WBS 엑셀 양식 다운로드·채우기 → 임포트(inspect → execute append·replace)
//        → 주간보고 PPT·엑셀, WBS 엑셀 내보내기 → 산출물 zip 전 항목에서 원 고객사 흔적 검사.
//   SP1: 프로젝트 A·B → 프로젝트 팀(A: 두 팀, B: 한 팀) → 명단(본인@A 관리자·다중 팀, 외부 인력 bob@A, 본인@B 멤버)
//        → A 임포트(팀명 담당) → 외부 인력 bob 을 A 리프 담당으로 → 회의(참석자 bob) → 초대 발급(carol, 멤버, A 첫 팀)
//        → 새 세션으로 가입+합류 → carol 로그인: A 멤버, B 조회 전용(같은 워크스페이스 — 스펙 2.4.1), 타 워크스페이스·미존재는
//        not-found(존재 은닉 — 상태 코드가 아니라 notFound() digest 로 판정) → 관리자 세션으로 주요 화면 렌더(오류 표식·흐름 데이터).
// 브라우저 자동화는 비밀번호를 입력하지 못하므로 화면이 부르는 것과 같은 경로(서버 액션·API 라우트)를 직접 부른다.
// 사용: db:reset → dev:bootstrap 직후(깨끗한 DB), INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000
//   으로 띄운 npm run dev 가 떠 있는 상태에서
//   BOOTSTRAP_PASSWORD=… [BOOTSTRAP_EMAIL=admin@example.com] [E2E_BASE_URL=http://localhost:3000] \
//   [E2E_OUT_DIR=<산출물 폴더>] node scripts/e2e-local.mjs
// 결과는 stdout 에 JSON 한 덩어리. 어느 단계든 실패하면 그 자리에서 멈추고 exit 1.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  ERR_DENIED, INVITEE, LEVEL_LABELS, OTHER_WORKSPACE, SP1_TEAMS, TEMPLATE_HEADER, actionResult, cookieHeader, dispositionFilename,
  e2eRows, encodeActionArgs, findActionId, findTraces, inviteInput, inviteTokenFromUrl, leafCodes, localAppUrl,
  localClientEnv, meetingInput, notFoundRendered, pageProblems, redactInviteTokens, rosterPlan, rosterView, signupInput,
  teamIdsByCode, toCell,
} from './lib/e2e.mjs'
import { localAdminEnv } from './lib/targets.mjs'

class Fail extends Error {}
const log = (m) => console.error(`· ${m}`)

let env
let adminEnv
try {
  const text = readFileSync('.env.local', 'utf8')
  env = localClientEnv(text)
  adminEnv = localAdminEnv(text) // 타 워크스페이스 픽스처 전용(로컬 판정은 targets.mjs 한 곳)
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
const base = (() => {
  try { return localAppUrl(process.env.E2E_BASE_URL || 'http://localhost:3000') } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
})()
const email = (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()
const password = process.env.BOOTSTRAP_PASSWORD
const outDir = process.env.E2E_OUT_DIR || join(tmpdir(), 'd-flow-e2e')
if (!password) { console.error('✗ BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다'); process.exit(1) }

const MANIFEST = '.next/server/server-reference-manifest.json'
const ACTIONS = {
  createProject: { filename: 'src/app/actions/project.ts', exportedName: 'createProject', worker: '/projects/page' },
  addProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'addProjectTeam', worker: '/p/[projectId]/settings/page' },
  upsertRosterMember: { filename: 'src/app/actions/roster.ts', exportedName: 'upsertRosterMember', worker: '/p/[projectId]/members/page' },
  setWbsAssignee: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsAssignee', worker: '/p/[projectId]/wbs/page' },
  createMeeting: { filename: 'src/app/actions/meetings.ts', exportedName: 'createMeeting', worker: '/p/[projectId]/meetings/page' },
  createProjectInvite: { filename: 'src/app/actions/projectInvites.ts', exportedName: 'createProjectInvite', worker: '/p/[projectId]/members/page' },
  redeemInviteWithSignup: { filename: 'src/app/actions/inviteRedeem.ts', exportedName: 'redeemInviteWithSignup', worker: '/invite/[token]/page' },
}

const summary = { base, email, outDir, steps: [], artifacts: [] }
/**
 * 단계 기록 — 그 단계의 검사가 끝난 뒤 부른다. failure 를 주면 ✗ 로 기록·출력하고 Fail 을 던진다
 * (기록을 남긴 채 실패해야 결과 JSON 에 어느 단계에서 무엇이 틀렸는지 남는다).
 * @param {string} name @param {object} detail @param {string} [failure]
 */
const step = (name, detail, failure) => {
  // detail 의 name·at·ok 가 단계 이름·시각·판정을 덮으면 결과 JSON 이 거짓말을 한다(러너 개발 중 name 으로 실제로 한 번 겪었다).
  if (['name', 'at', 'ok'].some((k) => k in detail)) throw new Fail(`단계 ${name} 의 기록에 예약 키(name·at·ok)가 있다`)
  summary.steps.push({ name, at: new Date().toISOString(), ok: !failure, ...detail })
  if (failure) {
    log(`${name} ✗`)
    throw new Fail(failure)
  }
  log(`${name} ✓`)
}

/**
 * 쿠키 항아리 하나 = 브라우저 하나. 앱과 같은 @supabase/ssr 로 쿠키를 만든다(이름·청크·base64 인코딩을 손으로 흉내 내지 않는다).
 * @param {string} label
 */
function session(label) {
  const jar = new Map()
  const sb = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  })
  const cookies = () => cookieHeader([...jar].map(([name, value]) => ({ name, value })))

  async function http(method, path, { body, headers = {}, expect = 200 } = {}) {
    const res = await fetch(`${base}${path}`, { method, body, redirect: 'manual', headers: { cookie: cookies(), ...headers } })
    if (Array.isArray(expect) ? !expect.includes(res.status) : res.status !== expect) {
      const text = (await res.text()).slice(0, 500)
      throw new Fail(`[${label}] ${method} ${path} → ${res.status}(기대 ${expect}): ${text}`)
    }
    return res
  }

  async function login(user, pass) {
    const { data, error } = await sb.auth.signInWithPassword({ email: user, password: pass })
    if (error) throw new Fail(`[${label}] 로그인 실패: ${error.message}`)
    if (![...jar.keys()].some((k) => k.includes('-auth-token'))) throw new Fail(`[${label}] 로그인은 됐는데 세션 쿠키가 만들어지지 않았다`)
    return data.user
  }

  /**
   * 서버 액션 — 화면이 부르는 것과 같은 방식(POST <페이지> + next-action 헤더). 액션 id 는 빌드마다 달라 next dev 가 쓴
   * 매니페스트에서 매번 새로 읽는다(호출 전에 그 페이지를 GET 해 컴파일·등록을 끝내 둔다). 응답(Flight)에서 반환값을 꺼낸다.
   */
  async function action(pagePath, name, args) {
    const ref = ACTIONS[name]
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    let found
    try { found = findActionId(manifest, ref) } catch (e) { throw new Fail(`${e.message}(${pagePath} 를 먼저 GET 했는가)`) }
    if (!found.workers.some((w) => w.endsWith(ref.worker))) {
      throw new Fail(`${name} 가 ${ref.worker} 에 묶여 있지 않다(${found.workers.join(', ')})`)
    }
    const res = await http('POST', pagePath, {
      body: encodeActionArgs(args),
      headers: { 'next-action': found.id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component', origin: base },
    })
    try {
      return { actionId: found.id, result: actionResult(Buffer.from(await res.arrayBuffer())) }
    } catch (e) {
      throw new Fail(`[${label}] ${name}: ${e.message}`)
    }
  }

  return { label, sb, jar, http, login, action }
}

/** { ok: true } 계열 반환이 아니면 멈춘다 — 실패 문구를 그대로 올린다. */
function mustOk(name, result) {
  if (!result || result.ok !== true) throw new Fail(`${name} 실패: ${JSON.stringify(result)}`)
  return result
}

/** 조회 오류를 '0건'으로 넘기지 않는다. */
function rows(what, { data, error }) {
  if (error || !data) throw new Fail(`${what} 조회 실패: ${error?.message ?? 'data 없음'}`)
  return data
}

function same(what, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Fail(`${what} 가 다르다: ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`)
  }
}

const xlsxBlob = (buf) => new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
const seoulToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const ROSTER_SELECT = 'id, access_role, people!inner(display_name, email, user_id), project_member_teams(is_primary, teams(code))'

async function main() {
  mkdirSync(outDir, { recursive: true })
  const admin = session('admin')
  // service_role — 세션 경로에 grant 가 없는 표(project_invites)의 확인과 타 워크스페이스 픽스처에만 쓴다(로컬 전용, localAdminEnv).
  const svc = createClient(adminEnv.url, adminEnv.serviceRoleKey, { auth: { persistSession: false } })

  // ── 1. 로그인 — 미들웨어가 /login 으로 돌려보내지 않아야 한다(302/307 이면 실패).
  const me = await admin.login(email, password)
  await admin.http('GET', '/projects')
  step('login', { userId: me.id, cookieNames: [...admin.jar.keys()] })

  // ── 2. 프로젝트 A·B — 화면(NewProjectModal)이 부르는 createProject. 결과는 DB 에서 확인한다(같은 이름 1건 + 라벨 그대로).
  const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '')
  const createProject = async (label) => {
    const name = `E2E ${label} ${stamp}`
    const { actionId } = await admin.action('/projects', 'createProject', [name, null, null, null, LEVEL_LABELS])
    const found = rows('프로젝트', await admin.sb.from('projects').select('id,name,workspace_id').eq('name', name))
    if (found.length !== 1) throw new Fail(`생성된 프로젝트 ${name} 가 ${found.length}건`)
    const { data: settings, error } = await admin.sb.from('project_settings').select('level_labels,max_depth').eq('project_id', found[0].id).single()
    if (error) throw new Fail(`프로젝트 설정 조회 실패: ${error.message}`)
    same(`${name} 단계 라벨`, settings.level_labels, LEVEL_LABELS)
    return { id: found[0].id, name, workspaceId: found[0].workspace_id, settings, actionId }
  }
  const A = await createProject('A')
  const B = await createProject('B')
  if (A.workspaceId !== B.workspaceId) throw new Fail('A·B 가 다른 워크스페이스에 생겼다(부트스트랩 워크스페이스 하나여야 한다)')
  step('create-projects', {
    path: `server action createProject(${A.actionId.slice(0, 12)}…) via POST /projects`,
    projects: [A, B].map(({ id, name, settings }) => ({ id, name, settings })), workspaceId: A.workspaceId, rows: 2,
  })

  // ── 3. 프로젝트 팀 — 설정 화면(ProjectTeamsManager)의 addProjectTeam. 부트스트랩은 팀을 만들지 않는다(Task 8).
  for (const p of [A, B]) await admin.http('GET', `/p/${p.id}/settings`)
  for (const [p, codes] of [[A, SP1_TEAMS.A], [B, SP1_TEAMS.B]]) {
    for (const code of codes) mustOk(`addProjectTeam(${code})`, (await admin.action(`/p/${p.id}/settings`, 'addProjectTeam', [p.id, code])).result)
  }
  const teamRows = rows('팀', await admin.sb.from('teams').select('id,code,project_id,workspace_id').in('project_id', [A.id, B.id]))
  if (teamRows.length !== SP1_TEAMS.A.length + SP1_TEAMS.B.length) throw new Fail(`프로젝트 팀이 ${teamRows.length}건`)
  if (teamRows.some((t) => t.workspace_id !== A.workspaceId)) throw new Fail('프로젝트 팀의 워크스페이스가 프로젝트와 다르다')
  const teamIds = { A: teamIdsByCode(teamRows, A.id, SP1_TEAMS.A), B: teamIdsByCode(teamRows, B.id, SP1_TEAMS.B) }
  step('project-teams', { A: SP1_TEAMS.A, B: SP1_TEAMS.B, rows: teamRows.length })

  // ── 4. 명단 — upsertRosterMember(RPC upsert_project_member 한 번). 본인 이름은 부트스트랩 프로필 그대로(개명하지 않게).
  const { data: profile, error: profErr } = await admin.sb.from('profiles').select('display_name').eq('user_id', me.id).single()
  if (profErr) throw new Fail(`프로필 조회 실패: ${profErr.message}`)
  const plan = rosterPlan({ selfName: profile.display_name, selfEmail: email, teamIds })
  for (const p of [A, B]) await admin.http('GET', `/p/${p.id}/members`)
  const upsert = async (p, input) => mustOk('upsertRosterMember', (await admin.action(`/p/${p.id}/members`, 'upsertRosterMember', [p.id, input])).result).memberId
  const selfA = await upsert(A, plan.selfA)
  const bobId = await upsert(A, plan.bob)
  const selfB = await upsert(B, plan.selfB)
  const roster = async (pid) => rosterView(rows('명단', await admin.sb.from('project_members').select(ROSTER_SELECT).eq('project_id', pid)))
  const rosterA = await roster(A.id)
  const rosterB = await roster(B.id)
  const byId = (view, id) => view.find((r) => r.memberId === id)
  same('A 명단 행 수', rosterA.length, 2)
  same('본인@A', byId(rosterA, selfA), { memberId: selfA, name: profile.display_name, email, accessRole: 'admin', linked: true, teams: [...SP1_TEAMS.A] })
  same('외부 인력 bob@A', byId(rosterA, bobId), { memberId: bobId, name: 'bob', email: null, accessRole: null, linked: false, teams: [] })
  same('B 명단', rosterB, [{ memberId: selfB, name: profile.display_name, email, accessRole: 'member', linked: true, teams: [...SP1_TEAMS.B] }])
  step('roster', { A: rosterA, B: rosterB, rows: rosterA.length + rosterB.length })

  // ── 5. A 에 WBS 임포트 — 양식 다운로드 → 행 채우기 → inspect → execute (ImportWizard 와 같은 폼 필드·기본값: append, saveProfile)
  const team = SP1_TEAMS.A[0]
  const template = Buffer.from(await (await admin.http('GET', '/api/import/template')).arrayBuffer())
  writeFileSync(join(outDir, 'wbs-template.xlsx'), template)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template)
  const ws = wb.getWorksheet('WBS')
  if (!ws) throw new Fail("양식에 'WBS' 시트가 없다")
  const header = ws.getRow(1).values.slice(1)
  if (JSON.stringify(header) !== JSON.stringify(TEMPLATE_HEADER)) throw new Fail(`양식 헤더가 다르다: ${JSON.stringify(header)}`)
  // 예시 행 자리에 덮어쓰고 남는 예시 행은 비운다(spliceRows 는 SheetJS 가 쓴 시트에서 행을 지우지 못했다 — 2026-09-24 실측).
  const wbsRows = e2eRows(team)
  const lastExample = ws.rowCount
  wbsRows.forEach((r, i) => { ws.getRow(i + 2).values = r.map(toCell) })
  for (let n = wbsRows.length + 2; n <= lastExample; n++) ws.getRow(n).values = []
  const filled = Buffer.from(await wb.xlsx.writeBuffer())
  const check = new ExcelJS.Workbook()
  await check.xlsx.load(filled)
  const written = check.getWorksheet('WBS').actualRowCount
  if (written !== wbsRows.length + 1) throw new Fail(`채운 양식의 WBS 시트가 ${written}행(기대 헤더+${wbsRows.length})`)
  writeFileSync(join(outDir, 'wbs-filled.xlsx'), filled)
  step('fill-template', { rows: wbsRows.length, team, file: join(outDir, 'wbs-filled.xlsx') })

  const inspectForm = new FormData()
  inspectForm.append('file', xlsxBlob(filled), 'wbs-filled.xlsx')
  inspectForm.append('projectId', A.id)
  const inspected = await (await admin.http('POST', '/api/import/inspect', { body: inspectForm })).json()
  const profileDetected = inspected.detection.profile
  step('import-inspect', { hierarchy: profileDetected.hierarchy, teamColumns: profileDetected.teamColumns, warnings: inspected.detection.warnings })

  const execute = async (mode) => {
    const form = new FormData()
    form.append('file', xlsxBlob(filled), 'wbs-filled.xlsx')
    form.append('projectId', A.id)
    form.append('profile', JSON.stringify(profileDetected))
    form.append('mode', mode)
    form.append('saveProfile', 'true')
    form.append('registerTeams', 'false') // 3 단계에서 만든 프로젝트 팀이 이미 있어야 한다 — 409(needsTeams)면 실패
    try {
      return (await admin.http('POST', '/api/import/execute', { body: form })).json()
    } catch (e) {
      // 팀 마스터 캐시(src/lib/teams/master.ts)는 모듈 인스턴스마다 따로이고 TTL(60초)이 지나면 첫 읽기가 옛 값을 돌려준다 —
      // 임포트 라우트가 팀 생성 전에 이미 로드돼 있었으면(같은 dev 서버로 재실행) 방금 만든 프로젝트 팀을 못 본다. 재시도로 덮지 않는다.
      if (e instanceof Fail && e.message.includes('→ 409') && e.message.includes('needsTeams')) {
        throw new Fail(`${e.message} — 임포트 라우트의 팀 캐시가 3 단계에서 만든 팀을 못 봤다(모듈 인스턴스별 캐시·TTL). dev 서버를 새로 띄워 처음부터 다시 돌린다`)
      }
      throw e
    }
  }
  const importedItems = async () => {
    const data = rows('WBS', await admin.sb.from('wbs_items')
      .select('id,code,name,level_idx,assignee_member_id,item_owners(kind,teams(code))').eq('project_id', A.id).order('code'))
    if (data.length !== wbsRows.length) throw new Fail(`임포트 뒤 WBS 가 ${data.length}행(기대 ${wbsRows.length})`)
    const owned = data.filter((i) => i.item_owners.some((o) => o.teams?.code === team))
    const expectOwned = wbsRows.filter((r) => r.at(-1) === team).length
    if (owned.length !== expectOwned) throw new Fail(`팀 ${team} 담당 행이 ${owned.length}건(기대 ${expectOwned})`)
    return data
  }
  const appended = await execute('append')
  step('import-append', { response: appended, items: await importedItems() })

  // replace — 같은 파일로 트리를 통째로 갈아 끼운다. 백업은 교체 전 5행이어야 하고, 교체 뒤에도 5행이다(중복 없음).
  const replaced = await execute('replace')
  if (replaced.backup?.rows?.length !== wbsRows.length) throw new Fail(`replace 백업이 ${replaced.backup?.rows?.length}행(기대 ${wbsRows.length})`)
  const items = await importedItems()
  step('import-replace', {
    response: { ...replaced, backup: { rows: replaced.backup.rows.length, generatedAt: replaced.backup.generatedAt } },
    items,
  })

  // ── 6. 외부 인력(계정 없음) bob 을 A 리프 담당으로 — WBS 담당 패널(WbsAssigneeStagePanel)의 setWbsAssignee.
  await admin.http('GET', `/p/${A.id}/wbs`)
  const leafCode = leafCodes(wbsRows)[0]
  const leaf = items.find((i) => i.code === leafCode)
  if (!leaf) throw new Fail(`리프 ${leafCode} 가 임포트 결과에 없다`)
  mustOk('setWbsAssignee', (await admin.action(`/p/${A.id}/wbs`, 'setWbsAssignee', [leaf.id, bobId])).result)
  const assigned = rows('담당', await admin.sb.from('wbs_items').select('id,code').eq('project_id', A.id).eq('assignee_member_id', bobId))
  same('bob 담당 항목', assigned.map((i) => i.code), [leafCode])
  step('assign-external', { itemId: leaf.id, itemCode: leafCode, memberId: bobId, rows: assigned.length })

  // ── 7. 회의 + 참석자 bob — 회의 화면(MeetingFormModal)의 createMeeting.
  await admin.http('GET', `/p/${A.id}/meetings`)
  const meetingDate = seoulToday()
  const meeting = mustOk('createMeeting', (await admin.action(`/p/${A.id}/meetings`, 'createMeeting', [A.id, meetingInput({ date: meetingDate, attendeeIds: [bobId] })])).result)
  const attendees = rows('참석자', await admin.sb.from('meeting_attendees').select('member_id,project_id').eq('meeting_id', meeting.id))
  same('회의 참석자', attendees, [{ member_id: bobId, project_id: A.id }])
  step('meeting', { meetingId: meeting.id, meetingDate, attendees: attendees.length })

  // ── 8. 내보내기 — 리포트 화면의 주간보고 PPT·엑셀, WBS 화면의 엑셀(담당·회의가 들어간 뒤의 A).
  const exports = [
    ['report-pptx', `/api/report?projectId=${A.id}&format=pptx`, 'report.pptx'],
    ['report-xlsx', `/api/report?projectId=${A.id}&format=xlsx`, 'report.xlsx'],
    ['wbs-xlsx', `/api/export?projectId=${A.id}`, 'wbs_export.xlsx'],
  ]
  for (const [kind, path, fallback] of exports) {
    const res = await admin.http('GET', path)
    const buf = Buffer.from(await res.arrayBuffer())
    const file = join(outDir, dispositionFilename(res.headers.get('content-disposition'), fallback))
    writeFileSync(file, buf)
    summary.artifacts.push({ kind, file, bytes: buf.length, contentType: res.headers.get('content-type') })
  }
  step('export', { files: summary.artifacts.map((a) => a.file) })

  // ── 9. 산출물 zip 의 모든 항목(XML·rels·docProps·미디어)을 UTF-8 로 풀어 흔적 검사.
  for (const a of summary.artifacts) {
    const zip = await JSZip.loadAsync(readFileSync(a.file))
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
    const entries = await Promise.all(names.map(async (name) => ({ name, text: await zip.file(name).async('string') })))
    const root = a.kind.endsWith('pptx') ? 'ppt/presentation.xml' : 'xl/workbook.xml'
    a.entries = names.length
    a.hasRoot = names.includes(root)
    a.traces = findTraces(entries)
    if (!a.hasRoot) throw new Fail(`${a.file} 에 ${root} 가 없다`)
  }
  const traced = summary.artifacts.filter((a) => a.traces.length)
  step('trace-scan', { entriesScanned: summary.artifacts.reduce((n, a) => n + a.entries, 0), hits: traced.length },
    traced.length ? `흔적 적중: ${JSON.stringify(traced.map((a) => ({ file: a.file, traces: a.traces })))}` : undefined)

  // ── 10. 초대 발급 — 명단 화면(ProjectInviteManager)의 createProjectInvite. 토큰은 응답 url 에만 있다(DB 는 해시).
  const invite = mustOk('createProjectInvite', (await admin.action(`/p/${A.id}/members`, 'createProjectInvite', [A.id, inviteInput([teamIds.A[0]])])).result)
  if (invite.alreadyAccount !== false) {
    throw new Fail(`${INVITEE.email} 계정 존재 여부가 ${invite.alreadyAccount} — 깨끗한 DB 에서 돌린다(npm run db:reset && npm run dev:bootstrap)`)
  }
  const token = inviteTokenFromUrl(invite.url, base)
  const invites = rows('초대', await svc.from('project_invites').select('id,email,access_role,redeemed_at').eq('project_id', A.id))
  same('A 초대', invites.map(({ id, email: e, access_role, redeemed_at }) => ({ id, email: e, access_role, redeemed_at })),
    [{ id: invite.row.id, email: INVITEE.email, access_role: 'member', redeemed_at: null }])
  step('invite-issue', {
    inviteId: invite.row.id, email: invite.row.email, accessRole: invite.row.accessRole, teamCodes: invite.row.teamCodes,
    status: invite.row.status, urlOrigin: new URL(invite.url).origin, mailed: invite.mailed, mailError: invite.mailError ?? null, rows: invites.length,
  })

  // ── 11. 새 세션(쿠키 없음)으로 가입+합류 — 초대 화면(InviteRedeemCard)의 redeemInviteWithSignup. 비밀번호는 실행마다 새로(출력하지 않는다).
  const carol = session('carol')
  await carol.http('GET', `/invite/${token}`)
  const carolPassword = `E2E-${randomUUID()}`
  const redeemed = mustOk('redeemInviteWithSignup', (await carol.action(`/invite/${token}`, 'redeemInviteWithSignup', [token, signupInput(INVITEE.name, carolPassword)])).result)
  same('합류 결과', { projectId: redeemed.projectId, email: redeemed.email }, { projectId: A.id, email: INVITEE.email })
  const rosterA2 = await roster(A.id)
  const carolRow = rosterA2.find((r) => r.email === INVITEE.email)
  same('A 명단 행 수(합류 뒤)', rosterA2.length, 3)
  if (!carolRow) throw new Fail(`합류했는데 A 명단에 ${INVITEE.email} 가 없다`)
  const { memberId: carolMemberId, ...carolView } = carolRow
  same('carol@A', carolView, { name: INVITEE.name, email: INVITEE.email, accessRole: 'member', linked: true, teams: [SP1_TEAMS.A[0]] })
  const consumed = rows('초대', await svc.from('project_invites').select('redeemed_at').eq('id', invite.row.id))
  if (!consumed[0]?.redeemed_at) throw new Fail('합류했는데 초대가 소비되지 않았다')
  step('invite-redeem', { projectId: redeemed.projectId, memberId: carolMemberId, teams: carolView.teams, redeemedAt: consumed[0].redeemed_at, rows: rosterA2.length })

  // ── 12. 존재 은닉 대조군 — 타 워크스페이스의 프로젝트 C. 워크스페이스를 만드는 화면·액션이 SP2 몫이라 service_role 로 직접 만든다(로컬 전용).
  const { data: otherWs, error: owErr } = await svc.from('workspaces')
    .upsert({ slug: OTHER_WORKSPACE.slug, name: OTHER_WORKSPACE.name }, { onConflict: 'slug' }).select('id').single()
  if (owErr) throw new Fail(`타 워크스페이스 픽스처 실패: ${owErr.message}`)
  const { data: C, error: cErr } = await svc.from('projects').insert({ name: `E2E C ${stamp}`, workspace_id: otherWs.id }).select('id,name').single()
  if (cErr) throw new Fail(`타 워크스페이스 프로젝트 픽스처 실패: ${cErr.message}`)
  const { error: csErr } = await svc.from('project_settings').insert({ project_id: C.id, level_labels: LEVEL_LABELS, max_depth: LEVEL_LABELS.length })
  if (csErr) throw new Fail(`타 워크스페이스 프로젝트 설정 픽스처 실패: ${csErr.message}`)
  step('other-workspace-fixture', { via: 'service_role(로컬 전용 — 워크스페이스 생성 경로는 SP2)', workspace: OTHER_WORKSPACE.slug, projectId: C.id, projectName: C.name })

  // ── 13. carol 로그인 — A 는 명단 멤버, B 는 같은 워크스페이스라 조회 전용(스펙 2.4.1 '그 외 워크스페이스 멤버 → viewer':
  // 화면은 열리고 쓰기는 거부), C(타 워크스페이스)·미존재 id 는 똑같이 not-found(존재 은닉). 관리자(플랫폼 관리자)는 C 를 본다 —
  // not-found 가 부재가 아니라 은닉이라는 대조. (app)/loading.tsx 스트리밍 때문에 은닉돼도 HTTP 상태는 200 일 수 있어
  // 은닉 판정은 실제 HTTP 404 또는 notFound() digest 다(어느 신호였는지 기록). 열려야 하는 화면은 pageProblems 로 본다 —
  // 스트리밍된 오류 digest·열화 표시가 없고, 그 페이지 세그먼트만 그리는 문구(WBS 히어로 제목, A 는 리프명)가 있어야 한다.
  // 프로젝트 이름만으로는 안 된다: 레이아웃 사이드바가 모든 화면에 싣는다(은닉된 C 에도 실린다, 4.2).
  // 이름 노출(projectNameInHtml)은 기록만 — SP1 은 projects·read_all_* 읽기 정책이 개방인 상태가 의도다(SP1 스펙 표 258행, SP2 가 닫는다).
  const carolUser = await carol.login(INVITEE.email, carolPassword)
  const missing = randomUUID()
  const visibility = []
  const see = async (who, label, pid, name, { hidden = false, expectTexts = [] } = {}) => {
    const path = `/p/${pid}/wbs`
    const res = await who.http('GET', path, { expect: hidden ? [200, 404] : 200 })
    const html = await res.text()
    const digest = notFoundRendered(html)
    const entry = {
      who: who.label, project: label, path, status: res.status,
      notFound: res.status === 404 || digest, notFoundSignal: res.status === 404 ? 'http-404' : digest ? 'digest' : null,
      projectNameInHtml: name ? html.includes(name) : null,
      ...(hidden ? {} : { expect: expectTexts, problems: pageProblems(html, expectTexts) }),
    }
    visibility.push(entry)
    if (entry.notFound !== hidden) throw new Fail(`${who.label} ${label} 화면: notFound=${entry.notFound}(기대 ${hidden})`)
    if (!hidden && entry.problems.length) throw new Fail(`${who.label} ${label} 화면 문제: ${entry.problems.join(', ')}`)
  }
  const wbsTitle = (name) => `${name} WBS · 간트` // wbs/page.tsx 히어로 — 페이지 세그먼트만 그린다(i18n wbs.heroTitleSuffix)
  await see(carol, 'A(명단 멤버)', A.id, A.name, { expectTexts: [wbsTitle(A.name), leaf.name] })
  await see(carol, 'B(같은 워크스페이스, 명단 없음)', B.id, B.name, { expectTexts: [wbsTitle(B.name)] })
  const denied = (await carol.action(`/p/${B.id}/meetings`, 'createMeeting', [B.id, meetingInput({ date: meetingDate, attendeeIds: [] })])).result
  same('carol 의 B 회의 생성', denied, { ok: false, error: ERR_DENIED })
  const bMeetings = rows('B 회의', await admin.sb.from('meetings').select('id').eq('project_id', B.id))
  same('B 회의 수', bMeetings.length, 0)
  visibility.push({ who: 'carol', project: 'B(같은 워크스페이스, 명단 없음)', action: 'createMeeting', result: denied, bMeetings: bMeetings.length })
  await see(carol, 'C(타 워크스페이스)', C.id, C.name, { hidden: true })
  await see(carol, '미존재 id', missing, null, { hidden: true })
  await see(admin, 'C(타 워크스페이스)', C.id, C.name, { expectTexts: [wbsTitle(C.name)] })
  step('visibility', { carolUserId: carolUser.id, checks: visibility })

  // ── 14. 관리자 세션으로 주요 화면 렌더(눈확인의 기계 부분) — 스트리밍된 오류 digest·notFound·열화 표시가 없고, 흐름에서 만든
  // 데이터가 그 페이지 세그먼트에 실려 있어야 한다(조회 실패를 빈 목록으로 그리는 화면은 오류 표식이 없다). /projects 는 프로젝트
  // 이름이 사이드바에도 있으므로 카드 링크(`/p/<id>/dashboard` — 사이드바는 /projects 에서 프로젝트 메뉴를 그리지 않는다)로 본다.
  // 마지막 단계라 앞 단계는 전부 돈다.
  const pages = [
    ['/projects', [`/p/${A.id}/dashboard`, `/p/${B.id}/dashboard`]],
    [`/p/${A.id}/members`, ['bob', INVITEE.name]],
    [`/p/${A.id}/meetings`, [meetingInput({ date: meetingDate, attendeeIds: [] }).title]],
    [`/p/${A.id}/issues`, []],
    [`/p/${A.id}/wbs`, [leaf.name]],
    [`/p/${A.id}/attendance`, []],
  ]
  const rendered = []
  for (const [path, expectTexts] of pages) {
    const html = await (await admin.http('GET', path)).text()
    rendered.push({ path, bytes: html.length, expect: expectTexts, problems: pageProblems(html, expectTexts) })
  }
  const broken = rendered.filter((r) => r.problems.length)
  step('render-pages', { pages: rendered, problems: broken.length }, broken.length ? `화면 오류 표식: ${JSON.stringify(broken)}` : undefined)
}

try {
  await main()
  summary.ok = true
} catch (e) {
  summary.ok = false
  // 실패 메시지에 /invite/<토큰> 경로가 들어갈 수 있다(초대 화면 GET·POST 실패) — 출력 전에 가린다.
  summary.error = redactInviteTokens(e?.message ?? String(e))
  if (!(e instanceof Fail)) console.error(redactInviteTokens(e?.stack ?? String(e)))
  process.exitCode = 1
}
console.log(JSON.stringify(summary, null, 2))
