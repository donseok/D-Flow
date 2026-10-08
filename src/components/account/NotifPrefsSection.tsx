'use client'

import { useState } from 'react'
import { saveNotifPrefs } from '@/app/actions/preferences'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'
import { NOTIFICATION_CATALOG, isTypeEnabled, type NotificationCategory, type NotificationType } from '@/lib/domain/inbox'

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
const CATEGORIES: readonly NotificationCategory[] = ['work', 'issue', 'meeting', 'announce', 'system']

/**
 * 개인 알림 유형 토글(SPU1, 개정 §4.10) — 계정 키 `notif`. 유형·기본값·필수 여부는 NOTIFICATION_CATALOG 가 정본이고, 켜짐 판정은 알림함과 같은
 * isTypeEnabled 다(조회 시점 필터라 끄면 이미 받은 알림도 숨는다). `required` 유형은 켜진 채 비활성이다. 누르면 그 유형만 바로 저장하고,
 * 실패하면 값을 되돌리고 알린다(성공처럼 보이지 않게). notif 가 null 이면 조회 실패 — 기본값으로 그리지 않는다.
 */
export function NotifPrefsSection({ notif }: { notif: Record<string, boolean> | null }) {
  const { t } = useLocale()
  const [prefs, setPrefs] = useState<Record<string, boolean>>(notif ?? {})
  const [saving, setSaving] = useState<ReadonlySet<NotificationType>>(new Set())
  const [failed, setFailed] = useState(false)

  async function toggle(type: NotificationType) {
    if (NOTIFICATION_CATALOG[type].required || saving.has(type)) return
    const before = isTypeEnabled(prefs, type)
    setFailed(false)
    setPrefs((p) => ({ ...p, [type]: !before }))
    setSaving((s) => new Set(s).add(type))
    let ok = false
    try { ok = (await saveNotifPrefs({ [type]: !before })).ok } catch (e) {
      console.error('[account] 알림 설정 저장 실패:', e instanceof Error ? e.message : e)
    }
    setSaving((s) => { const next = new Set(s); next.delete(type); return next })
    if (!ok) {
      setPrefs((p) => ({ ...p, [type]: before }))
      setFailed(true)
    }
  }

  return (
    <section data-account-notif className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-fg">{t('account.notif.title')}</h2>
      {notif === null ? (
        <div className="mt-3"><StatusMessage kind="partial_error" compact title={t('account.notif.loadFailed')} detail={t('account.notif.loadFailedDetail')} /></div>
      ) : (
        <>
          <p className="mt-1 text-meta text-fg-secondary">{t('account.notif.desc')}</p>
          <p data-notif-required-reason className="mt-1 text-meta text-fg-secondary">{t('account.notif.requiredReason')}</p>
          {failed && <div className="mt-3"><StatusMessage kind="partial_error" compact blocking title={t('account.notif.saveFailed')} detail={t('account.notif.saveFailedDetail')} /></div>}
          {CATEGORIES.map((category) => {
            const types = TYPES.filter((type) => NOTIFICATION_CATALOG[type].category === category)
            if (types.length === 0) return null
            return (
              <fieldset key={category} className="mt-4">
                <legend className="mb-2 text-meta font-semibold text-fg-secondary">{t(`account.notif.category.${category}`)}</legend>
                <ul className="space-y-1">
                  {types.map((type) => {
                    const required = NOTIFICATION_CATALOG[type].required
                    const on = isTypeEnabled(prefs, type)
                    const label = t(`account.notif.type.${type}`)
                    return (
                      <li key={type} className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
                        <span className="min-w-0 flex-1 text-sm text-fg">
                          {label}
                          {required && <span className="ml-2 text-meta text-fg-secondary">{t('account.notif.required')}</span>}
                        </span>
                        <button type="button" role="switch" aria-checked={on} aria-label={label} data-notif-type={type}
                          disabled={required || saving.has(type)} onClick={() => { void toggle(type) }}
                          className={`shrink-0 rounded-full px-3 py-1 text-meta font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
                          {on ? t('account.notif.on') : t('account.notif.off')}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            )
          })}
        </>
      )}
    </section>
  )
}
