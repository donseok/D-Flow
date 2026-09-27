# SP2 — 워크스페이스 격리 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-26 |
| 상태 | 초안 — 사용자 검토 대기 |
| 상위 정본 | `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §2(조직·권한 모델, 특히 2.3.7·2.4.6·2.4.8)와 §6.2 SP2(범위·done_when). 이 문서는 SP1 결과(`sp1-done` = `4faed0d`)와 2026-09-26 실측을 기준으로 **SP2 에서 실제로 할 일**만 적는다. 헬퍼·정책 골격의 원형은 §2.4.6 이 정본이고 여기 반복하지 않는다 |
| 선행 | SP1 완료(마이그레이션 `0003`~`0005`) |
| 마이그레이션 | `0006_workspace_isolation.sql`(Phase A) · `0007_storage_realtime.sql`(Phase B1) · `0008_workspace_settings.sql`(Phase B2) — 각각 `supabase/rollbacks/` 에 동명 롤백 |
| 실측 근거 | 2026-09-26 읽기 전용 조사(로컬 DB 카탈로그 + grep). 아래 수치는 모두 이 실측값이다 |

## 1. 전제와 결정

### 1.1 사용자 결정(2026-09-26)

| # | 결정 | 귀결 |
|---|---|---|
| U1 | 범용성 검토 문서(`docs/2026-09-26-configurability-review-and-implementation.md`)는 **SP2 뒤, SP3 착수 전에** 정본 설계 개정으로 반영한다 | SP2 범위는 격리에 한정한다. 설정·워크플로·IA 는 건드리지 않는다 |
| U2 | `/w/[slug]` 경로 이동·워크스페이스 전환 UI·`/projects` 워크스페이스 필터는 **SP3b 로 이관**(제5부 IA·셸 재설계와 한 번에. 2026-09-27 정본 개정으로 SP3 이 SP3a·SP3b 로 나뉘었다 — `2026-09-27-platform-revision-configurability-design.md` §6.2) | SP2 는 UI 위험 파일 중 `usePagePresence.ts` 하나만 만진다. 사이드바·헤더·내비게이션 컨텍스트는 그대로 |
| U3 | SP2 는 2단계: **Phase A(DB 격리) → main 체크포인트 → Phase B(B1 Storage·Realtime ∥ B2 가드·service_role)** | Phase A 끝에서 main 이 배포 가능 상태(전체 스위트·tsc·CI 초록) |
| U4 | (승계) 로컬 우선 — 원격 스테이징·Vercel 없음 | done_when 의 "스테이징 스모크"는 로컬 2-워크스페이스 브라우저 확인으로 정의. UI 위험 파일은 `Preview-checked: local …` |

### 1.2 컨트롤러 기본값(사용자 승인 설계에 포함)

| # | 결정 | 이유 |
|---|---|---|
| D1 | `/admin/llm-config`(LLM 프로필·설정 7액션)·`resetPassword`·`setPlatformAdmin`·`api/chat/health`·`api/wiki/reindex` 는 **플랫폼 전용**(`requireSuperuser`) 유지 | LLM 설정은 배포 전역 표(`llm_config`/`llm_profiles`). 계정 비밀번호는 여러 워크스페이스에 걸친 전역 자원 — 워크스페이스 관리자가 바꾸면 다른 워크스페이스 소속자에게 영향 |
| D2 | `issue_mega_areas` 의 개방 읽기는 '개방 읽기 0건' 불변식의 **명시적 예외**(화이트리스트 1행, 사유·만료 SP5 기재) | 전역 참조 데이터라 테넌트 행이 없다. 표 자체가 SP5 에서 프로젝트 영역으로 대체된다 |
| D3 | `project_id` 가 null 인 회의록·폴더의 `workspace_id` 백필 = 작성자(`created_by`)가 속한 **유일한** 워크스페이스. 작성자 소속이 0개·2개 이상이면 전체 워크스페이스가 정확히 1개일 때 그것, 아니면 마이그레이션 **중단**(`raise exception`) | 추정으로 잘못 배정하느니 멈춘다(에러 처리 3원칙). 로컬 해당 행 0건 |
| D4 | 새 `workspace_id` 컬럼은 백필 뒤 `not null` + `workspaces(id)` FK + 인덱스 | 이후 insert 경로가 값을 빠뜨리면 즉시 실패해야 한다 |

### 1.3 상위 스펙 대비 정정(실측)

| 상위 스펙 §6.2 SP2 문구 | 실측 | 이 문서의 처리 |
|---|---|---|
| 헬퍼 `is_ws_member`·`is_ws_admin`·`project_ws`·`accessible_project_ids` **신설**, `can_read_project` 본문 교체 | 전부 SP1 `0003` 에 있고 `can_read_project` 는 이미 워크스페이스 스코프 | 신설하지 않는다. 보완만(§2.3) |
| Q2(`roleIn` 워크스페이스 관리자 우선, `canSeeProject`, `is_project_admin`) 반영 | SP1 에서 구현됨 | 테스트만 추가(§5.2) |
| `using (true)` 읽기 정책 57문/32파일 | **라이브 40정책/40테이블** | 40개 교체(§2.1) |
| `app_role()` 잔존 정책 9개(미검증) | 9개 맞음 + **함수 `curate_wiki_item` 본문도 호출** | 함수까지 고친 뒤 drop(§2.2) |
| `meeting_attendees` 에 `project_id` 추가 | 이미 `not null` | 직접 술어만 |
| 다섯 컬럼 `workspace_id` 소유 "`0003`" | 번호 밀림 이전 표기 | `0006` 소유 |
| `realtime.messages` 정책 2건 | presence private 전환에는 `extension='presence'` SELECT·INSERT 가 필요 — 4건 | §3.3 |
| Storage: `minutes`·`issue-attachments` 읽기만 개방 | **`minutes` insert 도 개방**(아무 경로에나 쓰기 가능) | §3.2 |
| 미들웨어 matcher 갱신 | 제외 목록 방식이라 불필요 | SP3 경로 이동 때 옛 경로 리다이렉트만 |
| href·`revalidatePath`·`redirect` 28·122·13 | 전역 합계였다. 이동 대상 6라우트 = 리터럴 95줄·`revalidatePath` 29·`redirect` 0 | SP3 로 이관(U2) |
| `tests/rls/` 신설 | SP1 이 하네스·픽스처·CI 잡을 만들었다 | 확장(§5.1) |

### 1.4 비목표

- 경로 `/w/[slug]` 이동, 워크스페이스 전환 UI(쿠키·prefs), `/projects` 필터, `canViewAgents` 의 워크스페이스 밖 명단 — SP3(U2)
- 설정 엔진·모듈 토글·메뉴 통합 — SP3(개정 뒤)
- 벡터·lexical 검색 RPC 필터, `ai_documents`·`ai_index_jobs`·`usage_events` 의 `workspace_id` — SP8
- 외부 연동 자격증명의 워크스페이스화, `agent_runners` 스코프, `narrowActor` — SP7
- 비공개 프로젝트를 RLS 로 잠그기(현 결정 '화면 숨김' 유지)
- `teams/master` 캐시 구조(R10) — SP4. 단 캐시 **조회의 워크스페이스 필터**는 B2 에서 고친다(누설)

## 2. Phase A — `0006_workspace_isolation.sql`

코드 변경은 새 `workspace_id` 컬럼을 채우는 쓰기 경로뿐이다(§2.4). 마이그레이션과 코드는 커밋을 나눈다(G1). 한 마이그레이션 안에서 컬럼 추가·백필·`not null` 을 하고, 바로 다음 커밋에서 코드가 값을 넣게 한다. 두 커밋 사이에는 회의록 생성이 `not null` 에 걸리는 중간 상태가 생기지만, 원격이 없고 체크포인트(main 머지)는 둘 다 들어간 뒤이므로 허용한다.

### 2.1 개방 읽기 40정책 교체

사전검증 `do` 블록: 교체할 옛 정책 이름 40개가 **전부** 존재하는지 확인하고, 하나라도 없으면 `raise exception`(SP0 `0053` 패턴). 그 뒤 `drop policy` + `create policy`.

| 분류 | 테이블 | 새 읽기 술어 |
|---|---|---|
| 직접 `project_id`(22) | `announcements`·`attendance_records`·`holidays`·`issue_assignees`·`issue_attachments`·`issue_links`·`issue_major_processes`·`issue_updates`·`issues`·`meeting_attendees`·`meetings`·`project_ai_briefs`·`project_members`·`project_settings`·`task_dependencies`·`wbs_embeddings`·`wbs_items`·`wbs_progress_snapshots`·`weekly_reports`·`wiki_change_events`·`wiki_items`·`wiki_topics` | `project_id in (select accessible_project_ids())` |
| 프로젝트 자신 | `projects` | `workspace_id in (select my_workspace_ids())` |
| 워크스페이스 컬럼 | `teams` | `workspace_id in (select my_workspace_ids())` |
| nullable `project_id` + 새 `workspace_id`(§2.3) | `minutes`·`minute_folders` | `workspace_id in (select my_workspace_ids())` |
| nullable `project_id`, 부모 경유 | `minute_versions` | 부모 `minutes` 조인 |
| nullable `project_id`, SP8 소유 | `ai_documents` | `project_id in (select accessible_project_ids())`(null 행은 세션에서 안 보임 — 색인은 service_role 로 읽는다. 전역 문서의 스코프는 SP8) |
| 부모 조인(11) | `change_logs`·`deliverable_attachments`·`item_owners`→`wbs_items` · `meeting_exceptions`→`meetings` · `weekly_report_rows`→`weekly_reports` · `minute_embeddings`·`minute_files`·`minute_highlights`·`minute_insights`→`minutes` · `wiki_item_relations`(`from_item_id`)·`wiki_item_sources`→`wiki_items` | `exists (select 1 from <부모> p where p.id = <fk> and p.<스코프> in (…))` |
| 예외(D2) | `issue_mega_areas` | 유지 |

추가로 `true` 는 아니지만 좁혀지지 않은 것:

- `notification_events.read_notification_events` 의 `audience = 'global'` 분기 삭제(앱 emitter 는 `'direct'` 만 쓴다 — `src/lib/notify/emit.ts:51`). 수신자 본인 조건에 `workspace_id in (select my_workspace_ids())` 추가.
- `minute_favorites.own_minute_favorites` 에 부모 `minutes` 스코프 추가(떠난 워크스페이스의 즐겨찾기).
- `change_logs.insert_own_log` 에 부모 `wbs_items` 의 `can_read_project` 추가(타 워크스페이스 `wbs_item_id` 로 로그 삽입 차단).
- `for all` 정책은 SELECT 에도 적용되므로 불변식(§5.1)은 `cmd in ('SELECT','ALL')` 를 함께 본다.

`weekly_report_rows` 읽기 정책을 닫으면 `supabase_realtime` 발행의 `postgres_changes` 도 구독자별로 닫힌다(현재 타 워크스페이스 구독자에게도 변경이 간다 — 이 교체로 해결).

### 2.2 `app_role()` 폐기

- 정책 9개를 명시적 헬퍼로 교체: `minute_files` 3(`mi.created_by = auth.uid() or is_ws_admin(mi.workspace_id) or (mi.project_id is not null and is_project_admin(mi.project_id))`), `minute_folders` 3·`minute_highlights` 2(`is_ws_member(workspace_id)` 기반 — 옛 `app_role() is not null` 은 "어느 프로젝트든 역할 있음"이었으므로 새 술어는 "그 워크스페이스의 활성 명단에 역할이 있거나 워크스페이스 관리자"), `storage.objects` 의 `minutes bucket delete` 1(→ Phase B1 에서 버킷 정책 전체 재작성 시 함께. Phase A 에서는 `app_role()` 호출만 동형 술어로 치환).
- 함수 `curate_wiki_item`(SECURITY DEFINER) 본문의 `app_role()` 을 `is_project_admin(<대상 프로젝트>)` 로 교체(`create or replace`).
- 그 뒤 `drop function app_role()`. drop 은 plpgsql 본문을 검사하지 않으므로, 마이그레이션 끝에 `pg_proc.prosrc ilike '%app_role(%'` 가 0건인지 확인하는 `do` 블록을 둔다.

### 2.3 컬럼·헬퍼·권한

- `workspace_id uuid` 추가 + 백필 + `not null` + FK + 인덱스(D3·D4): `minutes`·`minute_folders`·`notification_events`·`user_preferences`·`agent_watchers`.
  - 백필: `project_id` 가 있으면 `projects.workspace_id`. 없으면 D3. `user_preferences` 는 사용자당 1행이고 워크스페이스 개념이 없었으므로 사용자의 유일 워크스페이스(여럿이면 가장 먼저 가입한 것 — 선호값은 보안 경계가 아니다). PK 는 `(user_id, workspace_id)` 로 바꾼다.
  - `project_id` 가 있는 행은 `workspace_id = project_ws(project_id)` 를 강제하는 트리거(SP1 `projects_guard` 와 같은 결 — 두 값이 어긋날 수 없게).
- 헬퍼 보완(M3): `my_member_id`·`my_team_ids`·`is_project_admin_anywhere_in_ws` 에 `pe.active` 조건.
- 실행 권한(security-5): SP1 헬퍼 전부(`is_superuser`·`my_workspace_ids`·`is_ws_member`·`is_ws_admin`·`project_ws`·`accessible_project_ids`·`can_read_project`·`is_project_admin`·`is_project_member`·`is_project_admin_anywhere_in_ws`·`my_member_id`·`my_team_ids`·`can_attach`·`can_edit_issue`)에서 `anon`·`public` EXECUTE 회수. `project_ws` 는 `authenticated` 에서도 회수하고 정책 안에서만 쓰이게 한다(정책은 소유자 권한으로 함수를 부르지 않으므로 — **실측 필요**: 회수 뒤 정책 평가가 42501 이면 `project_ws` 는 authenticated 유지하고 본문에 `can_read_project(pid)` 조건을 넣어 오라클만 없앤다. 구현자가 둘 중 되는 쪽을 택하고 기록).
- `anon` 쓰기 권한 일괄 회수: `public` 스키마 전 테이블에서 `anon` 의 INSERT·UPDATE·DELETE·TRUNCATE 회수, `alter default privileges` 로 이후 테이블에도. `anon` EXECUTE 가 열린 SECURITY INVOKER RPC(`import_wbs`·`import_wbs_upsert`·`replace_wbs`·`match_*_documents`·`usage_*`·`lead_lease_ttl`)도 회수.
- 명단 보호(M1): `project_members` 를 가리키는 FK(`attendance_records`·`issue_assignees`·`meeting_attendees` 등 — 구현자가 `pg_constraint` 로 전수)를 `on delete cascade` → `no action` 으로. `authenticated` 의 `project_members` 컬럼 UPDATE 권한에서 `person_id`·`project_id` 제외. 삭제는 기록 없는 행만 가능해지고, 기록 있는 행은 비활성화가 유일한 경로가 된다(앱 `removeRosterMember` 와 같은 규칙이 DB 에서도).
- 관리자 행 팀 편집(M2): `project_member_teams_write` 가 대상 명단 행의 `access_role = 'admin'` 이면 워크스페이스 관리자만 허용(RPC 의 `ADMIN_SLOT` 규칙과 동형).

### 2.4 코드(같은 체크포인트, 별도 커밋)

- 회의록 생성 경로가 `workspace_id` 를 넣는다: RPC `create_minute_with_version`(마이그레이션 쪽에서 인자·본문 갱신), 외부 회의록 API(`src/lib/minutes/externalApi.ts` 후처리), 폴더 생성(`src/lib/minutes/folders.ts`, `actions/teams.ts:53` 의 전역 루트 폴더 시드 검사 → 워크스페이스 스코프).
- 알림 emit(`src/lib/notify/emit.ts`)이 `notification_events.workspace_id` 를 채우고, 수신자 선정에 `project_members.active and people.active` 필터(이월 항목).
- 사용자 선호(`user_preferences`) 읽기·쓰기가 워크스페이스 키를 쓴다. 현재 워크스페이스는 `resolveSoleWorkspaceId` 규칙 그대로(전환 UI 는 SP3).
- `agent_watchers` 쓰기(`api/v1/agent/watch`)가 `workspace_id` 를 채운다.

### 2.5 롤백 `0006_workspace_isolation_rollback.sql`

옛 정책 40개·`app_role()`·옛 `curate_wiki_item`·옛 헬퍼 본문·옛 권한·옛 FK 동작을 복원하고 새 컬럼·트리거를 drop. 검증은 SP1 과 같이 `supabase/rehearsal/compare-catalog.mjs` 로 0005 캡처와 0 mismatch.

## 3. Phase B1 — Storage·Realtime(`0007_storage_realtime.sql`)

### 3.1 경로 규약

`ws/<wid>/p/<pid 또는 _>/<entity>/<id>/<파일>` — `<entity>` 는 `minutes`·`minute-files`·`deliverables`·`issue-attachments`. 경로 생성은 순수 함수 하나(`src/lib/domain/storagePath.ts`: `makeStoragePath`·`parseStoragePath`)로 모으고, 서버 검증기(`isIssueAttachmentPathValid`·`isMinuteFilePathValid`, deliverables 는 신설)가 이 파서를 쓴다.

### 3.2 정책

- SQL 헬퍼: `uuid_or_null(text)`(형식이 틀리면 null — 직접 `::uuid` 캐스트 금지, 22P02 로 목록 조회 전체가 실패하는 것 방지), `storage_ws(name)`·`storage_project(name)`·`storage_entity_id(name)`.
- `minutes`: 읽기 `is_ws_member(storage_ws(name)) and (storage_project(name) is null or can_read_project(storage_project(name)))`, insert 같은 스코프 + 세그먼트 형식 검사, delete 는 Phase A 에서 치환한 술어를 새 헬퍼로.
- `issue-attachments`: 읽기 `can_read_project(storage_project(name))`, insert/delete `can_edit_issue(storage_entity_id(name))`.
- `deliverables`: `can_attach(storage_entity_id(name))`(현 `split_part(name,'/',1)::uuid` 대체).
- 옛 경로 객체: 로컬 0건. 원격이 생기기 전이므로 이전 스크립트는 만들지 않고, 옛 형식 경로는 새 정책에서 거부된다(`uuid_or_null` → null → false).

### 3.3 Realtime

- presence 두 채널을 private 로: `usePagePresence.ts`(토픽 `project-<pid>-presence-<pageKey>`, UI 위험 파일 → `ui/sp2-presence` 브랜치 + 로컬 눈확인 트레일러), `weekly/usePresence.ts`(`project-<pid>-weekly-<reportId>-presence`).
- `realtime.messages` 정책: `extension = 'presence'` 에 대해 SELECT·INSERT 각각, 토픽에서 정규식으로 pid 를 뽑아 `can_read_project`(SP1 `receive_project_wbs_channel` 의 `substring … is not null` 패턴).
- `weekly-rows-*`(`postgres_changes`)는 Phase A 의 읽기 정책 교체로 격리된다 — 코드 변경 없음.

## 4. Phase B2 — 가드·service_role(`0008_workspace_settings.sql`)

### 4.1 가드

- `requireWorkspaceAdmin(wid)` 신설(`src/lib/authz/index.ts`, 판정은 `domain/authz.ts` 의 순수 함수). 가드 시그니처 불변식(`tests/invariants/guard-signatures`)에 추가.
- `resolveScope(table, id) → { projectId, workspaceId }` — `resolveProjectId` 를 대체(화이트리스트 9테이블 유지, 호출 0인 `minutes`·`weekly_reports` 는 제거하지 않고 회의록 액션이 쓰도록). `resolveProjectId` 는 `resolveScope` 의 얇은 래퍼로 남긴다(호출 25곳 일괄 교체는 하지 않는다).
- ~~`src/lib/agent/delegation.ts:37` 이 서비스 경로에서 세션 전제 `resolveProjectId` 를 쓰는 것 — admin 클라이언트용 `resolveScopeAdmin` 으로 교체.~~
  **정정(Task 10, 2026-09-26)**: 전제가 틀렸다 — `delegation.ts` 의 호출 3곳은 모두 세션 액션이라 세션 `resolveProjectId` 가 맞다. 교체하지 않았다
  (`resolveScopeAdmin` 은 외부 API 같은 세션 없는 경로용으로만 쓴다).
- `requireSuperuser` 24곳 분류:

| 등급 | 위치 |
|---|---|
| 워크스페이스(13) → `requireWorkspaceAdmin(<대상 wid>)` | `actions/project.ts` createProject·setProjectPrivacy(→ 프로젝트 관리자 가드로 충분하면 `requireProjectAdmin`), `actions/projectInvites.ts` 관리자 슬롯, `actions/chat.ts` reindexProjectAction(→ `requireProjectAdmin`), `actions/teams.ts` addTeam·updateTeam·listTeamsAdmin, `actions/accounts.ts` createAccount·bulkCreateAccounts·setWorkspaceRole·listAccounts, `api/chat/reindex`(→ `requireProjectAdmin`), `api/import/execute` 전역 팀 등록 분기 |
| 플랫폼(11) — 유지(D1) | `actions/llmConfig.ts` 7, `accounts.ts` resetPassword·setPlatformAdmin, `api/chat/health`, `api/wiki/reindex` |

- 쓰기 대상 워크스페이스: `resolveSoleWorkspaceId` 대신 액션 입력(대상 프로젝트의 워크스페이스, 또는 명시적 `workspaceId`)에서 얻는다. 입력이 없는 생성 액션(createProject·addTeam·createAccount)은 `workspaceId` 인자를 받고, 화면은 SP3 전까지 유일 워크스페이스를 넘긴다.

### 4.2 service_role 감사

- `adminFor({ workspaceId } | { projectId })` 래퍼(`src/lib/supabase/adminFor.ts`): admin 클라이언트와 스코프 값을 함께 돌려주고, 스코프 필터를 빠뜨린 쿼리를 정적 테스트가 잡을 수 있게 한다.
- 감사표 `docs/sp2-admin-client-audit.md`: 63 소비 파일 × {플랫폼(화이트리스트) | 외부 API·서비스 | 세션 가드 뒤 id 스코프 | 경계 넘음}.
- 정적 불변식 `tests/invariants/admin-scope.test.ts`: `createAdminClient` 를 import 하는 파일은 화이트리스트(플랫폼 성격 8 + 감사표에서 사유를 적은 것)이거나 `adminFor` 를 쓴다.
- 경계를 넘는 조회 수정: `actions/teams.ts` listTeamsAdmin·`lib/teams/master.ts` fetchTeams(워크스페이스 필터), `api/v1/minutes/meta`(호출자의 워크스페이스 프로젝트만), `api/v1/agent/me`(호출자가 볼 수 있는 `agent_projects` 만), `api/v1/agent/watch`(`agent_watchers.workspace_id`), `actions/accounts.ts:243`(대상 사용자의 관리자 여부를 그 워크스페이스로).

### 4.3 외부 API 판정 통합(결정 8)

- `src/lib/agent/externalApi.ts` 의 `isAgentProjectMember`·`isAgentProjectAdmin`·`agentMemberRole` 과 `src/lib/minutes/externalApi.ts` 의 `isBatchAuthorized` 를 `actorFromUser(admin, userId)`(이미 존재, 호출 0) + `roleIn` 으로 교체. 워크스페이스 관리자 승계가 외부 API 에도 적용되고, 역할 문자열 비교(M5 `:83,114`)가 사라진다.
- `isBatchAuthorized` 는 "대상 프로젝트들 각각에 대해 관리자"로 바꾼다(현재: 아무 프로젝트든 관리자면 전부).

### 4.4 초대·워크스페이스 설정

- 초대 수락(`consume_project_invite` 경로)이 `workspace_members` 행을 멤버로 자동 추가(이미 있으면 유지). 비활성 인물 재활성화·`createAccount` 의 `p_member.active`(spec-2)는 명시적 재활성화 규칙으로 정리: 초대 수락은 비활성 명단 행을 재활성화하지 않고 `INVITE_INACTIVE` 로 거부 → 관리자가 명단에서 재활성화.
- `workspace_settings(workspace_id pk, allowed_domains text[] not null default '{}', updated_at)` 신설 — 읽기 `is_ws_member`, 쓰기 `is_ws_admin`. `invites.allowed_domains` 판정이 이 표를 읽는다(현재 판정 위치를 구현자가 확인하고 교체). 레지스트리 일반화는 SP3.
- 초대 가드 이월(`created_by` 재기록 방지, `'@'` 폴백)과 `keep_last_admin` 동시성(rpc-5 — `for update` 잠금)을 같은 파일을 만질 때 닫는다.

### 4.5 기타 이월

- `getProjectMembers` 실패 은폐 7곳(`lib/ai/knowledge.ts:41`, `minutes/[id]/page.tsx:47`, `p/[pid]/{agents,attendance,wbs,meetings,issues}/page.tsx`) → `getProjectRoster` 로 교체해 실패를 표시·로깅. `getProjectMembers` 는 호출 0이 되면 삭제.
- T11 C3: 슈퍼유저가 존재하지 않는 pid 로 들어가면 빈 페이지 → 404. 스트리밍 뒤 404 는 레이아웃에서 먼저 판정.
- M5 역할 리터럴 잔여(`admin/accounts/page.tsx:51-52`, `accounts.ts:131,217`, `projectInvites.ts:202`)는 `domain/authz.ts` 상수로.

## 5. 테스트

### 5.1 `tests/rls` 확장(done_when 의 본체)

- 픽스처: 워크스페이스 A·B, 각각 관리자·멤버·명단 없는 워크스페이스 멤버, A 에 공개·비공개 프로젝트, B 에 프로젝트 1. 모든 스코프 테이블에 행 1개 이상(없는 테이블은 픽스처가 채우지 못한 이유를 표에 적는다).
- 전수 교차: `pg_tables where rowsecurity` 전 테이블(72)에 대해 B 계정으로 A 행 SELECT 0건, INSERT/UPDATE/DELETE 거부. 테이블 목록은 카탈로그에서 읽어 새 테이블이 생기면 자동 포함(목록에 없는 테이블은 실패).
- Storage: 하네스가 pg 직결이므로 `storage.objects` 에 행을 넣고 `set local role authenticated` + `request.jwt.claims` 로 정책을 평가.
- Realtime: `realtime.messages` 정책을 `realtime.topic()` 설정으로 평가(presence·broadcast 토픽, A/B 교차).
- `service_role` 경로 검사(T10 이월): `set local role service_role` 로 grant 누락을 잡는다.

### 5.2 단위·정적

- `tests/domain/authz`: Q2 세 지점(`roleIn` 워크스페이스 관리자 우선, `canSeeProject` 비공개, B 프로젝트 `roleIn === null`), `requireWorkspaceAdmin` 판정.
- 정적 불변식: '개방 읽기 정책 0건'(`tests/rls/schema-invariants` — `cmd in ('SELECT','ALL')` 이면서 `qual` 이 `true` 이거나 스코프 헬퍼를 부르지 않는 정책, D2 화이트리스트 제외), '`app_role` 참조 0건', '스코프 없는 admin 쿼리 0건'(§4.2), `requireSuperuser` 호출 위치가 §4.1 플랫폼 11곳과 일치.

### 5.3 성능 기준선

`scripts/perf-baseline.mjs`: 로컬 dev 서버에 대해 대시보드·WBS 셸을 N회 요청해 p95 를 기록. `sp1-done` 체크아웃과 Phase A 이후를 같은 데이터로 비교해 +20% 이내. 결과는 `docs/baseline/sp2-perf.md`.

### 5.4 로컬 E2E·브라우저

`scripts/e2e-local.mjs` 에 두 번째 워크스페이스 시나리오 추가: A 관리자가 프로젝트를 만들고 외부 이메일을 초대 → 수락한 계정이 A 에만 속함, B 계정이 A 프로젝트 URL 을 직접 입력하면 404. presence 변경은 두 브라우저 세션으로 눈확인.

## 6. 작업 순서

**Phase A**
1. RLS 픽스처 2-워크스페이스 확장 + 전수 교차 테스트 먼저(현재 DB 에서 실패하는 것을 확인 — 기대 실패 목록 기록)
2. `0006` 마이그레이션(§2.1~2.3) + 롤백 + rehearsal smoke — 단독 커밋, `Staging-verified`
3. 코드: 회의록·알림·선호·watchers 의 `workspace_id` 쓰기(§2.4)
4. 정적 불변식(개방 읽기 0·`app_role` 0) + 성능 기준선
5. 체크포인트: `db:reset` → bootstrap → E2E → `test:rls` 전부 초록 → main ff 머지·push(사람 확인)·CI

**Phase B**(B1 ∥ B2 — 파일 분리)
- B1: 6 경로 규약 순수 함수 → 7 `0007` 정책 → 8 업로드 5곳·검증기 → 9 presence(`ui/` 브랜치)
- B2: 10 `requireWorkspaceAdmin`·`resolveScope` → 11 `requireSuperuser` 13곳 교체 → 12 `adminFor`·감사표·불변식·경계 누설 수정 → 13 외부 API 통합 → 14 `0008` + 초대·설정 → 15 이월 정리(§4.5)
- 16 E2E 2-워크스페이스 시나리오 + 브라우저 눈확인 → 최종 리뷰 → main·`sp2-done`

## 7. 완료 조건(done_when)

- `tests/rls` 에서 워크스페이스 B 계정이 A 의 전 RLS 테이블·3버킷·presence/broadcast 토픽을 0건 읽고 쓰기가 전부 거부 — CI `db` 잡에서 실행
- Q2: A 워크스페이스 관리자가 A 의 비공개 프로젝트를 읽고 쓰며, B 의 어떤 프로젝트도 `roleIn === null`(단위·RLS 양쪽)
- 불변식 통과: 개방 읽기 0(D2 예외 1)·`app_role` 참조 0·스코프 없는 admin 쿼리 0·플랫폼 가드 11곳 고정
- 로컬 E2E: 워크스페이스 관리자가 만든 프로젝트에 초대된 외부 계정이 그 워크스페이스에만 속함, B 계정의 A 프로젝트 URL 직접 입력 404
- presence 변경 `Preview-checked: local …` 트레일러
- 대시보드·WBS 셸 p95 가 `sp1-done` 대비 +20% 이내(기록)
- 롤백 3개 모두 catalog 0 mismatch

## 8. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| R1 | 40정책 교체 뒤 `accessible_project_ids()` 서브쿼리가 행마다 평가돼 느려짐 | `(select …)` 로 감싸 initplan 1회 평가, 성능 기준선으로 확인 |
| R2 | 부모 조인 정책이 부모 RLS 를 다시 타며 중첩 비용 | 부모 조인은 스코프 컬럼만 비교(부모의 RLS 를 부르지 않도록 `exists` 안에서 `accessible_project_ids` 를 직접) |
| R3 | `project_ws` 실행 권한 회수가 정책 평가를 깨뜨림 | §2.3 의 실측 분기 — 둘 중 되는 쪽 |
| R4 | FK `no action` 전환으로 기존 삭제 흐름(프로젝트 삭제 cascade)이 막힘 | 프로젝트 삭제 경로는 `projects` → 자식 cascade 가 먼저 `project_members` 의존 행을 지우는지 확인. 막히면 명단 행만 `no action`, 프로젝트 삭제는 cascade 유지 순서를 설계(구현자가 실측) |
| R5 | 회의록 생성 경로 중 `workspace_id` 를 빠뜨린 곳이 남음 | `not null` 이 즉시 실패시키고, E2E 가 회의록 업로드·외부 API 를 지난다 |
| R6 | presence private 전환이 Realtime 서버 설정(`private` 채널 허용)에 의존 | 로컬 Supabase 에서 두 세션 눈확인. 안 되면 B1 의 presence 만 SP3 로 이관하고 기록 |

## 9. 열린 항목

- 없음(사용자 결정 U1~U4, 컨트롤러 기본값 D1~D4 로 닫음). 구현 중 실측 분기(R3·R4·R6)는 원장에 판정으로 남긴다.
