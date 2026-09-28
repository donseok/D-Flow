// src/components/settings/ConfigLoadError.tsx — 설정을 읽지 못한 화면의 상태(스펙 §3.5). 기본값으로 그리지 않는다.
import { AlertTriangle } from 'lucide-react'
import { t, type Locale } from '@/lib/i18n/dict'

export function ConfigLoadError({ error, keyName = null, locale }: { error: string; keyName?: string | null; locale: Locale }) {
  return (
    <div role="alert" data-config-load-error className="rounded-xl border border-delayed/30 bg-delayed-weak/40 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-delayed"><AlertTriangle className="h-4 w-4" />{t(locale, 'settings.configLoadFailed')}</p>
      {keyName && <p className="mt-1 text-ink-muted">{t(locale, 'settings.configLoadFailedKey').replace('{key}', keyName)}</p>}
      <p className="mt-1 text-xs text-ink-subtle">{error}</p>
    </div>
  )
}
