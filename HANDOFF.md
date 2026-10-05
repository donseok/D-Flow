# HANDOFF — D-Flow (Claude → Codex 인계)

> **최종 갱신 2026-10-03 ~12:15 KST — Claude 쪽 작업·에이전트 전부 정지 상태.** 사용자 지시("진행 중인 명령이 끝나면 두 작업의 보고서를 최신으로 갱신하고 모두 멈춰줘. 이후 Codex가 이어받는다")로 두 레인 모두 현재 Step 에서 멈췄고, 아래 미커밋 변경은 **커밋·되돌림·삭제 없이 그대로 보존**돼 있다.
> **이 파일은 인계용 미추적 파일이다 — 커밋하지 마라.** 사용자 응답은 **항상 한국어**. 사용자는 **토큰 사용에 민감**하다(성능 측정은 "전체 구현 뒤 일괄").
> 이어받기 전 **이 파일 → `/Users/jerry/D-Flow/CLAUDE.md` → 각 레인 보고서의 "인계" 절** 순으로 읽어라.

## 0. 한눈에 — 지금 어디서 멈췄나

| 레인 | 워크트리 / 브랜치 | HEAD | 멈춘 지점 | 보고서(정본) |
|---|---|---|---|---|
| **A — SP6(양식 병합 엔진)** | `/Users/jerry/D-Flow-wt/lane-a-sp4` · `sp6/form-engine` | `b0fbff55` | **SP6 전체 구현·검증 마감**, forms.* verified 승격, 부정 테스트 6, 합성 S8 활성화, 단위/RLS/build 통과, 원격 푸시 완료 | `docs/superpowers/plans/2026-10-05-sp6-form-engine.md`, HANDOFF §21 |
| **B — SP3b UI-3(화면)** | `/Users/jerry/D-Flow-wt/lane-b` · `ui/sp3-screens`(로컬 전용·미푸시) | `b2bc2b6e` | 묶음 U3-4 과제 10(홈 v1) **구현·단위 테스트 초록, 눈확인(Step 5) 도중**, 숨김 경합 버그 1건 미수정, 커밋 미작성. 미커밋 20경로 | `.superpowers/sp3b/sdd-ui3/u3-4-report.md` ("인계(Codex)" 절) |
| 메인 체크아웃 | `/Users/jerry/D-Flow` · `main` = origin/main `9b50d483`(CI 초록) | — | 미추적 `HANDOFF.md` 외 깨끗 | — |

환경 상태(정지 시점): `.heavy.lock` 없음, 3101~3103·3201~3203 포트에 떠 있는 서버 없음, 띄워 둔 next/playwright 프로세스 없음. colima 는 켜져 있고 supabase 컨테이너 12개가 떠 있다(레인 A `d-flow-sp4`·레인 B `d-flow-lane-b`; **메인 스택 `d-flow` 54321/54322 는 DB 만 clean stop 한 상태 — 사용자 실데이터, 건드리지 마라**). 레인 A DB 는 0020 이 적용된 빈 상태(부트스트랩 없음) — 다음 실행 전 `db:reset` + `dev:bootstrap` 필요. 세션 재시작이 있었다면 `colima status` → 꺼졌으면 `colima start`.

## 1. 전체 목표와 완료 기준

- **D-Flow** = 범용 프로젝트 관리 플랫폼(가칭, wbs-web 포크). Next.js 15 App Router + Tailwind v4 + Supabase(로컬 Docker/colima). 규칙 정본 `/Users/jerry/D-Flow/CLAUDE.md`.
- 설계 정본 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` + 개정 `2026-09-27-platform-revision-configurability-design.md`. SP 별 스펙·계획은 `docs/superpowers/{specs,plans}/`.
- **단계 완료 기준(SP/Phase 공통)**: 스펙 §7 완료 조건 → 공통 묶음(`db:reset`→`dev:bootstrap`→`settings:verify`→`test:rls` 건너뜀 0→`test`·`lint`·`typecheck`·`build`) + 로컬 E2E(`next start`) + 합성 게이트 + 눈확인(헤드리스 라이트·다크) → 최종 리뷰 초록 → 로컬 태그 → **사용자 확인 뒤** main ff·push → GitHub CI 초록.
- 로드맵: SP0~SP2(기반)·SP3a(설정 엔진)·SP3b(셸/IA: UI-0·1·2·**3**)·SP4(주간·팀)·SP5(달력 A, 이슈 B1, 회의록 첨부 B3, 어휘 B4, 회의록 팀·마감 B2)·SP6~SP9.

## 2. 완료한 작업 (main = origin/main `9b50d483`, CI 초록)

| 단계 | 상태 | 태그 / 커밋 |
|---|---|---|
| SP0~SP3a | 완료 | `sp3a-done`(81deae9) 등 |
| SP3b UI-0·UI-1 | main 반영 | — |
| SP3b UI-2(UI-2a 경로·IA + UI-2b 범위 레이아웃 셸·전환기·드로어·우측 레일) | main 반영(10/02) | `sp3b-ui2a-done`(354fad00)·`sp3b-ui2b-done`(f5435c75) |
| SP4 A1·A2·B(주간 영역·가져오기 멱등·팀 원천·Excel 표준·팀 색 슬롯·영수증·주간 채움형) | main 반영 | `sp4-a1-done`·`sp4-a2-done`·`sp4-done`(07d8bd1a) |
| SP5 A(달력: 주 시작 일요일·시간대·근무일·날짜 예외) | main 반영(10/03) | `sp5-a-done`(9b50d483) |
| **사용자 DB(메인 스택 54322) 0012→0019 적용** | 완료(10/03, 사용자 확인) | 백업 `/Users/jerry/D-Flow-backup/20261003-0919/`(full.dump·data.sql) |

- 마이그레이션 `supabase/migrations/0013_weekly_areas … 0019_calendar`(0018 = account_preferences). **번호는 접미로 참조**한다(테스트·리허설이 접미로 찾는다).
- 단계별 변경 목록 `docs/baseline/*.md` + git log.

## 3. 진행 중인 작업 — 상세 (둘 다 로컬 전용·미푸시)

### 3-A. 레인 A — SP5 B1 (`sp5/b1`, 계획 `docs/superpowers/plans/2026-10-03-sp5-phase-b1.md` 18과제·5묶음)
되돌릴 수 없는 이관(이슈 코드 부여·전역 Mega 영역→프로젝트별 영역·설정 값 기록)이 있는 단계. 새 마이그레이션 = **0020 `_issue_areas`**.

**커밋된 것(HEAD `46f1bdd2`, 계획 `9a969e7d` 위)**
- `0a4d4ea3` 과제 2: `src/lib/issues/{idPolicy,errors}.ts`·골든 표·`tests/issues/id-policy.test.ts`.
- `ae733812` 과제 3: `issue_analysis` 선택 모듈·`issues.id_policy`/`issues.analysis` 설정 정의·카탈로그·사전·테스트 리터럴 갱신.
- `76b47c46`·`46f1bdd2` B1-1 리뷰 수정(P1-1 `stripTokens` **단일 패스**, P1-2 프로젝트 설정 `MODULE_LABEL`, 골든 확장, `$&` 안전 렌더, 옛 목록 호환 테스트 `tests/fixtures/pre-b1-modules.ts`). 리뷰 `.superpowers/sp5/b1-review-1.md`, 수정 보고 `b1-fix-1-report.md`.
- **계획 문서의 코드 블록(idPolicy 392·426행, SQL 1113행 중첩 `replace`)은 낡았다 — 단일 패스가 정본.**

**미커밋 11경로(전부 보존 — B1-2 구현물)**: `supabase/migrations/0020_issue_areas.sql`(S1~S11)·`supabase/rollbacks/0020_issue_areas_rollback.sql`(927줄)·`supabase/rehearsal/0020_issue_areas_{seed,smoke,rollback_guard}.sql`·`tests/rls/{issue-areas,issue-code-policy}.test.ts`(새)·`tests/rls/issue-code-width.test.ts`(다시 씀)·`tests/rls/{fixture-ws.sql,isolation-map.ts,schema-invariants.test.ts}`(수정). 상태: 전부 완성. 검증됨 — `db:reset`(max 0020)·이슈 RLS 세 파일 99 통과·리허설 R(카탈로그 불일치 0, 적용·재적용 양방향)·데이터 왕복(영역 3·분류 4·레거시 2·ISS 3 → 롤백 → 재적용 → 가드 `ISSUE_AREAS_ROLLBACK_BLOCKED`)·스모크 20항목 두 번. **미검증 = 이 마이그레이션 위 전체 `test:rls`·CI 등가·`settings:verify`·전체 vitest(Step 8)**. 과제 5 끝에 전체 `test:rls` 538 통과·건너뜀 0 이었다.

**바로 이어서(보고서 "미착수" 절에 명령 전문, 아래 8-A 에도 복사)**: Step 8 → Step 9 커밋 ②(마이그레이션 두 파일만 + `Staging-verified: local db reset <Step 8 뒤의 실제 date '+%Y-%m-%d %H:%M'> — …` 트레일러, G1·G4) → Step 10 커밋 ③(테스트·리허설 파일, 파일명 명시 add). Step 8 에서 마이그레이션을 고치면 Step 6·7 도 다시.
**결정·주의**: `issue_code_year` 는 0019 시간대 규칙과 같게(`lower()`·`btrim()` 금지, '/' 없는 이름은 닫힌 목록 UTC/GMT/EST5EDT/CST6CDT/MST7MDT/PST8PDT, `EST`·`GMT0` 거부); `code` 길이 CHECK 금지(자리 올림 때 발번 실패); SQL 의 `CONFIG_INVALID:<키>` 는 `issues.id_policy`·`calendar.timezone` 둘로 한정(`issues.analysis` 손상은 필수로 닫음); 롤백은 storage 정책 "issue-attachments insert" 를 떼었다 다시 붙임(계획에 없던 보정).
**다음 묶음 B1-3(과제 7~9 소비처)이 받는 것**(보고서 "B1-3 에 넘기는 것"): `defs/project.ts:131` `calendar.timezone` `sql: null`→`{ readers: ['assign_issue_code'] }`+핀 `tests/settings/calendar-keys.test.ts:46`; 새 RPC 시그니처 `create_issue_from_minute_block(…, p_area_id, …) returns table(issue_id, code)`(`p_actor_id` 는 가드 결과만, `_rpc-tables.ts` 는 고치지 않음 X4, `MODULE_TABLE_OWNER` 에서 `issue_mega_areas` 삭제); 오류 토큰→문구 표(+23505 `issues_project_code_uidx`→`ERR_ISSUE_RETRY`); issues→project_areas FK 는 `issues_area_fk` 하나(임베드 모호성 없음); **`ModuleToggleEditor` UX** — 이관이 `issues` 꺼진 프로젝트에도 `issue_analysis` 를 넣어 다른 토글 저장이 `checkEnabledModules` requires 오류로 거부될 수 있음(검사 대상을 새로 추가된 id 로 좁히거나 편집기가 닫힘으로 거르게); 과제 8 `context.ts` 첫 줄 `import 'server-only'`. 컨트롤러가 스펙 §9 에 적을 한 줄(B4 입력): "B4 `_vocab_settings` 는 `settings_ref_check` 의 `calendar.week_start`·`calendar.timezone`·`issues.id_policy` 세 분기 위에 더하고, 그 사후검사가 `'issues.id_policy'` 문자열도 본다(B1 사후검사 ⑤ 와 같은 토큰)". B1-2 구현 뒤 **적대적 리뷰(opus)** 를 붙인다(권한 DEFINER RPC·트리거·되돌릴 수 없는 이관).
- 이후: B1-3 → B1-4(화면 과제 10~12) → B1-5(마감 13~18: 가드·합성·E2E·`runbook-user-db-apply.md` 갱신(`npx supabase`→PATH 2.75)·체크포인트 `sp5-b1-done`). 사용자 DB 에 B1 을 올리는 것은 main 머지 + **사용자 별도 확인** 뒤(덤프→전용 스택 리허설→재확인→`supabase migration up --local`). 그 뒤 SP5 B3 → B4 → B2(계획 미작성).

### 3-B. 레인 B — SP3b UI-3 (`ui/sp3-screens`, 계획 `docs/superpowers/plans/2026-10-01-sp3b-ui3.md` 18과제·7묶음)
**컨트롤러 판정 `/Users/jerry/D-Flow/.superpowers/sp3b/sdd-ui3/u3-rulings.md`(R1~R10)가 계획과 충돌하면 우선** — R1 Seoul 상수 금지(`viewTimezone(scope.ws.id)`·`projectTodays`/`workspaceToday`/`opts.now`), R2 설정 키 수 21/22, R3 저장 바 대상, R4 RightRail(스펙 §8.5), R5 칸반 흡수·SP4 `teams-color-render` 주소 변경, R6 SP4 겹침 보존, R7 체크포인트(`git merge main` 대체 가능), **R8 U3-6 앞에서 도구 수정 4건**, R9 ①③ 처리됨(`dc77ba50`)·② U3-6, **R10 U3-3 리뷰 처리 판정**(P2-5 칸반 꺼짐 사유 3갈래·`views.default` 순수 모듈 분리 → U3-6, 저장 바 높이 관찰 등록 방식 등 → U3-7).

**커밋된 것(HEAD `b2bc2b6e`)**: U3-1 `ac75537d`(도구)·U3-2 `5c7a214d`·`f6c1898c`(`portal.widgets`·`views.default` 정의)·U3-3 `d2418c9b`·`2cceaef8`·`0d06cd1f`·`6d177597`(상태 알림·설정 화면 패턴·저장 바·두 편집기; 리뷰 P0 0·P1 0·P2 11, `u3-3-review.md`)·U3-4 `dc77ba50`(R9 ① `visibleWidgets` reviewer `boolean|null`)·`0c9fcb1e`(R10 ①② 저장 알림 통일·상태 알림 링크 밑줄)·`ab196e5f`(과제 8: 개인 설정 `portalHiddenWidgets`·`projectsView` — `src/lib/portal/prefs.ts` 순수 모듈)·`b2bc2b6e`(과제 9: 포털 로더 v1).

**미커밋 20경로(과제 10 홈 v1 — 전부 보존)**: 수정 7 — `docs/settings-catalog.md`·`src/app/(app)/w/[slug]/{page,my-work/page}.tsx`·`src/components/portal/MyWorkList.tsx`·`src/lib/settings/catalog-meta.ts`·`tests/settings/{catalog-sync,registry}.test.ts`; 삭제 staged 2 — `src/components/portal/HomeSections.tsx`·`tests/portal/home-v0.test.tsx`; 새 파일 — `src/components/portal/{PortalSummary,PortalWidgets,ProjectStatusChip,ShowHiddenWidgets,WidgetError,WidgetFrame,WidgetHideButton}.tsx`·`tests/portal/{_render.ts,my-work-page.test.tsx,partial-failure.test.tsx}`. 상태: 구현·단위 완성(vitest 266 files·2873 tests 통과, typecheck 0, lint 오류 0). **눈확인 미완**(캡처 24장을 아직 열어 보지 않았다). 레인 B DB 의 눈확인용 임시 변경은 모두 원상복구됨(설정 이력 행만 남음 — 무해).
**미해결 버그 1건**: 멤버가 위젯 '숨기기' 직후 '다시 보기'를 누르면 DB 는 바뀌는데 화면이 숨긴 상태로 남는다(4번 중 2번); 빠르게 연달아 숨기면 앞 숨김이 덮일 수 있다 — 낡은 prop 으로 목록을 만드는 즉시 저장 경합. `WidgetHideButton`·`ShowHiddenWidgets` 를 **클라이언트 공유 상태**(최신 목록을 한 곳에서 받아 직렬화 저장)로 고치고 jsdom 테스트(두 번 연달아 숨기기 → 두 번째 요청 본문에 둘 다, 실패 시 role=alert).
**바로 이어서(보고서 "인계(Codex)" 절에 명령 전문)**: ① 숨김 경합 수정 + 테스트(`LANE_B_TASK=t10 /Users/jerry/D-Flow-wt/lane-b-run.sh npx vitest run tests/portal`·typecheck·lint) → ② 눈확인 재실행(`TASK=t10 ROUTES=ws-home,ws-home-wsadmin,ws-my-work SIZES=1440x900,1280x720,768x1024,390x844 … bundle.sh` — 보고서 명령 그대로) 후 캡처를 **실제로 열어 확인**(홈에서 편집기로 '공지' 끔→홈에서 사라짐→되돌림 포함) → ③ 편집기에 '모듈이 꺼져 있으면 홈에 보이지 않습니다' 한 줄을 둘지 판단(R10 ⑤) → ④ 전체 vitest(잠금; 기준 879 files·11,582 tests·알려진 실패 1) 후 과제 10 커밋(트레일러 `Preview-checked: local <실제 date> — /w/<slug>(멤버·워크스페이스 관리자, 숨김·다시 보기·편집기로 공지 끔/켬)·/w/<slug>/my-work(…)`; 삭제 staged 2 포함 add 목록은 계획 Step 6 + my-work-page 테스트).
**다음 묶음**: U3-4 리뷰(sonnet, 로더의 숨김 프로젝트 누출·모듈 합집합·`recent_docs` R9 ③ 결론은 `u3-4-report.md` 참조) → 수정 1회 → U3-5(과제 11~13: 프로젝트 목록 v1·명단 실효 역할·SP3b 소유 화면; 보고서 "U3-5 보충 지시 제안" 5항 — ☆ 토글도 같은 즉시 저장 경합, `getProjectRows` v1 재사용, `projectsView` 는 `queueUiPref`, 포털 로더 요청 범위 cache, 눈확인 보조 도구 `tools/u34-shot.mjs`·`bundle.sh`) → U3-6(14·15; **R8 먼저**) → U3-7(16 체크포인트 + **사용자 눈확인 게이트 ⑪**, 17 main 직전 `git merge main`). UI 위험 파일(globals.css·레이아웃 셋·`src/components/app/*`)은 브랜치에서만·건드려야 하면 멈추고 보고.

## 4. 남은 작업 우선순위

1. **레인 A B1 완주**(§3-A) → **레인 B UI-3 완주**(§3-B). 두 레인은 병렬 가능(전용 스택·워크트리 분리). UI-3 과제 15·16 과 B1 화면(과제 10~12)이 같은 이슈·설정 화면을 만질 수 있어 main 머지 때 충돌 가능 — 먼저 끝난 쪽이 main 에 들어가고 다른 쪽은 `git merge main`.
2. **SP5 B3(회의록 첨부) → B4(어휘) → B2(회의록 팀·마감)**: 각 단계 = 계획 작성 → 묶음 구현·리뷰 → 체크포인트. 스펙 `docs/superpowers/specs/2026-10-02-sp5-calendar-issues-minutes-design.md`(§9.1 정오표). 사용자 DB 이관이 있으면 `docs/runbook-user-db-apply.md` 갱신 + 사용자 확인.
3. **성능 일괄 측정**(전체 구현 뒤 한 번에): SP3b R25 교대 재측정(경로별 p95 비율 ≤ 1.20; SP2 대비 누적 한도 재조정은 **사용자 판단 대기**)·SP4 B 과제 14·SP5 A 과제 31b·SP5 B1 D59(100 동시 채번 p95). 방법 n 100·ABBA 4라운드·부하 ≤ 6·측정 중 heavy-lock 독점. **사용자가 미루라고 했다 — 구현 중에는 하지 않는다.**
4. 이월: 각 스펙 §9 의 SPU1·SPU3·SP8·SP9 행, 레인 B 의 `match_minute_documents`·`match_wbs_documents` 시그니처 확장(SP5 B3 입력), 스택·워크트리 정리(§7).

## 5. 중요한 결정과 이유 · 사용자 요구사항

- **push 는 늘 사람 확인 뒤**(사용자에게 묻고 ff main → `git push origin main` + 태그 → CI 확인). `git push --force origin main` 금지, `git add -A` 금지(파일명 명시), 마이그레이션과 코드는 **다른 커밋**(G1), 마이그레이션 커밋은 `Staging-verified: local db reset <일시>` 트레일러(G4), UI 위험 파일은 브랜치 + 실제 눈확인 + `Preview-checked: local <실제 date 시각> — <화면>`, 반응형 안전망(globals.css 끝 unlayered 블록) 무수정. 커밋 메시지 한국어·"왜"·끝에 Co-Authored-By(Codex 는 자신의 attribution 규칙을 따른다).
- **메인 스택(54321/54322, 사용자 실데이터)은 사용자 명시 확인 없이 읽기·쓰기·reset 금지.** 원본 wbs-web Supabase ref `rglfgrwwwwdqejohdnty`·`abtyahghvvkcriawffty` 접속 절대 금지(`scripts/lib/targets.mjs` — 우회 플래그 만들지 말 것).
- **전용 스택**: 레인 A `d-flow-sp4`(54521/54522, 앱 3101·3102, 래퍼 `/Users/jerry/D-Flow-wt/lane-a-run.sh` — DSN 고정 가드), 레인 B `d-flow-lane-b`(54421/54422, 앱 3201~3203, 래퍼 `lane-b-run.sh`, `LANE_B_TASK=<이름>`). 무거운 실행(전체 vitest·build·E2E·측정)은 `/Users/jerry/D-Flow-wt/heavy-lock.sh "<label>" -- <cmd>`. **CLI 는 PATH 의 `supabase` 2.75 또는 `npm run db:reset`**(`npx supabase` 는 2.119 를 받아 `db reset` 이 realtime.messages 소유자 오류). invariants 테스트를 typecheck 와 병렬로 돌리지 말 것(5초 시간 초과).
- **비공개 프로젝트 = 화면 숨김**(RLS 잠금 재제안 금지, 2026-08-10 결정) — 명단 행이 있어도 `access_role` null 이면 숨김(정본 `canSeeProject`). 판정자는 `HiddenProjectIds` 브랜드 하나.
- 긴 브랜치를 main 과 합칠 땐 **rebase 대신 `git merge main`**(충돌 한 번·해시 보존, SP5 A 선례; UI-3 과제 17 도 R7).
- 에러 3원칙(조회 실패를 없음으로 위장 금지·쓰기 전 선행 조회 실패 시 중단·보안 가드 fail-closed), 설정 쓰기는 RPC 한 길, `p_actor` 는 가드 결과만, 회의록·위키·AI 쓰기는 RLS 정책 없음 — 상세는 CLAUDE.md "권한".
- 클라이언트 컴포넌트는 `src/lib/settings/defs/*` 런타임을 import 하지 않는다(순수 모듈로 분리 — R10 ③). 즉시 동작(숨김·☆)에는 `SettingsSaveBar` 를 쓰지 않는다. 즉시 저장은 낡은 prop 으로 목록을 만들지 말고 최신 공유 상태를 직렬화해 저장(§3-B 버그의 교훈).
- 계획은 실행 없이 쓰였다 — **실패하는 단언·코드를 느슨하게 만들지 말고** 원인을 확정해 스펙·판정 의도에 맞게 고친다. 의도 자체가 틀렸으면 멈추고 보고.
- 서브에이전트 운용 관례(Claude 쪽): 구현·보안·스펙 = opus, UI·리뷰 = sonnet; 금지 명령(push·fetch·rebase·switch·checkout 브랜치·stash·reset·amend·tag·`git add -A`); 보고 파일을 먼저 만들고 Step 마다 이어 씀; 묶음 리뷰(정확성·보안, 적대적) → 수정 1회 → 범위 재리뷰 → 최종 리뷰 뒤 컨트롤러가 로컬 태그. 비밀번호·키는 출력·기록 금지(`openssl rand` → env → unset), 고객명·실명 금지.
- 성능 측정 보류(사용자 지시) · 사용자 기본값 결정: 주차 라벨 통일(#1)·주간보고 있는 프로젝트도 다음 주부터 일요일 전환(#2) · 스펙 사전 승인(초안 나오면 권고 기본값으로 진행·보고).

## 6. 테스트 결과와 남은 오류

- main CI(최신 run 37081429891, SP5 A push): **success**.
- 레인 A(HEAD `46f1bdd2`, B1-1 수정 라운드 끝): vitest 11586 중 11585 통과, typecheck 0, lint 오류 0(경고 4 기존). 미커밋 B1-2 위: 이슈 RLS 세 파일 99 통과, 과제 5 끝 전체 `test:rls` 538(건너뜀 0), 리허설 R·왕복 초록; Step 8 미실행.
- 레인 B(HEAD `b2bc2b6e` + 미커밋 과제 10): `tests/portal` 포함 266 files·2873 tests 통과(해당 범위), typecheck 0, lint 오류 0. 전체 vitest 기준선은 U3-3 끝 879 files·11,582 tests.
- **알려진 영구 실패 1건**: `tests/scripts/baseline-cli.test.ts`(워크트리 firmlink 경로 — 환경 의존, 무시).
- 미해결: ① 홈 위젯 숨김/다시 보기 경합 버그(§3-B) ② 성능 R25 판정 보류 ③ 간트 주 띠가 프로젝트 주 시작과 어긋남(기존) ④ `replaceMinuteBody` 가 DB 원문 반환(기존) ⑤ 에이전트 허브 킬스위치 손상 갈래 눈확인 못 함 ⑥ 일부 커밋 위생 결함(수정 불가 — `docs/baseline/sp5-e2e.md`·원장의 bisect 건너뛰기 목록) ⑦ `scripts/e2e-local.mjs:461`·`e2e-synthetic.mjs:139` "비core 13" 주석(UI-3 겹침 — 머지 뒤 14 로).

## 7. 작업 폴더 · 브랜치 · 문서

| 용도 | 경로 / 브랜치 |
|---|---|
| 메인 체크아웃(병합·push 전용, 직접 개발 금지) | `/Users/jerry/D-Flow` — `main` 9b50d483, 미추적 `HANDOFF.md` 외 깨끗 |
| 레인 A 워크트리 | `/Users/jerry/D-Flow-wt/lane-a-sp4` — `sp5/b1`(§3-A). 옛 `sp5/a` 는 main 과 같아 정리 가능 |
| 레인 B 워크트리 | `/Users/jerry/D-Flow-wt/lane-b` — `ui/sp3-screens`(§3-B). 옛 `ui/sp3-menu` 는 main 반영 완료(정리 가능) |
| 정리 대상(옛 스크래치) | `lane-b-base`·`lane-b-gg`·`sp3a-b-26`·`sp3a-b-27-h2`(detached), `/Users/jerry/orca/workspaces/D-Flow/sp3a-c-visual` |
| 원장(gitignore — 파일시스템으로만 접근, **끝부터 읽어라**) | `/Users/jerry/D-Flow/.superpowers/{sp3b,sp4,sp5}/progress.md` — **원장에는 이 세션의 B1-1 리뷰·수정·B1-2·U3-3 리뷰·U3-4 진행이 아직 기록되지 않았다(에이전트 보고서가 정본)** |
| 보고·리뷰·판정 | 레인 A: `.superpowers/sp5/{b1-report-t1-3,b1-review-1,b1-fix-1-report,b1-report-t4-6}.md`. 레인 B: `.superpowers/sp3b/sdd-ui3/{u3-rulings,u3-1-report,u3-1-review,u3-2-report,u3-2-review,u3-3-report,u3-3-review,u3-4-report}.md` + `tools/`(눈확인 보조 `u34-shot.mjs`·`bundle.sh`·`t10-extra.sh`) |
| 계획 | `docs/superpowers/plans/2026-10-01-sp3b-ui3.md`(UI-3)·`2026-10-03-sp5-phase-b1.md`(B1) |
| 절차서 | `docs/runbook-user-db-apply.md`(사용자 DB 적용 — `npx supabase` 는 2.75 로 정정 필요, B1 과제 17), `docs/runbook-staging.md`, `docs/runbook-rollback.md` |
| 메모리(Claude 쪽, 참고) | `/Users/jerry/.claude/projects/-Users-jerry-D-Flow/memory/`(`dflow-sp4-wip.md`·`dflow-user-db-applied.md`) — 정지 시점 상태는 이 파일이 최신 |

## 8. 다음 에이전트가 바로 시작할 구체적인 단계

1. `cd /Users/jerry/D-Flow && git status && git log --oneline -3`(main 9b50d483, 미추적 HANDOFF.md 만) → CLAUDE.md 정독 → 두 보고서의 인계 절 정독.
2. 환경: `colima status`(꺼졌으면 `colima start`) → `docker ps` 로 `d-flow-sp4`·`d-flow-lane-b` 스택 확인 → 낡은 `/Users/jerry/D-Flow-wt/.heavy.lock` 있으면(소유 PID 가 죽었을 때만) 제거. 앱 서버·스택은 위 래퍼로만.
3. **각 워크트리에서 `git status` 로 미커밋 목록이 §3 과 같은지 확인**(다르면 보고서를 신뢰하되 차이를 기록). 미커밋 변경을 `stash`·`reset`·`checkout --` 하지 마라.
4. **레인 A 재개**(8-A): `lane-a-sp4` 에서 Step 8 → 초록이면 커밋 ②(마이그레이션 두 파일만, 실제 시각 `Staging-verified`)·③ → B1-2 적대적 리뷰(opus) → 수정 1회 → B1-3 착수. Step 8 에서 실패가 나오면 단언을 느슨하게 하지 말고 원인을 확정.
5. **레인 B 재개**: `lane-b` 에서 숨김 경합 수정+테스트 → 눈확인 재실행·캡처 확인 → 전체 vitest → 과제 10 커밋 → U3-4 리뷰 → U3-5.
6. 단계가 끝날 때마다: 최종 리뷰 → 로컬 태그 → **사용자에게 push 확인 요청** → ff main → push → CI 확인 → 원장 기록. 사용자 DB 변경은 별도 확인. 성능 측정은 하지 않는다(일괄 대기).

### 8-A. 레인 A Step 8 명령(보고서 `b1-report-t4-6.md` "미착수" 절과 동일)
```bash
WT=/Users/jerry/D-Flow-wt/lane-a-sp4; R=/Users/jerry/D-Flow-wt/lane-a-run.sh; H=/Users/jerry/D-Flow-wt/heavy-lock.sh
cd "$WT"
"$H" "sp5b1:t6" -- "$R" npm run db:reset
"$H" "sp5b1:t6" -- "$R" bash -c 'BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$(openssl rand -base64 24)" npm run dev:bootstrap'
"$H" "sp5b1:t6" -- "$R" npm run settings:verify
"$H" "sp5b1:t6" -- "$R" npm run test:rls 2>&1 | tail -6          # 건너뜀 0, 숫자 기록(예상 ≈545)
"$H" "sp5b1:t6" -- "$R" bash -c 'supabase db reset --version 0001 || true; supabase migration up --local && npm run test:rls 2>&1 | tail -4'   # CI 등가
"$H" "sp5b1:t6" -- "$R" npm run db:reset                           # 이어서 dev:bootstrap 다시
"$R" npm run typecheck && "$R" npm run lint 2>&1 | tail -3
"$H" "sp5b1:t6" -- "$R" npx vitest run --maxWorkers=4 --reporter=dot 2>&1 | tail -4   # 알려진 실패 1건 외 0
```


## 9. Codex 재개 최신 상태 — 2026-10-03 12:28 KST ~ 2026-10-04 09:11 KST

이 절이 위의 진행 중 상태보다 최신이다. HANDOFF.md는 계속 미추적이며 커밋하지 않는다.

- **레인 B (UI-3)**: U3-4 완료 `823215dd`, origin/ui/sp3-screens 푸시 완료. 트리 깨끗, 다음 U3-5 이어받기 대기.
- **레인 A (B1)**: B1-3 완료 `19da4c80`, origin/sp5/b1 푸시 완료. 전체 879 파일 11,622 통과, lint/typecheck/build 초록.
- **레인 A (B3)**: 이제 sp5/b3 브랜치에서 회의록 첨부(B3) 작업 진행 중. 최신 커밋 `e7d2f911` (첨부 정책·권한·왕복 검증 완료).
- 두 스택 실행 중, main은 9b50d483 유지.

## 10. 완료 작업 커밋·푸시 — 2026-10-03 ~ 2026-10-04

사용자 지시: “작업 완료하면 커밋·푸시 자동 진행” + “Codex 마무리만 해줘” (Claude Haiku 인수, 2026-10-04 09:15).

- **UI-3 (Lane B)**: U3-4 완료 `823215dd` 푸시 완료. CI: https://github.com/donseok/D-Flow/actions/runs/37095643181
- **B1 (Lane A)**: B1-3 완료 `19da4c80` 푸시 완료. CI 미작동(sp5/** 필터 없음).
- **B3 (Lane A)**: 진행 중. 기본 개발·검증 완료, 다음 단계 정의 필요.
- main 병합·푸시는 하지 않았다.

## 11. B1-3 단계 완료 요약 — Codex

B1-3 과제 7~9 완료(2026-10-04 07:00 경):
- **과제 7**: 도메인 Issue/code/areaId 구조 변환, 영역 주입·집계 완성. 도메인 71/데이터 12 테스트 통과.
- **과제 8**: context server-only, 등록·수정 조건부 분석 관문(영역/분석 필수, 코드영역 불변). RPC 새 응답 구조. 규칙 29/액션 77/묶음 103 통과.
- **과제 9**: AI 초안 활성영역/분석모드 주입, 캐시 v5 격리, 색인 code 제목/본문 포함. 전체 호환성 검증.

최소 화면형 교체 및 등록폼 중첩분석 API 연결 포함. 실제 화면 변화 확인 후 커밋(전용 A 앱 캡처 12장 light/dark 눈확인). 
전체: 879 파일 878 통과, 11,622 테스트 통과, typecheck/lint/build/smoke 초록. 
**결론**: B1-3 완료 → B1-4(화면 과제 10~12) 다음 단계 준비.

## 12. B3(회의록 첨부) 단계 진행 상태 — 2026-10-04 09:11 KST

현재 Lane A (sp5/b3 브랜치):
- **기본 개발 완료**: 첨부 정책 DB 구조, 삭제 상태 불변식, 권한·왕복 검증 완료.
- **최신 커밋**: `e7d2f911` (첨부 정책·권한·왕복 검증)
- **검증 로그**: `/Users/jerry/D-Flow/.superpowers/sp5/codex-b3/` 디렉토리에 DB 검증 로그 완전 보존
  - db-reset·bootstrap 통과
  - RLS/설정/테스트 통과 (`db-full-test.log`)
  - roundtrip/롤백 검증 완료
- **현재 상태**: 미커밋 변경 없음, 워킹 트리 깨끗. 다음 스펙 검토 + 화면 개발 대기.

## 13. 자동 연속 진행 중단 및 Cloud Claude 인수 — 2026-10-04 09:15 KST

Codex 토큰 소진. Claude Haiku 2.1.288 인수, HANDOFF.md 최신화 및 상태 정리만 수행.

## 14. B3 완료 — Claude Cloud 세션 (2026-10-04 09:28 ~ 11:10 KST)

- **B3 과제 5~14 전부 완료**, 브랜치 `sp5/b3` 체크포인트 `0e1e601`(로컬 태그 `sp5-b3-done`). 상세: `docs/superpowers/plans/2026-10-04-sp5-phase-b3.md` 진행표, `docs/baseline/sp5-effort.md` "B3 과제 5~14" 절.
  - 첨부 삭제 톰스톤·미리보기·정책 조회 액션, 상세 첨부 패널·새 회의록 모달 정책 확인, 산출물·이슈 클릭 발급(60초), 정책 편집기(워크스페이스·프로젝트), 청소 잡 `npm run minutes:sweep`, 의미검색 범위 `0022_semantic_scope`(+롤백), 카탈로그 `minutes.attachments` verified.
- **검증**: 로컬 db reset(10:48:41 KST) → bootstrap → settings:verify → test:rls 39 files·609/skip0, 단위 891 files·11,806 통과, typecheck·lint·build 초록, 실앱 Playwright 18/18(1440/390 light/dark), 청소 잡 실DB dry-run/--apply/재실행0.
- **클라우드 컨테이너 주의**: 커널에 IPv6 가 없어 realtime v2.73.2 가 뜨지 않는다 — HTTP 리스너만 `[:inet]` 으로 바꾼 로컬 이미지를 만들어 썼다(리포 변경 없음). 이미지 다운로드가 프록시에서 간헐 403 이라 재시도가 필요하다. `supabase` 는 `npx -y supabase@2.75.0` 으로 부른다.
- **main 반영**: B1(`0e9e403`)·B3 를 main 에 병합(아래 커밋). 사용자 DB 적용·성능 측정은 하지 않았다(별도 확인).
- **이월**: v2.9 계약 절의 첨부 운영 상한 한 줄(B2 산출물), 다음은 계획상 B2(회의록 팀·폴더) 또는 B4(어휘 설정).

## 15. B4 완료 — Claude Cloud 세션 (2026-10-04 11:20 ~ 12:40 KST)

- **B4(어휘 설정값 승격) 묶음 1~6 완료**, 브랜치 `sp5/b4`(태그 `sp5-b4-done`). 상세: `docs/superpowers/plans/2026-10-04-sp5-phase-b4.md`, `docs/baseline/sp5-effort.md` "B4" 절.
  - 마이그레이션 `0023_vocab_settings`(+롤백·리허설). 근태 유형·회의 범주·이슈 심각도·출처·원인 분류가 프로젝트 설정 키이고 DB check 대신 트리거가 판정한다. 프로젝트 설정 '용어·분류' 편집기, 참조 있는 code 는 '기록 옮기기'(`migrateVocabCode`) 뒤 삭제.
- **검증**: db reset 12:07:24 KST·test:rls 40/627, 단위 896 files·11,855, build, 합성 게이트 19단계(S1-vocab), 실앱 Playwright 12/12.
- **사용자 DB 적용은 하지 않았다** — `0023_vocab_settings` 는 main 반영 뒤 §8 #13 대로 따로 확인을 받아 적용한다.
- **다음**: 계획상 B2(회의록 팀·폴더 — v2.9 계약 절의 첨부 운영 상한 한 줄 포함).

## 16. B2 완료 · SP5 마감 — Claude Cloud 세션 (2026-10-04 12:40 ~ 15:10 KST)

- **B2(회의록 팀·폴더) 묶음 1~5 완료**, 브랜치 `sp5/b2`, 로컬 태그 `sp5-done`. 상세: `docs/superpowers/plans/2026-10-04-sp5-phase-b2.md`, `docs/baseline/sp5-effort.md` "B2" 절.
  - 마이그레이션 `0024_minutes_teams`(+롤백·리허설). 회의록 폴더·회의록이 팀 이름 대신 팀 id 로 이어진다 — 팀 개명에 폴더 이름이 따라가고, 비활성 팀 루트 아래 새 폴더·새 회의록은 거부된다. 공용 팀 생성은 `create_team` RPC 한 길.
  - 워크스페이스 설정 `minutes.root_folders`(teams/custom), 회의록 `?team=<팀 id>` 필터(옛 code 링크는 리다이렉트), 외부 회의록 API 계약 v2.9.
  - 이월 넷(탐색기 이동 판정 서버 계산·팀 막대 공용화·프로젝트 점 토큰·회의 화면 조용한 실패 제거).
- **SP5 마감**: A·B1·B3·B4·B2 전부 main. 일괄 성능 `docs/baseline/sp5-perf.md`(8칸 모두 ≤ 1.20). 개정 스펙 §6.3 에 0018~0024 실측과 다음 SP 시작 번호 0025, §8.1 닫음 표기.
- **사용자 DB 적용은 하지 않았다** — 0019~0024 는 `docs/runbook-user-db-apply.md` 대로 §8 #13 확인 뒤 적용한다(0024 는 사전 검사 SQL 먼저).
- **다음**: 개정 스펙의 SP5b(또는 사용자가 정하는 다음 SP). 관찰: 390 회의록 머리의 보기 전환 줄이 안쪽 가로 스크롤이라 첫 버튼이 살짝 잘려 보인다(기존 배치).

## 17. SP5b 완료(업무 흐름 설정화) — Claude Cloud 세션 (2026-10-04 15:01 ~ 19:50 KST)

- **Phase P0 → I → W1 → W2 → Z 전부 main**(브랜치 `sp5b/{w1,w2,z}`, 태그 `sp5b-done`). 스펙 `docs/superpowers/specs/2026-10-04-sp5b-workflow-design.md`(판정 S1~S26 반영),
  계획·진행 `docs/superpowers/plans/2026-10-04-sp5b-phase-{i,w1,w2,z}.md`, 원장 `docs/baseline/sp5b-{e2e,ui,perf,effort}.md`·`synthetic-acceptance.md` SP5b 절.
  - I(`0025_issue_status_vocab`): 이슈 상태 = 범주(제품 고정 4) + 프로젝트 표시 상태(`workflow.issue_statuses`), DB 트리거가 전이·해결일·상태 이력을 정한다.
  - W1(`0026_workflow_policy`): 승인 단계 1~3·서로 다른 승인자·선행 기준(`reached`|`final`)·크레딧 정책, 승인 원장 `wbs_stage_approvals`, JWT 의 흐름 다섯 열 쓰기 42501.
  - W2: 선행 기준을 claim 게이트·후속 알림·대기 사유·상세 패널 다섯 곳에 같은 입력으로, 결재 배지·포털·허브의 승인 가능 셈, 설정 '상태·승인' 편집기, 단계 이름 주입.
  - Z: 합성 S1/S3/S6/S9-workflow, 성능 A/B, 카탈로그 workflow 6키 verified, `api-contract.md` SP5b 주석, CLAUDE.md 권한 절, 개정 스펙 §3.0a·§6.2·§6.3 반영.
- **열린 것(사용자 확인)**: done_when #8 의 RPC 몫 — `apply_workflow_event` 판정 사건(approve·set_stage:xx) p95 가 기준선 대비 1.31~1.34, 합계 1.22(+0.3~0.45ms 절대).
  화면 경로는 통과. 설정 행 잠금·새 트리거는 원인이 아님을 실험으로 확인(`sp5b-perf.md`). 기본값 = 기능 비용으로 수용.
- **사용자 DB 적용은 하지 않았다** — 0019~0026 은 `docs/runbook-user-db-apply.md`(0025·0026 행·사전검사 추가) 대로 §8 #13 확인 뒤.
- **다음**: 개정 스펙 순서상 SP5c(사용자 정의 필드 — 합성 `S3` 의 필드 몫). 이월은 개정 §6.2 SPU1·SPU2·SPU3·SP8·SP9 블록의 "SP5b 에서 넘어옴" 줄.

## 18. SP5c 진행 — Codex (2026-10-04 21:30 KST)

최신 원격 main `8238de9f`에서 Claude의 SP5·SP5b 완료를 다시 확인한 뒤 이어받았다. 메인 체크아웃도 fast-forward하여 clean 상태이며, 이전 B3/B4/B2를 다시 구현하지 않는다. A 작업트리 `/Users/jerry/D-Flow-wt/lane-a-sp4`의 현재 브랜치는 **`sp5c/custom-fields`**, HEAD **`233f7e46`**, 같은 이름 원격에 푸시했다. main 통합은 하지 않았다.

완료/푸시: `fed474ce`(F 순수 7타입 계약), `61b5fafd`(D 0027+rollback), `f44b96af`(DB 검증/회귀), `6ec37531`(관리자 사용 건수·백필·purge 액션, CI 성공), `b86c1aa2`(필드 3키 레지스트리·관리 화면·공통 입력). 상세 진행/검증 정본은 `docs/superpowers/plans/2026-10-04-sp5c-custom-fields.md`, `docs/baseline/sp5c-e2e.md`. 카탈로그 fields는 stored이며 SP5c 전체 완료가 아니다.

전용 A DB reset 0027까지 성공, 전체 RLS 44파일 856/skip0. 관리자 액션 권한/불변식 503건, 설정/모듈/카탈로그 79건, UI 21건 통과. 전체 단위는 새 키 등록에 맞춘 기존 계약 2건을 수정해 관련 검사를 재통과했다. 타입·lint 오류 0(기존 경고 4)·build·settings:verify 문제 0. 실제 브라우저 1440/390에서 저장→재조회→기본값 0→백필/필수→3탭→정확한 건수 삭제 확인, pageerror/가로 넘침 없음. 임시 프로젝트/계정과 A 앱 3101 서버 정리했다.

다음: V(행 값 입력/목록·타입·로더) → X(Excel/주간 이월) → I(AI 본문·정의 변경 재색인) → Z(합성 S3·최종 일괄 성능/카탈로그). 값 쓰기는 JWT/RLS와 JSONB CAS로 기존 관리자 필드·동시 변경을 보호해야 하며, service_role 쓰기로 우회하지 않는다. fields 재색인 부수효과는 아직 구현하지 않았고 계획 S는 이 때문에 전체 체크하지 않았다. 봇 근거 확장은 SP8 뒤 이월.

사용자 DB(54321/54322), B 레인, 원본/원격 DB는 건드리지 않았다. 기존 UI3 사람 확인·사용자 DB 0019~0026 적용·SP5b 성능 수용은 여전히 미결이다. `b86c1aa2` 푸시 후 CI 확인 필요. 자동 커밋·푸시는 사용자의 기존 명시 승인에 따라 진행했다.

### 18 추가 진행 (2026-10-04)

`b093b5ce` 값 저장 기반, `233f7e46` WBS 상세 입력을 추가 커밋·푸시했다. 전체 단위 921파일 12,277건 통과, build/타입/lint 통과. 실제 전용 DB/빌드 앱에서 JWT 저장과 동시 변경 CAS(최신 4를 오래된 3으로 덮어쓰지 않음), 초안 유지/취소 후 최신 값 채택, 1440/390 화면을 확인했다. 임시 데이터와 앱 3101 정리. 이슈 상세 입력/로더 연결은 현재 작업 중이며 아직 커밋 전이다. 이후 이슈 등록/수정 폼·목록/필터, WBS 시트 열·키보드/실시간, 주간 열·이월, Excel/AI/합성 등이 남았다. SP5c 전체 미완료, fields 카탈로그 stored 유지. 이후 브랜치 CI는 완료 여부 재확인 필요(마지막 확인 b86c1aa2 실행 중, b093b5ce 대기 중).

### 18 추가 진행 (2026-10-05 03:53 KST)

A 브랜치 `sp5c/custom-fields` HEAD/원격 `cc448b9e`. 추가 푸시: `4688963b` 이슈 상세/모달 hydration, `abb892a1` DB 0028(custom 방송/이슈 시각), `44561f6e` 테스트 픽스처 타입, `1553e739` DB 0029(WBS custom 변경 시각), `cc448b9e` 방송 파서/마이크로초 비교/롤백 검사·증거. WBS 실시간 채널 가입 후 custom-only 수정의 시각이 그대로라 변경을 버리는 문제를 실제 재현했고 0029로 보완했다.

전용 A reset 0029까지 성공, RLS 45파일 864/skip0, 전체 타입 검사/관련 회귀 40건 통과. 기존 전체 단위 12,288건/lint/build 통과. 실제 브라우저 private websocket 가입→초안 6 유지/서버 7에 저장 차단→취소 후 7→서버 9 자동 반영, 기존 CAS·이슈 JWT false/true/직접 링크/설정 백필·purge 회귀를 검증했다. 1440/390 눈확인/pageerror·가로 넘침0, 임시 프로젝트/계정 정리. 최신 CI 확인 필요: 44561 CI는 타입 통과 후 역사적 롤백 의존성에서 실패했으며 cc448에서 0029→0028→0027 순서로 보완했다.

현재 이슈 목록 show_in_list 열·타입별 필터 연결 작업 중(미커밋), 관련 단위/타입/lint 통과 후 프로덕션 빌드·실제 화면 검사 진행. 아직 V의 등록/수정 폼·WBS 시트 열/키보드·주간 값 입력 및 X/I/Z가 남았다. SP5c 전체 미완료, 카탈로그 stored. main/사용자 DB 통합·UI3·SP5b 성능 수용 게이트 유지.

### 18 이슈 목록 완료 (2026-10-05 03:57 KST)

A HEAD/원격 `8e4448ef` 커밋·푸시 완료, A 작업 트리 clean. 이슈 사용자 필드 show_in_list 열과 활성 필드별 타입 필터를 연결했다. 텍스트 포함/타입별 동일 값/다중 선택 모두 포함, false·0 보존, 비활성 옵션 라벨/필터, 필터 변경 첫 페이지 이동, 손상 값/설정 가시성을 검증했다. 관련 단위 10건 및 공통 설정/상세 회귀 44건·전체 타입·lint·build 통과. 실제 브라우저 1440/390에서 열·false/true 조건·해제·모바일 표 내부 가로 스크롤 접근과 기존 WBS 실시간/CAS/이슈/관리 설정 회귀 통과, pageerror/문서 넘침0. 임시 데이터와 앱 3101 정리. 최신 CI 실행 결과 확인 필요. 이전 cc448 CI는 후속 푸시로 cancelled.

다음은 이슈 등록/수정 폼의 동일 JWT 쓰기에 custom 통합(UPDATE는 전체 JSONB CAS), WBS 시트 열/키보드, 주간 입력/이월, Excel 및 AI 재색인·합성. 사용자 DB 54321/54322 및 main 통합은 여전히 수행하지 않았다. 메인 HANDOFF.md 갱신만 dirty이며 A 커밋에 포함하지 않았다. SP5c 전체 미완료/fields 카탈로그 stored.

### 18 일반 이슈 폼 완료 (2026-10-05 04:19 KST)

A 브랜치 sp5c/custom-fields의 HEAD 38c8c731을 커밋·푸시했다. 일반 이슈 등록/수정 모달에 추가 정보를 연결하고 같은 JWT INSERT/UPDATE로 기본 정보와 custom을 함께 쓴다. 수정은 전체 old custom JSONB CAS, 0행이면 담당자 쓰기 이전에 conflict. 필수 INSERT 기본값/0·false/보호 필드 검증, 관리자·비활성 읽기 전용, 손상 설정 차단을 구현했다. 첨부 부분 실패 재시도는 생성/필드 쓰기를 반복하지 않는다.

실제 브라우저에서 custom이 pristine인 제목만 편집할 때 충돌 잠금이 자동 해제되는 문제를 발견해 고쳤다. 서버 제목과 custom이 함께 바뀐 conflict refresh에도 사용자 제목/custom 초안을 유지하며, 추가 정보 초안 취소로 최신 custom만 채택하고 재저장한다. 편집 대상이 조회에서 사라지면 신규 등록으로 바뀌지 않는다. 최종 전체 단위 924파일 12,308/12,308, 전체 타입/lint(기존 경고4)/build 통과. 실제 1440/390 화면·등록/동시 저장/CAS/명시 채택/재저장과 기존 WBS 실시간/이슈 목록/설정 백필·purge 회귀 통과, pageerror·가로 넘침0. 임시 데이터/앱3101 정리, A 작업 트리 clean 확인 필요. 직전 8e4448ef CI test/db 성공, 신규 CI 결과 후속 확인.

다음: 회의록 연결 신규 등록 RPC의 custom 입력 확장(현재 해당 onCreate 폼에는 필드 입력을 노출하지 않으며 서버는 custom 공급을 명시 거부해 조용히 버리지 않는다. DB 필수 기본값은 기존대로), WBS 시트 열/키보드, 주간 입력/이월, Excel, AI 재색인, 합성/최종 성능. SP5c 전체 미완료·카탈로그 stored. main/사용자 DB 미통합, 기존 승인 게이트 유지. 메인 HANDOFF.md만 별도 dirty이며 A 커밋에는 넣지 않았다.

### 18 회의록 연결 이슈 등록 완료 (2026-10-05 05:06 KST)

A 브랜치 `sp5c/custom-fields` HEAD/원격 `b30fa682`(마이그레이션 `bc5caad6` 0030 분리 커밋). 회의록 연결 신규 등록 RPC 가 `p_custom` 필수 오버로드로 코어·custom·담당자·원문 연결을 한 트랜잭션에 쓴다. 전용 reset 05:04, test:rls 46파일 869/869, 실브라우저 QA 통과. CI 결과는 후속 확인. 다음: WBS 시트 열/키보드, 주간 입력/이월, Excel, AI 재색인, 합성/최종 성능. SP5c 전체 미완료·카탈로그 stored·main/사용자 DB 미통합.

### 18 WBS 시트 사용자 정의 필드 열 완료 (2026-10-05 05:17 KST)

A 브랜치 `sp5c/custom-fields` HEAD/원격 `f5e9dcac`. WBS 간트 시트에 활성 show_in_list 필드를 폭 140px 열로 추가했다. useCustomFieldScope()로 필드 정의와 공통 서식을 조회하며, 0·false·빈 값(—) 보존 및 파싱 손상 값 경고(!)를 표시한다. 직전 b30fa682 CI 성공. 단위 925파일 12,314건 및 프로덕션 build, 실브라우저 QA(1440/390 가로 넘침 0) 통과. 다음: 주간 값 입력/이월, Excel, AI 재색인, 합성/최종 성능. SP5c 전체 미완료·카탈로그 stored·main/사용자 DB 미통합.

### 18 주간 시트 사용자 정의 필드 열·편집 모달 완료 (2026-10-05 05:52 KST)

A 브랜치 `sp5c/custom-fields` HEAD/원격 `460a49e1`. 주간 업무보고 시트에 `fields.weekly_row` 활성 `show_in_list` 필드를 140px 폭 열로 추가하고, 행 단위 추가 정보 편집 모달을 연결했다.
- WeeklyPage에서 `fields.weekly_row` 설정을 읽어 `<CustomFieldsProvider>`로 뷰를 감쌌다.
- WeeklySheetView에서 `useCustomFieldScope()`로 열 정의를 조회해 thead 및 colgroup(공백 텍스트 노드 없는 배열 형태)에 140px 열로 배치했다.
- 각 행 업무영역 칸에 "추가 정보" 버튼을 배치하고, 추가 열 또는 버튼 클릭 시 `CustomFieldValuesEditor`를 포함한 `<Modal>`을 열어 값 편집 및 CAS 저장을 지원했다.
- fromRecord 및 mapAreaRow, AREA_ROW_COLS에 custom 필드를 추가하고 직렬 쿼리 계약을 보존했다.
- 단위 테스트(3건), colgroup 불변식 테스트, 쿼리/이월 테스트 포함 주간 관련 10개 테스트 파일 225건 및 전체 빌드/타입/lint 통과.
- 실제 빌드 앱 3101 + 전용 A DB(54521/54522) 브라우저 QA(`.superpowers/sp5c/weekly-cols-browser.mjs`): 1440px 데스크톱 및 390px 모바일 화면에서 추가 열 표시, 0 및 불리언 서식 표시, show_in_list 비활성 열 미표시, 모달 오픈 및 편집 확인, 가로 넘침 없음 및 콘솔 오류 0 검증 완료. 로컬 증거 `.superpowers/sp5c/weekly-cols-browser-result.json`, `weekly-cols-desktop.png`, `weekly-cols-mobile.png`.
- 다음: X(주간 carryCustom 이월 및 WBS Excel 왕복), I(AI 색인), Z(합성/최종 성능 검증). SP5c 전체 미완료·카탈로그 stored·main/사용자 DB 미통합.



## 19. SP6 인계 재검증·가드 복구 (2026-10-05 09:07 KST)

A 작업트리 /Users/jerry/D-Flow-wt/lane-a-sp4는 이제 sp6/form-engine이다. 다른 LLM의 원격 ef27f273까지 fast-forward했고 SP5c 최종 a85cae77 CI 성공을 확인했다. SP6 CI 브랜치 필터 누락과 기준선 DB 12건 실패를 확인해 수정했다. 6bf4e5b4(0033 SQL/롤백 분리), 148a4696(검증·CI·인계 문서)을 커밋·푸시했으며 원격 HEAD 일치와 작업트리 clean(0 ahead/behind)을 확인했다. 신규 CI 37246235373은 실행 중이며 최종 결과는 후속 확인한다.

복구: form_templates의 의도하지 않은 authenticated 쓰기 권한 회수, 실제 actor 없는 참조 probe를 service 전용으로, 기존 SP5c 타입/범위 축소 검사를 보존한 양식 참조 가드, 엔티티/활성 상태 구분, 양식 전용 Storage 경로 검사(일반 첨부 파서 불변), 격리 픽스처/닫힌 목록/역사적 롤백 리허설. 카탈로그 project.level_labels는 공개 양식 계약의 닫힌 형태만 기존 열 사용 검사에서 제외하며 실제 열 읽기는 계속 막는다.

전용 d-flow-sp4(54521/54522), CLI 2.75.0 clean reset 08:55 + bootstrap, 전체 RLS 48파일 881/881, 전체 단위 946파일 12,489/12,489, typecheck/lint(오류0·기존 경고4)/production build 통과. local log .superpowers/sp6. main/사용자 DB는 변경하지 않았고 메인 HANDOFF.md의 기존 dirty 상태는 보존했다. forms 카탈로그는 stored, SP6 전체 미완료다.

다음 우선: 기본 중립 양식 assets/default 4종이 없어 기본 출력 경로가 실패할 수 있으므로 실제 파일/렌더 검증을 구현한다. createProject는 정본 4.6.3의 Storage.copy→copy_project_config 및 실패 보상이 없어 물리 파일 복사도 필요하다. 이후 양식 관리 화면/매핑·engineVersion 재스캔·고정 이슈분석 자산·Office 열림·S8/부정 테스트/카탈로그 마감. 전체 후속 물량은 A의 docs/baseline/sp6-handoff-review.md에 정리했다(SP7 외부연동, SP8 AI 범위, SPU1~3 UI, SP9 출시). 기존 UI3 사람 확인/통합, 사용자 DB 적용, SP5b 성능 수용 미결 사항 유지.

## 20. SP6 기본 양식 4종 (2026-10-05 09:23 KST)

A sp6/form-engine에서 f02992c4 커밋·원격 push 완료. 기본 weekly_report_pptx/xlsx·issue_analysis_pptx·wbs_export_xlsx 자산, OLE 없이 새 OPC 패키지를 만드는 scripts/forms/build-defaults.mjs, 다운로드 API 파일 추적, ExcelJS 공유 스타일의 날짜 서식 전파 수정. 전체 단위 947파일 12,509/12,509, 최종 자산/엔진/설정 검사 57/57, typecheck/build PASS, lint 0 errors/기존 warnings 4. 빌드 nft에 네 기본 파일 포함. 실제 병합 파일 Quick Look 표지/상세·XLSX 미리보기 확인. Office 전체/장문 및 3유형/6근무일 검증은 남음. 이전 148a4696 CI 37246235373 성공. 새 커밋 CI는 푸시 후 별도 확인 필요.

다음 순서: 정본 §4.6.3 프로젝트 생성 복사에 실제 Storage.copy 및 RPC 실패 보상, 멱등 재시도·응답 유실 보상 계약 구현 → 관리 UI/매핑 → 엔진 변경 재스캔 → 고정 프로세스 양식·출력 검증·S8/verified 마감. 현재 create_project_with_settings는 SQL 안에서 새 UUID를 생성하므로 단순 후처리 복사로는 계약을 만족하지 않는다. source 변경 경합 및 DB 커밋 후 응답 유실 때 파일 삭제 금지도 함께 설계해야 함. 사용자 DB/main 미통합.

## 21. SP6 완료 및 마감 (2026-10-05 11:15 KST)

- A 작업트리 `lane-a-sp4` 브랜치 `sp6/form-engine`에서 SP6 잔여 과제를 모두 완료하고 원격에 푸시했다.
- **프로젝트 복사 시 양식 파일 복사·보상 계약**: `a0bf86ef`(0034 마이그레이션·롤백·RLS), `ae03dc57`·`e1b01787`(`createProject` 연동 및 `no-raw-db-errors` 가드 복구, CI 37250149499 성공).
- **보고서 양식 관리 UI 및 매핑**: `42b7d4ff` `FormTemplatesManager.tsx`, `settings/page.tsx` 연동, jsdom 단위 테스트 `tests/ui/form-templates-manager.test.tsx` 통과, CI 37253160632 성공.
- **부정 테스트 6**: `tests/negative/form-engine-outputs.test.ts` 추가. 기본 4종 양식 렌더링 출력의 모든 zip 텍스트 파트(슬라이드, 노트, docProps, rels)에서 제조/영업 샘플 토큰('온라인 주문 포털', '외주가공' 등 9개) 0건 검증(13/13 통과).
- **합성 게이트 S8 활성화**: `scripts/e2e-synthetic.mjs`에 `S8-outputs`(주간 PPT/XLSX·WBS XLSX 양식·이슈분석서 10개 영역 체브론 8칸 창 분할 및 완결성) 단계 구현, `scripts/lib/synthetic.mjs`의 `PENDING_STEPS`에서 S8 제거.
- **카탈로그 verified 승격**: `src/lib/settings/catalog-meta.ts`의 `forms.*` 4개 키를 `verified`로 승격하고 실재 소비처 및 테스트 목록 등록. `src/lib/settings/defs/forms.ts` 위젯 컴포넌트를 실재하는 `FormTemplatesManager`로 연결하고 `docs/settings-catalog.md` 갱신.
- **검증**: 전용 DB reset + `test:rls` 49파일 886/886 전수 통과, `tests/report` 37파일 431/431, `tests/negative` 4파일 57/57, `tests/invariants` 35파일 242/242 통과, `tsc --noEmit` 0 오류, eslint 통과, 프로덕션 `npm run build` 성공.
- 최신 커밋 `b0fbff55` 원격 푸시 완료. main/사용자 DB 미통합 유지. 다음 단계는 개정 로드맵에 따른 SP7(외부 연동) 또는 잔여 SP.

