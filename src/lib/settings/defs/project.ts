// 프로젝트 키 6개(스펙 §3.6 표, 개정 §2.8.2). 소유 모듈은 wbs(넷)·settings(modules.enabled). 값 형태의 정본은 개정 §2.8.2.
import { REQUIRED_ON_CREATE, defineSetting, type Parsed, type SettingDef } from '../def'
import { OFF_ON_CREATE, PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'
import { CREDIT_GAP, CREDIT_STEP, DEFAULT_STAGE_CREDITS, validateStageCredits, type StageCredits } from '@/lib/domain/stageCredits'
import { validateProfile, type ExcelProfile } from '@/lib/excel/profile'
import { parseModuleList, type ModulesList } from './workspace'

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

export const PROJECT_DEFS = [
  defineSetting<'core.level_labels', string[]>({
    key: 'core.level_labels', scope: 'project', module: 'wbs', default: REQUIRED_ON_CREATE,
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
    widget: { kind: 'custom', component: 'ExcelProfilePanel' }, editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'modules.enabled', ModulesList>({
    key: 'modules.enabled', scope: 'project', module: 'settings',
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
] as const satisfies readonly SettingDef[]
export type { ModuleId }
