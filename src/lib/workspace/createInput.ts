// 워크스페이스 생성 입력의 순수 검증(개정 §2.2 — 허용 모듈의 첫 값은 플랫폼 관리자가 고른다, §4.2.6 — 새 워크스페이스의 시간대는 생성 폼 값).
// 서버 액션(createPlatformWorkspace)과 생성 폼이 같은 함수를 쓴다 — 화면이 먼저 걸러도 판정은 서버가 다시 한다.
// 규칙은 scripts/dev-bootstrap.mjs 와 같다: slug 는 DB check 와 같은 식(SLUG_RE), 허용 모듈은 비core 목록 안(모르는 id 는 조용히 버리지 않고 거부),
// 시간대는 줬을 때만 쓴다(비우면 제품 기본값 — 설정 화면이 브라우저 시간대를 제안한다). 예약어 목록은 없다(경로가 /w/<slug> 라 다른 경로와 겹치지 않는다).
import { canonicalEmail } from '@/lib/domain/email'
import { parseTimezone } from '@/lib/domain/calendar'
import { NON_CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import { SLUG_RE } from './constants'

export const WORKSPACE_NAME_MAX = 80
export type WorkspaceCreateField = 'name' | 'slug' | 'adminEmail' | 'modules' | 'timezone'
/** 입력 검증의 거부 사유 — 문구는 사전(platform.ws.err.<code>)이 갖는다 */
export type WorkspaceCreateInputCode = 'input_invalid' | 'name_required' | 'name_too_long' | 'slug_invalid' | 'email_invalid' | 'modules_invalid' | 'timezone_invalid'
export interface WorkspaceCreateValue {
  name: string
  slug: string
  /** null = 만드는 플랫폼 관리자 자신 */
  adminEmail: string | null
  modules: ModuleId[]
  /** null = 쓰지 않는다(제품 기본값) */
  timezone: string | null
}
export type WorkspaceCreateCheck =
  | { ok: true; value: WorkspaceCreateValue }
  | { ok: false; code: WorkspaceCreateInputCode; field: WorkspaceCreateField | null }

const bad = (code: WorkspaceCreateInputCode, field: WorkspaceCreateField | null): WorkspaceCreateCheck => ({ ok: false, code, field })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** modules 를 생략하면 비core 전부(dev-bootstrap 의 기본값과 같다), 빈 배열은 core 만. 순서는 레지스트리 순으로 정규화한다 */
export function checkWorkspaceCreate(raw: unknown): WorkspaceCreateCheck {
  if (!isRecord(raw)) return bad('input_invalid', null)
  if (typeof raw.name !== 'string') return bad('name_required', 'name')
  const name = raw.name.trim()
  if (!name) return bad('name_required', 'name')
  if (name.length > WORKSPACE_NAME_MAX || /[\r\n\t]/.test(name)) return bad('name_too_long', 'name')
  // slug 는 다듬지 않는다 — 대문자·공백을 조용히 고치면 사용자가 적은 주소와 만들어진 주소가 달라진다
  if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) return bad('slug_invalid', 'slug')

  let adminEmail: string | null = null
  if (raw.adminEmail !== undefined && raw.adminEmail !== null && raw.adminEmail !== '') {
    if (typeof raw.adminEmail !== 'string') return bad('email_invalid', 'adminEmail')
    if (raw.adminEmail.trim()) {
      adminEmail = canonicalEmail(raw.adminEmail)
      if (!adminEmail) return bad('email_invalid', 'adminEmail')
    }
  }

  let modules: ModuleId[] = [...NON_CORE_MODULES]
  if (raw.modules !== undefined) {
    if (!Array.isArray(raw.modules) || raw.modules.some((m) => typeof m !== 'string' || !(NON_CORE_MODULES as readonly string[]).includes(m))) {
      return bad('modules_invalid', 'modules')
    }
    const picked = new Set(raw.modules as string[])
    modules = NON_CORE_MODULES.filter((m) => picked.has(m))
  }

  let timezone: string | null = null
  if (raw.timezone !== undefined && raw.timezone !== null && raw.timezone !== '') {
    const tz = parseTimezone(raw.timezone)
    if (!tz.ok) return bad('timezone_invalid', 'timezone')
    timezone = tz.value
  }
  return { ok: true, value: { name, slug: raw.slug, adminEmail, modules, timezone } }
}
