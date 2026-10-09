import { cookies } from 'next/headers'
import { registerEn, type Locale } from './dict'
import { serverKoTranslate, serverTranslatorFor, type ServerTranslate } from './serverDict'
import { EN } from './dict/en'

// 서버 번들에서만 EN 을 정적 등록 — 서버 렌더의 t() 는 항상 완전한 en 을 본다.
// (next/headers 의존이라 이 모듈은 클라이언트 청크에 들어갈 수 없다 = 분리 안전.)
registerEn(EN)

/**
 * 서버 컴포넌트/서버 액션에서 현재 locale을 읽는다.
 * LocaleProvider가 언어 토글 시 dflow-locale 쿠키를 기록하고 router.refresh()로
 * 서버 렌더 본문을 재요청하므로, 이 값은 클라이언트 토글과 항상 동기화된다.
 */
export async function getServerLocale(): Promise<Locale> {
  const v = (await cookies()).get('dflow-locale')?.value
  return v === 'en' ? 'en' : 'ko'
}

/**
 * 서버 로더·액션이 화면에 그대로 보이는 문구(착수 대기 사유 등)를 만들 때 넘기는 번역 함수 — 요청의 화면 언어를 따른다.
 * 요청 범위 밖(작업자·단위 테스트 — cookies() 가 던진다)에서는 한국어다: 저장되는 글자와 같은 기본값이고, 화면 언어를 알 수 없는 자리다.
 */
export async function serverTranslator(): Promise<ServerTranslate> {
  try {
    return serverTranslatorFor(await getServerLocale())
  } catch {
    return serverKoTranslate
  }
}
