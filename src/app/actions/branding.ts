'use server'

import { requireWorkspaceAdmin } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/validate'
import { adminFor } from '@/lib/supabase/adminFor'
import { BRANDING_BUCKET, BRANDING_SLOTS, type BrandingSlot } from '@/lib/settings/brandingPath'
import { inspectBrandLogo } from '@/lib/settings/logoFile'

export type BrandUploadResult = { ok: true; path: string } | { ok: false; error: string }

/** 파일 업로드만 수행한다. 설정 revision 변경은 updateWorkspaceSettings가 맡는다. */
export async function uploadBrandLogo(workspaceId: string, slot: BrandingSlot, file: File): Promise<BrandUploadResult> {
  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }
  if (!isUuidLike(workspaceId) || !(BRANDING_SLOTS as readonly string[]).includes(slot)) return { ok: false, error: '로고 위치가 올바르지 않습니다.' }
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') return { ok: false, error: '로고 파일이 필요합니다.' }
  try {
    const checked = await inspectBrandLogo(workspaceId, slot, file)
    if (!checked.ok) return checked
    const { error } = await adminFor({ workspaceId }).admin.storage.from(BRANDING_BUCKET).upload(checked.path, checked.bytes,
      { contentType: checked.contentType, upsert: true })
    if (error) {
      console.error('[branding] 로고 업로드 실패:', { workspaceId, slot, cause: error.message })
      return { ok: false, error: '로고를 올리지 못했습니다. 잠시 뒤 다시 시도하세요.' }
    }
    return { ok: true, path: checked.path }
  } catch (error) {
    console.error('[branding] 로고 업로드 예외:', { workspaceId, slot, cause: error })
    return { ok: false, error: '로고를 올리지 못했습니다. 잠시 뒤 다시 시도하세요.' }
  }
}
