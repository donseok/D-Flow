import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
import { wsHref } from '@/lib/workspace/paths'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { IntegrationCredentialsManager } from '@/components/settings/IntegrationCredentialsManager'

export const dynamic = 'force-dynamic'
export const metadata = { title: '연동 자격증명' }

export default async function WorkspaceIntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const access = await workspacePageAccess(slug)
  if (!access.isAdmin) redirect(wsHref(access.slug))

  const admin = createAdminClient()
  const [{ data: projectsData }, { data: teamsData }] = await Promise.all([
    admin.from('projects').select('id, name').eq('workspace_id', access.id).order('name'),
    admin.from('teams').select('id, code, name').eq('workspace_id', access.id).order('name'),
  ])

  const projects = (projectsData ?? []).map((p: { id: string; name: string }) => ({
    id: p.id,
    name: p.name,
  }))
  const teams = (teamsData ?? []).map((t: { id: string; code: string; name: string }) => ({
    id: t.id,
    code: t.code,
    name: t.name,
  }))

  return (
    <PageFrame
      header={
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Link
              href={wsHref(access.slug, 'settings')}
              className="inline-flex items-center gap-1 hover:text-ink transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              설정으로 돌아가기
            </Link>
          </div>
          <PageHeader title="연동 자격증명" meta={access.name} />
        </div>
      }
    >
      <div className="max-w-5xl mx-auto py-2">
        <IntegrationCredentialsManager
          workspaceId={access.id}
          projects={projects}
          teams={teams}
        />
      </div>
    </PageFrame>
  )
}
