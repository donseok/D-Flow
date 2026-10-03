# SP5 E2E·리허설 기록 — Phase A

계획 `docs/superpowers/plans/2026-10-02-sp5-phase-a.md`(스펙 `docs/superpowers/specs/2026-10-02-sp5-calendar-issues-minutes-design.md` §3.2·§3.8·§7 A).
레인 A 전용 스택(워크트리 `/Users/jerry/D-Flow-wt/lane-a-sp4`, 브랜치 `sp5/a`, project `d-flow-sp4`, db 54522 — 공통 지시의 P12 정정)에서 잰다.
시각은 KST. 마이그레이션 번호는 접미로 적는다(`*_calendar` — D2, 잠정 번호 0018·직전 0017).
체크포인트 절(E2E·합성·눈확인·성능)은 과제 33 이 끝에 더한다.

## 리허설

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_calendar` | R(카탈로그 — M → N → 롤백 → 재적용) | 2026-10-02 10:43~10:45 | `diff r b` 불일치 0(함수 143·트리거 66·정책 138, dump 차이 0) · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0(함수 148·트리거 67) · ⑪ `CALENDAR_POSTCHECK` 통과 |
| `*_calendar` | 데이터 ①②③ + 키 있는 프로젝트(`week_start` seed → 적용 → check·smoke → 롤백 → 롤백 확인 → 재적용 → check·smoke) | 2026-10-02 10:45 | 첫 적용 `CALENDAR_WEEK_START_REHEARSAL: 14 항목 통과`·`CALENDAR_SMOKE: 9 항목 통과` · 롤백 확인 다섯(`kind` 열 0·헬퍼 0·옛 사용현황 있음·가져오기 본문의 휴일 `kind` 0·tz 값 `Asia/Seoul` 남음) · 재적용 14·9, revision 그대로(P1~P3 = 1, P5 = 3 — 멱등) · 서울 오늘 10-02(K = 09-28): P2 의 E = 2026-10-04, P3 의 E = 2026-10-25 · `settings:verify` 문제 0(10:37, 같은 seed) |
| `*_calendar` | 음성 ④(`week_start` bad → 적용) | 2026-10-02 10:37~10:39 | `CALENDAR_PRECHECK: 월요일이 아닌 주 키 1건 — (프로젝트 00000000-0000-0000-5c05-000000000c04, 2026-09-29, isodow 2). 그 문서의 주 키를 월요일로 고친 뒤 다시 적용한다` 로 멈춤, 버전 = 0017 |
| `*_calendar` | 사후검사 민감도(⑪-a — 트리거 끔·헬퍼/사용현황 실행권·DEFINER·골격 되돌림·가져오기 실행권 회수) | 2026-10-02 10:46 | 모두 `CALENDAR_POSTCHECK` 로 멈춤(`week-start-transition` 의 ⑪-a 네 케이스) |
| `*_calendar` | 사용현황 RPC 언어(계획 P5) | 2026-10-02 10:51 | sql — `explain` 의 `One-Time Filter: ((now() AT TIME ZONE 'UTC'::text) IS NOT NULL)` · 빈 표 22023 케이스 초록(plpgsql 대안 불필요) |
| 공통 | `db:reset`·`dev:bootstrap`·`settings:verify`·`test:rls` | 2026-10-02 10:46 | `test:rls` 33파일·436 통과·건너뜀 0 · `settings:verify` 문제 0 |
| 공통 | CI 등가(부트스트랩 없이 `db reset --version 0001` → `migration up` → `test:rls`) | 2026-10-02 10:47~10:48 | 계정 0 · `test:rls` 33파일·436 통과·건너뜀 0 |
| `*_calendar`(A-2 리뷰 수정 L1~L6 — 그 자리 수정) | R(카탈로그) | 2026-10-02 13:13~13:14 | `diff r b` 불일치 0(함수 143·트리거 66·정책 138) · 기본 권한 diff 없음 · `diff f a` 불일치 0(함수 148·트리거 67 — ⑩ 의 E 계산 함수는 pg_temp 라 카탈로그에 없다) |
| `*_calendar`(L) | 데이터 ①②③ + P5 + **P6 먼 미래 문서(K+70)** — 적용 → check·smoke → 롤백 → 롤백 확인 → 재적용 → check·smoke | 2026-10-02 13:14~13:15 | 첫 적용·재적용 `CALENDAR_WEEK_START_REHEARSAL: 15 항목 통과`·`CALENDAR_SMOKE: 9 항목 통과` · 롤백 확인 `0`·`0`·`t`·`0`·`Asia/Seoul` · revision P1~P3·P6 = 1, P5 = 3 · L6 알림 `CALENDAR_MIGRATE: 일요일 전환이 8주 넘게 미뤄진 프로젝트 …0c06 — E 2026-12-13, 오늘 2026-10-02`(P6 한 줄 — P2·P3 는 없음) |
| `*_calendar`(L) | 음성 ④ | 2026-10-02 13:15~13:16 | `CALENDAR_PRECHECK: 월요일이 아닌 주 키 1건 — (…0c04, 2026-09-29, isodow 2) …` 로 멈춤, 버전 0017. 키 있는 프로젝트 갈래(L2)는 `week-start-transition` 의 블록 재실행 케이스가 본다 |
| 공통(L) | `db:reset`·`dev:bootstrap`·`settings:verify`·`test:rls` + CI 등가 | 2026-10-02 13:16~13:17 | `settings:verify` 0 · `test:rls` 33파일·441 통과·건너뜀 0 · CI 등가(계정 0) 441 통과·건너뜀 0 · 끝에 전체 적용 + 부트스트랩 |

비고:
- 리허설 seed(`*_calendar_week_start.sql` mode=seed)는 생성 RPC 를 거치지 않아 필수 키 `core.level_labels` 가 없다 — `settings:verify` 의 `required_missing` 이 이관 판정을 가리지 않게 seed 가 그 키를 직접 쓴다(revision 무변경).
- ⑩ '오늘이 일요일' 갈래(E = K+13)는 리허설 실행일(금요일)이 밟지 않는다 — ⑩ 의 E 계산을 날짜 인자형 `pg_temp.calendar_migrate_e` 로 떼어
  `week-start-transition` 이 그 블록을 그대로 만들어 일요일·월요일·토요일·미래 문서 경우를 단위로 본다(A-2 리뷰 — L 수정).
- 롤백 확인의 가져오기 본문 검사는 휴일 갱신절의 `kind`(`public.holidays.kind`·`name, kind)`)만 센다 — SP4 원문에도 `item_owners.kind` 가 있다.

# A — 체크포인트(과제 33)

- 일시: 2026-10-03 08:10 ~ 08:41 KST. 체크포인트 HEAD **`5d207d06`**(브랜치 `sp5/a` — main `07d8bd1a`(UI-2·SP4 A·B)를 merge `5e5e82c1` 로 담았다. 계획의 `ui/sp5-calendar`
  브랜치는 만들지 않았다 — UI-2 가 `(app)/layout.tsx` 의 서울 '오늘'을 포털 로더로 옮겨 과제 32 가 UI 위험 파일을 고치지 않는다). 밑 `sp4-a2-done`.
  마이그레이션 `0019_calendar`(main 의 `0018_account_preferences` 다음 — merge 때 0018 → 0019 rename, 내용 변경 0). 전용 스택 `d-flow-sp4`(db 54522)만, 래퍼 `lane-a-run.sh`·잠금 `heavy-lock.sh` 안.
- 리허설(HEAD 에서 다시 — `0431001e`, 이후 커밋은 러너·테스트뿐): R(M=0018·N=0019) `diff r b` 불일치 0·기본 권한 diff 없음·`diff f a` 불일치 0 ·
  데이터 왕복 첫 적용·재적용 `CALENDAR_WEEK_START_REHEARSAL: 15 항목 통과`·`CALENDAR_SMOKE: 9 항목 통과`, 롤백 뒤 `kind` 열 0·헬퍼 0·옛 사용현황 t·`Asia/Seoul`(되돌리지 않는 데이터)
  (가져오기 본문의 단순 `position('kind')` 는 SP4 원문의 `item_owners.kind` 라 0 이 아니다 — 위 비고의 토큰 검사가 정본이고, R 의 `diff r b` 0 이 롤백 뒤 본문 = 0018 본문이다).
- 공통 묶음: `db:reset`(0000 → … → `0019_calendar`) 초록 · `dev:bootstrap`(`BOOTSTRAP_TIMEZONE=UTC`) · `settings:verify` 0(프로젝트 0·워크스페이스 1·문제 0) · `test:rls` 35 files·448 통과·건너뜀 0 ·
  `migration-files` 5 통과 · 재 reset + bootstrap(Step 5) · HEAD `5d207d06` 에서 `typecheck` 0·`lint` 0 error(4 경고 — 기존 테스트 파일) · vitest 872 files·11,500 중 11,499 통과(기준선 실패 `baseline-cli` firmlink 1) ·
  스크래치 `build`(`NEXT_PUBLIC_APP_URL=http://localhost:3101`) 성공(정적 16페이지, 경고 = 미들웨어 Edge supabase-js — 기존)
- CI 등가: `db reset --version 0001` → `migration up`(계정 0) → `test:rls` 35 files·448 통과·건너뜀 0
- 로컬 E2E(3101, **`next start`**, 스크래치 `5d207d06`): exit 0·`ok: true`, **54단계 전부 ✓** — SP5 A 넷(`calendar-week-sunday`·`calendar-week-transition`·`calendar-tz`·`calendar-workday`),
  `teams-color-render`, `sp3b-` 11, `render-pages`, 기존 주간 단계(`weekly-carry-mapping` 의 `sundayKeys` ✓ — SP5 D5 의 의도된 변화). 실행 전후 `git diff --quiet -- src supabase` 참, 뒤 `settings:verify` 0(프로젝트 17·워크스페이스 5·문제 0).
  - 1회차(`0431001e`)는 `calendar-tz` ✗ — 러너 결함 둘: ① `/w/<slug>/usage` 렌더의 `after(purgeOldUsageEvents)` 가 보존 90일 밖인 2026-01-15 픽스처를 지워, 화면을 먼저 연 러너의 UTC 일자 판독이 빈 배열(경합 — 함수는 psql·PostgREST 로 정상 확인)
    ② `createAnnouncement` 가 작성자 읽음 표시를 방금 만든 공지로 올려(앱 의도) 배지가 늘 0 — merge 때 티커 → 배지로 바꾸며 놓친 기대값. `5d207d06` 이 판독 순서·작성자 워터마크 걷기만 고쳤다(단언 무완화) + 포털 홈 공지 카드 판정 추가.
  - `calendar-tz` 판별적 시각 여부: **아니오**(08:20 KST — UTC·LA 모두 10-02). 단 같은 순간 서울은 10-03 = LA 의 내일이라, 포털 공지 카드(`now` ✓·`later` ✗)·셸 배지(1)는 옛 서울 고정 코드와 갈리는 시각이었다.
    오독 방지(a6-fix-brief): `discriminating` 은 날짜만 달라도 참인 값이라 서버 tz 경로 검증 근거로 쓰지 않고, `render-pages` 의 `America/Los_Angeles` 기대(datalist 로 늘 참)도 화면 근거로 쓰지 않는다 — 화면은 눈확인(`sp5-ui.md`)이 DOM 으로 본다.
  - 사전 확인: A 프로젝트 kanban 모듈 켜짐(`teams-color-render` 칸반 problems 0), e2e-local 을 `npx --yes -p playwright@1.58.2` 로 호출(`sp3b-E11` ✓).
- 합성: `docs/baseline/synthetic-acceptance.md` 의 SP5 A 절
- 성능: **일괄 측정 대기**(사용자 지시 — 과제 31b 는 SP5 전체 구현 뒤 한꺼번에 잰다. `sp5-perf.md` 없음)
- 눈확인: `docs/baseline/sp5-ui.md`(78 장 — 20행, 라이트·다크 × 1440·390, 보고서 모달만 1440 두 장)
- 검사 묶음(과제 33 Step 8): ② 무수정 셋 ✓ · ③ 선기록 `d5799c05` → 마이그레이션 `d6f2b433` ✓ · ④ 마이그레이션 커밋 셋(`d6f2b433`·`98d97446` 은 두 파일만·`Staging-verified` 가 `Co-Authored-By` 바로 위, `c875eccb` 는 rename 두 파일 — G4 는 빈 커밋 `70875911`) ·
  ⑤ main 대비 UI 위험 파일 diff 0·SP5 쪽 커밋이 만진 UI 위험 파일 0 · ⑥ 화면 커밋 29 모두 `Preview-checked` · ⑦ `CHAT_TIMEZONE` 0·옛 주 이름 1(`scripts/ui-capture.mjs:426` — 과제 7 의 월요일 캡처 시드, 단일 출처 가드의 영구 허용 항목)·국가 달력 0·`ToolContext.timezone: string`·`Asia/Seoul` 등 코드 줄 0(주석 셋) ·
  ⑧ 이름 있는 테스트 18 files·461 통과 · ⑨ 달력 키 셋 `S5A('verified'` 3 · ⑩ 라벨 커밋 `907df97e`·`1992edbf` 의도 변화 ✓ · ⑪ `0019_calendar` > main 의 마지막 `0018_account_preferences`(rename 불필요)
- 메인 스택(사용자 DB): 적용하지 않았다(D48 — §8 #13 은 main 반영 뒤 컨트롤러가 사용자에게 묻는다. #1·#2 의 답 상태: 10-02 05시 답 받음 — #1 통일·#2 전환)
- 커밋 위생(bisect): `90ead30` → `6b36cae`, `ebea4cd` → `ce69c55`, `bafc051`·`1992edb`·`907df97`·`5a64a13` → `a9bab86` 로 건너뛴다. O2(`153d06c8`)의 `Preview-checked` 시각 19:12 는 실제 19:08~09(amend 금지 — 기록으로 정정).
- merge 커밋 `5e5e82c1` 은 0018 번호가 둘이고(`0018_calendar`·`0018_account_preferences`) 테스트도 빨갛다 — bisect 때 `f9ad12ae` 로 건너뛴다(A 최종 리뷰 P3).

# B1 — 체크포인트(과제 18) · 2026-10-03

- 체크포인트 소스 HEAD `4eb5fe81` (`sp5/b1`), main 기준 `9b50d483` / 마지막 이관 `0019_calendar`; fetch·main 사용자 스택 접근 없음. 전용 `d-flow-sp4` (API 54521, DB 54522)에서 `db:reset`·`dev:bootstrap`·`settings:verify` 문제 0.
- 마이그레이션 R 왕복: catalog 차이 0·권한 차이 0·데이터 왕복 통과; rollback smoke 20 통과. CI 등가 reset `--version 0001` 뒤 migration up 및 RLS 37 파일·550 통과. 전체 reset/bootstrap 뒤 RLS 재확인.
- 코드 검사: `ISSUE_MEGA_AREAS`, `issue_mega_areas`, `mega_code`, `pi_issue_code` 사용 0; UI 위험 파일 변경 0; 기존 `schema-invariants` 예외 한 행 제거만. 합성 게이트 `ok:true`, 18/18; 로컬 E2E `ok:true`, 55/55. 기본 `ISS-001`, 영역별 `E2E-RND-001` → 개명 후 기존 코드 유지 → `E2E-RND-002`, 목록·분석서의 코드 표시, 분석 모듈 비활성화 시 쓰기 거부·API 404를 확인했다. 봇 호출은 외부 LLM 키 없이 단위 검사만.
- 설정 검사: 4 프로젝트·4 워크스페이스, 문제 0. 전체 Vitest 882 files / 11,648 tests 중 11,647 통과, 기존 macOS firmlink 경로 테스트 1 실패(`tests/scripts/baseline-cli.test.ts`, `.superpowers` 허용 경로를 `/System/Volumes/Data` alias에서도 허용해야 하는 기준선). lint 0 error(기존 경고 4), typecheck 통과.
- 눈확인: `sp5-ui.md` B1 절, 13 화면 시나리오 × 1440/390 × light/dark; calendar 오류 주입은 전용 DB에서 복구 확인. 빌드는 B1 앱 소스가 마지막 검증된 시점에 성공.
- 종료 정리: 전용 DB reset + bootstrap(UTC) 뒤 `settings:verify` 프로젝트 0·워크스페이스 1·문제 0. 사용자 DB 적용 없음.
- 연도 경계: 해당 없음 — 채번 연도는 UTC instant를 설정 시간대로 변환해 산출(`at time zone`); 구간 경계 판정이 아니다.

# B1 — 성능(보류 — 일괄 측정)

- 상태: **보류 — SP5 전체 구현 뒤 일괄 측정**(사용자 지시 2026-10-02, P16). 지금은 이슈 코드 채번·분석 진입 경로의 비용을 대상으로만 기록한다.
- 바뀐 경로: 매 이슈 insert 의 `assign_issue_code` 트리거가 프로젝트 설정 행 `FOR SHARE`, 지정된 이슈 영역 행 `FOR KEY SHARE`, 번호 카운터 upsert 잠금을 거친다. 발급 문자열이 이미 있으면 `exists(project_id, code)` 유일 인덱스 탐색을 반복한다. 이슈 페이지와 create/update 액션은 `loadIssueEntryContext` 에서 `getProjectConfig` 와 `moduleState` 를 병렬 조회하고 정책·분류 설정·영역을 해석한다. 현재 helper 에 요청 간 캐시가 없으므로 페이지 및 액션 왕복의 측정값에 설정 조회가 포함된다.
- 측정 대상: ① 동시 채번 100건 — 측정 전용 스크립트에서 두 연결이 같은 범위로 insert 하고 건당 지연 p95·유일성·무결번을 기록한다(기존 `issue-code-policy` 경합 케이스를 따른다). ② `/p/<pid>/issues` — 800 이슈 시드 페이지 응답. ③ `createIssue` 액션 왕복 — 같은 설정·영역으로 순차 생성한다.
- 방법: `docs/baseline/sp4-perf.md` 의 교대 방법과 A 과제 31b 를 따른다. 기준선은 B1 직전 `main`, 후보는 `sp5-b1-done`; 둘 다 `next start`, 워밍업 3회 뒤 경로별 순차 30회 × 3 라운드, ABBA 순서, 측정 앞 1분 load < 3 기록. 두 편의 빌드·시드·`vacuum analyze` 를 맞추고 전용 스택에서 수행한다. 동시 채번용 임시 측정 스크립트는 재현 절차에 두되 커밋하지 않는다.
- 판정: 페이지·액션 p95 는 라운드별 중앙값의 후보/기준선 비율 ≤ 1.20(D59). 동시 채번은 절대 p95(건당)와 유일·무결번 결과를 기록하되 회귀 비율 기준은 적용하지 않는다.
- 측정 실행처: 레인 A 원장의 일괄 측정 목록과 과제 18 종료 알림. 측정 시 기준선·후보의 실제 커밋 좌표와 부하 기록을 이 절에 추가한다.


## B1 최종 리뷰 — 2026-10-04

- 대상: `sp5-b1-done` = `164ac7c0`, main 기준 `9b50d483`. 스펙 §7 B1 완료 조건과 계획의 완료 조건 표를 실제 소비처·관문·테스트·리허설 기록에 대조했다. **차단 사항 없음**. 최종 리뷰는 단일 작업자가 수행했으며 독립 리뷰어 검증은 포함하지 않는다.
- 보안/DB: 새 회의록 RPC는 service_role 실행권만, 액션은 프로젝트 멤버·모듈 관문 뒤 원문 검증을 거쳐 가드의 actor ID를 전달한다. 영역 RPC의 행위자 재판정·설정 행 SHARE 잠금·영역 KEY SHARE 잠금·채번 카운터 직렬화·코드 불변 트리거를 확인했다. 롤백 가능 조건과 되돌릴 수 없는 데이터 이관은 사용자 DB 절차서에 명시되어 있다.
- 소비처: 일반 등록과 분석 필드 쓰기의 모듈 관문 분리, 분석 모듈 OFF일 때 기존 메타를 보존하는 수정 계약, 코드/영역을 사용하는 목록·회의록·분석서·색인, 영역별 채번/정책 렌더 골든 표의 TS·SQL 대응을 확인했다.
- 제한: 전체 테스트의 알려진 firmlink 실패 1건, 외부 LLM 봇 호출 미실행, 성능 측정은 사용자 지시대로 SP5 전체 구현 뒤 일괄 실행. `.github/workflows/ci.yml`은 `sp5/**` push를 대상으로 하지 않아 B1 원격 CI 실행은 없다(로컬 CI 등가 결과를 사용).
- GitHub `origin/sp5/b1`에 체크포인트 커밋을 푸시했고 작업 트리는 깨끗하다. 태그는 로컬 유지. main 반영과 사용자 DB 적용은 별도 단계다.
