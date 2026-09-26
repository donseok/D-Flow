import { describe, expect, it } from 'vitest'
import type { ProjectRole } from '@/lib/domain/authz'
import { isBatchAuthorized } from '@/lib/minutes/externalApi'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

// SP2 결정 8 — 배치는 "어느 프로젝트든 관리자"가 아니라 대상 회의록마다 관리자 이상이어야 한다.
const P1 = 'p-1'
const P2 = 'p-2'
const inWs = (projectId: string | null) => ({ project_id: projectId, workspace_id: WS })
const actor = (roles: Array<[string, ProjectRole]>) => makeActor({
  projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map(roles),
})

describe('isBatchAuthorized — 대상마다 관리자', () => {
  it('대상 프로젝트 둘 중 하나만 관리자면 false', () => {
    expect(isBatchAuthorized(actor([[P1, 'admin'], [P2, 'member']]), [inWs(P1), inWs(P2)])).toBe(false)
  })
  it('둘 다 관리자면 true', () => {
    expect(isBatchAuthorized(actor([[P1, 'admin'], [P2, 'admin']]), [inWs(P1), inWs(P2)])).toBe(true)
  })
  it('빈 대상은 false — 판정할 것이 없으면 통과시키지 않는다', () => {
    expect(isBatchAuthorized(makeSuperuser(), [])).toBe(false)
  })
  it('워크스페이스 관리자는 명단 없이 그 워크스페이스 프로젝트·무프로젝트 회의록 모두 통과(승계)', () => {
    const wsAdmin = makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS]]) })
    expect(isBatchAuthorized(wsAdmin, [inWs(P1), inWs(null)])).toBe(true)
  })
  it('무프로젝트 회의록은 프로젝트 관리자만으로는 false', () => {
    expect(isBatchAuthorized(actor([[P1, 'admin']]), [inWs(null)])).toBe(false)
  })
  it('다른 워크스페이스 프로젝트는 명단 admin 행이 있어도 false(스냅샷에 없음)', () => {
    const a = makeActor({ projectRoles: new Map<string, ProjectRole>([['p-foreign', 'admin']]) })
    expect(isBatchAuthorized(a, [{ project_id: 'p-foreign', workspace_id: 'ws-2' }])).toBe(false)
  })
})
