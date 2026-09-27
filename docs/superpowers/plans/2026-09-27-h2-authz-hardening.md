# H2 권한 하드닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** H1 뒤·SP3a 전에 남은 권한 경계 결함을 마이그레이션 하나(`0011_authz_hardening`)로 닫는다. 마지막 슈퍼유저가 사라지지 않고, 쓰지 않는 표 권한이 없고, 멤버가 공개 토큰을 읽지 못하고, 소속을 잃으면 권한도 잃고, 회의록 첨부의 SQL 판정·버킷 정책·삽입 가드가 앱 판정과 같아진다. H1 이 넘긴 둘(첨부 객체 존재 확인 RPC + 공용 삭제 도우미, 승인·반려의 보고 id 원자 대조)과 §8.1 #4 가 당긴 실적 100 잠금 절도 같은 파일에 넣는다. H1 최종 리뷰의 M5(회의 예외 이중 실패·내 회의 조회 실패의 빈 결과)는 부록 과제로 고친다.

**Architecture:** 판정은 여전히 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/**` 두 곳과 SQL 헬퍼다. SQL 은 `0011_authz_hardening.sql` 한 파일이고, 과제 6~15 가 작업 트리에서 절을 하나씩 **덧붙이며** 과제마다 `npm run db:reset` 과 누적 롤백 리허설로 검증한다. 커밋은 과제 16 이 한 번에 한다(마이그레이션 커밋 ② → RLS 테스트 커밋 ③). 그 전에 과제 1~5 가 0011 이 있든 없든 초록인 앱 코드를 커밋한다(①). 새 RPC 인자를 넘기는 코드는 0011 없이는 PostgREST 가 함수를 찾지 못하므로 ② 뒤의 과제 17(④)에 둔다. UI 위험 파일은 없다 — 전부 `main` 직행이다.

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17.6, RLS, plpgsql, Storage), vitest(+ `vitest.config.rls.ts` 의 pg 직결 하네스 `tests/rls/harness.ts`), TypeScript, 로컬 Supabase CLI 2.75 + colima, 카탈로그 대조 `supabase/rehearsal/compare-catalog.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` §6.2.0 "**H2 — 권한 하드닝(채택, G0-7)**" 블록(항목 a~i, 소유 파일 행, 커밋 행, done_when)이 정본이다. 함께 읽는 곳: §8.1 #4(WF-GAP-1·2 — 잠금 절과 `tests/rls/workflow-parity.test.ts`)와 그것이 가리키는 §3.3.5·§3.0, §8.2 ③(AUTH-11 예외)·④(`auth.users` 캐스케이드 면제), 원장 `.superpowers/review-triage/parts-7-8-synthesis.md` §1·§3, H1 최종 리뷰 `.superpowers/sdd/2026-09-27-post-sp2-hardening/final-review-data.md` M5, 프로젝트 규칙 `CLAUDE.md`(권한·데이터·git 운영·에러 처리 3원칙). 스펙의 줄 번호는 H1 뒤 어긋나 있다 — 이 계획의 줄 번호는 `bdbcfac` 기준 실측이다(끝의 Self-Review 5 에 대조표).

**컨트롤러 판정(구속 — 구현자가 바꾸지 않는다):**
- §8.1 #4 권고 채택: `guard_workflow_actual` 의 **잠금 절(첫 `raise`)만** 과 현행 고정 패리티 테스트 `tests/rls/workflow-parity.test.ts` 를 `0011` 에 넣는다. 단계 ≥ 2 절(`WORKFLOW_APPROVAL_REQUIRED`)은 SP5b 다.
- §8.2 ③: 무프로젝트 회의록의 워크스페이스 관리자 칸은 SQL(`can_manage_minute`)이 열고 앱(`canEditMinute`)이 닫는다. 패리티 표의 명시적 예외는 이 칸뿐이다.
- §8.2 ④: 마지막 슈퍼유저 가드는 `platform_admins` 에 직접 내린 DELETE·UPDATE 만 막고 `auth.users` 삭제의 캐스케이드는 통과시킨다(`scripts/dev-bootstrap.mjs:51-56` 의 실패 롤백).
- H1 판정 이월(세부는 이 계획이 정한다 — 아래 Interfaces): 승인 RPC 에 `p_expected_report_id` 를 더해 주문 행 잠금 아래에서 비교하고 승인·반려 둘 다 쓴다. SECURITY DEFINER 존재 확인 RPC 와 세 삭제 경로의 공용 삭제 도우미를 두고, 확인이 실패하면 행을 남긴다.

## Global Constraints

- **착수 조건:** `git merge-base --is-ancestor bdbcfac HEAD && echo ok` 가 `ok`(H1 완료). `ls supabase/migrations | tail -1` 이 `0010_issue_code_seq_width.sql` 이고 `0011_*` 가 없다. 로컬 DB 가 0010 이다: `docker exec supabase_db_d-flow psql -U postgres -Atc "select max(version) from supabase_migrations.schema_migrations"` → `0010`. 아니면 멈추고 보고한다.
- **작업 위치:** 컨트롤러가 준 체크아웃·브랜치에서만 일한다(`git branch --show-current` 가 `main` 또는 컨트롤러가 적어 준 이름). 이 리포에는 다른 에이전트가 쓰는 체크아웃(`g0/canonical-spec`)과 사용자·Codex 의 dirty 파일이 있을 수 있다 — **내 과제의 파일이 아니면 stage 하지 않는다.** 특히 `docs/superpowers/specs/2026-09-23-generic-platform-design.md`·`docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 는 건드리지 않는다. 워크트리를 쓰면 최대 1개, `node_modules`·`.env.local` 은 심볼릭 링크(`ln -s /Users/jerry/D-Flow/node_modules <wt>/node_modules`, `ln -s /Users/jerry/D-Flow/.env.local <wt>/.env.local`)로 두고 끝나면 `git worktree remove <wt>`.
- `git add -A`·`git add .`·`git add -p` 금지. 파일명을 명시해 stage 하고 커밋 전에 `git diff --cached --stat` 으로 내 파일만 들어갔는지 본다. `git push`·`git fetch`·`git stash`·`git reset`·`git tag`·`git switch`·`SKIP_GUARD` 금지 — 반영·push 는 컨트롤러가 사람 확인 뒤 한다. 셸에서 `cd X && a; b` 를 쓰지 않는다(명령은 `&&` 로만 잇거나 줄을 나눈다).
- **커밋 순서(스펙 §6.2.0 커밋 행 + 이 계획의 ④):**
  1. ① 앱 호환 코드 — 과제 1~5, 과제마다 커밋 하나. 0011 이 없어도 있어도 초록이어야 한다.
  2. ② 마이그레이션 — 과제 16 이 `supabase/migrations/0011_authz_hardening.sql` 과 `supabase/rollbacks/0011_authz_hardening_rollback.sql` **둘만** 담아 한 번 커밋한다(훅 G1). 트레일러 `Staging-verified: local db reset <YYYY-MM-DD HH:MM>`(훅 G4)는 트레일러 블록 안에서 `Co-Authored-By:` **바로 위 줄**(빈 줄 없이)에 둔다.
  3. ③ RLS 테스트 — 과제 16 이 과제 6~15 의 `tests/rls/**` 를 한 커밋으로.
  4. ④ 0011 뒤 코드 — 과제 17(RPC 새 인자). 부록 과제 18 은 0011 과 무관해 순서가 자유다.
  ①~④ 는 한 번에 push 된다(컨트롤러). ② 와 ④ 사이의 로컬 상태에서는 승인·반려가 보고가 있는 주문에서 `report_stale` 로 막힌다 — 이 사이에 앱을 쓰지 않는다.
- **0011 한 파일 쌓기:** 과제 6 이 두 파일을 만들고(머리 주석 + 롤백의 `begin;`/`commit;`), 과제 7~15 는 정방향 파일 **끝에** 자기 절을 덧붙이고 롤백 파일의 **`begin;` 바로 다음 줄에** 자기 절을 끼운다(그래서 롤백은 정방향의 역순이 된다). 과제 16 이 끝에 사후검증 절을 붙이고 커밋한다. 과제 6~16 사이에는 이 두 파일과 `tests/rls/**` 를 커밋하지 않는다 — 작업 트리에 남긴 채 다음 과제로 넘긴다(stash·reset 금지). 과제 사이에 파일을 잃으면 멈추고 보고한다.
- **SQL 과제의 순환:** 실패하는 RLS 테스트 먼저(`npm run test:rls -- tests/rls/<파일>` → FAIL) → 절 추가 → `npm run db:reset` → 같은 명령 PASS → `npm run test:rls 2>&1 | tail -4`(전체, 건너뜀 0) → **리허설 R** → `npm run dev:bootstrap`. 로컬 Supabase 스택은 하나다 — `db:reset`·`test:rls` 는 과제 간 동시에 돌리지 않는다.
- **리허설 R(과제 6~16 공통, 명령 전문):** 누적 0011 의 롤백이 0010 과 카탈로그·기본 권한까지 같아지고, 롤백한 DB 에 0011 을 다시 적용할 수 있는지 본다.
  ```bash
  D=$(mktemp -d)
  DEFACL="select defaclobjtype, defaclacl::text from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace order by 1"
  supabase db reset --version 0010
  node supabase/rehearsal/compare-catalog.mjs capture "$D/r10"
  docker exec supabase_db_d-flow psql -U postgres -At -c "$DEFACL" > "$D/r10.defacl"
  npm run db:reset
  node supabase/rehearsal/compare-catalog.mjs capture "$D/f11"
  docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0011_authz_hardening_rollback.sql
  node supabase/rehearsal/compare-catalog.mjs capture "$D/b11"
  node supabase/rehearsal/compare-catalog.mjs diff "$D/r10" "$D/b11"
  docker exec supabase_db_d-flow psql -U postgres -At -c "$DEFACL" > "$D/b11.defacl"
  diff "$D/r10.defacl" "$D/b11.defacl"
  docker exec -i supabase_db_d-flow psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 < supabase/migrations/0011_authz_hardening.sql
  node supabase/rehearsal/compare-catalog.mjs capture "$D/a11"
  node supabase/rehearsal/compare-catalog.mjs diff "$D/f11" "$D/a11"
  npm run db:reset
  ```
  Expected: 두 `diff` 가 `✓ 불일치 0`, `diff … .defacl` 출력 없음. 불일치가 함수 본문이면 롤백에 붙인 원문의 공백·줄바꿈이 원본과 다른 것이다. 불일치가 GRANT 줄이면 권한 복원 목록이 0010 과 다르다(열 단위 grant 는 `revoke (열)` 로 먼저 걷어야 한다).
- **`dev:bootstrap`:** `db:reset` 은 계정까지 지운다. `db:reset` 을 돌린 과제는 마지막에 `npm run dev:bootstrap` 을 한 번 돌린다. 환경 변수 `BOOTSTRAP_EMAIL`·`BOOTSTRAP_PASSWORD` 가 셸에 없으면 돌리지 말고 컨트롤러에게 요청한다. 값을 출력·파일·커밋·로그에 남기지 않는다(`echo`·`set -x`·`env |` 금지, 프롬프트에 타이핑하지 않는다).
- **새 함수의 실행 권한:** `postgres` 의 public 기본 권한(`pg_default_acl`, 함수 `f`)이 새 함수에 `authenticated` EXECUTE 를 준다. 새로 만드는 함수는 전부 `revoke all … from public, anon[, authenticated]` 와 필요한 `grant` 를 명시한다(트리거 함수는 셋 다 회수). `apply_workflow_event` 처럼 drop + create 하는 함수도 같다.
- **롤백의 함수 원문:** `create or replace` 로 바꾼 함수는 0010 상태의 원문을 파일에서 그대로 옮긴다(아래 과제마다 `sed -n` 범위를 준다 — 0004~0010 이 다시 정의하지 않았음을 확인했다). 카탈로그 대조가 본문 바이트를 비교하므로 공백을 바꾸지 않는다.
- `atomic` 으로 끝나는 식별자를 쓰지 않는다(CLI 2.75 문장 분할기 42601). 과제 16 이 `grep -niE "[a-z0-9_]*atomic\b" supabase/migrations/0011_authz_hardening.sql` 0건을 확인한다.
- 마이그레이션 파일에 `begin;`/`commit;` 을 쓰지 않는다(CLI 가 한 트랜잭션으로 적용). 롤백 파일은 `begin;`…`commit;` 으로 감싼다(0009·0010 관례).
- **UI 위험 파일(`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*`)은 이 계획 어디에서도 건드리지 않는다.** H2 항목 가운데 UI 위험 파일이 필요한 것은 없다. 범위 밖으로 남기는 것: §8.1 #23(산출물·이슈 첨부 서명 링크의 클릭 발급 전환, `RowDetailPanel.tsx`·이슈 첨부 패널 — UI 위험 아님)은 이 계획에 넣지 않았다 — SP5 MIN-ATT 또는 SPU3 가 첨부 패널을 만질 때 한다.
- **에러 처리 3원칙:** 조회 실패를 "데이터 없음"으로 위장하지 않는다(표시 = 로깅). 쓰기 전 선행 조회가 실패하면 중단한다. 보안 가드는 fail-closed. DB 오류 원문을 응답·토스트에 싣지 않는다(H1 `c276c67` 규칙 — 알려진 코드는 사용자 문구로, 모르는 것은 로그 + 일반 문구).
- service_role 클라이언트를 새 파일에서 만들면 `docs/sp2-admin-client-audit.md` 에 행을 더한다(이 계획은 새 파일에서 만들지 않는다. 과제 1 이 기존 행의 근거만 고친다).
- **범위 밖 — `supabase_admin` 의 public 기본 권한:** `pg_default_acl` 에는 `postgres` 항목과 별도로 `supabase_admin|public|r` 항목이 있어 `anon`·`authenticated` 에 `arwdDxtm` 을 준다. 0011 은 이 항목을 바꾸지 않는다. 이유: 마이그레이션을 돌리는 `postgres` 는 그 롤의 구성원이 아니라 `FOR ROLE supabase_admin` 으로 바꿀 수 없고(`pg_has_role('postgres','supabase_admin','member')` = f, `scripts/lib/baseline.mjs:30-33` 과 같은 사실), 마이그레이션은 `postgres` 로 표를 만들어 그 기본 권한을 받지 않는다. 과제 7 의 불변식·사후검증은 `postgres` 항목만 본다.
- **알려진 우회 — service_role 의 첨부 insert:** `minute_files` 에 `role = 'attachment'` 행을 service_role(auth.uid() null)로 넣으면 과제 13 의 가드를 건너뛴다(가드 ① 이 `can_manage_minute` 거짓 세션을 곧장 RLS 로 넘기는데 service_role 은 RLS 도 건너뛴다). 지금 그렇게 넣는 서버 경로는 없다(첨부 insert 는 `actions/minutes.ts` 의 세션 경로뿐, 회의록 RPC 는 `role = 'body'` 만 쓴다). SP5 MIN-ATT 가 서버 경로로 첨부를 넣게 되면 그 경로를 이 가드 또는 같은 검사(경로·객체 소유·메타데이터 크기·형식·중복·개수)를 거치게 해야 한다.
- 새 코드·픽스처·문구에 고객명·실명·구 브랜드를 쓰지 않는다. 예시는 `Acme`·`alice`·`example.com` 류. 픽스처 id 는 `00000000-0000-0000-7e57-0000000012NN`(이 계획 전용 범위)을 쓴다.
- 커밋 메시지는 한국어, "무엇"보다 "왜". 모든 커밋은 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 로 끝난다.
- 각 과제의 마지막 검증: `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3`. SQL 과제는 위 순환을 더한다. 실패를 단언 완화로 덮지 않는다.

## Review Focus

스펙이 암시하지만 스펙의 done_when·과제 테스트가 아직 덮지 않던 입력·실패 가운데 사람을 가장 먼저 다치게 할 다섯이다. 각 줄의 테스트는 해당 과제에 넣었다.

1. **회의록을 다른 프로젝트로 옮긴 뒤 옛 경로의 첨부를 지운다.** 파일 경로의 프로젝트 세그먼트는 옛 값으로 남는다. 관리 권한자(새 프로젝트의 작성자·관리자)는 지울 수 있어야 하고, 옛 프로젝트에만 권한이 있는 사람은 지우지 못해야 한다. → 과제 12 "이동한 회의록" 케이스.
2. **두 창에서 같은 회의록에 동시에 첨부를 확정한다.** 개수 검사가 서로의 미커밋 행을 못 보면 11개가 된다. 가드는 회의록 행 잠금으로 직렬화해야 한다 — 뒤 연결은 앞 연결이 끝날 때까지 기다린다. → 과제 13 "두 연결" 케이스(`lock_timeout` 으로 대기를 관측).
3. **계정 삭제(`auth.users`)의 캐스케이드가 새 트리거에 막히지 않는다.** 계정 생성 보상 롤백(`accounts.ts:121-127` `rollbackAccount`, `inviteRedeem.ts` 보상, dev-bootstrap)은 워크스페이스 소속·명단 권한이 있는 계정을 지운다. 소속 회수 트리거 → 명단 갱신 → `project_members_guard`·`no_self_demote` 사슬이 오류를 내면 유령 계정이 남는다. → 과제 9 "새 계정 삭제" 케이스.
4. **업로드한 뒤 확정이 거부되거나 회의록이 보관되면, 올린 사람이 방금 올린 객체를 지운다(보상 삭제).** 관리 권한이 사라진 뒤에도 "소유자 ∧ 미참조" 로 지울 수 있어야 하고, 이미 행이 참조하는 객체는 소유자라도 관리 권한 없이는 못 지워야 한다. 워크스페이스를 떠난 소유자에게는 RLS 가 참조 행을 가려 '미참조'로 오판할 수 있으므로 소속도 요구한다. → 과제 12 "보상 삭제" 케이스.
5. **공유 토큰 열 권한을 걷은 뒤 회의록 목록·상세·내보내기·AI 답변이 42501 로 깨지지 않는다.** 세션이 `minutes` 를 `*` 로 읽거나 임베드 `minutes(*)` 를 쓰는 곳이 하나라도 있으면 그 화면 전체가 실패한다. → 과제 1 불변식 테스트(`tests/invariants/minutes-select-columns.test.ts`) + 과제 8 의 "다른 표 정책이 minutes 를 읽어도" 케이스.

## File Structure

| 파일 | 책임 | 과제 |
|---|---|---|
| `src/app/actions/minutes.ts`(`readShareRow`·`getMinuteShare`·`setMinuteShare` :1419-1456), `docs/sp2-admin-client-audit.md`(:29 근거), `tests/actions/minutes-workspace-scope.test.ts`(`fakeClient` 가 select 문자열을 기록), `tests/invariants/minutes-select-columns.test.ts`(신설) | 공유 토큰은 판정 뒤 service_role 로만 읽는다(c 의 코드 먼저) | 1 |
| `src/app/actions/accounts.ts`(`setPlatformAdmin` :317-352), `tests/actions/accounts-gate.test.ts`(:473-516) | 마지막 슈퍼유저 판정을 DB 로, `PLATFORM_LAST_ADMIN` 문구(a 의 코드) | 2 |
| `src/lib/authz/buildActor.ts`(:54-57), `tests/authz/guards.test.ts` | 소속 워크스페이스 밖 명단 행을 버린다(d 의 코드) | 3 |
| `src/lib/attachments/removeStoredAttachment.ts`(신설), `src/app/actions/attachments.ts`(`removeAttachment` :139-166), `src/app/actions/issueAttachments.ts`(`removeIssueAttachment` :169-203), `src/app/actions/minutes.ts`(`removeMinuteFile` :791-821), `tests/lib/remove-stored-attachment.test.ts`(신설), `tests/actions/issue-attachments-gate.test.ts`, `tests/actions/minutes-workspace-scope.test.ts` | 세 삭제 경로의 공용 도우미 + 존재 확인 RPC 호출(g 보강의 코드) | 4 |
| `src/app/actions/minutes.ts`(`recordMinuteFile` :717-789), `src/app/actions/wbs.ts`(`updateActual` :142-176), `tests/actions/minutes-file-path.test.ts`, `tests/actions/wbs-update-actual-lock.test.ts` | DB 가드 사유(첨부 가드·실적 잠금)를 사용자 문구로 | 5 |
| `supabase/migrations/0011_authz_hardening.sql`, `supabase/rollbacks/0011_authz_hardening_rollback.sql` | 0011 — 과제 6~15 가 절을 쌓고 16 이 커밋 | 6~16 |
| `tests/rls/h2-platform-admins.test.ts` | a | 6 |
| `tests/rls/h2-table-grants.test.ts` | b | 7 |
| `tests/rls/h2-share-token.test.ts` | c | 8 |
| `tests/rls/h2-membership.test.ts` | d | 9 |
| `tests/rls/h2-access-granted.test.ts` | e | 10 |
| `tests/rls/h2-actor.ts`(신설 — `buildActor` 의 SQL 판), `tests/rls/h2-minute-manage-parity.test.ts`, `tests/rls/schema-invariants.test.ts`(:118-167 목록) | f | 11 |
| `tests/rls/h2-minute-bucket.test.ts`, `tests/rls/schema-invariants.test.ts`(:154-167 목록) | g | 12 |
| `tests/rls/h2-attachment-guard.test.ts`, `tests/rls/storage-realtime.test.ts`(⑪ :255-277) | h | 13 |
| `tests/rls/h2-report-stale.test.ts` | i | 14 |
| `tests/rls/workflow-parity.test.ts` | WF-GAP-1 잠금 절 + WF-GAP-2 현행 패리티 | 15 |
| `src/lib/agent/workflowEvent.ts`, `src/app/actions/agentWork.ts`(:246-296), `tests/agent/workflow-event.test.ts`, `tests/agent/approval-stale.test.ts` | 승인·반려가 본 보고 id 를 RPC 에 넘긴다(i 의 코드) | 17 |
| `src/lib/data/meetings.ts`(:59-70, :107-128, :189-236), `src/app/actions/meetings.ts`(:284-292), `src/app/(app)/meetings/page.tsx`, `src/components/meetings/MyMeetingsView.tsx`, `tests/lib/meetings-exception-embed.test.ts`, `tests/ui/my-meetings-load-error.test.tsx`(신설), `tests/ui/meetings-project-chips.test.tsx`·`tests/ui/deep-link-params.test.tsx`(목 반환형) | M5 — 회의 예외·내 회의 조회 실패를 드러낸다 | 18 |

`tests/rls/fixture-ws.sql` 은 바꾸지 않는다 — 스펙 §2.11 H2 행은 `:133-135` 의 첨부 행이 새 가드에 걸린다고 적었지만, 가드는 스펙 순서대로 `can_manage_minute` 가 거짓인 세션을 곧장 RLS 로 넘기고 픽스처는 `postgres`(auth.uid() null → 거짓)로 들어가므로 가드를 타지 않는다(과제 13 이 이 동작을 고정한다). 버킷 정책은 `storage.objects` 에만 걸리고 픽스처는 객체를 만들지 않는다.

## 의존 순서

| 단계 | 과제 | 크기 | 선행 | 커밋 |
|---|---|---|---|---|
| ① | 1 공유 토큰 서버 경로 | S | H1 | 과제 안 |
| ① | 2 마지막 슈퍼유저 문구 | S | H1 | 과제 안 |
| ① | 3 buildActor 소속 밖 명단 | S | H1 | 과제 안 |
| ① | 4 첨부 삭제 공용 도우미 | M | 1(`actions/minutes.ts`·`minutes-workspace-scope.test.ts`) | 과제 안 |
| ① | 5 DB 가드 사유 문구 | S | 4(`actions/minutes.ts`) | 과제 안 |
| ② | 6 a 마지막 슈퍼유저(파일 생성) | M | 1~5 커밋 | 16 |
| ② | 7 b 표 권한 | M | 6 | 16 |
| ② | 8 c share_token 열 | S | 7 | 16 |
| ② | 9 d 소속 회수 | L | 8 | 16 |
| ② | 10 e access_granted | S | 9 | 16 |
| ② | 11 f can_manage_minute | M | 10, 3(규칙 미러) | 16 |
| ② | 12 g 버킷 정책 + 존재 확인 RPC | L | 11, 4(RPC 이름) | 16 |
| ② | 13 h 첨부 가드 | L | 12, 5(사유 코드) | 16 |
| ② | 14 i 보고 id 대조 | M | 13 | 16 |
| ② | 15 WF-GAP 잠금 절 + 패리티 | M | 14, 5(사유 코드) | 16 |
| ②③ | 16 사후검증·리허설·커밋 | M | 6~15 | ②·③ |
| ④ | 17 승인·반려 RPC 인자 | S | 16 | 과제 안 |
| 부록 | 18 M5 회의 조회 실패 | M | 없음(0011 무관) | 과제 안 |

과제 6~15 는 한 파일을 쌓으므로 **엄격히 순서대로** 한다. 과제 18 은 어느 때든 되지만 로컬 DB 를 쓰지 않으므로 SQL 과제와 병렬로 돌려도 된다(같은 체크아웃에서 동시에 파일을 고치지 않는다).

---

## 1단계 — 앱 호환 코드(커밋 ①)

### Task 1: 공유 토큰은 판정 뒤 서버 경로로만 읽는다 (H2-c 의 코드 먼저)

항목: AUTH-10a(코드 절반). UI 위험 파일 없음. 마이그레이션 없음.

결함: `readShareRow`(`src/app/actions/minutes.ts:1421-1429`)는 `checkOwner` 의 세션 조회에 `share_token, share_enabled` 를 실어 읽는다. 과제 8 이 `minutes` 의 표 SELECT 를 걷고 `share_token` 을 뺀 열에만 grant 하면 이 조회가 42501 이 된다. 토큰은 판정을 통과한 뒤 service_role 로 그 행 하나만 읽는다. 같은 함수 옆 `setMinuteShare`(:1441-1456)는 저장 실패의 DB 문구를 그대로 돌려준다(`:1453` — H1 `c276c67` 규칙 위반) — 같은 곳을 만지므로 함께 고친다. Review Focus 5 의 불변식(세션이 `minutes` 를 `*` 로 읽지 않는다)을 여기 둔다.

**Files:**
- Modify: `src/app/actions/minutes.ts:1419-1456`, `docs/sp2-admin-client-audit.md:29`(근거 문구)
- Modify(test): `tests/actions/minutes-workspace-scope.test.ts`(`fakeClient` :98-130 이 select 문자열을 기록)
- Create(test): `tests/invariants/minutes-select-columns.test.ts`

**Interfaces:**
- Consumes: `checkOwner(sb, minuteId, actor, opts)`(:125-148), `adminOr(fallback)`(:179-185) — 둘 다 그대로.
- Produces: `readShareRow(sb, id, actor): Promise<{ state: ShareState; admin: ReturnType<typeof createAdminClient> } | { error: string }>` — 모듈 내부. `getMinuteShare`·`setMinuteShare` 의 공개 시그니처는 그대로다. 오류 문구 `ERR_SHARE_LOOKUP = '공유 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'`, `ERR_SHARE_SAVE = '공유 설정을 저장하지 못했습니다.'`(모듈 내부 상수).
- 과제 8 이 기대하는 것: `src/**` 에서 `share_token` 을 읽는 코드는 `src/app/actions/minutes.ts`(service_role)와 `src/app/share/minutes/[token]/page.tsx`(service_role) 둘뿐이다.

- [ ] **Step 0: 착수 확인** — Global Constraints 의 착수 조건. `grep -rn "share_token" src` 결과를 적어 둔다(`actions/minutes.ts:1424,1427,1452`, `share/minutes/[token]/page.tsx:24` 이어야 한다).

- [ ] **Step 1: `fakeClient` 가 select 문자열을 기록하게 한다** (`tests/actions/minutes-workspace-scope.test.ts:98-130`)

`from` 안의 메서드 루프를 다음으로 바꾸고, 반환 객체에 `selects` 를 더한다(기존 케이스는 그대로 통과해야 한다).
```ts
  const selects: Record<string, string[]> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const result = next(table)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'maybeSingle', 'single']) {
      b[m] = vi.fn((...args: unknown[]) => {
        log.push(m)
        if (m === 'select') (selects[table] ??= []).push(String(args[0] ?? ''))
        return b
      })
    }
    ;(b as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(result)
    return b
  })
  // …
  return { client: { from, storage: { from: vi.fn(bucketOf) } }, calls, storageCalls, selects }
```

- [ ] **Step 2: 실패하는 테스트 — 공유 상태** (같은 파일 끝에 describe 추가)

```ts
describe('공유 상태 — share_token 은 세션으로 읽지 않는다(H2-c 앱 호환, 0011 이 열 권한을 걷는다)', () => {
  const TOKEN = '11111111-2222-4333-8444-555555555555'
  const shareRow = { data: { share_token: TOKEN, share_enabled: true }, error: null }

  it('getMinuteShare: 세션 조회에는 share_token 이 없고, 판정을 통과한 뒤 service_role 로 그 행만 읽는다', async () => {
    const db = fakeClient({ minutes: { data: minuteRow(), error: null } })
    createServerClient.mockResolvedValue(db.client)
    const adm = fakeClient({ minutes: shareRow })
    mocks.createAdminClient.mockReturnValue(adm.client)
    getActor.mockResolvedValue(inA)
    expect(await getMinuteShare(M)).toEqual({ ok: true, enabled: true, token: TOKEN })
    expect((db.selects.minutes ?? []).join(' | ')).not.toContain('share_token')
    expect(adm.selects.minutes).toEqual(['share_token, share_enabled'])
  })

  it('판정에서 막히면 service_role 을 만들지 않는다', async () => {
    createServerClient.mockResolvedValue(fakeClient({ minutes: { data: minuteRow(), error: null } }).client)
    getActor.mockResolvedValue(onlyInB)
    expect(await getMinuteShare(M)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('service_role 조회가 실패하거나 0행이면 공유 상태를 모른다 — 거부하고 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const res of [{ data: null, error: { message: 'db down' } }, { data: null, error: null }]) {
      createServerClient.mockResolvedValue(fakeClient({ minutes: { data: minuteRow(), error: null } }).client)
      mocks.createAdminClient.mockReturnValue(fakeClient({ minutes: res }).client)
      getActor.mockResolvedValue(inA)
      expect(await getMinuteShare(M)).toEqual({ ok: false, error: '공유 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.' })
    }
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('setMinuteShare: 저장 실패의 DB 문구를 응답에 싣지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createServerClient.mockResolvedValue(fakeClient({ minutes: { data: minuteRow(), error: null } }).client)
    mocks.createAdminClient.mockReturnValue(fakeClient({ minutes: [shareRow, { data: null, error: { message: 'db boom' } }] }).client)
    getActor.mockResolvedValue(inA)
    expect(await setMinuteShare(M, 'enable' as never)).toEqual({ ok: false, error: '공유 설정을 저장하지 못했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```
파일 머리의 import 에 `getMinuteShare` 를 더한다(`@/app/actions/minutes` 묶음). `mocks.createAdminClient` 의 기본 구현이 `ADMIN_REACHED` 를 던지게 돼 있다면 이 describe 의 `beforeEach` 에서 `mocks.createAdminClient.mockReset()` 을 부른다.

- [ ] **Step 3: 실패하는 테스트 — 불변식** (`tests/invariants/minutes-select-columns.test.ts`)

```ts
// 0011(H2-c)은 minutes 의 표 SELECT 를 걷고 share_token 을 뺀 열에만 준다. 세션이 minutes 를 '*' 로 읽거나 임베드 minutes(*) 를 쓰면
// 그 쿼리 전체가 42501 이다(목록·상세·내보내기·AI 답변이 통째로 실패). 토큰은 서버 경로 둘만 읽는다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
/** .from('minutes') 바로 뒤 첫 .select( 의 리터럴 인자 — 인자 없음(= *)도 잡는다 */
const DIRECT = /\.from\((['"])minutes\1\)\s*\.select\(\s*(\)|(['"`])([^'"`]*)\3)/g
/** PostgREST 임베드 minutes(*)·minutes!inner(*) */
const EMBED = /\bminutes(!\w+)?\(\s*\*\s*\)/

export function starReads(text: string): string[] {
  const hits: string[] = []
  for (const m of text.matchAll(DIRECT)) if (m[2] === ')' || (m[4] ?? '').includes('*')) hits.push(m[0])
  if (EMBED.test(text)) hits.push(text.match(EMBED)![0])
  return hits
}

describe('minutes 열 단위 SELECT(H2-c) — 세션 쿼리가 * 로 읽지 않는다', () => {
  it('src 에 minutes 를 * 로 읽는 곳이 없다(표 직접·임베드)', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const text = codeLines(readFileSync(file, 'utf8')).join('\n')
      for (const h of starReads(text)) hits.push(`${relative(process.cwd(), file)}: ${h}`)
    }
    expect(hits).toEqual([])
  })

  it('민감도 — 검사식이 * 읽기를 잡는다', () => {
    expect(starReads(`sb.from('minutes').select('*').eq('id', x)`)).toHaveLength(1)
    expect(starReads(`sb.from('minutes')\n  .select()`)).toHaveLength(1)
    expect(starReads(`sb.from('files').select('id, minutes(*)')`)).toHaveLength(1)
    expect(starReads(`sb.from('minutes').select('id, title')`)).toEqual([])
    expect(starReads('sb.from(\'minutes\').select(`${COLS}, body_md`)')).toEqual([])
  })

  it('share_token 을 읽는 코드는 서버 경로 둘뿐이다(readShareRow 의 service_role, 공개 페이지)', () => {
    const files = walk(ROOT)
      .filter((f) => codeLines(readFileSync(f, 'utf8')).some((l) => l.includes('share_token')))
      .map((f) => relative(process.cwd(), f)).sort()
    expect(files).toEqual(['src/app/actions/minutes.ts', 'src/app/share/minutes/[token]/page.tsx'])
  })
})
```

- [ ] **Step 4: 실패 확인** — `npx vitest run tests/actions/minutes-workspace-scope.test.ts tests/invariants/minutes-select-columns.test.ts` → 공유 상태 첫 케이스가 FAIL(세션 select 에 `share_token` 이 있다), `setMinuteShare` 케이스가 FAIL(`db boom` 이 응답에 실린다). 불변식 세 케이스는 이미 통과할 수 있다 — 그것이 정상이다(현재 코드가 규칙을 지키고 있음을 고정한다).

- [ ] **Step 5: 구현** (`src/app/actions/minutes.ts:1419-1456` 를 교체)

```ts
export interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string }

const ERR_SHARE_LOOKUP = '공유 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_SHARE_SAVE = '공유 설정을 저장하지 못했습니다.'

/** 소유자/관리자 검증 + 공유 컬럼 조회 — get/set 공용(소유권 규칙 한 곳). 판정은 checkOwner 그대로다(resolveScope 범위의
 *  canEditMinute) — 미지정(project_id null) 회의록은 작성자 본인 또는 슈퍼유저만.
 *  share_token 은 세션이 읽지 못한다(0011 H2-c — minutes 는 share_token 을 뺀 열 단위 SELECT). 판정을 통과한 뒤 service_role 로
 *  그 회의록 id 한 행만 읽는다. 조회 실패·0행은 공유 상태를 모른다는 뜻이라 거부한다(fail-closed). */
async function readShareRow(sb: Sb, id: string, actor: Actor):
  Promise<{ state: ShareState; admin: ReturnType<typeof createAdminClient> } | { error: string }> {
  const own = await checkOwner(sb, id, actor, { archivedError: '보관된 회의록은 공유 설정을 바꿀 수 없습니다.' })
  if (!own.ok) return { error: own.error }
  const adm = adminOr('공유 설정을 확인하세요.')
  if ('error' in adm) return { error: adm.error }
  const { data, error } = await adm.admin.from('minutes').select('share_token, share_enabled').eq('id', id).maybeSingle()
  if (error || !data) {
    console.error('[readShareRow] 공유 상태 조회 실패:', error?.message ?? '0행')
    return { error: ERR_SHARE_LOOKUP }
  }
  const row = data as { share_token: string | null; share_enabled: boolean | null }
  return { state: { token: row.share_token ?? null, enabled: !!row.share_enabled }, admin: adm.admin }
}

/** 공유 상태 조회 — 토큰은 이 액션으로만 클라이언트에 전달(페이지 payload 미포함, 소유자/관리자 한정). */
export async function getMinuteShare(id: string): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return { ok: false, error: row.error }
  return { ok: true, enabled: row.state.enabled, token: row.state.token }
}

/** 공유 토글/재발급 — 서버에서 소유권을 확인한 뒤 service role로 허용 컬럼만 쓴다. */
export async function setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return { ok: false, error: row.error }
  const next = nextShareState(row.state, op, crypto.randomUUID())
  const { error } = await row.admin.from('minutes')
    .update({ share_token: next.token, share_enabled: next.enabled }).eq('id', id)
  if (error) {
    console.error('[setMinuteShare] 공유 설정 저장 실패:', error.message)
    return { ok: false, error: ERR_SHARE_SAVE }
  }
  return { ok: true, enabled: next.enabled, token: next.token }
}
```
`docs/sp2-admin-client-audit.md:29` 의 근거 끝 "공유를 쓴다" 를 "공유 토큰을 읽고 쓴다(0011 뒤 세션은 share_token 열을 읽지 못한다)" 로 바꾼다(분류는 그대로 `세션 가드 뒤 id 스코프`).

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/actions tests/invariants tests/minutes --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "share_token" src` 가 Step 0 과 같은 두 파일만 가리킨다.

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/minutes.ts docs/sp2-admin-client-audit.md tests/actions/minutes-workspace-scope.test.ts tests/invariants/minutes-select-columns.test.ts
git commit -m "fix(minutes): 공유 토큰은 판정 뒤 service_role 로만 읽는다 — 0011 의 열 권한 회수 전에 앱을 맞춘다

minutes_ws_read 가 행 전체를 열어 회의록을 읽는 멤버가 공개 토큰까지 읽었다(편집자 전용 공개 게이트 우회, AUTH-10a).
0011 이 share_token 을 뺀 열에만 SELECT 를 주면 소유권 조회에 실어 읽던 토큰이 42501 이 되므로, 판정(checkOwner)을
통과한 뒤 service_role 로 그 행 하나만 읽는다. 저장 실패의 DB 문구는 응답에서 뺀다. 세션이 minutes 를 * 로 읽지 않는다는
불변식을 둔다 — 하나라도 있으면 0011 뒤 그 화면이 통째로 실패한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: 마지막 슈퍼유저 판정은 DB 가 한다 — `PLATFORM_LAST_ADMIN` 을 사용자 문구로 (H2-a 의 코드)

항목: AUTH-04(코드 절반). UI 위험 파일 없음.

결함: `setPlatformAdmin`(`src/app/actions/accounts.ts:317-352`)이 해제 전에 목록을 세고(:325-334) 그다음 지운다. 두 슈퍼유저가 서로를 동시에 해제하면 둘 다 "2명"을 보고 통과해 0명이 된다. 경합에 안전한 쪽은 DB 트리거(과제 6 `platform_admins_keep_last`)다 — `setWorkspaceRole` 의 `WORKSPACE_LAST_ADMIN` 관례(:357-384)처럼 앱은 세지 않고 DB 오류를 문구로 옮긴다. 0행 삭제(이미 슈퍼유저가 아님)를 성공으로 보고하지 않는다(같은 파일 `setWorkspaceRole` 관례).

과제 6 전(이 커밋만 있는 로컬 상태)에는 마지막 1명 해제가 막히지 않는다. 원격이 없고 ①~④ 가 함께 push 되므로 이 창은 운영에 닿지 않는다.

**Files:**
- Modify: `src/app/actions/accounts.ts:313-352`
- Modify(test): `tests/actions/accounts-gate.test.ts:473-516`

**Interfaces:**
- Consumes: 과제 6 의 DB 오류 `{ code: '23514', message: 'PLATFORM_LAST_ADMIN' }`.
- Produces: `setPlatformAdmin(userId, value)` 시그니처 그대로. 문구: 마지막 1명 `'마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.'`(기존 문구 유지), 0행 `'슈퍼유저가 아닌 계정입니다.'`.

- [ ] **Step 1: 실패하는 테스트** — `describe('setPlatformAdmin — 마지막 관리자 보호')`(:473-516)를 다음으로 바꾼다.

```ts
describe('setPlatformAdmin — 마지막 관리자 보호(DB 트리거 platform_admins_keep_last, 0011)', () => {
  beforeEach(() => { requireSuperuser.mockResolvedValue({ ok: true, actor: SU }) })

  it('마지막 슈퍼유저 해제는 트리거가 거부한다 — 사용자 문구로, 앱은 미리 세지 않는다', async () => {
    const q = chain({ data: null, error: { code: '23514', message: 'PLATFORM_LAST_ADMIN' } })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    expect(await setPlatformAdmin('u1', false))
      .toEqual({ ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' })
    expect(q.delete).toHaveBeenCalledTimes(1)
    expect(q.eq).toHaveBeenCalledWith('user_id', 'u1')
    // 사전 목록 조회(select 만 하고 delete 없는 체인)가 없다
    expect(q.select).toHaveBeenCalledWith('user_id')
    expect(q.select).toHaveBeenCalledTimes(1)
  })

  it('그 밖의 삭제 오류는 원문을 싣지 않는다 — 로그만', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createAdminClient.mockReturnValue({ from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never)
    expect(await setPlatformAdmin('u1', false)).toEqual({ ok: false, error: '슈퍼유저를 해제하지 못했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('0행(이미 슈퍼유저가 아님)은 성공으로 위장하지 않는다', async () => {
    createAdminClient.mockReturnValue({ from: vi.fn(() => chain({ data: [], error: null })) } as never)
    expect(await setPlatformAdmin('u9', false)).toEqual({ ok: false, error: '슈퍼유저가 아닌 계정입니다.' })
  })

  it('본인 해제는 거부한다 — 조회·쓰기 없이(다른 슈퍼유저가 해야 한다)', async () => {
    const res = await setPlatformAdmin('u-su', false)
    expect(res).toEqual({ ok: false, error: '본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('다른 사람 해제 — 지워진 행을 돌려받으면 성공', async () => {
    const q = chain({ data: [{ user_id: 'u1' }], error: null })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    expect(await setPlatformAdmin('u1', false)).toEqual({ ok: true })
    expect(q.delete).toHaveBeenCalled()
  })

  it('지정은 발급자를 남기고 이미 있으면 그대로 둔다', async () => {
    const q = chain({ error: null })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    expect(await setPlatformAdmin('u2', true)).toEqual({ ok: true })
    expect(q.upsert).toHaveBeenCalledWith({ user_id: 'u2', granted_by: 'u-su' }, { onConflict: 'user_id', ignoreDuplicates: true })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/actions/accounts-gate.test.ts` → 첫 케이스(사전 목록이 트리거 오류 대신 판정)·셋째(0행 성공)가 FAIL.

- [ ] **Step 3: 구현** — `accounts.ts` 의 머리 주석(:313-316)과 해제 분기(:324-340)를 바꾼다.

```ts
/**
 * 플랫폼 관리자(슈퍼유저) 지정·해제. 마지막 한 명은 해제하지 못한다 — 판정은 DB 트리거(platform_admins_keep_last, 0011)가
 * advisory 잠금 아래에서 한다. 앱이 먼저 세면 두 슈퍼유저가 서로를 동시에 해제할 때 둘 다 통과한다(setWorkspaceRole 관례).
 */
export async function setPlatformAdmin(userId: string, value: boolean): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  // 본인 해제는 다른 슈퍼유저가 한다 — 한 번의 클릭으로 자기 관리 화면에서 잠기는 사고를 막는다(마지막 한 명 검사와 별개).
  if (!value && userId === g.actor.userId) return { ok: false, error: ERR_SELF_PLATFORM }
  if (typeof value !== 'boolean') return { ok: false, error: '지정 여부가 올바르지 않습니다.' }
  const admin = createAdminClient()

  if (!value) {
    const { data, error: delErr } = await admin.from('platform_admins').delete().eq('user_id', userId).select('user_id')
    if (delErr) {
      if (delErr.message.includes('PLATFORM_LAST_ADMIN')) {
        return { ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' }
      }
      console.error('[setPlatformAdmin] 해제 실패:', delErr.message)
      return { ok: false, error: '슈퍼유저를 해제하지 못했습니다.' }
    }
    // 0행 = 이미 슈퍼유저가 아니다. 조용한 no-op 을 성공으로 보고하지 않는다.
    if (!data || data.length === 0) return { ok: false, error: '슈퍼유저가 아닌 계정입니다.' }
  } else {
    // (지정 분기는 그대로)
```

- [ ] **Step 4: 통과** — `npx vitest run tests/actions/accounts-gate.test.ts tests/invariants/platform-guards.test.ts && npm run typecheck && npm run lint` → 초록(`requireSuperuser` 호출 위치 11곳 불변).

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/accounts.ts tests/actions/accounts-gate.test.ts
git commit -m "fix(accounts): 마지막 슈퍼유저 판정을 DB 트리거에 맡기고 PLATFORM_LAST_ADMIN 을 사용자 문구로 옮긴다

앱이 목록을 센 뒤 지우면 두 슈퍼유저가 서로를 동시에 해제할 때 둘 다 통과해 0명이 된다(AUTH-04). 0011 의
platform_admins_keep_last 가 advisory 잠금 아래에서 판정하므로 앱은 세지 않고 오류를 문구로만 옮긴다
(setWorkspaceRole 의 WORKSPACE_LAST_ADMIN 관례). 0행 삭제를 성공으로 보고하지 않는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: `buildActor` 가 소속 워크스페이스 밖 명단 행을 버린다 (H2-d 의 코드)

항목: AUTH-01b(코드 절반). UI 위험 파일 없음.

결함: `buildActor`(`src/lib/authz/buildActor.ts:54-57`)는 명단 행을 워크스페이스 소속으로 거르지 않고 `projectRoles`·`memberIds` 에 싣는다. 소속을 잃은 사람의 남은 admin 행이 `isAnyProjectAdmin`(`authz.ts:174-180`)·`adminProjectIds`(:188-194)·`hasAnyProjectRole`(:205-208)에 셈해진다. `roleIn` 은 `projectWorkspace` 로 거르지만 이 셋은 `projectRoles` 를 그대로 돈다. SQL 헬퍼(`is_project_member` 등)는 0009 부터 `is_ws_member` 로 같은 선을 긋는다.

**Files:**
- Modify: `src/lib/authz/buildActor.ts:54-57`
- Modify(test): `tests/authz/guards.test.ts`(describe `getActor — 4축 조립`)

**Interfaces:**
- Produces: 규칙 "명단 행의 `project_id` 가 `projectWorkspace` 에 없으면 그 행은 `projectRoles`·`memberIds`·`rosterTeams` 어디에도 싣지 않는다". 과제 11 의 `tests/rls/h2-actor.ts` `actorFromDb` 가 같은 규칙을 SQL 로 미러한다.

- [ ] **Step 1: 실패하는 테스트** (`tests/authz/guards.test.ts`, `(d′)` 케이스 뒤에 추가)

```ts
  it('(h) 소속 워크스페이스 밖 프로젝트의 명단 행은 버린다 — 남은 admin 행이 어느 축에도 새지 않는다(AUTH-01b)', async () => {
    // p1 은 w1(소속), pX 는 소속이 없는 워크스페이스의 프로젝트 — projects 조회(in w1)에 나오지 않는다
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'member', [['QA', true]]), row('pX', 'admin', [['ERP', true]])] })
    const a = await getActor()
    expect(a?.projectRoles.get('p1')).toBe('member')
    expect(a?.projectRoles.has('pX')).toBe(false)
    expect(a?.memberIds.has('pX')).toBe(false)
    expect(a?.rosterTeams.has('pX')).toBe(false)
    expect(isAnyProjectAdmin(a)).toBe(false)
    expect(adminProjectIds(a)).toEqual([])
  })

  it('(h′) 플랫폼 관리자는 모든 프로젝트가 projectWorkspace 에 있으므로 명단 행을 버리지 않는다', async () => {
    stubDb({ platformAdmin: true, projects: [{ id: 'p1', workspace_id: 'w1' }, { id: 'pX', workspace_id: 'w9' }], roster: [row('pX', 'admin')] })
    const a = await getActor()
    expect(a?.projectRoles.get('pX')).toBe('admin')
  })
```
파일 머리 import 에 `import { adminProjectIds, isAnyProjectAdmin } from '@/lib/domain/authz'` 를 더한다(이미 있으면 그대로).

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/authz/guards.test.ts` → `(h)` FAIL(`projectRoles.has('pX')` 가 참).

- [ ] **Step 3: 구현** (`buildActor.ts:54-57`)

```ts
  for (const row of pm.data! as Array<Record<string, unknown>>) {
    const pid = row.project_id as string
    // 소속 워크스페이스 밖 프로젝트의 명단 행은 버린다 — 소속을 잃은 뒤 남은 행이 projectRoles 로 들어가면 isAnyProjectAdmin·
    // adminProjectIds·hasAnyProjectRole 이 그 역할을 센다(AUTH-01b). SQL 헬퍼는 is_ws_member 로 같은 선을 긋는다(0009 F1).
    // 플랫폼 관리자는 projectWorkspace 에 전 프로젝트가 있어 버리는 행이 없다.
    if (!projectWorkspace.has(pid)) continue
    memberIds.set(pid, row.id as string)
    if (row.access_role) projectRoles.set(pid, row.access_role as ProjectRole)
```

- [ ] **Step 4: 통과·회귀** — `npx vitest run tests/authz tests/agent tests/ai/chat-v2-route.test.ts tests/lib/resolve-member-ids.test.ts --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authz/buildActor.ts tests/authz/guards.test.ts
git commit -m "fix(authz): buildActor 가 소속 워크스페이스 밖 프로젝트의 명단 행을 버린다

소속을 잃은 사람의 남은 admin 행이 projectRoles 에 실려 isAnyProjectAdmin·adminProjectIds·hasAnyProjectRole 이
그 역할을 셌다(AUTH-01b). roleIn 은 projectWorkspace 로 걸렀지만 이 셋은 projectRoles 를 그대로 돌았다. SQL 헬퍼가
0009 부터 is_ws_member 로 긋는 선과 같게 한다. 0011 은 소속 회수 때 명단 권한 자체를 null 로 만든다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: 세 첨부 삭제 경로를 공용 도우미 하나로 — 이미 없는 객체의 행은 지우고, 읽을 수 없을 뿐인 객체의 행은 남긴다 (H2-g 보강의 코드)

항목: H1 이월(과제 18·19 판정 — 스펙 §6.2.0 g 마지막 불릿). UI 위험 파일 없음.

결함: 세 삭제 경로(`attachments.ts:139-166`, `issueAttachments.ts:169-203`, `minutes.ts:791-821`)는 Storage 삭제가 정확히 1건일 때만 행을 지운다(H1 과제 18). 객체가 이미 없으면 `remove` 는 0건이라 그 행을 영영 지우지 못한다. 세션의 `exists()` 는 '없음'과 '읽을 수 없음'을 가르지 못한다(회의록을 옮기거나 경로가 옛 형식이면 세션은 객체를 못 읽는다 — 오판하면 과제 18 이 닫은 고아 객체가 다시 생긴다). 0건이면 SECURITY DEFINER RPC(과제 12 `attachment_object_exists`)에 묻고, 객체가 정말 없을 때만 행을 지운다. 확인이 실패하면 행을 남긴다.

0011 전에는 RPC 가 없어 PostgREST 가 오류를 낸다 → 행을 남기고 오류 — 지금과 같은 동작이라 이 커밋은 0011 전후 모두 초록이다.

**Files:**
- Create: `src/lib/attachments/removeStoredAttachment.ts`, `tests/lib/remove-stored-attachment.test.ts`
- Modify: `src/app/actions/attachments.ts:139-166`, `src/app/actions/issueAttachments.ts:169-203`, `src/app/actions/minutes.ts:791-821`
- Modify(test): `tests/actions/issue-attachments-gate.test.ts`(`makeClient` :60-126, 삭제 케이스 :280-357), `tests/actions/minutes-workspace-scope.test.ts`(`fakeClient` 에 `rpc`, :472-514 삭제 케이스)

**Interfaces:**
```ts
// src/lib/attachments/removeStoredAttachment.ts
export type AttachmentKind = 'deliverable' | 'issue' | 'minute'
export const ERR_OBJECT_REMOVE = '첨부 파일을 지우지 못했습니다 — 권한이나 저장소 상태를 확인한 뒤 다시 시도하세요.'
export const ERR_ROW_REMOVE = '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.'
export async function removeStoredAttachment(
  db: Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>,
  input: { kind: AttachmentKind; id: string; filePath: string; tag: string },
): Promise<{ ok: true } | { ok: false; error: string }>
```
- kind → (버킷, 표): `deliverable` → (`deliverables`, `deliverable_attachments`), `issue` → (`issue-attachments`, `issue_attachments`), `minute` → (`minutes`, `minute_files`).
- 부르는 RPC(과제 12 가 만든다): `rpc('attachment_object_exists', { p_kind: AttachmentKind, p_id: uuid })` → `boolean`. 권한 없음·행 없음은 `42501 ATTACHMENT_FORBIDDEN`, 모르는 kind 는 `22023 ATTACHMENT_KIND_INVALID`.
- 권한 판정은 호출부가 먼저 끝낸다(도우미는 판정하지 않는다).

- [ ] **Step 1: 실패하는 테스트 — 도우미** (`tests/lib/remove-stored-attachment.test.ts`)

```ts
// 세 첨부 삭제 경로의 공용 도우미 — 객체 삭제 1건이면 행 삭제, 0건이면 RPC attachment_object_exists 로 '없음'과 '읽을 수 없음'을
// 가른다. 없음 → 행 삭제, 있음·확인 실패 → 행 유지(fail-closed). DB 오류 원문은 응답에 싣지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE, removeStoredAttachment } from '@/lib/attachments/removeStoredAttachment'

type R = { data: unknown; error: { message: string } | null }
function fakeDb(o: { removed?: R; exists?: R; deleted?: R } = {}) {
  const calls: string[] = []
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`remove:${paths.join(',')}`)
    return o.removed ?? { data: [{ name: paths[0] }], error: null }
  })
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    calls.push(`rpc:${fn}:${JSON.stringify(args)}`)
    return o.exists ?? { data: false, error: null }
  })
  const del: Record<string, unknown> = {}
  del.eq = vi.fn(() => del)
  del.select = vi.fn(async () => { calls.push('row.delete'); return o.deleted ?? { data: [{ id: 'a1' }], error: null } })
  const from = vi.fn((table: string) => { calls.push(`table:${table}`); return { delete: vi.fn(() => del) } })
  const storageFrom = vi.fn((bucket: string) => { calls.push(`bucket:${bucket}`); return { remove } })
  return { db: { from, rpc, storage: { from: storageFrom } } as never, calls }
}
const IN = { kind: 'minute' as const, id: 'a1', filePath: 'ws/w/p/_/minute-files/m/a.pdf', tag: 'test' }

let spy: ReturnType<typeof vi.spyOn>
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { spy.mockRestore() })

describe('removeStoredAttachment', () => {
  it('객체 1건 삭제 → 행 삭제, RPC 는 부르지 않는다', async () => {
    const f = fakeDb()
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: true })
    expect(f.calls).toEqual(['bucket:minutes', `remove:${IN.filePath}`, 'table:minute_files', 'row.delete'])
  })
  it('0건 + 객체가 정말 없음(RPC false) → 행만 지운다', async () => {
    const f = fakeDb({ removed: { data: [], error: null }, exists: { data: false, error: null } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: true })
    expect(f.calls).toContain(`rpc:attachment_object_exists:${JSON.stringify({ p_kind: 'minute', p_id: 'a1' })}`)
    expect(f.calls.at(-1)).toBe('row.delete')
  })
  it('0건 + 객체가 남아 있음(RPC true, 삭제 권한 불일치) → 행을 남기고 실패', async () => {
    const f = fakeDb({ removed: { data: [], error: null }, exists: { data: true, error: null } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls).not.toContain('row.delete')
    expect(spy).toHaveBeenCalled()
  })
  it.each([
    ['RPC 오류', { data: null, error: { message: 'ATTACHMENT_FORBIDDEN' } }],
    ['RPC 응답이 boolean 아님', { data: null, error: null }],
  ])('0건 + %s → 행을 남기고 실패(fail-closed)', async (_l, exists) => {
    const f = fakeDb({ removed: { data: [], error: null }, exists })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls).not.toContain('row.delete')
  })
  it('Storage 오류 → RPC·행 삭제 없이 실패', async () => {
    const f = fakeDb({ removed: { data: null, error: { message: 'storage down' } } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls.some((c) => c.startsWith('rpc:'))).toBe(false)
    expect(f.calls).not.toContain('row.delete')
  })
  it.each([
    ['0행', { data: [], error: null }],
    ['오류(원문을 싣지 않는다)', { data: null, error: { message: 'db boom' } }],
  ])('행 삭제 %s → 기록 삭제 실패', async (_l, deleted) => {
    const f = fakeDb({ deleted })
    const res = await removeStoredAttachment(f.db, IN)
    expect(res).toEqual({ ok: false, error: ERR_ROW_REMOVE })
  })
  it.each([
    ['deliverable', 'deliverables', 'deliverable_attachments'],
    ['issue', 'issue-attachments', 'issue_attachments'],
    ['minute', 'minutes', 'minute_files'],
  ] as const)('kind %s → 버킷 %s·표 %s', async (kind, bucket, table) => {
    const f = fakeDb()
    await removeStoredAttachment(f.db, { ...IN, kind })
    expect(f.calls).toContain(`bucket:${bucket}`)
    expect(f.calls).toContain(`table:${table}`)
  })
})
```

- [ ] **Step 2: 실패하는 테스트 — 호출부 두 파일**

`tests/actions/issue-attachments-gate.test.ts` 의 `makeClient`:
- 옵션에 `exists?: { data: unknown; error: { message: string } | null }` 를 더한다.
- 반환 `client` 에 `rpc: vi.fn(async () => { calls.push('rpc.exists'); return opts.exists ?? { data: true, error: null } })` 를 더한다(기본 = 객체가 남아 있음 → 기존 0건 케이스의 기대 "메타 유지"가 그대로다).
- 메타 delete 사슬을 도우미가 쓰는 모양(`.delete().eq('id', id).select('id')` 를 바로 await)으로 바꾼다.
  ```ts
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            calls.push('meta.delete')
            const r = opts.deleteResult ?? { data: { id: 'a1' }, error: opts.deleteError ?? null }
            return Promise.resolve({ data: r.data ? [r.data] : [], error: r.error }).then(res, rej)
          },
        })),
      })),
    })),
  ```
- "Storage 가 0건을 지웠으면 메타를 남기고 실패"(:309-321)의 기대를 `expect(m.calls).toEqual(['storage.remove', 'rpc.exists'])` 로 바꾼다.
- 새 케이스:
  ```ts
  it('Storage 0건인데 객체가 이미 없으면(존재 확인 RPC false) 메타만 지우고 성공', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      removed: { data: [], error: null },
      exists: { data: false, error: null },
    })
    state.client = m.client
    expect(await removeIssueAttachment('a1')).toEqual({ ok: true })
    expect(m.calls).toEqual(['storage.remove', 'rpc.exists', 'meta.delete'])
  })
  ```

`tests/actions/minutes-workspace-scope.test.ts` 의 `fakeClient`(과제 1 이 고친 판):
- `StorageResults` 에 `exists?: TableResult` 를 더하고, 반환 `client` 에 `rpc: vi.fn(async () => storage.exists ?? { data: true, error: null })` 를 더한다.
- `describe('removeMinuteFile — …')`(:472)에 새 케이스:
  ```ts
  it('remove 0건이어도 객체가 이미 없으면(RPC false) 행을 지우고 성공', async () => {
    const db = seedDb(
      { minute_files: [{ data: FILE_ROW, error: null }, { data: [{ id: 'file-1' }], error: null }] },
      { remove: { data: [], error: null }, exists: { data: false, error: null } },
    )
    getActor.mockResolvedValue(inA)
    expect(await removeMinuteFile('file-1')).toEqual({ ok: true })
    expect(db.calls.minute_files).toContain('delete')
  })
  ```
  (`seedDb` 가 `fakeClient` 의 두 번째 인자를 그대로 넘기는지 확인하고, 아니면 넘기게 고친다.)

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/lib/remove-stored-attachment.test.ts tests/actions/issue-attachments-gate.test.ts tests/actions/minutes-workspace-scope.test.ts` → 도우미 파일이 없어 FAIL, 새 호출부 케이스 FAIL.

- [ ] **Step 4: 구현 — 도우미** (`src/lib/attachments/removeStoredAttachment.ts`)

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/** 첨부 세 종류 — RPC attachment_object_exists(p_kind) 의 값과 같다(0011 H2-g). */
export type AttachmentKind = 'deliverable' | 'issue' | 'minute'

const TARGET: Record<AttachmentKind, { bucket: string; table: string }> = {
  deliverable: { bucket: 'deliverables', table: 'deliverable_attachments' },
  issue: { bucket: 'issue-attachments', table: 'issue_attachments' },
  minute: { bucket: 'minutes', table: 'minute_files' },
}

export const ERR_OBJECT_REMOVE = '첨부 파일을 지우지 못했습니다 — 권한이나 저장소 상태를 확인한 뒤 다시 시도하세요.'
export const ERR_ROW_REMOVE = '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.'

type Db = Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>

/**
 * 첨부 행과 그 Storage 객체를 함께 지운다 — 산출물·이슈·회의록 첨부 세 삭제 경로의 공용 도우미. 권한 판정은 호출부가 먼저 끝낸다.
 * 순서: 객체 삭제 → 1건이면 행 삭제. remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려주고, 세션의 exists() 는 '없음'과 '읽을 수
 * 없음'을 가르지 못한다(회의록을 옮기거나 옛 형식 경로면 세션은 객체를 못 읽는다). 그래서 0건이면 SECURITY DEFINER RPC
 * attachment_object_exists 에 묻는다 — 객체가 정말 없으면 행만 지우고(이미 사라진 객체의 행이 영영 남지 않게), 남아 있거나 확인이
 * 실패하면 행을 남기고 오류다(fail-closed — 고아 객체를 만들지 않는다). DB 오류 원문은 로그에만 남긴다.
 */
export async function removeStoredAttachment(
  db: Db, input: { kind: AttachmentKind; id: string; filePath: string; tag: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { bucket, table } = TARGET[input.kind]
  const { data: removed, error: rmErr } = await db.storage.from(bucket).remove([input.filePath])
  if (rmErr) {
    console.error(`[${input.tag}] Storage 삭제 실패 — 행을 남긴다:`, rmErr.message)
    return { ok: false, error: ERR_OBJECT_REMOVE }
  }
  if ((removed ?? []).length !== 1) {
    const { data: exists, error: exErr } = await db.rpc('attachment_object_exists', { p_kind: input.kind, p_id: input.id })
    if (exErr || typeof exists !== 'boolean') {
      console.error(`[${input.tag}] 객체 존재 확인 실패 — 행을 남긴다:`, exErr?.message ?? `응답 ${JSON.stringify(exists)}`)
      return { ok: false, error: ERR_OBJECT_REMOVE }
    }
    if (exists) {
      console.error(`[${input.tag}] Storage 삭제 ${(removed ?? []).length}건인데 객체가 남아 있다(삭제 권한 불일치) — 행을 남긴다:`, input.filePath)
      return { ok: false, error: ERR_OBJECT_REMOVE }
    }
  }
  const { data: gone, error } = await db.from(table).delete().eq('id', input.id).select('id')
  if (error) {
    console.error(`[${input.tag}] 행 삭제 실패:`, error.message)
    return { ok: false, error: ERR_ROW_REMOVE }
  }
  if ((gone ?? []).length === 0) {
    console.error(`[${input.tag}] 행 삭제 0건:`, input.id)
    return { ok: false, error: ERR_ROW_REMOVE }
  }
  return { ok: true }
}
```

- [ ] **Step 5: 구현 — 세 호출부**

- `attachments.ts` `removeAttachment`: 권한 가드(`requireAttachPermission`) 뒤의 Storage·행 삭제부(:150-165)를 다음으로 바꾼다. import `removeStoredAttachment` 추가.
  ```ts
  // 객체 삭제 → 행 삭제. 객체가 이미 없으면 행만 지우고, 남아 있으면(삭제 권한 불일치) 행을 남긴다(0011 H2-g 존재 확인 RPC).
  return removeStoredAttachment(sb, { kind: 'deliverable', id, filePath: att.file_path as string, tag: 'removeAttachment' })
  ```
- `issueAttachments.ts` `removeIssueAttachment`: :183-199 를 다음으로.
  ```ts
  const r = await removeStoredAttachment(sb, { kind: 'issue', id, filePath: att.file_path as string, tag: 'removeIssueAttachment' })
  if (!r.ok) return r
  revalidatePath(`/p/${g.projectId}/issues`)
  return { ok: true }
  ```
- `minutes.ts` `removeMinuteFile`: :805-819 를 다음으로.
  ```ts
  // 객체 삭제 → 행 삭제. 버킷 정책(minute-files 삭제 = 관리 권한 ∨ ws 관리자 ∨ 소유자∧미참조, 0011 H2-g)이 행 삭제
  // (can_manage_minute)와 같은 선이 됐다. 객체가 이미 없으면 행만 지운다(존재 확인 RPC).
  const r = await removeStoredAttachment(sb, { kind: 'minute', id: fileId, filePath: f.file_path as string, tag: 'removeMinuteFile' })
  if (!r.ok) return r
  revalidatePath(`/minutes/${f.minute_id as string}`)
  return { ok: true }
  ```

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/lib tests/actions tests/components/wbs-row-detail-attachments.test.tsx --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "storage.from(BUCKET).remove" src/app/actions/{attachments,issueAttachments}.ts src/app/actions/minutes.ts` → 삭제 경로에서 0건(업로드 보상 경로는 클라이언트 컴포넌트라 해당 없음).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/attachments/removeStoredAttachment.ts tests/lib/remove-stored-attachment.test.ts src/app/actions/attachments.ts src/app/actions/issueAttachments.ts src/app/actions/minutes.ts tests/actions/issue-attachments-gate.test.ts tests/actions/minutes-workspace-scope.test.ts
git commit -m "fix(attachments): 세 첨부 삭제 경로를 공용 도우미로 — 이미 없는 객체의 행은 지우고 읽을 수 없는 객체의 행은 남긴다

Storage 삭제가 1건일 때만 행을 지우면(H1 과제 18) 객체가 이미 없는 첨부는 영영 지울 수 없다. 세션의 exists() 는
'없음'과 '읽을 수 없음'을 가르지 못하므로, 0건이면 0011 의 SECURITY DEFINER RPC attachment_object_exists 에 묻고
정말 없을 때만 행을 지운다. 확인이 실패하면 행을 남긴다(fail-closed). 0011 전에는 RPC 가 없어 지금과 같이 행을 남긴다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: DB 가드의 거부 사유를 사용자 문구로 — 첨부 확정 가드(h)와 실적 100 잠금(WF-GAP-1)

항목: H2-h·WF-GAP-1 의 코드 절반. UI 위험 파일 없음.

결함: 과제 13 의 첨부 가드와 과제 15 의 실적 잠금은 DB 오류(`MINUTE_ATTACHMENT_*`, `WORKFLOW_ACTUAL_LOCKED`)로 거부한다. `recordMinuteFile`(:785)과 `updateActual`(`wbs.ts:175`)은 DB 오류 원문을 그대로 돌려준다 — 사용자에게 식별자가 보이고, 첨부는 H1 규칙(원문 금지)에 어긋난다. 0011 전에는 이 코드가 나오지 않으므로 매핑을 먼저 둬도 동작은 같다.

**Files:**
- Modify: `src/app/actions/minutes.ts`(import :13-18 에 `MINUTE_ATTACHMENTS_MAX_COUNT`, `recordMinuteFile` :781-788), `src/app/actions/wbs.ts:142-176`
- Modify(test): `tests/actions/minutes-file-path.test.ts`(`fakeDb` :53-62 에 insert 결과 분리), `tests/actions/wbs-update-actual-lock.test.ts`

**Interfaces:**
- Consumes(과제 13 이 낸다): `MINUTE_ATTACHMENT_LIMIT`(23514)·`MINUTE_ATTACHMENT_DUPLICATE`(23505)·`MINUTE_ATTACHMENT_ARCHIVED`(42501)·`MINUTE_ATTACHMENT_PATH`(22023)·`MINUTE_ATTACHMENT_OBJECT`(42501). (과제 15 가 낸다): `WORKFLOW_ACTUAL_LOCKED`(42501).
- Produces: 문구 표(모듈 내부).

| DB 사유 | 사용자 문구 |
|---|---|
| `MINUTE_ATTACHMENT_LIMIT` | `첨부는 회의록당 ${MINUTE_ATTACHMENTS_MAX_COUNT}개까지입니다.` |
| `MINUTE_ATTACHMENT_DUPLICATE` | `같은 파일이 이미 첨부돼 있습니다.` |
| `MINUTE_ATTACHMENT_ARCHIVED` | `보관된 회의록에는 첨부할 수 없습니다.` |
| `MINUTE_ATTACHMENT_PATH` | `잘못된 파일 경로입니다.` |
| `MINUTE_ATTACHMENT_OBJECT` | `업로드한 파일을 확인하지 못했습니다 — 다시 올려 주세요.` |
| 그 밖 | `첨부 기록에 실패했습니다.`(원문은 로그) |
| `WORKFLOW_ACTUAL_LOCKED` | `wbs.ts:158` 의 잠금 문구 그대로(`ACTUAL_LOCKED_MSG` 로 뽑는다) |

- [ ] **Step 1: 실패하는 테스트 — 첨부** (`tests/actions/minutes-file-path.test.ts`)

`fakeDb` 를 insert 결과를 따로 받게 바꾼다(기본은 성공).
```ts
function fakeDb(result: { data?: unknown; error?: { message: string } | null },
  insertResult: { error: { message: string } | null } = { error: null }) {
  const b: Record<string, unknown> = {}
  const insert = vi.fn(() => ({
    then: (r: (v: unknown) => void) => r({ data: null, error: insertResult.error }),
  }))
  for (const m of ['select', 'eq', 'maybeSingle', 'single']) b[m] = vi.fn(() => b)
  b.insert = insert
  ;(b as { then: (r: (v: unknown) => void) => void }).then =
    resolve => resolve({ data: result.data ?? null, error: result.error ?? null })
  return { client: { from: vi.fn(() => b) }, insert }
}
```
`describe('recordMinuteFile — scope 는 DB 의 회의록 행')` 에 추가:
```ts
  it.each([
    ['MINUTE_ATTACHMENT_LIMIT', '첨부는 회의록당 10개까지입니다.'],
    ['MINUTE_ATTACHMENT_DUPLICATE', '같은 파일이 이미 첨부돼 있습니다.'],
    ['MINUTE_ATTACHMENT_ARCHIVED', '보관된 회의록에는 첨부할 수 없습니다.'],
    ['MINUTE_ATTACHMENT_PATH', '잘못된 파일 경로입니다.'],
    ['MINUTE_ATTACHMENT_OBJECT', '업로드한 파일을 확인하지 못했습니다 — 다시 올려 주세요.'],
  ])('DB 가드 사유 %s 는 사용자 문구로', async (code, text) => {
    const db = fakeDb({ data: row() }, { error: { message: code } })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toEqual({ ok: false, error: text })
  })
  it('모르는 DB 오류는 원문을 싣지 않는다 — 로그만', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeDb({ data: row() }, { error: { message: 'db boom' } })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toEqual({ ok: false, error: '첨부 기록에 실패했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
```

- [ ] **Step 2: 실패하는 테스트 — 실적** (`tests/actions/wbs-update-actual-lock.test.ts` 끝의 describe 에 추가)

```ts
  it('앱 판정 뒤 쓰기 사이에 주문이 claim 되면 DB 잠금(WORKFLOW_ACTUAL_LOCKED)이 막는다 — 같은 잠금 문구로', async () => {
    server({
      wbs_items: [item(), { data: null }, { data: null, error: { message: 'WORKFLOW_ACTUAL_LOCKED' } }],
      agent_work_orders: [{ data: null }],
    })
    expect(await updateActual(W1, 100)).toEqual({ ok: false, error: LOCKED_MSG })
  })

  // 경계 패리티의 TS 쪽 — tests/rls/workflow-parity.test.ts 의 ACTUAL_BOUNDARY 와 같은 세 값이다(과제 15). 한쪽을 바꾸면 다른 쪽도 바꾼다.
  it.each([[99, true], [99.5, false], [100, false]] as const)('위임된 항목의 수기 실적 %s → 허용 %s(99 초과는 잠금)', async (pct, allowed) => {
    const { writes } = server({
      wbs_items: [item({ tags: ['agent'] }), { data: null }, { data: [{ id: W1 }] }],
    })
    const res = await updateActual(W1, pct)
    if (allowed) {
      expect(res).toEqual({ ok: true })
      expect(writes.some((w) => w.table === 'wbs_items')).toBe(true)
    } else {
      expect(res).toEqual({ ok: false, error: LOCKED_MSG })
      expect(writes.some((w) => w.table === 'wbs_items')).toBe(false)
    }
  })
```
(큐 순서는 `updateActual` 의 조회 순서다: 항목 → 하위 항목 → (관리자라 담당 조회 없음) → 주문 → 갱신. 위임된 항목은 주문을 조회하지 않는다. 파일의 기존 케이스가 쓰는 큐와 같은 순서인지 확인하고 맞춘다. 경계 세 케이스는 현행 앱 규칙(`wbs.ts:146` `newPct > 99`)을 고정하므로 처음부터 통과한다.)

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/actions/minutes-file-path.test.ts tests/actions/wbs-update-actual-lock.test.ts` → 새 케이스 FAIL(원문이 그대로 나온다).

- [ ] **Step 4: 구현**

`src/app/actions/minutes.ts`: import 묶음(:13-18)에 `MINUTE_ATTACHMENTS_MAX_COUNT` 를 더하고, `recordMinuteFile` 위에 둔다.
```ts
/** 첨부 확정 가드(0011 minute_files_attachment_guard)의 거부 사유 → 사용자 문구. 모르는 사유는 원문을 싣지 않는다. */
const ATTACHMENT_GUARD_TEXT: ReadonlyArray<readonly [string, string]> = [
  ['MINUTE_ATTACHMENT_LIMIT', `첨부는 회의록당 ${MINUTE_ATTACHMENTS_MAX_COUNT}개까지입니다.`],
  ['MINUTE_ATTACHMENT_DUPLICATE', '같은 파일이 이미 첨부돼 있습니다.'],
  ['MINUTE_ATTACHMENT_ARCHIVED', '보관된 회의록에는 첨부할 수 없습니다.'],
  ['MINUTE_ATTACHMENT_PATH', '잘못된 파일 경로입니다.'],
  ['MINUTE_ATTACHMENT_OBJECT', '업로드한 파일을 확인하지 못했습니다 — 다시 올려 주세요.'],
]
```
`recordMinuteFile` 의 첨부 insert 오류 처리(:785)를 바꾼다.
```ts
  if (error) {
    const known = ATTACHMENT_GUARD_TEXT.find(([code]) => error.message.includes(code))?.[1]
    if (!known) console.error('[recordMinuteFile] 첨부 기록 실패:', error.message)
    return { ok: false, error: known ?? '첨부 기록에 실패했습니다.' }
  }
```

`src/app/actions/wbs.ts`: `:158` 의 잠금 문구를 파일 상수 `const ACTUAL_LOCKED_MSG = '완료는 승인 버튼으로 처리합니다 — 에이전트 관할 작업(위임됨·작업 중·검수 대기)은 99% 까지 입력할 수 있습니다. 직접 완료하려면 위임을 끄세요.'` 로 뽑아 두 곳에서 쓴다(`'use server'` 파일이라 export 하지 않는다). `:175` 를 바꾼다.
```ts
  if (upErr) {
    // 앱 잠금 판정과 이 쓰기 사이에 주문이 claim 되면 DB 가드(0011 guard_workflow_actual)가 막는다 — 같은 문구로.
    if (upErr.message.includes('WORKFLOW_ACTUAL_LOCKED')) return { ok: false, error: ACTUAL_LOCKED_MSG }
    return { ok: false, error: upErr.message }
  }
```

- [ ] **Step 5: 통과·회귀** — `npx vitest run tests/actions tests/ui/minute-upload-modal.test.tsx --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/minutes.ts src/app/actions/wbs.ts tests/actions/minutes-file-path.test.ts tests/actions/wbs-update-actual-lock.test.ts
git commit -m "fix(minutes,wbs): 0011 의 첨부 확정 가드·실적 잠금이 내는 사유를 사용자 문구로 옮긴다

0011 이 PostgREST 직접 쓰기를 막으려 첨부 개수·중복·경로·객체 소유와 위임 작업의 실적 100 을 DB 에서 거부한다.
recordMinuteFile·updateActual 은 DB 오류 원문을 돌려줘 식별자가 사용자에게 보인다. 알려진 사유는 문구로, 모르는 것은
로그 + 일반 문구로 한다. 0011 전에는 이 사유가 나오지 않으므로 동작은 같다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 2단계 — `0011_authz_hardening` 쌓기(커밋은 과제 16)

과제 6~15 는 커밋하지 않는다. 각 과제의 산출물은 작업 트리의 `supabase/migrations/0011_authz_hardening.sql`(끝에 덧붙임)·`supabase/rollbacks/0011_authz_hardening_rollback.sql`(`begin;` 바로 아래에 끼움)·`tests/rls/**` 다. 각 과제 끝에서 `git status --short supabase tests/rls` 로 누적 파일을 확인하고 보고에 적는다.

### Task 6: a — 마지막 슈퍼유저 보호 (0011 파일 생성)

항목: AUTH-04. 스펙 §6.2.0 a, §8.2 ④.

현행(실측): `platform_admins` 에 사용자 트리거 0개, 정책 `platform_admins_write`(ALL `is_superuser()`, `0003_org_core.sql:641-642`), `authenticated` ACL `arwdDxtm`(`0003:643-645` 의 `grant all`), anon `rxtm`(0006 이 쓰기만 걷었다).

**Files:**
- Create: `supabase/migrations/0011_authz_hardening.sql`, `supabase/rollbacks/0011_authz_hardening_rollback.sql`, `tests/rls/h2-platform-admins.test.ts`

**Interfaces:**
- Produces: 트리거 함수 `public.platform_admins_keep_last()`(SECURITY DEFINER, `search_path=''`, 실행 권한 없음), 트리거 `platform_admins_keep_last BEFORE UPDATE OR DELETE`, 오류 `{ errcode 23514, message 'PLATFORM_LAST_ADMIN' }`(과제 2 가 소비). 정책 `platform_admins_write` 없음, `authenticated` 의 INSERT·UPDATE·DELETE·TRUNCATE 없음(SELECT 정책 `platform_admins_read` 는 그대로).

- [ ] **Step 0: 착수 확인** — Global Constraints 착수 조건 + 과제 1~5 커밋이 HEAD 에 있다(`git log --oneline -5`). `git status --short supabase tests/rls` 가 비어 있다.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-platform-admins.test.ts`)

```ts
// H2-a(AUTH-04) — 마지막 슈퍼유저 보호. 세션은 platform_admins 를 쓰지 못하고(정책 drop + 권한 회수), 직접 DELETE·user_id 를 바꾸는
// UPDATE 로 마지막 1명을 없애면 PLATFORM_LAST_ADMIN(세션·service_role 모두). 같은 계정 행 UPDATE(granted_by SET NULL 캐스케이드)와
// auth.users 삭제의 캐스케이드(dev-bootstrap 실패 롤백, 스펙 §8.2 ④)는 통과한다. 두 연결의 동시 해제는 advisory 잠금이 직렬화한다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LAST = { code: '23514', message: 'PLATFORM_LAST_ADMIN' }
const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
/** 같은 트랜잭션에서 keep 만 남기고 나머지 슈퍼유저 행을 지운다(keep 이 남으므로 가드를 통과한다). */
async function onlyAdmins(c: PoolClient, keep: string[]) {
  await c.query('insert into public.platform_admins (user_id) select unnest($1::uuid[]) on conflict do nothing', [keep])
  await c.query('delete from public.platform_admins where not (user_id = any($1::uuid[]))', [keep])
}

describe('H2-a platform_admins — 마지막 1명', () => {
  it('세션은 슈퍼유저여도 platform_admins 에 쓰지 못한다(권한 42501) — 읽기는 그대로, 쓰기 정책은 없다', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect((await c.query('select 1 from public.platform_admins where user_id = $1', [F.users.platform])).rowCount).toBe(1)
      for (const sql of [
        'insert into public.platform_admins (user_id) values ($1)',
        'delete from public.platform_admins where user_id = $1',
        'update public.platform_admins set granted_at = now() where user_id = $1',
      ]) {
        expect(await pgError(c, sql, [F.users.aLoose]), sql).toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
      }
    })
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'platform_admins' and cmd <> 'SELECT'`)
    expect(rows[0].n).toBe(0)
  })

  it('마지막 1명의 DELETE·user_id 변경 UPDATE 는 PLATFORM_LAST_ADMIN(service_role 도), 같은 계정 행 UPDATE 는 통과', async () => {
    await asService(pool, async (c) => {
      await onlyAdmins(c, [F.users.platform])
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.platform])).toMatchObject(LAST)
      expect(await pgError(c, 'update public.platform_admins set user_id = $2 where user_id = $1', [F.users.platform, F.users.aLoose]))
        .toMatchObject(LAST)
      expect(await pgError(c, 'update public.platform_admins set granted_by = null, granted_at = now() where user_id = $1', [F.users.platform]))
        .toBeNull()
      await c.query('insert into public.platform_admins (user_id) values ($1)', [F.users.aLoose])
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.platform])).toBeNull()
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.aLoose])).toMatchObject(LAST)
    })
  })

  it('auth.users 삭제의 캐스케이드는 면제된다 — 부트스트랩 실패 롤백(방금 만든 유일 슈퍼유저 계정 삭제)이 반쪽으로 끝나지 않는다', async () => {
    await asService(pool, async (c) => {
      const U = '00000000-0000-0000-7e57-000000001201'
      await c.query(INSERT_AUTH_USER, [U, 'rls-h2-boot@example.com'])
      await onlyAdmins(c, [U])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query<{ n: number }>('select count(*)::int as n from public.platform_admins')).rows[0].n).toBe(0)
    })
  })

  it('granted_by 의 SET NULL 캐스케이드(발급자 계정 삭제)는 같은 계정 행 UPDATE 라 통과한다', async () => {
    await asService(pool, async (c) => {
      const G = '00000000-0000-0000-7e57-000000001202'
      await c.query(INSERT_AUTH_USER, [G, 'rls-h2-granter@example.com'])
      await onlyAdmins(c, [F.users.platform])
      await c.query('update public.platform_admins set granted_by = $2 where user_id = $1', [F.users.platform, G])
      expect(await pgError(c, 'delete from auth.users where id = $1', [G])).toBeNull()
      expect((await c.query('select granted_by from public.platform_admins where user_id = $1', [F.users.platform])).rows[0].granted_by).toBeNull()
    })
  })

  it('가드는 advisory 잠금으로 직렬화하고 남은 행을 for update 로 잠그지 않는다(두 연결이 서로를 해제할 때 40P01 교착 방지)', async () => {
    const { rows: [r] } = await pool.query<{ def: string }>(
      `select pg_get_functiondef('public.platform_admins_keep_last()'::regprocedure) as def`)
    expect(r.def).toMatch(/pg_advisory_xact_lock/)
    expect(r.def).not.toMatch(/for\s+update/i)
  })

  it('두 연결이 남은 두 슈퍼유저를 서로 해제해도 1명이 남는다 — 뒤 연결이 앞 연결의 커밋을 기다렸다가 PLATFORM_LAST_ADMIN', async () => {
    // 다른 연결이 봐야 하므로 커밋된 상태가 필요하다. 기존 슈퍼유저 행(픽스처·dev:bootstrap 계정)을 저장하고 finally 에서 되돌린다.
    const saved = (await pool.query<{ user_id: string; granted_by: string | null; granted_at: string }>(
      'select user_id, granted_by, granted_at from public.platform_admins')).rows
    const [X, Y] = [F.users.aLoose, F.users.bMember]
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    try {
      await s1.query('begin'); await onlyAdmins(s1, [X, Y]); await s1.query('commit')
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s1.query('delete from public.platform_admins where user_id = $1', [X])
      let settled = false
      const s2Result = s2.query('delete from public.platform_admins where user_id = $1', [Y]).then(
        () => null,
        (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked).toBe(true)
      await s1.query('commit')
      expect(await s2Result).toMatchObject(LAST)
      const { rows } = await s1.query<{ user_id: string }>('select user_id from public.platform_admins')
      expect(rows).toEqual([{ user_id: Y }])
    } finally {
      await s1.query('rollback').catch(() => undefined)
      // 저장한 행을 먼저 넣고(남은 수가 늘어 가드를 통과한다) 이 케이스가 넣은 X·Y 를 지운다
      await s1.query(`insert into public.platform_admins (user_id, granted_by, granted_at)
        select user_id, granted_by, granted_at from json_populate_recordset(null::public.platform_admins, $1::json) on conflict do nothing`,
        [JSON.stringify(saved)])
      await s1.query('delete from public.platform_admins where user_id = any($1::uuid[]) and not (user_id = any($2::uuid[]))',
        [[X, Y], saved.map((r) => r.user_id)])
      s1.release()
      s2.release()
    }
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-platform-admins.test.ts` → 첫 케이스(세션 insert 가 RLS 통과·정책 존재)·둘째(DELETE 통과)·다섯째(함수 없음)·여섯째(blocked false) FAIL.

- [ ] **Step 3: 정방향 파일 생성** (`supabase/migrations/0011_authz_hardening.sql`)

```sql
-- 0011_authz_hardening — 권한 하드닝 H2. 정본: docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §6.2.0
-- H2 a~i 와 §8.1 #4(실적 100 잠금 절). 원장: .superpowers/review-triage/parts-7-8-synthesis.md §3.
-- 절 순서: ① 마지막 슈퍼유저(a) ② 쓰지 않는 표 권한(b) ③ minutes.share_token 열 권한(c) ④ 소속 회수 = 권한 소멸(d)
--          ⑤ access_granted_* 열(e) ⑥ can_manage_minute = 앱 canEditMinute(f) ⑦ 회의록 버킷 entity 별 정책 + 첨부 객체 존재 확인 RPC(g)
--          ⑧ 첨부 insert 가드(h) ⑨ 승인·반려 보고 id 대조(i) ⑩ 실적 100 잠금 절(WF-GAP-1) ⑪ 사후검증.
-- 새 함수는 revoke/grant 를 명시한다 — postgres 의 public 기본 권한이 새 함수에 authenticated EXECUTE 를 준다.
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다. 롤백: supabase/rollbacks/0011_authz_hardening_rollback.sql.

-- ① 마지막 슈퍼유저(a, AUTH-04) ---------------------------------------------------------------------------------------
-- 정책 platform_admins_write(0003, ALL is_superuser)를 걷는다 — 플랫폼 관리자 변경은 서버 경로(service_role, accounts.ts)로만 한다.
-- 앱의 사전 count(accounts.ts)는 경합에 안전하지 않다: 두 슈퍼유저가 서로를 동시에 해제하면 둘 다 통과한다. 판정을 DB 로 옮긴다.
drop policy platform_admins_write on public.platform_admins;
revoke insert, update, delete, truncate on public.platform_admins from authenticated;

create function public.platform_admins_keep_last() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 같은 계정 행의 UPDATE(granted_by 의 SET NULL 캐스케이드, granted_at 정정)는 슈퍼유저 수를 바꾸지 않는다
  if tg_op = 'UPDATE' and new.user_id = old.user_id then
    return new;
  end if;
  -- auth.users 삭제의 캐스케이드는 면제한다(스펙 §8.2 ④) — dev-bootstrap 의 실패 롤백(방금 만든 계정 삭제)이 이 경로라 막으면
  -- 슈퍼유저 행만 남은 반쪽 상태로 끝난다. 캐스케이드 시점에는 부모 행이 이미 지워져 있다(0008 workspace_members_keep_last_admin 선례).
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  -- 직렬화는 advisory 잠금으로 한다. 남은 행을 for update 로 잠그면 두 연결이 서로를 해제할 때 서로의 행을 기다려 40P01 이 난다.
  -- 잠금을 얻은 뒤의 count 는 새 스냅샷이라(read committed) 앞 연결이 커밋한 삭제를 본다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.platform_admins_keep_last'));
  if not exists (select 1 from public.platform_admins a where a.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'PLATFORM_LAST_ADMIN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.platform_admins_keep_last() from public, anon, authenticated;
create trigger platform_admins_keep_last before update or delete on public.platform_admins
  for each row execute function public.platform_admins_keep_last();

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_admins' and cmd <> 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: platform_admins 쓰기 정책이 남았다';
  end if;
  if has_table_privilege('authenticated', 'public.platform_admins', 'INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 platform_admins 쓰기 권한을 가진다';
  end if;
end $$;
```

- [ ] **Step 4: 롤백 파일 생성** (`supabase/rollbacks/0011_authz_hardening_rollback.sql`)

```sql
-- 0011_authz_hardening 롤백 — 0010 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: supabase/rehearsal/compare-catalog.mjs diff,
-- pg_default_acl 대조 — 계획 docs/superpowers/plans/2026-09-27-h2-authz-hardening.md 의 리허설 R).
-- 절은 정방향의 역순이다(각 과제가 begin; 바로 아래에 자기 절을 끼웠다).
-- 데이터는 되돌리지 않는다: ④ 트리거가 null 로 만든 access_role, ⑤ 가드가 찍은 access_granted_by, ⑧ 가드가 덮어쓴 size·mime 은
-- 그대로 남는다(0010 규칙도 만족하는 값이다).

begin;

-- ① 마지막 슈퍼유저(a) — 트리거 제거, 세션 쓰기 권한·정책 복구(0003:641-645)
drop trigger platform_admins_keep_last on public.platform_admins;
drop function public.platform_admins_keep_last();
grant insert, update, delete, truncate on public.platform_admins to authenticated;
create policy platform_admins_write on public.platform_admins to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

commit;
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 오류 없이 0000~0011. `npm run test:rls -- tests/rls/h2-platform-admins.test.ts` → PASS. `npm run test:rls 2>&1 | tail -4` → 전체 초록(건너뜀 0). `npx vitest run tests/invariants/migration-files.test.ts` → PASS(롤백 쌍).

- [ ] **Step 6: 리허설 R** (Global Constraints 의 명령 전문) → 두 diff 불일치 0, defacl 차이 없음.

- [ ] **Step 7: `npm run dev:bootstrap`** → `✓ 플랫폼 관리자 …`(Global Constraints 의 비밀번호 규칙). 부트스트랩의 `platform_admins` upsert 가 새 트리거(같은 계정 행)를 통과함을 이것으로 본다. 커밋하지 않는다.

### Task 7: b — 쓰지 않는 표 권한 회수

항목: AUTH-12. 스펙 §6.2.0 b.

현행(실측, 0010): `authenticated` 가 TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 을 가진 public 표 40개, `anon` 이 REFERENCES·TRIGGER·MAINTAIN 을 가진 표 41개(40 + `people`). `postgres` 의 public 기본 권한(표): `anon=rxtm`, `authenticated=arwdDxtm`. 권한은 있는데 그 명령의 정책이 없는 (표, DML) 쌍이 13개 표에 있다(아래 목록 — 세 표는 정책이 하나도 없고 열 표는 일부 명령만 정책이 있다). `supabase_admin` 의 public 기본 권한도 `anon`·`authenticated` 에 `arwdDxtm` 을 주지만 `postgres` 는 그 롤의 구성원이 아니라 바꿀 수 없다(`pg_has_role('postgres','supabase_admin','member')` = f) — 마이그레이션은 `postgres` 로 표를 만들므로 영향이 없고, 범위 밖으로 기록한다. 함수의 PUBLIC EXECUTE 기본값도 범위 밖이다(스펙 b 마지막 불릿).

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(끝에 ②), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(`begin;` 아래에 ②)
- Create: `tests/rls/h2-table-grants.test.ts`

**Interfaces:**
- Produces: 불변식 "public 관계에 anon·authenticated 의 TRUNCATE·TRIGGER·REFERENCES·MAINTAIN 0", "postgres 기본 권한(표)에도 없다", "authenticated 가 가진 DML(INSERT·UPDATE 는 열 단위 포함, DELETE)마다 그 명령(또는 ALL)의 정책이 있다". 과제 16 의 사후검증이 마지막에 다시 본다.

- [ ] **Step 0: 목록 대조** — 아래 두 쿼리의 결과가 이 과제의 목록과 같은지 본다. 다르면 멈추고 보고한다(0010 이후 표가 늘었다).
```bash
docker exec supabase_db_d-flow psql -U postgres -Atc "select string_agg(relname, ' ' order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r' and has_table_privilege('authenticated', oid, 'TRUNCATE')"
docker exec supabase_db_d-flow psql -U postgres -Atc "select string_agg(relname, ' ' order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r' and has_table_privilege('anon', oid, 'TRIGGER')"
```
(DB 는 과제 6 뒤라 `platform_admins` 가 authenticated 목록에서 이미 빠져 있다 — 39개. 롤백 목록은 0010 기준 40개다.)

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-table-grants.test.ts`)

```ts
// H2-b(AUTH-12) — anon·authenticated 는 public 관계에서 truncate·trigger·references·maintain 이 없고(postgres 기본 권한 포함),
// 정책이 없는 DML 은 권한도 없다(명령 단위). 쓰이는 명령(change_logs INSERT·issue_assignees INSERT/DELETE 등)은 정책과 함께 남는다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const EXTRA = ['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']
/** authenticated 가 가진 DML 인데 그 명령(또는 ALL)의 정책이 없는 (표, 명령). INSERT·UPDATE 는 열 단위 권한도 센다. */
export const DML_WITHOUT_POLICY = `
  with t as (select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
       cmd(cmd) as (values ('INSERT'), ('UPDATE'), ('DELETE'))
  select t.relname::text as rel, cmd.cmd from t cross join cmd
   where (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[])
   order by 1, 2`

describe('H2-b 쓰지 않는 표 권한', () => {
  it('public 관계에서 anon·authenticated 의 truncate·trigger·references·maintain 0건', async () => {
    const { rows } = await pool.query(`
      select c.relname::text as rel, a.grantee::regrole::text as grantee, a.privilege_type as priv
        from pg_class c cross join lateral aclexplode(c.relacl) a
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and a.grantee in ('anon'::regrole, 'authenticated'::regrole) and a.privilege_type = any($1::text[])
       order by 1, 2, 3`, [EXTRA])
    expect(rows).toEqual([])
  })

  it('postgres 의 public 기본 권한(표)에도 없다', async () => {
    const { rows } = await pool.query(`
      select a.grantee::regrole::text as grantee, a.privilege_type as priv
        from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
         and a.grantee in ('anon'::regrole, 'authenticated'::regrole) and a.privilege_type = any($1::text[])`, [EXTRA])
    expect(rows).toEqual([])
  })

  it('민감도 — 새 표는 truncate·trigger 를 받지 않고 select 는 받는다(기본 권한이 실제로 바뀌었다)', async () => {
    await asService(pool, async (c) => {
      await c.query('create table public.rls_h2_probe (id int primary key)')
      const { rows: [r] } = await c.query(`select has_table_privilege('authenticated', 'public.rls_h2_probe', 'TRUNCATE') as t,
        has_table_privilege('authenticated', 'public.rls_h2_probe', 'SELECT') as s,
        has_table_privilege('anon', 'public.rls_h2_probe', 'TRIGGER') as a`)
      expect(r).toEqual({ t: false, s: true, a: false })
    })
  })

  it('authenticated 가 가진 DML 은 전부 그 명령의 정책이 있다(정책 없는 DML 권한 0)', async () => {
    expect((await pool.query(DML_WITHOUT_POLICY)).rows).toEqual([])
  })

  it('쓰이는 명령은 남는다 — change_logs INSERT, issue_assignees INSERT·DELETE, deliverable_attachments INSERT·DELETE, teams INSERT·UPDATE, minute_highlights INSERT·DELETE', async () => {
    const pairs: Array<[string, string]> = [
      ['change_logs', 'INSERT'], ['issue_assignees', 'INSERT'], ['issue_assignees', 'DELETE'],
      ['deliverable_attachments', 'INSERT'], ['deliverable_attachments', 'DELETE'],
      ['teams', 'INSERT'], ['teams', 'UPDATE'], ['minute_highlights', 'INSERT'], ['minute_highlights', 'DELETE'],
    ]
    const { rows } = await pool.query<{ t: string; p: string; ok: boolean }>(
      `select x.t, x.p, has_table_privilege('authenticated', ('public.' || x.t)::regclass, x.p) as ok
         from unnest($1::text[], $2::text[]) as x(t, p)`, [pairs.map((p) => p[0]), pairs.map((p) => p[1])])
    expect(rows.filter((r) => !r.ok).map((r) => `${r.t}:${r.p}`)).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-table-grants.test.ts` → 앞 넷 FAIL, 다섯째 PASS.

- [ ] **Step 3: 정방향 ② 를 끝에 덧붙인다**

```sql

-- ② 쓰지 않는 표 권한(b, AUTH-12) -------------------------------------------------------------------------------------
-- anon·authenticated 는 표를 truncate·trigger·references·maintain 할 일이 없다. 0000~0003 의 grant all(예 0003:633·643·656…)과
-- postgres 기본 권한(arwdDxtm)이 준 것이다. 기본 권한에서도 빼 새 표가 다시 받지 않게 한다. supabase_admin 의 기본 권한은
-- postgres 가 바꿀 수 없다(그 롤의 구성원이 아니다) — 마이그레이션은 postgres 로 표를 만들므로 영향이 없다.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- 권한은 있는데 그 명령의 정책이 없는 DML(RLS 가 늘 거부하는 명령)은 명령 단위로 회수한다. 쓰이는 명령은 정책이 있어 목록에 없다
-- (change_logs INSERT, issue_assignees INSERT·DELETE 등). SELECT 는 이 절의 대상이 아니다.
revoke insert, update, delete on public.agent_lead_leases from authenticated;
revoke insert, update, delete on public.agent_watchers from authenticated;
revoke update, delete on public.change_logs from authenticated;
revoke update on public.deliverable_attachments from authenticated;
revoke update on public.issue_assignees from authenticated;
revoke insert, update, delete on public.minute_embeddings from authenticated;
revoke update on public.minute_highlights from authenticated;
revoke insert, update, delete on public.minute_insights from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.project_ai_briefs from authenticated;
revoke delete on public.teams from authenticated;
revoke insert, update, delete on public.wbs_embeddings from authenticated;
revoke insert, update, delete on public.workspaces from authenticated;

do $$
declare v text;
begin
  select string_agg(format('%s:%s:%s', c.relname, a.grantee::regrole, a.privilege_type), ', ' order by 1) into v
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 표 권한이 남았다: %', left(v, 800); end if;
  select string_agg(format('%s:%s', a.grantee::regrole, a.privilege_type), ', ') into v
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 기본 권한이 남았다: %', v; end if;
end $$;
```

- [ ] **Step 4: 롤백 ② 를 `begin;` 바로 아래에 끼운다** (0010 목록 그대로)

```sql
-- ② 쓰지 않는 표 권한(b) — 0010 의 권한 목록으로 복구(anon 41표 x·t·m, authenticated 40표 D·x·t·m, 명령 단위 DML 13표, 기본 권한)
grant insert, update, delete on public.agent_lead_leases to authenticated;
grant insert, update, delete on public.agent_watchers to authenticated;
grant update, delete on public.change_logs to authenticated;
grant update on public.deliverable_attachments to authenticated;
grant update on public.issue_assignees to authenticated;
grant insert, update, delete on public.minute_embeddings to authenticated;
grant update on public.minute_highlights to authenticated;
grant insert, update, delete on public.minute_insights to authenticated;
grant insert, delete on public.profiles to authenticated;
grant insert, update, delete on public.project_ai_briefs to authenticated;
grant delete on public.teams to authenticated;
grant insert, update, delete on public.wbs_embeddings to authenticated;
grant insert, update, delete on public.workspaces to authenticated;
grant truncate, references, trigger, maintain on
  public.agent_lead_leases, public.agent_watchers, public.announcement_seen, public.announcements, public.area_teams,
  public.attendance_records, public.change_logs, public.deliverable_attachments, public.holidays, public.issue_assignees,
  public.issues, public.item_owners, public.llm_config, public.llm_profiles, public.meeting_attendees, public.meeting_exceptions,
  public.meetings, public.minute_embeddings, public.minute_favorites, public.minute_folders, public.minute_highlights,
  public.minute_insights, public.platform_admins, public.profiles, public.project_ai_briefs, public.project_areas,
  public.project_member_teams, public.project_members, public.projects, public.task_dependencies, public.teams,
  public.user_preferences, public.user_wbs_state, public.wbs_embeddings, public.wbs_items, public.wbs_progress_snapshots,
  public.weekly_report_rows, public.weekly_reports, public.workspace_members, public.workspaces
  to authenticated;
grant references, trigger, maintain on
  public.agent_lead_leases, public.agent_watchers, public.announcement_seen, public.announcements, public.area_teams,
  public.attendance_records, public.change_logs, public.deliverable_attachments, public.holidays, public.issue_assignees,
  public.issues, public.item_owners, public.llm_config, public.llm_profiles, public.meeting_attendees, public.meeting_exceptions,
  public.meetings, public.minute_embeddings, public.minute_favorites, public.minute_folders, public.minute_highlights,
  public.minute_insights, public.people, public.platform_admins, public.profiles, public.project_ai_briefs, public.project_areas,
  public.project_member_teams, public.project_members, public.projects, public.task_dependencies, public.teams,
  public.user_preferences, public.user_wbs_state, public.wbs_embeddings, public.wbs_items, public.wbs_progress_snapshots,
  public.weekly_report_rows, public.weekly_reports, public.workspace_members, public.workspaces
  to anon;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to authenticated;
alter default privileges for role postgres in schema public grant references, trigger, maintain on tables to anon;
```
(① 의 롤백이 `platform_admins` 에 truncate 를 다시 주므로 두 절이 겹쳐도 멱등이다.)

- [ ] **Step 5: 쓰는 경로 점검** — 세션 클라이언트가 회수한 명령을 쓰는지 본다. 아래가 전부 admin 클라이언트(`admin.`) 또는 0건이어야 한다. 세션 경로가 나오면 멈추고 보고한다.
```bash
grep -rnE "from\('(agent_lead_leases|agent_watchers|minute_embeddings|minute_insights|project_ai_briefs|wbs_embeddings|workspaces)'\)\s*\.(insert|update|upsert|delete)" src
grep -rnE "from\('(change_logs|deliverable_attachments|issue_assignees|minute_highlights)'\)\s*\.(update|upsert)" src
grep -rnE "from\('teams'\)\s*\.delete|from\('profiles'\)\s*\.(insert|delete|upsert)" src
```
(여러 줄 체인은 `grep -A2 "from('<표>')"` 로 한 번 더 본다. 조사 시점 `bdbcfac` 에서 세션 쓰기는 없었다 — `agent/watch/route.ts`·`ai/ingest.ts`·`ai/minutes-insights.ts` 는 admin.)

- [ ] **Step 6: 적용·통과** — `npm run db:reset` → `npm run test:rls -- tests/rls/h2-table-grants.test.ts` PASS → `npm run test:rls 2>&1 | tail -4` 초록(특히 `workspace-isolation.test.ts` 의 전수 교차 — 회수한 명령의 update·delete 탐침이 42501 로 끝나야 한다).

- [ ] **Step 7: 리허설 R** → 불일치 0. 불일치가 GRANT 줄이면 Step 0 목록과 롤백 목록을 대조한다.

- [ ] **Step 8: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 8: c — `minutes.share_token` 열 권한

항목: AUTH-10a. 스펙 §6.2.0 c. 코드는 과제 1 이 먼저 바꿨다.

현행: `authenticated` 는 `minutes` 에 표 SELECT(`r`)만 있고(쓰기는 service_role), 정책 `minutes_ws_read` 가 행 전체를 연다 — `has_column_privilege('authenticated','public.minutes','share_token','SELECT')` = t. 열은 19개(`id … workspace_id`), anon 은 권한이 없다. Realtime 발행에 `minutes` 가 없고(`pg_publication_tables` 는 `weekly_report_rows` 뿐), public 뷰가 없고, `minutes` 를 읽는 INVOKER 함수를 authenticated 가 실행할 수 없음을 확인했다.

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(③), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(③)
- Create: `tests/rls/h2-share-token.test.ts`

**Interfaces:**
- Produces: `minutes` 의 authenticated 권한 = `share_token` 을 뺀 18열의 열 단위 SELECT. 불변식 "share_token 외 모든 열은 grant" (SP5 가 열을 더하면 이 테스트가 grant 누락을 잡는다).

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-share-token.test.ts`)

```ts
// H2-c(AUTH-10a) — 회의록을 읽는 멤버도 share_token 은 읽지 못한다(42501). 나머지 열은 그대로 읽고, 다른 표의 정책이 minutes 를
// 서브쿼리로 읽어도 깨지지 않는다. 새 열을 더하고 grant 를 잊으면 불변식이 잡는다. 토큰은 서버 경로(service_role)만 읽고 쓴다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

describe('H2-c minutes.share_token 열 권한', () => {
  it('회의록을 읽는 멤버(alice)도 share_token·* 는 42501, 나머지 열은 읽는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, 'select share_token from public.minutes where id = $1', [F.rows.minute])).toMatchObject({ code: '42501' })
      expect(await pgError(c, 'select * from public.minutes where id = $1', [F.rows.minute])).toMatchObject({ code: '42501' })
      const { rows } = await c.query(
        'select id, title, body_md, share_enabled, archived_at, project_id, workspace_id, created_by from public.minutes where id = $1',
        [F.rows.minute])
      expect(rows).toHaveLength(1)
    })
  })

  it('share_token 외 모든 열은 authenticated SELECT 가 있다 — 표 SELECT 는 없다', async () => {
    const { rows } = await pool.query<{ col: string; ok: boolean }>(
      `select a.attname::text as col, has_column_privilege('authenticated', 'public.minutes'::regclass, a.attname, 'SELECT') as ok
         from pg_attribute a where a.attrelid = 'public.minutes'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`)
    expect(rows.length).toBeGreaterThanOrEqual(19)
    expect(rows.filter((r) => r.col !== 'share_token' && !r.ok).map((r) => r.col)).toEqual([])
    expect(rows.find((r) => r.col === 'share_token')?.ok).toBe(false)
    const { rows: [t] } = await pool.query(
      `select has_table_privilege('authenticated', 'public.minutes', 'SELECT') as auth, has_table_privilege('anon', 'public.minutes', 'SELECT') as anon`)
    expect(t).toEqual({ auth: false, anon: false })
  })

  it('다른 표의 정책이 minutes 를 읽어도 42501 이 나지 않는다(첨부·하이라이트·인사이트·즐겨찾기 읽기)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      for (const t of ['minute_files', 'minute_highlights', 'minute_insights', 'minute_favorites']) {
        expect(await pgError(c, `select 1 from public.${t} where minute_id = $1`, [F.rows.minute]), t).toBeNull()
      }
    })
  })

  it('서버 경로(service_role)는 share_token 을 읽고 쓴다 — 편집자의 공개 설정 경로', async () => {
    await asService(pool, async (c) => {
      const TOKEN = '00000000-0000-0000-7e57-000000001210'
      await c.query('update public.minutes set share_token = $2, share_enabled = true where id = $1', [F.rows.minute, TOKEN])
      expect((await c.query('select share_token from public.minutes where id = $1', [F.rows.minute])).rows[0].share_token).toBe(TOKEN)
    })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-share-token.test.ts` → 첫째·둘째 FAIL.

- [ ] **Step 3: 정방향 ③**

```sql

-- ③ minutes.share_token 열 권한(c, AUTH-10a) --------------------------------------------------------------------------
-- minutes_ws_read 가 행 전체를 열어 회의록을 읽는 멤버가 공개 토큰을 읽었다(편집자 전용 공개 게이트 setMinuteShare 우회). 표 SELECT 를
-- 걷고 share_token 을 뺀 열에만 준다. 토큰은 서버 경로(readShareRow 의 service_role, 공개 페이지)만 읽는다.
-- minutes 에 열을 더하는 마이그레이션은 그 열의 grant select 를 함께 적는다(tests/rls/h2-share-token.test.ts 불변식이 잡는다).
revoke select on public.minutes from authenticated;
grant select (id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at,
              share_enabled, external_id, body_preview, folder_id, project_id, meeting_occurrence_date, archived_at, workspace_id)
  on public.minutes to authenticated;

do $$
declare v text;
begin
  if has_table_privilege('authenticated', 'public.minutes', 'SELECT')
     or has_column_privilege('authenticated', 'public.minutes', 'share_token', 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 minutes.share_token 을 읽는다';
  end if;
  select string_agg(a.attname, ', ') into v from pg_attribute a
   where a.attrelid = 'public.minutes'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'share_token'
     and not has_column_privilege('authenticated', 'public.minutes', a.attname, 'SELECT');
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: minutes 열 grant 누락: %', v; end if;
end $$;
```

- [ ] **Step 4: 롤백 ③ 을 `begin;` 아래에**

```sql
-- ③ minutes 열 권한(c) — 열 단위 grant 를 걷고 표 SELECT 를 되돌린다(열 grant 가 남으면 카탈로그가 다르다)
revoke select (id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at,
               share_enabled, external_id, body_preview, folder_id, project_id, meeting_occurrence_date, archived_at, workspace_id)
  on public.minutes from authenticated;
grant select on public.minutes to authenticated;
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 이 파일 PASS → 전체 `test:rls` 초록 → `npx vitest run tests/invariants/minutes-select-columns.test.ts` PASS.

- [ ] **Step 6: 리허설 R** → 불일치 0.

- [ ] **Step 7: 런타임 확인(선택이 아니다 — 세션 화면의 42501 은 테스트가 못 본다)** — `npm run dev -- -p 3101` 을 띄우고 부트스트랩 계정으로 `/minutes`(목록)·회의록 상세·공유 모달(토큰 발급/해제)·`/api/minutes/export` 를 한 번씩 연다. 서버 로그에 `permission denied for table minutes` 가 0건이어야 한다. 끝나면 `lsof -iTCP:3101 -sTCP:LISTEN` 의 pid 를 kill 한다. (포트 3000 은 사용자 것이다.)

- [ ] **Step 8: `npm run dev:bootstrap`**(Step 7 전에 이미 돌렸다면 생략). 커밋하지 않는다.

### Task 9: d — 소속 회수가 권한 소멸이 되게

항목: AUTH-01b. 스펙 §6.2.0 d. 코드는 과제 3 이 먼저 바꿨다.

현행: `workspace_members` 의 트리거는 `workspace_members_keep_last_admin` 하나(0008 판). 소속을 지워도 그 워크스페이스 명단 행의 `access_role` 이 남고, 재초대(`consume_project_invite`, `0008_workspace_settings.sql:96-110` 의 admin > member > null 최대값)가 옛 admin 을 되살린다. `upsert_project_member`(`0004_upsert_member_keep_name.sql:44-53` ①)의 명단 admin 분기에 소속 검사가 없다. `authenticated` 는 `workspace_members` 에 표 UPDATE 전체가 있다(정책 `workspace_members_write` ALL `is_ws_admin`). 실측 0010: 사전 검사 대상(소속 없는 계정의 명단 권한)은 0행.

"컬럼 권한은 `grant update(role)` 만 남긴다"(스펙 d 네 번째 불릿)는 `workspace_members` 로 해석한다 — 세션이 `user_id`·`workspace_id` 를 바꿔 새 트리거 경로를 우회하거나 `invited_by` 를 위조하지 못하게 한다(앱의 세션 쓰기는 없다 — `accounts.ts` 는 admin).

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(④), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(④)
- Create: `tests/rls/h2-membership.test.ts`

**Interfaces:**
- Produces: 트리거 함수 `public.workspace_members_revoke_access()`(DEFINER), 트리거 `workspace_members_revoke_access AFTER DELETE OR UPDATE OF user_id, workspace_id`. `project_members_no_self_demote` 에 `is_ws_member` 조건. `workspace_members` 의 authenticated UPDATE 는 `(role)` 열만. `upsert_project_member` ①·개명 분기에 호출자 소속 조건. 사전 검사 오류 `AUTHZ_0011_PRECHECK`(23514).
- 사전 검사가 raise 하면(운영자 절차): 마이그레이션은 아무것도 바꾸지 않고 멈춘다. 오류가 명단 행 id 를 보여 준다. 사람이 행마다 정한다 — 권장은 `update public.project_members set access_role = null where id in (…)`(소속이 없는 사람의 권한은 0009 부터 SQL 에서 이미 무효다) 또는 그 사람을 워크스페이스에 다시 넣는 것. 정리한 SQL 을 기록으로 남기고 다시 적용한다. 마이그레이션이 대신 보정하지 않는다.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-membership.test.ts`)

```ts
// H2-d(AUTH-01b) — 워크스페이스에서 빠지면 그 워크스페이스 명단 행의 access_role 이 null 이 된다(행은 남는다). 재초대는 재초대한
// 프로젝트만 되살린다. 계정 삭제 캐스케이드·본인 세션(claims)에서의 소속 삭제가 새 사슬(트리거 → 명단 가드 → no_self_demote)에
// 막히지 않는다. upsert_project_member 는 소속 없는 명단 admin 을 호출자로 받지 않는다. 세션은 workspace_members 의 role 만 고친다.
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const roleOf = async (c: PoolClient, memberId: string) =>
  (await c.query<{ r: string | null }>('select access_role as r from public.project_members where id = $1', [memberId])).rows[0]?.r
const DANA_B = '00000000-0000-0000-7e57-000000001220'   // dana 의 A 워크스페이스 프로젝트 b(c2) 명단 행
const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`

describe('H2-d 소속 회수 = 권한 소멸', () => {
  it('워크스페이스에서 빠지면 그 워크스페이스 명단 행은 남고 access_role 만 null — 다른 워크스페이스 명단은 그대로', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`,
        [DANA_B, F.projects.b, F.people.dualA])
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
      expect(await roleOf(c, F.members.danaA)).toBeNull()
      expect(await roleOf(c, DANA_B)).toBeNull()
      expect(await roleOf(c, F.members.danaB)).toBe('member')
      expect((await c.query<{ n: number }>('select count(*)::int as n from public.project_members where id = any($1::uuid[])',
        [[F.members.danaA, DANA_B]])).rows[0].n).toBe(2)
    })
  })

  it('재가입(done_when): 빠졌다 member 로 재초대되면 재초대한 프로젝트만 member, 같은 워크스페이스 다른 프로젝트는 null — 옛 admin 이 되살아나지 않는다', async () => {
    await asService(pool, async (c) => {
      // alice: A 의 프로젝트 a 관리자, b·c3 멤버. A 에서 빠진 뒤 a 에 member 로 재초대
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      const hash = sha256('rls-h2-rejoin')
      await c.query(`insert into public.project_invites (workspace_id, project_id, email, access_role, token_hash, created_by, expires_at)
        values ($1, $2, 'rls-alice@example.com', 'member', $3, $4, now() + interval '1 day')`, [F.ws, F.projects.a, hash, F.users.wsAdmin])
      const r = await c.query('select * from public.consume_project_invite($1, $2, $3)', [hash, 'rls-alice@example.com', F.users.member])
      expect(r.rows).toEqual([{ workspace_id: F.ws, project_id: F.projects.a, member_id: F.members.aliceA }])
      expect(await roleOf(c, F.members.aliceA)).toBe('member')
      expect(await roleOf(c, F.members.aliceB)).toBeNull()
      expect(await roleOf(c, F.members.alicePrivate)).toBeNull()
    })
  })

  it('소속의 user_id·workspace_id 를 바꾸는 UPDATE(service 경로)도 옛 워크스페이스 권한을 지운다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.workspace_members set workspace_id = $3 where workspace_id = $1 and user_id = $2',
        [F.ws, F.users.member, F.wsB])
      expect(await roleOf(c, F.members.aliceA)).toBeNull()
      expect(await roleOf(c, F.members.aliceB)).toBeNull()
    })
  })

  it('Review Focus 3 — 계정 삭제(auth.users) 캐스케이드가 새 사슬에 막히지 않는다(계정 생성 보상 롤백 경로)', async () => {
    await asService(pool, async (c) => {
      const U = '00000000-0000-0000-7e57-000000001221', PE = '00000000-0000-0000-7e57-000000001222', PM = '00000000-0000-0000-7e57-000000001223'
      await c.query(INSERT_AUTH_USER, [U, 'rls-h2-gone@example.com'])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U])
      await c.query(`insert into public.people (id, workspace_id, display_name, email, user_id) values ($1, $2, 'gone', 'rls-h2-gone@example.com', $3)`,
        [PE, F.ws, U])
      await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`, [PM, F.projects.a, PE])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect(await roleOf(c, PM)).toBeNull()
    })
  })

  it('본인 claims 인 채 소속이 지워져도(0009 ⓐ 와 같은 순서) no_self_demote 가 막지 않는다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await c.query('reset role')
      expect(await pgError(c, 'delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])).toBeNull()
      expect(await roleOf(c, F.members.danaA)).toBeNull()
    })
  })

  it('소속이 있는 본인의 강등은 여전히 PROJECT_MEMBER_SELF_DEMOTE', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')   // postgres 로 RLS 를 건너 트리거만 본다(claims = alice)
      expect(await pgError(c, 'update public.project_members set access_role = null where id = $1', [F.members.aliceA]))
        .toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_SELF_DEMOTE' })
    })
  })

  it('upsert_project_member: 소속 없는 명단 admin(사전 검사가 막는 잔존 상태를 강제로 만든 것)은 호출자가 될 수 없다', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      await c.query('set local session_replication_role = replica')   // 트리거를 끄고 잔존 admin 을 되살린다
      await c.query(`update public.project_members set access_role = 'admin' where id = $1`, [F.members.aliceA])
      await c.query('set local session_replication_role = origin')
      expect(await pgError(c, 'select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null)', [
        F.users.member, F.projects.a, JSON.stringify({ id: F.people.external }), JSON.stringify({ role_label: 'x' }),
      ])).toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_FORBIDDEN' })
    })
  })

  it('세션은 workspace_members 의 role 만 고친다 — user_id·workspace_id·invited_by 는 42501', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
        [F.ws, F.users.aLoose])).toBeNull()
      for (const col of ['user_id', 'workspace_id', 'invited_by']) {
        expect(await pgError(c, `update public.workspace_members set ${col} = ${col} where workspace_id = $1 and user_id = $2`,
          [F.ws, F.users.aLoose]), col).toMatchObject({ code: '42501' })
      }
    })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-membership.test.ts` → 1·2·3·4(역할이 남는다)·7(FORBIDDEN 이 아니라 성공)·8(`user_id` 갱신 통과) FAIL. 5·6 은 이미 통과할 수 있다(트리거가 아직 없어서) — 트리거를 더한 뒤에도 통과해야 한다.

- [ ] **Step 3: 정방향 ④**

`upsert_project_member` 본문은 계획에 옮겨 적지 않는다. `sed -n '15,172p' supabase/migrations/0004_upsert_member_keep_name.sql` 출력을 그대로 붙인 뒤 두 곳만 바꾼다(첫 줄은 이미 `create or replace function` 이다).

바꿀 곳 1 — ① 호출자 등급(0004:48-53):
```sql
  if not v_ws_admin and not exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin') then
```
→
```sql
  -- 명단 admin 은 그 워크스페이스 소속일 때만 호출자 자격이다(0011 H2-d) — 소속 회수 뒤 남은 admin 행으로 명단을 쓰지 못한다
  if not v_ws_admin and not (
       exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor)
       and exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin')) then
```
바꿀 곳 2 — 개명 분기(0004:69-75):
```sql
       and (v_ws_admin or exists (
             select 1 from public.project_members pm
              where pm.person_id = v_person_id
                and exists (select 1 from public.project_members apm join public.people ape on ape.id = apm.person_id
                             where apm.project_id = pm.project_id and ape.user_id = p_actor
                               and apm.active and ape.active and apm.access_role = 'admin'))) then
```
→
```sql
       and (v_ws_admin or (exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor)
            and exists (
             select 1 from public.project_members pm
              where pm.person_id = v_person_id
                and exists (select 1 from public.project_members apm join public.people ape on ape.id = apm.person_id
                             where apm.project_id = pm.project_id and ape.user_id = p_actor
                               and apm.active and ape.active and apm.access_role = 'admin')))) then
```
(개명 분기의 소속 조건은 ① 을 통과한 호출자에게 늘 참이다 — 스펙대로 두 곳에 두되 따로 시험하지 않는다.)

파일 끝에 덧붙일 ④ 전체:
```sql

-- ④ 소속 회수 = 권한 소멸(d, AUTH-01b) -------------------------------------------------------------------------------
-- ⓪ 사전 검사 — 소속이 없는데 권한이 남은 명단 행이 있으면 멈춘다(보정하지 않는다). 사람이 정리한 뒤 다시 적용한다.
do $$
declare
  v_n int;
  v_ids text;
begin
  select count(*), string_agg(pm.id::text, ', ' order by pm.id) into v_n, v_ids
    from public.project_members pm
    join public.people pe on pe.id = pm.person_id
    join public.projects p on p.id = pm.project_id
   where pm.access_role is not null and pe.user_id is not null
     and not exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id and m.user_id = pe.user_id);
  if v_n > 0 then
    raise exception 'AUTHZ_0011_PRECHECK: 소속 없는 계정의 명단 권한 %건(%) — access_role 을 null 로 하거나 소속을 되살린 뒤 다시 적용한다',
      v_n, left(v_ids, 400) using errcode = '23514';
  end if;
end $$;

-- 소속이 사라지면(삭제, 또는 user_id·workspace_id 변경) 그 워크스페이스 명단 행의 권한을 null 로 만든다. 행은 남긴다(이력·담당 FK).
-- 재초대(consume_project_invite)는 admin > member > null 의 최대값을 쓰므로 이것이 없으면 남은 admin 이 되살아났다(0008:96-110).
-- 인물은 워크스페이스 단위이고 명단 행의 인물·프로젝트는 같은 워크스페이스다(project_members_guard).
create function public.workspace_members_revoke_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.workspace_id = old.workspace_id then
    return null;
  end if;
  update public.project_members pm
     set access_role = null
   where pm.access_role is not null
     and pm.person_id in (select pe.id from public.people pe
                           where pe.user_id = old.user_id and pe.workspace_id = old.workspace_id);
  return null;
end
$$;
revoke all on function public.workspace_members_revoke_access() from public, anon, authenticated;
create trigger workspace_members_revoke_access after delete or update of user_id, workspace_id on public.workspace_members
  for each row execute function public.workspace_members_revoke_access();

-- 본인 강등 금지는 소속이 있는 세션 사용자에게만 — 위 트리거의 갱신이 본인 claims 에서 일어나도(소속이 이미 지워진 뒤) 막지 않는다.
-- 이 조건이 없으면 tests/rls/workspace-isolation-cases.test.ts ⓐ·ⓐ′(소속 삭제)가 PROJECT_MEMBER_SELF_DEMOTE 로 깨진다.
create or replace function public.project_members_no_self_demote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or old.access_role is null then
    return new;
  end if;
  if (new.access_role is null
      or (old.access_role = 'admin' and new.access_role = 'member')
      or (old.active and not new.active))
     and exists (select 1 from public.people pe where pe.id = old.person_id and pe.user_id = auth.uid())
     and not public.is_ws_admin(public.project_ws(old.project_id))
     and public.is_ws_member(public.project_ws(old.project_id)) then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  return new;
end
$$;

-- 세션은 소속의 등급만 바꾼다 — user_id·workspace_id 를 바꿔 소속을 옮기거나 invited_by 를 쓰지 못한다
revoke update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;

<sed -n '15,172p' supabase/migrations/0004_upsert_member_keep_name.sql 출력 — 위 두 곳만 바꾼 판>
revoke all on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) to service_role;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'workspace_members_revoke_access' and tgrelid = 'public.workspace_members'::regclass) then
    raise exception 'AUTHZ_0011_POSTCHECK: workspace_members_revoke_access 트리거가 없다';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.workspace_members', 'role', 'UPDATE') then
    raise exception 'AUTHZ_0011_POSTCHECK: workspace_members UPDATE 권한이 role 열만이 아니다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[])'::regprocedure)
     !~ 'workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor' then
    raise exception 'AUTHZ_0011_POSTCHECK: upsert_project_member 에 호출자 소속 조건이 없다';
  end if;
end $$;
```
(`<sed … 출력>` 줄은 설명이다 — 파일에는 실제 본문을 넣는다.)

- [ ] **Step 4: 롤백 ④ 를 `begin;` 아래에**

```sql
-- ④ 소속 회수(d) — 트리거 제거, workspace_members UPDATE 복구(열 grant 를 먼저 걷는다), 두 함수를 0010 원문으로
drop trigger workspace_members_revoke_access on public.workspace_members;
drop function public.workspace_members_revoke_access();
revoke update (role) on public.workspace_members from authenticated;
grant update on public.workspace_members to authenticated;
<sed -n '436,451p' supabase/migrations/0003_org_core.sql 출력 — 첫 줄의 create function 만 create or replace function 으로>
<sed -n '15,172p' supabase/migrations/0004_upsert_member_keep_name.sql 출력 그대로>
revoke all on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) to service_role;
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 이 파일 PASS → 전체 `test:rls` 초록(특히 `workspace-isolation-cases.test.ts` ⓐ·ⓐ′, `org-core.test.ts` ⑤·⑦·⑩·⑪, `workspace-settings.test.ts` ⑥~⑧).

- [ ] **Step 6: 리허설 R** → 불일치 0.

- [ ] **Step 7: 사전 검사 리허설** — 사전 검사가 실제로 raise 하는지 본다(과제 16 도 다시 한다).
```bash
supabase db reset --version 0010
docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-7e57-0000000012f0', 'rls-h2-precheck', 'H2 사전검사');
insert into public.projects (id, name, workspace_id) values ('00000000-0000-0000-7e57-0000000012f1', 'H2 사전검사', '00000000-0000-0000-7e57-0000000012f0');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  values ('00000000-0000-0000-7e57-0000000012f2', 'rls-h2-precheck@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.people (id, workspace_id, display_name, email, user_id)
  values ('00000000-0000-0000-7e57-0000000012f3', '00000000-0000-0000-7e57-0000000012f0', 'precheck', 'rls-h2-precheck@example.com', '00000000-0000-0000-7e57-0000000012f2');
insert into public.project_members (project_id, person_id, access_role)
  values ('00000000-0000-0000-7e57-0000000012f1', '00000000-0000-0000-7e57-0000000012f3', 'member');
SQL
supabase migration up --local
npm run db:reset
```
Expected: `supabase migration up --local` 이 `AUTHZ_0011_PRECHECK: 소속 없는 계정의 명단 권한 1건(…)` 으로 실패하고 0011 이 적용되지 않는다. 마지막 `db:reset` 이 깨끗한 0011 로 되돌린다.

- [ ] **Step 8: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 10: e — `access_granted_*` 열은 세션이 쓰지 못한다 (선택 동승)

항목: AUTH-09a. 스펙 §6.2.0 e(선택 동승 — 컨트롤러가 빼기로 하면 이 과제의 두 파일 절과 테스트 파일만 건너뛰면 된다. 다른 과제는 이 절에 기대지 않는다).

현행: `authenticated` 는 `project_members` 에 표 INSERT(`a`)와 열 UPDATE 8개(`0006_workspace_isolation.sql:506-508`, `access_granted_by`·`access_granted_at` 포함)를 가진다. `project_members_guard`(`0003_org_core.sql:396-429`)는 `access_granted_at` 만 찍고 `access_granted_by` 는 액션·RPC 가 넣는다 — 세션이 이 값을 위조할 수 있다. 앱의 세션 쓰기는 없다(`roster.ts` 는 삭제만, 명단 쓰기는 RPC).

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑤), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑤)
- Create: `tests/rls/h2-access-granted.test.ts`

**Interfaces:**
- Produces: `project_members` 의 authenticated INSERT 는 열 목록(`id, project_id, title, created_at, role_label, person_id, access_role, active, sort_order, updated_at`), UPDATE 에서 `access_granted_by`·`access_granted_at` 제외. `project_members_guard` 가 세션 경로(auth.uid() not null)에서 역할이 바뀔 때만 `access_granted_by := auth.uid()`. service_role 경로·FK SET NULL 은 건드리지 않는다. `invited_by` 는 SP3a(`authz_events`)로 넘긴다.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-access-granted.test.ts`)

```ts
// H2-e(AUTH-09a) — 세션은 access_granted_by·access_granted_at 을 직접 쓰지 못한다(열 권한). 세션에서 역할이 바뀌면 부여자는 그 세션
// 사용자로 찍히고, 역할이 그대로면 찍지 않는다. service_role 경로(RPC)는 호출부가 준 p_actor 를 그대로 두고, 발급자 계정 삭제의
// SET NULL 은 막지 않는다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

describe('H2-e access_granted_*', () => {
  it('세션은 access_granted_by·access_granted_at 을 UPDATE·INSERT 로 쓰지 못한다(42501)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, 'update public.project_members set access_granted_by = $2 where id = $1', [F.members.danaA, F.users.wsAdmin]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, 'update public.project_members set access_granted_at = now() where id = $1', [F.members.danaA]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, `insert into public.project_members (project_id, person_id, access_role, access_granted_by) values ($1, $2, 'member', $3)`,
        [F.projects.b, F.people.aLoose, F.users.member])).toMatchObject({ code: '42501' })
    })
  })

  it('세션에서 역할이 바뀌면 부여자 = 세션 사용자(INSERT·UPDATE), 역할이 그대로면 찍지 않는다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const up = await c.query<{ by: string }>(`update public.project_members set access_role = 'admin' where id = $1 returning access_granted_by as by`,
        [F.members.danaA])
      expect(up.rows).toEqual([{ by: F.users.wsAdmin }])
      const ins = await c.query<{ by: string }>(
        `insert into public.project_members (project_id, person_id, access_role) values ($1, $2, 'member') returning access_granted_by as by`,
        [F.projects.b, F.people.aLoose])
      expect(ins.rows).toEqual([{ by: F.users.wsAdmin }])
      const same = await c.query<{ by: string | null }>(`update public.project_members set title = 'rls' where id = $1 returning access_granted_by as by`,
        [F.members.bobA])
      expect(same.rows).toEqual([{ by: null }])
    })
  })

  it('service_role 경로(RPC)는 p_actor 를 부여자로 둔다 — 가드가 덮지 않는다', async () => {
    await asService(pool, async (c) => {
      const { rows: [r] } = await c.query<{ id: string }>('select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null) as id', [
        F.users.wsAdmin, F.projects.a, JSON.stringify({ id: F.people.aLoose }), JSON.stringify({ access_role: 'member' }),
      ])
      expect((await c.query('select access_granted_by as by from public.project_members where id = $1', [r.id])).rows[0].by).toBe(F.users.wsAdmin)
    })
  })

  it('발급자 계정 삭제의 SET NULL 은 막지 않는다', async () => {
    await asService(pool, async (c) => {
      const G = '00000000-0000-0000-7e57-000000001230'
      await c.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role,
        instance_id, created_at, updated_at) values ($1, 'rls-h2-g2@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())`, [G])
      await c.query('update public.project_members set access_granted_by = $2 where id = $1', [F.members.danaA, G])
      expect(await pgError(c, 'delete from auth.users where id = $1', [G])).toBeNull()
      expect((await c.query('select access_granted_by as by from public.project_members where id = $1', [F.members.danaA])).rows[0].by).toBeNull()
    })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-access-granted.test.ts` → 첫째(쓰기 통과)·둘째(부여자 null) FAIL.

- [ ] **Step 3: 정방향 ⑤**

```sql

-- ⑤ access_granted_* 열(e, AUTH-09a, 선택 동승) --------------------------------------------------------------------------
-- 세션이 부여자·부여 시각을 위조하지 못하게 열 권한을 걷고, 세션 경로의 부여자는 가드가 auth.uid() 로 찍는다(0008 ③ 이
-- project_invites.created_by 를 불변으로 만든 목적과 같다). service_role 경로(auth.uid() null)는 RPC 가 넘긴 p_actor 를 그대로 두고,
-- 발급자 계정 삭제의 FK SET NULL 은 역할이 바뀌지 않는 UPDATE 라 건드리지 않는다. invited_by 는 SP3a(authz_events)로 넘긴다.
revoke update (access_granted_by, access_granted_at) on public.project_members from authenticated;
revoke insert on public.project_members from authenticated;
grant insert (id, project_id, title, created_at, role_label, person_id, access_role, active, sort_order, updated_at)
  on public.project_members to authenticated;

create or replace function public.project_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person_ws uuid;
  v_person_user uuid;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    -- 담당 FK 가 (id, project_id) 복합이라 바꾸면 FK 가 깨진다
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PROJECT_IMMUTABLE';
  end if;

  select pe.workspace_id, pe.user_id into v_person_ws, v_person_user
    from public.people pe where pe.id = new.person_id;
  if found then
    if new.access_role is not null and v_person_user is null then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
    end if;
    if v_person_ws is distinct from public.project_ws(new.project_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  end if;
  -- 인물이 없으면 person_id FK 가 거부한다

  if tg_op = 'INSERT' then
    new.access_granted_at := case when new.access_role is not null then now() end;
    -- 세션 경로의 부여자는 세션 사용자다(0011 H2-e). service_role 경로는 RPC 가 넣은 값을 둔다.
    if auth.uid() is not null then
      new.access_granted_by := case when new.access_role is not null then auth.uid() end;
    end if;
  else
    if new.access_role is distinct from old.access_role then
      new.access_granted_at := now();
      if auth.uid() is not null then
        new.access_granted_by := auth.uid();
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
```

- [ ] **Step 4: 롤백 ⑤ 를 `begin;` 아래에**

```sql
-- ⑤ access_granted_*(e) — 열 INSERT 를 걷고 표 INSERT·열 UPDATE 를 되돌린다, 가드를 0010 원문으로
revoke insert (id, project_id, title, created_at, role_label, person_id, access_role, active, sort_order, updated_at)
  on public.project_members from authenticated;
grant insert on public.project_members to authenticated;
grant update (access_granted_by, access_granted_at) on public.project_members to authenticated;
<sed -n '396,429p' supabase/migrations/0003_org_core.sql 출력 — 첫 줄의 create function 만 create or replace function 으로>
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 이 파일 PASS → 전체 `test:rls` 초록(`workspace-isolation.test.ts` 의 복사 insert 가 INSERT 가능 열로만 만든다 — `TABLES_SQL` 이 열 권한을 읽는다).

- [ ] **Step 6: 리허설 R** → 불일치 0.

- [ ] **Step 7: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 11: f — `can_manage_minute` 를 앱 `canEditMinute` 와 맞춘다 (+ 패리티 표)

항목: P8-H2-3. 스펙 §6.2.0 f, §8.2 ③.

현행: `can_manage_minute`(`0007_storage_realtime.sql:116-123`)는 작성자면 멤버 여부와 무관하게 참이다(AUTH-02 의 SQL 쪽 절반). 앱 `canEditMinute`(`src/lib/domain/authz.ts:114-117`) = 범위 멤버(`isMinuteMember` :105-107) ∧ (작성자 ∨ 프로젝트 관리자 이상). 무프로젝트 회의록은 앱이 슈퍼유저만, SQL 은 워크스페이스 관리자에게도 연다(AUTH-11 — 유지).

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑥), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑥)
- Create: `tests/rls/h2-actor.ts`, `tests/rls/h2-minute-manage-parity.test.ts`
- Modify(test): `tests/rls/schema-invariants.test.ts:118-124`(`HELPER_FNS`)·`:154-167`(`DEFINER_EXECUTABLE`)

**Interfaces:**
- Consumes: 과제 3 의 규칙(소속 밖 명단 행 버림).
- Produces: `public.has_project_role_in_ws(wid uuid) returns boolean`(SQL, STABLE, DEFINER, `authenticated`·`service_role` EXECUTE — 정책 헬퍼 관례) = `authz.ts:210-217` `hasProjectRoleInWorkspace` 와 같은 판정. `can_manage_minute(p_minute uuid)` 시그니처·ACL 그대로, 본문만 바뀐다. `tests/rls/h2-actor.ts` 의 `actorFromDb(c: PoolClient, userId: string): Promise<Actor>` — 과제 12 도 쓸 수 있다.

- [ ] **Step 1: 헬퍼** (`tests/rls/h2-actor.ts`)

```ts
// buildActor(src/lib/authz/buildActor.ts)의 4축을 같은 조건의 SQL 로 읽어 Actor 를 만든다 — TS 판정(canEditMinute 등)과 SQL 헬퍼의
// 패리티 표에 쓴다. postgres 롤로 부른다(RLS 를 건너 전 행을 본다 — buildActor 가 user_id 필터로 하는 것과 같다).
import type { PoolClient } from 'pg'
import type { Actor, ProjectRole, WorkspaceRole } from '@/lib/domain/authz'

export async function actorFromDb(c: PoolClient, userId: string): Promise<Actor> {
  const q = async <T>(sql: string, p: unknown[] = []) => (await c.query<T>(sql, p)).rows
  const isSuperuser = (await q<{ n: number }>('select count(*)::int as n from public.platform_admins where user_id = $1', [userId]))[0].n === 1
  const ws = await q<{ workspace_id: string; role: WorkspaceRole }>(
    'select workspace_id, role from public.workspace_members where user_id = $1', [userId])
  const workspaceRoles = new Map(ws.map((r) => [r.workspace_id, r.role] as const))
  const projects = isSuperuser
    ? await q<{ id: string; workspace_id: string }>('select id, workspace_id from public.projects')
    : await q<{ id: string; workspace_id: string }>('select id, workspace_id from public.projects where workspace_id = any($1::uuid[])',
      [[...workspaceRoles.keys()]])
  const projectWorkspace = new Map(projects.map((p) => [p.id, p.workspace_id] as const))
  const roster = await q<{ id: string; project_id: string; access_role: ProjectRole | null }>(
    `select pm.id, pm.project_id, pm.access_role from public.project_members pm join public.people pe on pe.id = pm.person_id
      where pe.user_id = $1 and pe.active and pm.active`, [userId])
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  for (const r of roster) {
    if (!projectWorkspace.has(r.project_id)) continue   // buildActor 와 같은 규칙(H2 과제 3)
    memberIds.set(r.project_id, r.id)
    if (r.access_role) projectRoles.set(r.project_id, r.access_role)
  }
  return { userId, isSuperuser, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams: new Map() }
}
```

- [ ] **Step 2: 실패하는 테스트** (`tests/rls/h2-minute-manage-parity.test.ts`)

```ts
// H2-f(P8-H2-3) — SQL can_manage_minute 와 TS canEditMinute 의 패리티 표. 사용자 7명 × 회의록 10건(프로젝트·무프로젝트, 작성자
// 여러 명, 두 워크스페이스). 어긋나는 칸은 AUTH-11(무프로젝트 × 그 워크스페이스 관리자, 슈퍼유저 아님, SQL 만 참) 넷뿐이어야 한다
// (스펙 §8.2 ③). 보관된 회의록은 SQL 이 거부하고 앱은 checkOwner 가 따로 거부하므로 표에 넣지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canEditMinute } from '@/lib/domain/authz'
import { actorFromDb } from './h2-actor'
import { F, asUser, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const id = (n: number) => `00000000-0000-0000-7e57-00000000124${n}`
type M = { id: string; project: string | null; ws: string; author: string; label: string }
const MINUTES: M[] = [
  { id: F.rows.minute, project: F.projects.a, ws: F.ws, author: F.users.member, label: 'a·alice' },
  { id: F.rows.nullMinute, project: null, ws: F.ws, author: F.users.member, label: 'A_·alice' },
  { id: id(1), project: F.projects.a, ws: F.ws, author: F.users.dual, label: 'a·dana' },
  { id: id(2), project: F.projects.a, ws: F.ws, author: F.users.aLoose, label: 'a·cy' },
  { id: id(3), project: null, ws: F.ws, author: F.users.aLoose, label: 'A_·cy' },
  { id: id(4), project: null, ws: F.ws, author: F.users.dual, label: 'A_·dana' },
  { id: id(5), project: null, ws: F.ws, author: F.users.wsAdmin, label: 'A_·wsadmin' },
  { id: id(6), project: F.projects.b, ws: F.ws, author: F.users.member, label: 'b·alice' },
  { id: id(7), project: null, ws: F.wsB, author: F.users.bMember, label: 'B_·ben' },
  { id: id(8), project: F.projects.bWs, ws: F.wsB, author: F.users.dual, label: 'bWs·dana' },
]
const USERS: Array<[string, string]> = [
  ['platform', F.users.platform], ['wsadmin', F.users.wsAdmin], ['alice', F.users.member], ['cy', F.users.aLoose],
  ['dana', F.users.dual], ['bea', F.users.bAdmin], ['ben', F.users.bMember],
]

async function seedMinutes(c: PoolClient) {
  for (const m of MINUTES.slice(2)) {
    await c.query(`insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by)
      values ($1, $2, $3, '2026-09-27', 'ERP', $4, '# h2', $5)`, [m.id, m.project, m.ws, `H2 ${m.label}`, m.author])
  }
}

describe('H2-f can_manage_minute ↔ canEditMinute 패리티', () => {
  it('어긋나는 칸은 AUTH-11 넷뿐(무프로젝트 × 그 워크스페이스 관리자, SQL 만 참)', async () => {
    const cells: Array<{ user: string; minute: string; ts: boolean; sql: boolean }> = []
    for (const [label, uid] of USERS) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        await seedMinutes(c)
        const actor = await actorFromDb(c, uid)
        await c.query('set local role authenticated')
        for (const m of MINUTES) {
          const sql = (await c.query<{ ok: boolean }>('select public.can_manage_minute($1) as ok', [m.id])).rows[0].ok
          const ts = canEditMinute(actor, { created_by: m.author, project_id: m.project, workspace_id: m.ws })
          cells.push({ user: label, minute: m.label, ts, sql })
        }
      })
    }
    const mismatches = cells.filter((x) => x.ts !== x.sql).map((x) => `${x.user}×${x.minute}: ts=${x.ts} sql=${x.sql}`).sort()
    expect(mismatches).toEqual([
      'bea×B_·ben: ts=false sql=true',
      'wsadmin×A_·alice: ts=false sql=true',
      'wsadmin×A_·cy: ts=false sql=true',
      'wsadmin×A_·dana: ts=false sql=true',
    ])
    // 표가 비어 통과하지 않게 — 양성·음성이 모두 있어야 한다
    expect(cells.filter((x) => x.sql).length).toBeGreaterThan(10)
    expect(cells.filter((x) => !x.sql).length).toBeGreaterThan(10)
  })

  it('작성자라도 범위 멤버가 아니면 거짓 — 명단 없는 작성자(cy)는 자기 회의록(프로젝트·무프로젝트)을 관리하지 못한다', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role'); await seedMinutes(c); await c.query('set local role authenticated')
      const { rows } = await c.query<{ p: boolean; n: boolean }>('select public.can_manage_minute($1) as p, public.can_manage_minute($2) as n',
        [id(2), id(3)])
      expect(rows[0]).toEqual({ p: false, n: false })
    })
  })

  it('has_project_role_in_ws = hasProjectRoleInWorkspace — ws 관리자·명단 역할 있음 참, 명단 없는 멤버·다른 워크스페이스 거짓', async () => {
    const cases: Array<[string, string, boolean]> = [
      [F.users.wsAdmin, F.ws, true], [F.users.member, F.ws, true], [F.users.dual, F.ws, true],
      [F.users.aLoose, F.ws, false], [F.users.bAdmin, F.ws, false], [F.users.bAdmin, F.wsB, true], [F.users.platform, F.wsB, true],
    ]
    for (const [uid, wid, expected] of cases) {
      await asUser(pool, uid, async (c) => {
        expect((await c.query<{ ok: boolean }>('select public.has_project_role_in_ws($1) as ok', [wid])).rows[0].ok, `${uid} ${wid}`).toBe(expected)
      })
    }
  })

  it('보관된 회의록은 누구에게도 관리 대상이 아니다(SQL)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await c.query('reset role')
      await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      await c.query('set local role authenticated')
      expect((await c.query<{ ok: boolean }>('select public.can_manage_minute($1) as ok', [F.rows.minute])).rows[0].ok).toBe(false)
    })
  })
})
```
`schema-invariants.test.ts`: `HELPER_FNS` 에 `'public.has_project_role_in_ws(uuid)'`, `DEFINER_EXECUTABLE` 에 `'has_project_role_in_ws(uuid)': HELPER` 를 더한다.

- [ ] **Step 3: 실패 확인** — `npm run test:rls -- tests/rls/h2-minute-manage-parity.test.ts tests/rls/schema-invariants.test.ts` → 패리티(cy 칸이 어긋난다)·둘째(cy 참)·셋째(함수 없음)·스키마 불변식(목록의 함수 없음) FAIL.

- [ ] **Step 4: 정방향 ⑥**

```sql

-- ⑥ can_manage_minute = 앱 canEditMinute(f, P8-H2-3) ----------------------------------------------------------------
-- 앱 판정(authz.ts canEditMinute) = 범위 멤버 ∧ (작성자 ∨ 프로젝트 관리자 이상). SQL 은 작성자면 멤버 여부와 무관하게 참이었다
-- (AUTH-02 의 SQL 쪽 절반). 무프로젝트 회의록의 워크스페이스 관리자 칸은 유지한다 — 앱은 슈퍼유저만 여는 의도된 fail-closed
-- (SP1 §3.5)이고 SQL 이 더 넓다. 앱이 더 좁으므로 권한 확대가 없다(AUTH-11, 스펙 §8.2 ③ — 패리티 표의 유일한 예외).
-- has_project_role_in_ws = authz.ts hasProjectRoleInWorkspace: 워크스페이스 관리자(슈퍼유저 포함) 또는 그 워크스페이스 소속이면서
-- 그 워크스페이스 프로젝트의 활성 명단 행에 권한이 있음.
create function public.has_project_role_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or (public.is_ws_member(wid)
          and exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                        join public.projects p on p.id = pm.project_id
                       where p.workspace_id = wid and pe.user_id = auth.uid()
                         and pm.active and pe.active and pm.access_role is not null))
$$;
revoke all on function public.has_project_role_in_ws(uuid) from public, anon;
grant execute on function public.has_project_role_in_ws(uuid) to authenticated, service_role;

create or replace function public.can_manage_minute(p_minute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.minutes mi
                  where mi.id = p_minute and mi.archived_at is null
                    and mi.workspace_id in (select public.my_workspace_ids())
                    and case when mi.project_id is not null
                             then public.is_project_admin(mi.project_id)
                                  or (mi.created_by = auth.uid() and public.is_project_member(mi.project_id))
                             else public.is_superuser()
                                  or (mi.created_by = auth.uid() and public.has_project_role_in_ws(mi.workspace_id))
                                  or public.is_ws_admin(mi.workspace_id) end)
$$;
```

- [ ] **Step 5: 롤백 ⑥ 을 `begin;` 아래에**

```sql
-- ⑥ can_manage_minute(f) — 0007 원문으로, 새 헬퍼 제거(can_manage_minute 를 먼저 되돌려야 의존이 풀린다)
<sed -n '116,123p' supabase/migrations/0007_storage_realtime.sql 출력 — 첫 줄의 create function 만 create or replace function 으로>
drop function public.has_project_role_in_ws(uuid);
```

- [ ] **Step 6: 적용·통과** — `npm run db:reset` → 두 파일 PASS → 전체 `test:rls` 초록(`storage-realtime.test.ts` ⑪ 의 기대 — 작성자 alice·ws 관리자 허용, cy·bea 거부 — 는 그대로다).

- [ ] **Step 7: 리허설 R** → 불일치 0.

- [ ] **Step 8: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 12: g — 회의록 버킷 정책을 entity 별로 + 첨부 객체 존재 확인 RPC

항목: P8-H2-2 + H1 이월(g 보강). 스펙 §6.2.0 g, Review Focus 1·4.

현행: `minutes` 버킷의 insert(`0007:55-62`)는 entity 를 `in ('minutes','minute-files')` 로만 보고 회의록 행과 대조하지 않는다 — 멤버면 남의 회의록 경로에 고아 파일을 채운다. delete(`0007:63-67`)는 소유자 ∨ ws 관리자라 `can_manage_minute`(프로젝트 관리자 포함)보다 좁다 — 프로젝트 관리자가 첨부 행은 지우지만 객체는 못 지운다(`정본:861` 과 어긋남).

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑦), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑦)
- Create: `tests/rls/h2-minute-bucket.test.ts`
- Modify(test): `tests/rls/schema-invariants.test.ts`(`DEFINER_EXECUTABLE` 에 한 줄)

**Interfaces:**
- Produces:
  - 정책 `"minutes bucket insert"`·`"minutes bucket delete"` 는 entity `minutes`(본문)만 — 술어는 0007 그대로.
  - 새 정책 `"minute-files insert"`: `can_manage_minute(entity_id)` ∧ 경로의 워크스페이스·프로젝트(`is not distinct from`)가 회의록 행과 같다.
  - 새 정책 `"minute-files delete"`: (`can_manage_minute(entity_id)` ∧ 경로 워크스페이스 = 회의록 워크스페이스) ∨ `is_ws_admin(경로 ws)` ∨ (소유자 ∧ 경로 워크스페이스 소속 ∧ 어떤 `minute_files` 행도 참조하지 않음). 프로젝트 세그먼트는 보지 않는다(회의록을 옮겨도 경로는 그대로).
  - `public.attachment_object_exists(p_kind text, p_id uuid) returns boolean`(plpgsql STABLE DEFINER, `authenticated`·`service_role` EXECUTE): `p_kind ∈ {'deliverable','issue','minute'}` 의 첨부 행을 id 로 읽어 그 버킷·경로의 `storage.objects` 존재를 답한다. 호출자에게 그 삭제 권한(`can_attach`·`can_edit_issue`·`can_manage_minute`)이 없거나 행이 없으면 `42501 ATTACHMENT_FORBIDDEN`(존재 여부를 흘리지 않는다), 모르는 kind 는 `22023 ATTACHMENT_KIND_INVALID`. `minute` 은 `role = 'attachment'` 행만. 과제 4 의 도우미가 부른다.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-minute-bucket.test.ts`)

```ts
// H2-g(P8-H2-2) — minutes 버킷의 첨부(minute-files) 정책을 회의록 관리 권한과 맞춘다. 삽입 = 관리 권한 ∧ 경로가 회의록 행과 일치.
// 삭제 = (관리 권한 ∧ 워크스페이스 일치) ∨ ws 관리자 ∨ (소유자 ∧ 소속 ∧ 미참조). 본문(minutes) entity 는 0007 그대로.
// 존재 확인 RPC(H1 이월)는 '없음'과 '읽을 수 없음'을 가르고, 권한 없는 호출자에게는 답하지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { F, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const DANA_MIN = '00000000-0000-0000-7e57-000000001250'   // 프로젝트 a, 작성자 dana(a 멤버)
const ALICE_MIN = '00000000-0000-0000-7e57-000000001251'  // 프로젝트 a, 작성자 alice — 이동 케이스용
const ROW = '00000000-0000-0000-7e57-000000001252'
const ISSUE_ATT = '00000000-0000-0000-7e57-000000001112'  // fixture-ws.sql:121-122 (경로 'rls/a.txt' — 옛 형식)
const DELIV_ATT = '00000000-0000-0000-7e57-000000001116'  // fixture-ws.sql:129-130 (경로 'rls/d.txt')
const filePath = (minuteId: string, projectId: string | null, name = 'f.pdf') =>
  makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: name })
const put = (c: PoolClient, bucket: string, name: string, owner: string | null) =>
  c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{"size": 10, "mimetype": "application/pdf"}'::jsonb)`,
    [bucket, name, owner])
async function delObject(c: PoolClient, name: string, bucket = 'minutes') {
  await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
  return (await c.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount
}
/** postgres 로 회의록(작성자 author)·객체(owner)·(참조 행)을 만들고 authenticated 로 돌아온다 */
async function arrange(c: PoolClient, o: { minuteId: string; author: string; owner: string; path: string; row?: boolean }) {
  await c.query('reset role')
  await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
    values ($1, $2, '2026-09-27', 'ERP', 'H2 버킷', '# h2', $3) on conflict (id) do nothing`, [o.minuteId, F.projects.a, o.author])
  await put(c, 'minutes', o.path, o.owner)
  if (o.row) {
    await c.query(`insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by)
      values ($1, $2, 'attachment', 'f.pdf', $3, 10, 'application/pdf', $4)`, [ROW, o.minuteId, o.path, o.owner])
  }
  await c.query('set local role authenticated')
}

describe('H2-g minute-files 삭제', () => {
  it('프로젝트 관리자(alice)는 남(dana)의 첨부 객체를 지운다(정본:861) — 명단 없는 멤버(cy)·B 관리자는 0행', async () => {
    const path = filePath(DANA_MIN, F.projects.a)
    for (const [uid, expected] of [[F.users.member, 1], [F.users.aLoose, 0], [F.users.bAdmin, 0], [F.users.dual, 1]] as const) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
        expect(await delObject(c, path), uid).toBe(expected)
      })
    }
  })

  it('Review Focus 1 — 회의록을 다른 프로젝트로 옮겨도(경로의 프로젝트는 옛 값) 관리 권한자는 지우고, 옛 프로젝트만의 권한자는 못 지운다', async () => {
    const path = filePath(ALICE_MIN, F.projects.a)
    for (const [uid, expected] of [[F.users.member, 1], [F.users.dual, 0]] as const) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: ALICE_MIN, author: F.users.member, owner: F.users.dual, path, row: true })
        await c.query('reset role')
        await c.query('update public.minutes set project_id = $2 where id = $1', [ALICE_MIN, F.projects.b])   // a → b(같은 워크스페이스)
        await c.query('set local role authenticated')
        expect(await delObject(c, path), uid).toBe(expected)   // alice = 작성자 ∧ b 멤버, dana = b 명단 없음
      })
    }
  })

  it('Review Focus 4 — 보상 삭제: 관리 권한을 잃어도(보관) 소유자는 미참조 객체를 지우고, 참조된 객체는 못 지운다', async () => {
    const path = filePath(DANA_MIN, F.projects.a, 'comp.pdf')
    for (const [withRow, expected] of [[false, 1], [true, 0]] as const) {
      await asUser(pool, F.users.dual, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: withRow })
        await c.query('reset role')
        await c.query('update public.minutes set archived_at = now() where id = $1', [DANA_MIN])
        await c.query('set local role authenticated')
        expect(await delObject(c, path), `row=${withRow}`).toBe(expected)
      })
    }
  })

  it('본문(minutes) entity 는 0007 그대로 — 프로젝트 관리자도 남의 본문 객체는 못 지운다(소유자·ws 관리자만)', async () => {
    const body = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: DANA_MIN, fileName: 'b.md' })
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path: body })
      expect(await delObject(c, body)).toBe(0)
    })
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path: body })
      expect(await delObject(c, body)).toBe(1)
    })
  })
})

describe('H2-g minute-files 삽입', () => {
  const insertObj = 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)'
  it('관리 권한자는 그 회의록 범위 경로에 올리고, 프로젝트 세그먼트가 다르거나(같은 워크스페이스라도) 관리 권한이 없으면 42501', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, '2026-09-27', 'ERP', 'H2', '#', $3)`, [DANA_MIN, F.projects.a, F.users.dual])
      await c.query('set local role authenticated')
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, F.projects.a, 'ok.pdf'), F.users.member])).toBeNull()
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, F.projects.b, 'x.pdf'), F.users.member])).toMatchObject({ code: '42501' })
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, null, 'y.pdf'), F.users.member])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.aLoose, async (c) => {
      expect(await pgError(c, insertObj, ['minutes', filePath(F.rows.nullMinute, null, 'cy.pdf'), F.users.aLoose])).toMatchObject({ code: '42501' })
    })
  })
})

describe('H2-g attachment_object_exists(H1 이월)', () => {
  const EXISTS = 'select public.attachment_object_exists($1, $2) as ok'
  it("'minute': 관리 권한자에게 있음/없음을 답하고, 권한 없는 사람·B 관리자·없는 행은 ATTACHMENT_FORBIDDEN(존재를 흘리지 않는다)", async () => {
    const path = filePath(DANA_MIN, F.projects.a)
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
      expect((await c.query(EXISTS, ['minute', ROW])).rows[0].ok).toBe(true)
      await c.query('reset role'); await delObject(c, path); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['minute', ROW])).rows[0].ok).toBe(false)
      expect(await pgError(c, EXISTS, ['minute', '00000000-0000-0000-7e57-0000000012ff'])).toMatchObject({ code: '42501', message: 'ATTACHMENT_FORBIDDEN' })
      expect(await pgError(c, EXISTS, ['nope', ROW])).toMatchObject({ code: '22023', message: 'ATTACHMENT_KIND_INVALID' })
    })
    for (const uid of [F.users.aLoose, F.users.bAdmin]) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
        expect(await pgError(c, EXISTS, ['minute', ROW]), uid).toMatchObject({ code: '42501', message: 'ATTACHMENT_FORBIDDEN' })
      })
    }
  })

  it("'issue': 세션이 읽지 못하는 객체(옛 형식 경로)도 있으면 true — '읽을 수 없음'은 '없음'이 아니다", async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, 'issue-attachments', 'rls/a.txt', F.users.member); await c.query('set local role authenticated')
      expect((await c.query("select 1 from storage.objects where bucket_id = 'issue-attachments' and name = 'rls/a.txt'")).rowCount).toBe(0)
      expect((await c.query(EXISTS, ['issue', ISSUE_ATT])).rows[0].ok).toBe(true)
      await c.query('reset role'); await delObject(c, 'rls/a.txt', 'issue-attachments'); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['issue', ISSUE_ATT])).rows[0].ok).toBe(false)
    })
  })

  it("'deliverable': can_attach 인 사람에게 답한다", async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect((await c.query(EXISTS, ['deliverable', DELIV_ATT])).rows[0].ok).toBe(false)
      await c.query('reset role'); await put(c, 'deliverables', 'rls/d.txt', F.users.member); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['deliverable', DELIV_ATT])).rows[0].ok).toBe(true)
    })
  })
})
```
`schema-invariants.test.ts` `DEFINER_EXECUTABLE` 에 `'attachment_object_exists(text, uuid)': '첨부 삭제 도우미(src/lib/attachments/removeStoredAttachment.ts)가 Storage 삭제 0건일 때 부른다 — 그 첨부의 삭제 권한이 있는 호출자에게만 답하고(없으면 42501) 경로를 받지 않는다(첨부 행 id 로만)'` 를 더한다.

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-minute-bucket.test.ts tests/rls/schema-invariants.test.ts` → alice 삭제(0행), 이동 케이스, 보상 케이스(참조 행이 있어도 소유자라 1행), 삽입의 프로젝트 b 경로(통과), RPC 셋(함수 없음), 스키마 목록 FAIL.

- [ ] **Step 3: 정방향 ⑦**

```sql

-- ⑦ 회의록 버킷 entity 별 정책(g, P8-H2-2) + 첨부 객체 존재 확인 RPC(H1 이월) -------------------------------------------------
-- 0007 의 minutes 버킷 insert 는 entity 를 in ('minutes','minute-files') 로만 봐 멤버가 남의 회의록 경로에 고아 파일을 채웠고, delete 는
-- 소유자 ∨ ws 관리자라 행 삭제(can_manage_minute — 프로젝트 관리자 포함)보다 좁았다. 본문(minutes) entity 는 0007 술어 그대로 두고
-- (minute_versions WORM 가드 포함), 첨부(minute-files)에 회의록 관리 권한 정책을 따로 둔다.
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minutes'
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null
       or exists (select 1 from public.projects p
                   where p.id = public.storage_project(objects.name) and p.workspace_id = public.storage_ws(objects.name)
                     and public.is_project_member(p.id))));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minutes'
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (owner = auth.uid() or public.is_ws_admin(public.storage_ws(name)))
  and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));
-- 첨부 삽입: 그 회의록을 관리할 수 있고 경로의 워크스페이스·프로젝트가 회의록 행과 같다(프로젝트는 is not distinct from — 무프로젝트 '_')
create policy "minute-files insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minute-files'
  and public.storage_ws(name) is not null
  and public.can_manage_minute(public.storage_entity_id(name))
  and exists (select 1 from public.minutes mi
               where mi.id = public.storage_entity_id(objects.name) and mi.workspace_id = public.storage_ws(objects.name)
                 and mi.project_id is not distinct from public.storage_project(objects.name)));
-- 첨부 삭제: 관리 권한 ∧ 워크스페이스 일치, 또는 ws 관리자, 또는 (올린 사람 ∧ 소속 ∧ 어떤 첨부 행도 참조하지 않음 — 확정 실패·
-- 보관 뒤의 보상 삭제). 프로젝트 세그먼트는 보지 않는다 — 회의록을 다른 프로젝트로 옮겨도 파일 경로는 그대로다. 소속을 요구하는
-- 이유: 참조 행 서브쿼리는 호출자의 RLS 로 돈다 — 워크스페이스를 떠난 소유자에게는 참조 행이 가려져 '미참조'로 보인다.
create policy "minute-files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minute-files'
  and public.storage_ws(name) is not null
  and ((public.can_manage_minute(public.storage_entity_id(name))
        and exists (select 1 from public.minutes mi
                     where mi.id = public.storage_entity_id(objects.name) and mi.workspace_id = public.storage_ws(objects.name)))
       or public.is_ws_admin(public.storage_ws(name))
       or (owner = auth.uid() and public.is_ws_member(public.storage_ws(name))
           and not exists (select 1 from public.minute_files mf where mf.file_path = objects.name))));

-- 첨부 객체 존재 확인 — 세 첨부 삭제 경로(src/lib/attachments/removeStoredAttachment.ts)가 Storage 삭제 0건일 때 부른다. 세션의
-- exists() 는 '없음'과 '읽을 수 없음'을 가르지 못한다(옛 형식 경로·옮긴 회의록). 첨부 행 id 로만 묻고(경로를 받지 않는다) 그 첨부의
-- 삭제 권한(버킷 삭제 정책과 같은 판정)이 있는 호출자에게만 답한다 — 없거나 행이 없으면 42501(존재를 흘리지 않는다).
create function public.attachment_object_exists(p_kind text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bucket text;
  v_path text;
  v_allowed boolean;
begin
  if p_kind = 'deliverable' then
    select 'deliverables', a.file_path, public.can_attach(a.wbs_item_id) into v_bucket, v_path, v_allowed
      from public.deliverable_attachments a where a.id = p_id;
  elsif p_kind = 'issue' then
    select 'issue-attachments', a.file_path, public.can_edit_issue(a.issue_id) into v_bucket, v_path, v_allowed
      from public.issue_attachments a where a.id = p_id;
  elsif p_kind = 'minute' then
    select 'minutes', f.file_path, public.can_manage_minute(f.minute_id) into v_bucket, v_path, v_allowed
      from public.minute_files f where f.id = p_id and f.role = 'attachment';
  else
    raise exception using errcode = '22023', message = 'ATTACHMENT_KIND_INVALID';
  end if;
  if v_path is null or not coalesce(v_allowed, false) then
    raise exception using errcode = '42501', message = 'ATTACHMENT_FORBIDDEN';
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = v_path);
end
$$;
revoke all on function public.attachment_object_exists(text, uuid) from public, anon;
grant execute on function public.attachment_object_exists(text, uuid) to authenticated, service_role;
```

- [ ] **Step 4: 롤백 ⑦ 을 `begin;` 아래에**

```sql
-- ⑦ 회의록 버킷(g) — 새 정책·RPC 제거, 두 정책을 0007 원문으로
drop function public.attachment_object_exists(text, uuid);
drop policy "minute-files delete" on storage.objects;
drop policy "minute-files insert" on storage.objects;
drop policy "minutes bucket delete" on storage.objects;
<sed -n '64,67p' supabase/migrations/0007_storage_realtime.sql 출력 그대로>
drop policy "minutes bucket insert" on storage.objects;
<sed -n '56,62p' supabase/migrations/0007_storage_realtime.sql 출력 그대로>
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 두 파일 PASS → 전체 `test:rls` 초록(`storage-realtime.test.ts` ①·①′·⑫ — 본문 entity·cy 의 `_` 경로 양성 대조가 그대로여야 한다).

- [ ] **Step 6: 리허설 R** → 불일치 0(정책 본문은 `pg_policies` 로 비교된다 — 0007 원문이 공백까지 같아야 한다).

- [ ] **Step 7: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 13: h — 첨부 insert 가드 (PostgREST 직접 쓰기 차단)

항목: P8-H2-1. 스펙 §6.2.0 h, Review Focus 2.

현행: `minute_files` 에 트리거 0개, 개수 제한은 클라이언트뿐(`MinuteUploadModal.tsx:141`), `size`·`mime` 은 클라이언트 선언값, UPDATE 정책 `attachment_update_minute_files`(`0007:127-130`)가 있다. 픽스처(`fixture-ws.sql:133-135`)는 `postgres` 로 첨부 1행(`rls/f.txt`)을 넣는다.

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑧), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑧)
- Create: `tests/rls/h2-attachment-guard.test.ts`
- Modify(test): `tests/rls/storage-realtime.test.ts:255-277`(⑪ — 객체를 먼저 올린다)

**Interfaces:**
- Produces: 트리거 함수 `public.minute_files_attachment_guard()`(DEFINER, 실행 권한 없음), 트리거 `minute_files_attachment_guard BEFORE INSERT … WHEN (new.role = 'attachment')`, 부분 유니크 인덱스 `minute_files_attachment_path_uidx (file_path) WHERE role = 'attachment'`, `minute_files` UPDATE 정책 없음·authenticated UPDATE 없음. 오류(과제 5 가 소비): `42501 MINUTE_ATTACHMENT_ARCHIVED`, `22023 MINUTE_ATTACHMENT_PATH`, `42501 MINUTE_ATTACHMENT_OBJECT`, `23505 MINUTE_ATTACHMENT_DUPLICATE`, `23514 MINUTE_ATTACHMENT_LIMIT`. 상한 10 은 `domain/minutes.ts:9` `MINUTE_ATTACHMENTS_MAX_COUNT` 와 같다(SP5 `0017` 이 설정 읽기로 바꾼다).
- 검사 순서(스펙 그대로): ① 관리 불가 세션은 `return new`(RLS 가 42501 — `isolation-map.ts:83` 탐침 유지; service_role 은 auth.uid() null 이라 여기서 통과) ② 회의록 행 `for no key update` + 보관 거부 ③ 경로 ④ 객체 소유자 = 세션, `size`·`mime` = 객체 메타데이터 ⑤ 중복 23505(개수보다 먼저) ⑥ 10개.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-attachment-guard.test.ts`)

```ts
// H2-h(P8-H2-1) — 첨부 insert 가드. 제8부 탐침 P1(개수)·P2(중복)·P3(보관)·P4(크기·mime 위조)와 경로·객체 소유, 검사 순서(관리 불가
// 세션은 RLS 가 거부 — 가드가 다른 오류를 먼저 내지 않는다), UPDATE 금지, 두 연결 직렬화(Review Focus 2)를 본다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const M = '00000000-0000-0000-7e57-000000001260'   // 프로젝트 a, 작성자 alice, 첨부 0
const pathOf = (i: number | string, minuteId = M, projectId: string | null = F.projects.a) =>
  makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: `f${i}.pdf` })
const INSERT = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
  values ($1, 'attachment', 'f.pdf', $2, 1, 'text/plain', $3) returning size, mime`
const put = (c: PoolClient, name: string, owner: string, meta = { size: 12345, mimetype: 'application/pdf' }) =>
  c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)', ['minutes', name, owner, JSON.stringify(meta)])
/** alice 세션에서 회의록 M 과 객체들을 postgres 로 만들고 authenticated 로 돌아온다 */
async function seed(c: PoolClient, objects: Array<number | string>, owner = F.users.member) {
  await c.query('reset role')
  await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
    values ($1, $2, '2026-09-27', 'ERP', 'H2 가드', '# h2', $3)`, [M, F.projects.a, F.users.member])
  for (const i of objects) await put(c, pathOf(i), owner)
  await c.query('set local role authenticated')
}

describe('H2-h minute_files_attachment_guard', () => {
  it('P1 — 10개까지 확정되고 11번째는 MINUTE_ATTACHMENT_LIMIT', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      for (let i = 1; i <= 10; i++) expect(await pgError(c, INSERT, [M, pathOf(i), F.users.member]), `#${i}`).toBeNull()
      expect(await pgError(c, INSERT, [M, pathOf(11), F.users.member])).toMatchObject({ code: '23514', message: 'MINUTE_ATTACHMENT_LIMIT' })
    })
  })

  it('P2 — 같은 경로 재전송은 MINUTE_ATTACHMENT_DUPLICATE(23505), 10개째 상태에서도 개수보다 먼저', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toBeNull()
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toMatchObject({ code: '23505', message: 'MINUTE_ATTACHMENT_DUPLICATE' })
      for (let i = 2; i <= 10; i++) await c.query(INSERT, [M, pathOf(i), F.users.member])
      expect(await pgError(c, INSERT, [M, pathOf(10), F.users.member])).toMatchObject({ code: '23505', message: 'MINUTE_ATTACHMENT_DUPLICATE' })
    })
  })

  it('P3 — 보관된 회의록은 RLS 가 거부한다(42501 row-level security)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1])
      await c.query('reset role'); await c.query('update public.minutes set archived_at = now() where id = $1', [M]); await c.query('set local role authenticated')
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
  })

  it('P4 — 선언한 크기·형식(1, text/plain) 대신 객체 메타데이터(12345, application/pdf)가 저장된다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1])
      const { rows } = await c.query<{ size: string; mime: string }>(INSERT, [M, pathOf(1), F.users.member])
      expect(rows[0]).toEqual({ size: '12345', mime: 'application/pdf' })
    })
  })

  it('객체가 없거나 남의 객체면 MINUTE_ATTACHMENT_OBJECT', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [])
      expect(await pgError(c, INSERT, [M, pathOf('none'), F.users.member])).toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_OBJECT' })
      await c.query('reset role'); await put(c, pathOf('other'), F.users.dual); await c.query('set local role authenticated')
      expect(await pgError(c, INSERT, [M, pathOf('other'), F.users.member])).toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_OBJECT' })
    })
  })

  it('경로가 회의록 범위와 다르면 MINUTE_ATTACHMENT_PATH — 다른 회의록 id·프로젝트·본문 entity·옛 형식', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [])
      for (const bad of [
        pathOf('x', F.rows.minute), pathOf('y', M, F.projects.b), pathOf('z', M, null),
        makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: M, fileName: 'b.pdf' }),
        `${M}/old.pdf`,
      ]) {
        expect(await pgError(c, INSERT, [M, bad, F.users.member]), bad).toMatchObject({ code: '22023', message: 'MINUTE_ATTACHMENT_PATH' })
      }
    })
  })

  it('관리할 수 없는 세션(cy)은 가드가 아니라 RLS 가 거부한다 — isolation-map.ts OWN_INSERT_PROBES 의 전제', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await seed(c, [1], F.users.aLoose)
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.aLoose])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
  })

  it('service_role 경로(auth.uid() null)는 가드를 타지 않는다 — 픽스처·서버 경로(현재 첨부를 서버가 넣는 곳은 없다)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime)
        values ($1, 'attachment', 'x.txt', 'rls/h2-service.txt', 1, 'text/plain')`, [F.rows.minute])).toBeNull()
    })
  })

  it('첨부는 추가·삭제만 — UPDATE 는 권한 42501, UPDATE 정책 없음, 부분 유니크 인덱스 있음', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `update public.minute_files set file_name = 'x' where minute_id = $1`, [F.rows.minute]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
    })
    const { rows: [r] } = await pool.query(`select
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'minute_files' and cmd = 'UPDATE') as upd,
      (select indexdef from pg_indexes where indexname = 'minute_files_attachment_path_uidx') as idx`)
    expect(r.upd).toBe(0)
    expect(r.idx).toMatch(/UNIQUE INDEX .* \(file_path\) WHERE \(role = 'attachment'::text\)/)
  })

  it('Review Focus 2 — 같은 회의록에 두 연결이 동시에 확정하면 뒤 연결은 회의록 행 잠금을 기다린다(개수 경합 직렬화)', async () => {
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    const claims = JSON.stringify({ sub: F.users.member, role: 'authenticated' })
    try {
      await s1.query('begin')
      await put(s1, pathOf('s1', F.rows.minute), F.users.member)
      await s1.query('set local role authenticated')
      await s1.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      await s1.query(INSERT, [F.rows.minute, pathOf('s1', F.rows.minute), F.users.member])   // 회의록 행 잠금을 쥔 채 멈춘다
      await s2.query('begin')
      await s2.query(`set local lock_timeout = '300ms'`)
      await s2.query('set local role authenticated')
      await s2.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      const err = await s2.query(INSERT, [F.rows.minute, pathOf('s2', F.rows.minute), F.users.member]).then(
        () => null, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      expect(err).toMatchObject({ code: '55P03' })   // lock_not_available — 가드 ② 에서 기다렸다
    } finally {
      await s1.query('rollback').catch(() => undefined)
      await s2.query('rollback').catch(() => undefined)
      s1.release()
      s2.release()
    }
  })
})
```

`tests/rls/storage-realtime.test.ts` ⑪(:255-277)을 다음으로 바꾼다(판정 표는 그대로, 객체를 먼저 올리고 규약 경로를 쓴다).
```ts
describe('minute_files 첨부 정책(0007 can_manage_minute · 0011 가드 — 객체를 먼저 올린다)', () => {
  const insertAttachment = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
    values ($1, 'attachment', 'x.txt', $2, 1, 'text/plain', $3)`
  const pathFor = (minuteId: string, projectId: string | null, uid: string) =>
    makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: `rls-${uid.slice(-2)}.txt` })
  it('⑪ 작성자·A 워크스페이스 관리자는 첨부를 넣고 지우며, 명단 없는 A 멤버·B 관리자·보관된 회의록은 거부', async () => {
    for (const [uid, allowed] of [[F.users.member, true], [F.users.wsAdmin, true], [F.users.aLoose, false], [F.users.bAdmin, false]] as const) {
      await asUser(pool, uid, async (c) => {
        for (const [minuteId, projectId] of [[F.rows.minute, F.projects.a], [F.rows.nullMinute, null]] as const) {
          const path = pathFor(minuteId, projectId, uid)
          await c.query('reset role'); await put(c, 'minutes', path, uid); await c.query('set local role authenticated')
          const err = await pgError(c, insertAttachment, [minuteId, path, uid])
          if (allowed) expect(err, `${uid} ${minuteId}`).toBeNull()
          else expect(err, `${uid} ${minuteId}`).toMatchObject({ code: '42501' })
        }
        const del = await c.query(`delete from public.minute_files where minute_id = $1 and role = 'attachment'`, [F.rows.minute])
        expect(del.rowCount, `${uid} 삭제`).toBe(allowed ? 2 : 0)   // 픽스처 첨부 1 + 방금 넣은 1(허용된 경우)
      })
    }
    await asUser(pool, F.users.member, async (c) => {
      const path = pathFor(F.rows.minute, F.projects.a, 'archived')
      await c.query('reset role'); await put(c, 'minutes', path, F.users.member)
      await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      await c.query('set local role authenticated')
      expect(await pgError(c, insertAttachment, [F.rows.minute, path, F.users.member])).toMatchObject({ code: '42501' })
    })
  })
})
```
(`put` 은 이 파일 머리의 `put(c, bucket, name, owner)`(:13-14)다 — 메타데이터가 없으므로 가드 ④ 가 `MINUTE_ATTACHMENT_OBJECT` 를 낸다. `put` 을 `metadata` 를 넣도록 바꾼다: `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{"size": 1, "mimetype": "text/plain"}'::jsonb)`. 다른 케이스는 metadata 를 보지 않으므로 그대로 통과한다.)

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-attachment-guard.test.ts tests/rls/storage-realtime.test.ts` → P1·P2·P4·객체·경로·UPDATE·두 연결(55P03 대신 성공) FAIL. P3·cy·service 는 이미 통과할 수 있다.

- [ ] **Step 3: 정방향 ⑧**

```sql

-- ⑧ 첨부 insert 가드(h, P8-H2-1 — WF-GAP-1 과 같은 PostgREST 직접 쓰기 차단) ----------------------------------------------
-- 사전 검사: 같은 경로의 첨부 행이 둘 이상이면 부분 유니크 인덱스를 만들 수 없다 — 멈추고 사람이 정리한다.
do $$
declare v text;
begin
  select string_agg(d.file_path, ', ') into v
    from (select file_path from public.minute_files where role = 'attachment' group by file_path having count(*) > 1) d;
  if v is not null then
    raise exception 'AUTHZ_0011_PRECHECK: 첨부 경로 중복(%) — 중복 행을 지운 뒤 다시 적용한다', left(v, 400) using errcode = '23505';
  end if;
end $$;

create unique index minute_files_attachment_path_uidx on public.minute_files (file_path) where role = 'attachment';

-- 첨부는 추가·삭제만 한다 — UPDATE 로 경로·크기를 바꾸면 아래 가드를 건너뛴다
drop policy attachment_update_minute_files on public.minute_files;
revoke update on public.minute_files from authenticated;

create function public.minute_files_attachment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_project uuid;
  v_archived timestamptz;
  v_owner uuid;
  v_meta jsonb;
begin
  -- ① 관리할 수 없는 세션은 RLS(attachment_insert_minute_files)가 42501 로 거부한다 — 가드가 먼저 다른 오류를 내면 격리 탐침
  --    (tests/rls/isolation-map.ts OWN_INSERT_PROBES minute_files)이 RLS 거부를 보지 못한다. service_role(auth.uid() null)도 여기서 통과.
  if not public.can_manage_minute(new.minute_id) then
    return new;
  end if;
  -- ② 회의록 행을 잠근다 — 같은 회의록의 첨부 확정을 직렬화하고(개수 경합) 그사이의 보관을 본다
  select mi.workspace_id, mi.project_id, mi.archived_at into v_ws, v_project, v_archived
    from public.minutes mi where mi.id = new.minute_id for no key update;
  if v_archived is not null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_ARCHIVED';
  end if;
  -- ③ 경로 = ws/<회의록 ws>/p/<회의록 프로젝트|_>/minute-files/<회의록 id>/<파일>(프로젝트는 is not distinct from)
  if not coalesce(public.storage_ws(new.file_path) = v_ws
                  and public.storage_project(new.file_path) is not distinct from v_project
                  and split_part(new.file_path, '/', 5) = 'minute-files'
                  and public.storage_entity_id(new.file_path) = new.minute_id, false) then
    raise exception using errcode = '22023', message = 'MINUTE_ATTACHMENT_PATH';
  end if;
  -- ④ 객체는 이 세션이 올린 것이고, 크기·형식은 객체 메타데이터 값이다(클라이언트 선언값을 믿지 않는다)
  select o.owner, o.metadata into v_owner, v_meta
    from storage.objects o where o.bucket_id = 'minutes' and o.name = new.file_path;
  if not found or v_owner is distinct from auth.uid() or (v_meta ->> 'size') is null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_OBJECT';
  end if;
  new.size := (v_meta ->> 'size')::bigint;
  new.mime := coalesce(nullif(v_meta ->> 'mimetype', ''), 'application/octet-stream');
  -- ⑤ 같은 경로 재전송은 중복 — 개수 검사보다 먼저(10개째 재전송이 '한도 초과'로 보이지 않게)
  if exists (select 1 from public.minute_files f where f.role = 'attachment' and f.file_path = new.file_path) then
    raise exception using errcode = '23505', message = 'MINUTE_ATTACHMENT_DUPLICATE';
  end if;
  -- ⑥ 운영 상한 10개(domain/minutes.ts MINUTE_ATTACHMENTS_MAX_COUNT, 스펙 §2.9.2). SP5 0017 이 minutes.attachments 설정을 읽게 바꾼다
  if (select count(*) from public.minute_files f where f.minute_id = new.minute_id and f.role = 'attachment') >= 10 then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_LIMIT';
  end if;
  return new;
end
$$;
revoke all on function public.minute_files_attachment_guard() from public, anon, authenticated;
create trigger minute_files_attachment_guard before insert on public.minute_files
  for each row when (new.role = 'attachment') execute function public.minute_files_attachment_guard();
```

- [ ] **Step 4: 롤백 ⑧ 을 `begin;` 아래에**

```sql
-- ⑧ 첨부 가드(h) — 트리거·인덱스 제거, UPDATE 권한·정책 복구(0007:127-130)
drop trigger minute_files_attachment_guard on public.minute_files;
drop function public.minute_files_attachment_guard();
drop index public.minute_files_attachment_path_uidx;
grant update on public.minute_files to authenticated;
<sed -n '128,130p' supabase/migrations/0007_storage_realtime.sql 출력 그대로>
```

- [ ] **Step 5: 실 Storage 메타데이터 모양 확인(테스트가 흉내 낸 키가 실제와 같은지)** — `npm run db:reset` 뒤, service_role 로 객체 하나를 실제 Storage API 로 올리고 메타데이터 키를 본다(비밀번호가 필요 없다).
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { localAdminEnv } from './scripts/lib/targets.mjs'
const t = localAdminEnv(readFileSync('.env.local', 'utf8'))
const sb = createClient(t.url, t.serviceRoleKey, { auth: { persistSession: false } })
const { error } = await sb.storage.from('minutes').upload('h2-probe/meta.pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { upsert: true })
console.log(error ? 'upload error: ' + error.message : 'uploaded')
"
docker exec supabase_db_d-flow psql -U postgres -Atc "select metadata ? 'size', metadata ? 'mimetype', metadata->>'mimetype' from storage.objects where bucket_id = 'minutes' and name = 'h2-probe/meta.pdf'"
```
Expected: `t|t|application/pdf`. 키가 다르면(예 `contentType`) 가드 ④ 와 테스트의 키를 실측값으로 고치고 보고한다. 끝나면 `npm run db:reset`(탐침 객체 제거). (`localAdminEnv` 가 service role 키를 돌려준다 — 키를 출력하지 않는다.)

- [ ] **Step 6: 적용·통과** — `npm run db:reset` → 두 파일 PASS → 전체 `test:rls` 초록(`workspace-isolation.test.ts` 의 `minute_files` 복사 insert·자기 이름 탐침이 RLS 거부로 끝나야 한다).

- [ ] **Step 7: 리허설 R** → 불일치 0.

- [ ] **Step 8: `npm run dev:bootstrap`.** 커밋하지 않는다.

### Task 14: i — 승인·반려의 보고 id 대조를 RPC 주문 잠금 아래로

항목: H1 이월(과제 11 판정). 스펙 §6.2.0 i.

현행: `apply_workflow_event`(`0000_baseline.sql:731-944`)는 SECURITY **INVOKER**, `search_path` 설정 없음, ACL `{postgres=X, service_role=X}`(0001~0010 이 다시 정의하지 않았다). 앱의 `checkReportFresh`(`agentWork.ts:209-217`)와 RPC 의 주문 CAS(:786-807) 사이에 재보고가 끼면 사람이 보지 않은 보고가 승인·반려된다(`agentWork.ts:258,284` 의 '잔여 창' 주석).

인자를 더하면 시그니처가 바뀌므로 `create or replace` 가 아니라 drop + create 다. 새 함수는 기본 권한 때문에 `authenticated` EXECUTE 를 받으므로 명시적으로 회수한다. 본문은 원문 그대로 두고(INVOKER·search_path 없음 유지 — 하드닝은 SP5b `0020` 재작성의 몫) 한 블록만 넣는다.

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑨), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑨)
- Create: `tests/rls/h2-report-stale.test.ts`

**Interfaces:**
- Produces: `public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL, p_stage text DEFAULT NULL, p_agent text DEFAULT NULL, p_agent_user_id uuid DEFAULT NULL, p_expected_report_id uuid DEFAULT NULL) returns jsonb`. `approve`·`reject` 는 주문 행을 잠근 뒤(`for update`, 기존) 최신 completion 보고 id(`created_at desc, id desc limit 1`, 없으면 null)와 `p_expected_report_id` 를 `is distinct from` 으로 비교해 다르면 `{"ok": false, "reason": "report_stale", "stale": true, "order_status": <현재>}`. 인자를 생략하면 null = "보고 없음을 봤다" 로 비교한다(보고가 있으면 stale). 다른 사건은 인자를 보지 않는다. ACL = `postgres`·`service_role` 만. 과제 17 이 소비한다.

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/h2-report-stale.test.ts`)

```ts
// H2-i(H1 이월) — 승인·반려는 RPC 가 주문 행 잠금 아래에서 사람이 본 completion 보고 id 와 최신 보고를 비교한다. 앱 대조와 전이
// 사이에 재보고가 끼면 stale 로 거부되고 아무것도 쓰이지 않는다. 순서는 앱(latestCompletionReportId)과 같다: created_at 내림차순,
// 같으면 id 가 큰 쪽. 다른 사건은 인자를 보지 않는다. 새 시그니처는 service_role 만 실행한다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ORDER = '00000000-0000-0000-7e57-000000001270'
const R1 = '00000000-0000-0000-7e57-000000001271'
const R2 = '00000000-0000-0000-7e57-000000001272'
const RPC = 'select public.apply_workflow_event($1, $2, null, $3, null, null, null, $4) as r'
const STALE = { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' }

async function seed(c: PoolClient, reports: Array<[string, string]> = [[R1, "now() - interval '2 minutes'"], [R2, "now() - interval '1 minute'"]]) {
  await c.query('update public.wbs_items set dev_workflow = true where id = $1', [F.leaf.aErp])
  await c.query(`insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, 'reported')`,
    [ORDER, F.projects.a, F.leaf.aErp])
  for (const [id, at] of reports) {
    await c.query(`insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent, created_at)
      values ($1, $2, 'completion', 100, 'h2', 'rls-agent', ${at})`, [id, ORDER])
  }
}
const orderStatus = async (c: PoolClient) => (await c.query('select status from public.agent_work_orders where id = $1', [ORDER])).rows[0].status

describe('H2-i apply_workflow_event p_expected_report_id', () => {
  it.each(['approve', 'reject'])('%s: 본 보고가 최신이 아니면 report_stale, 주문·단계 불변 — 최신이면 전이', async (event) => {
    await asService(pool, async (c) => {
      await seed(c)
      expect((await c.query(RPC, [event, F.users.member, ORDER, R1])).rows[0].r).toEqual(STALE)
      expect(await orderStatus(c)).toBe('reported')
      expect((await c.query(RPC, [event, F.users.member, ORDER, R2])).rows[0].r).toMatchObject({ ok: true })
      expect(await orderStatus(c)).toBe(event === 'approve' ? 'approved' : 'claimed')
    })
  })

  it('보고가 없으면 null 이 일치하고, 보고가 있는데 null(인자 생략)이면 stale', async () => {
    await asService(pool, async (c) => {
      await seed(c, [])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, null])).rows[0].r).toMatchObject({ ok: true })
    })
    await asService(pool, async (c) => {
      await seed(c)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, null])).rows[0].r).toEqual(STALE)
      expect((await c.query('select public.apply_workflow_event($1, $2, null, $3) as r', ['approve', F.users.member, ORDER])).rows[0].r)
        .toEqual(STALE)
    })
  })

  it('created_at 이 같으면 id 가 큰 쪽이 최신이다(앱과 같은 순서)', async () => {
    await asService(pool, async (c) => {
      await seed(c, [[R1, "'2026-09-27T00:00:00Z'"], [R2, "'2026-09-27T00:00:00Z'"]])
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R1])).rows[0].r).toEqual(STALE)
      expect((await c.query(RPC, ['approve', F.users.member, ORDER, R2])).rows[0].r).toMatchObject({ ok: true })
    })
  })

  it('다른 사건은 인자를 보지 않는다 — unapprove 는 아무 id 로도 진행', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      await c.query(`update public.agent_work_orders set status = 'approved' where id = $1`, [ORDER])
      expect((await c.query(RPC, ['unapprove', F.users.member, ORDER, '00000000-0000-0000-7e57-0000000012fe'])).rows[0].r)
        .toMatchObject({ ok: true, order_status: 'reported' })
    })
  })

  it('새 시그니처만 있고 service_role 만 실행한다(authenticated·anon 없음)', async () => {
    const { rows: [r] } = await pool.query(`select
      to_regprocedure('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)') is null as old_gone,
      has_function_privilege('authenticated', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'EXECUTE') as auth,
      has_function_privilege('anon', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'EXECUTE') as anon,
      has_function_privilege('service_role', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'EXECUTE') as svc`)
    expect(r).toEqual({ old_gone: true, auth: false, anon: false, svc: true })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/h2-report-stale.test.ts` → 8번째 인자가 없어 전부 FAIL(`function … does not exist`).

- [ ] **Step 3: 정방향 ⑨**

함수 본문은 계획에 옮겨 적지 않는다. `sed -n '731,944p' supabase/migrations/0000_baseline.sql` 출력을 붙인 뒤 두 곳만 바꾼다.
- 첫 줄(0000:731)을 다음으로 바꾼다.
  ```sql
  CREATE FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid, p_expected_report_id uuid DEFAULT NULL::uuid) RETURNS jsonb
  ```
- 0000:807 의 `    end if;`(주문 CAS 충돌 반환 블록을 닫는 줄) **바로 다음**, 0000:808 의 `  else` 앞에 다음 블록을 넣는다(들여쓰기 4칸).
  ```sql
      -- 사람이 본 completion 보고가 지금도 최신인가(0011 H2-i) — 주문 행 잠금 아래에서 본다. 앱의 checkReportFresh 와 이 전이 사이에
      -- 재보고가 끼면 여기서 막힌다. 순서는 앱(latestCompletionReportId)과 같다: created_at 내림차순, 같으면 id 가 큰 쪽. null = 보고 없음.
      if p_event in ('approve','reject') and p_expected_report_id is distinct from (
           select r.id from public.agent_work_reports r
            where r.work_order_id = p_order_id and r.kind = 'completion'
            order by r.created_at desc, r.id desc limit 1) then
        return jsonb_build_object('ok', false, 'reason', 'report_stale', 'stale', true, 'order_status', v_order_status);
      end if;
  ```
파일 끝에 덧붙일 ⑨ 전체:
```sql

-- ⑨ 승인·반려 보고 id 대조(i, H1 이월 과제 11) ---------------------------------------------------------------------------
-- 인자를 더하므로 drop + create 다(0000 원문, INVOKER·search_path 없음 유지 — 재작성은 SP5b 0020 이 이 인자를 잇는다).
-- 새 함수는 postgres 기본 권한으로 authenticated EXECUTE 를 받으므로 0000 의 ACL(service_role 만)로 되돌린다.
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid);
<sed -n '731,944p' supabase/migrations/0000_baseline.sql 출력 — 위 두 곳을 바꾼 판>
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) to service_role;
```

- [ ] **Step 4: 롤백 ⑨ 를 `begin;` 아래에**

```sql
-- ⑨ 보고 id 대조(i) — 새 시그니처를 지우고 0000 원문과 ACL 을 되돌린다
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid);
<sed -n '731,944p' supabase/migrations/0000_baseline.sql 출력 그대로>
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role;
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 이 파일 PASS → 전체 `test:rls` 초록(`schema-invariants.test.ts` 의 "p_actor* 인자 함수는 authenticated·anon 이 실행할 수 없다" 가 새 시그니처에도 초록).

- [ ] **Step 6: 리허설 R** → 불일치 0.

- [ ] **Step 7: `npm run dev:bootstrap`.** 커밋하지 않는다. (이제 로컬에서 앱의 승인·반려는 과제 17 전까지 보고가 있는 주문에서 stale 이다 — Global Constraints.)

### Task 15: WF-GAP-1 잠금 절 + WF-GAP-2 현행 패리티 테스트

항목: 스펙 §8.1 #4(컨트롤러 판정 — 채택), §3.3.5 첫 `raise`, §3.0 WF-GAP-2.

현행: 실적 100 잠금은 앱 계층뿐이다(`src/app/actions/wbs.ts:142-159` — `newPct > 99 && dev_workflow`, 위임됨 ∨ 주문 claimed·reported). DB 는 `member_update_actual`(`0006:197-200`)과 `guard_non_admin_column_scope`(`0000:3060-3080`)만 본다 — 위임·점유 항목에 PostgREST 직접 PATCH 로 100 을 쓸 수 있다. 크레딧·잠금·선행 판정의 TS↔SQL 대조 테스트가 포크에 없다(`stageCredits.ts:2-4`·`agentWork.ts:31` 주석이 가리키는 `tests/migrations/0096-*` 부재).

**스펙 이탈(컨트롤러 판정):** 잠금 절은 새 실적이 99 를 넘으면(`> 99`) 막고 99 이하는 통과시킨다 — 스펙 §3.3.5 의 `coalesce(new.actual_pct, 0) < 100 then return new`(100 이상만 막음)와 다르다. 이유: DB 가드는 앱(`wbs.ts:146` `newPct > 99`)보다 느슨하면 안 되는데 `actual_pct` 는 제약 없는 numeric(CHECK 0~100)이라 99 와 100 사이 값(예 99.5)을 스펙 식은 통과시키고 앱은 막는다. Self-Review 7 의 스펙 이탈 목록에 올려 스펙을 뒤에 고친다.

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(⑩), `supabase/rollbacks/0011_authz_hardening_rollback.sql`(⑩)
- Create: `tests/rls/workflow-parity.test.ts`

**Interfaces:**
- Consumes: 과제 14 의 8인자 RPC(`approve`·`reject` 는 보고가 없으면 null 로 통과). 과제 5 Step 2 의 TS 쪽 경계 케이스(`tests/actions/wbs-update-actual-lock.test.ts`, 같은 세 값 99·99.5·100).
- Produces: 트리거 함수 `public.guard_workflow_actual()`(DEFINER, 실행 권한 없음), 트리거 `guard_workflow_actual BEFORE UPDATE OF actual_pct ON wbs_items`, 오류 `42501 WORKFLOW_ACTUAL_LOCKED`(과제 5 가 소비). 경계 = 앱과 같은 `> 99`. 단계 ≥ 2 절은 없다(SP5b).

- [ ] **Step 1: 실패하는 테스트** (`tests/rls/workflow-parity.test.ts`)

```ts
// WF-GAP-2 — 크레딧 기본값·잠금·선행 도달 판정의 TS↔SQL 현행 고정 패리티(스펙 §3.0·§8.1 #4). WF-GAP-1 — 위임·점유 항목에 세션이
// 직접 실적 100 을 쓰면 guard_workflow_actual 이 WORKFLOW_ACTUAL_LOCKED(앱 updateActual 잠금의 DB 판). 패리티 케이스는 현행을 고정하므로
// 처음부터 통과할 수 있다 — 실패부터 봐야 하는 것은 잠금 절 케이스다. 단계 ≥ 2 절(WORKFLOW_APPROVAL_REQUIRED)은 SP5b 다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS, EVENT_CREDIT } from '@/lib/domain/stageCredits'
import { REACHED_STAGES, stageLockedForHuman } from '@/lib/domain/agentWork'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LEAF = F.leaf.aErp
const ORDER = '00000000-0000-0000-7e57-000000001280'
const STATUSES = [null, 'ready', 'claimed', 'reported', 'approved', 'cancelled'] as const
const RPC = 'select public.apply_workflow_event($1, $2, $3, $4, $5, null, null, null) as r'
/** 실적 잠금 경계(앱 wbs.ts:146 `newPct > 99` = DB 가드). TS 쪽은 tests/actions/wbs-update-actual-lock.test.ts 의 같은 세 값이다. */
const ACTUAL_BOUNDARY = [[99, false], [99.5, true], [100, true]] as const   // [값, 잠긴 항목에서 막히는가]

/** postgres 로 리프 상태를 맞춘다 — 매번 같은 출발점(단계 없음, 실적 0, 주문 하나 또는 없음) */
async function arrange(c: PoolClient, o: { delegated: boolean; status: string | null; devWorkflow?: boolean; stage?: string | null }) {
  await c.query('update public.wbs_items set dev_workflow = $2, tags = $3, stage = $4, actual_pct = 0 where id = $1',
    [LEAF, o.devWorkflow ?? true, o.delegated ? ['agent'] : [], o.stage ?? null])
  await c.query('delete from public.agent_work_orders where id = $1', [ORDER])
  if (o.status) {
    await c.query('insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, $4)',
      [ORDER, F.projects.a, LEAF, o.status])
  }
}
const rpc = async (c: PoolClient, event: string, o: { item?: string | null; order?: string | null; stage?: string | null } = {}) =>
  (await c.query(RPC, [event, F.users.member, o.item ?? null, o.order ?? null, o.stage ?? null])).rows[0].r as Record<string, unknown>

describe('WF-GAP-2 TS↔SQL 현행 패리티', () => {
  it('크레딧 기본값 — RPC 의 c_default = DEFAULT_STAGE_CREDITS', async () => {
    const { rows: [r] } = await pool.query<{ src: string }>(
      `select prosrc as src from pg_proc where oid = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)'::regprocedure`)
    const m = r.src.match(/c_default constant jsonb := '([^']+)'::jsonb/)
    expect(m, 'c_default 선언을 찾지 못했다').not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(DEFAULT_STAGE_CREDITS)
  })

  it('사건별 크레딧 — 각 주문 사건의 결과 실적 = EVENT_CREDIT 의 키(approve 는 100)', async () => {
    const from: Record<string, string> = {
      claim: 'ready', report_completion: 'claimed', release: 'claimed', approve: 'reported', reject: 'reported', unapprove: 'approved', rework: 'approved',
    }
    await asService(pool, async (c) => {
      await c.query('update public.project_settings set stage_credits = null where project_id = $1', [F.projects.a])
      for (const [event, status] of Object.entries(from)) {
        await arrange(c, { delegated: false, status })
        const r = await rpc(c, event, { order: ORDER })
        const key = EVENT_CREDIT[event as keyof typeof EVENT_CREDIT]
        expect(r.ok, event).toBe(true)
        expect(Number(r.actual_pct), event).toBe(key === 'xx' ? 100 : DEFAULT_STAGE_CREDITS.default[key])
      }
      await arrange(c, { delegated: false, status: null })
      expect(Number((await rpc(c, 'assign', { item: LEAF })).actual_pct)).toBe(DEFAULT_STAGE_CREDITS.default[EVENT_CREDIT.assign])
    })
  })

  it('잠금 — RPC set_stage 의 locked = stageLockedForHuman(위임됨 × 주문 상태 12칸)', async () => {
    await asService(pool, async (c) => {
      for (const delegated of [false, true]) {
        for (const status of STATUSES) {
          await arrange(c, { delegated, status })
          const r = await rpc(c, 'set_stage', { item: LEAF, stage: 'im' })
          expect(r.reason === 'locked', `delegated=${delegated} status=${status}`).toBe(stageLockedForHuman({ delegated, orderStatus: status }))
        }
      }
    })
  })

  it('선행 도달 — 미착수에서 단계를 정했을 때의 reached_first = REACHED_STAGES', async () => {
    await asService(pool, async (c) => {
      for (const stage of ['as', 'ip', 'im', 'xx']) {
        await arrange(c, { delegated: false, status: null })
        expect((await rpc(c, 'set_stage', { item: LEAF, stage })).reached_first, stage).toBe(REACHED_STAGES.has(stage))
      }
    })
  })
})

describe('WF-GAP-1 guard_workflow_actual(잠금 절)', () => {
  const SET = 'update public.wbs_items set actual_pct = $2 where id = $1'
  it('세션이 잠긴 항목(위임됨 ∨ 주문 claimed·reported)에 99 를 넘는 값(99.5·100)을 쓰면 WORKFLOW_ACTUAL_LOCKED — 99 와 안 잠긴 항목은 된다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      for (const delegated of [false, true]) {
        for (const status of STATUSES) {
          const locked = stageLockedForHuman({ delegated, orderStatus: status })
          for (const [pct, blockedWhenLocked] of ACTUAL_BOUNDARY) {
            await c.query('reset role'); await arrange(c, { delegated, status }); await c.query('set local role authenticated')
            const label = `pct=${pct} delegated=${delegated} status=${status}`
            const err = await pgError(c, SET, [LEAF, pct])
            if (locked && blockedWhenLocked) expect(err, label).toMatchObject({ code: '42501', message: 'WORKFLOW_ACTUAL_LOCKED' })
            else expect(err, label).toBeNull()
          }
        }
      }
    })
  })

  it('개발 워크플로 대상이 아니면(dev_workflow=false) 위임 태그가 있어도 막지 않는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await arrange(c, { delegated: true, status: 'claimed', devWorkflow: false }); await c.query('set local role authenticated')
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
    })
  })

  it('RPC·서버 경로(auth.uid() null)는 잠금과 무관하다 — 승인 사건이 100 을 쓴다', async () => {
    await asService(pool, async (c) => {
      await arrange(c, { delegated: true, status: 'claimed' })
      expect(await pgError(c, SET, [LEAF, 100])).toBeNull()
    })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/workflow-parity.test.ts` → WF-GAP-1 첫 케이스 FAIL(잠긴 칸의 99.5·100 도 통과). TS 쪽 같은 세 값은 과제 5 에서 이미 초록이다(`npx vitest run tests/actions/wbs-update-actual-lock.test.ts`). 패리티 네 케이스는 PASS 일 수 있다 — PASS 가 아니면 멈추고 보고한다(현행 TS·SQL 이 이미 어긋나 있다는 뜻이고, 고치는 방향은 컨트롤러가 정한다).

- [ ] **Step 3: 정방향 ⑩**

```sql

-- ⑩ 실적 100 잠금 절(WF-GAP-1, 스펙 §3.3.5 첫 raise · §8.1 #4) ------------------------------------------------------------
-- 앱 updateActual(wbs.ts)의 잠금(위임됨 ∨ 에이전트 주문 claimed·reported → 100 은 승인 버튼으로만)이 DB 에 없어, 담당 팀 멤버가
-- PostgREST 직접 PATCH 로 100 을 쓸 수 있었다(member_update_actual·guard_non_admin_column_scope 는 열만 본다). RPC·서버 경로
-- (auth.uid() null)는 통과한다 — 승인 사건이 100 을 쓴다. 단계 ≥ 2 절(WORKFLOW_APPROVAL_REQUIRED)은 SP5b 가 이 함수를 바꿔 더한다.
-- 경계는 앱과 같은 '99 초과'다(스펙 §3.3.5 의 '< 100 통과' 에서 벗어남 — actual_pct 는 numeric 이라 99.5 를 앱은 막고 스펙 식은 통과시킨다).
create function public.guard_workflow_actual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.actual_pct is not distinct from old.actual_pct or coalesce(new.actual_pct, 0) <= 99 then return new; end if;
  if not old.dev_workflow then return new; end if;
  if 'agent' = any(coalesce(old.tags, '{}'::text[]))
     or exists (select 1 from public.agent_work_orders o where o.wbs_item_id = old.id and o.status in ('claimed', 'reported')) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  return new;
end
$$;
revoke all on function public.guard_workflow_actual() from public, anon, authenticated;
create trigger guard_workflow_actual before update of actual_pct on public.wbs_items
  for each row execute function public.guard_workflow_actual();
```

- [ ] **Step 4: 롤백 ⑩ 을 `begin;` 아래에**

```sql
-- ⑩ 실적 100 잠금 절 — 트리거 제거
drop trigger guard_workflow_actual on public.wbs_items;
drop function public.guard_workflow_actual();
```

- [ ] **Step 5: 적용·통과** — `npm run db:reset` → 이 파일 PASS → 전체 `test:rls` 초록(`org-core.test.ts` ① — alice 의 ERP 리프 실적 수정은 `dev_workflow=false` 라 그대로다).

- [ ] **Step 6: 리허설 R** → 불일치 0.

- [ ] **Step 7: `npm run dev:bootstrap`.** 커밋하지 않는다.

---

## 3단계 — 마이그레이션·테스트 커밋(② → ③)

### Task 16: 사후검증 절, 전체 리허설, 사전 검사 리허설, 커밋 ②·③

**Files:**
- Modify: `supabase/migrations/0011_authz_hardening.sql`(끝에 ⑪)
- Commit: 위 두 SQL 파일(②), `tests/rls/h2-*.ts`·`tests/rls/workflow-parity.test.ts`·`tests/rls/storage-realtime.test.ts`·`tests/rls/schema-invariants.test.ts`(③)

**Interfaces:**
- Consumes: 과제 6~15 의 산출물 전부(작업 트리). 과제 7 의 `DML_WITHOUT_POLICY` 쿼리.
- Produces: 커밋 ②(G1·G4 통과), 커밋 ③.

- [ ] **Step 0: 작업 트리 대조** — `git status --short` 에 이 계획의 파일만 있다(아래 목록). 다른 파일(사용자·다른 에이전트의 것)은 목록에 적고 건드리지 않는다.
```
?? supabase/migrations/0011_authz_hardening.sql
?? supabase/rollbacks/0011_authz_hardening_rollback.sql
?? tests/rls/h2-platform-admins.test.ts
?? tests/rls/h2-table-grants.test.ts
?? tests/rls/h2-share-token.test.ts
?? tests/rls/h2-membership.test.ts
?? tests/rls/h2-access-granted.test.ts
?? tests/rls/h2-actor.ts
?? tests/rls/h2-minute-manage-parity.test.ts
?? tests/rls/h2-minute-bucket.test.ts
?? tests/rls/h2-attachment-guard.test.ts
?? tests/rls/h2-report-stale.test.ts
?? tests/rls/workflow-parity.test.ts
 M tests/rls/schema-invariants.test.ts
 M tests/rls/storage-realtime.test.ts
```
(과제 10 을 뺐다면 `h2-access-granted.test.ts` 가 없다.)

- [ ] **Step 1: 사후검증 ⑪ 을 끝에 덧붙인다** — 뒤 절이 권한을 바꿨을 수 있으므로 표 권한·정책 불변식을 마지막에 다시 본다.

```sql

-- ⑪ 사후검증 — 절마다 본 것 가운데 뒤 절이 바꿀 수 있는 표 권한·정책 불변식을 마지막에 다시 본다 ---------------------------------
do $$
declare v text;
begin
  -- 권한은 있는데 그 명령(또는 ALL)의 정책이 없는 DML(INSERT·UPDATE 는 열 단위 포함) — 0 이어야 한다(②, ⑧)
  select string_agg(format('%s:%s', t.relname, cmd.cmd), ', ') into v
    from pg_class t cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(cmd)
   where t.relnamespace = 'public'::regnamespace and t.relkind in ('r', 'p')
     and (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[]);
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 정책 없는 DML 권한: %', left(v, 800); end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
                and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
                and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')) then
    raise exception 'AUTHZ_0011_POSTCHECK: truncate·trigger·references·maintain 권한이 되살아났다';
  end if;
  if has_column_privilege('authenticated', 'public.minutes', 'share_token', 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: minutes.share_token 이 열렸다';
  end if;
  select string_agg(n, ', ') into v from unnest(array[
      'platform_admins_keep_last', 'workspace_members_revoke_access', 'minute_files_attachment_guard', 'guard_workflow_actual']) as n
   where not exists (select 1 from pg_trigger g where g.tgname = n and not g.tgisinternal);
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 트리거가 없다: %', v; end if;
  if has_function_privilege('authenticated', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 apply_workflow_event 를 실행한다';
  end if;
end $$;
```

- [ ] **Step 2: 식별자·금지 패턴** — `grep -niE "[a-z0-9_]*atomic\b" supabase/migrations/0011_authz_hardening.sql supabase/rollbacks/0011_authz_hardening_rollback.sql` → 0건. `grep -nE "^\s*(begin|commit);" supabase/migrations/0011_authz_hardening.sql` → 0건. `grep -n "<sed" supabase/migrations/0011_authz_hardening.sql supabase/rollbacks/0011_authz_hardening_rollback.sql` → 0건(설명 줄이 남지 않았다).

- [ ] **Step 3: 전체 적용·테스트** — `npm run db:reset` → `npm run test:rls 2>&1 | tail -4`(건너뜀 0) → `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3` → `npm run build`. 전부 초록.

- [ ] **Step 4: 리허설 R**(전체 0011) → 불일치 0 두 번, defacl 차이 없음.

- [ ] **Step 5: 사전 검사 리허설** — 과제 9 Step 7 의 명령 전문을 다시 돌린다 → `AUTHZ_0011_PRECHECK` 로 실패, 0011 미적용. 이어서 `npm run db:reset`.

- [ ] **Step 6: `npm run dev:bootstrap`** → `✓ 플랫폼 관리자 …`. 이것이 스펙 done_when 의 "`db:reset` → `dev:bootstrap`" 이고, 부트스트랩의 `platform_admins` upsert 가 새 트리거를 통과한다는 확인이다(실패 롤백의 캐스케이드 면제는 `h2-platform-admins.test.ts` 가 `auth.users` 삭제로 본다).

- [ ] **Step 7: 커밋 ② — 마이그레이션과 롤백만(G1), `Staging-verified`(G4)**

```bash
git add supabase/migrations/0011_authz_hardening.sql supabase/rollbacks/0011_authz_hardening_rollback.sql
git diff --cached --stat
git commit -F - <<'EOF'
db: 0011 권한 하드닝(H2) — 마지막 슈퍼유저·표 권한·공유 토큰 열·소속 회수·회의록 첨부 판정·승인 보고 대조·실적 잠금

제7·8부 원장이 남긴 경계 결함을 한 마이그레이션으로 닫는다. 마지막 슈퍼유저는 DB 가 advisory 잠금 아래에서 지키고
(auth.users 캐스케이드는 면제), anon·authenticated 의 쓰지 않는 표 권한과 정책 없는 DML 권한을 걷는다. 멤버는
minutes.share_token 을 읽지 못하고, 워크스페이스에서 빠지면 그 워크스페이스 명단 권한이 null 이 된다(재초대가 옛 admin 을
되살리지 않는다). can_manage_minute 는 앱 canEditMinute 와 같아지고(AUTH-11 칸만 예외), 회의록 첨부의 버킷 정책·insert 가드가
PostgREST 직접 쓰기를 막는다. H1 이월 둘(첨부 객체 존재 확인 RPC, 승인·반려의 보고 id 를 주문 잠금 아래에서 대조)과
§8.1 #4 의 실적 100 잠금 절도 넣었다. 롤백 후 카탈로그·기본 권한 diff 0, 롤백 뒤 재적용 diff 0.

Staging-verified: local db reset <date '+%Y-%m-%d %H:%M' 출력>
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='%(trailers:key=Staging-verified,valueonly)'
```
Expected: 마지막 명령이 일시를 출력한다. 비어 있으면 `git commit --amend` 로 트레일러 블록(빈 줄 없이 두 줄)을 고친다. `<date …>` 는 실제 `date '+%Y-%m-%d %H:%M'` 출력으로 채운다.

- [ ] **Step 8: 커밋 ③ — RLS 테스트**

```bash
git add tests/rls/h2-platform-admins.test.ts tests/rls/h2-table-grants.test.ts tests/rls/h2-share-token.test.ts tests/rls/h2-membership.test.ts tests/rls/h2-access-granted.test.ts tests/rls/h2-actor.ts tests/rls/h2-minute-manage-parity.test.ts tests/rls/h2-minute-bucket.test.ts tests/rls/h2-attachment-guard.test.ts tests/rls/h2-report-stale.test.ts tests/rls/workflow-parity.test.ts tests/rls/schema-invariants.test.ts tests/rls/storage-realtime.test.ts
git diff --cached --stat
git commit -m "test(rls): 0011 권한 하드닝 — 마지막 슈퍼유저 경합, 표 권한 불변식, 재가입, canEditMinute 패리티, 첨부 탐침 P1~P4, 보고 id 대조, 워크플로 패리티

done_when 의 행을 RLS 로 고정한다. 패리티 표(can_manage_minute ↔ canEditMinute)의 예외는 AUTH-11 칸뿐이고, 워크플로 패리티는
크레딧 기본값·잠금·선행 도달의 TS↔SQL 현행을 묶는다(WF-GAP-2). storage-realtime ⑪ 은 첨부 가드 때문에 객체를 먼저 올린다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(과제 10 을 뺐다면 `h2-access-granted.test.ts` 를 목록에서 뺀다.)

---

## 4단계 — 0011 뒤 코드(커밋 ④)

### Task 17: 승인·반려가 본 보고 id 를 RPC 에 넘긴다 (H2-i 의 코드)

항목: H1 이월(과제 11). UI 위험 파일 없음. 과제 16 커밋 뒤에만 한다(0011 없이는 PostgREST 가 8인자 함수를 찾지 못한다).

**Files:**
- Modify: `src/lib/agent/workflowEvent.ts`(`WorkflowEventArgs` :12-22, `REASON_TEXT` :32-44, `WorkflowEventFail` :29, `applyWorkflowEvent` :54-77), `src/app/actions/agentWork.ts`(:246-296)
- Modify(test): `tests/agent/workflow-event.test.ts`, `tests/agent/approval-stale.test.ts`

**Interfaces:**
- Consumes: 과제 14 의 RPC — `p_expected_report_id` 인자, 결과 `{ ok: false, reason: 'report_stale', stale: true, order_status }`.
- Produces:
  ```ts
  export type WorkflowEventArgs = { …기존…; /** approve·reject 전용 — 사람이 본 completion 보고 id(보고 없음 = null). */ expectedReportId?: string | null }
  export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string; stale?: true }
  // REASON_TEXT.report_stale = ERR_REPORT_STALE(@/lib/domain/agentWork)
  ```
  `approve`·`reject` 사건은 RPC 인자에 `p_expected_report_id: args.expectedReportId ?? null` 을 싣는다. 다른 사건의 인자 객체는 바뀌지 않는다.

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/workflow-event.test.ts`:
- 첫 케이스(:12-20)의 `approve` 기대 인자에 `p_expected_report_id: null` 을 더한다.
- 추가:
  ```ts
  it('approve·reject 는 본 보고 id 를 싣고, 다른 사건은 싣지 않는다', async () => {
    const { client, rpc } = admin({ data: { ok: true } })
    await applyWorkflowEvent(client, { event: 'reject', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-9' })
    expect(rpc).toHaveBeenLastCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'reject', p_expected_report_id: 'r-9' }))
    await applyWorkflowEvent(client, { event: 'claim', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-9' })
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_expected_report_id')
  })
  it('report_stale 은 stale 표시와 ERR_REPORT_STALE 문구로', async () => {
    const { client } = admin({ data: { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' } })
    expect(await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-1' }))
      .toEqual({ ok: false, conflict: false, reason: 'report_stale', stale: true, orderStatus: 'reported', error: ERR_REPORT_STALE })
  })
  ```
  (import `ERR_REPORT_STALE` from `@/lib/domain/agentWork`.)

`tests/agent/approval-stale.test.ts` 에 추가:
```ts
describe('RPC 가 주문 잠금 아래에서 다시 대조한다(0011 H2-i)', () => {
  it('앱 대조는 통과했는데 RPC 가 report_stale 이면 stale 로 답하고 검토 기록·알림이 없다', async () => {
    const { admin, reviews } = fakeAdmin({
      agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R1)],
      rpc: [{ data: { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' } }],
    })
    expect(await approveAgentCompletion(O1, R1)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'approve', p_expected_report_id: R1 }))
    expect(reviews()).toEqual([])
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })
  it('반려도 같다', async () => {
    const { admin, reviews } = fakeAdmin({
      agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R1)],
      rpc: [{ data: { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' } }],
    })
    expect(await rejectAgentCompletion(O1, '사유', R1)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'reject', p_expected_report_id: R1 }))
    expect(reviews()).toEqual([])
  })
})
```
(반려는 `loadOrderForReview` 경로다 — 파일 머리의 `requireDelegationRight` 목이 통과시킨다. 반려의 주문 조회 큐가 승인과 다르면 기존 반려 케이스(:150-170)의 큐를 따른다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/agent/workflow-event.test.ts tests/agent/approval-stale.test.ts` → 새 케이스 FAIL.

- [ ] **Step 3: 구현**

`workflowEvent.ts`:
```ts
import { ERR_REPORT_STALE } from '@/lib/domain/agentWork'
// …
export type WorkflowEventArgs = {
  // (기존 필드 그대로)
  /** approve·reject 전용 — 사람이 본 completion 보고 id(보고 없음 = null). RPC 가 주문 행 잠금 아래에서 최신 보고와 대조한다(0011 H2-i).
   *  생략하면 null 로 대조한다(보고가 있으면 stale). */
  expectedReportId?: string | null
}
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string; stale?: true }
// REASON_TEXT 에 한 줄:
  report_stale: ERR_REPORT_STALE,
// applyWorkflowEvent 의 rpc 인자:
  const { data, error } = await admin.rpc('apply_workflow_event', {
    p_event: args.event, p_actor: args.actorUserId,
    p_item_id: args.itemId ?? null, p_order_id: args.orderId ?? null, p_stage: args.stage ?? null,
    p_agent: args.agent ?? null, p_agent_user_id: args.agentUserId ?? null,
    ...(args.event === 'approve' || args.event === 'reject' ? { p_expected_report_id: args.expectedReportId ?? null } : {}),
  })
// 실패 반환:
    const fail: WorkflowEventFail = { ok: false, conflict, reason, orderStatus, error: REASON_TEXT[reason] ?? `전이 실패(${reason})` }
    return r.stale === true ? { ...fail, stale: true } : fail
```
(`@/lib/domain/agentWork` 는 순수 모듈이라 순환 import 가 없다 — `agentWork.ts` 액션이 이미 둘을 함께 import 한다.)

`agentWork.ts` 승인(:258-263)·반려(:284-289):
```ts
  // RPC 가 주문 행 잠금 아래에서 같은 보고 id 를 다시 대조한다(0011 H2-i) — 이 대조와 전이 사이의 재보고도 stale 로 막힌다.
  const fresh = await checkReportFresh(admin, orderId, expectedReportId)
  if (!fresh.ok) return fresh
  const transition = await applyWorkflowEvent(admin, { event: 'approve', actorUserId: actor.userId, orderId, expectedReportId })
  if (!transition.ok) {
    if (transition.stale) return { ok: false, stale: true, error: ERR_REPORT_STALE }
    return { ok: false, error: transition.conflict ? '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' : transition.error }
  }
```
반려도 같은 모양(`event: 'reject'`, 기존 충돌 문구 유지). '잔여 창' 주석 두 줄(:258, :284)은 위 주석으로 바뀐다.

- [ ] **Step 4: 통과·회귀** — `npx vitest run tests/agent tests/actions --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -n "잔여 창" src/app/actions/agentWork.ts` → 0건.

- [ ] **Step 5: 런타임 한 번** — `npm run test:rls -- tests/rls/h2-report-stale.test.ts` 초록을 다시 보고, `npm run dev -- -p 3101` 에서 에이전트 허브의 승인 대기 카드 하나를 승인해 본다(보고가 있는 주문이 없으면 이 단계는 "대상 없음"으로 보고한다). 끝나면 3101 을 내린다.

- [ ] **Step 6: 커밋 ④**

```bash
git add src/lib/agent/workflowEvent.ts src/app/actions/agentWork.ts tests/agent/workflow-event.test.ts tests/agent/approval-stale.test.ts
git commit -m "fix(agent): 승인·반려가 본 보고 id 를 전이 RPC 에 넘긴다 — 앱 대조와 상태 CAS 사이의 재보고도 stale 로 막힌다

앱의 보고 id 대조와 RPC 의 주문 상태 CAS 가 따로 돌아, 그 사이(ms)에 재보고가 끼면 사람이 보지 않은 보고가 승인·반려될
수 있었다(H1 과제 11 의 잔여 창). 0011 이 RPC 에 p_expected_report_id 를 더해 주문 행 잠금 아래에서 다시 대조하므로
승인·반려가 그 인자를 싣고 report_stale 을 stale 결과로 옮긴다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 부록 — H1 최종 리뷰 이월

### Task 18: 회의 예외 이중 실패·내 회의 조회 실패를 '없음'으로 위장하지 않는다 (M5)

항목: H1 최종 리뷰 `final-review-data.md` M5(스펙 §8.1 #22). UI 위험 파일 없음(`ProjectPageShell` 은 import 만 하고 고치지 않는다). 0011 과 무관 — 순서 자유, DB 를 쓰지 않는다.

결함:
- `fetchExceptionsByIds`(`src/lib/data/meetings.ts:59-70`)는 임베드 조회가 실패한 뒤 별도 조회까지 실패하면 로그만 남기고 `[]` 를 돌려준다 — 취소된 회차가 달력·대시보드·보고서·AI 브리핑에 살아 있는 것처럼 보인다.
- `getMyMeetings`(:189-236)는 `selectMeetings` 의 `failed` 를 보지 않는다(구조 분해에서 빠졌다) — 회의 조회가 실패하면 '이번 달 회의 없음'과 KPI 0 을 그린다. 결과형이 없어 호출부(`meetings/page.tsx`, `fetchMyMeetings` → `MyMeetingsView`)가 실패를 알 수 없다.

**Files:**
- Modify: `src/lib/data/meetings.ts:59-70,107-128,189-236`, `src/app/actions/meetings.ts:284-292`, `src/app/(app)/meetings/page.tsx`, `src/components/meetings/MyMeetingsView.tsx`
- Modify(test): `tests/lib/meetings-exception-embed.test.ts`, `tests/ui/meetings-project-chips.test.tsx`·`tests/ui/deep-link-params.test.tsx`(목 `fetchMyMeetings` 의 반환에 `ok: true`)
- Create(test): `tests/ui/my-meetings-load-error.test.tsx`

**Interfaces:**
```ts
// src/lib/data/meetings.ts
export type MyMeetingsResult =
  | { ok: true; meetings: Meeting[]; exceptions: MeetingException[] }
  | { ok: false; error: string }
export const getMyMeetings: (gridStartIso: string, gridEndIso: string) => Promise<MyMeetingsResult>
// 비로그인은 { ok: true, meetings: [], exceptions: [] }(호출부가 세션을 따로 본다 — 지금과 같다). 회의 조회 실패·예외 폴백 실패는 ok:false(ERR_MEETINGS_LOAD).
// getProjectMeetingData 의 반환형은 그대로 — 예외 폴백 실패도 { ok: false, error: ERR_MEETINGS_LOAD }.
// src/app/actions/meetings.ts
export async function fetchMyMeetings(gridStartIso: string, gridEndIso: string): Promise<MyMeetingsResult>
// src/components/meetings/MyMeetingsView.tsx — 새 prop
initialFailed?: boolean
```

- [ ] **Step 1: 실패하는 테스트 — 로더** (`tests/lib/meetings-exception-embed.test.ts`)

- `getMyMeetings` 의 기존 기대 `{ meetings: [], exceptions: [] }` 를 `{ ok: true, meetings: [], exceptions: [] }` 로, `res.meetings`·`res.exceptions` 를 쓰는 곳은 `res.ok` 확인 뒤로 바꾼다(`if (!res.ok) throw new Error('ok 여야 한다')`).
- 추가:
```ts
describe('조회 실패를 없음으로 위장하지 않는다(M5)', () => {
  it('getProjectMeetingData: 임베드 실패 뒤 예외 별도 조회까지 실패하면 ok:false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({ meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])), exceptions: ERR('boom') })
    expect(await getProjectMeetingData('p1')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
  })
  it('getMyMeetings: 회의 조회가 재시도까지 실패하면 ok:false — 빈 달력이 아니다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    expect(await getMyMeetings('2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
  })
  it('getMyMeetings: 임베드 실패 뒤 예외 별도 조회까지 실패하면 ok:false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({
      user: { id: 'u1', email: null },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])),
      exceptions: ERR('boom'),
    })
    expect(await getMyMeetings('2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
  })
})
```
(`getProjectMeetingData`·`getMyMeetings` 는 React `cache()` 로 감싸여 있다 — 파일의 기존 케이스가 인자를 바꿔 캐시를 피하는 방식을 쓰면 그대로 따른다. `console.error` 스파이는 파일의 `afterEach` 가 되돌리는지 확인한다.)

- [ ] **Step 2: 실패하는 테스트 — 화면** (`tests/ui/my-meetings-load-error.test.tsx`)

```tsx
// @vitest-environment jsdom
// 내 회의 — 조회 실패는 '이번 달 회의 없음'이 아니라 사유와 재시도로 보인다(M5, 에러 처리 3원칙 ①).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ fetchMyMeetings: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/app/actions/meetings', () => ({
  fetchMyMeetings: mocks.fetchMyMeetings,
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/minutes', () => ({ fetchMeetingMinutesLite: vi.fn(async () => []) }))
vi.mock('@/app/actions/announcements', () => ({ createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })) }))

import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'

describe('MyMeetingsView — 조회 실패', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.fetchMyMeetings.mockReset()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('initialFailed 면 경고와 재시도, 재시도가 성공하면 경고가 사라진다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
    await act(async () => {
      root.render(<MyMeetingsView initialMeetings={[]} initialExceptions={[]} initialFailed todayIso="2026-07-19" currentUserId={null} />)
      await Promise.resolve()
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('common.loadFailed.meetings')
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('common.retry'))
    await act(async () => { retry!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.fetchMyMeetings).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('달을 옮겨 다시 읽다가 실패하면 경고가 뜬다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await act(async () => {
      root.render(<MyMeetingsView initialMeetings={[]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null} />)
      await Promise.resolve()
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('common.loadFailed.meetings')
  })
})
```
`tests/ui/meetings-project-chips.test.tsx`·`tests/ui/deep-link-params.test.tsx` 의 `fetchMyMeetings` 목 반환에 `ok: true` 를 더한다(`deep-link-params.test.tsx:34` 의 `({ meetings: [], exceptions: [] })` → `({ ok: true, meetings: [], exceptions: [] })`, 칩 테스트의 `mockResolvedValue` 도 같다).

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/lib/meetings-exception-embed.test.ts tests/ui/my-meetings-load-error.test.tsx` → FAIL.

- [ ] **Step 4: 구현 — 로더** (`src/lib/data/meetings.ts`)

```ts
/** 임베드가 불가했을 때만 쓰는 폴백 — 예외를 별도 왕복으로 읽는다. 실패면 null — 취소 회차가 되살아나 보이지 않게
 *  호출부가 회의 일정 전체를 실패로 보인다(에러 처리 3원칙 ①). */
async function fetchExceptionsByIds(
  sb: ServerClient, ids: string[], tag: string,
): Promise<MeetingException[] | null> {
  if (!ids.length) return []
  const { data, error } = await sb
    .from('meeting_exceptions')
    .select('meeting_id, occurrence_date, kind')
    .in('meeting_id', ids)
  if (error) {
    console.error(`[${tag}] meeting_exceptions 조회 실패 — 회의 일정을 실패로 보인다:`, error.message)
    return null
  }
  return (data ?? []).map((e: Row) => toException(e))
}

export type MyMeetingsResult =
  | { ok: true; meetings: Meeting[]; exceptions: MeetingException[] }
  | { ok: false; error: string }
```
`getProjectMeetingData`(:124-127):
```ts
  const exceptions = embedded
    ? exceptionsFrom(rows)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), 'getProjectMeetingData')
  if (exceptions === null) return { ok: false, error: ERR_MEETINGS_LOAD }
  return { ok: true, meetings, exceptions }
```
`getMyMeetings`: 반환형을 `Promise<MyMeetingsResult>` 로. 비로그인 반환을 `{ ok: true, meetings: [], exceptions: [] }` 로. `const [myMemberIdList, { rows, embedded, failed }] = …` 로 `failed` 를 받아 `if (failed) return { ok: false, error: ERR_MEETINGS_LOAD }`(목록 매핑 전). 끝을
```ts
  const exceptions = embedded
    ? exceptionsFrom(rows)
    : await fetchExceptionsByIds(sb, meetings.map(m => m.id), 'getMyMeetings')
  if (exceptions === null) return { ok: false, error: ERR_MEETINGS_LOAD }
  return { ok: true, meetings, exceptions }
```

`src/app/actions/meetings.ts` `fetchMyMeetings`: 반환형 `Promise<MyMeetingsResult>`(import `type MyMeetingsResult`), 비로그인 `{ ok: true, meetings: [], exceptions: [] }`.

- [ ] **Step 5: 구현 — 화면**

`src/app/(app)/meetings/page.tsx`:
```tsx
  const [res, m, user, locale] = await Promise.all([getMyMeetings(gs, ge), getActorForView(), getSession(), getServerLocale()])
  const meetings = res.ok ? res.meetings : []
  const exceptions = res.ok ? res.exceptions : []
  const mineOcc = expandMeetings(meetings.filter(x => x.isMine), exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(mineOcc, today)
  // 조회 실패면 KPI 는 0 이 아니라 '—'(모름)다
  const kpi = (n: number) => (res.ok ? n : '—')
```
KPI 세 개의 `value={todayN}` 등을 `value={kpi(todayN)}` 로, `<MyMeetingsView … initialFailed={!res.ok} />`.

`src/components/meetings/MyMeetingsView.tsx`:
- props 에 `initialFailed = false`(타입 `initialFailed?: boolean` + 한 줄 주석 "서버 첫 조회 실패 — 빈 달력 대신 경고와 재시도(M5)").
- 상태 `const [failed, setFailed] = useState(initialFailed)`.
- 재조회 effect(:100-107)를 다음으로.
  ```tsx
    startTransition(async () => {
      const res = await fetchMyMeetings(gridStart, gridEnd)
      if (!alive) return
      const range = `${gridStart}|${gridEnd}`
      if (res.ok) { setFailed(false); setData({ meetings: res.meetings, exceptions: res.exceptions, range }) }
      else { setFailed(true); setData({ meetings: [], exceptions: [], range }) }
    })
  ```
- 툴바 블록(:167 의 sticky div) 바로 아래에 `{failed && <LoadErrorNotice message={t('common.loadFailed.meetings')} onRetry={() => setReloadKey(k => k + 1)} busy={pending} />}` 를 둔다(import `LoadErrorNotice` from `@/components/ui/LoadErrorNotice`). 문구는 이미 있는 사전 키 `common.loadFailed.meetings`(ko·en)다.

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/lib tests/ui tests/actions --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `npm run typecheck` 가 `getMyMeetings` 의 다른 호출부를 알려 주면 같은 결과형 처리로 고친다(조사 시점 호출부는 `meetings/page.tsx`·`actions/meetings.ts` 둘뿐).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/data/meetings.ts src/app/actions/meetings.ts "src/app/(app)/meetings/page.tsx" src/components/meetings/MyMeetingsView.tsx tests/lib/meetings-exception-embed.test.ts tests/ui/my-meetings-load-error.test.tsx tests/ui/meetings-project-chips.test.tsx tests/ui/deep-link-params.test.tsx
git commit -m "fix(meetings): 회의 예외 이중 실패·내 회의 조회 실패를 빈 결과로 위장하지 않는다

예외 폴백 조회까지 실패하면 빈 목록을 돌려줘 취소된 회차가 달력·대시보드·보고서에 살아 있는 것처럼 보였고, 내 회의는
회의 조회 실패를 보지 않아 '이번 달 회의 없음'과 KPI 0 을 그렸다(H1 최종 리뷰 M5). 둘 다 결과형으로 실패를 돌려주고
내 회의 화면은 경고와 재시도, KPI 는 '—' 로 보인다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 완료 조건 대조

스펙 H2 done_when(§6.2.0 끝) → 과제·테스트.

| 완료 조건 | 과제 | 테스트 |
|---|---|---|
| 재가입: 빠졌다 member 로 재초대되면 재초대한 프로젝트는 member, 같은 워크스페이스 다른 프로젝트는 null | 9(+3) | `h2-membership.test.ts` "재가입" |
| 마지막 슈퍼유저 직접 DELETE·UPDATE 거부, 두 연결 동시 해제에도 1명, `auth.users` 캐스케이드 통과 | 6(+2) | `h2-platform-admins.test.ts` 전부 |
| anon·authenticated 의 t/x/m(+truncate) 0, 기본 권한에서도 빠짐 | 7 | `h2-table-grants.test.ts` 1·2·3 + 16 사후검증 |
| 멤버의 `share_token` SELECT 42501, 편집자의 공개 설정은 서버 경로로 | 8(+1) | `h2-share-token.test.ts`, `minutes-workspace-scope.test.ts` 공유 describe |
| 제8부 탐침 P1~P4 거부 | 13 | `h2-attachment-guard.test.ts` P1~P4 |
| `canEditMinute` ↔ `can_manage_minute` 패리티, 예외는 AUTH-11 칸뿐 | 11(+3) | `h2-minute-manage-parity.test.ts` |
| (H1 이월 g) 객체가 이미 없는 행은 지우고, 읽을 수 없을 뿐인 객체의 행은 남긴다 | 4, 12 | `remove-stored-attachment.test.ts`, `h2-minute-bucket.test.ts` "'issue'" |
| (H1 이월 i) 대조와 CAS 사이 재보고 → 승인·반려 stale | 14, 17 | `h2-report-stale.test.ts`, `approval-stale.test.ts` "RPC 가 … 다시 대조" |
| `db:reset` → `dev:bootstrap` → `test:rls` 초록(건너뜀 0) | 16 | Step 3·6 |
| (§8.1 #4) 실적 100 잠금 절 + 현행 패리티 | 15(+5) | `workflow-parity.test.ts` |
| (스펙 커밋 행) 앱 호환 코드 → `0011`+롤백 `Staging-verified` → RLS 테스트 | 1~5, 16 | 커밋 ①·②·③(+④ 과제 17) |
| (M5) 회의 예외·내 회의 조회 실패 표시 | 18 | `meetings-exception-embed.test.ts`, `my-meetings-load-error.test.tsx` |

## Self-Review

**1. 스펙 항목 → 과제(누락 0).**

| 스펙 H2 항목·불릿 | 과제 |
|---|---|
| a 정책 drop + I/U/D/T revoke | 6 |
| a `platform_admins_keep_last`, 같은 user_id UPDATE 통과 | 6 |
| a advisory 잠금(for update 금지) | 6(+정의 검사) |
| a `auth.users` 캐스케이드 면제(§8.2 ④) | 6 |
| a `accounts.ts` 사전 count 제거·문구 | 2 |
| b t/x/m/D 전 테이블 + 기본 권한 | 7 |
| b 정책 없는 13표 명령 단위 | 7 |
| b 사후 검사, 롤백 명시 목록, 함수 PUBLIC EXECUTE 범위 밖 | 7(범위 밖은 Global Constraints·과제 7 머리) |
| c 코드 먼저(`readShareRow`) | 1 |
| c 표 SELECT revoke + 열 grant | 8 |
| c 불변식 "share_token 외 모든 열 grant" | 8 |
| d ⓪ 사전 검사(raise) + 운영자 절차 | 9(Interfaces·Step 7), 16 Step 5 |
| d `workspace_members` 트리거 | 9 |
| d `no_self_demote` 에 `is_ws_member` | 9 |
| d `grant update(role)` 만 | 9(`workspace_members` 로 해석) |
| d `upsert_project_member` ①·개명 | 9 |
| d `buildActor.ts:54-57` | 3 |
| e 열 UPDATE revoke, INSERT 열 목록, 세션만 `auth.uid()`, SET NULL 고정 안 함, `invited_by` SP3a | 10 |
| f `can_manage_minute` 개정, `has_project_role_in_ws`, AUTH-11 유지·문서화 | 11 |
| g insert/delete entity 별, `minute-files` 삽입·삭제 술어, 본문 entity·WORM 유지 | 12 |
| g(H1 이월) 존재 확인 RPC + 공용 삭제 도우미 + fail-closed | 12, 4 |
| h 가드 검사 순서 1~6 | 13 |
| h 부분 유니크 인덱스, UPDATE 정책 drop + revoke | 13 |
| h 픽스처·`storage-realtime.test.ts:255-276` 재구성 | 13(⑪ 재구성. 픽스처는 불필요 — File Structure 아래 설명) |
| i `p_expected_report_id`, 주문 잠금 아래 비교, 승인·반려 | 14, 17 |
| §8.1 #4 잠금 절 + `workflow-parity.test.ts` | 15 |
| 커밋 셋(+④) | Global Constraints, 16, 17 |
| H1 최종 리뷰 M5 | 18 |

**2. 자리표시자 점검.** "TBD·적절히·나중에" 문구는 없다. 의도적으로 "파일에서 그대로 옮긴다"고 한 곳은 여섯이다 — `upsert_project_member`(0004:15-172, 두 곳 치환을 전문으로 줬다), `project_members_no_self_demote`·`project_members_guard`(0003, 롤백), `can_manage_minute`·버킷 정책 둘·UPDATE 정책(0007, 롤백), `apply_workflow_event`(0000:731-944, 정방향은 두 곳 치환을 전문으로 줬다). 리허설 R 의 카탈로그 대조가 본문 바이트를 비교하므로 계획에 옮겨 적으면 공백이 틀어질 위험이 더 크다. 과제 16 Step 2 가 `<sed` 설명 줄이 파일에 남지 않았는지 grep 한다. 커밋의 `<date …>` 는 커밋 시각이라 미리 쓸 수 없다. 실측으로 확정하는 곳은 셋이다 — 과제 7 Step 0(권한 목록), 과제 13 Step 5(Storage 메타데이터 키), 과제 5·17 의 목 큐 순서(기존 케이스의 순서를 따른다).

**3. 이름·시그니처 일관성(과제 간 공유).**
- `PLATFORM_LAST_ADMIN`(6 → 2).
- `attachment_object_exists(p_kind text, p_id uuid) → boolean`, kind `'deliverable' | 'issue' | 'minute'`, `ATTACHMENT_FORBIDDEN`·`ATTACHMENT_KIND_INVALID`(12 ↔ 4 `AttachmentKind`·`removeStoredAttachment`).
- `MINUTE_ATTACHMENT_{LIMIT,DUPLICATE,ARCHIVED,PATH,OBJECT}`(13 → 5).
- `WORKFLOW_ACTUAL_LOCKED`(15 → 5 `ACTUAL_LOCKED_MSG`).
- `p_expected_report_id`, `report_stale`·`stale: true`(14 → 17 `expectedReportId`·`WorkflowEventFail.stale`·`REASON_TEXT.report_stale`).
- `has_project_role_in_ws(wid uuid)`(11 → 11 `can_manage_minute`, `schema-invariants` 두 목록).
- `workspace_members_revoke_access`, `platform_admins_keep_last`, `minute_files_attachment_guard`, `guard_workflow_actual`(각 과제 → 16 사후검증 이름 목록).
- `actorFromDb`(11) = `buildActor` 규칙(3).
- `DML_WITHOUT_POLICY`(7 테스트) = 16 사후검증의 같은 조건.
- `MyMeetingsResult`·`initialFailed`(18).

**4. 충돌표 — 같은 파일·인터페이스를 쓰는 과제 쌍(뒤 과제는 앞 과제 뒤에).**

| 쌍 | 공유하는 것 | 순서 |
|---|---|---|
| 1 ↔ 4 ↔ 5 | `src/app/actions/minutes.ts`(공유 / 첨부 삭제 / 첨부 기록) | 1 → 4 → 5 |
| 1 ↔ 4 | `tests/actions/minutes-workspace-scope.test.ts` `fakeClient`(select 기록 / rpc) | 1 → 4 |
| 1 ↔ 8 | `share_token` 을 세션이 읽지 않는다는 전제 | 1 커밋 → 8 |
| 2 ↔ 6 | `PLATFORM_LAST_ADMIN` | 2(코드) → 6(SQL) |
| 3 ↔ 11 | 소속 밖 명단 행 버림 규칙(`actorFromDb`) | 3 → 11 |
| 4 ↔ 12 | RPC 이름·인자·반환·오류 | 4(호출) → 12(정의) |
| 5 ↔ 13 | 첨부 가드 사유 코드 | 5 → 13 |
| 5 ↔ 15 | `WORKFLOW_ACTUAL_LOCKED`, 실적 잠금 경계 세 값 99·99.5·100(TS 쪽은 5 의 테스트, SQL 쪽은 15 의 `ACTUAL_BOUNDARY`) | 5 → 15 |
| 6 ~ 15 | `0011_authz_hardening.sql`(끝에 덧붙임)·롤백(`begin;` 아래 끼움) | 6 → 7 → … → 15 엄격 |
| 6 ↔ 7 | `platform_admins` 권한(I/U/D/T 는 6, t/x/m 은 7, 롤백 겹침 멱등) | 6 → 7 |
| 7 ↔ 13 ↔ 16 | "정책 없는 DML 0" 불변식(13 이 UPDATE 정책·권한을 함께 걷는다) | 7 → 13 → 16 |
| 9 ↔ 10 | `project_members` 트리거 둘(`no_self_demote` / `guard`)과 권한(UPDATE 열 / INSERT 열) | 9 → 10 |
| 11 ↔ 12 ↔ 13 | `can_manage_minute`(정책·RPC·가드가 부른다) | 11 → 12 → 13 |
| 11 ↔ 12 | `tests/rls/schema-invariants.test.ts`(`HELPER_FNS`·`DEFINER_EXECUTABLE`) | 11 → 12 |
| 12 ↔ 13 | `storage.objects` 의 minute-files 경로(정책 / 가드 ④), `storage-realtime.test.ts`(⑪ 은 13 만 고친다) | 12 → 13 |
| 14 ↔ 15 | `apply_workflow_event` 8인자(15 의 패리티가 8인자로 부른다) | 14 → 15 |
| 14 ↔ 17 | `p_expected_report_id`·`report_stale` | 14 → 16 커밋 → 17 |
| 16 ↔ 6~15 | 커밋 ②·③ 이 6~15 의 파일을 담는다 | 6~15 → 16 |
| 18 | 없음(다른 과제와 파일 공유 없음) | 자유 |

**5. 스펙 줄 번호 대조(`bdbcfac` 실측).**

| 스펙이 적은 곳 | 지금 |
|---|---|
| `actions/minutes.ts:1387-1394`(`readShareRow`), `:1396`(공개 게이트) | `:1421-1429`, `setMinuteShare` `:1441-1456` |
| `authz.ts:114-119`(`canEditMinute`), `:111` | `:114-117`(주석 `:108-113`) |
| `authz.ts:168-174` | `isAnyProjectAdmin` `:174-180`·`adminProjectIds` `:188-194`·`hasAnyProjectRole` `:205-208` |
| `authz.ts:204-211`(`hasProjectRoleInWorkspace`) | `:210-217` |
| `dev-bootstrap.mjs:48-58` | 롤백 함수 `:51-56`, 단계 `:58-66` |
| `accounts.ts:325-334` | `:325-333` |
| `0003:633-635` "명시적 grant all" | `workspaces` 의 grant(`:633-635`) — `platform_admins` 는 `:643-645`. 같은 모양이 `:656·665·683·703·712·726` 에도 있다(b 는 전부를 덮는다) |
| `0008:206-209` | `:206-208` |
| `storage-realtime.test.ts:255-276` | describe `:255`, ⑪ `:258-276` |
| `wbs.ts:142-161`(§3.0), `:146-161`(§3.3.5) | 잠금 `:142-159`, 갱신 `:171-176` |

**6. Review Focus → 과제 테스트.** 1 → 과제 12 "Review Focus 1", 2 → 과제 13 "Review Focus 2", 3 → 과제 9 "Review Focus 3", 4 → 과제 12 "Review Focus 4", 5 → 과제 1 불변식 + 과제 8 셋째 케이스·Step 7 런타임 확인.

**7. 스펙 이탈 — 컨트롤러가 승인했고, 스펙(§6.2.0 H2·§3.3.5·§2.11)을 뒤에 고친다.**

| 스펙 | 이 계획 | 이유 | 과제 |
|---|---|---|---|
| §3.3.5 `guard_workflow_actual`: `coalesce(new.actual_pct, 0) < 100 then return new`(100 이상만 막음) | `<= 99 then return new`(99 초과를 막음) | DB 가드가 앱(`wbs.ts:146` `newPct > 99`)보다 느슨하면 안 된다. `actual_pct` 는 numeric 이라 99.5 를 앱은 막고 스펙 식은 통과시킨다. 경계 99·99.5·100 을 양쪽에서 시험한다 | 15, 5 |
| §6.2.0 H2 커밋 행: 커밋 셋(① 코드 → ② 마이그레이션 → ③ RLS 테스트) | 커밋 넷 — ④ 로 승인·반려의 RPC 새 인자 코드(과제 17) | 새 인자를 넘기는 코드는 0011 없이는 PostgREST 가 함수를 찾지 못해 ① 에 둘 수 없다 | 16, 17 |
| §6.2.0 g: `minute-files` 삭제 = … ∨ (소유자 ∧ 미참조) | (소유자 ∧ 경로 워크스페이스 소속 ∧ 미참조) | 미참조 서브쿼리는 호출자 RLS 로 돌아 워크스페이스를 떠난 소유자에게 참조 행이 가려진다 — 참조된 객체를 지울 수 있게 된다 | 12 |
| §2.11 H2 행: `fixture-ws.sql:133-135` 첨부 행이 새 가드에 걸려 픽스처를 다시 만든다 | 픽스처 불변 | 픽스처는 `postgres`(auth.uid() null)로 들어가 가드 ① 에서 곧장 통과한다. 같은 이유로 service_role 첨부 insert 는 가드를 건너뛴다(Global Constraints 의 알려진 우회) | 13 |
