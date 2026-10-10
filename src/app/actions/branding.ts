'use server'

import { requireWorkspaceAdmin } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/validate'
import { adminFor } from '@/lib/supabase/adminFor'
import { BRANDING_BUCKET, BRANDING_SLOTS, type BrandingSlot } from '@/lib/settings/brandingPath'
import { inspectBrandLogo } from '@/lib/settings/logoFile'
import { serverTranslator } from '@/lib/i18n/server'

export type BrandUploadResult = { ok: true; path: string } | { ok: false; error: string }

/** 파일 업로드만 수행한다. 설정 revision 변경은 updateWorkspaceSettings가 맡는다. */
export async function uploadBrandLogo(workspaceId: string, slot: BrandingSlot, file: File): Promise<BrandUploadResult> {
  const t = await serverTranslator()
  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }
  if (!isUuidLike(workspaceId) || !(BRANDING_SLOTS as readonly string[]).includes(slot)) return { ok: false, error: t('srv.branding.logoSlotNotValid') }
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') return { ok: false, error: t('srv.branding.logoFileRequired') }
  try {
    const checked = await inspectBrandLogo(workspaceId, slot, file)
    if (!checked.ok) return checked
    const { error } = await adminFor({ workspaceId }).admin.storage.from(BRANDING_BUCKET).upload(checked.path, checked.bytes,
      { contentType: checked.contentType, upsert: true })
    if (error) {
      console.error('[branding] 로고 업로드 실패:', { workspaceId, slot, cause: error.message })
      return { ok: false, error: t('srv.branding.couldNotUploadLogo') }
    }
    return { ok: true, path: checked.path }
  } catch (error) {
    console.error('[branding] 로고 업로드 예외:', { workspaceId, slot, cause: error })
    return { ok: false, error: t('srv.branding.couldNotUploadLogo') }
  }
}
