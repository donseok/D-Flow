import 'server-only'
import { fetchAllPages } from '@/lib/data/paging'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { getProjectConfig } from './projectConfig'
import { valueOf } from './registry'
import { listWeekKeys } from './weekKeys'
import { DEFAULT_WEEK_RULES, previewWeekStart, todayIn, type WeekStartDay, type WeekStartPreview, type WeekStartRule } from '@/lib/domain/calendar'
import { corruptWeekStartError } from './defs/project'
import { ConfigKeyError } from './errors'
import type { KeyState } from './resolve'

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
 * 문서 키는 끝까지 읽는다(listWeekKeys).
 * 판정은 저장(edit.toStored = weekStartToStored)과 같은 입력만 본다(A-5 리뷰 O7): 오늘을 정하는 시간대와 저장된 주 시작 규칙.
 * 근무 요일이 손상돼도 주 시작 변경은 서버가 받으므로 막지 않는다. 시간대가 손상이면 오늘을 정할 수 없어 그 키의 ConfigKeyError(서버도 거부).
 * 주 시작이 손상이면 주간보고가 있을 때 저장과 같은 문구의 error(저장 막힘), 0건이면 요일 하나로 교체하는 미리보기.
 */
export async function previewWeekStartImpact(admin: AdminClient, args: { projectId: string; day: WeekStartDay; now: Date }): Promise<WeekStartPreview> {
  const cfg = await getProjectConfig(args.projectId, { client: admin })
  const tz = usable(cfg.keys['calendar.timezone'])
  if (typeof tz !== 'string') throw new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone')
  const today = todayIn(tz, args.now)
  const keys = await listWeekKeys(admin, args.projectId)
  const rules = usable(cfg.keys['calendar.week_start']) as WeekStartRule[] | undefined
  if (rules === undefined) {
    if (keys.length > 0) return { effectiveFrom: null, transitionDays: null, keptDocs: keys.length, blockingWeeks: [], error: corruptWeekStartError(keys.length), cancelled: null }
    return previewWeekStart(DEFAULT_WEEK_RULES, args.day, today, keys)
  }
  return previewWeekStart(rules, args.day, today, keys)
}

/** 해석기 키 상태에서 쓸 수 있는 값(set·default) — 손상·필수 누락은 undefined */
function usable(state: KeyState<unknown> | undefined): unknown {
  return state && (state.status === 'set' || state.status === 'default') ? state.value : undefined
}
