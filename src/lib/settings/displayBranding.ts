import 'server-only'
import { BRAND } from '@/lib/branding'
import { getWorkspaceConfig, type WorkspaceConfig } from './workspaceConfig'
import type { ConfigReadClient } from './projectConfig'

export interface DisplayBranding { productName: string; mailFromName: string }

/** Invalid branding states are already logged by resolveKeys; display surfaces use a neutral fallback. */
export function displayBranding(config: WorkspaceConfig): DisplayBranding {
  const product = config.keys['branding.product_name']
  const productName = product.status === 'set' || product.status === 'default' ? product.value : BRAND.productName
  const from = config.keys['branding.mail_from_name']
  const mailFromName = from.status === 'set' || from.status === 'default' ? (from.value ?? productName) : productName
  return { productName, mailFromName }
}

export async function loadDisplayBranding(workspaceId: string, client?: ConfigReadClient): Promise<DisplayBranding> {
  try { return displayBranding(await getWorkspaceConfig(workspaceId, { client })) }
  catch (error) {
    console.error('[branding] 설정 조회 실패:', { workspaceId, cause: error })
    return { productName: BRAND.productName, mailFromName: BRAND.productName }
  }
}
