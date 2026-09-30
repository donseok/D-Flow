import { AlertTriangle } from 'lucide-react'
import { t, type Locale } from '@/lib/i18n/dict'
import { CONFIG_MESSAGES } from '@/lib/settings/errors'

type NoticeKind = 'unavailable' | 'invalid' | 'required' | 'field' | 'patch'

/** 설정 상태를 표시하는 공통 자리. 업무 기능은 오류를 기본값으로 바꾸지 않는다. */
export function ConfigStateNotice({ kind, locale, keyName, message, settingsHref, isAdmin = false }: {
  kind: NoticeKind; locale: Locale; keyName?: string | null; message?: string
  settingsHref?: string; isAdmin?: boolean
}) {
  const ko = locale === 'ko'
  const title = kind === 'unavailable' ? t(locale, 'settings.configLoadFailed')
    : kind === 'required' ? (ko ? '필요한 설정이 없습니다.' : 'A required setting is missing.')
      : kind === 'invalid' ? (ko ? '설정이 손상되었습니다.' : 'A setting is invalid.')
        : kind === 'field' ? (ko ? '입력값을 확인하세요.' : 'Check this value.')
          : (ko ? '설정을 저장하지 못했습니다.' : 'Settings could not be saved.')
  const detail = kind === 'unavailable' ? (ko ? CONFIG_MESSAGES.CONFIG_UNAVAILABLE : 'The settings could not be loaded.') : message
  return <div role="alert" data-config-state={kind} {...(kind === 'unavailable' ? { 'data-config-load-error': true } : {})}
    className="rounded-xl border border-delayed/30 bg-delayed-weak/40 p-4 text-sm">
    <p className="flex items-center gap-1.5 font-semibold text-delayed"><AlertTriangle className="h-4 w-4 shrink-0" />{title}</p>
    {keyName && <p className="mt-1 text-ink-muted">{t(locale, 'settings.configLoadFailedKey').replace('{key}', keyName)}</p>}
    {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    {(kind === 'invalid' || kind === 'required') && <p className="mt-1 text-xs text-ink-muted">
      {isAdmin && settingsHref ? <a href={settingsHref} className="font-semibold text-brand underline">{ko ? '설정에서 복구하기' : 'Open settings'}</a>
        : ko ? '관리자에게 문의하세요.' : 'Contact an administrator.'}
    </p>}
  </div>
}
