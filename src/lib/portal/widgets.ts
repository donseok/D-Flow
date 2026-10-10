/**
 * 포털 위젯 레지스트리(SP3b 스펙 §6.1 — 2026-10-10 위젯 강화로 넓혔다) — 닫힌 목록 하나가 이름·설명·모듈·조건·기본 크기·기본 배치 여부를 정한다.
 * 열(main/side) 고정은 없앴다: 배치는 "순서 + 크기(half 1칸·full 2칸)" 뿐이고 격자는 2열(lg 미만은 한 열)이다.
 * 세 층이 겹친다 — ① 워크스페이스 설정 portal.widgets(허용·기본 배치) ② 개인 구성(워크스페이스 범위 개인 설정 portalLayout) ③ 모듈·조건.
 * 순수 모듈: 설정 정의(defs/workspace)·서버 로더·클라이언트 편집기가 함께 import 한다. 개인 설정(prefs)을 import 하지 않는다.
 */
import type { Parsed } from '@/lib/settings/def'
import type { ModuleId } from '@/lib/modules/defaults'
import type { DictKey } from '@/lib/i18n/dict'

export type PortalWidgetId =
  | 'my_work' | 'projects' | 'review' | 'upcoming' | 'recent_docs' | 'announcements'
  | 'due_work' | 'my_issues' | 'project_progress' | 'week_schedule' | 'favorites' | 'quick_actions' | 'memo'
  | 'recent_changes' | 'attendance_today' | 'agents_status' | 'weekly_reports' | 'wiki_recent'
export type WidgetSize = 'half' | 'full'
export const WIDGET_SIZES: readonly WidgetSize[] = ['half', 'full']
export const isWidgetSize = (x: unknown): x is WidgetSize => x === 'half' || x === 'full'

export interface PortalWidgetDef {
  id: PortalWidgetId; labelKey: DictKey
  /** 갤러리·설정 편집기의 한 줄 설명 */
  descKey: DictKey
  /** 이 모듈이 어느 프로젝트에서든(또는 워크스페이스 층에서) 켜져 있어야 후보가 된다. null = 조건 없음 */
  module: ModuleId | null
  needs: 'reviewer' | null
  /** 기본 크기 — 설정·개인 구성이 크기를 정하지 않았을 때 */
  size: WidgetSize
  /** 설정이 정하지 않았을 때 기본 배치(개인 구성이 없는 사람의 홈)에 올리는가. 새 위젯은 false — 기존 홈이 저절로 바뀌지 않는다 */
  defaultOn: boolean
}

const def = (id: PortalWidgetId, module: ModuleId | null, size: WidgetSize, defaultOn: boolean, needs: 'reviewer' | null = null): PortalWidgetDef =>
  ({ id, labelKey: `portal.widget.${id}`, descKey: `portal.widgetDesc.${id}`, module, needs, size, defaultOn })

/** 앞 여섯은 종전 홈(순서도 종전 그대로 — 옛 저장값과 E2E 가 이 순서에 기댄다). 뒤는 갤러리에서 골라 올린다 */
export const PORTAL_WIDGETS: readonly PortalWidgetDef[] = [
  def('my_work', null, 'full', true),
  def('projects', null, 'full', true),
  def('review', 'agents', 'half', true, 'reviewer'),
  def('upcoming', 'meetings', 'half', true),
  def('recent_docs', 'minutes', 'half', true),
  def('announcements', 'announcements', 'half', true),
  def('due_work', null, 'half', false),
  def('my_issues', 'issues', 'half', false),
  def('project_progress', null, 'half', false),
  def('week_schedule', null, 'full', false),
  def('favorites', null, 'half', false),
  def('quick_actions', null, 'half', false),
  def('memo', null, 'half', false),
  def('recent_changes', null, 'half', false),
  def('attendance_today', 'attendance', 'half', false),
  def('agents_status', 'agents', 'half', false),
  def('weekly_reports', 'weekly', 'half', false),
  def('wiki_recent', 'wiki', 'half', false),
]
export const PORTAL_WIDGET_IDS: readonly PortalWidgetId[] = PORTAL_WIDGETS.map((w) => w.id)
const BY_ID = new Map(PORTAL_WIDGETS.map((w) => [w.id, w]))
export const isPortalWidgetId = (x: unknown): x is PortalWidgetId => typeof x === 'string' && BY_ID.has(x as PortalWidgetId)
export const portalWidgetDef = (id: PortalWidgetId): PortalWidgetDef => BY_ID.get(id)!

// ── ① 워크스페이스 설정 portal.widgets ────────────────────────────────────────────────────────────────────────────

/**
 * 저장 형태 — 배열 순서가 기본 배치의 순서다. 옛 형태는 { id, enabled } 둘뿐이고(SP3b), 새 형태는 size·inDefault 를 더 둔다.
 * 두 칸은 항목마다 선택이다: 없으면 레지스트리 기본(size·defaultOn)으로 읽는다 — 옛 저장값을 고쳐 쓰지 않고 그대로 해석한다.
 */
export type PortalWidgetSetting = { id: PortalWidgetId; enabled: boolean; size?: WidgetSize; inDefault?: boolean }[]
/** 해석한 한 항목 — enabled = 이 워크스페이스에서 쓸 수 있다(허용), inDefault = 기본 배치에 올린다 */
export interface ResolvedWidgetSetting { id: PortalWidgetId; enabled: boolean; size: WidgetSize; inDefault: boolean }

/** 기본값 = 레지스트리 순서 전부 허용(크기·기본 배치는 레지스트리를 따른다 — 종전 홈과 같은 구성). 매번 새 배열 */
export const defaultPortalWidgets = (): PortalWidgetSetting => PORTAL_WIDGET_IDS.map((id) => ({ id, enabled: true }))

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const SETTING_KEYS = new Set(['id', 'enabled', 'size', 'inDefault'])
/**
 * 저장 형태 검증 — 순수·throw 금지. 옛 형태({ id, enabled })·새 형태(+ size·inDefault) 둘 다 받고 받은 칸만 그대로 돌려준다.
 * 빠진 id 는 레지스트리 순서로 뒤에(허용) — 새 위젯이 기존 워크스페이스의 갤러리에서 빠지지 않게(기본 배치에 드는지는 레지스트리가 정한다)
 */
export function parsePortalWidgets(raw: unknown): Parsed<PortalWidgetSetting> {
  if (!Array.isArray(raw)) return fail('위젯 목록이어야 합니다.')
  const out: PortalWidgetSetting = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return fail('위젯 항목은 { id, enabled } 여야 합니다.')
    const keys = Object.keys(x)
    if (!keys.includes('id') || !keys.includes('enabled') || keys.some((k) => !SETTING_KEYS.has(k))) return fail('위젯 항목에는 id·enabled·size·inDefault 만 둡니다.')
    const { id, enabled, size, inDefault } = x as { id?: unknown; enabled?: unknown; size?: unknown; inDefault?: unknown }
    if (!isPortalWidgetId(id)) return fail(`알 수 없는 위젯입니다: ${String(id)}`)
    if (typeof enabled !== 'boolean') return fail(`${id}: 켜짐 여부는 참·거짓이어야 합니다.`)
    if (size !== undefined && !isWidgetSize(size)) return fail(`${id}: 크기는 half·full 가운데 하나여야 합니다.`)
    if (inDefault !== undefined && typeof inDefault !== 'boolean') return fail(`${id}: 기본 배치 여부는 참·거짓이어야 합니다.`)
    if (seen.has(id)) return fail(`위젯이 중복됩니다: ${id}`)
    seen.add(id)
    out.push({ id, enabled, ...(size !== undefined ? { size } : {}), ...(inDefault !== undefined ? { inDefault } : {}) })
  }
  for (const id of PORTAL_WIDGET_IDS) if (!seen.has(id)) out.push({ id, enabled: true })
  return { ok: true, value: out }
}

/** 설정 값 → 네 칸이 모두 찬 목록(레지스트리 밖 id 는 버리고, 빠진 id 는 뒤에 붙인다 — parse 를 거치지 않은 값이 와도 같은 결과) */
export function resolvePortalWidgets(setting: PortalWidgetSetting): ResolvedWidgetSetting[] {
  const out: ResolvedWidgetSetting[] = []
  const seen = new Set<PortalWidgetId>()
  for (const w of setting) {
    const d = BY_ID.get(w.id)
    if (!d || seen.has(w.id)) continue
    seen.add(w.id)
    out.push({ id: w.id, enabled: w.enabled === true, size: isWidgetSize(w.size) ? w.size : d.size, inDefault: typeof w.inDefault === 'boolean' ? w.inDefault : d.defaultOn })
  }
  for (const d of PORTAL_WIDGETS) if (!seen.has(d.id)) out.push({ id: d.id, enabled: true, size: d.size, inDefault: d.defaultOn })
  return out
}

// ── ② 개인 구성(워크스페이스 범위 개인 설정 portalLayout) ─────────────────────────────────────────────────────────

export interface LayoutItem { id: PortalWidgetId; size: WidgetSize }
/**
 * 내 홈의 구성. items = 올린 위젯(순서·크기), known = 저장할 때 갤러리에 있던 위젯 — 그 뒤 관리자가 새로 켠 위젯을 '새로 추가됨'으로 가린다.
 * v 는 형태 판(지금은 1 하나).
 */
export interface PortalLayout { v: 1; items: LayoutItem[]; known: PortalWidgetId[] }

/**
 * 개인 구성 정리 — 저장 경로·읽기가 같은 함수를 쓴다. 형태가 아니면 null(저장 경로는 그 키를 버리고, 읽기는 '개인 구성 없음'으로 본다).
 * 모르는 id·중복 항목은 조용히 버린다(레지스트리에서 빠진 위젯이 남의 홈을 깨지 않게). 닫힌 목록이라 항목 수 상한은 레지스트리 크기다.
 */
export function parsePortalLayout(raw: unknown): PortalLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { v, items, known } = raw as { v?: unknown; items?: unknown; known?: unknown }
  if (v !== 1 || !Array.isArray(items)) return null
  const out: LayoutItem[] = []
  const seen = new Set<PortalWidgetId>()
  for (const x of items) {
    if (!x || typeof x !== 'object') continue
    const { id, size } = x as { id?: unknown; size?: unknown }
    if (!isPortalWidgetId(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, size: isWidgetSize(size) ? size : BY_ID.get(id)!.size })
  }
  return { v: 1, items: out, known: Array.isArray(known) ? [...new Set(known.filter(isPortalWidgetId))] : [] }
}

/** 옛 개인 숨김(portalHiddenWidgets) — 배열이 아니면 빈 목록 */
const legacyHiddenOf = (v: readonly PortalWidgetId[] | null | undefined): ReadonlySet<PortalWidgetId> => new Set(v ?? [])

// ── ③ 해석 ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 검토자(스펙 §6.1 역할별, W11) — 표시 규칙. 입력의 관리자 여부는 호출부가 domain/authz 의 isProjectAdmin 으로 만든다.
 * adminOfAgentsProject = null 은 '판정 불가'(모듈 합집합을 읽지 못해 agents 가 켜진 프로젝트를 모른다 — R9 ①).
 * 그때 검토 대기가 양수면 검토자, 아니면 null(검토자 아님과 구분 — 노출 식이 review 를 module_unknown 으로 남긴다).
 */
export function isPortalReviewer({ adminOfAgentsProject, reviewCount }: { adminOfAgentsProject: boolean | null; reviewCount: number | null }): boolean | null {
  if (adminOfAgentsProject === true || (reviewCount !== null && reviewCount > 0)) return true
  return adminOfAgentsProject === null ? null : false
}

export type WidgetState = 'show' | 'module_unknown'
export type WidgetSlot = { id: PortalWidgetId; size: WidgetSize; state: WidgetState }
/** 갤러리 한 칸 — size 는 워크스페이스가 정한 기본 크기. isNew = 내 구성을 저장한 뒤에 쓸 수 있게 된 위젯 */
export type GalleryItem = { id: PortalWidgetId; size: WidgetSize; state: WidgetState; isNew: boolean }
export interface HomeLayout {
  /** 홈에 그릴 위젯(순서대로) */
  slots: WidgetSlot[]
  /** 지금 이 사람이 고를 수 있는 위젯 전부(허용 ∧ 모듈 ∧ 조건) — 설정 순서 */
  gallery: GalleryItem[]
  /** 워크스페이스 기본 배치(같은 후보 안에서) — '기본값으로 되돌리기' 가 초안에 싣는 값 */
  defaults: LayoutItem[]
  /** 저장된 개인 구성으로 그렸는가(false = 워크스페이스 기본 배치 — 옛 숨김만 뺀 경우도 false) */
  personal: boolean
}

/**
 * 홈 해석 — 후보 = 설정에서 허용 ∧ (모듈 null ∨ 합집합에 있음) ∧ (needs null ∨ 검토자).
 * 합집합을 읽지 못하면(null) 모듈 위젯을 후보에서 빼지 않고 module_unknown 으로 남긴다 — 페이지가 그 자리에 실패 카드를 그린다(W10).
 * reviewer = null(판정 불가 — R9 ①)도 review 를 module_unknown 으로 남긴다(false 면 후보가 아니다). 합집합을 읽었고 그 모듈이 어디서도 꺼져 있으면 없다.
 * 개인 구성이 있으면 그 items 가운데 후보인 것만 개인 순서·크기로 — 관리자가 끈 위젯은 개인 구성에 있어도 보이지 않고, 새로 켠 위젯은 끼어들지 않는다.
 * 개인 구성이 없으면 설정의 기본 배치(inDefault)에서 옛 개인 숨김(legacyHidden)을 뺀다 — 숨김 값을 잃지 않는 이행(저장하면 개인 구성이 된다).
 */
export function resolveHomeLayout({ setting, layout, legacyHidden, moduleUnion, reviewer }: {
  setting: PortalWidgetSetting; layout: PortalLayout | null; legacyHidden?: readonly PortalWidgetId[] | null
  moduleUnion: ReadonlySet<ModuleId> | null; reviewer: boolean | null
}): HomeLayout {
  const resolved = resolvePortalWidgets(setting)
  const state = new Map<PortalWidgetId, WidgetState>()
  for (const { id, enabled } of resolved) {
    const d = BY_ID.get(id)!
    if (!enabled) continue
    let s: WidgetState = 'show'
    if (d.module !== null) {
      if (moduleUnion === null) s = 'module_unknown'
      else if (!moduleUnion.has(d.module)) continue
    }
    if (d.needs === 'reviewer') {
      if (reviewer === false) continue
      if (reviewer === null) s = 'module_unknown'                        // '검토자 아님'으로 위장하지 않는다(R9 ①)
    }
    state.set(id, s)
  }
  const candidates = resolved.filter((w) => state.has(w.id))
  const defaults: LayoutItem[] = candidates.filter((w) => w.inDefault).map((w) => ({ id: w.id, size: w.size }))
  const placed = layout ? layout.items.filter((i) => state.has(i.id)) : (() => { const hidden = legacyHiddenOf(legacyHidden); return defaults.filter((i) => !hidden.has(i.id)) })()
  const known = new Set<PortalWidgetId>(layout ? [...layout.known, ...layout.items.map((i) => i.id)] : [])
  return {
    slots: placed.map((i) => ({ id: i.id, size: i.size, state: state.get(i.id)! })),
    gallery: candidates.map((w) => ({ id: w.id, size: w.size, state: state.get(w.id)!, isNew: layout !== null && !known.has(w.id) })),
    defaults, personal: layout !== null,
  }
}

// ── 격자·편집(순수 — 편집 모드와 테스트가 함께 쓴다) ──────────────────────────────────────────────────────────────

export const GRID_COLUMNS = 2
export interface GridCell { id: PortalWidgetId; row: number; col: number; span: 1 | 2 }
/**
 * 2열 격자의 자리(1부터) — CSS 격자의 기본 흐름(row, dense 아님)과 같은 규칙: full 은 새 줄의 두 칸, half 는 빈 칸이 있으면 그 줄에.
 * 화면은 CSS 가 놓는다 — 이 계산은 위치를 글로 알릴 때(라이브 영역)와 테스트에 쓴다. 한 열(좁은 화면)에서는 순서가 곧 위치다.
 */
export function gridCells(items: readonly LayoutItem[]): GridCell[] {
  const out: GridCell[] = []
  let row = 1, col = 1
  for (const { id, size } of items) {
    const span = size === 'full' ? GRID_COLUMNS : 1
    if (col + span - 1 > GRID_COLUMNS) { row++; col = 1 }
    out.push({ id, row, col, span: span as 1 | 2 })
    col += span
    if (col > GRID_COLUMNS) { row++; col = 1 }
  }
  return out
}

/** 한 자리 앞(-1)·뒤(+1)로. 끝에서는 그대로(같은 배열을 돌려준다 — 호출부가 '못 옮김'을 안다) */
export function moveLayoutItem<T extends { id: PortalWidgetId }>(items: readonly T[], id: PortalWidgetId, step: -1 | 1): readonly T[] {
  const from = items.findIndex((i) => i.id === id), to = from + step
  if (from < 0 || to < 0 || to >= items.length) return items
  const next = [...items]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
/** 끌어 놓기 — id 를 target 의 자리로(앞에서 끌어오면 target 뒤, 뒤에서 끌어오면 target 앞 = 놓은 자리를 차지한다) */
export function dropLayoutItem<T extends { id: PortalWidgetId }>(items: readonly T[], id: PortalWidgetId, target: PortalWidgetId): readonly T[] {
  const from = items.findIndex((i) => i.id === id), to = items.findIndex((i) => i.id === target)
  if (from < 0 || to < 0 || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
export const sameLayout = (a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.size === b[i].size)
