# SP5 — 달력(주 시작·시간대·근무일) + 이슈 영역·채번·분석 모듈 + 회의록 팀·첨부 + 어휘 설정값 승격 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-01 |
| 상태 | **확정 — 비평 셋·판정 S1~S13 반영, 2026-10-01 · 범위 재검토 반영(`.superpowers/sp5/rereview.md` P1 4·P2 6·P3 7 — 표기 "재검토 반영 — Rn": R1~R4 = P1 ①~④, R5~R10 = P2-1~6 — R10 은 수용이라 스펙 변경 없음, R11~R17 = P3-1~7), 2026-10-02**. 입력은 사전 실측 `.superpowers/sp5/survey.md`(범위 59·충돌 C-1~C-21·사용자 확인 후보 U-1~U-9)와 비평 셋(`.superpowers/sp5/critique-{feasibility-scope,fidelity,db-security}.md`), 판정 `.superpowers/sp5/rulings-post-critique.md`(S1~S13 — 구속). 실측 권고와 다르게 쓴 곳은 그 자리에 **"실측 권고와 다름 — 이유"**, 판정이 바꾼 행에는 **"비평 반영 — Sn"**. 판정별 반영 위치·반영하지 않은 발견은 `.superpowers/sp5/revision-report.md` |
| 상위 정본 | 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §6.2 SP5 블록(Phase A·B·B2 MIN-ATT·done_when)·§4.2(달력)·§4.4.2~§4.4.4(이슈 분석 모듈·채번)·§4.7(회의록 폴더↔팀)·§4.8 근태 행·§2.4.1(잠금 규약)·§2.8.1·§2.8.2·§2.8.3(SP5 키)·§2.8.7(`calendar.week_start` 키 계약)·§2.6.2 R2·R2 예외·R6·§2.11 SP5 행(done_when·픽스처 표)·§5.12.5 SP5 행·§6.1 원칙 1~6·§6.3·§6.5.8(S4·S5·S6·S10)·§8.1 #2·#3·#15·#18·#22·#23. 정본 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` `@31878b1` 의 SP5 블록(`정본:2952-2993` — 개정이 "유지"로 가져온 범위: Q4 어휘 표·회의록 `team_id`·잔여 문자열·done_when). SP4 확정 스펙(`sp4/spec` `1ee953e`, 이 문서에서는 "SP4 Dn·En·Kn") — 특히 §2.1.1 ⑥(대기 중 SP5 당기기)·D12(번호 접미)·D27(주간 쓰기 길)·D26(영역 편집기)·D34(가져오기 명령 원장)·D54(상속 공용 팀 전환 RPC)·§9 의 SP5 행. SP4 원장 `.superpowers/sp4/progress.md`(A1 의 M1 가드 `team_ref_owned_scope`·키셋 도우미 `fetchAllByKeyset`·래퍼 `lane-a-run.sh`) |
| 선행 | **SP4** — Phase A 는 SP4 **A2 체크포인트**(팀 요청 범위 원천·`holidays` 끝까지 읽기)의 HEAD 위에서 시작할 수 있다(SP4 §2.1.1 ⑥). **B2(회의록 팀)만** `sp4-done`(전환 RPC 의 `copyGlobalTeams` 연결·팀 화면이 B 에서 끝난다)이 선행이고, 그래서 B2 를 맨 끝에 둔다 — 순서 A → B1 → B3 → B4 → B2(D1·D3, 비평 반영 — S9) |
| 마이그레이션 | **다섯** — 개발 중 파일명 `NNNN_calendar`(A)·`NNNN_issue_areas`(B1)·`NNNN_attachments`(B3 — 개정은 `_minutes_teams` 에 합쳤다, D2)·`NNNN_vocab_settings`(B4)·`NNNN_minutes_teams`(B2)(+ 롤백 쌍 — 적용 순서대로 적었다). 번호는 main 머지 직전에 확정한다(SP4 D12 관례) — 지금 SP4 가 `0013`~`0015` 를 쓰고 레인 B UI-2a 의 `account_preferences` 가 하나를 더 받으므로 SP5 첫 번호는 `0016` 또는 `0017` 이다(C-1). 이 문서는 번호 대신 `NNNN_<이름>` 으로 적는다 |
| 실측 근거 | 2026-10-01 읽기 전용 사전 실측 `.superpowers/sp5/survey.md`(main `f2356ae` 기준. 이하 "실측"). 이 초안이 더 확인한 것: SP4 워크트리(`sp4/a1` `bff02f8`)의 `0013`~`0015` 함수 목록(`create_weekly_report`·`upsert_project_area`·`import_wbs`/`replace_wbs` 재정의·`import_wbs_cmd`·`convert_inherited_teams`·`team_ref_owned_scope` 트리거 넷·`apply_project_settings` 재정의), `create_issue_from_minute_block` 의 인자(`p_mega_code` — E15), `holidays` 쓰기 액션(`actions/project.ts` `addHoliday`·`removeHoliday` — 세션 클라이언트 + RLS), 설정 영향 미리보기의 자리(`src/app/actions/settingsPreview.ts` 의 `previewProjectSettingsImpact` — 지금은 모듈만, `src/lib/settings/impactPreview.ts`), 레지스트리 정의 파일(`src/lib/settings/defs/{project,workspace}.ts`), `PLANNED_KEYS` 의 SP5 행 16. 코드 줄은 착수 때 다시 잰다 — 이 문서는 심볼을 먼저 적고 줄은 참고로만 단다(C-14). 확정본이 더 확인한 것(비평 셋의 대조 + 반영자 표본): SP4 워크트리 HEAD `4828a58`(마이그레이션 마지막 변경 `cd66d6c` — M1 가드 "새로 생기는 참조만"·프로젝트 행 `for key share`), `teams` 세션 INSERT 정책 `wsadmin_insert_teams`(`0003_org_core.sql:609`)가 있으나 앱의 팀 생성은 모두 service_role(`actions/{teams,projectTeams}.ts` `createAdminClient`), 일반 이슈 등록은 지금도 Mega 영역 필수(`createIssue` → `validateInput('normal-create')` → `issueAnalysis.ts` 의 `'잘못된 Mega 영역입니다.'`), 개정 §4.7 SQL 의 `minute_folders.team_id … on delete restrict`(개정:2263) |

읽는 순서: 사용자는 **§8 을 먼저** 읽는다(#1·#2 는 SP5 착수 전 결정). 표기 — "D n" 은 이 문서의 결정, "E n" 은 상위 문서 대비 정정, "K n" 은 §10 의 리스크, "W n" 은 실측 ① 의 완료 조건 후보 번호, "C-n" 은 실측 ② 의 충돌 번호, "U-n" 은 실측 ④ 의 사용자 확인 후보 번호, "S-A n·S-B n·S-C n·S-D n" 은 실측 ① 의 범위 항목(Phase A·B1·B2·이월 — 실측 표의 A1·B1·C1·D1 을 충돌 C-n 과 가르려고 접두 `S-` 를 붙였다), "개정:줄"·"정본:줄"·"SP4:줄" 은 상위 문서의 줄(실측과 같은 기준), "A·B1·B2·B3·B4" 는 §2 의 체크포인트다(이름은 초안 그대로, **도는 순서는 A → B1 → B3 → B4 → B2** — 비평 반영 — S9). "S n" 은 비평 뒤 판정(`rulings-post-critique.md`)이다. "사용자 결정 n" 은 2026-09-26 사용자 결정(memory `dflow-design-decisions-2026-09-26` — ④ 주 시작 일요일·⑤ 공휴일 오버레이 없음·③ 집계 현행 유지·⑥ 디자인 번복).

## 목차

1. 전제와 결정 — 1.1 구속하는 결정 · 1.2 이 SP 의 결정(D) · 1.3 상위 문서 대비 정정(E) · 1.4 실측 충돌 C-1~C-21 처리 대응표 · 1.5 범위 표
2. Phase 구성 — 2.1 Phase 표 · 2.1.1 착수 시점·SP4 와의 순서·레인 B 창 · 2.2 노력 추정과 근거 · 2.3 소유 파일 · 2.4 SP3b·SP4 와 겹치는 파일·UI 위험 파일·트레일러 · 2.5 커밋·브랜치·전용 스택
3. DB 계약 — 3.1 공통 규칙 · 3.2 `NNNN_calendar` · 3.3 `NNNN_issue_areas` · 3.4 `NNNN_minutes_teams` · 3.5 `NNNN_attachments` · 3.6 `NNNN_vocab_settings` · 3.7 격리 맵·픽스처·RLS 테스트 · 3.8 리허설
4. 도메인·서버 — 4.1 달력 모듈 · 4.2 주 키 이행과 설정 키 · 4.3 시간대 · 4.4 소비처 전수(재작성) · 4.5 한국 공휴일 오버레이 삭제 · 4.6 이슈 영역·채번·분석 모듈 · 4.7 회의록 팀 · 4.8 회의록 첨부(MIN-ATT) · 4.9 어휘 · 4.10 이월 셋(첨부 경로·클릭 발급·회의 화면 실패) · 4.11 상수 제거·회귀 가드
5. 화면 — 5.1 체크포인트별 화면 범위 · 5.2 SPU3 로 넘기는 패턴 이행
6. 테스트·검증 — 6.1 단위·정적 · 6.2 실행형 · 6.3 로컬 E2E · 6.4 합성 게이트 · 6.5 눈확인
7. 완료 조건(done_when)
8. 사용자 확인 항목
9. 범위 제외·이월
10. 리스크

## 1. 전제와 결정

### 1.1 구속하는 결정

| # | 결정(출처) | SP5 에서의 귀결 |
|---|---|---|
| 사용자 결정 4 | 주 시작 일요일. 컨트롤러 해석 — `calendar.week_start` 설정, 기본 일요일, 기존 월요일 키는 새 주차부터 이행(memory) | 키 계약은 개정 §2.8.7, 이행은 §4.2.4 그대로(D4·D5). 주차 문서가 있는 기존 프로젝트의 전환은 **SP5 착수 전 사용자 결정**(§8 #2 — 개정 §8.1 #3) |
| 사용자 결정 5 | 공휴일 오버레이 없음 | 한국 특일 모듈·사전·테스트 삭제, 휴일 원천은 프로젝트 `holidays` 표뿐(§4.5). 기본 공휴일 출처 0 |
| 사용자 결정 3 | 집계·위험·완료 정책은 지금과 같게 | `progress_snapshots` 는 근무일 설정이 바뀌어도 재계산하지 않는다(개정 §4.2.2). 위험 모델은 손대지 않는다 |
| 사용자 결정 6 | 디자인 번복(중립·코발트, 다크 재노출) | SP5 가 만지는 색은 토큰으로(회의 화면 `projectColors.ts` — D39). 일·토 고정 색은 "비근무 요일" 토큰 하나로(§4.5) |
| 정본 결정 9 | 팀·영역·휴일은 FK 표라 설정 키가 아니다 | 이슈 영역은 `project_areas(kind='issue_area')` 행, `holidays.kind` 는 표 열이다. 레지스트리 키는 개정 §2.8.1·§2.8.2 의 SP5 행(워크스페이스 5 — `calendar.*` 3·`minutes.root_folders`·`minutes.attachments` / 프로젝트 11 — `calendar.*` 3·`issues.*` 5·`attendance.types`·`meetings.categories`·`minutes.attachments`)만 만든다. `PLANNED_KEYS` 의 SP5 행은 16(W5·P11 — 이 초안이 `catalog-meta.ts` 와 대조, 실측 ③-5 의 "15행"을 고친다). 그 행의 `sp` 표기 'SP5 Phase B' 는 체크포인트 이름(B1~B4)으로 고친다 |
| 개정 §6.1 원칙 1 | SP 당·Phase 당 노력 상한 3주, Phase 사이 main 체크포인트 | 체크포인트 **다섯**(D1), 순서 A → B1 → B3 → B4 → B2(비평 반영 — S9). 각 체크포인트(고정 비용 포함)가 3주 아래 |
| 개정 §6.1 원칙 2·3 | 완료 근거는 행위 테스트(grep 은 보조), RLS 건너뜀은 실패. 설정 키의 done = 네 연결(정의·편집·소비처·테스트) | 각 키는 들어가는 체크포인트에서 `verified` 까지 간다(D44) |
| 개정 §6.1 원칙 4 | 화면 소유 — SP 가 만진 화면은 SP3b 패턴으로 끝낸다 | SP4 D52 선례대로 **순수 패턴 이행은 SPU3 로 넘기는 것을 기본값**으로 둔다 — 원칙을 고치는 일이라 사용자 확인(§8 #10, D30) |
| 개정 §6.1 원칙 6 | 원격 배포 전 — 스테이징 실측 = 로컬 `db:reset`·`dev:bootstrap`·E2E·`test:rls`, 태그는 로컬 `sp5-*-done`, 트레일러 `Preview-checked: local …` | 그대로(§2.5) |
| 개정 §2.6.2 R2·R2 예외·R6 | 현행과 다른 기본값은 이관이 기존 행에 현행값을 명시 기록(워크스페이스·프로젝트 둘 다). `calendar.week_start` 는 예외(전환 규칙 기록). 새 모듈은 기존 `allowed`·`enabled` 에 명시 편입 | `calendar.timezone='Asia/Seoul'`(둘 다)·`issues.analysis='required'`·`modules.allowed`/`enabled ∋ 'issue_analysis'` 를 이관 SQL 리터럴로만(D13·D16) |
| H2 규칙 ①~⑤(memory `dflow-h2-done`) | 새 함수 EXECUTE 명시 회수 · 새 표 RLS + 정책 없는 DML 0 · 잠금 뒤 다른 행 판정 가드는 25001 · 마지막 1행은 advisory · CI db 잡은 부트스트랩 없이 | §3.1 공통 규칙에 그대로(⑤ 포함 — 새 RLS 테스트는 부트스트랩 계정·이관 기록 값에 기대지 않는다). ② 의 취지는 **세션 쓰기 권한이 있는 표의 새 열**(`minute_folders.kind·team_id`, `holidays.kind`)에도 적용한다 — 열 권한이나 트리거로 세션이 쓸 수 있는 범위를 정한다(D49, 비평 반영 — S1·S13) |
| SP4 §2.1.1 ⑥ | SP4 A2 → B 대기 동안 레인 A 는 SP5 스펙·계획. 대기가 길면 SP5 Phase A 를 당기되 자기 전용 스택, B 게이트가 열리면 진행 중 과제 커밋에서 멈추고 SP4 B 먼저, SP5-A 는 B 반영 뒤 rebase | D3·§2.1.1 |
| SP4 §9 의 SP5 행 | 주 시작·봇 월요일 강제·`p_from_week` · 이슈 영역 탭·code 규칙·쓰기 길(`upsert_project_area`) · `create_team`·개명 동기 · 회의록 팀 막대 패턴 · `projectColors.ts` · 새 팀 열을 전환 RPC 에 같은 커밋으로 | 각각 D34·D17·D20·D39·D19 가 받는다 |
| 사전 승인(memory `dflow-spec-preapproval`) | 초안이 비평·개정을 거치면 승인으로 보고 구현, 사용자 확인 항목은 권고 기본값으로 진행·보고, 되돌릴 수 없는 일은 그때 묻는다 | §8 은 기본값으로 진행한다. #1·#2 는 개정이 "SP5 착수 전"으로 둔 사용자 결정이라 **SP5 착수 전에 컨트롤러가 사용자에게 묻는다**(이 스펙의 확정 보고에 별도 블록으로). 답이 없으면 기본값으로 시작하되 A 의 마이그레이션 커밋 전에 한 번 더 확인 요청을 남긴다(원장 기록). #2 는 **메인 스택 적용(#13) 뒤에는 되돌릴 수 없다**(이관이 기록한 설정 값·이력을 롤백이 되돌리지 않는다). #13(사용자 DB 적용)은 그때 묻는다(비평 반영 — S12) |
| CLAUDE.md | `git add -A` 금지 · 마이그레이션과 코드 다른 커밋(G1) · UI 위험 파일은 `ui/` 브랜치 + `Preview-checked: local` · 0001+ 마이그레이션 `Staging-verified: local db reset`(G4) · 원본 DB 금지 · push 는 사람 확인 · `…atomic` 식별자 금지 · 롤백 쌍 · 권한 판정은 `authz.ts`·`src/lib/authz/**` 만 · 설정 쓰기는 RPC 한 길(`settings-writes` 불변식) | §2.5·§3.1. 회의록 계열은 RLS 쓰기 정책이 없다 — 첨부·폴더·팀 지정 액션의 서버 가드가 유일한 관문(K10) |

### 1.2 이 SP 의 결정

구조·공통 = D1~D3·D27·D30·D31·D33·D43~D45·D47·D48·D57·D59, A = D4~D14·D28·D32·D34~D38·D53·D54·D60, B1 = D15~D17·D41·D42·D55, B3 = D22~D26·D56, B4 = D29·D46·D58, B2 = D18~D21·D39·D40·D49~D52(도는 순서대로 적었다). "실측 권고와 다름" 은 실측 ②·④·⑥ 의 권고와 다르게 정한 곳, "비평 반영 — Sn" 은 판정 Sn 이 바꾸거나 더한 곳이다(D49~D60 은 비평 뒤 새 결정).

| # | 결정 | 이유 | 대안(사용자·비평이 달리 정하면) |
|---|---|---|---|
| D1 | **체크포인트 다섯 — A 달력 · B1 이슈 영역·채번·분석 · B3 회의록 첨부(MIN-ATT) · B4 어휘 · B2 회의록 팀·마감.** 이 순서(A → B1 → B3 → B4 → B2)로 순차로 돈다 — **B2 만 `sp4-done` 을 기다리므로 맨 끝**이고 마감 묶음도 B2 가 맡는다(비평 반영 — S9). 이름은 초안 그대로 둔다(D·E·§7 의 참조를 흔들지 않으려고). 각 체크포인트는 마이그레이션 하나와 그 소비처를 담고 검증 묶음 + 로컬 태그(`sp5-a-done`·`sp5-b1-done`·`sp5-b3-done`·`sp5-b4-done`·`sp5-done`)로 닫는다 `[사용자 확인 §8 #8]`. **실측 권고와 다름**: 실측은 넷(어휘만 B3 로 분리, U-8)을 권했다. 그 넷에서 B2(회의록 팀 + 첨부)는 실측 자신의 추정으로 2.5~3주에 U-5(회의록 `team_id`) 0.5~0.75주와 체크포인트 고정 비용 0.2~0.3주가 더해져 3.2~4.05주 — 하한부터 상한 3주를 넘는다. 첨부와 어휘를 합치면 2.75~3.6주(확정본 재산정)로 상한이 넘친다(§2.2). 그래서 회의록 팀과 첨부를 가른다. 순서를 B2 끝으로 미루는 이유: B3(첨부 가드는 `minute_files`·`minutes`·설정 행만 읽는다)·B4(어휘는 `_calendar` 의 `settings_ref_check` 본문 위에만 얹힌다)에는 `sp4-done` 의존이 없어서, SP4 B 가 레인 B 사람 게이트를 기다리는 동안 A·B1·B3·B4 를 모두 당길 수 있다 | 개정 §6.1 원칙 1(Phase 당 3주). SP3a·SP4 가 개정 추정의 1.4~3배로 팽창했다(K13) — 상한에 닿는 Phase 를 미리 만들지 않는다. 첨부 SQL 은 팀 폴더 SQL 과 독립이다(첨부 가드는 `minute_files`·`minutes`·설정 행만 읽는다) | 넷(실측 권고 — U-5 를 SP7 로 미루면 B2 가 2.75~3.25주로 상한 근처) / 셋(개정 — B2 3.5~4.5주, 상한 위반) |
| D2 | **마이그레이션 다섯, 번호 대신 접미로 참조.** `NNNN_calendar`·`NNNN_issue_areas`·`NNNN_attachments`·`NNNN_vocab_settings`·`NNNN_minutes_teams`(적용 순서 — D1). 첨부의 톰스톤 열·H2-h 가드의 설정 읽기는 개정이 `_minutes_teams` 에 합쳤으나(개정:3601) D1 의 분할을 따라 **따로 둔다**. 리허설·테스트·사전/사후검사 토큰·머리 주석의 파일 경로는 접미로(`*_calendar_week_start.sql` 꼴), 머지 직전 `ls supabase/migrations \| tail -1` 로 번호를 받고 `git mv` rename 커밋 + 재리허설 빈 커밋(SP4 D12·§2.5). 개정 §6.3 표 갱신은 마감(B2)의 문서 커밋에서 한다(비평 반영 — S9) | C-1. 원격 DB 전이라 rename 비용 0(개정 §6.3 번호 규칙) | 개정대로 넷(첨부를 `_minutes_teams` 에 — B2·B3 을 한 체크포인트로 되돌릴 때만) |
| D3 | **착수 시점과 순서.** (i) A 는 SP4 A2 체크포인트 HEAD 위(main 반영 전이면 그 태그 위 — SP4 D49 ②)에서 자를 수 있다. SP4 B 가 레인 B 게이트를 기다리는 동안 당기면 **SP5 전용 스택**(D33)을 쓰고, SP4 B 게이트가 열리면 진행 중 과제의 커밋에서 멈추고 SP4 B 를 먼저 끝낸 뒤 `sp5/phase-a` 를 그 위로 rebase 한다(SP4 §2.1.1 ⑥). (ii) B1·B3·B4 는 차례로 앞 체크포인트 위에 쌓을 수 있다(같은 규칙). (iii) **B2 만 `sp4-done` 뒤**다 — B2 는 SP4 B 가 바꾸는 `copyGlobalTeams` → 전환 RPC 연결과 팀 관리 화면(#15) 위에서 팀 루트·`team_id` 를 건다. B3·B4 가 `actions/minutes.ts`·`data/minutes.ts`·`domain/minutes.ts` 를 먼저 고치므로 B2 가 그 위로 rebase 한다(비평 반영 — S9) | SP5 의 실제 전제(요청 범위 팀 원천·`holidays` 끝까지 읽기)는 SP4 A2 에서 끝난다(SP4 §2.1·K3). B2 는 SP4 B 와 같은 파일(`projectTeams.ts`·팀 관리 화면)을 고친다 | SP4 `sp4-done` 뒤에 A 부터 시작(대기 시간 손실, rebase 0) / 초안 순서 A → B1 → B2 → B3 → B4(B3·B4 가 B2 와 함께 `sp4-done` 을 기다린다 — 대기 최장) |
| D4 | **주차 라벨 = 개정 §4.2.5 단일 규칙**(기준일 = 주 키 + 3일, 그 달에서 기준일이 떨어지는 앞선 주 키 수 + 1). 표시 요일 = 기간 안 근무일(5칸 고정 폐기), 서식 라벨 셋(시트 `M월 N주차`·파일명 `M월N주차`·보고서 `YYYY년 M월 N주차 (범위)`)은 한 함수 `weekLabelOf` 에서 나온다. **SP5 착수 전 사용자 결정** `[사용자 확인 §8 #1]` — 기본값으로 진행 | 개정 §8.1 #2·§6.2.0 게이트 문구("SP5 착수 전에 닫는다"), C-18. 같은 주가 생성일에 따라 '6월 5주차'/'7월 1주차' 로 갈리던 일이 사라진다 | 키가 속한 달의 N번째 시작 요일 |
| D5 | **주차 문서가 있는 기존 프로젝트도 다음 주부터 일요일**(개정 §4.2.4 이관 1~4 그대로 — tz 기록 → 변경 연산 → E 이후 문서면 E 를 `max(week_start)+6` 으로 미룸 → `[{monday,null},{sunday,E}]`, 이력 `source='migration'`, 월요일 아닌 키가 있으면 raise). **SP5 착수 전 사용자 결정** `[사용자 확인 §8 #2]` — 기본값으로 진행 | 사용자 결정 4·컨트롤러 해석("새 주차부터 이행"), 개정 §8.1 #3 | 주간보고가 있는 프로젝트는 `[{monday,null}]` 만 기록해 월요일 유지 |
| D6 | 주 시작 선택지는 **일요일·월요일 둘**. 워크스페이스 값 `'sunday'\|'monday'`, 프로젝트 편집 입력도 둘 중 하나 `[사용자 확인 §8 #3]` | 개정 §4.2.2·§2.9.2 지원 제한. 알고리즘(`weekKeyOf`)은 요일 무관이라 목록만 넓히면 된다 | 7요일 |
| D7 | **날짜 예외 `holidays.kind 'off'\|'work'`, 입력은 일정 화면.** `ScheduleManager` 에 휴무/근무 선택을 더하고 `addHoliday(projectId, date, name, kind)` 가 `kind` 를 쓴다. 쓰기 길은 **지금처럼 세션 클라이언트 + RLS `admin_write_holidays`(관리자)** 이고 새 RPC 를 만들지 않는다 — `kind` check 가 DB 를 지킨다. Excel `Holiday` 시트·`/api/v1/wbs/import` 는 휴무(`off`)만, 내보내기는 `off` 만(지원 제한). 가져오기의 휴일 upsert 는 `work` 행을 덮지 않고(`… do update set name = excluded.name where public.holidays.kind = 'off'`) 미리보기·결과에 '건너뜀(특정일 근무와 충돌)'을 보인다 `[사용자 확인 §8 #4]` | U-4, 개정 §4.2.3 충돌 규칙. 실측 ③-3 이 짚은 세션 직접 쓰기 정책은 지금도 관리자만 통과하고, `work` 를 넣는 것이 정상 경로다 | Excel 에 '근무' 열(양식 엔진과 함께 SP6) |
| D8 | **주 키 트리거를 둔다 — 근거를 고친다.** `weekly_reports` `BEFORE INSERT OR UPDATE OF week_start` 트리거(DEFINER): 설정 행 `FOR SHARE`(그 `values` 를 변수에 받는다) → `new.week_start <> week_key_from_rules(week_rules_of(<잠근 values>), new.week_start)` 면 23514 `WEEK_KEY_INVALID` — 설정을 두 번 읽지 않는다(D53 의 규칙 인자형 순수 헬퍼, 비평 반영 — S2). SP4 D27 뒤 세션은 `week_start` 를 쓸 수 없고 생성은 `create_weekly_report` 한 길이므로, 트리거의 근거는 "RLS 직접 쓰기 방어"가 아니라 **"RPC·service_role 경로의 마지막 방어 + 설정 RPC 와의 직렬화"**다(E2). `create_weekly_report` 본문은 다시 만들지 않는다(키 검사는 트리거와 중복). 액션이 `weekKeyOf(<프로젝트 규칙>, todayIn(tz) 또는 요청 날짜)` 로 키를 정규화해 넘긴다. **잠금 순서**(순환 없음): 생성 = advisory `'weekly:'‖project` → (insert) 트리거의 설정 행 `FOR SHARE`. 설정 저장 = 설정 행 `FOR UPDATE` → `settings_ref_check` 의 문서 count(advisory 를 잡지 않는다). 두 길이 서로 상대가 먼저 잡는 잠금을 기다리지 않는다. 비평이 SP4 HEAD 본문(`0013` `create_weekly_report`·`upsert_project_area`, `0015` `apply_project_settings`, `0014` `convert_inherited_teams`)과 대조해 순환 없음을 확인했다 — `upsert_project_area` 는 `weekly_reports` 를 select 만 하고 `week_start` 를 쓰지 않으며 설정 행을 읽지 않는다 | C-3. 개정 §2.4.1 이 주 키 경합 보장(A8·W8)을 이 `FOR SHARE` 에 맡겼다 — 트리거를 빼면 경합 테스트의 근거가 사라진다 | RPC 안 검사 + 트리거 삭제(경합 보장을 RPC advisory 로 — 설정 RPC 도 같은 advisory 를 잡아야 해서 0012 RPC 를 고친다) |
| D9 | **주 계산 단일 출처 가드를 넓힌다 — 호출 단위로.** `tests/domain/week-single-source.test.ts` 는 개정 정규식(`mondayOf\|mondayIso\|(dow \+ 6) % 7`)에 더해 **`get(UTC)?Day()` 호출 자체**를 `src/lib/domain/calendar.ts` 와 닫힌 허용 목록 밖에서 금지한다(조건식 모양 매칭은 버린다 — 한 줄에 조건이 없는 `DayPopover` 의 `getDay()`·다음 줄에서 비교하는 `validate.mjs` 를 놓친다). 스캔 범위 `src/**`·`scripts/**`. 허용 목록은 사유 주석이 달린 닫힌 목록 — ISO 주차 메타 `isoWeek`(`report/weekly.ts`)·요일 라벨 색인(`DOW_KR[…getUTCDay()]` 꼴, `mail/meetingInvite.ts`)·대시보드 요일 키(`components/dashboard/bits.tsx`) 정도 — 이고 죽은 항목(가리키는 줄이 없어진 항목)도 실패로 본다. 놓침 표본(실측 C-4 의 넷 + `DayPopover.tsx` 의 `getDay()`·`wbsmd/parse.ts` 의 주말 판정·`scripts/wbs/validate.mjs` 의 `getDay()`)과 거짓 적중 표본을 단위 테스트로 고정한다(비평 반영 — S13) | C-4 — 개정 정규식은 `planner.ts` 주 범위·봇 주간 도구 월요일 강제·간트 주 끝·캡처 시드를 놓친다 | 개정 정규식 그대로 + 실측 넷만 손으로 교체(재발 방지 없음) |
| D10 | **소비처 전수 표를 다시 만든다(§4.4).** 개정 §4.2.8 표에 실측 C-5 의 7건(`actions/wbs.ts` 영업일, `wbsmd/parse.ts` `nextBusinessDay`, 플래너 주 범위, `MeetingsView`·`MyMeetingsView` 월 그리드, `DayPopover` 로컬 tz, 녹취 시간 보정, 봇 주간 도구 월요일 강제)을 더하고 심볼로 적는다. 각 Phase 착수 때 그 Phase 범위를 SP4 머지 트리에서 D9 의 넓힌 정규식과 `seoul(Today\|Ymd\|Stamp)`·`Asia/Seoul`·`+09:00`·`9 \* 3600_000`·`from('holidays')`·주 시작 문구(`월요일\|Mon start` — i18n 설명 문구, 예: `dash.issues.trendCaption` ko/en) grep 으로 **다시 전수**하고 계획에 적는다(비평 반영 — S13) | C-5·C-14·C-17 — SP4 머지 뒤 주 계산 호출부(`create_weekly_report` 호출·`weeklyCarry.ts`·`p_from_week`)가 늘었다 | — |
| D11 | **`holidays` 판독을 한 로더로 모은다.** 달력 로더 `src/lib/calendar/load.ts`(새 — 서버 전용) 하나가 `holidays(date, name, kind)` 를 끝까지 읽어(SP4 의 키셋 도우미 `fetchAllByKeyset` 또는 같은 꼴) `WorkCalendar` 를 만들고, `getProjectConfig` 가 그 결과를 `ProjectConfig.calendar` 로 싣는다(5조회, 실패 시 `CONFIG_UNAVAILABLE` throw — 부분 기본값 없음). 실측 판독 7곳(`actions/project.ts` 둘·`actions/wbs.ts`·`repositories/supabase/{settings,wbs}.ts`·`data/snapshots.ts`·`data/wbs.ts`)은 `ProjectConfig.calendar` 또는 그 로더를 쓴다. 불변식 `tests/invariants/holidays-reads.test.ts`(새): `from('holidays')` 는 허용 파일 둘(로더 · 쓰기 액션 `actions/project.ts`) 밖 0건, 허용 파일 안의 select 는 `kind` 를 포함. 엑셀 내보내기는 `offDates` 만 쓴다 | C-6 — `kind` 도입 뒤 `date` 만 읽는 곳은 `work` 행을 휴무로 오판한다. 설정 4표 불변식(`settings-writes`)과 같은 꼴 | 판독 7곳에 `kind` 열만 더함(재발 방지 없음) |
| D12 | **가져오기 RPC 는 SP4 정의를 기준으로 고친다.** `NNNN_calendar` 는 SP4 `_command_receipts` 가 다시 만든 `import_wbs`·`replace_wbs` 본문을 `create or replace` 의 바탕으로 쓰고 휴일 upsert 갱신절만 바꾼다(D7). `import_wbs_cmd` 요약(`holidays` 포함 — SP4 D34)·멱등 재생 결과가 바뀌지 않음을 회귀로 둔다(`tests/rls/command-receipts.test.ts` 에 `work` 행 케이스 하나). **SP4 본문 승계 검사**(SP5 가 전문 `create or replace` 하는 SP4 함수 전부 — `import_wbs`·`replace_wbs`·`convert_inherited_teams`·`team_ref_owned_scope`·`project_areas_guard`·`upsert_project_area`): 바탕 본문은 `sp4-a2-done`(B2 는 `sp4-done`) 태그 시점(단 `project_areas_guard`·`upsert_project_area` 는 SP4 A1 정의라 `sp4-a2-done` 이후 SP4 가 고칠 수 있으므로 B1 은 **착수 때 SP4 HEAD 의 본문**을 바탕으로 한다 — K25 와 같은 위험, 재검토 반영 — R17)이고, 각 `*_POSTCHECK` 가 SP4 쪽 핵심 문장 토큰이 새 본문에 남았는지 `prosrc` 로 본다 — `import_wbs`·`replace_wbs`: `'wbs-import:'` 잠금·영수증 호출 자리, `convert_inherited_teams`: `TEAM_CONVERT_ISOLATION`·`already`, `team_ref_owned_scope`: `TEAM_SCOPE_PROJECT_OWNED`·`for key share`·`TEAM_SCOPE_TRIGGER_MISPLACED`, `project_areas_guard`·`upsert_project_area`: SP4 분기 문구. 번호 rename 뒤 재리허설(D2)도 이 검사를 포함한다(비평 반영 — S13) | C-7 — 개정은 `0009` 본문을 가리킨다 | — |
| D13 | **시간대.** ① 이관이 기존 워크스페이스·프로젝트 **둘 다**에 `calendar.timezone='Asia/Seoul'` 을 기록한다(R2, 이관 SQL 의 데이터 리터럴 — 런타임 0). ② 새 워크스페이스는 생성 폼이 브라우저 tz 를 제안하고, `dev:bootstrap` 은 `BOOTSTRAP_TIMEZONE`(기본 `'UTC'`)을 받는다. 다시 돌릴 때 기존 워크스페이스에 값이 있으면 명시했을 때만 덮는다(`BOOTSTRAP_MODULES` 관례) `[사용자 확인 §8 #9]`. tz 값의 검증은 D54(`'UTC'` 를 받는다). ③ 봇: **요청 범위 달력 한 벌** = (tz, 주 시작 요일, 근무 요일) — 요청에 `projectId` 가 있으면 그 프로젝트, 없으면 워크스페이스(워크스페이스 `'sunday'\|'monday'` 를 규칙 하나 `[{day, from:null}]` 로 승격)가 날짜 앵커(오늘·이번 주)를 정한다. 라우터·플래너는 '지난/이번/다음 주'를 **날짜 범위**로 만들고, 주간 도구가 그 범위를 프로젝트별 키(`weekKeyOf(<그 프로젝트 규칙>, date)`)로 바꾼다. 도구는 프로젝트 데이터의 date-only 값만 비교하고 자기 tz 로 '오늘'을 다시 계산하지 않는다(개정 §4.2.6 의 보강 — 화면별 해석 규칙 개정:3015 와 같은 원칙). 시그니처 변경 `routeChatRequest(request, now, calendar)`(§4.4). `CHAT_TIMEZONE` 삭제, `ToolContext.timezone: string`(비평 반영 — S13). ④ 녹취 도구 산출물의 "UTC → 한국 시간 +9시간" 보정(`lib/minutes/timeFix.ts`)은 "UTC → 회의록 범위 tz"(프로젝트 회의록은 프로젝트, 무프로젝트는 워크스페이스)로 일반화하고 보정 여부 판정은 그대로, 사전 문구 `min.timeFix.desc` 를 tz 이름을 넣는 꼴로 `[사용자 확인 §8 #6]` | 개정 §4.2.6·§2.6.2 R2·§8.1 #18, C-19, U-6·U-9 | ③ 도구마다 프로젝트 tz(워크스페이스 질문에서 '이번 주'가 도구마다 다를 수 있다) / ④ 한국 전용 보정으로 두고 지원 제한에 적음 |
| D14 | **사용현황 RPC 5종에 `p_timezone text`(기본값 없음)** — 네 함수는 맨 뒤, `usage_sessions` 는 **`p_gap_minutes` 앞**(`usage_sessions(p_from, p_to, p_timezone, p_gap_minutes default 30)` — 기본값 있는 인자 뒤에 기본값 없는 인자를 둘 수 없다, 42P13). 호출부는 이름 인자(`sb.rpc(name, {…})`)라 순서 무관. **`LANGUAGE sql STABLE`·INVOKER 를 유지**한다 — DEFINER 로 바꾸면 `usage_events` 의 RLS(`read_usage_events`, 슈퍼유저)가 빠져 비슈퍼유저에게 열린다. 잘못된 tz 검증은 **SQL 식**으로 — 본문의 `at time zone p_timezone` 이 PG 의 22023(`invalid_parameter_value`)을 내고, **빈 `usage_events` 에서도 평가되도록** 본문 첫 FROM 항목을 `p_timezone` 을 쓰는 한 행짜리 식으로 둔다. TS 데이터 계층이 이 함수들의 22023 을 `USAGE_TIMEZONE_INVALID` 로 매핑한다(fail-closed). SQL 식으로 "빈 표에서도 22023"을 보장할 수 없으면 `plpgsql`(`return query`)로 바꾸되 INVOKER 를 유지한다 — 계획이 `usage-timezone.test.ts` 의 빈 표 케이스로 고른다. EXECUTE 기대표(§3.1): public·anon 거짓, authenticated·service_role 참(`drop`+`create` 가 ACL 을 기본값으로 되돌리므로 `revoke all … from public, anon` + `grant execute … to authenticated, service_role` 를 명시). `/usage` 는 워크스페이스 필터가 있으면 그 tz, 전체 합산은 `'UTC'` 를 명시해 넘기고 화면에 "UTC 기준"을 적는다. SP8 의 `p_workspace_id` 는 그 위에 얹는다(비평 반영 — S7) | 개정 §4.2.3·§4.2.6. 기본값 인자를 두지 않는다(빠뜨린 호출이 조용히 UTC 가 되지 않게). 다섯은 지금 `language sql`·INVOKER 이고 세션 클라이언트가 부르며(`src/lib/data/usage.ts` `createServerClient()`), `0006` 은 public·anon 에서만 EXECUTE 를 회수했다 | plpgsql INVOKER(위 조건) / `pg_timezone_names` 존재 검사(호출마다 tz 디렉터리를 훑어 느리다 — 비권고) |
| D15 | **이슈 채번·영역은 개정 §4.4.3 그대로**(`issues.id_policy` 토큰 문법·`scope_key` 카운터·겹침 건너뛰기 1,000회·`0010` 최소 n자리·절단 금지·이관 1~6·조건부 롤백). 더하는 것: `create_issue_from_minute_block` 은 반환만이 아니라 **인자도** 바뀐다 — `p_mega_code` → `p_area_id`, 분석 인자(`p_major_name`·`p_sub_process`·`p_owner_department`·`p_related_systems`·`p_source_type`)는 `issue_analysis` 모듈이 꺼졌으면 null 이어야 하고(켜졌을 때의 필수 규칙은 `issues.analysis` 와 같은 판정), 반환은 `(issue_id, code)`(E15). 함수가 시그니처째 바뀌므로 `drop function` + `create function` + EXECUTE 재부여(service_role 만). **잠금·판정 보강**(비평 반영 — S13): 영역 활성 판정은 채번 트리거와 이 함수 모두 `select active from public.project_areas where id = … and project_id = … and kind = 'issue_area' for key share`(SP4 `upsert_project_area` 의 영역 `for update` 와 충돌해 비활성화 커밋 뒤 값을 읽는다). 분석 인자의 모듈 판정은 **유효 모듈**(워크스페이스 `modules.allowed` ∋ ∧ 프로젝트 `modules.enabled` ∋ `'issue_analysis'`) — 두 설정 행을 워크스페이스 → 프로젝트 순으로 `FOR SHARE`(설정 RPC 와 같은 순서). 같은 판정을 쓸 곳이 더 생기면 내부 헬퍼 `module_effective(p_project_id, p_module)`(EXECUTE 무부여). 영역 없는 기존 이슈의 코드는 D55 | 개정 §4.4.3, 실측 S-B4·W26. 이 초안이 0000 본문을 확인했다 — 영역 존재 검사가 `issue_mega_areas` 를 읽는다 | — |
| D16 | **분석 모듈 `issue_analysis` 분리와 게이트 재분류.** 모듈 레지스트리에 `issue_analysis`(`requires: ['issues']`), `issues` 행의 `apiPrefixes` 에서 `/api/issue-analysis` 를 옮기고, `OFF_ON_CREATE = ['issue_analysis']`. 이관이 기존 워크스페이스 `modules.allowed`·기존 프로젝트 `modules.enabled` 에 넣고 `issues.analysis='required'` 를 기록한다(R6·R2). `tests/gates/manifest.ts` 의 이슈 액션·라우트 항목을 모듈별로 다시 나누고(분석 실행·분석서 PPT·분석 필드 쓰기·`/api/issue-analysis` → `issue_analysis`, 일반 이슈 → `issues`), SP4 의 RPC↔표 대응(`tests/gates/_rpc-tables.ts`)에 바뀐 RPC 를 같은 커밋으로 적는다. 분석 필드 쓰기는 모듈 관문 `requireModule(scope, 'issue_analysis')` 가 닫고, DB 제약은 "Major 부여" 기준(개정 §4.4.2)으로, `ISSUE_MAJOR_REQUIRED` 삭제 | C-20, 개정 §4.4.2 | — |
| D17 | **이슈 영역 편집 = SP4 편집기의 `issue_area` 탭.** SP4 D26 이 숨긴 탭을 연다. 쓰기는 SP4 의 `upsert_project_area`(kind `issue_area`) 한 길, code 규칙 `^[A-Z0-9]{1,8}$`·불변은 `project_areas_guard`(SP4 `_weekly_areas` 의 트리거) 분기와 RPC 입력 검사 둘 다에 둔다(`NNNN_issue_areas` 가 그 둘을 `create or replace`). 비활성 영역에 새 이슈 0(`ISSUE_AREA_INACTIVE`) | SP4 §9(쓰기 길·code 규칙)·E26, 실측 S-B6 | — |
| D18 | **회의록 팀 지정도 id 로 — `minutes.team_id` 를 SP5 B2 에 넣는다** `[사용자 확인 §8 #5]`. `minutes.team_id uuid references teams(id) on delete set null`(nullable — 프로젝트 삭제가 전용 팀을 cascade 로 지울 때 RESTRICT 면 프로젝트 삭제가 막힌다, 비평 반영 — S10. 메아리 트리거가 "`team_id` 가 없으면 입력값 유지"라 `team_code` 에 원문이 남는다). 범위 가드는 D51. **팀 선택은 code 단위**(비평 반영 — S13): 이관 = 프로젝트 회의록은 그 프로젝트의 같은 code 전용 팀(활성 무관), 없으면 같은 워크스페이스의 같은 code 공용 팀(활성 무관 — 과거 편철을 지킨다), 무프로젝트 회의록은 같은 code 공용 팀(활성 무관). **다른 프로젝트의 전용 팀은 어느 경우에도 고르지 않는다**(지금 수신 RPC 는 다른 프로젝트 전용 팀까지 통과시킨다). 맞는 팀이 없으면 null 로 두고 `raise notice` 로 건수를 보고한다. 재편철(프로젝트 변경, `folders.ts` 재편철 경로)은 대상 프로젝트 기준으로 같은 규칙으로 `team_id` 를 다시 해석해 함께 쓴다(없으면 null + 화면 알림 — 그대로 두면 M1 이 `TEAM_SCOPE_PROJECT_OWNED` 로 이동을 거부한다). 팀을 code 로 가리키는 나머지 넷(`minute_versions.team_code`·`wiki_items.owner_team`·`wiki_topics.owner_team`·`ai_documents.team`)은 code 로 남긴다 — 전환이 같은 code 로 복사하므로 의미가 유지되고, 버전은 이력이라 당시 code 가 맞다(§9 SP7 행). **`team_code` 열은 남긴다** — 트리거가 `team_id` 에서 `teams.code` 로 채우는 읽기 전용 메아리(외부 수신 RPC 의 `p_team_code` 계약과 기존 내보내기가 그대로 돈다). 열 삭제와 외부 `team` 문자열의 `team_map` 은 SP7(계약 v3). 앱 읽기·필터(`?team=` → `team_id`)·위키·AI 색인은 `team_id` 로. teams 모드의 새 쓰기는 `team_id` 필수(액션·수신 RPC 가 판정 — 열은 nullable, 기존 null 행은 '팀 미지정'으로 보인다). 또박또박 `team` 문자열 → `teams.id` 해석 함수(`src/lib/minutes/teamResolve.ts`)는 지금 code 일치만 하고 SP7 이 `team_map` 을 얹는다 | C-8·U-5. 정본 SP5 범위(`정본:2967`)·SP4 §9("SP5 의 회의록 `team_id`")·개정 §4.7 표("회의록 `team_id` 필수/선택")가 열을 전제한다. SP4 전환 RPC 뒤 같은 code·다른 id 팀이 생기므로 문자열은 팀을 가리키지 못한다 | 폴더만 id 로, 회의록 `team_code` 는 SP7 과 함께(−0.4~0.55주 — §2.2 표 기준, 전환 뒤 회의록이 어느 팀인지 code 로만 안다) |
| D19 | **팀 루트 생성 경로 넷을 정한다.** ① 공용 팀(`addTeam`) → RPC `create_team(p_actor, p_workspace_id, …)` 한 트랜잭션에서 팀 + 워크스페이스 단위 `team_root`(teams 모드일 때만). 실패하면 둘 다 롤백 — 지금의 부분 실패 `ok:false` 를 없앤다. **공용 팀 생성은 이 RPC 한 길**이다 — 세션 INSERT 정책 `wsadmin_insert_teams` 만 지운다 — 표 단위 INSERT 권한은 회수하지 않는다(그 권한은 프로젝트 팀 정책 `pa_insert_project_teams` 가 쓰고 `h2-table-grants` 가 참이어야 한다고 단언한다 — 재검토 반영 — R1)(앱은 이미 service_role 로만 넣는다), 루트 모드는 워크스페이스 설정 행 `FOR SHARE` 뒤에 읽는다(D50, 비평 반영 — S10). ② 프로젝트 단위 루트(공용 팀의 프로젝트 루트·프로젝트 전용 팀의 루트)는 **지연 생성 유지** — `ensureProjectTeamRoot` 를 `kind='team_root' ∧ team_id` 조회로 바꾸고 23505 경합 처리는 그대로. 그래서 `addProjectTeam`·SP4 가져오기의 전용 팀 등록(`ensureProjectTeams`)·전환 RPC 는 폴더를 만들지 않는다. ③ **전환 RPC `convert_inherited_teams`(SP4 D54)는 새 팀 열 둘을 옮긴다** — 그 프로젝트의 `minute_folders.team_id`(프로젝트 루트)와 `minutes.team_id` 를 옛 공용 → 새 전용 id 로. 두 표는 **UPDATE 목록과 복사 대상 집합 둘 다**에 든다 — 복사 대상은 "활성 공용 팀 ∪ 그 프로젝트의 참조가 가리키는 비활성 공용 팀"(SP4 `0014` 의 `t.active or exists(…)`)이라, `exists` 목록에 두 표가 없으면 회의록·폴더만 가리키는 비활성 공용 팀이 복사되지 않아 회의록이 공용 팀에 남는다(비평 반영 — S13). `NNNN_minutes_teams` 가 RPC 를 같은 파일에서 `create or replace` 하고 SP4 의 카탈로그 불변식(teams 를 참조하는 FK 열 ∪ `team_ids` = RPC 가 옮기는 열)이 그것을 잡는다(SP4 K20). 공용 팀의 워크스페이스 루트(`project_id` null)는 전환 대상이 아니다. ④ SP4 M1 가드 `team_ref_owned_scope` 를 `minutes`·`minute_folders` 에도 건다(`project_id` 가 있는 행만 — 그 프로젝트에 같은 code 의 전용 팀이 있으면 공용 팀 참조 거부). 바탕은 SP4 `cd66d6c` 규칙 — **새로 생기는 참조만** 판정하고 UPDATE 에서 `team_id`·`project_id` 가 그대로면 통과, 짝 잠금은 프로젝트 행 `for key share`, 함수는 `tg_table_name` 분기형이라 분기 둘을 더하고 `else` 의 55000 `TEAM_SCOPE_TRIGGER_MISPLACED` 를 유지한다(비평 반영 — S11) | C-9, SP4 §9·K20·원장 M1. 프로젝트 루트를 팀 생성 때 만들면 프로젝트 수 × 팀 수만큼 빈 폴더가 생긴다(지금도 지연 생성이다) | 프로젝트 팀도 생성 즉시 루트(경로 셋을 모두 고친다) |
| D20 | **팀 개명 → 루트 이름 동기 트리거.** `teams` `AFTER UPDATE OF name` 트리거가 `kind='team_root' ∧ team_id = new.id` 인 폴더의 `name` 을 `left(btrim(new.name), 60)` 으로. 폴더 id 불변. 이름 제약과 충돌하면 23505 `TEAM_ROOT_NAME_CONFLICT` 로 개명이 멈추고 SP4 D37 의 개명 액션이 그 토큰을 문구("같은 이름의 회의록 최상위 폴더가 있습니다 — 그 폴더 이름을 바꾼 뒤 다시")로 돌려준다(D52, 비평 반영 — S10). 팀 비활성 → 루트는 읽기 전용(새 편철·하위 폴더 생성 거부, 열람 가능 — `정본:2993`) — 판정은 `folders.ts` 의 편철·생성 경로와 수신 RPC, 그리고 **DB 가드 `minute_folders_kind_guard`**(D49 — 세션 insert 정책으로 우회되지 않게, 비평 반영 — S1) | 개정 §4.7 표, SP4 §9 | — |
| D21 | **`minutes.root_folders` custom 모드는 서버·테스트까지 만들고 화면 선택지는 SP7 전까지 숨긴다** `[사용자 확인 §8 #12]`. 키(W)·모드별 규칙(개정 §4.7 표 전부)·외부 업로드 정규화·v2.9 계약 절은 B2 산출물이다. 설정 화면은 `teams` 만 보이고, custom 은 플랫폼 관리자가 설정 RPC 로만 넣을 수 있다. `editor` 는 키 단위라(`canEditSetting(scope, editor, actor)` 는 값 안의 `mode` 를 보지 않는다) **SP7 전까지 키 전체의 `editor = 'platform_admin'`**(teams 가 기본값이라 워크스페이스 관리자가 바꿀 일이 없다 — 화면 숨김만으로는 액션 직접 호출을 막지 못한다), SP7 이 v3 송부와 함께 화면을 열고 `workspace_admin` 으로 내린다(비평 반영 — S13) | 개정 §8.1 #15("송부 전 배포에서는 custom 모드를 켜지 않는다"), §4.7 | 화면에 바로 노출하고 경고 문구 |
| D22 | **첨부 SQL 은 `NNNN_attachments` 로 따로**(D2) — 회의록 첨부와 이월된 산출물·이슈 첨부 경로 정책을 한 파일에 담는다(B3 가 '첨부 경로를 만지는 체크포인트'다). 내용: `minute_files.deleted_at·deleted_by·purged_at`, 가드 `minute_files_attachment_guard` 재정의(설정 읽기·크기·총량·확장자·enabled — D23), `deliverable_attachments`·`issue_attachments` insert 정책의 경로 범위 검사(§4.10). 청소 잡은 새 RPC 없이 service_role 클라이언트로(§3.5) | D1, 개정 SP5 블록 (H2 이월) | — |
| D23 | **톰스톤은 한도·중복·목록·다운로드에서 빠진다.** 가드의 개수(⑥)·총량은 `deleted_at is null` 행만 센다 `[사용자 확인 §8 #7]`. **중복(⑤)은 지금처럼 전체 행**을 본다 — 경로 유일 인덱스(`minute_files_attachment_path_uidx`)가 톰스톤을 포함한 채 유지되므로(같은 경로를 다시 쓰지 않는다 — `stampedFileName`) ⑤ 만 좁히면 톰스톤 경로 재전송이 원시 23505 로 떨어져 `MINUTE_ATTACHMENT_DUPLICATE` 가 사라진다(비평 반영 — S13). 톰스톤의 쓰기 길·되살리기 금지·읽기 제외는 D56. 가드에 더하는 검사: `enabled=false` → 거부, 객체 메타 `size > maxFileBytes`, 살아 있는 첨부 총량 + 새 크기 `> maxTotalBytes`, `allowedExtensions` 가 있으면 파일명 확장자(소문자) ∉ 목록 — 각각 23514 `MINUTE_ATTACHMENT_{DISABLED,TOO_LARGE,TOTAL_EXCEEDED,EXTENSION}`. 운영 상한 `MINUTES_ATTACHMENT_MAX_BYTES` 는 설정 저장 검증(TS)과 버킷 `file_size_limit` 이 지킨다(가드는 설정값만 본다) | C-10·U-7. 지금 가드에는 개수만 있다(`0011:655-661`) — 개정 SP5-5 "화면·서버·DB 가 같은 제한"을 DB 가 지키려면 크기·총량·확장자가 가드에 있어야 한다 | 톰스톤도 `purged_at` 전까지 한도에 남김 |
| D24 | **무프로젝트 회의록의 첨부 정책 = 워크스페이스 키.** 회의록에 `project_id` 가 있으면 그 프로젝트의 `minutes.attachments`, 없으면 워크스페이스의 `minutes.attachments`. 가드는 쓰는 쪽 설정 행을 `FOR SHARE` 로 잡는다(§2.4.1 — 두 표 모두). TS 해석기 `resolveAttachmentPolicy(minute)` 가 같은 규칙이고 패리티 테스트가 둘을 맞춘다 | C-11 | — |
| D25 | **외부 메타 API(`/api/v1/minutes/meta`)는 운영 상한을 그대로 광고한다** — `max_attachments`·`max_attachment_bytes` 는 상수 대신 운영 상한(`MINUTES_ATTACHMENT_MAX_BYTES`)·제품 상한(10)에서. 외부 수신 경로는 첨부를 받지 않으므로(실측 ③-8) 계약 불변, v2.9 절에 한 줄 | C-12 | 워크스페이스 값 광고(외부가 받지 않는 값을 광고하게 된다) |
| D26 | **고아 청소 잡.** `scripts/minutes/sweep-attachments.mjs`(service_role, 기본 dry-run, `--apply` 로만 삭제) — ① 대상은 **버킷 `minutes` 중 경로 세그먼트가 첨부인 객체(`split_part(name,'/',5) = 'minute-files'`)뿐**이고, 그 가운데 `minute_files.file_path`(톰스톤 포함) **와 `minute_versions.file_path` 어느 쪽도 가리키지 않고** 생성 24시간 지난 것만 삭제한다(업로드 중인 객체 보호. 버킷에는 본문(`'minutes'` 세그먼트)도 같이 있고 과거 버전 본문은 `minute_versions.file_path`(WORM)만 가리킨다 — 잡은 service_role 이라 세션 삭제 정책의 보호 밖이므로 범위를 코드로 못 박는다, 비평 반영 — S3). 단위 테스트: 본문 세그먼트 객체·과거 버전 본문 객체는 dry-run 목록에 0 ② `deleted_at is not null ∧ purged_at is null` 행의 객체를 지우고 `purged_at` 기록(재시도). 실행 기록은 표준 출력 + 종료 코드. 스케줄 배선은 운영 설정(개정 §4.10)이라 SP8/첫 배포 — SP5 는 수동 실행과 테스트까지 | 개정 SP5-6·SP5-7. 원격이 없어 크론을 걸 곳이 없다 | Next 라우트 + `CRON_SECRET`(배포가 생기면) |
| D27 | **SP3b 경로 이동과 겹치는 화면은 착수 때 다시 잡는다.** `/meetings`·`/minutes` → `/w/[slug]/…`(UI-2a)·`(app)/layout.tsx`(UI-2b) — 각 Phase 착수 때 UI-2a·UI-2b 의 main 머지 여부로 파일 경로를 다시 정하고 계획에 적는다. 먼저 머지한 쪽이 기준, 나중이 rebase | C-15, 개정 §6.1 원칙 5 | — |
| D28 | **월요일 픽스처·시드는 그 프로젝트에 월요일 규칙을 먼저 기록한다.** 대상 = `tests/rls/fixture-ws.sql` 의 주간 행(`2026-08-31` 월) + **월요일 키를 직접 넣는 모든 `tests/rls/**` 임시 프로젝트**(SP4 `tests/rls/weekly-areas.test.ts` 의 `scene()`·`DEL.p` 등 — `create_weekly_report` 를 `'2026-09-07'`·`'2026-08-31'`·`'2026-09-14'` 로 부르고 `weekly_reports` 를 직접 insert 한다, `isolation-map.ts` 의 `weekly_reports` 탐침 포함) + 레인 B 캡처 시드 `scripts/ui-capture.mjs` 의 주간 문서 + 합성 C(월요일). 주차 문서를 넣기 **전에** 설정 행 `values` 에 `calendar.week_start = [{monday,null}]` 을 쓴다(픽스처·RLS 테스트는 SQL update, 캡처 시드·합성은 설정 액션/RPC 경로). 월요일 회귀를 계속 덮는다. **이 선기록과 픽스처 수정은 마이그레이션 앞 커밋 ①** 이다 — `project_settings.values` 의 제약은 `jsonb_typeof='object'` 뿐이고 해석기는 모르는 키를 `unknownKeys` 로 견디므로 마이그레이션 전에도 무해하다. 그래서 ② 마이그레이션 커밋 시점에 `test:rls` 가 초록이고 `Staging-verified` 트레일러가 참이다(§2.5, 비평 반영 — S8). 캡처 시드 수정은 SP4 D53 처럼 레인 A 가 A 에서 하고 컨트롤러가 레인 B 원장에 알린다. 목 데이터만 쓰는 단위 테스트는 DB 트리거와 무관하지만 주 키 정규화·라벨을 거치는 순수 함수의 기대값이 바뀔 수 있다 — 소유 목록(§2.3 A-가드·테스트)에 `tests/data/weeklySheet*.test.ts`·`core-read`·`ai/intent`·`tests/ai/chat-v2-router.test.ts`(`weekStart` 기대)·`tests/ai/golden/{fixtures,cases}.ts`·`tests/ai/tools-dashboard.test.ts`·`tests/domain/{attendance,meetings}.test.ts`·`tests/lib/wbsmd-parse.test.ts`·`tests/scripts/ui-capture.test.ts`·`tests/ui/{wbs-today-scroll,gantt-frozen-overlay-clip,issues-mega-filter}.test.tsx` 를 올리고 A 착수 때 `grep -rln "2026-09-07\|2026-08-31\|mondayIso" tests` 로 다시 센다(E26, 비평 반영 — S8) | C-16. 픽스처 날짜를 일요일로 바꾸면 월요일 경로를 덮는 테스트가 사라진다 | 픽스처 날짜를 일요일로 |
| D29 | **어휘 5키는 B4 에 따로.** `attendance.types`·`meetings.categories`·`issues.severities`·`issues.sources`·`issues.cause_categories` — 레지스트리 정의·편집 화면·DB check 제거(넷 — 원인 분류는 DB check 없음)·어휘 트리거(`enforce_project_vocab`, §2.4.1 잠금 규약)·`settings_ref_check` 어휘 분기·`migrate_setting_code`·소비처(화면 선택지·검증·PPT 라벨·AI 프롬프트·봇) 교체. 고정 어휘 절(`docs/settings-catalog.md`)에는 **범주**만(개정:3614). `issues.sources` 의 `'minutes'` 는 예약(회의록에서 만든 이슈의 원천) | C-21, 정본 Q4 표, 개정 §2.11 SP5 ①·§2.4.1 | — |
| D30 | **SP5 화면의 순수 패턴 이행은 SPU3 로** `[사용자 확인 §8 #10]`. SP5 가 만지는 화면(회의·회의록·이슈·근태·공지·설정 일부)에서 SP5 는 **기능과 그 기능의 새 요소**(첨부 패널·이슈 영역 탭·휴무/근무 선택·달력 첫 열·비근무 요일 색 토큰·코드 표시 등)를 SP3b 패턴으로 만든다. 기존 화면 전체의 `PageHeader`·상태 계약·12px/uppercase 이행(개정 §5.9.4 의 #8·#9·#24·#26·#29·#31)은 SPU3 가 맡는다. 다만 **SP5 가 새로 만드는 파일**(첨부 패널 `MinuteAttachmentsPanel`·이슈 영역 탭·어휘 편집기 등)은 `PageHeader`·상태 계약까지 SP5 가 끝낸다 — 새 파일 한정으로 원칙 4 를 지킨다. SPU3 누적(SP4 D52 넷 + SP5 여섯)은 마감(B2)에서 개정 §6.2 SPU3 노력을 다시 재고 레버 L2(SPU3 를 출시 후로) 영향을 적는다(§9, 비평 반영 — S13) | SP4 D52 선례. 여섯 화면 전면 이행은 +0.75~1.25주로 추정(실측 ⑥ 의 줄일 레버 첫째) — 다섯 체크포인트 어디에 넣어도 상한을 누른다 | 개정 원칙대로 SP5 가 끝낸다(+0.75~1.25주, 한 체크포인트 더) |
| D31 | **눈확인은 에이전트가 헤드리스 브라우저로**(라이트·다크 스크린샷 + 기록, SP3a·SP4 와 같다) `[사용자 확인 §8 #11]`. 사람의 눈확인은 SP3b 의 사용자 게이트(UI-1·UI-2b·UI-3)에 맡긴다 | SP4 D14 선례 | 체크포인트마다 사람 게이트(그동안 쌓는다 — SP4 D49) |
| D32 | **UI 위험 파일 한 줄은 A 에서 `ui/sp5-calendar` 로.** `(app)/layout.tsx` 의 `seoulToday` → 워크스페이스 tz 의 `todayIn`(UI-2b 뒤면 `w/[slug]/layout.tsx` 등 옮겨 간 자리). A 의 다른 커밋과 같은 Phase 브랜치 위에 `ui/sp5-calendar` 를 쌓아 한 번에 반영하고, 그 커밋은 `Preview-checked: local <일시> — <확인 화면>`. UI-2b 가 먼저 머지되면 그 위로 rebase(한 줄) | 개정 §4.2.8 마지막에서 둘째 행, CLAUDE.md 브랜치 규칙. SP4 는 UI-2 와의 충돌 때문에 A 에서 UI 위험 파일을 금지했지만(SP4 D41) SP5 A 의 변경은 한 줄이다 | 마감(B2)으로 미룸(그동안 `seoulToday` 한 곳이 남아 시간대 done_when 이 B2 까지 열린다) |
| D33 | **전용 스택·워크트리.** SP4 와 동시에 돌 수 있으므로(D3 (i)) SP5 는 `/Users/jerry/D-Flow-wt/lane-a-sp5`, `project_id = "d-flow-sp5"`, 포트 **546xx**(메인 543xx·레인 B 544xx·SP4 545xx 와 겹치지 않음), `git update-index --skip-worktree supabase/config.toml`, 래퍼 `/Users/jerry/D-Flow-wt/lane-a-sp5-run.sh`(DSN `127.0.0.1:54622` 고정, 다른 DSN·543xx·545xx 거부 — SP4 `lane-a-run.sh` 와 같은 꼴). SP4 가 끝나 SP4 스택을 내린 뒤에는 SP4 워크트리를 재사용해도 된다(계획이 고른다). 무거운 실행은 두 레인 공유 잠금(`heavy-lock.sh`) | SP4 D42·원장의 DSN 사고("zsh `env $E`") | — |
| D34 | **봇 주간 도구·라우터·플래너의 월요일 강제를 걷는다(A).** `ai/tools/weekly.ts` 의 "기준일은 월요일" 검사 → 그 프로젝트 규칙의 키(`weekKeyOf`), 라우터 `mondayOf`·플래너 `thisWeek/nextWeek/lastWeek` → `weekPeriodOf(weekKeyOf(todayIn(tz)))` 와 이웃 키. SP4 `upsert_project_area(p_from_week)` 의 액션 계산("현 주 월요일") → `weekKeyOf(rules, todayIn(tz))`. RPC 본문은 바꾸지 않는다 | SP4 §9·D24, 실측 S-D7 | — |
| D35 | **이웃 주는 키 함수로.** 시트 이전/다음(`shiftWeeks(±1)`)·보고서·API 의 "±7일"을 `prevWeekKey(key) = weekKeyOf(key − 1)`·`nextWeekKey(key) = weekPeriodOf(key).endExclusive` 로. 과도기 주(6·8일)에서 ±7 은 틀린 키를 낸다 | 개정 §4.2.4·§4.2.8 | — |
| D36 | **워크스페이스 달력.** `getWorkspaceConfig` 가 `calendar.*` 3키를 싣고(`WorkCalendar` 의 `offDates`·`workDates` 는 빈 집합 — 워크스페이스에는 날짜 예외 표가 없다), 워크스페이스 화면(회의록·내 회의·포털·`/usage` 의 필터)의 '오늘'·비근무 요일·월 첫 열은 이 값으로 | 개정 §4.2.6·§4.2.7 | — |
| D37 | **SQL 헬퍼 `is_workday(p_project_id, p_date)`·`week_key_of(p_project_id, p_date)`** — `stable security definer set search_path ''`, EXECUTE 는 어느 역할에도 주지 않는다(호출자는 DEFINER 트리거·RPC 뿐). 설정 행이 없으면 `P0001 SETTINGS_ROW_MISSING`, 값 모양이 손상이면 `22023 CONFIG_INVALID:<key>`(§2.4.1). `week_key_of` 의 규칙 해석·과도기 창(`[E−10, E−4]`)은 TS `weekKeyOf` 와 한 골든 행렬로 묶는다(`tests/rls/calendar-parity.test.ts`). 의존성 트리거 둘의 `isodow < 6 and not exists(holidays)` 3곳 → `public.is_workday(new.project_id, d)` | 개정 §4.2.3·§2.11 SP5 ③ | — |
| D38 | **달력 설정 영향 미리보기 = 서버 계산.** SP3a 의 미리보기 자리(`src/app/actions/settingsPreview.ts`·`src/lib/settings/impactPreview.ts` — 지금은 모듈 영향만)에 읽기 액션 `previewWeekStartChange(projectId, day)`(`requireProjectAdmin`)를 더한다 — `toStored` 와 같은 함수로 E·과도기 주·"기존 주간보고 N건은 그대로"·E 이후 문서 목록(거부 예정)을 돌려준다. 설정 화면 '변경 내용 검토'가 이 값을 보인다. 열거 게이트 manifest 에 등록 | 개정 §2.8.7 영향 행·§5.12.5 SP5 ③ | — |
| D39 | **회의 화면 이월 셋은 B2.** `projectColors.ts`(포트폴리오·내 회의의 프로젝트 점 색) 하드코딩 → `category-*` 토큰(레인 B `no-raw-color` ALLOW 의 그 줄 삭제), 회의록 화면의 팀 막대 패턴 이행(SP4 B 는 색 슬롯만), 회의 화면의 남은 조용한 실패(개정 §8.1 #22 — `getMyMeetings` 인증 오류·`getMeetingDetail`·이슈 `resolveMemberIds`·AI 브리핑 상태·목록 탭 로딩)를 결과형 + 표시로 | SP4 §9, 개정 §8.1 #22, 실측 S-D3~S-D5. B2 가 회의·회의록 화면을 만진다 | — |
| D40 | **`canMoveLeaf` → `canEditMinute` 판정(B2).** 회의록 탐색기의 이동·일괄 지정 어포던스를 상세 화면과 같은 판정으로 — 회의 폴백 프로젝트의 관리자에게 열리는 결함 | 개정 SP5 블록, 실측 S-C6 | — |
| D41 | **`#${issueNo}` 노출 제거(B1).** 화면(`IssuesView`·`IssueQueueCard`)·AI 색인 제목을 `code` 로, 색인 문구 변경은 SP8 재색인 대상 목록에 한 줄. `issue_no` 열은 내부 식별자로 남는다 | 개정 F-issue-no(R4-12) | — |
| D42 | **이슈분석서 `deckPlan` 의 Mega 순서·라벨을 `areas` 주입으로(B1).** 렌더러는 SP6. 영역 9개 이상 출력은 SP6 | 정본 SP5 범위, 실측 S-C19 | — |
| D43 | **합성 게이트**: A 가 S4 의 R(일요일 키)와 S5(달력 집계 — LA·베를린, DST 주)를, B1 이 S6 의 SP5 몫(R 영역 10개·채번 형식 — 표시 상태 흐름은 SP5b)을 켠다. **S1**(각 SP 가 자기 키 입력)의 SP5 몫은 A(`calendar.*`)·B1(`issues.id_policy`)·B4(어휘 5키)가, **S10** 센티널은 A(`Asia/Seoul`·`+09:00`)·B1(`SENTINELS_BY_SP.SP5` 의 8 영역명·`PI-I-` — `sentinelsFor` 로 등록 이름과 같은 것만 제외)·B4(잔여 문자열)가 나눠 켠다(§6.4, 비평 반영 — S13). `scripts/lib/synthetic.mjs` 의 `PENDING_STEPS` 에서 그 몫을 체크포인트마다 지운다. C 의 월요일 규칙은 주차 문서 생성 전에 설정 액션으로(D28) | 개정 §6.5.8 | — |
| D44 | **설정 키 상태**: 각 키는 들어가는 체크포인트에서 `planned → verified` 까지(정의·편집·소비처·테스트). A = `calendar.*` 6(W3·P3), B1 = `issues.id_policy`·`issues.analysis`, B2 = `minutes.root_folders`, B3 = `minutes.attachments`(W·P), B4 = 어휘 5. `PLANNED_KEYS` 에서 그 행을 지우고 `docs/settings-catalog.md` 를 생성기로 다시 만든다 | 개정 §2.11 SP5 ⑤·§6.1 원칙 3 | — |
| D45 | **`no-runtime-constants` 의 SP5 몫은 "허용 목록 SP5 행 0"으로 판정.** 패턴(`Asia/Seoul`·`+09:00`·`9 * 3600_000`)은 이미 있다. 체크포인트마다 자기 몫을 지운다(A = 시간대 계열, B1 = `ISSUE_MEGA_AREAS` 10파일, B4 = 어휘·나머지·잔여 문자열 — B4 끝에 SP5 행 0, 마감(B2)이 다시 확인). 지우는 단위는 **행이 아니라 패턴**이다 — 한 행에 패턴이 둘 이상인 파일(`IssueModals.tsx`·`IssuesView.tsx`·`storedRun.ts` 는 `ISSUE_MEGA_AREAS` + `ISSUE_SEVERITIES`, `domain/meetings.ts` 는 `MEETING_CATEGORIES` + `+09:00`)이 있어, 행은 마지막 패턴이 빠질 때 지운다(비평 반영 — S13) | C-13 | — |
| D46 | **잔여 문자열·봇 근태 유형(B4).** 계정 화면 안내문·`report/weekly.ts` 의 원본 문자열 제거(정본 done_when ① — 원본 고객 문자열 grep 0, 허용 목록 비움), 봇 `attendanceTypesFrom` 을 `attendance.types` 라벨에서 생성(개정 §4.8) | 정본 SP5·개정 §4.8, 실측 S-C17·S-C19 | — |
| D47 | **새 서버 액션·RPC 의 등록.** SP5 가 만드는 액션·라우트(미리보기·첨부 패널 셋·정책 저장은 설정 RPC·`create_team`·영역 편집은 SP4 액션 재사용)는 `tests/gates/manifest.ts` 에 모듈 또는 `null`(사유), RPC 는 `_rpc-tables.ts` 에, service_role 클라이언트를 새로 만들면 `docs/sp2-admin-client-audit.md` 에 분류 | CLAUDE.md 권한 절, SP4 D25 | — |
| D48 | **사용자 DB(메인 스택)는 각 체크포인트의 main 반영 뒤 사용자 확인을 받아 덤프 → `migration up`**(SP4 §8 #10 과 같은 절차) `[사용자 확인 §8 #13 — 그때 묻는다]`. 확정 전 번호를 사용자 DB 에 적용하지 않는다 | K1 — 주 시작 전환·이슈 코드·회의록 팀 id·폴더 종류가 사용자 데이터를 바꾼다 | — |
| D49 | **`minute_folders` 종류 가드 트리거(B2).** `NNNN_minutes_teams` 에 `minute_folders_kind_guard` — `BEFORE INSERT OR UPDATE OR DELETE`, **SECURITY INVOKER**(§3.1 의 DEFINER 규칙의 예외 — 직접 세션 문장과 DEFINER 함수·service_role 이 낸 문장을 `current_user` 로 가르려면 INVOKER 여야 한다. DEFINER 안의 문장은 함수 소유자로 돈다). 세션(`current_user in ('authenticated','anon')`)이면: ① INSERT 는 `kind='user' ∧ team_id is null` 만 ② UPDATE 는 `kind`·`team_id` 변경 거부, `kind <> 'user'` 행의 `name`·`parent_id`·`project_id`·`workspace_id` 변경 거부 ③ DELETE 는 `kind <> 'user'` 행 거부(남이 편철한 하위 폴더가 `parent_id … on delete cascade` 로 같이 지워지는 길을 막는다) ④ 비활성 팀의 `team_root` 아래로 새 폴더를 넣거나 옮기는 INSERT·`parent_id` UPDATE 거부(D20 을 DB 로 — 조상 판독은 세션 RLS 아래에서 하고, 조상을 볼 수 없으면 거부) ⑤ 최상위(`parent_id is null`) `user` 폴더의 이름이 같은 범위 팀 이름(워크스페이스 루트면 그 워크스페이스 공용 팀, 프로젝트 루트면 그 프로젝트의 전용·공용 팀)과 같으면 거부(INSERT 와 `name`·`parent_id` UPDATE 둘 다 — 개명·최상위 이동으로 우회하지 못한다, 재검토 반영 — R9) — 지연 생성(D19 ②)보다 먼저 이름 유일 인덱스를 차지해 팀 루트 생성을 막는 선점을 닫는다. 오류는 42501 `MINUTE_FOLDER_KIND_FORBIDDEN`·23514 `MINUTE_FOLDER_ROOT_INACTIVE`·23505 `MINUTE_FOLDER_NAME_RESERVED`. service_role(지연 생성 `ensureProjectTeamRoot` 는 이미 admin 클라이언트)·DEFINER(`create_team`·`ensure_team_roots`·개명 동기)·FK 연쇄 동작은 통과. 사후검사에 트리거 존재와 `prosrc` 토큰, `tests/rls/minutes-teams.test.ts` 에 세션 위조 다섯(팀 루트 선점 insert·`kind`/`team_id` update·팀 루트 delete 와 하위 폴더 보존·비활성 루트 아래 insert·팀 이름 선점) | 비평 DB P0 — 표 단위 `GRANT ALL … TO authenticated`(`0000:12585`)와 세션 쓰기 정책 셋(`0006:320-329`)이 새 열에도 걸린다. 지금은 `created_by null` 을 세션이 만들 수 없어 루트 식별이 DB 로 지켜졌는데, 식별을 `kind`·`team_id` 로 옮기면 그 보호가 사라진다(비평 반영 — S1) | 열 권한 회수(`revoke insert, update` 뒤 기존 열 목록만 재부여 — 삭제·이름 변경·비활성 루트는 따로 막아야 해서 비권고) |
| D50 | **공용 팀 생성 한 길 + 모드 잠금 + 지연 수렴(B2).** ① `drop policy wsadmin_insert_teams` **만** — 표 단위 `revoke insert` 는 하지 않는다(재검토 반영 — R1: `teams` INSERT 권한은 프로젝트 팀 정책 `pa_insert_project_teams` 의 권한이고, `tests/rls/h2-table-grants.test.ts:79-88` 이 `['teams','INSERT']` 가 참이어야 한다고 단언하며 `isolation-map.ts:102-104`·`fixture-ws.sql:53` 이 프로젝트 팀 분기로 태운다. 그래서 `h2-table-grants`·`isolation-map`·`fixture-ws` 는 무수정을 유지한다). `pa_insert_project_teams` 는 프로젝트 팀(`project_id` 있는 행) 한정이라 루트 보장 대상이 아니다. 공용 팀(`project_id is null`)은 `create_team` 만 만든다(전용 팀은 지금처럼 service_role 경로: `addProjectTeam`·`copyGlobalTeams`·SP4 가져오기·전환 RPC). 사후검사 `pg_policies` 의 `teams` INSERT 정책 가운데 `project_id is null` 행을 허용하는 분기 0(`wsadmin_insert_teams` 부재 + 남은 정책이 `project_id` 에 묶임 — 계획이 정책 전수를 읽어 확인) + RLS 테스트 "세션 공용 팀 insert 거부", 정적 불변식 `tests/invariants/team-create-path.test.ts`(새 — `from('teams')` 의 `.insert(` 는 전용 팀 경로 허용 파일 밖 0건). ② `create_team` 은 워크스페이스 설정 행을 `FOR SHARE` 로 잡은 뒤 `minutes.root_folders.mode` 를 읽는다(§2.4.1 규약을 RPC 에도). ③ `ensure_team_roots(p_actor, p_workspace_id)` 는 워크스페이스 관리자 재판정 → 설정 행 `FOR UPDATE` → 모드를 다시 읽고 teams 일 때만 루트 없는 활성 공용 팀의 루트를 만든다(멱등) — `create_team` 과 직렬화된다. ④ 설정 저장(모드 custom → teams)과 `ensure_team_roots` 는 두 트랜잭션이라 둘째가 실패할 수 있다 — **지연 수렴**: teams 모드에서 루트 없는 활성 공용 팀을 만나는 편철·업로드 경로가 워크스페이스 루트를 지연 생성한다(`ensureProjectTeamRoot` 와 같은 23505 경합 처리). 설정 RPC 는 고치지 않는다 — `ensure_team_roots` 는 설정 4표를 쓰지 않으므로 "설정 쓰기 한 길"과 충돌하지 않고 `settings-writes` 불변식의 RPC 목록에도 넣지 않는다 | 비평 DB P1 둘 — 세션 INSERT 정책(`0003_org_core.sql:609`)이 있으면 RPC 가 "한 길"이 아니고, 모드를 잠그지 않고 읽으면 경합으로 teams 모드에 루트 없는 팀이 생긴다(비평 반영 — S10) | `teams` AFTER INSERT 트리거로 루트 보장(어느 길로 넣어도 같은 트랜잭션 — 세션 정책을 남길 때) / 표 단위 INSERT 회수(`h2-table-grants`·`isolation-map`·`fixture-ws` 를 B2 소유 목록과 §3.7 에 올리고 §3.1 무수정 목록에서 `h2-table-grants` 를 뺀다 — 프로젝트 팀의 세션 insert 도 같이 닫힌다) |
| D51 | **팀 참조 범위 가드와 FK 동작(B2).** `minutes_team_scope`·`minute_folders_team_scope`(`BEFORE INSERT OR UPDATE OF team_id, project_id, workspace_id`, DEFINER) — 팀의 `workspace_id = new.workspace_id ∧ (team.project_id is null ∨ team.project_id = new.project_id)` 아니면 23514 `MINUTE_TEAM_SCOPE`. 무프로젝트 회의록·워크스페이스 루트는 공용 팀만. **예외(재검토 반영 — R4)**: UPDATE 에서 `project_id` 가 not null → null 이고 `team_id` 가 그대로면 판정하지 않는다 — 프로젝트 삭제의 `minutes_project_fk … on delete set null` 연쇄 UPDATE 가 "무프로젝트는 공용 팀만" 에 걸려 프로젝트 삭제가 막히는 것을 피한다(그 회의록의 `team_id` 가 삭제되는 전용 팀을 가리키면 팀 cascade 의 `minutes.team_id on delete set null` 이 정리하고, `minute_folders` 는 `minute_folders_project_id_fkey` cascade 로 같은 문장에서 지워져 대상이 아니다). 기존 팀 참조 열 넷의 `*_TEAM_SCOPE` 가드(`0003_org_core.sql`·`0009`)와 같은 꼴이고, M1(D19 ④)은 그 위에 얹힌다. FK 동작: `minutes.team_id … on delete set null`(D18), `minute_folders.team_id … on delete no action`(개정 SQL 의 `restrict` 를 고친다 — 프로젝트 삭제가 전용 팀과 그 프로젝트 루트를 한 문장에서 같이 지우므로 문장 끝에 검사하는 NO ACTION 은 통과하고, 공용 팀 삭제는 루트가 있으면 막힌다 — E28). 리허설에 "전용 팀·회의록·폴더가 있는 프로젝트 삭제" 한 경우(**프로젝트 삭제 통과는 이 경우가 확인하는 것이지 설계가 단언하는 것이 아니다** — R4), `minutes-teams.test.ts` 에 교차 워크스페이스·교차 프로젝트 케이스 | 비평 DB P1 둘 — 회의록은 RLS 쓰기 정책이 없어 액션이 받은 `team_id` 를 service_role 로 쓰면 DB 방어선이 0이고 메아리 트리거가 남의 팀 code 를 옮겨 적는다. `teams_project_id_fkey … on delete cascade` 아래에서 RESTRICT 는 프로젝트 삭제를 막는다(비평 반영 — S10) | — |
| D52 | **팀 루트 이름 이관·동기의 제약(B2).** 이관은 팀 루트 이름을 `teams.name` 으로 맞춘다(개정은 이름을 건드리지 않는다 — E27: SP4 D37 이 개명을 폴더에 전파하지 않고 SP5 로 넘겼으므로 개명 동기의 시작점을 맞춘다). ① **사전검사 `MINUTES_TEAMS_PRECHECK`**(23514) — 맞춘 뒤 같은 범위 루트 이름 유일 인덱스(`minute_folders_root_name_null_proj_uniq`·`minute_folders_root_name_proj_uniq`)에서 겹치는 폴더 목록과 `length(btrim(teams.name)) > 60`(폴더 이름 CHECK `between 1 and 60`) 팀 목록을 `left(…, 600)` 로 적고 멈춘다(조치: 겹치는 폴더 개명 / 팀 이름 60자 이하로). ② 개명 동기(D20)는 `left(btrim(name), 60)` 을 쓰고, 겹치면 23505 `TEAM_ROOT_NAME_CONFLICT`, 60자 초과면 23514 `TEAM_ROOT_NAME_TOO_LONG` — 개명 액션이 문구로 돌려준다. `create_team`(루트를 만드는 teams 모드)도 같은 두 오류를 쓰고 **60자 초과 이름을 절단하지 않고 거부**하며, `addTeam` 액션이 그 문구를 돌려준다(재검토 반영 — R9). ③ **롤백이 폴더 이름도 되돌린다** — `team_id` 를 지우기 전에 `update minute_folders f set name = t.code from teams t where f.kind = 'team_root' and t.id = f.team_id`(충돌 시 raise·조치 문구), 리허설에 "롤백 → 옛 조회(`parent_id null ∧ created_by null ∧ name = code`)로 루트 발견". ④ 외부 업로드 응답의 `folder_path[0]` 는 teams 모드에서 팀 **code** 를 유지한다(v2.8 불변 — 표시용 폴더 이름과 분리, v2.9 절에 한 줄) | 비평 DB P1 둘·실행 P2·충실도 P2 — 루트 이름 유일 인덱스 둘과 60자 CHECK 가 있고 `teams.name` 은 무제약이라 이관 한 줄이 23505/23514 로 파일 전체를 멈춘다. 이름을 안 되돌리면 롤백 뒤 옛 코드가 루트를 못 찾고 code 이름 루트를 하나 더 만든다(비평 반영 — S10·S12) | 이관은 이름을 건드리지 않고 개명 동기만 이후 개명에 적용(충돌 위험 0, 개명 전까지 code 로 보임) / 이름 유일 인덱스를 `kind <> 'team_root'` 로 다시 만듦 |
| D53 | **`settings_ref_check('calendar.week_start')` = 정확 판정(A).** "첫 차이 위치" 규칙을 버린다 — 새 규칙 = `week_rules_of(coalesce(p_new, '[{"day":"sunday","from":null}]'))`(**unset(null) = 제품 기본값 일요일** — `apply_project_settings` 는 `p_unset` 키를 새 값 null 로 부른다), 그 프로젝트 주간 문서 가운데 `week_key_from_rules(<새 규칙>, d.week_start) <> d.week_start` 인 행이 하나라도 있으면 `CONFIG_IN_USE`(detail 에 해당 `week_start` 최대 20). 키 계산은 판독형 `week_key_of(p_project_id, p_date)`(설정을 읽는다)와 규칙 인자형 순수 헬퍼 `week_key_from_rules(p_rules jsonb, p_date date)`(immutable, EXECUTE 무부여) 둘로 가르고, 주 키 트리거는 잠근 `values` 로 순수 헬퍼를 부른다(D8). 미리보기(D38)도 같은 정의 — "새 규칙에서 키가 바뀌는 문서 = 거부 예정". 과거 원소 수정 금지(`from ≤ T`)는 TS `toStored` 가 그대로 판정한다. 골든 행렬(D37)에 "미적용 전환을 더 늦은 날로 교체 — 사이 문서 있음 → 거부"와 "unset → 기본 일요일(월요일 문서 있으면 거부)" 두 행 | 비평 DB P1 — 옛 `[mon@null, sun@E1]` → 새 `[mon@null, sun@E2]`(E2 > E1)이면 첫 차이 규칙은 `≥ E2` 만 세어 `[E1, E2)` 의 일요일 키 문서를 놓친다(같은 주 문서가 하나 더 생기고 기존 문서가 화면에서 사라진다). 주간 문서는 프로젝트당 연 52건 수준이라 전수 비용이 작고, TS 와 손으로 맞추는 일이 사라진다(비평 반영 — S2) | — |
| D54 | **시간대 값 검증(A).** TS 는 `new Intl.DateTimeFormat('en', { timeZone: tz })` **생성 성공**으로 판정하고(목록 포함 여부가 아니다 — Node 22 의 `Intl.supportedValuesOf('timeZone')` 에는 `'UTC'`·`'Etc/UTC'` 가 없다), 저장 값은 `resolvedOptions().timeZone`(대소문자·별칭 정규화). **오프셋 꼴 거부**(재검토 반영 — R5): 정규화 결과가 IANA 이름 꼴 `^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$` 이어야 한다 — 최신 V8 은 `+09:00` 같은 오프셋 문자열도 생성에 성공시키는 것으로 알고 있고(실행해 확인하지 않은 추정) 그 값이 저장되면 PG `at time zone` 이 POSIX 꼴로 읽어 부호를 반대로 해석해(UTC−9) TS·SQL 일자가 어긋난다. 단위 테스트에 `+09:00`·`GMT+1`·`EST` 를 넣어 거부하거나(`EST` 처럼 이름 꼴을 지나는 값은 PG 와 같은 뜻임을 대조 테스트가 확인한다) 한다. 실패면 `CONFIG_INVALID:calendar.timezone`(폴백 없이 거부). DB 쪽 마지막 방어: `settings_ref_check` 에 `calendar.timezone` 분기 — `now() at time zone <값>` 이 22023 이면 `CONFIG_INVALID:calendar.timezone`(프로젝트만 — 워크스페이스 tz 를 읽는 SQL 은 없다, 사용현황 RPC 는 TS 가 넘긴다). **TS·SQL 허용 집합 대조 테스트**(`tests/rls/calendar-parity.test.ts`): TS 가 받는 이름(`Intl.supportedValuesOf('timeZone')` ∪ `{'UTC','Etc/UTC'}` 가운데 TS 검증을 지나는 것)은 PG 의 `at time zone` 이 모두 받는다(TS ⊂ PG, 역은 요구하지 않음). 단위 표본에 `UTC`·`Asia/Seoul`·`America/Los_Angeles`·`Europe/Berlin`·`Asia/Kolkata`·`Europe/Kyiv` | 비평 충실도 P1·DB P1 — "목록 포함·폴백 없이 거부"는 제품 기본값 `'UTC'`·`BOOTSTRAP_TIMEZONE` 기본값·`/usage` 전체 합산을 거부한다. TS 만 통과한 값이 PG 에 없으면 그 프로젝트의 이슈 insert 가 채번 트리거에서 막힌다(E29, 비평 반영 — S4) | — |
| D55 | **영역 없는 기존 이슈 = 이관 전용 레거시 코드(B1).** ① `{area}` 정책이 되는 프로젝트(PI 코드 보유)의 미분류 기존 이슈(`mega_code is null` — 영역이 없다)는 **이관 SQL 이 채번 트리거를 만들기 전에** 고정 레거시 형식 `{prefix}-U-{seq:3}`(예: `PI-U-001`), `code_scope = 'legacy'`(별도 카운터 행), `code_area_id = null` 로 `(created_at, issue_no)` 순서로 발번한다. PI 템플릿 `{prefix}-I-{area}-{seq:2}` 와 겹치지 않음을 렌더 검증으로 고정한다. PI 코드가 없는 프로젝트는 정책 키가 없어 제품 기본값 `ISS-{seq:3}` 로 발번한다(영역 불필요 — 레거시 아님). ② **이관 뒤 등록 규칙**: 채번 트리거는 `legacy` 범위를 쓰지 않는다 — 레거시 범위는 늘지 않는다. `{area}` 정책 프로젝트의 모든 insert 경로는 영역 필수(`ISSUE_AREA_REQUIRED`) — 일반 등록은 지금도 Mega 영역 필수(`createIssue` 의 `validateInput('normal-create')`)라 현행 그대로이고, 회의록 블록 경로는 §4.6 대로. 레거시 코드 이슈에 나중에 영역을 붙이는 것은 허용 — 갱신 규칙은 "`code_area_id` 가 not null 이면 `area_id` 는 그 값과 같아야 한다, null 이면 자유"(`is distinct from` 으로 쓰면 ISS·레거시 이슈의 나중 분류가 전부 거부된다). ③ **롤백 조건 = 모든 `issue_area` code 가 `^[0-9]{2}$`** 하나(개정의 "템플릿 밖 발번 0건"을 뺀다). PI 템플릿과 일치하는 코드의 이슈만 `mega_code`·`mega_seq`·`pi_issue_code` 를 되살리고, 나머지(레거시·`ISS-…`·템플릿 밖)는 세 열 모두 null — 옛 스키마의 '미분류 이슈'로 돌아가 옛 CHECK(mega ⇔ 코드)가 성립한다(mega 를 잃는 이슈의 `major_id` 는 기준선 일관성 CHECK 에 맞춰 계획이 정한다). 잃는 것(그 코드 문자열·영역 분류)은 롤백 머리 주석의 "되돌리지 않는 데이터". ④ 리허설: **코드 없는 이슈가 있는 시드(PI 프로젝트의 미분류 이슈 + 코드 없는 프로젝트)에서 적용 → 롤백 → 재적용 초록** | 비평 충실도 P1·DB P1 둘 — 개정 이관 2 는 영역 없는 행을 `{area}` 정책으로 발번할 수 없고(이관이 raise 하거나 임의 구현), 개정 롤백 조건은 이관 2 가 템플릿 밖 코드를 매기므로 이관 직후에도 거의 늘 거짓이라 리허설 왕복이 성립하지 않는다(E30, 비평 반영 — S5) | 'UNASSIGNED' 영역을 만들어 붙임(사용자 데이터에 가짜 영역 — 비권고) / 영역 없는 등록은 제품 기본 패턴으로 계속 발번(레거시 범위가 계속 늘고 한 프로젝트에 두 형식이 섞인다) |
| D56 | **톰스톤 쓰기 길·전이 가드·읽기 제외(B3).** ① 톰스톤은 **service_role** 로 쓴다 — `removeMinuteFile` 이 지금과 같은 가드(`requireActor` → `checkOwner` = `can_manage_minute` 동등) 뒤에서 `update minute_files set deleted_at = now(), deleted_by = <actor> where id = … and role = 'attachment' and deleted_at is null`(회의록 계열 관례 — `deleteMinute` 가 `adminOr` 로 보관 RPC 를 부르는 꼴). **세션 열 UPDATE 는 다시 열지 않는다**(`0011` 회수 유지). `docs/sp2-admin-client-audit.md` 에 분류. ② `NNNN_attachments` 에 **모든 역할에 걸리는** `minute_files_mutation_guard`(BEFORE UPDATE) — 허용 전이는 (a) `deleted_at` null → not null(같은 문장에서 `deleted_by` not null) (b) `deleted_at` not null 일 때 `purged_at` null → not null (c) `uploaded_by`·`deleted_by` 가 not null → null 이고 다른 열은 그대로 — FK `minute_files_uploaded_by_fkey … on delete set null`(`0000:9610-9611`)의 계정 삭제 연쇄 UPDATE(`accounts.ts`·`inviteRedeem.ts` 의 `deleteUser`)를 막으면 업로드한 첨부가 있는 계정을 삭제할 수 없다(재검토 반영 — R3) 셋뿐, 되돌림(되살리기)과 그 밖의 열(`file_path`·`size`·`mime`·`minute_id`·`role`·`uploaded_by`(not null → null 은 (c) 가 허용)) 변경은 23514 `MINUTE_FILE_IMMUTABLE`. ③ 세션 첨부 DELETE 정책 `attachment_delete_minute_files`(`0007`)를 지우고 **`revoke delete on public.minute_files from authenticated`** 를 함께 한다 — 톰스톤이 첨부의 유일한 삭제 길(세션 하드 삭제는 `deleted_by` 기록을 건너뛴다). 정책만 지우면 DELETE 권한은 있고 정책은 없는 상태가 되어 `h2-table-grants` 의 `DML_WITHOUT_POLICY`(정책 없는 DML 권한 0)가 깨진다(기준선 `0000:12577` 이 DELETE 를 부여 — 재검토 반영 — R2). 계획이 `minute_files` 세션 DELETE 의 다른 사용처를 grep 으로 0 확인하고, 있으면 남기는 이유를 적는다. 산출물·이슈 첨부의 삭제(`removeStoredAttachment` 공용)는 바꾸지 않는다 — 회의록 첨부만 톰스톤이다. ④ **읽기 제외**: 톰스톤 행을 읽는 경로(`data/minutes.ts` 상세·`repositories/supabase/minutes.ts`·`ai/tools/minutes.ts`·`getMinuteFileUrl`·내보내기·위키 색인 입력)는 `deleted_at is null` 만 반환·서명한다. ⑤ 사용자 응답: 톰스톤 기록이 성공하면 삭제 성공(화면에서 사라진다), 객체 삭제 실패는 서버 로그 + 청소 잡 재시도(D26) — 사용자에게 오류를 보이지 않는다(그 시점 사용자 의도는 이뤄졌다). 테스트(`minute-attachments-policy.test.ts`): service_role 로 `deleted_at → null` 거부, `file_path` 변경 거부, 톰스톤 행 서명 발급 거부, 목록 0건, 세션 DELETE 거부, **업로더 계정 삭제 → 첨부 행이 `uploaded_by null` 로 남음**(R3), `h2-table-grants` 무수정 초록(`minute_files` DELETE 권한 회수 — R2) | 비평 DB P1·실행 P2 — D23 이 톰스톤을 한도에서 빼므로 `deleted_at` 을 되돌리는 길이 하나라도 있으면 "10개 → 5개 톰스톤 → 5개 더 → 5개 되살림 = 15개"로 개수 한도를 우회한다. 세션 열 UPDATE 재개방은 그 길을 PostgREST 에 연다(비평 반영 — S6) | — |
| D57 | **이관 기록 형식 = 0012 꼴(A·B1).** 설정 값을 기록하는 이관 절은 RPC 를 거치지 않고 직접 쓴다: 범위 행마다 한 번, 바뀐 키가 있을 때만 `revision = revision + 1`·`updated_at = now()`·`updated_by = null`, **`schema_version` 은 건드리지 않는다**(해석기는 `schema_version > SETTINGS_SCHEMA_VERSION` 이면 `schemaAhead`), 이력은 바뀐 키마다 `(revision+1, key, old_value = 이전 값(없으면 null), new_value, source='migration', command_id = 범위 행마다 gen_random_uuid(), changed_by null)`. 한 파일 안의 여러 이관 절(A 의 ⑨·⑩, B1 의 모듈 편입·`issues.analysis`·`id_policy`)은 한 revision 으로 묶는다. RPC 를 거치지 않으므로 `settings_ref_check` 가 돌지 않는다 — A 의 ⑩ 은 사전검사(`CALENDAR_PRECHECK`)가 대신한다 | 비평 DB P2 — `0012_settings.sql` 이행이 직접 update + 키마다 이력 행이었고, 이력은 `unique (project_id, revision, key)` 다(비평 반영 — S13) | — |
| D58 | **어휘 트리거는 값이 바뀐 행만 판정하고 교착은 재시도로(B4).** ① `enforce_project_vocab` 는 `tg_op = 'UPDATE' and new.<열> is not distinct from old.<열>` 이면 설정 잠금 없이 통과한다(SP4 M1 의 "새로 생기는 참조만"과 같은 규칙 — 폼이 모든 열을 보내도 값이 같으면 판정하지 않는다). ② 남는 창(같은 순간 그 code 로 바꾸는 편집 대 `migrate_setting_code`)은 40P01 → 503 재시도를 `migrate_setting_code` 액션과 근태·회의·이슈 쓰기 액션의 공통 매핑으로 둔다. `config-vocabulary.test.ts` 에 "동시 편집 대 이관 — 한쪽 40P01, 고아 0". ③ `migrate_setting_code` 는 이관 건수를 **반환값으로만** 돌려 화면에 보이고 이력을 남기지 않는다 — 이력 표에 주석 열이 없고 값 불변 명령에 이력을 남기지 않는 것이 `apply_project_settings` 의 계약이다(뒤따르는 code 삭제 명령이 이력을 남긴다) | 비평 DB P2 둘 — 사용자 편집(행 잠금 → 트리거의 설정 `FOR SHARE`)과 `migrate_setting_code`(설정 `FOR UPDATE` → 참조 행 update)가 엇갈리면 40P01. 이력 표는 `unique (project_id, revision, key)` 라 revision 을 올리지 않은 같은 키 행은 23505(비평 반영 — S13) | 이력을 남김 — revision+1·`source='internal'`·`old_value = new_value` + 건수 열을 0012 이력 표에 추가 |
| D59 | **성능 게이트(A·B1).** A 체크포인트 조건에 SP3a 와 같은 방법(`scripts/perf-baseline.mjs` — 대시보드·WBS·이슈·가져오기 800행)으로 **p95 비율 ≤ 1.20**, 기록 `docs/baseline/sp5-perf.md`. B1 에 동시 채번 100건의 p95 를 같은 문서에. 위반 시 조치: 헬퍼를 `language sql stable` 로 풀거나, 의존성 트리거 세 곳을 규칙을 한 번 읽는 집합형 헬퍼 `has_workday(p_project_id, p_from, p_to)` 로 바꾸거나, 로더에서 `holidays` 를 `calendar` 요청 캐시에 합친다 | 비평 실행 P2 — D11 이 `getProjectConfig`(src 27파일)에 `holidays` 끝까지 읽기를 얹고 D37 이 의존성 트리거에서 날마다 `is_workday`(설정 행 + 휴일 조회)를 부른다. SP2·SP3a 는 p95 ≤ 1.20 게이트를 뒀다(`docs/baseline/sp3a-perf.md`, 가장 높은 값 1.12)(비평 반영 — S13) | — |
| D60 | **시각 표시의 locale(A).** 시각 표시 컴포넌트(승인 큐·에이전트 허브·좌석 배치·위키 공유·usage 셋·초대 관리·어시스턴트 등)는 `timeZone` prop 을 필수로 받고 **`locale` 인자를 받게만** 한다 — 값 공급(개인 `locale` 키, 개정 §2.8.5)은 레인 B 소유라 SP5 는 값이 없으면 지금의 `ko-KR` 을 쓴다(§9 에 받는 쪽 기록) | 비평 충실도 P2 — 개정 §5.12.5 SP5 ①·§5.12.4("시각은 유효 locale·시간대를 따른다")의 locale 이 초안 어디에도 없었다(비평 반영 — S13) | SP5 가 개인 `locale` 키까지 읽음(레인 B 소유 파일과 겹친다) |

### 1.3 상위 문서 대비 정정(실측)

| # | 상위 문서의 말 | 실측(근거) | 이 문서의 처리 |
|---|---|---|---|
| E1 | 개정 §4.2.1 "`project_settings.working_days`·`timezone` 컬럼은 있으나 판독 0건"(근거 `src/lib/data/projectConfig.ts:39`) | 0012 가 두 열을 지웠다(`0012_settings.sql:472-473`). 해석기는 `src/lib/settings/projectConfig.ts` 다(C-2) | 정정만. 이관할 옛 값이 없으므로 tz 의 출처는 이관 SQL 의 `'Asia/Seoul'` 리터럴 하나다(D13) |
| E2 | 개정 §4.2.3 주 키 트리거 근거 — "RLS 가 관리자 insert(`0000:11321`)와 멤버 update(`0000:11335`)를 PostgREST 직접 쓰기로 허용하므로 서버 액션 검증만으로는 부족" | SP4 D27 이 `weekly_reports` INSERT·DELETE 정책을 지우고 UPDATE 를 열 `(title)` 로 좁힌다. 생성은 DEFINER RPC `create_weekly_report` 한 길이고 그 RPC 는 주 키 요일을 검사하지 않는다(SP4:346)(C-3) | D8 — 트리거 유지, 근거를 "RPC·service_role 경로의 마지막 방어 + 설정 RPC 와의 직렬화"로. 잠금 순서를 적는다 |
| E3 | 개정 §2.8.7 단일 출처 — `mondayOf\|mondayIso\|(dow \+ 6) % 7` 금지 | 놓치는 사본: `ai/chat/planner.ts` 주 범위(`day === 0 ? 6 : day - 1`), `ai/tools/weekly.ts` 월요일 강제(`getUTCDay() !== 1`), `WbsGanttSheet.tsx` 주 끝(`(end.getUTCDay() + 6) % 7`), `scripts/ui-capture.mjs` 시드(C-4) | D9 — 일반형 정규식 + `scripts/**` + 닫힌 허용 목록 |
| E4 | 개정 §4.2.8 소비처 전수 | 표에 없는 7건(C-5 ①~⑦) | D10·§4.4 재작성 |
| E5 | 개정 §4.2.3 주입 행 — "`getComputedWbs` 가 따로 싣는 `holidays` 는 이 값으로 대체" | `holidays` 판독은 7곳이다. `kind` 도입 뒤 `date` 만 읽으면 `work` 행을 휴무로 오판한다(C-6) | D11 — 로더 하나 + 불변식 |
| E6 | 개정 §4.2.3 — 휴일 upsert 최신 정의 = `0009_sp2_isolation_fixes.sql:183-187,250-254` | SP4 `_command_receipts` 가 `import_wbs`·`replace_wbs` 를 이름 한정으로 다시 만든다(SP4 D34, SP4 워크트리 `0014_command_receipts.sql` 의 `CREATE OR REPLACE FUNCTION public.import_wbs`·`replace_wbs`)(C-7) | D12 |
| E7 | 개정 §4.7 SQL·§6.3 `0017` 설명 — `minute_folders` 만 바꾼다 | 정본 SP5(`정본:2967`)·SP4 블록(개정:3567)·SP4 §9(SP4:914)·§4.7 표("회의록 `team_id` 필수/선택")는 `minutes.team_id` 가 있다고 전제한다. 현행 `minutes.team_code text NOT NULL`, 수신 RPC `p_team_code`(최신 `0007_storage_realtime.sql`)(C-8) | D18 |
| E8 | 개정 §4.7 — "팀 생성 = RPC `create_team` 한 트랜잭션에서 팀 + `team_root`" | teams 모드의 "팀마다 루트"에 걸리는 경로가 넷이다: 공용 `addTeam`, 전용 `addProjectTeam`·`copyGlobalTeams`(지금 지연 생성 `ensureProjectTeamRoot`), SP4 가져오기의 전용 팀(SP4 D4), SP4 전환 RPC(D54)(C-9) | D19 |
| E9 | 개정 SP5-7 톰스톤 / SP5-5 "가드가 같은 유효 정책" | H2-h 가드는 `role='attachment'` 행 전체로 개수·중복을 센다. 크기·총량·확장자·enabled 검사가 없다(`0011:606-667`)(C-10) | D23 |
| E10 | 개정 §2.8.2 `minutes.attachments`(P) "이 키를 읽는 것은 그 프로젝트의 회의록 첨부뿐" | 무프로젝트 회의록(`minutes.project_id` null)의 정책 출처가 없다(C-11) | D24 — 워크스페이스 키 |
| E11 | 개정 MIN-ATT — 외부 메타 API 언급 없음 | `api/v1/minutes/meta/route.ts` 가 `max_attachments`·`max_attachment_bytes` 로 상수를 광고한다(C-12) | D25 |
| E12 | 개정 §4.2.9 — "`no-runtime-constants` 패턴에 `\+09:00\|9 \* 3600_000` 을 추가해 0건" | 패턴은 이미 있다(`tests/settings/no-runtime-constants.allow.ts`), `removedBy: 'SP5'` 는 **39행**(허용 목록 파일 기준 — 실측의 "45개"를 고친다, 비평 반영 — S13)이고 한 행에 패턴이 둘 이상인 행이 있다(C-13) | D45 — "허용 목록 SP5 행 0", 패턴 단위로 지운다 |
| E13 | 개정의 줄 번호 전반, "`Asia/Seoul` 리터럴 25파일 30건" | 이미 밀렸다(`router.ts:104-108` → `:110-113` 등 실측 C-14 표). 리터럴은 src 24파일 29줄(주석 포함). SP4·SP3b 머지 뒤 더 밀린다 | 심볼로 가리키고 줄은 착수 때 다시 잰다(D10) |
| E14 | 개정 §6.3 번호표 — SP5 = `0015`~`0018`, 리허설 이름 `0015_calendar_week_start.sql`·`0016_issue_areas_smoke.sql`. `0011_authz_hardening.sql` 의 주석 "SP5 0017 이" | SP4 가 `0013`~`0015` 를 쓰고 레인 B `account_preferences` 가 하나 더 받는다 → SP5 첫 번호 `0016`/`0017`. SP5 는 파일이 다섯(D2)(C-1) | D2. 적용된 마이그레이션의 주석(`0011`)은 고치지 않는다(기록). 개정 §6.3 표는 마감(B2) 문서 커밋이 고친다 |
| E15 | 개정 §4.4.3 — "`create_issue_from_minute_block`(`0000:1928`)의 반환 `(issue_id, issue_no, pi_issue_code)` → `(issue_id, code)`. 호출부 `actions/issues.ts:858`" | 인자도 바뀐다 — `p_mega_code` 로 `issue_mega_areas` 의 활성 영역을 검사하고 `issue_major_processes(mega_code)` 를 만든다(이 초안이 0000 본문 확인). 호출부는 `actions/issues.ts` 의 `createIssueFromMinuteBlock`(지금 `:891` 근처) | D15 — 시그니처째 교체 |
| E16 | 개정 SP5 블록 노력 5~5.5주, Phase 셋 | 실측 ⑥ 의 재산정 7.75~9.75주. 이 문서는 9.45~12.1주(고정 비용 포함, §2.2 — 비평 반영으로 늘어난 일 포함) — 개정의 약 1.8~2.2배. B2 가 어휘를 품으면 상한을 넘는다(C-21) | D1·§2.2 |
| E17 | 개정 §8.1 #3 닫는 시점 "G0-2(이 문서 승인 때 함께)" | G0-6-4 판정이 "권고 기본값으로 진행, 사용자에게 확인 요청 — SP5 착수 전 되돌림 가능"(`.superpowers/g0/progress.md:12`), 게이트 문구는 "SP5 착수 전에 닫는다"(개정:3365). 둘 다 아직 사용자 답이 없다(C-18) | §8 #1·#2 를 "SP5 착수 전 사용자 결정"으로 — 기본값으로 진행 |
| E18 | 개정 §2.11 픽스처 표의 SP5 행 — "`fixture-ws.sql:97` 의 월요일 주차가 깨진다" | 더 깨지는 곳: 레인 B 캡처 시드 `ui-capture.mjs` 의 주간 문서(이번 주 월요일), 합성 C 의 S4(월)(SP4 D40)(C-16), **SP4 `tests/rls/weekly-areas.test.ts` 의 임시 프로젝트**(월요일 키로 `create_weekly_report` 15회 이상·직접 insert — 픽스처 선기록으로 덮이지 않는다)와 `isolation-map.ts` 의 주간 탐침 | D28 — 모두 월요일 규칙을 먼저 기록, 마이그레이션 앞 커밋 ① 로(비평 반영 — S8) |
| E19 | 개정 §4.2.6 봇 행 — "요청에 `projectId` 가 있으면 프로젝트, 없으면 워크스페이스" | 플래너의 날짜 앵커는 요청 하나에서 여러 프로젝트를 도구로 조회할 수 있다 — 도구마다 tz 를 다시 계산하면 '이번 주'가 도구마다 다르다(C-19) | D13 ③ — 앵커는 요청 범위 tz 하나 |
| E20 | 개정 §4.4.2·SP5 블록 — 모듈 분리(`/api/issue-analysis` 이전) | 열거 게이트 manifest 의 이슈 항목과 SP4 의 RPC↔표 대응(`_rpc-tables.ts`)이 모듈별 재분류를 요구한다(C-20) | D16 |
| E21 | 개정 §4.2.8 — `report/week.ts` 이웃 주는 표에 있으나 "±7일" 계산이 남는 곳(API·보고서 이웃 주)을 따로 말하지 않는다 | 과도기 주(6·8일)에서 ±7 은 틀린 키 | D35 |
| E22 | 개정 SP5 블록 — 화면 소유(§6.1 원칙 4)는 SP5 가 만지는 회의·회의록·이슈·근태·공지 화면을 SP3b 패턴으로 끝내라 한다(§5.9.4 #8·#9·#24·#26·#29·#31) | 그 이행은 SP5 추정(개정)에 없다. SP4 는 같은 사정으로 순수 패턴을 SPU3 로 넘겼다(SP4 D52) | D30 — 기본값 SPU3, §8 #10 |
| E23 | 개정 §2.8.2 `holidays` 행 "입력 경로 셋(`ScheduleManager`·Excel·`/api/v1/wbs/import`)" | `ScheduleManager` 의 쓰기는 세션 클라이언트 + RLS `admin_write_holidays`(`addHoliday` 의 upsert — `kind` 인자가 없다). 실측 ③-3 이 "세션 직접 쓰기도 `work` 를 넣을 수 있다 — 정상 경로인지 스펙이 정할 것"으로 남겼다 | D7 — 정상 경로로 둔다 |
| E24 | 개정 §4.2.3 `is_workday` 주석 "없으면 `{1..5}`" | 런타임 상속이 없고(S1) 설정 행은 행 생성 트리거가 늘 만든다 — "키 없음"은 제품 기본값 `[1..5]`, "행 없음"은 `SETTINGS_ROW_MISSING`(§2.4.1) | D37 — 둘을 가른다 |
| E25 | 개정 §2.8.1 `minutes.root_folders` 편집 W | §8.1 #15 가 "송부 전 배포에서는 custom 모드를 켜지 않는다"고 하므로 워크스페이스 관리자가 화면에서 고를 수 있으면 규칙이 화면에 없다 | D21 — custom 은 SP7 전까지 화면에 숨김 |
| E26 | 실측 C-16 의 "목 데이터 테스트(`weeklySheet*`·`core-read`·`ai/intent`)는 확인 필요" | 단위 테스트는 DB 트리거를 거치지 않는다 — 주 키 정규화를 거치는 순수 함수의 기대값만 바뀔 수 있다 | D28 — 기대값이 바뀔 수 있는 파일을 소유 목록에 올리고 A 착수 때 다시 센다(비평이 20여 파일을 찾았다, 비평 반영 — S8) |
| E27 | 개정 §4.7 이관 — "팀 code 와 이름이 같으면 `team_root`(team_id)". 이름은 건드리지 않는다. 개명 행은 "트리거가 `minute_folders.name` 동기" | SP4 D37 이 개명을 폴더에 전파하지 않고 SP5 로 넘겼으므로, 이관 시점에 이미 code ≠ name 인 팀이 있을 수 있다. 루트 이름 유일 인덱스 둘(`0006:117`·`0000:8452`)과 60자 CHECK 가 있고 `teams.name` 은 무제약이다 | D52 — 이관이 이름을 `teams.name` 으로 맞추고(개명 동기의 시작점) 사전검사·롤백 이름 복원·외부 에코 code 유지(비평 반영 — S12·S10) |
| E28 | 개정 §4.7 SQL — `minute_folders.team_id … on delete restrict`, 개정에 `minutes.team_id` 없음(E7) | `teams_project_id_fkey … on delete cascade`·`minute_folders_project_id_fkey … on delete cascade`·`minutes_project_fk … on delete set null`(`0000:9635,9707`) — RESTRICT 는 프로젝트 삭제를 즉시 거부한다(여기까지는 코드에서 읽은 사실). **추정**(재검토 반영 — R4): 프로젝트 삭제 때 RI 가 `UPDATE minutes SET project_id = NULL` 을 실행하면 `UPDATE OF project_id` 범위 가드가 발화하는데, 발화 순서가 RI 트리거 이름(OID) 순이고 기준선의 FK 생성 순서가 minutes(`0000:9707`) → teams(`0000:9891`)라서 그 회의록의 `team_id` 가 아직 삭제 전 전용 팀이면 걸릴 수 있다 — 순서는 읽어서 추정한 것이고 실행으로 확인하지 않았다 | D51 — `minute_folders.team_id` NO ACTION, `minutes.team_id` SET NULL(비평 반영 — S10). 프로젝트 삭제의 `project_id` not null → null 연쇄는 범위 가드가 판정하지 않는다. "프로젝트 삭제 통과"는 단언이 아니라 리허설 경우로 확인한다(재검토 반영 — R4) |
| E29 | 개정 §2.8.1·§2.8.2·§4.2.2 `calendar.timezone` 검증 — "`Intl.supportedValuesOf('timeZone')` 에 포함. 폴백 없이 거부" | Node 22 의 목록(418개)에 `'UTC'`·`'Etc/UTC'` 가 없다 — 제품 기본값 `'UTC'` 가 거부된다. SQL 은 `at time zone`·`pg_timezone_names` 라 허용 집합이 다르다 | D54 — `Intl.DateTimeFormat` 생성 성공 + 오프셋 꼴 거부(재검토 반영 — R5) + TS ⊂ PG 대조 테스트(비평 반영 — S4) |
| E30 | 개정 §4.4.3 이관 2("코드 없던 이슈는 프로젝트 정책으로 발번")·롤백 조건("새 정책(영역별 템플릿 밖)으로 발번한 이슈 0건", 개정:2167) | `{area}` 정책 프로젝트의 미분류 이슈는 영역이 없어 그 정책으로 발번할 수 없다. 이관 2 가 템플릿 밖 코드를 매기므로 롤백 조건이 이관 직후에도 거의 늘 거짓 — 리허설 왕복이 성립하지 않는다 | D55 — 이관 전용 레거시 형식(`code_scope='legacy'`), 롤백 조건은 영역 code 숫자 2자리 하나, 템플릿 밖 코드는 롤백이 버린다(비평 반영 — S5) |
| E31 | 개정 §4.7 — "팀 생성 = RPC `create_team` 한 트랜잭션에서 팀 + `team_root`" | 세션 INSERT 정책 `wsadmin_insert_teams`(`0003_org_core.sql:609`)가 있어 RPC 를 거치지 않는 길이 열려 있다(앱은 쓰지 않지만 PostgREST 로 열림) | D50 — 정책 삭제(표 단위 INSERT 회수는 하지 않는다 — 재검토 반영 — R1), 모드 `FOR SHARE`, `ensure_team_roots` 직렬화·지연 수렴(비평 반영 — S10) |
| E32 | 개정 §4.2.3 — "사용현황 RPC 5종에 `p_timezone` … `pg_timezone_names` 에 없으면 예외" | 다섯은 `language sql`·INVOKER(본문에 `raise` 불가), `usage_sessions` 는 `p_gap_minutes default 30` 이 끝에 있다 | D14 — `p_gap_minutes` 앞, `language sql`·INVOKER 유지, SQL 식 검증 + TS 매핑(비평 반영 — S7) |
| E33 | 개정 MIN-ATT SP5-6 — "service_role 잡과 dry-run 모드를 둔다" | 원격이 없어 크론을 걸 곳이 없다 | D26 — 수동 스크립트(`--apply` 명시), 배선은 §9(첫 배포·SP8)(비평 반영 — S13) |
| E34 | 초안이 읽은 SP4 `sp4/a1` `bff02f8` 의 M1 가드 | SP4 `cd66d6c` 가 `0014` 를 고쳤다 — "새로 생기는 참조만"(같은 키 재저장·팀/부모 열 불변 UPDATE 통과), 짝 잠금 `for key share`, 분기형 함수(모르는 표 55000) | D19 ④ — `cd66d6c` 본문 위에서 분기 둘, D12 의 승계 검사(비평 반영 — S11) |
| E35 | 개정 §8.1 #3·§6.2.0 — 사용자 결정의 "되돌림 가능" | `_calendar` 롤백은 이관이 기록한 설정 값·이력을 되돌리지 않는다 — 메인 스택 적용 뒤에는 #2 를 되돌릴 수 없다 | §8 #1·#2 — 비용 칸·질문 시점 정정(비평 반영 — S12) |

### 1.4 실측 충돌 C-1~C-21 처리 대응표

| C | 요지 | 처리 |
|---|---|---|
| C-1 | 마이그레이션 번호가 개정 표보다 밀린다 | D2·E14 |
| C-2 | §4.2.1 낡은 실측(설정 열 삭제됨) | E1 |
| C-3 | 주 키 트리거 근거가 SP4 뒤 바뀜 | D8·E2 |
| C-4 | 단일 출처 정규식이 사본을 놓침 | D9·E3 |
| C-5 | §4.2.8 소비처 7건 누락 | D10·E4·§4.4 |
| C-6 | `holidays` 판독 7곳의 `kind` 오판 | D11·E5 |
| C-7 | `import_wbs`·`replace_wbs` 최신 정의가 SP4 | D12·E6 |
| C-8 | 회의록 `team_code → team_id` 가 개정 §4.7 에서 빠짐 | D18·D51·E7·E28·§8 #5 |
| C-9 | 팀 루트 생성 경로 넷 | D19·D49·D50·E8·E31 |
| C-10 | 톰스톤과 H2-h 가드 | D23·D56·E9·§8 #7 |
| C-11 | 무프로젝트 회의록 정책 출처 | D24·E10 |
| C-12 | 외부 메타 API 상수 광고 | D25·E11 |
| C-13 | `no-runtime-constants` 패턴은 이미 있음 | D45·E12 |
| C-14 | 줄 번호 밀림 | D10·E13 |
| C-15 | SP3b 경로 이동·layout 겹침 | D27·D32 |
| C-16 | 기본 일요일이 픽스처·시드·합성을 깸 | D28·E18·E26 |
| C-17 | SP4 의 월요일 하드 의존 | D10(착수 때 재전수)·D34 |
| C-18 | 주차 라벨·기존 프로젝트 전환은 사용자 항목 | D4·D5·E17·§8 #1·#2 |
| C-19 | 봇 시간대 기준 | D13 ③·E19 |
| C-20 | `issue_analysis` 와 게이트 재분류 | D16·E20 |
| C-21 | 어휘 범위·노력 | D1·D29·E16·§8 #8 |

### 1.5 범위 표

실측 ① 의 59항목을 체크포인트와 절에 놓는다. "→" 는 이 문서가 바꾼 거처다.

| 실측 항목 | 내용(요지) | 체크포인트 | 절 |
|---|---|---|---|
| S-A1·S-A2·S-A9 | `calendar.*` 3키 두 스코프·`week_start` 키 계약·변경 연산 | A | §4.2 |
| S-A3·S-A4 | `WorkCalendar` 순수 모듈·`ProjectConfig.calendar` 주입 | A | §4.1·D11 |
| S-A5·S-A7·S-A8·S-A10·S-A11 | `NNNN_calendar`(kind·헬퍼·의존성 트리거·주 키 트리거·`settings_ref_check` 분기·tz 이관·주 시작 이관·리허설) | A | §3.2·§3.8 |
| S-A6 | 사용현황 RPC 5종 `p_timezone` | A | §3.2·D14 |
| S-A12 | 주차 라벨·표시 요일·서식 라벨 | A | §4.2·D4 |
| S-A13·S-A18·S-A21 | 시간대 적용 규칙·소비처 전수·layout 한 줄·표시 시각 tz | A | §4.3·§4.4·D32 |
| S-A14·S-A15 | KR 오버레이 삭제·검증 CLI | A | §4.5 |
| S-A16 | 가져오기 휴일 upsert `kind='off'`·충돌 건너뜀 | A | §3.2·D7·D12 |
| S-A17 | 월 달력 첫 열 = 규칙 시작 요일 | A | §4.4 |
| S-A19 | `BOOTSTRAP_TIMEZONE`·생성 폼 tz 제안 | A | D13 ② |
| S-A20 | 변경 내용 검토(E·N건) — 서버 계산 미리보기 | A | D38 |
| S-A22 | 합성 S4(일)·S5 | A | §6.4 |
| S-D7 | 봇 주간 도구·라우터 월요일 강제·`p_from_week` | A | D34 |
| S-B1·S-B2 | 이슈 영역·`id_policy` 채번·카운터 재키·이관·롤백 | B1 | §3.3·§4.6 |
| S-B3 | 분석 모듈 분리·이관 편입·DB 제약 재정의 | B1 | D16·§4.6 |
| S-B4 | `create_issue_from_minute_block` | B1 | D15·E15 |
| S-B5 | `#${issueNo}` 노출 제거 | B1 | D41 |
| S-B6 | 이슈 영역 편집 탭·쓰기 길 | B1 | D17 |
| S-B7·S-B8 | P1-AC2 E2E·합성 S6 | B1 | §6.3·§6.4 |
| S-B9·S-B10 | 격리 맵·픽스처·`ISSUE_MEGA_AREAS` 허용 목록 | B1 | §3.7·D45 |
| S-C19 일부 | `deckPlan` Mega 순서·라벨 `areas` 주입 | B1 | D42 |
| S-C1·S-C2·S-C3 | 폴더 `kind`·`team_id`·`minutes.root_folders`·`create_team`·개명 동기 | B2 | §3.4·§4.7·D49~D52 |
| S-C4 | 회의록 `team_id`(+ 위키·필터·해석 함수) | B2 | D18 |
| S-C5 | 업로드 계약 v2.9 절 | B2 | §4.7 |
| S-C6 | `canMoveLeaf` | B2 | D40 |
| S-D3·S-D4·S-D5 | 회의 화면 실패·`projectColors.ts`·팀 막대 | B2 | D39 |
| S-D6 | 전환 RPC 의 새 팀 열 | B2 | D19 ③ |
| S-C7~S-C14 | MIN-ATT SP5-1~7·EX-1·EX-2·수용 #1~#6 | **→ B3**(개정은 B2) | §3.5·§4.8 |
| S-C15 | service_role 첨부 insert 경로 | B3 | §4.8 |
| S-D1·S-D2 | 산출물·이슈 첨부 경로 정책·클릭 발급 | **→ B3**(첨부 경로를 만지는 체크포인트) | §4.10 |
| S-C16·S-C18 | 어휘 5키·카탈로그 범주 고정 | **→ B4**(개정은 B2) | §3.6·§4.9 |
| S-C17 | 봇 근태 유형 | B4 | D46 |
| S-C19 나머지 | 잔여 문자열(정본 done_when ①) | B4 | D46 |
| S-D8 | (조건부) `copyGlobalTeams` 분열 | 해당 없음 — SP4 §8 #3 기본값이면 SP4 B 가 닫는다. 대안 ①이 채택되면 B2 에 든다 | — |

## 2. Phase 구성

### 2.1 Phase 표

| 체크포인트 | 목표 | 의존(게이트) | 노력(작업 + 고정 비용, 노력 단위 주) | 브랜치 | 체크포인트 조건 |
|---|---|---|---|---|---|
| **A** — 달력 | 주 계산이 `calendar.ts` 한 모듈이고 프로젝트 규칙(일요일 기본·전환 규칙)을 따른다. 시간대가 설정에서 온다(`Asia/Seoul`·`+09:00`·`9 * 3600_000` 런타임 0). 근무일·날짜 예외가 TS·SQL 같은 판정이다. 한국 공휴일 출처 0. 기존 프로젝트는 서울 tz·"다음 주부터 일요일"(§8 #2 기본값) | SP4 A2 체크포인트(D3 (i)), 이 스펙, §8 #1·#2 의 착수 전 질문 | 2.1~2.6 + 0.2~0.3 = **2.3~2.9** | `sp5/phase-a` 위에 `ui/sp5-calendar`(layout 한 줄 — D32) | 공통 묶음 + 리허설(`*_calendar_week_start` 네 경우·`*_calendar_smoke`) + CI 등가 1회 + 로컬 E2E 의 A 단계 + 합성 S1(A 몫)·S4(R 일요일·C 월요일)·S5 + **성능 게이트 p95 ≤ 1.20(D59)** + 눈확인 A 행 + `Preview-checked` + 로컬 태그 `sp5-a-done` |
| **B1** — 이슈 영역·채번·분석 | 이슈가 프로젝트 영역·`id_policy` 로 발번된다. 영역 없는 기존 이슈는 이관 전용 레거시 코드다(D55). 분석이 선택 모듈이다. 전역 영역 표가 없다. 화면·색인에 `#issueNo` 가 없다 | A | 1.8~2.1 + 0.2~0.3 = **2.0~2.4** | `sp5/phase-b1` | 공통 묶음 + 리허설(`*_issue_areas_smoke`·롤백 조건 두 경우·코드 없는 이슈 시드의 적용 → 롤백 → 재적용) + 동시 채번 100건(p95 기록 — D59) + 로컬 E2E P1-AC2 + 합성 S1(B1 몫)·S6(SP5 몫)·S10(B1 몫) + 눈확인 B1 행 + `sp5-b1-done` |
| **B3** — 회의록 첨부(MIN-ATT) | 기존 회의록에 첨부를 더하고 지운다. 화면·서버·DB 가드가 같은 설정 정책을 쓴다. 톰스톤(service_role + 전이 가드)·청소 잡이 있다. 산출물·이슈 첨부가 경로 범위·클릭 발급이다 | B1 | 1.5~1.9 + 0.2~0.3 = **1.7~2.2** | `sp5/phase-b3` | 공통 묶음 + 리허설(`*_attachments_smoke`) + MIN-ATT 수용 #1~#6·EX-1·EX-2(§7 B3 의 대응표) + 청소 잡 dry-run 기록 + 눈확인 B3 행 + `sp5-b3-done` |
| **B4** — 어휘 | 어휘 5키가 설정에서 오고 DB check 가 없다. 어휘 code 삭제 경합에 고아 참조 0. 잔여 원본 문자열 0 | B3 | 1.05~1.4 + 0.2~0.3 = **1.25~1.7** | `sp5/phase-b4` | 공통 묶음 + 리허설(`*_vocab_settings_smoke`) + `config-vocabulary` 경합 + 합성 S1(B4 몫)·S10(잔여 문자열) + 눈확인 B4 행 + `sp5-b4-done` |
| **B2** — 회의록 팀·마감 | 회의록 폴더·회의록이 팀 id 로 이어진다. 팀 생성·개명·비활성·전환이 루트를 일관되게 다루고 세션은 팀 루트를 만들거나 바꿀 수 없다. 회의 화면 이월 셋·`canMoveLeaf` 가 닫힌다. SP5 키 전부 `verified`. 기록·노력 실측 | B4 ∧ **`sp4-done`**(D3 (iii)) | 2.0~2.6 + 0.2~0.3 = **2.2~2.9** | `sp5/phase-b2` | 공통 묶음 + 리허설(`*_minutes_teams_smoke` — 폴더 종류·이름 이관·회의록 `team_id` 이관 대조·롤백 이름 복원·프로젝트 삭제) + 부정 테스트 넷 + 세션 위조 다섯(D49) + 전환 RPC 카탈로그 불변식 + 로컬 E2E `minutes-teams`(생성→루트→업로드→개명→비활성, §6.3 — 재검토 반영 — R7) + 눈확인 B2 행 + 마감 묶음(§7 B2) + 태그 `sp5-done` |

- **순차로 돈다: A → B1 → B3 → B4 → B2**(비평 반영 — S9). 전용 스택이 하나라 `db:reset`·`test:rls`·리허설·E2E 를 동시에 돌리지 않는다(무거운 실행은 두 레인 공유 잠금). B2 만 `sp4-done` 을 기다리므로, SP4 B 가 레인 B 사람 게이트를 기다리는 동안 A·B1·B3·B4(작업 약 6.45~8.0 노력주)를 모두 당길 수 있다.
- **공통 묶음**(SP4 §2.1 과 같다): 전용 스택에서 `db:reset` → `dev:bootstrap` → `settings:verify` → `test:rls`(건너뜀 0) → 다시 `db:reset` + `dev:bootstrap` → **체크포인트 HEAD 를 담은 트리(SP5 워크트리)에서** `test`(`--maxWorkers=4`)·`lint`·`typecheck`, 기록에 그 HEAD 해시 → 스크래치 워크트리 `build` → 로컬 태그. main 반영(ff·push)은 사람 확인 때, 그 뒤 CI(`test`·`db`) 초록 확인. 메인 체크아웃(`/Users/jerry/D-Flow`)은 다른 작업(Codex 포함)이 같이 쓰므로 검증 트리로 쓰지 않는다.
- CI 는 `main`·`ui/**` push 에서만 돈다. `sp5/*` 의 CI 증거는 main push 뒤에 받고, 그 전에 CI db 잡 조건(부트스트랩 없이 `migration up` → `test:rls`)을 전용 스택에서 손으로 재현한다.
- 체크포인트마다 실측 노력을 원장(`.superpowers/sdd/<날짜>-sp5-*/progress.md`)에 적고 마감(B2)에서 `docs/baseline/sp5-effort.md` 로 남긴다.

#### 2.1.1 착수 시점·SP4 와의 순서·레인 B 창

| # | 규칙 |
|---|---|
| ① | **SP5 스펙·계획은 브랜치 없이** 한다 — 레인 B 창을 막지 않는다(SP4 §2.1.1 ④·⑥) |
| ② | A 는 SP4 A2 체크포인트(`sp4-a2-done`) HEAD 위에서 자를 수 있다. SP4 B 가 레인 B 게이트(UI-1 사용자 눈확인·UI-2a/2b 머지)를 기다리는 동안 당기는 것이 기본 시나리오다(SP4 K3). 그때 SP5 는 자기 스택(D33)을 쓴다 |
| ③ | SP4 B 게이트가 열리면 SP5 는 **진행 중 과제의 커밋에서 멈추고** SP4 B 를 먼저 끝낸다. `sp4-done` 이 main 에 반영되고 레인 B 창이 닫히면 SP5 브랜치(A·B1·B3·B4 가운데 쌓인 것 전부)를 그 main 위로 rebase 하고 체크포인트 증거를 rebase 뒤 트리에서 다시 만든다(SP4 D49 ③) |
| ④ | B1·B3·B4 는 차례로 앞 체크포인트 위에 쌓을 수 있다(SP4 D49 ②). **B2 만 `sp4-done` 이 main 에 있어야 자른다**(D3 (iii), 비평 반영 — S9) |
| ⑤ | 체크포인트 = 검증 묶음 + 로컬 태그. 사람 확인을 기다리는 동안 다음 Phase 는 직전 체크포인트 HEAD 위에 쌓고, main 반영 때 태그 순서대로 ff 한다(SP4 D49 ①·②) |
| ⑥ | 레인 B 창(SP3b D46)은 실제 main 반영 직후에 열린다. 레인 B 의 UI-2a(`/w/[slug]/meetings`·`/minutes` 이동·`account_preferences` 마이그레이션)·UI-2b(`(app)/layout.tsx` 재작성)가 SP5 와 겹친다 — 먼저 머지한 쪽이 기준, 나중이 rebase(D27). 번호는 나중 머지가 민다(D2) |
| ⑦ | **착수 전 사용자 결정(§8 #1·#2)**: 컨트롤러가 이 스펙의 확정 보고에 #1·#2 를 별도 블록으로 올려 사용자에게 묻는다. 답 없이 A 를 시작하더라도 A 의 마이그레이션 커밋(②) 전에 한 번 더 확인 요청을 남긴다(원장 기록). #2 는 메인 스택 적용(§8 #13) 뒤에는 되돌릴 수 없다(비평 반영 — S12) |
| ⑧ | **계획 첫 과제**: SP4 가 "SP5 블록에 한 줄"로 넘기기로 한 것(이슈 영역 쓰기 길·팀 막대·`projectColors.ts`·새 팀 열 — SP4 §9)이 SP4 B 마감에 실제로 기록됐는지 확인한다(이월이 끊기지 않게, 비평 반영 — S13) |

### 2.2 노력 추정과 근거

개정 SP5 블록은 5~5.5주(4.5~6)다. 이 문서의 추정은 **9.45~12.1주**(노력 단위 — 체크포인트 고정 비용 1.0~1.5주 포함, 빼면 8.45~10.6주)다. 초안(9.0~11.5주)보다 늘어난 것은 비평 반영으로 생긴 일(세션 폴더 가드·팀 범위 가드·모드 잠금·루트 이름 사전검사와 롤백 복원·톰스톤 전이 가드와 읽기 제외·레거시 코드·성능 게이트·어휘 트리거 보강)과 A 작업 합의 산식 정정(초안 2.0~2.5 → 하위 합 2.05~2.55)이다(비평 반영 — S13). 실측 ⑥ 은 7.75~9.75주(넷, 고정 비용 0.5주)였다 — 차이는 체크포인트 수(넷 → 다섯)와 고정 비용을 SP4 처럼 체크포인트당 0.2~0.3주로 센 것, B3 에 첨부 이월 둘(산출물·이슈 첨부)을 옮긴 것, 비평 반영분이다. 출처 — (i) 개정 SP5 블록 문면(정본 유지 범위 포함), (ii) 블록에 없는 이월(H1·H2·SP4 §9), (iii) 이 문서의 결정(D9·D11·D18·D19·D23·D49~D59 등), (iv) 구조(체크포인트 수). 화면 순수 패턴 이행(D30)은 빼고 셌다. 표는 도는 순서(A → B1 → B3 → B4 → B2)로 적었다.

| 묶음 | 추정(주) | 출처 | 근거 |
|---|---|---|---|
| A — `NNNN_calendar` + 롤백 + 리허설 + RLS 셋(패리티·전환·경합) | 0.6~0.75 | (i), (iii) D8·D37·D53 | 헬퍼 셋(판독형·규칙 인자형·근무일)·의존성 트리거 2종 3곳·사용현황 5종 재정의·주 키 트리거·`settings_ref_check` 분기 둘(주 시작 정확 판정·tz)·`holidays.kind`·가져오기 RPC 갱신절·이관 두 단계. 이관 3단계(E 미룸)·raise 경우가 리허설을 네 벌로 만든다 |
| A — `calendar.ts` + 행렬 테스트 + 설정 키 6정의(`edit`·`seedFrom`) + 미리보기 액션 + tz 검증(D54) | 0.4~0.5 | (i), (iii) D38·D54 | 키 함수·과도기 창·라벨 규칙·DST 2건·루프 상한. `toStored` 의 네 경우 |
| A — 주 소비처(시트·보고서·API·액션·봇 셋·이슈 추이·간트·이웃 주) + 월요일 가정 테스트 기대값 | 0.4~0.5 | (i), (ii) SP4 §9, (iii) D9·D13 ③·D34·D35 | 실측 ③-1 의 13곳 + SP4 가 더한 호출부 + 봇 요청 범위 달력. 비평이 찾은 월요일 가정 테스트 20여 파일은 착수 재전수 뒤 이 칸을 다시 잰다 |
| A — 시간대(seoul* 38파일 96회·리터럴 24파일·오프셋 9줄·메일·usage 화면·녹취 보정·bootstrap) + locale 인자(D60) | 0.35~0.45 | (i), (iii) D13·D14·D60 | 대부분 기계적 교체지만 서버/클라이언트 경계로 tz 를 내려보내는 props 가 늘어난다(규모는 비평 재측정값) |
| A — `holidays` 로더 단일화·`kind`·일정 화면·가져오기 미리보기 / KR 오버레이 삭제·달력 셋·월 그리드 다섯·검증 CLI·가드 | 0.3~0.35 | (i), (iii) D7·D11 | 판독 7곳, 불변식 둘(`holidays-reads`·`no-country-calendar`) |
| A — 성능 게이트(D59)·규칙 선기록 커밋 ①(D28) | 0.05 | (iii) D28·D59 | `perf-baseline.mjs` 한 번 + 비교 기록, 픽스처·RLS 임시 프로젝트 선기록 |
| **A 작업 합** | **2.1~2.6** | | 하위 합(초안의 2.0~2.5 는 하위 합 2.05~2.55 와 어긋났다 — 비평 충실도 P3) |
| B1 — `NNNN_issue_areas`(채번 트리거 재작성·카운터 재키·영역 생성 이관·레거시 범위·대조·조건부 롤백·`create_issue_from_minute_block` 교체) + 리허설 + RLS(동시 100건·연도 경계·정책 변경) | 0.85~1.0 | (i), (iii) D15·D55 | 0010 의 자리 규칙 계승, 이관 6단계 + 레거시 발번·롤백의 템플릿 판정 |
| B1 — `mega_code` 계열 20파일·허용 목록 10파일·모듈 분리·manifest 재분류·영역 탭·`#issueNo`·`deckPlan` | 0.95~1.1 | (i), (iii) D16·D17·D41·D42 | AI 회의록 초안·분석 실행·분석서 PPT·봇 이슈 도구까지 `area_id`·`code` |
| **B1 작업 합** | **1.8~2.1** | | |
| B3 — `NNNN_attachments`(톰스톤·전이 가드·세션 DELETE 정책 정리·가드 재정의·경로 정책) + 리허설 + RLS(동시·위조·재전송·권한 회수·25001·패리티·되살리기 거부) | 0.5~0.65 | (i), (iii) D22~D24·D56 | 가드는 H2-h 의 ①~⑧ 을 그대로 잇고 검사를 넷 더한다 |
| B3 — 첨부 패널·메타·과거 버전·미리보기·정책 키 편집·청소 잡·외부 메타·톰스톤 읽기 제외 | 0.75~0.95 | (i), (iii) D25·D26·D56 | 개정 MIN-ATT +1~1.5주의 화면 몫 + 읽는 곳 여섯의 `deleted_at` 필터 |
| B3 — 산출물·이슈 첨부 경로 정책·클릭 발급(이월) | 0.25~0.3 | (ii) | insert 정책 두 개·목록 결과형 두 개 |
| **B3 작업 합** | **1.5~1.9** | | |
| B4 — `NNNN_vocab_settings`(check 넷 삭제·어휘 트리거 다섯 표·`settings_ref_check` 어휘 분기·`migrate_setting_code`) + RLS 경합(동시 편집 대 이관 포함) | 0.5~0.65 | (i), (iii) D58 | §2.4.1 규약의 첫 실사용 — SP5b 가 재사용 |
| B4 — 어휘 소비처(근태·회의·심각도·원천·원인 — 화면·검증·PPT·AI 프롬프트·봇) + 편집 화면 + 잔여 문자열 | 0.55~0.75 | (i), (iii) D46 | 정본 Q4 표의 실측 위치 |
| **B4 작업 합** | **1.05~1.4** | | 초안의 마감 묶음(0.1~0.15)은 B2 로 옮겼다 |
| B2 — `NNNN_minutes_teams`(폴더 `kind`·`team_id`·회의록 `team_id`·`create_team`·`ensure_team_roots`·개명 동기·전환 RPC 재정의·M1 트리거 두 표·범위 가드 둘·종류 가드·세션 공용 팀 INSERT 정책 삭제·사전검사) + 이관 대조 + 리허설(롤백 이름 복원·프로젝트 삭제) | 0.75~0.9 | (i), (iii) D18·D19·D49~D52 | 전환 RPC 를 SP4 정의 위에서 다시 만든다 |
| B2 — `folders.ts`·`domain/minutes.ts` 판정 교체·`root_folders` 두 모드·지연 수렴·v2.9 절·`canMoveLeaf`·팀 액션 셋 | 0.5~0.65 | (i), (iii) D20·D21·D40·D50 | |
| B2 — 회의록 `team_id` 소비처(회의록 계열 약 20파일·위키·AI 색인·필터·내보내기·해석 함수·재편철 재해석) | 0.4~0.55 | (iii) D18 — U-5 | 실측 ⑥ 의 +0.5~0.75 에서 수신 RPC·내보내기를 `team_code` 메아리로 두어 하한을 깎았다 |
| B2 — 회의 화면 이월 셋(D39) | 0.25~0.35 | (ii) | 결과형 다섯 곳·색 토큰·팀 막대 |
| B2 — 마감 묶음(기록·노력 실측·개정 표 갱신·SPU3 누적 재산정·태그) | 0.1~0.15 | (iv) | |
| **B2 작업 합** | **2.0~2.6** | | |
| **체크포인트 고정 비용** | 0.2~0.3 × 5 = **1.0~1.5** | (iv) | SP4 §2.2 와 같은 근거(Phase 최종 리뷰·공통 묶음·E2E·눈확인·기록) |

- 체크포인트별(고정 비용 포함): A 2.3~2.9 · B1 2.0~2.4 · B3 1.7~2.2 · B4 1.25~1.7 · B2 2.2~2.9. **A·B2 의 상한이 3주에 가깝다** — A 는 넘칠 때 넘길 목록을 미리 적는다: ① 사용현황 RPC `p_timezone`(D14)을 **별도 마이그레이션 `NNNN_usage_timezone`**(A 이후 첫 DB 커밋)으로 — 그때 §7 A 의 `usage-timezone`·`CALENDAR_POSTCHECK` 의 사용현황 항목이 그 파일의 완료 조건으로 함께 옮겨 간다(비평 반영 — S13) ② 달력 셋의 비근무 요일 색 토큰을 B1 의 화면 커밋으로 ③ `DayPopover`·메일 시각 표기를 B1 로. B2 는 넘치면 회의 화면 이월 셋(D39)을 SP5 뒤 첫 회의 화면 작업으로 넘기는 것을 사용자 확인으로 올린다(개정 §8.1 #22 가 SP5 에 준 일이라 혼자 옮기지 않는다). 발동은 SP4 K17 과 같은 방식(그 체크포인트의 마이그레이션 커밋 + `tests/rls/**` 초록 시점에 실측 에이전트 시간을 추정 × 9.4시간/노력주와 비교).
- **넷으로 합치면**: B3+B4 = 1.5~1.9 + 1.05~1.4 + 0.2~0.3 = 2.75~3.6 — 상한을 넘는다. B2+B3 = 3.7~4.8. 셋(개정) = B2 에 셋을 다 넣어 4.75~6.2. 그래서 다섯이다(D1).
- **에이전트 시간 환산**(SP4 §2.2 의 방식 — 고정 비용 뺀 8.45~10.6주에 SP3a 비율 0.11~0.17 을 엇갈려 곱한다): 10.6 × 5 × 0.11 ≈ 5.8일, 8.45 × 5 × 0.17 ≈ 7.2일, 중간 9.5 × 5 × 0.14 ≈ 6.7일 → **약 6.5일(5.8~7.2)**. 9.4시간/노력주로는 약 79~100시간. SP3a 한 표본의 비율이라 단서가 붙는다.
- 달력은 노력보다 바깥이 정한다 — B2 는 `sp4-done`(그 앞에 레인 B 의 사람 게이트 둘)을 기다린다(K2). 순서를 B2 끝으로 바꿔 A·B1·B3·B4(작업 6.45~8.0)를 그 대기 동안 당긴다(비평 반영 — S9).

### 2.3 소유 파일

파일마다 주인은 처음 고치는 체크포인트다(도는 순서 A → B1 → B3 → B4 → B2 기준 — 비평 반영 — S9). 줄이 아니라 심볼로 찾는다(D10). `NNNN` 은 머지 직전 번호.

| 체크포인트 | 소유 파일 |
|---|---|
| A — DB | `supabase/migrations/NNNN_calendar.sql`, `supabase/rollbacks/NNNN_calendar_rollback.sql`, `supabase/rehearsal/NNNN_calendar_{week_start,smoke}.sql`, `tests/rls/{calendar-parity,week-start-transition,usage-timezone}.test.ts`(새), `tests/rls/fixture-ws.sql`·SP4 `tests/rls/weekly-areas.test.ts`·`tests/rls/isolation-map.ts`(월요일 규칙 선기록 — D28, 마이그레이션 앞 커밋 ①, 비평 반영 — S8), `tests/rls/command-receipts.test.ts`(`work` 행 회귀 — D12) |
| A — 달력·설정 | `src/lib/domain/calendar.ts`(새), `src/lib/domain/dates.ts`(seoul*·주말·영업일 삭제 — 날짜 산술만 남김), `src/lib/calendar/load.ts`(새 — D11), `src/lib/settings/{projectConfig,workspaceConfig,catalog-meta}.ts`, `src/lib/settings/defs/{project,workspace}.ts`(6정의 — 지금 레지스트리 정의가 두 파일이다), `src/app/actions/settingsPreview.ts`·`src/lib/settings/impactPreview.ts`(`previewWeekStartChange` — D38), `src/components/settings/{ScheduleManager,…}.tsx`(휴무/근무·주 시작·근무 요일·tz 편집), `src/app/actions/project.ts`(`addHoliday` `kind`), `scripts/dev-bootstrap.mjs`(`BOOTSTRAP_TIMEZONE`), 워크스페이스 생성 폼(tz 제안) |
| A — 주 소비처 | `src/lib/report/{week,weekly}.ts`, `src/app/(app)/p/[projectId]/weekly/page.tsx`, `src/app/api/report/route.ts`, `src/app/actions/weekly.ts`·`projectAreas.ts`(키 계산만), `src/components/weekly/WeeklySheetView.tsx`(이웃 주만), `src/lib/ai/chat/{router,planner,protocol,orchestrator}.ts`, `src/lib/ai/tools/{weekly,types,common}.ts`, `src/app/api/chat/v2/stream/route.ts`, `src/components/**/BotPageContextProvider.tsx`, `src/lib/domain/{issueDashboard,ganttScale,trend,progress,dependencySchedule}.ts`, `src/components/wbs/WbsGanttSheet.tsx`(주 끝·음영만), `src/lib/wbsmd/parse.ts`, `src/app/actions/wbs.ts`(영업일), `src/lib/data/{wbs,snapshots}.ts`, `src/lib/repositories/supabase/{settings,wbs}.ts` |
| A — 시간대 | 실측 ③-2 의 seoul* 파일(비평 재측정 38파일 96회)과 24파일(리터럴) — 표시 포맷 컴포넌트, `src/lib/data/usage.ts`·`src/components/usage/*`·`src/app/(app)/usage/page.tsx`, `src/lib/domain/{announcements,meetings,officeChatter}.ts`, `src/lib/mail/projectInvite.ts`, `src/lib/minutes/timeFix.ts`·`src/app/actions/minutes.ts`(보정 호출 두 곳)·사전 `min.timeFix.desc`, `src/components/ui/DayPopover.tsx`, `src/lib/report/issues/deckPlan.ts`(tz 한 줄) |
| A — 공휴일·달력 화면 | 삭제 `src/lib/domain/holidays.ts`·`src/lib/i18n/dict/holidays{,.en}.ts`·`tests/domain/holidays.test.ts`. `src/components/attendance/AttendanceView.tsx`·`src/components/meetings/{MeetingCalendar,MeetingsView,MyMeetingsView}.tsx`·`src/components/minutes/MinutesCalendar.tsx`(쉬는 날·비근무 요일 색·첫 열), `src/lib/domain/attendance.ts`(`monthMatrix`), 회의 페이지 둘의 `monthGrid`, `scripts/wbs/validate.mjs` |
| A — UI 위험(`ui/sp5-calendar`) | `src/app/(app)/layout.tsx`(또는 UI-2b 뒤 그 자리) 한 줄 |
| A — 가드·테스트 | `tests/domain/{calendar,week-single-source}.test.ts`(새), `tests/invariants/{no-country-calendar,holidays-reads}.test.ts`(새), `tests/settings/no-runtime-constants.allow.ts`(A 몫 행 삭제), `tests/report/{week,weekly}.test.ts`(기대값 — 커밋 메시지에 의도 변화), `tests/domain/dates.test.ts`, 월요일 가정 기대값 파일(D28 의 목록 — `tests/ai/{chat-v2-router,tools-dashboard}.test.ts`·`tests/ai/golden/*`·`tests/domain/{attendance,meetings}.test.ts`·`tests/lib/wbsmd-parse.test.ts`·`tests/scripts/ui-capture.test.ts`·`tests/ui/{wbs-today-scroll,gantt-frozen-overlay-clip,issues-mega-filter}.test.tsx` 등, 착수 재전수), 새 이름 있는 검사(§7 A — `tests/components/calendar-first-column.test.tsx`·`tests/wbs/import-holiday-skip.test.ts`·`tests/scripts/bootstrap-timezone.test.ts`·`tests/ai/bot-week-rules.test.ts`·`tests/components/time-display-zone.test.tsx`), `docs/baseline/sp5-perf.md`(D59), `tests/gates/manifest.ts`(미리보기 액션), `scripts/lib/synthetic.mjs`·`scripts/e2e-synthetic.mjs`(S4 R·S5), `scripts/ui-capture.mjs`(월요일 규칙 선기록 — D28) |
| B1 | `supabase/migrations/NNNN_issue_areas.sql`·롤백·`supabase/rehearsal/NNNN_issue_areas_{smoke,rollback_guard}.sql`, `src/lib/domain/issueAnalysis.ts`(`ISSUE_MEGA_AREAS` 삭제), `src/lib/domain/issues.ts`, `src/lib/issues/idPolicy.ts`(새 — 패턴 파서·렌더 미리보기, SQL 과 패리티), `src/lib/settings/defs/project.ts`(`id_policy`·`analysis`), `src/lib/modules/{registry,defaults}.ts`, `src/app/actions/issues.ts`, `src/app/api/issue-analysis/**`, `src/lib/ai/{issue-analysis,minute-issue-draft}.ts`, `src/lib/ai/index/content.ts`(이슈 제목), `src/lib/report/issues/{model,deckPlan,storedRun}.ts`, `src/components/issues/**`(`IssuesView`·`IssueQueueCard`·분석 폼), 설정 화면 이슈 절·영역 편집기 `issue_area` 탭(SP4 `ProjectAreasManager`), `tests/rls/{issue-areas,issue-code-policy}.test.ts`(새)·`issue-code-width.test.ts`, `tests/rls/{isolation-map.ts,schema-invariants.test.ts}`(예외 셋 삭제 — 개정 §2.11 픽스처 표), `tests/gates/{manifest.ts,_rpc-tables.ts}`, `tests/ui/issue-code-display.test.tsx`(새 — `#issueNo` 노출 0) |
| B3 | `supabase/migrations/NNNN_attachments.sql`·롤백·리허설, `src/components/minutes/{MinuteAttachmentsPanel,MinuteViewer}.tsx`, `src/app/actions/{minuteAttachments,minutes}.ts`(첨부 액션 분리 — 계획이 판단), `src/lib/domain/{minutes,types}.ts`, `src/lib/data/minutes.ts`·`src/lib/repositories/supabase/minutes.ts`·`src/lib/ai/tools/minutes.ts`(톰스톤 읽기 제외 — D56), `src/lib/settings/defs/{project,workspace}.ts`(`minutes.attachments` 만 — `minutes.root_folders` 는 B2, 비평 반영 — S13), `src/app/api/v1/minutes/meta/route.ts`, `scripts/minutes/sweep-attachments.mjs`(새), 산출물·이슈 첨부 목록·액션(`listAttachments` 계열), `tests/rls/{h2-minute-bucket,h2-minute-manage-parity,minute-attachments-policy}.test.ts`, `docs/sp2-admin-client-audit.md`(청소 잡) |
| B4 | `supabase/migrations/NNNN_vocab_settings.sql`·롤백·리허설, `src/lib/settings/defs/project.ts`(어휘 5정의), `src/lib/domain/{attendance,meetings,issues,issueAnalysis}.ts`(상수 → 해석된 어휘), `src/lib/ai/tools/attendance.ts`·`src/lib/ai/chat/router.ts`(`attendanceTypesFrom`), `src/lib/report/issues/*`·`src/lib/ai/issue-analysis.ts`(원인 분류), 설정 화면 어휘 편집기, `src/components/admin/AccountsManager.tsx`·`src/lib/report/weekly.ts`(잔여 문자열), `tests/rls/config-vocabulary.test.ts`(새), `docs/settings-catalog.md` |
| B2 | `supabase/migrations/NNNN_minutes_teams.sql`·롤백·`supabase/rehearsal/NNNN_minutes_teams_smoke.sql`, `src/app/actions/{teams,projectTeams,minutes}.ts`, `src/lib/minutes/{folders,teamResolve}.ts`, `src/lib/domain/minutes.ts`, `src/lib/data/minutes.ts`, `src/lib/minutes/externalApi.ts`·`src/app/api/v1/minutes/**`, 위키 파이프라인·AI 색인의 회의록 로더, `src/components/minutes/**`(탐색기 `canMoveLeaf`·팀 막대·필터), `src/lib/data/meetings.ts`·`src/lib/ai/brief.ts`·회의 화면(D39), `src/lib/domain/projectColors.ts`, `docs/design/dflow-minutes-upload-api-spec.md`(v2.9 절), `tests/rls/{minutes-teams,team-convert}.test.ts`, `tests/invariants/{minute-folder-kind,team-create-path}.test.ts`(새), `tests/minutes/team-id-contract.test.ts`(새), `tests/css/no-raw-color.test.ts`(ALLOW 한 줄), `src/lib/settings/defs/workspace.ts`(`minutes.root_folders` — `create_team` 이 모드를 읽으므로 B2 에서 정의, 비평 반영 — S13), 마감 문서(`docs/baseline/{synthetic-acceptance,sp5-e2e,sp5-ui,sp5-effort,sp5-perf}.md`, 개정 §6.3 표·SP 블록의 받는 쪽 기록·SPU3 노력 재산정) |

| 파일(주인) | 이어 고치는 체크포인트와 내용 |
|---|---|
| `src/lib/settings/projectConfig.ts`(A) | B1 이 `issues.*`, B3 이 `minutes.attachments`, B4 가 어휘를 싣는다 |
| `tests/gates/manifest.ts`·`_rpc-tables.ts`(A) | 각 체크포인트가 새 액션·RPC 를 같은 커밋으로 |
| `src/app/actions/minutes.ts`(A — 녹취 보정) | B3 첨부·톰스톤, B2 팀·폴더 |
| `src/lib/data/minutes.ts`(B3 — 첨부 메타·톰스톤 제외) | B2 회의록 `team_id` |
| `src/lib/domain/minutes.ts`(B3 — 첨부 상수 → 정책) | B2 폴더 종류 판정 |
| `src/lib/domain/issues.ts`·`issueAnalysis.ts`(B1) | B4 어휘(심각도·원천·원인) |
| `src/lib/ai/chat/router.ts`(A) | B4 근태 유형 |
| `tests/settings/no-runtime-constants.allow.ts`(A) | B1·B4 가 자기 몫 패턴을 지운다 — B4 끝에 SP5 행 0, 마감(B2)이 다시 확인 |
| `tests/rls/isolation-map.ts`·`fixture-ws.sql`(A) | B1(예외 셋)·B3·B2 가 새 열·탐침 |
| `scripts/e2e-local.mjs`·`scripts/e2e-synthetic.mjs`(A) | B1·B3·B4·B2 가 단계를 이름으로 더한다 |

### 2.4 SP3b·SP4 와 겹치는 파일·UI 위험 파일·트레일러

| 파일·영역 | 상대 | SP5 | 처리 |
|---|---|---|---|
| 마이그레이션 번호 | SP4 `0013`~`0015`, 레인 B `account_preferences` | 다섯 | D2 — 나중 머지가 rename + 재리허설 |
| `weekly_reports` 쓰기 길·`create_weekly_report`·`upsert_project_area(p_from_week)` | SP4 D27·A1 | 주 키 트리거·액션의 키 계산 | D8·D34 — RPC 본문 무변경 |
| `import_wbs`·`replace_wbs` | SP4 `_command_receipts`(D34) | 휴일 갱신절 | D12 |
| `holidays` 로더·`getComputedWbs` | SP4 A2(끝까지 읽기 — D18) | `ProjectConfig.calendar` 단일화 | D11 — SP4 A2 머지 트리 위 |
| 팀 원천·개명·전환 RPC·M1 가드 | SP4 D19·D37·D54·M1 | `create_team`·개명 동기·새 팀 열·트리거 확장 | D19·D20 — B2 는 `sp4-done` 뒤 |
| 주간 영역 편집기 | SP4 D26(`weekly_section` 탭) | `issue_area` 탭 | D17 |
| 봇 주간 도구 | SP4 D24(팀 필터 원천) | 월요일 강제 제거 | D34 — SP4 A 머지 트리 위 |
| `scripts/ui-capture.mjs` | 레인 B 캡처 시드, SP4 A1 이 주간 행 수정(SP4 D53) | 월요일 규칙 선기록 | D28 — 레인 A 가 고치고 레인 B 원장에 알림 |
| `tests/css/no-raw-color.test.ts` ALLOW | 레인 B UI-1 | `projectColors.ts` 줄 삭제 | D39 — 사유가 SP5 로 고쳐져 있어야 한다(SP4 §2.4 마지막 행) |
| `/meetings`·`/minutes` 경로 | UI-2a 이동 | 월 그리드·회의록 화면 | D27 |
| `src/app/(app)/layout.tsx` | UI-2a·UI-2b | `seoulToday` 한 줄 | D32 — `ui/sp5-calendar` |
| `tests/rls/{isolation-map.ts,fixture-ws.sql}`·`tests/invariants/settings-writes.test.ts` | UI-2a `account_preferences`, SP4 | 예외 삭제·탐침·월요일 규칙 | 나중 머지가 rebase 하고 `test:rls` 전체 재실행 |
| `scripts/lib/synthetic.mjs` `PENDING_STEPS` | SP4(S2·S4 문구) | S1·S4·S5·S6·S10 | D43·§6.4 |
| SP4 함수 본문을 전문 `create or replace` 하는 곳(`import_wbs`·`replace_wbs`·`convert_inherited_teams`·`team_ref_owned_scope`·`project_areas_guard`·`upsert_project_area`) | SP4 의 뒤늦은 수정(A1 안에서도 `0014` 를 수정 커밋으로 고쳤다) | 휴일 갱신절·두 표 분기·`issue_area` 분기 | D12 의 승계 검사 — 바탕 태그 시점 본문, 사후검사의 SP4 토큰(비평 반영 — S13) |

- **UI 위험 파일**: SP5 는 `(app)/layout.tsx`(또는 UI-2b 뒤의 자리) 한 줄만 고친다(D32). `globals.css`·`src/components/app/*`·`src/app/layout.tsx` 는 고치지 않는다 — 비근무 요일 색은 기존 토큰(레인 B UI-1 의 의미 토큰)을 쓰고 새 토큰을 `globals.css` 에 더하지 않는다. 필요해지면 멈추고 `ui/sp5-<주제>` 브랜치로 옮긴다.
- **트레일러**: `src/components/**`·`page.tsx`·`layout.tsx` 를 고친 커밋은 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 이나 `Preview-checked: n/a — <사유>`. 체크포인트는 확인 화면을 모두 적은 빈 커밋 하나로 닫는다(마지막 rebase 뒤).

### 2.5 커밋·브랜치·전용 스택

- **커밋 순서**(각 체크포인트, SP4 §2.5 관례): ① 마이그레이션 없이 초록인 커밋 — A 는 **순수 모듈 `calendar.ts` + 행렬 테스트가 첫 묶음**, 그다음 로더·단일 출처 가드(옛 사본은 허용 목록에 사유와 함께 두고 교체 커밋마다 지운다), 그리고 **월요일 규칙 선기록 커밋**(픽스처·RLS 임시 프로젝트·캡처 시드·합성 C 의 `values` 에 `calendar.week_start=[{monday,null}]` 을 주간 insert 앞에서 기록 — 마이그레이션 전에도 무해, D28, 비평 반영 — S8. 단 설정 액션 경로로 쓰는 곳(캡처 시드·합성 C)은 `calendar.*` 키 정의 6개(§2.3 A 의 레지스트리 정의 — 소비처 없이 정의만)가 이 커밋보다 앞서거나 같은 묶음이어야 한다 — `src/app/actions/settings.ts:141-144` 가 미등록 키를 `CONFIG_UNKNOWN_KEY` 로 거부한다. 키 정의를 앞세우지 않으려면 캡처 시드의 선기록은 SQL 로 한다(픽스처·RLS 는 SQL 직접 쓰기라 무관, `settings-verify` 는 미등록 키를 경고만 — 재검토 반영 — R6)) → ② 마이그레이션 + 롤백 **두 파일만** 한 커밋, `Staging-verified: local db reset <YYYY-MM-DD HH:MM> — 적용·test:rls 초록(건너뜀 0)·롤백 카탈로그 불일치 0·스모크 통과` 를 `Co-Authored-By:` 바로 위 줄에(G4) → ③ 새 `tests/rls/**`·리허설(픽스처의 월요일 규칙은 이미 ① 에 있으므로 ② 시점에 `test:rls` 가 초록이고 트레일러가 참이다) → ④ 소비처 교체(작은 묶음, 테스트 먼저) → ⑤ 화면(트레일러) → ⑥ 가드 강화(허용 목록 비움).
- **G1**: 마이그레이션과 코드는 다른 커밋. 이관 리터럴(`'Asia/Seoul'`·`'required'`)은 마이그레이션 파일에만.
- `git add -A` 금지, 파일명 stage. 커밋 메시지 한국어·"왜". 라벨 기대값을 바꾸는 커밋 메시지에 의도 변화(개정 §4.2.5 예)를 적는다.
- **전용 스택**(D33): `( cd "$WT" && … )`, 모든 DB·테스트 명령은 `lane-a-sp5-run.sh` 래퍼로. 계획의 명령 전문에서 `grep -nE "5432[12]|5452[12]|supabase_db_d-flow\b"` 0건.
- **메인 스택(사용자 데이터)**: 번호 확정·main 반영 전에 SP5 마이그레이션을 적용하지 않는다(D48).
- push 는 사람 확인 뒤, `SKIP_GUARD` 금지, `main` force push 금지. 서브에이전트 브리프에 "push 금지·`mktemp -d`·`cd &&;` 금지"(memory `agent-git-push-safety`).

## 3. DB 계약

### 3.1 공통 규칙

SP4 §3.1 의 규칙을 그대로 잇는다. 아래는 SP5 에서 달라지거나 더하는 것이다.

| 규칙 | 내용 | 근거 |
|---|---|---|
| 파일 형식·머리 주석 | 정방향에 `begin;`/`commit;` 없음, 롤백은 `begin;`…`commit;`·역순·`cascade` 0. 머리 주석의 파일 경로·리허설 이름은 **접미로**(`supabase/rollbacks/*_calendar_rollback.sql` 꼴) — rename 이 내용 변경 0 이 되게. 롤백 머리에 "되돌리지 않는 데이터"(A: 이관이 기록한 설정 값·이력, B1: 새 정책으로 발번한 코드, B2: 회의록 `team_id`, B3: 톰스톤 행, B4: 이관으로 바꾼 code) | SP4 §3.1, D2 |
| 함수 | `language plpgsql security definer set search_path to ''`(헬퍼는 `language sql stable` 또는 plpgsql stable), 본문은 `public.`·`pg_catalog.` 한정. 새 함수 전부 `revoke all … from public, anon, authenticated;`, 서버 RPC 만 `grant execute … to service_role;`. 트리거 함수·헬퍼(`is_workday`·`week_key_of`·`week_key_from_rules`·`render_issue_code`·`module_effective`)는 grant 없음. 행위자 인자 `p_actor`(받으면 본문에서 재판정 — `create_team`·`ensure_team_roots`·`migrate_setting_code`). **EXECUTE 기대표**(사후검사가 본다): 새 함수 = anon·authenticated 거짓, 서버 RPC 만 service_role 참. **예외 둘** — ① 재생성한 기존 INVOKER 함수 사용현황 5종은 기존 ACL 승계(public·anon 거짓, authenticated·service_role 참 — D14) ② `minute_folders_kind_guard` 는 SECURITY INVOKER 트리거 함수(D49 — 트리거 함수 실행은 EXECUTE 권한을 보지 않으므로 grant 없음 그대로)(비평 반영 — S7·S1) | H2 규칙 ①, 개정 §2.3.2 |
| 시그니처가 바뀌는 함수 | 사용현황 5종(`p_timezone` 추가 — `usage_sessions` 는 `p_gap_minutes` 앞)·`create_issue_from_minute_block`(인자·반환)은 `drop function <옛 시그니처>` + `create function`. `drop`+`create` 는 ACL 을 기본값(PUBLIC EXECUTE)으로 되돌리므로 회수·부여를 명시하고, 사후검사가 기대표로 본다 — 사용현황 5종: public·anon 거짓·authenticated·service_role 참, `create_issue_from_minute_block`: service_role 만(비평 반영 — S7) | SP4 Q40(새 함수의 service_role 기본 권한) |
| 설정 행 잠금 | 설정을 읽어 판정하는 트리거는 먼저 `select values from public.project_settings where project_id = new.project_id for share`(무프로젝트 회의록 첨부는 `workspace_settings` — D24). 행 없음 `P0001 SETTINGS_ROW_MISSING`, 모양 손상 `22023 CONFIG_INVALID:<key>`. 키 없음은 제품 기본값. 설정을 읽어 판정하는 **RPC** 도 같다 — `create_team`(워크스페이스 행 `FOR SHARE`)·`ensure_team_roots`(`FOR UPDATE`)·`create_issue_from_minute_block`(워크스페이스 → 프로젝트 `FOR SHARE`). **의도된 예외**: 의존성 트리거 둘(`guard_dependent_wbs_dates`·`validate_task_dependency`)은 설정 행을 잠그지 않고 격리 가드도 넣지 않는다 — 근무 요일·휴일을 바꿔도 기존 일정을 다시 검증하지 않으므로(사용자 결정 3) 직렬화가 지킬 불변식이 없고, 의존성 쓰기와 설정 저장이 서로 기다릴 일도 없다(비평 반영 — S13) | 개정 §2.4.1, E24 |
| 격리 가드(25001) | 잠금 뒤 다른 행을 읽어 판정하는 새·재정의 함수: 주 키 트리거(`WEEK_KEY_ISOLATION`), 채번 트리거(`ISSUE_CODE_ISOLATION`), `create_team`(`TEAM_CREATE_ISOLATION`), `ensure_team_roots`(`TEAM_ROOTS_ISOLATION`), 전환 RPC(SP4 `TEAM_CONVERT_ISOLATION` 유지), 첨부 가드(`MINUTE_ATTACHMENT_ISOLATION` 유지 — `0011` ⑪ 은 그때만 돌므로 상시 보호는 `tests/rls` 케이스), 어휘 트리거(`PROJECT_VOCAB_ISOLATION`), `migrate_setting_code`(`SETTING_CODE_MIGRATE_ISOLATION`). 글자 그대로 SP4 §3.1 의 문장 + "이 가드에서 놓치는 것" 주석 한 줄. 사후검사가 `prosrc` 를 본다 | H2 규칙 ③, 개정 SP5-5 |
| `settings_ref_check` | 분기를 누적한다 — `_calendar` 가 `calendar.week_start` 분기를 더해 `create or replace`, `_vocab_settings` 가 그 본문에 어휘 분기를 더해 다시 `create or replace`. 앞 분기를 지우지 않음을 사후검사가 `prosrc` 로 본다(`'calendar.week_start'` 문자열 존재). SP4 `_authz_carry` 가 다시 만든 `apply_project_settings` 는 건드리지 않는다(호출 지점 그대로) | 개정 §2.3.2 분기 표, SP4 워크트리 `0015_authz_carry.sql` |
| 번호를 참조하지 않는다 | 사전·사후검사 토큰 `CALENDAR_PRECHECK`·`CALENDAR_POSTCHECK`·`ISSUE_AREAS_PRECHECK`·`ISSUE_AREAS_POSTCHECK`·`MINUTES_TEAMS_PRECHECK`·`MINUTES_TEAMS_POSTCHECK`·`ATTACHMENTS_POSTCHECK`·`VOCAB_SETTINGS_POSTCHECK`. 새 픽스처 uuid 표지 `5c05`, 테스트 id 범위 `…7e57-0000000019NN`(SP4 `18NN`·레인 B `15NN` 와 겹치지 않게), 테스트 워크스페이스 `…aa5N` | SP4 §3.1 |
| 새 표 | 없다. SP5 는 열·트리거·함수·정책만 더한다 — `isolation-map.ts` 등록 변경은 `issue_mega_areas` 삭제뿐(§3.7) | — |
| 세션 쓰기 표의 새 열 | 세션 쓰기 권한(표 단위 grant + 쓰기 정책)이 있는 표에 더하는 열은 세션이 쓸 수 있는 범위를 열 권한이나 트리거로 정하고 사후검사·RLS 테스트로 고정한다 — `minute_folders.kind·team_id`(D49 — 트리거), `holidays.kind`(관리자 정책 `admin_write_holidays` + `kind` check — 관리자가 `work` 를 쓰는 것이 정상 경로, D7), `teams`(세션 공용 팀 INSERT 정책 삭제 — D50, 표 단위 권한은 유지 — 재검토 반영 — R1) | H2 규칙 ② 의 취지(비평 반영 — S1·S10) |
| 이관 기록 | D57 — 0012 꼴(바뀐 키가 있을 때만 revision+1, `schema_version` 불변, 키마다 이력 `source='migration'`, 한 파일은 한 revision) | `0012_settings.sql` 이행 |
| SP4 본문 승계 | D12 — SP4 함수를 전문 재정의할 때 바탕은 태그 시점 본문, 사후검사가 SP4 핵심 토큰을 `prosrc` 로 본다 | 비평 반영 — S13 |
| 무수정 불변식 | `tests/rls/{workspace-isolation-cases,h2-table-grants}.test.ts` 는 고치지 않은 채 초록(D50 은 정책만 지우므로 `isolation-map`·`fixture-ws` 도 무수정 — 재검토 반영 — R1). `schema-invariants.test.ts` 는 B1 이 `OPEN_READ_EXCEPTIONS` 의 `issue_mega_areas` 한 줄만 지운다(개정 §2.11 픽스처 표) — 그 밖 무수정을 `git diff` 로 본다 | SP4 Q24 |
| 식별자 | `…atomic` 접미 0건 | CLAUDE.md |
| H2 규칙 ⑤ | 새 RLS 테스트는 부트스트랩 계정·이관 기록 값에 기대지 않는다 — 이관 ⑨ 은 빈 DB(CI)에서 0행에 적용되므로 픽스처 워크스페이스에는 `calendar.timezone` 이 없다(제품 기본값). 시간대·주 시작이 필요한 케이스는 픽스처가 설정 행에 직접 쓴다(D28 꼴) | memory `dflow-h2-done`(비평 반영 — S13) |
| H2 규칙 ④ | 해당 없음 — "마지막 하나를 지키는" 가드가 없다. 마지막 활성 이슈 영역의 비활성화는 허용(그 영역을 쓰는 패턴이면 새 이슈 등록이 `ISSUE_AREA_REQUIRED`/`INACTIVE` 로 막힌다). 어휘의 "`open`·`resolved` 범주에 활성 1개 이상" 같은 하한은 SP5b 의 상태 어휘에만 있다. SP5 어휘 5키의 "활성 1개 이상"은 TS 검증(저장 전)으로 충분 — 저장이 설정 행 `FOR UPDATE` 아래 한 RPC 라 경합이 없다 | — |

### 3.2 `NNNN_calendar`

| 절 | 내용 |
|---|---|
| ① 사전검사 | `CALENDAR_PRECHECK`(23514) — `weekly_reports.week_start` 가운데 `extract(isodow) <> 1` 인 행이 있으면 목록(`left(…, 600)`)과 조치("그 문서의 주 키를 월요일로 고친 뒤 다시 적용")를 적고 멈춘다(개정 §4.2.4 이관 3 의 raise) |
| ② `holidays.kind` | `alter table public.holidays add column kind text not null default 'off' check (kind in ('off','work'));` — 기존 행은 전부 `off`. RLS `admin_write_holidays` 무변경(D7) |
| ③ 헬퍼 | `public.week_rules_of(p_values jsonb) returns jsonb`(내부 — `values->'calendar.week_start'` 를 모양 검사 후 반환, 없으면 `[{"day":"sunday","from":null}]`, 손상이면 22023), `public.is_workday(p_project_id uuid, p_date date) returns boolean`, `public.week_key_of(p_project_id uuid, p_date date) returns date`(판독형 — 설정을 읽는다), `public.week_key_from_rules(p_rules jsonb, p_date date) returns date`(규칙 인자형 순수 헬퍼 — `immutable`, D53) — 판독형은 `stable`, 잠금 없음(호출 트리거가 잡는다), 모두 EXECUTE 무부여(D37). 키 계산 본문은 `week_key_from_rules` 하나이고 `week_key_of` 는 그것을 부른다 — 개정 §4.2.4 의 키 함수를 그대로 옮긴다(과도기 창 `[E−10, E−4]`) |
| ④ 의존성 트리거 | `guard_dependent_wbs_dates`·`validate_task_dependency` 를 기준선 본문 위에서 `create or replace` — `extract(isodow from d) < 6 and not exists (holidays …)` 3곳 → `public.is_workday(<project_id>, d::date)`. 그 밖 줄 무변경(사후검사가 `prosrc` 에 `isodow` 0건). 설정 행 잠금·격리 가드를 넣지 않는다 — §3.1 "설정 행 잠금"의 의도된 예외. 성능 게이트(D59)를 넘으면 규칙을 한 번 읽는 집합형 헬퍼 `has_workday(p_project_id, p_from, p_to)` 로 세 곳을 바꾼다 |
| ⑤ 사용현황 RPC 5종 | `usage_summary`·`usage_daily_actives`·`usage_menu_ranking`·`usage_user_rollup`·`usage_sessions` — 기준선 본문의 `'Asia/Seoul'` 16곳 → `p_timezone`. `p_timezone` 은 네 함수에서 맨 뒤, `usage_sessions` 에서 `p_gap_minutes` 앞. **`language sql stable`·INVOKER 유지**, 검증은 SQL 식(빈 표에서도 잘못된 tz 가 22023 을 내도록 본문 첫 FROM 항목이 `p_timezone` 을 쓴다 — 보장 못 하면 plpgsql `return query` + INVOKER), TS 가 22023 → `USAGE_TIMEZONE_INVALID`(D14). 시그니처 교체(§3.1) 뒤 `revoke all … from public, anon` + `grant execute … to authenticated, service_role`(비평 반영 — S7) |
| ⑥ 주 키 트리거 | `public.weekly_reports_week_key_guard()` + `create trigger … before insert or update of week_start on public.weekly_reports for each row`. 순서: 설정 행 `FOR SHARE`(`values` 를 변수로) → 격리 가드 → `new.week_start <> public.week_key_from_rules(public.week_rules_of(<잠근 values>), new.week_start)` 면 23514 `WEEK_KEY_INVALID`(D8·D53) |
| ⑦ `settings_ref_check` 분기 | **정확 판정**(D53, 비평 반영 — S2): `calendar.week_start` — 새 규칙 = `week_rules_of(coalesce(p_new, '[{"day":"sunday","from":null}]'))`(unset = 제품 기본값 일요일), 그 프로젝트 주간 문서 가운데 `week_key_from_rules(<새 규칙>, week_start) <> week_start` 인 행이 있으면 `CONFIG_IN_USE`(0012 오류 꼴, detail 에 해당 `week_start` 목록 최대 20). 과거 원소 수정 금지(`from ≤ T`)는 TS `toStored` 가 판정하고 이 분기는 문서 키 유효성만 본다(D38 미리보기와 같은 정의). `calendar.timezone` — `now() at time zone <새 값>` 이 22023 이면 `CONFIG_INVALID:calendar.timezone`(D54, 비평 반영 — S4) |
| ⑧ 가져오기 RPC | SP4 `_command_receipts` 의 `import_wbs`·`replace_wbs` 본문을 `create or replace` 하되 휴일 upsert 를 `insert … (project_id, date, name, kind) values (…, 'off') on conflict (project_id, date) do update set name = excluded.name where public.holidays.kind = 'off'` 로(D7·D12). 반환 형태 불변 |
| ⑨ 이관 1 — 시간대 | 기존 워크스페이스·프로젝트 설정 행 전부에 `calendar.timezone = "Asia/Seoul"` 기록(키가 이미 있으면 건드리지 않는다), 이력 `source='migration'`(D57 — 0012 이행 꼴: 바뀐 키가 있는 범위 행만 revision+1·`schema_version` 불변·키마다 이력 행, ⑨·⑩ 은 한 revision). 워크스페이스·프로젝트 `calendar.working_days`·워크스페이스 `calendar.week_start` 는 기록하지 않는다(R1 — 기본값 `[1..5]` 가 현행, 워크스페이스 `sunday` 는 결정 4) |
| ⑩ 이관 2 — 주 시작 | `weekly_reports` 가 1건 이상인 프로젝트마다(§8 #2 기본값): T = `(now() at time zone 'Asia/Seoul')::date`(⑨ 의 값), K = T 의 월요일, E = K + 6(일요일), `E <= T` 면 E += 7, `max(week_start) >= E` 면 E = `max(week_start) + 6`. `calendar.week_start = [{"day":"monday","from":null},{"day":"sunday","from":E}]`, 이력 `source='migration'`. 문서 0건 프로젝트는 키 없음(= 일요일). **§8 #2 의 대안이 채택되면** 이 절은 `[{"day":"monday","from":null}]` 만 기록한다(같은 절의 한 줄 교체 — 그 SQL 을 주석으로 함께 둔다) |
| ⑪ 사후검사 | `CALENDAR_POSTCHECK` — 헬퍼 넷·트리거 함수 EXECUTE: anon·authenticated 거짓(service_role 은 보지 않는다 — SP4 Q40), 사용현황 5종은 public·anon 거짓·authenticated·service_role 참·`prolang` 이 sql(또는 계획이 고른 plpgsql)·`prosecdef` 거짓(INVOKER), 의존성 트리거 두 본문에 `isodow` 0·`is_workday` 존재, 주 키 트리거 존재, `settings_ref_check` 에 `'calendar.week_start'`·`'calendar.timezone'`·`week_key_from_rules`, SP4 가져오기 RPC 토큰(D12 승계 검사), 주차 문서가 있는 프로젝트 전부 `calendar.week_start` 보유(§8 #2 기본값일 때 두 원소), 설정 행 전부 `calendar.timezone` 보유, `holidays.kind` 가 전부 `'off'`, 기존 주차 문서 전부가 `week_key_of` 와 같다(트리거가 이관 뒤 update 를 막지 않음을 보장) |

롤백(`*_calendar_rollback.sql`): 트리거·헬퍼 삭제, 의존성 트리거·사용현황 5종·가져오기 RPC 를 이전 본문(SP4 정의)으로, `holidays.kind` 삭제(`work` 행이 있으면 raise — 휴무로 오해되는 행이 생긴다. 조치: 그 행을 지우고 다시), `settings_ref_check` 를 0012 골격으로. 설정 값·이력(⑨⑩)은 되돌리지 않는다(머리 주석).

### 3.3 `NNNN_issue_areas`

개정 §4.4.3 의 DB 절과 이관 1~6·조건부 롤백을 그대로 따른다. 더하거나 정한 것:

| 절 | 내용 |
|---|---|
| ① 사전검사 | `ISSUE_AREAS_PRECHECK` — `mega_code` 가 있는데 `issue_mega_areas` 에 없는 값(FK 가 막았어야 함), `pi_issue_code` 중복, 범위별 `last_no < max(mega_seq)` 를 목록으로 멈춘다 |
| ② 영역·열 | 개정 §4.4.3 의 `issues` 열·복합 FK·유일 인덱스·CHECK, `issue_major_processes.area_id`(+ 식별 키·형제 유일 키 재정의), `issue_number_counters.scope_key`(PK 교체). SP4 `project_areas_guard` 를 `create or replace` 해 `kind='issue_area'` 일 때 code `^[A-Z0-9]{1,8}$`·불변(D17), `upsert_project_area` 의 입력 검사도 같은 규칙(SP4 정의 위 `create or replace`) |
| ③ 채번 | `public.render_issue_code(p_policy jsonb, p_area_code text, p_year int, p_seq bigint) returns text`(immutable, TS `renderIssueCode` 와 패리티), 트리거 `public.assign_issue_code()` BEFORE INSERT — 설정 행 `FOR SHARE` → 격리 가드 → 정책 해석(없으면 제품 기본값 `ISS`) → `{area}` 면 `area_id` 필수·활성(영역 행을 `for key share` 로 읽는다 — SP4 `upsert_project_area` 의 비활성화 `for update` 커밋 뒤 값을 본다, 비평 반영 — S13) → `{yyyy}` 는 `(now() at time zone <프로젝트 calendar.timezone>)` 의 연도 → 카운터 upsert(행 잠금) → 겹침이면 `while exists` 로 seq 증가(1,000회 넘으면 `ISSUE_CODE_EXHAUSTED`) → `code`·`code_seq`·`code_scope`·`code_area_id`. `ISSUE_CODE_IMMUTABLE` 트리거는 `code` 계열 셋에 유지. 영역 갱신 규칙: `code_area_id` 가 not null 이면 `area_id` 는 그 값과 같아야 하고(다르면 거부), null 이면 자유(ISS·레거시 코드 이슈의 나중 분류 — D55 ②, 비평 반영 — S5). 채번 트리거는 `code_scope = 'legacy'` 를 쓰지 않는다. `assign_issue_analysis_code`(0010)·`assign_issue_major_seq` 의 `mega_code` 판독은 `area_id` 로 교체 |
| ④ 분석 제약 | 개정 §4.4.2 의 두 CHECK, 트리거의 `ISSUE_MAJOR_REQUIRED` 삭제 |
| ⑤ `create_issue_from_minute_block` | 시그니처 교체(D15) — `p_area_id uuid` 와 분석 인자 null 허용, 반환 `(issue_id uuid, code text)`, 영역 검사는 `project_areas`(그 프로젝트·`issue_area`·활성), 분석 인자를 받으면 **유효 모듈**(워크스페이스 `modules.allowed` ∋ ∧ 프로젝트 `modules.enabled` ∋ `'issue_analysis'` — 두 설정 행을 워크스페이스 → 프로젝트 순 `FOR SHARE`)을 확인(아니면 22023 `ISSUE_ANALYSIS_DISABLED` — 서버 액션의 모듈 관문 뒤 DB 방어). 영역 검사는 ③ 과 같은 `for key share` 문장. EXECUTE service_role 만(비평 반영 — S13) |
| ⑥ 이관 | 개정 §4.4.3 이관 1~6 + 모듈 편입(R6 ①②)·`issues.analysis='required'`(R2)·`issues.id_policy` — `pi_issue_code` 가 있는 프로젝트 = `{prefix:'PI', pattern:'{prefix}-I-{area}-{seq:2}', counter_scope:'area', reset:'never'}`, 나머지 = 키 없음(제품 기본값 `ISS-{seq:3}`). 코드 없던 기존 이슈는 `(created_at, issue_no)` 순서로 발번한다 — PI 프로젝트의 영역 없는(미분류) 이슈는 **채번 트리거를 만들기 전에** 이관 전용 레거시 형식 `{prefix}-U-{seq:3}`·`code_scope='legacy'`·`code_area_id null`(D55), 그 밖은 그 프로젝트 정책(`ISS-…`)(§8 #14 — 알림). 이력 `source='migration'`(D57 — 한 revision)(비평 반영 — S5) |
| ⑦ 대조·삭제 | 개정 이관 5·6 — 전후 이슈 수·코드 보유 수·범위별(`legacy` 범위 포함) `last_no = max(code_seq)`, 어긋나면 raise. 그다음 `mega_code`·`mega_seq`·`pi_issue_code`·옛 인덱스·CHECK·`issue_mega_areas` 표·개방 읽기 예외 삭제 |
| ⑧ 사후검사 | `ISSUE_AREAS_POSTCHECK` — 함수 EXECUTE 기대표, `issue_mega_areas` 부재, 모든 이슈 `code` 보유, `legacy` 범위 코드가 PI 템플릿과 겹치지 않음, 기존 프로젝트 전부 `modules.enabled ∋ issue_analysis`·워크스페이스 `allowed ∋`, 채번 트리거 `prosrc` 에 25001 문장·`for key share`, SP4 `project_areas_guard`·`upsert_project_area` 토큰(D12 승계 검사) |

롤백(비평 반영 — S5, D55 ③): 조건은 **모든 `issue_area` code `^[0-9]{2}$`** 하나 — 아니면 raise(조치 문구). 역매핑으로 `issue_mega_areas` 를 다시 만들고(이름은 영역의 현재 이름), PI 템플릿과 일치하는 코드의 이슈만 `mega_code`·`mega_seq`·`pi_issue_code` 를 되살리며 나머지(레거시·`ISS-…`·템플릿 밖)는 세 열 모두 null 로 돌린다(옛 CHECK mega ⇔ 코드 성립 — 그 코드 문자열·영역 분류는 "되돌리지 않는 데이터", 머리 주석). 리허설은 코드 없는 이슈가 있는 시드에서 적용 → 롤백 → 재적용 초록. 모듈 편입·`issues.analysis` 기록은 되돌리지 않는다(머리 주석 — SP4 D15 의 `modules.*` 비건드림 원칙과 다르다: R6 편입은 롤백 뒤에도 무해하다).

### 3.4 `NNNN_minutes_teams`

적용 순서는 다섯 파일 가운데 마지막이다(`_attachments`·`_vocab_settings` 뒤 — D1, 비평 반영 — S9). 바탕 본문은 `sp4-done` 태그 시점(D12).

| 절 | 내용 |
|---|---|
| ⓪ 사전검사 | `MINUTES_TEAMS_PRECHECK`(23514, 비평 반영 — S10·D52) — ① 이관 뒤 이름(`left(btrim(teams.name), 60)`)으로 바꿀 팀 루트가 같은 범위 루트 이름 유일 인덱스(`minute_folders_root_name_null_proj_uniq`·`minute_folders_root_name_proj_uniq`)에서 다른 폴더와 겹치는 목록 ② `length(btrim(teams.name)) > 60` 인 팀(폴더 이름 CHECK `between 1 and 60`) — 목록 `left(…, 600)` 과 조치("겹치는 폴더 이름을 바꾸거나 팀 이름을 60자 이하로 바꾼 뒤 다시 적용")를 적고 멈춘다 |
| ① 폴더 | 개정 §4.7 SQL(`kind`·`team_id`·CHECK 둘·유일 인덱스)에서 FK 동작만 `team_id … on delete no action`(D51·E28). 이관: `parent_id null ∧ created_by null` 행 → 같은 워크스페이스에서 이름이 팀 code 와 같은 팀(프로젝트 폴더면 그 프로젝트의 같은 code 전용 팀, 없으면 공용 — D18 의 code 단위 규칙) → `team_root(team_id)`, 아니면 `custom_root`(탈퇴 사용자의 루트도 `created_by` 가 SET NULL 이라 여기에 든다 — 리허설 경우). 이름은 `left(btrim(teams.name), 60)` 으로 맞춘다(개명 동기의 시작점 — 표시가 code → 이름으로 바뀐다, 눈확인 행. E27·D52, 비평 반영 — S12) |
| ①′ 종류 가드 | `minute_folders_kind_guard`(D49, 비평 반영 — S1) — INVOKER, `BEFORE INSERT OR UPDATE OR DELETE`, 세션이면 `kind`·`team_id` 쓰기·팀/사용자 지정 루트의 insert·update·delete·비활성 팀 루트 아래 insert/이동·팀 이름 선점을 거부. 세션 쓰기 정책 셋(`0006:320-329`)은 그대로 둔다(일반 폴더의 세션 쓰기는 현행) |
| ② 회의록 | `minutes.team_id uuid references public.teams(id) on delete set null`(nullable — D18·D51, 비평 반영 — S10). 이관 D18(code 단위). `team_code` 메아리 트리거 `minutes_team_code_echo` — `team_id` 가 있으면 `new.team_code := teams.code`, 없으면 입력값 유지(NOT NULL 유지 — FK 의 SET NULL 갱신도 이 BEFORE 트리거를 타서 원문이 남는다). 인덱스 `(workspace_id, team_id)` |
| ②′ 범위 가드 | `minutes_team_scope`·`minute_folders_team_scope`(D51, DEFINER, `BEFORE INSERT OR UPDATE OF team_id, project_id, workspace_id`) — 팀이 같은 워크스페이스이고 공용이거나 그 행 프로젝트의 전용 팀이어야 한다, 아니면 23514 `MINUTE_TEAM_SCOPE`. 무프로젝트 회의록·워크스페이스 루트는 공용 팀만. UPDATE 에서 `project_id` not null → null ∧ `team_id` 불변이면 판정하지 않는다(프로젝트 삭제 SET NULL 연쇄 — D51, 재검토 반영 — R4) |
| ③ `create_team` | `public.create_team(p_actor uuid, p_workspace_id uuid, p_code text, p_name text, p_color text, p_sort_order int) returns uuid` — 워크스페이스 관리자 재판정(`actor_is_workspace_admin` — 없으면 같은 꼴로 새 헬퍼) → 워크스페이스 설정 행 `FOR SHARE` → 격리 가드 → insert team → `minutes.root_folders.mode = 'teams'` 면 워크스페이스 루트(`project_id null`, 이름 `btrim(p_name)` — 60자를 넘으면 절단하지 않고 23514 `TEAM_ROOT_NAME_TOO_LONG`, 같은 범위 루트 이름 유일 인덱스와 겹치면 23505 `TEAM_ROOT_NAME_CONFLICT`: 개명 경로와 같은 오류, 재검토 반영 — R9) insert. 실패면 전체 롤백. EXECUTE service_role 만. `addTeam` 액션이 이것을 부른다. **공용 팀의 세션 INSERT 를 닫는다** — `drop policy wsadmin_insert_teams on public.teams` 만(표 단위 `revoke insert` 는 하지 않는다 — D50, 비평 반영 — S10, 재검토 반영 — R1). `public.ensure_team_roots(p_actor uuid, p_workspace_id uuid) returns int` — 워크스페이스 관리자 재판정 → 설정 행 `FOR UPDATE` → 격리 가드(`TEAM_ROOTS_ISOLATION`) → 모드를 다시 읽어 teams 일 때만 활성 공용 팀 중 루트 없는 것의 루트를 만든다(멱등, 같은 insert SQL 을 `create_team` 과 공유 — 이름 규칙·오류도 같다). 설정 4표를 쓰지 않으므로 "설정 쓰기 한 길"과 충돌하지 않는다. 지연 수렴은 D50 ④ |
| ④ 개명 동기 | `teams_name_sync_minute_roots` AFTER UPDATE OF name(DEFINER) — `minute_folders.name := left(btrim(new.name), 60)`(`kind='team_root' ∧ team_id = new.id`). 유일 인덱스와 겹치면 23505 `TEAM_ROOT_NAME_CONFLICT`, 60자 초과면 23514 `TEAM_ROOT_NAME_TOO_LONG` — 개명 액션이 문구로 돌려준다(D20·D52) |
| ⑤ 전환 RPC | SP4 `convert_inherited_teams` 를 그 정의 위에서 `create or replace` — **복사 대상 `exists` 목록과 UPDATE 목록 둘 다**에 `minutes`(그 프로젝트)·`minute_folders`(그 프로젝트)를 더한다(회의록·폴더만 가리키는 비활성 공용 팀도 복사·이동). 결과 jsonb 에 두 건수(D19 ③, 비평 반영 — S13) |
| ⑥ M1 가드 확장 | SP4 `team_ref_owned_scope` 를 `cd66d6c` 본문 위에서 `create or replace` — `tg_table_name` 분기형에 `minutes`·`minute_folders` 분기 둘을 더한다(`v_project := new.project_id`, `v_teams := array[new.team_id]`, **UPDATE 에서 `team_id`·`project_id` 가 그대로면 통과** — "새로 생기는 참조만"), `else` 의 55000 `TEAM_SCOPE_TRIGGER_MISPLACED` 유지. 트리거 둘(`before insert or update of team_id, project_id`, `project_id` 가 있는 행만 판정)(비평 반영 — S11) |
| ⑦ 수신 RPC | `create_minute_with_version`(최신 `0007`)의 `p_team_code` 를 유지하고 본문에서 `team_id` 를 code 단위로 해석해 넣는다(D18 — 프로젝트 회의록은 그 프로젝트의 같은 code 전용 팀, 없으면 공용 팀, 무프로젝트는 공용 팀. **다른 프로젝트의 전용 팀은 고르지 않는다**). 고른 팀이 비활성이면 지금과 같은 `MINUTE_TEAM_INVALID`(23503 — 전용이 비활성일 때 공용으로 내려가지 않는다, 새 code 없음 — 개정 Q6). M1 의 `for key share` 대기 뒤 `TEAM_SCOPE_PROJECT_OWNED`·40P01 은 외부 API 가 재시도 가능(503)으로 매핑한다(v2.9 절 한 줄, K6) |
| ⑧ 사후검사 | `MINUTES_TEAMS_POSTCHECK` — `parent_id null ∧ created_by null ∧ kind='user'` 0행, 함수 EXECUTE 기대표, 정책 `wsadmin_insert_teams` 부재·`teams` INSERT 정책 중 `project_id is null` 을 허용하는 분기 0(표 단위 INSERT 권한은 남는다 — 재검토 반영 — R1), 종류 가드·범위 가드 둘·메아리·개명 동기 트리거 존재, 전환 RPC 의 이동 열 카탈로그 불변식(SP4 테스트가 잡는다 — 여기서는 `prosrc` 에 두 표 이름), SP4 토큰(`TEAM_CONVERT_ISOLATION`·`TEAM_SCOPE_PROJECT_OWNED`·`for key share` — D12), 회의록 `team_id` 이관 건수·null 건수 `raise notice` |

롤백: **폴더 이름을 먼저 되돌린다** — `team_id` 를 지우기 전에 `update public.minute_folders f set name = t.code from public.teams t where f.kind = 'team_root' and t.id = f.team_id`(겹치면 raise·조치 문구 — 옛 코드는 `parent_id null ∧ created_by null ∧ name = code` 로 루트를 찾는다, D52 ③, 비평 반영 — S10). 그다음 트리거·RPC 삭제, `wsadmin_insert_teams` 정책 복원(`teams` INSERT 권한은 회수한 적이 없다), 전환 RPC·M1 가드·수신 RPC 를 SP4·0007 본문으로, `minutes.team_id`·`minute_folders.kind`·`team_id` 삭제. 리허설에 "롤백 → 옛 조회로 루트 발견"(머리 주석의 되돌리지 않는 데이터: 회의록 `team_id` 이관 결과).

### 3.5 `NNNN_attachments`

| 절 | 내용 |
|---|---|
| ① 톰스톤 | `minute_files` 에 `deleted_at timestamptz`, `deleted_by uuid`, `purged_at timestamptz`, CHECK `(purged_at is null or deleted_at is not null)`. 톰스톤 쓰기 길 = **service_role**(D56, 비평 반영 — S6) — `removeMinuteFile` 이 지금의 가드(`requireActor` → `checkOwner`) 뒤에서 `update … set deleted_at = now(), deleted_by = <actor> where id = … and role = 'attachment' and deleted_at is null`. 세션 UPDATE 회수(`0011:603-604`)는 유지 — 열 UPDATE 를 다시 열지 않는다. `docs/sp2-admin-client-audit.md` 에 분류 |
| ①′ 전이 가드 | `minute_files_mutation_guard` BEFORE UPDATE — **모든 역할**(service_role 포함)에 걸린다. 허용 전이는 (a) `deleted_at` null → not null(같은 문장에서 `deleted_by` not null) (b) `deleted_at` not null 일 때 `purged_at` null → not null (c) `uploaded_by`·`deleted_by` 가 not null → null 이고 다른 열은 그대로(계정 삭제의 FK `set null` 연쇄 — 재검토 반영 — R3) 셋뿐. 되돌림(되살리기)과 `file_path`·`size`·`mime`·`minute_id`·`role`·`uploaded_by`(not null → null 은 (c) 가 허용) 변경은 23514 `MINUTE_FILE_IMMUTABLE`(D56) |
| ①″ 세션 삭제 | 세션 첨부 DELETE 정책 `attachment_delete_minute_files`(`0007`)를 지우고 `revoke delete on public.minute_files from authenticated` 를 함께 한다 — 톰스톤이 첨부의 유일한 삭제 길(D56 ③, 재검토 반영 — R2). 계획이 세션 DELETE 의 다른 사용처 0 을 grep 으로 확인 |
| ② 가드 재정의 | `minute_files_attachment_guard` 를 H2-h 의 ①~⑧ 순서 그대로 다시 쓰고 ⑥(개수 — `0011` 의 실제 번호)과 새 총량 검사만 `deleted_at is null` 로 좁히며 ⑤(중복)는 전체 행 그대로 둔다(D23, 비평 반영 — S13), 설정 행 `FOR SHARE`(D24 — 회의록의 `project_id` 유무로 표 선택)를 ② 의 회의록 행 잠금 **뒤**에 둔다. 더하는 검사: enabled·크기·총량·확장자(D23 의 오류 넷). 격리 가드 `MINUTE_ATTACHMENT_ISOLATION` 문장 유지 |
| ③ 산출물·이슈 첨부 경로 | `deliverable_attachments`·`issue_attachments` insert 정책에 `file_path` 범위 검사(H2-g 의 `attachment_object_exists` 와 같은 경로 규칙 — 그 엔티티의 워크스페이스·프로젝트·id 접두). 옛 형식 경로 행 수를 `raise notice` 로 보고(로컬 데이터 — 이관 없음, 행은 남는다: 지금도 앱 삭제로 지워지지 않는 행이다) |
| ④ 사후검사 | `ATTACHMENTS_POSTCHECK` — 가드 `prosrc` 에 25001 문장·`deleted_at is null`·설정 키 이름, 첨부 가드·전이 가드 트리거 존재, 정책 `attachment_delete_minute_files` 부재·`has_table_privilege('authenticated','public.minute_files','DELETE')` 거짓(재검토 반영 — R2), 두 정책의 `with check` 에 경로 함수 |

롤백: 전이 가드 삭제, 세션 DELETE 정책을 `0007` 정의로·`grant delete on public.minute_files to authenticated` 복원, 가드를 `0011` 본문으로, 톰스톤 열 삭제(톰스톤 행이 있으면 raise — 조치: 청소 잡 `--apply` 로 정리하거나 그 행을 지운다), 두 정책을 이전 정의로.

### 3.6 `NNNN_vocab_settings`

| 절 | 내용 |
|---|---|
| ① check 삭제 | `attendance_records_type_check`·`meetings_category_check`·`issues_severity_check`·`issues` 의 `source_type` check(`0055` 계열 — 기준선 이름 확인) |
| ② 어휘 트리거 | `public.enforce_project_vocab()` 하나를 표·열별 트리거 넷으로 — `attendance_records(type)`·`meetings(category)`·`issues(severity)`·`issues(source_type)`(`before insert or update of <열>`). UPDATE 에서 값이 그대로(`new.<열> is not distinct from old.<열>`)면 설정 잠금 없이 통과(D58 — 새로 생기는 값만 판정, 비평 반영 — S13). 그 밖은 설정 행 `FOR SHARE` → 격리 가드 → 활성 code 집합에 없으면 23514 `PROJECT_VOCAB_INACTIVE:<key>:<code>`. 키 없음 = 제품 기본값(현 목록 — R1). `source_type` 은 null 허용(분석 모듈 꺼진 이슈) |
| ③ `settings_ref_check` 어휘 분기 | `_calendar` 본문에 더한다(§3.1). 어휘 5키 — 옛 목록에 있고 새 목록에서 빠진 code, 또는 의미 속성(`attendance.types.counts_as` 등 개정 §2.8.2 검증 칸)이 바뀐 code 의 참조 행을 센다 → 1건 이상이면 `CONFIG_IN_USE`(detail: 키·code·건수). `issues.cause_categories` 는 분석 실행 JSON 참조라 "삭제 금지"(개정 §2.4.2 — TS 가 거부, SQL 분기 없음) |
| ④ `migrate_setting_code` | `public.migrate_setting_code(p_actor, p_project_id, p_key text, p_from text, p_to text)` — 프로젝트 관리자 재판정 → 설정 행 `FOR UPDATE` → 격리 가드 → `p_to` 가 활성인지 → 참조 행 update(같은 트랜잭션) → 건수 반환. **이력은 남기지 않는다** — 건수는 반환값으로 화면에 보이고, 뒤따르는 code 삭제 명령이 이력을 남긴다(이력 표에 주석 열이 없고 `unique (project_id, revision, key)` 다, D58, 비평 반영 — S13). 어휘 트리거와 엇갈린 40P01 은 액션이 503 재시도로 매핑. EXECUTE service_role 만. 어휘 code 를 지우려면 이관 → 삭제의 두 명령(개정 §2.4.2) |
| ⑤ 사후검사 | `VOCAB_SETTINGS_POSTCHECK` — check 넷 부재, 트리거 넷, `settings_ref_check` 에 두 분기 문자열, EXECUTE 기대표 |

롤백: check 를 되살리기 전에 목록 밖 code 행이 있으면 raise(조치: `migrate_setting_code` 로 옛 code 로), 트리거·함수 삭제, `settings_ref_check` 를 `_calendar` 본문으로.

### 3.7 격리 맵·픽스처·RLS 테스트

도는 순서(A → B1 → B3 → B4 → B2)로 적었다.

| 체크포인트 | 변경 |
|---|---|
| A | `fixture-ws.sql`·SP4 `weekly-areas.test.ts` 의 임시 프로젝트·`isolation-map.ts` 의 주간 탐침 — 주간 문서가 있는 프로젝트의 설정 행에 `calendar.week_start=[{monday,null}]` 을 주간 insert **앞**에(D28 — 마이그레이션 앞 커밋 ①, 비평 반영 — S8). 새 `tests/rls/calendar-parity.test.ts`(골든 행렬 — 근무 `[1..5]`·`[7,1,2,3,4]`·`[1..6]`, `off`/`work` 예외, 전환 예시 3건, 의존성 트리거의 토요일 거부·일요일 허용, `week_key_from_rules` 대 `weekKeyOf`, **tz 허용 집합 TS ⊂ PG**(`UTC` 포함 — D54)), `week-start-transition.test.ts`(직접 insert·update 23514, 경합 — 독립 연결 2개, 저장 거부 `CONFIG_IN_USE`, **미적용 전환을 더 늦은 날로 교체 — 사이 문서 있음 → 거부, unset → 기본 일요일(월요일 문서 있으면 거부)**(D53), 잘못된 tz 저장 `CONFIG_INVALID:calendar.timezone`, 과도기 6/8일, UNIQUE 위반 0, 이월 원본 = 직전 키), `usage-timezone.test.ts`(LA·UTC 일자 경계, 잘못된 tz 22023 — **빈 `usage_events` 에서도**, 비슈퍼유저 세션 실행 시 RLS 로 0행, EXECUTE 기대표 — D14), `command-receipts.test.ts` 에 `work` 행 회귀 |
| B1 | `isolation-map.ts` 의 `OPEN_BY_DESIGN`·탐침, `schema-invariants.test.ts` 의 `OPEN_READ_EXCEPTIONS` 에서 `issue_mega_areas` 삭제, `OWN_INSERT_PROBES` 의 `issue_major_processes(mega_code)` → `area_id`. 새 `issue-areas.test.ts`(이관 대조·영역 code 규칙·비활성·복합 FK 교차 프로젝트 거부·**비활성화 커밋과 동시 등록 — 비활성 영역에 이슈 0**·**레거시 코드 이슈에 나중 영역 지정 허용, 영역 코드 이슈의 영역 변경 거부**), `issue-code-policy.test.ts`(동시 100건 유일·무결번, `{yyyy}` LA 12/31 23:30, 정책 변경 뒤 불변, 겹침 건너뛰기, 1,000회 상한, TS 렌더와 패리티, 레거시 범위는 트리거가 쓰지 않음). `issue-code-width.test.ts` 를 새 트리거로. `create_issue_from_minute_block` 의 유효 모듈 판정(워크스페이스 허용 회수 → 거부) |
| B3 | `h2-minute-bucket.test.ts`·`h2-minute-manage-parity.test.ts`·`h2-attachment-guard.test.ts`·`h2-share-token.test.ts` 회귀 + 새 `minute-attachments-policy.test.ts`(두 프로젝트 다른 정책 → 가드 제한, 톰스톤 제외 한도, 톰스톤 경로 재전송 = `MINUTE_ATTACHMENT_DUPLICATE`, 크기·총량·확장자·disabled, 무프로젝트 회의록 = 워크스페이스 정책, 동시 두 연결 한도 근처 → 개수 초과 0, 25001, TS 해석기와 패리티, **service_role 로 `deleted_at → null` 거부·`file_path` 변경 거부·세션 DELETE 거부·톰스톤 행 서명 발급 거부·목록 0건**(D56, 비평 반영 — S6)), 산출물·이슈 첨부 범위 밖 `file_path` insert 거부 |
| B4 | 새 `config-vocabulary.test.ts`(경합 — 참조 insert 대 code 삭제, 고아 0; 의미 속성 변경 `CONFIG_IN_USE`; 비활성 code insert 23514; `migrate_setting_code`; **값이 그대로인 UPDATE 는 판정 없이 통과, 동시 편집 대 이관 — 한쪽 40P01, 고아 0**(D58)) |
| B2 | 새 `minutes-teams.test.ts`(폴더 종류 이관·`create_team` 원자성·**세션 공용 팀 직접 insert 거부**(프로젝트 팀 `pa_insert_project_teams` 경로는 통과 — `h2-table-grants`·`isolation-map` 무수정, 재검토 반영 — R1)·**`create_team` 대 모드 전환 경합 — teams 모드에 루트 없는 활성 팀 0**·개명 동기·**개명 이름 충돌 `TEAM_ROOT_NAME_CONFLICT`**·**`create_team` 의 같은 이름·61자 이름 거부**(R9)·비활성 루트 쓰기 거부·custom 모드 팀 추가 → 폴더 0·M1 가드 두 표(UPDATE 무변경 통과)·**세션 위조 다섯**(팀 루트 선점 insert·`kind`/`team_id` update·팀 루트 delete 와 남의 하위 폴더 보존·비활성 루트 아래 insert·팀 이름 선점 — D49, 비평 반영 — S1)·**범위 가드 교차 워크스페이스·교차 프로젝트**(D51)·**재편철 시 `team_id` 재해석**·**전용 팀·회의록·폴더가 있는 프로젝트 삭제 통과**(E28)), `team-convert.test.ts` 에 회의록 두 열 이동 + **비활성 공용 팀을 회의록만 참조하는 프로젝트의 전환 → 새 전용 팀 id 로 이동** 케이스 |

### 3.8 리허설

데이터가 있는 업그레이드를 전용 스택에서(SP2·SP4 관례). 각 파일: 직전 체크포인트 상태 + 시드 → 적용 → 스모크 → 롤백 → 재적용 → 스모크. 카탈로그 R 불일치 0·기본 권한 diff 없음(`compare-catalog.mjs`).

| 파일 | 경우 |
|---|---|
| `*_calendar_week_start.sql` | ① 주간 문서 없는 프로젝트(키 없음 → 일요일) ② 과거 문서만(`[monday, sunday@E]`, E = 이관일 다음 일요일 규칙) ③ E 이후 미래 문서(E 가 `max+6` 으로 밀림) ④(음성) 월요일 아닌 키 → `CALENDAR_PRECHECK` 로 멈추고 `max(version)` = N−1 |
| `*_calendar_smoke.sql` | tz 두 스코프 기록(D57 꼴 — revision+1 한 번·`schema_version` 불변)·`holidays.kind` 기본·의존성 트리거 판정 불변(월~금 프로젝트에서 이관 전후 같은 결과)·사용현황 5종 호출(EXECUTE 기대표) |
| `*_issue_areas_smoke.sql` | 개정 이관 5 의 대조(PI 코드 프로젝트·코드 없는 프로젝트·영역 0 프로젝트·**PI 프로젝트 + 미분류 이슈 → 레거시 코드**) + `*_issue_areas_rollback_guard.sql`(롤백 가능 경우 — **코드 없는 이슈가 있는 시드에서 적용 → 롤백 → 재적용 초록**·영문 영역 code 가 있어 raise 하는 경우)(D55, 비평 반영 — S5) |
| `*_attachments_smoke.sql` | 톰스톤 열 기본, 가드 재정의 뒤 기존 첨부 수가 한도 안, 범위 밖 경로 행 보고, 전이 가드 존재 |
| `*_vocab_settings_smoke.sql` | check 삭제 뒤 기존 행이 트리거 판정을 통과(현 목록 = 제품 기본값), `settings_ref_check` 두 분기 |
| `*_minutes_teams_smoke.sql` | 사전검사 음성 둘(같은 이름 사용자 루트·61자 팀 이름 → `MINUTES_TEAMS_PRECHECK` 로 멈춤), 폴더 이관(팀 code 동명 → team_root, 아님 → custom_root, 프로젝트 루트, 탈퇴 사용자의 루트), 이름 = 팀 이름, 회의록 `team_id` code 단위 매칭·null 보고, 전환 RPC 의 두 열 이동, **롤백 → 옛 조회(`name = code`)로 루트 발견**, 전용 팀·회의록·폴더가 있는 프로젝트 삭제(비평 반영 — S10) |

## 4. 도메인·서버

### 4.1 달력 모듈 `src/lib/domain/calendar.ts`(A)

개정 §4.2.3 의 계약(`IsoDow`·`WeekStartDay`·`WeekStartRule`·`WorkCalendar`·함수 열)을 그대로 쓴다. 더하는 것:

| 항목 | 내용 |
|---|---|
| 이웃 키 | `prevWeekKey(key, rules)`·`nextWeekKey(key, rules)`(D35) |
| 규칙 연산 | `applyWeekStartChange(rules, newDay, today, docCount): WeekStartRule[]` — 개정 §4.2.4 변경 연산 표의 네 경우. `toStored` 와 `previewWeekStartChange` 가 이 함수 하나를 쓴다. 과거 원소(`from ≤ T`) 수정은 `CALENDAR_PAST_RULE` 로 거부(`CONFIG_INVALID` 로 매핑) |
| 검증 | 규칙 목록 — 첫 원소 `from null`, 이후 `from` 오름차순·그 날짜 요일 = `day`, 이웃 원소 `day` 다름. `working_days` — 길이 ≥1·1..7·유일. tz — `new Intl.DateTimeFormat('en', { timeZone })` 생성 성공(목록 포함이 아니다 — `'UTC'` 를 받는다), 저장은 `resolvedOptions().timeZone`, 정규화 결과가 IANA 이름 꼴이 아니면(오프셋 꼴 `+09:00`·`GMT+1`) 거부, 실패는 폴백 없이 거부(D54, 비평 반영 — S4, 재검토 반영 — R5) |
| 무한 루프 방지 | 다음 근무일 탐색은 3,660일 상한, 넘으면 `CALENDAR_NO_WORKDAY` throw(`dependencySchedule.ts` 의 do-while 포함) |
| `dates.ts` | `seoulToday`·`seoulYmd`·`seoulStamp`·`isWeekendDow`·`isBusinessDay`·`businessDaysBetween` 를 삭제한다. 날짜 산술(`addDaysIso` 등 tz 무관 함수)만 남는다 |
| 순수성 | `now` 를 주입받는다. 서버 진입점(페이지·액션·라우트)이 `new Date()` 를 한 번 만들어 내려보낸다 |
| 로더 | `src/lib/calendar/load.ts`(서버 전용) — `loadProjectCalendar(projectId, values)`(holidays 끝까지 + 설정 값) / `workspaceCalendar(values)`(날짜 예외 빈 집합). `getProjectConfig` 가 5조회로 `calendar` 를 싣고(D11), `getWorkspaceConfig` 가 `calendar` 를 싣는다(D36) |

### 4.2 주 키 이행과 설정 키(A)

| 항목 | 내용 |
|---|---|
| 정의 | 워크스페이스 `calendar.timezone`·`working_days`·`week_start`(요일), 프로젝트 같은 셋(`seedFrom` — 생성 시 복사, 상속 아님). 프로젝트 `week_start` 는 `edit: { parseInput: 요일 하나, toStored: applyWeekStartChange }`, 클라이언트 patch 의 목록은 `CONFIG_INVALID`(개정 §2.8.7). `EditCtx` 의 `today` 는 프로젝트 tz 의 `todayIn`, `loadWeekKeys` 는 그 프로젝트 문서 수(0 판정용) |
| 복사 | 프로젝트 복사는 `[{ day: <원본 마지막 규칙 day>, from: null }]`(`source='copy'`) |
| 미리보기 | `previewWeekStartChange`(D38) — `{ effectiveFrom: E \| null, transitionDays: 6 \| 8 \| null, keptDocs: N, blockingWeeks: string[] }`. 화면 '변경 내용 검토'가 "E 부터 일요일 시작, 전환 주 하나가 6일, 기존 주간보고 N건은 그대로"를 보인다 |
| 라벨·표시 요일 | `weekLabelOf`·`weekDisplayDays`(D4). 보고서의 `ceil(일자/7)`·시트의 "N번째 월요일"·5칸 고정(`WEEKDAY_LABELS`)을 지운다. 표시 칸 수는 근무일 수(근무일 0이면 기간 전체) |
| 소비 | §4.4 표 |

### 4.3 시간대(A)

| 경로 | 기준 tz | 구현 |
|---|---|---|
| 프로젝트 화면·액션·보고서·프로젝트 메일 | 프로젝트 | 페이지가 `getProjectConfig` 의 `calendar.timezone` 으로 `todayIn` 을 계산해 props 로. 클라이언트 표시 포맷 컴포넌트는 `timeZone` prop(필수 — 기본값 없음) |
| 워크스페이스 화면(회의록·내 회의·포털) | 워크스페이스 | `getWorkspaceConfig`(D36). UI 위험 파일 한 줄(D32) |
| 봇 | 요청 범위 달력 한 벌(D13 ③) | 스트림 라우트가 범위 달력(tz·주 시작·근무 요일)을 해석해 `routeChatRequest(request, now, calendar)`·`ToolContext.timezone: string` 으로. 라우터·플래너는 '이번 주'를 날짜 범위로, 주간 도구가 프로젝트별 키로. `CHAT_TIMEZONE`·플래너 프롬프트의 고정 문구 삭제 — 프롬프트는 해석된 IANA 이름을 넣는다(비평 반영 — S13) |
| `/usage` | 필터 워크스페이스 또는 `'UTC'`(D14) | 세 화면 컴포넌트가 tz prop |
| 이슈 코드 `{yyyy}` | 프로젝트 | SQL 채번(B1) — TS 패리티 |
| 메일 시각 | 프로젝트(초대) | `stampIn(tz)` + `" (<IANA>)"` — `" (한국 시간)"` 대체 |
| 시각 표시 locale | 레인 B 의 개인 `locale`(없으면 `ko-KR`) | 표시 포맷 컴포넌트가 `locale` 인자를 받게만 한다(D60) |
| 녹취 보정 | 회의록 범위(D13 ④) | `timeFix.ts` 가 tz 인자를 받는다 |
| 잡 스케줄 | UTC 고정 | 변경 없음 |
| 기존 데이터 | 이관이 `'Asia/Seoul'` 두 스코프(D13 ①) | — |

### 4.4 소비처 전수(재작성 — D10)

심볼 기준. "착수 재전수"는 D10 의 grep 으로 각 Phase 착수 때 다시 센다.

| 소비처(심볼) | 현행 | SP5 | 체크포인트 |
|---|---|---|---|
| `domain/dates.ts` seoul*·주말·영업일 | Seoul·토일 | `calendar.ts` | A |
| `domain/progress.ts` `plannedPct` | `businessDaysBetween(…, holidays)` | `workingDaysBetween(…, cal)` | A |
| `domain/dependencySchedule.ts` | `isBusinessDay`·상한 없는 do-while | `isWorkingDay` + 3,660일 상한 | A |
| `domain/trend.ts`·`domain/ganttScale.ts`·`WbsGanttSheet.tsx`(음영·주 끝) | 토일 음영·주 끝 = 다음 주 일요일 | `isWorkingDay`, 주 끝 = `weekPeriodOf(현재 키).endExclusive − 1` | A |
| **`actions/wbs.ts` 영업일(실측 C-5 ①)** | `businessDaysBetween` + holidays 별도 조회 | `ProjectConfig.calendar` | A |
| **`wbsmd/parse.ts` `nextBusinessDay`(C-5 ②)** | 토·일 하드코딩 | 가져오기 대상 프로젝트의 `WorkCalendar` 를 인자로(파서는 순수 유지) | A |
| `report/week.ts` `mondayIso`·`sheetWeekMeta`·`shiftWeeks` ← 주간 페이지·`api/report`·`actions/weekly.ts`·`WeeklySheetView` 이웃 주 | 월요일 | `weekKeyOf`·`weekLabelOf`·이웃 키(D35) | A |
| `report/weekly.ts` 주차·요일·`announcedOn` +9h | 월요일·5칸·KST | §4.2·`ymdIn(tz)` | A |
| `domain/issueDashboard.ts` `issueTrend` | `(dow + 6) % 7` | 현재 규칙의 `weekKeyOf` 12회(과거 전환 무시 — 표시 전용) | A |
| i18n 설명 문구 `dash.issues.trendCaption`(`i18n/dict/dashboard{,.en}.ts` — "주 단위(월요일 시작)"·"Mon start", `IssueTrendCard`) | 주 시작을 문구로 고정 | 규칙의 시작 요일 이름을 인자로(D10 의 문구 grep, 비평 반영 — S13) | A |
| `ai/chat/router.ts` `mondayOf`·'지난/이번/다음 주'·명시 날짜 | 사본, `routeChatRequest(request, NOW)` 는 규칙도 tz 도 받지 않는다 | 요청 범위 달력의 `weekPeriodOf(weekKeyOf(today))` — 시그니처 `routeChatRequest(request, now, calendar)`(D13 ③) | A |
| **`ai/chat/planner.ts` 날짜 앵커 `thisWeek/nextWeek/lastWeek`(C-5 ③)** | `day === 0 ? 6 : day − 1`·`seoulYmd` | 같음 + 범위 tz(D13 ③) | A |
| **`ai/tools/weekly.ts` 월요일 강제(C-5 ⑦)** | `getUTCDay() !== 1` | 규칙 키(D34) | A |
| SP4 `upsert_project_area(p_from_week)`·`create_weekly_report` 호출부·`weeklyCarry.ts` | `mondayIso` | `weekKeyOf(rules, todayIn(tz))` | A(착수 재전수) |
| `domain/attendance.ts` `monthMatrix`, 회의 페이지 둘 `monthGrid`, **`MeetingsView`·`MyMeetingsView` 월 그리드(C-5 ④)**, `MeetingCalendar`(`idx % 7` 요일 추정), `MinutesCalendar` | 일요일 첫 열 | 첫 열 = 현재 규칙 시작 요일(워크스페이스 화면은 워크스페이스 값), 요일 추정은 날짜에서 | A |
| **`components/ui/DayPopover.tsx`(C-5 ⑤)** | `new Date('…T00:00:00').getDay()` — 브라우저 로컬 tz | date-only UTC 연산을 `calendar.ts` 함수로(D9 의 호출 단위 가드가 `getDay()` 를 잡는다) | A |
| `data/usage.ts`·`domain/announcements.ts`·`domain/meetings.ts`·`domain/officeChatter.ts` | `+09:00`·`+9h` | `zonedMidnightUtc`·`ymdIn` | A |
| `Asia/Seoul` 리터럴 24파일(표시 포맷·`ProjectInviteManager`·`AssistantChat`·`ApprovalQueue`·`AgentHubView`·`SeatmapView`·`WikiShared`·`Usage*`·`deckPlan` 등) | 고정 | 해석된 tz 를 prop·인자로 | A |
| `(app)/layout.tsx` `seoulToday` | 고정 | 워크스페이스 tz(D32) | A(`ui/sp5-calendar`) |
| `ai/chat/protocol.ts`·`ai/tools/types.ts`·스트림 라우트·`BotPageContextProvider` | 고정·리터럴 타입 | 범위 tz | A |
| **`lib/minutes/timeFix.ts`·`actions/minutes.ts` 보정 호출 둘·사전(C-5 ⑥)** | UTC→KST +9h | UTC→범위 tz(D13 ④) | A |
| `mail/projectInvite.ts` | `" (한국 시간)"` | `" (<IANA>)"` | A |
| `holidays` 판독 7곳(C-6) | `date` 만 | 로더·`ProjectConfig.calendar`(D11) | A |
| 의존성 트리거·사용현황 5종·주 키 트리거·가져오기 RPC | §3.2 | §3.2 | A |
| `scripts/ui-capture.mjs` 주간 시드 | 이번 주 월요일 | 월요일 규칙 선기록(D28) | A |

### 4.5 한국 공휴일 오버레이 삭제(A)

개정 §4.2.7 그대로 — 모듈·사전 둘·테스트 삭제, 달력 셋의 쉬는 날 = `!isWorkingDay`(휴무 이름은 `holidays.name`, 워크스페이스 달력은 요일만), 일·토 고정 색 → "비근무 요일" 색 하나(레인 B UI-1 의 의미 토큰 — `globals.css` 를 고치지 않는다, §2.4), 검증 CLI 의 `HOLIDAYS` 상수 삭제 → 입력 JSON `holidays`(기본 `[]`, 배열 아니면 오류)·주말 문구 '주말(토·일)'. 가드 `tests/invariants/no-country-calendar.test.ts`(스캔 `src/**`·`scripts/**`·`.claude/skills/**` — 스킬 문서 예시 블록 제외, 금지 문자열 넷 + 한 파일 고정 공휴일 월·일 리터럴 2개 이상) + 행위 단언 셋(빌더·템플릿·검증 CLI 기본 `[]`). 사용자 데이터의 `holidays` 행(이미 입력된 휴일)은 그대로다 — 데이터이지 오버레이가 아니다.

### 4.6 이슈 영역·채번·분석 모듈(B1)

| 항목 | 내용 |
|---|---|
| 영역 | `ProjectConfig.areas` 의 `issue_area`(SP4 해석기가 이미 영역을 싣는다). `ISSUE_MEGA_AREAS`·`IssueMegaCode`·`ISSUE_MEGA_CODES`·`formatPiIssueCode` 삭제 → `area.code`·`area.name`. 소비처 20파일(실측 ③-6) — 이슈 폼·목록·필터·분석서·봇 이슈 도구·AI 초안·대시보드 |
| 채번 TS | `src/lib/issues/idPolicy.ts` — `parseIdPolicy`(개정 §4.4.3 검증표)·`renderIssueCode`(미리보기용 — 실제 발번은 DB). 설정 화면이 "다음 이슈 코드 미리보기"와 "기존 ID 는 바뀌지 않습니다"를 보인다 |
| 분석 모듈 | 레지스트리·`OFF_ON_CREATE`·manifest 재분류(D16). 일반 등록(`createIssue`)은 `issues.analysis='required'` ∧ 모듈 켜짐일 때만 분석 필수, 아니면 분석 필드를 받지 않는다(모듈 꺼짐이면 분석 필드가 오면 `ERR_MODULE_DISABLED` 매핑). 분석 분류 동작은 `issue_analysis` 관문 |
| 회의록 → 이슈 | `createIssueFromMinuteBlock` 이 새 시그니처(D15) — 영역 선택은 `{area}` 패턴이거나 분석 켜짐일 때만 필수 |
| 영역 없는 기존 이슈 | 이관 전용 레거시 코드(`PI-U-001` 꼴, D55). 이관 뒤 `{area}` 정책 프로젝트의 등록은 모든 경로에서 영역 필수(일반 등록은 지금도 Mega 영역 필수 — 현행 그대로). 레거시 코드 이슈는 나중에 영역을 붙일 수 있고 코드는 바뀌지 않는다. 화면은 레거시 코드를 다른 코드와 같게 보인다(비평 반영 — S5) |
| 노출 | `#${issueNo}` → `code`(D41). 색인 재생성은 SP8 |
| 분석서 | `deckPlan` 의 Mega 순서·라벨 → 활성 영역 `sort_order`·`name`(D42) |

### 4.7 회의록 팀(B2)

| 항목 | 내용 |
|---|---|
| 판정 교체 | 개정 §4.7 "대체" 문단 — `isTeamRootFolder` → `kind === 'team_root'`, `teamRootFolderIdOf`·`resolveTeamRootFolderId`·`ensureProjectTeamRoot` → `team_id` 조회, `teamSubOfFolder` → `folder.team_id`. `created_by` 는 작성자 의미만 — 불변식 `tests/invariants/minute-folder-kind.test.ts`(새): `created_by` 와 `null`/`parent_id` 를 함께 보는 폴더 종류 판정 0건(AST) |
| 팀 액션 | `addTeam` → `create_team` RPC(D19 ① — 공용 팀 생성 한 길, 세션 공용 팀 INSERT 정책 삭제 D50). `addProjectTeam`·전환·가져오기는 폴더 무관(D19 ②). 팀 비활성 → 루트 읽기 전용(D20 — 서버 판정 + DB 종류 가드 D49). 팀 개명 액션(SP4 D37)과 `addTeam` 은 `TEAM_ROOT_NAME_CONFLICT`·`TEAM_ROOT_NAME_TOO_LONG` 을 문구로 돌려준다(D52, 재검토 반영 — R9). 불변식 `tests/invariants/team-create-path.test.ts` |
| 회의록 `team_id` | 업로드 모달·편집·필터(`?team=<id>` — 옛 `?team=<code>` 링크는 code → id 로 한 번 해석해 리다이렉트)·목록·위키·AI 색인(`title`·`team_id`·`minute_date` — 정본 done_when) 이 `team_id`. 해석 함수 `teamResolve.ts`(D18 — code 단위, 다른 프로젝트 전용 팀 제외). 재편철(프로젝트 변경)은 대상 프로젝트 기준으로 `team_id` 를 다시 해석해 함께 쓰고, 없으면 null + 화면 알림(비평 반영 — S13) |
| 루트 모드 | `minutes.root_folders`(W) — 개정 §4.7 표의 일곱 사건 전부. 모드 전환(custom → teams)은 활성 팀 중 루트 없는 것만 만든다(멱등 — `create_team` 과 같은 insert 를 서버 액션이 service_role 로 반복하지 않고 설정 RPC 뒤 후처리 RPC `ensure_team_roots(p_actor, p_workspace_id)` 로 — 설정 행 `FOR UPDATE` 로 `create_team` 과 직렬화, 둘째 트랜잭션이 실패하면 편철·업로드의 지연 수렴이 메운다, D50, 비평 반영 — S10). 화면 선택지는 teams 만, 키 `editor = 'platform_admin'`(D21) |
| 외부 업로드 | v2.8 규약 그대로(teams). custom 정규화·응답 매핑은 `docs/design/dflow-minutes-upload-api-spec.md` **v2.9 절**(D25 의 메타 한 줄, teams 모드 응답 `folder_path[0]` = 팀 **code** 유지(D52 ④), `TEAM_SCOPE_PROJECT_OWNED`·40P01 → 503 재시도 가능 한 줄 포함). 새 오류 code 없음 |
| 화면 | 탐색기 `canMoveLeaf` → `canEditMinute`(D40), 팀 막대 패턴(D39), 루트 표시 = 팀 이름 |

### 4.8 회의록 첨부 MIN-ATT(B3)

개정 SP5-1~7 을 그대로 하되 D22~D26 을 따른다.

| 슬롯 | 이 문서의 결정 |
|---|---|
| SP5-1 패널 | `MinuteAttachmentsPanel` — 본문과 분리, 개수·남은 개수·허용 형식·개당 용량(유효 정책), 추가 버튼 + 드래그(키보드·모바일은 버튼), 파일별 상태 머신(대기 → 전송 → 확정 / 실패 / 취소), 실패만 재시도, 권한 있으면 삭제. 목록은 결과형(`{ok,rows}\|{ok:false}`). `MinuteUploadModal` 의 본문 필수 흐름은 재사용하지 않는다. 클라이언트 사전 검사는 안내용이고 판정은 가드(D23) |
| SP5-2 메타 | 파일명(말줄임 + 전체 이름)·형식·크기·등록일·등록자 — `MinuteFile` 에 등록자(`uploadedBy`·이름)를 더하고 `data/minutes.ts` 상세 select 확장(비평 반영 — S13) |
| SP5-3 과거 버전 | `historicalVersion` 분기에서 첨부 대신 "첨부파일은 현재 회의록에서 확인" 링크 |
| SP5-4 미리보기 | png·jpg·gif·webp 이미지, PDF sandbox iframe(`sandbox` 속성 — 스크립트 없음), svg·html 미리보기 0. 미리보기 서명은 안전 형식에만 `download` 없이, 다운로드 서명은 `download` 강제 유지, TTL `MINUTE_FILE_URL_TTL_SEC`(60초). `previewEnabled=false` 면 끔. 형식 판정은 **확장자 + 객체 메타 mime 둘 다** 안전 목록일 때만 |
| SP5-5 정책 키 | `minutes.attachments`(W·P, `seedFrom`) 정의·편집 화면, 운영 상한 초과 저장 거부, 해석기 `resolveAttachmentPolicy`(D24) — 선택기·액션·가드가 같은 값. 상수 `MINUTE_ATTACHMENT_MAX`·`MINUTE_ATTACHMENTS_MAX_COUNT` 는 운영 상한·제품 상한 이름으로 바꿔 정책 기본값의 원천으로만(설정을 덮지 않는다) |
| SP5-6 청소 | D26 |
| SP5-7 톰스톤 | `removeMinuteFile` → (가드 뒤) service_role 톰스톤 + 객체 삭제 시도 → 성공 시 `purged_at`. 실패는 서버 로그 + 청소 잡 재시도, 사용자 응답은 성공(D56). 톰스톤 행을 읽는 곳(`data/minutes.ts`·`repositories/supabase/minutes.ts`·`ai/tools/minutes.ts`·`getMinuteFileUrl`·내보내기·위키 색인 입력)은 `deleted_at is null` 만(비평 반영 — S6) |
| 두지 않는 것(개정 SP5-5·SP5-6) | `allowedMimeTypes`·`externalDownloadEnabled` 키, 업로드 예약 표(P8-RJ-1), 버전별 첨부 스냅샷(P8-NG-4) — 계획에서 되살리지 않는다(비평 반영 — S13) |
| service_role 경로(H2 이월) | 첨부 행을 넣는 새 서버 경로가 생기면 가드를 지나게 세션 클라이언트로 넣는다 — SP5 는 그런 경로를 만들지 않는다(패널 업로드는 세션). 만들면 같은 커밋에 테스트(실측 S-C15) |

### 4.9 어휘(B4)

| 키 | 소비처 교체(정본 Q4 표의 실측 위치) |
|---|---|
| `attendance.types` | `domain/attendance.ts` `ATTENDANCE_TYPES`, `ai/tools/attendance.ts`, 근태 화면 선택지·집계 라벨, 봇 `attendanceTypesFrom`(D46). `counts_as` 는 참조 0일 때만 변경 |
| `meetings.categories` | `domain/meetings.ts` `MEETING_CATEGORIES`, 회의 화면 선택지·색(토큰 이름)·공지 기본값(`announce_default`) |
| `issues.severities` | `domain/issues.ts` `ISSUE_SEVERITIES`·`ISSUE_SEVERITY_META`, 이슈 화면·대시보드·PPT 라벨 |
| `issues.sources` | `issueAnalysis.ts` `ISSUE_SOURCE_TYPES`, 분석 폼·분석서. `'minutes'` 예약(삭제·비활성 거부 — 회의록에서 만든 이슈) |
| `issues.cause_categories` | `report/issues/model.ts`·`deckPlan.ts` 라벨·`storedRun.ts`·`ai/issue-analysis.ts` 프롬프트·검증 — 같은 값을 주입받는다. 삭제 금지(분석 실행 JSON 참조), 비활성만 |

- 편집 화면: 설정의 어휘 범주 — 목록 편집(code 불변·라벨·순서·활성·색), 삭제는 "참조 n건 — 다른 code 로 옮긴 뒤 삭제"(`migrate_setting_code` 명령), 의미 속성 변경 거부 문구.
- 해석: 화면·검증·PPT·AI 는 `ProjectConfig` 의 해석된 어휘만 받는다(상수 import 0 — `no-runtime-constants` 허용 목록 비움).

### 4.10 이월 셋(B2·B3)

| 이월 | 처리 | 체크포인트 |
|---|---|---|
| 회의 화면 조용한 실패(개정 §8.1 #22 남은 다섯) | 결과형으로 바꾸고 호출부가 실패를 표시(에러 처리 원칙 ①) — `getMyMeetings` 인증 오류 ≠ 비로그인, `getMeetingDetail` 실패 ≠ '회의 없음', 이슈 `resolveMemberIds` 실패 표시, AI 브리핑 상태의 조회 실패 ≠ '브리핑 없음', 목록 탭 로딩 상태 | B2(D39) |
| 산출물·이슈 첨부 경로 정책(H2 이월) | insert 정책 경로 범위(§3.5 ③). 옛 형식 경로는 보고만 | B3 |
| 산출물·이슈 첨부 클릭 발급(개정 §8.1 #23) | 목록은 서명 URL 없이 메타만, 클릭 때 읽기 액션이 `can_attach` 판정 후 60초 서명(회의록 파일과 같은 꼴). `LIST_SIGNED_URL_TTL_SEC` 삭제 | B3 |

### 4.11 상수 제거·회귀 가드

| 가드 | 내용 | 체크포인트 |
|---|---|---|
| `week-single-source` | D9 | A |
| `no-country-calendar` | §4.5 | A |
| `holidays-reads` | D11 | A |
| `no-runtime-constants` | 허용 목록 SP5 행 0(D45) — A 시간대, B1 `ISSUE_MEGA_AREAS`, B4 어휘·잔여 | A·B1·B4 |
| `minute-folder-kind` | §4.7 | B2 |
| `team-create-path` | D50 — 공용 팀 insert 는 `create_team` 만 | B2 |
| 센티널 S10 | `Asia/Seoul`·`+09:00`(A)·`PI-I-`·8 영역명(B1 — `SENTINELS_BY_SP.SP5` 의 `issueAreas`·`issueIdPrefix`)·잔여 문자열(B4)이 R·C 출력에 0(합성 — SP4 의 센티널 일치 규칙과 `sentinelsFor` 의 "등록 이름과 같은 센티널만 제외" 그대로, §6.4) | A·B1·B4 |
| 정본 done_when ① | 원본 고객 문자열 grep 0 — 문자열 목록은 정본 `:2989` 와 `tests/fixtures/legacy-sentinels.ts` 를 쓰고 이 문서에 옮겨 적지 않는다 | B4 |

## 5. 화면

### 5.1 체크포인트별 화면 범위

D30 의 기본값 — SP5 는 **기능과 그 기능의 새 요소**를 SP3b 패턴(토큰·`StatusMessage`·상태 계약)으로 만들고, **새로 만드는 파일**은 `PageHeader`·상태 계약까지 끝낸다(비평 반영 — S13). 기존 화면 전체의 패턴 이행은 §5.2. 표는 도는 순서로 적었다.

| 체크포인트 | 화면 | 내용 |
|---|---|---|
| A | 설정 — 일정(`ScheduleManager`)·달력 절 | 휴무/근무 선택, 주 시작(일·월)·근무 요일·tz 편집, '변경 내용 검토'(D38 미리보기 — E·과도기·N건), "워크스페이스 기본값에서 복사됨(생성 시점)" 표기(상속 표현 금지) |
| A | 워크스페이스 설정 — 달력 절·생성 폼 | 세 키 편집, 생성 폼 tz 제안 |
| A | 주간 시트·보고서 모달 | 라벨·표시 칸 수·이웃 주(기능만) |
| A | 근태·회의(프로젝트·워크스페이스·내 회의)·회의록 달력 | 첫 열·쉬는 날·비근무 요일 색 토큰 |
| A | `/usage` | "UTC 기준"/워크스페이스 tz 표기 |
| A | 시각 표시 전반 | 유효 tz·locale 인자(승인 큐 포함 — 개정 §5.12.5 SP5 ①, D60) |
| A | 가져오기 미리보기·결과 | '건너뜀(특정일 근무와 충돌)' |
| B1 | 이슈 목록·상세·폼·큐 카드·분석 폼, 설정 이슈 절, 영역 편집기 `issue_area` 탭 | `code` 표시, 영역 선택(필요할 때만), 분석 필드 모듈 조건부, 채번 정책 편집 + 미리보기 + "기존 ID 는 바뀌지 않습니다" |
| B3 | 회의록 상세 첨부 패널·과거 버전 링크·미리보기, 설정 첨부 정책 절, 산출물·이슈 첨부 목록(클릭 발급) | §4.8·§4.10 |
| B4 | 설정 어휘 범주(5키), 근태·회의·이슈 선택지·배지 | 목록 편집·이관 명령·거부 문구, 선택지가 설정을 따른다 |
| B2 | 회의록 탐색기·목록·업로드·필터, 팀 관리(공용 팀 생성 결과), 포트폴리오·내 회의 점 색, 회의 화면 오류 표시 | 루트 = 팀 이름, `team_id` 필터, 이동 어포던스, 팀 막대 패턴, `category-*` 토큰, 실패 표시 |

### 5.2 SPU3 로 넘기는 패턴 이행(D30 — §8 #10)

개정 §5.9.4 의 SP5 화면 #8(`/w/[slug]/meetings`)·#9(`/w/[slug]/minutes`)·#24(이슈)·#26(회의)·#29(공지)·#31(근태)의 `PageHeader`·상태 계약·12px/uppercase·전면 `EmptyState` 정리. SP5 는 위 화면에서 자기가 더한 요소만 패턴으로 만들고 나머지 줄은 손대지 않는다. 마감(B2) 문서 커밋이 개정 SPU3 블록에 한 줄을 더하고, SPU3 누적(SP4 D52 넷 + SP5 여섯)으로 SPU3 노력(개정 2.5주)을 다시 재어 레버 L2 영향을 적는다(비평 반영 — S13).

## 6. 테스트·검증

### 6.1 단위·정적(`npm run test`, DB 없음)

도는 순서로 적었다. 굵은 이름은 §7 이 부르는 검사다(비평 반영 — S13).

| 체크포인트 | 테스트 |
|---|---|
| A | `tests/domain/calendar.test.ts` — P1-AC3 행렬(근무 `[1..5]`·`[7,1,2,3,4]`·`[1..6]`, 특정 토요일 `work`, 휴일만 있는 기간, 빈 배열 거부, UTC/서울/LA 경계, DST 2건(America/New_York 2026-03-08·11-01), 루프 상한 throw), 개정 §4.2.4 예시 표 세 행(과도기 6/8일·E ≤ T 미룸), §4.2.5 라벨 표 네 행, 이웃 키, `applyWeekStartChange` 네 경우 + 과거 원소 거부, tz 검증(D54 — `'UTC'` 수용·잘못된 이름 거부·`resolvedOptions` 정규화·오프셋 꼴 `+09:00`·`GMT+1`·`EST` 거부 — R5). `week-single-source`(놓침 표본 — 실측 넷 + `DayPopover`·`wbsmd/parse.ts`·`validate.mjs`, 거짓 적중 표본, 죽은 허용 항목), `no-country-calendar`(행위 단언 셋), `holidays-reads`, 라벨 기대값 변경(`tests/report/{week,weekly}.test.ts`)과 월요일 가정 기대값 파일(D28 목록), 설정 키 6정의(`registry.test.ts`·`config-lifecycle` — 목록 patch `CONFIG_INVALID`, 복사 = 마지막 규칙 day), **`tests/ai/bot-week-rules.test.ts`**(새 — 일요일 규칙 프로젝트에서 `weekly` 도구가 일요일 기준일을 거부하지 않음, 라우터 '지난/이번/다음 주'·플래너 앵커가 `weekPeriodOf` 와 같은 기간, 워크스페이스 질문에서 도구 둘이 같은 '이번 주', `p_from_week` 호출이 규칙 키 — 월요일 규칙이면 월요일), **`tests/components/calendar-first-column.test.tsx`**(새 — 달력 다섯(`MeetingsView`·`MyMeetingsView`·`MeetingCalendar`·`MinutesCalendar`·`AttendanceView`)의 첫 열 = 규칙 시작 요일, 쉬는 날 = 근무 요일 + `holidays`), **`tests/wbs/import-holiday-skip.test.ts`**(새 — 가져오기 미리보기·결과의 '건너뜀(특정일 근무와 충돌)'), **`tests/scripts/bootstrap-timezone.test.ts`**(새 — `BOOTSTRAP_TIMEZONE` 기록·재실행 규칙), **`tests/components/time-display-zone.test.tsx`**(새 — 같은 instant 가 LA·서울 프로젝트에서 다른 날짜, `timeZone` prop 필수, `locale` 인자 — D60), `timeFix` tz 일반화, 메일 시각 |
| B1 | `idPolicy` 파서·렌더(개정 예 세 행·40자·`{seq:n}` 하나·`counter_scope`/`reset` 교차, 레거시 형식이 PI 템플릿과 겹치지 않음 — D55), 분석 모듈 꺼짐(분석 필드 거부·AI 초안 분석 필드 없음), manifest 재분류(`tests/gates`), **`tests/ui/issue-code-display.test.tsx`**(새 — `#issueNo` 노출 0), `deckPlan` 영역 주입 |
| B3 | 첨부 상태 머신·재시도, `resolveAttachmentPolicy`(프로젝트·무프로젝트), 미리보기 형식 판정(svg·html 0, 확장자·mime 둘 다), 청소 잡 dry-run 대상 계산(24시간 유예·톰스톤 재시도·**본문 세그먼트 객체와 `minute_versions.file_path` 객체 0** — D26), 톰스톤 읽기 제외(목록·서명·AI 도구 — D56), 클릭 발급(목록에 서명 URL 0) |
| B4 | 어휘 정의 5(검증·`'minutes'` 예약·원인 삭제 금지), 소비처가 해석된 어휘만(상수 import 0), 봇 근태 유형 = 설정 라벨, 잔여 문자열 0, 카탈로그 동기(`docs/settings-catalog.md` 생성 결과 일치), 40P01 → 503 매핑 |
| B2 | `minute-folder-kind`·**`team-create-path`** 불변식, `teamResolve`(code 단위·다른 프로젝트 전용 팀 제외), 루트 모드 사건 일곱(순수 판정), **`tests/minutes/team-id-contract.test.ts`**(새 — 회의록 `team_id` 읽기·필터·`?team=<code>` 리다이렉트·위키 재색인 대상 `title`·`team_id`·`minute_date`·재편철 재해석), 팀 개명 오류 문구 매핑(D52), 회의 화면 결과형 다섯(실패 표시), `canMoveLeaf` 판정, `no-raw-color` |

### 6.2 실행형(`npm run test:rls`, 건너뜀 0)

§3.7 의 파일들. 각 체크포인트는 `test:rls` 전체 초록·건너뜀 0 이고, CI 등가(부트스트랩 없이 `db reset --version 0001` → `migration up` → `test:rls`)를 한 번 돈다. 패리티 셋(개정 §2.11 SP5 ③): `is_workday` 대 `isWorkingDay`, `week_key_of`·`week_key_from_rules` 대 `weekKeyOf`, 채번 `{yyyy}` 대 `ymdIn`, `render_issue_code` 대 `renderIssueCode`, 첨부 가드 대 `resolveAttachmentPolicy`, tz 허용 집합 TS ⊂ PG(D54).

### 6.3 로컬 E2E(`scripts/e2e-local.mjs`, 기록 `docs/baseline/sp5-e2e.md`)

단계는 이름으로 부른다(SP4 Q7). 도는 순서로 적었다.

| 단계 | 내용 | 체크포인트 |
|---|---|---|
| `calendar-week-sunday` | 일요일 프로젝트에서 주간 2주 생성·이월·라벨·표시 칸 수, 월요일 프로젝트 비교(개정 §4.2.9 셋째 항목) | A |
| `calendar-week-transition` | 월→일 전환 저장(미리보기 E 일치) → 과도기 주 → 과거 URL(`?week=<옛 월요일>`) 같은 문서 | A |
| `calendar-tz` | LA 프로젝트의 '오늘'·공지 예약·`/usage` 일자 | A |
| `calendar-workday` | `work` 예외 등록 → 간트 음영·계획 진척·의존성 저장 판정 | A |
| `issue-code-flow` | P1-AC2 — 등록 → 목록 → 분석서 → 봇 → PPT 가 같은 `area_id`·`code`, 영역 개명 뒤 코드 불변. 영역 0·분석 꺼짐 프로젝트에서 `ISS-001` | B1 |
| `minute-attachments` | 기존 회의록에 다수 첨부 → 새로고침·재로그인 뒤 유지 → 새 회의록 동시 첨부 → 삭제(톰스톤 — 목록·다운로드에서 사라짐) → 청소 dry-run → `--apply` | B3 |
| `vocab-edit` | 근태 유형 라벨 변경 → 화면·PPT·봇 추종, 참조 있는 code 삭제 거부 → 이관 → 삭제, 목록 밖 값 저장 거부 | B4 |
| `minutes-teams` | `create_team` → 루트 → 업로드(teams) → 팀 개명 → 루트 이름 추종·id 불변 → 비활성 → 편철 거부 | B2 |

### 6.4 합성 게이트(`npm run accept:synthetic`)

| 단계 | 내용 | 체크포인트 |
|---|---|---|
| S1(SP5 몫) | 각 SP 가 자기 키를 R·C 에 설정 화면과 같은 액션으로 입력 — A = `calendar.*`(tz·근무일·주 시작), B1 = `issues.id_policy`, B4 = 어휘 5키(R 의 연구용·C 의 건설용 근태 유형·회의 분류 등 — 개정 §6.5.8 의 R·C 구성표) | A·B1·B4 |
| S4 | R 일요일 키(기본)·C 월요일 키(주차 문서 전 설정 — 규칙 교체), 연속 2주·이월·영역 개명 | A(R 추가 — C 는 SP4) |
| S5 | 계획 진척·근무일·'오늘' — LA·베를린, DST 주, C 의 토요일 휴무·일요일 근무 | A |
| S6(SP5 몫) | R 영역 10개 등록·`RS-{area}-{seq:3}`, C `CN-{yyyy}-{seq:4}` — 표시 상태 흐름은 SP5b | B1 |
| S10 | A = `Asia/Seoul`·`+09:00` 0건, B1 = `SENTINELS_BY_SP.SP5` 를 채운다(`issueAreas` 8 영역명·`issueIdPrefix` `PI-I-`) — `sentinelsFor` 로 R 의 등록 영역과 같은 이름만 제외, B4 = 잔여 문자열 센티널(R·C 의 API·봇·출력) | A·B1·B4 |

`PENDING_STEPS` 갱신(체크포인트별): A — S1(A 몫)·S4(R)·S5·S10(A 몫)을 지운다 / B1 — S1(B1 몫)·S6(SP5 몫)·S10(B1 몫) / B4 — S1(B4 몫)·S10(잔여). 남는 몫(S6 표시 상태 → SP5b, S10 나머지 → SP6~SP8)은 문구로 남긴다(비평 반영 — S13).

설정은 설정 화면과 같은 서버 액션·API 로만, 실행 전후 `git diff --quiet -- src supabase`, 건너뜀은 실패(개정 §6.5.8).

### 6.5 눈확인

D31 — 에이전트가 헤드리스 브라우저(라이트·다크)로 찍고 `docs/baseline/sp5-ui.md` 에 기록. 화면은 §5.1 의 각 행. A 의 `ui/sp5-calendar` 확인 화면 = "워크스페이스 홈·회의록·내 회의(오늘 표시)".

## 7. 완료 조건(done_when)

모든 체크포인트는 공통 묶음(§2.1)·로컬 태그·CI 등가를 포함하고, main 반영은 사람 확인 때 한다. 괄호는 근거(W = 실측 ① 의 완료 조건 후보). 도는 순서(A → B1 → B3 → B4 → B2)로 적었고, 항목마다 걸리는 검사 이름을 단다(비평 반영 — S9·S13).

**A**

- [ ] 전용 스택 `db:reset`(0000 → SP4 셋 → `_calendar`) 초록, `migration-files` 초록, `settings:verify` 0(W1)
- [ ] 월요일 규칙 선기록 커밋 ① 이 마이그레이션 커밋 ② 앞에 있고, ② 시점 `test:rls` 초록(건너뜀 0)이라 `Staging-verified` 가 참(D28 — 비평 반영 — S8)
- [ ] 리허설 `*_calendar_week_start` 네 경우·`*_calendar_smoke`, 롤백 → 재적용, 카탈로그 R 불일치 0. 이관 이력 `source='migration'`·revision+1 한 번·`schema_version` 불변(W10·W11, D57)
- [ ] `calendar-parity`(tz TS ⊂ PG 포함)·`week-start-transition`(직접 쓰기 23514·경합 정확히 하나 커밋·겹침 0·저장 거부 `CONFIG_IN_USE`·**미적용 전환 늦춤 교체 거부·unset = 기본 일요일**·잘못된 tz `CONFIG_INVALID`·과도기 6/8일·UNIQUE 위반 0·이월 원본 = 직전 키)·`usage-timezone`(빈 표 22023·비슈퍼유저 0행·EXECUTE 기대표) 초록, 의존성 트리거 `[7,1,2,3,4]` 토요일 거부·일요일 허용(W5·W6·W7·W8·W9, D53·D54·D14)
- [ ] `calendar.test.ts` 행렬·라벨 표·변경 연산·tz 검증(`'UTC'` 수용·오프셋 꼴 거부 — 재검토 반영 — R5)(W3·W12, D54), 목록 patch `CONFIG_INVALID`·복사 규칙(W2), holidays 조회 실패 → `CONFIG_UNAVAILABLE` throw(W4)
- [ ] `week-single-source`(호출 단위·놓침 표본 일곱)·`no-country-calendar`(행위 단언 셋)·`holidays-reads` 초록(W14·W15), `CHAT_TIMEZONE` 0, `ToolContext.timezone: string`, `no-runtime-constants` 허용 목록의 A 몫(시간대) 패턴 0(W13)
- [ ] 봇 월요일 강제 0 — `tests/ai/bot-week-rules.test.ts` 초록(일요일 규칙 프로젝트의 `weekly` 도구·라우터·플래너 앵커·`p_from_week` 규칙 키, 월요일 규칙 회귀)(SP4 §9 첫 행, 개정 §4.2.9 셋째 — 비평 반영 — S13)
- [ ] `work` 예외가 Holiday 시트 가져오기로 지워지지 않고(`command-receipts` `work` 행 회귀) 미리보기·결과에 '건너뜀' — `tests/wbs/import-holiday-skip.test.ts`(W16), `import_wbs_cmd` 멱등 회귀 초록(D12)
- [ ] 월요일 프로젝트의 월 달력 첫 열 = 월(W17), 달력 셋의 쉬는 날이 근무 요일 + `holidays` 에서만(개정 §5.12.5 ②) — `tests/components/calendar-first-column.test.tsx`, 미리보기가 서버 계산 E(W20)
- [ ] 시각 표시가 유효 tz·locale 인자를 따르고 서울 고정 0 — `tests/components/time-display-zone.test.tsx`(같은 instant 가 LA·서울 프로젝트에서 다른 날짜, 승인 큐 포함)(W21 ①, 개정 §5.12.5 SP5 ①, D60 — 비평 반영 — S13)
- [ ] `bootstrap` 재실행 시 `BOOTSTRAP_TIMEZONE` 기록 규칙 — `tests/scripts/bootstrap-timezone.test.ts`(W19)
- [ ] 로컬 E2E `calendar-*` 넷, 합성 S1(A 몫)·S4(R)·S5·S10(A 몫) 초록, `PENDING_STEPS` 갱신(W22)
- [ ] 성능 게이트 p95 비율 ≤ 1.20 — `docs/baseline/sp5-perf.md`(D59 — 비평 반영 — S13)
- [ ] 이웃 키 `prevWeekKey`·`nextWeekKey`(D35)·`timeFix` tz 일반화·메일 시각의 유효 tz 표기(D13 ④) — §6.1 A 의 검사(재검토 반영 — R13)
- [ ] SP4 본문 승계 검사 — `CALENDAR_POSTCHECK` 의 가져오기 RPC SP4 토큰(D12)
- [ ] `ui/sp5-calendar` 커밋 `Preview-checked: local …`(W18), 눈확인 A 행
- [ ] SP5 A 키 6개 `verified`, `PLANNED_KEYS` 에서 빠짐(W1)
- [ ] 라벨 기대값을 바꾼 커밋 메시지에 의도 변화

**B1**

- [ ] `_issue_areas` 적용·리허설(대조 초록·PI 프로젝트 미분류 이슈 → 레거시 코드·**코드 없는 이슈 시드에서 적용 → 롤백 → 재적용 초록**·영문 영역 code 롤백 raise)(W23, D55 — 비평 반영 — S5)
- [ ] `issue-areas`(비활성화 경합 → 비활성 영역 이슈 0·레거시 이슈 나중 영역 지정 허용)·`issue-code-policy`(동시 100건 유일·무결번, LA 연도, 정책 변경 뒤 불변, 겹침 건너뛰기, 1,000회 상한, 렌더 패리티, 레거시 범위를 트리거가 쓰지 않음) 초록(W24), 동시 채번 p95 기록(D59)
- [ ] 영역 0·분석 꺼짐 프로젝트 `ISS-001`, `PI-I-<area>-<seq>` 재현·seq ≥ 100 무절단(W24), `{area}` 정책 프로젝트의 영역 없는 등록 `ISSUE_AREA_REQUIRED`
- [ ] 분석 모듈 꺼짐 → 분석 필드 쓰기 거부·`/api/issue-analysis` 404·AI 초안 분석 필드 없음, 워크스페이스 허용 회수 → `create_issue_from_minute_block` 분석 인자 거부(유효 모듈), 켜짐 → 현 계약. 이관 뒤 기존 프로젝트 `effectiveModules ∋ issue_analysis`·`issues.analysis='required'`, 새 프로젝트 꺼짐(W25)
- [ ] `createIssueFromMinuteBlock` 새 시그니처(W26), `#${issueNo}` 노출 0 — grep + `tests/ui/issue-code-display.test.tsx`(W27)
- [ ] 영역 편집 탭으로 영문·숫자 code 등록, 세션 직접 쓰기 0(W28)
- [ ] 로컬 E2E `issue-code-flow`(W29), 합성 S1(B1 몫)·S6(SP5 몫)·S10(B1 몫 — `SENTINELS_BY_SP.SP5` 채움)(W30)
- [ ] `test:rls` 무예외 초록(격리 맵·스키마 불변식에서 `issue_mega_areas` 제거)(W31), 허용 목록 `ISSUE_MEGA_AREAS` 패턴 0(W32)
- [ ] 이슈분석서 `deckPlan` 의 Mega 순서·라벨이 `areas` 주입(D42 — §6.1 B1), 눈확인 B1 행(§6.5, 재검토 반영 — R13)
- [ ] `issues.id_policy`·`issues.analysis` `verified`, manifest·`_rpc-tables` 재분류, SP4 `project_areas_guard`·`upsert_project_area` 승계 토큰(D12)

**B3**

- [ ] `_attachments` 적용·리허설
- [ ] MIN-ATT 수용 — 번호별 검사(비평 반영 — S13):

  | 수용 | 내용 | 검사 |
  |---|---|---|
  | #1 | 본문 재업로드 없이 다수 추가·새로고침·재로그인 뒤 유지·새 회의록 동시 첨부 | E2E `minute-attachments`(W39) |
  | #2 | 두 프로젝트 다른 정책에서 화면·서버·DB 같은 제한 | `minute-attachments-policy`(정책 둘)·`resolveAttachmentPolicy` 패리티(W42·W45) |
  | #3 | 조회 전용·권한 회수·다른 프로젝트·워크스페이스 사용자의 직접 액션·Storage·첨부 id 바꿔치기 거부, 무프로젝트 회의록은 첨부 권한 행대로(AUTH-11 포함) | `h2-attachment-guard`·`h2-minute-manage-parity` 회귀 + `minute-attachments-policy`(id 바꿔치기·무프로젝트 케이스)(W45) |
  | #4 | 동시 두 연결 개수 초과 0·위조·재전송(톰스톤 경로 재전송 = `MINUTE_ATTACHMENT_DUPLICATE`) | `minute-attachments-policy`(동시·25001)·`h2-attachment-guard`(위조·재전송)(W45) |
  | #5 | 업로드 중 권한 회수·이동·보관 → 확정 거부, TTL 60초 | `h2-minute-bucket` 회귀 + `minute-attachments-policy`(확정 거부 케이스)(W45) |
  | #6 | 공개 공유 첨부 0, 과거 버전 링크 | `h2-share-token` 회귀 + 단위(과거 버전 분기)(W40·W45) |
  | EX-1·EX-2 | 경로 검증·동명 덮어쓰기 금지 | `h2-attachment-guard`·`h2-minute-bucket` 회귀(계획이 케이스 이름을 적는다)(W45) |

- [ ] svg·html 미리보기 0, 다운로드 서명 `download` 강제 유지(W41)
- [ ] 톰스톤: 제외 한도(§8 #7 기본값)·service_role 쓰기·전이 가드(되살리기·`file_path` 변경 거부)·세션 DELETE 거부·DELETE 권한 회수(`h2-table-grants` `DML_WITHOUT_POLICY` 무수정 초록 — R2)·업로더 계정 삭제 → `uploaded_by null`(R3)·**톰스톤 행 서명 발급 거부·목록 0건** — `minute-attachments-policy`(D56 — 비평 반영 — S6, 재검토 반영 — R2·R3)
- [ ] 청소 잡 dry-run 대상 기록(대상 = `minute-files` 세그먼트만, `minute_versions.file_path` 제외 — 단위 테스트)·삭제 실패 재시도(W43·W44, D26 — 비평 반영 — S3)
- [ ] 산출물·이슈 첨부 범위 밖 `file_path` insert 거부(W51), 목록에 서명 URL 0·클릭 발급(W52)
- [ ] 두지 않는 것(`allowedMimeTypes`·`externalDownloadEnabled`·업로드 예약 표·버전별 첨부 스냅샷) 0건 — 레지스트리·스키마 grep
- [ ] 외부 메타 API(`/api/v1/minutes/meta`)가 운영 상한을 광고(D25 — 소유 B3, §7 B2 의 v2.9 절 한 줄과 짝), 눈확인 B3 행(§6.5, 재검토 반영 — R13)
- [ ] 새 서버 경로 테스트(W46 — 만들었으면), `minutes.attachments`(W·P) `verified`

**B4**

- [ ] `_vocab_settings` 적용·리허설
- [ ] `config-vocabulary` — 경합 고아 참조 0, 의미 속성 변경 `CONFIG_IN_USE`(W47), 값 그대로인 UPDATE 통과·동시 편집 대 이관 40P01 + 고아 0(D58), 설정을 바꾸면 화면 선택지·검증·PPT 라벨 추종(정본 done_when ③ — 로컬 E2E `vocab-edit`)
- [ ] **레지스트리 밖 값은 저장 시 거부**(정본 done_when ③ 뒷절) — 활성 code 밖 값으로 근태·회의·이슈 행을 쓰면 23514(트리거 `PROJECT_VOCAB_INACTIVE`), 화면은 선택지에서 막고 서버 액션이 저장 전 오류로 거부(비평 반영 — S13)
- [ ] 봇 근태 유형 = 설정 라벨(W48), 카탈로그 동기·고정 어휘 절은 범주만(W49), 합성 S1(B4 몫)·S10(잔여 문자열)
- [ ] 눈확인 B4 행(§6.5, 재검토 반영 — R13)
- [ ] 정본 done_when ① — 원본 고객 문자열 grep 0, **`no-runtime-constants` 허용 목록 SP5 행 0**(W50, D45)

**B2(마감 포함)**

- [ ] `_minutes_teams` 적용·리허설(사전검사 음성 둘·폴더 이관·이름 = 팀 이름·`team_id` code 단위 매칭·null 보고·전환 두 열·**롤백 → 옛 조회로 루트 발견**·프로젝트 삭제 통과 — 리허설이 확인하는 것, 설계 단언 아님)(D52·D51 예외·E28 — 비평 반영 — S10, 재검토 반영 — R4)
- [ ] 세션 위조 다섯 거부(팀 루트 선점·`kind`/`team_id` 변경·팀 루트 삭제와 하위 폴더 보존·비활성 루트 아래 생성·팀 이름 선점) — `minutes-teams`(D49 — 비평 반영 — S1)
- [ ] 공용 팀 생성 한 길 — 세션 공용 팀 직접 insert 거부(정책 삭제 — 표 단위 INSERT 권한은 유지)·`pg_policies` 에 `project_id is null` 허용 분기 0·`team-create-path` 불변식, `create_team` 대 모드 전환 경합에서 teams 모드의 루트 없는 활성 팀 0(D50 — 비평 반영 — S10, 재검토 반영 — R1)
- [ ] 팀 참조 범위 가드 — 교차 워크스페이스·교차 프로젝트 `team_id` 거부(D51 — 비평 반영 — S10)
- [ ] `created_by` null 로 폴더 종류를 판정하는 코드 0(`minute-folder-kind` — W33)
- [ ] 부정 테스트 넷(W34 의 셋 + S10 의 이름 충돌 — 재검토 반영 — R14) — custom 모드 팀 추가 → 폴더 0, 불일치 경로 → `unclassified`·`folder_id null`(v2.9), 재편철 유지(`team_id` 재해석 포함), 개명 시 루트 이름 추종·id 불변·이름 충돌은 `TEAM_ROOT_NAME_CONFLICT` 문구(W34)
- [ ] 로컬 E2E `minutes-teams` — 생성 → 루트 → 업로드(teams) → 개명(루트 이름 추종·id 불변) → 비활성 → 편철 거부(§6.3 — 재검토 반영 — R7)
- [ ] `create_team` 시드 실패 시 팀도 롤백(W35), 비활성 팀 루트 쓰기 거부
- [ ] 회의록 `team_id` 계약 — `tests/minutes/team-id-contract.test.ts`(위키 재색인 대상 `title`·`team_id`·`minute_date`, `?team=<code>` 옛 링크 리다이렉트)(W36)
- [ ] v2.9 절 커밋(W37 — custom 정규화·`folder_path[0]` code 유지·503 재시도 줄), 메타 API 한 줄(D25)
- [ ] `canMoveLeaf` — 회의 폴백 프로젝트 관리자에게 이동 어포던스 비노출(W38)
- [ ] 전환 RPC 카탈로그 불변식 초록 + 전환 뒤 회의록·폴더 팀 참조 이전 테스트(비활성 공용 팀만 가리키는 회의록 포함)(W56), M1 가드 두 표(`cd66d6c` 규칙 — UPDATE 무변경 통과), SP4 승계 토큰(D12)
- [ ] 회의 화면 결과형 다섯(W53), `no-raw-color` ALLOW 의 `projectColors.ts` 줄 제거(W54), 팀 막대 눈확인(W55)
- [ ] 근태·회의의 사람 축 확인 — `attendance_records`·`meeting_attendees` 가 SP1 의 `project_members(person)` 축, 회의 초대 메일 수신자 `people.email`(정본 SP5 범위 "유지" — 변경 없음 확인, 비평 반영 — S13)
- [ ] `minutes.root_folders` `verified`(화면은 teams 만·키 `editor = 'platform_admin'` — D21)
- [ ] SP5 키 16개 전부 `verified`(개정 §2.11 SP5 ⑤)
- [ ] 마감 묶음: `docs/baseline/{synthetic-acceptance,sp5-e2e,sp5-ui,sp5-effort,sp5-perf}.md`, 개정 §6.3 번호표·§9 받는 쪽 기록(SP5b·SP6·SP7·SP8·SPU3 블록 한 줄씩 — SPU3 노력 재산정·L2 영향 포함)·§8.1 #2·#3·#18·#22·#23 닫음 표기, `no-runtime-constants` SP5 행 0 재확인, 태그 `sp5-done`

## 8. 사용자 확인 항목

각 항목은 권고 기본값으로 진행한다(사전 승인 규칙). "기한"은 그 체크포인트에 착수하기 전이다(도는 순서 A → B1 → B3 → B4 → B2). **#1·#2 는 "SP5 착수 전 사용자 결정"이다**(개정 §6.2.0 게이트·§8.1 #2·#3 의 판단자 = 사용자). **질문 시점·주체**: SP5 착수 전에 컨트롤러가 이 스펙의 확정 보고에 #1·#2 를 별도 블록으로 올려 사용자에게 묻는다. 답이 없으면 기본값으로 시작하되, A 의 마이그레이션 커밋 전에 한 번 더 확인 요청을 남긴다(원장 기록). **되돌릴 수 있는 한계**: A 의 코드·리허설까지는 바꾸는 비용이 작다(이관 한 절·라벨 함수 하나). 그러나 **메인 스택(사용자 DB)에 적용(#13)된 뒤에는 #2 를 되돌릴 수 없다** — `_calendar` 롤백은 이관이 기록한 설정 값·이력을 되돌리지 않는다. 그래서 #13 질문 때 #1·#2 의 답 상태를 함께 확인한다(비평 반영 — S12). #13 만 사전 승인에 넣지 않고 그때 묻는다(사용자 데이터 변경).

| # | 질문 | 권고 기본값 | 대안 | 바꿀 때 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | **(SP5 착수 전 사용자 결정 — U-1, 개정 §8.1 #2)** 주간보고의 주차 이름을 "그 주 시작일 + 3일이 속한 달의 몇 번째 주"로 하나로 맞출까요? 지금은 보고서가 "오늘 날짜 ÷ 7 올림"(예전 요청), 시트가 "그 달 몇 번째 월요일"을 써서 같은 주가 '6월 5주차'·'7월 1주차'로 갈릴 수 있습니다. 바꾸면 이미 만든 주간보고의 주차 이름도 새 규칙으로 다시 보입니다(예: 2026-06-29 주가 '6월 5주차' → '7월 1주차') | 예 — 시작일 + 3일이 속한 달 기준으로 통일(D4 — 개정 §4.2.5) | **아니오 — 현행 유지**(보고서 '오늘 ÷ 7 올림'·시트 '그 달 몇 번째 월요일'이 따로 남아 같은 주가 두 이름으로 갈린다. A 는 두 규칙을 각자 새 주 시작 요일에 맞춰 일반화해야 해서 `weekLabelOf` 통일보다 손이 더 갈 수 있다 — 추정, 계획이 산정) / 또는 키가 속한 달의 N번째 시작 요일(일요일 시작이면 평일 대부분이 다음 달인 주도 전달 이름). 재검토 반영 — R8 | 낮음 — `weekLabelOf` 한 함수와 테스트 기대값. 라벨은 저장하지 않고 그때 계산하므로 메인 스택 적용 뒤에도 바꿀 수 있다(그때까지 내보낸 파일명은 옛 이름으로 남는다) | **SP5 착수 전 사용자 결정** — 컨트롤러가 확정 보고에서 묻는다, 답이 없으면 A 의 마이그레이션 커밋 전 재확인 |
| 2 | **(SP5 착수 전 사용자 결정 — U-2, 개정 §8.1 #3)** 주간보고가 이미 있는 프로젝트도 **다음 주부터** 일요일 시작으로 바꿀까요? 지난 주차는 그대로이고, 바뀌는 주 하나만 6일(월~토)이 됩니다. 미리 만들어 둔 미래 주차가 있으면 그 뒤부터 바뀝니다. 주간보고가 없는 프로젝트는 곧바로 일요일입니다 | 전환(D5 — 사용자 결정 4) | 주간보고가 있는 프로젝트는 월요일 유지(설정 화면에서 언제든 일요일로 바꿀 수 있다 — 같은 전환 규칙) | A 의 코드·리허설까지는 낮음 — 이관 한 절 교체(§3.2 ⑩ 에 대안 SQL 을 함께 둔다). **메인 스택 적용(#13) 뒤에는 덤프 복원 외에는 되돌릴 수 없다**(설정 값·이력을 롤백이 되돌리지 않는다. 재검토 반영 — R15: 그 뒤에는 설정 화면의 전환 규칙으로 새로 바꾸는 것만 된다) | **SP5 착수 전 사용자 결정** — 컨트롤러가 확정 보고에서 묻는다, 답이 없으면 A 의 마이그레이션 커밋 전 재확인, #13 때 답 상태 확인 |
| 3 | (U-3) 주 시작 요일 선택지를 일요일·월요일 둘로만 둘까요? | 둘(D6) | 7요일 | 낮음 — 선택지 목록·검증 | A |
| 4 | (U-4) 공휴일 반대의 '특정일 근무'(토요일 근무 등)를 프로젝트 설정의 일정 화면에서 등록하게 할까요? Excel 의 Holiday 시트는 쉬는 날만 다룹니다 | 일정 화면에서 휴무/근무 선택, Excel 은 휴무만(D7) | Excel 에도 '근무' 열(양식 엔진 SP6 과 함께) | 중간 — Excel 양식·가져오기·내보내기 | A |
| 5 | (U-5) 회의록의 '팀' 지정을 팀 이름 문자열이 아니라 팀 자체(id)로 바꿀까요? 팀 이름을 바꾸거나 프로젝트 전용 팀으로 전환해도 회의록이 같은 팀을 가리킵니다. 외부 회의록 업로드(또박또박)의 계약은 그대로입니다 | SP5 B2 에 넣는다(D18) | 폴더만 id 로, 회의록은 SP7(외부 계약 v3)과 함께 | 대안이면 −0.4~0.55주, 전환 뒤 회의록이 어느 팀인지 코드로만 안다 | B2 |
| 6 | (U-6) 녹취 도구 결과의 "UTC → 한국 시간(+9시간)" 자동 보정을 "UTC → 그 회의록의 시간대"로 바꿀까요? | 시간대 설정으로 일반화, 보정 여부 판정은 그대로(D13 ④) | 한국 전용으로 두고 지원 제한에 적음 / 보정을 끔 | 낮음 | A |
| 7 | (U-7) 지운 회의록 첨부는 첨부 개수 한도에서 바로 빠지게 할까요? 실제 파일 정리는 정리 작업이 뒤에서 합니다 | 뺀다(D23) | 실제 파일 정리 전까지 한도에 남김 | 낮음 — 가드 조건 한 줄 | B3 |
| 8 | (U-8 변형) SP5 를 **다섯 단계**(달력 / 이슈 / 회의록 첨부 / 어휘 / 회의록 팀·마감 — 이 순서로)로 나눌까요? 개정은 셋, 사전 실측은 넷을 권했지만 추정이 단계당 상한(3주)을 넘습니다. 단계마다 검증·기록 비용(0.2~0.3주)이 붙어 전체 추정은 9.45~12.1주(개정 5~5.5주)입니다. 회의록 팀만 SP4 완료를 기다리므로 맨 끝에 둡니다 | 다섯, 순서 A → B1 → B3 → B4 → B2(D1, 비평 반영 — S9) | 넷(첨부+어휘 2.75~3.6주 — 상한을 넘을 수 있다) / 셋(개정 — 상한 위반) / 초안 순서(회의록 팀을 셋째로 — 첨부·어휘도 SP4 완료를 기다린다) | 단계 수·순서만 바뀐다 — 넷이면 고정 비용 −0.2~0.3주, 그 단계의 넘침 위험. 순서는 번호를 접미로 부르므로 비용 0 | 스펙 확정 때 |
| 9 | (U-9, 개정 §8.1 #18) 새 워크스페이스의 기본 시간대 — 생성 화면이 브라우저 시간대를 제안하고, 로컬 개발용 `dev:bootstrap` 은 `BOOTSTRAP_TIMEZONE`(기본 `UTC`)을 받게 할까요? 기존 데이터는 모두 서울 시간으로 옮겨집니다 | 그렇게 한다(D13 ②) | bootstrap 기본을 서울 | 낮음 | A |
| 10 | (새 — SP4 §8 #5 와 같은 질문) SP5 가 만지는 화면(회의·회의록·이슈·근태·공지) 가운데 **새 기능 부분만** 새 디자인 패턴으로 만들고, 나머지 화면 전체의 패턴 정리(머리·상태 표시·글자 크기)는 뒤(SPU3)로 넘길까요? 이것은 **개정이 정한 "SP 가 만진 화면은 패턴으로 끝낸다" 원칙(§6.1 원칙 4)을 고치는 일**입니다 | 넘긴다(D30) — 여섯 화면 전면 이행은 +0.75~1.25주 | 개정대로 SP5 가 끝낸다(체크포인트 하나 더 또는 상한 근접) | 중간 — 추정과 일정 | A 착수 전 |
| 11 | (새 — SP4 §8 #4 와 같은 질문) 화면 눈확인을 에이전트가 브라우저 스크린샷(라이트·다크)으로 하고 기록을 남길까요? **개정은 눈확인을 사람의 게이트로 정했습니다**(개정 §6.5.9) | 에이전트(D31) — 사람 눈확인은 레인 B 의 사용자 게이트에서 | 체크포인트마다 사용자 눈확인(그동안 다음 단계는 쌓는다) | 낮음 — 달력만 늦어진다 | A |
| 12 | (새) 회의록 폴더의 '사용자 지정 루트' 모드(팀이 아닌 이름 목록으로 최상위 폴더를 두는 것)는 외부 업로드 계약이 달라 상대 팀에 v2.9 절을 보낸 뒤에만 쓸 수 있습니다. SP5 는 기능·테스트까지 만들고 **설정 화면 선택지는 SP7 전까지 숨길까요?** | 숨긴다 + SP7 전까지 키 `editor = 'platform_admin'`(D21 — 개정 §8.1 #15, 비평 반영 — S13) | 화면에 바로 노출 + 경고 문구 | 낮음 — 선택지 하나·`editor` 한 칸 | B2 |
| 13 | (새 — **그때 묻는다**) 각 단계가 main 에 들어간 뒤 지금 쓰시는 로컬 DB(메인 스택)에 적용할까요? 적용하면 — A: 시간대 서울 기록·주간보고 프로젝트의 일요일 전환(#2), B1: 이슈 코드가 프로젝트 영역 기준으로 바뀌고 코드 없던 이슈에 코드가 매겨짐(#14), B3: 첨부 삭제가 톰스톤으로, B4: 어휘가 설정으로, B2: 회의록 최상위 폴더 이름이 팀 코드 → 팀 이름, 회의록에 팀 id(도는 순서 — 재검토 반영 — R16) | 적용 전 덤프 → `migration up`(리허설과 같은 절차) → 결과 건수 보고(D48). A 적용 전에 #1·#2 의 답 상태를 함께 확인 | 미룬다(그동안 메인 스택은 옛 스키마 — 앱 main 과 맞지 않는다) | 적용은 덤프로만 되돌린다(롤백 SQL 은 설정 값·이력·회의록 `team_id`·레거시 코드 문자열을 되돌리지 않는다). 미루면 비용은 없지만 메인 스택에서 앱을 쓸 수 없다 | 각 단계 main 반영 뒤 |
| 14 | (새 — 알림) 코드가 없던 기존 이슈(분석 분류를 안 한 이슈)에 이관이 코드를 매깁니다(등록 순). 분석 코드(`PI-I-…`)가 있던 프로젝트는 분류된 이슈의 코드가 그대로 이어지고, **영역(Mega)이 없는 이슈는 `PI-U-001` 같은 별도 형식**을 받습니다(그 형식은 이관 때만 쓰고 늘지 않습니다 — 새 이슈는 지금처럼 영역을 골라야 합니다). 분석 코드가 없던 프로젝트는 `ISS-001` 형식이 됩니다. 화면의 `#번호` 표시는 코드로 바뀝니다 | 그렇게 한다(§3.3 ⑥·D55 — 개정 §4.4.3 이관 2 를 고침, 비평 반영 — S5) | 코드 없는 이슈를 남김(코드 NOT NULL 계약을 바꿔야 한다) | 중간 — 채번 계약 | B1 |

## 9. 범위 제외·이월

받는 SP 의 블록에 적혀 있지 않은 것은 마감(B2)의 문서 커밋이 개정의 그 블록에 한 줄을 더한다.

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| 화면 순수 패턴 이행(§5.2 — #8·#9·#24·#26·#29·#31) | SPU3 | SPU3 블록에 한 줄(§8 #10). **SPU3 누적**: SP4 D52 넷 + SP5 여섯(+0.75~1.25주) — 마감에서 개정 §6.2 SPU3 노력(2.5주)을 다시 재고 레버 L2(SPU3 를 출시 후로)의 영향(Q06·Q08·Q11 미검증)을 적는다(비평 반영 — S13) |
| 회의록 `team_code` 열 삭제, 외부 `team` 문자열의 `team_map`, custom 모드 화면 선택지·v2.9 송부·`minutes.root_folders` 의 `editor` 를 `workspace_admin` 으로, 팀을 code 로 가리키는 나머지 넷(`minute_versions.team_code`·`wiki_items.owner_team`·`wiki_topics.owner_team`·`ai_documents.team` — SP5 는 code 로 남긴다, D18) | SP7 | SP7 블록에 한 줄(§8.1 #15 는 이미 있음)(비평 반영 — S13) |
| 이슈 색인 문구 변경의 재색인(`code`), 회의록 `team_id` 색인 재생성 | SP8 | SP8 블록에 한 줄 |
| 청소 잡의 스케줄 배선(크론) | 첫 원격 배포(개정 §8.1 #10)·SP8(§4.10 잡 정책) | SP8 블록에 한 줄 |
| 주간 PPT/Excel·이슈분석서 렌더러의 라벨·영역 9개 이상 출력 | SP6 | 이미 있음(개정 §2.11 SP6 행·§4.5) |
| 이슈 표시 상태(범주 고정 + 표시 상태 설정) — 어휘 트리거 규약·`migrate_setting_code` 재사용 | SP5b | 이미 있음 |
| `fields.*`(사용자 정의 필드) | SP5c | 이미 있음 |
| Excel `Holiday` 시트의 '근무' 열(§8 #4 대안) | SP6(채택 시) | — |
| 격주·월간 보고·회계연도 주차·국가 달력 | 지원 제한(개정 §2.9.2) | 이미 있음 |
| 키보드·모바일 첨부 조작(제8부 수용 #7) | SPU3 390px·키보드 점검 | 이미 있음(개정:3652) |
| 권한 이력 표시(`describeAuthzChange`) 사전 이행 — SP5 는 설정 '기록' 범주를 만지지 않는다(미리보기는 '변경 내용 검토') | 권한 이력 화면을 i18n 하는 SP | 이미 있음(SP4 §9) |
| `carryCustom`·주간 행 `custom`·`create_weekly_report` 재정의 | SP5c | 이미 있음(SP4 §9) |
| 산출물·이슈 첨부의 옛 형식 경로 행 이관(들여올 데이터가 생기면) | 그 데이터를 들여오는 SP(미정) | 개정 §8.1 에 한 줄 |
| `minutes.root_folders` 의 워크스페이스 간 이동·폴더 병합 | 비목표 | — |
| 시각 표시 `locale` 의 값 공급(개인 `locale` 키 — 개정 §2.8.5) | 레인 B(SP3b 계정 설정) | SP3b 원장에 한 줄 — SP5 는 포맷 컴포넌트가 `locale` 인자를 받게만 한다(D60, 비평 반영 — S13) |
| 산출물·이슈 첨부의 톰스톤(지금은 하드 삭제 — 회의록 첨부만 톰스톤, D56) | 첨부 삭제 계약을 하나로 맞출 SP(미정) | 개정 §8.1 에 한 줄 |
| 과도기 마지막 날 되돌림의 주 키 변경 — 8일 과도기 주의 마지막 날(E−1, 일요일)에 대기 전환을 되돌리면 그날의 키가 과도기 키에서 새 주 키로 바뀐다(이번 주가 그 자리에서 쪼개진다 — 과거 날짜·문서 키는 그대로라 DB 는 받는다). 표(개정 §4.2.4 "from > T 원소는 교체·삭제")대로라 SP5 A 는 코드를 바꾸지 않는다(A-1 리뷰 K4 판정) | SP5 B 마감 재검토 | B 마감 문서 커밋이 거부·안내 또는 미리보기 고지 중 하나를 정한다 |
| 자정이 두 번인 날의 TS·SQL 경계 차이 — TS `zonedMidnightUtc` 는 첫 자정(K1), PG `'<날짜>'::timestamp at time zone tz` 는 모호한 지역 시각에 전환 뒤 오프셋을 붙여 둘째 자정을 낸다(Asia/Amman 2010-10-29 — 21:00Z 대 22:00Z). 지금 두 경계를 한 판정에 섞는 코드는 없어 SP5 A 는 코드를 바꾸지 않는다(A-2 리뷰 L5 — `calendar.ts` 주석) | SP5 B 마감 재검토 | SQL 쪽 자정 계산과 대조하는 곳이 생기면 TS 규칙(첫 자정)으로 맞춘다 |
| 사용현황 표 직접 조회(`getRecentUsageEvents`)의 tz 오류 갈래 — RPC 다섯은 PG 22023 을 `USAGE_TIMEZONE_INVALID` 로 가르지만 표 직접 조회는 경계를 TS `zonedMidnightUtc` 로 만들어 모르는 tz 에 `RangeError` 를 그대로 던진다(둘 다 fail-closed). 지금은 tz 가 상수 `'UTC'` 라 도달하지 않는다(A-4 리뷰 P3, N9) | SP8(사용현황 필터 tz 를 넣는 SP) | SP8 블록에 한 줄 — 필터 tz 를 넣을 때 경계 계산을 감싸 같은 `UsageQueryError('USAGE_TIMEZONE_INVALID')` 로 던진다 |

## 10. 리스크

| # | 리스크 | 담는 방법 |
|---|---|---|
| K1 | 이관이 사용자 데이터(메인 스택)를 바꾼다 — 주 시작 전환, 이슈 코드 재키·새 발번, 회의록 팀 id·폴더 종류·루트 이름, 어휘 check 삭제. `_issue_areas` 롤백은 조건부, 폴더 이름·설정 이력은 되돌리지 않는다 | 리허설은 전용 스택(§3.8), 사전검사·전후 대조가 어긋나면 멈춘다, 사용자 DB 는 main 반영 뒤 덤프와 함께 사용자 확인(D48·§8 #13) |
| K2 | SP4 가 끝나기 전에 당겨 시작한 A·B1·B3·B4 가 SP4 B 반영 뒤 rebase 를 받는다. B2 는 `sp4-done`(그 앞에 레인 B 사람 게이트 둘)을 기다린다 | D3·§2.1.1 — 멈춤 지점은 과제 커밋, 체크포인트 증거는 rebase 뒤 트리에서 다시. 대기 동안 A·B1·B3·B4 를 당긴다(재검토 반영 — R12) |
| K3 | 레인 B UI-2a(경로 이동·`account_preferences`)·UI-2b(layout)와 같은 파일 | D27·D32 — 착수 때 경로 재실측, layout 은 한 줄 `ui/` 브랜치, 나중 머지가 rebase 하고 `test:rls` 전체 재실행, 번호는 rename |
| K4 | 기본 일요일·주 키 트리거가 월요일을 가정한 경로(픽스처·캡처 시드·합성·봇·E2E·SP4 의 새 호출부)를 깬다 | D28(월요일 규칙 선기록 — SP4 `weekly-areas.test.ts` 임시 프로젝트 포함, 마이그레이션 앞 커밋 ①)·D10(착수 재전수)·D9(가드)·`week-start-transition` 의 직접 쓰기 케이스. A 의 첫 마이그레이션 커밋 전에 단일 출처 가드와 `test:rls` 가 초록(옛 사본은 허용 목록)(비평 반영 — S8) |
| K5 | TS `weekKeyOf`·`isWorkingDay`·`renderIssueCode`·첨부 정책 해석과 SQL 이 어긋난다 | 패리티 테스트 다섯(§6.2), 골든 행렬 한 파일을 두 쪽이 읽는다 |
| K6 | 잠금 경합·교착 — 설정 RPC(`FOR UPDATE`) 대 주 키·어휘·채번·첨부 트리거(`FOR SHARE`), SP4 advisory `'weekly:'`, 채번 카운터 행 잠금, SP4 전환 RPC 의 프로젝트 `for update` 와 M1 트리거 `for key share` | D8 의 잠금 순서(순환 없음)를 각 함수 머리 주석에, 경합 테스트(주 키·어휘·동시 채번·동시 첨부), M1 트리거를 회의록 두 표에 걸 때 SP4 의 교착 처리(40P01 → 503 재시도)를 같은 호출부 규칙으로 — 고빈도 외부 업로드(수신 RPC)도 회의록 insert 마다 프로젝트 행 `key share` 를 잡으므로 외부 API 가 `TEAM_SCOPE_PROJECT_OWNED`·40P01 을 503 재시도로 매핑(§3.4 ⑦). 비평이 SP4 HEAD 본문과 대조한 새 순환 둘 — 어휘 이관 ↔ 어휘 트리거(D58: 값이 바뀐 행만 판정 + 40P01 재시도), 채번의 영역 활성 판정 ↔ 영역 비활성화(D15: `for key share`)(비평 반영 — S13) |
| K7 | 시간대 교체가 넓다(seoul* 38파일 96회·리터럴 24파일·오프셋 9줄 — 비평 재측정, 재검토 반영 — R11) — 한 곳이라도 남으면 '오늘'이 하루 어긋난다 | `no-runtime-constants` 허용 목록 0, 센티널 S10, 합성 S5(LA·베를린·DST), 표시 포맷 컴포넌트의 `timeZone` prop 을 필수로(기본값 없음 — 타입이 잡는다) |
| K8 | 이슈 채번 재작성 — 동시 발번 결번·중복, 정책 변경 겹침, 롤백 불가 경우 | 카운터 행 잠금(현 관례)·`while exists` 건너뛰기 1,000회·동시 100건 테스트·롤백 사전 조건과 raise |
| K9 | 회의록 `team_id` 이관에서 팀을 못 찾은 회의록이 '팀 미지정'이 된다(code 오타·지운 팀) | `raise notice` 건수 보고·리허설에 불일치 경우, 화면에 '팀 미지정' 필터, `team_code` 메아리가 원문을 지킨다(D18) |
| K10 | 회의록·첨부는 RLS 쓰기 정책이 없어 서버 가드가 유일한 관문이다(CLAUDE.md) — 첨부 패널·톰스톤·청소 잡·`create_team`·폴더 액션 | 모든 새 액션이 권한 가드 → 모듈 관문 → 입력 검증 순서, manifest 등록(D47), service_role 사용처 감사 문서, H2 테스트 회귀, 첨부 가드는 DB 에서 재판정(D23) |
| K11 | 고아 청소 잡이 살아 있는 객체를 지운다(업로드 중·행 커밋 직전) | dry-run 기본·`--apply` 명시, 대상은 `minute-files` 경로 세그먼트뿐이고 `minute_versions.file_path` 가 가리키는 객체 제외(과거 버전 본문 보호), 생성 24시간 유예, 판정은 톰스톤 포함 모든 행, 단위 테스트(경계 시각·본문 객체 0)(D26, 비평 반영 — S3) |
| K12 | 어휘 code 삭제·이관의 경합으로 고아 참조 | 트리거 `FOR SHARE` + 설정 RPC `FOR UPDATE`(개정 §2.4.1), `config-vocabulary` 경합 테스트 |
| K13 | 추정이 실측보다 낮다(SP3a 개정 3 → 4.3~6.3주, SP4 2.5 → 5.5~7.8주). A(2.3~2.9)·B2(2.2~2.9)의 상한이 3주에 가깝다 | 체크포인트마다 실측을 원장에, A 의 넘길 목록(§2.2 셋 — ① 은 별도 마이그레이션)·B2 의 넘김 후보(회의 화면 이월 — 사용자 확인)와 발동 시점(SP4 K17 방식). 일을 미리 옮기지 않는다 |
| K14 | 전환 RPC 가 새 팀 열을 빠뜨리면 같은 code·다른 id 분열(SP4 K20) | D19 ③ — 같은 파일에서 RPC 재정의, SP4 카탈로그 불변식, 전환 뒤 회의록 테스트 |
| K15 | date-only 와 instant 혼동(브라우저 로컬 tz 재해석 — `DayPopover` 꼴) | 개정 §4.2.3 date-only 규칙, `week-single-source` 가 `get(UTC)?Day()` **호출 자체**를 허용 목록 밖에서 잡는다(초안의 조건식 모양 정규식은 `DayPopover` 의 `getDay()` 를 못 잡았다 — D9), LA·서울 경계 테스트(비평 반영 — S13) |
| K16 | custom 모드가 v2.9 송부 전에 켜지면 외부 업로드가 다른 정규화를 받는다 | D21 — 화면 숨김, 플랫폼 관리자 RPC 만 |
| K17 | 화면 패턴 이행을 SPU3 로 넘기면 SP5 화면이 한동안 새 요소와 옛 패턴이 섞인다(§6.1 원칙 4 의 수정) | §8 #10 사용자 확인, 새 요소만 패턴 — 옛 줄은 건드리지 않는다, SPU3 블록에 목록 |
| K18 | 한국 공휴일 표시가 사라져 기존 사용자에게 달력이 달라 보인다 | 사용자 결정 5(의도), 휴일은 일정 화면에서 입력, 이관 안내 문구 한 줄(설정 일정 절) |
| K19 | 주차 이름이 바뀌어 지난 주간보고·내보낸 파일명과 화면 이름이 다를 수 있다 | §8 #1 착수 전 확인, 라벨 커밋 메시지에 의도 변화, 문서 키(`week_start`)·URL 불변 |
| K20 | SP5 전용 스택(546xx)과 SP4 스택(545xx)·레인 B(544xx)·메인(543xx)이 동시에 떠 있다 — 명령이 엉뚱한 DB 로 붙는다 | D33 래퍼(다른 DSN 거부), 계획 명령 전문 grep, 무거운 실행 공유 잠금 |
| K21 | 세션이 `minute_folders` 의 팀 루트를 위조·선점·삭제한다(표 단위 grant·세션 쓰기 정책 셋이 새 열에도 걸린다) — 남이 편철한 하위 폴더가 cascade 로 사라지고 회의록이 고아가 된다 | D49 종류 가드(INVOKER — `current_user` 로 세션 판정), 세션 위조 다섯 RLS 테스트, 사후검사. 남는 위험: 가드는 `current_user` 판정에 기댄다 — 새 DEFINER 함수가 세션 입력을 그대로 폴더에 쓰면 가드를 지난다(그런 함수는 자기 재판정을 갖는다 — §3.1)(비평 반영 — S1) |
| K22 | 톰스톤 되살리기로 첨부 개수 한도를 우회한다 / 전이 가드가 정당한 관리 작업(잘못 지운 첨부 복구)도 막는다 | D56 전이 가드(모든 역할), 세션 UPDATE 회수 유지·세션 DELETE 정책 삭제와 DELETE 권한 회수(재검토 반영 — R2). 전이 가드는 계정 삭제의 FK `set null` 연쇄를 (c) 로 통과시킨다(R3). 복구는 같은 파일을 새 첨부로 다시 올리는 것뿐 — 운영 복구가 필요해지면 전이 가드를 고치는 마이그레이션으로(비평 반영 — S6) |
| K23 | 한 프로젝트에 이슈 코드 형식이 둘(`PI-I-…` 와 레거시 `PI-U-…`) 섞여 사용자가 헷갈린다 / `_issue_areas` 롤백이 `ISS-…`·레거시 코드 문자열과 영역 분류를 버린다 | §8 #14 고지, 레거시 범위는 늘지 않음(트리거가 쓰지 않는다), 렌더 검증으로 두 형식이 겹치지 않음. 롤백 손실은 머리 주석에 적고 리허설 왕복으로 확인(D55, 비평 반영 — S5) |
| K24 | 팀 개명이 회의록 폴더 이름 충돌·60자 제약 때문에 막힌다(폴더가 개명을 인질로 잡는다) | D52 — 이관 전 사전검사로 기존 충돌 0, 이후 충돌은 `TEAM_ROOT_NAME_CONFLICT` 문구(조치: 겹치는 폴더 개명). D49 ⑤ 가 세션의 팀 이름 선점을 막아 새 충돌의 대부분을 없앤다. 그래도 잦으면 대안(이름 유일 인덱스를 `kind <> 'team_root'` 로)을 다음 SP 가 고른다(비평 반영 — S10) |
| K25 | SP5 가 SP4 함수 본문을 전문 재정의하는 사이 SP4 가 그 함수를 다시 고치면 SP5 복사본이 조용히 수정을 되돌린다 | D12 승계 검사 — 바탕 태그 시점 본문, 사후검사의 SP4 토큰, rename 뒤 재리허설(비평 반영 — S13) |
| K26 | `getProjectConfig` 의 `holidays` 끝까지 읽기·의존성 트리거의 날마다 `is_workday`·채번 트리거가 응답 시간을 늘린다 | D59 성능 게이트(p95 ≤ 1.20)와 위반 시 조치 셋(비평 반영 — S13) |
| K27 | 순서 변경(B2 끝)으로 B3·B4 가 회의록 파일(`actions/minutes.ts`·`data/minutes.ts`·`domain/minutes.ts`)을 먼저 고쳐 B2 의 rebase 충돌이 늘고, `sp4-done` 이 늦으면 A·B1·B3·B4 가 쌓인 채 SP4 B rebase 를 한꺼번에 받는다 | D3·§2.1.1 ③ — 체크포인트마다 로컬 태그, rebase 뒤 트리에서 증거 다시, 쌓인 브랜치는 태그 순서로 ff(비평 반영 — S9) |
| K28 | 주 시작 정확 판정(D53)이 프로젝트의 주간 문서 전부를 훑어 설정 저장이 느려진다 | 주간 문서는 프로젝트당 연 52건 수준 — 저장 때만 돈다. 문서가 많은 프로젝트가 생기면 바뀐 첫 규칙 원소의 과도기 창 시작(`from − 10일`) 이후 문서만 보는 최적화(첫 원소가 바뀌면 전체 — 판정은 같다)(비평 반영 — S2) |
