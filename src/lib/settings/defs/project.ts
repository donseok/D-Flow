// 프로젝트 키 12개(SP5 A 의 calendar.* 셋·SP5 B1 의 issues.* 둘 포함)(스펙 §3.6 표, 개정 §2.8.2). 소유 모듈은 wbs(넷)·settings(modules.enabled·calendar.*)·
// issues(issues.id_policy)·issue_analysis(issues.analysis). 값 형태의 정본은 개정 §2.8.2.
import { DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy, type AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { REQUIRED_ON_CREATE, defineSetting, type EditCtx, type Parsed, type SettingDef } from '../def'
import { OFF_ON_CREATE, PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'
import {
  DEFAULT_CREDIT_POLICY, DEFAULT_STAGE_CREDITS, STRUCTURAL_CREDIT_POLICY, parseCreditPolicy, validateStageCredits, type CreditPolicy, type StageCredits,
} from '@/lib/domain/stageCredits'
import { DEFAULT_APPROVAL_STEPS, parseApprovalSteps, type ApprovalStepDef } from '@/lib/domain/approvalSteps'
import { PREDECESSOR_GATES, type PredecessorGate } from '@/lib/domain/agentWork'
import { validateProfile, type ExcelProfile } from '@/lib/excel/profile'
import { parseModuleList, type ModulesList } from './workspace'
import {
  DEFAULT_TIMEZONE, DEFAULT_WEEK_RULES, DEFAULT_WORKING_DAYS, applyWeekStartChange, parseTimezone, parseWeekRules, parseWeekStartDay, parseWorkingDays,
  type IsoDow, type WeekStartDay, type WeekStartRule,
} from '@/lib/domain/calendar'
import { DEFAULT_ID_POLICY, parseIdPolicy, type IdPolicy } from '@/lib/issues/idPolicy'
import { RESERVED_SOURCE, defaultVocab, parseVocab, vocabChangeError, type VocabKey, type VocabValues } from '../vocab'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** SP5 B4(D29, 개정 §2.4.2·§2.8.2) — 어휘 5키. 저장 검증은 parseVocab, 이전 값과 비교한 규칙(원인 분류 삭제 금지)은 toStored.
 *  참조가 있는 code 의 삭제·의미 속성 변경은 DB(settings_ref_check)가 실제 건수로 막는다(guarded). */
function vocabDef<const K extends VocabKey>(key: K, module: ModuleId, readers: readonly string[] | null, fixedCodes?: readonly string[]) {
  return defineSetting<K, VocabValues[K]>({
    key, scope: 'project', module, default: defaultVocab(key),
    parse: (raw) => parseVocab(key, raw),
    edit: {
      parseInput: (raw) => parseVocab(key, raw),
      toStored: (prev, input) => { const e = vocabChangeError(key, prev, input); return e ? fail(e) : { ok: true, value: input } },
    },
    widget: { kind: 'vocab', ...(fixedCodes ? { fixedCodes } : {}) }, editor: 'project_admin', apply: 'immediate', impact: ['guarded'],
    sql: readers ? { readers } : null,
  })
}

/** issues.analysis 의 값(스펙 D16) — 분석 모듈이 켜진 프로젝트에서 등록 때 분석 분류가 선택인지 필수인지 */
export type IssueAnalysisSetting = 'optional' | 'required'

/** 옛 src/app/actions/project.ts:58 의 여섯 — 이제 레지스트리 기본값이다(생성 때 저장하지 않는다. 미설정 = 이 값) */
export const DEFAULT_MILESTONE_KEYWORDS: readonly string[] = ['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고']
/** 크레딧 정책 기본값(현행) — 정본은 도메인(stageCredits.ts), SP5b 가 workflow.credit_policy 로 주입한다 */
export { DEFAULT_CREDIT_POLICY }

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

/**
 * 크레딧 표 판독(SP5b 정책 주입). 레지스트리 parse 는 고정 불변식만 보는 STRUCTURAL 정책으로 읽는다 — 정책 키와의 교차 검사는
 * 저장 때 validateConfig 가 한다(개정 §3.3.4 "두 키의 교차 검사는 validateConfig"). 그래서 저장된 표를 읽는 쪽은 정책이 바뀌어도 invalid 가 되지 않는다.
 */
export function parseStageCredits(raw: unknown, policy: CreditPolicy = DEFAULT_CREDIT_POLICY): Parsed<StageCredits> {
  const v = validateStageCredits(raw, policy)
  return v.ok ? { ok: true, value: v.credits } : fail(v.error)
}

/** 단계 라벨(개정 §2.8.2) — 칸 none/as/ip/im/xx, 값은 트림 1~20자. 미설정 칸은 로케일 사전 */
export const STAGE_LABEL_SLOTS = ['none', 'as', 'ip', 'im', 'xx'] as const
export type StageLabelSlot = (typeof STAGE_LABEL_SLOTS)[number]
export type StageLabels = Partial<Record<StageLabelSlot, string>>
export function parseStageLabels(raw: unknown): Parsed<StageLabels> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('단계 라벨은 객체여야 합니다.')
  const out: StageLabels = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(STAGE_LABEL_SLOTS as readonly string[]).includes(k)) return fail(`모르는 단계입니다: ${k}`)
    if (typeof v !== 'string') return fail(`${k} 라벨은 문자열이어야 합니다.`)
    const t = v.trim()
    if (t.length < 1 || t.length > 20) return fail(`${k} 라벨은 1~20자여야 합니다.`)
    out[k as StageLabelSlot] = t
  }
  return { ok: true, value: out }
}

export function parsePredecessorGate(raw: unknown): Parsed<PredecessorGate> {
  return typeof raw === 'string' && (PREDECESSOR_GATES as readonly string[]).includes(raw)
    ? { ok: true, value: raw as PredecessorGate } : fail("'reached' 또는 'final' 이어야 합니다.")
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
    key: 'modules.enabled', scope: 'project', module: 'settings', explicit: true,   // 생성 때 늘 명시 기록 — 미설정이면 기본값(토글 − OFF_ON_CREATE)이 켜진 것으로 풀린다
    default: [...PROJECT_TOGGLABLE].filter((id) => !OFF_ON_CREATE.includes(id)),
    parse: (raw) => parseModuleList(raw, [...PROJECT_TOGGLABLE]),
    widget: { kind: 'custom', component: 'ModuleToggleEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'workflow.stage_credits', StageCredits>({
    key: 'workflow.stage_credits', scope: 'project', module: 'wbs', default: DEFAULT_STAGE_CREDITS,
    parse: (raw) => parseStageCredits(raw, STRUCTURAL_CREDIT_POLICY),
    widget: { kind: 'custom', component: 'StageCreditSlider' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['apply_workflow_event', 'workflow_value_of'] },
  }),
  // SP5b W1(스펙 §3.3·§4.5, 개정 §2.8.2) — WBS 흐름 다섯 키. 단계 code(as/ip/im/xx)는 제품 고정, 설정은 라벨·승인 단계·선행 기준·크레딧 정책
  defineSetting<'workflow.credit_policy', CreditPolicy>({
    key: 'workflow.credit_policy', scope: 'project', module: 'wbs', default: { ...DEFAULT_CREDIT_POLICY },
    parse: parseCreditPolicy,
    widget: { kind: 'custom', component: 'StageCreditSlider' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['workflow_value_of'] },
  }),
  defineSetting<'workflow.wbs_stage_labels', StageLabels>({
    key: 'workflow.wbs_stage_labels', scope: 'project', module: 'wbs', default: {},
    parse: parseStageLabels,
    widget: { kind: 'custom', component: 'StageLabelsEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'workflow.approval_steps', ApprovalStepDef[]>({
    key: 'workflow.approval_steps', scope: 'project', module: 'wbs', default: DEFAULT_APPROVAL_STEPS.map((s) => ({ ...s })),
    parse: parseApprovalSteps,
    widget: { kind: 'custom', component: 'ApprovalStepsEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only', 'guarded'],
    sql: { readers: ['apply_workflow_event', 'guard_workflow_actual', 'workflow_value_of', 'settings_ref_check'] },
  }),
  defineSetting<'workflow.approval_distinct_approvers', boolean>({
    key: 'workflow.approval_distinct_approvers', scope: 'project', module: 'wbs', default: true,
    parse: (raw) => (typeof raw === 'boolean' ? { ok: true, value: raw } : fail('참/거짓이어야 합니다.')),
    widget: { kind: 'boolean' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['apply_workflow_event', 'workflow_value_of'] },
  }),
  defineSetting<'workflow.predecessor_gate', PredecessorGate>({
    key: 'workflow.predecessor_gate', scope: 'project', module: 'wbs', default: 'reached',
    parse: parsePredecessorGate,
    widget: { kind: 'select', options: [
      { value: 'reached', labelKey: 'settings.workflow.gateReached' }, { value: 'final', labelKey: 'settings.workflow.gateFinal' }] },
    editor: 'project_admin', apply: 'immediate', impact: ['recompute'],
    sql: { readers: ['apply_workflow_event', 'workflow_value_of'] },
  }),
  // SP5 A(스펙 §4.2, 개정 §2.8.2) — 생성 때 워크스페이스 값을 복사한다(seedFrom — createProject 가 쓴다, 과제 5). 상속하지 않는다
  defineSetting<'calendar.timezone', string>({
    key: 'calendar.timezone', scope: 'project', module: 'settings', default: DEFAULT_TIMEZONE,
    parse: parseTimezone, seedFrom: { key: 'calendar.timezone' },
    widget: { kind: 'custom', component: 'TimezoneSelect' }, editor: 'project_admin', apply: 'immediate', impact: ['recompute'], sql: { readers: ['assign_issue_code'] },
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
  // SP5 B1(스펙 D15·D16, 개정 §2.8.2·§4.4.3) — 발번은 DB 트리거, 여기는 검증·편집. 바꿔도 기존 코드는 그대로(future_only)
  defineSetting<'issues.id_policy', IdPolicy>({
    key: 'issues.id_policy', scope: 'project', module: 'issues', default: DEFAULT_ID_POLICY,
    parse: parseIdPolicy,
    widget: { kind: 'custom', component: 'IssuePolicyEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['assign_issue_code', 'create_issue_from_minute_block', 'settings_ref_check'] },
  }),
  defineSetting<'issues.analysis', IssueAnalysisSetting>({
    key: 'issues.analysis', scope: 'project', module: 'issue_analysis', default: 'optional',
    parse: (raw) => (raw === 'optional' || raw === 'required' ? { ok: true, value: raw } : fail("'optional' 또는 'required' 여야 합니다.")),
    widget: { kind: 'select', options: [
      { value: 'optional', labelKey: 'settings.issues.analysisOptional' }, { value: 'required', labelKey: 'settings.issues.analysisRequired' }] },
    editor: 'project_admin', apply: 'immediate', impact: ['future_only'], sql: { readers: ['create_issue_from_minute_block'] },
  }),
  // SP5 B3(D24): 프로젝트는 생성 때 복사, 기존 프로젝트는 제품 기본값. 실시간 상속 없음.
  defineSetting<'minutes.attachments', AttachmentPolicy>({
    key: 'minutes.attachments', scope: 'project', module: 'minutes', default: { ...DEFAULT_ATTACHMENT_POLICY },
    parse: parseAttachmentPolicy,
    widget: { kind: 'custom', component: 'AttachmentPolicyEditor' }, editor: 'project_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['minute_files_attachment_guard'] },
    seedFrom: { key: 'minutes.attachments' },
  }),
  vocabDef('attendance.types', 'attendance', ['enforce_project_vocab', 'settings_ref_check']),
  vocabDef('meetings.categories', 'meetings', ['enforce_project_vocab', 'settings_ref_check']),
  vocabDef('issues.severities', 'issues', ['enforce_project_vocab', 'settings_ref_check']),
  vocabDef('issues.sources', 'issue_analysis', ['enforce_project_vocab', 'settings_ref_check'], [RESERVED_SOURCE]),
  // 원인 분류는 분석 실행 JSON 이 참조한다 — DB 가 세지 않으므로(삭제 금지, TS) SQL 판독자가 없다
  vocabDef('issues.cause_categories', 'issue_analysis', null),
  // SP5b(스펙 D1) — 이슈 표시 상태. 판정은 DB 트리거 enforce_issue_workflow(범주 전이표·파생 status·resolved_at), 의미 속성 category 의
  // 참조 검사는 settings_ref_check 가 한다
  vocabDef('workflow.issue_statuses', 'issues', ['enforce_issue_workflow', 'settings_ref_check']),
] as const satisfies readonly SettingDef[]
export type { ModuleId }
