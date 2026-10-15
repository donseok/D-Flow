# 플랫폼 관리자 관리 화면 · 프로젝트 없는 멤버 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 슈퍼유저가 한 화면(`/admin/platform-admins`)에서 플랫폼 관리자 목록을 보고 이미 있는 계정을 지정·해제하게 하고, 워크스페이스 › 멤버·초대 화면이 프로젝트 없이도 열리게 한다.

**Architecture:** 권한 규칙·스키마는 그대로다(마이그레이션 없음). 지정·해제는 기존 `setPlatformAdmin`(→ RPC `set_platform_admin`)을 재사용하고, 새 서버 액션 둘(`listPlatformAdmins`·`findAccountByEmail`, `requireSuperuser`)과 새 화면 하나를 더한다. `listAccounts` 는 워크스페이스 기준으로 바꾸고 프로젝트는 선택 인자로 둔다.

**Tech Stack:** Next.js 15 App Router(서버 액션·RSC), React 19, Supabase(service_role 클라이언트), vitest(+ jsdom), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-15-platform-admin-management-design.md`

## Global Constraints

- 마이그레이션을 만들지 않는다. `supabase/migrations/*` 를 건드리지 않는다.
- UI 위험 파일(`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, 범위 레이아웃 셋, `src/components/app/*`)을 고치지 않는다. 메뉴 아이콘은 `navIcons.ts` 에 이미 있는 `UserCog` 를 쓴다.
- 문구는 한국어만, 사전(`src/lib/i18n/dict/*`)에 둔다. 서버 문구는 `src/lib/i18n/dict/serverUi.ts`(`srv.*`), 화면 문구는 `src/lib/i18n/dict/platform.ts`·`adminUi.ts`.
- 에러 3원칙: 조회 실패를 빈 목록·"없음"으로 위장하지 않는다(`{ ok: false }` + `console.error`), 보안 가드는 fail-closed.
- 서버 액션의 첫 판정은 가드다(`requireSuperuser()`·`requireWorkspaceAdmin(wid)`). `createAdminClient()` 는 가드를 넘은 뒤에만 부른다.
- 커밋: `git add -A` 금지(파일명으로 stage), 한국어 메시지("왜"), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push 하지 않는다.
- `HANDOFF.md` 는 사용자 파일이다 — 절대 stage 하지 않는다.
- 테스트는 DB 를 쓰지 않는 vitest 만 돈다(`npx vitest run <파일>`). 로컬 Supabase 를 띄우거나 리셋하지 않는다.

## Review Focus

- 프로필이 없는 `platform_admins` 행(계정 삭제 경합·시드) — 목록에서 빠지면 관리자 수가 틀린다. 행은 남고 이메일 자리에 '(프로필 없음)'이 보여야 한다. → Task 3 테스트.
- 대문자·앞뒤 공백이 섞인 이메일 검색(` Bob@Example.COM `) — 정규화 뒤 완전 일치로 찾아야 한다. → Task 3 테스트.
- 다른 워크스페이스의 프로젝트 id 를 `listAccounts` 에 넣기 — 404(`ERR_MISSING`)로 숨겨야 하고 명단을 읽으면 안 된다. → Task 1 테스트.
- 프로젝트 없는 워크스페이스에서 일괄 추가 줄에 권한('관리자')이 적힌 경우 — 조용히 버리지 않고 줄 오류. 그리고 `/p/null/members` 재검증을 부르면 안 된다. → Task 1 테스트.
- 지정·해제 실패(마지막 한 명·다른 사람이 먼저 해제) 뒤 화면이 낡은 채 남는 것 — 실패에도 `router.refresh()` 해야 한다. → Task 4 테스트.

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/app/actions/accounts.ts` | `listAccounts` 워크스페이스 기준, `bulkCreateAccounts` 프로젝트 선택, `setPlatformAdmin` 재검증 경로 추가 | 수정 (Task 1·3) |
| `src/app/(app)/w/[slug]/admin/accounts/page.tsx` | 프로젝트 없을 때도 목록 | 수정 (Task 2) |
| `src/components/admin/AccountsManager.tsx` | `projectId: string \| null` 처리 | 수정 (Task 2) |
| `src/app/actions/platformAdmins.ts` | 플랫폼 관리자 목록·계정 찾기 | 신규 (Task 3) |
| `src/lib/authz/accountsAccess.ts` | `canManagePlatformAdmins` | 수정 (Task 3) |
| `src/app/(app)/(global)/admin/platform-admins/page.tsx` | 페이지 | 신규 (Task 4) |
| `src/components/admin/PlatformAdminsManager.tsx` | 표·해제·추가 모달 | 신규 (Task 4) |
| `src/lib/nav/ids.ts`, `src/lib/nav/registry.ts` | 메뉴 항목 | 수정 (Task 4) |
| 사전 `serverUi.ts`·`platform.ts`·`adminUi.ts`·`pagesUi.ts` | 문구 | 수정 (Task 2·3·4) |
| 테스트·불변식 | 아래 각 Task | 수정·신규 |

---

### Task 1: `listAccounts` 를 워크스페이스 기준으로 — 프로젝트는 선택

**Files:**
- Modify: `src/app/actions/accounts.ts` (`bulkCreateAccounts` ~262-289, `listAccounts` ~569-650)
- Modify: `tests/gates/manifest.ts:49,55`
- Modify: `tests/actions/accounts-gate.test.ts` (`listAccounts(P1)` 호출 전부 — 186-196, 560-680 부근)

**Interfaces:**
- Produces:
  ```ts
  export async function listAccounts(input: { workspaceId: string; projectId?: string | null }): Promise<
    { ok: true; rows: AccountRow[]; workspaceId: string } | { ok: false; error: string }>
  export async function bulkCreateAccounts(workspaceId: string, text: string, projectId: string | null): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }>
  ```
  `AccountRow` 는 바뀌지 않는다. 프로젝트가 없으면 모든 행의 `accessRole` 은 null.

- [ ] **Step 1: 기존 호출을 새 시그니처로 고치고 새 실패 테스트를 더한다**

`tests/actions/accounts-gate.test.ts` 에서 `listAccounts(P1)` 를 전부 `listAccounts({ workspaceId: WS, projectId: P1 })` 로 바꾼다(기대값은 그대로). 거부 테스트(현재 ~190행)는 이렇게 된다:

```ts
  it('listAccounts 는 권한 거부를 빈 배열로 위장하지 않는다 — 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    signedInAs(WS_MEMBER)
    expect(await listAccounts({ workspaceId: WS, projectId: P1 })).toEqual({ ok: false, error: ERR_DENIED })
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    signedInAs(OTHER_WS_ADMIN)
    expect(await listAccounts({ workspaceId: WS, projectId: P1 })).toEqual({ ok: false, error: ERR_MISSING })
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
```

`describe('listAccounts — …')` 블록 끝에 새 테스트 넷을 더한다:

```ts
  it('프로젝트 없이 — 워크스페이스 소속만, 명단(project_members)을 읽지 않고 accessRole 은 모두 null', async () => {
    signedInAs(WS_ADMIN)
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'profiles') return chain({ data: [{ user_id: 'u1', email: 'kim@example.com', display_name: '김관리', created_at: '2026-09-01T00:00:00Z' }], count: 1, error: null })
        if (t === 'platform_admins') return chain({ data: [], error: null })
        if (t === 'workspace_members') return chain({ data: [{ user_id: 'u1', workspace_id: WS, role: 'admin' }], count: 1, error: null })
        throw new Error('예상치 못한 테이블 접근: ' + t)
      }),
    } as never)
    const res = await listAccounts({ workspaceId: WS })
    expect(res.ok && res.rows.map(r => [r.id, r.accessRole])).toEqual([['u1', null]])
    expect(res.ok && res.workspaceId).toBe(WS)
  })

  it('다른 워크스페이스의 프로젝트 id 는 ERR_MISSING — 명단을 읽지 않는다(존재 은닉)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    signedInAs(makeActor({ userId: 'u-wsa', workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS], ['p-b', WS_B]]) }))
    expect(await listAccounts({ workspaceId: WS, projectId: 'p-b' })).toEqual({ ok: false, error: ERR_MISSING })
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('워크스페이스 id 가 없으면 가드 전에 거부한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    signedInAs(SU)
    expect(await listAccounts({ workspaceId: '' })).toEqual({ ok: false, error: '워크스페이스를 지정해야 합니다.' })
    spy.mockRestore()
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
  })
```

그리고 `bulkCreateAccounts` 테스트들이 있는 describe 에(파일에서 `bulkCreateAccounts(` 를 찾아 그 블록 끝) 하나를 더한다:

```ts
  it('프로젝트 없이(null) 일괄 추가 — 권한이 적힌 줄은 줄 오류, 명단 재검증(/p/…/members)을 부르지 않는다', async () => {
    signedInAs(WS_ADMIN)
    accountClient()
    const { revalidatePath } = await import('next/cache')
    const res = await bulkCreateAccounts(WS, 'a@example.com,admin,password1,에이', null)
    expect(res.ok).toBe(true)
    expect(res.results).toEqual([expect.objectContaining({ ok: false, error: '권한을 줄 프로젝트를 지정하세요.' })])
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/p/'))
  })
```

> 줄 형식은 `이메일, 권한, 초기비번[, 이름]`(`src/lib/domain/accounts.ts` 의 `parseBulkAccounts`), 오류 문구는 `srv.accounts.chooseProjectGrantAccess` 의 값이다(확인함). `accountClient()` 는 이 파일의 기존 도우미다(createUser 흉내 포함). 줄 검증이 createUser 전에 끊기므로 createUser 가 불리지 않아도 된다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/accounts-gate.test.ts`
Expected: FAIL — 새 시그니처 호출이 타입·동작상 맞지 않음(현재 `listAccounts` 는 문자열 pid 를 받는다).

- [ ] **Step 3: `listAccounts` 구현을 바꾼다**

`src/app/actions/accounts.ts` 의 `listAccounts` 앞 주석과 머리·가드·조회 부분을 이렇게 바꾼다(행 조립·정렬 이하는 그대로):

```ts
/**
 * 계정 목록. **권한 거부·조회 실패를 빈 배열로 돌려주지 않는다** — 이 화면은 그 자체가 권한 정보라
 * '계정 0개'·'관리자 0명'이 곧 오정보가 되고, 관리자가 그걸 근거로 권한을 다시 부여하는 쓰기까지 유발한다.
 * 기준은 워크스페이스다(그 워크스페이스의 관리자). projectId 는 선택 — 있으면 그 프로젝트의 명단 권한 열을 채우고 명단 계정도 보이며,
 * 그 프로젝트가 이 워크스페이스의 것이 아니면 404 로 숨긴다(W11). 없으면 명단을 읽지 않고 accessRole 은 모두 null(프로젝트 없는 워크스페이스).
 */
export async function listAccounts(
  input: { workspaceId: string; projectId?: string | null },
): Promise<{ ok: true; rows: AccountRow[]; workspaceId: string } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const workspaceId = input?.workspaceId
  const projectId = input?.projectId ?? null
  const deny = (error: string) => {
    console.error('[listAccounts] 게이트 거부:', error, 'workspaceId=', workspaceId, 'projectId=', projectId)
    return { ok: false as const, error }
  }
  if (!isWorkspaceIdInput(workspaceId)) return deny(ERR_WORKSPACE_REQUIRED)
  if (projectId !== null && typeof projectId !== 'string') return deny(ERR_MISSING)
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return deny(g.error)
  if (projectId !== null && !projectInWorkspace(g.actor, projectId, workspaceId)) return deny(ERR_MISSING)
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listAccounts] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: t(ERR_LIST) }
  }

  let profiles
  try {
    profiles = await listProfiles(admin)
  } catch (e) {
    return fail('프로필', e instanceof Error ? e.message : String(e))
  }
  const [platform, wsMembers, roster] = await Promise.all([
    admin.from('platform_admins').select('user_id'),
    admin.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId),
    // 프로젝트가 없으면 명단을 읽지 않는다 — 권한 열이 없는 화면이다
    projectId
      ? admin.from('project_members').select('access_role, active, people!inner(user_id, active)').eq('project_id', projectId)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
```

나머지(`if (platform.error …)` 부터 끝까지)는 그대로 둔다. `requireProjectMember` import 가 더 쓰이지 않으면 import 목록에서 지운다(lint 가 잡는다).

- [ ] **Step 4: `bulkCreateAccounts` 의 프로젝트를 선택으로**

```ts
export async function bulkCreateAccounts(
  workspaceId: string, text: string, projectId: string | null,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
```

본문 끝의 재검증을 이렇게 바꾼다:

```ts
  revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
  if (projectId) revalidatePath(`/p/${projectId}/members`)
  return { ok: true, results }
```

(`createOne` 은 `accessRole && !input.projectId` 일 때 이미 줄별로 `srv.accounts.chooseProjectGrantAccess` 를 돌려준다 — 바꾸지 않는다. `projectId: null` 을 `createOne` 에 넘길 때 `AccountInput.projectId` 가 `string | null` 을 받는지 확인 — 이미 `projectId?: string | null` 이다.)

- [ ] **Step 5: 매니페스트 표본을 고친다**

`tests/gates/manifest.ts`:

```ts
  [`${A('accounts')}#bulkCreateAccounts`]: { ...nul('workspaceAdmin'), sample: [U, '', null] },   // typeof workspaceId 가 가드 앞
  …
  [`${A('accounts')}#listAccounts`]: { ...nul('workspaceAdmin'), sample: [{ workspaceId: U }] },   // 빈 workspaceId 는 가드 앞(isWorkspaceIdInput)
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/actions/accounts-gate.test.ts tests/gates`
Expected: PASS. (`tests/admin/workspace-admin-pages.test.tsx` 는 Task 2 에서 고친다 — 이 시점에는 타입 검사 없이 vitest 가 돌므로 그 파일의 실패 여부와 무관하게 다음 단계로 간다. 단, 이 Task 의 커밋 전에 `npx tsc --noEmit -p .` 는 페이지 호출부 때문에 실패한다 — 페이지 호출부(`listAccounts(projectId)`)를 이 Task 에서 임시로 `listAccounts({ workspaceId: scope.ws.id, projectId })` 로 고쳐 타입을 맞춘다. 화면 동작 변경은 Task 2.)

`src/app/(app)/w/[slug]/admin/accounts/page.tsx:54` 를:

```ts
  const res = await listAccounts({ workspaceId: scope.ws.id, projectId })
```

로 바꾸고 `tests/admin/workspace-admin-pages.test.tsx` 의 `toHaveBeenCalledWith(P1)` 셋을 `toHaveBeenCalledWith({ workspaceId: WS.id, projectId: P1 })`, `not.toHaveBeenCalledWith(PB)` 를 `not.toHaveBeenCalledWith(expect.objectContaining({ projectId: PB }))` 로 바꾼다. `AccountsManager` 의 `bulkCreateAccounts(workspaceId, text, projectId)` 호출은 타입이 넓어졌을 뿐이라 그대로 컴파일된다.

Run: `npx vitest run tests/actions/accounts-gate.test.ts tests/gates tests/admin/workspace-admin-pages.test.tsx && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/accounts.ts tests/gates/manifest.ts tests/actions/accounts-gate.test.ts "src/app/(app)/w/[slug]/admin/accounts/page.tsx" tests/admin/workspace-admin-pages.test.tsx
git commit -m "계정 목록을 워크스페이스 기준으로 읽는다 — 프로젝트는 고를 때만

프로젝트가 없는 워크스페이스는 계정 목록 자체를 못 읽어 멤버 화면이 막혔다.
판정 등급(워크스페이스 관리자)은 같고, 다른 워크스페이스 프로젝트는 계속 404 로 숨긴다.
일괄 추가도 프로젝트 없이 부를 수 있게 하고 /p/null 재검증을 부르지 않는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 멤버·초대 화면 — 프로젝트가 없어도 표를 그린다

**Files:**
- Modify: `src/app/(app)/w/[slug]/admin/accounts/page.tsx`
- Modify: `src/components/admin/AccountsManager.tsx`
- Modify: `src/lib/i18n/dict/adminUi.ts` (키 하나 추가), `src/lib/i18n/dict/pagesUi.ts:67-68` (키 둘 삭제)
- Modify: `tests/admin/workspace-admin-pages.test.tsx`, `tests/components/accounts-manager.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `listAccounts({ workspaceId, projectId })`, `bulkCreateAccounts(workspaceId, text, projectId: string | null)`.
- Produces: `AccountsManager` props 의 `projectId: string | null`(다른 props 불변). 사전 키 `wsAccounts.noProjectNotice`.

- [ ] **Step 1: 실패 테스트**

`tests/admin/workspace-admin-pages.test.tsx` 의 `'멤버 → /w/acme, 응답의 워크스페이스가 다르면 404, 관리할 프로젝트 0 → 빈 상태'` 테스트를 둘로 바꾼다:

```ts
  it('멤버 → /w/acme', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) })))
    await expect(accounts()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
  })
  it('관리할 프로젝트 0 → 빈 상태가 아니라 워크스페이스 계정 표(projectId null)', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(wsAdmin))
    h.listProjectsWithState.mockResolvedValue({ projects: [], degraded: false })
    const html = await renderAccounts()
    expect(html).not.toContain('관리할 프로젝트가 없습니다')
    expect(h.listAccounts).toHaveBeenCalledWith({ workspaceId: WS.id, projectId: null })
    expect(h.managerProps).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, projects: [] }))
  })
```

`tests/components/accounts-manager.test.tsx` 의 `render` 도우미에 `projectId` 인자를 더하고(기본 `'p-1'`) 테스트 하나를 더한다:

```ts
  function render(rows: AccountRow[] = [account(), BOB, CAROL, DAVE], platformOps = true, projectId: string | null = 'p-1') {
    act(() => {
      root.render(<AccountsManager accounts={rows} projectId={projectId} workspaceId="ws-1"
        projects={projectId ? [{ id: 'p-1', name: 'Acme' }] : []} canPlatformOps={platformOps} currentUserId="u-bob" />)
    })
  }
```

```ts
  it('프로젝트가 없으면 — 프로젝트 권한 열이 없고 안내 한 줄, 계정 추가 모달에 권한 선택이 없다', async () => {
    render(undefined, true, null)
    expect(headers()).not.toContain('이 프로젝트 권한')
    expect(container.querySelector('[data-access-role]')).toBeNull()
    expect(container.textContent).toContain('아직 프로젝트가 없어 프로젝트 권한은 표시하지 않습니다.')
    const addBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('계정 추가'))!
    await click(addBtn)
    const labels = Array.from(document.body.querySelectorAll('label span')).map(s => s.textContent?.trim())
    expect(labels).not.toContain('이 프로젝트 권한')
    expect(labels).toContain('워크스페이스 역할')
  })
```

> '계정 추가'·'이 프로젝트 권한'·'워크스페이스 역할' 은 `wsAccounts.add`·`wsAccounts.colProjectAccess`·`wsAccounts.colWsRole` 의 실제 사전 값으로 맞춘다(기존 테스트가 '이 프로젝트 권한'·'워크스페이스 역할' 을 쓰고 있다).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/admin/workspace-admin-pages.test.tsx tests/components/accounts-manager.test.tsx`
Expected: FAIL — 빈 상태가 그려지고, 프로젝트 권한 열이 남는다.

- [ ] **Step 3: 페이지**

`src/app/(app)/w/[slug]/admin/accounts/page.tsx` 에서 `if (!projectId) { … noProjects … }` 블록과 `if (res.ok && res.workspaceId !== scope.ws.id) notFound()` 줄을 지우고, 프로젝트 선택을 null 허용으로 바꾼다:

```ts
  // 후보 = 그 워크스페이스의, 내가 관리자인 프로젝트. 목록의 첫 항목으로 정하면 B 프로젝트 관리자가 들어왔을 때 A 가 기본값이 되어
  // 게이트에 거부당하고 화면은 그 거부를 '계정 0개'로 보여준다. 다른 워크스페이스 pid 는 ?project= 로도 고를 수 없다(W11).
  // 후보가 없으면(프로젝트 없는 워크스페이스) 프로젝트 없이 워크스페이스 계정만 그린다 — 계정 추가·등급·재설정이 막히지 않게.
  const managed = (projects as { id: string; name: string; workspace_id?: string }[])
    .filter((p) => p.workspace_id === scope.ws.id && isProjectAdmin(actor, p.id))
  const projectId = managed.some((p) => p.id === project) ? project! : (managed[0]?.id ?? null)

  const res = await listAccounts({ workspaceId: scope.ws.id, projectId })
```

`notFound` 를 더 쓰지 않으면 import 에서 지운다(`redirect` 는 남는다). `AccountsManager` 에 넘기는 `workspaceId={res.workspaceId}` 는 그대로.

- [ ] **Step 4: `AccountsManager`**

`src/components/admin/AccountsManager.tsx`:

1. props 타입: `projectId: string | null` — 주석 `/** 역할 열·역할 변경이 대상으로 삼는 프로젝트. null = 워크스페이스에 관리할 프로젝트가 없다 — 권한 열·권한 선택을 그리지 않는다 */`.
2. 표 위(카드 머리 `</div>` 다음, `<div className="p-5 sm:p-6">` 안 맨 앞)에:
   ```tsx
        {projectId === null && (
          <p data-no-project-notice className="mb-4 text-sm text-fg-secondary">{t('wsAccounts.noProjectNotice')}</p>
        )}
   ```
3. 머리 `<th …>{t('wsAccounts.colProjectAccess')}</th>` 와 셀 `<td>…<Link href={`/p/${projectId}/members`} …>` 를 `projectId !== null &&` 로 감싼다(`table` 의 `min-w-[880px]` 는 그대로).
4. `AddAccountModal` props 타입 `projectId: string | null`. 권한 칸을 조건부로:
   ```tsx
        <div className={`grid gap-3 ${projectId ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Field label={t('wsAccounts.colWsRole')}>
            <WorkspaceRoleSelect value={wsRole} onChange={setWsRole} />
          </Field>
          {projectId && (
            <Field label={t('wsAccounts.colProjectAccess')}>
              <RoleSelect value={role} onChange={setRole} />
            </Field>
          )}
        </div>
   ```
   제출은 `projectId, accessRole: projectId && role !== 'viewer' ? role : null` 로.
5. `BulkAddModal` props 타입 `projectId: string | null` — 본문은 그대로(`bulkCreateAccounts(workspaceId, text, projectId)`).

사전 `src/lib/i18n/dict/adminUi.ts` 의 `wsAccounts.*` 묶음에 추가:

```ts
  'wsAccounts.noProjectNotice': '아직 프로젝트가 없어 프로젝트 권한은 표시하지 않습니다. 프로젝트를 만든 뒤 명단에서 권한을 줍니다.',
```

`src/lib/i18n/dict/pagesUi.ts` 에서 `'pages.accounts.noProjects'`·`'pages.accounts.noProjectsDetail'` 두 줄을 지운다(다른 사용처 없음 — `grep -rn "pages.accounts.noProjects" src tests` 로 0 확인).

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/admin/workspace-admin-pages.test.tsx tests/components/accounts-manager.test.tsx tests/i18n && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0. (`tests/i18n` 이 없으면 그 인자를 빼고 `npm run test -- -t 사전` 대신 전체 `npm run test` 를 Step 6 에서 돈다.)

- [ ] **Step 6: 전체 회귀**

Run: `npm run lint && npm run test`
Expected: lint 0 오류, vitest 전부 통과(DB 가 필요한 RLS 묶음은 기존처럼 건너뛰거나 기존 결과와 같다).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/w/[slug]/admin/accounts/page.tsx" src/components/admin/AccountsManager.tsx src/lib/i18n/dict/adminUi.ts src/lib/i18n/dict/pagesUi.ts tests/admin/workspace-admin-pages.test.tsx tests/components/accounts-manager.test.tsx
git commit -m "프로젝트가 없는 워크스페이스에서도 멤버·초대 화면을 연다

관리할 프로젝트가 없으면 빈 상태만 그려 계정 추가·등급 변경·비밀번호 재설정·
플랫폼 관리자 지정이 모두 막혔다. 프로젝트가 없을 때는 권한 열과 권한 선택만 빼고
워크스페이스 계정 표를 그린다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 서버 액션 — 플랫폼 관리자 목록·이메일로 계정 찾기

**Files:**
- Create: `src/app/actions/platformAdmins.ts`
- Modify: `src/lib/authz/accountsAccess.ts` (`canManagePlatformAdmins` 추가)
- Modify: `src/app/actions/accounts.ts` (`setPlatformAdmin` 성공 뒤 재검증 경로 하나 추가)
- Modify: `src/lib/i18n/dict/serverUi.ts` (`srv.platformAdmins.*` 둘)
- Modify: `tests/invariants/platform-guards.test.ts` (15 → 17), `tests/gates/manifest.ts` (두 항목), `CLAUDE.md` (「권한」의 "플랫폼 15곳" 문장)
- Test: `tests/actions/platform-admins-gate.test.ts` (신규)

**Interfaces:**
- Produces:
  ```ts
  // src/app/actions/platformAdmins.ts
  export interface PlatformAdminPerson { userId: string; email: string | null; name: string | null }   // null = 프로필 없음
  export interface PlatformAdminRow extends PlatformAdminPerson { grantedAt: string; grantedBy: PlatformAdminPerson | null }
  export interface PlatformAdminCandidate {
    userId: string; email: string; name: string
    isPlatformAdmin: boolean
    workspaces: { name: string; role: 'admin' | 'member'; archived: boolean }[]
  }
  export async function listPlatformAdmins(): Promise<{ ok: true; rows: PlatformAdminRow[] } | { ok: false; error: string }>
  export async function findAccountByEmail(email: string): Promise<{ ok: true; account: PlatformAdminCandidate | null } | { ok: false; error: string }>
  // src/lib/authz/accountsAccess.ts
  export function canManagePlatformAdmins(actor: Pick<Actor, 'isSuperuser'> | null): boolean
  ```

- [ ] **Step 1: 실패 테스트**

`tests/actions/platform-admins-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

const { createAdminClient, requireSuperuser } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => { throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다') }),
  requireSuperuser: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireSuperuser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { listPlatformAdmins, findAccountByEmail } from '@/app/actions/platformAdmins'
import { canManagePlatformAdmins } from '@/lib/authz/accountsAccess'
import { makeActor, makeSuperuser } from '../fixtures/actor'

type Result = { data?: unknown; error: { message: string } | null }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) c[m] = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, Mock<(...a: unknown[]) => unknown>> & PromiseLike<Result>
}
const SU = makeSuperuser({ userId: 'u-su' })
const DENIED = { ok: false as const, error: '권한 없음' }

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => { throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다') })
  requireSuperuser.mockReset()
})

describe('canManagePlatformAdmins', () => {
  it('플랫폼 관리자만 참, 열화(null)는 거짓', () => {
    expect(canManagePlatformAdmins(SU)).toBe(true)
    expect(canManagePlatformAdmins(makeActor())).toBe(false)
    expect(canManagePlatformAdmins(null)).toBe(false)
  })
})

describe('listPlatformAdmins', () => {
  it('플랫폼 관리자가 아니면 거부 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await listPlatformAdmins()).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('지정 일시 순 목록 + 지정한 사람 — 프로필 없는 행도 빠지지 않는다(null)', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'platform_admins') return chain({ data: [
          { user_id: 'u-su', granted_by: null, granted_at: '2026-10-14T00:00:00Z' },
          { user_id: 'u-b', granted_by: 'u-su', granted_at: '2026-10-15T00:00:00Z' },
          { user_id: 'u-gone', granted_by: 'u-x', granted_at: '2026-10-15T01:00:00Z' },
        ], error: null })
        if (t === 'profiles') return chain({ data: [
          { user_id: 'u-su', email: 'su@example.com', display_name: '수퍼' },
          { user_id: 'u-b', email: 'b@example.com', display_name: '비' },
        ], error: null })
        throw new Error('예상치 못한 테이블 접근: ' + t)
      }),
    } as never)
    expect(await listPlatformAdmins()).toEqual({ ok: true, rows: [
      { userId: 'u-su', email: 'su@example.com', name: '수퍼', grantedAt: '2026-10-14T00:00:00Z', grantedBy: null },
      { userId: 'u-b', email: 'b@example.com', name: '비', grantedAt: '2026-10-15T00:00:00Z', grantedBy: { userId: 'u-su', email: 'su@example.com', name: '수퍼' } },
      { userId: 'u-gone', email: null, name: null, grantedAt: '2026-10-15T01:00:00Z', grantedBy: { userId: 'u-x', email: null, name: null } },
    ] })
  })

  it.each(['platform_admins', 'profiles'])('%s 조회 실패는 { ok: false } — 빈 목록으로 위장하지 않는다', async (bad) => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => t === bad
        ? chain({ data: null, error: { message: 'boom' } })
        : chain({ data: t === 'platform_admins' ? [{ user_id: 'u-su', granted_by: null, granted_at: 'x' }] : [], error: null })),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listPlatformAdmins()).toEqual({ ok: false, error: '플랫폼 관리자 목록을 불러오지 못했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('findAccountByEmail', () => {
  function client(o: { profile?: Result; platform?: Result; members?: Result } = {}) {
    const profiles = chain(o.profile ?? { data: { user_id: 'u-b', email: 'bob@example.com', display_name: '밥' }, error: null })
    const from = vi.fn((t: string) => {
      if (t === 'profiles') return profiles
      if (t === 'platform_admins') return chain(o.platform ?? { data: null, error: null })
      if (t === 'workspace_members') return chain(o.members ?? { data: [
        { role: 'admin', workspaces: { name: '알파', archived_at: null } },
        { role: 'member', workspaces: { name: '베타', archived_at: '2026-10-01T00:00:00Z' } },
      ], error: null })
      throw new Error('예상치 못한 테이블 접근: ' + t)
    })
    createAdminClient.mockReturnValue({ from } as never)
    return { profiles }
  }

  it('플랫폼 관리자가 아니면 거부 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await findAccountByEmail('bob@example.com')).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('정규화(공백·대문자) 뒤 완전 일치로 찾고 소속 워크스페이스(보관 표시 포함)를 싣는다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    const { profiles } = client()
    expect(await findAccountByEmail('  Bob@Example.COM ')).toEqual({ ok: true, account: {
      userId: 'u-b', email: 'bob@example.com', name: '밥', isPlatformAdmin: false,
      workspaces: [{ name: '알파', role: 'admin', archived: false }, { name: '베타', role: 'member', archived: true }],
    } })
    expect(profiles.eq).toHaveBeenCalledWith('email', 'bob@example.com')
  })

  it('이미 플랫폼 관리자면 isPlatformAdmin true', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client({ platform: { data: { user_id: 'u-b' }, error: null } })
    const res = await findAccountByEmail('bob@example.com')
    expect(res.ok && res.account?.isPlatformAdmin).toBe(true)
  })

  it('없으면 account: null', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client({ profile: { data: null, error: null } })
    expect(await findAccountByEmail('nobody@example.com')).toEqual({ ok: true, account: null })
  })

  it('형식이 아니면 오류 문구 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    expect(await findAccountByEmail('not-an-email')).toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['profiles', { profile: { data: null, error: { message: 'boom' } } }],
    ['platform_admins', { platform: { data: null, error: { message: 'boom' } } }],
    ['workspace_members', { members: { data: null, error: { message: 'boom' } } }],
  ] as const)('%s 조회 실패는 { ok: false } — "계정 없음"으로 위장하지 않는다', async (_t, o) => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client(o)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await findAccountByEmail('bob@example.com')).toEqual({ ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/platform-admins-gate.test.ts`
Expected: FAIL — `@/app/actions/platformAdmins` 가 없다.

- [ ] **Step 3: 사전·판정자**

`src/lib/i18n/dict/serverUi.ts` 의 `srv.accounts.*` 근처에:

```ts
  'srv.platformAdmins.listFailed': '플랫폼 관리자 목록을 불러오지 못했습니다.',
  'srv.platformAdmins.lookupFailed': '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.',
```

`src/lib/authz/accountsAccess.ts` 의 `canManageWorkspaceAccounts` 아래에:

```ts
/**
 * 플랫폼 관리자 관리 화면(/admin/platform-admins) — 플랫폼 관리자만. 페이지가 이 판정으로 404 를 가르고, 목록·찾기 액션은
 * requireSuperuser 로, 지정·해제는 setPlatformAdmin(requireSuperuser → RPC set_platform_admin) 이 다시 가드한다.
 * actor 가 null(권한 조회 실패)이면 거짓 — fail-closed.
 */
export function canManagePlatformAdmins(actor: Pick<Actor, 'isSuperuser'> | null): boolean {
  return actor?.isSuperuser === true
}
```

- [ ] **Step 4: 액션 파일**

`src/app/actions/platformAdmins.ts`:

```ts
'use server'
// 플랫폼 관리자(슈퍼유저) 관리 화면의 조회 둘 — 목록과 이메일로 계정 찾기. 지정·해제는 새로 만들지 않는다:
// accounts.ts 의 setPlatformAdmin(requireSuperuser → RPC set_platform_admin — 행위자 재판정·명령 멱등·authz_events·마지막 한 명 트리거) 한 길이다.
// 계정을 여기서 만들지 않는다(설계 결정 A) — 없는 이메일은 화면이 멤버·초대 화면으로 안내한다.
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalEmail } from '@/lib/domain/email'
import { isWorkspaceAdminRole } from '@/lib/domain/authz'
import { serverTranslator } from '@/lib/i18n/server'

/** email·name 이 null = 프로필 행이 없다(계정 삭제 경합·시드). 행은 빼지 않는다 — 빼면 관리자 수가 틀린다 */
export interface PlatformAdminPerson { userId: string; email: string | null; name: string | null }
export interface PlatformAdminRow extends PlatformAdminPerson {
  grantedAt: string
  /** 지정한 사람. null = granted_by 가 비었다(첫 관리자 시드·지운 계정의 SET NULL) */
  grantedBy: PlatformAdminPerson | null
}
export interface PlatformAdminCandidate {
  userId: string; email: string; name: string
  isPlatformAdmin: boolean
  /** 소속 워크스페이스 — 지정 전 "이 사람이 맞나" 판단용 표시. 보관된 것도 싣고 archived 로 표시한다 */
  workspaces: { name: string; role: 'admin' | 'member'; archived: boolean }[]
}

/**
 * 플랫폼 관리자 전부(지정 일시 순). **조회 실패를 빈 목록으로 돌려주지 않는다** — '관리자 0명'은 오정보이고
 * 그걸 근거로 한 재지정 쓰기를 부른다(listAccounts 와 같은 원칙).
 */
export async function listPlatformAdmins(): Promise<{ ok: true; rows: PlatformAdminRow[] } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listPlatformAdmins] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: t('srv.platformAdmins.listFailed') }
  }
  const pa = await admin.from('platform_admins').select('user_id, granted_by, granted_at').order('granted_at').order('user_id')
  if (pa.error || !pa.data) return fail('플랫폼 관리자', pa.error?.message)
  const rows = pa.data as Array<{ user_id: string; granted_by: string | null; granted_at: string }>
  const ids = [...new Set(rows.flatMap((r) => (r.granted_by ? [r.user_id, r.granted_by] : [r.user_id])))]
  // 플랫폼 관리자는 몇 명뿐이다 — 한 번의 in 으로 읽는다(지정한 사람 포함)
  const pr = await admin.from('profiles').select('user_id, email, display_name').in('user_id', ids)
  if (pr.error || !pr.data) return fail('프로필', pr.error?.message)
  const by = new Map((pr.data as Array<{ user_id: string; email: string; display_name: string }>)
    .map((p) => [p.user_id, { userId: p.user_id, email: p.email, name: p.display_name }]))
  const person = (id: string): PlatformAdminPerson => by.get(id) ?? { userId: id, email: null, name: null }
  return {
    ok: true,
    rows: rows.map((r) => ({ ...person(r.user_id), grantedAt: r.granted_at, grantedBy: r.granted_by ? person(r.granted_by) : null })),
  }
}

/**
 * 이메일 완전 일치로 계정 하나를 찾는다(정규형 — 계정·프로필은 canonicalEmail 로 저장된다). 부분 검색은 하지 않는다.
 * 없으면 account: null. 조회 실패는 { ok: false } — '계정 없음'으로 위장하면 관리자가 없는 계정을 만들러 간다.
 */
export async function findAccountByEmail(
  email: string,
): Promise<{ ok: true; account: PlatformAdminCandidate | null } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const canon = typeof email === 'string' ? canonicalEmail(email) : null
  if (!canon) return { ok: false, error: t('err.emailFormatNotValid') }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[findAccountByEmail] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: t('srv.platformAdmins.lookupFailed') }
  }
  // 같은 이메일 행이 둘이면 maybeSingle 이 오류를 낸다 — 고르지 않고 실패로 닫는다
  const pr = await admin.from('profiles').select('user_id, email, display_name').eq('email', canon).maybeSingle()
  if (pr.error) return fail('프로필', pr.error.message)
  if (!pr.data) return { ok: true, account: null }
  const p = pr.data as { user_id: string; email: string; display_name: string }
  const [pa, wm] = await Promise.all([
    admin.from('platform_admins').select('user_id').eq('user_id', p.user_id).maybeSingle(),
    admin.from('workspace_members').select('role, workspaces!inner(name, archived_at)').eq('user_id', p.user_id),
  ])
  if (pa.error) return fail('플랫폼 관리자', pa.error.message)
  if (wm.error || !wm.data) return fail('워크스페이스 소속', wm.error?.message)
  type W = { name: string; archived_at: string | null }
  const workspaces = (wm.data as unknown as Array<{ role: string; workspaces: W | W[] }>).map((m) => {
    const w = Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces
    return { name: w.name, role: isWorkspaceAdminRole(m.role) ? 'admin' as const : 'member' as const, archived: w.archived_at !== null }
  })
  return { ok: true, account: { userId: p.user_id, email: p.email, name: p.display_name, isPlatformAdmin: !!pa.data, workspaces } }
}
```

- [ ] **Step 5: `setPlatformAdmin` 재검증**

`src/app/actions/accounts.ts` 의 `setPlatformAdmin` 성공 경로(`return { ok: true }` 직전)를:

```ts
  revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
  revalidatePath('/admin/platform-admins')
  return { ok: true }
```

- [ ] **Step 6: 불변식·매니페스트·문서**

`tests/invariants/platform-guards.test.ts`: 머리 주석 끝에 한 줄을 더하고 `EXPECTED` 에 둘을 더한 뒤 describe 이름을 고친다.

```ts
// + 플랫폼 관리자 목록·계정 찾기 둘(2026-10-15 — 플랫폼 관리자 관리 화면. 워크스페이스와 무관한 전역 명단이라 워크스페이스 가드로는 열 수 없다) = 17곳.
```

```ts
  'src/app/actions/platformAdmins.ts#findAccountByEmail', 'src/app/actions/platformAdmins.ts#listPlatformAdmins',
```

```ts
describe('플랫폼 가드 17곳(D1 의 11 − 비밀번호 재설정 + 워크스페이스 목록·생성·삭제·보관·복원 + 플랫폼 관리자 목록·찾기)', () => {
```

`tests/gates/manifest.ts` 의 `platformWorkspaces` 묶음 위에:

```ts
  // ── platformAdmins — 플랫폼(플랫폼 관리자 목록·이메일로 계정 찾기. 지정·해제는 accounts#setPlatformAdmin)
  [`${A('platformAdmins')}#listPlatformAdmins`]: nul('superuser'),
  [`${A('platformAdmins')}#findAccountByEmail`]: nul('superuser'),
```

`CLAUDE.md` 「권한」의 "`requireSuperuser` 는 플랫폼 15곳(… + 워크스페이스 목록·생성·삭제·보관·복원 `src/app/actions/platformWorkspaces.ts` 다섯)뿐이다." 를 "플랫폼 17곳(… 다섯 + 플랫폼 관리자 목록·계정 찾기 `src/app/actions/platformAdmins.ts` 둘)" 로 고친다(그 문장만).

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/actions/platform-admins-gate.test.ts tests/invariants/platform-guards.test.ts tests/gates tests/actions/accounts-gate.test.ts && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0. 열거 게이트가 `.from('…')` 표 목록이나 `admin client` 감사 문서(`docs/sp2-admin-client-audit.md`)를 요구하면 그 메시지대로 항목을 더한다(service_role 클라이언트 신규 사용 — 분류: "플랫폼 관리자 전용 조회, requireSuperuser 뒤").

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/platformAdmins.ts src/lib/authz/accountsAccess.ts src/app/actions/accounts.ts src/lib/i18n/dict/serverUi.ts tests/actions/platform-admins-gate.test.ts tests/invariants/platform-guards.test.ts tests/gates/manifest.ts CLAUDE.md
# docs/sp2-admin-client-audit.md 를 고쳤다면 그것도 파일명으로 더한다
git commit -m "플랫폼 관리자 목록과 이메일로 계정 찾기 액션을 더한다

슈퍼유저가 누가 플랫폼 관리자인지 한곳에서 보고, 이미 있는 계정을 찾아
지정할 수 있게 한다. 지정·해제는 기존 setPlatformAdmin(RPC) 한 길을 그대로 쓴다.
조회 실패는 빈 목록이나 '계정 없음'으로 위장하지 않는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 플랫폼 관리자 화면과 메뉴

**Files:**
- Create: `src/app/(app)/(global)/admin/platform-admins/page.tsx`
- Create: `src/components/admin/PlatformAdminsManager.tsx`
- Modify: `src/lib/nav/ids.ts`, `src/lib/nav/registry.ts`
- Modify: `src/lib/i18n/dict/platform.ts`
- Modify: `tests/nav/nav-ids.test.ts`, `tests/nav/nav-for.test.ts`, `tests/invariants/module-page-gates.test.ts`
- Test: `tests/ui/platform-admins-admin.test.tsx` (신규)

**Interfaces:**
- Consumes: Task 3 의 `listPlatformAdmins`·`findAccountByEmail`·`PlatformAdminRow`·`PlatformAdminCandidate`·`canManagePlatformAdmins`, 기존 `setPlatformAdmin(userId: string, value: boolean): Promise<{ ok: boolean; error?: string }>`.
- Produces: 라우트 `/admin/platform-admins`, 내비 id `ws.platform_admins`, 컴포넌트 `PlatformAdminsManager({ rows, currentUserId, accountsHref })`.

- [ ] **Step 1: 실패 테스트**

`tests/ui/platform-admins-admin.test.tsx`:

```tsx
// @vitest-environment jsdom
// /admin/platform-admins — 플랫폼 관리자만(나머지·열화 = 404). 목록·해제(본인 잠금)·이메일로 찾아 지정.
import { act, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render } from '../shell/_dom'
import { makeActor, makeSuperuser } from '../fixtures/actor'
import { KO } from '@/lib/i18n/dict/ko'
import type { PlatformAdminRow } from '@/app/actions/platformAdmins'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(), listPlatformAdmins: vi.fn(), findAccountByEmail: vi.fn(), setPlatformAdmin: vi.fn(),
  readCurrentWorkspace: vi.fn(), toast: vi.fn(), refresh: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/app/actions/platformAdmins', () => ({ listPlatformAdmins: mocks.listPlatformAdmins, findAccountByEmail: mocks.findAccountByEmail }))
vi.mock('@/app/actions/accounts', () => ({ setPlatformAdmin: mocks.setPlatformAdmin }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: mocks.readCurrentWorkspace }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: keyof typeof KO) => KO[k] ?? k }) }))

import PlatformAdminsPage from '@/app/(app)/(global)/admin/platform-admins/page'
import { PlatformAdminsManager } from '@/components/admin/PlatformAdminsManager'

const ROWS: PlatformAdminRow[] = [
  { userId: 'u-su', email: 'su@example.com', name: '수퍼', grantedAt: '2026-10-14T00:00:00Z', grantedBy: null },
  { userId: 'u-b', email: 'b@example.com', name: '비', grantedAt: '2026-10-15T00:00:00Z', grantedBy: { userId: 'u-su', email: 'su@example.com', name: '수퍼' } },
  { userId: 'u-gone', email: null, name: null, grantedAt: '2026-10-15T01:00:00Z', grantedBy: null },
]
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const setValue = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const button = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: 'w1', slug: 'alpha', name: '알파' } })
  mocks.listPlatformAdmins.mockResolvedValue({ ok: true, rows: ROWS })
  mocks.setPlatformAdmin.mockResolvedValue({ ok: true })
})

describe('/admin/platform-admins 페이지', () => {
  const html = async () => renderToStaticMarkup((await PlatformAdminsPage()) as ReactElement)
  it('플랫폼 관리자가 아니면 404 — 목록 액션을 부르지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeActor())
    await expect(PlatformAdminsPage()).rejects.toThrow('404')
    expect(mocks.listPlatformAdmins).not.toHaveBeenCalled()
  })
  it('권한 조회 열화(actor null)도 404', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    await expect(PlatformAdminsPage()).rejects.toThrow('404')
  })
  it('목록 조회 실패는 표 대신 blocking 오류 — "0명"으로 그리지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser({ userId: 'u-su' }))
    mocks.listPlatformAdmins.mockResolvedValue({ ok: false, error: '플랫폼 관리자 목록을 불러오지 못했습니다.' })
    const out = await html()
    expect(out).toContain('data-status-kind="partial_error"')
    expect(out).not.toContain('data-platform-admin-row')
  })
  it('목록 — 행 셋, 프로필 없는 행은 (프로필 없음)', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser({ userId: 'u-su' }))
    const out = await html()
    expect(out.match(/data-platform-admin-row=/g)).toHaveLength(3)
    expect(out).toContain('b@example.com')
    expect(out).toContain(KO['platformAdmins.noProfile'])
  })
})

describe('PlatformAdminsManager', () => {
  function mount() {
    return render(<PlatformAdminsManager rows={ROWS} currentUserId="u-su" accountsHref="/w/alpha/admin/accounts" />)
  }
  it('본인 행의 해제는 잠기고, 다른 행은 확인 뒤 setPlatformAdmin(id, false) → refresh', async () => {
    const { container } = mount()
    const selfBtn = container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-su"] [data-platform-admin-unset]')!
    expect(selfBtn.disabled).toBe(true)
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.setPlatformAdmin).toHaveBeenCalledWith('u-b', false)
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('해제 거부(마지막 한 명 등)는 문구를 토스트하고 그래도 refresh — 낡은 표를 남기지 않는다', async () => {
    mocks.setPlatformAdmin.mockResolvedValue({ ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' })
    const { container } = mount()
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: expect.stringContaining('마지막 슈퍼유저') }))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('추가 — 찾기: 지정 가능한 계정이면 소속을 보이고 지정 → setPlatformAdmin(id, true)', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: {
      userId: 'u-c', email: 'c@example.com', name: '씨', isPlatformAdmin: false,
      workspaces: [{ name: '알파', role: 'admin', archived: false }, { name: '베타', role: 'member', archived: true }],
    } })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'c@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(mocks.findAccountByEmail).toHaveBeenCalledWith('c@example.com')
    expect(document.body.textContent).toContain('알파')
    expect(document.body.textContent).toContain(KO['platformAdmins.archived'])
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(mocks.setPlatformAdmin).toHaveBeenCalledWith('u-c', true)
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('추가 — 이미 관리자면 지정 버튼 없이 안내', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: { userId: 'u-b', email: 'b@example.com', name: '비', isPlatformAdmin: true, workspaces: [] } })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'b@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.textContent).toContain(KO['platformAdmins.already'])
    expect(document.body.querySelector('[data-platform-admin-grant]')).toBeNull()
  })
  it('추가 — 계정이 없으면 멤버·초대 화면 링크', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: null })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'none@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.textContent).toContain(KO['platformAdmins.notFound'])
    expect(document.body.querySelector('a[href="/w/alpha/admin/accounts"]')).not.toBeNull()
  })
  it('추가 — 조회 실패는 오류 문구, 입력은 유지', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    const input = document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!
    setValue(input, 'x@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('계정을 조회하지 못했습니다')
    expect(input.value).toBe('x@example.com')
  })
})
```

> `render` 는 `tests/shell/_dom` 의 도우미다(`tests/ui/workspaces-admin.test.tsx` 와 같은 쓰임) — 반환 형태(`{ container }` 등)를 그 파일에서 확인하고 맞춘다.

`tests/nav/nav-ids.test.ts`: 25 → 26, `'ws.platform': ['ws.workspaces', 'ws.platform_admins', 'ws.llm', 'ws.ui_states']`, 머리 주석에 "+ 플랫폼 관리자 관리 ws.platform_admins = 26개".
`tests/nav/nav-for.test.ts`: 80행 목록·99행 기대·111행 `isPlatformAdmin` 목록에 `'ws.platform_admins'` 를 `'ws.workspaces'` 바로 뒤에 넣는다(order 7 — workspaces 5 와 llm 10 사이).
`tests/invariants/module-page-gates.test.ts` 의 제외 목록(26행 근처)에:

```ts
  'src/app/(app)/(global)/admin/platform-admins/page.tsx': '플랫폼 관리(플랫폼 관리자 목록·지정) — 모듈 밖',
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/platform-admins-admin.test.tsx tests/nav tests/invariants/module-page-gates.test.ts`
Expected: FAIL — 페이지·컴포넌트·내비 id 가 없다.

- [ ] **Step 3: 사전**

`src/lib/i18n/dict/platform.ts` 의 `'nav.workspaces'` 다음과 워크스페이스 묶음 뒤에:

```ts
  'nav.platformAdmins': '플랫폼 관리자',
```

```ts
  // 플랫폼 관리자(/admin/platform-admins)
  'platformAdmins.title': '플랫폼 관리자',
  'platformAdmins.desc': '모든 워크스페이스와 플랫폼 운영 화면(워크스페이스 관리·LLM 설정·사용 현황)을 다루는 계정입니다.',
  'platformAdmins.listTitle': '플랫폼 관리자 {n}명',
  'platformAdmins.colName': '이름',
  'platformAdmins.colEmail': '이메일',
  'platformAdmins.colGrantedBy': '지정한 사람',
  'platformAdmins.colGrantedAt': '지정 일시',
  'platformAdmins.colActions': '작업',
  'platformAdmins.noProfile': '(프로필 없음)',
  'platformAdmins.unset': '해제',
  'platformAdmins.unsetTitle': '플랫폼 관리자 해제',
  'platformAdmins.add': '플랫폼 관리자 추가',
  'platformAdmins.emailLabel': '계정 이메일',
  'platformAdmins.find': '찾기',
  'platformAdmins.finding': '찾는 중…',
  'platformAdmins.already': '이미 플랫폼 관리자입니다.',
  'platformAdmins.noWorkspaces': '소속 워크스페이스 없음',
  'platformAdmins.archived': '(보관됨)',
  'platformAdmins.grant': '지정',
  'platformAdmins.notFound': '이 이메일의 계정이 없습니다. 워크스페이스 › 멤버·초대에서 먼저 계정을 만드세요.',
  'platformAdmins.goAccounts': '멤버·초대로 가기',
  'platformAdmins.listError': '플랫폼 관리자 목록을 불러오지 못했습니다',
  'platformAdmins.listErrorDetail': '잠시 뒤 다시 시도하세요. 계속되면 서버 로그의 [listPlatformAdmins] 를 확인하세요.',
```

해제·지정 확인 문구·완료 토스트·실패 제목은 기존 키를 쓴다: `wsAccounts.platform.unsetConfirm`·`wsAccounts.platform.setConfirm`·`wsAccounts.platform.unsetDone`·`wsAccounts.platform.setDone`·`wsAccounts.changeFailed`·`wsAccounts.requestFailedShort`·`wsAccounts.selfPlatformHint`·`common.cancel`·`wsAccounts.role.admin`·`wsAccounts.role.member`.

- [ ] **Step 4: 내비**

`src/lib/nav/ids.ts`: 머리 주석의 "25개" → "26개(+ 플랫폼 관리자 관리의 ws.platform_admins)". `NAV_ITEM_IDS` 의 `'ws.workspaces',` 뒤에 `'ws.platform_admins',`, `NAV_GROUP_OF` 에 `'ws.platform_admins': 'ws.platform',`.

`src/lib/nav/registry.ts` 의 `SHELL_NAV` 에서 `ws.workspaces` 줄 다음에:

```ts
  // 플랫폼 관리자 목록·지정·해제(2026-10-15) — 아이콘은 표(navIcons)에 있는 이름(UI 위험 파일을 고치지 않는다)
  { id: 'ws.platform_admins', labelKey: 'nav.platformAdmins', icon: 'UserCog', segment: '/admin/platform-admins', group: 'ws.platform', order: 7, scope: 'workspace', needs: 'isPlatformAdmin' },
```

`NAV_DEFAULT_LABEL_KEY` 의 주석 "25개 id 전부" → "26개 id 전부".

- [ ] **Step 5: 페이지**

`src/app/(app)/(global)/admin/platform-admins/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canManagePlatformAdmins } from '@/lib/authz/accountsAccess'
import { t } from '@/lib/i18n/dict'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { wsHref } from '@/lib/workspace/paths'
import { listPlatformAdmins } from '@/app/actions/platformAdmins'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { PlatformAdminsManager } from '@/components/admin/PlatformAdminsManager'

export const dynamic = 'force-dynamic' // 목록은 항상 최신 DB 값을 읽는다

/**
 * 플랫폼 관리자 목록·지정·해제 — (global) 라우트 그룹, 플랫폼 관리자만(나머지·열화 = 404, /admin/workspaces 관례).
 * 판정은 canManagePlatformAdmins 이고 목록·찾기 액션은 requireSuperuser, 지정·해제는 setPlatformAdmin 이 다시 가드한다.
 * 플랫폼 관리라 모듈 관문 밖이다(페이지 관문 불변식 제외 목록).
 */
export async function generateMetadata() { return { title: t('nav.platformAdmins') } }
export default async function PlatformAdminsPage() {
  const actor = await getActorForView()
  if (!canManagePlatformAdmins(actor)) notFound()
  const [res, cur] = await Promise.all([listPlatformAdmins(), readCurrentWorkspace()])
  // 없는 계정의 안내 링크 — 계정은 워크스페이스 멤버·초대 화면에서 만든다(소속이 없거나 못 읽으면 링크 없이 문구만)
  const accountsHref = cur.ok && cur.ws ? wsHref(cur.ws.slug, 'admin/accounts') : null
  return (
    <div className="space-y-6">
      <PageHeader title={t('platformAdmins.title')} description={t('platformAdmins.desc')} />
      {res.ok ? (
        <PlatformAdminsManager rows={res.rows} currentUserId={actor!.userId} accountsHref={accountsHref} />
      ) : (
        // 조회 실패를 '관리자 0명'으로 그리지 않는다(3원칙 ①) — 원인은 서버 로그에 남았다
        <StatusMessage kind="partial_error" blocking title={t('platformAdmins.listError')} detail={t('platformAdmins.listErrorDetail')} />
      )}
    </div>
  )
}
```

(`canManagePlatformAdmins` 가 참이면 actor 는 null 이 아니다 — `actor!` 대신 타입 좁힘이 안 되면 `if (!actor || !canManagePlatformAdmins(actor)) notFound()` 로 쓴다. `PageHeader` 는 `src/components/app/` 의 기존 컴포넌트를 import 만 한다 — 수정 아님.)

- [ ] **Step 6: 컴포넌트**

`src/components/admin/PlatformAdminsManager.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ShieldOff, Search, UserPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { setPlatformAdmin } from '@/app/actions/accounts'
import { findAccountByEmail, type PlatformAdminCandidate, type PlatformAdminRow } from '@/app/actions/platformAdmins'

/** 플랫폼 관리자 표 + 해제 + 이메일로 찾아 지정. 판정은 전부 서버(setPlatformAdmin·RPC·트리거)가 다시 한다 — 화면의 잠금은 어포던스다. */
export function PlatformAdminsManager({ rows, currentUserId, accountsHref }: {
  rows: PlatformAdminRow[]
  /** 보는 사람 — 본인 행의 해제를 잠근다(액션도 거부) */
  currentUserId: string
  /** 없는 계정 안내의 멤버·초대 링크. null = 링크 없이 문구만 */
  accountsHref: string | null
}) {
  const { t } = useLocale()
  const [unsetting, setUnsetting] = useState<PlatformAdminRow | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-fg">{t('platformAdmins.listTitle').replace('{n}', String(rows.length))}</h2>
        <button onClick={() => setAdding(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />{t('platformAdmins.add')}</button>
      </div>
      <div className="overflow-x-auto p-5 sm:p-6">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">{t('platformAdmins.colName')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colEmail')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colGrantedBy')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colGrantedAt')}</th>
              <th className="py-2 pr-3 text-right">{t('platformAdmins.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.userId === currentUserId
              return (
                <tr key={r.userId} data-platform-admin-row={r.userId} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 font-medium text-fg">{r.name ?? '—'}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">{r.email ?? t('platformAdmins.noProfile')}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">{r.grantedBy ? (r.grantedBy.name ?? r.grantedBy.email ?? t('platformAdmins.noProfile')) : '—'}</td>
                  <td className="py-2.5 pr-3 text-fg-muted">{r.grantedAt.slice(0, 10)}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex justify-end">
                      <button
                        data-platform-admin-unset
                        className="btn btn-ghost btn-sm disabled:opacity-50"
                        disabled={isSelf}
                        title={isSelf ? t('wsAccounts.selfPlatformHint') : t('platformAdmins.unsetTitle')}
                        onClick={() => setUnsetting(r)}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />{t('platformAdmins.unset')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <UnsetModal row={unsetting} onClose={() => setUnsetting(null)} />
      <AddModal open={adding} onClose={() => setAdding(false)} accountsHref={accountsHref} />
    </div>
  )
}

/** 지정·해제 한 번 — 성공·실패 모두 refresh 한다(거부는 표가 낡았다는 신호다: 다른 관리자가 먼저 바꿨거나 마지막 한 명이 됐다) */
function useToggle() {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const run = (userId: string, label: string, value: boolean, done: () => void) => startTransition(async () => {
    try {
      const res = await setPlatformAdmin(userId, value)
      if (res.ok) toast({ title: value ? t('wsAccounts.platform.setDone') : t('wsAccounts.platform.unsetDone'), description: label, variant: 'success' })
      else toast({ title: t('wsAccounts.changeFailed'), description: res.error, variant: 'error' })
      router.refresh()
    } catch {
      toast({ title: t('wsAccounts.changeFailed'), description: t('wsAccounts.requestFailedShort'), variant: 'error' })
    } finally {
      done()
    }
  })
  return { pending, run }
}

function UnsetModal({ row, onClose }: { row: PlatformAdminRow | null; onClose: () => void }) {
  const { t } = useLocale()
  const { pending, run } = useToggle()
  const label = row?.email ?? row?.userId ?? ''
  return (
    <Modal
      open={row !== null}
      onClose={() => { if (!pending) onClose() }}
      size="sm"
      title={t('platformAdmins.unsetTitle')}
      footer={
        <>
          <button className="btn btn-ghost" disabled={pending} onClick={onClose}>{t('common.cancel')}</button>
          <button data-platform-admin-confirm className="btn btn-primary" disabled={pending || !row}
            onClick={() => row && run(row.userId, label, false, onClose)}>{t('platformAdmins.unset')}</button>
        </>
      }
    >
      <p className="text-sm leading-6 text-fg-secondary">
        <strong className="break-all text-fg">{label}</strong>{t('wsAccounts.platform.unsetConfirm')}
      </p>
    </Modal>
  )
}

type Lookup = { kind: 'idle' } | { kind: 'found'; account: PlatformAdminCandidate } | { kind: 'none' } | { kind: 'error'; message: string }

function AddModal({ open, onClose, accountsHref }: { open: boolean; onClose: () => void; accountsHref: string | null }) {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' })
  const [finding, startFind] = useTransition()
  const { pending, run } = useToggle()

  useEffect(() => { if (open) { setEmail(''); setLookup({ kind: 'idle' }) } }, [open])

  const find = () => startFind(async () => {
    try {
      const res = await findAccountByEmail(email)
      if (!res.ok) setLookup({ kind: 'error', message: res.error })
      else setLookup(res.account ? { kind: 'found', account: res.account } : { kind: 'none' })
    } catch {
      setLookup({ kind: 'error', message: t('wsAccounts.requestFailedShort') })
    }
  })
  const busy = finding || pending

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      title={t('platformAdmins.add')}
      footer={<button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('platformAdmins.emailLabel')}</span>
          <div className="flex gap-2">
            <input data-platform-admin-email className="app-input" type="email" value={email} autoFocus
              onChange={(e) => { setEmail(e.target.value); setLookup({ kind: 'idle' }) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && !busy) find() }} placeholder="user@company.com" />
            <button className="btn btn-ghost shrink-0" disabled={busy || !email.trim()} onClick={find}>
              <Search className="h-4 w-4" />{finding ? t('platformAdmins.finding') : t('platformAdmins.find')}
            </button>
          </div>
        </label>

        {lookup.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{lookup.message}</p>}

        {lookup.kind === 'none' && (
          <div className="space-y-2 text-sm text-fg-secondary">
            <p>{t('platformAdmins.notFound')}</p>
            {accountsHref && <Link href={accountsHref} className="font-medium text-action underline">{t('platformAdmins.goAccounts')}</Link>}
          </div>
        )}

        {lookup.kind === 'found' && (
          <div className="space-y-3 rounded-(--radius-panel) border border-border p-4 text-sm">
            <div>
              <p className="font-semibold text-fg">{lookup.account.name}</p>
              <p className="break-all text-fg-secondary">{lookup.account.email}</p>
            </div>
            <ul className="space-y-0.5 text-fg-secondary">
              {lookup.account.workspaces.length === 0
                ? <li>{t('platformAdmins.noWorkspaces')}</li>
                : lookup.account.workspaces.map((w, i) => (
                  <li key={`${w.name}-${i}`}>
                    {w.name}{w.archived ? ` ${t('platformAdmins.archived')}` : ''} · {t(w.role === 'admin' ? 'wsAccounts.role.admin' : 'wsAccounts.role.member')}
                  </li>
                ))}
            </ul>
            {lookup.account.isPlatformAdmin ? (
              <p className="font-medium text-fg">{t('platformAdmins.already')}</p>
            ) : (
              <>
                <p className="leading-6 text-fg-secondary">
                  <strong className="break-all text-fg">{lookup.account.email}</strong>{t('wsAccounts.platform.setConfirm')}
                </p>
                <button data-platform-admin-grant className="btn btn-primary" disabled={busy}
                  onClick={() => { const a = (lookup as { account: PlatformAdminCandidate }).account; run(a.userId, a.email, true, onClose) }}>
                  <ShieldCheck className="h-4 w-4" />{t('platformAdmins.grant')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

> `rounded-(--radius-panel)` 과 lucide `ShieldOff` 는 이 리포에 있다(확인함). 상태 변형 display 유틸(`group-hover:flex` 등)은 쓰지 않는다(CLAUDE.md CSS 규칙).

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/ui/platform-admins-admin.test.tsx tests/nav tests/invariants tests/domain/usage-menu.test.ts && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 0. 라우트 문자열 불변식(`tests/invariants/route-literals.test.ts`)·사용 현황 메뉴 키 테스트가 새 경로를 요구하면 그 메시지대로 목록에 더한다.

- [ ] **Step 8: 전체 검증**

Run: `npm run lint && npm run test && npm run build`
Expected: lint 0 오류, vitest 전부 통과, build 성공(라우트 표에 `/admin/platform-admins` 가 보인다).

- [ ] **Step 9: 로컬 화면 확인(사람이 볼 수 있게 기록만)**

이 Task 는 UI 위험 파일을 건드리지 않으므로 Preview 트레일러가 필요 없다. 실행자는 dev 서버를 띄우지 않는다(사용자의 :3000·메인 DB 를 건드리지 않는다). 확인 항목을 보고서에 적는다: 사이드바 플랫폼 묶음에 '플랫폼 관리자'가 '워크스페이스 관리' 다음에 보임, 표·해제·추가 모달 세 갈래, 멤버·초대 화면의 프로젝트 없는 상태.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/(global)/admin/platform-admins/page.tsx" src/components/admin/PlatformAdminsManager.tsx src/lib/nav/ids.ts src/lib/nav/registry.ts src/lib/i18n/dict/platform.ts tests/ui/platform-admins-admin.test.tsx tests/nav/nav-ids.test.ts tests/nav/nav-for.test.ts tests/invariants/module-page-gates.test.ts
# 불변식 목록을 더 고쳤다면 그 파일도 파일명으로 더한다
git commit -m "플랫폼 관리자 화면을 더한다 — 목록·해제·이메일로 찾아 지정

슈퍼유저 지정 칩이 워크스페이스 멤버 화면의 행에만 있어 누가 플랫폼 관리자인지
한곳에서 볼 수 없었다. 플랫폼 메뉴에 화면을 두고, 지정·해제는 기존
setPlatformAdmin 한 길을 그대로 쓴다. 아이콘은 표에 있는 것을 써 UI 위험 파일은 건드리지 않는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
