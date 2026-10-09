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

/** 마크가 저장돼 있으면 세션 읽기 라우트 주소를, 없거나 손상이면 null — 호출부는 루트 파일 아이콘을 그대로 둔다. */
export function workspaceIconHref(config: WorkspaceConfig): string | null {
  const logo = config.keys['branding.logo']
  if (logo.status !== 'set' || !logo.value.mark) return null
  return `/api/brand/${config.workspaceId}/mark`
}

export async function loadDisplayBranding(workspaceId: string, client?: ConfigReadClient): Promise<DisplayBranding> {
  try { return displayBranding(await getWorkspaceConfig(workspaceId, { client })) }
  catch (error) {
    console.error('[branding] 설정 조회 실패:', { workspaceId, cause: error })
    return { productName: BRAND.productName, mailFromName: BRAND.productName }
  }
}

/**
 * 제품 이름 한 값 — 워크스페이스가 정해진 자리는 그 워크스페이스의 설정값, 정해지지 않은 자리(null)는 배포 기본(BRAND).
 * AI 프롬프트처럼 "워크스페이스를 알면 쓰고 모르면 기본"인 호출부가 분기를 되풀이하지 않게 둔다. 판독 실패는 loadDisplayBranding 이 기본으로 내린다.
 */
export async function productNameFor(workspaceId: string | null | undefined, client?: ConfigReadClient): Promise<string> {
  return workspaceId ? (await loadDisplayBranding(workspaceId, client)).productName : BRAND.productName
}
