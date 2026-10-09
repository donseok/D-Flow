'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import { useLocale } from '@/components/providers/LocaleProvider'
import { NOTIFICATION_CATALOG, type NotificationCategory, type NotificationType } from '@/lib/domain/inbox'
import { DEFAULT_NOTIFY_POLICY, disabledOnly, isNotifyTypeEnabled, parseNotifyPolicy, type NotifyPolicy } from '@/lib/settings/defs/notify'

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
const CATEGORIES: readonly NotificationCategory[] = ['work', 'issue', 'meeting', 'announce', 'system']
// 초안·기준·최신 값을 모두 "끈 유형만" 꼴로 맞춘다 — { enabled: true } 가 섞인 저장값과 같은 뜻의 초안이 '바뀜'으로 보이지 않게
const fromLatest = (v: unknown) => { const p = parseNotifyPolicy(v ?? DEFAULT_NOTIFY_POLICY); return p.ok ? disabledOnly(p.value) : null }

/**
 * 관리자 알림 정책(notify.policy — 개정 §4.10·§2.8.1) — 유형마다 발행 스위치 하나. 끈 유형은 이 워크스페이스에서 발행되지 않는다(emit 관문).
 * 유형·범주·필수 여부는 개인 토글(/account NotifPrefsSection)과 같은 원천(NOTIFICATION_CATALOG)이다. 범주 이름도 같은 사전(account.notif.category.*)이지만
 * 유형 이름은 정책용(settings.notify.policy.type.*)을 쓴다 — 개인 토글 문구는 받는 사람 시점("나에게 배정됨")이라 발행을 정하는 화면에 맞지 않는다.
 * `required` 유형은 켜진 채 비활성 — 서버 parse 도 거부한다. 저장 규약은 useSettingItemCommand(expectedRevision CAS·409 비교·결과 불명 재확인).
 */
export function NotifyPolicyEditor({ workspaceId, revision, initial, invalidReason }: {
  workspaceId: string; revision: number; initial: NotifyPolicy | null; invalidReason?: string
}) {
  const { t, locale } = useLocale()
  const c = useSettingItemCommand<NotifyPolicy>({
    scope: { workspaceId }, key: 'notify.policy', revision, initial: initial && disabledOnly(initial), empty: { ...DEFAULT_NOTIFY_POLICY }, fromLatest,
  })
  const off = c.pending || c.uncertain
  const label = (type: NotificationType) => t(`settings.notify.policy.type.${type}`)
  const toggle = (type: NotificationType) => {
    if (NOTIFICATION_CATALOG[type].required) return
    const next: NotifyPolicy = { ...c.draft }
    if (isNotifyTypeEnabled(c.draft, type)) next[type] = { enabled: false }
    else delete next[type]
    c.setDraft(disabledOnly(next))
  }
  const summary = (v: NotifyPolicy) => {
    const offTypes = TYPES.filter((type) => !isNotifyTypeEnabled(v, type))
    return offTypes.length === 0 ? t('settings.notify.policy.allOn') : `${t('settings.notify.policy.offList')} ${offTypes.map(label).join(', ')}`
  }
  return <div className="space-y-4">
    <p data-notify-required-reason className="text-meta text-fg-secondary">{t('settings.notify.policy.requiredReason')}</p>
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" locale={locale} keyName="notify.policy" message={invalidReason} isAdmin settingsHref="#workspace-notify" />}
    {CATEGORIES.map((category) => {
      const types = TYPES.filter((type) => NOTIFICATION_CATALOG[type].category === category)
      if (types.length === 0) return null
      return <fieldset key={category}>
        <legend className="mb-2 text-meta font-semibold text-fg-secondary">{t(`account.notif.category.${category}`)}</legend>
        <ul className="space-y-1">
          {types.map((type) => {
            const required = NOTIFICATION_CATALOG[type].required
            const on = isNotifyTypeEnabled(c.draft, type)
            return <li key={type} className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
              <span className="min-w-0 flex-1 text-sm text-fg">
                {label(type)}
                {required && <span className="ml-2 text-meta text-fg-secondary">{t('account.notif.required')}</span>}
              </span>
              <button type="button" role="switch" aria-checked={on} aria-label={label(type)} data-notify-type={type}
                disabled={required || off} onClick={() => toggle(type)}
                className={`shrink-0 rounded-full px-3 py-1 text-meta font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
                {on ? t('account.notif.on') : t('account.notif.off')}
              </button>
            </li>
          })}
        </ul>
      </fieldset>
    })}
    <p className="text-meta text-fg-secondary">{t('settings.notify.policy.personalNote')}</p>
    {c.fieldError && <ConfigStateNotice kind="field" locale={locale} message={c.fieldError} />}
    {c.conflict && <ConflictCompare rows={[{ key: 'notify.policy', label: t('settings.notify.policy.label'), mine: summary(c.draft), latest: c.conflict.value ? summary(c.conflict.value) : t('settings.notify.policy.corrupted') }]}
      onMine={c.keepMine} onLatest={c.useLatest} latestAvailable={!!c.conflict.value} />}
    {c.error && <ConfigStateNotice kind="patch" locale={locale} message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" data-notify-save disabled={c.pending || (!c.dirty && !c.uncertain) || !!c.conflict} onClick={c.save}>
        {c.uncertain ? t('settings.notify.policy.saveRetry') : t('settings.notify.policy.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
