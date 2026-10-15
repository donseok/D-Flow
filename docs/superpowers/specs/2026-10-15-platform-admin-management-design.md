# 플랫폼 관리자 관리 화면 · 프로젝트 없는 멤버 화면 — 설계

2026-10-15. 브레인스토밍 결정(사용자 승인): 범위 C(플랫폼 관리자 화면 + 멤버 화면 보강), 지정 대상 A(이미 있는 계정만), 프로젝트 관리자 부여 A(워크스페이스 관리자 이상).

## 1. 배경 — 지금 상태

권한 4등급은 이미 있다(`src/lib/domain/authz.ts`, CLAUDE.md 「권한」).

| 등급 | 저장 | 비고 |
|---|---|---|
| 플랫폼 관리자(슈퍼유저) | `platform_admins` | 모든 워크스페이스·플랫폼 운영 화면 |
| 워크스페이스 관리자 | `workspace_members.role='admin'` | 그 워크스페이스 모든 프로젝트의 관리자를 승계 |
| 프로젝트 관리자/멤버 | `project_members.access_role` | null·명단 밖 = 조회 전용 |

플랫폼 관리자 지정·해제의 서버 길도 이미 완결돼 있다 — `setPlatformAdmin`(`requireSuperuser`) → DEFINER RPC `set_platform_admin`(0012 — service_role 전용,
행위자 재판정, 명령 멱등, `authz_events` 기록), 마지막 한 명 보호는 트리거 `platform_admins_keep_last`(0011, advisory 잠금), 본인 해제는 액션이 거부한다.
RLS 테스트 `tests/rls/h2-platform-admins.test.ts` 가 이 길을 검증한다.

프로젝트 관리자 부여 규칙(결정 A)도 이미 그대로다 — 관리자 행(새 값·옛 값 중 하나가 admin)의 쓰기는 워크스페이스 관리자 이상만:
RPC `upsert_project_member`(0011 ④ `PROJECT_MEMBER_ADMIN_SLOT`), RLS `admin_write_member_rows`·`wsadmin_write_admin_rows`, 명단 삭제는 세션 경로(RLS 판정),
관리자 초대는 `requireWorkspaceAdmin`, 화면은 `src/lib/domain/roster.ts` 의 셀 잠금. 프로젝트 관리자의 본인 강등·비활성은 `PROJECT_MEMBER_SELF_DEMOTE`.
**이 작업은 권한 규칙·스키마를 바꾸지 않는다. 마이그레이션 없음.**

빈 곳은 화면이다.

1. 플랫폼 관리자 전체 목록을 보는 곳이 없다 — 지정 칩은 워크스페이스 › 멤버·초대 화면의 계정 행에만 있다.
2. 그 멤버 화면은 프로젝트가 하나라도 있어야 목록을 그린다(`src/app/(app)/w/[slug]/admin/accounts/page.tsx` — 관리 대상 프로젝트가 없으면 빈 상태).
   새 워크스페이스에서는 계정 추가·등급 변경·비밀번호 재설정·플랫폼 관리자 지정이 모두 막힌다.
3. 지정 대상이 지금 보는 워크스페이스의 계정으로 한정된다.

## 2. 플랫폼 관리자 화면 `/admin/platform-admins`

### 2.1 경로·메뉴

- 페이지: `src/app/(app)/(global)/admin/platform-admins/page.tsx`. `/admin/workspaces` 와 같은 꼴 — `getActorForView()` → 플랫폼 관리자가 아니면(열화 포함) `notFound()`.
  판정 함수는 `src/lib/authz/accountsAccess.ts` 에 새로 두는 `canManagePlatformAdmins(actor)`(= `actor?.isSuperuser === true`)다 — 화면별 판정자 관례
  (`canManageWorkspaces` 를 빌려 쓰지 않는다). 플랫폼 관리라 모듈 관문 밖이다(페이지 관문 불변식의 제외 목록에 더한다).
- 메뉴: `SHELL_NAV` 에 `{ id: 'ws.platform_admins', labelKey: 'nav.platformAdmins', icon: 'UserCog', segment: '/admin/platform-admins', group: 'ws.platform', order: 7, scope: 'workspace', needs: 'isPlatformAdmin' }`.
  아이콘은 `navIcons.ts` 에 이미 있는 `UserCog` 를 쓴다 — UI 위험 파일(`src/components/app/*`)을 고치지 않는다. 항목 id 는 `src/lib/nav/ids.ts` 에 더하고,
  `NAV_DEFAULT_LABEL_KEY` 개수를 고정하는 테스트(`tests/nav/registry.test.ts`)를 고친다.
- 소속이 없는 플랫폼 관리자의 시작 화면(`NoWorkspaceView`)에도 링크를 둘지: 두지 않는다(YAGNI — 메뉴는 워크스페이스 층에 있고 소속 0 은 첫 설치 직후뿐이다).

### 2.2 서버 액션 — `src/app/actions/platformAdmins.ts` (신규)

```ts
export interface PlatformAdminRow {
  userId: string; email: string | null; name: string | null   // null = 프로필 없음 — 화면이 '(프로필 없음)'으로 그린다
  grantedAt: string                      // platform_admins.granted_at
  grantedBy: { userId: string; email: string | null; name: string | null } | null   // granted_by 가 null(지운 계정·시드)이면 null
}
listPlatformAdmins(): Promise<{ ok: true; rows: PlatformAdminRow[] } | { ok: false; error: string }>

export interface PlatformAdminCandidate {
  userId: string; email: string; name: string
  isPlatformAdmin: boolean
  workspaces: { name: string; role: 'admin' | 'member'; archived: boolean }[]   // 보관된 것도 싣는다 — 화면이 이름 뒤에 '(보관됨)'을 붙인다. 판단 근거 표시용
}
findAccountByEmail(email: string): Promise<
  { ok: true; account: PlatformAdminCandidate | null } | { ok: false; error: string }>
```

- 둘 다 첫 줄이 `requireSuperuser()` 다. `tests/invariants/platform-guards.test.ts` 의 닫힌 목록을 15 → 17 로 고치고 머리 주석에 사유를 적는다.
  `tests/gates/manifest.ts` 에 두 항목을 `nul('superuser')` 로 더한다.
- `listPlatformAdmins`: `platform_admins` 전부(service_role) + `profiles`(이메일·이름). 정렬은 지정 일시 오름차순.
  **조회 실패는 `{ ok: false }` 다 — 빈 배열로 돌려주지 않는다**(관리자 0명 오정보가 재부여 쓰기를 부른다, `listAccounts` 와 같은 원칙).
  `platform_admins` 행이 있는데 프로필이 없으면 그 행을 빼지 않고 이메일 자리에 `(프로필 없음)` 꼴로 보인다(숨기면 관리자 수가 틀린다).
- `findAccountByEmail`: 입력을 `canonicalEmail` 로 정규화해 `profiles.email` **완전 일치**로 찾는다(부분 검색 없음). 형식이 안 맞으면 오류 문구.
  못 찾으면 `{ ok: true, account: null }`. 조회 실패는 `{ ok: false }` — "계정 없음"으로 위장하지 않는다.
- 지정·해제는 새로 만들지 않는다 — 기존 `setPlatformAdmin(userId, value)` 를 부른다. 성공 뒤 그 액션의 `revalidatePath` 에 `/admin/platform-admins` 를 더한다.

### 2.3 화면 — `src/components/admin/PlatformAdminsManager.tsx` (신규, client)

- 머리: 제목 '플랫폼 관리자', 설명 '모든 워크스페이스와 플랫폼 운영 화면(워크스페이스 관리·LLM 설정·사용 현황)을 다루는 계정입니다.'
- 표: 이름 · 이메일 · 지정한 사람 · 지정 일시 · 동작(해제).
  - 본인 행의 해제 버튼은 잠그고 툴팁 '다른 플랫폼 관리자가 해제합니다'(기존 `SELF_PLATFORM_HINT_KEY` 재사용).
  - 해제는 확인 창(기존 `wsAccounts.platform.unsetConfirm` 문구 재사용) → `setPlatformAdmin(id, false)` → 성공 토스트·`router.refresh()`. 실패는 액션 문구를 그대로 토스트
    (마지막 한 명 = `srv.accounts.lastSuperuser`).
- '플랫폼 관리자 추가' 버튼 → 모달: 이메일 입력 → '찾기' → `findAccountByEmail`.
  - 있음·이미 관리자: '이미 플랫폼 관리자입니다.' 지정 버튼 없음.
  - 있음·아님: 이름·이메일·소속 워크스페이스(이름·등급) → '지정' → 확인 문구(기존 `setConfirm` 재사용) → `setPlatformAdmin(id, true)`.
  - 없음: '이 이메일의 계정이 없습니다. 워크스페이스 › 멤버·초대에서 먼저 계정을 만드세요.' + 현재 워크스페이스의 멤버 화면 링크
    (페이지가 `readCurrentWorkspace()` 로 `accountsHref` 를 넘긴다 — `/admin/workspaces` 와 같은 꼴, 없으면 링크 없이 문구만).
  - 조회 실패: 오류 문구(입력 유지).
- 목록 조회 실패는 페이지가 `StatusMessage kind="partial_error" blocking` 으로 그린다(표를 그리지 않는다).
- 문구는 사전 `src/lib/i18n/dict/adminUi.ts` 에 `platformAdmins.*` 키로 한국어만.

## 3. 멤버·초대 화면 — 프로젝트가 없어도 연다

### 3.1 `listAccounts` 시그니처

```ts
listAccounts(input: { workspaceId: string; projectId?: string | null }): Promise<
  { ok: true; rows: AccountRow[]; workspaceId: string } | { ok: false; error: string }>
```

- 가드: `workspaceId` 형식 검사 → `requireWorkspaceAdmin(workspaceId)`. (지금은 `requireProjectMember(pid)` → 그 프로젝트의 워크스페이스로 `requireWorkspaceAdmin` — 판정 등급은 같다.)
- `projectId` 가 있으면 `g.actor.projectWorkspace.get(projectId) === workspaceId` 가 아니면 `ERR_MISSING`(404 — 다른 워크스페이스·없는 프로젝트를 숨긴다).
- 행 = 그 워크스페이스 소속 계정 ∪ (프로젝트가 있으면) 그 프로젝트 명단의 계정. 프로젝트가 없으면 명단 조회를 하지 않고 `accessRole` 은 모두 null.
- `AccountRow` 는 바꾸지 않는다. 나머지(플랫폼 관리자 플래그는 플랫폼 관리자에게만, 행별 판정, 정렬, 조회 실패 = `{ ok: false }`)는 그대로.
- 반환의 `workspaceId` 는 입력과 같다 — 페이지의 "슬러그와 다른 워크스페이스" 검사는 의미가 없어지므로 지운다.

### 3.2 페이지 `src/app/(app)/w/[slug]/admin/accounts/page.tsx`

- 프로젝트 목록 조회 실패(`list.degraded`)의 오류 화면은 그대로 둔다(못 읽은 것을 "프로젝트 없음"으로 그리지 않는다).
- 관리 대상 프로젝트가 없으면 빈 상태로 끝내지 않고 `listAccounts({ workspaceId: scope.ws.id, projectId: null })` 로 목록을 그린다.
- 있으면 지금처럼 `?project=` 또는 첫 프로젝트를 골라 `listAccounts({ workspaceId: scope.ws.id, projectId })`.
- 빈 상태 문구 `pages.accounts.noProjects`·`noProjectsDetail` 은 지운다(사전에서도).

### 3.3 `AccountsManager`

- `projectId: string | null` 로 바꾼다. null 이면:
  - '프로젝트 권한' 열을 그리지 않는다(머리·셀 모두).
  - 표 위에 안내 한 줄: '아직 프로젝트가 없어 프로젝트 권한은 표시하지 않습니다. 프로젝트를 만든 뒤 명단에서 권한을 줍니다.'
  - 계정 추가 모달은 프로젝트 권한 선택을 숨기고 `projectId: null, accessRole: null` 로 보낸다(서버는 이미 허용한다).
  - 일괄 추가 모달은 그대로 보낸다 — 줄에 권한이 적혀 있으면 서버(`createOne`)가 이미 줄별로 `srv.accounts.chooseProjectGrantAccess` 를 돌려준다(확인함 — 조용히 버리지 않는다).
    `bulkCreateAccounts(workspaceId, text, projectId)` 의 셋째 인자는 `string | null` 로 넓히고, null 이면 `revalidatePath(`/p/${projectId}/members`)` 를 건너뛴다.
- 프로젝트가 있을 때의 동작·마크업은 바꾸지 않는다.

## 4. 오류 처리

- 목록·검색 조회 실패는 성공의 빈 값으로 돌려주지 않는다(3원칙 ①). 로그는 `[listPlatformAdmins]`·`[findAccountByEmail]` 머리로 남긴다.
- 쓰기 판정은 전부 기존 액션·RPC 가 한다 — 화면의 잠금은 어포던스일 뿐이다(본인 해제는 액션이, 마지막 한 명은 트리거가 다시 거부).

## 5. 테스트

- `tests/actions/platform-admins-gate.test.ts`: 두 액션 — 비플랫폼 관리자 거부, 조회 실패 → `{ ok: false }`, 이메일 정규화·완전 일치, 없음 → `account: null`,
  프로필 없는 관리자 행이 빠지지 않음.
- `tests/ui/platform-admins-admin.test.tsx`: 페이지 — 비플랫폼 관리자·열화 404, 목록 실패 시 blocking 상태, 본인 행 해제 잠금, 검색 세 갈래(이미 관리자·지정 가능·없음 + 링크).
- `tests/actions/accounts-gate.test.ts`: 새 시그니처로 갱신 — 프로젝트 없는 목록, 다른 워크스페이스 프로젝트 id → `ERR_MISSING`, 프로젝트 있는 경우 기존 기대 유지.
- 멤버 화면 UI: 프로젝트 없음 → 표가 그려지고 프로젝트 권한 열·추가 모달의 권한 선택이 없다.
- 불변식: `platform-guards`(17곳), `tests/gates/manifest.ts`, 페이지 관문 제외 목록, 메뉴 레지스트리 개수.
- RPC·트리거는 바뀌지 않으므로 RLS 테스트를 새로 만들지 않는다.

## 6. 배포

- 마이그레이션 없음 — 코드 커밋만. `main` push = 운영 배포이므로 push 는 사람 확인 뒤, push 전 `npm run lint`·`npm run test`·`npm run build`, 뒤에 스모크·CI 확인.
- UI 위험 파일을 건드리지 않는다(아이콘 재사용). 구현 중 `src/components/app/*` 수정이 필요해지면 브랜치 + `Preview-checked: local …` 트레일러로 간다.

## 7. 범위 밖

- 플랫폼 관리자 화면에서 계정 생성(결정 A로 제외).
- 계정 자체 삭제.
- 멤버 화면의 기존 플랫폼 관리자 칩 제거(두 화면이 같은 액션을 부른다 — 유지).
- 비밀번호 재설정 링크(로그인 화면)의 메일 경로.
