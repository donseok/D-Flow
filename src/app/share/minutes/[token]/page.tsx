import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { isShareToken } from '@/lib/minutes/share'
import { requireModule } from '@/lib/modules/gate'
import { noteRateFailure, rateLimited } from '@/lib/http/rateLimit'
import { t } from '@/lib/i18n/dict'
import { ShareViewer } from '@/components/minutes/ShareViewer'
import type { TeamCode } from '@/lib/domain/types'

// 공유 OFF/재발급이 다음 요청부터 즉시 반영되도록 정적 캐시 금지
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function SharedMinutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // 요청 제한(src/lib/http/rateLimit.ts 'shareToken') — 같은 IP 가 없는 공유 토큰을 한도만큼 대면 창이 끝날 때까지 닫는다. 토큰을 보기 전에
  // 판정한다(막힌 동안에는 맞는 링크도 같은 안내 — 유효 여부를 더 드러내지 않는다). 서버 컴포넌트는 응답 상태를 바꾸지 못해 429 가 아니라
  // 안내 문구를 그린다. 세는 것은 틀린 토큰뿐이다(형식이 아닌 값·없거나 꺼진 공유). 조회 장애·꺼진 모듈은 세지 않는다
  if ((await rateLimited('shareToken')) > 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <p role="alert" data-rate-limited className="text-body text-fg-secondary">{t('rateLimit.tooMany')}</p>
      </main>
    )
  }
  if (!isShareToken(token)) { await noteRateFailure('shareToken'); notFound() }
  // env 가드 — 미설정 배포에서 500 대신 404 (rematchMinuteHighlights 와 동일 패턴)
  if (!serviceRoleConfigured()) {
    console.error('[share] service_role 환경변수 미설정 — 공유 페이지 비활성')
    notFound()
  }
  const admin = createAdminClient()
  // ① 워크스페이스만 — 모듈이 꺼졌으면 본문을 읽지 않는다(스펙 §7.1 share-minutes-gate). 조건은 본문 조회와 같다.
  const { data: head, error: headErr } = await admin.from('minutes')
    .select('workspace_id')
    .eq('share_token', token)
    .eq('share_enabled', true)
    .is('archived_at', null)
    .maybeSingle()
  if (headErr) console.error('[share] 공유 회의록 범위 조회 실패:', headErr.message)
  else if (!head) await noteRateFailure('shareToken')
  if (!head) notFound()
  // ② 모듈 관문(스펙 §4.2 3행) — 세션이 없는 익명 경로라 admin 으로 판정한다(쿠키 없는 세션 클라이언트는 0행 → 모든 링크가 닫힌다)
  const gate = await requireModule({ workspaceId: head.workspace_id as string }, 'minutes', { client: admin })
  if (!gate.ok) notFound()
  // ③ 반환 컬럼 화이트리스트(스펙 §3.2) — 작성자 실명·첨부·하이라이트·인사이트 미노출
  const { data, error } = await admin.from('minutes')
    .select('minute_date, team_code, title, body_md')
    .eq('share_token', token)
    .eq('share_enabled', true)
    .is('archived_at', null)
    .maybeSingle()
  if (error) console.error('[share] 공유 회의록 본문 조회 실패:', error.message)
  if (!data) notFound()
  return (
    <ShareViewer
      minuteDate={data.minute_date as string}
      teamCode={data.team_code as TeamCode}
      title={data.title as string}
      bodyMd={data.body_md as string}
    />
  )
}
