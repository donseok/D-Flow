import { getAccountPrefs } from '@/app/actions/preferences'
import { getActorViewState } from '@/lib/authz'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { ShellScopeProvider } from '@/components/app/ShellScope'
import { RightRailProvider } from '@/components/app/RightRail'
import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'
import { ShellEnvProvider } from '@/components/app/ShellEnv'
import { PrefsSync } from '@/components/app/PrefsSync'
import { UsageTracker } from '@/components/app/UsageTracker'
import { AssistantChat } from '@/components/chat/AssistantChat'
import { serverTranslator } from '@/lib/i18n/server'

/**
 * (app) 공급자 층(D2, 스펙 §5.4.1) — 셸(전역 바·내비·main)은 범위 레이아웃 셋(w/[slug]·p/[projectId]·(global))이 그린다.
 * 여기는 범위가 바뀌어도 살아 있어야 하는 것(게시 저장소·레일·봇 문맥·알림 구독·대화)만 둔다. 프로젝트 목록·팀·신원은 싣지 않는다.
 * STAGING env 판독은 이 파일에 남긴다(C 의 operational-env owner) — 셸에는 컨텍스트로 내린다.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 아래 범위 레이아웃(w/[slug]·p/[projectId]·(global))이 첫 줄에서 어차피 부르는 권한·소속 조회를 미리 띄운다. 부모 레이아웃이 끝나야 자식이 실행되므로
  // (React 는 부모 함수가 돌려준 뒤에야 자식 함수를 부른다) 그대로 두면 이 레이아웃의 개인 설정 조회가 끝난 다음에야 권한 조회(두 단계)가 시작된다.
  // 요청 캐시(React cache)가 같은 키의 약속을 내주므로 읽기가 늘지 않고 직렬 단계만 겹친다. 소비하는 쪽이 따로 있어 여기서는 결과를 쓰지 않고,
  // 처리되지 않은 거절만 막는다(실패는 소비하는 쪽이 자기 방식으로 처리한다).
  void getActorViewState().catch(() => undefined)
  void listMyWorkspaces().catch(() => undefined)
  const prefs = await getAccountPrefs()
  return (
    <ShellEnvProvider value={{ staging: process.env.STAGING === '1', sidebarCollapsed: typeof prefs.sidebarCollapsed === 'boolean' ? prefs.sidebarCollapsed : null }}>
      <ShellScopeProvider>
        <RightRailProvider>
          <BotPageContextProvider>
            <ShellStateProvider>
              <PrefsSync server={prefs} />
              <UsageTracker />
              <a href="#main-content" className="fixed left-4 top-3 z-(--z-skip) -translate-y-20 rounded-(--radius-control) bg-action px-4 py-2 text-sm font-semibold text-action-fg transition focus:translate-y-0">{(await serverTranslator())('shell.skipToMain')}</a>
              {children}
              <AssistantChat />
            </ShellStateProvider>
          </BotPageContextProvider>
        </RightRailProvider>
      </ShellScopeProvider>
    </ShellEnvProvider>
  )
}
