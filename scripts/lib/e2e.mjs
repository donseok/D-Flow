// scripts/lib/e2e.mjs — e2e-local.mjs 의 순수 조각(부작용 없음). vitest 로 고정한다.
// 러너는 로컬 스택만 두드린다 — 대상 판정은 targets.mjs 한 곳에서 한다.
import { classifySupabaseUrl, detectEnvTarget, parseEnvFile } from './targets.mjs'

/** 새 프로젝트의 단계 라벨(SP0 done_when 1번). 행의 아웃라인 깊이와 같아야 한다. */
export const LEVEL_LABELS = ['단계', '작업', '활동']

/** 양식 헤더 — src/lib/excel/template.ts TEMPLATE_HEADER 와 같아야 한다(테스트가 드리프트를 잡는다). */
export const TEMPLATE_HEADER = ['코드', '업무명', '업무영역', '산출물', '시작일', '종료일', '가중치', '실적%', '담당']

/**
 * 양식에 채울 행 — 아웃라인 3층(LEVEL_LABELS 와 같은 깊이), 담당은 팀명 직접 방식으로 부트스트랩 팀 하나.
 * 날짜는 ISO 로 두고 러너가 toCell 로 바꾼다. 빈 칸은 ''(toCell 이 null 로 바꾼다).
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
