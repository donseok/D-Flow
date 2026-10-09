// 관리자 알림 정책(개정 §2.8.1·§4.10) — 예약 네임스페이스 notify.* 의 첫 키. 워크스페이스가 끈 유형은 발행하지 않는다(화면만 숨기는 것이 아니다).
// 유형·필수 여부의 정본은 NOTIFICATION_CATALOG 하나다 — 개인 토글(/account)과 같은 원천이라 목록을 여기 다시 적지 않는다.
// 소비는 src/lib/notify/policy.ts(서버 읽기) → src/lib/notify/emit.ts(발행 관문) 한 길이다.
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { defineSetting, type Parsed } from '../def'

/** 값의 꼴은 개정 §2.8.1 그대로 — 적히지 않은 유형은 켜짐이다. {} = 전부 켬 */
export type NotifyPolicy = Partial<Record<NotificationType, { enabled: boolean }>>

export const DEFAULT_NOTIFY_POLICY: NotifyPolicy = {}

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
// in 연산자는 프로토타입 속성(constructor 등)까지 유형으로 읽는다 — 자기 속성만 본다
const isType = (k: string): k is NotificationType => Object.prototype.hasOwnProperty.call(NOTIFICATION_CATALOG, k)

/** 모르는 유형·필수 유형 끄기를 거부한다(버리지 않는다 — 오타가 조용히 "켜짐"으로 저장되지 않게). 저장 순서는 카탈로그 순서로 고른다 */
export function parseNotifyPolicy(raw: unknown): Parsed<NotifyPolicy> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('알림 정책은 객체여야 합니다.')
  }
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(r)) {
    if (!isType(k)) return fail(`모르는 알림 유형입니다: ${k}`)
  }
  const value: NotifyPolicy = {}
  for (const type of TYPES) {
    if (!Object.prototype.hasOwnProperty.call(r, type)) continue
    const entry = r[type]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return fail(`${type} 은 { enabled } 객체여야 합니다.`)
    const e = entry as Record<string, unknown>
    if (typeof e.enabled !== 'boolean') return fail(`${type} 의 enabled 는 불리언이어야 합니다.`)
    if (Object.keys(e).length !== 1) return fail(`${type} 에는 enabled 만 둘 수 있습니다.`)
    if (!e.enabled && NOTIFICATION_CATALOG[type].required) return fail(`필수 알림은 끌 수 없습니다: ${type}`)
    value[type] = { enabled: e.enabled }
  }
  return { ok: true, value }
}

/** 워크스페이스가 이 유형의 발행을 허용하는가 — 필수 유형은 값과 무관하게 발행한다(저장값이 손으로 고쳐졌어도 승인 요청이 사라지지 않게) */
export function isNotifyTypeEnabled(policy: NotifyPolicy, type: NotificationType): boolean {
  if (NOTIFICATION_CATALOG[type]?.required) return true
  return policy[type]?.enabled !== false
}

/** 끈 유형만 카탈로그 순서로 — 편집기가 보내는 꼴. { enabled: true } 는 적지 않은 것과 뜻이 같아 남기지 않는다 */
export function disabledOnly(policy: NotifyPolicy): NotifyPolicy {
  const out: NotifyPolicy = {}
  for (const type of TYPES) if (!isNotifyTypeEnabled(policy, type)) out[type] = { enabled: false }
  return out
}

export const NOTIFY_POLICY_DEF = defineSetting<'notify.policy', NotifyPolicy>({
  key: 'notify.policy',
  scope: 'workspace',
  module: 'settings',
  default: { ...DEFAULT_NOTIFY_POLICY },
  parse: parseNotifyPolicy,
  widget: { kind: 'custom', component: 'NotifyPolicyEditor' },
  editor: 'workspace_admin',
  apply: 'immediate',
  // 이미 발행된 알림은 그대로 남는다 — 바꾼 뒤의 발행부터 적용(개정 §2.8.1)
  impact: ['future_only'],
  sql: null,
})
