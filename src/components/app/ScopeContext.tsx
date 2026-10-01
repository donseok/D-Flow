'use client'
// 범위의 동기 컨텍스트(D38 ①) — 범위 레이아웃이 자기 자식을 감싼다. 화면 안 링크·wsHref 를 쓰는 클라이언트 컴포넌트는 이것만 읽는다(SSR 에도 값).
import { createContext, useContext } from 'react'
import type { WorkspaceRef } from '@/lib/workspace/constants'

export interface ScopeValue { workspace: WorkspaceRef | null; projectId: string | null }
const Ctx = createContext<ScopeValue | null>(null)
export function ScopeProvider({ value, children }: { value: ScopeValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useScope(): ScopeValue | null { return useContext(Ctx) }
