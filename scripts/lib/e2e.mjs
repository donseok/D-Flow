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

/** 존재 은닉 대조용 타 워크스페이스 = SP2 흐름의 워크스페이스 B(워크스페이스 생성 화면은 SP3 — 그전까지는 service_role 픽스처). */
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

/**
 * createProjectInvite 입력 — 멤버, 팀은 받은 순서(첫 팀이 대표 후보, 빈 배열 = 팀 없음). 받는 사람은 기본 carol.
 * @param {string[]} teamIds @param {string} [email]
 */
export function inviteInput(teamIds, email = INVITEE.email) {
  return { email, accessRole: 'member', teamIds: [...teamIds] }
}

/** redeemInviteWithSignup 입력 — 이메일은 싣지 않는다(서버가 초대 행의 이메일로만 계정을 만든다). @param {string} name @param {string} password */
export function signupInput(name, password) {
  return { name, password, passwordConfirmation: password }
}

/** 조회 전용(viewer) 쓰기 거부 문구 — src/lib/authz/errors.ts ERR_DENIED(드리프트는 tests/scripts/e2e.test.ts 가 대조). */
export const ERR_DENIED = '권한 없음'

/**
 * 렌더된 HTML 의 문구 표식 — DegradedNotice(권한·목록 조회 실패), (app)/error.tsx 경계, Next 오류 문서.
 * error.tsx 문구는 보조다: 'use client' 클래스 경계라 서버 렌더가 돌리지 않는다. (app)/loading.tsx 가 셸을 먼저 흘려보낸 뒤
 * 서버 컴포넌트가 던지면 HTML 에는 digest 만 남고 경계는 브라우저에서 그려진다(streamedErrorDigests 가 주 판정).
 * 문구가 앱과 어긋나지 않는지는 tests/scripts/e2e.test.ts 가 원본 파일과 대조한다.
 */
export const PAGE_MARKERS = [
  ['degraded', '일부 정보를 불러오지 못했습니다'],
  ['error-boundary', '화면을 불러오지 못했습니다'],
  ['next-error', 'id="__next_error__"'],
]

/** 정상 화면에도 있는 digest 값 — 메타데이터 경계의 빈 자리(`"digest":"$undefined"`). */
const BENIGN_DIGEST = '$undefined'
/** notFound() 의 digest 접두 — 오류가 아니라 은닉 판정 몫(notFoundRendered). */
const NOT_FOUND_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK;'

/**
 * 스트리밍으로 흘러간 서버 오류의 digest 들. 서버 컴포넌트가 셸 뒤에 던지면 Next 는 HTTP 200 그대로
 * (1) RSC 인라인 페이로드에 Flight 오류 행 `<id>:E{"digest":"…"}` 을, (2) HTML 에 클라이언트 렌더 전환
 * `<template data-dgst="…">` 를 싣는다(2026-09-26 로컬 실측 — tests/scripts/fixtures/page-streamed-error.html.gz).
 * 인라인 페이로드는 JSON 문자열 안이라 따옴표가 `\"` 로 이스케이프돼 있다. notFound digest 와 `$undefined` 는 뺀다.
 * @param {string} html
 * @returns {string[]}
 */
export function streamedErrorDigests(html) {
  const text = String(html)
  const found = new Set()
  for (const m of text.matchAll(/"digest\\*":\\*"([^"\\]*)/g)) found.add(m[1])
  for (const m of text.matchAll(/data-dgst="([^"]*)"/g)) found.add(m[1])
  return [...found].filter((d) => d !== BENIGN_DIGEST && !d.startsWith(NOT_FOUND_DIGEST)).sort()
}

/**
 * 열려야 하는 화면의 문제 목록 — 스트리밍된 서버 오류('error-digest:<d>'), notFound(열려야 하는 화면이 은닉됨),
 * 문구 표식, 있어야 할 데이터가 없는 것('missing:<문구>'). 조회 실패를 로그만 남기고 빈 목록으로 그리는 화면은
 * 오류 표식이 없으므로, 흐름에서 만든 데이터가 HTML(SSR·RSC 페이로드)에 있는지로 잡는다. expectTexts 는 레이아웃
 * (사이드바·헤더의 프로젝트 이름 등)이 아니라 그 페이지 세그먼트만 그리는 문구여야 한다 — 레이아웃 문구는 페이지가
 * 깨져도 HTML 에 있다.
 * @param {string} html @param {readonly string[]} [expectTexts]
 */
export function pageProblems(html, expectTexts = []) {
  const text = String(html)
  return [
    ...streamedErrorDigests(text).map((d) => `error-digest:${d}`),
    ...(notFoundRendered(text) ? ['not-found'] : []),
    ...PAGE_MARKERS.filter(([, marker]) => text.includes(marker)).map(([name]) => name),
    ...expectTexts.filter((t) => !text.includes(t)).map((t) => `missing:${t}`),
  ]
}

/**
 * 러너 출력(실패 메시지·스택)에서 초대 토큰을 가린다. 토큰은 미소비 초대의 자격 증명이고 결과 JSON 은 파일로 남는다.
 * @param {string} text
 */
export function redactInviteTokens(text) {
  return String(text).replace(/\/invite\/[0-9a-f-]{36}/gi, '/invite/<token>')
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

// ── SP2 흐름(2-워크스페이스 격리) ─────────────────────────────────────────────────────────────────
// 워크스페이스 A = 부트스트랩 워크스페이스, 워크스페이스 B = OTHER_WORKSPACE(생성 화면은 SP3 라 행만 service_role 로 만든다).

/**
 * 워크스페이스 A 의 관리자 — 플랫폼 관리자가 아니다. 부트스트랩 계정은 플랫폼 관리자라 모든 가드가 워크스페이스와 무관하게
 * 통과하고 외부 API 도 전 워크스페이스를 본다 — 그 계정으로 재면 워크스페이스 경계 시험이 비어 버린다.
 */
export const A_ADMIN = Object.freeze({ email: 'e2e-ana@example.com', name: 'ana' })
/** 워크스페이스 B 의 관리자(플랫폼 관리자 아님). 비밀번호는 env E2E_B_PASSWORD(러너가 출력하지 않는다). */
export const B_ADMIN = Object.freeze({ email: 'e2e-bea@example.com', name: 'bea' })
/** A 관리자가 새 프로젝트(E2E A2)에 멤버로 초대하는 외부 이메일 — 합류 뒤 워크스페이스 소속은 A 하나여야 한다. */
export const OUTSIDER = Object.freeze({ email: 'e2e-outsider@example.com', name: 'outsider' })
/** 워크스페이스 A 의 공용 팀 — 프로젝트 없는 회의록의 담당(프로젝트 팀은 그 프로젝트의 회의록에만 쓸 수 있다). */
export const WS_TEAM = 'OPS'

/**
 * createAccount 입력 — 그 워크스페이스의 관리자로, 프로젝트 권한 없이(명단 행 없음). 서버 액션 인자라 undefined 를 싣지 않는다.
 * @param {{ workspaceId: string, email: string, name: string, password: string }} p
 */
export function workspaceAdminAccountInput({ workspaceId, email, name, password }) {
  return { workspaceId, email, password, name, workspaceRole: 'admin', projectId: null, accessRole: null }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 회의록 본문 파일의 Storage 키 — src/lib/domain/storagePath.ts makeStoragePath(entity 'minutes')와 같은 규약·같은 거부
 * (드리프트는 tests/scripts/e2e.test.ts 가 앱 함수와 대조). 프로젝트가 없으면 세그먼트는 '_'.
 * @param {{ workspaceId: string, projectId: string | null, minuteId: string, fileName: string }} p
 */
export function minuteBodyPath({ workspaceId, projectId, minuteId, fileName }) {
  const nameOk = typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 200 && !fileName.includes('/')
    && fileName !== '.' && fileName !== '..' && !/[\s\p{Cc}]/u.test(fileName.replace(/ /g, ''))
  if (!UUID_RE.test(workspaceId) || (projectId !== null && !UUID_RE.test(projectId)) || !UUID_RE.test(minuteId) || !nameOk) {
    throw new Error('저장 경로 입력이 올바르지 않습니다.')
  }
  return `ws/${workspaceId}/p/${projectId ?? '_'}/minutes/${minuteId}/${fileName}`
}

/**
 * Storage 객체 이름이 그 워크스페이스의 규약 경로(ws/<wid>/p/<pid|_>/<entity>/<id>/<file>, 7 세그먼트)인가.
 * 접두만 보지 않는다 — 'ws/<wid>/p/../..' 같은 이름은 규약 경로가 아니다(스토리지 RLS 의 storage_ws 와 같은 모양 판정).
 * @param {string} name @param {string} workspaceId
 */
export function inWorkspaceStorage(name, workspaceId) {
  const s = String(name ?? '').split('/')
  if (s.length !== 7 || s[0] !== 'ws' || s[2] !== 'p') return false
  const [, ws, , pid, entity, id, file] = s
  return ws.toLowerCase() === String(workspaceId).toLowerCase() && (pid === '_' || UUID_RE.test(pid))
    && ['minutes', 'minute-files', 'deliverables', 'issue-attachments'].includes(entity) && UUID_RE.test(id)
    && file.length > 0 && file.length <= 200
}

/**
 * createMinute 입력(MinuteInput) — 회의 미연결, 프로젝트 지정(projectId) 또는 미지정(null).
 * @param {{ date: string, teamCode: string, title: string, bodyMd: string, projectId: string | null }} p
 */
export function minuteInput({ date, teamCode, title, bodyMd, projectId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`회의록 날짜 형식이 아니다: ${date}`)
  return { minuteDate: date, teamCode, title, bodyMd, meetingId: null, projectId, meetingOccurrenceDate: null }
}

/**
 * createMinute 의 셋째 인자(MinuteCreateSource) — 화면(MinuteUploadModal)처럼 선발급한 회의록 id 와 이미 올린 본문 파일 메타.
 * @param {{ minuteId: string, fileName: string, filePath: string, size: number }} p
 */
export function minuteSource({ minuteId, fileName, filePath, size }) {
  return { minuteId, file: { fileName, filePath, size, mime: 'text/markdown' } }
}

/**
 * 보여선 안 되는 것 중 보인 것 — 교차 워크스페이스 누설 판정(순서는 seen 첫 등장 순, 중복 제거).
 * @param {Iterable<string>} seen @param {Iterable<string>} forbidden
 */
export function leakedIds(seen, forbidden) {
  const f = new Set(forbidden)
  return [...new Set(seen)].filter((x) => f.has(x))
}

/**
 * HTML(SSR·RSC 페이로드)에 들어 있는 문구 — 없어야 할 이름·제목이 실렸는지 본다(pageProblems 의 missing 의 반대).
 * @param {string} html @param {readonly string[]} texts
 */
export function presentTexts(html, texts) {
  const text = String(html)
  return texts.filter((t) => text.includes(t))
}
