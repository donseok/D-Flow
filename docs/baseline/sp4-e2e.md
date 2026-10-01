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

# A1 — 체크포인트(과제 36)

트리 `sp4/a1` 의 **`70f2a7f`**(main `305a3b4` — 레인 B UI-1 이 든 main — 위로 rebase 한 57커밋 + 과제 36 의 결함 수정 1커밋). 측정일 2026-10-01 23:59 ~ 2026-10-02 02:00(KST).
전용 스택 `d-flow-sp4` 에서만 돌렸고 사용자의 메인 스택은 건드리지 않았다. 모든 DB·무거운 명령은 레인 A 래퍼(`lane-a-run.sh` — DSN 54522 고정)와 공유 잠금(`heavy-lock.sh`) 아래였다.

## 요약

- **공통 묶음** — `db:reset` 뒤 `max(version)` = `0015`(`*_authz_carry`), `dev:bootstrap` ✓, `settings:verify` exit 0, `test:rls` **30 파일 381 통과·건너뜀 0**. SP4 워크트리 HEAD `70f2a7f` 에서 `typecheck` 0, `lint` 0 error(경고 4 — 기존), vitest **739 파일 중 738 · 9,841 중 9,840 통과** — 실패 1 은 `tests/scripts/baseline-cli.test.ts` 의 macOS firmlink 케이스(워크트리 경로에 따른 환경 의존, A1 내내 같은 1건 — 앱·SP4 코드와 무관). 스크래치 `build` ✓(정적 19페이지, Edge 런타임 경고 1 — supabase-js, 기존).
- **CI 등가** — 부트스트랩 없이 `db reset --version 0001` → `migration up` → `max(version)` 0015, 계정 0, `test:rls` 30 파일 381 초록·건너뜀 0.
- **E2E** — exit 0, **36단계 전부 ✓**. A1 새 단계 여섯: `weekly-areas-required`·`weekly-carry-mapping`·`weekly-outputs`·`weekly-registered-names`·`import-idempotent`·`import-unregistered-teams`(+ 기존 `import-append`·`import-replace` 의 명령 id·사전 백업).
- **합성** — exit 0: S1 ✓ · S1 추가(`S1-teams-areas`) ✓ · S9 ✓ · S2 ✓ · S4(월) ✓, 미활성 S3·S4(일 — SP5)·S5~S8·S10(`synthetic-acceptance.md` SP4 A1 절).
- **눈확인** — 9행 × 4크기 = 36장 사실값 통과(`fails` 0) + 눈 판정 통과. 선택자·하네스 조정 셋(비고), M 두 행 390 재확인 1회.
- 성능은 A2(스펙 §6.5 — 계획 P9)라 이 절에 없다.

## 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · PostgreSQL 17.6 · project `d-flow-sp4`(api 54521 · db 54522) · 마이그레이션 `0000`~`0015` |
| 앱 | Next.js 15.5.19 `next dev -p 3101 -H 127.0.0.1` · Node 22.18.0 |
| 앱 위치 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp4-a1-scratch`(detached `70f2a7f`, `node_modules` 링크, `.env.local` 복사 — 끝에 지움) |
| dev 서버 env(이름만) | `NEXT_PUBLIC_APP_URL`·`INVITE_ALLOWED_DOMAINS`·`MINUTES_API_ENABLED`·`MINUTES_API_SECRET`·`CRON_SECRET`·`NODE_OPTIONS`(통과 실행은 `--max-old-space-size=8192` — 비고) |
| 계정 | 부트스트랩 `admin@example.com` — 비밀번호·시크릿은 `openssl rand` 로 한 셸의 변수로만. 눈확인은 service_role 로 만든 임시 계정(워크스페이스 A 관리자, `crypto.randomBytes`, 끝에 삭제) |
| 산출물 | `mktemp -d` 아래(E2E·합성 JSON·zip·스크린샷) — 커밋하지 않는다 |

## 순서와 명령

1. (23:59) 착수 확인 — `sp4/a1`, status 빈 출력, merge-base = main `305a3b4`, 과제 1~35·수정 라운드 커밋 57개.
2. (00:01 · 9852c09) Step 1 — `npm run db:reset` → `max(version)` → `dev:bootstrap` → `settings:verify` → `test:rls`(381·건너뜀 0). (00:02) Step 2 — CI 등가(381). Step 3 — vitest 9,840/9,841(firmlink). Step 4 — 스크래치 build ✓.
3. (00:07) Step 5 1회차 — E2E 가 `import-append` 에서, 합성이 S2 에서 409 `NEEDS_TEAMS` `needsTeams: ['*']`. **결함 — 과제 36 이 고쳤다**(비고 ①, 커밋 `70f2a7f`).
4. (00:12~00:18 · 70f2a7f) Step 1~4 다시 — `test:rls` 381·CI 등가 381·건너뜀 0, typecheck 0·lint 0 error, vitest 9,840/9,841(firmlink), build ✓.
5. (00:19) Step 5 2회차 — E2E 26단계 ✓ 뒤 `weekly-carry-mapping` 의 영역 저장에서 `fetch failed`(dev 서버 `approaching the used memory threshold, restarting` — 비고 ②). 합성은 exit 0.
6. (00:28~01:03) Step 5 3회차(계획의 한 번 재실행, dev 서버만 8192) — `db:reset` → `dev:bootstrap` → `npm run dev -- -p 3101 -H 127.0.0.1` → `node scripts/e2e-local.mjs` exit 0(36단계) → `npm run accept:synthetic` exit 0 → 실행 전후 `git diff --quiet -- src supabase` 참 → `settings:verify` exit 0.
7. (01:07~01:52) Step 6 눈확인 — `npx --yes -p playwright@1 node eye-a1.mjs <e2e.json> <폴더>` 세 번(비고 ③), 3회차 36/36. (01:53) M 두 행 390 재확인.
8. (01:55) Step 7 서버 종료(3101 → `000`), Step 8 검사 묶음.

## E2E 단계표

| # | 단계 | 판정 |
|---|---|---|
| 1~8 | `login`·`create-projects`·`settings-update`·`create-copy`·`project-teams`·`roster`·`fill-template`·`import-inspect` | ✓ |
| 9 | `import-append` | ✓ 명령 id 실음 → `kind: 'applied'`·5건·`profileSaved: true` |
| 10 | `import-replace` | ✓ 사전 백업 5행(`getWbsBackup`) → `applied`·5건, 응답 백업 5행 |
| 11~25 | `assign-external`·`meeting`·`export`·`trace-scan`·`invite-issue`·`invite-redeem`·`other-workspace-fixture`·`visibility`·`workspace-admin-project`·`outsider-invite`·`minutes-upload`·`workspace-b-isolation`·`workspace-settings-boundary`·`authz-events`·`minutes-api-scope` | ✓ |
| 26 | **`weekly-areas-required`** | ✓ 영역 0개 → `CONFIG_REQUIRED`('주간보고 영역을 먼저 설정하세요.')·문서 0 |
| 27 | **`weekly-carry-mapping`** | ✓ `checks` 아홉 전부 참 — 대기 영역 '운영'·칸 `nextContent`·`nextIssue`, 대기 중 문서 0, W2 실험 칸 `carry-own-1\ncarry-mapped-1`·이슈 `carry-mapped-issue`, W2 활성 영역만, W1 불변, 개명 뒤 같은 `area_id`·같은 칸, 신규 행 W1·W2 둘, 월요일 키(`2026-09-21`·`09-28`·`10-05`) |
| 28 | **`weekly-outputs`** | ✓ 장 수 3, 세 출력(시트 PPT·Excel·요약 PPT) 센티널 0, 임베드 오류 없음, 행 수 `[2,3,2]` |
| 29 | **`weekly-registered-names`** | ✓ 등록 이름(ERP·MES·SALES·영업)이 PPT 에 나오고 다른 센티널 0, 장 수 2 |
| 30 | **`import-idempotent`** | ✓ `applied` → `duplicate`(5건·같은 모드), 항목 5(한 벌), 다른 파일의 같은 id 422 `COMMAND_REUSED`, 영수증 1(세션 PostgREST — 액션은 매니페스트 밖), 다른 프로젝트 영수증 0 |
| 31 | **`import-unregistered-teams`** | ✓ 409 `needsTeams: ['LAB']`·`inheritsCommon: true`·공용 `OPS` → 토큰 없는 등록은 전환 없이 409 → 토큰 돌려보낸 등록 `applied`, 전용 팀 `OPS`·`LAB`, 공용 참조 0(담당·명단·영역·초대), 전용 OPS 참조 넷 각 1, 공용 팀 그대로 |
| 32 | `render-pages` | ✓ 12쪽 문제 0 — B 주간·설정에 '실험 설계'·'신규' |
| 33~36 | `module-issues-off`·`module-agents-off`·`module-minutes-integration-off`·`module-index-skip` | ✓ |

### render-pages 센티널 실측(기록용 — 재검토 반영 B P3-2·K12)

`/p/<B>/weekly` 서버 렌더 HTML(RSC 페이로드 포함, 179,388 바이트): `sentinels: ["ERP"]`, `masks: ["영업일","영업관리팀"]`.
적중 낱말 `ERP` 는 같은 실행에서 **프로젝트 A 가 등록한 팀 code**(E2E `SP1_TEAMS.A` — B 와 같은 워크스페이스)와 같은 문자열이다 — B 의 영역·팀이 아니다. 체크포인트 뒤 같은 경로를
임시 계정(워크스페이스 A 관리자)으로 다시 받은 HTML(175,394 바이트)에는 `ERP` 부분 문자열이 0건이라 HTML 안 위치(앞뒤 40자)는 재현하지 못했다 — 러너는 부트스트랩
관리자(플랫폼 관리자) 세션으로 받았으므로 그 세션에만 실리는 셸 데이터(프로젝트·팀 목록 등)로 추정한다. 이것은 옛 기본값 누출이 아니라 다른 프로젝트의 등록 이름이
같은 페이지에 실린 경우다(D8 의 "그 프로젝트가 등록한 이름" 제외는 B 의 이름만 뺀다). **처리는 A2 의 S10 앞 — K12 규칙**(목록을 늘릴 때는 실측 근거·존재 단언을
같은 커밋에, 옛 이름 자체를 마스크하지 않는다). 러너가 적중 위치를 함께 남기게 하는 것도 그때 판단한다.

## 합성 게이트

`synthetic-acceptance.md` 의 **SP4 A1 — S1 추가분·S2·S4(월)** 절.

## 눈확인 A1

스펙 §6.6 A1 행 넷 ↔ 이 표: 주간 시트 = W0(영역 0개)·W1(영역 있음)·W2(비활성 영역 내용), 이월 매핑 창·넘침 = M1·M2(다시 대기로 온 영역은 **상태는 단위 테스트** —
`tests/ui/carry-mapping-modal.test.tsx`), 설정 편집기 = S1, 가져오기 등록 확인·사전 백업 = I1·I2. 헤드리스 Chromium(playwright@1), 라이트, 서버 3101. 스크린샷은 커밋하지 않는다(이름·해시만).

| # | 화면 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| 1 | W0 영역 0개 | 1440×900 | 통과 | W0-no-areas-1440x900.png | 7e35513547ee | 안내·설정 링크, 기본 시트 시작 없음, 센티널 0 |
| 2 | W1 영역 있음 | 1440×900 | 통과 | W1-areas-1440x900.png | fca181743169 | 머리 '업무영역', 순서 실험 설계 → 신규(비고 ④) |
| 3 | W2 비활성 내용 | 1440×900 | 통과 | W2-inactive-1440x900.png | 718cae607417 | '운영 (비활성)' |
| 4 | S1 편집기 | 1440×900 | 통과 | S1-editor-1440x900.png | e95d9ff66578 | 세 이름, 이슈 영역 탭 없음 |
| 5 | I1 등록 확인 | 1440×900 | 통과 | I1-needs-teams-1440x900.png | 1c963c82ffb0 | 제목·공용 OPS·미등록 LAB, 슈퍼유저 문구 없음 |
| 6 | I2 백업 전 | 1440×900 | 통과 | I2-replace-locked-1440x900.png | c1bb094d1156 | 실행 잠김·백업 버튼 |
| 7 | I2 백업 뒤 | 1440×900 | 통과 | I2-replace-unlocked-1440x900.png | 6a80a9423e8d | 내려받기 시작·실행 열림 |
| 8 | W0 | 1280×720 | 통과 | W0-no-areas-1280x720.png | 969e30cbf50c | 〃 |
| 9 | W1 | 1280×720 | 통과 | W1-areas-1280x720.png | 1477bf339dcf | 〃 |
| 10 | W2 | 1280×720 | 통과 | W2-inactive-1280x720.png | 7b64979c9aea | 〃 |
| 11 | S1 | 1280×720 | 통과 | S1-editor-1280x720.png | e1fefbef9e68 | 〃 |
| 12 | I1 | 1280×720 | 통과 | I1-needs-teams-1280x720.png | ec508985321f | 〃 |
| 13 | I2 백업 전 | 1280×720 | 통과 | I2-replace-locked-1280x720.png | 823c5c60e143 | 〃 |
| 14 | I2 백업 뒤 | 1280×720 | 통과 | I2-replace-unlocked-1280x720.png | 42e8e5846b0b | 〃 |
| 15 | W0 | 768×1024 | 통과 | W0-no-areas-768x1024.png | 3cde75aac8c9 | 〃 |
| 16 | W1 | 768×1024 | 통과 | W1-areas-768x1024.png | 8e65f78c93d9 | 〃 |
| 17 | W2 | 768×1024 | 통과 | W2-inactive-768x1024.png | 2b74dcf210b0 | 〃 |
| 18 | S1 | 768×1024 | 통과 | S1-editor-768x1024.png | 8f93445e3f7f | 〃 |
| 19 | I1 | 768×1024 | 통과 | I1-needs-teams-768x1024.png | 623008bab057 | 〃 |
| 20 | I2 백업 전 | 768×1024 | 통과 | I2-replace-locked-768x1024.png | ca25895ba2de | 〃 |
| 21 | I2 백업 뒤 | 768×1024 | 통과 | I2-replace-unlocked-768x1024.png | 34272c5e7726 | 〃 |
| 22 | W0 | 390×844 | 통과 | W0-no-areas-390x844.png | c397460a20bf | 〃(머리 도구 줄 넘침 — 비고 ⑤) |
| 23 | W1 | 390×844 | 통과 | W1-areas-390x844.png | f74ce088d65c | 표는 카드 안 가로 스크롤 |
| 24 | W2 | 390×844 | 통과 | W2-inactive-390x844.png | 9a0f0141cb17 | 〃 |
| 25 | S1 | 390×844 | 통과 | S1-editor-390x844.png | 882785d16e19 | 영역 표는 카드 안 가로 스크롤(상태·작업 열은 밀어서) |
| 26 | I1 | 390×844 | 통과 | I1-needs-teams-390x844.png | 78334c652897 | 창이 화면 안에 읽힘 |
| 27 | I2 백업 전 | 390×844 | 통과 | I2-replace-locked-390x844.png | cae8b00d63f2 | 〃 |
| 28 | I2 백업 뒤 | 390×844 | 통과 | I2-replace-unlocked-390x844.png | 0bec40d4b9cd | 〃 |
| 29 | M1 매핑 창 | 1440×900 | 통과 | M1-mapping-1440x900.png | b375bbc18ea4 | 대기 '신규'·'옮기지 않음' |
| 30 | M2 넘침 | 1440×900 | 통과 | M2-overflow-1440x900.png | 8a81335b654c | '실험 설계 · 금주실적 내용 21,001자' |
| 31 | M1 | 1280×720 | 통과 | M1-mapping-1280x720.png | 83bbb8b4d9f1 | 〃 |
| 32 | M2 | 1280×720 | 통과 | M2-overflow-1280x720.png | fb5a52bf9d5d | 〃 |
| 33 | M1 | 768×1024 | 통과 | M1-mapping-768x1024.png | fc54f51ba758 | 〃 |
| 34 | M2 | 768×1024 | 통과 | M2-overflow-768x1024.png | 91119e083dd9 | 〃 |
| 35 | M1 | 390×844 | 통과 | M1-mapping-390x844.png | e9b746c42fc7 | 재확인 `c9b7340972e6` |
| 36 | M2 | 390×844 | 통과 | M2-overflow-390x844.png | c4e832286e1a | 사진이 창의 열림 전환 중(반투명)이었다 — 1.5초 뒤 재확인 `a15c3e73ea8f` 에서 창이 또렷하고 넘침 문구가 읽힘 |

## 검사 묶음(Step 8)

- ① 리허설 기록 — `_weekly_areas`·`_command_receipts`·`_authz_carry`·`WEEKLY_AREAS_PRECHECK`·`seed_wide`·`smoke`·`created_fixture`·`rollback_check`·`CI 등가` 전부 ✓.
- ② 무수정 셋(`schema-invariants`·`workspace-isolation-cases`·`h2-table-grants`) ✓.
- ③ 손실 경로 커밋이 첫 마이그레이션 `9646f00` 앞 — `route.ts`·`paging-consumers` `2329888`, `wbs.ts`·`computed-wbs-merge` `9e55a71` ✓.
- ④ 마이그레이션 커밋 여섯 — 셋(`9646f00`·`1599a0c`·`9e2f6f6`)과 수정 셋(`8d76915`·`d90c9b8` — 두 파일, `9d64736` — 롤백 무변경이라 정방향 한 파일) 모두 `supabase/migrations`·`supabase/rollbacks` 밖 파일 0, `Staging-verified` 한 줄이 `Co-Authored-By:` 바로 위.
- ⑤ 경계 밖 화면 파일 0, UI 위험 파일 0.
- ⑥ 화면 커밋 여덟 전부 `Preview-checked`(local 둘 · n/a 여섯 — n/a 의 화면은 이 체크포인트의 빈 커밋 트레일러가 받는다).
- ⑦ `src` 의 옛 주간 상수 grep 0건. 허용 목록 파일의 grep 적중은 타입·패턴 정의와 주석뿐이고 `ALLOW` 항목에는 주간 상수가 없다. `FALLBACK_SECTION` 가드 패턴 1줄.
- ⑧ 이름 있는 테스트 29 파일 1,025 통과. `no-raw-db-errors` 대상에 여섯 경로(주간·영역 액션·가져오기 라우트·영수증·백업 액션·팀 등록).
- ⑨ W30 — 요일·날짜 계산 패턴 BASE 43줄 · HEAD 43줄, SP4 가 더한 줄 0.
- ⑩ 감사 문서 본문 절 'DEFINER RPC 가 등급을 다시 판정하는 경로(SP4 — D28·D51)' 와 RPC 넷 ✓.

## 비고

- ① **결함(과제 36 이 고침 — `70f2a7f`)**: A1-5 R5(`14c5306`)가 양식을 저장하는 가져오기에서 프로파일의 팀 열 이름을 등록 대상에 넣으며, 팀명 직접 방식의 표지 `'*'`
  (`detect.ts` — 담당 열 하나에 팀명이 든 양식)까지 팀으로 셌다. 양식 다운로드에 채운 파일을 저장과 함께 가져오면 늘 409 `needsTeams: ['*']`. 저장 교차 검증(`validateConfig.ts`)은
  이미 `'*'` 를 건너뛴다 — 같은 규칙으로 맞췄다(라우트 한 줄 + `import-idempotent` 테스트 1 — 빨강 확인 뒤 초록). rebase 와 무관한 A1-5 수정 회귀이고, 단위 테스트의 프로파일이
  팀 열을 이름으로만 가져 놓쳤다. 고친 뒤 Step 1 부터 다시 돌았다.
- ② 2회차의 `fetch failed` 는 dev 서버 메모리 감시 재시작(SP3a `sp3a-e2e.md` 4절·sp2-e2e §9 ② 와 같은 원인)이다. 3회차는 그 실행의 dev 서버만 `--max-old-space-size=8192`(SP3a 선례 — 하네스 설정, 앱 코드 무관), 재시작 0회.
- ③ 눈확인 스크립트 조정(무엇을 보는지 — `EXPECT` — 는 바꾸지 않았다): ⓐ W0 안내 문구 선택자 `/설정(이)?\s*필요/` → `/영역을 먼저 설정하세요/`(과제 23 화면의 실제 문구 '주간보고 영역을 먼저 설정하세요')
  ⓑ 가져오기 화면은 기본 탭이 마크다운이라 `getByRole('tab', { name: /엑셀/ })` 를 누른 뒤 `input[type=file][accept=".xlsx"]` 에 파일을 넣는다(과제 31 화면 — `ImportModes`)
  ⓒ 하네스 — 컨텍스트 기본 시간 120초·탐색 180초와 측정 전 데움(W·S·I 경로를 한 번씩 열고 분석까지, 사진 없음). 1·2회차는 다른 레인의 무거운 실행과 겹친 부하에서 next dev 의
  첫 컴파일·재시작 뒤 재컴파일이 수 분 걸려 시간 초과·연결 거부로 깨졌다(동작 차이 아님). 3회차 36/36.
- ④ W1 사진은 3회차 것이라 1회차의 M 전제(W2 차주 계획 15,000자·'신규' 비활성)가 심긴 뒤다 — 행이 수천 px 로 길어 라벨이 첫 화면 밖이다. 라벨·순서는 사실값(innerText)으로, 화면은
  1회차 390 사진(전제 심기 전)에서 '실험 설계'·'신규' 행과 칸이 정상임을 봤다.
- ⑤ 주간 머리 도구 줄(`WeekNav` — `WeeklySheetView.tsx` 의 SP0 루트 줄, A1 무변경)이 390 에서 오른쪽 버튼을 화면 밖으로 밀고 768 에서 버튼 글자를 여러 줄로 접는다. 이 체크포인트의
  결함이 아니라 기존 반응형 빈틈 — 레인 B(SP3b 화면 이행)·SPU3 몫으로 알린다.
- dev.log 의 `[teams] 최초 팀 마스터 로드 … 3000ms 초과`·`[layout] 팀 마스터 조회 실패` 는 부하 아래 옛 팀 캐시(스펙 K7 — B 까지 레이아웃만 남김)의 첫 로드 시간 초과다. 레이아웃은
  팀 탭 없이 그리고, 판정 경로(가져오기·내보내기)는 요청 범위 원천이라 단계에는 영향이 없었다.
- 레인 B 캡처 시드(과제 33 — `seedPlan`·`cmdSeed` 의 영역 id)의 실행 확인은 레인 B 몫이다(계약 메모). 여기서는 `tests/scripts/ui-capture.test.ts` 만 돌렸다(⑧).
- 전용 스택은 내리지 않았다(A2 가 쓴다). DB 에는 E2E·합성 데이터가 남고 눈확인 임시 계정은 스크립트가 지웠다.

## A1 실측 노력

커밋 시각(`git log --reverse --format='%h %ad'`, rebase 가 작성 시각을 지켰다)과 원장(`.superpowers/sp4/progress.md`)의 리뷰 기록에서 옮겼다. 묶음은 병렬로 겹친다(구현자와 앞 묶음 리뷰가 동시에 돌았다).

| 묶음 | 과제 | 커밋 수 | 첫 커밋 → 끝 커밋(경과) | 리뷰 | 비고 |
|---|---|---|---|---|---|
| A1-1 | 1~9 | 15 | 10-01 18:31 → 19:12(0.7시간) | 관점 2(정확성·보안) · 수정 1(K1~K8) · 범위 재리뷰 1(초록) | 구현 9 → 18:50, 수정 6 |
| A1-2 | 10~14 | 4 | 19:47 → 20:30(0.7시간) | 관점 2(보안·DB) · 수정 1(L1~L6 — A1-3 구현자가 이어서) | ②a·③a + 수정 ②·③ |
| A1-3 | 15~18 | 8 | 20:03 → 22:08(2.1시간) | 리뷰 1(보안+DB) · 수정 1(M1~M4 — A1-4 구현자가 이어서) | 구현 5 → 20:10, 수정 3 은 22:06~22:08 |
| A1-4 | 19~26 | 16 | 20:39 → 23:22(2.7시간) | 관점 2(권한·정확성) · 수정 1(P1~P7 — A1-5 구현자가 이어서) | 구현 9 → 21:27, 수정 7 |
| A1-5 | 27~32 | 9 | 22:13 → 23:57(1.7시간) | 관점 2(보안·정확성) · 수정 1(R1~R5 — A1-6 구현자가 이어서) | 구현 6 → 22:58, 수정 3 |
| A1-6 | 33~36 | 6 | 23:30 → 10-02 02:0x(2.6시간) | — (Phase A1 최종 리뷰는 컨트롤러가 이 뒤에) | 33~35 셋 + 결함 수정 1 + 문서 1 + 빈 커밋 1 |
| 체크포인트 꼬리 | 36 | 3 | 10-01 23:59 → 10-02 02:0x(약 2.1시간) | — | 결함 1 수정·재실행(Step 1~5 두 번 더)·눈확인 세 번이 시간을 썼다 |
| 합계 | 1~36 | 58(+ 스펙·계획 2) | 18:31 → 02:0x(약 7.6시간) | 관점 리뷰 9 · 수정 라운드 5 · 범위 재리뷰 1 | rebase 1회(main `305a3b4`, 무충돌) |

비율(`sp3a-effort.md` §2 와 같은 식 — 경과 달력일 ÷ 추정 노동일, 1주 = 5일): 스펙 추정 A1 2.0~2.7주 + 고정 0.2~0.3주 = 2.2~3.0주(11~15일).
경과 약 7.6시간 = 0.32일 → **0.021~0.029**(SP3a 0.14, SP0~SP2 0.11 보다 훨씬 낮다). 같은 경과를 SP3a 실측 환산(9.4시간/노력주)으로 보면 0.81 노력주 = 추정의 0.27~0.37.
에이전트가 일한 시간은 원장에 시간 단위로 남지 않았다 — 구현자 1 + 리뷰어 1~2 가 대부분의 구간에서 병렬이었으므로 에이전트 시간 합은 경과보다 크다(추정 1.5~2.5배).
스펙·계획(스펙 커밋 16:28·계획 18:25)과 그 앞의 실측·비평은 이 표에 없다. K17 의 넘침 판단(§2.5 ③ 끝 — A1-3 구현 끝 20:10)은 원장에 따로 적히지 않았다 — 그 시점까지 착수 뒤 1.7시간으로
3.0주 상한에 견줄 필요가 없었고, 넘긴 것은 없다(T14 의 `copyGlobalTeams` → B 는 기본값).

# A2 — A1 이월 수정(A1 최종 리뷰 Z1~Z5)

## 리허설 — `*_team_scope_lock_order`(Z1, 보안 P2)

0014 는 origin/main 에 있어 원문을 고치지 않고 `team_ref_owned_scope` 하나를 바꾸는 새 마이그레이션(0016)으로 냈다(컨트롤러 판정).
`tests/rls/team-convert.test.ts` 의 경합 ④(전환이 참조를 옮긴 뒤·커밋 전의 같은 키 on conflict 재삽입)는 0016 없이 **빨강**(쓰기가 성공 —
공용 RES 참조가 되살아남)으로 재현했고, 0016 적용 뒤 초록이다(team-convert 3회 반복 15/15).

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_team_scope_lock_order` | R(카탈로그) | 2026-10-02 02:56 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ② `TEAM_SCOPE_LOCK_ORDER_POSTCHECK` 통과 |
| `*_team_scope_lock_order` | 사후검사 민감도(옛 본문으로 되돌린 뒤 ② 만) | 2026-10-02 02:57 KST | `TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 잠금 앞에서 판정하는 면제가 있다: from public.item_owners x, from public.project_member_teams x, from public.area_teams x` 로 멈춤 |
| 0013~0016 | 연쇄 롤백(0016→0015→0014→0013) = `--version 0012`, 다시 넷 적용 = 전체 | 2026-10-02 02:55 KST | 두 `diff` 모두 불일치 0 |
| 0013~0016 | 데이터 업그레이드(seed_wide → 0013~0016 → 전환 스모크 → 0016 롤백 → 스모크 → 0016 재적용 → 스모크, authz_carry 스모크) | 2026-10-02 02:56 KST | 첫 적용 `영역 신설 8, 재사용 2, 병합으로 지운 행 5, 머리표 4, 남은 행 11` · 상속 프로젝트 `…5b04-000000000c03` 전환 `{"moved": {"invites": 1, "area_teams": 1, "item_owners": 2, "project_member_teams": 2}, "teams": 3, "status": "converted"}` · 스모크 전부 통과 |
| CI 등가(부트스트랩 없음) | `db reset --version 0001` → `migration up` → `test:rls` | 2026-10-02 02:58 KST | max(version) 0016 · 30 파일 382 초록·건너뜀 0 |

## 머지 체크리스트(A2 반영 때)

- 번호를 공유했던 로컬 스택(레인 B 의 `0013_account_preferences` 를 적용한 DB 등)은 `db:reset` 으로 맞춘다 — `migration up` 은 같은 번호를 적용된 것으로 보고
  SP4 파일을 건너뛴다. 0016 은 SP4 가 쓴다(레인 B 의 account_preferences 는 rebase 때 다음 빈 번호로 — 컨트롤러가 레인 B 원장에 알림).
- 메인 스택(사용자 데이터)에 0013 이후를 적용할 때는 0016 까지 함께(0014 만 적용하면 경합 창이 열린 트리거가 남는다).
