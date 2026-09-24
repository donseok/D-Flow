// scripts/e2e-local.mjs — SP0 done_when 1번 흐름을 로컬 스택에서 HTTP 로 완주한다. 로컬 전용.
//   로그인 → 프로젝트 생성(단계 라벨 입력) → WBS 엑셀 양식 다운로드·채우기 → 임포트(inspect → execute append·replace)
//   → 주간보고 PPT·엑셀, WBS 엑셀 내보내기 → 산출물 zip 전 항목에서 원 고객사 흔적 검사.
// 브라우저 자동화는 비밀번호를 입력하지 못하므로 화면이 부르는 것과 같은 경로(서버 액션·API 라우트)를 직접 부른다.
// 사용: npm run dev 가 떠 있는 상태에서
//   BOOTSTRAP_PASSWORD=… [BOOTSTRAP_EMAIL=admin@example.com] [BOOTSTRAP_TEAM=운영] [E2E_BASE_URL=http://localhost:3000] \
//   [E2E_OUT_DIR=<산출물 폴더>] node scripts/e2e-local.mjs
// 결과는 stdout 에 JSON 한 덩어리. 어느 단계든 실패하면 그 자리에서 멈추고 exit 1.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServerClient } from '@supabase/ssr'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  LEVEL_LABELS, TEMPLATE_HEADER, cookieHeader, dispositionFilename, e2eRows, findActionId, findTraces,
  localAppUrl, localClientEnv, toCell,
} from './lib/e2e.mjs'

class Fail extends Error {}
const log = (m) => console.error(`· ${m}`)

let env
try { env = localClientEnv(readFileSync('.env.local', 'utf8')) } catch (e) {
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
const team = (process.env.BOOTSTRAP_TEAM || '운영').trim()
const outDir = process.env.E2E_OUT_DIR || join(tmpdir(), 'd-flow-e2e')
if (!password) { console.error('✗ BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다'); process.exit(1) }

const summary = { base, email, outDir, steps: [], artifacts: [] }
const step = (name, detail) => { summary.steps.push({ name, at: new Date().toISOString(), ...detail }); log(`${name} ✓`) }

// ── 1. 로그인 — 앱과 같은 @supabase/ssr 로 쿠키를 만든다(이름·청크·base64 인코딩을 손으로 흉내 내지 않는다).
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
  if (res.status !== expect) {
    const text = (await res.text()).slice(0, 500)
    throw new Fail(`${method} ${path} → ${res.status}(기대 ${expect}): ${text}`)
  }
  return res
}
const xlsxBlob = (buf) => new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

async function main() {
  mkdirSync(outDir, { recursive: true })

  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password })
  if (authErr) throw new Fail(`로그인 실패: ${authErr.message}`)
  if (![...jar.keys()].some((k) => k.includes('-auth-token'))) throw new Fail('로그인은 됐는데 세션 쿠키가 만들어지지 않았다')
  await http('GET', '/projects') // 미들웨어가 /login 으로 돌려보내지 않아야 한다(302/307 이면 실패)
  step('login', { userId: auth.user.id, cookieNames: [...jar.keys()] })

  // ── 2. 프로젝트 생성 — 화면(NewProjectModal)이 부르는 서버 액션 createProject 를 같은 방식(fetch action)으로 부른다.
  // 액션 id 는 빌드마다 달라 next dev 가 쓴 매니페스트에서 읽는다(위 GET /projects 가 그 페이지를 컴파일시켰다).
  const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8'))
  const action = findActionId(manifest, { filename: 'src/app/actions/project.ts', exportedName: 'createProject' })
  const page = action.workers.find((w) => w.endsWith('/projects/page'))
  if (!page) throw new Fail(`createProject 가 /projects 페이지에 묶여 있지 않다(${action.workers.join(', ')})`)
  const projectName = `E2E 샘플 프로젝트 ${new Date().toISOString().slice(0, 16).replace(/\D/g, '')}`
  await http('POST', '/projects', {
    body: JSON.stringify([projectName, null, null, null, LEVEL_LABELS]),
    headers: { 'next-action': action.id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component', origin: base },
  })
  // 액션 응답(RSC)을 해석하지 않고 결과를 DB 에서 확인한다 — 같은 이름 정확히 1건 + 입력한 라벨 그대로.
  const { data: projects, error: pErr } = await sb.from('projects').select('id,name').eq('name', projectName)
  if (pErr) throw new Fail(`프로젝트 조회 실패: ${pErr.message}`)
  if (projects.length !== 1) throw new Fail(`생성된 프로젝트가 ${projects.length}건`)
  const projectId = projects[0].id
  const { data: settings, error: sErr } = await sb.from('project_settings').select('level_labels,max_depth').eq('project_id', projectId).single()
  if (sErr) throw new Fail(`프로젝트 설정 조회 실패: ${sErr.message}`)
  if (JSON.stringify(settings.level_labels) !== JSON.stringify(LEVEL_LABELS)) {
    throw new Fail(`단계 라벨이 다르다: ${JSON.stringify(settings.level_labels)}`)
  }
  step('create-project', { path: `server action createProject(${action.id.slice(0, 12)}…) via POST /projects`, projectId, projectName, settings })

  // ── 3. 양식 다운로드 → 행 채우기 → inspect → execute (ImportWizard 와 같은 폼 필드·기본값: append, saveProfile)
  const template = Buffer.from(await (await http('GET', '/api/import/template')).arrayBuffer())
  writeFileSync(join(outDir, 'wbs-template.xlsx'), template)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template)
  const ws = wb.getWorksheet('WBS')
  if (!ws) throw new Fail("양식에 'WBS' 시트가 없다")
  const header = ws.getRow(1).values.slice(1)
  if (JSON.stringify(header) !== JSON.stringify(TEMPLATE_HEADER)) throw new Fail(`양식 헤더가 다르다: ${JSON.stringify(header)}`)
  // 예시 행 자리에 덮어쓰고 남는 예시 행은 비운다(spliceRows 는 SheetJS 가 쓴 시트에서 행을 지우지 못했다 — 2026-09-24 실측).
  const rows = e2eRows(team)
  const lastExample = ws.rowCount
  rows.forEach((r, i) => { ws.getRow(i + 2).values = r.map(toCell) })
  for (let n = rows.length + 2; n <= lastExample; n++) ws.getRow(n).values = []
  const filled = Buffer.from(await wb.xlsx.writeBuffer())
  const check = new ExcelJS.Workbook()
  await check.xlsx.load(filled)
  const written = check.getWorksheet('WBS').actualRowCount
  if (written !== rows.length + 1) throw new Fail(`채운 양식의 WBS 시트가 ${written}행(기대 헤더+${rows.length})`)
  writeFileSync(join(outDir, 'wbs-filled.xlsx'), filled)
  step('fill-template', { rows: rows.length, file: join(outDir, 'wbs-filled.xlsx') })

  const inspectForm = new FormData()
  inspectForm.append('file', xlsxBlob(filled), 'wbs-filled.xlsx')
  inspectForm.append('projectId', projectId)
  const inspected = await (await http('POST', '/api/import/inspect', { body: inspectForm })).json()
  const profile = inspected.detection.profile
  step('import-inspect', { hierarchy: profile.hierarchy, teamColumns: profile.teamColumns, warnings: inspected.detection.warnings })

  const execute = async (mode) => {
    const form = new FormData()
    form.append('file', xlsxBlob(filled), 'wbs-filled.xlsx')
    form.append('projectId', projectId)
    form.append('profile', JSON.stringify(profile))
    form.append('mode', mode)
    form.append('saveProfile', 'true')
    form.append('registerTeams', 'false') // 부트스트랩 팀이 이미 등록돼 있어야 한다 — 409(needsTeams)면 실패
    return (await http('POST', '/api/import/execute', { body: form })).json()
  }
  const importedItems = async () => {
    const { data, error } = await sb.from('wbs_items')
      .select('code,name,level_idx,item_owners(kind,teams(code))').eq('project_id', projectId).order('code')
    if (error) throw new Fail(`WBS 조회 실패: ${error.message}`)
    if (data.length !== rows.length) throw new Fail(`임포트 뒤 WBS 가 ${data.length}행(기대 ${rows.length})`)
    const owned = data.filter((i) => i.item_owners.some((o) => o.teams?.code === team))
    const expectOwned = rows.filter((r) => r.at(-1) === team).length
    if (owned.length !== expectOwned) throw new Fail(`팀 ${team} 담당 행이 ${owned.length}건(기대 ${expectOwned})`)
    return data
  }
  const appended = await execute('append')
  step('import-append', { response: appended, items: await importedItems() })

  // replace — 같은 파일로 트리를 통째로 갈아 끼운다. 백업은 교체 전 5행이어야 하고, 교체 뒤에도 5행이다(중복 없음).
  const replaced = await execute('replace')
  if (replaced.backup?.rows?.length !== rows.length) throw new Fail(`replace 백업이 ${replaced.backup?.rows?.length}행(기대 ${rows.length})`)
  step('import-replace', {
    response: { ...replaced, backup: { rows: replaced.backup.rows.length, generatedAt: replaced.backup.generatedAt } },
    items: await importedItems(),
  })

  // ── 4. 내보내기 — 리포트 화면의 주간보고 PPT·엑셀, WBS 화면의 엑셀.
  const exports = [
    ['report-pptx', `/api/report?projectId=${projectId}&format=pptx`, 'report.pptx'],
    ['report-xlsx', `/api/report?projectId=${projectId}&format=xlsx`, 'report.xlsx'],
    ['wbs-xlsx', `/api/export?projectId=${projectId}`, 'wbs_export.xlsx'],
  ]
  for (const [kind, path, fallback] of exports) {
    const res = await http('GET', path)
    const buf = Buffer.from(await res.arrayBuffer())
    const file = join(outDir, dispositionFilename(res.headers.get('content-disposition'), fallback))
    writeFileSync(file, buf)
    summary.artifacts.push({ kind, file, bytes: buf.length, contentType: res.headers.get('content-type') })
  }
  step('export', { files: summary.artifacts.map((a) => a.file) })

  // ── 5. 산출물 zip 의 모든 항목(XML·rels·docProps·미디어)을 UTF-8 로 풀어 흔적 검사.
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
  step('trace-scan', { entriesScanned: summary.artifacts.reduce((n, a) => n + a.entries, 0), hits: traced.length })
  if (traced.length) throw new Fail(`흔적 적중: ${JSON.stringify(traced.map((a) => ({ file: a.file, traces: a.traces })))}`)
}

try {
  await main()
  summary.ok = true
} catch (e) {
  summary.ok = false
  summary.error = e?.message ?? String(e)
  if (!(e instanceof Fail)) console.error(e)
  process.exitCode = 1
}
console.log(JSON.stringify(summary, null, 2))
