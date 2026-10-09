'use server'
import { requireProjectAdmin } from '@/lib/authz'
import { ingestProject } from '@/lib/ai/ingest'
import { requireModule } from '@/lib/modules/gate'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

/** AI 어시스턴트 의미검색 색인 재생성(그 프로젝트의 관리자 — 색인은 프로젝트 단위다, SP2 §4.1). 설정 화면/임포트 후 호출. */
export async function reindexProjectAction(projectId: string): Promise<{
  ok: boolean
  error?: string
  count?: number
  skipped?: boolean
  reason?: string
  skippedItems?: number
}> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: libText(t, g.error) }
  const mod = await requireModule({ projectId }, 'chatbot')                   // 스펙 §4.2 — 챗봇을 끈 프로젝트는 색인을 다시 만들지 않는다
  if (!mod.ok) return { ok: false, error: libText(t, mod.error) }
  try {
    const r = await ingestProject(projectId)
    return { ok: true, count: r.count, skipped: r.skipped, reason: r.reason, skippedItems: r.skippedItems }
  } catch (e) {
    // 원문 DB/PostgREST 메시지를 클라이언트로 흘리지 않는다(상세는 서버 로그에만).
    console.error('[assistant] reindexProjectAction 오류:', e instanceof Error ? e.message : e)
    return { ok: false, error: t('err.indexingFailed') }
  }
}
