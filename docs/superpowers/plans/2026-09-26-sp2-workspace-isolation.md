# SP2 워크스페이스 격리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크스페이스 B 의 계정이 워크스페이스 A 의 어떤 행·파일·실시간 토픽도 읽거나 쓰지 못하게 한다. DB(RLS 40정책·`app_role()` 폐기·다섯 표의 `workspace_id`)를 먼저 닫고(Phase A), 그 위에서 Storage·Realtime(B1)과 서버 가드·service_role 경로(B2)를 병렬로 닫는다.

**Architecture:** Phase A 는 마이그레이션 `0006_workspace_isolation.sql` 하나가 개방 읽기 39정책을 SP1 헬퍼(`accessible_project_ids()`·`my_workspace_ids()`) 술어로 바꾸고, `app_role()` 을 쓰던 9정책을 명시 헬퍼로 옮긴 뒤 함수를 지우고, `minutes`·`minute_folders`·`notification_events`·`user_preferences`·`agent_watchers` 에 `workspace_id` 를 백필·`not null` 로 넣는다. 코드는 그 컬럼을 채우는 쓰기 경로만 바뀐다. 체크포인트(main) 뒤 Phase B 는 파일이 겹치지 않는 두 트랙으로 갈린다: B1 = 경로 규약 `ws/<wid>/p/<pid|_>/<entity>/<id>/<file>` + `0007_storage_realtime.sql` + presence private 채널, B2 = `requireWorkspaceAdmin`·`resolveScope`·`adminFor` + 감사표 + 외부 API 판정 통합 + `0008_workspace_settings.sql`. 판정은 여전히 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/**` 두 곳뿐이다.

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17, RLS, plpgsql, Storage, Realtime), vitest(+ `vitest.config.rls.ts` 의 pg 직결 하네스), TypeScript, 로컬 Supabase CLI 2.75 + colima.

**Spec:** `docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md`(SP2 정본, 승인됨). 헬퍼·정책 골격의 원형은 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §2.4.6. 실측 근거: 2026-09-26 카탈로그 조사(이 계획의 정책·제약 이름은 전부 로컬 DB `pg_policies`·`pg_constraint` 에서 그대로 옮겼다).

## Global Constraints

- 마이그레이션은 `0006_workspace_isolation.sql`(Phase A) · `0007_storage_realtime.sql`(B1) · `0008_workspace_settings.sql`(B2) 셋, 각각 `supabase/rollbacks/NNNN_<이름>_rollback.sql` 쌍. 다른 번호를 만들지 않는다.
- 마이그레이션 커밋에는 `supabase/migrations/*`·`supabase/rollbacks/*`·`supabase/rehearsal/*` 만 담는다(G1) — `src/` 와 `tests/` 는 다음 커밋. 본문 끝에 `Staging-verified: local db reset <YYYY-MM-DD HH:MM>`(G4).
- `git add -A` 금지 — 파일명을 명시해 stage 한다.
- 구현자는 `git push`·`git fetch`·`git stash`·`git reset`·`git tag`·`SKIP_GUARD` 를 쓰지 않는다. `main` 반영·push·태그는 컨트롤러가 사람 확인 뒤에 한다. git 시뮬레이션은 `mktemp -d` 고유 디렉터리에서 `set -e` 로, `cd X && a; b` 패턴 금지.
- `src/components/app/usePagePresence.ts` 는 UI 위험 파일 — `ui/sp2-presence` 브랜치에서 고치고 커밋에 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 트레일러.
- 가드 시그니처 동결: `requireSuperuser(): Promise<GuardResult>` · `requireProjectAdmin(projectId: string | null): Promise<GuardResult>` · `requireProjectMember(projectId: string | null): Promise<GuardResult>` · `roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null`. 신설은 `requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult>` 하나뿐.
- 새 코드·픽스처·문구에 고객명·실명·구 브랜드 금지. 픽스처는 `example.com`·`Acme`·`alice` 류(`rls-` 접두 이메일).
- 에러 처리 3원칙: 조회 실패를 "없음"으로 위장하지 않는다(표시 = 로깅) / 쓰기 전 선행 조회가 실패하면 중단 / 보안 가드는 fail-closed(모르면 거부).
- `atomic` 으로 끝나는 식별자 금지(CLI 2.75 문장 분할기 42601).
- 공유 로컬 DB: 워크트리가 여럿이어도 Supabase 스택은 하나다. `db:reset`·`supabase migration up`·`test:rls`·E2E 는 트랙 간 동시에 돌리지 않는다(컨트롤러가 순서를 준다). DB 단계는 늘 자기 워크트리의 `npm run db:reset` 부터 시작한다 — 다른 트랙이 남긴 스키마를 믿지 않는다.
- 헬퍼 SQL 관례: `language sql stable security definer set search_path = ''`, 실행 권한은 `authenticated`(필요 시 `service_role`)만. `anon`·`public` 에는 주지 않는다.

## Review Focus

1. **형식이 틀린 Storage 객체 이름 하나가 버킷 목록 조회 전체를 22P02 로 깨뜨림** — `garbage`·`ws/not-a-uuid/…`·옛 `<uuid>/파일` 형식 객체가 섞인 버킷을 A 멤버가 `select` 해도 오류 없이 자기 행만 나와야 한다(`uuid_or_null` 경유, 직접 `::uuid` 금지). → Task 7 케이스 ④.
2. **두 워크스페이스에 동시에 속한 사용자** — dana(A·B 멤버)는 양쪽을 다 읽고, A 에서 빠지는 순간 A 의 프로젝트·회의록·즐겨찾기(`minute_favorites`)가 0행이 되며 B 는 그대로여야 한다. 선호값(`user_preferences`)은 가장 먼저 가입한 워크스페이스 키로 읽힌다. → Task 2 케이스 ⓐ, Task 3 단위 테스트 `prefsWorkspaceId`, Task 10 단위 테스트(`roleIn` 양쪽).
3. **프로젝트가 없는 회의록** — `project_id is null` 회의록은 `workspace_id` 로만 스코프되고, `workspace_id` 없이 넣으면 23502, 프로젝트 삭제(FK `set null`)로 null 이 된 회의록은 원래 워크스페이스를 유지한 채 A 에서만 보인다. → Task 2 케이스 ⓑ·ⓓ.
4. **FK 가 NO ACTION 이 된 뒤 프로젝트 삭제가 명단 행으로 연쇄** — 기록 있는 명단 행 직접 삭제는 23503, 그러나 프로젝트 삭제(`projects → project_members` cascade + `projects → attendance_records` 등 cascade)는 성공해야 한다. → Task 2 Step 5 리허설(R4 분기) + 케이스 ⓒ.
5. **읽을 수 없는 pid 의 presence 토픽** — B 계정이 `project-<A pid>-presence-wbs` 로 join(SELECT)·track(INSERT)하면 0행·42501, 형식이 틀린 토픽도 오류 없이 거부. → Task 7 케이스 ⑥.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `tests/rls/fixture-ws.sql`, `tests/rls/harness.ts`(F·loadFixture), `tests/rls/isolation-map.ts`, `tests/rls/workspace-isolation.test.ts` | 2-워크스페이스 픽스처·전수 교차 | 1, 2, 14(새 표 등록) |
| `supabase/migrations/0006_workspace_isolation.sql`, `supabase/rollbacks/0006_workspace_isolation_rollback.sql`, `supabase/rehearsal/0006_smoke.sql`, `supabase/rehearsal/0006_backfill_ok.sql`, `supabase/rehearsal/0006_backfill_ambiguous.sql` | DB 격리 | 2 |
| `tests/rls/workspace-isolation-cases.test.ts` | Phase A 핀 케이스 ⓐ~ⓗ | 2 |
| `src/lib/domain/authz.ts`(`hasProjectRoleInWorkspace`), `src/lib/prefs/prefsWorkspace.ts`, `src/app/actions/{minutes,preferences,notifications,inbox,teams}.ts`, `src/app/api/v1/minutes/route.ts`, `src/app/api/v1/agent/watch/route.ts`, `src/lib/minutes/folders.ts`, `src/lib/notify/emit.ts` | `workspace_id` 쓰기 | 3 |
| `tests/rls/schema-invariants.test.ts`, `tests/invariants/no-legacy-org.test.ts`, `scripts/perf-baseline.mjs`, `docs/baseline/sp2-perf.md` | 불변식·성능 기준선 | 4 |
| `scripts/e2e-local.mjs`, `docs/baseline/sp2-e2e.md` | 체크포인트 | 5, 17 |
| `src/lib/domain/storagePath.ts`, `src/lib/domain/presenceTopics.ts` | 경로·토픽 규약(순수) | 6 |
| `supabase/migrations/0007_storage_realtime.sql`(+ 롤백·`0007_smoke.sql`), `tests/rls/storage-realtime.test.ts` | Storage·Realtime 정책 | 7 |
| `src/lib/domain/{issueAttachments,minutes}.ts`, `src/components/minutes/{MinuteUploadModal,MinuteViewer}.tsx`, `src/components/wbs/RowDetailPanel.tsx`, `src/lib/issues/uploadIssueAttachments.ts`, `src/app/actions/{attachments,issueAttachments,issues,minutes}.ts`, `src/lib/data/minutes.ts` | 업로드 5곳·검증기 | 8 |
| `src/components/app/usePagePresence.ts`, `src/components/weekly/usePresence.ts`, `src/components/wbs/WbsGanttSheet.tsx`, `src/components/weekly/WeeklySheetView.tsx` | presence private | 9 |
| `src/lib/domain/authz.ts`(`workspaceAdminVerdict`·`isHiddenProject`), `src/lib/authz/{index,scope,scopeAdmin}.ts`, `src/lib/agent/delegation.ts`, `tests/authz/guard-signatures.test.ts` | 가드·스코프 | 10 |
| `src/app/actions/{project,projectInvites,chat,teams,accounts}.ts`, `src/app/api/{chat/reindex,import/execute}/route.ts`, 호출 화면, `tests/invariants/platform-guards.test.ts` | `requireSuperuser` 13곳 | 11 |
| `src/lib/supabase/adminFor.ts`, `docs/sp2-admin-client-audit.md`, `tests/invariants/admin-scope.test.ts`, `src/lib/teams/master.ts`, `src/app/api/v1/minutes/meta/route.ts`, `src/app/api/v1/agent/{me,watch}/route.ts`, `docs/design/dflow-minutes-upload-api-spec.md` | service_role 감사·누설 수정 | 12 |
| `src/lib/agent/externalApi.ts`, `src/lib/minutes/externalApi.ts`, `src/app/api/v1/minutes/folder/route.ts` | 외부 API 판정 통합 | 13 |
| `supabase/migrations/0008_workspace_settings.sql`(+ 롤백·`0008_smoke.sql`), `src/app/actions/{projectInvites,inviteRedeem}.ts`, `tests/rls/workspace-settings.test.ts` | 초대·설정 | 14 |
| `src/lib/ai/knowledge.ts`, `src/app/(app)/minutes/[id]/page.tsx`, `src/app/(app)/p/[projectId]/{agents,attendance,wbs,meetings,issues}/page.tsx`, `src/app/(app)/p/[projectId]/layout.tsx`, `src/app/(app)/admin/accounts/page.tsx`, `src/lib/data/members.ts` | 이월 정리 | 15 |
| `src/app/actions/minutes.ts`(가드 스코프), `src/app/(app)/minutes/page.tsx` | 통합: 회의록 액션 `resolveScope` | 16 |

---

## Phase A — DB 격리

브랜치: `sp2/phase-a`(이미 있다 — `main` 에서 분기됨). Task 1~5 는 이 브랜치에서 순서대로. `main` 반영은 Task 5 체크포인트에서 컨트롤러가 한다.

### Task 1: 2-워크스페이스 RLS 픽스처 + 전수 교차 테스트 — 현재 DB 의 누설 목록을 먼저 기록

**Files:**
- Create: `tests/rls/fixture-ws.sql`, `tests/rls/isolation-map.ts`, `tests/rls/workspace-isolation.test.ts`
- Modify: `tests/rls/harness.ts`(`F` 확장, `loadFixture` 가 두 파일을 적용·전제 확인)

**Interfaces:**
- Produces(`harness.ts` 의 `F` 추가분 — 기존 키는 그대로):
```ts
F.wsB            // = F.otherWs('rls-other') — 워크스페이스 B. ⑨ 의 이동 대상과 같은 행이다
F.users.bAdmin   // bea — B 워크스페이스 관리자(명단 없음)
F.users.bMember  // ben — B 멤버, B 프로젝트 명단 member
F.users.aLoose   // cy  — A 워크스페이스 멤버, 명단 없음
F.users.dual     // dana — A·B 둘 다 멤버, 양쪽 명단 member
F.projects.aPrivate // A 비공개 프로젝트
F.projects.bWs      // B 워크스페이스의 프로젝트
F.rows.{meeting, issue, minute, minuteVersion, wikiTopic, wikiItem, wikiItem2, weeklyReport, globalEvent, folder, minuteFile, attendance}
```
- Produces(`isolation-map.ts`): `A_ROW_FILTER: Record<string, string>`(72표 × "A 행" 판별 SQL, 별칭 `t`), `OPEN_BY_DESIGN: ReadonlySet<string>`(= `issue_mega_areas`, D2), `UNFILLED: Record<string, string>`(픽스처가 못 채운 표 → 사유), `OWN_INSERT_PROBES`, `KNOWN_LEAKS: Record<'bea' | 'ben', readonly string[]>`.
- 누설 키 형식: `<표>:<read|insert|update|delete|insert-own>`.

- [ ] **Step 1: 픽스처 SQL**

`tests/rls/fixture-ws.sql`(fixture.sql 뒤에 같은 트랜잭션으로 적용 — 멱등, 고정 uuid, 넷째 묶음 `7e57`):
```sql
-- tests/rls 2-워크스페이스 픽스처(SP2) — fixture.sql 뒤에 loadFixture 가 같은 트랜잭션으로 흘린다(postgres 롤, 멱등).
-- A = rls-acme(…aa01), B = rls-other(…aa02). A 의 모든 스코프 표에 행 1개 이상을 둔다 — 전수 교차 테스트가 "빈 표라 0행" 으로
-- 통과하지 않게. 새 id: 계정 …a6~a9 · 인물 …b6~ba · 프로젝트 …c3~c4 · 팀 …d5 · 명단 …e4~e7 · 리프 …f4~f6 · A 엔터티 …11NN.
-- bigint identity 표는 7057001 을 명시 id 로 쓴다(시퀀스를 건드리지 않는다).

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
select v.id, v.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
       '00000000-0000-0000-0000-000000000000', now(), now()
  from (values
    ('00000000-0000-0000-7e57-0000000000a6'::uuid, 'rls-bea@example.com'),
    ('00000000-0000-0000-7e57-0000000000a7'::uuid, 'rls-ben@example.com'),
    ('00000000-0000-0000-7e57-0000000000a8'::uuid, 'rls-cy@example.com'),
    ('00000000-0000-0000-7e57-0000000000a9'::uuid, 'rls-dana@example.com')) as v(id, email)
on conflict do nothing;

insert into public.profiles (user_id, email, display_name) values
  ('00000000-0000-0000-7e57-0000000000a6', 'rls-bea@example.com', 'bea'),
  ('00000000-0000-0000-7e57-0000000000a7', 'rls-ben@example.com', 'ben'),
  ('00000000-0000-0000-7e57-0000000000a8', 'rls-cy@example.com', 'cy'),
  ('00000000-0000-0000-7e57-0000000000a9', 'rls-dana@example.com', 'dana')
on conflict do nothing;

-- B: bea 관리자, ben 멤버, dana 멤버. A: cy 멤버(명단 없음), dana 멤버. dana 는 A 에 먼저 가입(선호값 키 = A).
insert into public.workspace_members (workspace_id, user_id, role, created_at) values
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a6', 'admin',  now()),
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a7', 'member', now()),
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a8', 'member', now()),
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a9', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a9', 'member', now())
on conflict do nothing;

insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-7e57-0000000000b6', '00000000-0000-0000-7e57-00000000aa02', 'bea',  'rls-bea@example.com',  '00000000-0000-0000-7e57-0000000000a6'),
  ('00000000-0000-0000-7e57-0000000000b7', '00000000-0000-0000-7e57-00000000aa02', 'ben',  'rls-ben@example.com',  '00000000-0000-0000-7e57-0000000000a7'),
  ('00000000-0000-0000-7e57-0000000000b8', '00000000-0000-0000-7e57-00000000aa01', 'cy',   'rls-cy@example.com',   '00000000-0000-0000-7e57-0000000000a8'),
  ('00000000-0000-0000-7e57-0000000000b9', '00000000-0000-0000-7e57-00000000aa01', 'dana', 'rls-dana@example.com', '00000000-0000-0000-7e57-0000000000a9'),
  ('00000000-0000-0000-7e57-0000000000ba', '00000000-0000-0000-7e57-00000000aa02', 'dana', 'rls-dana@example.com', '00000000-0000-0000-7e57-0000000000a9')
on conflict do nothing;

insert into public.projects (id, name, workspace_id, is_private) values
  ('00000000-0000-0000-7e57-0000000000c3', 'RLS A private', '00000000-0000-0000-7e57-00000000aa01', true),
  ('00000000-0000-0000-7e57-0000000000c4', 'RLS Other P',   '00000000-0000-0000-7e57-00000000aa02', false)
on conflict do nothing;
insert into public.project_settings (project_id, level_labels) values
  ('00000000-0000-0000-7e57-0000000000c3', array['Phase','Task','Activity']),
  ('00000000-0000-0000-7e57-0000000000c4', array['Phase','Task','Activity'])
on conflict do nothing;
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-7e57-0000000000d5', '00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000c4', 'OPS', 'OPS')
on conflict do nothing;
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-7e57-0000000000e4', '00000000-0000-0000-7e57-0000000000c4', '00000000-0000-0000-7e57-0000000000b7', 'member'),
  ('00000000-0000-0000-7e57-0000000000e5', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000b9', 'member'),
  ('00000000-0000-0000-7e57-0000000000e6', '00000000-0000-0000-7e57-0000000000c4', '00000000-0000-0000-7e57-0000000000ba', 'member'),
  ('00000000-0000-0000-7e57-0000000000e7', '00000000-0000-0000-7e57-0000000000c3', '00000000-0000-0000-7e57-0000000000b3', 'member')
on conflict do nothing;
insert into public.project_member_teams (member_id, team_id, is_primary) values
  ('00000000-0000-0000-7e57-0000000000e4', '00000000-0000-0000-7e57-0000000000d5', true),
  ('00000000-0000-0000-7e57-0000000000e6', '00000000-0000-0000-7e57-0000000000d5', true)
on conflict do nothing;
insert into public.wbs_items (id, project_id, code, name, planned_start, planned_end) values
  ('00000000-0000-0000-7e57-0000000000f4', '00000000-0000-0000-7e57-0000000000c4', '1', 'OPS 리프', null, null),
  ('00000000-0000-0000-7e57-0000000000f5', '00000000-0000-0000-7e57-0000000000c1', '2', '선행', '2026-09-01', '2026-09-05'),
  ('00000000-0000-0000-7e57-0000000000f6', '00000000-0000-0000-7e57-0000000000c1', '3', '후행', '2026-09-08', '2026-09-12')
on conflict do nothing;
insert into public.item_owners (wbs_item_id, team_id, kind) values
  ('00000000-0000-0000-7e57-0000000000f4', '00000000-0000-0000-7e57-0000000000d5', 'primary')
on conflict do nothing;

-- 전역 참조(D2 예외) — 이슈 대분류·번호 카운터의 전제
insert into public.issue_mega_areas (code, name, sort_order, active) values ('RLSX', 'RLS 영역', 999, true)
on conflict do nothing;

-- ── A(프로젝트 c1) 엔터티: 스코프 표마다 1행 ────────────────────────────────────────────
insert into public.meetings (id, project_id, title, meeting_date) values
  ('00000000-0000-0000-7e57-000000001101', '00000000-0000-0000-7e57-0000000000c1', 'RLS 회의', '2026-09-01') on conflict do nothing;
insert into public.issues (id, project_id, title) values
  ('00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'RLS 이슈') on conflict do nothing;
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-0000000000c1', '2026-09-01', 'ERP', 'RLS 회의록', '# RLS', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id) values
  ('00000000-0000-0000-7e57-000000001104', '00000000-0000-0000-7e57-000000001103', 1, '# RLS', 'rls-h', 'RLS 회의록', '2026-09-01', 'ERP', '00000000-0000-0000-7e57-0000000000c1')
  on conflict do nothing;
insert into public.wiki_topics (id, project_id, title, normalized_title) values
  ('00000000-0000-0000-7e57-000000001105', '00000000-0000-0000-7e57-0000000000c1', 'RLS 토픽', 'rls 토픽') on conflict do nothing;
insert into public.wiki_items (id, project_id, topic_id, kind, statement, statement_hash, knowledge_key, certainty) values
  ('00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'fact', 'RLS 사실 1', 'rls-s1', 'rls-k1', 'explicit'),
  ('00000000-0000-0000-7e57-000000001107', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'fact', 'RLS 사실 2', 'rls-s2', 'rls-k2', 'explicit')
  on conflict do nothing;
insert into public.weekly_reports (id, project_id, week_start) values
  ('00000000-0000-0000-7e57-000000001108', '00000000-0000-0000-7e57-0000000000c1', '2026-08-31') on conflict do nothing;
-- audience='global' — 0005 까지는 전원에게 열린 분기(§2.1). 0006 뒤에는 누구에게도 안 보여야 한다(수신자 행 없음)
insert into public.notification_events (id, type, category, audience, project_id, payload) values
  ('00000000-0000-0000-7e57-000000001109', 'rls_test', 'system', 'global', '00000000-0000-0000-7e57-0000000000c1', '{"title":"rls"}')
  on conflict do nothing;
insert into public.announcements (id, project_id, title) values
  ('00000000-0000-0000-7e57-00000000110a', '00000000-0000-0000-7e57-0000000000c1', 'RLS 공지') on conflict do nothing;
insert into public.agent_work_orders (id, project_id) values
  ('00000000-0000-0000-7e57-00000000110b', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.project_areas (id, project_id, kind, code, name) values
  ('00000000-0000-0000-7e57-00000000110c', '00000000-0000-0000-7e57-0000000000c1', 'weekly_section', 'RLSA', 'RLS 영역') on conflict do nothing;
insert into public.minute_folders (id, project_id, name, created_by) values
  ('00000000-0000-0000-7e57-00000000110d', '00000000-0000-0000-7e57-0000000000c1', 'RLS 폴더', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.issue_major_processes (id, project_id, mega_code, name) values
  ('00000000-0000-0000-7e57-00000000110e', '00000000-0000-0000-7e57-0000000000c1', 'RLSX', 'RLS 대분류') on conflict do nothing;
insert into public.wiki_item_sources (id, wiki_item_id, minute_id, minute_version_id, body_hash, block_index, block_hash, relation) values
  ('00000000-0000-0000-7e57-00000000110f', '00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 'rls-h', 0, 'rls-b', 'supports')
  on conflict do nothing;
insert into public.issue_links (id, issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot, minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot) values
  ('00000000-0000-0000-7e57-000000001110', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 1, 'RLS 회의록', '2026-09-01', 'rls-h', 0, 'rls-b', 'rls 발췌')
  on conflict do nothing;
insert into public.issue_updates (id, issue_id, project_id, body, author_name) values
  ('00000000-0000-0000-7e57-000000001111', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'RLS 경과', 'alice') on conflict do nothing;
insert into public.issue_attachments (id, issue_id, project_id, file_name, file_path) values
  ('00000000-0000-0000-7e57-000000001112', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'a.txt', 'rls/a.txt') on conflict do nothing;
insert into public.issue_analysis_runs (id, project_id, input_hash, prompt_version, model) values
  ('00000000-0000-0000-7e57-000000001113', '00000000-0000-0000-7e57-0000000000c1', repeat('a', 64), 'v1', 'rls-model') on conflict do nothing;
insert into public.attendance_records (id, project_id, member_id, date, type) values
  ('00000000-0000-0000-7e57-000000001114', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000e1', '2026-09-01', 'work') on conflict do nothing;
insert into public.change_logs (id, wbs_item_id, field, user_id) values
  ('00000000-0000-0000-7e57-000000001115', '00000000-0000-0000-7e57-0000000000f1', 'actual_pct', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.deliverable_attachments (id, wbs_item_id, file_name, file_path) values
  ('00000000-0000-0000-7e57-000000001116', '00000000-0000-0000-7e57-0000000000f1', 'd.txt', 'rls/d.txt') on conflict do nothing;
insert into public.minute_embeddings (id, minute_id, chunk_index, content, embedding) values
  ('00000000-0000-0000-7e57-000000001117', '00000000-0000-0000-7e57-000000001103', 0, 'rls', array_fill(0::real, array[768])::vector) on conflict do nothing;
insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by) values
  ('00000000-0000-0000-7e57-000000001118', '00000000-0000-0000-7e57-000000001103', 'attachment', 'f.txt', 'rls/f.txt', 1, 'text/plain', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minute_highlights (id, minute_id, block_index, block_hash, created_by) values
  ('00000000-0000-0000-7e57-000000001119', '00000000-0000-0000-7e57-000000001103', 0, 'rls-b', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.minute_insights (id, minute_id, body_hash, kind, block_index) values
  ('00000000-0000-0000-7e57-00000000111a', '00000000-0000-0000-7e57-000000001103', 'rls-h', 'decision', 0) on conflict do nothing;
insert into public.notification_recipients (id, event_id, user_id) values
  ('00000000-0000-0000-7e57-00000000111b', '00000000-0000-0000-7e57-000000001109', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.project_ai_briefs (id, project_id, kind, input_hash, status) values
  ('00000000-0000-0000-7e57-00000000111c', '00000000-0000-0000-7e57-0000000000c1', 'weekly', 'rls-h', 'ready') on conflict do nothing;
insert into public.task_dependencies (id, project_id, predecessor_id, successor_id) values
  ('00000000-0000-0000-7e57-00000000111d', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000f5', '00000000-0000-0000-7e57-0000000000f6')
  on conflict do nothing;
insert into public.wbs_embeddings (id, project_id, kind, content) values
  ('00000000-0000-0000-7e57-00000000111e', '00000000-0000-0000-7e57-0000000000c1', 'project', 'rls') on conflict do nothing;
insert into public.weekly_report_rows (id, report_id) values
  ('00000000-0000-0000-7e57-00000000111f', '00000000-0000-0000-7e57-000000001108') on conflict do nothing;
insert into public.wiki_change_events (id, project_id, change_type, wiki_item_id) values
  ('00000000-0000-0000-7e57-000000001120', '00000000-0000-0000-7e57-0000000000c1', 'new', '00000000-0000-0000-7e57-000000001106') on conflict do nothing;
insert into public.wiki_feedback (id, project_id, topic_id, feedback_type) values
  ('00000000-0000-0000-7e57-000000001121', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'helpful') on conflict do nothing;
insert into public.wiki_item_relations (id, from_item_id, to_item_id, relation) values
  ('00000000-0000-0000-7e57-000000001122', '00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-000000001107', 'confirms') on conflict do nothing;
insert into public.wiki_questions (id, project_id, question) values
  ('00000000-0000-0000-7e57-000000001123', '00000000-0000-0000-7e57-0000000000c1', 'RLS?') on conflict do nothing;
insert into public.wiki_topic_revisions (id, topic_id, project_id, version_no, title, body_md, body_hash, document_kind) values
  ('00000000-0000-0000-7e57-000000001124', '00000000-0000-0000-7e57-000000001105', '00000000-0000-0000-7e57-0000000000c1', 1, 'RLS 토픽', '# RLS', 'rls-h', 'overview')
  on conflict do nothing;
insert into public.ai_documents (id, project_id, domain, entity_type, entity_id, chunk_no, content, content_hash, href, embedding_model, chunker_version) values
  ('00000000-0000-0000-7e57-000000001125', '00000000-0000-0000-7e57-0000000000c1', 'wbs', 'wbs_item', '00000000-0000-0000-7e57-0000000000f1', 0, 'rls', 'rls-c', '/p/x/wbs', 'rls-model', 'v1')
  on conflict do nothing;
insert into public.agent_runners (id, name, owner_user_id, token_prefix, token_hash, expires_at, project_id) values
  ('00000000-0000-0000-7e57-000000001126', 'rls', '00000000-0000-0000-7e57-0000000000a3', 'rls_a', 'rls-token-hash', now() + interval '1 year', '00000000-0000-0000-7e57-0000000000c1')
  on conflict do nothing;
insert into public.agent_watchers (id, user_id, agent, project_id) values
  ('00000000-0000-0000-7e57-000000001127', '00000000-0000-0000-7e57-0000000000a3', 'rls-agent', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent) values
  ('00000000-0000-0000-7e57-000000001128', '00000000-0000-0000-7e57-00000000110b', 'progress', 10, 'rls', 'rls-agent') on conflict do nothing;
insert into public.project_invites (id, workspace_id, project_id, email, access_role, token_hash, created_by, expires_at) values
  ('00000000-0000-0000-7e57-000000001129', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c1', 'rls-invitee@example.com', 'member', 'rls-invite-hash', '00000000-0000-0000-7e57-0000000000a2', now() + interval '1 year')
  on conflict do nothing;
insert into public.usage_events (id, user_id, menu_key, path, project_id) values
  ('00000000-0000-0000-7e57-00000000112a', '00000000-0000-0000-7e57-0000000000a3', 'wbs', '/p/rls/wbs', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.ai_index_jobs (id, job_key, operation, domain, entity_type, entity_id, project_id) values
  (7057001, 'rls-a', 'upsert', 'wbs', 'wbs_item', 'rls', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.wiki_processing_jobs (id, project_id, minute_id, minute_version_id, body_hash) values
  (7057001, '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 'rls-h') on conflict do nothing;
insert into public.llm_profiles (id, name, preset_id, provider, model) values (7057001, 'rls', 'rls', 'rls', 'rls-model') on conflict do nothing;
insert into public.llm_config (id, mode) values (1, 'env') on conflict do nothing;
-- 복합 키 표
insert into public.agent_lead_leases (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.agent_projects (project_id) values ('00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.announcement_seen (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.holidays (project_id, date) values ('00000000-0000-0000-7e57-0000000000c1', '2026-01-01') on conflict do nothing;
insert into public.issue_assignees (issue_id, member_id, project_id) values
  ('00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.issue_number_counters (project_id, mega_code, last_no) values ('00000000-0000-0000-7e57-0000000000c1', 'RLSX', 1) on conflict do nothing;
insert into public.meeting_attendees (meeting_id, member_id, project_id) values
  ('00000000-0000-0000-7e57-000000001101', '00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.meeting_exceptions (meeting_id, occurrence_date) values ('00000000-0000-0000-7e57-000000001101', '2026-09-08') on conflict do nothing;
-- dana(두 워크스페이스)의 A 회의록 즐겨찾기 — Review Focus 2 의 전제
insert into public.minute_favorites (user_id, minute_id) values
  ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-000000001103'),
  ('00000000-0000-0000-7e57-0000000000a9', '00000000-0000-0000-7e57-000000001103') on conflict do nothing;
insert into public.user_preferences (user_id, prefs) values ('00000000-0000-0000-7e57-0000000000a3', '{}') on conflict do nothing;
insert into public.user_wbs_state (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.wbs_progress_snapshots (project_id, snap_date, actual_pct, planned_pct) values ('00000000-0000-0000-7e57-0000000000c1', '2026-09-01', 10, 20) on conflict do nothing;
insert into public.wiki_project_rebuild_jobs (project_id) values ('00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.area_teams (area_id, team_id, kind) values ('00000000-0000-0000-7e57-00000000110c', '00000000-0000-0000-7e57-0000000000d1', 'primary') on conflict do nothing;
```
어느 insert 가 트리거·CHECK 로 실패하면 값을 고쳐 채운다(표를 빼지 않는다). 값으로 풀 수 없으면 그 insert 를 지우고 `isolation-map.ts` 의 `UNFILLED` 에 `표: 사유(오류 코드·메시지)` 를 적는다.

- [ ] **Step 2: 하네스 확장**

`tests/rls/harness.ts` — `FIXTURE_SQL` 옆에 `const FIXTURE_WS_SQL = fileURLToPath(new URL('./fixture-ws.sql', import.meta.url))`; `loadFixture` 는 `begin; <fixture.sql>; <fixture-ws.sql>; commit` 으로 두 파일을 한 트랜잭션에 흘린다. `F` 에 추가(기존 키 유지):
```ts
  /** 워크스페이스 B — F.otherWs 와 같은 행. SP2 교차 테스트는 이 이름으로 쓴다 */
  wsB: '00000000-0000-0000-7e57-00000000aa02',
  users: {
    /* 기존 platform·wsAdmin·member 그대로 */
    /** bea — B 워크스페이스 관리자(명단 없음) */ bAdmin: '00000000-0000-0000-7e57-0000000000a6',
    /** ben — B 멤버, B 프로젝트 명단 member */ bMember: '00000000-0000-0000-7e57-0000000000a7',
    /** cy — A 워크스페이스 멤버, 명단 없음 */ aLoose: '00000000-0000-0000-7e57-0000000000a8',
    /** dana — A·B 둘 다 멤버(A 먼저 가입), 양쪽 명단 member */ dual: '00000000-0000-0000-7e57-0000000000a9',
  },
  projects: { /* 기존 a·b 그대로 */ aPrivate: '00000000-0000-0000-7e57-0000000000c3', bWs: '00000000-0000-0000-7e57-0000000000c4' },
  teams: { /* 기존 erp·mes·qa·qa2 그대로 */ ops: '00000000-0000-0000-7e57-0000000000d5' },
  leaf: { /* 기존 aErp·bQa·bOwnTeam 그대로 */
    bWs: '00000000-0000-0000-7e57-0000000000f4', aDep1: '00000000-0000-0000-7e57-0000000000f5', aDep2: '00000000-0000-0000-7e57-0000000000f6' },
  people: { /* 기존 platform·wsAdmin·member·external 그대로 */
    bAdmin: '00000000-0000-0000-7e57-0000000000b6', bMember: '00000000-0000-0000-7e57-0000000000b7',
    aLoose: '00000000-0000-0000-7e57-0000000000b8', dualA: '00000000-0000-0000-7e57-0000000000b9',
    dualB: '00000000-0000-0000-7e57-0000000000ba' },
  members: { /* 기존 aliceA·aliceB·bobA 그대로 */
    benB: '00000000-0000-0000-7e57-0000000000e4', danaA: '00000000-0000-0000-7e57-0000000000e5',
    danaB: '00000000-0000-0000-7e57-0000000000e6', alicePrivate: '00000000-0000-0000-7e57-0000000000e7' },
  rows: {
    meeting: '00000000-0000-0000-7e57-000000001101', issue: '00000000-0000-0000-7e57-000000001102',
    minute: '00000000-0000-0000-7e57-000000001103', minuteVersion: '00000000-0000-0000-7e57-000000001104',
    wikiTopic: '00000000-0000-0000-7e57-000000001105', wikiItem: '00000000-0000-0000-7e57-000000001106',
    wikiItem2: '00000000-0000-0000-7e57-000000001107', weeklyReport: '00000000-0000-0000-7e57-000000001108',
    globalEvent: '00000000-0000-0000-7e57-000000001109', folder: '00000000-0000-0000-7e57-00000000110d',
    attendance: '00000000-0000-0000-7e57-000000001114', minuteFile: '00000000-0000-0000-7e57-000000001118',
  },
```
(`/* 기존 … 그대로 */` 자리에는 현재 `harness.ts` 의 해당 키를 그대로 둔다 — 새 키만 덧붙이는 편집이다.)
`loadFixture` 의 전제 확인 SQL 끝에 한 줄 추가: `and (select array_agg(user_id) from public.workspace_members where workspace_id = $10 and role = 'admin') = array[$11::uuid]`(`$10 = F.wsB`, `$11 = F.users.bAdmin`).

- [ ] **Step 3: 판별 맵 — `tests/rls/isolation-map.ts`**

```ts
// 전수 교차 테스트(workspace-isolation.test.ts)의 표별 "A 행" 판별식. service 경로(RLS 없음)에서 별칭 t 로 평가한다.
// 표가 새로 생기면 여기 없다는 이유로 테스트가 실패한다 — 새 표의 스코프를 반드시 정하게 한다.
import { F } from './harness'

const A = `'${F.ws}'::uuid`
const AP = `(select id from public.projects where workspace_id = ${A})`
/** A 에만 속한 계정 — 두 워크스페이스 사용자(dana)는 빠진다 */
const A_ONLY = `(select user_id from public.workspace_members where workspace_id = ${A}
                 except select user_id from public.workspace_members where workspace_id <> ${A})`
const A_MINUTES = `(select id from public.minutes where project_id in ${AP} or (project_id is null and created_by in ${A_ONLY}))`
const inAP = 't.project_id in ' + AP

export const A_ROW_FILTER: Record<string, string> = {
  agent_lead_leases: inAP, agent_projects: inAP,
  agent_runners: `(${inAP} or t.owner_user_id in ${A_ONLY})`,
  agent_watchers: `(${inAP} or t.user_id in ${A_ONLY})`,
  agent_work_orders: inAP,
  agent_work_reports: `t.work_order_id in (select id from public.agent_work_orders where project_id in ${AP})`,
  ai_documents: inAP, ai_index_jobs: inAP, announcement_seen: inAP, announcements: inAP,
  area_teams: `t.area_id in (select id from public.project_areas where project_id in ${AP})`,
  attendance_records: inAP,
  change_logs: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  deliverable_attachments: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  holidays: inAP, issue_analysis_runs: inAP, issue_assignees: inAP, issue_attachments: inAP, issue_links: inAP,
  issue_major_processes: inAP, issue_mega_areas: 'true', issue_number_counters: inAP, issue_updates: inAP, issues: inAP,
  item_owners: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  llm_config: 'true', llm_profiles: 'true',
  meeting_attendees: inAP,
  meeting_exceptions: `t.meeting_id in (select id from public.meetings where project_id in ${AP})`,
  meetings: inAP,
  minute_embeddings: `t.minute_id in ${A_MINUTES}`, minute_favorites: `t.minute_id in ${A_MINUTES}`,
  minute_files: `t.minute_id in ${A_MINUTES}`,
  minute_folders: `(${inAP} or (t.project_id is null and t.created_by in ${A_ONLY}))`,
  minute_highlights: `t.minute_id in ${A_MINUTES}`, minute_insights: `t.minute_id in ${A_MINUTES}`,
  minute_versions: `t.minute_id in ${A_MINUTES}`, minutes: `t.id in ${A_MINUTES}`,
  notification_events: `(${inAP} or (t.project_id is null and t.actor_user_id in ${A_ONLY}))`,
  notification_recipients: `t.event_id in (select id from public.notification_events where project_id in ${AP})`,
  people: `t.workspace_id = ${A}`,
  platform_admins: 'true',
  profiles: `t.user_id in ${A_ONLY}`,
  project_ai_briefs: inAP, project_areas: inAP, project_invites: inAP,
  project_member_teams: `t.member_id in (select id from public.project_members where project_id in ${AP})`,
  project_members: inAP, project_settings: inAP,
  projects: `t.workspace_id = ${A}`,
  task_dependencies: inAP,
  teams: `t.workspace_id = ${A}`,
  usage_events: `(${inAP} or t.user_id in ${A_ONLY})`,
  user_preferences: `t.user_id in ${A_ONLY}`,
  user_wbs_state: inAP, wbs_embeddings: inAP, wbs_items: inAP, wbs_progress_snapshots: inAP,
  weekly_report_rows: `t.report_id in (select id from public.weekly_reports where project_id in ${AP})`,
  weekly_reports: inAP, wiki_change_events: inAP, wiki_feedback: inAP,
  wiki_item_relations: `t.from_item_id in (select id from public.wiki_items where project_id in ${AP})`,
  wiki_item_sources: `t.wiki_item_id in (select id from public.wiki_items where project_id in ${AP})`,
  wiki_items: inAP, wiki_processing_jobs: inAP, wiki_project_rebuild_jobs: inAP, wiki_questions: inAP,
  wiki_topic_revisions: inAP, wiki_topics: inAP,
  workspace_members: `t.workspace_id = ${A}`,
  workspaces: `t.id = ${A}`,
}

/** D2 — 전역 참조 데이터. 읽기는 예외(쓰기는 여전히 거부돼야 한다). 만료: SP5 */
export const OPEN_BY_DESIGN: ReadonlySet<string> = new Set(['issue_mega_areas'])

/** 픽스처가 A 행을 넣지 못한 표 → 사유. 비어 있는 게 목표다 */
export const UNFILLED: Record<string, string> = {}

/** B 계정이 "자기 이름으로" A 부모에 매다는 쓰기 — 복사 insert 로는 안 드러나는 경로($1 = B 계정 id) */
export const OWN_INSERT_PROBES: ReadonlyArray<{ table: string; sql: string }> = [
  { table: 'change_logs', sql: `insert into public.change_logs (wbs_item_id, field, user_id) values ('${F.leaf.aErp}', 'actual_pct', $1)` },
  { table: 'minute_highlights', sql: `insert into public.minute_highlights (minute_id, block_index, block_hash, created_by) values ('${F.rows.minute}', 7, 'rls-x', $1)` },
  { table: 'minute_folders', sql: `insert into public.minute_folders (name, project_id, created_by) values ('RLS 침입', '${F.projects.a}', $1)` },
  { table: 'minute_files', sql: `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by) values ('${F.rows.minute}', 'attachment', 'x.txt', 'rls/x.txt', 1, 'text/plain', $1)` },
  { table: 'minute_favorites', sql: `insert into public.minute_favorites (user_id, minute_id) values ($1, '${F.rows.minute}')` },
  { table: 'announcement_seen', sql: `insert into public.announcement_seen (user_id, project_id) values ($1, '${F.projects.a}')` },
  { table: 'user_wbs_state', sql: `insert into public.user_wbs_state (user_id, project_id) values ($1, '${F.projects.a}')` },
]

/** 0005 까지 열려 있던 개방 읽기(D2 예외 제외 39) + audience='global' 알림 */
const READ_LEAKS_0005 = [
  'ai_documents', 'announcements', 'attendance_records', 'change_logs', 'deliverable_attachments', 'holidays',
  'issue_assignees', 'issue_attachments', 'issue_links', 'issue_major_processes', 'issue_updates', 'issues', 'item_owners',
  'meeting_attendees', 'meeting_exceptions', 'meetings', 'minute_embeddings', 'minute_files', 'minute_folders',
  'minute_highlights', 'minute_insights', 'minute_versions', 'minutes', 'notification_events', 'project_ai_briefs',
  'project_members', 'project_settings', 'projects', 'task_dependencies', 'teams', 'wbs_embeddings', 'wbs_items',
  'wbs_progress_snapshots', 'weekly_report_rows', 'weekly_reports', 'wiki_change_events', 'wiki_item_relations',
  'wiki_item_sources', 'wiki_items', 'wiki_topics',
].map((t) => `${t}:read`)
const OWN_INSERT_LEAKS_0005 = ['change_logs', 'minute_highlights', 'minute_folders', 'minute_favorites', 'announcement_seen', 'user_wbs_state']
  .map((t) => `${t}:insert-own`)

/**
 * 0005 실측 누설(Task 1 에서 기록, Task 2 에서 [] 로 비운다). bea 는 B 워크스페이스 관리자라 옛 app_role() 이
 * 'pmo_admin' 을 돌려준다(M4 — 아무 워크스페이스의 관리자) → A 회의록 폴더·하이라이트·첨부를 고치고 지운다.
 */
export const KNOWN_LEAKS: Record<'bea' | 'ben', readonly string[]> = {
  bea: [...READ_LEAKS_0005, ...OWN_INSERT_LEAKS_0005, 'minute_files:insert-own',
    'minute_folders:update', 'minute_folders:delete', 'minute_highlights:delete', 'minute_files:update', 'minute_files:delete'],
  ben: [...READ_LEAKS_0005, ...OWN_INSERT_LEAKS_0005],
}
```

- [ ] **Step 4: 전수 교차 테스트 — `tests/rls/workspace-isolation.test.ts`**

```ts
// SP2 done_when 본체: B 워크스페이스 계정이 A 의 전 RLS 표를 0행 읽고, 쓰기가 전부 거부되는가.
// 표 목록은 카탈로그에서 읽는다(pg_class.relrowsecurity) — 새 표는 isolation-map 에 판별식이 없으면 실패한다.
// 읽기: A 행의 PK 튜플 집합 ∩ B 세션이 보는 PK 튜플 집합 = ∅. 쓰기: A 행 한 개를 복사 insert·자기 자신으로 update·delete.
// 쓰기 판정: 오류가 RLS(42501)·트리거 거부면 막힌 것, 23505·23503·23502·23P01·CHECK 위반(제약 이름 있음)이면 RLS 를 통과한 것.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool } from './harness'
import { A_ROW_FILTER, KNOWN_LEAKS, OPEN_BY_DESIGN, OWN_INSERT_PROBES, UNFILLED } from './isolation-map'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const RLS_TABLES_SQL = `
  select c.relname::text as name,
         array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                where i.indrelid = c.oid and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)) as pk,
         array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and a.attgenerated = '' order by a.attnum) as cols
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity order by 1`

type Tbl = { name: string; pk: string[]; cols: string[] }
const q = (id: string) => `"${id}"`
const keyOf = (t: Tbl) => `row(${t.pk.map((c) => `t.${q(c)}`).join(', ')})::text`

/** RLS 를 통과한 뒤에야 나는 오류(=쓰기가 정책에서 막히지 않았다) */
function passedRls(e: DatabaseError): boolean {
  return ['23505', '23503', '23502', '23P01'].includes(e.code ?? '') || (e.code === '23514' && Boolean(e.constraint))
}

async function probe(c: PoolClient, sql: string, params: unknown[]): Promise<{ err: DatabaseError | null; rowCount: number }> {
  await c.query('savepoint probe')
  try {
    const r = await c.query(sql, params)
    return { err: null, rowCount: r.rowCount ?? 0 }
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e
    return { err: e, rowCount: 0 }
  } finally {
    await c.query('rollback to savepoint probe')
  }
}

/** 세션이 보는 PK 튜플. 표 권한이 없으면(42501) null = 0행과 같다. 그 밖의 오류는 던진다(조용히 0행으로 삼지 않는다). */
async function readKeys(c: PoolClient, t: Tbl): Promise<string[] | null> {
  await c.query('savepoint probe')
  try {
    const { rows } = await c.query<{ k: string }>(`select ${keyOf(t)} as k from public.${q(t.name)} t`)
    await c.query('release savepoint probe')
    return rows.map((r) => r.k)
  } catch (e) {
    await c.query('rollback to savepoint probe')
    if (e instanceof DatabaseError && e.code === '42501') return null
    throw e
  }
}

async function scanUser(label: 'bea' | 'ben', userId: string, tables: Tbl[], aRows: Map<string, { keys: string[]; json: unknown }>) {
  const leaks: string[] = []
  const notes: string[] = []   // RLS 보다 트리거가 먼저 거부한 insert — 보고서용(단언 아님)
  await asUser(pool, userId, async (c) => {
    for (const t of tables) {
      const a = aRows.get(t.name)!
      const seen = await readKeys(c, t)
      if (seen && !OPEN_BY_DESIGN.has(t.name) && a.keys.some((k) => seen.includes(k))) leaks.push(`${t.name}:read`)
      if (a.keys.length === 0) continue
      const cols = t.cols.map(q).join(', ')
      const ins = await probe(c,
        `insert into public.${q(t.name)} (${cols}) select ${cols} from json_populate_record(null::public.${q(t.name)}, $1::json)`, [a.json])
      if (!ins.err || passedRls(ins.err)) leaks.push(`${t.name}:insert`)
      else if (ins.err.code !== '42501') notes.push(`${t.name}: ${ins.err.code} ${ins.err.message}`)
      const upd = await probe(c, `update public.${q(t.name)} t set ${q(t.pk[0])} = t.${q(t.pk[0])} where ${keyOf(t)} = $1`, [a.keys[0]])
      if (!upd.err && upd.rowCount > 0) leaks.push(`${t.name}:update`)
      const del = await probe(c, `delete from public.${q(t.name)} t where ${keyOf(t)} = $1`, [a.keys[0]])
      if (!del.err && del.rowCount > 0) leaks.push(`${t.name}:delete`)
    }
    for (const p of OWN_INSERT_PROBES) {
      const r = await probe(c, p.sql, [userId])
      if (!r.err || passedRls(r.err)) leaks.push(`${p.table}:insert-own`)
    }
  })
  if (notes.length) console.info(`[${label}] 트리거가 먼저 거부한 insert:\n  ${notes.join('\n  ')}`)
  return { label, leaks: leaks.sort() }
}

describe('워크스페이스 전수 교차(SP2 §5.1)', () => {
  it('카탈로그의 RLS 표 = 판별 맵의 표(새 표는 스코프를 정해야 한다)', async () => {
    const names = await asService(pool, async (c) => (await c.query<Tbl>(RLS_TABLES_SQL)).rows.map((t) => t.name))
    expect(names.filter((n) => !(n in A_ROW_FILTER)), '판별식 없는 새 RLS 표').toEqual([])
    expect(Object.keys(A_ROW_FILTER).filter((n) => !names.includes(n)), '사라진 표(맵에서 뺀다)').toEqual([])
  })

  it('B 계정(bea·ben)이 A 의 행을 읽거나 쓰는 경로 = KNOWN_LEAKS(0006 뒤에는 없음)', async () => {
    const tables = await asService(pool, async (c) => (await c.query<Tbl>(RLS_TABLES_SQL)).rows)
    const aRows = new Map<string, { keys: string[]; json: unknown }>()
    await asService(pool, async (c) => {
      for (const t of tables) {
        const { rows } = await c.query<{ k: string; j: unknown }>(
          `select ${keyOf(t)} as k, row_to_json(t) as j from public.${q(t.name)} t where ${A_ROW_FILTER[t.name]} order by 1`)
        aRows.set(t.name, { keys: rows.map((r) => r.k), json: rows[0]?.j ?? null })
      }
    })
    // 비어 있는 표는 UNFILLED 에 사유가 있어야 하고, UNFILLED 는 실제로 비어 있어야 한다(죽은 예외 금지)
    const empty = tables.filter((t) => aRows.get(t.name)!.keys.length === 0).map((t) => t.name)
    expect(empty.filter((n) => !(n in UNFILLED)), '픽스처가 A 행을 못 넣은 표').toEqual([])
    expect(Object.keys(UNFILLED).filter((n) => !empty.includes(n)), 'UNFILLED 인데 행이 있다').toEqual([])

    const results = [
      await scanUser('bea', F.users.bAdmin, tables, aRows),
      await scanUser('ben', F.users.bMember, tables, aRows),
    ]
    for (const r of results) expect(r.leaks, `${r.label} 의 누설`).toEqual([...KNOWN_LEAKS[r.label]].sort())
  })

  it('대조: B 계정은 자기 워크스페이스 프로젝트를 본다 — 위 0행이 세션 흉내 실패가 아니다', async () => {
    for (const uid of [F.users.bAdmin, F.users.bMember]) {
      await asUser(pool, uid, async (c) => {
        const { rows } = await c.query('select id from public.projects where id = $1', [F.projects.bWs])
        expect(rows).toHaveLength(1)
      })
    }
  })
})
```

- [ ] **Step 5: 실행해 현재 DB 의 실측 누설을 기록**

Run: `npm run db:reset 2>&1 | tail -2 && npm run test:rls -- tests/rls/workspace-isolation.test.ts 2>&1 | tail -40`
Expected: 첫 실행에서 테스트 2 는 `KNOWN_LEAKS` 가 예측값이라 **실측과 다르면 FAIL** 하고 diff 를 보여 준다. 실측 목록으로 `KNOWN_LEAKS` 를 고쳐 다시 돌려 PASS 3 을 만든다. 예측과 달랐던 항목(더 많거나 적은 누설)은 보고서에 표로 적는다 — 예측보다 **적은** 항목은 원인을 한 줄씩(예: 트리거가 먼저 거부). `UNFILLED` 가 비어 있지 않으면 표·사유를, `console.info` 의 "트리거가 먼저 거부한 insert" 목록도 보고서에(그 표들은 복사 insert 로 RLS 까지 닿지 않는다 — 리뷰어가 insert 정책 유무를 따로 본다).
그리고 SP1 케이스가 픽스처 확장에 흔들리지 않았는지: `npm run test:rls 2>&1 | tail -4` → org-core·schema-invariants 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add tests/rls/fixture-ws.sql tests/rls/harness.ts tests/rls/isolation-map.ts tests/rls/workspace-isolation.test.ts
git commit -m "test(rls): 2-워크스페이스 픽스처와 전수 교차 테스트 — 0005 의 실측 누설 목록을 먼저 고정한다

72 RLS 표 전부를 카탈로그에서 읽어 B 계정의 읽기·복사 insert·update·delete·자기 이름 insert 를 시험한다.
KNOWN_LEAKS 는 지금 DB 의 실측이다 — 0006 이 이것을 비우는지가 곧 SP2 Phase A 의 판정이다."
```

### Task 2: 마이그레이션 `0006_workspace_isolation.sql` + 롤백 + 리허설 + 핀 케이스

**Files:**
- Create: `supabase/migrations/0006_workspace_isolation.sql`, `supabase/rollbacks/0006_workspace_isolation_rollback.sql`, `supabase/rehearsal/0006_smoke.sql`, `supabase/rehearsal/0006_backfill_ok.sql`, `supabase/rehearsal/0006_backfill_ambiguous.sql`
- Create: `tests/rls/workspace-isolation-cases.test.ts`
- Modify: `tests/rls/isolation-map.ts`(`KNOWN_LEAKS` 비움), `tests/rls/fixture-ws.sql`(`user_preferences.workspace_id`, 프로젝트 없는 회의록·폴더)

**Interfaces:**
- Produces(DB): 컬럼 `minutes.workspace_id`·`minute_folders.workspace_id`·`notification_events.workspace_id`·`user_preferences.workspace_id`·`agent_watchers.workspace_id`(전부 `uuid not null references public.workspaces(id) on delete cascade` + 인덱스), `user_preferences` PK `(user_id, workspace_id)`; 트리거 함수 `workspace_scope_from_project()`·`minute_folders_workspace_scope()`(불일치 23514 `WORKSPACE_SCOPE_MISMATCH`); 읽기 정책 `<표>_ws_read` 39개; `app_role()` 없음; RPC `create_minute_with_version(…, p_workspace_id uuid default null)`(18인자, `service_role` 전용; 새 오류 `MINUTE_WORKSPACE_REQUIRED` 22023·`MINUTE_WORKSPACE_MISMATCH` 23514·`MINUTE_FOLDER_WORKSPACE_MISMATCH` 23514·`MINUTE_PROJECT_NOT_FOUND` 23503).
- Consumes: Task 1 의 픽스처·맵.

- [ ] **Step 1: 롤백 작성용 원본 캡처(리포 밖)**

```bash
D=$(mktemp -d)
docker exec supabase_db_d-flow psql -U postgres -d postgres -Atc "select string_agg(pg_get_functiondef(p.oid), E';\n\n') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_minute_with_version','curate_wiki_item','my_member_id','my_team_ids','is_project_admin_anywhere_in_ws','app_role')" > "$D/functions-0005.sql"
docker exec supabase_db_d-flow psql -U postgres -d postgres -Atc "select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') and exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) order by 1" > "$D/anon-write-tables.txt"
wc -l "$D/anon-write-tables.txt"     # 실측 41
docker exec supabase_db_d-flow psql -U postgres -d postgres -AF $'\t' -tc "select schemaname, tablename, policyname, permissive, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, '') from pg_policies where schemaname in ('public','storage','realtime') order by 1, 2, 3" > "$D/policies-0005.tsv"
docker exec supabase_db_d-flow psql -U postgres -d postgres -AF $'\t' -tc "select p.oid::regprocedure, coalesce(array_to_string(p.proacl, ' '), '') from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1" > "$D/function-acl-0005.tsv"
echo "$D"                             # 보고서에 경로를 적는다
```
이 네 파일이 롤백의 원문이다(롤백은 카탈로그 비교에서 0 mismatch 여야 하므로 함수 본문·정책 본문·ACL 을 글자 그대로 되돌린다).

- [ ] **Step 2: 마이그레이션 작성**

`supabase/migrations/0006_workspace_isolation.sql`:
```sql
-- 0006_workspace_isolation — SP2 Phase A. 정본: docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md §2.
-- 순서: ⓪ 사전검증 ① workspace_id 컬럼·백필·not null·FK·인덱스·트리거 ② 헬퍼 보완(M3) ③ 개방 읽기 39 교체 + 좁히기
--       ④ app_role 정책 9 → 명시 헬퍼, curate_wiki_item 주석, app_role drop ⑤ 명단 보호(M1·M2) ⑥ 회의록 생성 RPC
--       ⑦ 실행·쓰기 권한 회수 ⑧ 사후검증. 정책이 새 컬럼을 읽으므로 ① 이 ③④ 보다 먼저다.

-- ⓪ 사전검증 — 교체할 옛 개방 읽기 정책 40개(D2 예외 issue_mega_areas 포함)가 전부 그 이름·그 본문으로 있어야 한다 ----
do $$
declare v_missing text;
begin
  select string_agg(e.t || '.' || e.p, ', ' order by e.t) into v_missing
    from (values
      ('ai_documents','ai_documents_read'), ('announcements','read_all_announcements'),
      ('attendance_records','read_all_attendance'), ('change_logs','read_all_logs'),
      ('deliverable_attachments','read_all_attachments'), ('holidays','read_all_holidays'),
      ('issue_assignees','read_all_issue_assignees'), ('issue_attachments','read_issue_attachments'),
      ('issue_links','read_all_issue_links'), ('issue_major_processes','read_all_issue_major_processes'),
      ('issue_mega_areas','read_all_issue_mega_areas'), ('issue_updates','read_issue_updates'),
      ('issues','read_all_issues'), ('item_owners','read_all_owners'),
      ('meeting_attendees','read_all_meeting_attendees'), ('meeting_exceptions','read_all_meeting_exceptions'),
      ('meetings','read_all_meetings'), ('minute_embeddings','minute_embeddings_read'),
      ('minute_files','read_all_minute_files'), ('minute_folders','read_all_minute_folders'),
      ('minute_highlights','read_all_minute_highlights'), ('minute_insights','minute_insights_read'),
      ('minute_versions','minute_versions_read'), ('minutes','read_all_minutes'),
      ('project_ai_briefs','project_ai_briefs_read'), ('project_members','read_all_members'),
      ('project_settings','read_project_settings'), ('projects','read_all_projects'),
      ('task_dependencies','task_dependencies_select'), ('teams','read_all_teams'),
      ('wbs_embeddings','wbs_embeddings_read'), ('wbs_items','read_all_items'),
      ('wbs_progress_snapshots','read_all_progress_snapshots'), ('weekly_report_rows','weekly_report_rows_select'),
      ('weekly_reports','weekly_reports_select'), ('wiki_change_events','wiki_change_events_read'),
      ('wiki_item_relations','wiki_item_relations_read'), ('wiki_item_sources','wiki_item_sources_read'),
      ('wiki_items','wiki_items_read'), ('wiki_topics','wiki_topics_read')
    ) as e(t, p)
   where not exists (select 1 from pg_policies pp
                      where pp.schemaname = 'public' and pp.tablename = e.t and pp.policyname = e.p
                        and pp.cmd = 'SELECT' and pp.qual = 'true');
  if v_missing is not null then
    raise exception 'SP2_0006_PRECHECK: 교체할 개방 읽기 정책이 없거나 달라졌다: %', v_missing;
  end if;
end $$;

-- ① workspace_id 다섯 컬럼(D3·D4) ----------------------------------------------------------------------------
alter table public.minutes             add column workspace_id uuid;
alter table public.minute_folders      add column workspace_id uuid;
alter table public.notification_events add column workspace_id uuid;
alter table public.user_preferences    add column workspace_id uuid;
alter table public.agent_watchers      add column workspace_id uuid;

update public.minutes m             set workspace_id = p.workspace_id from public.projects p where p.id = m.project_id;
update public.minute_folders f      set workspace_id = p.workspace_id from public.projects p where p.id = f.project_id;
update public.notification_events e set workspace_id = p.workspace_id from public.projects p where p.id = e.project_id;
update public.agent_watchers w      set workspace_id = p.workspace_id from public.projects p where p.id = w.project_id;

-- 프로젝트 없는 행(D3): 작성자가 속한 유일한 워크스페이스. 0개·2개 이상이면 전체 워크스페이스가 정확히 1개일 때 그것,
-- 아니면 멈춘다 — 추정으로 잘못 배정하느니 실패한다(에러 3원칙). 폴더 자식은 부모를 따른다(트리 불변식).
-- user_preferences 는 보안 경계가 아니므로 여러 소속이면 가장 먼저 가입한 것.
do $$
declare
  v_total int := (select count(*) from public.workspaces);
  v_only  uuid := (select w.id from public.workspaces w order by w.id limit 1);
  r record; v_ws uuid; v_n int;
begin
  for r in
    select 'minutes'::text as tbl, m.id, m.created_by as owner from public.minutes m where m.workspace_id is null
    union all
    select 'minute_folders', f.id, f.created_by from public.minute_folders f where f.workspace_id is null and f.parent_id is null
    union all
    select 'notification_events', e.id, e.actor_user_id from public.notification_events e where e.workspace_id is null
    union all
    select 'agent_watchers', w.id, w.user_id from public.agent_watchers w where w.workspace_id is null
  loop
    select count(*), min(wm.workspace_id::text)::uuid into v_n, v_ws from public.workspace_members wm where wm.user_id = r.owner;
    if v_n <> 1 then
      if v_total = 1 then v_ws := v_only;
      else
        raise exception 'SP2_0006_BACKFILL_AMBIGUOUS: %.% (작성자 %, 소속 %개, 전체 워크스페이스 %개)', r.tbl, r.id, r.owner, v_n, v_total;
      end if;
    end if;
    execute format('update public.%I set workspace_id = $1 where id = $2', r.tbl) using v_ws, r.id;
  end loop;

  loop
    update public.minute_folders c set workspace_id = p.workspace_id
      from public.minute_folders p
     where c.parent_id = p.id and c.workspace_id is null and p.workspace_id is not null;
    exit when not found;
  end loop;

  update public.user_preferences up set workspace_id = (
    select wm.workspace_id from public.workspace_members wm where wm.user_id = up.user_id
     order by wm.created_at, wm.workspace_id limit 1);
  if exists (select 1 from public.user_preferences where workspace_id is null) then
    if v_total = 1 then update public.user_preferences set workspace_id = v_only where workspace_id is null;
    else raise exception 'SP2_0006_BACKFILL_AMBIGUOUS: user_preferences — 소속 없는 사용자의 선호값(전체 워크스페이스 %개)', v_total;
    end if;
  end if;
end $$;

alter table public.minutes             alter column workspace_id set not null,
  add constraint minutes_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.minute_folders      alter column workspace_id set not null,
  add constraint minute_folders_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.notification_events alter column workspace_id set not null,
  add constraint notification_events_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.user_preferences    alter column workspace_id set not null,
  add constraint user_preferences_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.agent_watchers      alter column workspace_id set not null,
  add constraint agent_watchers_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
create index minutes_workspace_idx             on public.minutes (workspace_id);
create index minute_folders_workspace_idx      on public.minute_folders (workspace_id);
create index notification_events_workspace_idx on public.notification_events (workspace_id);
create index agent_watchers_workspace_idx      on public.agent_watchers (workspace_id);
alter table public.user_preferences drop constraint user_preferences_pkey,
  add constraint user_preferences_pkey primary key (user_id, workspace_id);
-- 프로젝트 없는 루트 폴더 이름은 워크스페이스마다 유일(전역 유일이면 두 번째 워크스페이스가 같은 팀 루트를 못 만든다)
drop index public.minute_folders_root_name_null_proj_uniq;
create unique index minute_folders_root_name_null_proj_uniq on public.minute_folders (workspace_id, name)
  where parent_id is null and project_id is null;

-- project_id 가 있는 행은 workspace_id = 그 프로젝트의 워크스페이스. 비어 있으면 채우고, 다르면 거부한다(SP1 projects_guard 결).
create function public.workspace_scope_from_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if new.project_id is null then return new; end if;
  select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  if not found then return new; end if;   -- 없는 프로젝트는 FK 가 23503 으로 거부한다
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;
create function public.minute_folders_workspace_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  elsif new.parent_id is not null then
    select f.workspace_id into v_ws from public.minute_folders f where f.id = new.parent_id;
  end if;
  if v_ws is null then return new; end if;
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;
revoke all on function public.workspace_scope_from_project() from public, anon, authenticated;
revoke all on function public.minute_folders_workspace_scope() from public, anon, authenticated;
create trigger minutes_workspace_scope before insert or update of project_id, workspace_id on public.minutes
  for each row execute function public.workspace_scope_from_project();
create trigger notification_events_workspace_scope before insert or update of project_id, workspace_id on public.notification_events
  for each row execute function public.workspace_scope_from_project();
create trigger agent_watchers_workspace_scope before insert or update of project_id, workspace_id on public.agent_watchers
  for each row execute function public.workspace_scope_from_project();
create trigger minute_folders_workspace_scope before insert or update of project_id, parent_id, workspace_id on public.minute_folders
  for each row execute function public.minute_folders_workspace_scope();

-- ② 헬퍼 보완(M3) — 비활성 인물(pe.active=false)의 명단 행이 권한·팀으로 새지 않게 ---------------------------
create or replace function public.my_member_id(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active and pe.active
   limit 1
$$;
create or replace function public.my_team_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.active and pe.user_id = auth.uid()
$$;
create or replace function public.is_project_admin_anywhere_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or exists (select 1 from public.project_members pm
                   join public.people pe on pe.id = pm.person_id
                   join public.projects p on p.id = pm.project_id
                  where p.workspace_id = wid and pe.user_id = auth.uid()
                    and pm.active and pe.active and pm.access_role = 'admin')
$$;

-- ③ 개방 읽기 39 교체(§2.1) — 표 주도. (select …) 로 감싸 initplan 1회 평가(R1). 부모 조인은 부모의 스코프 컬럼만 본다(R2).
do $$
declare r record;
begin
  for r in select * from (values
    ('announcements','read_all_announcements',                'project_id in (select public.accessible_project_ids())'),
    ('attendance_records','read_all_attendance',              'project_id in (select public.accessible_project_ids())'),
    ('holidays','read_all_holidays',                          'project_id in (select public.accessible_project_ids())'),
    ('issue_assignees','read_all_issue_assignees',            'project_id in (select public.accessible_project_ids())'),
    ('issue_attachments','read_issue_attachments',            'project_id in (select public.accessible_project_ids())'),
    ('issue_links','read_all_issue_links',                    'project_id in (select public.accessible_project_ids())'),
    ('issue_major_processes','read_all_issue_major_processes','project_id in (select public.accessible_project_ids())'),
    ('issue_updates','read_issue_updates',                    'project_id in (select public.accessible_project_ids())'),
    ('issues','read_all_issues',                              'project_id in (select public.accessible_project_ids())'),
    ('meeting_attendees','read_all_meeting_attendees',        'project_id in (select public.accessible_project_ids())'),
    ('meetings','read_all_meetings',                          'project_id in (select public.accessible_project_ids())'),
    ('project_ai_briefs','project_ai_briefs_read',            'project_id in (select public.accessible_project_ids())'),
    ('project_members','read_all_members',                    'project_id in (select public.accessible_project_ids())'),
    ('project_settings','read_project_settings',              'project_id in (select public.accessible_project_ids())'),
    ('task_dependencies','task_dependencies_select',          'project_id in (select public.accessible_project_ids())'),
    ('wbs_embeddings','wbs_embeddings_read',                  'project_id in (select public.accessible_project_ids())'),
    ('wbs_items','read_all_items',                            'project_id in (select public.accessible_project_ids())'),
    ('wbs_progress_snapshots','read_all_progress_snapshots',  'project_id in (select public.accessible_project_ids())'),
    ('weekly_reports','weekly_reports_select',                'project_id in (select public.accessible_project_ids())'),
    ('wiki_change_events','wiki_change_events_read',          'project_id in (select public.accessible_project_ids())'),
    ('wiki_items','wiki_items_read',                          'project_id in (select public.accessible_project_ids())'),
    ('wiki_topics','wiki_topics_read',                        'project_id in (select public.accessible_project_ids())'),
    ('ai_documents','ai_documents_read',                      'project_id in (select public.accessible_project_ids())'),
    ('projects','read_all_projects',                          'workspace_id in (select public.my_workspace_ids())'),
    ('teams','read_all_teams',                                'workspace_id in (select public.my_workspace_ids())'),
    ('minutes','read_all_minutes',                            'workspace_id in (select public.my_workspace_ids())'),
    ('minute_folders','read_all_minute_folders',              'workspace_id in (select public.my_workspace_ids())'),
    ('minute_versions','minute_versions_read',
      'exists (select 1 from public.minutes m where m.id = minute_versions.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_embeddings','minute_embeddings_read',
      'exists (select 1 from public.minutes m where m.id = minute_embeddings.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_files','read_all_minute_files',
      'exists (select 1 from public.minutes m where m.id = minute_files.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_highlights','read_all_minute_highlights',
      'exists (select 1 from public.minutes m where m.id = minute_highlights.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_insights','minute_insights_read',
      'exists (select 1 from public.minutes m where m.id = minute_insights.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('change_logs','read_all_logs',
      'exists (select 1 from public.wbs_items w where w.id = change_logs.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('deliverable_attachments','read_all_attachments',
      'exists (select 1 from public.wbs_items w where w.id = deliverable_attachments.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('item_owners','read_all_owners',
      'exists (select 1 from public.wbs_items w where w.id = item_owners.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('meeting_exceptions','read_all_meeting_exceptions',
      'exists (select 1 from public.meetings m where m.id = meeting_exceptions.meeting_id and m.project_id in (select public.accessible_project_ids()))'),
    ('weekly_report_rows','weekly_report_rows_select',
      'exists (select 1 from public.weekly_reports r where r.id = weekly_report_rows.report_id and r.project_id in (select public.accessible_project_ids()))'),
    ('wiki_item_relations','wiki_item_relations_read',
      'exists (select 1 from public.wiki_items i where i.id = wiki_item_relations.from_item_id and i.project_id in (select public.accessible_project_ids()))'),
    ('wiki_item_sources','wiki_item_sources_read',
      'exists (select 1 from public.wiki_items i where i.id = wiki_item_sources.wiki_item_id and i.project_id in (select public.accessible_project_ids()))')
  ) as v(tbl, old_pol, pred)
  loop
    execute format('drop policy %I on public.%I', r.old_pol, r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', r.tbl || '_ws_read', r.tbl, r.pred);
  end loop;
end $$;

-- true 는 아니지만 좁혀지지 않은 것(§2.1 하단 + 자기 이름 쓰기)
drop policy read_notification_events on public.notification_events;
create policy read_notification_events on public.notification_events for select to authenticated using (
  workspace_id in (select public.my_workspace_ids())
  and (exists (select 1 from public.notification_recipients r where r.event_id = notification_events.id and r.user_id = auth.uid())
       or (audience = 'project' and public.is_project_member(project_id))));
drop policy own_minute_favorites on public.minute_favorites;
create policy own_minute_favorites on public.minute_favorites for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.minutes m where m.id = minute_favorites.minute_id
                                            and m.workspace_id in (select public.my_workspace_ids())))
  with check (user_id = auth.uid() and exists (select 1 from public.minutes m where m.id = minute_favorites.minute_id
                                                 and m.workspace_id in (select public.my_workspace_ids())));
drop policy insert_own_log on public.change_logs;
create policy insert_own_log on public.change_logs for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.wbs_items w where w.id = change_logs.wbs_item_id
                                                 and public.can_read_project(w.project_id)));
drop policy own_seen_announcements on public.announcement_seen;
create policy own_seen_announcements on public.announcement_seen for all to authenticated
  using (user_id = auth.uid() and project_id in (select public.accessible_project_ids()))
  with check (user_id = auth.uid() and project_id in (select public.accessible_project_ids()));
drop policy own_user_wbs_state on public.user_wbs_state;
create policy own_user_wbs_state on public.user_wbs_state for all to authenticated
  using (user_id = auth.uid() and project_id in (select public.accessible_project_ids()))
  with check (user_id = auth.uid() and project_id in (select public.accessible_project_ids()));
drop policy own_user_preferences on public.user_preferences;
create policy own_user_preferences on public.user_preferences for all to authenticated
  using (user_id = auth.uid() and public.is_ws_member(workspace_id))
  with check (user_id = auth.uid() and public.is_ws_member(workspace_id));

-- ④ app_role() 폐기(§2.2) --------------------------------------------------------------------------------------
-- minute_files 3 — 작성자 ∨ 그 워크스페이스 관리자 ∨ 그 프로젝트 관리자. minutes 조회는 minutes RLS(워크스페이스)를 탄다.
drop policy attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files for insert to authenticated
  with check (role = 'attachment' and uploaded_by = auth.uid() and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files for update to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))))
  with check (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files for delete to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
-- minute_folders 3 — 옛 'app_role() is not null'(어느 프로젝트든 역할) → 그 워크스페이스에 역할(명단 권한 또는 워크스페이스 관리자)
drop policy insert_own_minute_folders on public.minute_folders;
create policy insert_own_minute_folders on public.minute_folders for insert to authenticated
  with check (created_by = auth.uid() and (public.is_ws_admin(workspace_id)
    or exists (select 1 from public.projects p where p.workspace_id = minute_folders.workspace_id and public.is_project_member(p.id))));
drop policy update_own_minute_folders on public.minute_folders;
create policy update_own_minute_folders on public.minute_folders for update to authenticated
  using (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)))
  with check (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)));
drop policy delete_own_minute_folders on public.minute_folders;
create policy delete_own_minute_folders on public.minute_folders for delete to authenticated
  using (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)));
-- minute_highlights 2
drop policy insert_own_minute_highlights on public.minute_highlights;
create policy insert_own_minute_highlights on public.minute_highlights for insert to authenticated
  with check (created_by = auth.uid() and exists (
    select 1 from public.minutes mi where mi.id = minute_highlights.minute_id
       and (public.is_ws_admin(mi.workspace_id)
            or exists (select 1 from public.projects p where p.workspace_id = mi.workspace_id and public.is_project_member(p.id)))));
drop policy delete_own_minute_highlights on public.minute_highlights;
create policy delete_own_minute_highlights on public.minute_highlights for delete to authenticated
  using (exists (select 1 from public.minutes mi where mi.id = minute_highlights.minute_id
                   and (minute_highlights.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id))));
-- storage minutes delete 1 — 경로 규약은 B1(0007)에서 바뀐다. 여기서는 app_role() 만 동형 술어로(첫 세그먼트 = 회의록 id, 텍스트 비교라 22P02 없음)
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes'
    and (owner = auth.uid() or exists (select 1 from public.minutes mi
          where mi.id::text = split_part(objects.name, '/', 1) and public.is_ws_admin(mi.workspace_id)))
    and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));
```
이어서 `curate_wiki_item` — **판정은 이미 `is_project_admin(v_item.project_id)` 다**(실측). `app_role(` 은 주석 한 줄에만 있다. Step 1 의 `$D/functions-0005.sql` 에서 `curate_wiki_item` 정의를 그대로 복사해 `create or replace function …` 로 붙이고 그 한 줄만 바꾼다:
```
-  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(app_role() is not null)는
+  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(전역 역할 함수의 not null 판정)는
```
(나머지 본문·`SECURITY DEFINER`·`SET search_path TO 'public', 'pg_temp'` 는 한 글자도 바꾸지 않는다.) 그 뒤:
```sql
drop function public.app_role();   -- 남은 정책이 있으면 의존성 오류로 여기서 멈춘다

-- ⑤ 명단 보호(M1·M2) ---------------------------------------------------------------------------------------------
-- 앱 removeRosterMember 의 MEMBER_DEPENDANTS 6개와 같은 FK — CASCADE·SET NULL → NO ACTION(R4 분기 A).
alter table public.attendance_records drop constraint attendance_member_project_fk,
  add constraint attendance_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.issue_assignees drop constraint issue_assignees_member_project_fk,
  add constraint issue_assignees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.meeting_attendees drop constraint meeting_attendees_member_project_fk,
  add constraint meeting_attendees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.issues drop constraint issues_assignee_project_fk,
  add constraint issues_assignee_project_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id);
alter table public.wbs_items drop constraint wbs_items_assignee_member_fk,
  add constraint wbs_items_assignee_member_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id);
alter table public.wiki_items drop constraint wiki_items_owner_project_fk,
  add constraint wiki_items_owner_project_fk foreign key (owner_member_id, project_id) references public.project_members(id, project_id);
-- project_member_teams(팀 소속)·notification_recipients(알림 수신)는 명단 행과 함께 사라지는 게 맞다 — CASCADE 유지.

-- 세션은 명단 행의 인물·프로젝트를 바꾸지 못한다(사람 바꿔치기·프로젝트 이동 차단)
revoke update on public.project_members from authenticated;
grant update (access_role, role_label, title, active, sort_order, access_granted_by, access_granted_at, updated_at)
  on public.project_members to authenticated;
-- R3 분기 A 의 전제: 정책이 project_ws() 를 직접 부르지 않게 한다(유일한 직접 호출 정책)
drop policy wsadmin_write_admin_rows on public.project_members;
create policy wsadmin_write_admin_rows on public.project_members to authenticated
  using (exists (select 1 from public.projects p where p.id = project_members.project_id and public.is_ws_admin(p.workspace_id)))
  with check (exists (select 1 from public.projects p where p.id = project_members.project_id and public.is_ws_admin(p.workspace_id)));
-- M2: 관리자 명단 행의 팀 편집은 워크스페이스 관리자만(RPC 의 ADMIN_SLOT 과 동형)
drop policy project_member_teams_write on public.project_member_teams;
create policy project_member_teams_write on public.project_member_teams to authenticated
  using (exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
                  where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)
                    and (pm.access_role is distinct from 'admin' or public.is_ws_admin(p.workspace_id))))
  with check (exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
                       where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)
                         and (pm.access_role is distinct from 'admin' or public.is_ws_admin(p.workspace_id))));
```
⑥ `create_minute_with_version` — Step 1 의 원본을 기준으로:
```sql
drop function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text);
create function public.create_minute_with_version(
  p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text,
  p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text,
  p_actor_id uuid, p_actor_name text, p_file_name text default null, p_file_path text default null,
  p_file_size bigint default null, p_file_mime text default null, p_workspace_id uuid default null)
returns table(minute_id uuid, version_id uuid, version_no integer, body_hash text, created_at timestamptz, updated_at timestamptz, wiki_rebuild_required boolean)
language plpgsql set search_path to 'public', 'extensions' as $function$
-- (원본 본문을 그대로 두고 아래 네 곳만 바꾼다)
$function$;
revoke all on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid) to service_role;
```
본문 변경 네 곳:
1. `declare` 에 `v_workspace_id uuid;`.
2. 팀 검사 블록(`if not exists (select 1 from public.teams t where t.code = p_team_code and t.active) then … MINUTE_TEAM_INVALID`)을 **회의 블록(`if p_meeting_id is not null then … end if;`) 뒤로** 옮기고, 그 앞에 워크스페이스 확정을 넣는다:
```sql
  if v_project_id is not null then
    select p.workspace_id into v_workspace_id from public.projects p where p.id = v_project_id;
    if not found then
      raise exception 'MINUTE_PROJECT_NOT_FOUND' using errcode = '23503';
    end if;
    if p_workspace_id is not null and p_workspace_id <> v_workspace_id then
      raise exception 'MINUTE_WORKSPACE_MISMATCH' using errcode = '23514';
    end if;
  else
    v_workspace_id := p_workspace_id;
    if v_workspace_id is null then
      raise exception 'MINUTE_WORKSPACE_REQUIRED' using errcode = '22023';
    end if;
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.minute_folders f where f.id = p_folder_id and f.workspace_id = v_workspace_id) then
    raise exception 'MINUTE_FOLDER_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active and t.workspace_id = v_workspace_id
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;
```
3. `insert into public.minutes as new_minute (` 열 목록 끝에 `, workspace_id`, `values (` 끝에 `, v_workspace_id`.
4. 그 외 본문(파일 검사·advisory lock·위키 재구성 요청)은 그대로.
```sql
-- ⑦ 실행·쓰기 권한 회수(security-5) -------------------------------------------------------------------------------
revoke execute on function public.is_superuser(), public.my_workspace_ids(), public.is_ws_member(uuid), public.is_ws_admin(uuid),
  public.project_ws(uuid), public.accessible_project_ids(), public.can_read_project(uuid), public.is_project_admin(uuid),
  public.is_project_member(uuid), public.is_project_admin_anywhere_in_ws(uuid), public.my_member_id(uuid),
  public.my_team_ids(uuid), public.can_attach(uuid), public.can_edit_issue(uuid), public.wbs_is_leaf(uuid) from public, anon;
-- R3 분기 A: project_ws 는 정책·SECURITY DEFINER 헬퍼 안에서만 쓴다(PostgREST rpc/project_ws 오라클 제거)
revoke execute on function public.project_ws(uuid) from authenticated;
revoke execute on function public.import_wbs(uuid, jsonb, jsonb), public.import_wbs_upsert(uuid, jsonb, uuid),
  public.replace_wbs(uuid, jsonb, jsonb),
  public.match_minute_documents(vector, integer, text, date, date, uuid[]), public.match_wbs_documents(vector, integer, uuid, text[]),
  public.usage_daily_actives(date, date), public.usage_menu_ranking(date, date), public.usage_sessions(date, date, integer),
  public.usage_summary(date, date, date), public.usage_user_rollup(date, date), public.lead_lease_ttl() from public, anon;
revoke insert, update, delete, truncate on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ⑧ 사후검증 ------------------------------------------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(p.proname, ', ') into v from pg_proc p where p.prosrc ilike '%app_role(%';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 함수 본문에 app_role( 가 남았다: %', v; end if;
  select string_agg(pp.schemaname || '.' || pp.tablename || '.' || pp.policyname, ', ') into v
    from pg_policies pp where coalesce(pp.qual, '') || coalesce(pp.with_check, '') ilike '%app_role%';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 정책에 app_role 이 남았다: %', v; end if;
  select string_agg(pp.tablename || '.' || pp.policyname, ', ') into v
    from pg_policies pp where pp.schemaname = 'public' and pp.cmd in ('SELECT', 'ALL') and pp.qual = 'true'
     and pp.tablename <> 'issue_mega_areas';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 개방 읽기 정책이 남았다: %', v; end if;
  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     and exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole
                  and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'));
  if v is not null then raise exception 'SP2_0006_POSTCHECK: anon 쓰기 권한이 남았다: %', v; end if;
end $$;
```

- [ ] **Step 3: 롤백 작성**

`supabase/rollbacks/0006_workspace_isolation_rollback.sql` — 머리 주석: "0005 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch). 새 컬럼의 값은 버린다(데이터 보존 절차 없음 — 원격이 생기기 전)". 역순:
1. ⑦ 복원: `grant insert, update, delete, truncate on public.<표> to anon;` 를 `$D/anon-write-tables.txt` 의 41표 각각에 한 줄씩(목록을 파일에 그대로 적는다 — `all tables` 로 쓰면 0003 신설 표에 없던 권한이 생겨 mismatch). `alter default privileges for role postgres in schema public grant insert, update, delete, truncate on tables to anon;` `… grant execute on functions to anon;`. 함수 실행 권한은 `$D/function-acl-0005.tsv` 와 같아지게 — 실측으로는 헬퍼 15개 중 `can_edit_issue` 를 **뺀** 14개에 `grant execute … to anon`, RPC 11개(`import_wbs`·`import_wbs_upsert`·`replace_wbs`·`match_minute_documents`·`match_wbs_documents`·`usage_*` 5·`lead_lease_ttl`)에 `grant execute … to public, anon`, `grant execute on function public.project_ws(uuid) to authenticated`. 쓰기 전에 tsv 와 한 줄씩 대조한다.
2. ⑥ `drop function public.create_minute_with_version(<18인자>)` → `$D/functions-0005.sql` 의 원본 정의 + `revoke all … from public, anon, authenticated; grant execute … to service_role;`(원본 ACL: `postgres=X, service_role=X`).
3. ⑤ `project_member_teams_write`·`wsadmin_write_admin_rows` 를 `$D/policies-0005.tsv` 의 본문으로(실측: `wsadmin_write_admin_rows` using/with check `is_ws_admin(project_ws(project_id))`, `project_member_teams_write` using/with check `exists (select 1 from project_members pm where pm.id = project_member_teams.member_id and is_project_admin(pm.project_id))`); `revoke update (access_role, role_label, title, active, sort_order, access_granted_by, access_granted_at, updated_at) on public.project_members from authenticated; grant update on public.project_members to authenticated;`; FK 6개를 원래 동작으로 — `attendance_member_project_fk`·`issue_assignees_member_project_fk`·`meeting_attendees_member_project_fk` 는 `on delete cascade`, `issues_assignee_project_fk` 는 `on delete set null (assignee_member_id)`, `wbs_items_assignee_member_fk` 는 `on delete set null (assignee_member_id)`, `wiki_items_owner_project_fk` 는 `on delete set null (owner_member_id)`.
4. ④ `create function public.app_role()`(원본 본문 + ACL: `grant execute … to public, anon, authenticated, service_role` — 원본 ACL `=X/postgres anon=X authenticated=X service_role=X`), `curate_wiki_item` 원본 주석 복원(`create or replace`), 9정책을 `$D/policies-0005.tsv` 의 본문으로(`minute_files` 3·`minute_folders` 3·`minute_highlights` 2·`storage.objects` "minutes bucket delete").
5. ③ 좁힌 정책 6개(`read_notification_events`·`own_minute_favorites`·`insert_own_log`·`own_seen_announcements`·`own_user_wbs_state`·`own_user_preferences`)를 `$D/policies-0005.tsv` 의 본문으로; 39개 `<표>_ws_read` → 원래 이름 `for select to authenticated using (true)` — Step 2 의 VALUES 목록을 그대로 복사해 루프를 뒤집는다:
```sql
do $$
declare r record;
begin
  for r in select * from (values
    ('announcements','read_all_announcements'), ('attendance_records','read_all_attendance'),
    ('holidays','read_all_holidays'), ('issue_assignees','read_all_issue_assignees'),
    ('issue_attachments','read_issue_attachments'), ('issue_links','read_all_issue_links'),
    ('issue_major_processes','read_all_issue_major_processes'), ('issue_updates','read_issue_updates'),
    ('issues','read_all_issues'), ('meeting_attendees','read_all_meeting_attendees'),
    ('meetings','read_all_meetings'), ('project_ai_briefs','project_ai_briefs_read'),
    ('project_members','read_all_members'), ('project_settings','read_project_settings'),
    ('task_dependencies','task_dependencies_select'), ('wbs_embeddings','wbs_embeddings_read'),
    ('wbs_items','read_all_items'), ('wbs_progress_snapshots','read_all_progress_snapshots'),
    ('weekly_reports','weekly_reports_select'), ('wiki_change_events','wiki_change_events_read'),
    ('wiki_items','wiki_items_read'), ('wiki_topics','wiki_topics_read'),
    ('ai_documents','ai_documents_read'), ('projects','read_all_projects'),
    ('teams','read_all_teams'), ('minutes','read_all_minutes'),
    ('minute_folders','read_all_minute_folders'), ('minute_versions','minute_versions_read'),
    ('minute_embeddings','minute_embeddings_read'), ('minute_files','read_all_minute_files'),
    ('minute_highlights','read_all_minute_highlights'), ('minute_insights','minute_insights_read'),
    ('change_logs','read_all_logs'), ('deliverable_attachments','read_all_attachments'),
    ('item_owners','read_all_owners'), ('meeting_exceptions','read_all_meeting_exceptions'),
    ('weekly_report_rows','weekly_report_rows_select'), ('wiki_item_relations','wiki_item_relations_read'),
    ('wiki_item_sources','wiki_item_sources_read')
  ) as v(tbl, old_pol)
  loop
    execute format('drop policy %I on public.%I', r.tbl || '_ws_read', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (true)', r.old_pol, r.tbl);
  end loop;
end $$;
```
6. ② 헬퍼 3개 원본 본문으로.
7. ① 트리거 4개·함수 2개 drop, `minute_folders_root_name_null_proj_uniq` 를 `(name) where parent_id is null and project_id is null` 로 복원, `user_preferences` PK 를 `(user_id)` 로(같은 사용자에 워크스페이스별 행이 여럿이면 여기서 실패 — 머리 주석에 "롤백 전 `delete from user_preferences` 중복 정리 필요" 로 적는다), 인덱스 4개·FK 5개 drop, 컬럼 5개 drop.

- [ ] **Step 4: 리허설 SQL 세 개**

`supabase/rehearsal/0006_smoke.sql`(postgres 로, `begin … rollback`, 불리언 줄이 전부 `t`):
```sql
-- 0006_workspace_isolation 리허설 스모크. docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_smoke.sql
-- uuid 넷째 묶음 0006.
begin;
select to_regprocedure('public.app_role()') is null as app_role_dropped,
       not has_function_privilege('anon', 'public.can_read_project(uuid)', 'EXECUTE') as anon_no_helpers,
       not has_function_privilege('authenticated', 'public.project_ws(uuid)', 'EXECUTE') as project_ws_revoked,   -- R3 분기 B 면 이 줄을 has_… 로 바꾸고 주석
       not has_column_privilege('authenticated', 'public.project_members', 'person_id', 'UPDATE') as roster_person_locked,
       has_column_privilege('authenticated', 'public.project_members', 'access_role', 'UPDATE') as roster_role_open,
       not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
                    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) as anon_no_writes;

insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0006-00000000aa01', 'smoke6', 'Smoke 6');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0006-000000000a01', 'smoke6-alice@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name) values ('00000000-0000-0000-0006-000000000a01', 'smoke6-alice@example.com', 'alice');
insert into public.workspace_members (workspace_id, user_id, role) values ('00000000-0000-0000-0006-00000000aa01', '00000000-0000-0000-0006-000000000a01', 'admin');
insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-0006-000000000b01', '00000000-0000-0000-0006-00000000aa01', 'alice', 'smoke6-alice@example.com', '00000000-0000-0000-0006-000000000a01');
insert into public.projects (id, name, workspace_id) values ('00000000-0000-0000-0006-000000000c01', 'P6', '00000000-0000-0000-0006-00000000aa01');
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-0006-000000000d01', '00000000-0000-0000-0006-00000000aa01', null, 'SMK', 'SMK');
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-0006-000000000e01', '00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-000000000b01', 'admin');
insert into public.attendance_records (project_id, member_id, date, type) values
  ('00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-000000000e01', '2026-09-01', 'work');
insert into public.wbs_items (id, project_id, code, name, assignee_member_id) values
  ('00000000-0000-0000-0006-000000000f01', '00000000-0000-0000-0006-000000000c01', '1', 'L', '00000000-0000-0000-0006-000000000e01');
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-0006-000000001101', '00000000-0000-0000-0006-000000000c01', '2026-09-01', 'SMK', 'M', '#', '00000000-0000-0000-0006-000000000a01');
select workspace_id = '00000000-0000-0000-0006-00000000aa01' as minute_ws_filled_from_project
  from public.minutes where id = '00000000-0000-0000-0006-000000001101';

-- 기록 있는 명단 행 직접 삭제 → 23503(NO ACTION; 분기 B 면 set constraints all immediate 로 즉시 검사)
do $$ begin
  set constraints all immediate;
  delete from public.project_members where id = '00000000-0000-0000-0006-000000000e01';
  raise exception 'expected 23503';
exception when foreign_key_violation then null; end $$;
-- 프로젝트 없는 회의록은 workspace_id 없이 못 넣는다
do $$ begin
  insert into public.minutes (minute_date, team_code, title, body_md) values ('2026-09-01', 'SMK', 'X', '#');
  raise exception 'expected 23502';
exception when not_null_violation then null; end $$;
-- 프로젝트와 다른 워크스페이스 → 23514
do $$ begin
  insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0006-00000000aa02', 'smoke6b', 'Smoke 6b');
  insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md)
  values ('00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-00000000aa02', '2026-09-01', 'SMK', 'X', '#');
  raise exception 'expected WORKSPACE_SCOPE_MISMATCH';
exception when check_violation then null; end $$;
-- RPC: 프로젝트 없는 회의록은 p_workspace_id 필수
do $$ begin
  perform * from public.create_minute_with_version(null, '2026-09-01', 'SMK', 'T', '#', public.wiki_fnv1a64('#'),
    null, null, null, null, null, '00000000-0000-0000-0006-000000000a01', 'alice');
  raise exception 'expected MINUTE_WORKSPACE_REQUIRED';
exception when invalid_parameter_value then null; end $$;
select count(*) = 1 as rpc_null_project_ok from public.create_minute_with_version(null, '2026-09-01', 'SMK', 'T', '#', public.wiki_fnv1a64('#'),
    null, null, null, null, null, '00000000-0000-0000-0006-000000000a01', 'alice', null, null, null, null, '00000000-0000-0000-0006-00000000aa01');

-- R4: 프로젝트 삭제는 명단·근태·WBS 를 한 문장으로 지운다(NO ACTION 이 cascade 순서에 막히지 않는가).
-- 위 DO 블록의 immediate 를 풀고(분기 B 의 deferrable FK 가 커밋 시점 검사로 돌아가게) 삭제한 뒤, immediate 로 밀린 검사를 지금 돌린다.
set constraints all deferred;
delete from public.projects where id = '00000000-0000-0000-0006-000000000c01';
set constraints all immediate;
select not exists (select 1 from public.project_members where id = '00000000-0000-0000-0006-000000000e01') as project_delete_cascaded,
       (select project_id is null and workspace_id = '00000000-0000-0000-0006-00000000aa01' from public.minutes
         where id = '00000000-0000-0000-0006-000000001101') as minute_keeps_ws_after_project_delete;
rollback;
```
`supabase/rehearsal/0006_backfill_ok.sql` — 0005 스키마 위에 워크스페이스 2개(`smk-a`,`smk-b`), 소속 1개인 사용자 u1(smk-a), 그 사용자가 만든 **프로젝트 없는** 회의록·루트 폴더·그 폴더의 자식 폴더, `user_preferences(u1)` 를 **커밋**으로 넣는다(`begin; … commit;` — 뒤이은 `migration up` 이 이 행을 백필해야 하므로). uuid 넷째 묶음 `0b0f`.
`supabase/rehearsal/0006_backfill_ambiguous.sql` — 같은 구조에서 u1 을 두 워크스페이스 모두의 멤버로 넣는다.

- [ ] **Step 5: 리허설 실행 — R3·R4 분기 판정 포함**

```bash
D=$(mktemp -d)
supabase db reset --version 0005 2>&1 | tail -1
node supabase/rehearsal/compare-catalog.mjs capture "$D/ref0005"
# D3 — 정상 백필
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_backfill_ok.sql
supabase migration up --local 2>&1 | tail -2
docker exec supabase_db_d-flow psql -U postgres -d postgres -Atc "select (select count(*) from public.minutes where workspace_id is null) = 0 and (select count(*) from public.minute_folders f join public.workspaces w on w.id = f.workspace_id where w.slug = 'smk-a') = 2 and (select count(*) from public.user_preferences where workspace_id is not null) = 1"
# D3 — 모호하면 멈춘다
supabase db reset --version 0005 2>&1 | tail -1
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_backfill_ambiguous.sql
supabase migration up --local 2>&1 | grep -c SP2_0006_BACKFILL_AMBIGUOUS
# 정방향 + 스모크 + 롤백 대조
npm run db:reset 2>&1 | tail -2
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_smoke.sql
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0006_workspace_isolation_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/rolledback"
node supabase/rehearsal/compare-catalog.mjs diff "$D/ref0005" "$D/rolledback"
npm run db:reset 2>&1 | tail -2
npx vitest run tests/invariants/migration-files.test.ts
```
Expected: 정상 백필 `t`, 모호 grep `1` 이상, 스모크 불리언 전부 `t`, 롤백 무오류, diff "불일치 0", migration-files PASS.

**R4 분기**(스모크의 `project_delete_cascaded`): `delete from public.projects …` 가 23503 으로 실패하면(cascade 순서상 명단 행 삭제의 NO ACTION 검사가 근태 행 삭제보다 먼저 돈 경우) → 분기 B: ⑤ 의 FK 6개를 `… references public.project_members(id, project_id) deferrable initially deferred` 로 다시 쓴다(검사가 커밋 시점으로 밀려 모든 cascade 뒤에 돈다). 롤백의 FK 복원은 그대로(원본은 non-deferrable). 스모크를 다시 돌려 `project_delete_cascaded = t`, 직접 삭제 23503(스모크가 `set constraints all immediate` 로 강제)을 확인. 분기 B 도 실패하면 멈추고 오류 전문을 보고한다(프로젝트 삭제 경로 설계는 컨트롤러 판단).
**R3 분기**(`project_ws_revoked`): 다음 Step 의 `npm run test:rls` 에서 `permission denied for function project_ws`(42501)가 하나라도 나면 → 분기 B: `revoke execute on function public.project_ws(uuid) from authenticated;` 줄을 지우고, `project_ws` 본문을 오라클이 없게 바꾼다:
```sql
create or replace function public.project_ws(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  -- 호출자가 볼 수 없는 프로젝트의 워크스페이스는 알려 주지 않는다. auth.uid() 가 null 인 경로(service_role·트리거의 서비스 호출)는 그대로.
  select p.workspace_id from public.projects p
   where p.id = pid
     and (auth.uid() is null or public.is_superuser()
          or exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id and m.user_id = auth.uid()))
$$;
```
(`can_read_project` 를 부르면 `can_read_project → project_ws` 재귀가 되므로 직접 조건을 쓴다.) 롤백에 원본 `project_ws` 본문 복원을 추가. 스모크의 `project_ws_revoked` 줄은 `has_function_privilege(…) as project_ws_kept_with_guard` 로 바꾼다.
두 분기의 판정(A/B, 근거 오류 메시지)을 보고서 첫머리에 "R3: A|B — …", "R4: A|B — …" 로 적는다.

- [ ] **Step 6: 마이그레이션 커밋(G1 — 마이그레이션·롤백·리허설만)**

```bash
git add supabase/migrations/0006_workspace_isolation.sql supabase/rollbacks/0006_workspace_isolation_rollback.sql supabase/rehearsal/0006_smoke.sql supabase/rehearsal/0006_backfill_ok.sql supabase/rehearsal/0006_backfill_ambiguous.sql
git commit -m "db: 0006 워크스페이스 격리 — 개방 읽기 39 교체·app_role 폐기·workspace_id 다섯 컬럼·명단 보호

B 워크스페이스 계정이 A 의 행을 읽던 using(true) 39개를 accessible_project_ids()/my_workspace_ids() 로 닫고,
'아무 워크스페이스의 관리자' 였던 app_role() 을 쓰는 9정책을 명시 헬퍼로 옮긴 뒤 지운다. 프로젝트 없는 회의록·폴더는
workspace_id 로만 스코프되므로 백필이 모호하면 추정하지 않고 멈춘다(D3). R3·R4 판정은 커밋 본문 아래에.

R3: <A|B — 근거>
R4: <A|B — 근거>

Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')"
```

- [ ] **Step 7: 테스트 갱신 — 누설 목록 비우기 + 픽스처 + 핀 케이스**

`tests/rls/isolation-map.ts`: `KNOWN_LEAKS = { bea: [], ben: [] }` 로, `READ_LEAKS_0005`·`OWN_INSERT_LEAKS_0005` 상수는 지운다(주석에 "0005 실측은 커밋 <Task 1 sha> 참조").
`tests/rls/fixture-ws.sql`: `user_preferences` insert 를 `insert into public.user_preferences (user_id, workspace_id, prefs) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-00000000aa01', '{}') on conflict do nothing;` 로. 끝에 추가:
```sql
-- 프로젝트 없는 회의록·폴더(Review Focus 3) — workspace_id 로만 스코프된다
insert into public.minute_folders (id, project_id, workspace_id, name, created_by) values
  ('00000000-0000-0000-7e57-00000000112c', null, '00000000-0000-0000-7e57-00000000aa01', 'RLS 전역 폴더', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-7e57-00000000112b', null, '00000000-0000-0000-7e57-00000000aa01', '2026-09-02', 'ERP', 'RLS 전역 회의록', '# RLS', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
```
`harness.ts` 의 `F.rows` 에 `nullMinute: '00000000-0000-0000-7e57-00000000112b'`, `nullFolder: '00000000-0000-0000-7e57-00000000112c'`.

`tests/rls/workspace-isolation-cases.test.ts`(`beforeAll(loadFixture)`, `asUser`·`asService`·`pgError` 사용):
```ts
it('ⓐ 두 워크스페이스 사용자(dana)는 A·B 를 다 보고, A 에서 빠지면 A 만 사라진다(Review Focus 2)', async () => {
  await asUser(pool, F.users.dual, async (c) => {
    const count = async (sql: string, p: unknown[]) => Number((await c.query(sql, p)).rows[0].n)
    const projects = 'select count(*) as n from public.projects where id = any($1::uuid[])'
    const favs = 'select count(*) as n from public.minute_favorites where user_id = $1'
    expect(await count(projects, [[F.projects.a, F.projects.bWs]])).toBe(2)
    expect(await count(favs, [F.users.dual])).toBe(1)
    await c.query('reset role')   // postgres 로 잠시 돌아가 A 소속만 지운다(같은 트랜잭션, 끝에 rollback. JWT claims 는 그대로)
    await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
    await c.query('set local role authenticated')
    expect(await count(projects, [[F.projects.a]])).toBe(0)
    expect(await count(projects, [[F.projects.bWs]])).toBe(1)
    expect(await count(favs, [F.users.dual])).toBe(0)
    expect(await count('select count(*) as n from public.minutes where id = $1', [F.rows.minute])).toBe(0)
  })
})
it('ⓑ 프로젝트 없는 회의록은 A 멤버만 보고, 프로젝트가 지워진 회의록도 워크스페이스를 유지한다(Review Focus 3)', async () => {
  await asUser(pool, F.users.aLoose, async (c) =>
    expect((await c.query('select 1 from public.minutes where id = $1', [F.rows.nullMinute])).rowCount).toBe(1))
  await asUser(pool, F.users.bAdmin, async (c) =>
    expect((await c.query('select 1 from public.minutes where id = $1', [F.rows.nullMinute])).rowCount).toBe(0))
  await asService(pool, async (c) => {
    const P = '00000000-0000-0000-7e57-0000000011c0', M = '00000000-0000-0000-7e57-0000000011c1'
    await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 임시', F.ws])
    await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md) values ($1, $2, '2026-09-03', 'ERP', 'T', '#')`, [M, P])
    await c.query('delete from public.projects where id = $1', [P])
    const { rows } = await c.query('select project_id, workspace_id from public.minutes where id = $1', [M])
    expect(rows[0]).toEqual({ project_id: null, workspace_id: F.ws })
  })
})
it('ⓒ 기록 있는 명단 행은 직접 못 지우고(23503), 프로젝트 삭제는 그 행까지 지운다(Review Focus 4)', async () => {
  await asService(pool, async (c) => {
    await c.query('set constraints all immediate')   // R4 분기 B(deferrable)여도 직접 삭제는 이 문장에서 23503
    expect(await pgError(c, 'delete from public.project_members where id = $1', [F.members.aliceA]))
      .toMatchObject({ code: '23503' })
    await c.query('set constraints all deferred')
    await c.query('delete from public.projects where id = $1', [F.projects.a])
    await c.query('set constraints all immediate')   // 밀린 검사를 지금 돌린다 — 실패하면 여기서 throw
    expect((await c.query('select 1 from public.project_members where id = $1', [F.members.aliceA])).rowCount).toBe(0)
    expect((await c.query('select 1 from public.attendance_records where id = $1', [F.rows.attendance])).rowCount).toBe(0)
  })
})
it('ⓓ workspace_id 없는 무프로젝트 회의록 23502, 프로젝트와 어긋난 workspace_id 23514', async () => {
  await asService(pool, async (c) => {
    expect(await pgError(c, `insert into public.minutes (minute_date, team_code, title, body_md) values ('2026-09-01', 'ERP', 'X', '#')`))
      .toMatchObject({ code: '23502' })
    expect(await pgError(c, `insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md) values ($1, $2, '2026-09-01', 'ERP', 'X', '#')`,
      [F.projects.a, F.wsB])).toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' })
  })
})
it('ⓔ project_ws 는 세션이 PostgREST 로 부를 수 없다(R3 A) — 분기 B 면 남의 프로젝트에 null', async () => {
  await asUser(pool, F.users.bAdmin, async (c) => {
    const err = await pgError(c, 'select public.project_ws($1)', [F.projects.a])
    // R3 분기 A: expect(err).toMatchObject({ code: '42501' })
    // R3 분기 B: expect(err).toBeNull() 그리고 결과 null — 채택한 분기 한 줄만 남긴다
    expect(err).toMatchObject({ code: '42501' })
  })
})
it('ⓕ 프로젝트 관리자는 관리자 명단 행의 팀을 못 바꾸고, 워크스페이스 관리자는 바꾼다(M2)', async () => {
  // dana 의 A 명단 행(member)을 같은 트랜잭션 안에서 admin 으로 올린 뒤 팀을 붙여 본다(끝에 rollback)
  const promote = `update public.project_members set access_role = 'admin' where id = $1`
  const add = 'insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, false)'
  await asUser(pool, F.users.member, async (c) => {   // alice — A 프로젝트 관리자, 워크스페이스 관리자 아님
    await c.query('reset role'); await c.query(promote, [F.members.danaA]); await c.query('set local role authenticated')
    expect(await pgError(c, add, [F.members.danaA, F.teams.erp])).toMatchObject({ code: '42501' })
    // 대조: 멤버 행(bob)의 팀은 alice 가 붙인다 — 거부가 "관리자 행" 때문이다
    expect((await c.query(add, [F.members.bobA, F.teams.mes])).rowCount).toBe(1)
  })
  await asUser(pool, F.users.wsAdmin, async (c) => {
    await c.query('reset role'); await c.query(promote, [F.members.danaA]); await c.query('set local role authenticated')
    expect((await c.query(add, [F.members.danaA, F.teams.erp])).rowCount).toBe(1)
  })
})
it('ⓖ 세션은 명단 행의 person_id·project_id 를 못 바꾼다(M1 컬럼 권한)', async () => {
  await asUser(pool, F.users.wsAdmin, async (c) => {
    expect(await pgError(c, 'update public.project_members set person_id = $1 where id = $2', [F.people.aLoose, F.members.bobA]))
      .toMatchObject({ code: '42501' })
    expect((await c.query('update public.project_members set role_label = $1 where id = $2', ['QA', F.members.bobA])).rowCount).toBe(1)
  })
})
it('ⓗ 비활성 인물의 명단 행은 my_member_id·my_team_ids 에서 빠진다(M3)', async () => {
  await asUser(pool, F.users.member, async (c) => {
    await c.query('reset role')
    await c.query('update public.people set active = false where id = $1', [F.people.member])
    await c.query('set local role authenticated')
    const { rows } = await c.query('select public.my_member_id($1) as m, (select count(*) from public.my_team_ids($1)) as t', [F.projects.a])
    expect(rows[0]).toEqual({ m: null, t: '0' })
  })
})
it('ⓘ service_role 은 72 RLS 표 전부를 읽고 서비스 RPC 를 실행한다(grant 누락 — T10 이월, §5.1)', async () => {
  await asService(pool, async (c) => {
    const tables = (await c.query<{ name: string }>(`select c.relname::text as name from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity order by 1`)).rows
    await c.query('set local role service_role')
    const denied: string[] = []
    for (const { name } of tables) {
      const err = await pgError(c, `select 1 from public."${name}" limit 1`)
      if (err) denied.push(`${name}: ${err.code}`)
    }
    expect(denied).toEqual([])
    const { rows } = await c.query<{ ok: boolean }>(`select bool_and(has_function_privilege('service_role', f, 'EXECUTE')) as ok from unnest(array[
      'public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid)',
      'public.consume_project_invite(text, text, uuid)',
      'public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[])']) as f`)
    expect(rows[0].ok).toBe(true)
  })
})
```

- [ ] **Step 8: 실행**

Run: `npm run test:rls 2>&1 | tail -6`
Expected: workspace-isolation 3 PASS(누설 0), workspace-isolation-cases 9 PASS, org-core 12 PASS(⑤ 는 `wsadmin_write_admin_rows` 새 본문으로 통과), schema-invariants PASS. SP1 케이스가 깨지면 마이그레이션을 고치고(수기 DB 편집 금지) `db:reset` 부터 다시 — 이미 만든 마이그레이션 커밋은 amend 하지 않고 후속 `db: 0006 …` 커밋으로(같은 트레일러).

- [ ] **Step 9: 테스트 커밋**

```bash
git add tests/rls/isolation-map.ts tests/rls/fixture-ws.sql tests/rls/harness.ts tests/rls/workspace-isolation-cases.test.ts
git commit -m "test(rls): 0006 뒤 B 계정의 누설 0 + 두 워크스페이스 사용자·무프로젝트 회의록·명단 FK·service_role grant 핀 케이스"
```

### Task 3: 코드 — `workspace_id` 쓰기 경로(회의록·폴더·알림·선호·watchers)

**Files:**
- Modify: `src/lib/domain/authz.ts`, `src/app/actions/minutes.ts`(생성·폴더 가드), `src/app/api/v1/minutes/route.ts`, `src/lib/minutes/folders.ts`, `src/app/actions/teams.ts:53-60`, `src/lib/notify/emit.ts`, `src/app/actions/{preferences,notifications,inbox}.ts`, `src/app/api/v1/agent/watch/route.ts`
- Create: `src/lib/prefs/prefsWorkspace.ts`
- Test: `tests/domain/authz.test.ts`(추가), `tests/prefs/prefs-workspace.test.ts`(신설), 위 파일들의 기존 테스트(rpc 인자·insert 인자 갱신)

**Interfaces:**
- Produces:
```ts
// src/lib/domain/authz.ts
/** 그 워크스페이스에 역할이 있는가 — 워크스페이스 관리자이거나, 그 워크스페이스 프로젝트 중 하나에 명단 권한. (옛 app_role() is not null 의 워크스페이스판) */
export function hasProjectRoleInWorkspace(actor: Actor | null, workspaceId: string | null | undefined): boolean
// src/lib/prefs/prefsWorkspace.ts
/** 선호값 키 워크스페이스 = 가장 먼저 가입한 소속(0006 백필과 같은 규칙). 소속 없음 null, 조회 실패 throw. */
export async function prefsWorkspaceId(db: Pick<SupabaseClient, 'from'>, userId: string): Promise<string | null>
// src/lib/minutes/folders.ts — 시그니처 변경
export async function resolveTeamRootFolderId(sb: DbClient, teamCode: TeamCode, projectId: string | null, workspaceId: string): Promise<string | null>
// src/lib/notify/emit.ts — EmitInput 에 추가
workspaceId?: string   // projectId 가 null 일 때 필수(없으면 { ok: false } + 로그)
```
- Consumes: Task 2 의 RPC `p_workspace_id`, 트리거(프로젝트 있는 행은 DB 가 채운다 — 코드는 알 때 명시로 넣는다).

- [ ] **Step 1: 순수 함수 테스트**

`tests/domain/authz.test.ts` 에 추가:
```ts
describe('hasProjectRoleInWorkspace', () => {
  const W2 = 'ws-2', R = 'proj-in-w2'
  it('워크스페이스 관리자는 명단 없이 true, 다른 워크스페이스 관리자는 false', () => {
    expect(hasProjectRoleInWorkspace(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), W)).toBe(true)
    expect(hasProjectRoleInWorkspace(makeActor({ workspaceRoles: new Map([[W2, 'admin']]) }), W)).toBe(false)
  })
  it('그 워크스페이스 프로젝트의 명단 권한이면 true, 다른 워크스페이스 명단 권한은 false', () => {
    expect(hasProjectRoleInWorkspace(makeMemberActor(P, [], inWs), W)).toBe(true)
    const other = makeMemberActor(R, [], { projectWorkspace: new Map([[R, W2]]), workspaceRoles: new Map([[W, 'member'], [W2, 'member']]) })
    expect(hasProjectRoleInWorkspace(other, W)).toBe(false)
  })
  it('null 워크스페이스·비로그인은 fail-closed, 플랫폼 관리자는 true', () => {
    expect(hasProjectRoleInWorkspace(makeMemberActor(P, [], inWs), null)).toBe(false)
    expect(hasProjectRoleInWorkspace(null, W)).toBe(false)
    expect(hasProjectRoleInWorkspace(makeSuperuser(), W)).toBe(true)
  })
})
```
`tests/prefs/prefs-workspace.test.ts`: 가짜 `from('workspace_members').select().eq().order().order().limit().maybeSingle()` 체인으로 (a) 행 있으면 그 id, (b) 없으면 null, (c) `error` 면 reject, (d) 쿼리가 `created_at` 오름차순 → `workspace_id` 오름차순으로 정렬을 요청했는지(호출 인자 기록).

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/authz.test.ts tests/prefs` → FAIL(없는 export·모듈).

- [ ] **Step 3: 구현**

`src/lib/domain/authz.ts`:
```ts
export function hasProjectRoleInWorkspace(actor: Actor | null, workspaceId: string | null | undefined): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  if (!workspaceId) return false
  if (actor.workspaceRoles.get(workspaceId) === 'admin') return true
  for (const pid of actor.projectRoles.keys()) if (actor.projectWorkspace.get(pid) === workspaceId) return true
  return false
}
```
`src/lib/prefs/prefsWorkspace.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/** 선호값(user_preferences)의 워크스페이스 키 — 가장 먼저 가입한 소속. 0006 백필과 같은 규칙이라 기존 행을 그대로 찾는다.
 *  선호값은 보안 경계가 아니다(스펙 §2.3). 전환 UI 는 SP3 — 그때 이 함수가 "현재 워크스페이스" 로 바뀐다. */
export async function prefsWorkspaceId(db: Pick<SupabaseClient, 'from'>, userId: string): Promise<string | null> {
  const { data, error } = await db.from('workspace_members').select('workspace_id')
    .eq('user_id', userId).order('created_at', { ascending: true }).order('workspace_id', { ascending: true })
    .limit(1).maybeSingle()
  if (error) throw new Error('선호값 워크스페이스 조회 실패: ' + error.message)
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null
}
```
선호값 소비처(각각 `const ws = await prefsWorkspaceId(sb, uid)` 후 `.eq('workspace_id', ws)`):
- `preferences.ts` `getUiPrefs`: 조회 실패(throw)·`ws === null` → `console.error` 후 `{}`(표시용 열화 — 기존 관례와 같음). `saveUiPrefs`: 실패·null → 로그 후 **저장 중단**(3원칙 ②), upsert 행에 `workspace_id: ws`, `onConflict: 'user_id,workspace_id'`.
- `notifications.ts:60`(읽기) 동일 열화, `:77-83`(`markAllNotificationsRead`) 실패·null → `{ ok: false }`, upsert 에 `workspace_id`·`onConflict: 'user_id,workspace_id'`.
- `inbox.ts:48` 의 `Promise.all` 두 번째 원소를 `prefsWorkspaceId(sb, user.id).then(ws => ws ? sb.from('user_preferences').select('prefs').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle() : { data: null, error: null })` 로(실패 throw 는 `prefError` 로 잡아 기존 열화 경로로).

회의록 생성(`src/app/actions/minutes.ts` 180~230):
```ts
  // 미지정이면 쓰기 대상 워크스페이스에 역할이 있어야 한다(옛 app_role() is not null 의 워크스페이스판)
  let workspaceId: string | null = null
  if (!resolvedProject.projectId) {
    const w = resolveSoleWorkspaceId(g.actor)
    if (!w.ok) return { ok: false, error: w.error }
    workspaceId = w.workspaceId
  }
  if (resolvedProject.projectId
    ? !isProjectMember(g.actor, resolvedProject.projectId)
    : !hasProjectRoleInWorkspace(g.actor, workspaceId)) return { ok: false, error: '권한 없음' }
```
폴더 해석에 넘길 워크스페이스 — 프로젝트가 있으면 그 프로젝트의 것(가드를 통과했으니 `projectWorkspace` 에 있다; 플랫폼 관리자는 buildActor 가 전 프로젝트를 싣는다):
```ts
  const targetWs = workspaceId
    ?? (resolvedProject.projectId ? g.actor.projectWorkspace.get(resolvedProject.projectId) ?? null : null)
  if (!targetWs) return { ok: false, error: ERR_MISSING }
  const effectiveFolderId = folderId ?? await resolveTeamRootFolderId(sb, effectiveTeam, resolvedProject.projectId, targetWs)
```
RPC 인자에 `p_workspace_id: workspaceId`(프로젝트가 있으면 null — RPC 가 프로젝트에서 얻는다). 186행 주석을 "미지정이면 쓰기 대상 워크스페이스에 역할이 있어야 한다" 로.
폴더 가드 동기화(RLS 와 같은 판정 — 952행 주석이 예고한 것):
- `loadFolders` 의 select 에 `workspace_id`, `FolderRow` 에 `workspaceId: string`.
- `createMinuteFolder`: `hasAnyProjectRole(g.actor)` → 부모를 찾은 뒤 `if (!hasProjectRoleInWorkspace(g.actor, parent.workspaceId)) return { ok: false, error: '권한 없음' }`(부모 조회 전 판정은 지운다). insert 는 그대로(트리거가 부모의 워크스페이스를 채운다).
- 이름 변경(916행 부근)·삭제(952~955행): `isAnyProjectAdmin(g.actor)` → `isWorkspaceAdmin(g.actor, target.workspaceId)`. 916·952~954·1043행의 `app_role()` 언급 주석을 "RLS 의 관리자 판정(작성자 ∨ 그 워크스페이스 관리자, 0006)" 으로.
`src/lib/minutes/folders.ts`: `resolveTeamRootFolderId(sb, teamCode, projectId, workspaceId)` — `projectId` 가 null 이면 `q.is('project_id', null).eq('workspace_id', workspaceId)`. 호출부(액션·`api/v1/minutes/route.ts` 의 `resolveTeamRootWithLazyCreate`)가 넘긴다.
외부 회의록 API(`src/app/api/v1/minutes/route.ts` `insertNew`): `meetingProjectId` 가 null 이면
```ts
  let workspaceId: string | null = null
  if (!meetingProjectId) {
    let actor
    try { actor = await actorFromUser(admin, user.id) } catch (e) {
      console.error('[minutes-api] 작성자 권한 조회 실패:', e); return apiInternalError()
    }
    const w = resolveSoleWorkspaceId(actor)
    if (!w.ok) return apiBadRequest('프로젝트 없는 회의록은 소속 워크스페이스가 하나인 계정만 등록할 수 있습니다. meeting_id 로 프로젝트를 지정하세요.')
    workspaceId = w.workspaceId
  }
```
RPC 에 `p_workspace_id: workspaceId`, 폴더 해석 호출에도 넘긴다.
공용 팀 시드(`src/app/actions/teams.ts:53-60`): select 에 `.eq('workspace_id', w.workspaceId)`, insert 에 `workspace_id: w.workspaceId`.
알림(`src/lib/notify/emit.ts`): 수신자 해석 쿼리를 `.select('id, people!inner(user_id, active)').in('id', memberIds).eq('active', true).eq('people.active', true)`(비활성 명단·인물은 받지 않는다 — 이월 항목). 이벤트 insert 전에:
```ts
    if (!input.projectId && !input.workspaceId) {
      console.error('[notify] 프로젝트 없는 알림에 workspaceId 가 없다', input.type)
      return { ok: false }
    }
```
insert 행에 `workspace_id: input.workspaceId ?? null`(프로젝트가 있으면 트리거가 채운다). `git grep -n "emitNotification(" src` 로 `projectId: null` 을 넘기는 호출부가 있는지 확인 — 있으면 그 호출부의 워크스페이스를 넘긴다(Task 1 조사 시점 0곳 — 보고서에 재확인 결과).
에이전트 watch(`src/app/api/v1/agent/watch/route.ts:115`): `projectId` 가 null 이면 `actorFromUser(admin, principal.userId)` → `resolveSoleWorkspaceId` → 실패 시 `apiFail(400, 'project_required', '워크스페이스가 하나가 아니면 project_id 를 지정하세요.')`. upsert 에 `workspace_id`(프로젝트가 있으면 트리거가 채우므로 null 로 둬도 된다 — 명시할 수 있으면 명시).

- [ ] **Step 4: 통과·회귀**

Run: `npx vitest run tests/domain/authz.test.ts tests/prefs tests/actions tests/notify tests/api tests/minutes --reporter=dot 2>&1 | tail -4 && npm run typecheck`
Expected: 실패 0, tsc 0. 기존 테스트가 rpc 인자(`p_workspace_id`)·upsert `onConflict`·select 문자열을 단언하면 새 값으로 고친다(단언 완화 금지).

- [ ] **Step 5: DB 맞물림 확인(로컬)**

Run: `npm run db:reset && npm run test:rls 2>&1 | tail -3` → PASS(코드 변경이 DB 를 건드리지 않았는지). 그리고 `npm run dev:bootstrap`(env 로 계정) → `npm run dev` 에서 회의록 업로드(프로젝트 지정·미지정 각 1건), 폴더 생성, 선호값(테마 전환) 저장이 오류 없이 되는지 눈으로 확인. dev 서버는 끝나면 종료(`lsof -iTCP:3000` 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/authz.ts src/lib/prefs/prefsWorkspace.ts src/app/actions/minutes.ts src/app/api/v1/minutes/route.ts src/lib/minutes/folders.ts src/app/actions/teams.ts src/lib/notify/emit.ts src/app/actions/preferences.ts src/app/actions/notifications.ts src/app/actions/inbox.ts src/app/api/v1/agent/watch/route.ts tests/domain/authz.test.ts tests/prefs/prefs-workspace.test.ts <인자를 고친 기존 테스트들>
git commit -m "feat(ws): 회의록·폴더·알림·선호·watchers 가 workspace_id 를 채우고 폴더 가드가 RLS 와 같은 판정을 쓴다

0006 이 프로젝트 없는 행에 workspace_id not null 을 걸었다. 쓰기 대상은 resolveSoleWorkspaceId(SP3 전환 UI 전까지),
선호값 키는 가장 먼저 가입한 워크스페이스(백필과 같은 규칙). 알림 수신자는 활성 명단·활성 인물만."
```

### Task 4: 정적 불변식(개방 읽기 0·`app_role` 0) + 성능 기준선

**Files:**
- Modify: `tests/rls/schema-invariants.test.ts`, `tests/invariants/no-legacy-org.test.ts`
- Create: `scripts/perf-baseline.mjs`, `tests/scripts/perf-baseline.test.ts`, `docs/baseline/sp2-perf.md`

**Interfaces:**
- Produces: `node scripts/perf-baseline.mjs seed` / `node scripts/perf-baseline.mjs measure --base <url> --label <이름> [--n 30]` → stdout JSON `{ label, n, routes: { [path]: { p50, p95 } } }`. 순수 헬퍼 `percentile(values: number[], p: number): number`(`scripts/lib/perf.mjs`).

- [ ] **Step 1: DB 불변식 — `tests/rls/schema-invariants.test.ts` 에 두 케이스**

```ts
// 개방 읽기 0(D2 예외 1): SELECT·ALL 정책 중 본문이 true 이거나 스코프 헬퍼·auth.uid() 를 하나도 부르지 않는 것
const SCOPE_MARKERS = ['accessible_project_ids', 'my_workspace_ids', 'is_ws_member', 'is_ws_admin', 'can_read_project',
  'is_project_member', 'is_project_admin', 'is_superuser', 'auth.uid()', 'can_attach', 'can_edit_issue']
const OPEN_READ_EXCEPTIONS: Record<string, string> = {
  'issue_mega_areas.read_all_issue_mega_areas': 'D2 — 전역 참조 데이터(테넌트 행 없음). 만료: SP5 에서 표가 프로젝트 영역으로 대체',
}
it('개방 읽기 정책 0건(D2 예외 1)', async () => {
  const rows = await asService(pool, async (c) => (await c.query<{ k: string; qual: string | null }>(
    `select tablename || '.' || policyname as k, qual from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL')`)).rows)
  const open = rows.filter((r) => r.qual === 'true' || !SCOPE_MARKERS.some((m) => (r.qual ?? '').includes(m))).map((r) => r.k)
  expect(open.filter((k) => !(k in OPEN_READ_EXCEPTIONS))).toEqual([])
  expect(Object.keys(OPEN_READ_EXCEPTIONS).filter((k) => !open.includes(k)), '죽은 예외').toEqual([])
})
it('app_role 참조 0건(함수·정책, storage·realtime 포함)', async () => {
  const { rows } = await pool.query<{ what: string }>(
    `select 'fn ' || proname as what from pg_proc where prosrc ilike '%app_role%'
     union all select 'policy ' || schemaname || '.' || tablename || '.' || policyname from pg_policies
      where coalesce(qual, '') || coalesce(with_check, '') ilike '%app_role%'`)
  expect(rows.map((r) => r.what)).toEqual([])
})
```
- [ ] **Step 2: 코드 불변식** — `tests/invariants/no-legacy-org.test.ts` 의 `LEGACY_IDENT` 에 `app_role` 추가: `/\b(memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership|current_team|update_project_member_with_identity|app_role)\b/`.

- [ ] **Step 3: 실행** — `npm run test:rls -- tests/rls/schema-invariants.test.ts && npx vitest run tests/invariants/no-legacy-org.test.ts` → PASS. 실패하면 남은 참조를 고친다(테스트를 완화하지 않는다). `SCOPE_MARKERS` 에 걸리지 않는 정당한 정책이 있으면 그 정책 본문을 보고서에 적고 컨트롤러 판단을 받는다.

- [ ] **Step 4: 성능 스크립트**

`scripts/lib/perf.mjs`:
```js
/** 최근접 순위 백분위(p ∈ (0,100]) — 표본이 작아도 실제 관측값을 돌려준다. */
export function percentile(values, p) {
  if (!values.length) throw new Error('표본 없음')
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
```
`tests/scripts/perf-baseline.test.ts`: `percentile([5,1,3,2,4], 50) === 3`, `percentile([1..20], 95) === 19`, 빈 배열 throw.
`scripts/perf-baseline.mjs`(로컬 전용 — `.env.local` 을 `scripts/lib/e2e.mjs` 의 `localClientEnv`·`scripts/lib/targets.mjs` 의 `localAdminEnv` 로 읽는다; 원격 좌표면 그 함수들이 throw):
- `seed`: service_role 로 부트스트랩 워크스페이스(`BOOTSTRAP_WORKSPACE_SLUG`, 기본 `default`)에 프로젝트 `PERF`(없으면 생성, 있으면 재사용), `wbs_items` 800행(10 단계 × 80, 코드 `P.<i>.<j>`, 계획일 결정적), 공지 20, 이슈 50 을 `upsert(..., { onConflict })` 로 멱등 생성. 프로젝트 id 를 stdout.
- `measure --base <url> --label <이름> --n <N>`: `BOOTSTRAP_EMAIL`/`BOOTSTRAP_PASSWORD` 로 `@supabase/ssr` 로그인(쿠키 jar — e2e 의 `session()` 과 같은 구성), `PERF` 프로젝트 id 조회, 경로 `/p/<pid>/dashboard`·`/p/<pid>/wbs` 를 워밍업 3회 뒤 각각 N 회 순차 `fetch`(응답 본문까지 읽고 시간 측정, 상태 200 아니면 exit 1), `percentile` 50·95 를 JSON 으로.

- [ ] **Step 5: 기준선 측정 — `sp1-done` 과 HEAD 를 같은 데이터로**

```bash
set -e
W=$(mktemp -d)/sp1
git worktree add --detach "$W" sp1-done
cp .env.local "$W/.env.local"
npm --prefix "$W" ci
npm --prefix "$W" run build
supabase db reset --version 0005
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' npm run dev:bootstrap
node scripts/perf-baseline.mjs seed
npm --prefix "$W" run start -- -p 3100     # run_in_background 로 띄운다
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' node scripts/perf-baseline.mjs measure --base http://localhost:3100 --label sp1-done --n 30 > "$W/../sp1.json"
# 3100 서버 종료(lsof -iTCP:3100 -sTCP:LISTEN 의 pid 를 kill)
npm run db:reset
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' npm run dev:bootstrap
node scripts/perf-baseline.mjs seed
npm run build
npm run start -- -p 3000                   # run_in_background
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' node scripts/perf-baseline.mjs measure --base http://localhost:3000 --label sp2-phase-a --n 30 > "$W/../sp2a.json"
# 3000 서버 종료, git worktree remove "$W"
```
Expected: 두 JSON. `docs/baseline/sp2-perf.md` 에 일시·커밋 sha·N·경로별 p50/p95 표와 비율(HEAD/sp1-done)을 적는다. 기준: 두 경로 모두 p95 비율 ≤ 1.20. 넘으면 커밋하지 말고 멈춰 보고한다(R1 — `EXPLAIN (ANALYZE)` 로 `wbs_items` 조회 계획을 떠서 첨부; initplan 이 행마다 돌면 정책 술어를 고치는 것이 다음 태스크).

- [ ] **Step 6: 커밋**

```bash
git add tests/rls/schema-invariants.test.ts tests/invariants/no-legacy-org.test.ts scripts/perf-baseline.mjs scripts/lib/perf.mjs tests/scripts/perf-baseline.test.ts docs/baseline/sp2-perf.md
git commit -m "test: 개방 읽기 0·app_role 0 을 불변식으로, 대시보드·WBS p95 를 sp1-done 과 같은 데이터로 기록한다"
```

### Task 5: Phase A 체크포인트

**Files:**
- Create: `docs/baseline/sp2-e2e.md`(Phase A 절)

- [ ] **Step 1: 깨끗한 DB 에서 전 게이트**

```bash
npm run db:reset 2>&1 | tail -2
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run dev    # run_in_background
BOOTSTRAP_PASSWORD='LocalDev!2026' node scripts/e2e-local.mjs > "$(mktemp -d)/e2e.json"
npm run test:rls 2>&1 | tail -4
npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3 && npm run build 2>&1 | tail -2
```
Expected: E2E exit 0(SP1 흐름 그대로 — Phase A 는 흐름을 바꾸지 않는다), test:rls 전부 PASS, 타입·린트·테스트·빌드 초록. E2E 가 실패하면 원인 파일을 고치고 해당 태스크의 후속 커밋으로(여기서 고치지 않는다). dev 서버 종료 확인.

- [ ] **Step 2: 기록·커밋 → 컨트롤러가 `main` ff 머지·push(사람 확인)·CI 확인**

`docs/baseline/sp2-e2e.md` 에 "Phase A" 절: 일시, 커밋 sha, E2E 단계표(단계·행 수), test:rls 케이스 수, R3·R4 판정.
```bash
git add docs/baseline/sp2-e2e.md
git commit -m "docs(sp2): Phase A 체크포인트 — E2E·test:rls·게이트 기록"
```

---

## Phase B — 두 트랙(B1 ∥ B2)

체크포인트가 `main` 에 들어간 뒤 컨트롤러가 워크트리 두 개를 만든다(리포 밖 `mktemp -d`):
- B1: 브랜치 `sp2/phase-b1`(Task 6→7→8→9, Task 9 는 그 위의 `ui/sp2-presence`), 마이그레이션 `0007` 만.
- B2: 브랜치 `sp2/phase-b2`(Task 10→11→12→13→14→15), 마이그레이션 `0008` 만.
각 워크트리에 `.env.local` 복사·`npm ci`. **두 트랙은 파일이 겹치지 않는다**(아래 태스크의 Files 목록이 서로소 — 겹침은 Task 16 통합에서 처리). DB 단계는 Global Constraints 의 공유 DB 규칙대로 컨트롤러가 순서를 준다. dev 서버 포트는 B1 `3101`, B2 `3102`(`npm run dev -- -p <포트>`).

### Task 6 (B1): 경로·토픽 규약 순수 함수 — `storagePath.ts`·`presenceTopics.ts`

**Files:**
- Create: `src/lib/domain/storagePath.ts`, `src/lib/domain/presenceTopics.ts`, `tests/domain/storage-path.test.ts`, `tests/domain/presence-topics.test.ts`

**Interfaces:**
- Produces:
```ts
// src/lib/domain/storagePath.ts
export type StorageEntity = 'minutes' | 'minute-files' | 'deliverables' | 'issue-attachments'
export interface StoragePathParts { workspaceId: string; projectId: string | null; entity: StorageEntity; entityId: string; fileName: string }
export function makeStoragePath(p: StoragePathParts): string            // ws/<wid>/p/<pid|_>/<entity>/<id>/<file> — 입력이 틀리면 throw
export function parseStoragePath(path: string): StoragePathParts | null // 형식이 틀리면 null(절대 throw 하지 않는다)
export function isStoragePathFor(path: string, expected: Omit<StoragePathParts, 'fileName'>): boolean
// src/lib/domain/presenceTopics.ts
export function pagePresenceTopic(projectId: string, pageKey: string): string        // project-<pid>-presence-<pageKey>
export function weeklyPresenceTopic(projectId: string, reportId: string): string     // project-<pid>-weekly-<rid>-presence
export const PRESENCE_TOPIC_RE: RegExp   // 0007 정책의 정규식과 글자 단위로 같다
```
- SQL 짝(Task 7): `storage_ws(name)`·`storage_project(name)`·`storage_entity_id(name)` 가 `parseStoragePath` 와 같은 세그먼트를 본다.

- [ ] **Step 1: 테스트**

`tests/domain/storage-path.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeStoragePath, parseStoragePath, isStoragePathFor } from '@/lib/domain/storagePath'
const W = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222', E = '33333333-3333-4333-8333-333333333333'
describe('storagePath', () => {
  it('왕복: 프로젝트 있음·없음', () => {
    const a = makeStoragePath({ workspaceId: W, projectId: P, entity: 'issue-attachments', entityId: E, fileName: '1700-a.pdf' })
    expect(a).toBe(`ws/${W}/p/${P}/issue-attachments/${E}/1700-a.pdf`)
    expect(parseStoragePath(a)).toEqual({ workspaceId: W, projectId: P, entity: 'issue-attachments', entityId: E, fileName: '1700-a.pdf' })
    const b = makeStoragePath({ workspaceId: W, projectId: null, entity: 'minutes', entityId: E, fileName: 'm.md' })
    expect(b).toBe(`ws/${W}/p/_/minutes/${E}/m.md`)
    expect(parseStoragePath(b)?.projectId).toBeNull()
  })
  it.each([
    'garbage', `${E}/1700-a.pdf`, `ws/not-a-uuid/p/_/minutes/${E}/f`, `ws/${W}/p/xx/minutes/${E}/f`,
    `ws/${W}/p/_/unknown/${E}/f`, `ws/${W}/p/_/minutes/${E}/`, `ws/${W}/p/_/minutes/${E}/a/b`, `ws/${W}/p/_/minutes/${E}/..`,
    `ws/${W}/q/_/minutes/${E}/f`, ` ws/${W}/p/_/minutes/${E}/f`,
  ])('형식이 틀리면 null: %s', (s) => { expect(parseStoragePath(s)).toBeNull() })
  it('make 는 틀린 입력을 거부한다', () => {
    expect(() => makeStoragePath({ workspaceId: 'x', projectId: null, entity: 'minutes', entityId: E, fileName: 'f' })).toThrow()
    expect(() => makeStoragePath({ workspaceId: W, projectId: null, entity: 'minutes', entityId: E, fileName: 'a/b' })).toThrow()
  })
  it('isStoragePathFor 는 네 스코프가 모두 같아야 true', () => {
    const p = makeStoragePath({ workspaceId: W, projectId: P, entity: 'deliverables', entityId: E, fileName: 'f' })
    expect(isStoragePathFor(p, { workspaceId: W, projectId: P, entity: 'deliverables', entityId: E })).toBe(true)
    expect(isStoragePathFor(p, { workspaceId: W, projectId: null, entity: 'deliverables', entityId: E })).toBe(false)
    expect(isStoragePathFor(p, { workspaceId: W, projectId: P, entity: 'minutes', entityId: E })).toBe(false)
  })
})
```
`tests/domain/presence-topics.test.ts`: 두 토픽 형식, `PRESENCE_TOPIC_RE` 가 둘 다 매치하고 첫 캡처가 pid, `pageKey` 가 `/^[a-z0-9-]{1,40}$/` 아니면 throw, uuid 아닌 pid·reportId throw, `project-<pid>-wbs`(브로드캐스트)는 매치하지 않음.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/storage-path.test.ts tests/domain/presence-topics.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

`src/lib/domain/storagePath.ts`:
```ts
// Storage 객체 키 규약(SP2 §3.1) — ws/<wid>/p/<pid 또는 _>/<entity>/<id>/<파일>. 스토리지 RLS(0007)의 storage_ws·storage_project·
// storage_entity_id 가 같은 세그먼트(2·4·6번째)를 읽는다. 파서는 형식이 틀리면 null — 호출부가 거부 사유로 쓴다(throw 금지).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITIES = ['minutes', 'minute-files', 'deliverables', 'issue-attachments'] as const
export type StorageEntity = (typeof ENTITIES)[number]
export interface StoragePathParts { workspaceId: string; projectId: string | null; entity: StorageEntity; entityId: string; fileName: string }

function fileNameOk(f: string): boolean {
  return f.length > 0 && f.length <= 200 && !f.includes('/') && f !== '.' && f !== '..' && !/[\s\p{Cc}]/u.test(f.replace(/ /g, ''))
}
export function makeStoragePath(p: StoragePathParts): string {
  if (!UUID.test(p.workspaceId) || (p.projectId !== null && !UUID.test(p.projectId)) || !UUID.test(p.entityId)
    || !(ENTITIES as readonly string[]).includes(p.entity) || !fileNameOk(p.fileName)) {
    throw new Error('저장 경로 입력이 올바르지 않습니다.')
  }
  return `ws/${p.workspaceId}/p/${p.projectId ?? '_'}/${p.entity}/${p.entityId}/${p.fileName}`
}
export function parseStoragePath(path: string): StoragePathParts | null {
  if (typeof path !== 'string') return null
  const s = path.split('/')
  if (s.length !== 7 || s[0] !== 'ws' || s[2] !== 'p') return null
  const [, ws, , pid, entity, id, file] = s
  if (!UUID.test(ws) || !(pid === '_' || UUID.test(pid)) || !UUID.test(id)) return null
  if (!(ENTITIES as readonly string[]).includes(entity) || !fileNameOk(file)) return null
  return { workspaceId: ws.toLowerCase(), projectId: pid === '_' ? null : pid.toLowerCase(), entity: entity as StorageEntity, entityId: id.toLowerCase(), fileName: file }
}
export function isStoragePathFor(path: string, e: Omit<StoragePathParts, 'fileName'>): boolean {
  const p = parseStoragePath(path)
  return !!p && p.workspaceId === e.workspaceId.toLowerCase() && p.projectId === (e.projectId?.toLowerCase() ?? null)
    && p.entity === e.entity && p.entityId === e.entityId.toLowerCase()
}
```
(`fileNameOk` 의 문자 규칙은 기존 `sanitizeFileName`(`src/lib/domain/issueAttachments.ts`) 출력이 통과하는지 테스트로 확인 — 업로드 쪽은 항상 `sanitizeFileName` 뒤에 `makeStoragePath` 를 부른다.)
`src/lib/domain/presenceTopics.ts`:
```ts
// presence 토픽 규약(SP2 §3.3) — realtime.messages 정책(0007)이 같은 정규식으로 pid 를 뽑아 can_read_project 로 판정한다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_KEY = /^[a-z0-9-]{1,40}$/
export const PRESENCE_TOPIC_RE =
  /^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$/
export function pagePresenceTopic(projectId: string, pageKey: string): string {
  if (!UUID.test(projectId) || !PAGE_KEY.test(pageKey)) throw new Error('presence 토픽 입력이 올바르지 않습니다.')
  return `project-${projectId.toLowerCase()}-presence-${pageKey}`
}
export function weeklyPresenceTopic(projectId: string, reportId: string): string {
  if (!UUID.test(projectId) || !UUID.test(reportId)) throw new Error('presence 토픽 입력이 올바르지 않습니다.')
  return `project-${projectId.toLowerCase()}-weekly-${reportId.toLowerCase()}-presence`
}
```
- [ ] **Step 4: 통과** — 같은 명령 → PASS.
- [ ] **Step 5: 커밋** — `git add src/lib/domain/storagePath.ts src/lib/domain/presenceTopics.ts tests/domain/storage-path.test.ts tests/domain/presence-topics.test.ts` → `git commit -m "feat(storage): 저장 경로·presence 토픽 규약을 순수 함수 한 곳으로 — 0007 정책과 같은 세그먼트를 본다"`.

### Task 7 (B1): `0007_storage_realtime.sql` — 3버킷·presence 정책 + RLS 케이스

**Files:**
- Create: `supabase/migrations/0007_storage_realtime.sql`, `supabase/rollbacks/0007_storage_realtime_rollback.sql`, `supabase/rehearsal/0007_smoke.sql`, `tests/rls/storage-realtime.test.ts`

**Interfaces:**
- Produces(DB): `public.uuid_or_null(text) returns uuid`(immutable, plpgsql, 정규식 먼저 — 캐스트 오류 없음), `public.storage_ws(text)`·`public.storage_project(text)`·`public.storage_entity_id(text) returns uuid`(immutable sql; 형식이 틀리면 null); storage 정책 9개(`minutes`·`issue-attachments`·`deliverables` × read/insert/delete, 이름 유지); `realtime.messages` 정책 `read_project_presence`(SELECT)·`track_project_presence`(INSERT); `create_minute_with_version` 파일 경로 검사가 새 규약.
- Consumes: Task 6 의 세그먼트 규약·`PRESENCE_TOPIC_RE`.

- [ ] **Step 1: RLS 케이스 먼저 — `tests/rls/storage-realtime.test.ts`**

```ts
// 0007 Storage·Realtime 정책 — pg 직결이라 storage.objects·realtime.messages 행을 직접 넣고 authenticated 세션으로 정책을 평가한다.
// realtime.messages 는 일 단위 파티션이다 — realtime 컨테이너가 떠 있어야 오늘 파티션이 있다(npm run db:start 로 전체 스택).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { pagePresenceTopic, weeklyPresenceTopic } from '@/lib/domain/presenceTopics'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const put = (c: PoolClient, bucket: string, name: string, owner: string | null) =>
  c.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, owner])
const visible = async (c: PoolClient, bucket: string, name: string) =>
  (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount
const minuteA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'm.md' })
const minuteNull = makeStoragePath({ workspaceId: F.ws, projectId: null, entity: 'minutes', entityId: F.rows.nullMinute, fileName: 'm.md' })
const issueA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'issue-attachments', entityId: F.rows.issue, fileName: 'a.pdf' })
const delivA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'deliverables', entityId: F.leaf.aErp, fileName: 'd.pdf' })

describe('Storage 3버킷(0007)', () => {
  it('① minutes: A 멤버는 프로젝트·무프로젝트 객체를 보고 쓰며, B 는 0행·쓰기 거부, 교차 프로젝트·옛 형식 경로 거부', async () => {
    // 픽스처 행은 트랜잭션마다 service 로 넣는다(롤백으로 사라진다)
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member); await put(c, 'minutes', minuteNull, F.users.member)
      await c.query('set local role authenticated')
      expect(await visible(c, 'minutes', minuteA)).toBe(1)
      expect(await visible(c, 'minutes', minuteNull)).toBe(1)
      const fresh = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'n.md' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', fresh, F.users.member])).toBeNull()
      const crossProject = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.bWs, entity: 'minutes', entityId: F.rows.minute, fileName: 'x.md' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', crossProject, F.users.member]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', `${F.rows.minute}/old.md`, F.users.member]))
        .toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member)
      await c.query('set local role authenticated')
      expect(await visible(c, 'minutes', minuteA)).toBe(0)
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', minuteA.replace('m.md', 'b.md'), F.users.bAdmin]))
        .toMatchObject({ code: '42501' })
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query('delete from storage.objects where bucket_id = $1 and name = $2', ['minutes', minuteA])).rowCount).toBe(0)
    })
  })
  const insertObj = 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)'
  it.each([
    ['② issue-attachments', 'issue-attachments', issueA],
    ['③ deliverables', 'deliverables', delivA],
  ])('%s: A 관리자(alice)는 읽고 쓰며, B 는 0행·쓰기 거부, 이웃 경로(다른 엔터티 id)도 거부', async (_label, bucket, name) => {
    const second = name.replace(/\/[^/]+$/, '/second.bin')
    const foreignEntity = name.replace(/\/([0-9a-f-]{36})\/([^/]+)$/, `/${F.rows.meeting}/$2`)   // 존재하지만 다른 종류의 id
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, bucket, name, F.users.member); await c.query('set local role authenticated')
      expect(await visible(c, bucket, name)).toBe(1)
      expect(await pgError(c, insertObj, [bucket, second, F.users.member])).toBeNull()
      expect(await pgError(c, insertObj, [bucket, foreignEntity, F.users.member])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, bucket, name, F.users.member); await c.query('set local role authenticated')
      expect(await visible(c, bucket, name)).toBe(0)
      expect(await pgError(c, insertObj, [bucket, second, F.users.bAdmin])).toMatchObject({ code: '42501' })
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount).toBe(0)
    })
  })
  it('④ 형식이 틀린 객체 이름이 섞여도 목록 조회가 22P02 로 깨지지 않는다(Review Focus 1)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      for (const b of ['minutes', 'issue-attachments', 'deliverables']) {
        for (const n of ['garbage', `ws/not-a-uuid/p/_/minutes/${F.rows.minute}/f`, `${F.rows.issue}/legacy.pdf`, `ws/${F.ws}/p/zz/minutes/x/f`]) {
          await put(c, b, `${n}`, null)
        }
      }
      await c.query('set local role authenticated')
      for (const b of ['minutes', 'issue-attachments', 'deliverables']) {
        const err = await pgError(c, 'select name from storage.objects where bucket_id = $1', [b])
        expect(err, `${b} 목록 조회`).toBeNull()
        const { rows } = await c.query<{ name: string }>('select name from storage.objects where bucket_id = $1', [b])
        expect(rows.map((r) => r.name).filter((n) => !n.startsWith('ws/'))).toEqual([])
      }
    })
  })
})

describe('Realtime presence(0007)', () => {
  const pageA = pagePresenceTopic(F.projects.a, 'wbs')
  const weeklyA = weeklyPresenceTopic(F.projects.a, F.rows.weeklyReport)
  const asTopic = (c: PoolClient, topic: string) => c.query(`select set_config('realtime.topic', $1, true)`, [topic])
  const join = async (c: PoolClient, topic: string) => {
    await asTopic(c, topic)
    return (await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'presence'`, [topic])).rowCount
  }
  const track = async (c: PoolClient, topic: string) => {
    await asTopic(c, topic)
    return pgError(c, `insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [topic])
  }
  it('⑤ A 멤버·두 워크스페이스 사용자는 A presence 를 보고 track 한다', async () => {
    for (const uid of [F.users.member, F.users.aLoose, F.users.dual]) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        for (const t of [pageA, weeklyA]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [t])
        await c.query('set local role authenticated')
        for (const t of [pageA, weeklyA]) { expect(await join(c, t)).toBe(1); expect(await track(c, t)).toBeNull() }
      })
    }
  })
  it('⑥ B 계정은 A pid 토픽을 0행·42501, 형식이 틀린 토픽도 오류 없이 거부(Review Focus 5)', async () => {
    const bad = [`project-not-a-uuid-presence-wbs`, `project-${F.projects.a}-presence-WBS`, `project-${F.projects.a}-presence-`]
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role')
      for (const t of [pageA, weeklyA, ...bad]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [t])
      await c.query('set local role authenticated')
      for (const t of [pageA, weeklyA, ...bad]) {
        expect(await join(c, t), t).toBe(0)
        expect(await track(c, t), t).toMatchObject({ code: '42501' })
      }
    })
  })
  it('⑦ broadcast(WBS 변경, SP1 정책)도 B 계정에 0행 — done_when 의 broadcast 토픽', async () => {
    const wbsA = `project-${F.projects.a}-wbs`
    for (const [uid, expected] of [[F.users.member, 1], [F.users.bAdmin, 0]] as const) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'wbs_changed', '{}', true)`, [wbsA])
        await c.query('set local role authenticated')
        await asTopic(c, wbsA)
        expect((await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'broadcast'`, [wbsA])).rowCount).toBe(expected)
      })
    }
  })
})
```
Run: `npm run db:reset && npm run test:rls -- tests/rls/storage-realtime.test.ts` → FAIL(현재 정책: minutes 개방·`split_part(...)::uuid` 22P02·presence 정책 없음).

- [ ] **Step 2: 마이그레이션**

`supabase/migrations/0007_storage_realtime.sql`:
```sql
-- 0007_storage_realtime — SP2 Phase B1. 정본: SP2 스펙 §3. 경로 규약 ws/<wid>/p/<pid|_>/<entity>/<id>/<file>(src/lib/domain/storagePath.ts 와 짝).
-- 직접 ::uuid 캐스트 금지 — 형식이 틀린 객체 이름 하나가 버킷 목록 조회 전체를 22P02 로 실패시킨다(uuid_or_null 경유).

create function public.uuid_or_null(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return p::uuid; end if;
  return null;
end $$;
create function public.storage_ws(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) = 'ws' and split_part(p_name, '/', 3) = 'p'
                and array_length(string_to_array(p_name, '/'), 1) = 7
              then public.uuid_or_null(split_part(p_name, '/', 2)) end
$$;
create function public.storage_project(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when public.storage_ws(p_name) is not null then public.uuid_or_null(split_part(p_name, '/', 4)) end
$$;
create function public.storage_entity_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when public.storage_ws(p_name) is not null then public.uuid_or_null(split_part(p_name, '/', 6)) end
$$;
revoke all on function public.uuid_or_null(text), public.storage_ws(text), public.storage_project(text), public.storage_entity_id(text) from public, anon;
grant execute on function public.uuid_or_null(text), public.storage_ws(text), public.storage_project(text), public.storage_entity_id(text) to authenticated, service_role;

-- minutes 버킷: 회의록 본문(minutes)·첨부(minute-files). 프로젝트 세그먼트는 '_' 또는 그 워크스페이스의 프로젝트.
drop policy "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated using (
  bucket_id = 'minutes' and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null or public.can_read_project(public.storage_project(name))));
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) in ('minutes', 'minute-files')
  and public.storage_entity_id(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (split_part(name, '/', 4) = '_'
       or exists (select 1 from public.projects p
                   where p.id = public.storage_project(name) and p.workspace_id = public.storage_ws(name)
                     and public.is_project_member(p.id))));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and public.is_ws_member(public.storage_ws(name))
  and (owner = auth.uid() or public.is_ws_admin(public.storage_ws(name)))
  and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));

-- issue-attachments: 읽기 = 그 프로젝트를 읽을 수 있음, 쓰기·삭제 = can_edit_issue + 이슈가 그 프로젝트·워크스페이스의 것
drop policy "issue-attachments read" on storage.objects;
create policy "issue-attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'issue-attachments' and public.can_read_project(public.storage_project(name))
  and public.storage_project(name) is not null);
drop policy "issue-attachments insert" on storage.objects;
create policy "issue-attachments insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'issue-attachments' and split_part(name, '/', 5) = 'issue-attachments'
  and public.can_edit_issue(public.storage_entity_id(name))
  and exists (select 1 from public.issues i join public.projects p on p.id = i.project_id
               where i.id = public.storage_entity_id(name) and i.project_id = public.storage_project(name)
                 and p.workspace_id = public.storage_ws(name)));
drop policy "issue-attachments delete" on storage.objects;
create policy "issue-attachments delete" on storage.objects for delete to authenticated using (
  bucket_id = 'issue-attachments' and public.can_edit_issue(public.storage_entity_id(name)));

-- deliverables: 세 동작 모두 can_attach(항목) + 항목이 그 프로젝트·워크스페이스의 것(읽기도 can_attach — 현행 의미 유지)
drop policy "deliverables read" on storage.objects;
create policy "deliverables read" on storage.objects for select to authenticated using (
  bucket_id = 'deliverables' and public.can_attach(public.storage_entity_id(name)));
drop policy "deliverables insert" on storage.objects;
create policy "deliverables insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'deliverables' and split_part(name, '/', 5) = 'deliverables'
  and public.can_attach(public.storage_entity_id(name))
  and exists (select 1 from public.wbs_items w join public.projects p on p.id = w.project_id
               where w.id = public.storage_entity_id(name) and w.project_id = public.storage_project(name)
                 and p.workspace_id = public.storage_ws(name)));
drop policy "deliverables delete" on storage.objects;
create policy "deliverables delete" on storage.objects for delete to authenticated using (
  bucket_id = 'deliverables' and public.can_attach(public.storage_entity_id(name)));

-- presence(private) — 토픽의 pid 를 읽을 수 있는 사람만 join(SELECT)·track(INSERT). 정규식 = presenceTopics.ts PRESENCE_TOPIC_RE.
create policy read_project_presence on realtime.messages for select to authenticated using (
  extension = 'presence'
  and substring(realtime.topic() from '^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$') is not null
  and public.can_read_project(public.uuid_or_null(substring(realtime.topic() from '^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$'))));
create policy track_project_presence on realtime.messages for insert to authenticated with check (
  extension = 'presence'
  and substring(realtime.topic() from '^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$') is not null
  and public.can_read_project(public.uuid_or_null(substring(realtime.topic() from '^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$'))));
```
이어서 `create_minute_with_version` 을 0006 본문 그대로 `create or replace`(18인자, 시그니처 불변) 하되 파일 경로 검사 한 줄만:
```
-         or p_file_path not like (v_minute_id::text || '/%')
+         or p_file_path not like ('ws/' || v_workspace_id::text || '/p/' || coalesce(v_project_id::text, '_') || '/minutes/' || v_minute_id::text || '/%')
```
— 이 검사는 워크스페이스 확정(0006 에서 팀 검사 앞에 넣은 블록) **뒤**에 있어야 한다. 0006 본문에서 파일 검사 블록이 워크스페이스 확정보다 앞에 있으면 파일 검사 블록을 워크스페이스 확정 뒤로 옮긴다(`v_has_file` 계산은 `declare` 그대로). ACL 은 `create or replace` 가 유지한다.

- [ ] **Step 3: 롤백·스모크·리허설**

롤백: presence 정책 2 drop; storage 9정책을 0006 직후 본문으로(`minutes bucket read` = `bucket_id = 'minutes'`, `minutes bucket insert` = `bucket_id = 'minutes'`, `minutes bucket delete` = 0006 Step 2 의 본문, `issue-attachments read` = `bucket_id = 'issue-attachments'`, `issue-attachments insert/delete` = `bucket_id = 'issue-attachments' and can_edit_issue((split_part(name, '/', 1))::uuid)`, `deliverables read/insert/delete` = `bucket_id = 'deliverables' and can_attach((split_part(name, '/', 1))::uuid)`); `create_minute_with_version` 을 0006 본문으로; 헬퍼 4 drop.
`supabase/rehearsal/0007_smoke.sql`(postgres 로, `begin … rollback`, 불리언 전부 `t`):
```sql
begin;
select public.uuid_or_null('garbage') is null as bad_is_null,
       public.uuid_or_null('11111111-1111-4111-8111-111111111111') is not null as good_parses,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f')
         = '11111111-1111-4111-8111-111111111111' as ws_segment,
       public.storage_project('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f') is null as underscore_is_null,
       public.storage_project('ws/11111111-1111-4111-8111-111111111111/p/33333333-3333-4333-8333-333333333333/minutes/22222222-2222-4222-8222-222222222222/f')
         = '33333333-3333-4333-8333-333333333333' as project_segment,
       public.storage_entity_id('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/not-uuid/f') is null as bad_entity_is_null,
       public.storage_ws('a/b/c') is null as short_path_is_null,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/a/b') is null as eight_segments_is_null,
       (select count(*) = 2 from pg_policies where schemaname = 'realtime' and policyname in ('read_project_presence', 'track_project_presence')) as presence_policies;
rollback;
```
```bash
D=$(mktemp -d)
supabase db reset --version 0006 && node supabase/rehearsal/compare-catalog.mjs capture "$D/ref0006"
npm run db:reset
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0007_smoke.sql
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0007_storage_realtime_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/rb" && node supabase/rehearsal/compare-catalog.mjs diff "$D/ref0006" "$D/rb"
npm run db:reset && npm run test:rls 2>&1 | tail -4
```
Expected: 스모크 전부 `t`, diff 0, test:rls 전부 PASS(storage-realtime 8 포함 — ①·②·③·④·⑤·⑥·⑦).

- [ ] **Step 4: 커밋 두 개**

```bash
git add supabase/migrations/0007_storage_realtime.sql supabase/rollbacks/0007_storage_realtime_rollback.sql supabase/rehearsal/0007_smoke.sql
git commit -m "db: 0007 Storage·presence 격리 — ws/<wid>/p/<pid>/… 경로 규약과 uuid_or_null 경유 정책

minutes 버킷은 읽기·쓰기가 로그인 누구에게나 열려 있었고, 나머지 두 버킷은 직접 ::uuid 캐스트라 형식이 틀린 객체
하나가 목록 조회를 22P02 로 깨뜨릴 수 있었다. presence 는 pid 를 읽을 수 있는 사람만 join·track 한다.

Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')"
git add tests/rls/storage-realtime.test.ts
git commit -m "test(rls): 3버킷·presence 교차 — B 0행·쓰기 거부, 형식 틀린 객체 이름·토픽이 조회를 깨지 않는다"
```

### Task 8 (B1): 업로드 5곳·서버 검증기가 새 경로 규약을 쓴다

**Files:**
- Modify: `src/lib/domain/issueAttachments.ts`(`makeIssueAttachmentPath`·`isIssueAttachmentPathValid`), `src/lib/domain/minutes.ts:181`(`isMinuteFilePathValid`), `src/lib/issues/uploadIssueAttachments.ts:67`, `src/components/minutes/MinuteUploadModal.tsx:152,194`, `src/components/minutes/MinuteViewer.tsx:619`, `src/components/wbs/RowDetailPanel.tsx:735`, `src/app/actions/{issueAttachments,minutes,attachments,issues}.ts`, `src/lib/data/minutes.ts`(DTO 에 `workspaceId`), 업로드 컴포넌트에 `workspaceId` 를 내리는 서버 페이지(목록은 `git grep -ln "MinuteUploadModal\|MinuteViewer\|RowDetailPanel\|uploadIssueAttachments" -- src` 의 결과를 따라 올라가 `page.tsx` 까지 — 보고서에 prop 경로 표)
- Create: `src/lib/domain/deliverables.ts`(`isDeliverablePathValid`)
- Test: `tests/domain/issue-attachments.test.ts`·`tests/domain/minutes.test.ts`(갱신), `tests/domain/deliverables.test.ts`(신설), 액션 테스트(검증기 거부 케이스)

**Interfaces:**
- Produces:
```ts
export function makeIssueAttachmentPath(scope: { workspaceId: string; projectId: string }, issueId: string, fileName: string, now: number): string
export function isIssueAttachmentPathValid(scope: { workspaceId: string; projectId: string }, issueId: string, path: string): boolean
export function isMinuteFilePathValid(scope: { workspaceId: string; projectId: string | null }, minuteId: string, path: string, entity: 'minutes' | 'minute-files'): boolean
export function isDeliverablePathValid(scope: { workspaceId: string; projectId: string }, itemId: string, path: string): boolean
```
전부 `makeStoragePath`/`isStoragePathFor` 위의 얇은 함수. 서버 액션은 **scope 를 클라이언트 입력이 아니라 DB 에서 읽은 대상 행**(이슈·회의록·WBS 항목의 `project_id` → 그 프로젝트의 `workspace_id`, 회의록은 `minutes.workspace_id`)에서 얻는다.

- [ ] **Step 1: 순수 테스트** — 각 검증기: 올바른 경로 true; 다른 워크스페이스·다른 프로젝트·다른 엔터티 id·다른 entity 세그먼트·옛 형식 `${id}/file`·`..` → false. `makeIssueAttachmentPath` 는 `sanitizeFileName` 결과를 `${now}-` 접두로.
- [ ] **Step 2: 실패 확인 → 구현 → 통과.** `npx vitest run tests/domain`.
- [ ] **Step 3: 업로드 5곳** — 각 컴포넌트가 `makeStoragePath` 로 경로를 만든다: 회의록 본문 `entity: 'minutes'`(후보 id = `candidateId`), 회의록 첨부 `'minute-files'`(`MinuteUploadModal:194`·`MinuteViewer:619`), 산출물 `'deliverables'`, 이슈 첨부 `makeIssueAttachmentPath`. `workspaceId` 는 서버 컴포넌트가 계산해 prop 으로 내린다 — 프로젝트 화면은 `actor.projectWorkspace.get(projectId)`, 회의록 목록의 무프로젝트 업로드는 `resolveSoleWorkspaceId(actor)`(실패 시 업로드 버튼 비활성 + 사유 표시), 회의록 상세는 DTO 의 `workspaceId`. 롤백 삭제(업로드 실패 후 브라우저 삭제 4곳)는 같은 경로 변수를 쓰므로 그대로 따라온다 — 파일별로 확인.
- [ ] **Step 4: 서버 검증기** — `actions/issueAttachments.ts:125`, `actions/minutes.ts:172,553,625` 가 새 시그니처로(대상 행에서 scope 를 읽는 쿼리가 이미 있으면 select 에 `workspace_id`/`projects(workspace_id)` 를 더한다; 조회 실패는 중단 — 3원칙 ②). `actions/attachments.ts` 산출물 등록 액션에 `isDeliverablePathValid` 신설 적용(없던 검증 — 실패 문구 `'잘못된 파일 경로입니다.'`). 서명 URL·삭제(`actions/attachments.ts:52,97`, `issueAttachments.ts:91,177`, `issues.ts:1129`, `minutes.ts:703,764`, `lib/data/minutes.ts:263`)는 DB 에 저장된 경로를 그대로 쓰므로 코드 변경 없음 — 확인만 하고 보고서에 "변경 없음(저장 경로 사용)" 표.
- [ ] **Step 5: 검증** — `npx vitest run tests/domain tests/actions tests/components --reporter=dot | tail -3 && npm run typecheck`. 로컬 눈확인(`npm run db:reset` → bootstrap → `npm run dev -- -p 3101`): 회의록 업로드(프로젝트 있음·없음), 회의록 첨부, 산출물 첨부, 이슈 첨부 각 1건 성공 + 다운로드(서명 URL) 성공. Storage 객체 이름이 `ws/` 로 시작하는지 `select name from storage.objects` 로 확인해 보고서에.
- [ ] **Step 6: 커밋** — 변경 파일을 명시해 `git add` → `feat(storage): 업로드 5곳·서버 검증기가 ws/<wid>/p/<pid>/… 규약을 쓴다 — scope 는 대상 행에서 읽는다`.

### Task 9 (B1): presence private 채널 — `usePagePresence`(UI 위험)·`weekly/usePresence`

브랜치: `git switch -c ui/sp2-presence`(sp2/phase-b1 에서).

**Files:**
- Modify: `src/components/app/usePagePresence.ts`, `src/components/wbs/WbsGanttSheet.tsx:368`, `src/components/weekly/usePresence.ts`, `src/components/weekly/WeeklySheetView.tsx:567`
- Test: `tests/components/use-page-presence.test.tsx`·`tests/components/weekly-presence.test.tsx`(없으면 신설 — `createBrowserClient` 를 mock 해 `channel(topic, { config: { private: true, presence: { key } } })` 인자와 `realtime.setAuth()` 호출을 단언)

**Interfaces:**
- 시그니처 변경: `usePagePresence({ projectId, pageKey, me, enabled })`(옛 `channelKey` 제거), `usePresence({ projectId, reportId, me, active, editing, enabled })`.

- [ ] **Step 1: 훅 테스트(mock)** — (a) 토픽 = `pagePresenceTopic(projectId, pageKey)`·`weeklyPresenceTopic(projectId, reportId)`, (b) `config.private === true`, (c) 구독 전 `sb.realtime.setAuth()` 호출, (d) `enabled=false`·`me=null`·토픽 생성 throw(잘못된 pid) 면 채널을 만들지 않고 빈 목록.
- [ ] **Step 2: 실패 → 구현.** `useWbsRealtime.ts` 와 같은 순서(세션 확인 → `setAuth()` → `channel(topic, { config: { private: true, presence: { key: connKeyRef.current! } } })`)로, 채널 생성 전체를 `try` 로 감싼다(향상 계층 — 실패해도 화면은 산다). 호출부: `WbsGanttSheet` → `usePagePresence({ projectId, pageKey: 'wbs', me, enabled: !!me })`, `WeeklySheetView` → `usePresence({ projectId, reportId, … })`.
- [ ] **Step 3: R6 — 로컬 두 브라우저 세션 눈확인**

`npm run db:reset` → bootstrap → 두 번째 계정을 같은 워크스페이스·같은 프로젝트 명단에 추가(로컬 service_role, E2E 초대 경로를 써도 된다) → `npm run dev -- -p 3101` → 브라우저 A(관리자)·B(두 번째 계정, 시크릿 창)로 `/p/<pid>/wbs`·`/p/<pid>/weekly` 에서 서로의 presence 아바타가 보이는지, 한쪽 탭을 닫으면 사라지는지. 그리고 다른 워크스페이스 계정(로컬에 두 번째 워크스페이스·계정 시드)으로 같은 URL 은 404(레이아웃)이므로, 대신 브라우저 콘솔에서 `supabase.channel('project-<A pid>-presence-wbs', { config: { private: true } }).subscribe(console.log)` 가 `CHANNEL_ERROR`(인가 거부)인지 확인.
**분기:** 같은 워크스페이스 두 세션이 서로를 못 보면(구독이 `CHANNEL_ERROR`·`TIMED_OUT`, 또는 SUBSCRIBED 인데 presence sync 가 비어 있음) → 이 태스크의 코드 변경을 되돌리지 말고 **커밋하지 않은 채 멈추고** 증상(브라우저 콘솔·`docker logs supabase_realtime_d-flow --tail 100`)을 보고한다. 컨트롤러가 "presence private 는 SP3 로 이관"(스펙 R6)을 판정하면 훅 변경을 버리고(`git checkout -- <두 훅·두 호출부>` — 작업 트리 파일 단위, 커밋 이력은 건드리지 않는다) 0007 의 presence 정책은 남긴다(무해). 판정을 보고서·`docs/baseline/sp2-e2e.md` 에 기록.
- [ ] **Step 4: 커밋(트레일러 필수) → `sp2/phase-b1` 로 ff 머지**

```bash
git add src/components/app/usePagePresence.ts src/components/wbs/WbsGanttSheet.tsx src/components/weekly/usePresence.ts src/components/weekly/WeeklySheetView.tsx tests/components/use-page-presence.test.tsx tests/components/weekly-presence.test.tsx
git commit -m "ui(presence): WBS·주간보고 presence 를 private 채널로 — pid 를 읽을 수 있는 사람만 join·track

공개 presence 채널은 anon 키만 있으면 누구나 join 해 사용자 id·이름을 볼 수 있었다(0007 정책과 짝).

Preview-checked: local $(date '+%Y-%m-%d %H:%M') — /p/[id]/wbs, /p/[id]/weekly 두 세션 presence + 타 워크스페이스 CHANNEL_ERROR"
git switch sp2/phase-b1 && git merge --ff-only ui/sp2-presence
```
(`git switch … && git merge …` 는 한 줄 `&&` 연결 — `;` 금지.)

### Task 10 (B2): `requireWorkspaceAdmin`·`resolveScope`·`resolveScopeAdmin`

**Files:**
- Modify: `src/lib/domain/authz.ts`, `src/lib/authz/index.ts`, `src/lib/agent/delegation.ts:37`, `tests/authz/guard-signatures.test.ts`, `tests/domain/authz.test.ts`, `tests/authz/guards.test.ts`
- Create: `src/lib/authz/scope.ts`, `src/lib/authz/scopeAdmin.ts`, `tests/authz/scope.test.ts`

**Interfaces:**
- Produces:
```ts
// src/lib/domain/authz.ts
export type WorkspaceGuardVerdict = 'ok' | 'missing' | 'denied'
export function workspaceAdminVerdict(actor: Actor, workspaceId: string | null): WorkspaceGuardVerdict
// src/lib/authz/scope.ts
export type ProjectScopedTable = 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'
export type ScopeResult = { ok: true; projectId: string | null; workspaceId: string } | { ok: false; error: string }
export async function readScope(db: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string, tag: string): Promise<ScopeResult>
// src/lib/authz/scopeAdmin.ts — service_role 경로(에이전트·외부 API)
export async function resolveScopeAdmin(admin: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string): Promise<ScopeResult>
// src/lib/authz/index.ts
export async function requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult>
export async function resolveScope(table: ProjectScopedTable, id: string): Promise<ScopeResult>
export async function resolveProjectId(table: ProjectScopedTable, id: string): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }>  // 불변 — resolveScope 의 얇은 래퍼
export type { ProjectScopedTable }   // scope.ts 에서 재수출
```

- [ ] **Step 1: 테스트**

`tests/domain/authz.test.ts` 추가:
```ts
describe('workspaceAdminVerdict', () => {
  it('플랫폼 관리자 ok, 관리자 ok, 멤버 denied, 비소속·null missing(존재 은닉)', () => {
    expect(workspaceAdminVerdict(makeSuperuser(), 'ws-x')).toBe('ok')
    expect(workspaceAdminVerdict(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), W)).toBe('ok')
    expect(workspaceAdminVerdict(makeActor(), W)).toBe('denied')
    expect(workspaceAdminVerdict(makeActor(), 'ws-other')).toBe('missing')
    expect(workspaceAdminVerdict(makeActor(), null)).toBe('missing')
  })
})
describe('Q2 — 두 워크스페이스·비공개(Review Focus 2)', () => {
  const W2 = 'ws-2', B = 'proj-b'
  const dual = makeActor({ workspaceRoles: new Map([[W, 'admin'], [W2, 'member']]), projectWorkspace: new Map([[P, W], [B, W2]]) })
  it('A 관리자는 A 비공개 프로젝트의 admin 이고 B 프로젝트는 명단대로(viewer)', () => {
    expect(roleIn(dual, P)).toBe('admin'); expect(canSeeProject(dual, { id: P, is_private: true })).toBe(true)
    expect(roleIn(dual, B)).toBe('viewer')
  })
  it('B 에 속하지 않은 A 관리자에게 B 프로젝트는 null', () => {
    expect(roleIn(makeActor({ workspaceRoles: new Map([[W, 'admin']]), projectWorkspace: new Map([[P, W]]) }), B)).toBe(null)
  })
})
```
`tests/authz/scope.test.ts`: 가짜 `from(table).select(cols).eq('id', id).maybeSingle()` — (a) `minutes` 는 `select('project_id, workspace_id')` 를 요청하고 무프로젝트 행에 `{ projectId: null, workspaceId }`, (b) 다른 표는 `'project_id, projects!inner(workspace_id)'` 를 요청하고 임베드 객체·배열 둘 다 해석, (c) `error` → `ERR_LOOKUP`, (d) `null` → `ERR_MISSING`, (e) 워크스페이스가 비면 `ERR_LOOKUP`(fail-closed).
`tests/authz/guards.test.ts`: `requireWorkspaceAdmin` 케이스 — 비로그인 `ERR_ANON`, 비소속 `ERR_MISSING`, 멤버 `ERR_DENIED`, 관리자 ok, 플랫폼 관리자 ok, `getActor` 실패 `ERR_LOOKUP`.
`tests/authz/guard-signatures.test.ts` 의 `it.each` 에 추가:
```ts
    ['requireWorkspaceAdmin', 'export async function requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult>'],
    ['resolveScope', 'export async function resolveScope(table: ProjectScopedTable, id: string): Promise<ScopeResult>'],
```
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/authz.test.ts tests/authz` → FAIL.
- [ ] **Step 3: 구현**

`src/lib/domain/authz.ts`:
```ts
export type WorkspaceGuardVerdict = 'ok' | 'missing' | 'denied'
/** 워크스페이스 관리 가드의 순수 판정. 소속이 없거나 id 가 없으면 'missing'(존재 은닉 — 404), 멤버면 'denied'(403). */
export function workspaceAdminVerdict(actor: Actor, workspaceId: string | null): WorkspaceGuardVerdict {
  if (actor.isSuperuser) return 'ok'
  if (!workspaceId) return 'missing'
  const r = actor.workspaceRoles.get(workspaceId)
  if (r === undefined) return 'missing'
  return r === 'admin' ? 'ok' : 'denied'
}
```
`src/lib/authz/scope.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { ERR_LOOKUP, ERR_MISSING } from './errors'

/** project_id 컬럼을 직접 가진 표 화이트리스트 — 임의 표 조회를 막는다. */
export type ProjectScopedTable =
  | 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'
export type ScopeResult = { ok: true; projectId: string | null; workspaceId: string } | { ok: false; error: string }

/** 대상 행의 프로젝트·워크스페이스. minutes 만 project_id 가 nullable 이라 자기 workspace_id(0006)를 읽는다.
 *  조회 실패는 쓰기 중단 사유(3원칙 ②), 워크스페이스를 못 얻으면 fail-closed. 세션 클라이언트면 RLS 가 타 워크스페이스 행을 가려 ERR_MISSING. */
export async function readScope(
  db: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string, tag: string,
): Promise<ScopeResult> {
  const cols = table === 'minutes' ? 'project_id, workspace_id' : 'project_id, projects!inner(workspace_id)'
  const { data, error } = await db.from(table).select(cols).eq('id', id).maybeSingle()
  if (error) {
    console.error(`[${tag}] ${table} 조회 실패:`, error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: ERR_MISSING }
  const row = data as Record<string, unknown>
  const embedded = row.projects as { workspace_id?: unknown } | Array<{ workspace_id?: unknown }> | null | undefined
  const ws = table === 'minutes' ? row.workspace_id : (Array.isArray(embedded) ? embedded[0]?.workspace_id : embedded?.workspace_id)
  if (typeof ws !== 'string' || !ws) {
    console.error(`[${tag}] ${table} 워크스페이스를 확정하지 못했다:`, id)
    return { ok: false, error: ERR_LOOKUP }
  }
  return { ok: true, projectId: (row.project_id as string | null) ?? null, workspaceId: ws }
}
```
`src/lib/authz/scopeAdmin.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { readScope, type ProjectScopedTable, type ScopeResult } from './scope'
/** service_role 경로용(RLS 없음) — 호출자가 이미 주체(PAT·세션 가드)를 확인한 뒤에만 쓴다. */
export function resolveScopeAdmin(admin: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string): Promise<ScopeResult> {
  return readScope(admin, table, id, 'resolveScopeAdmin')
}
```
`src/lib/authz/index.ts`: 기존 `ProjectScopedTable` 정의를 지우고 `import { readScope, type ProjectScopedTable, type ScopeResult } from './scope'` + `export type { ProjectScopedTable, ScopeResult }`;
```ts
/** 워크스페이스 관리(프로젝트 생성·공용 팀·계정·워크스페이스 역할). 비소속은 ERR_MISSING(404), 멤버는 ERR_DENIED. */
export async function requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult> {
  const r = await actorOrError(); if (!r.ok) return r
  const v = workspaceAdminVerdict(r.actor, workspaceId)
  if (v === 'missing') return { ok: false, error: ERR_MISSING }
  return v === 'ok' ? r : { ok: false, error: ERR_DENIED }
}
export async function resolveScope(table: ProjectScopedTable, id: string): Promise<ScopeResult> {
  return readScope(await createServerClient(), table, id, 'resolveScope')
}
/** 호출 25곳 호환용 — resolveScope 의 프로젝트만. */
export async function resolveProjectId(
  table: ProjectScopedTable, id: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }> {
  const r = await resolveScope(table, id)
  return r.ok ? { ok: true, projectId: r.projectId } : r
}
```
`src/lib/agent/delegation.ts:37` — 이 함수는 세션 가드(`requireProjectAdmin`/`Member`)를 쓰는 **세션 경로**다(실측: 36~43행). 서비스 경로에서도 불리는지 `git grep -n "requireDelegationRight" src` 로 확인: 세션 경로만이면 `resolveProjectId` 를 그대로 두고 보고서에 "세션 경로 — 교체 불필요(스펙 §4.1 의 전제 정정)". 서비스 경로(`api/v1/**`)에서 불리면 그 호출부에 `resolveScopeAdmin(admin, 'wbs_items', id)` 를 쓰는 서비스용 변형을 두고 세션 가드를 부르지 않게 한다.
- [ ] **Step 4: 통과·전체** — `npx vitest run tests/domain tests/authz --reporter=dot | tail -3 && npm run typecheck && npx vitest run --reporter=dot | tail -3`. `vi.mock('@/lib/authz')` 팩토리는 새 export 가 없어도 기존 테스트가 부르지 않으므로 그대로 통과해야 한다.
- [ ] **Step 5: 커밋** — `git add src/lib/domain/authz.ts src/lib/authz/index.ts src/lib/authz/scope.ts src/lib/authz/scopeAdmin.ts <delegation.ts 를 바꿨으면> tests/domain/authz.test.ts tests/authz/scope.test.ts tests/authz/guards.test.ts tests/authz/guard-signatures.test.ts` → `authz: requireWorkspaceAdmin·resolveScope — 워크스페이스 관리 가드와 행의 워크스페이스 해석을 판정 계층에`.

### Task 11 (B2): `requireSuperuser` 13곳 → 워크스페이스·프로젝트 가드, 플랫폼 11곳 고정

**Files:**
- Modify: `src/app/actions/project.ts`(createProject·setProjectPrivacy), `src/app/actions/projectInvites.ts`(createProjectInvite 관리자 슬롯), `src/app/actions/chat.ts`(reindexProjectAction), `src/app/actions/teams.ts`(addTeam·updateTeam·listTeamsAdmin), `src/app/actions/accounts.ts`(createAccount·bulkCreateAccounts·setWorkspaceRole·listAccounts), `src/app/api/chat/reindex/route.ts`, `src/app/api/import/execute/route.ts:96`, 호출 화면(`src/app/(app)/projects/page.tsx`·`src/app/(app)/admin/{teams,accounts}/page.tsx` 와 그 클라이언트 컴포넌트 — `workspaceId` prop 전달)
- Create: `tests/invariants/platform-guards.test.ts`
- Test: 위 액션들의 기존 테스트(`vi.mock('@/lib/authz')` 팩토리에 `requireWorkspaceAdmin` 추가 — 이 태스크가 바꾸는 액션의 테스트만)

**Interfaces:**
- 시그니처 변경: `createProject(workspaceId: string, name, start, end, description, levelLabels)`, `addTeam(workspaceId: string, input: string)`, `listTeamsAdmin(workspaceId: string)`, `createAccount(input: AccountInput & { workspaceId: string })`, `bulkCreateAccounts(workspaceId: string, text, projectId)`. `setWorkspaceRole(workspaceId, userId, role)` 는 이미 `workspaceId` 를 받는다(불변). 화면은 SP3 전까지 서버 컴포넌트가 `resolveSoleWorkspaceId(actor)` 로 구한 값을 넘긴다(실패면 버튼 비활성 + 사유).

- [ ] **Step 1: 불변식 먼저 — `tests/invariants/platform-guards.test.ts`**

```ts
// 플랫폼 전용 가드(requireSuperuser) 호출 위치를 스펙 §4.1 D1 의 11곳으로 고정한다 — 새 호출은 워크스페이스·프로젝트 가드를 먼저 검토하게.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const ROOT = join(process.cwd(), 'src')
function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}
const EXPECTED = [
  'src/app/actions/accounts.ts#resetPassword', 'src/app/actions/accounts.ts#setPlatformAdmin',
  'src/app/actions/llmConfig.ts#createLlmProfile', 'src/app/actions/llmConfig.ts#deleteLlmProfile',
  'src/app/actions/llmConfig.ts#getLlmConfig', 'src/app/actions/llmConfig.ts#listLlmProfiles',
  'src/app/actions/llmConfig.ts#saveLlmConfig', 'src/app/actions/llmConfig.ts#testLlmConnection',
  'src/app/actions/llmConfig.ts#updateLlmProfile',
  'src/app/api/chat/health/route.ts#GET', 'src/app/api/wiki/reindex/route.ts#POST',
]
describe('플랫폼 가드 11곳(D1)', () => {
  it('requireSuperuser( 호출 = EXPECTED', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(process.cwd(), file)
      if (rel === 'src/lib/authz/index.ts') continue   // 정의
      let fn = '(top)'
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^export (?:async )?function (\w+)/)
        if (m) fn = m[1]
        if (/\brequireSuperuser\(/.test(line)) hits.push(`${rel}#${fn}`)
      }
    }
    expect(hits.sort()).toEqual([...EXPECTED].sort())
  })
})
```
Run: `npx vitest run tests/invariants/platform-guards.test.ts` → FAIL(24곳).

- [ ] **Step 2: 13곳 교체**(각 액션: 가드 → 입력 검증 → 쓰기 순서 유지. 액션 테스트를 먼저 새 가드 기준으로 고치고 실패 확인 → 구현)
- `createProject(workspaceId, …)`: `const g = await requireWorkspaceAdmin(workspaceId)`; `resolveSoleWorkspaceId` 호출 삭제; insert 의 `workspace_id: workspaceId`.
- `setProjectPrivacy(projectId, …)`: `requireProjectAdmin(projectId)`.
- `createProjectInvite`: 관리자 슬롯(`access_role === 'admin'`) 분기만 `requireWorkspaceAdmin(g.actor.projectWorkspace.get(projectId) ?? null)`(앞선 `requireProjectAdmin(projectId)` 통과 뒤라 키가 있다). 202행의 `'admin'` 리터럴 비교는 Task 15.
- `reindexProjectAction(projectId)`·`api/chat/reindex` POST: `requireProjectAdmin(projectId)`.
- `addTeam(workspaceId, input)`: `requireWorkspaceAdmin(workspaceId)`; 이하 `w.workspaceId` → `workspaceId`.
- `updateTeam(teamId, …)`: 먼저 `createAdminClient().from('teams').select('workspace_id, project_id').eq('id', teamId).maybeSingle()` — 조회 실패 → `{ ok: false, error: ERR_LOOKUP }`, 없음·`project_id` 있음 → `ERR_MISSING`; 그 뒤 `requireWorkspaceAdmin(row.workspace_id)`; update 에 `.eq('workspace_id', row.workspace_id)` 도 건다.
- `listTeamsAdmin(workspaceId)`: `requireWorkspaceAdmin(workspaceId)`; 쿼리에 `.eq('workspace_id', workspaceId)`(전 워크스페이스 공용 팀 누설 수정 — 스펙 §4.2).
- `createAccount({ …, workspaceId })`·`bulkCreateAccounts(workspaceId, …)`: `requireWorkspaceAdmin(workspaceId)`. `createOne` 이 **이미 있는 계정(이메일)** 을 만나면 비밀번호·표시 이름을 건드리지 않고 그 워크스페이스 소속·명단만 추가하는지 코드로 확인 — 기존 계정의 비밀번호를 설정하는 분기가 있으면, 호출자가 플랫폼 관리자가 아닐 때 `'이미 다른 워크스페이스에 있는 계정입니다. 초대를 쓰세요.'` 로 거부하고 테스트 1건(비밀번호 무변경).
- `setWorkspaceRole(workspaceId, …)`: `requireWorkspaceAdmin(workspaceId)`.
- `listAccounts(projectId)`: 기존 `projects.workspace_id` 조회를 가드 **앞으로** 옮기고(`requireProjectMember(projectId)` 로 존재 은닉 먼저 → `g.actor.projectWorkspace.get(projectId)`), `requireWorkspaceAdmin(workspaceId)`.
- `api/import/execute` 전역 팀 등록 분기(96행): 대상 프로젝트의 워크스페이스로 `requireWorkspaceAdmin`.
화면: `projects/page.tsx`(생성 버튼)·`admin/teams/page.tsx`·`admin/accounts/page.tsx` 가 `resolveSoleWorkspaceId(actor)` 결과를 클라이언트 컴포넌트에 prop 으로; 실패면 기존 오류 표시 컴포넌트로 사유.
- [ ] **Step 3: 통과** — `npx vitest run tests/invariants/platform-guards.test.ts tests/actions tests/api --reporter=dot | tail -3 && npm run typecheck && npm run lint` → 실패 0.
- [ ] **Step 4: 커밋** — 변경 파일 명시 → `authz: requireSuperuser 13곳을 워크스페이스·프로젝트 가드로 — 플랫폼 전용 11곳을 불변식으로 고정`.

### Task 12 (B2): `adminFor` + service_role 감사표 + 스코프 불변식 + 경계 누설 수정

**Files:**
- Create: `src/lib/supabase/adminFor.ts`, `docs/sp2-admin-client-audit.md`, `tests/invariants/admin-scope.test.ts`, `tests/supabase/admin-for.test.ts`
- Modify: `src/lib/teams/master.ts`, `src/app/api/v1/minutes/meta/route.ts`, `src/app/api/v1/agent/me/route.ts`, `src/app/api/v1/agent/watch/route.ts`, `src/app/actions/accounts.ts:236-250`(`assertCanTouchAccount`), `src/app/actions/teams.ts`(listTeamsAdmin 의 admin 생성부를 `adminFor` 로), `docs/design/dflow-minutes-upload-api-spec.md`(meta 의 `user_email`)

**Interfaces:**
- Produces:
```ts
// src/lib/supabase/adminFor.ts
export type AdminScope = { workspaceId: string } | { projectId: string }
export type AdminClient = ReturnType<typeof createAdminClient>
/** service_role 클라이언트를 스코프 값과 함께 돌려준다 — 호출부가 그 값으로 필터를 걸게 하고, 정적 불변식이
 *  "스코프 없이 admin 을 만드는 파일"을 잡을 수 있게 한다. id 가 uuid 가 아니면 throw(fail-closed). */
export function adminFor<S extends AdminScope>(scope: S): S & { admin: AdminClient }
// src/lib/teams/master.ts 추가
export function teamsForWorkspaceSync(workspaceId: string): readonly Team[]
export function activeTeamCodesForWorkspaceSync(workspaceId: string): TeamCode[]
```
`Team` 형에 `workspaceId: string`(fetch select 에 `workspace_id`). 기존 전역 접근자(`teamsSync`·`activeTeamCodesSync` …)는 **검증 전용**으로 남긴다(호출처가 B1 파일 `actions/minutes.ts` 에 있다 — Task 16 이 워크스페이스판으로 옮긴다; 캐시 구조 자체는 SP4 R10).

- [ ] **Step 1: `adminFor` 테스트·구현**

`tests/supabase/admin-for.test.ts`(`vi.mock('@/lib/supabase/admin')` 로 가짜 클라이언트): `adminFor({ workspaceId: <uuid> })` → `{ workspaceId, admin }`, `adminFor({ projectId: 'x' })` throw, `adminFor({} as never)` throw.
```ts
import 'server-only'
import { createAdminClient } from './admin'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type AdminScope = { workspaceId: string } | { projectId: string }
export type AdminClient = ReturnType<typeof createAdminClient>
export function adminFor<S extends AdminScope>(scope: S): S & { admin: AdminClient } {
  const id = 'workspaceId' in scope ? scope.workspaceId : 'projectId' in scope ? scope.projectId : undefined
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('adminFor: 스코프 id 가 올바르지 않다')
  return { ...scope, admin: createAdminClient() }
}
```

- [ ] **Step 2: 감사표 작성 — `docs/sp2-admin-client-audit.md`**

목록 뽑기: `git grep -l createAdminClient -- src | grep -v -e '^src/lib/supabase/admin.ts$' -e '^src/lib/supabase/env.ts$'`(실측 63). 파일마다 열어 admin 체인을 읽고 분류한다: `플랫폼`(스코프 불필요 — 전역 표·cron·슈퍼유저 전용), `외부 API·서비스`(PAT·공유 시크릿·토큰 경로 — 주체 판정 뒤 대상 id 로 좁힘), `세션 가드 뒤 id 스코프`(가드가 대상 프로젝트·행을 확정한 뒤 그 id 로만 필터), `경계 넘음`(필터가 워크스페이스를 넘는다 — 이 태스크에서 고쳐 `adminFor` 로 옮기고 표에서 뺀다). 근거 열에는 "어느 가드 뒤 어떤 id 로 필터하는가" 를 한 줄로. 형식:
```md
# SP2 service_role(admin) 클라이언트 감사 — 2026-09-26

기준: `createAdminClient` 를 import 하는 src 파일(정의 `src/lib/supabase/admin.ts`·주석 `env.ts` 제외). 분류가 `경계 넘음` 인
파일은 없어야 한다(고쳐서 `adminFor` 로 옮겼다 — 아래 "수정한 파일" 절). `tests/invariants/admin-scope.test.ts` 가 이 표를 읽는다.

<!-- audit:start -->
| 파일 | 분류 | 근거 |
|---|---|---|
| src/app/api/cron/ai-index/route.ts | 플랫폼 | cron 시크릿 — 전역 색인 큐 |
| … 63행 … | | |
<!-- audit:end -->

## 수정한 파일(경계 넘음 → adminFor)
| 파일 | 이전 | 이후 |
```
표의 `분류` 값은 정확히 `플랫폼`·`외부 API·서비스`·`세션 가드 뒤 id 스코프`·`adminFor 정의` 넷 중 하나(`adminFor 정의` 는 `src/lib/supabase/adminFor.ts` 한 줄).

- [ ] **Step 3: 불변식 — `tests/invariants/admin-scope.test.ts`**

```ts
// service_role 클라이언트를 직접 만드는 파일 = 감사표(docs/sp2-admin-client-audit.md)의 행. 표에 없는 새 파일은 실패 —
// 스코프를 정하고(adminFor) 쓰거나, 표에 분류·근거를 적어야 한다. '경계 넘음' 분류는 남아 있으면 실패.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const ROOT = join(process.cwd(), 'src')
const DEFINITIONS = new Set(['src/lib/supabase/admin.ts', 'src/lib/supabase/env.ts'])
const CATEGORIES = new Set(['플랫폼', '외부 API·서비스', '세션 가드 뒤 id 스코프', 'adminFor 정의'])
function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}
function importers(): string[] {
  return walk(ROOT).map((f) => relative(process.cwd(), f))
    .filter((f) => !DEFINITIONS.has(f) && /\bcreateAdminClient\b/.test(readFileSync(f, 'utf8'))).sort()
}
function auditRows(): Array<{ file: string; category: string; reason: string }> {
  const doc = readFileSync('docs/sp2-admin-client-audit.md', 'utf8')
  const body = doc.split('<!-- audit:start -->')[1]?.split('<!-- audit:end -->')[0]
  if (!body) throw new Error('감사표 표지(audit:start/end)가 없다')
  return body.split('\n').filter((l) => /^\|\s*src\//.test(l)).map((l) => {
    const [file, category, reason] = l.split('|').slice(1, 4).map((s) => s.trim())
    return { file, category, reason }
  })
}
describe('admin 클라이언트 스코프(SP2 §4.2)', () => {
  it('createAdminClient 를 쓰는 파일 = 감사표 행', () => {
    expect(importers()).toEqual(auditRows().map((r) => r.file).sort())
  })
  it('분류는 허용된 넷 중 하나이고 근거가 비어 있지 않다(경계 넘음 0)', () => {
    const bad = auditRows().filter((r) => !CATEGORIES.has(r.category) || r.reason.length < 4)
    expect(bad).toEqual([])
  })
})
```
Run: `npx vitest run tests/invariants/admin-scope.test.ts` → 표를 다 채우기 전엔 FAIL, 다 채우면(경계 넘음 파일 수정 뒤) PASS.

- [ ] **Step 4: 경계 누설 수정(각각 테스트 먼저)**
- `lib/teams/master.ts` `fetchTeams`: select 에 `workspace_id`, `Team.workspaceId`; `teamsForWorkspaceSync(wid)`·`activeTeamCodesForWorkspaceSync(wid)` 추가(캐시 배열 필터). 테스트: 두 워크스페이스 팀이 섞인 캐시에서 한쪽만.
- `api/v1/minutes/meta`: 쿼리 `user_email` 필수(없으면 `apiBadRequest('user_email 이 필요합니다.')`) → `resolveUserByEmail` → 없으면 `apiNotFound` → `actorFromUser(admin, user.id)`(실패 500) → 프로젝트 목록을 `actor.projectWorkspace` 의 키 중 `canSeeProject` 통과분으로(`admin.from('projects').select('id, name, is_private').in('id', keys)`), `teams` 는 호출자가 속한 워크스페이스들의 `activeTeamCodesForWorkspaceSync` 합집합. `docs/design/dflow-minutes-upload-api-spec.md` 의 meta 절에 `user_email`(필수) 추가 + 변경 이력 한 줄. 테스트: 다른 워크스페이스 프로젝트가 응답에 없다.
- `api/v1/agent/me`: `agent_projects` 조회에 `.in('project_id', [...actor.projectWorkspace.keys()])`(PAT 소유자 `actorFromUser`) — 호출자가 볼 수 없는 프로젝트 제외.
- `api/v1/agent/watch`: 스펙 §4.2 가 짚은 누설은 "`agent_watchers` 에 워크스페이스 컬럼이 없다" 였고 Task 3 이 채웠다. 남는 무필터 쿼리는 7일 지난 행 GC(`delete().lt('last_seen_at', …)`) 하나 — 내용을 읽지 않는 전역 정리라 유지하고 감사표 근거에 적는다. `agent_watchers` 를 **읽는** `src/lib/data/agentHub.ts:40`·`src/lib/data/agentSeatmap.ts:64` 는 쿼리에 `project_id` 또는 `workspace_id` 필터가 있는지 확인해 없으면 `.eq('workspace_id', <화면의 워크스페이스>)` 를 더한다(있으면 `세션 가드 뒤 id 스코프` 로 분류).
- `actions/accounts.ts` `assertCanTouchAccount`(236~250): 대상 사용자의 관리자 여부를 **이 워크스페이스**로 — `workspace_members` 조회에 `.eq('workspace_id', workspaceId)`, `project_members` 조회에 `projects!inner(workspace_id)` + `.eq('projects.workspace_id', workspaceId)`(함수에 `workspaceId` 인자 추가, 호출부가 넘긴다).
- `actions/teams.ts` `listTeamsAdmin`: `const { admin } = adminFor({ workspaceId })`.
각 수정 파일이 더는 `createAdminClient` 를 직접 import 하지 않으면 표에서 빼고 "수정한 파일" 절에 적는다.
- [ ] **Step 5: 전체** — `npx vitest run --reporter=dot | tail -3 && npm run typecheck && npm run lint`.
- [ ] **Step 6: 커밋** — 변경 파일 명시 → `feat(admin): adminFor + service_role 63파일 감사표 + 스코프 불변식 — 워크스페이스를 넘던 조회 6곳을 좁힌다`.

### Task 13 (B2): 외부 API 판정을 `actorFromUser` + `roleIn` 으로(결정 8)

**Files:**
- Modify: `src/lib/agent/externalApi.ts`(`isAgentProjectMember`·`isAgentProjectAdmin`·`agentMemberRole`, `rosterAccessRole`·`platformAdmin` 삭제), `src/lib/minutes/externalApi.ts`(`isBatchAuthorized`), `src/app/api/v1/minutes/folder/route.ts:284`
- Test: `tests/agent/external-api-roles.test.ts`(신설 또는 기존 갱신), `tests/minutes/batch-authorized.test.ts`

**Interfaces:**
- 시그니처 불변(세 함수) — 호출부 무변경. `isBatchAuthorized(admin, userId, projectIds: string[]): Promise<boolean>`(인자 추가 — 호출 1곳).

- [ ] **Step 1: 테스트** — `vi.mock('@/lib/authz/buildActor')` 로 `buildActor` 가 돌려줄 Actor 를 주입(`actorFromUser` 는 `@/lib/authz` 가 아니라 `buildActor` 에 위임하므로 `@/lib/authz` 를 mock 하지 않는 테스트 파일에서): (a) 워크스페이스 관리자 + 명단 없음 → `isAgentProjectAdmin` true·`agentMemberRole` `'admin'`(승계 — 신규 동작), (b) 명단 member → member true·admin false, (c) 다른 워크스페이스 프로젝트 → member false·role null, (d) viewer(같은 워크스페이스, 명단 없음) → member false·role null, (e) `buildActor` throw → `isAgentProjectMember` false(fail-closed), `isAgentProjectAdmin` throw(현 계약 — 500), `agentMemberRole` null. `isBatchAuthorized`: 대상 프로젝트 둘 중 하나만 관리자면 false, 둘 다면 true, 빈 배열 false, 조회 실패 false.
- [ ] **Step 2: 실패 → 구현**

`@/lib/authz` 는 테스트 50파일이 통째로 mock 하는 모듈이라, 이 두 파일은 `actorFromUser` 대신 그 구현인 `buildActor`(`@/lib/authz/buildActor` — `actorFromUser` 가 그대로 위임한다)를 직접 import 한다. 판정은 같다.
```ts
// src/lib/agent/externalApi.ts
import { buildActor } from '@/lib/authz/buildActor'
import { roleIn, type EffectiveRole } from '@/lib/domain/authz'

/** actorFromUser 와 같은 조립(buildActor) + roleIn — 세션 경로와 한 판정(SP2 결정 8). 조회 실패는 throw. */
async function roleForAgent(admin: AdminClient, userId: string, projectId: string): Promise<EffectiveRole | null> {
  return roleIn(await buildActor(admin, userId), projectId)
}
export async function isAgentProjectMember(admin: AdminClient, userId: string, projectId: string): Promise<boolean> {
  try {
    const r = await roleForAgent(admin, userId, projectId)
    return r === 'superuser' || r === 'admin' || r === 'member'
  } catch (e) {
    console.error('[agent-api] 멤버 판정 조회 실패(거절):', e instanceof Error ? e.message : e)
    return false
  }
}
export async function isAgentProjectAdmin(admin: AdminClient, userId: string, projectId: string): Promise<boolean> {
  const r = await roleForAgent(admin, userId, projectId)   // throw → 라우트 try/catch 가 500(현 계약 유지)
  return r === 'superuser' || r === 'admin'
}
export async function agentMemberRole(admin: AdminClient, userId: string, projectId: string): Promise<'superuser' | 'admin' | 'member' | null> {
  try {
    const r = await roleForAgent(admin, userId, projectId)
    return r === 'viewer' ? null : r
  } catch (e) {
    console.error('[agent-api] 역할 조회 실패(거절):', e instanceof Error ? e.message : e)
    return null
  }
}
```
`platformAdmin`·`rosterAccessRole` 은 호출 0 이 되므로 지운다 — 83·114행의 역할 문자열 비교(M5)가 함께 사라진다. 헤더 주석의 "워크스페이스 관리자 승계 없음(SP7)" 문구를 "actorFromUser + roleIn — 세션 경로와 같은 판정(SP2 결정 8)" 으로.
```ts
// src/lib/minutes/externalApi.ts
export async function isBatchAuthorized(admin: AdminClient, userId: string, projectIds: string[]): Promise<boolean> {
  if (projectIds.length === 0) return false
  let actor
  try { actor = await buildActor(admin, userId) } catch (e) {
    console.error('[minutes-api] 등급 조회 실패(거절):', e instanceof Error ? e.message : e)
    return false
  }
  return projectIds.every((pid) => { const r = roleIn(actor, pid); return r === 'superuser' || r === 'admin' })
}
```
`api/v1/minutes/folder/route.ts:284`: 배치 대상 회의록들의 `project_id` 집합(무프로젝트 회의록은 그 `workspace_id` 의 워크스페이스 관리자 여부 — `isWorkspaceAdmin(actor, wid)`)을 먼저 모아 넘긴다. 무프로젝트 회의록이 섞이면 `isBatchAuthorized` 에 `workspaceIds` 도 받게 하지 말고, 라우트에서 `buildActor` 한 번으로 두 조건을 모두 판정하는 편이 단순하면 그렇게 하고 테스트를 맞춘다(선택을 보고서에).
- [ ] **Step 3: 통과·전체** — `npx vitest run tests/agent tests/minutes tests/api --reporter=dot | tail -3 && npm run typecheck`.
- [ ] **Step 4: 커밋** — `feat(api): 외부 API 역할 판정을 actorFromUser+roleIn 으로 — 워크스페이스 관리자 승계, 배치는 대상 프로젝트마다 관리자`.

### Task 14 (B2): `0008_workspace_settings.sql` + 초대 수락·허용 도메인·이월 가드

**Files:**
- Create: `supabase/migrations/0008_workspace_settings.sql`, `supabase/rollbacks/0008_workspace_settings_rollback.sql`, `supabase/rehearsal/0008_smoke.sql`, `tests/rls/workspace-settings.test.ts`
- Modify: `tests/rls/isolation-map.ts`(`workspace_settings: \`t.workspace_id = ${A}\``), `tests/rls/fixture-ws.sql`(`insert into public.workspace_settings (workspace_id, allowed_domains) values ('00000000-0000-0000-7e57-00000000aa01', array['example.com']) on conflict do nothing;`) — 새 RLS 표는 Task 1 의 전수 교차가 자동으로 잡으므로 판별식·A 행을 여기서 넣는다
- Modify: `src/app/actions/projectInvites.ts:205`, `src/app/actions/inviteRedeem.ts:35`, `src/lib/domain/invites.ts`(도메인 목록 결정 순수 함수), 관련 테스트

**Interfaces:**
- Produces(DB): 표 `workspace_settings(workspace_id uuid primary key references workspaces(id) on delete cascade, allowed_domains text[] not null default '{}', updated_at timestamptz not null default now())` — RLS 읽기 `is_ws_member(workspace_id)`, 쓰기 `is_ws_admin(workspace_id)`; `consume_project_invite` 가 비활성 인물·비활성 명단 행이면 `23514 INVITE_INACTIVE`; `project_invites_guard` 가 `created_by` 변경을 `23514 PROJECT_INVITE_CREATED_BY_IMMUTABLE` 로 거부; `workspace_members_keep_last_admin` 이 같은 워크스페이스 관리자 행을 `for update` 로 잠근다.
- Produces(TS): `resolveInviteDomains(workspaceDomains: string[] | null, envValue: string | undefined): string[]`(순수 — 워크스페이스 목록이 비어 있지 않으면 그것, 아니면 env).

- [ ] **Step 1: RLS 케이스 먼저 — `tests/rls/workspace-settings.test.ts`**: (a) A 멤버(cy) `workspace_settings(A)` 읽기 1·쓰기 42501, A 관리자(wsAdmin) upsert 성공, B 계정 읽기 0; (b) 초대 수락: 비활성 인물(`people.active=false`)의 이메일로 온 초대 → `consume_project_invite` 23514 `INVITE_INACTIVE`, 초대는 미소비; 명단 행 `active=false` 인 경우도 같음; 정상 수락은 `workspace_members` 에 member 행(이미 있으면 역할 유지 — 관리자였으면 admin 그대로); (c) `update project_invites set created_by = …` → 23514; (d) 마지막 관리자 강등 두 개를 한 트랜잭션에서 차례로(`update … set role='member'` 두 관리자) → 두 번째가 `WORKSPACE_LAST_ADMIN`(잠금 경로 확인은 스모크에서 두 세션으로).
Run → FAIL.
- [ ] **Step 2: 마이그레이션**

```sql
-- 0008_workspace_settings — SP2 Phase B2. 정본: SP2 스펙 §4.4. 레지스트리 일반화는 SP3.
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  allowed_domains text[] not null default '{}'
    check (array_position(allowed_domains, null) is null),
  updated_at timestamptz not null default now()
);
alter table public.workspace_settings enable row level security;
grant select, insert, update, delete on public.workspace_settings to authenticated, service_role;
create policy workspace_settings_read on public.workspace_settings for select to authenticated using (public.is_ws_member(workspace_id));
create policy workspace_settings_write on public.workspace_settings for all to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
```
`consume_project_invite`: `pg_get_functiondef` 원본을 `create or replace` 로 옮기고 두 곳을 바꾼다 — ① "비활성 인물을 다시 초대했으면 되살린다" 줄(`update public.people pe set active = true … where pe.id = v_person and not pe.active;`)을
```sql
  if exists (select 1 from public.people pe where pe.id = v_person and not pe.active) then
    raise exception using errcode = '23514', message = 'INVITE_INACTIVE';
  end if;
```
로, ② 기존 명단 행을 갱신하는 `update public.project_members pm set … active = true …` 앞에 같은 검사(`pm.active = false` 면 `INVITE_INACTIVE`)를 넣고 `active = true` 대입은 지운다. `split_part(v_email, '@', 1)` 두 곳을 `coalesce(nullif(split_part(v_email, '@', 1), ''), v_email)` 로('@' 폴백). `workspace_members` insert(64행)는 이미 있다 — 변경 없음(테스트로 고정).
`project_invites_guard`: 맨 앞에
```sql
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception using errcode = '23514', message = 'PROJECT_INVITE_CREATED_BY_IMMUTABLE';
  end if;
```
`workspace_members_keep_last_admin`: `if not exists (…)` 검사 앞에 `perform 1 from public.workspace_members m where m.workspace_id = old.workspace_id and m.role = 'admin' for update;`.
롤백: 표 drop, 세 함수 원본 본문 복원. 스모크: 표 권한·정책 존재, `INVITE_INACTIVE` 두 경우, `created_by` 불변, 그리고 두 psql 세션으로 동시 강등(한쪽 `begin; update … role='member' where user_id=a;` 대기, 다른 쪽 같은 워크스페이스의 b 강등 → 첫 세션 commit 뒤 두 번째가 `WORKSPACE_LAST_ADMIN`)을 손으로 확인하고 결과를 보고서에.
리허설: Task 7 Step 3 과 같은 절차(`--version 0006` 캡처 → 이 트랙 워크트리의 `db:reset` 은 0006+0008 만 적용하므로 기준도 0006) → diff 0.
- [ ] **Step 3: 마이그레이션 커밋(G1·G4)**

```bash
git add supabase/migrations/0008_workspace_settings.sql supabase/rollbacks/0008_workspace_settings_rollback.sql supabase/rehearsal/0008_smoke.sql
git commit -m "db: 0008 워크스페이스 설정 + 초대 수락의 비활성 재활성화 금지·created_by 불변·마지막 관리자 잠금

Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')"
```
그리고 `tests/rls/workspace-settings.test.ts`·`isolation-map.ts`·`fixture-ws.sql` 은 Step 6 의 테스트·코드 커밋에 넣는다(`npm run test:rls` 의 전수 교차가 `workspace_settings` 를 포함해 누설 0 인지 Step 5 에서 확인).
- [ ] **Step 4: 코드 — 허용 도메인** — `resolveInviteDomains` 순수 테스트(워크스페이스 목록 우선, 빈 배열이면 env, 둘 다 없으면 `[]`) → 구현. `projectInvites.ts:205`·`inviteRedeem.ts:35` 가 초대의 워크스페이스로 `workspace_settings` 를 읽고(admin, `.eq('workspace_id', wid).maybeSingle()`) — **조회 실패면 초대 발급·수락 중단**(보안 가드 fail-closed), 행 없음은 `null` → `resolveInviteDomains(row?.allowed_domains ?? null, process.env.INVITE_ALLOWED_DOMAINS)`. 수락 액션은 `INVITE_INACTIVE` 를 `'비활성화된 인원입니다. 관리자에게 명단 재활성화를 요청하세요.'` 로 매핑. `createAccount` 의 `p_member.active`(spec-2): 비활성 명단 행을 조용히 되살리지 않는지 확인 — 되살리는 분기가 있으면 같은 문구로 거부하고 테스트.
- [ ] **Step 5: 통과** — `npm run db:reset && npm run test:rls 2>&1 | tail -4 && npx vitest run tests/domain tests/actions --reporter=dot | tail -3 && npm run typecheck`.
- [ ] **Step 6: 테스트·코드 커밋** — `feat(invites): 허용 도메인을 워크스페이스 설정에서 읽고, 비활성 인원 초대는 재활성화 대신 거부한다`.

### Task 15 (B2): 이월 정리 — 명단 조회 실패 은폐 7곳·슈퍼유저 미존재 pid 404·역할 리터럴

**Files:**
- Modify: `src/lib/ai/knowledge.ts:41`, `src/app/(app)/minutes/[id]/page.tsx:47`, `src/app/(app)/p/[projectId]/{agents,attendance,wbs,meetings,issues}/page.tsx`, `src/lib/data/members.ts`(`getProjectMembers` 삭제), `src/app/(app)/p/[projectId]/layout.tsx`, `src/lib/domain/authz.ts`(`isHiddenProject`·`ACCESS_ROLE`), `src/app/(app)/admin/accounts/page.tsx:51-52`, `src/app/actions/accounts.ts:131,217`, `src/app/actions/projectInvites.ts:202`
- Test: `tests/domain/authz.test.ts`, 페이지·데이터 테스트(있으면 갱신)

**Interfaces:**
- Produces:
```ts
/** 레이아웃 404 판정 — 타 워크스페이스·미존재(roleIn null) 또는 플랫폼 관리자가 없는 pid 로 들어온 경우. */
export function isHiddenProject(actor: Actor | null, projectId: string): boolean
export const ACCESS_ROLE = { admin: 'admin', member: 'member' } as const
export const WORKSPACE_ROLE = { admin: 'admin', member: 'member' } as const
```

- [ ] **Step 1: 테스트** — `isHiddenProject`: 타 워크스페이스 true, 같은 워크스페이스 viewer false, 플랫폼 관리자 + `projectWorkspace` 에 없는 pid true(buildActor 는 플랫폼 관리자에게 전 프로젝트를 싣는다 — 없으면 미존재), 플랫폼 관리자 + 있는 pid false, `actor=null` true.
- [ ] **Step 2: 실패 → 구현**
```ts
export function isHiddenProject(actor: Actor | null, projectId: string): boolean {
  if (!actor) return true
  if (actor.isSuperuser) return !actor.projectWorkspace.has(projectId)
  return roleIn(actor, projectId) === null
}
```
`layout.tsx`: `if (!degraded && roleIn(actor, projectId) === null) notFound()` → `if (!degraded && isHiddenProject(actor, projectId)) notFound()`(레이아웃이 페이지 스트리밍보다 먼저 판정 — T11 C3).
명단 7곳: `getProjectMembers(pid)` → `getProjectRoster(pid)`(결과가 `{ ok, rows } | { ok: false, error }` 형이면 페이지는 실패 시 기존 오류 표시 컴포넌트로 사유를 그리고 `console.error`, `knowledge.ts` 는 챗봇 컨텍스트에 "명단 조회 실패" 를 명시하고 로그). 호출 0 이 되면 `getProjectMembers` 삭제(`git grep -n getProjectMembers src` 0건).
M5 리터럴: 나열된 5곳의 `'admin'`·`'member'` 역할 비교를 `ACCESS_ROLE.admin` 등으로(`wbs.ts:88-90` 은 이 목록 밖 — 손대지 않는다).
- [ ] **Step 3: 확인** — `npx vitest run --reporter=dot | tail -3 && npm run typecheck && npm run lint`. 로컬: 플랫폼 관리자로 `/p/00000000-0000-0000-0000-000000000000/wbs` → 404 화면(빈 페이지 아님).
- [ ] **Step 4: 커밋** — `fix: 명단 조회 실패를 빈 명단으로 삼던 7곳·플랫폼 관리자의 미존재 pid 빈 화면·역할 문자열 리터럴을 정리한다`.

---

## 통합·마무리

### Task 16: 통합 — B1·B2 머지 + 회의록 액션의 `resolveScope`·워크스페이스 팀 채택

브랜치: 컨트롤러가 `sp2/phase-b1`·`sp2/phase-b2` 를 `main` 에 반영(사람 확인)한 뒤 `main` 에서 `git switch -c sp2/phase-b-int`.

**Files:**
- Modify: `src/app/actions/minutes.ts`, `src/app/(app)/minutes/page.tsx`, `src/components/minutes/{MinutesView,MinutesExplorer}.tsx`(주석·prop 이름만)
- Test: `tests/actions/minutes-*.test.ts`(해당 액션의 가드 케이스)

**Interfaces:**
- Consumes: `resolveScope('minutes', id)`(Task 10), `hasProjectRoleInWorkspace`(Task 3), `isWorkspaceAdmin`, `activeTeamCodesForWorkspaceSync`(Task 12).

- [ ] **Step 1: 가드 테스트 먼저** — 무프로젝트 회의록(워크스페이스 A)에 대해: B 에만 역할이 있는 사용자의 수정·보관·폴더 이동 → `'권한 없음'`(또는 `ERR_MISSING`), A 에 역할이 있으면 통과. 회의록 id 해석 실패 → `ERR_LOOKUP` 중단.
- [ ] **Step 2: 구현** — `actions/minutes.ts` 에서 회의록 id 를 받는 액션(1173·1232행의 `hasAnyProjectRole` 판정 포함)이 `resolveScope('minutes', id)` 로 `{ projectId, workspaceId }` 를 얻고: 프로젝트가 있으면 `isProjectMember(actor, projectId)`, 없으면 `hasProjectRoleInWorkspace(actor, workspaceId)`(관리 동작은 `isWorkspaceAdmin`). 팀 코드 검증(169·267·342·486행의 `activeTeamCodesSync()`)을 대상 워크스페이스의 `activeTeamCodesForWorkspaceSync(workspaceId)` 로(프로젝트가 있으면 기존 `activeTeamCodesForProjectSync`). `minutes/page.tsx:70` 의 `canManage={isAnyProjectAdmin(m)} canEdit={hasAnyProjectRole(m)}` 는 목록 화면 어포던스 — SP3 전까지 유일 워크스페이스 기준 `isWorkspaceAdmin(m, ws)`·`hasProjectRoleInWorkspace(m, ws)`(`ws = resolveSoleWorkspaceId(m)`, 실패면 둘 다 false). `git grep -n "hasAnyProjectRole\|isAnyProjectAdmin" src/app/actions/minutes.ts` 0건.
- [ ] **Step 3: 전체** — `npm run typecheck && npm run lint && npx vitest run --reporter=dot | tail -3 && npm run db:reset && npm run test:rls 2>&1 | tail -4`.
- [ ] **Step 4: 커밋** — `feat(minutes): 회의록 액션이 resolveScope 로 대상 워크스페이스를 확정하고 그 워크스페이스 기준으로 판정한다`.

### Task 17: E2E 2-워크스페이스 시나리오 + 브라우저 눈확인 + 최종 게이트

**Files:**
- Modify: `scripts/e2e-local.mjs`, `scripts/lib/e2e.mjs`, `tests/scripts/e2e.test.ts`, `docs/baseline/sp2-e2e.md`, `CLAUDE.md`(권한 절 한 줄)

- [ ] **Step 1: E2E 단계 추가**(서버 액션 직접 호출 — 기존 `findActionId` 관례; `createProject`·`addTeam`·`createAccount` 새 인자 반영)
1. `other-workspace-fixture` 단계를 확장: service_role(로컬 전용 — 워크스페이스 생성 화면은 SP3)로 워크스페이스 B + B 관리자 계정 `e2e-bea@example.com`(비밀번호 env `E2E_B_PASSWORD`, 기본 `LocalDev!2026`) + B 프로젝트 1.
2. A 관리자(부트스트랩 계정 — 워크스페이스 A 관리자)가 `createProject(A, …)` 로 프로젝트 `E2E-A2` 생성 → 외부 이메일 `e2e-outsider@example.com` 초대(member) → 새 세션 가입·수락 → outsider 의 `workspace_members` 가 **A 하나뿐**(service_role 로 확인).
3. bea 로그인 → `GET /p/<E2E-A2 id>/wbs`·`/p/<A 프로젝트 id>` 가 not-found(`notFoundRendered`), `/minutes` 목록 HTML 에 A 회의록 제목이 없다.
4. 회의록 업로드(프로젝트 지정·미지정) 각 1건 → Storage 객체 이름이 `ws/<A>/p/…` 로 시작.
5. 외부 회의록 API: `GET /api/v1/minutes/meta?user_email=<A 관리자>` 의 `projects` 에 B 프로젝트가 없다.
각 단계 `summary.steps` 에 기록. 순수 헬퍼(입력 조립·경로 판정)는 `scripts/lib/e2e.mjs` + `tests/scripts/e2e.test.ts`.
- [ ] **Step 2: 실행**

```bash
npm run db:reset
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='LocalDev!2026' npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run dev      # run_in_background
BOOTSTRAP_PASSWORD='LocalDev!2026' node scripts/e2e-local.mjs > "$(mktemp -d)/e2e.json"
```
Expected: exit 0.
- [ ] **Step 3: 브라우저 눈확인(done_when 의 "스테이징 스모크" = 로컬 2-워크스페이스)** — 관리자(A)·bea(B) 두 브라우저: A 의 대시보드·WBS·회의록·이슈·공지·주간보고 화면이 오류 없이 뜨고, bea 는 A 프로젝트 URL 직접 입력 시 404, 사이드바 프로젝트 목록에 A 가 없다. presence: Task 9 판정이 A 면 두 세션 아바타 재확인. 스크린샷 경로·일시를 기록.
- [ ] **Step 4: 최종 게이트**

```bash
npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3 && npm run build 2>&1 | tail -2
npm run db:reset && npm run test:rls 2>&1 | tail -5
npx vitest run tests/invariants tests/authz/guard-signatures.test.ts
```
롤백 3개 카탈로그 대조(각각 직전 번호 기준):
```bash
D=$(mktemp -d)
supabase db reset --version 0007 && node supabase/rehearsal/compare-catalog.mjs capture "$D/r7"
npm run db:reset && docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0008_workspace_settings_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/b8" && node supabase/rehearsal/compare-catalog.mjs diff "$D/r7" "$D/b8"
supabase db reset --version 0006 && node supabase/rehearsal/compare-catalog.mjs capture "$D/r6"
supabase db reset --version 0007 && docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0007_storage_realtime_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/b7" && node supabase/rehearsal/compare-catalog.mjs diff "$D/r6" "$D/b7"
supabase db reset --version 0005 && node supabase/rehearsal/compare-catalog.mjs capture "$D/r5"
supabase db reset --version 0006 && docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0006_workspace_isolation_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/b6" && node supabase/rehearsal/compare-catalog.mjs diff "$D/r5" "$D/b6"
npm run db:reset
```
Expected: 전부 초록, diff 세 번 모두 "불일치 0". 성능: Task 4 의 측정을 HEAD 로 한 번 더(`--label sp2-final`) → `docs/baseline/sp2-perf.md` 에 행 추가, p95 비율 ≤ 1.20.
- [ ] **Step 5: 기록·커밋 → 컨트롤러가 최종 리뷰 → `main`·push(사람 확인)·CI → 태그 `sp2-done`**

`docs/baseline/sp2-e2e.md` 에 Phase B 절(E2E 단계표, 눈확인 일시·화면, R6 판정, 롤백 대조 3회, 성능 최종). `CLAUDE.md` 권한 절 끝에 한 줄: "워크스페이스 관리 가드는 `requireWorkspaceAdmin(wid)` — `requireSuperuser` 는 플랫폼 11곳(`tests/invariants/platform-guards.test.ts`)뿐이다. service_role 클라이언트를 새로 만들면 `docs/sp2-admin-client-audit.md` 에 분류를 적는다."
```bash
git add scripts/e2e-local.mjs scripts/lib/e2e.mjs tests/scripts/e2e.test.ts docs/baseline/sp2-e2e.md docs/baseline/sp2-perf.md CLAUDE.md
git commit -m "e2e(sp2): 2-워크스페이스 — 초대받은 외부 계정은 한 워크스페이스에만, B 계정의 A 프로젝트 URL 은 404

Preview-checked: local $(date '+%Y-%m-%d %H:%M') — 두 워크스페이스 계정으로 /p/[id]/{dashboard,wbs,weekly}, /minutes"
```

---

## 완료 조건 대조(스펙 §7)

| done_when | 태스크 |
|---|---|
| B 계정이 A 의 전 RLS 표 0행·쓰기 거부(CI `db` 잡) | 1(기록), 2(0 누설) |
| 3버킷·presence/broadcast 토픽 교차 | 7(①~④ Storage, ⑤⑥ presence, ⑦ broadcast) |
| Q2 — A 관리자가 A 비공개 읽기·쓰기, B 프로젝트 `roleIn === null` | 10(단위), 2 ⓐ·1(RLS) |
| 불변식: 개방 읽기 0(D2 1)·`app_role` 0·스코프 없는 admin 0·플랫폼 가드 11 | 4, 12, 11 |
| 로컬 E2E: 초대 외부 계정 한 워크스페이스, B 의 A URL 404 | 17 |
| presence `Preview-checked: local` | 9 |
| p95 +20% 이내(기록) | 4, 17 |
| 롤백 3개 catalog 0 mismatch | 2, 7, 14, 17 |

## 스펙 대조(절 → 태스크)

| 스펙 | 태스크 |
|---|---|
| §2.1 개방 읽기 40(39 교체 + D2) + notification_events·minute_favorites·change_logs | 2 Step 2 ③ |
| §2.2 app_role 9정책·`curate_wiki_item`·drop·prosrc 검사 | 2 Step 2 ④⑧ |
| §2.3 컬럼 5·백필(D3)·not null·FK·인덱스(D4)·트리거·M3·실행 권한(R3)·anon 쓰기·M1(R4)·M2 | 2 Step 2 ①②⑤⑦, Step 5 |
| §2.4 코드 쓰기 경로 | 3 |
| §2.5 롤백 + catalog | 2 Step 3·5 |
| §3.1 경로 규약·순수 함수·검증기 | 6, 8 |
| §3.2 SQL 헬퍼·3버킷 정책·옛 경로 거부 | 7 |
| §3.3 presence private·정책·`weekly-rows-*` | 7, 9 (postgres_changes 는 2 의 `weekly_report_rows_ws_read` 로) |
| §4.1 `requireWorkspaceAdmin`·`resolveScope`·`resolveScopeAdmin`·13/11 분류·쓰기 대상 워크스페이스 | 10, 11, 16 |
| §4.2 `adminFor`·감사표·불변식·경계 누설 6 | 12 |
| §4.3 외부 API 판정 통합 | 13 |
| §4.4 초대 수락·`workspace_settings`·초대 가드·`keep_last_admin` | 14 |
| §4.5 이월 | 15 |
| §5.1 tests/rls 픽스처·전수 교차·Storage·Realtime·service_role grant | 1, 2(ⓘ), 7, 14(새 표 등록) |
| §5.2 단위·정적 | 3, 4, 10, 11, 12 |
| §5.3 성능 | 4, 17 |
| §5.4 E2E·브라우저 | 17 |
