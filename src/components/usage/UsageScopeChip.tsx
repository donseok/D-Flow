import { t, type Locale } from '@/lib/i18n/dict'

/** 사용 현황의 범위 표시(D21, SP8) — 워크스페이스 스코프 */
export function UsageScopeChip({ workspaceName, locale = 'ko' }: { workspaceName?: string; locale?: Locale } = {}) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-3 py-1 text-meta font-semibold text-fg-secondary">
      {workspaceName ? t(locale, 'usage.scope.named').replace('{name}', () => workspaceName) : t(locale, 'usage.scope.this')}
    </span>
  )
}
