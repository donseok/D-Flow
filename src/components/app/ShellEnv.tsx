'use client'
// (app)/layout 이 내리는 셸 환경 — STAGING 표식(env 판독은 (app)/layout 에 남는다 — C 의 operational-env owner)과 계정 선호의 사이드바 접힘(D55)
import { createContext, useContext } from 'react'
import type { SidebarCollapsed } from './sidebarState'

export type ShellEnv = { staging: boolean; sidebarCollapsed: SidebarCollapsed }
const Ctx = createContext<ShellEnv>({ staging: false, sidebarCollapsed: null })
export function ShellEnvProvider({ value, children }: { value: ShellEnv; children: React.ReactNode }) { return <Ctx.Provider value={value}>{children}</Ctx.Provider> }
export function useShellEnv(): ShellEnv { return useContext(Ctx) }
