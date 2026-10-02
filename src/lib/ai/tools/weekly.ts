import { weeklyHref } from '@/lib/ai/chat/deep-links'
import type {
  ProjectSettingsRepository,
  WeeklyRepository,
  WeeklyRepositoryRow,
  WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import { resolveTeamsForProject, type Team } from '@/lib/domain/teams'
import { areasForTeam, orderAreas, rowLabel, type WeeklyArea } from '@/lib/domain/weeklySheet'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
import { calendarOrError, requireCalendar } from '@/lib/calendar/load'
import { weekKeyOf, type WeekStartRule } from '@/lib/domain/calendar'
import {
  checkProjectAccess,
  invalidArgument,
  isIsoDate,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  shortExcerpt,
} from './common'
import type { BotSource, ReadOnlyBotTool, ToolExecutionResult } from './types'

const WEEKLY_CAPABILITY = 'weekly:read' as const
const ERR_UNKNOWN_TEAM = '알 수 없는 담당팀입니다.'
const errNoAreasForTeam = (team: string): string =>
  `'${team}' 팀이 맡은 주간보고 영역이 없습니다 — 프로젝트 설정의 업무영역에서 담당 팀을 지정하세요.`

type SettingsReader = Pick<ProjectSettingsRepository, 'getProjectConfig'>

/** 프로젝트 화면과 같은 팀 규칙(D19·D36) — 전용 팀이 하나라도 있으면(비활성 포함) 그것만, 없으면 그 워크스페이스 공용.
 *  ConfigTeam 에는 워크스페이스 열이 없다 — 해석기가 이미 그 프로젝트 워크스페이스의 공용 ∪ 그 프로젝트 전용으로 좁혀 읽었다. */
function registeredTeamCodes(cfg: ProjectConfig, projectId: string): Set<string> {
  const teams: Team[] = cfg.teams.map(t => ({ ...t, workspaceId: cfg.workspaceId }))
  return new Set(resolveTeamsForProject(teams, projectId, cfg.workspaceId).map(t => t.code))
}

type TeamFilter =
  | { ok: true; areaIds: ReadonlySet<string> | null }
  | { ok: false; result: ToolExecutionResult<never> }

/** team 인자 → 그 팀이 주·보조로 든 영역 id 집합(D24). 영역 대응은 그 code 의 팀 전부(공용·전용 — area_teams_guard 가 허용하는 넓이)와
 *  설정의 주간 영역으로 정하고 보고서와 같은 areasForTeam 을 쓴다(W18). 미등록 팀과 '맡은 영역 0' 을 구분해 명시 거부한다(조용한 빈 결과
 *  금지). 동명 구분 폴백은 없다. 설정은 호출부가 프로젝트 접근 판정 뒤에 한 번 읽는다(projectWeekContext) — 먼저 보면 볼 수 없는
 *  프로젝트의 팀 구성이 검증 결과로 샌다. */
function resolveTeamFilter(cfg: ProjectConfig, projectId: string, team: string | undefined): TeamFilter {
  if (!team) return { ok: true, areaIds: null }
  if (!registeredTeamCodes(cfg, projectId).has(team)) return { ok: false, result: invalidArgument(ERR_UNKNOWN_TEAM) }
  const areaIds = areasForTeam(cfg.areas.weekly_section, cfg.teams, team)
  if (areaIds.size === 0) return { ok: false, result: invalidArgument(errNoAreasForTeam(team)) }
  return { ok: true, areaIds }
}

/** 프로젝트 설정(팀·영역·주 규칙) — 접근 판정 뒤에 한 번 읽는다. 설정을 못 읽으면 도구 실패(팀 없음으로 위장하지 않는다),
 *  달력 키가 손상이면 도구 실패(기본 규칙으로 다른 주를 읽지 않는다 — [RF4]) */
async function projectWeekContext(settings: SettingsReader, projectId: string):
  Promise<{ ok: true; cfg: ProjectConfig; rules: readonly WeekStartRule[] } | { ok: false; result: ToolExecutionResult<never> }> {
  const configResult = await settings.getProjectConfig(projectId)
  if (!configResult.ok) return { ok: false, result: repositoryFailure(configResult) }
  const cal = calendarOrError(() => requireCalendar(configResult.data))
  if (!cal.calendar) return { ok: false, result: invalidArgument('프로젝트의 달력 설정이 손상되어 주간업무를 조회할 수 없습니다.') }
  return { ok: true, cfg: configResult.data, rules: cal.calendar.weekStart }
}

const norm = (value: string): string => value.trim().toLocaleLowerCase('ko-KR')

/** section 인자 = 영역 이름 또는 code(앞뒤 공백·대소문자 무시 일치). 인자 이름은 플래너 계약이라 그대로 둔다(SP8) */
function matchesSection(area: WeeklyArea | undefined, section: string | undefined): boolean {
  if (!section) return true
  if (!area) return false
  const want = norm(section)
  return norm(area.name) === want || norm(area.code) === want
}

export interface WeeklySheetToolRecord {
  id: string
  reportId: string
  projectId: string
  weekStart: string
  areaId: string
  /** 영역 라벨(rowLabel — 비활성이면 표지, 모르는 영역이면 '알 수 없는 영역') */
  section: string
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
  updatedAt: string | null
}

export interface WeeklyComparisonValues {
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
  updatedAt: string | null
}

export interface WeeklySheetComparisonRecord {
  projectId: string
  /** 비교 키 — 영역을 개명해도 같은 영역이다(W14) */
  areaId: string
  section: string
  fromWeekStart: string
  toWeekStart: string
  change: 'added' | 'removed' | 'changed' | 'unchanged'
  from: WeeklyComparisonValues | null
  to: WeeklyComparisonValues | null
}

interface AggregatedWeeklyRow extends WeeklyComparisonValues {
  areaId: string
  sourceRows: WeeklyRepositoryRow[]
}

function isScopedWeeklySnapshot(
  snapshot: WeeklySheetSnapshot,
  projectId: string,
  weekStart: string,
): boolean {
  return snapshot.report.projectId === projectId
    && snapshot.report.weekStart === weekStart
    && snapshot.rows.every(row => row.reportId === snapshot.report.id)
}

/** 주간 행 출처 — 비교 레코드는 여러 물리 행을 묶어 행 id 가 없으므로, 증거는 영역 id(qualifier.anchor)로 묶는다(evidence.ts) */
function rowSource(row: WeeklyRepositoryRow, projectId: string, weekStart: string, areas: readonly WeeklyArea[]): BotSource {
  return {
    id: `weekly-row:${row.id}`,
    domain: 'weekly',
    entityType: 'weekly_row',
    entityId: row.id,
    projectId,
    title: rowLabel(row, areas),
    href: weeklyHref(projectId, weekStart),
    updatedAt: row.updatedAt,
    qualifier: { anchor: `area:${row.areaId}` },
    excerpt: shortExcerpt(row.thisContent, row.thisIssue, row.nextContent, row.nextIssue),
  }
}

export function createGetWeeklySheetTool(
  repository: WeeklyRepository,
  settings: SettingsReader,
): ReadOnlyBotTool<WeeklySheetToolRecord> {
  return {
    name: 'get_weekly_sheet',
    requiredCapability: WEEKLY_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const rawWeekStart = isIsoDate(args.weekStart) ? args.weekStart : null
      const section = readOptionalString(args.section, 100)
      const team = readOptionalString(args.team, 30)
      const query = readOptionalString(args.query)
      const limit = readLimit(args.limit)
      if (
        !projectId || !rawWeekStart || section === null || team === null
        || query === null || limit === null
      ) {
        return invalidArgument()
      }
      const denied = checkProjectAccess(context, projectId, WEEKLY_CAPABILITY)
      if (denied) return denied
      const wk = await projectWeekContext(settings, projectId)
      if (!wk.ok) return wk.result
      // 기준일은 아무 날짜나 받아 그 프로젝트 규칙의 키로 정규화한다(SP5 D34 — 월요일 강제 삭제)
      const weekStart = weekKeyOf(wk.rules, rawWeekStart)
      const teamFilter = resolveTeamFilter(wk.cfg, projectId, team || undefined)
      if (!teamFilter.ok) return teamFilter.result

      const repoResult = await repository.getSheet(projectId, weekStart)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (!repoResult.data) {
        return {
          ok: true,
          result: {
            status: 'ok', facts: { reportFound: false, totalMatched: 0, returned: 0 },
            records: [], sources: [], asOf: context.now, truncated: false, warnings: [],
          },
        }
      }
      if (!isScopedWeeklySnapshot(repoResult.data, projectId, weekStart)) return repositoryScopeViolation()

      const { areas } = repoResult.data
      const areaById = new Map(areas.map(area => [area.id, area]))
      const needle = query?.toLocaleLowerCase('ko-KR')
      const matched = repoResult.data.rows.filter(row => {
        if (teamFilter.areaIds && !teamFilter.areaIds.has(row.areaId)) return false
        if (!matchesSection(areaById.get(row.areaId), section || undefined)) return false
        if (!needle) return true
        return [rowLabel(row, areas), row.thisContent, row.thisIssue, row.nextContent, row.nextIssue]
          .some(value => value.toLocaleLowerCase('ko-KR').includes(needle))
      })
      const records: WeeklySheetToolRecord[] = matched.slice(0, limit).map(row => ({
        id: row.id,
        reportId: row.reportId,
        projectId,
        weekStart,
        areaId: row.areaId,
        section: rowLabel(row, areas),
        thisContent: row.thisContent,
        thisIssue: row.thisIssue,
        nextContent: row.nextContent,
        nextIssue: row.nextIssue,
        updatedAt: row.updatedAt,
      }))
      const reportSource: BotSource = {
        id: `weekly-report:${repoResult.data.report.id}`,
        domain: 'weekly',
        entityType: 'weekly_report',
        entityId: repoResult.data.report.id,
        projectId,
        title: repoResult.data.report.title || `${weekStart} 주간업무`,
        href: weeklyHref(projectId, weekStart),
        updatedAt: repoResult.data.report.updatedAt,
      }
      const rowSources = matched.slice(0, limit).map(row => rowSource(row, projectId, weekStart, areas))
      const truncated = matched.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            reportFound: true,
            weekStart,
            title: repoResult.data.report.title,
            totalRows: repoResult.data.rows.length,
            totalMatched: matched.length,
            returned: records.length,
          },
          records,
          sources: [reportSource, ...rowSources],
          asOf: context.now,
          truncated,
          warnings: truncated ? [`주간업무 ${matched.length}행 중 ${records.length}행만 반환했습니다.`] : [],
        },
      }
    },
  }
}

/** 영역마다 하나로 묶는다(키 = 영역 id). 같은 영역 행이 여럿이면(유일 인덱스 앞의 옛 데이터) 저장소의 표시 순서대로 잇는다. */
function aggregateRows(rows: readonly WeeklyRepositoryRow[]): Map<string, AggregatedWeeklyRow> {
  const out = new Map<string, AggregatedWeeklyRow>()
  const append = (left: string, right: string): string => {
    const value = right.trim()
    return !value ? left : left ? `${left}\n${value}` : value
  }
  for (const row of rows) {
    const current = out.get(row.areaId)
    if (!current) {
      out.set(row.areaId, {
        areaId: row.areaId,
        thisContent: row.thisContent,
        thisIssue: row.thisIssue,
        nextContent: row.nextContent,
        nextIssue: row.nextIssue,
        updatedAt: row.updatedAt,
        sourceRows: [row],
      })
      continue
    }
    current.thisContent = append(current.thisContent, row.thisContent)
    current.thisIssue = append(current.thisIssue, row.thisIssue)
    current.nextContent = append(current.nextContent, row.nextContent)
    current.nextIssue = append(current.nextIssue, row.nextIssue)
    current.updatedAt = [current.updatedAt, row.updatedAt]
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1) ?? null
    current.sourceRows.push(row)
  }
  return out
}

function comparable(row: AggregatedWeeklyRow): WeeklyComparisonValues {
  return {
    thisContent: row.thisContent,
    thisIssue: row.thisIssue,
    nextContent: row.nextContent,
    nextIssue: row.nextIssue,
    updatedAt: row.updatedAt,
  }
}

function comparisonChange(
  from: AggregatedWeeklyRow | undefined,
  to: AggregatedWeeklyRow | undefined,
): WeeklySheetComparisonRecord['change'] {
  if (!from) return 'added'
  if (!to) return 'removed'
  return from.thisContent === to.thisContent
    && from.thisIssue === to.thisIssue
    && from.nextContent === to.nextContent
    && from.nextIssue === to.nextIssue
    ? 'unchanged'
    : 'changed'
}

/** 두 주차의 영역을 id 로 합친다(같은 프로젝트라 보통 같다 — 사이에 개명·추가가 있으면 뒤 주차 값이 이긴다) */
function mergedAreas(...snapshots: Array<WeeklySheetSnapshot | null>): WeeklyArea[] {
  const byId = new Map<string, WeeklyArea>()
  for (const snapshot of snapshots) for (const area of snapshot?.areas ?? []) byId.set(area.id, area)
  return [...byId.values()]
}

function comparisonReportSource(
  snapshot: WeeklySheetSnapshot,
  projectId: string,
): BotSource {
  return {
    id: `weekly-report:${snapshot.report.id}`,
    domain: 'weekly',
    entityType: 'weekly_report',
    entityId: snapshot.report.id,
    projectId,
    title: snapshot.report.title || `${snapshot.report.weekStart} 주간업무`,
    href: weeklyHref(projectId, snapshot.report.weekStart),
    updatedAt: snapshot.report.updatedAt,
  }
}

export function createCompareWeeklySheetsTool(
  repository: WeeklyRepository,
  settings: SettingsReader,
): ReadOnlyBotTool<WeeklySheetComparisonRecord> {
  return {
    name: 'compare_weekly_sheets',
    requiredCapability: WEEKLY_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const rawFrom = isIsoDate(args.fromWeekStart) ? args.fromWeekStart : null
      const rawTo = isIsoDate(args.toWeekStart) ? args.toWeekStart : null
      const section = readOptionalString(args.section, 100)
      const team = readOptionalString(args.team, 30)
      const query = readOptionalString(args.query)
      const limit = readLimit(args.limit)
      if (
        !projectId || !rawFrom || !rawTo || section === null || team === null
        || query === null || limit === null
      ) return invalidArgument()
      const denied = checkProjectAccess(context, projectId, WEEKLY_CAPABILITY)
      if (denied) return denied
      const wk = await projectWeekContext(settings, projectId)
      if (!wk.ok) return wk.result
      // 두 날짜를 그 프로젝트 규칙의 키로 바꾼 뒤 비교한다(SP5 D34 — 월요일 강제 삭제)
      const fromWeekStart = weekKeyOf(wk.rules, rawFrom)
      const toWeekStart = weekKeyOf(wk.rules, rawTo)
      if (fromWeekStart >= toWeekStart) {
        return invalidArgument('비교할 두 주차는 서로 다른 주이며 과거 주차부터 입력해야 합니다.')
      }
      const teamFilter = resolveTeamFilter(wk.cfg, projectId, team || undefined)
      if (!teamFilter.ok) return teamFilter.result

      const [fromResult, toResult] = await Promise.all([
        repository.getSheet(projectId, fromWeekStart),
        repository.getSheet(projectId, toWeekStart),
      ])
      if (!fromResult.ok) return repositoryFailure(fromResult)
      if (!toResult.ok) return repositoryFailure(toResult)
      if (
        (fromResult.data && !isScopedWeeklySnapshot(fromResult.data, projectId, fromWeekStart))
        || (toResult.data && !isScopedWeeklySnapshot(toResult.data, projectId, toWeekStart))
      ) return repositoryScopeViolation()

      const areas = mergedAreas(fromResult.data, toResult.data)
      const areaById = new Map(areas.map(area => [area.id, area]))
      const rank = new Map(orderAreas(areas).map((area, index) => [area.id, index]))
      const rankOf = (areaId: string): number => rank.get(areaId) ?? Number.MAX_SAFE_INTEGER
      const fromRows = aggregateRows(fromResult.data?.rows ?? [])
      const toRows = aggregateRows(toResult.data?.rows ?? [])
      const needle = query?.toLocaleLowerCase('ko-KR')
      const keys = [...new Set([...fromRows.keys(), ...toRows.keys()])]
      const compared = keys.flatMap(areaId => {
        const from = fromRows.get(areaId)
        const to = toRows.get(areaId)
        if (!from && !to) return []
        if (teamFilter.areaIds && !teamFilter.areaIds.has(areaId)) return []
        if (!matchesSection(areaById.get(areaId), section || undefined)) return []
        const label = rowLabel({ areaId }, areas)
        if (needle) {
          const haystack = [
            label,
            from?.thisContent, from?.thisIssue, from?.nextContent, from?.nextIssue,
            to?.thisContent, to?.thisIssue, to?.nextContent, to?.nextIssue,
          ].filter((value): value is string => typeof value === 'string')
          if (!haystack.some(value => value.toLocaleLowerCase('ko-KR').includes(needle))) return []
        }
        return [{ areaId, label, from, to, change: comparisonChange(from, to) }]
      }).sort((a, b) =>
        rankOf(a.areaId) - rankOf(b.areaId)
        || a.label.localeCompare(b.label, 'ko-KR'),
      )
      const selected = compared.slice(0, limit)
      const records: WeeklySheetComparisonRecord[] = selected.map(value => ({
        projectId,
        areaId: value.areaId,
        section: value.label,
        fromWeekStart,
        toWeekStart,
        change: value.change,
        from: value.from ? comparable(value.from) : null,
        to: value.to ? comparable(value.to) : null,
      }))

      const reportSources = [fromResult.data, toResult.data]
        .filter((value): value is WeeklySheetSnapshot => value !== null)
        .map(snapshot => comparisonReportSource(snapshot, projectId))
      const rowSources: BotSource[] = selected.flatMap(value => [
        ...(value.from?.sourceRows ?? []).map(row => rowSource(row, projectId, fromWeekStart, areas)),
        ...(value.to?.sourceRows ?? []).map(row => rowSource(row, projectId, toWeekStart, areas)),
      ])
      const truncated = compared.length > selected.length
      const count = (change: WeeklySheetComparisonRecord['change']) =>
        compared.filter(record => record.change === change).length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            fromWeekStart,
            toWeekStart,
            fromReportFound: fromResult.data !== null,
            toReportFound: toResult.data !== null,
            totalCompared: compared.length,
            returned: records.length,
            added: count('added'),
            removed: count('removed'),
            changed: count('changed'),
            unchanged: count('unchanged'),
          },
          records,
          sources: [...reportSources, ...rowSources],
          asOf: context.now,
          truncated,
          warnings: truncated
            ? [`비교 결과 ${compared.length}행 중 ${records.length}행만 반환했습니다.`]
            : [],
        },
      }
    },
  }
}
