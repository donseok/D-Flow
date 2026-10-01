import type { UiPrefs } from '@/lib/domain/types'
import { isThemePref, type ThemePref } from '@/lib/theme/policy'

/** 로컬 캐시 값(서버 UiPrefs 는 부분적일 수 있음). theme 은 **선호**다 — 고른 적 없으면 null(DOM 클래스의 해석값이 아니다, D10). */
export type LocalPrefs = {
  heroCollapsed: boolean
  sidebarCollapsed: boolean
  theme: ThemePref | null
  locale: 'ko' | 'en'
}

const KEYS: (keyof LocalPrefs)[] = ['heroCollapsed', 'sidebarCollapsed', 'theme', 'locale']

/**
 * 서버 값과 로컬 현재값을 비교해 UI에 적용할 것(apply)과 서버에 백필할 것(backfill)을 계산한다.
 * - 서버에 값 없음 → 로컬값 백필. 단 테마는 로컬 선호가 있을 때만(고른 적 없는 사용자에게 'light' 를 저장하지 않는다 — D10)
 * - 서버에 값 있고 로컬과 다름 → UI에 적용(서버가 이긴다). 형식 밖 테마 저장값은 '없음'으로 본다
 * - 같음 → 둘 다 스킵
 */
export function computePrefsSync(
  server: UiPrefs,
  local: LocalPrefs,
): { apply: Partial<LocalPrefs>; backfill: Partial<UiPrefs> } {
  const apply: Partial<LocalPrefs> = {}
  const backfill: Partial<UiPrefs> = {}
  for (const k of KEYS) {
    if (k === 'theme') {
      const sv = isThemePref(server.theme) ? server.theme : null
      if (sv === null) { if (local.theme !== null) backfill.theme = local.theme }
      else if (sv !== local.theme) apply.theme = sv
      continue
    }
    const sv = server[k]
    if (sv === undefined || sv === null) {
      ;(backfill as Record<string, unknown>)[k] = local[k]
    } else if (sv !== local[k]) {
      ;(apply as Record<string, unknown>)[k] = sv
    }
  }
  return { apply, backfill }
}
