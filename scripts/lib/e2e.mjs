// scripts/lib/e2e.mjs — e2e-local.mjs·e2e-synthetic.mjs 의 순수 조각(부작용 없음). vitest 로 고정한다.
// 러너는 로컬 스택만 두드린다 — 대상 판정은 targets.mjs 한 곳에서 한다.
import ExcelJS from 'exceljs'
import { findSentinels, sp4Sentinels, zipTextParts } from './sentinels.mjs'
import { classifySupabaseUrl, detectEnvTarget, parseEnvFile } from './targets.mjs'

/** 새 프로젝트의 단계 라벨(SP0 done_when 1번). 행의 아웃라인 깊이와 같아야 한다. */
export const LEVEL_LABELS = ['단계', '작업', '활동']
/** 복사 생성(2b)의 입력 라벨 — 원본 A(LEVEL_LABELS)와 달라야 저장값이 원본이 아니라 입력값임을 가를 수 있다(스펙 §7.5). */
export const COPY_LEVEL_LABELS = ['국면', '과업', '세부']

/** 양식 헤더 — src/lib/excel/template.ts TEMPLATE_HEADER 와 같아야 한다(테스트가 드리프트를 잡는다). */
export const TEMPLATE_HEADER = ['코드', '업무명', '업무영역', '산출물', '시작일', '종료일', '가중치', '실적%', '담당']

/**
 * 양식에 채울 행 — 아웃라인 3층(LEVEL_LABELS 와 같은 깊이), 담당은 팀명 직접 방식으로 팀 하나(SP1: 프로젝트 A 의
 * 첫 팀 — 부트스트랩은 더 이상 팀을 만들지 않는다). 날짜는 ISO 로 두고 러너가 toCell 로 바꾼다. 빈 칸은 ''(toCell 이 null 로 바꾼다).
 * secondLeafTeam 을 주면 둘째 잎(1.2.1)만 그 팀이다(SP4 A1 의 미등록 팀 파일 — 첫 잎은 상속 공용 팀, 둘째 잎은 미등록 팀).
 * @param {string} team @param {string} [secondLeafTeam]
 */
export function e2eRows(team, secondLeafTeam = team) {
  return [
    ['1',     '설계',          '공통', '',               '2026-09-21', '2026-10-16', 1,   '', ''],
    ['1.1',   '요구 분석',     '공통', '',               '2026-09-21', '2026-10-02', 0.5, '', ''],
    ['1.1.1', '요구사항 정리', '공통', '요구사항 정의서', '2026-09-21', '2026-10-02', 1,   '', team],
    ['1.2',   '화면 설계',     '공통', '',               '2026-10-05', '2026-10-16', 0.5, '', ''],
    ['1.2.1', '화면 정의',     '공통', '화면 정의서',     '2026-10-05', '2026-10-16', 1,   '', secondLeafTeam],
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

/** E2E 앱 주소 — localAppUrl 에 더해 3000(main 체크아웃의 사용자 dev 서버)을 거부한다. 러너는 스크래치 워크트리의 3101 에서 돈다. */
export function e2eBaseUrl(value) {
  const url = localAppUrl(value)
  if (new URL(url).port === '3000') throw new Error('E2E 는 스크래치 워크트리의 3101 에서 돈다 — main 체크아웃의 3000 을 쓰지 않는다')
  return url
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
/** 모듈 관문의 거부 문구 — tests/scripts/e2e.test.ts 가 앱 원본과 대조한다. */
export const ERR_MODULE_DISABLED = '이 기능은 지금 사용할 수 없습니다.'

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

// ── SP4 A1 — 두 러너(e2e-local·e2e-synthetic)가 같이 쓰는 날짜·가져오기·영역 도우미 ──────────────────────────────────
// 주 키는 만들지 않는다(W30) — 러너는 날짜를 액션에 넘기고 앱이 프로젝트 규칙(weekKeyOf)으로 정한 week_start 를 DB 에서 다시 읽는다.

/** 'YYYY-MM-DD' 에서 n 일 이동(UTC 달력 — 시간대와 무관). 형식·정수가 아니면 throw @param {string} iso @param {number} days */
export function shiftDays(iso, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || !Number.isInteger(days)) throw new Error(`날짜 이동 입력이 올바르지 않다: ${iso}, ${days}`)
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── SP5 A — 러너의 날짜·시간대(러너는 TS 를 import 하지 못한다 — 앱의 todayIn 과 같은 Intl 관용구). 주 키는 만들지 않는다(W30).

/** 그 시간대의 오늘 'YYYY-MM-DD' @param {string} tz IANA 이름 @param {Date} [now] */
export function todayInTz(tz, now = new Date()) {
  if (typeof tz !== 'string' || !tz) throw new Error(`시간대가 없다: ${String(tz)}`)
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 저장된 분석 실행의 최소 v1 스냅샷 — PPT E2E 가 앱의 파서와 같은 코드·영역을 복원하는지 확인한다. */
export function issueAnalysisRunFixture({ areaCode, areaName, issueId, code }) {
  return {
    schemaVersion: 'issue-analysis.v1', projectId: 'fixture-project', issueCount: 1, generatedAt: '2026-10-01T00:00:00.000Z',
    areas: [{
      areaCode, areaName, majors: [],
      summary: {
        totalCount: 1,
        statusCounts: { open: 1, in_progress: 0, resolved: 0, on_hold: 0 },
        severityCounts: { high: 1, medium: 0, low: 0 },
        ownerDepartments: ['E2E 부서'], relatedSystems: ['E2E 시스템'],
      },
      issues: [{
        id: issueId, code, majorId: null, title: 'E2E 코드 확인', body: 'E2E 분석서 코드 검증',
        status: 'open', severity: 'high', subProcess: 'E2E 하위 프로세스', ownerDepartment: 'E2E 부서',
        relatedSystems: ['E2E 시스템'], assigneeMemberIds: [], source: { manual: { type: 'other', detail: 'E2E 출처' }, minutes: [] },
      }],
      opportunities: [{ title: '코드가 보고서에 보임', description: '등록한 이슈 코드를 분석서에서 확인한다.', issueIds: [issueId] }],
    }],
    unclassifiedIssues: [],
  }
}

/**
 * 영역 여러 개의 저장된 분석 실행(v1) — 합성 게이트 S8 이 이슈분석서를 실제로 받아 본문을 대조할 때 넣는다. 앱의 저장 실행 파서
 * (storedRun.ts)가 받는 모양이다: 영역 요약은 이슈에서 계산하고, 이슈마다 원인 분석 하나, 개선기회는 영역 이슈를 5건씩 묶어 전부 덮는다.
 * 빈 제목·본문은 파서가 거부하므로 대체 문구를 넣는다. 원인 분류 code 는 그 프로젝트의 어휘에 있어야 한다(기본 어휘의 'process').
 * @param {{ projectId: string, generatedAt?: string, causeCategory?: string,
 *   areas: ReadonlyArray<{ code: string, name: string, issues: ReadonlyArray<{ id: string, code: string, title?: string | null, body?: string | null, status?: string, severity: string }> }> }} input
 */
export function issueAnalysisRunOf({ projectId, areas, generatedAt = '2026-10-01T00:00:00.000Z', causeCategory = 'process' }) {
  const withIssues = areas.filter((a) => a.issues.length > 0)
  if (!withIssues.length) throw new Error('분석 실행 픽스처에 이슈가 있는 영역이 없다')
  const ko = (a, b) => a.localeCompare(b, 'ko')
  const count = (list, keys, pick) => Object.fromEntries(keys.map((k) => [k, list.filter((x) => pick(x) === k).length]))
  return {
    schemaVersion: 'issue-analysis.v1', projectId, generatedAt,
    issueCount: withIssues.reduce((n, a) => n + a.issues.length, 0),
    areas: withIssues.map((area) => {
      const issues = area.issues.map((issue) => ({
        id: issue.id, code: issue.code, majorId: null,
        title: String(issue.title ?? '').trim() || `${issue.code} 제목 없음`, body: String(issue.body ?? '').trim() || `${issue.code} 본문 없음`,
        status: issue.status ?? 'open', severity: issue.severity,
        subProcess: `${area.code} 절차`, ownerDepartment: `${area.code} 담당`, relatedSystems: [`${area.code} 시스템`],
        assigneeMemberIds: [], source: { manual: { type: 'other', detail: '합성 출처' }, minutes: [] },
      }))
      const opportunities = []
      for (let i = 0; i < issues.length; i += 5) {
        opportunities.push({
          title: `${area.code} 개선기회 ${opportunities.length + 1}`, description: `${area.name} 의 이슈를 묶어 개선한다.`,
          issueIds: issues.slice(i, i + 5).map((x) => x.id),
        })
      }
      return {
        areaCode: area.code, areaName: area.name, majors: [],
        summary: {
          totalCount: issues.length,
          statusCounts: count(issues, ['open', 'in_progress', 'resolved', 'on_hold'], (x) => x.status),
          severityCounts: count(issues, [...new Set(issues.map((x) => x.severity))], (x) => x.severity),
          ownerDepartments: [...new Set(issues.map((x) => x.ownerDepartment))].sort(ko),
          relatedSystems: [...new Set(issues.flatMap((x) => x.relatedSystems))].sort(ko),
        },
        issues,
        causeAnalyses: issues.map((x) => ({
          issueId: x.id, causes: [{ category: causeCategory, directCause: `${x.code} 직접 원인`, rootCause: `${x.code} 근본 원인` }],
        })),
        opportunities,
      }
    }),
    unclassifiedIssues: [],
  }
}

/** PPTX 텍스트 파트에 모든 기대 문자열이 있는지 — 바이너리·미디어 파트는 검사하지 않는다. */
export async function zipHasAll(buf, words) {
  const text = (await zipTextParts(buf)).map((part) => part.text).join('\n')
  const missing = words.filter((word) => !text.includes(word))
  return { ok: missing.length === 0, missing }
}

/** 검증 전용 요일 판독 — DB 가 돌려준 날짜의 요일(0=일 … 6=토). 주 키를 만들지 않는다 @param {string} iso */
export function dowOfIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error(`날짜 형식이 아니다: ${String(iso)}`)
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** 설정 values 의 calendar.timezone — 키가 없거나 문자열이 아니면 제품 기본값 'UTC'(H2 규칙 ⑤ — 부트스트랩 밖 워크스페이스는 키가 없다) */
export function storedTimezone(values) {
  const v = values && typeof values === 'object' ? values['calendar.timezone'] : undefined
  return typeof v === 'string' && v ? v : 'UTC'
}

/**
 * WBS 엑셀 내보내기에서 업무명 → '계획%' 값. 머리 셀 '계획%' 가 있는 첫 시트의 그 열을 읽는다(표준·저장 양식 둘 다 그 머리를 쓴다 —
 * src/lib/excel/exportWithProfile.ts·headerWords.ts). 업무명은 앞뒤 공백을 무시하고 같은 칸 문자열로 찾는다(들여쓰기 양식 대비).
 * @param {ArrayBuffer | Uint8Array} buf @param {readonly string[]} names @returns {Promise<Record<string, number>>}
 */
export async function plannedPctByName(buf, names) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const text = (v) => {
    if (v && typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if (v && typeof v === 'object' && 'result' in v) return v.result
    return v
  }
  for (const ws of wb.worksheets) {
    let col = null
    ws.eachRow((row) => {
      if (col !== null) return
      row.eachCell((cell, n) => { if (col === null && String(text(cell.value) ?? '').trim() === '계획%') col = n })
    })
    if (col === null) continue
    const out = {}
    ws.eachRow((row) => {
      const cells = []
      row.eachCell((cell) => cells.push(String(text(cell.value) ?? '').trim()))
      for (const name of names) if (cells.includes(name)) out[name] = Number(text(row.getCell(col).value))
    })
    return out
  }
  throw new Error("내보내기에 '계획%' 열이 없다")
}

const ymdParts = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error(`날짜 형식이 아니다: ${String(iso)}`)
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

/** 전환이 없는 주 키의 라벨 — 기준일 = 키 + 3일의 연·월, 주차 = ⌊(일 − 1)/7⌋ + 1(개정 §4.2.5 "전환이 없으면" 식). 과도기 키에 쓰지 않는다 @param {string} key */
export function plainWeekLabel(key) {
  const { y, m, d } = ymdParts(shiftDays(key, 3))
  const ordinal = Math.floor((d - 1) / 7) + 1
  return { year: y, month: m, ordinal, label: `${m}월 ${ordinal}주차` }
}

/** 'M/D~M/D'(앞 0 없음 — 화면·보고서 범위 표기) @param {string} first @param {string} last */
export function rangeText(first, last) {
  const a = ymdParts(first)
  const b = ymdParts(last)
  return `${a.m}/${a.d}~${b.m}/${b.d}`
}

/** 그날 포함 다음 그 요일(0=일 … 6=토) — 테스트 날짜를 고르는 데만 쓴다(주 키가 아니다) @param {string} iso @param {number} dow */
export function nextDowOnOrAfter(iso, dow) {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new Error(`요일이 올바르지 않다: ${dow}`)
  let cur = iso
  for (let i = 0; i < 7; i++, cur = shiftDays(cur, 1)) if (dowOfIso(cur) === dow) return cur
  throw new Error('도달 불가')
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * 가져오기 파일(xlsx) — rows(TEMPLATE_HEADER 순서의 값 배열)를 'WBS' 시트에 쓴다. 날짜는 toCell(UTC 정오).
 * templateBuf 가 있으면 내려받은 양식을 열어 예시 행 자리에 덮어쓰고 남는 예시 행을 비운다(spliceRows 는 SheetJS 가 쓴 시트에서 행을 지우지
 * 못했다 — 2026-09-24 실측, E2E 단계 5 와 같은 방식). 없으면 새 통합 문서에 'WBS'(머리 + 행)와 'Holiday'(머리만)를 만든다 — 양식의 예시는
 * 3단이라 4단 파일은 이 길로 만든다(스펙 §6.4 S2).
 * @param {ReadonlyArray<ReadonlyArray<string | number>>} rows @param {Uint8Array | null} [templateBuf] @returns {Promise<Uint8Array>}
 */
export async function fillWbsWorkbook(rows, templateBuf = null) {
  const wb = new ExcelJS.Workbook()
  if (templateBuf) {
    await wb.xlsx.load(templateBuf)
    const ws = wb.getWorksheet('WBS')
    if (!ws) throw new Error("양식에 'WBS' 시트가 없다")
    const header = ws.getRow(1).values.slice(1)
    if (JSON.stringify(header) !== JSON.stringify(TEMPLATE_HEADER)) throw new Error(`양식 헤더가 다르다: ${JSON.stringify(header)}`)
    const last = ws.rowCount
    rows.forEach((r, i) => { ws.getRow(i + 2).values = r.map(toCell) })
    for (let n = rows.length + 2; n <= last; n++) ws.getRow(n).values = []
  } else {
    const ws = wb.addWorksheet('WBS')
    ws.addRow([...TEMPLATE_HEADER])
    for (const r of rows) ws.addRow(r.map(toCell))
    wb.addWorksheet('Holiday').addRow(['날짜', '이름'])
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/**
 * 가져오기 실행 폼 — ImportWizard 와 같은 필드에 명령 id(스펙 §4.4 #1 — 없으면 라우트가 400 COMMAND_ID_REQUIRED). 명령 id 는 실행 의도마다
 * 하나다: 같은 의도의 재전송·409(needsTeams) 뒤 등록 재실행은 같은 id, 파일·양식·모드·저장 여부가 바뀌면 새 id(D50·Review Focus 3).
 * uuid 가 아니거나 모드가 아니면 throw — 명령 id 없는 실행을 만들지 않는다. convertToken 은 상속 프로젝트의 등록 재요청이 409 가 준 전환 동의
 * 토큰을 그대로 돌려보내는 필드다(A1-5 R3 — 주어졌을 때만 싣는다).
 * @param {{ file: Uint8Array, fileName: string, projectId: string, profile: unknown, mode: 'append' | 'replace', commandId: string, saveProfile?: boolean, registerTeams?: boolean, convertToken?: string | null }} p
 */
export function importForm({ file, fileName, projectId, profile, mode, commandId, saveProfile = true, registerTeams = false, convertToken = null }) {
  if (!UUID_RE.test(String(commandId))) throw new Error(`commandId 가 uuid 가 아니다: ${commandId}`)
  if (mode !== 'append' && mode !== 'replace') throw new Error(`가져오기 모드가 아니다: ${mode}`)
  const form = new FormData()
  form.append('file', new Blob([file], { type: XLSX_MIME }), fileName)
  form.append('projectId', projectId)
  form.append('profile', JSON.stringify(profile))
  form.append('mode', mode)
  form.append('saveProfile', String(saveProfile))
  form.append('registerTeams', String(registerTeams))
  form.append('commandId', commandId)
  if (convertToken) form.append('convertToken', convertToken)
  return form
}

/** 양식 분석 폼(/api/import/inspect) @param {{ file: Uint8Array, fileName: string, projectId: string }} p */
export function inspectForm({ file, fileName, projectId }) {
  const form = new FormData()
  form.append('file', new Blob([file], { type: XLSX_MIME }), fileName)
  form.append('projectId', projectId)
  return form
}

/** 가져오기 응답의 비교 모양 — 성공은 결과 종류·명령 id·건수·모드·양식 저장, 실패는 code(스펙 §4.4 응답 모양) @param {Record<string, any>} body */
export function importResultView(body) {
  return body?.ok === true
    ? { ok: true, kind: body.kind ?? null, commandId: body.commandId ?? null, count: body.count ?? null, mode: body.mode ?? null, profileSaved: body.profileSaved ?? null }
    : { ok: false, code: body?.code ?? null }
}

/**
 * upsertArea 입력(AreaInput — 설정 화면의 영역 편집기와 같은 모양, kind 는 weekly_section 고정 — D26). 담당 팀 [code, 종류] 를 그 프로젝트의
 * 팀 id 로 바꾼다 — 없는 code 면 throw. opts 로 기존 영역 id·새 이름·활성을 준다(개명·비활성화 — code 는 그대로, 트리거가 불변을 지킨다).
 * @param {{ code: string, name: string, sortOrder: number, teams: ReadonlyArray<ReadonlyArray<string>> }} def
 * @param {ReadonlyMap<string, string>} teamIdByCode
 * @param {{ id?: string, name?: string, active?: boolean }} [opts]
 */
export function areaInput(def, teamIdByCode, { id, name, active = true } = {}) {
  return {
    ...(id ? { id } : {}), kind: 'weekly_section', code: def.code, name: name ?? def.name, sortOrder: def.sortOrder, active,
    teams: def.teams.map(([code, kind]) => {
      const teamId = teamIdByCode.get(code)
      if (!teamId) throw new Error(`팀 ${code} 가 이 프로젝트에 없다`)
      return { teamId, kind }
    }),
  }
}

// ── SP4 A1 — 로컬 E2E 의 주간·가져오기 단계(스펙 §6.3) ─────────────────────────────────────────────────────────────

/** 프로젝트 B(SP1 팀 하나)의 주간 영역 — 사용자 정의 이름만(스펙 §6.3). code 는 이름과 다르다(개명해도 code 는 그대로 — 트리거가 지킨다) */
export const E2E_AREAS = Object.freeze({
  exp: Object.freeze({ code: 'EXP', name: '실험', renamed: '실험 설계' }),
  run: Object.freeze({ code: 'RUN', name: '운영' }),
  fresh: Object.freeze({ code: 'NEW', name: '신규' }),
})

/** 프로젝트 A(SP1 팀 둘)에 등록하는 영역 — 이름이 옛 11구분명의 둘째와 같은 낱말이다(부정 테스트 2 — 스스로 등록한 이름은 나와야 한다).
 *  평문은 센티널 픽스처 하나에 두므로(계획 P6) base64 사본에서 꺼낸다 — tests/scripts/e2e.test.ts 가 픽스처와 대조한다 */
export const REGISTERED_AREA = Object.freeze({ code: 'SALES', name: sp4Sentinels()[1] })

/** 상속 프로젝트에 들일 미등록 팀 code — 새 팀 코드 규칙을 통과하고 SP1 팀·공용 팀과 겹치지 않는다(테스트가 대조) */
export const UNREGISTERED_TEAM = 'LAB'

/**
 * 서버 렌더 HTML 로 Next 서버 종류를 가른다 — next start(프로덕션 빌드)는 해시 붙은 main-app 청크만, next dev 는 해시 없는 main-app·
 * react-refresh·webpack-hmr·static/development 흔적이 있다. teams-source-next-start 는 production 일 때만 통과한다(스펙 D19 — 모듈 인스턴스별
 * 옛 캐시 결함은 next start 에서만 드러났다. A2-4 리뷰 P3-1). 어느 흔적도 없으면 unknown(통과로 세지 않는다).
 * @param {string} html @returns {'production' | 'development' | 'unknown'}
 */
export function nextServerMode(html) {
  if (/react-refresh|webpack-hmr|\/_next\/static\/development\/|\/_next\/static\/chunks\/main-app\.js/.test(html)) return 'development'
  if (/\/_next\/static\/chunks\/main-app-[0-9a-f]{8,}\.js/.test(html)) return 'production'
  return 'unknown'
}

/** SP4 A2 — 같은 서버 프로세스에서 방금 만든 팀을 가져오기가 바로 보는지(teams-source-next-start)에 쓰는 팀 코드. 옛 이름이 아니다 */
export const A2_TEAM = 'RUN'

/** 이월 덧붙임의 기대값 — 붙일 값의 앞뒤 공백을 걷고 빈 값은 건너뛰어 '\n' 으로 잇는다(앱 weeklyCarry.ts 의 규칙 — 테스트가 그 함수와
 *  대조한다). 순서는 부르는 쪽이 정한다: 그 영역 자신의 이월분 → 매핑된 영역(영역 순서) @param {...string} parts */
export function carriedText(...parts) {
  return parts.map((p) => String(p ?? '').trim()).filter((p) => p !== '').join('\n')
}

const SLIDE_PART = /^ppt\/slides\/slide(\d+)\.xml$/
const XML_ENTITIES = Object.freeze({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })

/** pptx 텍스트 파트 이름 가운데 슬라이드 수 — ppt/slides/slideN.xml 만(레이아웃·마스터·노트·rels 제외) @param {readonly string[]} names */
export function slideCount(names) {
  return names.filter((n) => SLIDE_PART.test(n)).length
}

/** pptx 슬라이드의 글자 — 슬라이드 번호 순으로 <a:t> 내용을 잇는다(한 낱말이 여러 런으로 나뉘어도 찾게 — 슬라이드 안은 빈 문자 없이,
 *  슬라이드 사이는 줄바꿈). XML 엔티티 다섯을 푼다 @param {ReadonlyArray<{ name: string, text: string }>} entries */
export function pptText(entries) {
  const num = (name) => Number(name.match(SLIDE_PART)?.[1] ?? 0)
  return entries
    .filter((e) => SLIDE_PART.test(e.name))
    .sort((a, b) => num(a.name) - num(b.name))
    .map((e) => [...e.text.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)]
      .map((m) => m[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (x) => XML_ENTITIES[x])).join(''))
    .join('\n')
}

/** 텍스트 파트·HTML 의 센티널 적중 — 적중이 있는 항목만 [{ name, hits }](일치 규칙은 sentinels.mjs 의 findSentinels 하나 — 스펙 §6.4)
 *  @param {ReadonlyArray<{ name: string, text: string }>} entries @param {readonly string[]} sentinels */
export function sentinelReport(entries, sentinels) {
  return entries.map((e) => ({ name: e.name, hits: findSentinels(e.text, sentinels) })).filter((e) => e.hits.length > 0)
}

/**
 * 한 프로젝트 안에서 주어진 팀 id 를 가리키는 참조 수 — 전환 RPC 가 옮기는 네 곳(스펙 D54·§3.3 ⑤): 항목 담당(item_owners), 명단 팀
 * (project_member_teams), 영역 팀(area_teams), 수락 전 초대의 team_ids. 입력은 그 프로젝트로 거른 PostgREST 임베드 조회 행이다.
 * @param {{ items: ReadonlyArray<{ item_owners?: { team_id: string }[] }>, members: ReadonlyArray<{ project_member_teams?: { team_id: string }[] }>, areas: ReadonlyArray<{ area_teams?: { team_id: string }[] }>, invites: ReadonlyArray<{ team_ids?: string[] | null }> }} wiring
 * @param {Iterable<string>} teamIds
 */
export function teamRefs({ items, members, areas, invites }, teamIds) {
  const ids = new Set(teamIds)
  const count = (list) => list.filter((id) => ids.has(id)).length
  return {
    item_owners: count(items.flatMap((i) => (i.item_owners ?? []).map((o) => o.team_id))),
    project_member_teams: count(members.flatMap((m) => (m.project_member_teams ?? []).map((t) => t.team_id))),
    area_teams: count(areas.flatMap((a) => (a.area_teams ?? []).map((t) => t.team_id))),
    invites: count(invites.flatMap((v) => v.team_ids ?? [])),
  }
}

// ── SP3b UI-2 흐름(스펙 §8.3 E1·E2·E4~E11 — 브랜치 전용 e2e-sp3b.mjs 를 과제 39 가 e2e-local.mjs 로 합쳤다, V15) ────────────
// 워크스페이스 A·B·ana·bea·플랫폼 관리자는 위 SP2 흐름의 것 그대로, 두 워크스페이스에 속한 계정 duo 와 B 의 공용 팀·회의록만 더한다.

/** 두 워크스페이스(A·B) 멤버 — B 는 createAccount(프로젝트 C 멤버), A 소속은 service_role 행(워크스페이스 멤버 추가 화면은 아직 없다 — 로컬 전용). */
export const DUO = Object.freeze({ email: 'e2e-duo@example.com', name: 'duo' })
/** 워크스페이스 B 의 공용 팀 — B 의 프로젝트 없는 회의록 담당. A 의 WS_TEAM 과 다른 코드(SP2 흐름의 'bea meta 팀에 A 공용 팀이 없다' 단언과 섞이지 않게). */
export const SP3B_B_TEAM = 'BOPS'
/** bea 가 만드는 워크스페이스 B 의 회의록(프로젝트 없음) — 두 워크스페이스 목록·소프트 이동의 대상 */
export const SP3B_MINUTE_B = 'E2E SP3b B 회의록'
/** 워크스페이스 전환기 트리거 표지(D4) — 소속이 둘 이상일 때만 SSR HTML 에 있다 */
export const SWITCHER_MARK = 'data-ws-switcher="list"'

/** 옛 경로 × 쿼리 → 기대 대상(순수, E1) @param {string} slug @param {{ minuteId: string, projectId: string }} ids */
export function legacyCases(slug, ids) {
  const W = `/w/${slug}`
  const base = [['/meetings', 'meetings'], ['/minutes', 'minutes'], ['/agents', 'agents'], ['/portfolio', 'portfolio'], ['/usage', 'usage'], ['/admin/teams', 'admin/teams']]
  const out = []
  for (const [from, seg] of base) {
    out.push({ from, to: `${W}/${seg}` })
    out.push({ from: `${from}?view=calendar`, to: `${W}/${seg}?view=calendar` })
  }
  out.push({ from: '/usage?days=7&menu=a&menu=b', to: `${W}/usage?days=7&menu=a&menu=b` })
  out.push({ from: '/minutes?q=%ED%95%9C%20%26', to: `${W}/minutes?q=%ED%95%9C%20%26` })
  out.push({ from: `/admin/accounts?project=${ids.projectId}`, to: `${W}/admin/accounts?project=${ids.projectId}` })
  out.push({ from: `/minutes/${ids.minuteId}?block=2&version=v`, to: `${W}/minutes/${ids.minuteId}?block=2&version=v` })
  return out
}

/** 307·요청 원점·경로·쿼리(순수) — Location 은 절대 주소든 상대 경로든 origin 에 풀어 본다(스텁은 상대 경로를 낸다 — 판정 W2).
 *  쿼리는 디코드한 (키, 값) 목록의 순서까지 같아야 한다(%20 과 + 같은 인코딩 차이는 같은 값, 중복 키 순서는 다른 값)
 *  @param {{ status: number, headers: Headers }} res @param {string} origin @param {string} path @returns {string[]} 문제 목록 */
export function expectLocation(res, origin, path) {
  const p = []
  if (res.status !== 307) p.push(`상태 ${res.status} ≠ 307`)
  const loc = res.headers.get('location') ?? ''
  let got, want
  try { got = new URL(loc, origin); want = new URL(path, origin) } catch { return [...p, `Location 을 읽을 수 없다: ${loc}`] }
  if (got.origin !== new URL(origin).origin) p.push(`Location 원점 ${got.origin} ≠ ${origin}`)
  if (got.pathname !== want.pathname) p.push(`Location 경로 ${got.pathname} ≠ ${want.pathname}`)
  if (JSON.stringify([...got.searchParams]) !== JSON.stringify([...want.searchParams])) p.push(`Location 쿼리 ${got.search} ≠ ${want.search}`)
  return p
}

/** 칸반 보드 표지 — 작업 계획 페이지가 보드 보기를 그렸을 때 SSR HTML 에 있다(UI-3 과제 14 가 KanbanBoard 루트에 단다) */
export const KANBAN_BOARD_MARK = 'data-kanban-board'
/** 옛 칸반 딥링크 사례(순수, E3 — 스펙 §8.3·D36): view 는 group 으로, 나머지 쿼리는 그대로, 대상은 작업 계획의 보드 보기
 *  @param {string} pid @returns {{ path: string, want: string }} */
export function kanbanStubCase(pid) {
  return { path: `/p/${pid}/kanban?view=phase&team=X`, want: `/p/${pid}/wbs?view=board&group=phase&team=X` }
}

/** notFound 판정(순수) — HTTP 404 또는 로딩 경계 안 스트리밍 notFound() 의 digest. 센티널(보이면 안 되는 글자)이 본문에 실렸는지도 함께
 *  @param {{ status: number, html: string }} res @param {readonly string[]} [sentinels] @returns {string[]} */
export function hiddenVerdict({ status, html }, sentinels = []) {
  const p = []
  if (!(status === 404 || notFoundRendered(html))) p.push(`404 가 아니다(상태 ${status}, notFound digest 없음)`)
  for (const s of sentinels) if (html.includes(s)) p.push(`본문에 숨겨야 할 글자 '${s}' 가 있다`)
  return p
}

/** /admin/workspaces 목록의 한 행(순수) — `data-workspace-row="<slug>"` 부터 그 행이 끝나는 곳(</tr>)까지. 행이 없으면 null
 *  @param {string} html @param {string} slug @returns {string | null} */
export function workspaceRowHtml(html, slug) {
  const start = html.indexOf(`data-workspace-row="${slug}"`)
  if (start < 0) return null
  const end = html.indexOf('</tr>', start)
  return end < 0 ? html.slice(start) : html.slice(start, end)
}

/**
 * 워크스페이스 보관 상태의 목록 행 판정(순수, 0056) — 보관된 행은 "보관됨" 표지와 복원 단추가 있고 열기 링크·이름 바꾸기·보관 단추가 없다.
 * 활성 행은 그 반대다. 삭제 단추는 두 상태 모두 있다(보관된 워크스페이스도 비어 있으면 지울 수 있다).
 * @param {string} html /admin/workspaces 의 HTML @param {string} slug @param {boolean} expectArchived @returns {string[]} 문제 목록
 */
export function archivedRowVerdict(html, slug, expectArchived) {
  const row = workspaceRowHtml(html, slug)
  if (row === null) return [`목록에 ${slug} 행이 없다`]
  const has = (mark) => row.includes(mark)
  const p = []
  const want = (mark, expected, what) => { if (has(mark) !== expected) p.push(`${slug}: ${what}${expected ? '이(가) 없다' : '이(가) 있다'}`) }
  want('data-workspace-archived="true"', expectArchived, '보관 표지')
  want('data-workspace-restore', expectArchived, '복원 단추')
  want(`href="/w/${slug}"`, !expectArchived, '열기 링크')
  want('data-workspace-rename', !expectArchived, '이름 바꾸기 단추')
  want('data-workspace-archive=', !expectArchived, '보관 단추')
  want('data-workspace-delete', true, '삭제 단추')
  return p
}

/** 워크스페이스 전환기 트리거 판정(순수, E5·D4) — 소속 둘 이상이면 SSR HTML 에 트리거 표지가 있고, 하나면 이름만(표지 없음).
 *  개수는 보지 않는다 — 768~1023 에서 드로어를 연 상태는 같은 전환기를 한 번 더 마운트한다(U2b-4 이월)
 *  @param {string} html @param {boolean} expectList @returns {string[]} 문제 목록 */
export function switcherVerdict(html, expectList) {
  const has = html.includes(SWITCHER_MARK)
  if (expectList && !has) return [`전환기 트리거(${SWITCHER_MARK})가 없다 — 소속이 둘 이상이면 있어야 한다`]
  if (!expectList && has) return [`전환기 트리거(${SWITCHER_MARK})가 있다 — 소속이 하나면 이름만 보여야 한다`]
  return []
}

/** 프로젝트 내비의 이슈 링크 판정(순수, E7) — 같은 화면의 다른 내비 링크(WBS)를 대조로 본다(내비가 안 그려진 화면을 '없음'으로 읽지 않는다)
 *  @param {string} html @param {string} pid @param {boolean} expectPresent @returns {string[]} 문제 목록 */
export function issuesLinkVerdict(html, pid, expectPresent) {
  const p = []
  if (!html.includes(`href="/p/${pid}/wbs"`)) p.push('내비가 그려지지 않았다(WBS 링크 없음 — 대조 실패)')
  const has = html.includes(`href="/p/${pid}/issues"`)
  if (expectPresent && !has) p.push('이슈 링크가 없다(모듈을 켰는데)')
  if (!expectPresent && has) p.push('이슈 링크가 있다(모듈을 껐는데)')
  return p
}

/** /api/shell 배지 판정(순수, E10) — hidden = 소속이 아닌 워크스페이스·볼 수 없는 프로젝트의 범위라 세 배지 모두 null(남의 수를 흘리지 않는다),
 *  own = 자기 워크스페이스의 검토 대기 수는 숫자(대조 — 같은 경로가 숫자를 낸다는 것)
 *  @param {{ status: number, body: any }} res @param {'hidden' | 'own'} kind @returns {string[]} */
export function shellBadgeVerdict(res, kind) {
  if (res.status !== 200) return [`상태 ${res.status} ≠ 200`]
  const b = res.body?.badges
  if (!b || typeof b !== 'object') return ['응답에 badges 가 없다']
  if (kind === 'hidden') return ['myWorkReview', 'projectApprovals', 'projectUnreadAnnouncements'].filter((k) => b[k] !== null).map((k) => `${k} = ${JSON.stringify(b[k])} (null 이어야 한다)`)
  return typeof b.myWorkReview === 'number' ? [] : [`myWorkReview = ${JSON.stringify(b.myWorkReview)} (자기 워크스페이스는 숫자여야 한다)`]
}

/**
 * SP4 B — 화면 HTML 의 팀 색 클래스(teams-color-render, 스펙 §6.3). slots = category-1..8 의 text·bg(중복 없이 — 채움 위 글자 category-fg 와
 * -weak 배경은 세지 않는다), legacy = 옛 team-1..5 클래스(-weak 포함 — 0 이어야 한다), neutral = 목록 밖 팀의 중립 슬롯 수(기록만).
 * @param {string} html @returns {{ slots: string[], legacy: string[], neutral: number }}
 */
export function teamSlotVerdict(html) {
  const text = String(html)
  const uniq = (re) => [...new Set([...text.matchAll(re)].map((m) => m[0]))].sort()
  return {
    slots: uniq(/(?<![\w-])(?:text|bg)-category-[1-8](?![\w-])/g),
    legacy: uniq(/(?<![\w-])(?:text|bg)-team-[1-5](?:-weak)?(?![\w-])/g),
    neutral: (text.match(/(?<![\w-])(?:text|bg)-neutral(?![\w-])/g) ?? []).length,
  }
}

// ── 재점검 보강 흐름(e2e-local.mjs 의 끝 — sp3b- 단계 뒤): 팀 코드 변경·병합, 팀 없는 회의록, 알림 정책, 충돌 비교, 워크스페이스 생성,
//    계정 수명주기, 헬스체크·보안 헤더, 회의록 공유 링크, (선택) 색인·위키 워커. 앞 단계의 픽스처(소속 수·모듈 상태)를 건드리지 않게 맨 뒤에 둔다.

/** 제거·비밀번호 재설정의 대상 계정 — 워크스페이스 A 의 멤버이자 프로젝트 A 의 멤버로 만든다(소속은 A 하나) */
export const LEAVER = Object.freeze({ email: 'e2e-leaver@example.com', name: 'leaver' })
/** 켜고 끄는 알림 유형 — 필수가 아니고 한 번의 담당 지정으로 발행되는 가장 싼 유형 */
export const NOTIFY_PROBE_TYPE = 'work.assigned'
/** 충돌 비교 대화상자의 표지와 '서버 값 받기' 단추 이름(ko — 러너 계정의 기본 언어) */
export const CONFLICT_DIALOG = '[data-testid="conflict-resolver"]'
export const CONFLICT_TAKE_LATEST = '서버 값 받기'
/** 주간 시트의 제목 입력 */
export const WEEKLY_TITLE_INPUT = 'input[aria-label="시트 제목"]'
/** 회의록 목록의 "팀 없음" 필터 값과 그 탭의 이름 */
export const NO_TEAM_FILTER = 'none'
export const NO_TEAM_LABEL = '팀 없음'

/**
 * 재점검 보강 단계의 이름·코드 — 실행마다 달라지는 꼬리(stamp 의 끝 네 자리)를 붙여 같은 DB 에서 다시 돌려도 겹치지 않는다.
 * 팀 코드는 영문 대문자·숫자만 쓴다(팀 코드 규칙).
 * @param {string} stamp 숫자 12자리(yyyymmddhhmm)
 */
export function recheckNames(stamp) {
  const tail = String(stamp).slice(-4)
  if (!/^\d{4}$/.test(tail)) throw new Error(`stamp 의 끝 네 자리가 숫자가 아니다: ${stamp}`)
  return {
    teams: {
      source: { name: `E2E 원본팀 ${tail}`, code: `TS${tail}` },
      target: { name: `E2E 대상팀 ${tail}`, code: `TD${tail}` },
      /** 원본 팀의 바꿀 코드 */
      renamedCode: `TX${tail}`,
    },
    minutes: { team: `E2E-TEAM-${stamp}`, noTeam: `E2E-NOTEAM-${stamp}` },
    weeklyTitle: { theirs: `E2E 서버 제목 ${tail}`, mine: `E2E 내 제목 ${tail}` },
    workspace: { name: `E2E 새 워크스페이스 ${tail}`, slug: `e2e-new-${stamp}` },
  }
}

/** updateMinuteMeta 의 둘째 인자(본문을 뺀 MinuteInput) — 팀만 바꾼다. 빈 문자열이 "팀 없음"이다
 *  @param {{ date: string, title: string, teamCode: string, projectId?: string | null }} p */
export function minuteMetaPatch({ date, title, teamCode, projectId = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`회의록 날짜 형식이 아니다: ${date}`)
  return { minuteDate: date, teamCode, title, meetingId: null, projectId, meetingOccurrenceDate: null }
}

/** 워크스페이스 알림 정책 값 — 그 유형 하나를 끄거나 켠다(다른 유형은 적지 않는다 = 기본)
 *  @param {string} type @param {boolean} enabled */
export function notifyPolicyOf(type, enabled) {
  return { [type]: { enabled } }
}

/** 설정 패치 — 값이 undefined 면 키를 지운다(원래 저장값이 없던 상태로 되돌릴 때)
 *  @param {string} key @param {unknown} value */
export function settingPatch(key, value) {
  return value === undefined ? { set: {}, unset: [key] } : { set: { [key]: value }, unset: [] }
}

/**
 * /login 응답의 보안 헤더 판정(순수) — next.config.ts 의 headers() 가 전 경로에 싣는 것. HSTS 는 프로덕션에서만이라 로컬에서는 보지 않는다.
 * @param {{ get(name: string): string | null }} headers @returns {string[]} 문제 목록
 */
export function securityHeaderProblems(headers) {
  const p = []
  const want = (name, test, hint) => {
    const v = headers.get(name)
    if (v === null) p.push(`${name} 헤더가 없다`)
    else if (!test(v)) p.push(`${name} = ${JSON.stringify(v.slice(0, 80))} (${hint})`)
  }
  want('x-content-type-options', (v) => v.toLowerCase() === 'nosniff', 'nosniff 여야 한다')
  want('x-frame-options', (v) => v.toUpperCase() === 'DENY', 'DENY 여야 한다')
  want('referrer-policy', (v) => v === 'strict-origin-when-cross-origin', 'strict-origin-when-cross-origin 이어야 한다')
  want('permissions-policy', (v) => ['camera=()', 'microphone=()', 'geolocation=()'].every((x) => v.includes(x)), '카메라·마이크·위치를 닫아야 한다')
  // 프레임 차단은 어느 모드에서도 강제한다. 자원 정책은 모드(CSP_MODE)에 따라 강제 헤더(enforce)나 보고 전용 헤더(report) 한쪽에 실린다 —
  // 어느 쪽이든 실려 있어야 한다(둘 다 없으면 보고 전용 헤더가 없다고 짚는다)
  want('content-security-policy', (v) => v.includes("frame-ancestors 'none'"), "frame-ancestors 'none' 이 있어야 한다")
  const resource = (v) => v.includes("default-src 'self'") && v.includes("object-src 'none'")
  const enforced = headers.get('content-security-policy')
  if (!(enforced !== null && resource(enforced))) {
    want('content-security-policy-report-only', resource, "default-src 'self'·object-src 'none' 이 있어야 한다")
  }
  return p
}

/** 헬스체크 응답 판정(순수) — 얕은 점검은 { ok: true } 만(DB 칸 없음), 깊은 점검(시크릿 있음)은 db: 'ok'. 캐시하지 않는다
 *  @param {{ status: number, body: any, cacheControl: string | null }} res @param {'shallow' | 'deep'} kind @returns {string[]} */
export function healthProblems(res, kind) {
  const p = []
  if (res.status !== 200) p.push(`상태 ${res.status} ≠ 200`)
  if (res.body?.ok !== true) p.push(`ok = ${JSON.stringify(res.body?.ok)}`)
  if (kind === 'shallow' && res.body && 'db' in res.body) p.push('시크릿 없는 요청이 DB 점검을 일으켰다(db 칸이 있다)')
  if (kind === 'deep' && res.body?.db !== 'ok') p.push(`db = ${JSON.stringify(res.body?.db)} (깊은 점검이 돌지 않았다)`)
  if (!(res.cacheControl ?? '').includes('no-store')) p.push(`Cache-Control = ${JSON.stringify(res.cacheControl)} (no-store 여야 한다)`)
  return p
}

/** 워커 단계를 돌릴지 — 서버가 색인·위키 워커 플래그로 떠 있을 때만 켠다(E2E_WORKERS=1). 그 밖에는 건너뛴다(실패로 세지 않는다)
 *  @param {Record<string, string | undefined>} env */
export function workersEnabled(env) {
  return env.E2E_WORKERS === '1'
}

/**
 * 워커 세 잡의 응답 판정(순수). 404 는 그 잡의 플래그가 꺼진 서버라는 뜻이라 어떤 env 가 필요한지를 문제에 적는다.
 * 색인: 200·failed 0·문서가 쌓였다(실행 뒤 1건 이상이고 줄지 않았다). 위키: 200·처리 수가 숫자. 첨부 청소: 200·ok.
 * @param {{ index: { status: number, body: any }, wiki: { status: number, body: any }, gc: { status: number, body: any }, docsBefore: number, docsAfter: number }} r
 * @returns {string[]}
 */
export function workerProblems({ index, wiki, gc, docsBefore, docsAfter }) {
  const p = []
  if (index.status === 404) p.push('색인 워커 404 — 서버에 CHAT_V2_ENABLED=true·CHAT_V2_INDEX_WORKER_ENABLED=true 가 필요하다')
  else if (index.status !== 200) p.push(`색인 워커 상태 ${index.status}`)
  else {
    if (index.body?.failed !== 0) p.push(`색인 워커 failed = ${JSON.stringify(index.body?.failed)} (0 이어야 한다)`)
    if (!(docsAfter > 0)) p.push(`색인 문서가 없다(실행 뒤 ${docsAfter}건)`)
    if (docsAfter < docsBefore) p.push(`색인 문서가 줄었다(${docsBefore} → ${docsAfter})`)
  }
  if (wiki.status === 404) p.push('위키 워커 404 — 서버에 WIKI_WORKER_ENABLED=true(와 처리하려면 WIKI_SERVICE_ENABLED=true)가 필요하다')
  else if (wiki.status !== 200) p.push(`위키 워커 상태 ${wiki.status}`)
  else if (typeof wiki.body?.attempted !== 'number' || typeof wiki.body?.completed !== 'number') p.push(`위키 워커 응답 형식: ${JSON.stringify(wiki.body)?.slice(0, 120)}`)
  if (gc.status !== 200) p.push(`첨부 청소 상태 ${gc.status}${gc.body?.error ? `(${gc.body.error})` : ''}`)
  else if (gc.body?.ok !== true) p.push(`첨부 청소 응답: ${JSON.stringify(gc.body)?.slice(0, 120)}`)
  return p
}

// ── 설정 반영 완주(e2e-local.mjs 의 setting- 단계, e2e-synthetic.mjs 의 S7b) — "설정 값을 바꾼다 → 그 값이 화면·동작에 나타난다 →
//    다른 워크스페이스(프로젝트 키는 다른 프로젝트)에는 나타나지 않는다 → 되돌린다" 를 키마다 한 단계로 본다. 카탈로그 상태 verified 의 근거
//    (src/lib/settings/catalog-meta.ts 의 E2E_EVIDENCE)가 이 단계 이름을 가리킨다 — 이름을 바꾸면 그 표도 같이 바꾼다.

/** 강조색 입력(hex 하나) — 제품 기본 코발트와 눈에 띄게 다른 색. 앱의 파생(deriveAccent)이 받아 주는 값인지는 테스트가 고정한다 */
export const ACCENT_PROBE = '#6d28d9'
/** 끄고 켜 볼 홈 위젯 — 모듈·검토자 조건이 없어 누구의 홈에나 늘 보이는 것 */
export const PORTAL_PROBE_WIDGET = 'projects'
/** 홈 위젯 id 의 레지스트리 순서 — src/lib/portal/widgets.ts 의 PORTAL_WIDGET_IDS 와 같아야 한다(테스트가 대조) */
export const PORTAL_WIDGET_ORDER = Object.freeze(['my_work', 'projects', 'review', 'upcoming', 'recent_docs', 'announcements',
  'due_work', 'my_issues', 'project_progress', 'week_schedule', 'favorites', 'quick_actions', 'memo', 'recent_changes', 'attendance_today', 'agents_status',
  'weekly_reports', 'wiki_recent'])
/** 메뉴 순서 확인 — 워크스페이스 주 그룹에서 기본은 홈이 프로젝트보다 앞이다. 이 순서를 뒤집고 앞 항목의 이름을 바꾼다 */
export const MENU_PROBE_ORDER = Object.freeze(['ws.projects', 'ws.home'])
/** 초안 정책 확인용 위키 문서의 종류 — 앱이 아는 문서 종류여야 한다(테스트가 대조) */
export const WIKI_PROBE_KIND = 'reference'
/** 1×1 투명 PNG — 로고(마크) 슬롯에 올려 탭 아이콘·읽기 라우트를 본다. 크기 상한(로고 256KB)보다 한참 작다 */
export const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/**
 * 설정 단계의 확인용 값 — 실행마다 달라지는 꼬리를 붙여, 화면에 그 글자가 있으면 "이번 실행이 넣은 설정값"임이 갈린다(중립 이름).
 * 추가 축 이름은 20자, 제품 이름은 40자, 메뉴 이름은 20자가 상한이다.
 * @param {string} stamp 숫자 12자리(yyyymmddhhmm)
 */
export function settingProbeNames(stamp) {
  const tail = String(stamp).slice(-4)
  if (!/^\d{4}$/.test(tail)) throw new Error(`stamp 의 끝 네 자리가 숫자가 아니다: ${stamp}`)
  return {
    axis: `확인용 축 ${tail}`,
    product: `확인용 제품 ${tail}`,
    menuLabel: `확인용 메뉴 ${tail}`,
    folders: { on: `확인용 폴더 켬 ${tail}`, off: `확인용 폴더 끔 ${tail}`, other: `확인용 폴더 대조 ${tail}` },
    meeting: `E2E 자동 편철 회의 ${tail}`,
    wikiTitle: `E2E 초안 정책 문서 ${tail}`,
  }
}

/**
 * 개인 홈 구성의 확인용 값(widgets-personal 단계) — 기본 배치에 없는 위젯(quick_actions — 조건 없이 누구에게나 보인다)을 맨 앞·전체 폭으로 올리고,
 * 기본 배치의 두 위젯은 순서를 뒤집어 반 폭으로 둔다(기본은 my_work → projects, 둘 다 전체 폭). removeId 는 그다음 저장에서 빼 볼 위젯이다.
 * items 에 PORTAL_PROBE_WIDGET 이 들어 있어야 한다 — 관리자가 그 위젯을 끄면 개인 구성에 있어도 사라지는지를 본다(테스트가 대조).
 */
export const PORTAL_LAYOUT_PROBE = Object.freeze({
  items: Object.freeze([Object.freeze({ id: 'quick_actions', size: 'full' }), Object.freeze({ id: 'projects', size: 'half' }), Object.freeze({ id: 'my_work', size: 'half' })]),
  removeId: 'my_work',
})
/** 개인 설정에 넣을 홈 구성 값 @param {readonly { id: string, size: string }[]} items */
export function portalLayoutOf(items) {
  return { v: 1, items: items.map(({ id, size }) => ({ id, size })), known: [...PORTAL_WIDGET_ORDER] }
}

/** 홈 위젯 설정 값 — 그 위젯 하나만 끄고 나머지는 레지스트리 순서로 켠다 @param {string} offId */
export function portalWidgetsOff(offId) {
  if (!PORTAL_WIDGET_ORDER.includes(offId)) throw new Error(`모르는 홈 위젯이다: ${offId}`)
  return PORTAL_WIDGET_ORDER.map((id) => ({ id, enabled: id !== offId }))
}

/** 메뉴 설정 값 — MENU_PROBE_ORDER 순서로 앞에 두고 첫 항목의 이름을 바꾼다 @param {string} label */
export function navMenuProbe(label) {
  return { order: [...MENU_PROBE_ORDER], labels: { [MENU_PROBE_ORDER[0]]: label } }
}

/** 응답 HTML 의 <title> 글자 전부(문서 순서, 기본 엔티티만 푼다) — 스트리밍 메타데이터는 본문 쪽에 실릴 수 있어 첫 것만 보지 않는다 @param {string} html */
export function titlesOf(html) {
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
  return [...String(html).matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)].map((m) => decode(m[1]).trim())
}

/** 탭 제목이 그 제품 이름으로 끝나는가 — 세 범위의 제목 틀이 모두 '… | <제품>' 이고, 화면 제목이 없으면 제품 이름만이다 @param {string} html @param {string} name */
export function productInTitle(html, name) {
  return titlesOf(html).some((t) => t === name || t.endsWith(` | ${name}`))
}

/** 셸이 실은 강조색 블록의 첫 값(라이트 세트의 action 배경) — 없으면 null(제품 기본색). accentCss.ts 의 출력 꼴과 같다(테스트가 대조) @param {string} html */
export function accentRootOf(html) {
  return /:root\{--color-action:(#[0-9a-f]{6});/.exec(String(html))?.[1] ?? null
}

/** 문서 머리의 아이콘 링크 주소들 — <link rel="icon" …> 의 href @param {string} html @returns {string[]} */
export function iconHrefsOf(html) {
  const out = []
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel="(?:shortcut )?icon"/i.test(tag)) continue
    const href = /\bhref="([^"]*)"/i.exec(tag)?.[1]
    if (href) out.push(href.replace(/&amp;/g, '&'))
  }
  return out
}

/** 사이드 내비에 그려진 항목(문서 순서, id 마다 첫 것) — NavList 의 a[data-nav-item] 와 그 aria-label(= 표시 이름, 배지 수가 뒤에 붙을 수 있다)
 *  @param {string} html @returns {{ id: string, label: string }[]} */
export function navItemsOf(html) {
  const out = [], seen = new Set()
  for (const [tag] of String(html).matchAll(/<a\b[^>]*>/gi)) {
    const id = /\bdata-nav-item="([^"]+)"/.exec(tag)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: /\baria-label="([^"]*)"/.exec(tag)?.[1] ?? '' })
  }
  return out
}

/**
 * 메뉴 설정이 내비에 반영됐는가(순수) — MENU_PROBE_ORDER 의 두 항목이 모두 있고 첫 항목이 둘째보다 앞이며 첫 항목의 이름이 label 로 시작한다.
 * expectApplied=false 면 반대: 둘째(홈)가 앞이고 어느 항목 이름에도 label 이 없다(다른 워크스페이스·되돌린 뒤).
 * @param {{ id: string, label: string }[]} items @param {string} label @param {boolean} expectApplied @returns {string[]} 문제 목록
 */
export function navMenuProblems(items, label, expectApplied) {
  const [first, second] = MENU_PROBE_ORDER
  const at = (id) => items.findIndex((i) => i.id === id)
  if (at(first) < 0 || at(second) < 0) return [`내비에 ${first}·${second} 가 없다(그려진 항목 ${items.map((i) => i.id).join(',') || '없음'})`]
  const p = []
  const applied = at(first) < at(second)
  if (applied !== expectApplied) p.push(expectApplied ? `${first} 가 ${second} 보다 뒤다(순서 미반영)` : `${first} 가 ${second} 보다 앞이다(다른 범위의 순서가 실렸다)`)
  const named = items.some((i) => i.label.includes(label))
  if (expectApplied && !items[at(first)].label.startsWith(label)) p.push(`${first} 의 이름이 ${JSON.stringify(items[at(first)].label)} 다(이름 미반영)`)
  if (!expectApplied && named) p.push(`내비에 이름 ${JSON.stringify(label)} 이 실렸다`)
  return p
}

/** 홈에 그려진 위젯 id(문서 순서, 중복 없이) — WidgetFrame 의 section[data-widget] @param {string} html @returns {string[]} */
export function widgetIdsOf(html) {
  return [...new Set([...String(html).matchAll(/<section\b[^>]*\bdata-widget="([^"]+)"/gi)].map((m) => m[1]))]
}

/**
 * 홈 격자의 칸(문서 순서) — HomeGrid 의 [data-widget-cell][data-size]. 위젯 본문(section[data-widget])이 실제로 그려진 칸만 센다:
 * 칸은 있는데 본문이 없으면(로더를 부르지 않았거나 조건으로 빠졌으면) 그 위젯은 홈에 없는 것이다.
 * @param {string} html @returns {{ id: string, size: string }[]}
 */
export function widgetCellsOf(html) {
  const drawn = new Set(widgetIdsOf(html))
  const out = []
  for (const m of String(html).matchAll(/<(?:div|li)\b[^>]*\bdata-widget-cell="([^"]+)"[^>]*>/gi)) {
    const size = /\bdata-size="([^"]+)"/i.exec(m[0])?.[1] ?? ''
    if (drawn.has(m[1]) && !out.some((c) => c.id === m[1])) out.push({ id: m[1], size })
  }
  return out
}

/**
 * 화면에 내려간 로컬 초안 정책(위키 편집기의 draftPolicy prop) — RSC 페이로드에서 읽는다(따옴표가 \" 로 실린 꼴과 그대로인 꼴 둘 다).
 * 서로 다른 값마다 하나씩 돌려준다 — 한 화면이면 정확히 하나여야 한다(0 이면 편집기가 그려지지 않은 것).
 * @param {string} html @returns {{ allowed: boolean, retention_days: number }[]}
 */
export function draftPoliciesOf(html) {
  const seen = new Map()
  for (const [, body] of String(html).matchAll(/draftPolicy\\?":\{([^{}]*)\}/g)) {
    const allowed = /allowed\\?":(true|false)/.exec(body)?.[1]
    const days = /retention_days\\?":(\d+)/.exec(body)?.[1]
    if (allowed === undefined || days === undefined) continue
    const v = { allowed: allowed === 'true', retention_days: Number(days) }
    seen.set(JSON.stringify(v), v)
  }
  return [...seen.values()]
}

/** 외부 업로드 응답이 그 폴더로 편철됐다고 말하는가 — folder_path(팀 루트부터의 경로)에 그 폴더 이름이 있다 @param {any} body @param {string} segment */
export function filedUnder(body, segment) {
  return Array.isArray(body?.folder_path) && body.folder_path.includes(segment)
}

/** 위키 화면 단계를 돌릴지 — 서버가 WIKI_SERVICE_ENABLED=true 로 떠 있을 때만 켠다(E2E_WIKI=1). 그 밖에는 건너뛴다(실패로 세지 않는다)
 *  @param {Record<string, string | undefined>} env */
export function wikiStepEnabled(env) {
  return env.E2E_WIKI === '1'
}

/**
 * 알림 정책의 두 워크스페이스 격리 판정(순수, 합성 S7b) — 끈 워크스페이스는 이벤트 0, 그대로 둔 워크스페이스는 1건·수신자가 그 멤버,
 * 다시 켠 뒤에는 끈 쪽도 1건이다. 건수는 "이 단계가 일으킨 새 이벤트"다.
 * @param {{ offNew: number, otherNew: number, otherRecipients: { member_id: string }[], otherMemberId: string, onAgainNew: number, restored: boolean }} r
 * @returns {Record<string, boolean>}
 */
export function notifyIsolationChecks({ offNew, otherNew, otherRecipients, otherMemberId, onAgainNew, restored }) {
  return {
    offWorkspaceSilent: offNew === 0,
    otherWorkspaceStillEmits: otherNew === 1,
    otherRecipientIsItsMember: otherRecipients.length === 1 && otherRecipients[0].member_id === otherMemberId,
    onAgainEmits: onAgainNew === 1,
    restored: restored === true,
  }
}

/** 로고(마크) 객체 경로 — 앱의 규약 ws/<워크스페이스>/branding/<슬롯>-<sha256 앞 16자>.<확장자>(brandingPath.ts — 테스트가 그 판독기로 대조)
 *  @param {string} workspaceId @param {string} sha256Hex 파일 내용의 sha256(hex) */
export function brandMarkPath(workspaceId, sha256Hex) {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new Error('sha256 hex 64자가 아니다')
  return `ws/${workspaceId}/branding/mark-${sha256Hex.slice(0, 16)}.png`
}

/** 키 순서를 정렬한 JSON — 저장값(jsonb 는 키를 제 순서로 돌려준다)을 입력값과 비교할 때 쓴다. 배열 순서는 그대로다 @param {unknown} v */
export function canonicalJson(v) {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
}
