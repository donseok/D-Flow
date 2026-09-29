import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { isShareToken } from '@/lib/minutes/share'
import { requireModule } from '@/lib/modules/gate'
import { ShareViewer } from '@/components/minutes/ShareViewer'
import type { TeamCode } from '@/lib/domain/types'

// 공유 OFF/재발급이 다음 요청부터 즉시 반영되도록 정적 캐시 금지
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function SharedMinutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isShareToken(token)) notFound()
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
