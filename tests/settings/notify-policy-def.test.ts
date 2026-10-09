// 관리자 알림 정책 정의(notify.policy — 개정 §2.8.1·§4.10). 유형·필수 여부의 원천은 NOTIFICATION_CATALOG 하나다
import { describe, expect, it } from 'vitest'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { DEFAULT_NOTIFY_POLICY, NOTIFY_POLICY_DEF, disabledOnly, isNotifyTypeEnabled, parseNotifyPolicy } from '@/lib/settings/defs/notify'
import { KEY_PATTERN, settingDef } from '@/lib/settings/registry'

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
const REQUIRED = TYPES.filter((t) => NOTIFICATION_CATALOG[t].required)
const OPTIONAL = TYPES.filter((t) => !NOTIFICATION_CATALOG[t].required)

describe('notify.policy 설정 정의', () => {
  it('워크스페이스 키로 등록되고 기본값은 {} — 아무것도 끄지 않는다(지금 동작과 같다)', () => {
    expect(KEY_PATTERN.test(NOTIFY_POLICY_DEF.key)).toBe(true)
    expect(settingDef('workspace', 'notify.policy')).toBe(NOTIFY_POLICY_DEF)
    expect(settingDef('project', 'notify.policy')).toBeUndefined()
    expect(NOTIFY_POLICY_DEF).toMatchObject({ scope: 'workspace', module: 'settings', editor: 'workspace_admin', apply: 'immediate', impact: ['future_only'], sql: null })
    expect(NOTIFY_POLICY_DEF.default).toEqual({})
    expect(DEFAULT_NOTIFY_POLICY).toEqual({})
    expect(NOTIFY_POLICY_DEF.parse(NOTIFY_POLICY_DEF.default)).toEqual({ ok: true, value: {} })
    for (const type of TYPES) expect(isNotifyTypeEnabled({}, type), type).toBe(true)
  })

  it('정상 값 — 끈 유형·켠 유형을 그대로 받고 카탈로그 순서로 고른다', () => {
    expect(parseNotifyPolicy({ 'issue.update': { enabled: false }, 'work.assigned': { enabled: true } })).toEqual({
      ok: true, value: { 'work.assigned': { enabled: true }, 'issue.update': { enabled: false } },
    })
    const p = parseNotifyPolicy({ 'issue.update': { enabled: false }, 'work.assigned': { enabled: false } })
    expect(p.ok && Object.keys(p.value)).toEqual(['work.assigned', 'issue.update'])
    // 필수 유형을 "켠다"고 적는 것은 허용한다(뜻이 같다)
    expect(parseNotifyPolicy({ [REQUIRED[0]]: { enabled: true } }).ok).toBe(true)
    // 선택 유형은 전부 끌 수 있다
    expect(parseNotifyPolicy(Object.fromEntries(OPTIONAL.map((t) => [t, { enabled: false }]))).ok).toBe(true)
  })

  it('모르는 유형은 거부한다 — 프로토타입 이름도 유형이 아니다', () => {
    expect(parseNotifyPolicy({ 'issue.nope': { enabled: false } })).toEqual({ ok: false, error: '모르는 알림 유형입니다: issue.nope' })
    expect(parseNotifyPolicy({ constructor: { enabled: false } }).ok).toBe(false)
    expect(parseNotifyPolicy(JSON.parse('{"__proto__":{"enabled":false}}')).ok).toBe(false)
  })

  it('필수 유형 끄기는 거부한다 — 카탈로그의 required 전부', () => {
    expect(REQUIRED.length).toBeGreaterThan(0)
    for (const type of REQUIRED) {
      expect(parseNotifyPolicy({ [type]: { enabled: false } }), type).toEqual({ ok: false, error: `필수 알림은 끌 수 없습니다: ${type}` })
    }
  })

  it('꼴이 틀리면 거부한다 — 객체가 아닌 값·enabled 가 불리언이 아닌 항목·여분 필드', () => {
    for (const raw of [null, undefined, [], 'x', 1, true]) expect(parseNotifyPolicy(raw).ok, String(raw)).toBe(false)
    for (const entry of [false, null, [], 'off', {}, { enabled: 'no' }, { enabled: 0 }, { enabled: false, channel: 'mail' }]) {
      expect(parseNotifyPolicy({ 'issue.update': entry }).ok, JSON.stringify(entry)).toBe(false)
    }
  })

  it('isNotifyTypeEnabled — 적히지 않은 유형은 켜짐, 필수 유형은 값이 끄라고 해도 켜짐(손상 저장값 방어)', () => {
    const policy = { 'issue.update': { enabled: false }, 'work.assigned': { enabled: true } }
    expect(isNotifyTypeEnabled(policy, 'issue.update')).toBe(false)
    expect(isNotifyTypeEnabled(policy, 'work.assigned')).toBe(true)
    expect(isNotifyTypeEnabled(policy, 'issue.assigned')).toBe(true)
    expect(isNotifyTypeEnabled({ [REQUIRED[0]]: { enabled: false } }, REQUIRED[0])).toBe(true)
  })

  it('disabledOnly — 끈 유형만 카탈로그 순서로 남긴다(편집기가 보내는 꼴)', () => {
    expect(disabledOnly({ 'issue.update': { enabled: false }, 'work.assigned': { enabled: true }, 'work.claimed': { enabled: false } }))
      .toEqual({ 'work.claimed': { enabled: false }, 'issue.update': { enabled: false } })
    expect(Object.keys(disabledOnly({ 'issue.update': { enabled: false }, 'work.claimed': { enabled: false } }))).toEqual(['work.claimed', 'issue.update'])
    expect(disabledOnly({})).toEqual({})
  })
})
