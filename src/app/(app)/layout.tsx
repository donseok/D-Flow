import { getAccountPrefs } from '@/app/actions/preferences'
import { ShellScopeProvider } from '@/components/app/ShellScope'
import { RightRailProvider } from '@/components/app/RightRail'
import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'
import { ShellEnvProvider } from '@/components/app/ShellEnv'
import { PrefsSync } from '@/components/app/PrefsSync'
import { UsageTracker } from '@/components/app/UsageTracker'
import { AssistantChat } from '@/components/chat/AssistantChat'

/**
 * (app) 공급자 층(D2, 스펙 §5.4.1) — 셸(전역 바·내비·main)은 범위 레이아웃 셋(w/[slug]·p/[projectId]·(global))이 그린다.
 * 여기는 범위가 바뀌어도 살아 있어야 하는 것(게시 저장소·레일·봇 문맥·알림 구독·대화)만 둔다. 프로젝트 목록·팀·신원은 싣지 않는다.
 * STAGING env 판독은 이 파일에 남긴다(C 의 operational-env owner) — 셸에는 컨텍스트로 내린다.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const prefs = await getAccountPrefs()
  return (
    <ShellEnvProvider value={{ staging: process.env.STAGING === '1', sidebarCollapsed: typeof prefs.sidebarCollapsed === 'boolean' ? prefs.sidebarCollapsed : null }}>
      <ShellScopeProvider>
        <RightRailProvider>
          <BotPageContextProvider>
            <ShellStateProvider>
              <PrefsSync server={prefs} />
              <UsageTracker />
              <a href="#main-content" className="fixed left-4 top-3 z-(--z-skip) -translate-y-20 rounded-(--radius-control) bg-action px-4 py-2 text-sm font-semibold text-action-fg transition focus:translate-y-0">본문 바로가기</a>
              {children}
              <AssistantChat />
            </ShellStateProvider>
          </BotPageContextProvider>
        </RightRailProvider>
      </ShellScopeProvider>
    </ShellEnvProvider>
  )
}
