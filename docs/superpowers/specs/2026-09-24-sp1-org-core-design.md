# SP1 — 조직 코어: 사람·명단+권한 통합·다중 팀·담당 영역 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-24 |
| 상태 | 초안 — 사용자 검토 대기 |
| 상위 정본 | `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §2(조직·권한 모델 — 테이블·Actor·헬퍼·RLS 정의)와 §6.2 SP1(범위·done_when). 이 문서는 §2 를 **SP1 에서 실제로 구현하는 부분**과 **SP2 로 넘기는 부분**으로 가르고, SP0 결과(로컬 우선·마이그레이션 번호·부트스트랩)에 맞춰 바꾸는 항목만 적는다. 테이블 컬럼·제약·트리거·헬퍼 본문은 §2.3~2.4 가 정본이며 여기 반복하지 않는다 |
| 선행 | SP0 완료(`sp0-done` = `0e0ceaf`, 마이그레이션 `0000`·`0001`·`0002`) |
| 마이그레이션 | `0003_org_core.sql` + `supabase/rollbacks/0003_org_core_rollback.sql` |

## 1. 전제와 결정

### 1.1 사용자 결정(2026-09-24)

| # | 결정 | 귀결 |
|---|---|---|
| U1 | 진행 방식은 "가장 효과적인 방법으로 알아서" — 컨트롤러가 2단계 구성을 택함 | **Phase A(스키마·판정·데이터 접근) → Phase B(화면)** 한 스펙·한 플랜. Phase A 끝에서 `main` 이 배포 가능 상태(전체 스위트·tsc·CI 초록, 기존 화면이 새 스키마 위에서 동작)여야 하고, 그 지점이 상위 스펙 R2 의 "분할 체크포인트"다 |
| U2 | (SP0 승계) 로컬 우선 — 원격 스테이징·Vercel 없음 | done_when 의 "스테이징 실측"은 로컬 `db:reset` + 로컬 RLS 테스트 + 로컬 dev 눈확인으로 정의 |
| U3 | (SP0 승계) 원본 고객 흔적 금지 | 새 시드·픽스처·화면 문구에 고객명·실명 없음. 업무 어휘(팀 코드 등)는 값 제약을 두지 않는다 |

### 1.2 상위 스펙 대비 변경

| 상위 스펙 | 이 문서 | 근거 |
|---|---|---|
| SP1 마이그레이션 `0002_org_core.sql` | **`0003_org_core.sql`**. §6.3 배정표는 SP1 부터 번호가 하나씩 밀린다(SP2 `0004` …) | SP0 이 `0002` 를 물려받은 `import_wbs`/`replace_wbs` 결함 수정에 썼다 |
| `workspaces` "시드 1행" | 마이그레이션은 행을 만들지 않는다. **`npm run dev:bootstrap` 이 워크스페이스 1행 + 플랫폼 관리자 + 워크스페이스 관리자 + `profiles` + `people` 을 만든다**(5절) | 로컬 DB 는 비어 있고 `db:reset` 은 계정까지 지운다(SP0 CLAUDE.md). 시드 SQL 에 워크스페이스를 박으면 slug·이름이 리포에 고정된다 |
| `getActor` ③ 축 "RLS 가 내 워크스페이스로 좁힌다" | `buildActor` 가 **명시 필터**(`workspace_id in (내 워크스페이스)`, 플랫폼 관리자는 전부)로 읽는다 | SP1 에서는 `projects` 읽기 정책이 아직 개방(SP2 가 닫음). admin 클라이언트 경로(`actorFromUser`)도 같은 함수를 쓰므로 어차피 명시 필터가 필요하다(§2.4.4 "user_id 명시 필터" 와 같은 이유) |
| 프로젝트 생성·삭제 가드 `requireWorkspaceAdmin`(SP2) | SP1 은 서버 가드 **`requireSuperuser` 유지**, RLS insert/delete 정책만 `is_ws_admin(workspace_id)` 로 교체. `createProject` 의 `workspace_id` 는 5.3 규칙 | `requireWorkspaceAdmin` 은 SP2 범위(상위 §6.2 "범위 제외"). RLS 는 스키마와 같은 파일에서 바꿔야 두 번 고치지 않는다 |
| `app_role()` 삭제(SP2) | SP1 에서 **본문만 새 표 위로 재작성**(반환값 `'pmo_admin'|'team_editor'|null` 유지), 삭제와 8개 정책 교체는 SP2 | `app_role()` 이 `project_roles` 를 읽는다. 표를 지우면서 본문을 두면 회의록 정책 8개(`minute_files`·`minute_folders`·`minute_highlights`)가 그 자리에서 깨진다(§2.6 ②의 원칙) |
| `current_team()` | SP1 에서 **삭제** | `memberships` 를 읽고 호출처가 0건(기준선 grep) |
| `tests/rls` 신설(SP2) | SP1 이 **골격을 먼저 만든다** — 로컬 DB 에 `set local role authenticated` 세션으로 조직 코어 케이스만(7.3). 전수 교차 조회는 SP2 | done_when "RLS 에서 각각 통과/거부"를 손 실측이 아니라 자동 테스트로 남기기 위해 |
| tsc 게이트(SP0 §11 이월) | SP1 첫 작업: 물려받은 테스트 타입 오류 28건 정리 + CI `tsc --noEmit` | R2 대응 — Actor 형 변경이 82파일에 닿으므로 타입 회귀를 CI 가 잡아야 한다 |
| `teams.color` 소비(→ §3 설정 카탈로그) | SP1 은 컬럼만 추가하고 화면은 SP0 의 해시 슬롯 팔레트(`teamColor.ts`)를 유지. 컬럼 값은 팀 생성 시 앱이 팔레트에서 배정 | 소비처 교체는 SP3/SP4 몫. 지금 바꾸면 UI 위험 파일(`shared.tsx`)을 두 번 건드린다 |

### 1.3 비목표

- 읽기 격리(`accessible_project_ids`·`using (true)` 교체·부모 조인 정책)·storage/realtime 정책·워크스페이스 전환 UI·`/w/[slug]`·`requireWorkspaceAdmin`·`resolveScope`·`adminFor`(전부 SP2)
- `workspace_settings`·설정 승격·모듈 토글·`INVITE_ALLOWED_DOMAINS` 의 설정 승격(SP3~SP5). 초대 도메인은 SP0 의 env `INVITE_ALLOWED_DOMAINS` 그대로
- `integration_credentials`·외부 API 의 `Actor` 통합(`actorFromCredential` 등, SP7). SP1 은 외부 API 판정부에서 폐기 표를 읽는 자리만 최소 교체(3.5)
- `agent_projects`·`agent_runners`·`project_settings` 무변경
- 담당 영역의 소비 컬럼(`weekly_report_rows.area_id`·`issues.area_id`, SP4/SP5). SP1 은 `project_areas`·`area_teams` 표와 관리 화면만
- `minutes.team_code → team_id`(SP5), `teams/master.ts` 폐기(SP4)

## 2. 마이그레이션 `0003_org_core.sql`

한 파일이다(§2.6 ①·②). 아래 표는 "무엇을 어디서" 만 적고 정의는 §2.3 을 가리킨다. 순서는 의존 순이며, 표를 지우기 전에 그 표를 읽는 함수·정책을 먼저 바꾼다.

### 2.1 신설

| 객체 | 정본 | SP1 메모 |
|---|---|---|
| `workspaces` | §2.3.1 | RLS 읽기 `id in (select my_workspace_ids())`. 쓰기 정책 없음 |
| `platform_admins` | §2.3.1 | 읽기 `user_id = auth.uid() or is_superuser()` / 쓰기 `is_superuser()` |
| `profiles` | §2.3.1 | `auth.users` 트리거 없음. 계정 생성 액션·초대 RPC·부트스트랩이 insert |
| `workspace_members` + 트리거 `workspace_members_keep_last_admin` | §2.3.1·2.3.8 | |
| `people` + 트리거 `people_unlink_revokes_access` | §2.3.2·2.3.8 | `kind` 생성 컬럼. 유니크 3개·인덱스 1개. **컬럼 권한**(2026-09-25 판정, Task 3 리뷰로 확장): `revoke insert, update on people from authenticated` 뒤 `grant insert (workspace_id, display_name, email)`·`grant update (display_name, email, updated_at)` 만 — `user_id`·`workspace_id`·`active` 는 세션 경로에서 쓸 수 없다. 상위 §2.3.2 의 쓰기 정책만으로는 프로젝트 관리자가 (a) 인물을 다른 계정에 재연결하거나 (b) 임의 `user_id` 로 인물을 만들어 워크스페이스 밖 계정에 프로젝트 권한을 주거나 (c) 타 프로젝트 관리자를 `active=false` 로 내려 권한을 회수하는 경로가 열린다(전부 로컬 재현). 계정↔인물 연결·비활성화는 service_role 액션·RPC 만 한다 |
| `project_member_teams` + 트리거 `project_member_teams_guard` | §2.3.4 | |
| `project_areas`·`area_teams` + 트리거 2개 | §2.3.5 | SP1 에서는 행을 소비하는 컬럼이 없다 |
| 헬퍼 `my_workspace_ids`·`is_ws_member`·`is_ws_admin`·`project_ws`·`accessible_project_ids`·`my_member_id`·`my_team_ids`·`is_project_admin_anywhere_in_ws` | §2.4.5 | `accessible_project_ids` 는 SP2 의 읽기 정책이 쓸 함수. 새 표(`project_member_teams`·`project_areas`·`area_teams`)의 읽기 정책은 스펙 RLS 줄 그대로 이 함수를 부르며, SP1 동안 `projects` 읽기가 개방이라 결과는 전체 프로젝트와 같다(SP2 가 좁힌다) |
| RPC `upsert_project_member(p_actor, p_project_id, p_person jsonb, p_member jsonb, p_team_ids uuid[])` | §2.4.5 말미 | `security definer`, `grant execute … to service_role` 만. 세 규칙(관리자 슬롯·본인 회수 금지·계정 없는 사람에게 권한 불가)을 본문에서 판정 |

### 2.2 재정의

| 객체 | 변경 | 정본 |
|---|---|---|
| `projects` | `workspace_id uuid not null → workspaces on delete restrict`, `projects_id_ws_uidx`, `projects_ws_idx`. insert/delete 정책 `su_insert_projects`·`su_delete_projects` → `is_ws_admin(workspace_id)`. **트리거 `projects_guard`**(2026-09-25 판정): `workspace_id` 변경을 모든 경로에서 거부(23514 `PROJECT_WORKSPACE_IMMUTABLE`) — 기준선 `admin_update_projects` 가 프로젝트 관리자에게 전체 컬럼 update 를 허용해 프로젝트를 다른 워크스페이스로 옮기는 크로스테넌트 경로가 있었다(Task 3 리뷰 Critical). **읽기 정책은 무변경**(SP2) | §2.3.3 |
| `teams` | `workspace_id not null`, `color text not null check`, `teams_ws_project_code_key unique nulls not distinct (workspace_id, project_id, code)`(현 `(project_id, code)` 대체), `teams_id_ws_uidx`, 트리거 `teams_guard`. 공용 행 쓰기 정책 `su_insert_teams`·`su_update_teams` → `project_id is null and is_ws_admin(workspace_id)` | §2.3.4 |
| `project_members` | 컬럼 `name`·`email`·`team_id`·`role`·`user_id` **삭제**, `person_id not null → people on delete restrict`·`access_role`·`active`·`sort_order`·`access_granted_by`·`access_granted_at`·`updated_at` 추가. 유니크 `(project_id, person_id)`, `project_members_id_project_uidx` 유지. 트리거 `project_members_guard`·`project_members_no_self_demote` 신설, `project_members_normalize_link_trg`·`zz_project_member_email_identity_trg` 삭제. 쓰기 정책 `admin_write_members` → `admin_write_member_rows`(`is_project_admin(project_id) and access_role is distinct from 'admin'`) + `wsadmin_write_admin_rows`(`is_ws_admin(project_ws(project_id))`). **읽기 `read_all_members`(`using true`)는 무변경**(SP2) | §2.3.3 |
| 담당자 FK 승격 | `attendance_records.member_id` 단일 FK 삭제(복합만 유지); `meeting_attendees.project_id not null` + 복합 FK 2건 + `meetings_id_project_uidx` + **단일 `meeting_id` FK 삭제**; `notification_recipients.project_id null` + 복합 FK `(member_id, project_id)` + CHECK + `notification_events_id_project_uidx`, 사건과의 project 일치는 **복합 FK 대신 트리거 `notification_recipients_event_project_guard`**(단일 `event_id` FK 유지). 편차 근거(2026-09-25, Task 11 E2E 실측): 같은 표 쌍에 FK 가 둘이면 PostgREST 임베드가 PGRST201 로 모호해져 회의·알림 조회가 빈 값이 된다. 프로젝트 없는 수신자는 복합 FK 가 MATCH SIMPLE 로 검사를 건너뛰므로 존재·cascade 는 단일 FK 가 맡는다 | §2.3.3 FK 표 |
| `project_invites` | `workspace_id not null`, `access_role`(null 허용)·`role_label`·`team_ids uuid[]`(현 `team_id not null` 삭제)·`token_hash`(현 `token` 평문 삭제)·`revoked_at` 정리, 부분 유니크·인덱스·트리거 `project_invites_guard`. 정책 0개·service_role 전용 유지 | §2.3.3 |
| RPC `consume_project_invite(p_token_hash, p_email, p_user)` | 본문 재작성 — 단일 UPDATE 술어 유지 + `profiles` upsert → `people` 연결 → `workspace_members(member)` → `project_members` upsert → `project_member_teams` 전개. 반환 `(workspace_id, project_id, member_id)` | §2.3.3 |
| 헬퍼 본문 교체(이름·시그니처 유지) | `is_superuser()`(→ `platform_admins`), `is_project_admin(pid)`·`is_project_member(pid)`(→ `project_members ⨝ people`, 워크스페이스 관리자 승계 포함), `can_read_project(pid)`(→ `is_ws_member(project_ws(pid))` — 호출처는 `0079` 위키 정책 3개·storage 경로뿐이라 SP1 에서 바꿔도 읽기 폭이 "워크스페이스 멤버"로 좁혀질 뿐 화면 영향 없음), `can_attach(item)`(→ `my_team_ids`) | §2.4.5 |
| `app_role()` | 본문만 재작성: `is_superuser()` 또는 어느 프로젝트든 `access_role='admin'`(계정 연결된 `people`) → `'pmo_admin'`, 어느 프로젝트든 `access_role is not null` → `'team_editor'`, 아니면 null. **삭제는 SP2** | 1.2 |
| 정책 `member_update_actual` | `o.team_id in (select my_team_ids(wbs_items.project_id))` 로 교체(using·with check 둘 다) | §2.4.6 쓰기 ① |
| RPC `create_issue_from_minute_block` | 담당자 검증 블록(기준선 2094~2106행)이 `project_members(id, project_id)` 만 읽으므로 **텍스트 무변경**. 마이그레이션 리허설에서 호출 테스트로 확인 | — |

### 2.3 폐기

| 객체 | 비고 |
|---|---|
| `memberships`·`project_roles`·`project_member_identities` | 표와 함께 정책 5개(`read_all_memberships`·`read_all_project_roles`·`admin_write_member_roles`·`su_write_admin_roles`·`su_write_memberships`)·인덱스·FK 가 사라진다. `drop table … cascade` 는 쓰지 않는다 — 의존 객체가 남아 있으면 실패하게 두고(2.2 에서 전부 먼저 바꿨음을 검증), 실패하면 마이그레이션이 잘못된 것이다 |
| 함수 `current_team`·`enforce_project_member_email_identity`·`project_members_normalize_link`·`update_project_member_with_identity` | 소비처는 3절·4절에서 함께 제거 |

### 2.4 롤백 `0003_org_core_rollback.sql`

`0002` 롤백과 같은 방식 — 새 객체를 지우고, 기준선 `0000` 의 정의 텍스트로 표·함수·정책·트리거를 복원한다. 데이터 이관이 없으므로 데이터 보존 절차는 없다. `tests/invariants/migration-files.test.ts` 가 쌍 존재를 검사한다. 리허설: `npm run db:reset`(0000→0003 적용) → 롤백 SQL 적용 → `scripts/baseline-diff.mjs --snapshot` 류의 카탈로그 비교가 `0002` 적용 직후와 같음을 확인하는 절차를 플랜에 둔다.

### 2.5 SP1/SP2 경계 요약

| 남는 것(SP2 가 처리) | 왜 SP1 에서 안 하나 |
|---|---|
| `read_all_*`·`using (true)` 읽기 정책 전부, 부모 조인 자식 표, `agent_watchers.workspace_id` | 조직 모델이 굳은 뒤 한 번에(§6.1 순서 근거) |
| `minutes`·`minute_folders`·`notification_events`·`usage_events`·`ai_*` 의 `workspace_id` | 같은 이유. SP1 은 프로젝트 없는 행을 워크스페이스에 잇지 않는다 |
| `app_role()` 삭제 + 회의록 정책 8개 | 1.2 |
| storage/realtime 정책 재작성·경로 규약 | SP2 |

## 3. 서버 판정 계층

### 3.1 `src/lib/domain/authz.ts`

§2.4.2 의 Actor 최종형 그대로. 이 SP 에서 실제로 바뀌는 항목만:

- `Actor` 에서 `teamCode`·`teamId` 삭제, `workspaceRoles`·`projectWorkspace`·`memberIds` 추가, `rosterTeams` 값을 `{ teamIds[], teamCodes[] }` 로.
- `roleIn` 본문을 §2.4.3 으로(⑤ 워크스페이스 관리자 승계가 ⑥ 앞). **시그니처 불변.**
- `workspaceRoleIn`·`isWorkspaceAdmin`·`isWorkspaceMember` 신설. `canSeeProject`·`isAnyProjectAdmin`·`hasAnyProjectRole`·`adminProjectIds` 를 §2.4.2 표대로 확장.
- `effectiveLegacyRole` **삭제**. 소비처 5파일(`minutes/page.tsx:69`·`p/[projectId]/dashboard/page.tsx:66`·`meetings/page.tsx:59`·`issues/page.tsx:53`·`api/chat/v2/stream/route.ts:108`, 2026-09-24 실측)은 `isProjectAdmin`/`isProjectMember` 불리언으로. 그 불리언을 받는 클라이언트 컴포넌트의 `'pmo_admin'` 비교(`MinutesView.tsx:393`·`MeetingFormModal.tsx:108`·`MeetingsView.tsx:69`·`MeetingScheduleList.tsx:92`·`domain/issues.ts:170`·`repositories/supabase/wbs.ts:80,84`·`UsageUserTable.tsx:13`·`ChangeHistoryList.tsx:15`·`ai/chat/orchestrator.ts:156`·`domain/accounts.ts:65-67`)은 prop 이름을 `canManage`/`isAdmin` 류 불리언으로 바꾼다. 변경 이력·사용 현황이 표시하던 "역할 라벨"(`pmo_admin`/`team_editor`)은 저장값이 아니라 조회 시점에 `memberships` 에서 계산하던 것(`actions/wbs.ts:49`, `repositories/supabase/wbs.ts:227`)이므로, 계산 원천만 3.5 표대로 바꾸고 표시값은 `관리자`/`멤버`/`조회` 로 한다.
- `ProjectActorView` 를 §2.4.2 표대로(`workspaceId`·`workspaceRole`·`memberId`·`rosterTeamIds[]`·`rosterTeamCodes[]`·`primaryTeamCode`). 소비처 6파일 중 `KanbanBoard.tsx:70,167` 만 로직 변경(§2.4.2 소비처 표의 '내 팀' 렌즈 규칙).

### 3.2 `src/lib/authz/index.ts` — `buildActor` 와 가드

- `buildActor(client, userId)` 신설: §2.4.4 4축. ③ 은 1.2 의 명시 필터. ④ 는 `project_members(id, project_id, access_role, project_member_teams(team_id, is_primary, teams(code)))` 를 `people.user_id = userId and people.active and pm.active` 로 조인. 어느 축이든 오류면 throw(현행 fail-closed 유지).
- `getActor` = `cache(() => buildActor(세션 클라이언트, claims.sub))`. `actorFromUser(admin, userId)` 는 SP7 에서 쓰지만 `buildActor` 를 공유하는 얇은 함수이므로 지금 같이 둔다(테스트 1개).
- 가드 3종 **시그니처 불변**. `requireProjectAdmin`·`requireProjectMember` 는 `roleIn === null` 이면 `ERR_MISSING`, `'viewer'` 는 `ERR_DENIED`. `denyStatus` 에 `ERR_MISSING → 404` 추가 — 호출처 5곳의 라우트 테스트 기대값 500→404 갱신.
- `/p/[projectId]` 레이아웃: `roleIn(actor, projectId) === null → notFound()`.
- `resolveProjectId`·`ProjectScopedTable` 무변경(`project_members` 는 여전히 `project_id` 를 가진다).
- `src/lib/auth.ts` 의 `getMembership`·`Membership` 타입 삭제(호출처 0, 테스트 5파일의 mock 만 정리).

### 3.3 `src/lib/domain/permissions.ts`

`actorTeamCodesFor`/`actorTeamIdsFor` 본문을 `actor.rosterTeams.get(pid)?.teamCodes ?? []` / `teamIds` 로. 시그니처·나머지 함수 무변경. 소비처 `actions/wbs.ts:100,574`·`actions/attachments.ts:32` 무변경.

### 3.4 `Actor.teamCode/teamId` 직접 소비처(§2.4.2 표)

| 소비처 | SP1 처리 |
|---|---|
| `KanbanBoard.tsx:70,167` | `rosterTeamCodes[]` 교집합 렌즈 |
| `api/chat/v2/stream/route.ts:109` | `context.teamId` 필드 삭제(`ai/tools/types.ts:52` 선언도) |
| `api/issue-analysis/route.ts:45` | `primaryTeamCode ?? ''` |
| `(app)/layout.tsx:63` → `HeaderChrome.tsx` | `identity.teamCodes: string[]`(정렬·중복 제거), 표시 규칙 §2.4.2. **UI 위험 파일** — `ui/sp1-header-teams` 브랜치 + `Preview-checked: local` 트레일러(SP0 규칙) |
| `(app)/minutes/page.tsx:68` | `m?.teamCode` → 현재 워크스페이스 안 내 팀 코드 목록의 첫 값(회의록 기본 팀 선택용), 없으면 null |

### 3.5 외부 API·접근 스코프 — 최소 교체

`roleIn` 통합은 SP7. SP1 은 폐기 표를 읽는 자리만 새 표로 바꾸고 함수 이름·반환 계약을 유지한다.

| 파일:라인(실측) | 현행 | SP1 |
|---|---|---|
| `lib/agent/externalApi.ts:62,69,88,90,105,112` | `memberships.is_superuser`·`project_roles.role` | `platform_admins` 존재 / `project_members ⨝ people(user_id)` 의 `access_role`(active 만) |
| `lib/minutes/externalApi.ts:71,79` | 동일 | 동일 |
| `lib/minutes/externalApi.ts:132-150` `resolveUserByEmail` | `auth.admin.listUsers` 순회 | `profiles(email)` 단건 조회 |
| `lib/authz/accessScope.ts:29-33` | `projects`·`project_roles`·`memberships` | `buildActor` 로 Actor 를 만든 뒤 `canSeeProject` 필터(§2.4.8 챗·위키 행). 인터페이스·`ACCESS_SCOPE_UNAVAILABLE` 유지 |
| `api/v1/agent/work/[id]/report/route.ts:126` | `project_roles` 관리자 | `project_members ⨝ people(access_role='admin', user_id not null)` |
| `lib/data/usage.ts:165`·`lib/data/accounts.ts`(`listUsers`) | `memberships`·`listUsers` | `profiles` + `platform_admins` + `workspace_members`. 사용 현황의 "팀" 열은 워크스페이스 안 명단 팀 합집합 |
| `actions/wbs.ts:49`·`repositories/supabase/wbs.ts:227` 변경 이력 저자 라벨 | `memberships(role, teams(code))` | `people`(이름) + 그 프로젝트 `project_members`/`project_member_teams`(팀 코드들) — `actor_role` 은 3.1 의 새 값 |

## 4. 데이터 접근 교체 — `project_members` 소비처

`from('project_members')` 24파일(실측 인벤토리 2026-09-24)의 공통 원칙:

- 이름·이메일·계정은 `people` 조인으로 읽는다. 공용 select 상수 세 개(`data/members.ts:8 PROJECT_MEMBER_SELECT`·`repositories/supabase/members.ts:15 MEMBER_COLUMNS`·`repositories/supabase/attendance.ts:13`)를 하나(`src/lib/data/memberSelect.ts`)로 합치고 `id, project_id, person_id, access_role, role_label, title, active, sort_order, people(display_name, email, user_id, kind), project_member_teams(team_id, is_primary, teams(code, name))` 로 통일한다. 행 → DTO 매핑 함수 `toRosterMember(row)` 를 같은 파일에 두고, DTO(`RosterMember`)는 `{ id, projectId, personId, name, email, userId, kind, accessRole, roleLabel, title, active, teams: { id, code, name, isPrimary }[] }` 다. 기존 DTO 의 `teamCode` 단수 필드(§2.4.2 말미 목록 8곳)는 `teams[0]?.code`(대표 팀 우선) 를 주는 파생 getter 로 **한 릴리스 동안만** 유지하고 Phase B 에서 배열 소비로 바꾼다.
- `user_id`/`email` 로 명단 행을 찾던 조회(`data/members.ts:75,77`·`data/meetings.ts:173,175`·`minutes/meetings.ts:44`·`agent/assignee.ts:13`·`agent/wbsImport.ts:292`·`notify/emit.ts:29`·`data/agentSeatmap.ts:67,100`·`data/agentHub.ts:35`)는 `people` 조인 필터(`people.user_id = …` / `people.email = …`)로.
- 쓰기 6곳(`actions/members.ts:134,164,185`·`projectRoles.ts:156`·`accounts.ts:111`·`inviteRedeem.ts:406`)은 전부 RPC `upsert_project_member` 또는 `consume_project_invite` 경유. `project_members` 에 직접 insert/update 하는 앱 코드를 0 으로 만들고 `tests/invariants/roster-writes.test.ts` 가 grep 으로 단언한다(`from('project_members').insert|update|upsert` 0건, `delete` 는 `removeMember` 1곳 허용).
- `data/portfolio.ts:44`(`role='admin'` 로 프로젝트 관리자 목록) → `access_role='admin'`.
- `ProjectScopedTable`·`resolveProjectId` 그대로.

`memberSearch.ts` 의 후보 범위 "actor 의 `projectRoles` 키" 는 `projectWorkspace` 키(내 워크스페이스 프로젝트 전부, viewer 포함)가 아니라 **현행대로 명단 권한이 있는 프로젝트**로 유지한다(검색 결과에 타 프로젝트 인물이 새지 않게).

## 5. 개발 환경

### 5.1 `scripts/dev-bootstrap.mjs`

프롬프트/env: `BOOTSTRAP_EMAIL`·`BOOTSTRAP_PASSWORD`(SP0 유지), **`BOOTSTRAP_WORKSPACE_SLUG`(기본 `default`)·`BOOTSTRAP_WORKSPACE_NAME`(기본 `기본 워크스페이스`)**. `BOOTSTRAP_TEAM` 은 삭제(계정 전역 팀 폐지). 순서: `workspaces` upsert(slug) → `auth.admin.createUser` → `profiles` → `platform_admins` → `workspace_members(admin)` → `people(user_id, email, display_name)`. 어느 단계든 실패하면 만든 계정을 지우고 원인별 안내(SP0 관례). 두 번 실행해도 안전(upsert·on conflict).

### 5.2 `supabase/seed.sql`

계속 비어 있다. 워크스페이스는 부트스트랩이 만든다.

### 5.3 프로젝트 생성의 `workspace_id`

SP1 에는 워크스페이스 화면이 없다. `createProject` 는 `actor.workspaceRoles` 가 **정확히 1개**면 그 워크스페이스를 쓰고, 0개면 "워크스페이스에 소속돼 있지 않습니다"(플랫폼 관리자도 부트스트랩이 워크스페이스 관리자로 넣으므로 정상 경로에서는 발생하지 않음), 2개 이상이면 "워크스페이스를 지정해야 합니다"(SP2 가 UI 를 준다) 로 거부한다. 공용 팀 생성(`actions/teams.ts`)도 같은 규칙.

### 5.4 로컬 E2E

SP0 의 `scripts/e2e-local.mjs` 를 확장한다 — 부트스트랩 → 프로젝트 A·B 생성 → 명단에 사람 3명(계정 1·외부 2) → A 에서 계정 사용자를 팀 2개·admin, B 에서 팀 1개·member → WBS 임포트 → 담당자 지정(외부 인력) → 회의 참석자(외부 인력) → 초대 발급·수락(두 번째 계정) 까지 서버 액션 수준으로 완주. 결과는 `docs/baseline/sp1-e2e.md`.

## 6. 화면(Phase B)

| 화면 | 변경 | 파일(실측) |
|---|---|---|
| 명단 관리 | `ProjectRolesManager`(권한표) + `MembersBoard`(명단 카드) 를 **한 화면 `RosterManager`** 로. 행 = 사람(`people`), 열 = 팀(다중 선택·대표 팀), 역할 라벨, 직함, 권한(`없음/member/admin`), 계정 상태 배지(`계정 미연결`). admin 부여·회수 셀은 워크스페이스 관리자 이상에게만 활성(가드와 RPC 가 최종 판정). 외부 인력 추가 = 이름(+선택 이메일)만으로 `people` 행 생성 | `components/settings/ProjectRolesManager.tsx`(692행)·`components/members/MembersBoard.tsx`(660행)·`p/[projectId]/members/page.tsx`·`actions/projectRoles.ts`·`actions/members.ts` |
| 담당자·참석자 선택기 | `memberPicker.ts`·`MemberPicker.tsx` 가 `RosterMember` 를 받아 외부 인력도 노출, 항목에 `kind` 배지. `AssigneeComboBox`·`MeetingAttendeePicker`·`IssueAssigneePicker`·`AttendanceView` 는 DTO 변경만 | `components/members/MemberPicker.tsx`·`lib/domain/memberPicker.ts` 등 |
| 계정 관리 | 팀 필수 입력 제거, `profiles` insert, 워크스페이스 관리자 토글(`workspace_members.role`), 플랫폼 관리자 토글(`platform_admins`, 슈퍼유저만). `updateAccountTeam` 삭제 | `components/admin/AccountsManager.tsx`·`actions/accounts.ts`·`lib/data/accounts.ts` |
| 초대 | 발급 폼: 권한(`없음/member/admin`)·역할 라벨·팀 다중 선택. admin 초대는 워크스페이스 관리자 이상. 수락 페이지: RPC 결과로 이동 | `ProjectInviteManager.tsx`·`actions/projectInvites.ts`·`actions/inviteRedeem.ts`·`invite/[token]`·`InviteRedeemCard.tsx`·`mail/projectInvite.ts` |
| 담당 영역 | 프로젝트 설정에 "담당 영역" 절 신설 — `kind` 탭 2개(주간 구분·이슈 영역), 코드·이름·순서·활성·담당 팀(primary/support). 코드 불변. 소비처는 없다(SP4/5) | 신규 `components/settings/ProjectAreasManager.tsx`·`actions/projectAreas.ts` |
| 헤더 소속 표시 | 3.4 의 `teamCodes[]` 규칙 | `components/app/HeaderChrome.tsx` — UI 위험 파일 |
| 프로젝트 팀 관리 | `color` 배정(팔레트 자동, 편집은 SP3) 외 무변경 | `ProjectTeamsManager.tsx`·`actions/projectTeams.ts` |

i18n 사전(`src/lib/i18n/dict/*`)의 `pmo_admin`/`team_editor`/`contributor` 키는 `admin`/`member`/`viewer` 로 개명.

## 7. 테스트

### 7.1 공용 Actor fixture — 먼저

`tests/fixtures/actor.ts`: `makeActor(overrides?: Partial<Actor>): Actor`(기본값: 워크스페이스 `ws-1` member, 프로젝트 없음), `makeAdminActor(pid)`, `makeMemberActor(pid, teamCodes[])`, `makeSuperuser()`, `makeProjectActorView(...)`. 인라인 Actor 리터럴 35파일·`rosterTeams` 16파일·`teamCode:` 리터럴 중 Actor 형 41파일을 이 fixture 로 교체한다. 명단 DTO 의 `teamCode` 를 쓰는 나머지 테스트는 4절 DTO 변경에 따라 고친다. `vi.mock('@/lib/authz')` 50파일·`vi.mock('@/lib/supabase/admin')` 71파일은 시그니처 불변으로 **무수정**임을 플랜의 검증 단계가 diff 로 확인한다.

### 7.2 정적 불변식

- `tests/authz/guard-signatures.test.ts`(§6.5.2): `src/lib/authz/index.ts`·`src/lib/domain/authz.ts` 의 export 목록과 가드 3종·`roleIn` 의 시그니처 문자열 스냅샷.
- `tests/invariants/no-legacy-org.test.ts`: `src` 에서 `memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership|current_team|update_project_member_with_identity` 0건(주석 포함 — 주석도 지운다), `'pmo_admin'|'team_editor'|'contributor'` 리터럴 0건(i18n 사전 포함).
- `tests/invariants/roster-writes.test.ts`(4절).
- `tests/invariants/migration-files.test.ts` 기존(0003 쌍).

### 7.3 `tests/rls/` 골격

- `vitest.config.rls.ts` + `npm run test:rls`(단위 스위트와 분리, CI `db` 잡에서 `db reset` 뒤 실행).
- `tests/rls/harness.ts`: 로컬 DSN(`supabase status` 값, `.env.local` 의 로컬 좌표만 허용 — `targets.mjs` 금지 ref 가드 재사용) 에 `pg` 로 접속, `withSession(userId, fn)` = `begin; set local role authenticated; select set_config('request.jwt.claims', …, true); …; rollback`.
- `tests/rls/fixture.sql`: 워크스페이스 1개, 계정 3개(플랫폼 관리자·A-admin·A-member), 프로젝트 A·B, 팀 3개, 명단(§6.2 done_when 시나리오), WBS 리프 2개 + `item_owners`, 첨부 메타. `auth.users` 직접 insert(로컬).
- 케이스: ① A 에서 팀 2개·admin 인 사용자의 WBS 실적 update 통과, B 에서 member·다른 팀 리프는 0행; ② `can_attach` 통과/거부 같은 짝; ③ 워크스페이스 관리자가 명단 행 없이 `is_project_admin` true; ④ 계정 없는 `people` 에 `access_role` 부여 → 23514; ⑤ 본인 `access_role` 회수 — 세션 경로는 RLS 가 admin 행을 숨겨 0행, RPC `upsert_project_member(p_actor=본인)` 은 42501 `PROJECT_MEMBER_SELF_DEMOTE`, 워크스페이스 관리자는 통과(2026-09-25 정정); ⑥ 마지막 워크스페이스 관리자 강등 거부; ⑦ `consume_project_invite` 가 다섯 쓰기를 한 트랜잭션으로 남기고 재사용 시 0행.
- 전수 교차 조회(워크스페이스 2개)는 SP2 가 같은 하네스에 추가한다.

### 7.4 tsc 게이트

- 물려받은 테스트 타입 오류 28건/9파일 수정(SP0 스펙 §11 목록). 새 오류 0.
- `package.json` `typecheck: tsc --noEmit`, CI `test` 잡에 추가, `.githooks/pre-push` 는 무변경(훅은 빌드·테스트를 돌리지 않는다는 원칙 유지).

## 8. 작업 순서

**Phase A — 스키마·판정·데이터 접근(주 1~2)**

1. tsc 게이트(7.4) — 다른 모든 작업의 회귀 판정 도구.
2. Actor fixture(7.1) 도입 + 기존 테스트 교체(Actor 형만, 로직 무변경). 스위트 초록 유지.
3. `0003_org_core.sql` + 롤백 + `db:reset` 리허설 + 롤백 리허설(2.4). **마이그레이션만 담은 커밋**(G1), `Staging-verified: local db reset` 트레일러(G4).
4. 순수 계층(3.1)·`buildActor`·가드(3.2)·`permissions.ts`(3.3) + 단위 테스트. 이 시점부터 `getActor` 가 새 표를 읽으므로 3~6 은 `sp1/phase-a` 브랜치에서 이어서 하고 체크포인트 7 전에는 `main` 에 반영하지 않는다(브랜치 자체는 원격에 push 해 둔다).
5. 데이터 접근 교체(4절)·외부 API 최소 교체(3.5)·`teamCode/teamId` 소비처(3.4, 헤더 제외)·`effectiveLegacyRole` 소비처·`pmo_admin` 문자열·i18n 키.
6. 부트스트랩·`createProject` 규칙(5절)·E2E 스크립트 확장(5.4)·`tests/rls` 골격(7.3)·불변식 테스트(7.2).
7. **체크포인트**: 전체 스위트·tsc·lint·build·`test:rls` 초록, 로컬 dev 에서 기존 화면(명단·회의·이슈·WBS·근태) 눈확인, `main` push, CI 초록. 여기서 3주 상한을 넘길 조짐이면 Phase B 를 별도 SP 로 뗀다(사용자 보고).

**Phase B — 화면(주 2~3)**

8. `RosterManager`(6절 명단 관리) + `actions/roster.ts`(`upsert_project_member` 호출) — `ProjectRolesManager`·`MembersBoard` 삭제.
9. 선택기·계정 관리·초대 UI·담당 영역 관리.
10. 헤더 소속 표시 — `ui/sp1-header-teams` 브랜치, `Preview-checked: local` 트레일러.
11. 명단 DTO `teamCode` 파생 getter 제거(4절), E2E 재실행·`docs/baseline/sp1-e2e.md`, 태그 `sp1-done`.

각 태스크는 SP0 과 같은 서브에이전트 구동(구현 1명 순차, 리뷰는 다관점) + 브리프 공통 금지 사항(`git push`·`fetch`·`SKIP_GUARD`·공유 스크래치패드·`cd … && a; b` 패턴 금지 — 2026-09-24 사고 교훈).

## 9. 완료 조건(done_when)

- [ ] `npm run db:reset` 초록(0000→0003), 롤백 리허설 초록, `tests/invariants/migration-files.test.ts` 초록
- [ ] `npm run test:rls` 의 7.3 케이스 전부 초록 — 상위 done_when "한 사람이 A 에서 팀 2개·admin, B 에서 팀 1개·member 로 등록되고 WBS 실적 편집·첨부가 RLS 에서 각각 통과/거부" 의 자동화판
- [ ] 로컬 E2E(5.4) 완주 + `docs/baseline/sp1-e2e.md` — 계정 없는 외부 인력이 WBS 담당자·이슈 담당자·회의 참석자로 지정되고 복합 FK `(id, project_id)` 위반이 거부됨을 포함
- [ ] `grep -rE 'memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership' src` 0건(`tests/invariants/no-legacy-org.test.ts`)
- [ ] `tests/authz/guard-signatures.test.ts` 스냅샷이 SP0 시점 시그니처와 일치(가드 3종·`roleIn` diff 0)
- [ ] `vi.mock('@/lib/authz')` 50파일·`vi.mock('@/lib/supabase/admin')` 71파일 무수정(`git diff --stat` 로 확인해 플랜 보고에 기록)
- [ ] `tsc --noEmit` 0 오류(CI 게이트), `npm run test`·`lint`·`build` 초록, CI test·db 두 잡 초록
- [ ] Phase A 체크포인트에서 `main` 이 배포 가능 상태였음(push 뒤 CI 초록 기록)
- [ ] 명단 관리 화면에서 사람 1명을 팀 2개·대표 팀 지정·admin 부여, 외부 인력 추가·배지 표시, 초대 발급·수락 — 로컬 눈확인 트레일러 `Preview-checked: local …`
- [ ] 태그 `sp1-done` push

## 10. 리스크

| 리스크 | 대응 |
|---|---|
| R2 폭발 반경 — Actor 형 변경이 테스트 82파일에 닿음 | fixture 선행(8절 2) + tsc 게이트(8절 1) 를 스키마보다 먼저. 가드 시그니처 스냅샷 |
| 4~6 사이 `main` 이 깨진 상태로 세션이 끊김 | 4~6 은 `sp1/phase-a` 브랜치에서 진행, 체크포인트 7 에서만 `main` 반영(ff). 브랜치는 원격에 push 해 둔다(원본 이력 없음 — G5 통과) |
| `app_role()` 재작성 누락으로 회의록 정책이 깨짐 | 2.2 표 + `db:reset` 뒤 회의록 폴더 insert 를 `test:rls` 케이스에 포함 |
| 0003 이 `drop table` 에서 의존 객체로 실패 | 실패가 정답(2.3). 리허설에서 잡는다 |
| `read_all_members`·`projects` 읽기가 SP1 동안 개방 상태 | 의도된 상태(SP2 범위). 로컬 단일 워크스페이스라 노출 대상이 없다. SP2 착수 전 원격 배포 금지를 로드맵에 명시(이미 첫 배포 SP 가 뒤) |
| `HeaderChrome.tsx` 변경(UI 위험 파일) | `ui/` 브랜치 + 로컬 눈확인 트레일러(G2) |
| RPC 두 개(`upsert_project_member`·`consume_project_invite`)에 판정 로직이 들어가 앱 가드와 중복 | 중복은 의도(service_role 경로의 2차 방어선, §2.3.3). `test:rls` 가 두 경로를 각각 검증 |

## 11. 열린 항목

| 항목 | 상태 | 닫히는 시점 |
|---|---|---|
| Phase B 를 별도 SP 로 뗄지 | Phase A 체크포인트에서 판단 | 8절 7 |
| 사용 현황을 워크스페이스 관리자에게 열지(상위 §2.7) | 플랫폼 관리자 전용 유지 | 사용자 요청 시 |
| `people` 개명 권한의 화면 노출(워크스페이스 관리자 vs 프로젝트 관리자) | 명단 관리 화면에서는 "그 인물이 명단에 있는 프로젝트의 관리자" 규칙으로 편집 허용(§2.3.2) | Phase B |
