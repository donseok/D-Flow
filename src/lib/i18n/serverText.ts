// lib 가 만든 고정 문구를 요청의 화면 언어로 푸는 서버 전용 도우미(i18n 3차).
// lib 의 문구 상수는 한국어 그대로 둔다 — 코드로 비교되고(가드·테스트), 워커·저장 경로는 화면 언어를 모른다.
// 서버 사전(serverDict.ts)의 `srv.lib.*`·`err.config.*` 키는 그 문구를 ko 값으로 그대로 실은 것이라, ko 값 → 키를 거꾸로 찾아 요청의 언어로 바꾼다
// (화면이 문구로 키를 찾는 src/lib/wbs/actionErrors.ts 와 같은 꼴 — 표를 lib 모듈마다 두지 않고 사전에서 얻는다).
// 표에 없는 문구(동적 문구·DB 원문·가드 결과)는 받은 그대로다. lib 문구를 고치면 사전의 ko 값도 같이 고친다 —
// tests/invariants/i18n-server-messages.test.ts 가 사전의 문구가 lib 원문에 그대로 있는지 본다.
import 'server-only'
import { SERVER_KO, type ServerDictKey, type ServerTranslate } from './serverDict'

const REVERSE: ReadonlyMap<string, ServerDictKey> = new Map(
  (Object.entries(SERVER_KO) as [ServerDictKey, string][])
    .filter(([key]) => key.startsWith('srv.lib.') || key.startsWith('err.config.'))
    .map(([key, text]) => [text, key]),
)

/** lib 고정 문구 → 요청의 화면 언어. 표에 없으면 받은 값 그대로(없는 값도 그대로 돌려준다) */
export function libText<M extends string | null | undefined>(t: ServerTranslate, message: M): M | string {
  const key = typeof message === 'string' ? REVERSE.get(message) : undefined
  return key ? t(key) : message
}
