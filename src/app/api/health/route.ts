import { createAdminClient } from '@/lib/supabase/admin'
import { hasCronBearer } from '@/lib/jobs/auth'

/**
 * 헬스체크 — 무인증. 로드밸런서·가동 감시·자체호스트의 systemd 가 친다(docs/runbook-selfhost.md "헬스체크").
 *  · 얕은 점검(기본): 프로세스가 요청을 받는다는 사실만 — `{ ok: true }`. DB 를 건드리지 않는다.
 *  · 깊은 점검(`?deep=1` + `Authorization: Bearer <CRON_SECRET>`): DB 를 한 번 읽는다. 실패하면 503.
 *    익명 요청이 DB 조회를 일으키지 못하게 시크릿이 맞을 때만 한다 — 없거나 틀리면 거부하지 않고 얕은 응답으로 내려간다
 *    (감시 도구가 시크릿 없이 쳐도 생존 신호는 받는다. 깊은 점검이 실제로 돌았는지는 응답의 `db` 칸으로 안다).
 * 응답에는 상태 낱말만 싣는다 — 오류 문구·버전·환경 값은 넣지 않는다(원인은 서버 로그). 캐시하지 않는다.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(req: Request): Promise<Response> {
  const deep = new URL(req.url).searchParams.get('deep') === '1'
  if (!deep || !hasCronBearer(req)) return Response.json({ ok: true }, { headers: NO_STORE })
  try {
    // 어느 배포에나 있는 core 표 한 줄 — 행 내용은 쓰지 않는다(연결·권한·PostgREST 가 살아 있는지만)
    const { error } = await createAdminClient().from('workspaces').select('id').limit(1)
    if (error) {
      console.error('[health] 깊은 점검 실패 — DB 조회 오류:', error.message)
      return Response.json({ ok: false, db: 'unavailable' }, { status: 503, headers: NO_STORE })
    }
    return Response.json({ ok: true, db: 'ok' }, { headers: NO_STORE })
  } catch (e) {
    // 클라이언트 생성 실패(환경 변수 누락)·네트워크 예외도 같은 응답 — 원인은 로그에만
    console.error('[health] 깊은 점검 실패:', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, db: 'unavailable' }, { status: 503, headers: NO_STORE })
  }
}
