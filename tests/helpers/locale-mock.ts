// LocaleProvider 대역 — 화면 문구를 사전으로 옮긴 뒤에도 테스트가 한국어 글자를 그대로 단언할 수 있게 한다.
// 공급자 없는 기본 t 와 `t: k => k` 대역은 키를 돌려주므로, 옮긴 문구를 글자로 보는 테스트는 이 대역을 쓴다:
//   vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { t as translate, type DictKey } from '@/lib/i18n/dict'
import { adminUiKo } from '@/lib/i18n/dict/adminUi'

const noop = () => {}

/** 사전 전체를 한국어로 — 화면이 실제로 보이는 글자 그대로 */
export function koLocale() {
  const t = (k: DictKey) => translate('ko', k)
  return { useLocale: () => ({ locale: 'ko' as const, setLocale: noop, t }) }
}

/** 옮긴 문구(adminUi 가 싣는 모듈 — 설정·셸·관리·lib 라벨)만 한국어 글자로, 나머지 키는 키 그대로 — 예전부터 키를 단언하던 테스트를 건드리지 않는다.
 *  also: 옮기면서 재사용한 기존 키(그 테스트가 한국어 글자로 단언하는 것)도 한국어로 푼다. fallback: 나머지 키의 꼴(기본은 키 그대로) */
export function movedKoLocale(opts: { also?: readonly DictKey[]; fallback?: (k: string) => string } = {}) {
  const moved = adminUiKo as Record<string, string>
  const also = new Set<string>(opts.also ?? [])
  const rest = opts.fallback ?? ((k: string) => k)
  const t = (k: string) => moved[k] ?? (also.has(k) ? translate('ko', k as DictKey) : rest(k))
  return { useLocale: () => ({ locale: 'ko' as const, setLocale: noop, t }) }
}
