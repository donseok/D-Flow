/**
 * SP5 B4(스펙 D29·D46·D58, 개정 §2.4.2·§2.8.2) — 프로젝트 어휘 5키의 순수 계약. 잎 모듈: 클라이언트·서버·SQL 패리티 테스트가 함께 쓴다.
 * 설정 정의 런타임(defs·registry)을 가져오지 않는다 — 화면이 이 모듈만 import 해도 레지스트리가 번들에 끌려오지 않게.
 *
 * 기본값은 B4 이전 상수(ATTENDANCE_META·MEETING_META·ISSUE_SEVERITY_META·ISSUE_SOURCE_TYPES·ISSUE_ANALYSIS_CAUSE_CATEGORIES)와
 * 같은 code·순서·색이다. DB 어휘 트리거(enforce_project_vocab)의 "키 없음 = 제품 기본값"도 같은 code 목록을 쓴다(tests/rls 패리티).
 * 라벨은 저장 문자열이다. 제품 기본 라벨 그대로면 화면은 사전(KO/EN)으로 그리고, 바꾼 라벨은 그대로 그린다(vocabLabel).
 *
 * SP5b(스펙 D1·D2) — 여섯째 키 `workflow.issue_statuses`(이슈 표시 상태). 의미 속성은 category(제품 고정 4범주 — 이슈 전이표·집계가 읽는다).
 * 전이 판정은 src/lib/domain/issueWorkflow.ts. 기본 4행은 code = 범주 code 라 옛 이슈(status 만 있던 행)가 그대로 유효하다.
 */
import type { DictKey } from '@/lib/i18n/dict'
import type { Parsed } from './def'

export const VOCAB_KEYS = ['attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources', 'issues.cause_categories', 'workflow.issue_statuses'] as const
export type VocabKey = (typeof VOCAB_KEYS)[number]

/** 화면 색은 의미 토큰 이름으로만 저장한다(원시 색 금지 — no-raw-color). 클래스는 아래 정적 표에서 고른다. */
export const VOCAB_COLORS = ['done', 'brand', 'progress', 'delayed', 'accent', 'pending', 'neutral'] as const
export type VocabColor = (typeof VOCAB_COLORS)[number]
/** Tailwind 가 원문에서 클래스를 찾도록 리터럴로 둔다 — 조립하지 않는다. */
export const VOCAB_COLOR_CLASS: Readonly<Record<VocabColor, { dot: string; chip: string }>> = {
  done: { dot: 'bg-success', chip: 'bg-success-weak text-success' },
  brand: { dot: 'bg-action', chip: 'bg-action-soft text-action' },
  progress: { dot: 'bg-progress', chip: 'bg-progress-weak text-progress' },
  delayed: { dot: 'bg-danger', chip: 'bg-danger-weak text-danger' },
  accent: { dot: 'bg-warning', chip: 'bg-warning/15 text-warning' },
  pending: { dot: 'bg-pending', chip: 'bg-pending-weak text-pending' },
  neutral: { dot: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' },
}

/** 근태 월 집계의 제품 고정 5분류(개정 §2.8.2 정본 :1355) — 의미 속성이라 참조가 있으면 바꿀 수 없다(DB 가 센다). */
export const COUNTS_AS = ['work', 'leave', 'trip', 'remote', 'absent'] as const
export type CountsAs = (typeof COUNTS_AS)[number]
/** 이슈 상태의 제품 고정 4범주(개정 W1) — 집계·전이표·DB check(issues_status_check)가 읽는다. 의미 속성이라 참조가 있으면 바꿀 수 없다 */
export const ISSUE_CATEGORIES = ['open', 'in_progress', 'resolved', 'on_hold'] as const
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]

interface VocabBase { code: string; label: string; active: boolean }
export interface AttendanceTypeDef extends VocabBase { short: string; color: VocabColor; counts_as: CountsAs; selectable: boolean; sort: number }
export interface MeetingCategoryDef extends VocabBase { color: VocabColor; sort: number; announce_default: boolean }
export interface SeverityDef extends VocabBase { rank: number; color: VocabColor }
export interface SourceDef extends VocabBase { sort: number }
export interface CauseCategoryDef extends VocabBase { sort: number }
export interface IssueStatusDef extends VocabBase { category: IssueCategory; color: VocabColor; sort: number }
export interface VocabValues {
  'attendance.types': AttendanceTypeDef[]
  'meetings.categories': MeetingCategoryDef[]
  'issues.severities': SeverityDef[]
  'issues.sources': SourceDef[]
  'issues.cause_categories': CauseCategoryDef[]
  'workflow.issue_statuses': IssueStatusDef[]
}
export type VocabEntry = VocabValues[VocabKey][number]

export const DEFAULT_ATTENDANCE_TYPES: readonly AttendanceTypeDef[] = [
  { code: 'work', label: '정상근무', short: '근무', color: 'done', counts_as: 'work', selectable: true, sort: 1, active: true },
  { code: 'remote', label: '재택', short: '재택', color: 'brand', counts_as: 'remote', selectable: false, sort: 2, active: true },
  { code: 'annual', label: '연차', short: '연차', color: 'progress', counts_as: 'leave', selectable: true, sort: 3, active: true },
  { code: 'half', label: '반차', short: '반차', color: 'progress', counts_as: 'leave', selectable: true, sort: 4, active: true },
  { code: 'quarter', label: '반반차', short: '반반차', color: 'progress', counts_as: 'leave', selectable: true, sort: 5, active: true },
  { code: 'sick', label: '병가', short: '병가', color: 'delayed', counts_as: 'leave', selectable: true, sort: 6, active: true },
  { code: 'trip', label: '출장', short: '출장', color: 'accent', counts_as: 'trip', selectable: true, sort: 7, active: true },
  // 공가·결근은 B4 이전 집계(summarize)의 leave/trip/remote 어디에도 들지 않았다 — 같은 결과가 되게 work·absent 로 둔다
  { code: 'official', label: '공가', short: '공가', color: 'pending', counts_as: 'work', selectable: false, sort: 8, active: true },
  { code: 'absent', label: '결근', short: '결근', color: 'delayed', counts_as: 'absent', selectable: false, sort: 9, active: true },
]
export const DEFAULT_MEETING_CATEGORIES: readonly MeetingCategoryDef[] = [
  { code: 'routine', label: '정례', color: 'progress', sort: 1, announce_default: false, active: true },
  { code: 'general', label: '일반', color: 'brand', sort: 2, announce_default: false, active: true },
  { code: 'kickoff', label: '킥오프', color: 'done', sort: 3, announce_default: false, active: true },
  { code: 'review', label: '리뷰', color: 'pending', sort: 4, announce_default: false, active: true },
  { code: 'report', label: '보고', color: 'accent', sort: 5, announce_default: false, active: true },
  { code: 'external', label: '외부/고객', color: 'delayed', sort: 6, announce_default: false, active: true },
]
export const DEFAULT_SEVERITIES: readonly SeverityDef[] = [
  { code: 'high', label: '높음', rank: 1, color: 'delayed', active: true },
  { code: 'medium', label: '보통', rank: 2, color: 'pending', active: true },
  { code: 'low', label: '낮음', rank: 3, color: 'neutral', active: true },
]
export const DEFAULT_SOURCES: readonly SourceDef[] = [
  { code: 'minutes', label: '회의록', sort: 1, active: true },
  { code: 'interview', label: '인터뷰', sort: 2, active: true },
  { code: 'deliverable', label: '산출물', sort: 3, active: true },
  { code: 'as_is_analysis', label: 'As-Is 분석', sort: 4, active: true },
  { code: 'data_analysis', label: '데이터 분석', sort: 5, active: true },
  { code: 'other', label: '기타', sort: 6, active: true },
]
export const DEFAULT_CAUSE_CATEGORIES: readonly CauseCategoryDef[] = [
  { code: 'strategy_policy', label: 'S · 전략/규정', sort: 1, active: true },
  { code: 'process', label: 'P · 프로세스', sort: 2, active: true },
  { code: 'organization', label: 'O · 조직', sort: 3, active: true },
  { code: 'it', label: 'I · IT', sort: 4, active: true },
]
/** 현 칩 색 그대로(스펙 D2 — 화면 회귀 0): open=delayed·in_progress=progress·resolved=done·on_hold=neutral. 라벨은 사전 issue.status.* 와 같다 */
export const DEFAULT_ISSUE_STATUSES: readonly IssueStatusDef[] = [
  { code: 'open', label: '열림', category: 'open', color: 'delayed', sort: 1, active: true },
  { code: 'in_progress', label: '진행중', category: 'in_progress', color: 'progress', sort: 2, active: true },
  { code: 'resolved', label: '해결', category: 'resolved', color: 'done', sort: 3, active: true },
  { code: 'on_hold', label: '보류', category: 'on_hold', color: 'neutral', sort: 4, active: true },
]
export const DEFAULT_VOCAB: { readonly [K in VocabKey]: readonly VocabValues[K][number][] } = {
  'attendance.types': DEFAULT_ATTENDANCE_TYPES,
  'meetings.categories': DEFAULT_MEETING_CATEGORIES,
  'issues.severities': DEFAULT_SEVERITIES,
  'issues.sources': DEFAULT_SOURCES,
  'issues.cause_categories': DEFAULT_CAUSE_CATEGORIES,
  'workflow.issue_statuses': DEFAULT_ISSUE_STATUSES,
}
/** 기본값의 깊은 사본 — 정의의 default·해석기가 공유 배열을 넘기지 않게. */
export const defaultVocab = <K extends VocabKey>(key: K): VocabValues[K] =>
  DEFAULT_VOCAB[key].map(e => ({ ...e })) as VocabValues[K]

/** `issues.sources` 의 'minutes' 는 회의록에서 만든 이슈가 쓰는 예약 code — 삭제·비활성 불가(개정 §2.4.2). */
export const RESERVED_SOURCE = 'minutes'
/** 어휘 code 형식 — 설정 parse·서버 입력 검증이 같은 규칙을 쓴다 */
export const VOCAB_CODE_RE = /^[a-z][a-z0-9_]{0,19}$/
const MAX_ENTRIES = 50
/** 이슈 표시 상태 개수 상한(개정 §2.8.2 — 상태 20개 이하) */
export const MAX_ISSUE_STATUSES = 20

type Field = 'label' | 'short' | 'color' | 'counts_as' | 'category' | 'selectable' | 'sort' | 'rank' | 'announce_default' | 'active'
const FIELDS: Readonly<Record<VocabKey, readonly Field[]>> = {
  'attendance.types': ['label', 'short', 'color', 'counts_as', 'selectable', 'sort', 'active'],
  'meetings.categories': ['label', 'color', 'sort', 'announce_default', 'active'],
  'issues.severities': ['label', 'rank', 'color', 'active'],
  'issues.sources': ['label', 'sort', 'active'],
  'issues.cause_categories': ['label', 'sort', 'active'],
  'workflow.issue_statuses': ['label', 'category', 'color', 'sort', 'active'],
}
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

function checkField(f: Field, v: unknown): string | null {
  switch (f) {
    case 'label': return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 40 ? null : '이름은 1~40자여야 합니다.'
    case 'short': return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 10 ? null : '짧은 이름은 1~10자여야 합니다.'
    case 'color': return (VOCAB_COLORS as readonly unknown[]).includes(v) ? null : '색은 정해진 토큰 중 하나여야 합니다.'
    case 'counts_as': return (COUNTS_AS as readonly unknown[]).includes(v) ? null : '집계 분류가 올바르지 않습니다.'
    case 'category': return (ISSUE_CATEGORIES as readonly unknown[]).includes(v) ? null : '범주는 열림·진행·해결·보류 중 하나여야 합니다.'
    case 'sort': case 'rank': return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 9999 ? null : '순서는 0~9999 정수여야 합니다.'
    case 'selectable': case 'announce_default': case 'active': return typeof v === 'boolean' ? null : '참·거짓 값이어야 합니다.'
  }
}

/** 저장 형태 검증(엄격) — 모르는 필드·누락·code 중복·rank 중복을 거부하고, 활성 1개 이상·sources 의 'minutes' 활성을 요구한다. */
export function parseVocab<K extends VocabKey>(key: K, raw: unknown): Parsed<VocabValues[K]> {
  if (!Array.isArray(raw)) return fail('어휘는 목록이어야 합니다.')
  const max = key === 'workflow.issue_statuses' ? MAX_ISSUE_STATUSES : MAX_ENTRIES
  if (raw.length === 0 || raw.length > max) return fail(`어휘 항목은 1~${max}개여야 합니다.`)
  const fields = FIELDS[key]
  const allowed = ['code', ...fields].sort().join(',')
  const out: Record<string, unknown>[] = []
  const codes = new Set<string>()
  const ranks = new Set<number>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return fail('어휘 항목은 객체여야 합니다.')
    const x = item as Record<string, unknown>
    if (Object.keys(x).sort().join(',') !== allowed) return fail('어휘 항목의 필드가 빠졌거나 모르는 필드가 있습니다.')
    if (typeof x.code !== 'string' || !VOCAB_CODE_RE.test(x.code)) return fail('코드는 영소문자로 시작하는 영소문자·숫자·_ 1~20자여야 합니다.')
    if (codes.has(x.code)) return fail(`코드가 중복됩니다: ${x.code}`)
    codes.add(x.code)
    for (const f of fields) {
      const e = checkField(f, x[f])
      if (e) return fail(`${x.code}: ${e}`)
    }
    if (key === 'issues.severities') {
      if (ranks.has(x.rank as number)) return fail('심각도 순위가 중복됩니다.')
      ranks.add(x.rank as number)
    }
    const copy: Record<string, unknown> = { code: x.code }
    for (const f of fields) copy[f] = typeof x[f] === 'string' ? (x[f] as string).trim() : x[f]
    out.push(copy)
  }
  if (!out.some(e => e.active === true)) return fail('활성 항목이 하나 이상 있어야 합니다.')
  if (key === 'attendance.types' && !out.some(e => e.active === true && e.selectable === true)) return fail('등록에 쓸 수 있는 활성 근태 유형이 하나 이상 있어야 합니다.')
  if (key === 'workflow.issue_statuses') {
    // 초기 상태(open 범주 첫 활성)와 해결 범주가 늘 있어야 한다 — 모든 범주가 고정 전이표로 resolved 에 닿으므로 도달성 검사는 필요 없다
    for (const c of ['open', 'resolved'] as const) {
      if (!out.some(e => e.category === c && e.active === true)) return fail(c === 'open' ? '열림 범주에 활성 상태가 하나 이상 있어야 합니다(새 이슈의 첫 상태).' : '해결 범주에 활성 상태가 하나 이상 있어야 합니다.')
    }
  }
  if (key === 'issues.sources' && !out.some(e => e.code === RESERVED_SOURCE && e.active === true)) {
    return fail("출처 'minutes'(회의록)는 예약 항목이라 지우거나 끌 수 없습니다.")
  }
  return { ok: true, value: out as unknown as VocabValues[K] }
}

/**
 * 이전 값과 비교한 편집 규칙(TS 쪽, 개정 §2.4.2) — 원인 분류는 삭제 금지(분석 실행 JSON 참조를 DB 가 세지 않는다), 출처 'minutes' 는 parse 가 지킨다.
 * 참조가 있는 code 의 삭제·의미 속성(counts_as·category) 변경은 DB(settings_ref_check)가 실제 건수로 CONFIG_IN_USE 를 낸다.
 */
export function vocabChangeError<K extends VocabKey>(key: K, prev: VocabValues[K] | undefined, next: VocabValues[K]): string | null {
  if (!prev) return null
  const nextCodes = new Set(next.map(e => e.code))
  const removed = prev.filter(e => !nextCodes.has(e.code)).map(e => e.code)
  if (key === 'issues.cause_categories' && removed.length > 0) {
    return `원인 분류는 지울 수 없습니다(분석 기록이 참조) — 비활성으로 바꾸세요: ${removed.join(', ')}`
  }
  return null
}

/** 화면 순서(sort·rank) — 원본을 바꾸지 않는다. */
export function orderedVocab<T extends VocabEntry>(list: readonly T[]): T[] {
  const ord = (e: VocabEntry) => ('rank' in e ? e.rank : 'sort' in e ? e.sort : 0)
  return [...list].sort((a, b) => ord(a) - ord(b) || a.code.localeCompare(b.code))
}
export const activeVocab = <T extends VocabEntry>(list: readonly T[]): T[] => orderedVocab(list.filter(e => e.active))
export const vocabEntry = <T extends VocabEntry>(list: readonly T[], code: string | null | undefined): T | undefined =>
  code == null ? undefined : list.find(e => e.code === code)

/** 제품 기본 라벨의 사전 키 — 저장 라벨이 기본 그대로면 화면 언어로 번역한다. 원인 분류는 사전 키가 없다(분석서 문구 그대로). */
const DICT: { readonly [K in VocabKey]?: (code: string) => string } = {
  'attendance.types': c => `att.type.${c}`,
  'meetings.categories': c => `meet.cat.${c}`,
  'issues.severities': c => `issue.severity.${c}`,
  'issues.sources': c => `issue.source.type.${c}`,
  'workflow.issue_statuses': c => `issue.status.${c}`,
}
/** 표시 라벨 — 기본 code·기본 라벨이면 사전 문구, 아니면 저장 라벨. 목록에 없는 code(옛 행)는 code 를 그대로 보인다. */
export function vocabLabel(key: VocabKey, list: readonly VocabEntry[], code: string | null | undefined, t?: (k: DictKey) => string): string {
  if (code == null) return ''
  const e = list.find(x => x.code === code)
  if (!e) return code
  const def = DEFAULT_VOCAB[key].find(x => x.code === code)
  const dict = DICT[key]
  if (t && dict && def && def.label === e.label) return t(dict(code) as DictKey)
  return e.label
}
/** 근태 짧은 라벨 — 기본 code·기본 short 면 사전 'att.typeShort.*', 아니면 저장 short. 목록 밖 code 는 code. */
export function vocabShort(list: readonly AttendanceTypeDef[], code: string, t?: (k: DictKey) => string): string {
  const e = list.find(x => x.code === code)
  if (!e) return code
  const def = DEFAULT_ATTENDANCE_TYPES.find(x => x.code === code)
  if (t && def && def.short === e.short) return t(`att.typeShort.${code}` as DictKey)
  return e.short
}
export const vocabColor = (list: readonly VocabEntry[], code: string | null | undefined) => {
  const e = code == null ? undefined : list.find(x => x.code === code)
  const color = e && 'color' in e ? e.color : 'neutral'
  return VOCAB_COLOR_CLASS[color]
}

/** 근태 집계 — B4 이전 summarize 와 같은 셈(leave·trip·remote), 분류는 counts_as 에서 읽는다. 목록 밖 code 는 total 에만. */
export function summarizeAttendance(types: readonly AttendanceTypeDef[], records: readonly { type: string }[]) {
  const of = new Map(types.map(t => [t.code, t.counts_as]))
  let leave = 0, trip = 0, remote = 0
  for (const r of records) {
    const c = of.get(r.type)
    if (c === 'leave') leave++
    else if (c === 'trip') trip++
    else if (c === 'remote') remote++
  }
  return { total: records.length, leave, trip, remote }
}

/**
 * 프로젝트 id → 그 프로젝트의 어휘(직렬화 가능 — RSC 경계를 넘는다). 한 프로젝트 화면은 { [projectId]: list }, 프로젝트를 가로지르는 목록
 * (내 회의·회의록 탐색기)은 getProjectVocabs 의 결과. null·없는 프로젝트 = 못 읽음 → 빈 목록(라벨은 code, 색은 neutral — 기본값으로 풀지 않는다).
 */
export type VocabByProject<K extends VocabKey> = Readonly<Record<string, VocabValues[K] | null>>
export function vocabOf<K extends VocabKey>(m: VocabByProject<K>, projectId: string | null | undefined): VocabValues[K] {
  return ((projectId ? m[projectId] : null) ?? []) as VocabValues[K]
}
/** 표시 한 벌 — 라벨(기본 라벨이면 사전)·점·칩 */
export function vocabView(key: VocabKey, list: readonly VocabEntry[], code: string, t?: (k: DictKey) => string) {
  return { label: vocabLabel(key, list, code, t), ...vocabColor(list, code) }
}
