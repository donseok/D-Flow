import type { Locale } from './dict'
import { serverKoTranslate, type ServerTranslate } from './serverDict'

/**
 * 서버 컴포넌트/서버 액션의 화면 언어 — 제품이 한국어 전용이라 항상 'ko' 다(쿠키를 읽지 않는다).
 * async 시그니처는 호출부(`await getServerLocale()`)를 건드리지 않으려고 남겼다.
 */
export async function getServerLocale(): Promise<Locale> {
  return 'ko'
}

/**
 * 서버 로더·액션이 화면에 그대로 보이는 문구(착수 대기 사유 등)를 만들 때 넘기는 번역 함수 — 서버 사전 → 공용 사전 순으로 한국어 문구를 꺼낸다.
 * async 시그니처는 호출부를 건드리지 않으려고 남겼다.
 */
export async function serverTranslator(): Promise<ServerTranslate> {
  return serverKoTranslate
}
