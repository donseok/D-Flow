/**
 * AI 사용 가능 판정(정본 §5.4.5, 스펙 §4.1 끝 줄·D17, 판정 P9) — hasLLM() ∧ 워크스페이스 ai.enabled ∧ (module 을 주면) 그 모듈이 effective.
 * 이것이 없으면 ai.enabled 를 꺼도 AI 모듈 둘(wiki·chatbot)만 꺼지고 주간 AI·이슈 분석·브리핑·회의록 인사이트는 계속 LLM 을 부른다.
 * hasLLM() 이 거짓이면 설정을 읽지 않는다(키 없는 배포의 비용 0). 판정 실패는 [aiAvailable] 로그 뒤 false — 호출부는 결정형 폴백을 탄다.
 * 스코프: { workspaceId, projectId? }(스펙) · { projectId } · { minuteId }(회의록 행) · null(세션 행위자의 유일 워크스페이스).
 * hasLLM() 을 직접 부르는 곳은 provider.ts(정의)·health.ts(배포 진단)·이 파일 셋뿐이다(tests/ai/ai-available.test.ts 정적 검사).
 */
import { unstable_rethrow } from 'next/navigation'
import { hasLLM } from '@/lib/ai/provider'
import { getActor } from '@/lib/authz'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { getProjectConfig, type ConfigReadClient, type ProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { createServerClient } from '@/lib/supabase/server'
import { WORKSPACE_SCOPED, type ModuleId } from './defaults'
import { effectiveModules } from './effective'

export type AiScope = { workspaceId: string; projectId?: string } | { projectId: string } | { minuteId: string } | null

/** 범위 해석 — { projectId } 는 프로젝트 설정을 읽어 워크스페이스를 얻고, 읽은 설정을 effectiveModules 에 넘긴다(P27 — 라우트·액션·after() 는
 *  React cache 밖이라 넘기지 않으면 같은 설정을 두 번 읽는다) */
type Resolved = { scope: { workspaceId: string; projectId?: string }; projectConfig?: ProjectConfig }
async function resolveScope(scope: AiScope, client: ConfigReadClient | undefined): Promise<Resolved | null> {
  if (scope === null) {
    const actor = await getActor()
    if (!actor) return null
    const sole = resolveSoleWorkspaceId(actor)
    return sole.ok ? { scope: { workspaceId: sole.workspaceId } } : null
  }
  if ('minuteId' in scope) {
    const sb = client ?? (await createServerClient())
    const { data, error } = await sb.from('minutes').select('workspace_id, project_id').eq('id', scope.minuteId).maybeSingle()
    if (error) throw new Error(`회의록 범위 조회 실패: ${error.message}`)
    const row = data as { workspace_id: string; project_id: string | null } | null
    return row ? { scope: { workspaceId: row.workspace_id, ...(row.project_id ? { projectId: row.project_id } : {}) } } : null
  }
  if ('workspaceId' in scope) return { scope }
  const cfg = await getProjectConfig(scope.projectId, { client })
  return { scope: { workspaceId: cfg.workspaceId, projectId: scope.projectId }, projectConfig: cfg }
}

export async function aiAvailable(scope: AiScope, opts?: { module?: ModuleId; client?: ConfigReadClient }): Promise<boolean> {
  if (!hasLLM()) return false
  const client = opts?.client
  try {
    const r = await resolveScope(scope, client)
    if (!r) { console.error('[aiAvailable]', '범위를 정하지 못했다', opts?.module ?? '-'); return false }
    const ws = await getWorkspaceConfig(r.scope.workspaceId, { client })
    if (valueOf(ws, 'ai.enabled') === false) return false
    if (opts?.module) {
      // 워크스페이스 층 모듈(회의록 등)은 프로젝트 토글과 무관하다 — 범위에서 프로젝트를 빼 그 설정을 읽지 않는다.
      // 읽으면 손상된 프로젝트 설정 하나가 무관한 워크스페이스 층 AI 까지 끈다(회의록 행에 프로젝트가 붙은 경우)
      const eff = WORKSPACE_SCOPED.has(opts.module)
        ? await effectiveModules({ workspaceId: r.scope.workspaceId }, { client })
        : await effectiveModules(r.scope, { client, ...(r.projectConfig ? { projectConfig: r.projectConfig } : {}) })
      if (!eff.has(opts.module)) return false
    }
    return true
  } catch (e) {
    unstable_rethrow(e)
    console.error('[aiAvailable]', opts?.module ?? '-', e instanceof Error ? e.message : e)
    return false
  }
}
