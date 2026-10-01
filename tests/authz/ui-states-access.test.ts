// /admin/ui-states 판정(SP3b 스펙 D16) — 플랫폼 관리자만, 권한 조회 실패(null)는 닫힌다
import { describe, expect, it } from 'vitest'
import { canViewUiStates } from '@/lib/authz/uiStatesAccess'
import { WS, makeActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

describe('canViewUiStates', () => {
  it('플랫폼 관리자만 참', () => {
    expect(canViewUiStates(makeSuperuser())).toBe(true)
    expect(canViewUiStates(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) }))).toBe(false)
    expect(canViewUiStates(makeMemberActor('00000000-0000-0000-7e57-000000001530'))).toBe(false)
    expect(canViewUiStates(null)).toBe(false)
  })
})
