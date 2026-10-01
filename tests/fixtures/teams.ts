import { createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'

/** 테스트 전용 팀 — 옛 런타임 기본값(DEFAULT_TEAMS, 2026-07 5팀)의 값을 그대로 옮겼다. 런타임은 팀 마스터(DB)만 본다.
 *  워크스페이스가 없는 픽스처라 workspaceId 는 '' 다(어떤 워크스페이스 접근자에도 걸리지 않는다). */
export const FIXTURE_TEAMS: readonly Team[] = [
  { id: 'default-pmo', code: 'PMO', name: 'PMO', color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-erp', code: 'ERP', name: 'ERP', color: '#6b7280', sortOrder: 1, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mes', code: 'MES', name: 'MES', color: '#6b7280', sortOrder: 2, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-gagong', code: '가공', name: '가공', color: '#6b7280', sortOrder: 3, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mdm', code: 'MDM', name: 'MDM', color: '#6b7280', sortOrder: 4, active: true, progressVisible: false, projectId: null, workspaceId: '' },
]
export const FIXTURE_TEAM_CODES: readonly TeamCode[] = FIXTURE_TEAMS.map(t => t.code)

/** provider 없이 렌더하던 컴포넌트 테스트용 — 전역 mock 대신 명시적으로 감싼다. */
export function withTeams(ui: ReactNode, teams: readonly Team[] = FIXTURE_TEAMS): ReactElement {
  // children 은 셋째 인자로 넘긴다(react/no-children-prop) — props 타입이 children 을 요구해 단언으로 맞춘다.
  return createElement(TeamsProvider, { teams } as ComponentProps<typeof TeamsProvider>, ui)
}
