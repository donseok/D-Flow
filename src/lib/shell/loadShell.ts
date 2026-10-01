/**
 * 범위 레이아웃의 2차 조회(스펙 §5.4.1, D49) — 설정(navigation.menu·branding.*)·모듈 집합·셸 프로젝트 목록·워크스페이스 개인 설정을 병렬로 읽고
 * navFor 로 내비를 계산한다. 설정·모듈 읽기 실패는 던지지 않는다 — 모듈 집합 실패 = CORE, 메뉴 손상·실패 = 레지스트리 순서, 브랜딩 손상 = 제품 기본.
 * 셋 다 로그를 남기고 configDegraded 로 셸 머리에 알린다(손상된 키를 고칠 설정 화면이 같은 레이아웃 아래라 열려야 한다).
 * 셸 프로젝트 목록 실패는 projectsFailed 로 알린다(전환기·내비가 '없음'이 아니라 '불러오지 못함'을 그린다 — 3원칙 ①).
 * 즐겨찾기·최근 방문 id 는 현재 워크스페이스의 가시 프로젝트 목록으로 거른다(W14 — 다른 워크스페이스·숨김 id 는 이름도 내지 않는다).
 * 같은 요청의 페이지가 부르는 effectiveModules·getWorkspaceConfig 는 React cache 로 이 조회와 나눈다. 반환은 직렬화 가능한 값뿐이다.
 * 가드가 아니다 — 부르는 범위 레이아웃이 존재 은닉(404)을 먼저 끝낸 뒤에만 부른다.
 */
import { BRAND } from '@/lib/branding'
import { getWorkspaceConfig, type WorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { displayBranding } from '@/lib/settings/displayBranding'
import { valueOf, type NavMenuSetting } from '@/lib/settings/registry'
import { accentStyle } from '@/lib/settings/accentCss'
import { effectiveModules } from '@/lib/modules/effective'
import { CORE } from '@/lib/modules/registry'
import { navFor, type NavGroup } from '@/lib/nav/registry'
import { navCapsFor, scopeRoleLabel } from '@/lib/authz/navCaps'
import { identityTeamCodes } from '@/lib/domain/identityTeams'
import { isWorkspaceAdmin, type Actor } from '@/lib/domain/authz'
import { listWorkspaceProjects, type ShellProject } from '@/lib/data/portal'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import type { ModuleId } from '@/lib/modules/defaults'
import type { WorkspaceRef } from '@/lib/workspace/constants'
import type { MyWorkspace } from '@/lib/workspace/list'
import type { ShellBrand } from '@/components/app/BrandSlot'
import type { ShellIdentity } from '@/components/app/AccountMenu'

export type ShellScopeKind = 'workspace' | 'project' | 'global'
export interface ShellProps {
  scope: ShellScopeKind; base: string; groups: NavGroup[]
  workspace: WorkspaceRef; workspaces: MyWorkspace[]; viewingAsPlatformAdmin: boolean
  project: { id: string; name: string } | null; projects: ShellProject[]; projectsFailed: boolean
  favoriteIds: string[]; recentIds: string[]
  identity: ShellIdentity; brand: ShellBrand; accentCss: string
  degraded: boolean; configDegraded: boolean; canEditSettings: boolean
}

const EMPTY_MENU: NavMenuSetting = { order: [], labels: {} }
const msg = (e: unknown) => (e instanceof Error ? e.message : e)

export async function loadShell(input: {
  scope: ShellScopeKind; ws: WorkspaceRef; actor: Actor | null; degraded: boolean; projectId?: string | null
  viewingAsPlatformAdmin: boolean; workspaces: MyWorkspace[]; userName: string | null
}): Promise<ShellProps> {
  const { scope, ws, actor, degraded } = input
  const projectId = scope === 'project' ? input.projectId ?? null : null
  let configDegraded = false
  const fail = (what: string, e: unknown) => { configDegraded = true; console.error('[shell] 설정 읽기 실패 — 기본으로 그린다', what, ws.id, msg(e)) }
  const [configR, effR, listR, prefs] = await Promise.all([
    getWorkspaceConfig(ws.id).then((c) => ({ ok: true as const, c }), (e: unknown) => ({ ok: false as const, e })),
    effectiveModules({ workspaceId: ws.id, ...(projectId ? { projectId } : {}) }).then((s) => ({ ok: true as const, s }), (e: unknown) => ({ ok: false as const, e })),
    listWorkspaceProjects(ws.id, actor),
    getWorkspacePrefs(ws.id),
  ])
  let effective: ReadonlySet<ModuleId> = CORE
  if (effR.ok) effective = effR.s; else fail('modules', effR.e)
  let config: WorkspaceConfig | null = null
  if (configR.ok) config = configR.c; else fail('워크스페이스 설정', configR.e)
  let menu: NavMenuSetting = EMPTY_MENU
  let productName: string = BRAND.productName
  let logo: { full: string | null; full_dark: string | null; mark: string | null } = { full: null, full_dark: null, mark: null }
  let accentCss = ''
  if (config) {
    try { menu = valueOf(config, 'navigation.menu') } catch (e) { fail('navigation.menu', e) }
    const name = config.keys['branding.product_name']
    if (name.status === 'invalid') fail('branding.product_name', name.error); else productName = displayBranding(config).productName
    const l = config.keys['branding.logo']
    if (l.status === 'set' || l.status === 'default') logo = l.value; else if (l.status === 'invalid') fail('branding.logo', l.error)
    const a = config.keys['branding.accent']
    if (a.status === 'set' && a.value) accentCss = accentStyle(a.value); else if (a.status === 'invalid') fail('branding.accent', a.error)
  }
  const caps = navCapsFor(actor, { workspaceId: ws.id, projectId })
  const base = scope === 'project' && projectId ? `/p/${projectId}` : `/w/${encodeURIComponent(ws.slug)}`
  const groups = navFor({ scope: scope === 'project' ? 'project' : 'workspace', base, effective, caps, menu })
  const projects = listR.ok ? listR.rows : []
  if (!listR.ok) console.error('[shell] 프로젝트 목록 실패 — 전환기·즐겨찾기 없이 그리고 실패를 알린다', ws.id)
  const visible = new Set(projects.map((p) => p.id))
  const favoriteIds = (prefs.favoriteProjectIds ?? []).filter((id) => visible.has(id))
  const recentIds = (prefs.recentProjects ?? []).map((r) => r.id).filter((id) => visible.has(id))
  return {
    scope, base, groups, workspace: ws, workspaces: input.workspaces, viewingAsPlatformAdmin: input.viewingAsPlatformAdmin,
    project: projectId ? { id: projectId, name: projects.find((p) => p.id === projectId)?.name ?? '' } : null,
    projects, projectsFailed: !listR.ok, favoriteIds, recentIds,
    identity: { displayName: input.userName, roleLabel: scopeRoleLabel(actor, { workspaceId: ws.id, projectId }, degraded), teamCodes: actor ? identityTeamCodes(actor, ws.id) : null },
    brand: { productName, workspaceId: ws.id, hasFull: !!logo.full, hasFullDark: !!logo.full_dark, hasMark: !!logo.mark },
    accentCss, degraded, configDegraded, canEditSettings: isWorkspaceAdmin(actor, ws.id),
  }
}

/** 워크스페이스를 모를 때(프로젝트 범위 열화·(global) 소속 0)의 최소 셸 — 조회 없음. 내비 없이 전역 바·계정 메뉴·열화 알림만 */
export function minimalShell(input: { scope: ShellScopeKind; projectId: string | null; workspaces: MyWorkspace[]; userName: string | null; degraded: boolean }): ShellProps {
  return {
    scope: input.scope, base: '/', groups: [], workspace: { id: '', slug: '', name: '' }, workspaces: input.workspaces, viewingAsPlatformAdmin: false,
    project: input.projectId ? { id: input.projectId, name: '' } : null, projects: [], projectsFailed: false, favoriteIds: [], recentIds: [],
    identity: { displayName: input.userName, roleLabel: input.degraded ? '확인 불가' : '조회', teamCodes: null },
    brand: { productName: BRAND.productName, workspaceId: null, hasFull: false, hasFullDark: false, hasMark: false },
    accentCss: '', degraded: input.degraded, configDegraded: false, canEditSettings: false,
  }
}
