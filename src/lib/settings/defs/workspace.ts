// 워크스페이스 키 12개(SP5 A 의 calendar.* 셋 포함)(스펙 §3.6 표, 개정 §2.8.1). 소유 모듈은 전부 core settings(D12). 값 형태의 정본은 개정 §2.8.1.
import { DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy, type AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { defineSetting, type Parsed, type SettingDef } from '../def'
import { NON_CORE_MODULES, isModuleId, type ModuleId } from '@/lib/modules/defaults'
import { isNavItemId, type NavItemId } from '@/lib/nav/ids'
import { BRANDING_SLOTS, parseBrandingPath, type BrandingSlot } from '../brandingPath'
import { deriveAccent, parseAccentInput, parseAccentValue, type AccentValue, type Hex } from '../accent'
import { toAsciiHostname } from '@/lib/domain/hostname'
import { ANY_DOMAIN } from '@/lib/domain/invites'
import { DEFAULT_TIMEZONE, DEFAULT_WORKING_DAYS, parseTimezone, parseWeekStartDay, parseWorkingDays, type IsoDow, type WeekStartDay } from '@/lib/domain/calendar'

export type ModulesList = ModuleId[]
export type BrandingLogo = { full: string | null; full_dark: string | null; mark: string | null }
export type NavMenuSetting = { order: NavItemId[]; labels: Partial<Record<NavItemId, string>> }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
// 제어 문자(U+0000~U+001F·U+007F) — 줄바꿈도 여기 든다(메일 발신명 헤더 주입 차단)
const CONTROL = /[\u0000-\u001f\u007f]/

function parseShortText(raw: unknown, max: number, allowNull: boolean): Parsed<string | null> {
  if (raw === null) return allowNull ? { ok: true, value: null } : fail('값이 필요합니다.')
  if (typeof raw !== 'string') return fail('문자열이어야 합니다.')
  const v = raw.trim()
  if (v.length < 1 || v.length > max) return fail(`1~${max}자여야 합니다.`)
  if (CONTROL.test(v)) return fail('제어 문자를 넣을 수 없습니다.')
  return { ok: true, value: v }
}
const uniqueList = <T,>(xs: readonly T[]) => new Set(xs).size === xs.length

/** 비core 모듈 id 의 유일 목록 */
function parseModuleList(raw: unknown, allowed: readonly ModuleId[]): Parsed<ModulesList> {
  if (!Array.isArray(raw)) return fail('모듈 목록이어야 합니다.')
  for (const id of raw) {
    if (!isModuleId(id)) return fail(`모르는 모듈입니다: ${String(id)}`)
    if (!allowed.includes(id)) return fail(`이 층에서 켜고 끌 수 없는 모듈입니다: ${id}`)
  }
  if (!uniqueList(raw)) return fail('모듈이 중복됩니다.')
  return { ok: true, value: raw as ModulesList }
}
export { parseModuleList }

// ── 초대 도메인(D40) ──────────────────────────────────────────────────────────────────────────────────────────
// 전체 허용 값 ANY_DOMAIN 은 초대 판정(domain/invites)과 한 출처다 — 두 벌이면 한쪽만 바뀌었을 때 parse 와 판정이 갈린다
/** 한 항목의 정규화 — 소문자·앞뒤 공백·선행 @·끝 점 제거·퓨니코드. 형식이 틀리면 거부(버리지 않는다) */
export function normalizeDomain(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let v = raw.trim().toLowerCase().replace(/^@/, '')
  if (v.endsWith('.') && !v.endsWith('..')) v = v.slice(0, -1)
  if (!v) return fail('빈 도메인입니다.')
  if (v.includes('*')) return fail(`'*' 는 단독일 때만 전체 허용입니다: ${raw.trim()}`)
  // 퓨니코드 변환만 — URL 구분자·%xx 가 섞인 값은 잘라 저장하지 않고 거부한다(메일 쪽 normalizeEmailHost 와 같은 헬퍼)
  const h = toAsciiHostname(v)
  if (!h) return fail(`도메인 형식이 아닙니다: ${raw.trim()}`)
  return { ok: true, value: h }
}
/** 저장 형태 — 정규화된 유일 목록. [] 는 초대 불가, ['*'] 단독은 제한 없음. '*' 가 섞이면 거부 */
export function parseAllowedDomainsSetting(raw: unknown): Parsed<string[]> {
  if (!Array.isArray(raw)) return fail('도메인 목록이어야 합니다.')
  if (raw.some((x) => typeof x !== 'string')) return fail('도메인은 문자열이어야 합니다.')
  const items = raw as string[]
  if (items.some((x) => x.trim() === ANY_DOMAIN)) {
    return items.length === 1 ? { ok: true, value: [ANY_DOMAIN] } : fail(`'*' 는 단독일 때만 유효합니다.`)
  }
  const out: string[] = []
  for (const item of items) {
    const n = normalizeDomain(item)
    if (!n.ok) return n
    if (!out.includes(n.value)) out.push(n.value)
  }
  return { ok: true, value: out }
}
/** 배포 기본값 env(쉼표·공백 구분) — 틀린 항목이 하나라도 있으면 그 항목만 빼지 않고 전체를 undefined 로 본다(환경 오류를 조용히 좁히지 않는다) */
function parseDomainsEnv(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const parts = raw.split(/[\s,]+/).filter(Boolean)
  const p = parseAllowedDomainsSetting(parts)
  if (!p.ok) {
    console.error('[settings] INVITE_ALLOWED_DOMAINS 를 읽을 수 없어 배포 기본값을 쓰지 않습니다:', p.error)
    return undefined
  }
  return p.value
}

// ── 로고 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function parseBrandingLogo(raw: unknown): Parsed<BrandingLogo> {
  if (!isObj(raw)) return fail('로고 값은 객체여야 합니다.')
  const keys = Object.keys(raw).sort()
  if (keys.join(',') !== [...BRANDING_SLOTS].sort().join(',')) return fail('로고 값은 full·full_dark·mark 세 슬롯이어야 합니다.')
  const out = {} as Record<BrandingSlot, string | null>
  for (const slot of BRANDING_SLOTS) {
    const v = raw[slot]
    if (v === null) { out[slot] = null; continue }
    const p = parseBrandingPath(v)
    if (!p.ok) return fail(`${slot}: ${p.error}`)
    if (p.value.slot !== slot) return fail(`${slot}: 경로의 슬롯(${p.value.slot})이 다릅니다.`)
    out[slot] = v as string
  }
  return { ok: true, value: out }
}

// ── 메뉴 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function parseNavMenu(raw: unknown): Parsed<NavMenuSetting> {
  if (!isObj(raw) || !Array.isArray(raw.order) || !isObj(raw.labels)) return fail('메뉴 설정은 { order, labels } 여야 합니다.')
  if (!raw.order.every(isNavItemId)) return fail('order 에 모르는 메뉴 id 가 있습니다.')
  if (!uniqueList(raw.order)) return fail('order 에 중복이 있습니다.')
  const labels: Partial<Record<NavItemId, string>> = {}
  for (const [id, label] of Object.entries(raw.labels)) {
    if (!isNavItemId(id)) return fail(`labels 에 모르는 메뉴 id 가 있습니다: ${id}`)
    if (typeof label !== 'string' || label.length < 1 || label.length > 20 || /[<>]/.test(label)) {
      return fail(`${id} 의 라벨은 1~20자이고 꺾쇠를 쓸 수 없습니다.`)
    }
    labels[id] = label
  }
  return { ok: true, value: { order: raw.order as NavItemId[], labels } }
}

export const WORKSPACE_DEFS = [
  defineSetting<'modules.allowed', ModulesList>({
    key: 'modules.allowed', scope: 'workspace', module: 'settings', default: [],
    parse: (raw) => parseModuleList(raw, NON_CORE_MODULES),
    widget: { kind: 'custom', component: 'ModuleAllowEditor' }, editor: 'platform_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'ai.enabled', boolean>({
    key: 'ai.enabled', scope: 'workspace', module: 'settings', default: true,
    parse: (raw) => (typeof raw === 'boolean' ? { ok: true, value: raw } : fail('참·거짓이어야 합니다.')),
    widget: { kind: 'boolean' }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'invites.allowed_domains', string[]>({
    key: 'invites.allowed_domains', scope: 'workspace', module: 'settings', default: [],
    parse: parseAllowedDomainsSetting,
    widget: { kind: 'text_list', maxItems: 50 }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
    deployDefault: { env: 'INVITE_ALLOWED_DOMAINS', parse: parseDomainsEnv },
  }),
  defineSetting<'branding.product_name', string>({
    key: 'branding.product_name', scope: 'workspace', module: 'settings', default: 'D-Flow',
    parse: (raw) => parseShortText(raw, 40, false) as Parsed<string>,
    widget: { kind: 'text', maxLength: 40 }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
    deployDefault: { env: 'NEXT_PUBLIC_BRAND_NAME', parse: (raw) => { const p = parseShortText(raw, 40, false); return p.ok ? (p.value as string) : undefined } },
  }),
  defineSetting<'branding.logo', BrandingLogo>({
    key: 'branding.logo', scope: 'workspace', module: 'settings', default: { full: null, full_dark: null, mark: null },
    parse: parseBrandingLogo,
    widget: { kind: 'custom', component: 'LogoEditor' }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  defineSetting<'branding.accent', AccentValue | null, Hex | null>({
    key: 'branding.accent', scope: 'workspace', module: 'settings', default: null,
    parse: parseAccentValue,
    widget: { kind: 'custom', component: 'AccentEditor' }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
    // 입력은 hex 하나, 저장은 파생 세트(D14) — 클라이언트가 세트를 보내면 parseInput 에서 CONFIG_INVALID
    edit: {
      parseInput: parseAccentInput,
      toStored: (_prev, input) => {
        if (input === null) return { ok: true, value: null }
        const d = deriveAccent(input)
        return d.ok ? { ok: true, value: d.value } : fail(d.failures.length ? `${d.error} ${d.failures.map((f) => `${f.pair} ${f.contrast}<${f.min}`).join(', ')}` : d.error)
      },
    },
  }),
  defineSetting<'branding.mail_from_name', string | null>({
    key: 'branding.mail_from_name', scope: 'workspace', module: 'settings', default: null,   // 소비처가 제품명으로 푼다(§9 #4)
    parse: (raw) => parseShortText(raw, 40, true),
    widget: { kind: 'text', maxLength: 40 }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
    deployDefault: { env: 'MAIL_FROM_NAME', parse: (raw) => { const p = parseShortText(raw, 40, false); return p.ok ? (p.value as string) : undefined } },
  }),
  defineSetting<'navigation.menu', NavMenuSetting>({
    key: 'navigation.menu', scope: 'workspace', module: 'settings', default: { order: [], labels: {} },
    parse: parseNavMenu,
    widget: { kind: 'custom', component: 'MenuOrderEditor' }, editor: 'workspace_admin', apply: 'immediate', impact: ['none'], sql: null,
  }),
  // SP5 A(스펙 §4.2, 개정 §2.8.1) — 워크스페이스 값은 워크스페이스 화면의 기준이고 새 프로젝트의 초기값(생성 시 복사 — 상속 아님)이다
  defineSetting<'calendar.timezone', string>({
    key: 'calendar.timezone', scope: 'workspace', module: 'settings', default: DEFAULT_TIMEZONE,
    parse: parseTimezone,
    widget: { kind: 'custom', component: 'TimezoneSelect' }, editor: 'workspace_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'calendar.working_days', IsoDow[]>({
    key: 'calendar.working_days', scope: 'workspace', module: 'settings', default: [...DEFAULT_WORKING_DAYS],
    parse: parseWorkingDays,
    widget: { kind: 'custom', component: 'WorkingDaysEditor' }, editor: 'workspace_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  defineSetting<'calendar.week_start', WeekStartDay>({
    key: 'calendar.week_start', scope: 'workspace', module: 'settings', default: 'sunday',
    parse: parseWeekStartDay,
    // 위젯 정의는 스펙 D6 의 select(일·월 둘 중 하나 — tests/settings/calendar-keys 가 고정)다. 화면은 같은 두 값을 프로젝트와 같은
    // WeekStartEditor 라디오로 그린다(CalendarSettingsPanel). 카탈로그 '편집 UI' 칸은 이 정의를 적는다 — custom 으로 바꾸려면 스펙 정오표(a6 리뷰 Q3)
    widget: { kind: 'select', options: [
      { value: 'sunday', labelKey: 'settings.calendar.week_start.sunday' }, { value: 'monday', labelKey: 'settings.calendar.week_start.monday' },
    ] },
    editor: 'workspace_admin', apply: 'immediate', impact: ['recompute'], sql: null,
  }),
  // SP5 B3(D24): 프로젝트는 생성 때 복사, 기존 프로젝트는 제품 기본값. 실시간 상속 없음.
  defineSetting<'minutes.attachments', AttachmentPolicy>({
    key: 'minutes.attachments', scope: 'workspace', module: 'minutes', default: { ...DEFAULT_ATTACHMENT_POLICY },
    parse: parseAttachmentPolicy,
    widget: { kind: 'custom', component: 'AttachmentPolicyEditor' }, editor: 'workspace_admin', apply: 'immediate', impact: ['future_only'],
    sql: { readers: ['minute_files_attachment_guard'] },
  }),
] as const satisfies readonly SettingDef[]
