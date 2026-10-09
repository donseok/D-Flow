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

/** 옮긴 문구(adminUi·settingsUi 모듈)만 한국어 글자로, 나머지 키는 키 그대로 — 예전부터 키를 단언하던 테스트를 건드리지 않는다 */
export function movedKoLocale() {
  const moved = adminUiKo as Record<string, string>
  const t = (k: string) => moved[k] ?? k
  return { useLocale: () => ({ locale: 'ko' as const, setLocale: noop, t }) }
}
