import type { OwnerKind, TaskDependency, TeamCode, WbsRow } from '@/lib/domain/types'
import {
  repositoryError,
  repositoryOk,
  type RepositoryResult,
  type WbsAttachmentMetadataSnapshot,
  type WbsBotRepository,
  type ChangeActorRole,
  type WbsChangeField,
  type WbsChangeLogSnapshot,
  type WbsProjectSnapshot,
  type WbsRepositoryItem,
} from '@/lib/repositories/types'
import { isRetryableReadError, nestedOne, type SupabaseServerClient } from './common'
import { personOf, primaryTeamCode } from '@/lib/data/memberSelect'
import { mergeSpecDepends } from '@/lib/domain/mergeDependencies'
import { teamOrderMap } from '@/lib/domain/teams'
import { teamsForProjectSync } from '@/lib/teams/master'

type Row = Record<string, unknown>

const WBS_COLUMNS = [
  'id', 'project_id', 'parent_id', 'code', 'sort_order', 'name', 'biz', 'deliverable',
  'planned_start', 'planned_end', 'weight', 'actual_pct', 'updated_at', 'is_owner_split',
  'external_ref', 'depends', // wbs.md 선행을 의존성으로 합성하는 재료 — mergeSpecDepends
  'item_owners(kind, teams(code))',
].join(', ')

const WBS_ITEM_SCOPE_COLUMNS = 'id, project_id, code, name, updated_at'
const ALLOWED_CHANGE_FIELDS: readonly WbsChangeField[] = [
  'actual_pct', 'weight', 'created', 'name', 'planned_start', 'planned_end',
  'deliverable', 'biz', 'dependency',
]

interface WbsItemScope {
  id: string
  code: string
  name: string
  updatedAt: string | null
}

function mapOwners(raw: unknown, projectId: string): WbsRow['owners'] {
  if (!Array.isArray(raw)) return []
  // 팀 코드는 teams FK 조인 결과라 등록 팀만 온다 — 하드코딩 화이트리스트 불필요(신규 팀 자동 수용).
  const allowedKinds = new Set<OwnerKind>(['primary', 'support'])
  const owners: WbsRow['owners'] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    const code = team?.code
    const kind = row.kind
    if (typeof code === 'string' && code !== '' && allowedKinds.has(kind as OwnerKind)) {
      owners.push({ team: code, kind: kind as OwnerKind })
    }
  }
  // 표시 순서는 팀 마스터 sort_order(비활성 포함 — 기존 데이터 정렬 안정). 미등록은 뒤로.
  const order = teamOrderMap(teamsForProjectSync(projectId).map(t => t.code))
  const rank = (t: TeamCode) => order.get(t) ?? Number.MAX_SAFE_INTEGER
  return owners.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'primary' ? -1 : 1) || rank(a.team) - rank(b.team),
  )
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function safeAuditValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.length > 2_000 ? `${value.slice(0, 1_997)}…` : value
}

function teamCode(value: unknown): TeamCode | null {
  // 감사 로그 표시용 통과 파서 — 팀 목록 검증은 쓰기 경로(팀 마스터 대조)에서 이미 끝났다.
  return typeof value === 'string' && value !== '' ? value : null
}

/** 변경 이력 작성자의 이 프로젝트 권한 — 명단 access_role(admin|member), 권한 없는 행·명단 밖 계정은 viewer. */
function actorRole(value: unknown): ChangeActorRole | null {
  return value === 'admin' || value === 'member' || value === 'viewer' ? value : null
}

/** '팀 관리자' / '팀 멤버' / 조회 전용은 팀(없으면 '조회'). 팀이 없는 관리자·멤버는 권한만. */
function actorLabel(team: TeamCode | null, role: ChangeActorRole | null): string | null {
  if (role === 'admin') return team ? `${team} 관리자` : '관리자'
  if (role === 'member') return team ? `${team} 멤버` : '멤버'
  if (role === 'viewer') return team ?? '조회'
  return team
}

async function readItemScope(
  client: SupabaseServerClient,
  projectId: string,
  itemId: string,
): Promise<RepositoryResult<WbsItemScope | null>> {
  const result = await client
    .from('wbs_items')
    .select(WBS_ITEM_SCOPE_COLUMNS)
    .eq('project_id', projectId)
    .eq('id', itemId)
    .maybeSingle()
  if (result.error) {
    return repositoryError('WBS_ITEM_SCOPE_READ_FAILED', isRetryableReadError(result.error))
  }
  if (!result.data) return repositoryOk(null)
  const row = result.data as unknown as Row
  if (row.id !== itemId || row.project_id !== projectId) {
    return repositoryError('WBS_ITEM_SCOPE_READ_FAILED', false)
  }
  return repositoryOk({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  })
}

function mapItem(row: Row, projectId: string): WbsRepositoryItem {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    parentId: (row.parent_id as string | null) ?? null,
    code: row.code as string,
    sortOrder: Number(row.sort_order) || 0,
    name: row.name as string,
    biz: (row.biz as string | null) ?? null,
    deliverable: (row.deliverable as string | null) ?? null,
    plannedStart: (row.planned_start as string | null) ?? null,
    plannedEnd: (row.planned_end as string | null) ?? null,
    weight: nullableNumber(row.weight),
    actualPct: nullableNumber(row.actual_pct),
    owners: mapOwners(row.item_owners, projectId),
    updatedAt: (row.updated_at as string | null) ?? null,
    isOwnerSplit: row.is_owner_split === true,
  }
}

function mapDependency(row: Row): TaskDependency {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    predecessorId: row.predecessor_id as string,
    successorId: row.successor_id as string,
    type: row.dependency_type as TaskDependency['type'],
    lagDays: Number(row.lag_days) || 0,
    origin: 'manual', // task_dependencies 실제 행 — depends 합성 행은 mergeSpecDepends 가 붙인다
  }
}

/** Request-scoped Supabase adapter. All statements in this adapter are SELECTs. */
export function createSupabaseWbsRepository(client: SupabaseServerClient): WbsBotRepository {
  return {
    async getProjectSnapshot(projectId): Promise<RepositoryResult<WbsProjectSnapshot | null>> {
      const [projectResult, itemsResult, holidaysResult, dependenciesResult] = await Promise.all([
        client.from('projects').select('id, base_date').eq('id', projectId).maybeSingle(),
        client.from('wbs_items').select(WBS_COLUMNS).eq('project_id', projectId).order('sort_order'),
        client.from('holidays').select('date').eq('project_id', projectId).order('date'),
        client.from('task_dependencies')
          .select('id, project_id, predecessor_id, successor_id, dependency_type, lag_days')
          .eq('project_id', projectId),
      ])

      if (projectResult.error) {
        return repositoryError('WBS_PROJECT_READ_FAILED', isRetryableReadError(projectResult.error))
      }
      if (itemsResult.error) {
        return repositoryError('WBS_ITEMS_READ_FAILED', isRetryableReadError(itemsResult.error))
      }
      if (holidaysResult.error) {
        return repositoryError('WBS_HOLIDAYS_READ_FAILED', isRetryableReadError(holidaysResult.error))
      }
      if (dependenciesResult.error) {
        return repositoryError('WBS_DEPENDENCIES_READ_FAILED', isRetryableReadError(dependenciesResult.error))
      }
      if (!projectResult.data) return repositoryOk(null)

      const project = projectResult.data as Row
      const itemRows = (itemsResult.data ?? []) as unknown as Row[]
      const snapshot: WbsProjectSnapshot = {
        projectId,
        baseDate: (project.base_date as string | null) ?? null,
        items: itemRows.map(row => mapItem(row, projectId)),
        holidays: ((holidaysResult.data ?? []) as Row[]).map(row => row.date as string),
        // wbs_items.depends(import 선행)를 같은 배열로 합쳐 봇이 두 축을 한 번에 본다.
        // 해석 못 한 ref 는 여기서 빠진다 — 봇은 시작 게이트가 아니라 조회 도구이고,
        // 그 상태를 사용자에게 보이는 책임은 화면(RowDetailPanel)이 진다.
        dependencies: mergeSpecDepends(
          ((dependenciesResult.data ?? []) as Row[]).map(mapDependency),
          itemRows.map(row => ({
            id: row.id as string,
            projectId: row.project_id as string,
            externalRef: (row.external_ref as string | null) ?? null,
            depends: (row.depends as string[] | null) ?? null,
          })),
        ).dependencies,
      }
      return repositoryOk(snapshot)
    },

    async getChangeLog(projectId, itemId, limit) {
      const itemResult = await readItemScope(client, projectId, itemId)
      if (!itemResult.ok) return itemResult
      if (!itemResult.data) return repositoryOk(null)
      const item = itemResult.data

      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50))
      const logsResult = await client
        .from('change_logs')
        .select('id, wbs_item_id, field, old_value, new_value, at, user_id')
        .eq('wbs_item_id', itemId)
        .in('field', [...ALLOWED_CHANGE_FIELDS])
        .order('at', { ascending: false })
        .limit(safeLimit + 1)
      if (logsResult.error) {
        return repositoryError('WBS_CHANGE_LOG_READ_FAILED', isRetryableReadError(logsResult.error))
      }

      const rows = (logsResult.data ?? []) as unknown as Row[]
      if (rows.some(row => row.wbs_item_id !== itemId || !ALLOWED_CHANGE_FIELDS.includes(row.field as WbsChangeField))) {
        return repositoryError('WBS_CHANGE_LOG_READ_FAILED', false)
      }
      const selected = rows.slice(0, safeLimit)
      const userIds = [...new Set(selected.flatMap(row =>
        typeof row.user_id === 'string' ? [row.user_id] : [],
      ))]
      // 작성자 라벨 재료 — profiles(알려진 계정, 명단 행이 없으면 조회 전용 'viewer') + 이 프로젝트의
      // 활성 명단 행(대표 팀 code, access_role). 이메일은 어느 쪽 select 에도 싣지 않는다(챗봇 경계).
      const actors = new Map<string, { team: TeamCode | null; role: ChangeActorRole | null }>()
      if (userIds.length) {
        const [profilesResult, rosterResult] = await Promise.all([
          client
            .from('profiles')
            .select('user_id, display_name')
            .in('user_id', userIds),
          client
            .from('project_members')
            .select('access_role, people!inner(user_id, active), project_member_teams(is_primary, teams(code))')
            .eq('project_id', projectId)
            .eq('active', true)
            .in('people.user_id', userIds)
            .eq('people.active', true),
        ])
        const actorsError = profilesResult.error ?? rosterResult.error
        if (actorsError) {
          return repositoryError(
            'WBS_CHANGE_LOG_ACTORS_READ_FAILED',
            isRetryableReadError(actorsError),
          )
        }
        for (const raw of (profilesResult.data ?? []) as unknown as Row[]) {
          if (typeof raw.user_id !== 'string') continue
          actors.set(raw.user_id, { team: null, role: actorRole('viewer') })
        }
        for (const raw of (rosterResult.data ?? []) as unknown as Row[]) {
          const userId = personOf(raw)?.user_id
          if (typeof userId !== 'string') continue
          actors.set(userId, {
            team: teamCode(primaryTeamCode(raw.project_member_teams)),
            role: actorRole((raw.access_role as string | null) ?? 'viewer'),
          })
        }
      }

      const snapshot: WbsChangeLogSnapshot = {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemUpdatedAt: item.updatedAt,
        entries: selected.map(row => {
          const actor = typeof row.user_id === 'string' ? actors.get(row.user_id) : undefined
          const team = actor?.team ?? null
          const role = actor?.role ?? null
          return {
            id: Number(row.id),
            wbsItemId: item.id,
            field: row.field as WbsChangeField,
            oldValue: safeAuditValue(row.old_value),
            newValue: safeAuditValue(row.new_value),
            changedAt: row.at as string,
            actorLabel: actorLabel(team, role),
            actorTeam: team,
            actorRole: role,
          }
        }),
        truncated: rows.length > safeLimit,
      }
      return repositoryOk(snapshot)
    },

    async listAttachmentMetadata(projectId, itemId, limit) {
      const itemResult = await readItemScope(client, projectId, itemId)
      if (!itemResult.ok) return itemResult
      if (!itemResult.data) return repositoryOk(null)
      const item = itemResult.data

      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50))
      // Intentionally excludes file_path and uploaded_by. This is a table SELECT only;
      // no Storage client or signed-URL operation is reachable from this adapter.
      const attachmentsResult = await client
        .from('deliverable_attachments')
        .select('id, wbs_item_id, file_name, size, mime, created_at')
        .eq('wbs_item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(safeLimit + 1)
      if (attachmentsResult.error) {
        return repositoryError('WBS_ATTACHMENTS_READ_FAILED', isRetryableReadError(attachmentsResult.error))
      }

      const rows = (attachmentsResult.data ?? []) as unknown as Row[]
      if (rows.some(row => row.wbs_item_id !== itemId)) {
        return repositoryError('WBS_ATTACHMENTS_READ_FAILED', false)
      }
      const snapshot: WbsAttachmentMetadataSnapshot = {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemUpdatedAt: item.updatedAt,
        attachments: rows.slice(0, safeLimit).map(row => ({
          id: row.id as string,
          wbsItemId: item.id,
          fileName: row.file_name as string,
          size: nullableNumber(row.size),
          mime: (row.mime as string | null) ?? null,
          createdAt: row.created_at as string,
        })),
        truncated: rows.length > safeLimit,
      }
      return repositoryOk(snapshot)
    },
  }
}
