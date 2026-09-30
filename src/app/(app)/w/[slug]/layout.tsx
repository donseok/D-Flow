import type { Metadata } from 'next'
import { BRAND } from '@/lib/branding'
import { displayBranding, workspaceIconHref } from '@/lib/settings/displayBranding'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const ws = await workspacePageAccess(slug)
  let productName: string = BRAND.productName
  let icon: string | null = null
  try {
    const config = await getWorkspaceConfig(ws.id)
    productName = displayBranding(config).productName
    icon = workspaceIconHref(config)
  } catch (error) {
    console.error('[workspace settings] 브랜딩 판독 실패:', error)
  }
  // 메타데이터 icons 가 루트 파일 아이콘(src/app/icon.tsx)을 덮는다(2026-10-01 실측). 마크가 없으면 덮지 않는다.
  return { title: `${ws.name} 설정 | ${productName}`, ...(icon ? { icons: { icon } } : {}) }
}

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { slug } = await params
  await workspacePageAccess(slug)
  return children
}
