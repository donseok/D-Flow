'use client'
/**
 * 회의록 화면 안 링크(D38 ①, 계획 과제 35) — 범위 컨텍스트(useScope, SSR 에도 값)의 슬러그로 /w/<s>/minutes[/<id>].
 * 범위가 없을 때(셸 밖·테스트)만 옛 형식이다 — 스텁이 행의 워크스페이스로 보낸다(D5·D6). 옛 형식 리터럴은 이 파일 하나에 둔다.
 */
import { useScope } from '@/components/app/ScopeContext'
import { wsHref, wsMinuteHref } from '@/lib/workspace/paths'

export function useMinuteLinks(): { list: string; minute: (id: string) => string } {
  const slug = useScope()?.workspace?.slug ?? null
  return slug
    ? { list: wsHref(slug, 'minutes'), minute: (id) => wsMinuteHref(slug, id) }
    : { list: '/minutes', minute: (id) => `/minutes/${id}` }
}
