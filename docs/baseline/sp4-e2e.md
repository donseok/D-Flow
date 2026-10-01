# SP4 E2E·리허설 기록 — Phase A1

계획 `.superpowers/sp4/plan-a1.md`(스펙 `docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md` §3·§7). 전용 스택(워크트리
`/Users/jerry/D-Flow-wt/lane-a-sp4`, 브랜치 `sp4/a1`, project `d-flow-sp4`, api 54521·db 54522)에서 잰다. 시각은 KST.
마이그레이션 번호는 접미로 적는다(`*_weekly_areas` 등 — D12). 체크포인트 절(E2E·합성·눈확인)은 과제 36 이 끝에 더한다.

## 리허설

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_weekly_areas` | R(카탈로그) | 2026-10-01 19:44 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ⑫ `WEEKLY_AREAS_POSTCHECK` 통과 |
| `*_weekly_areas` | 사전검사(`precheck_violations` 경우 1·2) | 2026-10-01 19:45 KST | 둘 다 `WEEKLY_AREAS_PRECHECK` 로 멈춤(`this_content`·`next_issue` 20001자), 버전 그대로 |
| `*_weekly_areas` | 데이터 업그레이드(`seed_wide` → 적용 → `smoke` → `created_fixture` → `smoke` → 롤백 → `rollback_check` → 재적용 → `smoke`) | 2026-10-01 19:46 KST | 첫 적용 `영역 신설 8, 재사용 2, 병합으로 지운 행 5, 머리표 4, 남은 행 11` · 스모크 3회 통과(14개) · 롤백 확인 통과(11개) · 재적용 `영역 신설 0, 재사용 12, …, 남은 행 13` |
| `*_weekly_areas` | 사후검사 민감도(트리거 끔·insert grant) | 2026-10-01 19:46 KST | 둘 다 `WEEKLY_AREAS_POSTCHECK` 로 멈춤 — `트리거가 없다: weekly_report_rows_touch`·`정책 없는 DML 권한: weekly_report_rows:INSERT` |
| `*_command_receipts` | R(카탈로그) | 2026-10-01 19:57 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ⑦ `COMMAND_RECEIPTS_POSTCHECK` 통과 |
| `*_command_receipts` | 데이터 업그레이드(seed_wide 위, 전환 1회) | 2026-10-01 19:58 KST | 상속 프로젝트 `…5b04-000000000c03` · 스모크 2회 통과 · 전환 `{"moved": {"invites": 1, "area_teams": 1, "item_owners": 2, "project_member_teams": 2}, "teams": 3, "status": "converted"}` · 롤백·재적용 성공 · 재적용 뒤 그 프로젝트의 공용 팀 참조 0 |
| `*_command_receipts` | 사후검사 민감도(트리거 끔·insert grant) | 2026-10-01 19:58 KST | 둘 다 `COMMAND_RECEIPTS_POSTCHECK` 로 멈춤 — `트리거가 없다: command_receipts_worm`·`표 권한이 남았다: authenticated:INSERT` |
| `*_authz_carry` | R(카탈로그) | 2026-10-01 20:08 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ④ `AUTHZ_CARRY_POSTCHECK` 통과 |
| `*_authz_carry` | 데이터 업그레이드(seed_wide 위) | 2026-10-01 20:08 KST | 스모크 2회 통과 — 권한 있는 명단 행의 active 전환 기록 1·인물 기록 1(명령 id null)·person_id 변경 거부·modules.enabled unset 거부, 롤백·재적용 성공 |
| `*_authz_carry` | 사후검사 민감도(인물 트리거 끔·email grant) | 2026-10-01 20:08 KST | 둘 다 `AUTHZ_CARRY_POSTCHECK` 로 멈춤 — `기록 트리거가 기대와 다르다: people.authz_events_record_people`·`authenticated 가 people.email 을 쓴다` |
| CI 등가(부트스트랩 없음) | `db reset --version 0001` → `migration up` → `test:rls` | 2026-10-01 20:09 KST | 전체 초록(30 파일 357)·건너뜀 0 — HEAD `f758994` |
| `*_weekly_areas`(A1-2 수정 뒤 — 롤백 순서 정지·칸 길이 check·DEFINER 사후검사) | R(카탈로그) | 2026-10-01 20:22 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ⑫ 통과 |
| `*_weekly_areas`(수정 뒤) | 사전검사(경우 1·2) | 2026-10-01 20:24 KST | 둘 다 `WEEKLY_AREAS_PRECHECK` 로 멈춤(`this_content`·`next_issue` 20001자), 버전 0012 |
| `*_weekly_areas`(수정 뒤) | 데이터 업그레이드(seed_wide → 0013·0014·0015 적용 → `smoke` → `created_fixture` → `smoke` → **0013 롤백 단독(음성)** → 0015·0014 롤백 → 0013 롤백 → `rollback_check` → 재적용 → `smoke`) | 2026-10-01 20:25 KST | 첫 적용 `영역 신설 8, 재사용 2, 병합으로 지운 행 5, 머리표 4, 남은 행 11` · 스모크 3회 통과(14개) · `영역 2, 문서 1, 행 2, 개명 1` · 음성: `WEEKLY_AREAS_ROLLBACK_ORDER: *_command_receipts 롤백을 먼저 한다` 로 멈춤, 버전 0015·도우미·import_wbs_cmd·area_id 열·행 13 그대로 · 롤백 확인 통과(11개) · 재적용 `영역 신설 0, 재사용 12, 병합으로 지운 행 0, 머리표 0, 남은 행 13` |
| `*_weekly_areas`(수정 뒤) | 사후검사 민감도(트리거 끔·insert grant·도우미 search_path 해제) | 2026-10-01 20:25 KST | 셋 다 `WEEKLY_AREAS_POSTCHECK` — `트리거가 없다: weekly_report_rows_touch`·`정책 없는 DML 권한: weekly_report_rows:INSERT`·`DEFINER·search_path 가 기대와 다르다: public.actor_is_project_admin(uuid, uuid)` |
| `*_command_receipts`(0013 수정 뒤) | R(카탈로그) | 2026-10-01 20:26 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 |
| `*_authz_carry`(0013 수정 뒤) | R(카탈로그) | 2026-10-01 20:27 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 |
| `*_command_receipts`·`*_authz_carry`(0013 수정 뒤) | 데이터 업그레이드(seed_wide 위 0013~0015, 전환 1회 → 0015·0014 롤백 → 0014 재적용 → 0015 재적용·롤백·재적용)·민감도 | 2026-10-01 20:28 KST | 상속 프로젝트 `…5b04-000000000c03` 전환 `{"moved": {"invites": 1, "area_teams": 1, "item_owners": 2, "project_member_teams": 2}, "teams": 3, "status": "converted"}` · 두 파일 스모크 전부 통과 · 민감도 네 줄(`command_receipts_worm`·`authenticated:INSERT`·`people.authz_events_record_people`·`people.email`) |
| CI 등가(0013 수정 뒤, 부트스트랩 없음) | `db reset --version 0001` → `migration up` → `test:rls` | 2026-10-01 20:29 KST | 30 파일 374 초록·건너뜀 0 |
| `*_command_receipts`(A1-3 수정 M1 — 공용 팀 참조 거부 트리거 넷·전환 for update) | R(카탈로그) — `*_weekly_areas`·`*_authz_carry` 도 다시 | 2026-10-01 22:00 KST | 세 파일 모두 `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 |
| `*_weekly_areas`(M1 뒤) | 데이터 업그레이드 왕복(seed_wide → 0013~0015 → smoke → created_fixture → smoke → 0013 롤백 단독(음성) → 0015·0014·0013 롤백 → rollback_check → 0013 재적용 → smoke) | 2026-10-01 22:05 KST | 첫 적용 `영역 신설 8, 재사용 2, 병합으로 지운 행 5, 머리표 4, 남은 행 11` · 스모크 3회 통과(14개) · 음성 `WEEKLY_AREAS_ROLLBACK_ORDER` 로 멈춤(버전 0015·import_wbs_cmd·행 13 그대로) · 롤백 확인 통과(11개) · 재적용 `영역 신설 0, 재사용 12, …, 남은 행 13` |
| `*_command_receipts`·`*_authz_carry`(M1 뒤) | 데이터 업그레이드(seed_wide 위, 전환 1회 → 0015·0014 롤백 → 0014 재적용 → 0015 재적용·롤백·재적용)·민감도 | 2026-10-01 22:03 KST | 상속 프로젝트 `…5b04-000000000c03` 전환 `{"moved": {"invites": 1, "area_teams": 1, "item_owners": 2, "project_member_teams": 2}, "teams": 3, "status": "converted"}` · 스모크(전환 뒤 공용 팀 참조 거부 TEAM_SCOPE_PROJECT_OWNED 포함) 전부 통과 · 민감도 세 줄(`command_receipts_worm`·`authenticated:INSERT`·`area_teams.area_teams_owned_scope`) |
| CI 등가(M1 뒤, 부트스트랩 없음) | `db reset --version 0001` → `migration up` → `test:rls` | 2026-10-01 22:04 KST | 30 파일 379 초록·건너뜀 0 |
| `*_command_receipts`(A1-4 수정 P1·P2 — 새 참조만 거부·for key share) | R(카탈로그) — `*_weekly_areas`·`*_authz_carry` 도 다시 | 2026-10-01 23:10 KST | 세 파일 모두 `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 |
| `*_command_receipts`·`*_authz_carry`(P1·P2 뒤) | 데이터 업그레이드(seed_wide 위 0013~0015, 전환 1회 → 0015·0014 롤백 → 0014 재적용·스모크 → 0015 재적용·롤백·재적용·스모크) | 2026-10-01 23:12 KST | 상속 프로젝트 `…5b04-000000000c03` 전환 `{"moved": {"invites": 1, "area_teams": 1, "item_owners": 2, "project_member_teams": 2}, "teams": 3, "status": "converted"}` · 두 파일 스모크 전부 통과 |
| test:rls(P1·P2 뒤) | `db:reset` → `test:rls` | 2026-10-01 23:02 KST | 30 파일 381 초록·건너뜀 0(갈라진 프로젝트 재저장 통과·새 공용 참조 거부, 반대 순서 경합 40P01 한쪽 — team-convert 3회 반복 초록) |
