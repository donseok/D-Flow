// CSP 위반 보고의 본문 → 로그에 남길 두 값(차단된 주소·지시어)만 뽑는 순수 함수. 수집 라우트(src/app/api/csp-report/route.ts)가 쓴다.
// 보고 본문은 **누구나 보낼 수 있는 입력**이다(무인증 수집). 그래서 남기는 것을 좁힌다:
//   · 차단된 주소는 출처+경로까지만 — 쿼리스트링·조각(#)·사용자 정보는 버린다(Storage 서명 URL 의 토큰이 쿼리에 있다).
//   · 문서 주소(document-uri)·리퍼러·원문 정책·스크립트 견본(script-sample)·그 밖의 칸은 읽지 않는다(화면 경로의 토큰·본문 조각이 들어 있을 수 있다).
//   · 값은 길이를 자르고 출력 가능한 ASCII 만 남긴다(줄바꿈으로 가짜 로그 줄을 만들지 못하게).

export interface CspViolation { directive: string; blocked: string }

/** 본문 하나에서 읽는 보고 수의 상한 — Reporting API 는 여러 건을 한 배열로 보낸다 */
export const CSP_REPORT_MAX_ENTRIES = 20
const BLOCKED_MAX = 200
const DIRECTIVE_RE = /^[a-z][a-z-]{2,40}$/
/** 주소가 아닌 차단 대상(브라우저가 낱말로 적는다) */
const KEYWORDS: ReadonlySet<string> = new Set(['inline', 'eval', 'wasm-eval', 'self', 'data', 'blob', 'about', 'filesystem', 'mediastream', 'trusted-types-policy', 'trusted-types-sink'])

/** 'script-src-elem' 또는 옛 형식의 "script-src 'self' …"(지시어 + 값) → 지시어 이름. 형식 밖이면 'unknown' */
export function cleanDirective(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown'
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return DIRECTIVE_RE.test(name) ? name : 'unknown'
}

/** 차단된 주소 → 출처+경로(쿼리·조각 제거) 또는 낱말. 읽을 수 없으면 'other' */
export function cleanBlocked(raw: unknown): string {
  if (typeof raw !== 'string') return 'other'
  const text = raw.trim()
  if (text === '') return 'other'
  const word = text.toLowerCase().replace(/:$/, '')
  if (KEYWORDS.has(word)) return word
  let u: URL
  try { u = new URL(text) } catch { return 'other' }
  // data:·blob: 는 내용이 주소에 실려 있다 — 종류만 남긴다. 그 밖의 비표준 스킴(확장 프로그램 등)도 스킴만
  if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') {
    const scheme = u.protocol.replace(/:$/, '').replace(/[^a-z0-9+.-]/g, '')
    return scheme || 'other'
  }
  return `${u.protocol}//${u.host}${u.pathname}`.replace(/[^\x21-\x7e]/g, '').slice(0, BLOCKED_MAX)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 보고 본문(파싱된 JSON) → 위반 목록. 두 형식을 읽는다:
 *   · report-uri(옛 방식): { "csp-report": { "blocked-uri", "effective-directive" | "violated-directive", … } }
 *   · report-to(Reporting API): [{ "type": "csp-violation", "body": { "blockedURL", "effectiveDirective", … } }, …]
 * 형식 밖이면 [](버린다). 다른 종류의 보고(deprecation 등)는 건너뛴다.
 */
export function extractCspViolations(body: unknown): CspViolation[] {
  if (Array.isArray(body)) {
    const out: CspViolation[] = []
    for (const item of body.slice(0, CSP_REPORT_MAX_ENTRIES)) {
      if (!isRecord(item) || item.type !== 'csp-violation' || !isRecord(item.body)) continue
      out.push({ directive: cleanDirective(item.body.effectiveDirective), blocked: cleanBlocked(item.body.blockedURL) })
    }
    return out
  }
  if (isRecord(body) && isRecord(body['csp-report'])) {
    const r = body['csp-report']
    return [{ directive: cleanDirective(r['effective-directive'] ?? r['violated-directive']), blocked: cleanBlocked(r['blocked-uri']) }]
  }
  return []
}
