// 회의록 → 프로그램 설계서(DesignSpec) · 와이어프레임 화면 목업(MockupSpec) 명세. I/O 없는 순수 함수만 둔다.
// LLM 은 구조화된 JSON 만 출력하고, HTML·URL·스크립트 필드는 스키마에 두지 않는다.
// 모든 LLM 응답은 normalizeDesignSpec / normalizeMockupSpec 을 통과한 값만 화면에 그린다.

export const MOCKUP_COMPONENT_TYPES = [
  'heading', 'text', 'badge', 'stats', 'input', 'select', 'button', 'list', 'table', 'card', 'tabs', 'image',
] as const
export type MockupComponentType = (typeof MOCKUP_COMPONENT_TYPES)[number]

export const DESIGN_PRIORITIES = ['high', 'medium', 'low'] as const
export type DesignPriority = (typeof DESIGN_PRIORITIES)[number]

export const DESIGN_RULE_KINDS = ['data', 'api', 'auth', 'constraint'] as const
export type DesignRuleKind = (typeof DESIGN_RULE_KINDS)[number]

export const MOCKUP_SCREENS_MAX = 6
export const MOCKUP_COMPONENTS_MAX = 20
export const MOCKUP_ITEMS_MAX = 8
export const MOCKUP_TEXT_MAX = 80
export const MOCKUP_SUMMARY_MAX = 140
export const MOCKUP_TITLE_MAX = 40
export const MOCKUP_ID_MAX = 40

export const DESIGN_TITLE_MAX = 60
export const DESIGN_OVERVIEW_MAX = 400
export const DESIGN_REQUIREMENTS_MAX = 15
export const DESIGN_SCREENS_MAX = 10
export const DESIGN_RULES_MAX = 12
export const DESIGN_QUESTIONS_MAX = 10
export const DESIGN_ITEM_TITLE_MAX = 60
export const DESIGN_ITEM_DESC_MAX = 220
export const DESIGN_CATEGORY_MAX = 24

export interface MockupComponent {
  type: MockupComponentType
  /** heading·text·button·input·select·card·image·badge·stats 의 대표 문구 */
  text: string
  /** list·select·tabs·badge·stats 의 항목, table 의 열 이름, card·input 의 보조 항목 */
  items: string[]
  /** button·tabs 가 누르면 이동할 화면 id — 없는 화면을 가리키면 normalize 가 지운다 */
  goto: string | null
}

export interface MockupScreen {
  id: string
  title: string
  /** 화면의 역할·시나리오 한 줄 요약 */
  summary: string
  components: MockupComponent[]
}

export interface MockupSpec {
  title: string
  screens: MockupScreen[]
}

export interface DesignRequirement {
  id: string
  category: string
  title: string
  description: string
  priority: DesignPriority
}

export interface DesignScreenItem {
  id: string
  name: string
  purpose: string
  elements: string[]
  flow: string
}

export interface DesignRuleItem {
  kind: DesignRuleKind
  title: string
  detail: string
}

export interface DesignSpec {
  title: string
  overview: string
  requirements: DesignRequirement[]
  screens: DesignScreenItem[]
  rules: DesignRuleItem[]
  openQuestions: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 앞에서 max 자 — 서로게이트 쌍 가운데서 자르지 않는다 */
function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const head = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? clip(v, max) : '')

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((i): i is string => typeof i === 'string')
    .map(i => clip(i, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeComponent(raw: unknown, validIds: ReadonlySet<string>, selfId: string): MockupComponent | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (typeof type !== 'string' || !(MOCKUP_COMPONENT_TYPES as readonly string[]).includes(type)) return null
  // 글 필드 이름은 종류마다 달라도(label·text·title·placeholder) 하나로 모은다 — LLM 이 흔히 섞어 쓴다
  const text = str(raw.text, MOCKUP_TEXT_MAX)
    || str(raw.label, MOCKUP_TEXT_MAX)
    || str(raw.title, MOCKUP_TEXT_MAX)
    || str(raw.placeholder, MOCKUP_TEXT_MAX)
  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.columns)
      ? raw.columns
      : Array.isArray(raw.options)
        ? raw.options
        : Array.isArray(raw.fields)
          ? raw.fields
          : []
  const items = strList(rawItems, MOCKUP_ITEMS_MAX, MOCKUP_TEXT_MAX)
  const goto = typeof raw.goto === 'string' && raw.goto !== selfId && validIds.has(raw.goto) ? raw.goto : null
  return { type: type as MockupComponentType, text, items, goto }
}

/**
 * LLM 이 낸 값 → 쓸 수 있는 와이어프레임 명세. 화면이 하나도 남지 않으면 null(호출자가 실패로 알린다).
 * 화면 id 는 중복을 거르고, 버튼·탭의 goto 는 남은 화면 id 로만 허용한다.
 */
export function normalizeMockupSpec(raw: unknown): MockupSpec | null {
  if (!isRecord(raw) || !Array.isArray(raw.screens)) return null
  const seen = new Set<string>()
  const heads: { id: string; title: string; summary: string; comps: unknown[] }[] = []
  for (const s of raw.screens) {
    if (heads.length >= MOCKUP_SCREENS_MAX) break
    if (!isRecord(s)) continue
    const id = str(s.id, MOCKUP_ID_MAX)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title = str(s.title, MOCKUP_TITLE_MAX) || str(s.name, MOCKUP_TITLE_MAX) || id
    const summary = str(s.summary, MOCKUP_SUMMARY_MAX) || str(s.description, MOCKUP_SUMMARY_MAX) || str(s.purpose, MOCKUP_SUMMARY_MAX)
    heads.push({ id, title, summary, comps: Array.isArray(s.components) ? s.components : [] })
  }
  if (heads.length === 0) return null
  const screens: MockupScreen[] = heads.map(h => ({
    id: h.id,
    title: h.title,
    summary: h.summary,
    components: h.comps
      .slice(0, MOCKUP_COMPONENTS_MAX)
      .map(c => normalizeComponent(c, seen, h.id))
      .filter((c): c is MockupComponent => c !== null),
  }))
  const specTitle = str(raw.title, DESIGN_TITLE_MAX) || screens[0].title
  return { title: specTitle, screens }
}

function normalizePriority(v: unknown): DesignPriority {
  if (typeof v !== 'string') return 'medium'
  const lower = v.trim().toLowerCase()
  if (lower === 'high' || lower === 'must' || lower === '필수' || lower === '상' || lower === '높음') return 'high'
  if (lower === 'low' || lower === 'could' || lower === '검토' || lower === '하' || lower === '낮음') return 'low'
  return 'medium'
}

function normalizeRuleKind(v: unknown): DesignRuleKind {
  if (typeof v !== 'string') return 'data'
  const lower = v.trim().toLowerCase()
  if (lower === 'api' || lower.includes('연동') || lower.includes('인터페이스')) return 'api'
  if (lower === 'auth' || lower.includes('권한') || lower.includes('보안')) return 'auth'
  if (lower === 'constraint' || lower.includes('제약') || lower.includes('성능') || lower.includes('규칙')) return 'constraint'
  return 'data'
}

function normalizeRequirement(raw: unknown, index: number): DesignRequirement | null {
  if (!isRecord(raw)) return null
  const title = str(raw.title, DESIGN_ITEM_TITLE_MAX) || str(raw.name, DESIGN_ITEM_TITLE_MAX)
  const description = str(raw.description, DESIGN_ITEM_DESC_MAX) || str(raw.detail, DESIGN_ITEM_DESC_MAX) || str(raw.text, DESIGN_ITEM_DESC_MAX)
  if (!title && !description) return null
  const fallbackId = `FR-${String(index + 1).padStart(2, '0')}`
  const id = str(raw.id, 16) || fallbackId
  const category = str(raw.category, DESIGN_CATEGORY_MAX) || '기능'
  return {
    id,
    category,
    title: title || description.slice(0, DESIGN_ITEM_TITLE_MAX),
    description,
    priority: normalizePriority(raw.priority),
  }
}

function normalizeDesignScreen(raw: unknown, index: number): DesignScreenItem | null {
  if (!isRecord(raw)) return null
  const name = str(raw.name, MOCKUP_TITLE_MAX) || str(raw.title, MOCKUP_TITLE_MAX)
  const purpose = str(raw.purpose, DESIGN_ITEM_DESC_MAX) || str(raw.description, DESIGN_ITEM_DESC_MAX) || str(raw.summary, DESIGN_ITEM_DESC_MAX)
  if (!name && !purpose) return null
  const id = str(raw.id, MOCKUP_ID_MAX) || `screen_${index + 1}`
  const rawElements = Array.isArray(raw.elements) ? raw.elements : Array.isArray(raw.components) ? raw.components : Array.isArray(raw.items) ? raw.items : []
  const elements = strList(rawElements, MOCKUP_ITEMS_MAX, MOCKUP_TEXT_MAX)
  const flow = str(raw.flow, DESIGN_ITEM_DESC_MAX) || str(raw.transition, DESIGN_ITEM_DESC_MAX)
  return { id, name: name || id, purpose, elements, flow }
}

function normalizeDesignRule(raw: unknown): DesignRuleItem | null {
  if (!isRecord(raw)) return null
  const title = str(raw.title, DESIGN_ITEM_TITLE_MAX) || str(raw.item, DESIGN_ITEM_TITLE_MAX) || str(raw.name, DESIGN_ITEM_TITLE_MAX)
  const detail = str(raw.detail, DESIGN_ITEM_DESC_MAX) || str(raw.description, DESIGN_ITEM_DESC_MAX) || str(raw.text, DESIGN_ITEM_DESC_MAX)
  if (!title && !detail) return null
  return {
    kind: normalizeRuleKind(raw.kind ?? raw.category ?? raw.type),
    title: title || detail.slice(0, DESIGN_ITEM_TITLE_MAX),
    detail,
  }
}

/**
 * LLM 이 낸 값 → 쓸 수 있는 프로그램 설계서 명세.
 * 개요·요구사항·화면·규칙 가운데 실질 내용이 하나도 없으면 null(빈 설계서로 위장하지 않는다).
 */
export function normalizeDesignSpec(raw: unknown): DesignSpec | null {
  if (!isRecord(raw)) return null
  const overview = str(raw.overview, DESIGN_OVERVIEW_MAX) || str(raw.summary, DESIGN_OVERVIEW_MAX) || str(raw.purpose, DESIGN_OVERVIEW_MAX)
  const rawReqs = Array.isArray(raw.requirements) ? raw.requirements : Array.isArray(raw.functionalRequirements) ? raw.functionalRequirements : []
  const requirements = rawReqs
    .slice(0, DESIGN_REQUIREMENTS_MAX)
    .map((r, i) => normalizeRequirement(r, i))
    .filter((r): r is DesignRequirement => r !== null)
  const rawScreens = Array.isArray(raw.screens) ? raw.screens : []
  const screens = rawScreens
    .slice(0, DESIGN_SCREENS_MAX)
    .map((s, i) => normalizeDesignScreen(s, i))
    .filter((s): s is DesignScreenItem => s !== null)
  const rawRules = Array.isArray(raw.rules) ? raw.rules : Array.isArray(raw.dataAndRules) ? raw.dataAndRules : []
  const rules = rawRules
    .slice(0, DESIGN_RULES_MAX)
    .map(normalizeDesignRule)
    .filter((r): r is DesignRuleItem => r !== null)
  const rawQuestions = Array.isArray(raw.openQuestions)
    ? raw.openQuestions
    : Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.tbd)
        ? raw.tbd
        : []
  const openQuestions = strList(rawQuestions, DESIGN_QUESTIONS_MAX, DESIGN_ITEM_DESC_MAX)

  if (!overview && requirements.length === 0 && screens.length === 0 && rules.length === 0) return null
  const title = str(raw.title, DESIGN_TITLE_MAX) || requirements[0]?.title || screens[0]?.name || '프로그램 설계서'
  return { title, overview, requirements, screens, rules, openQuestions }
}

const PRIORITY_KO: Record<DesignPriority, string> = { high: '필수', medium: '권장', low: '검토' }
const RULE_KIND_KO: Record<DesignRuleKind, string> = {
  data: '데이터',
  api: '연동·API',
  auth: '권한·보안',
  constraint: '제약·성능',
}

/** 마크다운 표 칸 안의 파이프·줄바꿈 정리 */
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || '-'

/**
 * 추출된 프로그램 설계서(DesignSpec)를 위키·WBS 지시문·문서에 바로 붙여넣을 수 있는 마크다운으로 변환한다.
 */
export function formatDesignSpecMarkdown(spec: DesignSpec): string {
  const lines: string[] = [`# ${spec.title}`, '']
  if (spec.overview) {
    lines.push('## 1. 개요 및 목적', '', spec.overview, '')
  }
  if (spec.requirements.length > 0) {
    lines.push(
      '## 2. 기능 요구사항',
      '',
      '| ID | 분류 | 우선순위 | 요구사항 | 상세 내용 |',
      '|---|---|---|---|---|',
      ...spec.requirements.map(r =>
        `| ${mdCell(r.id)} | ${mdCell(r.category)} | ${PRIORITY_KO[r.priority]} | ${mdCell(r.title)} | ${mdCell(r.description)} |`),
      '',
    )
  }
  if (spec.screens.length > 0) {
    lines.push('## 3. 화면 구성 및 흐름', '')
    for (const s of spec.screens) {
      lines.push(`### ${s.name}`)
      if (s.purpose) lines.push(`- **목적**: ${s.purpose}`)
      if (s.elements.length > 0) lines.push(`- **주요 구성요소**: ${s.elements.join(', ')}`)
      if (s.flow) lines.push(`- **동작·이동 흐름**: ${s.flow}`)
      lines.push('')
    }
  }
  if (spec.rules.length > 0) {
    lines.push('## 4. 데이터 · 연동 · 제약 규칙', '')
    for (const r of spec.rules) {
      lines.push(`- **[${RULE_KIND_KO[r.kind]}] ${r.title}**: ${r.detail || '-'}`)
    }
    lines.push('')
  }
  if (spec.openQuestions.length > 0) {
    lines.push('## 5. 미결 사항 (추가 확인 필요)', '')
    for (const q of spec.openQuestions) {
      lines.push(`- [ ] ${q}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}
