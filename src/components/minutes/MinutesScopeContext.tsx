'use client'
// 회의록 화면 안의 모달·탐색기가 액션에 넘길 범위(계획 V13). 페이지가 서버에서 정해 내린다 — UI-2b 의 useScope() 와 별개(회의록 화면 전용, ?project= 포함)
import { createContext, useContext } from 'react'
import type { MinutesScope } from '@/lib/minutes/scope'

const Ctx = createContext<MinutesScope | null>(null)
export function MinutesScopeProvider({ scope, children }: { scope: MinutesScope; children: React.ReactNode }) {
  return <Ctx.Provider value={scope}>{children}</Ctx.Provider>
}
/** 범위가 없으면 null — 호출부는 액션을 부르지 않고 사유를 보인다(추측하지 않는다) */
export function useMinutesScope(): MinutesScope | null { return useContext(Ctx) }
