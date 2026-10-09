// 계정 조작의 순수 판정(계정 수명주기) — 비밀번호 재설정·워크스페이스에서 제거. 경계의 전 조합을 표로 고정한다.
// SQL 쪽 짝(0053 record_password_reset·remove_workspace_member)은 tests/rls/account-lifecycle.test.ts 가 같은 조합으로 본다.
import { describe, expect, it } from 'vitest'
import {
  memberRemovalVerdict, passwordResetVerdict, type AccountTarget, type WorkspaceRole,
} from '@/lib/domain/authz'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const WS_B = 'ws-b'
const WS_C = 'ws-c'
const target = (roles: Array<[string, WorkspaceRole]>, isPlatformAdmin = false, userId = 'u-t'): AccountTarget =>
  ({ userId, isPlatformAdmin, workspaceRoles: new Map(roles) })
const ADMIN = makeActor({ userId: 'u-a', workspaceRoles: new Map([[WS, 'admin']]) })
const ADMIN_AB = makeActor({ userId: 'u-ab', workspaceRoles: new Map([[WS, 'admin'], [WS_B, 'admin']]) })
const ADMIN_A_MEMBER_B = makeActor({ userId: 'u-am', workspaceRoles: new Map([[WS, 'admin'], [WS_B, 'member']]) })
const MEMBER = makeActor({ userId: 'u-m' })
const SU = makeSuperuser({ userId: 'u-su', workspaceRoles: new Map() })

describe('passwordResetVerdict — 대상이 닿는 범위가 행위자가 관리하는 범위 안일 때만', () => {
  it.each([
    ['자기 워크스페이스의 일반 멤버', ADMIN, target([[WS, 'member']]), 'ok'],
    ['자기 자신', ADMIN, target([[WS, 'admin']], false, 'u-a'), 'self'],
    ['이 워크스페이스의 다른 관리자', ADMIN, target([[WS, 'admin']]), 'target_admin'],
    ['이 워크스페이스 소속이 아닌 계정(소속 0)', ADMIN, target([]), 'not_member'],
    ['다른 워크스페이스에만 속한 계정', ADMIN, target([[WS_B, 'member']]), 'not_member'],
    ['플랫폼 관리자인 멤버', ADMIN, target([[WS, 'member']], true), 'platform_only'],
    ['다른 워크스페이스에도 속한 멤버', ADMIN, target([[WS, 'member'], [WS_B, 'member']]), 'platform_only'],
    ['다른 워크스페이스의 관리자', ADMIN, target([[WS, 'member'], [WS_B, 'admin']]), 'platform_only'],
    ['행위자가 멤버일 뿐인 워크스페이스에도 속한 계정', ADMIN_A_MEMBER_B, target([[WS, 'member'], [WS_B, 'member']]), 'platform_only'],
    ['행위자가 둘 다 관리자인 두 워크스페이스의 멤버', ADMIN_AB, target([[WS, 'member'], [WS_B, 'member']]), 'ok'],
    ['둘 다 관리하지만 대상이 한쪽의 관리자', ADMIN_AB, target([[WS, 'member'], [WS_B, 'admin']]), 'platform_only'],
    ['관리하는 둘 + 관리하지 않는 셋째에도 속한 계정', ADMIN_AB, target([[WS, 'member'], [WS_B, 'member'], [WS_C, 'member']]), 'platform_only'],
    ['행위자가 그 워크스페이스의 멤버일 뿐', MEMBER, target([[WS, 'member']]), 'denied'],
    ['행위자가 그 워크스페이스 소속이 아님', makeActor({ userId: 'u-x', workspaceRoles: new Map([[WS_B, 'admin']]) }), target([[WS, 'member']]), 'denied'],
  ] as const)('워크스페이스 관리자 → %s', (_n, actor, t, want) => {
    expect(passwordResetVerdict(actor, WS, t)).toBe(want)
  })

  it('플랫폼 관리자는 자기 자신 말고 누구든 — 관리자·플랫폼 관리자·다른 워크스페이스 소속·소속 없는 계정', () => {
    for (const t of [target([[WS, 'member']]), target([[WS, 'admin']]), target([[WS, 'member']], true),
      target([[WS, 'member'], [WS_B, 'admin']]), target([]), target([[WS_B, 'member']])]) {
      expect(passwordResetVerdict(SU, WS, t)).toBe('ok')
    }
    expect(passwordResetVerdict(SU, WS, target([[WS, 'admin']], true, 'u-su'))).toBe('self')
  })

  it('명단 권한(프로젝트 관리자)은 판정에 들어가지 않는다 — 워크스페이스 관리자가 그 워크스페이스 전 프로젝트의 관리자를 승계한다', () => {
    // AccountTarget 에 명단 축이 없다는 것 자체가 계약이다: 소속이 같으면 결과가 같다
    expect(passwordResetVerdict(ADMIN, WS, target([[WS, 'member']]))).toBe('ok')
  })
})

describe('memberRemovalVerdict — 마지막 관리자는 DB 가 판정한다(여기 없음)', () => {
  it.each([
    ['일반 멤버', ADMIN, { userId: 'u-t', workspaceRole: 'member' }, 'ok'],
    ['자기 자신', ADMIN, { userId: 'u-a', workspaceRole: 'admin' }, 'self'],
    ['다른 관리자(행위자는 워크스페이스 관리자)', ADMIN, { userId: 'u-t', workspaceRole: 'admin' }, 'target_admin'],
    ['소속 아닌 계정(명단에만 있음)', ADMIN, { userId: 'u-t', workspaceRole: null }, 'not_member'],
    ['행위자가 멤버일 뿐', MEMBER, { userId: 'u-t', workspaceRole: 'member' }, 'denied'],
    ['플랫폼 관리자 → 관리자', SU, { userId: 'u-t', workspaceRole: 'admin' }, 'ok'],
    ['플랫폼 관리자 → 멤버', SU, { userId: 'u-t', workspaceRole: 'member' }, 'ok'],
    ['플랫폼 관리자 → 자기 자신', SU, { userId: 'u-su', workspaceRole: 'admin' }, 'self'],
    ['플랫폼 관리자 → 소속 아닌 계정', SU, { userId: 'u-t', workspaceRole: null }, 'not_member'],
  ] as const)('%s', (_n, actor, t, want) => {
    expect(memberRemovalVerdict(actor, WS, t)).toBe(want)
  })
})
