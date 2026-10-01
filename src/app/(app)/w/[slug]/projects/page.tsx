import Link from 'next/link'
import { Calendar, FolderPlus, ArrowRight } from 'lucide-react'
import { listProjects } from '@/app/actions/project'
import { isWorkspaceAdmin } from '@/lib/domain/authz'
import { getProjectsCompletion } from '@/lib/data/wbs'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { EmptyState } from '@/components/ui/EmptyState'
import { NewProjectModal } from '@/components/home/NewProjectModal'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { seoulToday } from '@/lib/domain/dates'
import { BRAND } from '@/lib/branding'

type ProjectRow = {
  id: string
  name: string
  workspace_id: string
  description?: string | null
  start_date: string | null
  end_date: string | null
  created_at?: string | null
}

const STATUS: Record<ProjectLifecycleStatus, { labelKey: DictKey; chip: string; dot: string }> = {
  ready: { labelKey: 'home.status_ready', chip: 'bg-pending-weak text-pending', dot: 'bg-pending' },
  active: { labelKey: 'home.status_active', chip: 'bg-brand-weak text-brand', dot: 'bg-brand' },
  overdue: { labelKey: 'home.status_overdue' as DictKey, chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
  done: { labelKey: 'home.status_done', chip: 'bg-done-weak text-done', dot: 'bg-done' },
  unknown: { labelKey: 'home.status_unknown' as DictKey, chip: 'bg-surface-2 text-ink-muted', dot: 'bg-ink-subtle' },
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'
  // 영문은 단어 첫 글자 2개, 그 외(한글 등)는 앞 2글자
  const ascii = /^[\x00-\x7F]+$/.test(trimmed)
  if (ascii) {
    const parts = trimmed.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)).toUpperCase()
  }
  return trimmed.slice(0, 2)
}

function dateRange(start: string | null, end: string | null, locale: Locale): string {
  if (!start && !end) return t(locale, 'home.scheduleUnset')
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

function ProjectCard({ project, status, locale }: { project: ProjectRow; status: ProjectLifecycleStatus; locale: Locale }) {
  const s = STATUS[status]
  return (
    <Link
      href={`/p/${project.id}/dashboard`}
      className="card group flex min-h-[184px] flex-col p-5 transition hover:border-brand-ring hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-[var(--shadow-sm)]"
          style={{ backgroundImage: 'var(--gradient-primary)' }}
        >
          {initials(project.name)}
        </span>
        <span className={`chip ${s.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {t(locale, s.labelKey)}
        </span>
      </div>

      <div className="mt-4 min-w-0">
        <h3 className="truncate text-[15px] font-semibold text-ink" title={project.name}>{project.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-ink-muted">
          {project.description?.trim() || t(locale, 'home.noDescription')}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-subtle">
          <Calendar className="h-3.5 w-3.5" />
          <span className="tabular-nums">{dateRange(project.start_date, project.end_date, locale)}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-ink-subtle transition group-hover:text-brand">
          {t(locale, 'home.open')} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}

export const metadata = { title: `전체 프로젝트 | ${BRAND.productName}` }

export default async function ProjectsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  // 세 조회는 서로 독립 — 한 배치로 병렬. getProjectsCompletion 은 무인자 + React cache 라 레이아웃 실행분과 dedupe 된다.
  const [{ new: openNew }, rawProjects, locale, completion] = await Promise.all([
    searchParams, listProjects(), getServerLocale(), getProjectsCompletion(),
  ])
  const projects = (rawProjects as ProjectRow[]).filter(p => p.workspace_id === scope.ws.id)   // 슬러그 워크스페이스만
  const today = seoulToday()

  // 상태 배지 — 레이아웃과 같은 완료율 맵을 쓴다(트리 로드 없음). completion === null 은 조회 실패(상태 모름) —
  // 'WBS 없음'으로 뭉개면 종료일 지난 미완 프로젝트가 '완료' 배지로 둔갑한다. 맵에 항목이 없는 프로젝트 = WBS 0건(정상).
  const withStatus = projects.map(p => ({
    project: p,
    status: projectLifecycleStatus(
      p.start_date, p.end_date, today,
      completion === null ? null : (completion[p.id] ?? { hasWbs: false, allDone: false }),
    ),
  }))
  // 프로젝트 생성은 그 워크스페이스의 관리자(SP2 §4.1) — 대상은 슬러그 워크스페이스다(D26). createProject 액션이 다시 검증한다.
  // 권한 조회가 열화(actor null)면 isWorkspaceAdmin 이 거짓 — 버튼을 주지 않는다(fail-closed).
  const canCreate = isWorkspaceAdmin(scope.actor, scope.ws.id)
  const copyCandidates = canCreate ? projects.map(p => ({ id: p.id, name: p.name })) : []
  const create = canCreate
    ? <NewProjectModal workspaceId={scope.ws.id} copyCandidates={copyCandidates} defaultOpen={openNew === '1'} />
    : undefined

  return (
    <PageFrame width="portal" header={
      <PageHeader title={t(locale, 'nav.allProjects')} meta={`${withStatus.length}${t(locale, 'home.countUnit')}`} primaryAction={create} />
    }>
      {withStatus.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title={t(locale, 'home.emptyTitle')}
          description={t(locale, 'home.emptyDesc')}
          action={canCreate
            ? <NewProjectModal workspaceId={scope.ws.id} copyCandidates={copyCandidates} label={t(locale, 'home.newProjectStart')} className="btn btn-primary" />
            : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 pb-20 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {withStatus.map(({ project, status }) => (
            <ProjectCard key={project.id} project={project} status={status} locale={locale} />
          ))}
        </div>
      )}
    </PageFrame>
  )
}
