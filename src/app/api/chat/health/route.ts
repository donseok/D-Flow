import { NextResponse } from 'next/server'
import { requireSuperuser } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { assistantHealth } from '@/lib/ai/health'
import { serverTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

/** AI 어시스턴트 진단 — 키 설정/마이그레이션 적용 상태를 노출(슈퍼유저 전용). 설정 화면 배지와 동일 소스. */
export async function GET() {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g) })
  try {
    return NextResponse.json(await assistantHealth())
  } catch (e) {
    console.error('[assistant] /api/chat/health 오류:', e)
    return NextResponse.json({ error: t('srv.api.chatHealth.healthCheckFailed') }, { status: 500 })
  }
}
