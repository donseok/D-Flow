import { Shield } from 'lucide-react'
import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/app/PageHeader'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { ImportModes } from '@/components/import/ImportModes'
import { ImportReceiptPanel, receiptStateOf } from '@/components/import/ImportReceiptPanel'
import { getImportReceipt } from '@/app/actions/importReceipts'
import { t } from '@/lib/i18n/dict'
import { requireModulePage } from '@/lib/modules/pageGate'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick, pickCalendar } from '@/lib/settings/pick'

/** replace 경고 문구에 실제 삭제 건수를 싣기 위한 조회(리뷰 Important #1). 조회 실패는
 *  표시=로깅 원칙대로 로그만 남기고 null 로 degrade — 마법사는 숫자 없는 문구로 계속 동작한다. */
async function fetchWbsItemCount(projectId: string): Promise<number | null> {
  const sb = await createServerClient()
  const { count, error } = await sb
    .from('wbs_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (error) {
    console.error('[import] wbs_items 건수 조회 실패 — 경고 문구는 건수 없이 표시:', error.message)
    return null
  }
  return count ?? null
}

/** 프로젝트 달력의 tz — 실행 기록 시각·백업 파일 이름의 날짜. 설정 조회 실패·달력 손상은 null + 로그(표시 = 로깅, 사유 원문은 화면에 싣지 않는다) */
async function projectTimezone(projectId: string): Promise<string | null> {
  const pc = await loadProjectConfigForPage(projectId)
  const cal = pc.ok ? pickCalendar(pc.cfg) : null
  if (cal?.ok) return cal.calendar.timezone
  console.error('[import] 프로젝트 달력을 읽지 못해 실행 기록 시각·백업 파일 날짜를 비운다:', { projectId, key: cal && !cal.ok ? cal.key : null })
  return null
}

/** 추가 축 이름(core.extra_axis_label) — 마법사의 그 열 이름. 비었거나 못 읽으면 null(사전 기본 문구 — 표시 전용이라 마법사는 막지 않는다) */
async function projectExtraAxisLabel(projectId: string): Promise<string | null> {
  const pc = await loadProjectConfigForPage(projectId)
  const label = pc.ok ? pick(pc.cfg, 'core.extra_axis_label') : null
  if (label?.ok) return label.value
  console.error('[import] 추가 축 이름을 읽지 못해 기본 문구로 그린다:', { projectId })
  return null
}

/**
 * 임포트 마법사 진입 페이지(§6.2) — 서버는 프로젝트 실재·권한 확인만 하고, 감지·실행은 전부
 * 클라이언트가 `/api/import/inspect`·`/api/import/execute` 를 직접 호출한다(서버 임시 저장 없음).
 */
export default async function ImportWizardPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ receipt?: string | string[] }>
}) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'wbs')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [projects, actor, { receipt }] = await Promise.all([listProjects(), getActorForView(), searchParams])
  const project = projects.find(p => p.id === projectId)
  const isAdmin = isProjectAdmin(actor, projectId)
  const projectName = project?.name ?? t('importWizard.projectFallback')
  // 비관리자는 위저드를 렌더하지 않으니(아래) 조회 자체를 건너뛴다 — 불필요한 쿼리 방지.
  const currentItemCount = isAdmin ? await fetchWbsItemCount(projectId) : null
  // ?receipt= — 같은 화면의 실행 기록(#23, 계획 P9). 관리자만(액션 가드와 같다), 값이 없으면 패널 없음
  const receiptState = isAdmin ? await receiptStateOf(receipt, (id) => getImportReceipt(projectId, id)) : null
  // 실행 시각·백업 파일 날짜의 tz = 프로젝트 달력(SP5). 관리자(마법사를 그릴 때)만 읽고, 못 읽으면 시각 '—'·날짜 없는 파일 이름(로그) — 마법사는 막지 않는다
  const projectTz = isAdmin ? await projectTimezone(projectId) : null
  const extraAxisLabel = isAdmin ? await projectExtraAxisLabel(projectId) : null

  return (
    <ProjectPageShell
      hero={<PageHeader title={`${projectName} ${t('importWizard.heroTitleSuffix')}`} description={t('importWizard.heroDesc')} />}
    >
      {isAdmin ? (
        <div className="space-y-5">
          {receiptState && <ImportReceiptPanel state={receiptState} timeZone={projectTz} />}
          <ImportModes projectId={projectId} currentItemCount={currentItemCount} timeZone={projectTz} extraAxisLabel={extraAxisLabel} />
        </div>
      ) : (
        <EmptyState
          icon={Shield}
          title={t('importWizard.noPermissionTitle')}
          description={t('importWizard.noPermissionDesc')}
        />
      )}
    </ProjectPageShell>
  )
}
