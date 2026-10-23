import { requestCache } from '@/lib/server/requestCache'
import type { createServerClient } from './server'

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

/**
 * 이 요청의 로그인 토큰 검증 결과(getClaims) — **요청당 한 번만** 검증한다.
 *
 * getClaims() 는 부를 때마다 세션 쿠키를 풀고(base64 → JSON), 서명 검증용 키를 가져오고, 서명을 검증한다. 한 번에 1~2ms 의 CPU 라서, 세션(getSession)·권한(getActor)·
 * 소속(listMyWorkspaces)이 각자 부르면 화면 하나가 요청 시작 지점에서 같은 검증을 세 번 직렬로 치른다(이 서버는 한 스레드다 — 그 CPU 가 다음 DB 조회를
 * 띄우기 전에 쌓였다). 같은 요청 안에서는 같은 토큰이므로 결과를 나눈다.
 * 세션 클라이언트(createServerClient)가 요청 단위로 하나이므로 그 클라이언트를 캐시 키로 쓴다 — 호출부는 이미 가진 클라이언트를 넘기면 된다
 * (이 함수가 클라이언트를 따로 만들지 않아 호출부의 createServerClient 호출 횟수를 바꾸지 않는다).
 * 검증 실패·세션 없음은 그 결과 그대로(data.claims 없음 또는 error) 돌려준다 — 호출부가 각자 자기 방식(비로그인·오류)으로 처리한다.
 */
export const getRequestClaims = requestCache(async (sb: ServerClient) => sb.auth.getClaims())
