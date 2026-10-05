# 사용자 DB(메인 스택) 마이그레이션 적용 runbook — SP4·UI-2·SP5·SP5b (0013~0026)

> **2026-10-06 추가 적용 대상: 0038_ai_index_job_scope.** 메인 DB의 현재 max(version)=0037을 읽기 전용으로 확인했다. 이번 적용은 0038 하나이며 아래 0013~0026 절은 과거 이관 기록이다.
> 0038은 사용자 정의 필드 저장 뒤 색인 잡 등록이 workspace_id NOT NULL 오류로 실패하는 문제를 고친다. 데이터/열 삭제 없이 기존 RPC를 교체한다. 프로젝트의 workspace를 서버에서 확정하고 범위가 다른 job_key 재사용을 거부한다.
> 격리 전체 reset·RLS 913건·롤백/재적용 통과. 사전 백업 `/Users/jerry/D-Flow-backup/20261006-ai-index-scope/full.dump` (pg_restore 목록 확인).
> 메인 DB를 사용 중인 서버·도구와 작업 중인 데이터 유무에 대한 사용자 답변을 받은 뒤, `supabase migration up --local`로 적용한다. **db reset은 하지 않는다.** 적용 후 max(version)=0038과 등록 RPC의 workspace 확정 동작을 확인한다.


> 대상: 사용자의 로컬 개발 데이터가 든 **메인 스택**(`/Users/jerry/D-Flow` 체크아웃, project_id `d-flow`, DB `54322`·API `54321`, 컨테이너 `supabase_db_d-flow`).
> 이 스택은 개발 중 한 번도 `db:reset` 한 적이 없는 실데이터이며 평소 내려 둔다. **이 문서의 절차는 사용자의 명시적 확인(§8 #13) 뒤에만 실행한다**
> — 에이전트가 혼자 시작하지 않는다. 전용 스택(`d-flow-sp4` 54521/54522·`d-flow-lane-b` 54421/54422)과 헷갈리지 않는다.

## 0. 무엇이 올라가는가

| 번호 | 파일 | 출처 | 성격 |
|---|---|---|---|
| 0013 | `weekly_areas` | SP4 A1 | 주간 행을 영역 id 로 이관 — **되돌릴 수 없음**: 구분이 같은 행을 합치고, 모듈이 구분과 다르면 기존 행 본문 앞에 `[모듈]` 머리표를 쓴다(라벨 = `btrim(section)`) |
| 0014 | `command_receipts` | SP4 A1 | 가져오기 영수증(멱등) 표·RPC |
| 0015 | `authz_carry` | SP4 A1 | 권한 이월 — `people.email` 열 권한 회수·권한 이력 기록 트리거 둘·명단 인물 불변·설정 RPC 의 명시 키 거부(기존 함수 `create or replace`) |
| 0016 | `team_scope_lock_order` | SP4 A2 | 공용 팀 참조 거부 트리거의 판정·잠금 순서 수정(함수 교체) |
| 0017 | `copy_config_team_map` | SP4 A2 | 프로젝트 복사 시 영역 팀을 code 로 대응(함수 교체) |
| 0018 | `account_preferences` | SP3b UI-2 | 새 표(개인 설정) — 롤백 쉬움 |
| 0019 | `calendar` | SP5 A | `holidays.kind`·주 키 트리거·`p_timezone`·**시간대 `Asia/Seoul` 기록·주 시작 일요일 이관(⑩, 결정 #2 — 주간보고가 있는 프로젝트도 "다음 주부터" 일요일)** — **되돌릴 수 없음**: 롤백 파일이 설정 값·이력을 지우지 않는다 |
| 0020 | `issue_areas` | SP5 B1 | 이슈 영역·코드 이관 — **되돌릴 수 없음**: 분류 이슈 코드는 기존 분석 코드에서 유지하고 PI 프로젝트의 미분류는 `PI-U-…`, 나머지는 `ISS-…`를 받는다. 전역 Mega 영역을 프로젝트 영역 행으로 옮기고 `modules.*`·`issues.analysis`·PI 프로젝트 `issues.id_policy` 설정 이력을 기록한다. 롤백은 모든 이슈 영역 code 가 숫자 두 자리일 때만 허용되며 코드 문자열·영역 분류·이관 설정 값과 WORM 이력을 되돌리지 않는다 |
| 0021 | `attachments` | SP5 B3 | `minute_files` 톰스톤 열(삭제 표시·청소)·첨부 정책 판정 트리거 — 데이터 변화는 열 기본값뿐. 롤백은 톰스톤 행이 남으면 `ATTACHMENTS_ROLLBACK_BLOCKED` |
| 0022 | `semantic_scope` | SP5 B3 | 의미검색 RPC 두 개에 범위 인자(함수 교체) — 데이터 변화 없음 |
| 0023 | `vocab_settings` | SP5 B4 | 근태·회의·이슈 어휘 다섯의 고정 check 를 걷고 설정 판정 트리거·참조 검사·이관 RPC — 데이터 변화 없음(기존 code 는 제품 기본 어휘 안). 롤백은 기본 어휘 밖 code 가 있으면 `VOCAB_ROLLBACK_BLOCKED` |
| 0024 | `minutes_teams` | SP5 B2 | 회의록 폴더 `kind`·`team_id`(팀 루트 이름 = 팀 이름으로 이관)·회의록 `team_id`(code 단위 이관)·종류/범위 가드·`create_team`·`ensure_team_roots`·개명 동기·세션 공용 팀 INSERT 정책 삭제. **사전검사 `MINUTES_TEAMS_PRECHECK`**(팀 이름과 같은 이름의 최상위 사용자 폴더 / 61자 넘는 팀 이름이면 멈춘다). 롤백은 폴더 이름을 code 로 되돌린 뒤 열을 지운다(`MINUTES_TEAMS_ROLLBACK_BLOCKED` — 되돌릴 이름이 겹치면 멈춘다). 회의록 `team_id` 이관 결과는 되돌리지 않는다(`team_code` 원문이 남는다) |
| 0025 | `issue_status_vocab` | SP5b I | 이슈 `status_code`(표시 상태 — 기존 이슈는 `status` 와 같은 code 로 이관)·판정 트리거·상태 이력 트리거(DB 가 `issue_updates(kind='status')` 를 쓴다)·`workflow.issue_statuses` 참조 검사·이관 분기(같은 범주만). **사전검사 `ISSUE_STATUS_PRECHECK`**(손상된 `workflow.issue_statuses` 가 있으면 멈춘다 — 키를 쓴 프로젝트가 없으면 0). 데이터 변화: 새 열 이관뿐, 설정을 바꾸기 전까지 동작 동일 |
| 0026 | `workflow_policy` | SP5b W1 | WBS 승인 라운드 열(`review_round`·`review_steps` — im·xx 항목은 1·`{review}` 로 이관)·승인 원장 `wbs_stage_approvals`·`apply_workflow_event` 9인자 교체·**JWT 의 흐름 다섯 열 쓰기 차단**(`guard_workflow_columns` — 관리자가 PostgREST 로 `stage`·`dev_workflow`·`tags` 를 바로 바꾸던 길이 닫힌다, §8 #2)·실적 100 가드 교체·`set_dependency_waiver` 삭제. **사전검사 `WORKFLOW_POLICY_PRECHECK`**(손상된 `workflow.*` 설정 — 특히 0012 이래 조용히 기본값으로 풀리던 `workflow.stage_credits` — 가 있으면 멈춘다). 롤백은 흐름 설정·대기 라운드·원장 행이 있으면 `WORKFLOW_POLICY_ROLLBACK_BLOCKED` |

사용자가 미리 답한 결정: §8 #1(주차 라벨 통일 — 계산값이라 저장 없음)·#2(전환). 마이그레이션 본문과 사후검사는 `supabase/migrations/`, 롤백은 `supabase/rollbacks/`,
리허설 SQL 은 `supabase/rehearsal/`.

## 1. 사전 확인(읽기 전용)

1. 사용자에게 확인: 지금 개발 서버(`npm run dev`)·다른 도구가 이 스택을 쓰지 않는지, 작업 중인 데이터가 없는지.
2. 메인 스택이 내려가 있으면 `cd /Users/jerry/D-Flow && npm run db:start`(컨테이너만 올린다 — 마이그레이션은 자동 적용되지 않는다).
3. 현재 버전과 규모: `docker exec supabase_db_d-flow psql -U postgres -d postgres -tAc "select max(version) from supabase_migrations.schema_migrations"` (→ 0011 또는 0012 가 예상, 다르면 멈추고 사용자에게 알린다),
   주간·팀·프로젝트 행 수(`weekly_reports`·`weekly_report_rows`·`projects`·`teams`·`holidays`·`wbs_items`)를 기록한다 — 이관 뒤 대조용.
   B1 의 읽기 전용 사전 수치도 기록한다: 이슈 전체·`mega_code` 있음·`pi_issue_code` 있음 행 수, PI 프로젝트 수(분류 이슈가 있는 프로젝트)와 그 프로젝트의 미분류 이슈 수, `issue_mega_areas` 행 수·code·이름, `issue_number_counters` 행 수, `issue_major_processes` 행 수, `project_areas where kind='issue_area'` 중 code 가 `^[A-Z0-9]{1,8}$` 밖인 행. 마지막 결과가 0이 아니면 `ISSUE_AREAS_PRECHECK` 가 멈추므로 적용 전에 영역을 정리한다. 예시 SQL:

   ```sql
   select count(*) as issues, count(*) filter (where mega_code is not null) as mega_issues,
          count(*) filter (where pi_issue_code is not null) as pi_issues from public.issues;
   with pi as (select distinct project_id from public.issues where pi_issue_code is not null)
   select (select count(*) from pi) as pi_projects,
          (select count(*) from public.issues i join pi using (project_id) where i.mega_code is null) as pi_unclassified;
   select count(*) as legacy_mega_areas from public.issue_mega_areas;
   select code, name from public.issue_mega_areas order by code;
   select count(*) as counters from public.issue_number_counters;
   select count(*) as major_processes from public.issue_major_processes;
   select project_id, code from public.project_areas
    where kind = 'issue_area' and code !~ '^[A-Z0-9]{1,8}$' order by project_id, code;
   ```
   B2(0024)의 읽기 전용 사전 수치도 기록한다 — 사전검사가 멈출 데이터가 있는지 미리 본다(둘 다 0이어야 한다):

   ```sql
   -- 최상위(parent_id null) 사용자 폴더 중 같은 범위 팀 이름과 겹치는 것
   select f.id, f.name from public.minute_folders f join public.teams t on t.workspace_id = f.workspace_id
    where f.parent_id is null and f.created_by is not null and pg_catalog.btrim(f.name) = pg_catalog.btrim(t.name)
      and (t.project_id is null or t.project_id = f.project_id);
   select id, name from public.teams where length(btrim(name)) > 60;
   -- 이관 대조용: 시드 루트(옛 판정) 수·회의록 수·팀 code 별 회의록 수
   select count(*) from public.minute_folders where parent_id is null and created_by is null;
   select team_code, count(*) from public.minutes group by 1 order by 1;
   ```
   SP5b(0025·0026)의 읽기 전용 사전 수치 — `npm run settings:verify` 가 문제 0 이면 두 사전검사도 통과한다(같은 판독). 이관 대조용 수치를 함께 남긴다:

   ```sql
   select status, count(*) from public.issues group by 1 order by 1;               -- 0025 뒤 status_code 가 같은 분포여야 한다
   select stage, count(*) from public.wbs_items group by 1 order by 1;              -- 0026 뒤 im·xx 수 = review_round 1 인 행 수
   select project_id, "values" -> 'workflow.stage_credits' from public.project_settings where "values" ? 'workflow.stage_credits';
   ```
4. 적용 코드: 메인 체크아웃이 `main`(SP5b 반영본 — `sp5b-done`) 최신인지 `git status`·`git log -1`.

## 2. 덤프(되돌림의 유일한 수단)

롤백 SQL 은 구조만 되돌리고 이관된 데이터(주간 행 본문·시간대·주 시작 규칙·이력)는 되돌리지 못한다 — **덤프가 롤백이다.**

```bash
D=/Users/jerry/D-Flow-backup/$(date +%Y%m%d-%H%M); mkdir -p "$D"        # 저장소 밖, 권한 700
docker exec supabase_db_d-flow pg_dump -U postgres -d postgres -Fc -f /tmp/full.dump
docker cp supabase_db_d-flow:/tmp/full.dump "$D/full.dump" && docker exec supabase_db_d-flow rm /tmp/full.dump
docker exec supabase_db_d-flow pg_dump -U postgres -d postgres --data-only -n public -n auth -f /tmp/data.sql
docker cp supabase_db_d-flow:/tmp/data.sql "$D/data.sql" && docker exec supabase_db_d-flow rm /tmp/data.sql
ls -l "$D"; pg_restore -l "$D/full.dump" | head -3                       # 크기·목차 확인
```
덤프 파일에는 계정·해시가 들어 있다 — 저장소·대화에 올리지 않는다.

## 3. 전용 스택에서 리허설(메인 스택은 건드리지 않는다)

전용 스택 `d-flow-sp4`(레인 A 래퍼 `/Users/jerry/D-Flow-wt/lane-a-run.sh` 가 DSN 54522 로 고정한다)에서:
1. 사용자 DB 와 **같은 버전**까지만 만든다: `lane-a-run.sh npx supabase db reset --version <1단계에서 본 N>`(주의: 그 워크트리가 `main` 의 마이그레이션을 가진 상태여야 한다).
2. 데이터만 되싣는다 — `data.sql` 을 한 트랜잭션에서 `set session_replication_role = replica;` + public·auth 표 `truncate … cascade` 선행 + `psql -v ON_ERROR_STOP=1`
   (검증된 예: 성능 재측정 때 쓴 `/Users/jerry/D-Flow/.superpowers/qa/sp3b/r25/perf-r25.sh` 의 백업·복원 구간). 행 수를 1단계 기록과 대조한다.
3. 0026 까지 올린다: PATH 의 `supabase --version` 이 2.75 인지 확인한 뒤 `lane-a-run.sh supabase migration up --local` 을 실행한다(`npx supabase` 는 다른 버전을 받을 수 있어 쓰지 않는다). `CALENDAR_PRECHECK`·`ISSUE_AREAS_PRECHECK`·`MINUTES_TEAMS_PRECHECK`·`ISSUE_STATUS_PRECHECK`·`WORKFLOW_POLICY_PRECHECK` 가 멈추면 메시지의 데이터 원인을 확인하고 이 3단계를 처음부터 다시 한다.
4. 검증: `lane-a-run.sh npm run settings:verify` 문제 0, 최대 버전 0026, 기존 행 수 대조. 0025·0026 은 `supabase/rehearsal/0025_issue_status_vocab_smoke.sql`·`0026_workflow_policy_smoke.sql`(롤백되는 스모크)과 위 SP5b 사전 수치(상태 분포·im/xx 수)를 대조한다. 0024 는 `psql -f supabase/rehearsal/0024_minutes_teams_smoke.sql`(롤백되는 스모크 — 옛 시드 루트 0·루트 이름 = 팀 이름·`team_id` code 단위·개명 동기·범위 가드)과 NOTICE `MINUTES_TEAMS: 회의록 team_id 이관 N · 맞는 팀 없음(null) M` 을 사전 수치와 대조한다. 마이그레이션 NOTICE 의 영역·분류·레거시·ISS 수가 사전 확인으로 설명되는지 대조하고, 화면 스모크(`/w/<slug>` 홈·프로젝트 이슈 목록의 코드·영역 필터·WBS·주간보고·`/usage`)를 확인한다. 달력 설정은 기존 검사대로 `calendar.week_start` 를 대조한다.
5. **go/no-go**: 리허설이 초록이면 사용자에게 결과(위 4단계 수치)를 보고하고 "메인 스택에 적용해도 되는가"를 **다시** 묻는다.

## 4. 메인 스택 적용

1. 개발 서버·다른 연결을 모두 내린다(`lsof -iTCP:54322`).
2. `cd /Users/jerry/D-Flow && supabase migration up --local`(`supabase db push` 는 쓰지 않는다 — CLAUDE.md, Supabase CLI 2.75 확인). 한 번에 0026 까지.
3. 사후: 최대 버전 0026 · `npm run settings:verify` 문제 0 · 3단계 검증과 같은 행 수·NOTICE 대조 · `npm run dev` 로 홈·이슈 목록·주간보고 한 번.
4. 이상이 있으면 **앱을 켜지 않고** 5단계로.

## 5. 되돌림

- 마이그레이션이 중간에 멈춘 경우(사전검사 등): DB 는 직전 번호에 남는다. 이때 main 코드는 0019 스키마(`holidays.kind`·사용현황 `p_timezone`)를 전제하므로 **앱을 켜지 않는다.** 메시지의 원인 데이터를 고치고 `migration up` 을 다시 한다.
- 적용 뒤 문제: 컨테이너를 내리고(`npm run db:stop`) 메인 스택 볼륨을 새로 만든 뒤 `full.dump` 를 복원한다(`pg_restore --clean --if-exists --no-owner`). 롤백 SQL 은 쓰지 않는다 — 이관 데이터를 못 되돌린다.
- 0020 B1 롤백 SQL 은 기존 `issue_area` code 가 전부 숫자 두 자리(`^[0-9]{2}$`)일 때만 돈다. 영문 영역 code 가 하나라도 있으면 `ISSUE_AREAS_ROLLBACK_BLOCKED` 로 멈춘다. 조건을 만족해도 `ISS-…`·`PI-U-…` 등 코드 문자열, 새 영역 분류, `issues.analysis`·`issues.id_policy` 설정 값과 WORM 이력은 복원되지 않으므로 덤프 복원이 유일한 완전 복구다.
- 덤프 보관: 적용이 안정되기 전에는 지우지 않는다.

## 6. 기록

적용 일시·적용 전후 버전·행 수 대조·리허설 결과를 레인 원장과 `docs/baseline/` 의 해당 SP 기록에 한 줄 남긴다(계정·해시·비밀번호는 쓰지 않는다).
