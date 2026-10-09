// 서버 전용 사전 — 서버가 만들어 화면에 그대로 보이는 문구(서버 액션·내부 API·lib 고정 문구)의 ko·en.
// 왜 공용 사전(dict/ko.ts·en.ts)에 넣지 않나: ko.ts 는 클라이언트 공통 청크에 정적으로 실린다(dict.ts 머리 주석 — 2026-08-18 성능 감사).
// 이 문구는 서버만 읽으므로 거기 실으면 모든 페이지의 First Load JS 가 늘 뿐이다(실측 약 +20kB). 그래서 서버 번들에만 둔다.
// 클라이언트 코드는 이 모듈을 값으로 import 하지 않는다(타입 import 는 지워지므로 괜찮다) — tests/invariants/i18n-server-messages.test.ts 가 고정한다.
import 'server-only'
import { registerEn, t, type DictKey, type Locale } from './dict'
import { EN } from './dict/en'
import { serverUiKo } from './dict/serverUi'
import { serverUiEn } from './dict/serverUi.en'

// 서버 번들에서는 공용 EN 도 항상 완전하다(server.ts 와 같은 등록 — 이 모듈만 불러도 영어가 한국어로 떨어지지 않게)
registerEn(EN)

export const SERVER_KO = serverUiKo
export const SERVER_EN: Record<keyof typeof serverUiKo, string> = serverUiEn

/** 서버 번역 함수가 받는 키 — 공용 사전 키 + 서버 전용 키. 클라이언트의 DictKey 에는 서버 키가 없다 */
export type ServerDictKey = DictKey | keyof typeof SERVER_KO
/** 서버 번역 함수. 공용 키만 받는 자리(lib 의 `t: Translate`)에도 그대로 넘길 수 있다(더 넓은 키를 받는다) */
export type ServerTranslate = (key: ServerDictKey) => string

/** 서버 사전 → 공용 사전 순으로 찾는다 */
export function serverT(locale: Locale, key: ServerDictKey): string {
  if (Object.hasOwn(SERVER_KO, key)) {
    const k = key as keyof typeof SERVER_KO
    return (locale === 'en' ? SERVER_EN[k] : undefined) ?? SERVER_KO[k]
  }
  return t(locale, key as DictKey)
}

/** 로캘을 묶은 서버 번역 함수 */
export const serverTranslatorFor = (locale: Locale): ServerTranslate => (key) => serverT(locale, key)
/** 한국어 고정 — 요청 범위 밖(워커·단위 테스트)의 폴백. 서버 키도 한국어 문구로 푼다(키가 그대로 새지 않는다) */
export const serverKoTranslate: ServerTranslate = (key) => serverT('ko', key)
