'use client'
/**
 * 범위의 게시 저장소(D38 ②) — 범위 레이아웃이 그리는 <ShellScope> 가 효과로 { workspace, projectId, projects } 를 (app) 수준 저장소에 게시한다.
 * 범위 레이아웃 **위**의 소비처(AssistantChat·ShellStateProvider·BotPageContextProvider·UsageTracker)만 읽고, 첫 게시 전 null 은 '범위 없음'이다.
 * 현재 워크스페이스 쿠키(dflow-ws)를 쓰는 곳은 여기 하나다(D3) — 값이 다를 때만. 쿠키는 보안 경계가 아니다(읽는 쪽이 소속을 다시 본다).
 * 프로젝트 범위에 들어오면 최근 방문 앞에 넣는다(그 프로젝트의 워크스페이스 행 — §5.4.3).
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { queueWorkspacePref } from '@/lib/prefs/debouncedSave'
import { pushRecent } from '@/lib/prefs/split'
import { SLUG_RE, WS_COOKIE, type WorkspaceRef } from '@/lib/workspace/constants'

export interface ShellScopeState { workspace: WorkspaceRef | null; projectId: string | null; projects: { id: string; name: string }[] }
const Store = createContext<{ state: ShellScopeState | null; publish: (s: ShellScopeState) => void } | null>(null)

export function ShellScopeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShellScopeState | null>(null)
  const value = useMemo(() => ({ state, publish: setState }), [state])
  return <Store.Provider value={value}>{children}</Store.Provider>
}
export function useShellScope(): ShellScopeState | null { return useContext(Store)?.state ?? null }

function readCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function ShellScope({ workspace, projectId, projects, recent }: ShellScopeState & { recent?: { id: string; at: string }[] }) {
  const store = useContext(Store)
  const publish = store?.publish
  const projectsKey = projects.map((p) => `${p.id}:${p.name}`).join(',')
  useEffect(() => {
    publish?.({ workspace, projectId, projects })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 게시는 범위가 바뀔 때만(목록은 id·이름 열로 비교)
  }, [publish, workspace?.id, workspace?.slug, workspace?.name, projectId, projectsKey])
  useEffect(() => {
    if (!workspace || !SLUG_RE.test(workspace.slug)) return
    if (readCookie(WS_COOKIE) === workspace.slug) return
    document.cookie = `${WS_COOKIE}=${workspace.slug}; path=/; max-age=31536000; samesite=lax`
  }, [workspace])
  useEffect(() => {
    if (!workspace || !projectId) return
    queueWorkspacePref(workspace.id, { recentProjects: pushRecent(recent, projectId, new Date().toISOString()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입할 때 한 번(같은 프로젝트 안 이동은 다시 쓰지 않는다)
  }, [workspace?.id, projectId])
  return null
}
