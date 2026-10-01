'use client'

import { useRef, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { THEME_PREFS, THEME_UNSET_DEFAULT, type ThemePref } from '@/lib/theme/policy'
import type { DictKey } from '@/lib/i18n/dict'
import { rovingRadioIndex } from './rovingRadio'

const LABEL: Record<ThemePref, DictKey> = { system: 'chrome.themeSystem', light: 'chrome.themeLight', dark: 'chrome.themeDark' }

/**
 * 화면 테마 3단(사용자 결정 #21, SP3b 스펙 §4.2, 계획 판정 Q23) — 계정 팝오버·/account·UI-2b 의 AccountMenu 가 함께 쓴다.
 * 선호는 클라이언트에만 있어 첫 렌더는 선택 없음 + aria-busy 다(하이드레이션 불일치 없음 — D10). ready 뒤에는 선호를,
 * 미설정이면 THEME_UNSET_DEFAULT 를 선택으로 보인다(저장하지 않는다). 네이티브 radio 대신 APG 라디오 패턴 —
 * roving tabIndex, 방향키·Home·End 로 이동과 동시에 선택한다.
 */
export function ThemeRadioGroup({ compact = false }: { compact?: boolean }) {
  const { preference, ready, setPreference } = useTheme()
  const { t } = useLocale()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const shown: ThemePref | null = ready ? (preference ?? THEME_UNSET_DEFAULT) : null
  const focusIndex = shown ? THEME_PREFS.indexOf(shown) : 0

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingRadioIndex(e.key, i, THEME_PREFS.length)
    if (next === null) return
    e.preventDefault()
    setPreference(THEME_PREFS[next])
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('chrome.theme')}
      aria-busy={ready ? undefined : true}
      className={`grid grid-cols-3 gap-1 rounded-(--radius-control) border border-border bg-surface-subtle p-1 ${compact ? '' : 'max-w-sm'}`}
    >
      {THEME_PREFS.map((p, i) => {
        const on = shown === p
        return (
          <button
            key={p}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === focusIndex ? 0 : -1}
            data-theme-option={p}
            onClick={() => setPreference(p)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-(--radius-control) px-2 text-xs font-medium transition-colors duration-(--motion-fast) ${on ? 'bg-surface-selected text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}
          >
            <Check className={`h-3.5 w-3.5 ${on ? '' : 'invisible'}`} aria-hidden />
            {t(LABEL[p])}
          </button>
        )
      })}
    </div>
  )
}
