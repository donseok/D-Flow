import type { Metadata } from 'next'
import { BRAND } from '@/lib/branding'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const ws = await workspacePageAccess(slug)
  let productName: string = BRAND.productName
  try {
    productName = valueOf(await getWorkspaceConfig(ws.id), 'branding.product_name')
  } catch (error) {
    console.error('[workspace settings] 제품명 판독 실패:', error)
  }
  return { title: `${ws.name} 설정 | ${productName}` }
}

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { slug } = await params
  await workspacePageAccess(slug)
  return children
}
