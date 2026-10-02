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

## 리허설 — `*_copy_config_team_map`(Z3, 보안 P3)

`tests/rls/settings-create.test.ts` 의 갈라진 원본 복사 케이스는 0017 없이 **빨강**(`TEAM_SCOPE_PROJECT_OWNED` — 생성 전체가 되돌아감), 적용 뒤 초록.

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_copy_config_team_map` | R(카탈로그) | 2026-10-02 03:03 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ② `COPY_CONFIG_TEAM_MAP_POSTCHECK` 통과 |
| `*_copy_config_team_map` | 사후검사 민감도(옛 본문으로 되돌린 뒤 ② 만) | 2026-10-02 03:03 KST | `COPY_CONFIG_TEAM_MAP_POSTCHECK: 영역 팀 대응이 code 기준이 아니다` 로 멈춤 |
| 0013~0017 | 연쇄 롤백(0017→0013) = `--version 0012`, 다시 다섯 적용 = 전체 | 2026-10-02 03:04 KST | 두 `diff` 모두 불일치 0 |
| CI 등가(부트스트랩 없음) | `db reset --version 0001` → `migration up` → `test:rls` | 2026-10-02 03:05 KST | max(version) 0017 · 30 파일 383 초록·건너뜀 0 |

## 리허설 — `*_team_scope_lock_order` 격리 수준 가드(A2-1 리뷰 보안 P3 — Q2)

0016 이 아직 main 밖(sp4/a2 에만, 적용된 곳은 전용 스택 `d-flow-sp4` 뿐)이라 새 번호(0018 — 레인 B 가 다음 번호를 쓴다) 대신 0016 을 그 자리에서 고쳤다
(`e6122e9` — 마이그레이션 한 파일). 공용 팀을 가리키는 쓰기만 잠금 앞에서 read committed 가 아니면 25001 `TEAM_SCOPE_ISOLATION`, 사후검사
`TEAM_SCOPE_LOCK_ORDER_POSTCHECK` 가 가드 문장·토큰이 잠금 앞에 있는지 본다. 롤백(0014 본문)은 그대로다. `tests/rls/team-convert.test.ts` 의 새 케이스
(세 수준 거절·전용 팀 참조 통과·read committed 통과)는 고치기 전 DB 에서 **빨강**(repeatable read 의 공용 팀 참조 insert 가 성공)이었다.

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_team_scope_lock_order` | 사후검사 민감도(옛 0016 본문이 적용된 DB 에 새 ② 만) | 2026-10-02 04:13 KST | `TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 격리 수준 가드(TEAM_SCOPE_ISOLATION)가 잠금 앞에 없다` 로 멈춤 |
| `*_team_scope_lock_order` | R(카탈로그 — 옛 0016 위에 새 0016 → 0016 롤백 → 새 0016 재적용, `pg_dump --schema-only --schema=public`) | 2026-10-02 04:13 KST | 옛→새 차이는 가드 네 줄뿐 · 재적용 뒤 = 첫 적용(`\restrict` 토큰 줄 외 불일치 0) · 롤백 뒤 가드 없음 · 소유자 postgres·DEFINER·`search_path ""`·authenticated EXECUTE 없음 |
| 전체 | `npm run db:reset`(기준선 + 0001~0017 + seed) | 2026-10-02 04:19 KST | 초록 · max(version) 0017 · 함수 본문에 가드 있음 |
| CI 등가(부트스트랩 없음) | `db reset --version 0001` → `migration up`(16개) → `test:rls` | 2026-10-02 04:20 KST | max(version) 0017 · 30 파일 384 초록·건너뜀 0 |

## 머지 체크리스트(A2 반영 때)

- 번호를 공유했던 로컬 스택(레인 B 의 `0013_account_preferences` 를 적용한 DB 등)은 `db:reset` 으로 맞춘다 — `migration up` 은 같은 번호를 적용된 것으로 보고
  SP4 파일을 건너뛴다. 0016·0017 은 SP4 가 쓴다(레인 B 의 account_preferences 는 rebase 때 다음 빈 번호로 — 컨트롤러가 레인 B 원장에 알림).
- 메인 스택(사용자 데이터)에 0013 이후를 적용할 때는 0017 까지 함께(0014 만 적용하면 경합 창이 열린 트리거가, 0017 이 없으면 갈라진 원본 복사 실패가 남는다).
- `0016_team_scope_lock_order` 는 e6122e9 에서 **그 자리 수정**됐다(격리 수준 가드 `TEAM_SCOPE_ISOLATION` 추가 — A2-1 수정 Q2). 1dcbe08~e6122e9 사이에
  옛 0016 을 적용한 스택은 `schema_migrations` 에 0016 이 있어 `migration up` 이 새 본문을 건너뛴다 — `db:reset`(또는 0016 롤백 → 재적용)으로 맞춘다.
  확인: `select prosrc like '%TEAM_SCOPE_ISOLATION%' from pg_proc where proname = 'team_ref_owned_scope'` 가 참. 옛 본문 위에서는 0016 의 사후검사(②)를
  다시 돌려야 잡힌다(리허설 첫 줄 — 민감도 확인과 같은 절차). 원격·태그에 옛 0016 은 없다(A2-2 리뷰 보안 P3 확인 — sp4/a2 로컬 브랜치뿐).
- **성능 판정이 먼저다(스펙 §6.5 — A2 최종 리뷰 완료 P2-1).** `docs/baseline/sp4-perf.md` 의 800행 p95 비율 ≤ 1.20 판정이 커밋되기 전에는
  `sp4-a2-done` 태그·main 반영·push 를 하지 않는다(순서: 성능 판정 → `sp4-perf.md` 커밋 → 태그 → main). 넘으면 왕복을 줄인 뒤 다시 잰다 —
  넘은 채 머지하지 않는다. 1,500행은 기록만.
- **레인 B(`ui/sp3-menu` b9ad041, 베이스 305a3b4)와 겹치는 파일 19개** — 받는 쪽은 레인 B 과제 39(A2 반영 뒤 rebase). `git diff --name-only
  54a202e...ui/sp3-menu` ∩ A2(`54a202e..69f8508`):
  - 텍스트 충돌 1 — `src/app/actions/teams.ts`(B 의 `revalidatePath('/(app)/w/[slug]/admin/teams','page')` 두 줄 ↔ A2 의 `failWith`·개명으로 다시 쓴
    같은 함수). B 의 경로 꼴을 A2 본문 위에 다시 얹는다.
  - 자동 병합되나 의미를 볼 것 — `src/lib/data/portfolio.ts`(B `getPortfolioInputs(workspaceId)` ↔ A2 팀 원천·키셋), `docs/settings-catalog.md`·
    `src/lib/settings/catalog-meta.ts`(자동 생성 절 — `CATALOG_WRITE=1` 로 재생성 뒤 `catalog-sync`), `src/lib/data/agentApprovals.ts`,
    `src/components/wbs/WbsGanttSheet.tsx`(눈확인), `src/app/actions/minutes.ts`, `src/lib/domain/authz.ts`.
  - 테스트 — `tests/actions/minutes-{file-path,workspace-scope}.test.ts`·`tests/api/minutes-chat-route.test.ts`·`tests/minutes/{assign-project,external-api,
    folders-action}.test.ts`(B 쪽의 `@/lib/teams/master` 목이 A2 뒤 소비처 `@/lib/teams/source` 와 어긋날 수 있다)·`tests/api/shell-route.test.ts`·
    `tests/invariants/{project-page-gates,settings-writes}.test.ts`·`tests/scripts/e2e.test.ts`·`tests/ui/wbs-mobile-compact.test.tsx`.
- **병합 뒤 깨질 것으로 아는 테스트 셋**(B 과제 39 가 손으로 고친다):
  ① `tests/data/portfolio-teams.test.ts`(A2 새) — 무인자 `getPortfolioInputs()` 호출이고 목 행에 `workspace_id` 가 없어 B 의 워크스페이스 필터가 모두
  거른다 → 인자·목 행을 B 의 꼴로. ② `tests/portfolio/portfolio-scope.test.ts`(B 새) — `@/lib/teams/master` 를 목으로 거는데 A2 뒤 `portfolio.ts` 는
  `@/lib/teams/source` 를 쓴다 → 목 대상을 바꾼다. ③ `tests/invariants/teams-master-consumers.test.ts`(A2 새, 옛 캐시 소비처 닫힌 목록 7) — B 가
  `(app)/layout.tsx` 를 `(app)/(global)/layout.tsx`·`w/[slug]/layout.tsx` 로 나눴으므로 목록을 새 경로로 고친다.
  병합 뒤 `npm run test` 전체와 `catalog-sync` 를 B 와 같이 돌린다.

## render-pages 센티널 `ERP` 의 원인(Z5 F-1 — A2 S10 앞, 정적 확인)

결론: **보는 사람 자신의 소속 팀 표시**다. 다른 프로젝트 데이터의 누출도, 옛 기본값의 누출도 아니다.
- 러너는 부트스트랩 관리자 세션으로 받는다. E2E 4단계(명단)가 그 계정을 A 명단에 `teams: ['ERP', 'MES']`(`SP1_TEAMS.A`), B 명단에
  `['QA']` 로 넣는다(`scripts/e2e-local.mjs:251-253`).
- 앱 셸(`src/app/(app)/layout.tsx` 의 `identity.teamCodes = identityTeamCodes(actor)`)은 보는 사람의 **모든 프로젝트** 명단 대표 팀을
  헤더 소속 표시로 모든 화면에 싣는다(`src/lib/domain/identityTeams.ts` — 프로젝트마다 첫 팀). 그래서 `/p/<B>/weekly` 에도 `['ERP', 'QA']` 가 실린다.
- 대조: 명단에 없는 임시 계정(워크스페이스 A 관리자)으로 받은 HTML 에는 0건이었다. 그 계정의 셸에도 같은 워크스페이스의 공용 팀(`activeTeamsForWorkspaces`)은
  실리므로, `ERP` 가 공용 팀 목록에서 온 것은 아니다. 남는 경로는 명단 대표 팀뿐이다.
- 실행 재현(HTML 의 앞뒤 40자)은 하지 않았다. E2E 데이터가 남은 스택과 `next start` 가 필요해서 A2 체크포인트(과제 21·24)의 `next start` 실행에 맡긴다.
- **S10(과제 22)에 넘기는 것:** 서버 렌더 HTML 검사는 다른 프로젝트 명단에 없는 계정으로 받는다. 같은 계정을 쓸 때는 셸의 보는 사람 소속 팀
  (`identity.teamCodes`)을 K12 규칙대로 "근거·존재 단언"과 함께 제외한다. 이 경우에도 옛 이름 자체를 마스크하지는 않는다. 러너가 적중 위치(앞뒤 40자)를
  함께 남기게 하는 것도 S10 에서 정한다.

# A2 — 체크포인트(과제 24)

트리 `sp4/a2` 의 **`6b1f7aa`**(`sp4-a1-done` 위 56커밋 — 계획 1 + 과제 1~23 + 수정 라운드 Z·Q·U·X·W + 과제 24 의 러너 결함 수정 둘).
측정일 2026-10-02 06:26 ~ 08:31(KST). 전용 스택 `d-flow-sp4`(api 54521 · db 54522)에서만 돌렸고 사용자의 메인 스택은 건드리지 않았다.
모든 DB·무거운 명령은 레인 A 래퍼(`lane-a-run.sh` — DSN 54522 고정)와 공유 잠금(`heavy-lock.sh`) 아래였다.
서버는 A1 과 달리 **`next build` → `next start -p 3101`**(스크래치 워크트리 `sp4-a2-scratch` — 스펙 D19)이다. 마이그레이션 최대 번호는 `0017`(`*_copy_config_team_map`).

## 요약

- **공통 묶음** — `db:reset` 뒤 `max(version)` = `0017`, `dev:bootstrap` ✓, `settings:verify` exit 0, `test:rls` **30 파일 384 통과·건너뜀 0**.
  HEAD `6b1f7aa` 에서 `typecheck` 0, `lint` 0 error(경고 4 — 기존), vitest **757 파일 중 756 · 10,103 중 10,102 통과** — 실패 1 은 `tests/scripts/baseline-cli.test.ts` 의
  macOS firmlink(워크트리 경로 의존, A1 과 같은 1건). 스크래치 `build` ✓(정적 19페이지).
- **E2E(`next start`)** — exit 0, **38단계 전부 ✓**, `missing []`·`failed []`·가져오기 409 0. A2 새 단계 둘: `teams-source-next-start`(서버 `production` 확인)·`export-standard`.
- **합성** — exit 0: S1·S1 추가·S9·S2·S4(월)·**S10(SP4 부분)**·**경계 행렬 SP4 행** ✓, 미활성 S3·S4(일)·S5~S8·S10(나머지 — `SP5~SP8(나머지 부분 집합)`). `synthetic-acceptance.md` SP4 A2 절.
- **눈확인 A2** — 4행 × 4크기 = 16장 + 내려받기 1 = 17건 사실값 통과(`fails` 0) + 눈 판정 통과. 선택자 조정 셋(비고 ③).
- **성능** — 이 체크포인트에서 재지 않았다: **별도 재측정 대기 — perf-a2/**(과제 23 의 1·2·3회차가 이 기계의 부하 잡음과 회귀를 가르지 못했다 —
  조용한 창에서 교대 측정으로 따로 판정한다. 원자료 `.superpowers/sp4/perf-a2/`). `sp4-perf.md` 는 그 측정이 쓴다.

## 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · project `d-flow-sp4`(api 54521 · db 54522) · 마이그레이션 `0000`~`0017` |
| 앱 | Next.js 15.5.19 `next build` → `next start -p 3101` · Node 22.18.0 |
| 앱 위치 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp4-a2-scratch`(detached `6b1f7aa`, `node_modules` 링크, `.env.local` 복사 — 끝에 지움) |
| 빌드·서버 env(이름만) | 빌드 `NEXT_PUBLIC_APP_URL`(3101 — `NEXT_PUBLIC_*` 는 빌드 때 박힌다), 서버 `NEXT_PUBLIC_APP_URL`·`INVITE_ALLOWED_DOMAINS`·`MINUTES_API_ENABLED`·`MINUTES_API_SECRET`·`CRON_SECRET`·`NODE_OPTIONS`(`--max-old-space-size=4096`) |
| 계정 | 부트스트랩 `admin@example.com` — 비밀번호·시크릿은 `openssl rand` 로 한 셸의 변수로만(끝에 unset). 눈확인은 service_role 로 만든 임시 계정(워크스페이스 A 관리자, 끝에 삭제) |
| 산출물 | `mktemp -d` 아래(E2E·합성 JSON·xlsx·스크린샷) — 커밋하지 않는다 |

## 순서와 명령

1. (06:26 · `6f0e52b`) 착수 확인 — `sp4/a2`, status 빈 출력, 52커밋, `sp4-a2-done` 없음. Step 1 `db:reset`(0017) → `dev:bootstrap` → `settings:verify` → `test:rls`(384·건너뜀 0). Step 2 typecheck·lint·vitest 10,085/10,086.
2. (07:34) Step 3 스크래치 build ✓. (07:36) Step 4 1회차 — E2E 38단계 ✓, 합성이 **S10 ② 에서 멈춤**(비고 ①).
3. (07:4x~07:52) 러너 결함 수정과 A2-4 앞부분 리뷰 수정 W1~W3 — `f144c29`(S10 ⑤ 그려짐 단언 W1 + ② 빈 주차)·`2c47a4f`(W2 성능 러너 DSN)·`9817810`(W3 `next start` 확인).
4. (07:55~07:58 · `9817810`) Step 2·3 다시(vitest 10,099/10,100, build ✓). Step 4 2회차 — E2E ✓, 합성이 **S10 ④ 펼침에서 멈춤**(비고 ②). `6b1f7aa` 로 고침 — 커밋 전 같은 서버·새 DB 에서 고친 러너만 돌려(프로브) 합성 exit 0 확인.
5. (08:0x~08:10 · `6b1f7aa`) Step 2·3 다시(vitest 10,102/10,103, build ✓). **Step 4 공식** — `db:reset`(0017) → `dev:bootstrap` → `next start -p 3101` → `node scripts/e2e-local.mjs` exit 0(38단계) → `npm run accept:synthetic` exit 0 → 실행 전후 `git diff --quiet -- src supabase` 참 → `settings:verify` exit 0(프로젝트 12·워크스페이스 5·문제 0).
6. (08:12~08:28) Step 5 눈확인 — `npx --yes -p playwright@1 node eye-a2.mjs <e2e.json> <폴더>` 네 번(비고 ③), 4회차 17/17. (08:29) Step 6 서버 종료(3101 → `000`). (08:30) Step 7 검사 묶음.

## E2E 단계표(`next start`)

| # | 단계 | 판정 |
|---|---|---|
| 1~25 | `login` … `minutes-api-scope`(A1 표와 같은 25단계) | ✓ |
| 26~31 | `weekly-areas-required`·`weekly-carry-mapping`·`weekly-outputs`·`weekly-registered-names`·`import-idempotent`·`import-unregistered-teams` | ✓ (A1 새 단계 여섯) |
| 32 | **`teams-source-next-start`** | ✓ 새 프로젝트 N(공용 팀 상속)에 `addProjectTeam('RUN')` 직후 같은 서버 프로세스에서 가져오기 실행 → `applied`·5건·`profileSaved: false`, 항목 5, 담당 RUN, **`serverMode: production`**(`checks` 넷 — `applied`·`items`·`owned`·`nextStart` 참). 409 없음(KLC:56 해제) |
| 33 | **`export-standard`** | ✓ 저장 양식 없는 N 의 엑셀 접기·펼침 둘 다 200·`X-Excel-Layout: standard`, 텍스트 파트 센티널 0(N 이 등록한 팀 code·이름만 뺌) |
| 34 | `render-pages` | ✓ 12쪽 문제 0 — B 주간 HTML 기록 `sentinels: ["ERP"]`·`masks: ["영업일","영업관리팀"]`(플랫폼 관리자 세션 — 아래 F-1) |
| 35~38 | `module-issues-off`·`module-agents-off`·`module-minutes-integration-off`·`module-index-skip` | ✓ |

**F-1 실측(A1 최종 리뷰 이월 — Z5 의 정적 결론 확인):** 합성 S10 이 플랫폼 관리자 세션으로 받은 R·C 주간·WBS HTML(판정 밖 `adminShell`)의 `ERP` 적중 위치는
네 곳 모두 `"roleLabel":"슈퍼유저","teamCodes":["ERP","OPS","QA"],"isSuperuser":true` — 앱 셸의 보는 사람 소속 팀(`identity.teamCodes` — 이 계정이 E2E 의 A·D·B 명단에 든 대표 팀)이다.
명단 밖 워크스페이스 관리자로 받은 같은 화면(판정 대상)은 적중 0. 옛 기본값·다른 프로젝트 데이터의 누출이 아니다.

## 눈확인 A2

스펙 §6.6 A2 행 ↔ 이 표: 설정 내보내기 표기 = X1(표준 — 저장 양식 없는 N)·X2(저장된 양식·날짜 — E2E 가 양식을 저장한 A), 마법사 펼침 버튼 = X3(N 에 append·양식 저장 끔 →
완료 화면, 같은 페이지의 창 크기만 바꿈)·X3 내려받기, WBS 단계 배지 = B1(N 의 항목 상세 패널 머리 배지, 단 셋). 헤드리스 Chromium(playwright@1), 라이트, 서버 3101.
스크린샷은 커밋하지 않는다(이름·해시만).

| # | 화면 | 크기 | 결과 | 해시 | 관찰 |
|---|---|---|---|---|---|
| 1 | X1 표준 | 1440×900 | 통과 | 63ec0a9cc554 | '표준 양식(프로젝트 팀·단계로 생성)' 이 Excel 내보내기 버튼 바로 왼쪽, 저장 양식 문구 없음 |
| 2 | X2 저장된 양식 | 1440×900 | 통과 | 3214669405d4 | '저장된 양식(임포트 마법사, 2026-10-02)' 버튼 왼쪽, 그 아래 '저장된 양식 비우기' 단락 따로 |
| 3 | B1 단계 배지 | 1440×900 | 통과 | 3eb8c40e4acc | 패널 머리 배지 '단계'·'작업'·'활동'(라벨 원문), 배지 폭이 글자에 맞음, 코드 옆. PHASE·TASK·ACT 없음 |
| 4 | X1 | 1280×720 | 통과 | 52ba2d05bffb | 〃 |
| 5 | X2 | 1280×720 | 통과 | 3106cfbf6551 | 〃 |
| 6 | B1 | 1280×720 | 통과 | 9eab36252124 | 〃 |
| 7 | X1 | 768×1024 | 통과 | d240f9070f56 | 〃 |
| 8 | X2 | 768×1024 | 통과 | 699ecabc3433 | 〃 |
| 9 | B1 | 768×1024 | 통과 | f47d6ff835c3 | 〃 |
| 10 | X1 | 390×844 | 통과 | 40e4d0ad01f9 | 표기가 버튼 왼쪽 한 줄에 들어감, 잘림·겹침 없음 |
| 11 | X2 | 390×844 | 통과 | d8e807e195af | 표기 한 줄 → 그 아래 버튼, 날짜까지 읽힘 |
| 12 | B1 | 390×844 | 통과 | e827f5aff213 | 패널이 화면 전체, 배지 '활동' 또렷 |
| 13 | X3 펼침 버튼 | 1440×900 | 통과 | ca8fa196e97d | 제목·설명(표준 양식 문구 포함)·버튼이 한 패널(버튼 오른쪽), '양식을 저장하지 않아' 없음 |
| 14 | X3 | 1280×720 | 통과 | 1c8f720b19f3 | 〃 |
| 15 | X3 | 768×1024 | 통과 | 0528806b6773 | 버튼이 설명 아래, 한 덩어리 |
| 16 | X3 | 390×844 | 통과 | 250aa10042e5 | 〃 — 패널 아래 '다른 파일 가져오기' 끝이 떠 있는 챗봇 단추·완료 토스트에 가린다(비고 ④) |
| 17 | X3 내려받기 | — | 통과 | — | `WBS_E2E_N_<stamp>_2026-10-02.xlsx` |

## 검사 묶음(Step 7)

- ① `sp4-a1-done..HEAD -- supabase tests/rls` = `0016_team_scope_lock_order`·`0017_copy_config_team_map`(마이그레이션·롤백 넷)과 `tests/rls/settings-create.test.ts`·`team-convert.test.ts` 뿐.
  계획은 "A2 는 SQL 을 고치지 않는다(빈 출력)"였으나 A1 최종 리뷰 이월 Z1·Z3 과 A2-1 수정 Q2 가 컨트롤러 판정으로 마이그레이션을 더했다(리허설은 위 "A2 — A1 이월 수정" 절). 그 밖 파일 0.
- ② 옛 캐시 소비처 정확히 7 — `(app)/layout.tsx`·`p/[projectId]/layout.tsx`·`members/page.tsx`·`actions/project.ts`·`actions/projectTeams.ts`·`actions/teams.ts`·`DashboardView.tsx`.
- ③ `DEFAULT_LEVEL_LABELS|LEGACY_LABEL_ABBR|RESERVED_TEAM_NAMES`·`LEGACY_EXCEL_PROFILE_V1`·`legacyBuild` 모두 `src` 0건(exit 1), `src/lib/excel/export.ts` 없음, 감지 `[[8, '*']]` 1줄(`template.test.ts:61`).
- ④ 상태 머리 커밋 `9064e4f` → 동등성 커밋 `194cabb`(조상) ✓.
- ⑤ 허용 목록 밖 화면 파일 0, UI 위험 파일 0.
- ⑥ 화면 커밋 여섯 모두 `Preview-checked` 가 `Co-Authored-By:` 바로 위(local 다섯 · n/a 하나 — 그 화면은 이 체크포인트의 빈 커밋 트레일러가 받는다).
- ⑦ 런타임 상수·원문·설정 쓰기·센티널 목록·소비처 불변식·부정 테스트 7 파일 107 통과.
- ⑧ 스펙 §7 A2 의 이름 있는 단위 묶음 26 파일 391 통과.
- ⑨ 카탈로그 `wbs.excel_profile` `status: 'verified'` 1.
- ⑩ 다시 쓴 테스트 목록 56 파일 옛 이름 0(`hits []`). 계획의 검사 스크립트는 `REWRITTEN_TESTS` 부터 파일 끝까지 경로를 모아 "목록 밖" 단언(센티널 장치·SP5 소유 파일)의 경로까지 셌다 —
  목록 리터럴(`] as const` 까지)로 좁혀 셌다.
- ⑪ 성능 — 별도 재측정 대기(perf-a2/).

## 비고

- ① **러너 결함(과제 24 가 고침 — `f144c29`)**: S10 ② 가 R 의 이번 주(① 이 방금 만든 빈 문서 — 행 셋 모두 빈 칸) 시트 PPT 에 200 을 기대했다. 앱은 SP0 부터 내용 없는 주차에
  400 '해당 주차에 작성된 내용이 없습니다' 를 준다(`src/app/api/report/route.ts`). 앱과 같은 술어(`hasContent(ALL_CELLS)`)로 빈 주차를 가려 그 400·문구를 `emptyWeeks` 에 적고 출력 대상에서 뺐다.
- ② **러너 결함(`6b1f7aa`)**: S10 ④ 가 R·C 의 펼침(`expand=1`)에 200 을 기대했다. S2 가 저장한 양식이 아웃라인이라 앱은 400 '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' 로
  명시적으로 거절한다(U2 — 가져오기 완료 화면도 같은 사유). 접기의 `X-Excel-Layout` 이 `saved` 이고 그 문구일 때만 `unsupportedExports` 에 적고 대상에서 뺐다. 그래서 S10 대상 수가
  계획의 "R·C 각각 ≥ 8"과 다르다 — R 7(② 0)·C 9. 앱이 낼 출력이 없는 대상이고, R 의 ② 를 실제 출력으로 만들려면 S10 앞에 R 주간 칸을 쓰는 설계 변경이 필요하다(이월 판단).
- ③ 눈확인 스크립트 조정(무엇을 보는지 — `EXPECT` — 는 바꾸지 않았다): ⓐ 가져오기 화면 기본 탭이 마크다운이라 엑셀 탭을 누른 뒤 `input[type=file][accept=".xlsx"]`(A1 ③ⓑ 와 같다)
  ⓑ B1 — 단계 배지는 시트에 열이 없다(2026-08-21 개편으로 구분 열 삭제, 배지는 항목 상세 패널 머리). 단마다 대표 항목(설계·요구 분석·요구사항 정리)을 눌러 패널을 열고, 다음 행을
  가리지 않게 Escape 로 닫는다. 1회차는 시트 본문만 읽어 '작업명' 머리의 '작업' 만 잡혔다. ⓒ 패널 본문의 'SUB-ACT 추가'(세부업무 구조 편집 버튼 — 옛 단계 축약이 아니다)가 옛 축약 검사에
  걸려, 읽는 범위를 배지가 있는 패널 머리(`header` — 배지·코드·제목)로 좁히고 라벨 일치를 공백 경계로 했다. X3 의 마법사 가져오기는 회차마다 N 에 append 됐다(판정 무관).
- ④ 390 의 가져오기 완료 화면 아래 버튼 줄이 떠 있는 챗봇 단추·완료 토스트(사라지는 알림)에 일부 가린다 — 이 체크포인트의 변경이 아니라 기존 떠 있는 요소의 반응형 빈틈(A1 비고 ⑤ 와 같은 계열 — 레인 B·SPU3 몫으로 알린다).
- ⑤ `next build` 로그에 `[getProjectsCompletion] 조회 실패: Dynamic server usage: Route /minutes|/meetings|/projects couldn't be rendered statically because it used cookies` 3줄.
  `db66df5`(A2 과제 2)가 `createServerClient()` 를 try 안으로 옮겨, 정적 생성 시도의 Next 동적 신호를 catch 가 "조회 실패"로 로그한다. 세 라우트는 여전히 동적(ƒ)이고 요청 때는 쿠키가 있어 동작
  영향은 없다 — catch 에 `unstable_rethrow(e)` 를 두는 후속을 권한다(코드 무수정 체크포인트라 고치지 않았다).
- 전용 스택은 내리지 않았다(레인 B·성능 재측정이 쓴다). DB 에는 E2E·합성 데이터가 남고 눈확인 임시 계정은 스크립트가 지웠다.

## 알려진 한계(A2-4 앞부분 리뷰 기록 P3 셋)

- **봇 도구 관문의 503 범위(X2)**: 한 워크스페이스의 설정(`modules.allowed`)이 손상되면 그 워크스페이스에 속한 사용자의 **프로젝트 문맥 없는** 봇 질문이 모두 503 `MODULES_UNAVAILABLE` 이다(다른 워크스페이스 질문까지). 프로젝트 문맥이 있는 질문은 영향 없다. 의도한 방향(3원칙 ① — 열화를 드러낸다)이고 원인은 로그(`[moduleSetFor]`·`[chat-v2] 모듈 설정 조회 실패`)에, 손상은 `settings:verify` 가 미리 잡는다.
- **상속 프로젝트 가져오기의 보수적 겹침 거절(X4)**: 전환 앞 겹침 검사가 전환 뒤 남지 않을 공용 팀(파일 밖의 비활성·미참조)까지 대조한다 — 공용 팀끼리 키가 겹치는 옛 데이터에서만 거짓 400 이고, 그 400 은 409 확인 창(동의) 뒤 실행 요청에서 난다(부수효과 없음). 신규로는 그런 데이터가 생기지 않는다(팀 추가·수정이 막는다).
- **성능 러너의 1,500행 이름 세기(과제 23)**: 항목 수를 시드 항목 이름으로 센다(표준 내보내기에는 WBS 코드 열이 없다). 같은 HTML 안의 다른 무범위 목록(예: 선택 상자)이 이름을 전부 싣고 표만 잘린 경우는 가르지 못한다 — 지금 WBS 화면에서 그런 목록은 확인하지 못했다.

## 운영 메모(스펙 D20·P12 ②)

- **null 가중치** — 진척 집계의 가중치 미입력(null)은 이제 어디서나 1 로 센다. 바뀐 곳은 루트 항목 가운데 일부만 가중치가 비어 있는 프로젝트뿐이다(전에는 루트의 null 을 0 으로 세어 그 루트가 전체 진척에서 빠졌다). 가중치를 일부러 비워 '집계 제외'로 쓰던 프로젝트는 그 루트에 0 을 넣어야 한다. 대시보드·AI 도구의 '가중치 미입력 N건'(`unsetWeightCount`)으로 그런 행을 찾는다.
- **팀 60초 지연** — A2 뒤 비화면 경로(가져오기·내보내기·AI 도구·회의록·보고서·라우터)는 팀을 요청마다 읽는다(`teams-source-next-start` 가 `next start` 에서 확인). 옛 프로세스 캐시(모듈 인스턴스마다 60초 TTL)를 읽는 곳은 화면 넷(앱·프로젝트 레이아웃·명단·대시보드)뿐이라, 팀을 더하거나 바꾼 직후 그 화면의 팀 목록만 최대 60초 늦을 수 있다(같은 프로세스의 `refreshTeams` 를 탄 요청은 즉시). B 가 캐시를 지운다.

## A2 실측 노력

커밋 시각(`git log --reverse --format='%h %ad' sp4-a1-done..HEAD`)과 원장(`.superpowers/sp4/progress.md`)의 리뷰 기록에서 옮겼다. 묶음은 병렬로 겹친다(구현자와 앞 묶음 리뷰가 동시에 돌았다).
로컬 태그 `sp4-a2-done` 은 최종 리뷰 뒤 컨트롤러가 단다 — 아래 수는 이 기록 커밋 앞 HEAD(`6b1f7aa`)까지다.

| 묶음 | 과제 | 커밋 수 | 첫 커밋 → 끝 커밋(경과) | 리뷰 | 비고 |
|---|---|---|---|---|---|
| 계획 | — | 1 | 10-02 01:59 | — | `0821cf6` |
| A2-1 | 1~8 | 8 + A1 이월 Z1~Z5 9 | 02:02 → 03:13(1.2시간) | 관점 2(정확성·보안) · 수정 1(Q1~Q6 — A2-2 구현자가 이어서) | Z1·Z3 은 마이그레이션 0016·0017 |
| A2-2 | 9~15 | 7 + Q 수정 8 | 03:22 → 04:20(1.0시간) | 관점 2(보안·정확성) · 수정 1(U1~U5 — A2-3 구현자가 이어서) | Q2 는 0016 그 자리 수정 |
| A2-3 | 16~20 | 5 + U 수정 5 | 04:28 → 05:13(0.75시간) | 관점 2(보안·정확성) · 수정 1(X1~X5 — A2-4 구현자가 이어서) | |
| A2-4 | 21~24 | 4 + X 수정 5 + 과제 24 의 4(+ 기록 2) | 05:22 → 08:3x(3.2시간) | 리뷰 1(21~23+X) · 수정 1(W1~W3 — 과제 24 안) | 과제 23 성능 ok:false → 보류(별도 재측정), 과제 24 는 러너 결함 둘·스트림 끊김 1회 |
| 합계 | 1~24 | 56(+ 기록 2) | 01:59 → 08:3x(약 6.6시간) | 관점 리뷰 7 · 수정 라운드 4(+ A1 이월 1) | |

비율(A1 절과 같은 식): 스펙 추정 A2 1.4~1.95주 + 고정 0.2~0.3주 = 1.6~2.25주(8~11.25일). 경과 약 6.6시간 = 0.28일 → **0.024~0.034**(A1 0.021~0.029 와 비슷).
성능 판정(스펙 §6.5)이 아직 열려 있어 A2 의 끝은 그 재측정까지다 — 이 경과에 들지 않는다.
