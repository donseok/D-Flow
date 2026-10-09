import { extractCspViolations } from '@/lib/http/cspReport'
import { noteRateFailureFor, rateLimitedFor } from '@/lib/http/rateLimit'

/**
 * CSP 위반 보고 수집 — **무인증**(브라우저가 정책의 report-uri·report-to 로 직접 보낸다. 로그인 전 화면의 위반도 받아야 하고, 보고 요청에는
 * 세션을 기대할 수 없다). 저장하지 않는다 — 서버 로그 한 줄(지시어 + 차단된 주소)이 전부다. 강제 전환 전에 "위반 0건"을 확인하는 용도다
 * (docs/runbook-selfhost.md '응답 보안 헤더').
 * 누구나 칠 수 있는 주소라 좁게 받는다: 보고 콘텐츠 타입만, 본문 상한, IP 별 요청 수 제한(넘으면 읽지 않고 429 — 로그를 불리지 못하게),
 * 본문에서는 두 값만 뽑는다(쿠키·쿼리스트링·문서 주소·본문 전체를 남기지 않는다 — cspReport.ts). 응답에는 아무것도 싣지 않는다.
 */
export const dynamic = 'force-dynamic'

/** 본문 상한 — 보고 한 건은 1~2KB 다(Reporting API 가 여러 건을 묶어도 이 안에 든다). 넘으면 읽다 말고 413 */
const MAX_BYTES = 32 * 1024
const TYPES: ReadonlySet<string> = new Set(['application/csp-report', 'application/reports+json', 'application/json'])
const empty = (status: number, headers?: Record<string, string>) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

/** 상한까지만 읽는다 — Content-Length 를 믿지 않는다(없거나 거짓일 수 있다). 넘으면 null */
async function readCapped(req: Request): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

export async function POST(req: Request): Promise<Response> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!TYPES.has(type)) return empty(415)
  // 요청마다 센다(실패만 세는 다른 길과 다르다 — 여기는 모든 요청이 로그 한 줄이 될 수 있다). 막힌 동안에는 본문을 읽지 않는다
  const wait = rateLimitedFor('cspReport', req.headers)
  if (wait > 0) return empty(429, { 'Retry-After': String(wait) })
  noteRateFailureFor('cspReport', req.headers)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return empty(413)

  let text: string | null
  try { text = await readCapped(req) } catch { return empty(400) }
  if (text === null) return empty(413)
  let body: unknown
  try { body = JSON.parse(text) } catch { return empty(400) }
  // 지시어와 차단된 주소(출처+경로)만 — 한 건에 한 줄
  for (const v of extractCspViolations(body)) console.warn(`[csp] 위반 보고 directive=${v.directive} blocked=${v.blocked}`)
  return empty(204)
}
