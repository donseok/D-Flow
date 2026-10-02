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
