/**
 * 포털·셸 로더 v0(스펙 §5.9, D20·D39·D40) — 서버 전용, 세션 클라이언트 + RLS(service_role 없음). 원천마다 그 모듈이 effective 인
 * 그 워크스페이스 프로젝트만 읽는다(effectiveModulesMany — 상수 왕복). 여러 프로젝트에 걸친 조회는 끝까지 읽는다(fetchAllPages — D51).
 * 원천 하나의 실패는 failedKinds(전체 실패 아님). '오늘'은 seoulToday() — SP5 Phase A 가 워크스페이스 시간대로(레인 A 알림 5).
 * 정렬·커서는 원천마다 끝까지 읽은 뒤 메모리에서 한다(myWork.ts — 기한 null 이 섞인 키셋을 PostgREST 필터로 쓰지 않는다).
 */
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllPages, type PageResult } from '@/lib/data/paging'
import { getMyMeetings } from '@/lib/data/meetings'
import { getProjectsCompletion } from '@/lib/data/wbs'
import { filterApprovable } from '@/lib/domain/approvable'
import { effectiveModulesMany } from '@/lib/modules/effectiveMany'
import { canSeeProject, isProjectAdmin, isProjectMember, type Actor } from '@/lib/domain/authz'
import { seoulToday } from '@/lib/domain/dates'
import { expandMeetings } from '@/lib/domain/meetings'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { meetingHref, wbsItemHref } from '@/lib/ai/chat/deep-links'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import { CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import { MY_WORK_KINDS, mergeMyWork, openLeafIds, type MyWorkKind, type MyWorkRow } from '@/lib/portal/myWork'

type Db = Awaited<ReturnType<typeof createServerClient>>
type Opts = { client?: Db }
const LIMIT_MAX = 50
/** in() 목록 한 번에 실을 id 수 — 요청 URL 길이 상한 안에 두려고 나눠 묻는다 */
const IN_CHUNK = 200
const OPEN_ISSUE = ['open', 'in_progress', 'on_hold'] as const
const page = <T,>(label: string, build: (from: number, to: number) => unknown) =>
  fetchAllPages<T>(label, build as (from: number, to: number) => PromiseLike<PageResult<T>>)
const chunks = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / IN_CHUNK) }, (_, i) => xs.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK))
const overdue = (due: string | null, today: string): number | null => {
  if (!due || due >= today) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000)
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : e)

/** 그 워크스페이스의 프로젝트 — actor.projectWorkspace 가 정본(조회 없음, 다른 워크스페이스 프로젝트는 여기서 빠진다) */
const projectsIn = (actor: Actor, workspaceId: string) => [...actor.projectWorkspace].filter(([, w]) => w === workspaceId).map(([p]) => p)
const myMemberIdsIn = (actor: Actor, pids: readonly string[]) => pids.map((p) => actor.memberIds.get(p)).filter((x): x is string => !!x)

/** 모듈별 effective 프로젝트. core 모듈은 판정 없이 전부(꺼질 수 없다), 비core 는 판정에 성공해 켜진 것만(실패는 fail-closed + failed) */
async function moduleProjects(workspaceId: string, pids: string[], client: Db): Promise<{ on: (m: ModuleId) => string[]; failed: boolean }> {
  const { sets, failed } = await effectiveModulesMany(workspaceId, pids, { client })
  return { on: (m) => (CORE_MODULES.includes(m) ? pids : pids.filter((p) => sets.get(p)?.has(m))), failed: failed.length > 0 }
}

async function wbsRows(client: Db, actor: Actor, pids: string[], today: string): Promise<MyWorkRow[]> {
  const mine = myMemberIdsIn(actor, pids)
  if (!mine.length) return []
  type R = { id: string; name: string; project_id: string; planned_end: string | null; actual_pct: number | null; projects: { name: string } | null }
  const items = await page<R>('내 담당 작업', (f, t) => client.from('wbs_items')
    .select('id, name, project_id, planned_end, actual_pct, projects!inner(name)', { count: 'exact' })
    .in('project_id', pids).in('assignee_member_id', mine).order('id').range(f, t))
  if (!items.length) return []
  const kids = (await Promise.all(chunks(items.map((i) => i.id)).map((ids) => page<{ parent_id: string }>('내 담당 작업의 하위', (f, t) => client.from('wbs_items')
    .select('parent_id', { count: 'exact' }).in('parent_id', ids).order('id').range(f, t))))).flat()
  const open = openLeafIds(items, new Set(kids.map((k) => k.parent_id)))
  return items.filter((i) => open.has(i.id)).map((i) => ({
    kind: 'wbs', id: i.id, title: i.name, projectId: i.project_id, projectName: i.projects?.name ?? '',
    due: i.planned_end, overdueDays: overdue(i.planned_end, today), status: i.actual_pct === null ? '미착수' : `${Number(i.actual_pct)}%`,
    href: wbsItemHref(i.project_id, i.id),
  }))
}

async function issueRows(client: Db, actor: Actor, pids: string[], today: string): Promise<MyWorkRow[]> {
  const mine = myMemberIdsIn(actor, pids)
  if (!pids.length || !mine.length) return []
  type R = { issue_id: string; issues: { id: string; title: string; status: string; due_date: string | null; project_id: string; projects: { name: string } | null } | null }
  const rows = await page<R>('내 담당 이슈', (f, t) => client.from('issue_assignees')
    .select('issue_id, issues!inner(id, title, status, due_date, project_id, projects!inner(name))', { count: 'exact' })
    .in('project_id', pids).in('member_id', mine).in('issues.status', [...OPEN_ISSUE]).order('issue_id').order('member_id').range(f, t))
  const seen = new Set<string>()
  return rows.flatMap((r) => (r.issues && !seen.has(r.issues.id) && seen.add(r.issues.id) ? [{
    kind: 'issue' as const, id: r.issues.id, title: r.issues.title, projectId: r.issues.project_id, projectName: r.issues.projects?.name ?? '',
    due: r.issues.due_date, overdueDays: overdue(r.issues.due_date, today), status: r.issues.status, href: `/p/${r.issues.project_id}/issues?focus=${r.issues.id}`,
  }] : []))
}

/**
 * 내가 승인할 수 있는 보고됨 주문(D40) — 결재 배지(getPendingApprovalCount)와 같은 축: 관리자는 전부, 멤버는 서브트리 판정, 조회 전용은 없음.
 * 주문 1왕복(리프 이름·프로젝트 이름 임베드), 관리자가 아닌 멤버 프로젝트가 남으면 그 프로젝트들의 항목 트리 1왕복(최대 2).
 */
async function approvalRows(client: Db, actor: Actor, pids: string[]): Promise<MyWorkRow[]> {
  const eligible = pids.filter((p) => isProjectAdmin(actor, p) || isProjectMember(actor, p))
  if (!eligible.length) return []
  type O = { id: string; project_id: string; wbs_item_id: string | null; claimed_by_user_id: string | null; created_at: string
    wbs_items: { name: string } | null; projects: { name: string } | null }
  const orders = await page<O>('결재 대기 주문', (f, t) => client.from('agent_work_orders')
    .select('id, project_id, wbs_item_id, claimed_by_user_id, created_at, wbs_items(name), projects!inner(name)', { count: 'exact' })
    .in('project_id', eligible).eq('status', 'reported').order('id').range(f, t))
  if (!orders.length) return []
  const need = [...new Set(orders.map((o) => o.project_id))]
  const treeFor = need.filter((p) => !isProjectAdmin(actor, p))
  type I = { id: string; parent_id: string | null; assignee_member_id: string | null; project_id: string }
  const items = treeFor.length ? await page<I>('결재 대기 항목 트리', (f, t) => client.from('wbs_items')
    .select('id, parent_id, assignee_member_id, project_id', { count: 'exact' }).in('project_id', treeFor).order('id').range(f, t)) : []
  const out: MyWorkRow[] = []
  for (const pid of need) {
    const own = actor.memberIds.get(pid)
    const viewer = { isAdmin: isProjectAdmin(actor, pid), memberIds: own ? [own] : [], userId: actor.userId }
    for (const o of filterApprovable(orders.filter((x) => x.project_id === pid), items.filter((i) => i.project_id === pid), viewer)) {
      out.push({ kind: 'approval', id: o.id, title: o.wbs_items?.name ?? '에이전트 작업 보고', projectId: pid, projectName: o.projects?.name ?? '',
        due: null, overdueDays: null, status: '검토 대기', href: `/p/${pid}/agents` })
    }
  }
  return out
}

async function meetingRows(workspaceId: string, today: string): Promise<MyWorkRow[]> {
  const res = await getMyMeetings(workspaceId, today, today)          // meetings 가 꺼진 프로젝트의 행은 로더가 뺀다
  if (!res.ok) throw new Error(res.error)
  return expandMeetings(res.meetings.filter((m) => m.isMine), res.exceptions, today, today).map((o) => ({
    kind: 'meeting', id: o.occurrenceId, title: o.title, projectId: o.projectId, projectName: o.projectName ?? '',
    due: o.occurrenceDate, overdueDays: null, status: o.startTime ?? '종일', href: meetingHref(o.projectId, o.seriesId, o.occurrenceDate),
  }))
}

const SOURCE_MODULE: Record<MyWorkKind, ModuleId> = { wbs: 'wbs', issue: 'issues', approval: 'agents', meeting: 'meetings' }

export async function getMyWork(workspaceId: string, actor: Actor, opts: { kinds?: MyWorkKind[]; cursor?: string | null; limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: MyWorkRow[]; nextCursor: string | null; failedKinds: MyWorkKind[] } | { ok: false; error: string }> {
  const client = opts.client ?? (await createServerClient())
  const kinds = (opts.kinds?.length ? opts.kinds : MY_WORK_KINDS).filter((k) => MY_WORK_KINDS.includes(k))
  const limit = Math.min(Math.max(1, opts.limit ?? 20), LIMIT_MAX)
  const pids = projectsIn(actor, workspaceId)
  if (!pids.length) return { ok: true, rows: [], nextCursor: null, failedKinds: [] }
  let mods: Awaited<ReturnType<typeof moduleProjects>>
  try { mods = await moduleProjects(workspaceId, pids, client) } catch (e) {
    console.error('[portal] 모듈 판정 실패', workspaceId, errMsg(e))
    return { ok: false, error: '내 업무를 불러오지 못했습니다.' }
  }
  const today = seoulToday()
  const failedKinds: MyWorkKind[] = []
  const run = async (kind: MyWorkKind): Promise<MyWorkRow[]> => {
    // 일부 프로젝트의 판정 실패 — 비core 원천은 그 프로젝트 행이 빠졌을 수 있다고 알린다(core 는 판정과 무관하게 읽는다)
    if (mods.failed && !CORE_MODULES.includes(SOURCE_MODULE[kind])) failedKinds.push(kind)
    const on = mods.on(SOURCE_MODULE[kind])
    if (!on.length) return []                                          // 어디서도 effective 가 아니면 조회하지 않는다(D39)
    try {
      if (kind === 'wbs') return await wbsRows(client, actor, on, today)
      if (kind === 'issue') return await issueRows(client, actor, on, today)
      if (kind === 'approval') return await approvalRows(client, actor, on)
      return await meetingRows(workspaceId, today)
    } catch (e) {
      console.error('[portal] 원천 실패', kind, workspaceId, errMsg(e))
      failedKinds.push(kind)
      return []
    }
  }
  const sources = await Promise.all(kinds.map(run))
  return { ok: true, ...mergeMyWork(sources, opts.cursor ?? null, limit), failedKinds: [...new Set(failedKinds)] }
}

/** 그 워크스페이스에서 내가 승인할 수 있는 결재 대기 수. null = 조회 실패(0 으로 위장하지 않는다 — D34·D40) */
export async function countMyReview(workspaceId: string, actor: Actor, opts: Opts = {}): Promise<number | null> {
  try {
    const client = opts.client ?? (await createServerClient())
    const pids = projectsIn(actor, workspaceId)
    if (!pids.length) return 0
    const mods = await moduleProjects(workspaceId, pids, client)
    if (mods.failed) { console.error('[portal] 검토 대기 수 — 일부 프로젝트의 모듈 판정 실패(수를 모른다)', workspaceId); return null }
    return (await approvalRows(client, actor, mods.on('agents'))).length
  } catch (e) {
    console.error('[portal] 검토 대기 수 실패', workspaceId, errMsg(e))
    return null
  }
}

export interface ShellProject { id: string; name: string; status: ProjectLifecycleStatus; isAdmin: boolean }
type PRow = { id: string; name: string; start_date: string | null; end_date: string | null; is_private: boolean | null }

/** 셸용 가벼운 목록(전환기·즐겨찾기 교차) — 1왕복. 상태는 진척 없이 계산(종료일 지난 프로젝트는 'unknown' — 셸은 그 칩을 중립으로 그린다) */
export const listWorkspaceProjects = cache(async (workspaceId: string, actor: Actor | null, opts: Opts = {}):
  Promise<{ ok: true; rows: ShellProject[] } | { ok: false; error: string }> => {
  try {
    const client = opts.client ?? (await createServerClient())
    const rows = await page<PRow>('워크스페이스 프로젝트', (f, t) => client.from('projects')
      .select('id, name, start_date, end_date, is_private', { count: 'exact' }).eq('workspace_id', workspaceId).order('name').order('id').range(f, t))
    const today = seoulToday()
    return { ok: true, rows: rows.filter((p) => canSeeProject(actor, p)).map((p) => ({
      id: p.id, name: p.name, status: projectLifecycleStatus(p.start_date, p.end_date, today, null), isAdmin: isProjectAdmin(actor, p.id),
    })) }
  } catch (e) {
    console.error('[portal] 셸 프로젝트 목록 실패', workspaceId, errMsg(e))
    return { ok: false, error: '프로젝트 목록을 불러오지 못했습니다.' }
  }
})

export interface ProjectRow { id: string; name: string; status: ProjectLifecycleStatus; startDate: string | null; endDate: string | null; isFavorite: boolean }

export async function getProjectRows(workspaceId: string, actor: Actor, opts: { q?: string; status?: ProjectLifecycleStatus; favoritesOnly?: boolean; cursor?: string | null; limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: ProjectRow[]; nextCursor: string | null } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), LIMIT_MAX)
  try {
    const client = opts.client ?? (await createServerClient())
    const [rows, completion, prefs] = await Promise.all([
      page<PRow>('프로젝트 행', (f, t) => {
        let q = client.from('projects').select('id, name, start_date, end_date, is_private', { count: 'exact' }).eq('workspace_id', workspaceId)
        if (opts.q?.trim()) q = q.ilike('name', `%${opts.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
        return q.order('name').order('id').range(f, t)
      }),
      getProjectsCompletion(),
      opts.favoritesOnly ? getWorkspacePrefs(workspaceId) : Promise.resolve({}),
    ])
    const fav = new Set((prefs as { favoriteProjectIds?: string[] }).favoriteProjectIds ?? [])
    const today = seoulToday()
    const all = rows.filter((p) => canSeeProject(actor, p)).map((p) => ({
      id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, isFavorite: fav.has(p.id),
      status: projectLifecycleStatus(p.start_date, p.end_date, today, completion === null ? null : (completion[p.id] ?? { hasWbs: false, allDone: false })),
    })).filter((p) => (!opts.status || p.status === opts.status) && (!opts.favoritesOnly || p.isFavorite))
    const start = opts.cursor ? all.findIndex((p) => p.id === opts.cursor) + 1 : 0
    const slice = all.slice(start, start + limit)
    return { ok: true, rows: slice, nextCursor: start + limit < all.length ? slice[slice.length - 1].id : null }
  } catch (e) {
    console.error('[portal] 프로젝트 행 실패', workspaceId, errMsg(e))
    return { ok: false, error: '프로젝트를 불러오지 못했습니다.' }
  }
}

/** 그 워크스페이스 프로젝트의 게시 중 공지 — announcements 가 effective 인 프로젝트만(D20 — 티커를 지우는 UI-2b 의 대체 표면) */
export async function getWorkspaceAnnouncements(workspaceId: string, actor: Actor, opts: { limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: { id: string; title: string; projectId: string; projectName: string; isPinned: boolean; createdAt: string }[] } | { ok: false; error: string }> {
  try {
    const client = opts.client ?? (await createServerClient())
    const pids = projectsIn(actor, workspaceId)
    if (!pids.length) return { ok: true, rows: [] }
    const mods = await moduleProjects(workspaceId, pids, client)
    const on = mods.on('announcements')
    if (mods.failed) console.error('[portal] 공지 — 일부 프로젝트의 모듈 판정 실패(그 프로젝트 공지는 빠진다)', workspaceId)
    if (!on.length) return { ok: true, rows: [] }
    const today = seoulToday()
    const { data, error } = await client.from('announcements')
      .select('id, title, project_id, is_pinned, created_at, projects!inner(name)')
      .in('project_id', on).or(`publish_from.is.null,publish_from.lte.${today}`).or(`publish_to.is.null,publish_to.gte.${today}`)
      .order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).order('id').limit(Math.min(Math.max(1, opts.limit ?? 5), 20))
    if (error) throw new Error(error.message)
    type A = { id: string; title: string; project_id: string; is_pinned: boolean; created_at: string; projects: { name: string } | null }
    return { ok: true, rows: ((data ?? []) as unknown as A[]).map((a) => ({ id: a.id, title: a.title, projectId: a.project_id, projectName: a.projects?.name ?? '', isPinned: a.is_pinned, createdAt: a.created_at })) }
  } catch (e) {
    console.error('[portal] 공지 실패', workspaceId, errMsg(e))
    return { ok: false, error: '공지를 불러오지 못했습니다.' }
  }
}
