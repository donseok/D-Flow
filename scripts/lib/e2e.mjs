// scripts/lib/e2e.mjs — e2e-local.mjs 의 순수 조각(부작용 없음). vitest 로 고정한다.
// 러너는 로컬 스택만 두드린다 — 대상 판정은 targets.mjs 한 곳에서 한다.
import { classifySupabaseUrl, detectEnvTarget, parseEnvFile } from './targets.mjs'

/** 새 프로젝트의 단계 라벨(SP0 done_when 1번). 행의 아웃라인 깊이와 같아야 한다. */
export const LEVEL_LABELS = ['단계', '작업', '활동']

/** 양식 헤더 — src/lib/excel/template.ts TEMPLATE_HEADER 와 같아야 한다(테스트가 드리프트를 잡는다). */
export const TEMPLATE_HEADER = ['코드', '업무명', '업무영역', '산출물', '시작일', '종료일', '가중치', '실적%', '담당']

/**
 * 양식에 채울 행 — 아웃라인 3층(LEVEL_LABELS 와 같은 깊이), 담당은 팀명 직접 방식으로 팀 하나(SP1: 프로젝트 A 의
 * 첫 팀 — 부트스트랩은 더 이상 팀을 만들지 않는다). 날짜는 ISO 로 두고 러너가 toCell 로 바꾼다. 빈 칸은 ''(toCell 이 null 로 바꾼다).
 * @param {string} team
 */
export function e2eRows(team) {
  return [
    ['1',     '설계',          '공통', '',               '2026-09-21', '2026-10-16', 1,   '', ''],
    ['1.1',   '요구 분석',     '공통', '',               '2026-09-21', '2026-10-02', 0.5, '', ''],
    ['1.1.1', '요구사항 정리', '공통', '요구사항 정의서', '2026-09-21', '2026-10-02', 1,   '', team],
    ['1.2',   '화면 설계',     '공통', '',               '2026-10-05', '2026-10-16', 0.5, '', ''],
    ['1.2.1', '화면 정의',     '공통', '화면 정의서',     '2026-10-05', '2026-10-16', 1,   '', team],
  ]
}

/**
 * exceljs 셀 값. 'YYYY-MM-DD' → UTC 정오 Date — exceljs 는 Date 를 UTC 로 시리얼화하므로 정오여야 어느 시간대에서
 * 읽어도 하루가 밀리지 않는다(양식의 d() 가 로컬 정오인 것은 SheetJS 가 로컬 시각으로 시리얼화하기 때문). '' → null(빈 셀).
 */
export function toCell(v) {
  if (v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const [y, m, d] = v.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/**
 * .env.local 텍스트 → 로그인에 쓸 { url, anonKey }. 로컬이 아니거나 키가 모호하면 throw(fail-closed).
 * detectEnvTarget 은 첫 URL 줄, parseEnvFile 은 끝 줄을 본다 — 둘이 갈라지는 파일(중복 키)은 거절한다.
 */
export function localClientEnv(envText) {
  const verdict = detectEnvTarget(envText, {})
  if (verdict !== 'local') throw new Error(`.env.local 이 로컬을 가리키지 않는다(${verdict}) — npm run env:local 뒤 다시 실행한다`)
  const { values, duplicates } = parseEnvFile(envText)
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    if (duplicates.includes(key)) throw new Error(`${key} 가 두 번 이상 있다 — 어느 값이 쓰일지 모호하다`)
    if (!values[key]) throw new Error(`${key} 가 없다`)
  }
  return { url: values.NEXT_PUBLIC_SUPABASE_URL, anonKey: values.NEXT_PUBLIC_SUPABASE_ANON_KEY }
}

/** 앱 주소도 로컬만 — 세션 쿠키를 원격 배포에 실어 보내지 않는다. 끝 슬래시는 떼어 돌려준다. */
export function localAppUrl(value) {
  const url = String(value ?? '').trim()
  if (classifySupabaseUrl(url, {}) !== 'local') throw new Error(`앱 주소가 로컬이 아니다(${JSON.stringify(url)})`)
  return url.replace(/\/+$/, '')
}

/** [{ name, value }] → Cookie 헤더. 빈 값(삭제 표식)은 뺀다. */
export function cookieHeader(cookies) {
  return cookies.filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * next dev 의 server-reference-manifest.json 에서 서버 액션 id 를 찾는다. 정확히 하나가 아니면 throw —
 * 엉뚱한 액션을 부르느니 멈춘다. worker 는 그 액션을 가진 페이지 경로(app/(app)/projects/page 등) 목록이다.
 * Next 는 src 디렉터리를 쓰는 프로젝트의 filename 을 src 기준(app/actions/…)으로 적는다 — 앞의 src/ 는 떼고 비교한다.
 */
export function findActionId(manifest, { filename, exportedName }) {
  const norm = (p) => String(p ?? '').replace(/^src\//, '')
  const hits = []
  for (const runtime of ['node', 'edge']) {
    for (const [id, entry] of Object.entries(manifest?.[runtime] ?? {})) {
      if (norm(entry?.filename) === norm(filename) && entry?.exportedName === exportedName) {
        hits.push({ id, workers: Object.keys(entry.workers ?? {}) })
      }
    }
  }
  if (hits.length !== 1) {
    throw new Error(`서버 액션 ${filename}#${exportedName} 가 매니페스트에 ${hits.length}건 — 해당 페이지를 먼저 한 번 열었는지 확인한다`)
  }
  return hits[0]
}

/** Content-Disposition 의 filename*(RFC 5987) 우선, 없으면 filename. 경로 구분자는 '_' 로 무해화한다. */
export function dispositionFilename(header, fallback) {
  const text = String(header ?? '')
  const star = text.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  const plain = text.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
  let name = fallback
  if (star) { try { name = decodeURIComponent(star.trim()) } catch { name = plain ?? fallback } } else if (plain) name = plain
  return name.replace(/[/\\]/g, '_')
}

/**
 * 산출물에 남으면 안 되는 원 고객사·인물 흔적(SP0 스펙 9절 + 플랜 부록 A 확장 grep, XML 엔티티 표기 포함) 28개.
 * base64 로 두는 이유: 평문으로 적으면 이 목록 자체가 트리 전수 grep 에 걸리는 흔적이 된다.
 * 대소문자 무시·부분일치 — 짧은 토막도 있으므로 적중은 사람이 확인한다(오탐이면 근거를 남긴다).
 */
export const TRACE_WORDS = Object.freeze(Buffer.from(
  'ZC1jdWJlCmRjdWJlCmRvbmdrdWsK64+Z6rWtCmQnZmxvdwpkJmFwb3M7ZmxvdwpkJiMzOTtmbG93CmRrYm90CmRrIGJvdApoZWVzZXVuZwpqYW5nCuyepeyiheydtQpka2dyb3VwCmRrY2hlbQrslKjsl6AK7KCc6rCVCu2ZgOuUqeyKpArsi5zsiqTthZzspogKamppbmllCmpqaS0K67aA7IKwCnRyYWNrMwptZXMtYmFzZQptZXMtcnVubG9nCm1lcy1za2VsCm1lcy1vcAptZXMtcWEKbWRtLWRpY3Q=',
  'base64',
).toString('utf8').split('\n'))

const TRACE_RE = new RegExp(TRACE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')

/** [{ name, text }] → 적중 [{ name, matches }]. 적중이 없는 항목은 빠진다. */
export function findTraces(entries) {
  const hits = []
  for (const { name, text } of entries) {
    const matches = [...String(text).matchAll(TRACE_RE)].map((m) => m[0])
    if (matches.length) hits.push({ name, matches })
  }
  return hits
}

// ── SP1 흐름(다중 팀·외부 인력·초대 수락·존재 은닉) ───────────────────────────────────────────────

/** 프로젝트 팀(addProjectTeam) — A 는 두 팀(한 사람이 여러 팀), B 는 한 팀. WBS 임포트 담당은 A 의 첫 팀. */
export const SP1_TEAMS = Object.freeze({ A: Object.freeze(['ERP', 'MES']), B: Object.freeze(['QA']) })

/** 초대받는 사람 — 예시 도메인(INVITE_ALLOWED_DOMAINS=example.com 이어야 발급된다). */
export const INVITEE = Object.freeze({ email: 'carol@example.com', name: 'carol' })

/** 존재 은닉 대조용 타 워크스페이스(워크스페이스 생성 화면·액션은 SP2 — 그전까지는 service_role 픽스처). */
export const OTHER_WORKSPACE = Object.freeze({ slug: 'e2e-other', name: 'E2E 타 워크스페이스' })

/** @param {unknown} v @param {string} at */
function encodeValue(v, at) {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`서버 액션 인자 ${at} 를 직렬화할 수 없다(${v})`)
    return v
  }
  if (typeof v === 'string') return v.startsWith('$') ? `$${v}` : v
  if (Array.isArray(v)) return v.map((x, i) => encodeValue(x, `${at}[${i}]`))
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x, `${at}.${k}`)]))
  }
  throw new Error(`서버 액션 인자 ${at} 를 직렬화할 수 없다(${typeof v === 'object' ? Object.prototype.toString.call(v) : typeof v})`)
}

/**
 * 서버 액션 인자 배열 → 요청 본문(text/plain). 화면의 React encodeReply 가 평문 값에 쓰는 것과 같은 규칙이다 —
 * JSON 배열이고 '$' 로 시작하는 문자열은 '$$' 로 한 번 더 감싼다(서버가 '$…' 를 참조 표기로 읽기 때문).
 * undefined·Date·Map 처럼 encodeReply 가 특수 표기로 보내는 값은 이 러너가 흉내 내지 않고 거절한다(보낸 것 = 서버가 읽은 것).
 * @param {unknown[]} args
 */
export function encodeActionArgs(args) {
  if (!Array.isArray(args)) throw new Error('서버 액션 인자는 배열이어야 한다')
  return JSON.stringify(args.map((a, i) => encodeValue(a, `#${i}`)))
}

/** 길이 접두 행(T 텍스트·타입 배열) 태그 — `<id>:<tag><hex 바이트 길이>,<본문>` 이고 줄바꿈으로 끝나지 않는다. */
const LENGTH_TAGS = new Set('TABOoUSsLlGgMmV'.split(''))

/**
 * RSC(Flight) 응답 → Map<행 id, { tag, body }>. 행은 `<hex id>:<tag?><payload>\n` 이고 길이 접두 행만 바이트 길이로 끊는다
 * (본문에 줄바꿈이 있어도 다음 행으로 오인하지 않게). 힌트 행(`:HL…`)처럼 id 가 빈 행도 있다.
 * @param {string | Buffer} body
 */
function parseFlightRows(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8')
  const rows = new Map()
  let i = 0
  while (i < buf.length) {
    if (buf[i] === 0x0a) { i++; continue }
    const colon = buf.indexOf(0x3a, i)
    const id = colon < 0 ? null : buf.toString('utf8', i, colon)
    if (id === null || !/^[0-9a-f]*$/.test(id)) throw new Error(`Flight 행이 아니다: ${JSON.stringify(buf.toString('utf8', i, i + 40))}`)
    const tag = String.fromCharCode(buf[colon + 1] ?? 0)
    if (LENGTH_TAGS.has(tag)) {
      const comma = buf.indexOf(0x2c, colon + 2)
      const hex = comma < 0 ? '' : buf.toString('utf8', colon + 2, comma)
      if (/^[0-9a-f]+$/.test(hex)) {
        const start = comma + 1
        const end = start + parseInt(hex, 16)
        if (end > buf.length) throw new Error(`Flight 행 ${id} 가 잘렸다`)
        rows.set(id, { tag, body: buf.toString('utf8', start, end) })
        i = end
        continue
      }
    }
    const nl = buf.indexOf(0x0a, colon + 1)
    const end = nl < 0 ? buf.length : nl
    const payload = buf.toString('utf8', colon + 1, end)
    const m = payload.match(/^([A-Z]+)?([\s\S]*)$/)
    rows.set(id, { tag: m?.[1] ?? '', body: m?.[2] ?? '' })
    i = end + 1
  }
  return rows
}

/**
 * @param {unknown} v @param {Map<string, { tag: string, body: string }>} rows @param {Set<string>} seen
 * @returns {unknown}
 */
function decodeFlight(v, rows, seen) {
  if (typeof v === 'string' && v.startsWith('$')) {
    if (v.startsWith('$$')) return v.slice(1)
    if (v === '$undefined') return undefined
    if (v.startsWith('$D')) return v.slice(2)
    const ref = v.match(/^\$@?([0-9a-f]+)$/)?.[1]
    if (ref !== undefined) return resolveFlightRow(ref, rows, seen)
    throw new Error(`지원하지 않는 Flight 값 ${JSON.stringify(v)} — 결과가 평문 객체가 아니다`)
  }
  if (Array.isArray(v)) return v.map((x) => decodeFlight(x, rows, seen))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeFlight(x, rows, seen)]))
  return v
}

/** @param {string} id @param {Map<string, { tag: string, body: string }>} rows @param {Set<string>} seen */
function resolveFlightRow(id, rows, seen) {
  const row = rows.get(id)
  if (!row) throw new Error(`Flight 행 ${id} 가 응답에 없다`)
  if (seen.has(id)) throw new Error(`Flight 행 ${id} 가 순환 참조다`)
  if (row.tag === 'E') {
    let message = row.body
    try { message = JSON.parse(row.body).message ?? row.body } catch { /* 원문 그대로 */ }
    throw new Error(`서버 액션이 오류를 던졌다: ${message}`)
  }
  if (row.tag !== '') throw new Error(`Flight 행 ${id} 가 값 행이 아니다(태그 ${row.tag})`)
  const next = new Set(seen).add(id)
  return decodeFlight(JSON.parse(row.body), rows, next)
}

/**
 * 서버 액션 응답 본문(text/x-component) → 액션의 반환값. 루트 행 0 은 { a: 결과(프로미스 참조 "$@n"), f: 트리, b: 빌드 id } 다
 * (next/dist/server/app-render/app-render.js). 액션이 던졌으면(E 행) 그 메시지로 throw — 성공으로 흘려보내지 않는다.
 * @param {string | Buffer} body
 */
export function actionResult(body) {
  const rows = parseFlightRows(body)
  const root = rows.get('0')
  let parsed = null
  try { parsed = root && root.tag === '' ? JSON.parse(root.body) : null } catch { parsed = null }
  if (!parsed || typeof parsed !== 'object' || !('a' in parsed)) throw new Error('서버 액션 응답이 아니다(루트 행 0 에 a 가 없다)')
  return decodeFlight(parsed.a, rows, new Set(['0']))
}

const UUID_PATH = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * 초대 발급 응답의 url → 토큰. DB 에는 해시만 있어 이 응답이 토큰의 유일한 출처다.
 * origin 이 앱 주소와 다르면 NEXT_PUBLIC_APP_URL 이 틀린 것 — 그 링크는 메일로 나가도 쓸 수 없다.
 * @param {unknown} url @param {string} base
 */
export function inviteTokenFromUrl(url, base) {
  let u
  try { u = new URL(String(url ?? '')) } catch { throw new Error(`초대 링크가 URL 이 아니다: ${JSON.stringify(url)}`) }
  if (u.origin !== new URL(base).origin) throw new Error(`초대 링크 origin ${u.origin} 이 앱 주소 ${base} 와 다르다(NEXT_PUBLIC_APP_URL 확인)`)
  const token = u.pathname.match(UUID_PATH)?.[1]
  if (!token) throw new Error(`초대 링크 경로가 /invite/<uuid> 가 아니다: ${u.pathname}`)
  return token
}

/**
 * teams 조회 행 → 그 프로젝트의 코드 순서대로 id. 없거나 둘 이상이면 throw(엉뚱한 팀을 명단에 싣느니 멈춘다).
 * @param {Array<{ id: string, code: string, project_id: string | null }>} rows @param {string} projectId @param {readonly string[]} codes
 */
export function teamIdsByCode(rows, projectId, codes) {
  return codes.map((code) => {
    const hits = rows.filter((r) => r.project_id === projectId && r.code === code)
    if (hits.length !== 1) throw new Error(`프로젝트 ${projectId} 의 팀 ${code} 가 ${hits.length}건`)
    return hits[0].id
  })
}

/**
 * upsertRosterMember 입력 셋 — 본인@A 관리자 [A 팀 전부](첫 팀 대표), 외부 인력 bob@A(이메일·권한·팀 없음), 본인@B 멤버 [B 팀].
 * @param {{ selfName: string, selfEmail: string, teamIds: { A: string[], B: string[] } }} p
 */
export function rosterPlan({ selfName, selfEmail, teamIds }) {
  const email = selfEmail.trim().toLowerCase()
  return {
    selfA: { name: selfName, email, accessRole: 'admin', roleLabel: 'PM', title: null, teamIds: [...teamIds.A] },
    bob: { name: 'bob', email: null, accessRole: null, roleLabel: '외부 개발', title: null, teamIds: [] },
    selfB: { name: selfName, email, accessRole: 'member', roleLabel: null, title: null, teamIds: [...teamIds.B] },
  }
}

/** @param {unknown} v */
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? null

/**
 * 명단 조회 행(project_members + people + project_member_teams(teams)) → 비교용 평면 행. 대표 팀 먼저, 나머지는 코드순, 이름순 정렬.
 * @param {Array<Record<string, any>>} rows
 */
export function rosterView(rows) {
  return rows.map((r) => {
    const pe = one(r.people)
    if (!pe) throw new Error(`명단 행 ${r.id} 에 인물이 없다`)
    const teams = (r.project_member_teams ?? [])
      .map((/** @type {Record<string, any>} */ l) => ({ code: one(l.teams)?.code ?? null, primary: Boolean(l.is_primary) }))
      .filter((/** @type {{ code: string | null }} */ l) => l.code)
      .sort((/** @type {{ code: string, primary: boolean }} */ a, /** @type {{ code: string, primary: boolean }} */ b) =>
        Number(b.primary) - Number(a.primary) || a.code.localeCompare(b.code))
      .map((/** @type {{ code: string }} */ l) => l.code)
    return {
      memberId: r.id, name: pe.display_name, email: pe.email ?? null, accessRole: r.access_role ?? null,
      linked: Boolean(pe.user_id), teams,
    }
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** 자식이 없는 코드 — 담당 지정은 리프에. @param {Array<Array<string | number>>} rows */
export function leafCodes(rows) {
  const codes = rows.map((r) => String(r[0]))
  return codes.filter((c) => !codes.some((o) => o.startsWith(`${c}.`)))
}

/** createMeeting 입력 — 단발 킥오프 1건. @param {{ date: string, attendeeIds: string[] }} p */
export function meetingInput({ date, attendeeIds }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`회의 날짜 형식이 아니다: ${date}`)
  return {
    title: 'E2E 킥오프', meetingDate: date, startTime: '10:00', endTime: '11:00', location: null,
    category: 'kickoff', body: '', recurrence: 'none', recurrenceUntil: null, attendeeIds: [...attendeeIds],
  }
}

/** createProjectInvite 입력 — carol 멤버, 팀은 받은 순서(첫 팀이 대표 후보). @param {string[]} teamIds */
export function inviteInput(teamIds) {
  return { email: INVITEE.email, accessRole: 'member', teamIds: [...teamIds] }
}

/** redeemInviteWithSignup 입력 — 이메일은 싣지 않는다(서버가 초대 행의 이메일로만 계정을 만든다). @param {string} name @param {string} password */
export function signupInput(name, password) {
  return { name, password, passwordConfirmation: password }
}

/** 렌더된 HTML 의 오류 표식 — (app)/error.tsx 경계, DegradedNotice(권한·목록 조회 실패), Next 오류 문서. */
const PAGE_PROBLEMS = [
  ['error-boundary', '화면을 불러오지 못했습니다'],
  ['degraded', '일부 정보를 불러오지 못했습니다'],
  ['next-error', 'id="__next_error__"'],
]

/**
 * 오류 표식 + 있어야 할 데이터가 없는 것('missing:<문구>'). 조회 실패를 로그만 남기고 빈 목록으로 그리는 화면은
 * 오류 표식이 없으므로, 흐름에서 만든 데이터(회의 제목·명단 이름 등)가 HTML(SSR·RSC 페이로드)에 있는지로 잡는다.
 * @param {string} html @param {readonly string[]} [expectTexts]
 */
export function pageProblems(html, expectTexts = []) {
  const text = String(html)
  return [
    ...PAGE_PROBLEMS.filter(([, marker]) => text.includes(marker)).map(([name]) => name),
    ...expectTexts.filter((t) => !text.includes(t)).map((t) => `missing:${t}`),
  ]
}

/**
 * 서버가 notFound() 를 냈는가 — /p/[projectId] 레이아웃의 존재 은닉. (app)/loading.tsx 가 셸을 먼저 흘려보내므로 HTTP 상태는
 * 이미 200 이고, notFound 는 RSC 페이로드의 digest(NEXT_HTTP_ERROR_FALLBACK;404)로만 남아 클라이언트가 not-found 화면을 그린다.
 * 상태 코드만 보면 은닉 여부를 판정할 수 없다(2026-09-25 로컬 실측).
 * @param {string} html
 */
export function notFoundRendered(html) {
  return String(html).includes('NEXT_HTTP_ERROR_FALLBACK;404')
}
