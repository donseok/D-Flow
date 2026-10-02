'use client'
/**
 * 범위의 게시 저장소(D38 ②) — 범위 레이아웃이 그리는 <ShellScope> 가 효과로 { workspace, projectId, projects } 를 (app) 수준 저장소에 게시한다.
 * 범위 레이아웃 **위**의 소비처(AssistantChat·ShellStateProvider·BotPageContextProvider·UsageTracker)만 읽고, 첫 게시 전 null 은 '범위 없음'이다.
 * 현재 워크스페이스 쿠키(dflow-ws)를 쓰는 곳은 여기 하나다(D3) — 값이 다를 때만. 쿠키는 보안 경계가 아니다(읽는 쪽이 소속을 다시 본다).
 * 프로젝트 범위에 들어오면 방문을 알린다(queueProjectVisit) — 최근 방문 목록은 서버가 자기 행을 읽어 앞에 넣는다(§5.4.3, U2b-2 권한 리뷰 Y1:
 * 클라이언트가 가진 목록은 조회 실패면 '모름'이라 그것으로 덮으면 서버 목록이 지워지고, 디바운스 창 안 연속 이동은 서로 지운다).
 * persist=false(플랫폼 관리자가 소속 아닌 워크스페이스를 볼 때 — 레이아웃이 실제 소속 목록으로 정한다)면 게시만 하고 쿠키·방문을 쓰지 않는다.
 * 서버도 실제 소속일 때만 방문·워크스페이스 키를 쓴다(saveUiPrefs — 플랫폼 관리자 승계 없음, AA6). 두 겹이다.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { queueProjectVisit } from '@/lib/prefs/debouncedSave'
import { SLUG_RE, WS_COOKIE, type WorkspaceRef } from '@/lib/workspace/constants'

export interface ShellScopeState { workspace: WorkspaceRef | null; projectId: string | null; projects: { id: string; name: string }[] }
const Store = createContext<{ state: ShellScopeState | null; publish: (s: ShellScopeState | null) => void } | null>(null)

export function ShellScopeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShellScopeState | null>(null)
  const value = useMemo(() => ({ state, publish: setState }), [state])
  return <Store.Provider value={value}>{children}</Store.Provider>
}
export function useShellScope(): ShellScopeState | null { return useContext(Store)?.state ?? null }

function readCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function ShellScope({ workspace, projectId, projects, persist = true }: ShellScopeState & { persist?: boolean }) {
  const store = useContext(Store)
  const publish = store?.publish
  const projectsKey = projects.map((p) => `${p.id}:${p.name}`).join(',')
  useEffect(() => {
    publish?.({ workspace, projectId, projects })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 게시는 범위가 바뀔 때만(목록은 id·이름 열로 비교)
  }, [publish, workspace?.id, workspace?.slug, workspace?.name, projectId, projectsKey])
  // 범위를 떠나면 해제한다(Z7) — (global) 화면이 직전 워크스페이스·프로젝트를 지금 범위로 보지 않게(벨 합산·봇 문맥·사용 기록).
  // 범위 레이아웃끼리의 교체는 언마운트와 새 게시가 한 커밋이라 새 범위로 끝난다
  useEffect(() => () => { publish?.(null) }, [publish])
  useEffect(() => {
    if (!persist || !workspace || !SLUG_RE.test(workspace.slug)) return
    if (readCookie(WS_COOKIE) === workspace.slug) return
    document.cookie = `${WS_COOKIE}=${workspace.slug}; path=/; max-age=31536000; samesite=lax`
  }, [workspace, persist])
  useEffect(() => {
    if (!persist || !workspace || !projectId) return
    queueProjectVisit(workspace.id, projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입할 때 한 번(같은 프로젝트 안 이동은 다시 쓰지 않는다)
  }, [workspace?.id, projectId, persist])
  return null
}
