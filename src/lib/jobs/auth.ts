// 잡 라우트의 인증 한 곳(정본 §5.5.2 ①, §3.2.7 규칙 1·2). 스케줄(GET)·수동(POST) 모두 Authorization: Bearer <CRON_SECRET> 이다.
//   ① CRON_SECRET 미설정 → 404(존재를 숨긴다 — 시크릿 없이 열리지 않는다)
//   ② 레지스트리 항목의 envAvailable 이 거짓 → 404
//   ③ 헤더 없음·형식 다름·불일치 → 401
// 판정은 service_role 클라이언트를 만들기 전에 끝난다 — 닫힌 잡은 큐를 선점하지 않는다.
import { createHash, timingSafeEqual } from 'crypto'
import { jobDef, type JobId } from './registry'

/** 시크릿 비교는 길이 노출·타이밍 채널을 피하기 위해 해시 후 상수시간으로 비교한다. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

const notFound = () => Response.json({ error: 'NOT_FOUND' }, { status: 404 })

/** 통과하면 null, 아니면 그대로 돌려줄 응답(404·401). */
export function authorizeJob(req: Request, id: JobId): Response | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return notFound()
  if (!jobDef(id).envAvailable()) return notFound()
  const header = req.headers.get('authorization')
  if (!secretMatches(header?.startsWith('Bearer ') ? header.slice(7) : null, secret)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  return null
}
