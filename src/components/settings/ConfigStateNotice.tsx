import { t, type Locale } from '@/lib/i18n/dict'
import { CONFIG_MESSAGES } from '@/lib/settings/errors'
import { StatusMessage, type StatusKind } from '@/components/ui/StatusMessage'

export type NoticeKind = 'unavailable' | 'invalid' | 'required' | 'field' | 'patch' | 'disabled'
/** 설정 상태 → 표준 상태(SP3b 스펙 §6.4, W18). 조회 실패·손상 = 부분 오류, 필요 설정 없음 = 설정 필요, 비활성 모듈 = 꺼짐, 패치 거부·필드 = 막는 오류 */
export const NOTICE_STATUS: Readonly<Record<NoticeKind, StatusKind>> = {
  unavailable: 'partial_error', invalid: 'partial_error', required: 'needs_setup', disabled: 'disabled', field: 'partial_error', patch: 'partial_error',
}
// required는 본문을 대체하는 호출도 있지만 의미는 설정 필요(status). 막는 조회/입력 오류와 구분한다(U3-3 P2-3).
const BLOCKING: ReadonlySet<NoticeKind> = new Set(['unavailable', 'invalid', 'field', 'patch'])
const RECOVERABLE: ReadonlySet<NoticeKind> = new Set(['invalid', 'required', 'disabled'])

/** 설정 상태를 표시하는 공통 자리. 업무 기능은 오류를 기본값으로 바꾸지 않는다. 이름·호출부·루트 표지는 C 그대로다 */
export function ConfigStateNotice({ kind, locale, keyName, message, settingsHref, isAdmin = false, compact = false }: {
  kind: NoticeKind; locale: Locale; keyName?: string | null; message?: string
  settingsHref?: string; isAdmin?: boolean; compact?: boolean
}) {
  const ko = locale === 'ko'
  const title = kind === 'unavailable' ? t(locale, 'settings.configLoadFailed')
    : kind === 'required' ? t(locale, 'settings.state.required')
      : kind === 'invalid' ? t(locale, 'settings.state.invalid')
        : kind === 'disabled' ? t(locale, 'settings.state.disabled')
          : kind === 'field' ? t(locale, 'settings.state.field')
            : t(locale, 'settings.state.patch')
  const detailText = kind === 'unavailable' ? (ko ? CONFIG_MESSAGES.CONFIG_UNAVAILABLE : 'The settings could not be loaded.') : message
  const canRecover = RECOVERABLE.has(kind) && isAdmin && !!settingsHref
  const askAdmin = RECOVERABLE.has(kind) && !canRecover
  const detail = (keyName || detailText || askAdmin) ? <>
    {keyName && <span className="block">{t(locale, 'settings.configLoadFailedKey').replace('{key}', keyName)}</span>}
    {detailText && <span className="block">{detailText}</span>}
    {askAdmin && <span className="block">{t(locale, 'settings.state.askAdmin')}</span>}
  </> : undefined
  const action = canRecover
    ? { label: kind === 'disabled' ? t(locale, 'settings.state.turnOn') : t(locale, 'settings.state.recover'), href: settingsHref! }
    : undefined
  return <div data-config-state={kind} {...(kind === 'unavailable' ? { 'data-config-load-error': true } : {})}>
    <StatusMessage kind={NOTICE_STATUS[kind]} title={title} detail={detail} action={action} compact={compact || kind === 'field'} blocking={BLOCKING.has(kind)} />
  </div>
}
