// 프로젝트 키 10개(SP5 A 의 calendar.* 셋, SP3b UI-3 의 views.default 포함)(스펙 §3.6 표, 개정 §2.8.2). 소유 모듈은 wbs(여섯)·settings(modules.enabled·calendar.* 셋). 값 형태의 정본은 개정 §2.8.2.
import { REQUIRED_ON_CREATE, defineSetting, type EditCtx, type Parsed, type SettingDef } from '../def'
import { OFF_ON_CREATE, PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'
import { CREDIT_GAP, CREDIT_STEP, DEFAULT_STAGE_CREDITS, validateStageCredits, type StageCredits } from '@/lib/domain/stageCredits'
import { validateProfile, type ExcelProfile } from '@/lib/excel/profile'
import { parseModuleList, type ModulesList } from './workspace'
import {
  DEFAULT_TIMEZONE, DEFAULT_WEEK_RULES, DEFAULT_WORKING_DAYS, applyWeekStartChange, parseTimezone, parseWeekRules, parseWeekStartDay, parseWorkingDays,
  type IsoDow, type WeekStartDay, type WeekStartRule,
} from '@/lib/domain/calendar'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** 옛 src/app/actions/project.ts:58 의 여섯 — 이제 레지스트리 기본값이다(생성 때 저장하지 않는다. 미설정 = 이 값) */
export const DEFAULT_MILESTONE_KEYWORDS: readonly string[] = ['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고']
/** SP3a 의 고정 크레딧 정책 — SP5b 가 workflow.credit_policy 로 주입한다 */
export const DEFAULT_CREDIT_POLICY = { step: CREDIT_STEP, min_gap: CREDIT_GAP } as const

/** validateLevelSettings 의 라벨 규칙만 — 트리 깊이(축소 거부)는 validateConfig 의 몫이다(선행 조회가 필요하다) */
export function parseLevelLabels(raw: unknown): Parsed<string[]> {
  if (!Array.isArray(raw) || raw.some((l) => typeof l !== 'string')) return fail('단계 이름 목록이어야 합니다.')
  const labels = (raw as string[]).map((l) => l.trim())
  if (labels.length === 0) return fail('단계가 최소 1개 필요합니다.')
  if (labels.length > LEVEL_LABELS_MAX) return fail(`단계는 최대 ${LEVEL_LABELS_MAX}개까지입니다.`)
  const emptyIdx = labels.findIndex((l) => l === '')
  if (emptyIdx >= 0) return fail(`${emptyIdx + 1}번째 단계 이름이 비어 있습니다.`)
  if (new Set(labels).size !== labels.length) return fail('단계 이름이 중복됩니다.')
  return { ok: true, value: labels }
}

function parseExtraAxisLabel(raw: unknown): Parsed<string | null> {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return fail('문자열이어야 합니다.')
  const v = raw.trim()
  if (v.length < 1 || v.length > 20) return fail('1~20자여야 합니다.')
  return { ok: true, value: v }
}

/** 소문자 정규화는 여기서 — 옛 로더가 하던 일을 저장 시점으로(개정 §2.7.2 마지막 행). 빈 배열은 마커 0건이 정답 */
function parseMilestoneKeywords(raw: unknown): Parsed<string[]> {
  if (!Array.isArray(raw) || raw.some((k) => typeof k !== 'string')) return fail('키워드 목록이어야 합니다.')
  const out = (raw as string[]).map((k) => k.trim().toLowerCase())
  if (out.some((k) => k.length < 1 || k.length > 40)) return fail('키워드는 1~40자여야 합니다.')
  return { ok: true, value: out }
}

function parseExcelProfile(raw: unknown): Parsed<ExcelProfile | null> {
  if (raw === null) return { ok: true, value: null }
  const v = validateProfile(raw)
  return v.ok ? { ok: true, value: v.profile } : fail(v.error)
}

/** 정책 인자 자리만 만든다 — SP3a 는 고정 정책이고 다른 값이 오면 throw 한다(주입은 SP5b) */
export function parseStageCredits(raw: unknown, policy: { step: number; min_gap: number } = DEFAULT_CREDIT_POLICY): Parsed<StageCredits> {
  if (policy.step !== DEFAULT_CREDIT_POLICY.step || policy.min_gap !== DEFAULT_CREDIT_POLICY.min_gap) {
    throw new Error('크레딧 정책 주입은 SP5b(workflow.credit_policy)부터다')
  }
  const v = validateStageCredits(raw)
  return v.ok ? { ok: true, value: v.credits } : fail(v.error)
}

/**
 * calendar.week_start 편집(개정 §2.8.7·§4.2.4) — 입력은 요일 하나, 목록은 여기서 만든다. 오늘(ctx.today)은 프로젝트 tz 의 오늘이고
 * 문서 수는 ctx.loadWeekKeys 가 준다(과제 5 의 설정 액션). 둘 중 하나라도 없으면 fail-closed. 판독 오류는 삼키지 않고 던진다(액션이 unavailable 로).
 * E 이후 문서가 있으면 거부하는 판정은 DB(settings_ref_check — D53)가 설정 행 FOR UPDATE 아래에서 한다.
 */
/** 손상된 주 시작 + 주간보고가 있을 때의 거부 문구 — 저장(weekStartToStored)과 미리보기(previewWeekStartImpact)가 같은 문구(A-5 리뷰 O7) */
export function corruptWeekStartError(docCount: number): string {
  return `저장된 주 시작 규칙이 손상되어 바꿀 수 없습니다 — 주간보고 ${docCount}건의 주차가 그 규칙을 따릅니다. 저장 값을 먼저 복구하세요.`
}

export async function weekStartToStored(prev: WeekStartRule[] | undefined, day: WeekStartDay, ctx: EditCtx): Promise<Parsed<WeekStartRule[]>> {
  if (ctx.scope !== 'project') return fail('주 시작 규칙은 프로젝트 설정에서만 바꿀 수 있습니다.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.today)) return fail('프로젝트 시간대 설정을 읽지 못해 주 시작을 바꿀 수 없습니다. 시간대를 먼저 확인하세요.')
  if (!ctx.loadWeekKeys) return fail('주간보고 목록을 확인할 수 없어 주 시작을 바꿀 수 없습니다.')
  const keys = await ctx.loadWeekKeys()
  // prev 없음 = 저장 값 손상(invalid — 이 키는 기본값이 있어 미설정이면 기본값이 실린다). 주간보고가 있으면 그 문서의 키를 정한 과거 규칙을
  // 기본값으로 덮을 수 없다(fail-closed — K2). 문서가 0건이면 지킬 과거가 없어 요일 하나로 교체한다.
  if (prev === undefined && keys.length > 0) return fail(corruptWeekStartError(keys.length))
  const r = applyWeekStartChange(prev ?? DEFAULT_WEEK_RULES, day, ctx.today, keys.length)
  return r.ok ? { ok: true, value: r.rules } : fail(r.error)
}
/** 프로젝트 복사 = 원본 마지막 규칙의 요일 하나(전환 이력은 옮기지 않는다 — 개정 §2.8.7 복사 행, source='copy') */
export function copyWeekStartRules(src: readonly WeekStartRule[]): WeekStartRule[] {
  return [{ day: src[src.length - 1].day, from: null }]
}

export type WbsView = 'sheet' | 'timeline' | 'board'
export const WBS_VIEWS: readonly WbsView[] = ['sheet', 'timeline', 'board']
export type ViewsDefault = { wbs: WbsView }
/** 기본값 = 현행 동작(첫 보기는 표 — 개정 §2.6.2 R1, D43) */
export const DEFAULT_VIEWS: ViewsDefault = { wbs: 'sheet' }
/** { wbs } 만 받는다 — 밀도 등 필드를 나중에 더하는 것은 형태 변경(R5)이라 별도 키다(D43). 보드 ↔ 칸반 교차 검사는 validateProjectConfig(W12) */
export function parseViewsDefault(raw: unknown): Parsed<ViewsDefault> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('보기 기본값은 { wbs } 여야 합니다.')
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'wbs') return fail('보기 기본값에는 wbs 만 둡니다.')
  const wbs = (raw as { wbs: unknown }).wbs
  return typeof wbs === 'string' && (WBS_VIEWS as readonly string[]).includes(wbs)
    ? { ok: true, value: { wbs: wbs as WbsView } }
    : fail('작업 계획 기본 보기는 sheet·timeline·board 중 하나입니다.')
}

export const PROJECT_DEFS = [
  defineSetting<'core.level_labels', string[]>({
    key: 'core.level_labels', scope: 'project', module: 'wbs', default: REQUIRED_ON_CREATE, explicit: true,
    parse: parseLevelLabels,
    widget: { kind: 'custom', component: 'LevelSettingsManager' }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'core.extra_axis_label', string | null>({
    key: 'core.extra_axis_label', scope: 'project', module: 'wbs', default: null,
    parse: parseExtraAxisLabel,
    widget: { kind: 'text', maxLength: 20 }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'core.milestone_keywords', string[]>({
    key: 'core.milestone_keywords', scope: 'project', module: 'wbs', default: [...DEFAULT_MILESTONE_KEYWORDS],
    parse: parseMilestoneKeywords,
    widget: { kind: 'text_list', maxItems: 50 }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'wbs.excel_profile', ExcelProfile | null>({
    key: 'wbs.excel_profile', scope: 'project', module: 'wbs', default: null,
    parse: parseExcelProfile,
    widget: { kind: 'custom', component: 'ClearExcelProfileButton' }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'modules.enabled', ModulesList>({
    key: 'modules.enabled', scope: 'project', module: 'settings', explicit: true,   // 생성 때 늘 명시 기록 — 미설정이면 기본값(토글 전부)이 켜진 것으로 풀린다
    default: [...PROJECT_TOGGLABLE].filter((id) => !OFF_ON_CREATE.includes(id)),
    parse: (raw) => parseModuleList(raw, [...PROJECT_TOGGLABLE]),
    widget: { kind: 'custom', component: 'ModuleToggleEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'workflow.stage_credits', StageCredits>({
    key: 'workflow.stage_credits', scope: 'project', module: 'wbs', default: DEFAULT_STAGE_CREDITS,
    parse: (raw) => parseStageCredits(raw),
    widget: { kind: 'custom', component: 'StageCreditSlider' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['apply_workflow_event'] },
  }),
  // SP5 A(스펙 §4.2, 개정 §2.8.2) — 생성 때 워크스페이스 값을 복사한다(seedFrom — createProject 가 쓴다, 과제 5). 상속하지 않는다
  defineSetting<'calendar.timezone', string>({
    key: 'calendar.timezone', scope: 'project', module: 'settings', default: DEFAULT_TIMEZONE,
    parse: parseTimezone, seedFrom: { key: 'calendar.timezone' },
    widget: { kind: 'custom', component: 'TimezoneSelect' }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'calendar.working_days', IsoDow[]>({
    key: 'calendar.working_days', scope: 'project', module: 'settings', default: [...DEFAULT_WORKING_DAYS],
    parse: parseWorkingDays, seedFrom: { key: 'calendar.working_days' },
    widget: { kind: 'custom', component: 'WorkingDaysEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'],
    sql: { readers: ['is_workday'] },
  }),
  defineSetting<'calendar.week_start', WeekStartRule[], WeekStartDay>({
    key: 'calendar.week_start', scope: 'project', module: 'settings', default: DEFAULT_WEEK_RULES.map((r) => ({ ...r })),
    parse: parseWeekRules,
    seedFrom: { key: 'calendar.week_start', map: (ws) => [{ day: ws as WeekStartDay, from: null }] },   // ws 는 해석기가 검증한 워크스페이스 값
    edit: { parseInput: parseWeekStartDay, toStored: weekStartToStored },
    widget: { kind: 'custom', component: 'WeekStartEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only', 'recompute'],
    sql: { readers: ['week_key_of', 'weekly_reports_week_key_guard', 'settings_ref_check'] },
  }),
  // SP3b UI-3(스펙 §6.4 표 둘째 행, D43) — 작업 계획의 첫 보기. 보드는 칸반이 켜진 프로젝트에서만 저장되고(validateConfig), 저장 뒤 칸반이
  // 꺼지면 읽는 쪽이 표로 그린다. 보기 결정은 ?view → 이 값 → 'sheet'(소비처는 과제 14)
  defineSetting<'views.default', ViewsDefault>({
    key: 'views.default', scope: 'project', module: 'wbs', default: DEFAULT_VIEWS,
    parse: parseViewsDefault,
    widget: { kind: 'custom', component: 'ViewsDefaultEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
] as const satisfies readonly SettingDef[]
export type { ModuleId }
