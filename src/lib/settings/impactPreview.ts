import 'server-only'
import { fetchAllPages } from '@/lib/data/paging'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { getProjectConfig } from './projectConfig'
import { valueOf } from './registry'
import { listWeekKeys } from './weekKeys'
import { requireCalendar } from '@/lib/calendar/load'
import { previewWeekStart, todayIn, type WeekStartDay, type WeekStartPreview } from '@/lib/domain/calendar'

export interface ModuleAllowImpact {
  removed: { moduleId: ModuleId; projectCount: number }[]
  affectedProjects: number
}

export interface ProjectModuleImpact {
  removed: { moduleId: ModuleId; dataCount: number | null; dataLabel: string }[]
}

const MODULE_DATA: Partial<Record<ModuleId, { table: string; label: string }>> = {
  kanban: { table: 'wbs_items', label: 'WBS 항목(보드와 공유)' },
  meetings: { table: 'meetings', label: '회의' },
  weekly: { table: 'weekly_reports', label: '주간보고' },
  issues: { table: 'issues', label: '이슈' },
  wiki: { table: 'wiki_topics', label: '위키 주제' },
  announcements: { table: 'announcements', label: '공지' },
  attendance: { table: 'attendance_records', label: '근태 기록' },
  agents: { table: 'agent_work_orders', label: '에이전트 작업' },
}

/** 프로젝트 모듈을 끌 때 그 모듈의 대표 데이터 건수를 센다. 공유 데이터는 이름에 표시한다. */
export async function previewProjectModuleImpact(
  admin: AdminClient, args: { projectId: string; before: readonly ModuleId[]; next: readonly ModuleId[] },
): Promise<ProjectModuleImpact> {
  const removed = args.before.filter(id => !args.next.includes(id))
  return { removed: await Promise.all(removed.map(async moduleId => {
    const source = MODULE_DATA[moduleId]
    if (!source) return { moduleId, dataCount: null, dataLabel: '별도 데이터 집계 없음' }
    const { count, error } = await admin.from(source.table).select('id', { count: 'exact', head: true }).eq('project_id', args.projectId)
    if (error || typeof count !== 'number') throw new Error(`${source.table} 영향 건수 조회 실패: ${error?.message ?? 'count 없음'}`)
    return { moduleId, dataCount: count, dataLabel: source.label }
  })) }
}

/** 허용 목록을 좁힐 때 영향을 받는 프로젝트 수. 조회 실패·손상은 숫자 0으로 위장하지 않는다. */
export async function previewModuleAllowImpact(
  admin: AdminClient,
  args: { workspaceId: string; before: readonly ModuleId[]; next: readonly ModuleId[] },
): Promise<ModuleAllowImpact> {
  const removed = args.before.filter(id => !args.next.includes(id))
  if (removed.length === 0) return { removed: [], affectedProjects: 0 }

  const projects = await fetchAllPages<{ id: string }>('영향 대상 프로젝트', (from, to) =>
    admin.from('projects').select('id', { count: 'exact' }).eq('workspace_id', args.workspaceId).order('id').range(from, to))
  const counts = new Map<ModuleId, number>(removed.map(id => [id, 0]))
  const toggled = removed.filter(id => PROJECT_TOGGLABLE.has(id))
  let affectedProjects = 0
  for (const project of projects) {
    const enabled = toggled.length ? valueOf(await getProjectConfig(project.id, { client: admin }), 'modules.enabled') : []
    const affected = removed.filter(id => !PROJECT_TOGGLABLE.has(id) || enabled.includes(id))
    if (affected.length) affectedProjects += 1
    for (const id of affected) counts.set(id, counts.get(id)! + 1)
  }
  return { removed: removed.map(moduleId => ({ moduleId, projectCount: counts.get(moduleId)! })), affectedProjects }
}

export type { WeekStartPreview } from '@/lib/domain/calendar'

/**
 * 주 시작 변경의 '변경 내용 검토'(스펙 D38) — 저장 때 edit.toStored(applyWeekStartChange)와 같은 함수(previewWeekStart 안)로 E·과도기 일수·
 * 기존 문서 수·막는 주차(D53 — 새 규칙에서 키가 바뀌는 문서)를 낸다. '오늘'은 그 프로젝트 tz(설정 액션의 편집 문맥과 같다 — 과제 5).
 * 문서 키는 끝까지 읽는다(listWeekKeys). 달력 키가 손상이면 requireCalendar 가 ConfigKeyError 를 던진다 — 기본값으로 계산하지 않는다.
 */
export async function previewWeekStartImpact(admin: AdminClient, args: { projectId: string; day: WeekStartDay; now: Date }): Promise<WeekStartPreview> {
  const cfg = await getProjectConfig(args.projectId, { client: admin })
  const cal = requireCalendar(cfg)
  const keys = await listWeekKeys(admin, args.projectId)
  return previewWeekStart(cal.weekStart, args.day, todayIn(cal.timezone, args.now), keys)
}
