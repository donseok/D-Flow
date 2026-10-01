/**
 * 모듈 관문(스펙 §4.1·§4.2, 정본 §3.2.4) — 권한 가드 **뒤**에서 부른다. 가드가 아니라 관문이다(E18): actor 를 싣지 않고, 익명 공유 링크·
 * 에이전트 API·회의록 API·워커도 같은 함수를 쓴다. 세션 없는 경로는 { client: admin } 을 반드시 넘긴다 — 쿠키 없는 세션 클라이언트는 0행을
 * 받아 모든 호출이 닫힌다. 판정은 effectiveModules 하나다(메뉴 navFor 와 같은 원천). 예외는 전부 [requireModule] 로그 뒤 ERR_MODULE_DISABLED
 * (fail-closed) — 단 Next 의 제어 흐름 신호(동적 사용·notFound·redirect)는 삼키지 않는다. 요청이 전부 core 면 설정을 읽지 않는다(판정 P2).
 * 모듈 관문은 화면과 기능을 닫는다. 읽기 권한을 거두지 않는다(스펙 §4 머리) — RLS 로 읽히는 행은 PostgREST 로 계속 읽힌다.
 * authz/index.ts 에 두지 않는다(D10 — 81개 테스트가 그 모듈을 통째로 mock 한다). 단위 테스트는 tests/setup/module-gate.ts 가 통과시킨다.
 */
import { unstable_rethrow } from 'next/navigation'
import { getActor } from '@/lib/authz'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import type { ModuleId } from './defaults'
import { effectiveModules } from './effective'
import { CORE } from './registry'

export type ModuleScope = { projectId: string } | { workspaceId: string }
export type ModuleGateResult = { ok: true } | { ok: false; error: string }
export type ModuleState = 'on' | 'off' | 'unknown'

const DENIED: ModuleGateResult = { ok: false, error: ERR_MODULE_DISABLED }
const idsOf = (m: ModuleId | readonly ModuleId[]): readonly ModuleId[] => (typeof m === 'string' ? [m] : m)
const allCore = (ids: readonly ModuleId[]) => ids.every((id) => CORE.has(id))

async function effectiveFor(scope: ModuleScope, client: ConfigReadClient | undefined): Promise<ReadonlySet<ModuleId>> {
  if ('projectId' in scope) {
    const cfg = await getProjectConfig(scope.projectId, { client })            // E12 — resolveScope 에는 'projects' 가 없다
    return effectiveModules({ workspaceId: cfg.workspaceId, projectId: scope.projectId }, { client, projectConfig: cfg })   // P27 — 같은 설정을 두 번 읽지 않는다
  }
  return effectiveModules({ workspaceId: scope.workspaceId }, { client })
}

export async function requireModule(scope: ModuleScope, moduleId: ModuleId | readonly ModuleId[], opts?: { client?: ConfigReadClient }): Promise<ModuleGateResult> {
  const ids = idsOf(moduleId)
  if (ids.length === 0) throw new Error('[requireModule] 모듈 id 가 비었다')     // 프로그래밍 오류 — 통과로 두지 않는다
  if (allCore(ids)) return { ok: true }
  try {
    const eff = await effectiveFor(scope, opts?.client)
    return ids.every((id) => eff.has(id)) ? { ok: true } : DENIED
  } catch (e) {
    unstable_rethrow(e)                                                        // cause 안의 신호까지 다시 던진다
    console.error('[requireModule]', ids.join(','), JSON.stringify(scope), e instanceof Error ? e.message : e)   // 판정 범위까지 — 어느 프로젝트·워크스페이스에서 닫혔는지
    return DENIED
  }
}

/** 한 스코프의 유효 모듈을 한 번만 읽는다. 읽기 실패는 로그를 남기고 core 만 허용한다 — strict 면 로그 뒤 그 오류를 다시 던진다
 *  (닫힘이 다른 범위의 전제를 조용히 깨는 호출부 — 봇 도구의 워크스페이스 범위, A2-3 리뷰 보안 P3·X2). */
export async function moduleSetFor(scope: ModuleScope, opts?: { client?: ConfigReadClient; strict?: boolean }): Promise<ReadonlySet<ModuleId>> {
  try {
    return await effectiveFor(scope, opts?.client)
  } catch (error) {
    unstable_rethrow(error)
    console.error('[moduleSetFor]', error instanceof Error ? error.message : String(error))
    if (opts?.strict) throw error
    return CORE
  }
}

/** 대상 행이 없는 세션 판정(스펙 §4.2 2행) — projectId 가 있으면 그 프로젝트, 없으면 행위자의 유일 워크스페이스. 소속 0개·2개 이상·
 *  비로그인·권한 조회 실패는 닫는다(판정 P13, 리스크 R15). 세션 경로 전용 — 세션 없는 경로는 requireModule 에 범위와 client 를 넘긴다. */
export async function requireSessionModule(projectId: string | null, moduleId: ModuleId | readonly ModuleId[]): Promise<ModuleGateResult> {
  if (projectId) return requireModule({ projectId }, moduleId)
  if (allCore(idsOf(moduleId))) return { ok: true }
  let actor: Awaited<ReturnType<typeof getActor>>
  try { actor = await getActor() } catch (e) {
    unstable_rethrow(e)
    console.error('[requireModule] 행위자 조회 실패', e instanceof Error ? e.message : e)
    return DENIED
  }
  if (!actor) return DENIED
  const sole = resolveSoleWorkspaceId(actor)
  if (!sole.ok) return DENIED
  return requireModule({ workspaceId: sole.workspaceId }, moduleId)
}

/** 워커용 3값(판정 P10) — 설정을 읽지 못하거나 모듈 키가 손상이면 'unknown'(잡을 실패로 돌려 재시도·dead_letter), 꺼짐은 'off'(skipped).
 *  그 밖의 예외는 던진다(워커의 기존 예외 격리가 받는다). */
export async function moduleState(scope: ModuleScope, moduleId: ModuleId | readonly ModuleId[], opts?: { client?: ConfigReadClient }): Promise<ModuleState> {
  const ids = idsOf(moduleId)
  if (allCore(ids)) return 'on'
  try {
    const eff = await effectiveFor(scope, opts?.client)
    return ids.every((id) => eff.has(id)) ? 'on' : 'off'
  } catch (e) {
    if (e instanceof ConfigUnavailableError || e instanceof ConfigKeyError) {
      console.error('[moduleState]', ids.join(','), e.message)
      return 'unknown'
    }
    throw e
  }
}

/** 목록형 응답(스펙 §4.2 첫 문단) — 모듈이 유효한 프로젝트만, 입력 순서, 중복 제거. 판정 실패는 뺀다(requireModule 이 로그를 남긴다) */
export async function projectsWithModule(projectIds: readonly string[], moduleId: ModuleId | readonly ModuleId[], opts?: { client?: ConfigReadClient }): Promise<string[]> {
  const uniq = [...new Set(projectIds)]
  const ok = await Promise.all(uniq.map(async (projectId) => (await requireModule({ projectId }, moduleId, opts)).ok))
  return uniq.filter((_, i) => ok[i])
}

/** 워크스페이스 층 목록(회의록 API meta·목록) — 모듈이 유효한 워크스페이스만 */
export async function workspacesWithModule(workspaceIds: readonly string[], moduleId: ModuleId | readonly ModuleId[], opts?: { client?: ConfigReadClient }): Promise<string[]> {
  const uniq = [...new Set(workspaceIds)]
  const ok = await Promise.all(uniq.map(async (workspaceId) => (await requireModule({ workspaceId }, moduleId, opts)).ok))
  return uniq.filter((_, i) => ok[i])
}
