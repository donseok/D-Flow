import Link from 'next/link'
import type { ReactNode } from 'react'
import type { NavGroup } from '@/lib/nav/registry'
import { activeNavItem } from '@/lib/nav/active'

export interface ContextBreadcrumbProps {
  scope: 'workspace' | 'project' | 'global'
  workspace: { name: string; href: string } | null
  project: { name: string; href: string } | null
  screen: string | null
}

/** 브레드크럼의 화면 이름 — 내비와 같은 활성 항목의 라벨(설정 라벨 포함). 활성 항목이 없는 경로((global)·범위 밖)는 null */
export function navScreenLabel(pathname: string, groups: readonly NavGroup[], t: (key: string) => string): string | null {
  const id = activeNavItem(pathname, groups)
  const item = id ? groups.flatMap((g) => g.items).find((i) => i.id === id) : undefined
  if (!item) return null
  return typeof item.label === 'string' ? item.label : t(item.label.key)
}

/** '워크스페이스 / 프로젝트 / 화면' 을 한 번만(§5.4.4). 워크스페이스 범위는 프로젝트 자리에 누를 수 없는 칩 — 공용 화면에서 이전 프로젝트가 선택된 듯 보이지 않게.
 *  workspaceSlot(워크스페이스 전환기 — D4)을 받으면 워크스페이스 링크 자리에 그것을 둔다(데스크톱의 전환기 자리. 브랜드가 홈 링크다).
 *  projectSlot(프로젝트 전환기 — AA1)을 받으면 프로젝트 링크 자리에 둔다(개요는 내비가 맡는다) */
export function ContextBreadcrumb({ scope, workspace, project, screen, workspaceSlot, projectSlot }: ContextBreadcrumbProps & { workspaceSlot?: ReactNode; projectSlot?: ReactNode }) {
  const sep = <span aria-hidden className="text-fg-secondary">/</span>
  return (
    <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-2 text-control">
      {workspace && (workspaceSlot ?? <Link href={workspace.href} className="truncate text-fg-secondary hover:text-fg">{workspace.name}</Link>)}
      {scope === 'workspace' && workspace && <>{sep}<span className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 text-meta font-semibold text-fg-secondary">워크스페이스 전체</span></>}
      {scope === 'project' && project && <>{sep}{projectSlot ?? <Link href={project.href} className="truncate font-semibold text-fg hover:underline">{project.name}</Link>}</>}
      {screen && <>{sep}<span aria-current="page" className="truncate text-fg">{screen}</span></>}
    </nav>
  )
}
