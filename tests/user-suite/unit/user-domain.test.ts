import { describe, it, expect } from 'vitest'
import {
  isAccountRole,
  isValidPassword,
  parseBulkAccounts,
  ACCOUNT_ROLES,
} from '@/lib/domain/accounts'
import {
  isWorkspaceAdminRole,
  isAdminAccessRole,
  inheritedProjectRole,
  effectiveRoleOfRow,
  roleIn,
  workspaceRoleIn,
  isWorkspaceAdmin,
  isHiddenProject,
  WORKSPACE_ROLE,
  ACCESS_ROLE,
} from '@/lib/domain/authz'
import {
  splitPrefs,
  mergePrefs,
  pushRecent,
  RECENT_MAX,
  ACCOUNT_PREF_KEYS,
  WORKSPACE_PREF_KEYS,
} from '@/lib/prefs/split'
import { compareKoreanName, sortByKoreanName } from '@/lib/domain/nameSort'
import { makeActor, makeSuperuser, hiddenIds, WS } from '../../fixtures/actor'

describe('사용자 도메인 단위 테스트 슈트 (User Domain Unit Tests)', () => {
  describe('1. 계정 및 비밀번호 검증 (Account & Password Validation)', () => {
    it('비밀번호 최소 길이(8자)를 검증하고 비문자열 및 경계값을 올바르게 판정한다', () => {
      // 정상 케이스
      expect(isValidPassword('12345678')).toBe(true)
      expect(isValidPassword('securePassword123!')).toBe(true)
      expect(isValidPassword('abcdefgh')).toBe(true)

      // 실패 케이스 (경계값)
      expect(isValidPassword('1234567')).toBe(false)
      expect(isValidPassword('')).toBe(false)
      expect(isValidPassword('short')).toBe(false)

      // 비정상 타입 방어
      expect(isValidPassword(null)).toBe(false)
      expect(isValidPassword(undefined)).toBe(false)
      expect(isValidPassword(12345678)).toBe(false)
      expect(isValidPassword({})).toBe(false)
    })

    it('계정 역할 화이트리스트(admin, member, viewer)를 검증한다', () => {
      expect(ACCOUNT_ROLES).toEqual(['admin', 'member', 'viewer'])

      expect(isAccountRole('admin')).toBe(true)
      expect(isAccountRole('member')).toBe(true)
      expect(isAccountRole('viewer')).toBe(true)

      // 부적격 역할
      expect(isAccountRole('superuser')).toBe(false)
      expect(isAccountRole('guest')).toBe(false)
      expect(isAccountRole('owner')).toBe(false)
      expect(isAccountRole('Admin')).toBe(false)
      expect(isAccountRole('')).toBe(false)
    })

    describe('일괄 계정 파싱 (parseBulkAccounts)', () => {
      it('정상적인 3열 및 4열 형식을 콤마와 탭 구분자로 파싱한다', () => {
        const input = [
          'user1@example.com, admin, password123, 김관리',
          'user2@example.com\tmember\tpassword123\t이개발',
          'user3@example.com, viewer, password123',
        ].join('\n')

        const results = parseBulkAccounts(input)
        expect(results).toHaveLength(3)

        expect(results[0]).toMatchObject({
          lineNo: 1,
          ok: true,
          email: 'user1@example.com',
          role: 'admin',
          password: 'password123',
          name: '김관리',
        })

        expect(results[1]).toMatchObject({
          lineNo: 2,
          ok: true,
          email: 'user2@example.com',
          role: 'member',
          password: 'password123',
          name: '이개발',
        })

        expect(results[2]).toMatchObject({
          lineNo: 3,
          ok: true,
          email: 'user3@example.com',
          role: 'viewer',
          password: 'password123',
          name: null,
        })
      })

      it('빈 줄을 건너뛰면서도 실제 줄 번호(lineNo)를 정확하게 보존한다', () => {
        const input = [
          '',
          'user1@example.com, member, password123',
          '   ',
          'user2@example.com, admin, password123',
        ].join('\n')

        const results = parseBulkAccounts(input)
        expect(results).toHaveLength(2)
        expect(results[0].lineNo).toBe(2)
        expect(results[1].lineNo).toBe(4)
      })

      it('이메일 형식 오류, 비밀번호 길이 부족, 열 부족을 각각 포착한다', () => {
        const input = [
          'invalid-email, member, password123',
          'user@example.com, member, short',
          'user@example.com, member',
        ].join('\n')

        const results = parseBulkAccounts(input)
        expect(results).toHaveLength(3)

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('이메일 형식 오류')

        expect(results[1].ok).toBe(false)
        expect(results[1].error).toContain('비밀번호는 8자 이상')

        expect(results[2].ok).toBe(false)
        expect(results[2].error).toContain('열 부족')
      })

      it('옛 형식(팀 열 포함) 입력 시 명확한 마이그레이션 안내를 제공한다', () => {
        const oldFormat = 'user@example.com, PMO, member, password123'
        const results = parseBulkAccounts(oldFormat)
        expect(results).toHaveLength(1)
        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('팀 열이 있는 옛 형식입니다')
      })
    })
  })

  describe('2. 사용자 권한 및 접근 제어 판정 (Authz & Role Calculations)', () => {
    it('워크스페이스 및 프로젝트 역할 상수와 검사기를 확인한다', () => {
      expect(WORKSPACE_ROLE.admin).toBe('admin')
      expect(WORKSPACE_ROLE.member).toBe('member')
      expect(ACCESS_ROLE.admin).toBe('admin')
      expect(ACCESS_ROLE.member).toBe('member')

      expect(isWorkspaceAdminRole('admin')).toBe(true)
      expect(isWorkspaceAdminRole('member')).toBe(false)
      expect(isWorkspaceAdminRole(null)).toBe(false)
      expect(isWorkspaceAdminRole(undefined)).toBe(false)

      expect(isAdminAccessRole('admin')).toBe(true)
      expect(isAdminAccessRole('member')).toBe(false)
      expect(isAdminAccessRole(null)).toBe(false)
    })

    it('워크스페이스 관리자 권한이 프로젝트 역할로 올바르게 승계(inheritedProjectRole)된다', () => {
      // 워크스페이스 관리자는 프로젝트 내 명단 역할이 무엇이든 관리자가 됨
      expect(inheritedProjectRole('admin', null)).toBe('admin')
      expect(inheritedProjectRole('admin', 'member')).toBe('admin')
      expect(inheritedProjectRole('admin', 'admin')).toBe('admin')

      // 워크스페이스 일반 멤버는 프로젝트 명단 역할 그대로 유지
      expect(inheritedProjectRole('member', 'admin')).toBe('admin')
      expect(inheritedProjectRole('member', 'member')).toBe('member')
      expect(inheritedProjectRole('member', null)).toBe('viewer') // null은 조회 전용(viewer)

      // 워크스페이스 소속 없음(null)
      expect(inheritedProjectRole(null, 'admin')).toBe('admin')
      expect(inheritedProjectRole(null, 'member')).toBe('member')
      expect(inheritedProjectRole(null, null)).toBe('viewer')
    })

    it('명단 행 기준 유효 역할 표시(effectiveRoleOfRow)를 검증한다', () => {
      const wsRoles = new Map<string, 'admin' | 'member'>([
        ['u-admin', 'admin'],
        ['u-mem', 'member'],
      ])

      // 외부 인원(external)
      expect(effectiveRoleOfRow({ kind: 'external', userId: null, accessRole: null }, wsRoles)).toEqual({
        kind: 'external',
      })
      expect(effectiveRoleOfRow({ kind: 'account', userId: null, accessRole: 'admin' }, wsRoles)).toEqual({
        kind: 'external',
      })

      // 워크스페이스 역할 맵 누락 시 unknown
      expect(effectiveRoleOfRow({ kind: 'account', userId: 'u-mem', accessRole: 'member' }, null)).toEqual({
        kind: 'unknown',
      })

      // 워크스페이스 관리자가 상속받은 경우
      expect(effectiveRoleOfRow({ kind: 'account', userId: 'u-admin', accessRole: 'member' }, wsRoles)).toEqual({
        kind: 'role',
        role: 'admin',
        inherited: true,
      })

      // 일반 멤버가 직접 관리자인 경우
      expect(effectiveRoleOfRow({ kind: 'account', userId: 'u-mem', accessRole: 'admin' }, wsRoles)).toEqual({
        kind: 'role',
        role: 'admin',
        inherited: false,
      })

      // 일반 멤버가 명단 권한 없는 경우 (viewer)
      expect(effectiveRoleOfRow({ kind: 'account', userId: 'u-mem', accessRole: null }, wsRoles)).toEqual({
        kind: 'role',
        role: 'viewer',
        inherited: false,
      })
    })

    it('프로젝트 내 액터의 유효 역할(roleIn)을 정확히 산출한다', () => {
      const PID = 'p-alpha'

      // 1. 비로그인
      expect(roleIn(null, PID)).toBeNull()

      // 2. 플랫폼 슈퍼유저 (프로젝트 존재 여부와 무관하게 superuser)
      const su = makeSuperuser()
      expect(roleIn(su, PID)).toBe('superuser')
      expect(roleIn(su, null)).toBe('superuser')

      // 3. 프로젝트 미지정 (fail-closed: viewer)
      const mem = makeActor()
      expect(roleIn(mem, null)).toBe('viewer')

      // 4. 타 워크스페이스 / 알 수 없는 프로젝트 (존재 은닉: null)
      expect(roleIn(mem, 'unknown-project')).toBeNull()

      // 5. 워크스페이스 관리자의 승계
      const wsAdmin = makeActor({
        workspaceRoles: new Map([[WS, 'admin']]),
        projectWorkspace: new Map([[PID, WS]]),
      })
      expect(roleIn(wsAdmin, PID)).toBe('admin')

      // 6. 워크스페이스 일반 멤버 + 프로젝트 관리자
      const projAdmin = makeActor({
        workspaceRoles: new Map([[WS, 'member']]),
        projectWorkspace: new Map([[PID, WS]]),
        projectRoles: new Map([[PID, 'admin']]),
      })
      expect(roleIn(projAdmin, PID)).toBe('admin')

      // 7. 워크스페이스 일반 멤버 + 프로젝트 일반 멤버
      const projMember = makeActor({
        workspaceRoles: new Map([[WS, 'member']]),
        projectWorkspace: new Map([[PID, WS]]),
        projectRoles: new Map([[PID, 'member']]),
      })
      expect(roleIn(projMember, PID)).toBe('member')

      // 8. 워크스페이스 일반 멤버 + 프로젝트 명단 없음 (viewer)
      const projViewer = makeActor({
        workspaceRoles: new Map([[WS, 'member']]),
        projectWorkspace: new Map([[PID, WS]]),
        projectRoles: new Map(),
      })
      expect(roleIn(projViewer, PID)).toBe('viewer')
    })

    it('비공개 프로젝트 가시성 및 은닉(isHiddenProject)을 검증한다', () => {
      const PID_PUBLIC = 'p-pub'
      const PID_PRIVATE = 'p-priv'
      const PID_NON_EXIST = 'p-none'

      const user = makeActor({
        projectWorkspace: new Map([
          [PID_PUBLIC, WS],
          [PID_PRIVATE, WS],
        ]),
        projectRoles: new Map([[PID_PUBLIC, 'member']]),
      })

      // 비공개 프로젝트 집합
      const hidden = hiddenIds(PID_PRIVATE)

      // 비로그인은 무조건 숨김
      expect(isHiddenProject(null, PID_PUBLIC, hidden)).toBe(true)

      // 명단 밖 비공개 프로젝트는 숨김
      expect(isHiddenProject(user, PID_PRIVATE, hidden)).toBe(true)

      // 공개 프로젝트이고 권한이 있으면 노출(false)
      expect(isHiddenProject(user, PID_PUBLIC, hidden)).toBe(false)

      // 소속 없는 프로젝트는 숨김
      expect(isHiddenProject(user, PID_NON_EXIST, hidden)).toBe(true)

      // 슈퍼유저: 비공개라도 볼 수 있으나 존재하지 않는 프로젝트는 숨김
      const su = makeSuperuser({
        projectWorkspace: new Map([[PID_PUBLIC, WS], [PID_PRIVATE, WS]]),
      })
      expect(isHiddenProject(su, PID_PRIVATE, hidden)).toBe(true) // hiddenIds에 들어있으면 숨김
      expect(isHiddenProject(su, PID_PUBLIC, hidden)).toBe(false)
      expect(isHiddenProject(su, PID_NON_EXIST, hiddenIds())).toBe(true) // 존재하지 않는 프로젝트는 숨김
    })

    it('워크스페이스 역할 판정(workspaceRoleIn, isWorkspaceAdmin)을 검증한다', () => {
      const su = makeSuperuser()
      const wsAdmin = makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })
      const wsMem = makeActor({ workspaceRoles: new Map([[WS, 'member']]) })

      expect(workspaceRoleIn(null, WS)).toBeNull()
      expect(workspaceRoleIn(su, WS)).toBe('superuser')
      expect(workspaceRoleIn(wsAdmin, WS)).toBe('admin')
      expect(workspaceRoleIn(wsMem, WS)).toBe('member')
      expect(workspaceRoleIn(wsMem, 'other-ws')).toBeNull()

      expect(isWorkspaceAdmin(su, WS)).toBe(true)
      expect(isWorkspaceAdmin(su, null)).toBe(true)
      expect(isWorkspaceAdmin(wsAdmin, WS)).toBe(true)
      expect(isWorkspaceAdmin(wsMem, WS)).toBe(false)
      expect(isWorkspaceAdmin(null, WS)).toBe(false)
    })
  })

  describe('3. 사용자 선호도 및 UI 설정 (User Preferences)', () => {
    it('계정 선호도 키와 워크스페이스 선호도 키 화이트리스트를 검증한다', () => {
      expect(ACCOUNT_PREF_KEYS).not.toContain('theme')    // 라이트 전용 결정(2026-10-10)으로 폐기
      expect(ACCOUNT_PREF_KEYS).not.toContain('locale')   // 한국어 전용 결정(2026-10-10)으로 폐기
      expect(ACCOUNT_PREF_KEYS).toContain('sidebarCollapsed')
      expect(WORKSPACE_PREF_KEYS).toContain('startPage')
      expect(WORKSPACE_PREF_KEYS).toContain('favoriteProjectIds')
      expect(WORKSPACE_PREF_KEYS).toContain('recentProjects')
    })

    it('계정 선호도와 워크스페이스 선호도를 분리하고 알 수 없는 키를 식별한다', () => {
      const raw = {
        projectsView: 'cards' as const,
        sidebarCollapsed: true,
        startPage: 'my_work' as const,
        favoriteProjectIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        heroCollapsed: true, // 은퇴된 키
        unknownKey: 'invalidValue', // 모르는 키
      }

      const { account, workspace, dropped } = splitPrefs(raw)

      expect(account).toEqual({
        projectsView: 'cards',
        sidebarCollapsed: true,
      })

      expect(workspace).toEqual({
        startPage: 'my_work',
        favoriteProjectIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      })

      expect(dropped).toContain('heroCollapsed')
      expect(dropped).toContain('unknownKey')
    })

    it('최근 방문 프로젝트(pushRecent)의 중복 제거 및 LRU 상한 관리를 검증한다', () => {
      let recents: { id: string; at: string }[] = []
      const t1 = '2026-10-06T10:00:00Z'
      const t2 = '2026-10-06T11:00:00Z'
      const t3 = '2026-10-06T12:00:00Z'

      // 프로젝트 방문
      recents = pushRecent(recents, 'p1', t1)
      expect(recents).toEqual([{ id: 'p1', at: t1 }])

      recents = pushRecent(recents, 'p2', t2)
      expect(recents).toEqual([
        { id: 'p2', at: t2 },
        { id: 'p1', at: t1 },
      ])

      // 중복 방문 시 최신 시각으로 맨 앞으로 이동
      recents = pushRecent(recents, 'p1', t3)
      expect(recents).toEqual([
        { id: 'p1', at: t3 },
        { id: 'p2', at: t2 },
      ])

      // 상한(RECENT_MAX = 10) 초과 시 가장 오래된 항목 제거
      for (let i = 3; i <= 15; i++) {
        recents = pushRecent(recents, `p${i}`, new Date(Date.now() + i * 1000).toISOString())
      }
      expect(recents.length).toBe(RECENT_MAX)
      expect(recents[0].id).toBe('p15')
      expect(recents.map(x => x.id)).not.toContain('p2')
    })

    it('계정 설정과 워크스페이스 설정을 안전하게 병합(mergePrefs)한다', () => {
      const acc = { projectsView: 'cards' as const, sidebarCollapsed: true }
      const ws = { startPage: 'home' as const, favoriteProjectIds: ['p-fav'] }

      const merged = mergePrefs(acc, ws)
      expect(merged.projectsView).toBe('cards')
      expect(merged.sidebarCollapsed).toBe(true)
      expect(merged.startPage).toBe('home')
      expect(merged.favoriteProjectIds).toEqual(['p-fav'])
    })
  })

  describe('4. 한국어 이름 정렬 및 표시 (Korean Name Sorting)', () => {
    it('가나다순 및 숫자 정렬(홍길동2 vs 홍길동10)을 올바르게 수행한다', () => {
      const names = ['홍길동10', '강감찬', '홍길동2', '김유신', '이순신']
      const sorted = [...names].sort(compareKoreanName)

      expect(sorted).toEqual(['강감찬', '김유신', '이순신', '홍길동2', '홍길동10'])
    })

    it('빈 이름이나 null/undefined는 항상 맨 뒤로 보낸다', () => {
      const names = ['홍길동', '', null, '강감찬', undefined, '   ']
      const sorted = [...names].sort(compareKoreanName)

      expect(sorted[0]).toBe('강감찬')
      expect(sorted[1]).toBe('홍길동')
      // 뒷부분은 공백/빈값들
      expect(sorted.slice(2).every(n => !n || !n.trim())).toBe(true)
    })

    it('객체 목록 정렬(sortByKoreanName) 시 원본 불변성을 유지한다', () => {
      const users = [
        { id: 'u1', name: '홍길동' },
        { id: 'u2', name: '강감찬' },
        { id: 'u3', name: '김유신' },
      ]

      const sorted = sortByKoreanName(users, u => u.name)
      expect(sorted.map(u => u.name)).toEqual(['강감찬', '김유신', '홍길동'])
      // 원본 유지 확인
      expect(users[0].name).toBe('홍길동')
    })
  })
})
