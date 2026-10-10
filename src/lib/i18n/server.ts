import { serverKoTranslate, type ServerTranslate } from './serverDict'

/**
 * 서버 로더·액션이 화면에 그대로 보이는 문구(착수 대기 사유 등)를 만들 때 넘기는 번역 함수 — 서버 사전 → 공용 사전 순으로 한국어 문구를 꺼낸다.
 * async 시그니처는 호출부를 건드리지 않으려고 남겼다.
 */
export async function serverTranslator(): Promise<ServerTranslate> {
  return serverKoTranslate
}
