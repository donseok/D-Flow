import { NextResponse } from 'next/server'
import { ConfigKeyError, ConfigUnavailableError, configStatus } from '@/lib/settings/errors'

/**
 * 라우트 핸들러 공용 에러 응답 — 사본 3벌 정리(issue-analysis · minutes/export · chat/v2).
 * 에러 응답은 캐시되면 안 되므로 no-store 고정.
 *
 * 에이전트 외부 API 계열(src/lib/agent/externalApi.ts 의 apiFail(status, code, error) 등)과는
 * 인자 순서가 반대지만 통합하지 않는다 — 그쪽은 계약 v2.1 이 code 문자열(unauthorized ·
 * validation_failed · insufficient_scope …)을 외부 러너와의 약속으로 못 박아 code 가 필수이고,
 * 여기 code 는 선택이다(캐시 헤더도 그쪽엔 없다). 한 시그니처로 합치면 둘 중 한쪽 계약이 깨진다.
 */
export function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json(
    { error, ...(code ? { code } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * 라우트의 설정·달력 실패 응답 한 꼴(A-4 리뷰 N5) — 클라이언트가 '설정 손상'과 '일시 장애'를 가를 수 있게 세 라우트(내보내기·보고서·
 * 이슈 분석서)가 같이 쓴다. 달력 키(calendar.*) 손상 → configStatus + code 'CALENDAR_INVALID'·key, 다른 키 손상 → 그 코드·key,
 * 설정 일시 조회 실패 → 503 고정 문구(원문은 로그). 설정 오류가 아니면 null — 호출부가 결함으로 처리한다.
 */
export function configFailureResponse(e: unknown, tag: string): NextResponse | null {
  if (e instanceof ConfigKeyError) {
    const code = e.key.startsWith('calendar.') ? 'CALENDAR_INVALID' : e.code
    return NextResponse.json({ error: e.message, code, key: e.key }, { status: configStatus(e.code), headers: { 'Cache-Control': 'no-store' } })
  }
  if (e instanceof ConfigUnavailableError) {
    console.error(`[${tag}] 프로젝트 설정 조회 실패`, e.message)
    return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  return null
}
