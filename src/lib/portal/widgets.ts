/**
 * 포털 위젯 레지스트리(SP3b 스펙 §6.1) — 닫힌 목록 하나가 열(제품 고정)·모듈·검토 조건을 정한다. 순서는 열 안에서 portal.widgets 를 따른다.
 * main 열 첫 칸은 SP9 의 '프로젝트 준비'(UX-01)가 쓸 수 있다 — id 를 미리 예약하지 않는다(빈 자리·죽은 조작을 두지 않는다).
 * 순수 모듈: 설정 정의(defs/workspace)·서버 로더·클라이언트 편집기가 함께 import 한다. 개인 설정(prefs)을 import 하지 않는다.
 */
import type { Parsed } from '@/lib/settings/def'
import type { ModuleId } from '@/lib/modules/defaults'
import type { DictKey } from '@/lib/i18n/dict'

export type PortalWidgetId = 'my_work' | 'projects' | 'review' | 'upcoming' | 'recent_docs' | 'announcements'
export interface PortalWidgetDef { id: PortalWidgetId; labelKey: DictKey; module: ModuleId | null; column: 'main' | 'side'; needs: 'reviewer' | null }

export const PORTAL_WIDGETS: readonly PortalWidgetDef[] = [
  { id: 'my_work', labelKey: 'portal.widget.my_work', module: null, column: 'main', needs: null },
  { id: 'projects', labelKey: 'portal.widget.projects', module: null, column: 'main', needs: null },
  { id: 'review', labelKey: 'portal.widget.review', module: 'agents', column: 'side', needs: 'reviewer' },
  { id: 'upcoming', labelKey: 'portal.widget.upcoming', module: 'meetings', column: 'side', needs: null },
  { id: 'recent_docs', labelKey: 'portal.widget.recent_docs', module: 'minutes', column: 'side', needs: null },
  { id: 'announcements', labelKey: 'portal.widget.announcements', module: 'announcements', column: 'side', needs: null },
]
export const PORTAL_WIDGET_IDS: readonly PortalWidgetId[] = PORTAL_WIDGETS.map((w) => w.id)
const BY_ID = new Map(PORTAL_WIDGETS.map((w) => [w.id, w]))
export const isPortalWidgetId = (x: unknown): x is PortalWidgetId => typeof x === 'string' && BY_ID.has(x as PortalWidgetId)

export type PortalWidgetSetting = { id: PortalWidgetId; enabled: boolean }[]
/** 기본값 = 레지스트리 순서 전부 켬(현행 홈과 같은 구성 — 개정 §2.6.2 R1). 매번 새 배열 */
export const defaultPortalWidgets = (): PortalWidgetSetting => PORTAL_WIDGET_IDS.map((id) => ({ id, enabled: true }))

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
/** 저장 형태 검증 — 순수·throw 금지. 빠진 id 는 레지스트리 순서로 뒤에(켜짐) — 새 위젯이 기존 워크스페이스에서 꺼진 채 숨지 않게 */
export function parsePortalWidgets(raw: unknown): Parsed<PortalWidgetSetting> {
  if (!Array.isArray(raw)) return fail('위젯 목록이어야 합니다.')
  const out: PortalWidgetSetting = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return fail('위젯 항목은 { id, enabled } 여야 합니다.')
    const keys = Object.keys(x)
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('enabled')) return fail('위젯 항목에는 id·enabled 만 둡니다.')
    const { id, enabled } = x as { id?: unknown; enabled?: unknown }
    if (!isPortalWidgetId(id)) return fail(`알 수 없는 위젯입니다: ${String(id)}`)
    if (typeof enabled !== 'boolean') return fail(`${id}: 켜짐 여부는 참·거짓이어야 합니다.`)
    if (seen.has(id)) return fail(`위젯이 중복됩니다: ${id}`)
    seen.add(id); out.push({ id, enabled })
  }
  for (const id of PORTAL_WIDGET_IDS) if (!seen.has(id)) out.push({ id, enabled: true })
  return { ok: true, value: out }
}

/** 검토자(스펙 §6.1 역할별, W11) — 표시 규칙. 입력의 관리자 여부는 호출부가 domain/authz 의 isProjectAdmin 으로 만든다 */
export function isPortalReviewer({ adminOfAgentsProject, reviewCount }: { adminOfAgentsProject: boolean; reviewCount: number | null }): boolean {
  return adminOfAgentsProject || (reviewCount !== null && reviewCount > 0)
}

export type WidgetSlot = { id: PortalWidgetId; state: 'show' | 'module_unknown' }
/**
 * 노출 식(스펙 §6.1) — 설정에서 켜짐 ∧ 개인 숨김 아님 ∧ (모듈 null ∨ 합집합에 있음) ∧ (needs null ∨ 검토자).
 * 합집합을 읽지 못하면(null) 모듈 위젯을 숨기지 않고 module_unknown 으로 남긴다 — 페이지가 그 자리에 실패 카드를 그린다(W10).
 * hiddenCount = 개인 숨김이 없었다면 보였을 위젯 수('숨긴 위젯 N개 다시 보기').
 */
export function visibleWidgets({ setting, hidden, moduleUnion, reviewer }: {
  setting: PortalWidgetSetting; hidden: readonly PortalWidgetId[]; moduleUnion: ReadonlySet<ModuleId> | null; reviewer: boolean
}): { main: WidgetSlot[]; side: WidgetSlot[]; hiddenCount: number } {
  const main: WidgetSlot[] = [], side: WidgetSlot[] = []
  let hiddenCount = 0
  for (const { id, enabled } of setting) {
    const def = BY_ID.get(id)
    if (!def || !enabled) continue
    if (def.needs === 'reviewer' && !reviewer) continue
    let state: WidgetSlot['state'] = 'show'
    if (def.module !== null) {
      if (moduleUnion === null) state = 'module_unknown'
      else if (!moduleUnion.has(def.module)) continue
    }
    if (hidden.includes(id)) { hiddenCount++; continue }
    ;(def.column === 'main' ? main : side).push({ id, state })
  }
  return { main, side, hiddenCount }
}
