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
