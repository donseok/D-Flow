import { getActor } from '@/lib/authz'
import { isWorkspaceMember } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/validate'
import { createServerClient } from '@/lib/supabase/server'
import { BRANDING_BUCKET, BRANDING_SLOTS, parseBrandingPath, type BrandingSlot } from '@/lib/settings/brandingPath'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }
const missing = () => new Response(null, { status: 404, headers: HEADERS })

/** 비공개 버킷의 현재 로고 슬롯만 세션으로 읽는다. 이전 파일 경로는 URL에서 고를 수 없다. */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; slot: string }> }) {
  const { workspaceId, slot } = await context.params
  if (!isUuidLike(workspaceId) || !(BRANDING_SLOTS as readonly string[]).includes(slot)) return missing()
  let actor: Awaited<ReturnType<typeof getActor>>
  try { actor = await getActor() } catch (error) {
    console.error('[brand] 소속 조회 실패:', error)
    return new Response(null, { status: 503, headers: HEADERS })
  }
  if (!isWorkspaceMember(actor, workspaceId)) return missing()
  try {
    const sb = await createServerClient()
    const cfg = await getWorkspaceConfig(workspaceId, { client: sb })
    const state = cfg.keys['branding.logo']
    if (state.status !== 'set' && state.status !== 'default') return missing()
    const path = state.value[slot as BrandingSlot]
    if (!path) return missing()
    const parsed = parseBrandingPath(path)
    if (!parsed.ok || parsed.value.workspaceId !== workspaceId || parsed.value.slot !== slot) return missing()
    const { data, error } = await sb.storage.from(BRANDING_BUCKET).download(path)
    if (error || !data) {
      console.error('[brand] 로고 다운로드 실패:', { workspaceId, slot, cause: error?.message })
      return new Response(null, { status: 503, headers: HEADERS })
    }
    const type = parsed.value.ext === 'png' ? 'image/png' : parsed.value.ext === 'jpg' ? 'image/jpeg' : 'image/webp'
    return new Response(data, { status: 200, headers: { ...HEADERS, 'Content-Type': type } })
  } catch (error) {
    console.error('[brand] 로고 조회 실패:', { workspaceId, slot, cause: error })
    return new Response(null, { status: 503, headers: HEADERS })
  }
}
