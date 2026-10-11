'use client'
import { useEffect, useState } from 'react'

/** 응답 뒤 화면을 깨우는 시점(ms) — 받은 트리를 다 그렸을 무렵 한 번, 느린 화면을 위해 두 번 더 */
const WAKE_AT = [120, 450, 1200] as const

/**
 * 저장 뒤 화면이 옛 값에 머무는 것을 막는다(2026-10-11 사용자 테스트 — 설정·개요에서 "저장했습니다"가 뜨고도 새로고침해야 값이 바뀌었다).
 *
 * 프로덕션 빌드에서 서버가 돌려준 새 화면(서버 액션 응답·router.refresh)이 다 그려진 뒤에도 반영(commit)되지 않고 멈춰 있다가,
 * 화면 어디서든 다음 상태 변경이 일어나야 따라 반영됐다(실측: 응답은 0.1초 안에 오는데 화면은 토스트가 닫히는 3.5초 뒤에 바뀜.
 * 개발 서버·느린 네트워크에서는 다른 상태 변경이 끼어들어 드러나지 않는다). 리액트는 새 상태 변경이 들어오면 멈춘 전환을 다시 시도한다.
 * 그래서 서버 컴포넌트 응답이 올 때마다 아무것도 그리지 않는 이 컴포넌트의 상태를 한 번 바꿔 준다 — 화면 내용에는 손대지 않는다.
 * 요청·응답은 그대로 통과시키고 지켜보기만 한다.
 */
export function RefreshFlush() {
  const [, wake] = useState(0)
  useEffect(() => {
    const original = window.fetch
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const isRscRequest = (input: RequestInfo | URL, init?: RequestInit): boolean => {
      try {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        return headers.has('next-action') || headers.has('rsc')
      } catch { return false }
    }
    const patched: typeof window.fetch = (input, init) => {
      const pending = original(input, init)
      if (isRscRequest(input, init)) {
        void pending.then(() => {
          for (const ms of WAKE_AT) {
            const id = setTimeout(() => { timers.delete(id); wake(n => n + 1) }, ms)
            timers.add(id)
          }
        }, () => {})
      }
      return pending
    }
    window.fetch = patched
    return () => {
      if (window.fetch === patched) window.fetch = original
      timers.forEach(clearTimeout)
    }
  }, [])
  return null
}
