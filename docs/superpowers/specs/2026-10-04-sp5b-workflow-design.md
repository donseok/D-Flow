# SP5b — 업무 흐름 설정화(이슈 표시 상태 · WBS 승인 단계 · 선행 기준 · 크레딧 정책) 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-04 |
| 상태 | **초안** — 비평 셋(실현성·범위 / 상위 충실도 / DB·보안) 뒤 판정을 반영해 확정한다. 확정본은 이 줄을 "확정 — 판정 Sn 반영"으로 바꾸고, 판정이 바꾼 행에 "비평 반영 — Sn" 을 단다 |
| 상위 정본 | 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §3.0~§3.5·§3.7·§3.8(SP5b done_when 1~9)·§2.4.1·§2.4.2·§2.8.2 `workflow.*` 6행·§2.8.6(`agents.stage_workflow` 은퇴)·§5.12.5 SP5b 행·§6.2 SP5b 블록·§6.2.0 H1 과제 11·15, H2 구현 결과 A6·B1. SP5 확정 스펙 `docs/superpowers/specs/2026-10-02-sp5-calendar-issues-minutes-design.md`(이하 "SP5 Dn") — 특히 D58(어휘 이관 두 명령)·§3.6·§4.9·§9 의 SP5b 행 |
| 선행 | `sp5-done`(main `87c6116`) — B4 의 어휘 인프라(`0023_vocab_settings`)와 SP3a 의 `apply_workflow_event` 판(`0012_settings`) 위에서 한다 |
| 마이그레이션 | **둘** — 개발 중 파일명 `NNNN_issue_status_vocab`(Phase I)·`NNNN_workflow_policy`(Phase W). 번호는 main 머지 직전에 정한다(SP4 D12 관례 — 지금 순서면 `0025`·`0026`). 테스트·리허설은 접미로 찾는다(CLAUDE.md 데이터 절) |
| 실측 근거 | 2026-10-04 읽기 전용 사전 실측 둘 — `.superpowers/sp5b/survey-issues.md`(범위 A1~I3·충돌 C-1~C-19·소비처 전수·쓰기 경로 W1~W10·사용자 확인 후보 U-1~U-16, 이하 "실측-I") · `.superpowers/sp5b/survey-wbs.md`(범위 R1~R25·충돌 C-1~C-19·쓰기 경로 A-1~A-13/W-1~W-9·U-1~U-10, 이하 "실측-W"). 이 문서의 file:line 은 `87c6116` 기준이며 착수 때 심볼로 다시 찾는다 |

읽는 순서: 사용자는 **§8 을 먼저** 읽는다. 표기 — "D n" 이 문서의 결정, "E n" 상위 문서 대비 정정, "K n" 리스크, "개정:줄" 상위 문서 줄, "I-Cn"·"W-Cn" 실측-I·실측-W 의 충돌 번호, "I-Un"·"W-Un" 사용자 확인 후보 번호.

## 목차

1. 전제와 결정 — 1.1 구속하는 결정 · 1.2 이 SP 의 결정(D) · 1.3 상위 문서 대비 정정(E) · 1.4 범위 표
2. Phase 구성 — 2.1 Phase 표 · 2.2 노력 추정 · 2.3 소유 파일 · 2.4 UI 위험 파일·트레일러 · 2.5 커밋·브랜치
3. DB 계약 — 3.1 공통 규칙 · 3.2 `NNNN_issue_status_vocab` · 3.3 `NNNN_workflow_policy` · 3.4 격리 맵·픽스처 · 3.5 리허설·롤백
4. 도메인·서버 — 4.1 이슈 표시 상태 · 4.2 승인 단계 · 4.3 선행 기준 · 4.4 크레딧 정책 · 4.5 설정 키 등록 · 4.6 에이전트 프로토콜
5. 화면
6. 테스트·검증
7. 완료 조건(done_when)
8. 사용자 확인 항목
9. 범위 제외·이월
10. 리스크

---

## 1. 전제와 결정

### 1.1 구속하는 결정

- **사용자 결정 1(2026-09-26, 개정 §1.2)** 업무 흐름은 설정화한다 — 고정은 시스템 의미 범주(이슈 4범주·WBS `as/ip/im/xx`·주문 5상태)와 에이전트 프로토콜 둘뿐. **결정 3** 집계·위험·완료 판정은 어떤 설정으로도 바뀌지 않는다. 스크립팅은 없다(개정 W2).
- 개정 W1(행은 범주와 표시 상태를 둘 다 가진다)·W3(WBS 에는 같은 범주 안 복수 표시 상태 없음 — 승인 단계로 표현)·W4(설정은 권한을 넓히지 않는다)·W5(승인 0단계 없음 — `approved` 는 머지 조건이다).
- SP5 D58 — 어휘 code 이관은 `migrate_setting_code` 와 일반 설정 저장의 **두 명령**이다(개정 §2.4.2 의 한 명령·revision CAS 판을 대체했다). 이 SP 는 그 계약을 따른다(D3).
- 에이전트 프로토콜 동결(정본 5.3.4, 개정 §3.4) — URL 11개·응답 키·주문 상태·`depends_evidence[].reached` 키·타입 불변.
- CLAUDE.md — 판정은 `src/lib/domain/authz.ts` + `src/lib/authz/**` 두 곳, 가드 넷, `p_actor` 는 가드 결과의 `actor.userId` 만, 마이그레이션·코드 분리 커밋, 에러 처리 3원칙(조회 실패 위장 금지·쓰기 전 선행 조회 실패면 중단·보안 가드 fail-closed).

### 1.2 이 SP 의 결정

**이슈 표시 상태(Phase I)**

| # | 결정 | 근거 |
|---|---|---|
| D1 | `workflow.issue_statuses` 는 **B4 어휘 계열의 여섯째 키**로 얹는다 — 엄격 parse·라벨 사전 규약·색 토큰·편집기(`VocabEditor`)·`settings_ref_check` 어휘 분기·`migrate_setting_code` 를 재사용한다. 키 이름은 개정대로 `workflow.issue_statuses`, 의미 속성은 `category ∈ {open, in_progress, resolved, on_hold}`(`attendance.types.counts_as` 와 같은 "참조가 있으면 바꿀 수 없는 속성"). 전이 판정(`initialStatus`·`allowedTargets`·`canTransitionCode`·`categoryOf`)만 순수 모듈 `src/lib/domain/issueWorkflow.ts` 에 둔다 | 실측-I ⑦·I-U1. 새 인프라의 대부분을 B4 가 이미 만들었다. 개정의 `issueWorkflow.ts` 별도 모듈 서술(개정:1196)은 판정 함수만 남기고 어휘 부분은 `vocab.ts` 로 |
| D2 | 라벨은 **필수 문자열**, 기본 code·기본 라벨이면 사전 문구(`issue.status.<code>`)로 그린다 — B4 규약. 색은 `VOCAB_COLORS` 를 쓰고 기본값은 **현 칩 색 그대로**(open=delayed·in_progress=progress·resolved=done·on_hold=neutral) | 개정 `label: string\|null`·`action` 등 7색(개정:1161)과 다르다 — `action` 은 `-weak` 짝이 없어 칩을 못 만든다(I-C5·I-C6). 화면 회귀 0. 색 체계 이행은 디자인 SP |
| D3 | `migrate_setting_code` 는 **B4 의 5인자 계약을 유지**하고 `workflow.issue_statuses` 분기만 더한다(설정 행 `FOR UPDATE` 먼저 → 참조 update → 건수 반환. revision·`p_command_id`·`p_remove_from` 없음). 이슈 분기는 **같은 범주 안으로만** 옮긴다(다른 범주면 `SETTINGS_CODE_CATEGORY_MISMATCH` 23514). 삭제는 이관 → 일반 저장의 두 명령 | SP5 D58. 범주를 넘는 이관은 과거 집계 의미를 바꾼다(결정 3) — 범주 변경은 개별 전이로만. 그래서 개정의 GUC 우회(`dflow.setting_code_migration`, 개정:1176)가 필요 없다(I-C3·I-U5) |
| D4 | DB 판정 트리거 `trg_vocab_issue_status`(`BEFORE INSERT OR UPDATE OF status, status_code, resolved_at, project_id`, DEFINER·`search_path ''`) — 개정 §3.2.2 의 판정 표에 셋을 더한다: ① 격리 수준 가드 `25001 ISSUE_WORKFLOW_ISOLATION`(설정 판정 트리거 공통, H2 A6) ② `resolved_at` 은 트리거만 정한다 — INSERT 는 null, 범주 불변 UPDATE 는 `old.resolved_at` 유지(직접 PATCH 무시가 아니라 **거부** `ISSUE_RESOLVED_AT_DERIVED` 23514) ③ INSERT 에 `status` 가 `open` 이 아닌데 `status_code` 가 없으면 거부(`ISSUE_STATUS_DERIVED`) — 조용히 덮지 않는다 | I-C9·I-C10·I-C15. 대시보드 해결 7일 KPI 가 `resolved_at` 을 믿는다 |
| D5 | 상태 이력 `issue_updates(kind='status')` 는 **AFTER UPDATE 트리거**가 쓴다 — 액션·PostgREST 직접 PATCH·이관 세 경로가 같은 이력을 남기고 상태 변경과 원자적이다. 작성자 = `auth.uid()`, JWT 가 없으면 트랜잭션 GUC `dflow.actor`(이관 RPC 가 `p_actor` 로 설정), 둘 다 없으면 `author_user_id` null. 이름 = `profiles.display_name`, 없으면 '(이름 없음)'. 액션의 별도 insert(`actions/issues.ts:1147-1158`)는 지운다 | I-C19·I-U7·I-U8. 지금은 커밋 뒤 service_role 별도 insert 라 실패하면 이력만 빠지고, 직접 PATCH 는 이력이 없다 |
| D6 | `updateIssueProgress` 의 patch 필드 이름은 `status`·`expectedStatus` **그대로**, 값의 뜻만 "표시 상태 code" 가 된다(CAS `.eq('status_code', expected)`) — 기본 설정에서 code = 범주 code 라 기존 호출·테스트가 그대로 통과한다. 선조회 오류를 보지 않던 곳(`:1101`)은 고친다(3원칙 ②) | I-C8. 개정의 `statusCode`·`expectedStatusCode` 개명(개정:1217)은 done_when #1 "무수정"과 충돌 |
| D7 | `nextResolvedAt` 은 **남긴다** — 트리거 규칙의 TS 판(패리티 오라클), 액션은 더 쓰지 않는다 | I-C7. 개정 "삭제"(개정:1211)와 done_when #1 의 충돌 해소 |
| D8 | 이슈 보드는 만들지 않는다. `StatusPill` 은 **정의를 받는 판**(`{ label, tone, icon }`)으로 바꾸고, WBS 일정 상태는 고정 정의를, 이슈 칩 넷(`IssuesView`·`IssueModals.StatusChip`·회의록 두 곳)과 포털은 해석된 표시 상태 정의를 넘긴다 | I-C14·I-C17·I-U4·I-U6. §5.12.5 ①은 이것으로 충족, ②(보드 열 파생)는 WBS 보드의 '흐름' 보기(D17)로 충족 |
| D9 | 알림 `issue.status` 발행은 시작하지 않는다 | I-C12 — 타입만 있고 발행 0, "상태 자동 기록은 알리지 않는다"는 기존 설계(`inbox.ts:23-26`) |
| D10 | 분석서 저장 실행·입력 스냅샷은 B4 규약 — 기본 정의 프로젝트는 글자까지 동일(넣지 않음), 사용자 정의가 있을 때만 `statusCode`·`statusLabel` 을 싣는다. AI 색인 본문은 code 유지(라벨 색인·재색인은 SP8) | I-U10·I-U11. 기존 분석 캐시를 무효화하지 않는다 |

**WBS 흐름(Phase W)**

| # | 결정 | 근거 |
|---|---|---|
| D11 | `apply_workflow_event` 재작성의 출발점은 **살아 있는 `0012_settings.sql:229-466` 본문**이다(8인자·`p_expected_report_id` 대조·`25001 WORKFLOW_EVENT_ISOLATION`·`values` 판독). 새 인자 `p_expected_step text default null` 을 **9번째(맨 뒤)** 에 더한다 — `drop function`(8인자) + `create` + `revoke … from public, anon, authenticated` + `grant execute … to service_role`. 0011 ⑪ 사후검증을 지금 카탈로그에 다시 돌리는 `tests/rls/h2-postchecks.test.ts` 의 ⑪ 케이스는 "현 시그니처를 카탈로그에서 찾아 같은 검사"로 **같은 커밋에서 고친다**(done_when #1 의 무수정 목록에서 이 파일 하나를 뺀다 — 의도를 보존한 기계적 수정) | W-C2·W-C3·W-U1. 위치 인자 테스트(`workflow-parity`·`synthetic-parity` 8인자)는 뒤에 기본값 인자를 더하므로 그대로 돈다 |
| D12 | 롤백의 복원 대상은 **0012 본문 바이트 그대로 + 8인자 시그니처 + 권한**, `guard_workflow_actual` 은 **`0011:918-943` 본문** — 개정의 "기준선 `0000:731-944` 로" 는 H2-i 대조·격리 검사를 지우고 7인자로 돌아가 앱을 깨므로 쓰지 않는다 | W-C2 |
| D13 | JWT 세션의 흐름 열 쓰기를 막는 `guard_workflow_columns` 는 **`stage`·`review_round`·`review_steps`·`dev_workflow`·`tags`** 다섯 열을 INSERT·UPDATE 모두 본다(`auth.uid() is null` = 서버 경로 통과). INSERT 는 다섯 열이 기본값(`null`·0·null·false·`{}`)일 때만 허용 | 개정은 stage·review 둘(개정:1270). `dev_workflow`·`tags` 를 문장 나눠 끈 뒤 100 을 쓰는 다문장 우회(H2 이월 개정:3681, W-C17·W-U3)를 닫는다. 앱의 JWT 쓰기는 다섯 열 어느 것도 쓰지 않는다(실측-W ④-1 — 위임·`dev_workflow` 토글·가져오기는 service_role) |
| D14 | `guard_workflow_actual` 은 0011 ⑩ 구조(태그 → 격리 → 주문)에 **단계 절**을 더하고(설정 행 `FOR SHARE` — §2.4.1 규약, 격리 검사 뒤), 트리거를 `BEFORE INSERT OR UPDATE OF actual_pct` 로 넓힌다 — INSERT 는 99 초과 실적이 `dev_workflow` 행이면 거부 | W-C4·W-C5·W-C17. 관리자 JWT 의 `actual_pct=100` 직접 INSERT(W-6)를 닫는다 |
| D15 | 유효 단계 목록 규칙은 하나다: stage ∈ {im, xx} **이고 스냅샷이 있으면** 스냅샷, 그 밖(스냅샷 없음 포함)은 **현재 설정**. 서비스 경로(에이전트 가져오기)로 im·xx 가 된 새 행은 스냅샷이 없으므로 현재 설정을 따른다. `xx` 는 이미 최종 승인이라 판정에서 빠진다(개정 §3.3.5 그대로) | W-C18·W-U4. 개정 §3.3.5 의 `coalesce(cardinality(review_steps), 1)`("스냅샷 없음 = 1단계")과 §3.3.2 의 "유효 단계 한 규칙"이 서로 달랐다 — 현재 설정 쪽으로 하나로. `import_wbs_upsert` 는 건드리지 않는다(SP5c·SP7 충돌 회피) |
| D16 | 사람의 `set_stage` 로 `xx → im` 은 **새 라운드**(+1) + 옛 라운드 승인 철회(`stage_reset`). `unapprove`(주문 경로 xx→im)만 같은 라운드에서 마지막 단계를 다시 대기로 돌린다 | W-U5 — 개정 표에 없던 경우 |
| D17 | 보드: `KanbanBoard` 에 네 번째 보기 **'흐름'** — 열 = 단계 범주 5개(미착수 포함, 프로젝트 라벨), `im` 열 카드에 "승인 n/m · 라벨". **읽기 전용**(드래그 없음 — 기존 '진척' 보기의 드래그는 그대로 두고, 그 쓰기는 `updateActual` 이라 D14 단계 절이 덮는다) | 개정 §3.5 보드 행·§5.12.5 ②. 개정 "드래그 없음, 카드 이동 메뉴"는 '흐름' 보기에만 적용하고 이동 메뉴는 SPU2(그리드·보드 통합)로 넘긴다(W-C14) |
| D18 | 승인자 판정: 액션이 대기 단계를 먼저 읽고 `approverOf` 가 `admin` 이면 `requireProjectAdmin`, `subtree_or_admin` 이면 H1 과제 15 의 `requireCompletionApprover` → 읽은 단계를 `p_expected_step` 으로 CAS. 화면용 `canApproveCompletion`(`domain/seatmap.ts:141`)은 **`src/lib/domain/authz.ts` 로 옮기고** 단계 승인자 인자를 받는다 | W-C10·W-U6. CLAUDE.md 판정 위치 규칙 |
| D19 | 사람 경로 승인 `approveWbsStep` 의 모듈 관문은 없다(`module: null` — `wbs` 는 core). 에이전트 주문 승인 `approveAgentCompletion` 은 지금처럼 `agents` | W-U10 |
| D20 | 크레딧 SQL 판독도 fail-closed 로 — 키 없음·JSON null = 기본(`c_default`, 현행 패리티 유지), **모양 손상 = `CONFIG_INVALID:workflow.stage_credits` 22023**. 판독은 새 헬퍼 `workflow_setting` 을 거친다 | W-C12·W-U2. 개정 §3.3.1 의 fail-closed 원칙과 0012 의 조용한 폴백 불일치 |
| D21 | 선행 기준 gate 는 **소비처 5곳 모두** 같은 입력 형 `{ stage, orderApproved, actualPct, devWorkflow }` 로 판정한다 — 원래 승인 축이 없던 `stageTransition.allPredecessorsReached`·`dependencyReadiness.evaluateStartReadiness` 에도 승인·`dev_workflow` 재료를 싣는다. 여러 프로젝트를 도는 좌석표는 프로젝트별 gate 맵을 받는다 | W-C19·W-U8. 그러지 않으면 화면 "시작 가능"과 claim 게이트가 다른 말을 한다 |
| D22 | `apply_workflow_event` 성능 기준선은 **Phase P0 에서 `87c6116` 스키마로 먼저 잰다** — 새 측정 명령 `perf-baseline.mjs workflow`(pg 직결, 사건 순환 N회 × 라운드, 1단계·2단계 설정) | W-C·⑥-2·W-U9. done_when #8 의 "SP5 종료 대비" 비교값이 지금 없다 |

**공통**

| # | 결정 | 근거 |
|---|---|---|
| D23 | Phase 순서 **P0(기준선·현행 고정) → I(이슈) → W(WBS) → Z(마감)**. I 가 작고 독립이라 먼저 — 마이그레이션 번호도 그 순서(`*_issue_status_vocab` → `*_workflow_policy`) | I-U16. 설정 '상태·승인' 섹션을 I 가 먼저 열고 W 가 채운다 |
| D24 | 합성 게이트: S6 의 SP5b 몫 `S6-issue-status`(R 이슈 5상태 흐름 — 개정 done_when #2 의 연구 픽스처) 활성, S3 의 SP5b 몫 `S3-flow`(R 2단계 승인 + `final` + 크레딧 `{5,5}` 0/20/25/90/100, C 기본) 활성, `PENDING_STEPS.S3 = 'SP5c(필드)'`. 합성 R·C 크레딧 픽스처를 개정 표 값으로 바꾼다(`synthetic-parity` 기대값 같이) | I-U14·W-C11·W-U7 |
| D25 | 화면 눈확인은 에이전트 스크린샷(1440·390 × light·dark)으로 하고 `docs/baseline/sp5b-ui.md` 에 남긴다 — SP5 §8 #11 과 같은 관례. 다크 캡처는 계정 선호(`account_preferences.prefs.theme`)까지 맞춘다(SP5 B2 의 재촬영 교훈) | SP5 D31 |

### 1.3 상위 문서 대비 정정(실측)

| # | 상위 서술 | 실측 | 처리 |
|---|---|---|---|
| E1 | 번호 `0020_workflow_policy`·`0021_issue_status_vocab`(개정:1150·1265·1699·3667·3844-3845) | `0020`=`issue_areas`, `0021`=`attachments`. SP5 마감 줄(개정:3851) "다음 SP 는 0025 부터" | 접미 이름, 번호는 머지 직전(`0025`·`0026` 예상) |
| E2 | `apply_workflow_event` 기준선 `0000:731-944`, `c_default :735`·잠금 `:887-893`·첫 도달 `:916`(개정:1114·1674·1440) | 살아 있는 본문 `0012:229-466`, `c_default 0012:233`, 잠금 `0012:404-411`, 첫 도달 `0012:438` | D11·D12 |
| E3 | `migrate_setting_code` 8인자·이슈 행 먼저 잠금(개정:1188, §2.4.1) | 5인자·설정 행 먼저(`0023:225-263`), 교착은 액션 40P01 재시도(`actions/vocab.ts:52`) | D3 |
| E4 | 오류 `CONFIG_IN_USE` | DB 토큰 `SETTINGS_CODE_IN_USE:<key>`(`0023:214`) → 앱 `CONFIG_IN_USE`(`actions/settings.ts:201-205`) | 개정 서술은 앱 기준으로 맞다. detail reason 에 `category` 추가 |
| E5 | 이슈 보드 열 파생·`KanbanBoard.tsx:28,122,337`(개정:1475, §5.12.5 ②) | 이슈 보드 없음 — `KanbanBoard` 는 WBS 일정 상태 전용 | D8·D17 |
| E6 | `StatusPill` 이 이슈 표시 상태를 받는다(개정:1470) | `StatusPill` 은 WBS 일정 상태 전용, 이슈 칩은 4곳 손 칩 | D8 |
| E7 | 알림 `issue.status` 본문 라벨(개정:1225) | 발행 0 | D9 |
| E8 | 소비처 표(개정:1213-1227) | 회의록 칩 둘(`MinuteBlockPopover:89`·`MinuteInsightCard:149`)·포털(`portal.ts:34,108,113`·`MyWorkList.tsx:22` — **지금도 원 code 'open' 이 화면에 보인다**) 누락 | 실측-I ③ 전수표를 소비처 정본으로(§4.1) |
| E9 | `getProjectConfig` 0행 throw 신설(개정:694, `src/lib/data/projectConfig.ts:35`) | 이미 있다 — `src/lib/settings/projectConfig.ts:99`, `ConfigUnavailableError` | PAT 경로에서 `{ client: admin }` 만 넘긴다 |
| E10 | `REASON_TEXT workflowEvent.ts:32-44`, `requireCompletionApprover subtreeManager.ts:29-46` 등 다수 줄 | 이동(실측-W C-7) | 심볼로 인용 |
| E11 | `api-contract.md:26-29,164-168` | `:26-27,29-30,166-171`, 그리고 `:32` 의 "`project_settings.stage_credits`" 는 SP3a 뒤 틀린 서술 | 주석과 함께 `:32` 도 고친다 |
| E12 | `tests/skills` 16파일(개정:1460·1687) | `*.test.ts` 16개(+`_preserve.ts`·`fixtures/`) — 일치. 실측-I 의 19 는 비테스트 포함 수 | 그대로 |
| E13 | 크레딧 반례 합성 R 0/20/25/90/100(개정:4040) | 픽스처 R 0/20/30/90/100·C 0/10/20/80/100(`tests/fixtures/synthetic/configs.ts:36,52`) | D24 |
| E14 | `agentWork.ts:31` 주석 "`tests/migrations/0096` 이 대조" | `tests/migrations` 없음 — `tests/rls/workflow-parity.test.ts` 가 대조 | P0 커밋에서 주석 정정 |

### 1.4 범위 표

| 포함 | Phase |
|---|---|
| `workflow.issue_statuses`(범주·라벨·색·순서·활성), `issues.status_code`, 판정 트리거, 이력 트리거, 이관 분기, 소비처(목록·모달·이력·회의록 칩·포털·분석 스냅샷), `StatusPill` 정의판, 이슈 상태 편집기 | I |
| `workflow.wbs_stage_labels`·`approval_steps`·`approval_distinct_approvers`·`predecessor_gate`·`credit_policy`, `apply_workflow_event` 재작성(라운드·원장·`approve_step`·`p_expected_step`·gate·설정 `FOR SHARE`), `wbs_stage_approvals`, `guard_workflow_columns`, `guard_workflow_actual` 단계 절·INSERT, `workflow_setting`·`wbs_predecessor_reached`, `set_dependency_waiver` 삭제, gate 주입 5곳, 크레딧 정책 주입, 승인 화면 넷·단계 패널·보드 '흐름' 보기·서버 문구 라벨, 계약 문서 주석 | W |
| 성능 기준선, 현행 고정 패리티 보강, 응답 키 스냅샷 | P0 |
| 합성 S3·S6, 카탈로그 상태 verified, 원장·HANDOFF, `sp5b-done` | Z |

제외는 §9.

---

## 2. Phase 구성

### 2.1 Phase 표

| Phase | 내용 | 마이그레이션 | 체크포인트 |
|---|---|---|---|
| **P0** 기준선 | `perf-baseline.mjs workflow` 명령 + `87c6116` 기준선 측정(1·2단계 없이 현행 사건 순환), 에이전트 응답 키 스냅샷(claim·GET work) 신설, `agentWork.ts:31` 주석 정정 | 없음 | 기준선 수치가 `docs/baseline/sp5b-perf.md` 에 있다 |
| **I** 이슈 표시 상태 | 순수 계약(`vocab.ts` 확장·`issueWorkflow.ts`) → `NNNN_issue_status_vocab`(+롤백·리허설·RLS) → 레지스트리·액션·이관 분기 → 소비처·`StatusPill` → 편집기 → 검증 | 1 | db reset·RLS·단위·build·실앱 이슈 5상태 흐름 |
| **W** WBS 흐름 | 순수 계약(`approvalSteps.ts`·gate·크레딧 정책) → `NNNN_workflow_policy`(+롤백·리허설·RLS·패리티 골든) → 레지스트리 5키·액션(승인 다단계·`approveWbsStep`·gate 주입) → 화면(설정·단계 패널·승인 넷·보드 '흐름') → 검증 | 1 | db reset·RLS·패리티·단위·build·실앱 2단계 승인 |
| **Z** 마감 | 합성 S3·S6 활성, 성능 재측정(done_when #8), 카탈로그 verified, 계약 문서 주석, 원장(`sp5b-{e2e,ui,effort,perf}.md`·`synthetic-acceptance.md`)·HANDOFF·개정 §6.3 번호, 태그 `sp5b-done`, main | 없음 | — |

### 2.2 노력 추정

| 근거 | 값 |
|---|---|
| 개정 §6.2 | 2.5주(2~3) |
| 실측-I ⑦ | 이슈 쪽 사람 기준 4~6일, 에이전트 실측 보정 2~4 에이전트 시간(B4 1.3h 의 2~3배 — 트리거 판정·테스트 행렬) |
| 실측-W ⑧ | WBS 쪽 사람 기준 7~10일 |
| SP5 클라우드 실측 | B3 후반 1.5h·B4 1.3h·B2 2.3h(`docs/baseline/sp5-effort.md`) |

**추정**: P0 0.5~1h · I 2.5~4h · W 5~7h(재작성 RPC·패리티 행렬·화면 넷이 B2 의 2~3배) · Z 1~1.5h = **9~13.5 에이전트 시간 ≈ 1.0~1.45 노력주**(9.4h/노력주). 개정 2.5주보다 작은 것은 B4 가 이슈 쪽 인프라를 만들었고(D1) H1·H2 가 WBS 쪽 대조·격리·잠금 절을 이미 넣었기 때문이다. 단계당 3주 상한(개정 §6.1)을 넘지 않으므로 Phase 를 더 쪼개지 않는다.

### 2.3 소유 파일

개정 §6.2 SP5b 소유 파일 + 실측이 더한 것(I-C18):

- 도메인: `src/lib/domain/{agentWork,stageCredits,stageLabels,issues,issueWorkflow,approvalSteps,issueUpdates,waitReason,dependencyReadiness,authz}.ts`(authz 는 D18 이전분만), `src/lib/settings/{vocab,defs/project,catalog-meta}.ts`
- 서버: `src/lib/agent/{workflowEvent,stageTransition,depends}.ts`, `src/app/actions/{agentWork,wbs,wbsAssign,issues,vocab,settings}.ts`, `src/lib/data/{issues,portal}.ts`, `src/lib/report/issues/storedRun.ts`·`src/lib/ai/issue-analysis.ts`(D10 범위만), `api/v1/agent/work/*` 의 승인 판정부·거부 문구
- 화면: `src/components/ui/StatusPill.tsx`, `src/components/issues/{IssuesView,IssueModals,IssueUpdates}.tsx`, `src/components/minutes/{MinuteBlockPopover,MinuteInsightCard}.tsx`(칩만), `src/components/portal/MyWorkList.tsx`, `src/components/settings/{VocabEditor,WorkflowSettings,StageCreditSlider}.tsx`, `src/components/wbs/{WbsAssigneeStagePanel,WbsSpecPanel,RowDetailPanel}.tsx`, `src/components/agent-hub/{ApprovalQueue,DelegationTable,labels}.ts(x)`, 좌석표, `src/components/kanban/KanbanBoard.tsx`, 프로젝트 설정 페이지의 '상태·승인' 섹션
- DB·테스트·스크립트: 두 마이그레이션·롤백·리허설, `tests/rls/{issue-workflow,workflow-policy,workflow-parity,h2-postchecks,isolation-map}.ts`, `tests/fixtures/parity/{issue-workflow,workflow}.json`, `scripts/{perf-baseline,e2e-synthetic,e2e-local,ui-capture}.mjs`·`scripts/lib/synthetic.mjs`, `.claude/skills/dflow-work/references/api-contract.md`(주석만)

SP5c 와 겹치는 파일(이슈 모달·WBS 상세 패널·설정 페이지·엑셀 임포트)은 SP5b 가 먼저 끝낸다(개정 §3.8 의존).

### 2.4 UI 위험 파일·트레일러

CLAUDE.md 의 UI 위험 파일(`globals.css`·레이아웃 셋·`src/components/app/*`)은 **건드리지 않는다**. `StatusPill`·보드는 위험 파일 밖이지만 전 화면에 그려지므로 그 커밋에 관례로 `Preview-checked: local <일시> — <화면>` 을 단다(개정 §3.8). 새 색 토큰은 만들지 않는다(D2).

### 2.5 커밋·브랜치

- 브랜치 `sp5b/p0`·`sp5b/i`·`sp5b/w`(각 Phase 체크포인트에서 main 에 ff 병합 — SP5 관례). 스펙·계획은 `sp5b/spec`.
- 마이그레이션은 별도 커밋(G1), `Staging-verified: local db reset <일시>`(G4).
- 계획 문서 `docs/superpowers/plans/2026-10-xx-sp5b-phase-{i,w}.md` 를 Phase 착수 때 쓴다.

---

## 3. DB 계약

### 3.1 공통 규칙

- 새 함수: DEFINER 면 `set search_path to ''`, EXECUTE 는 `revoke … from public, anon, authenticated` 뒤 필요한 역할만(트리거 함수는 EXECUTE 없음). `anon`·`authenticated` EXECUTE 0건(개정 §2.3.2, done_when #7).
- 다른 행·표를 읽어 판정하는 가드는 격리 수준 검사(`25001 <AREA>_ISOLATION`)를 둔다(H2 A6).
- 설정 판정 트리거는 설정 행 `FOR SHARE`, 설정 쓰기 RPC 는 `FOR UPDATE`(§2.4.1). 값 변경 없는 UPDATE 는 잠그지 않는다(B4 관례 — `0023:79-108`).
- 거부는 `raise exception '<TOKEN>[:<detail>]' using errcode = …`, 앱 매핑은 `src/lib/issues/errors.ts`·`src/lib/agent/workflowEvent.ts`·`src/lib/settings/errors.ts`.
- 사후검사 do 블록(마이그레이션 끝)은 기존 관례대로 — 트리거·권한·기본값 패리티 토큰.
- `atomic` 으로 끝나는 식별자 금지(CLI 2.75).

### 3.2 `NNNN_issue_status_vocab`

순서:

1. `issues.status_code text` 추가 → `update issues set status_code = status`(백필 — 채번 트리거 `trg_assign_issue_code` 를 행마다 태우지만 불변식만 본다) → `not null` + `issues_status_code_shape check (status_code ~ '^[a-z][a-z0-9_]{0,19}$')`. DEFAULT 는 두지 않는다(트리거가 채운다). `issues_status_check`(범주)는 그대로.
2. `project_vocab_default('workflow.issue_statuses')` 분기 — 기본 4행 `{code, label(사전 기본 문구), color, category, sort, active}`, code = 범주 code. TS `DEFAULT_ISSUE_STATUSES` 와 패리티.
3. 모양 판독 `issue_statuses_of(p_project)`(DEFINER 내부용) — `project_vocab_of` 꼴에 `category` 검사(4값)·`open`·`resolved` 범주 활성 ≥1·≤20개. 손상 = `CONFIG_INVALID:workflow.issue_statuses` 22023.
4. 트리거 함수 `enforce_issue_workflow()` + `trg_vocab_issue_status`(D4). 판정 표:

| 경우 | 판정 | 오류 |
|---|---|---|
| 공통 | 격리 수준 read committed 아니면 거부. 설정 행 `FOR SHARE`(값 불변 UPDATE 는 건너뜀). 행 없음·모양 손상 fail-closed | `25001 ISSUE_WORKFLOW_ISOLATION` · `P0001 SETTINGS_ROW_MISSING` · `22023 CONFIG_INVALID:workflow.issue_statuses` |
| INSERT, `status_code` null | `status` 가 `open` 이면 `open` 범주 첫 활성(sort)으로 채움. 아니면 거부 | `23514 ISSUE_STATUS_DERIVED` |
| INSERT, `status_code` 지정 | 활성 ∧ 범주 `open` | `23514 ISSUE_STATUS_NOT_INITIAL:<code>` |
| UPDATE, `status_code` 불변·`status` 변경 | 거부 | `ISSUE_STATUS_DERIVED` |
| UPDATE, `status_code` 변경 | 대상이 정의에 있음 ∧ 활성(나가기는 허용) ∧ 범주가 바뀌면 고정 범주 전이표 10간선 안 | `ISSUE_STATUS_UNKNOWN:<code>` · `ISSUE_STATUS_INACTIVE:<code>` · `ISSUE_TRANSITION_DENIED:<from>><to>` |
| UPDATE, `resolved_at` 만 변경 | 거부 | `23514 ISSUE_RESOLVED_AT_DERIVED` |
| UPDATE, `project_id` 변경 | 기존 채번 트리거가 이미 거부(`0020:556-559`) — 이 트리거는 판정하지 않는다 | — |
| 파생 | `new.status := 대상 범주`. `resolved_at`: INSERT null · `resolved` 로 들어오면 now() · `resolved` 안 이동은 유지 · 나가면 null | — |

범주 전이표는 SQL 리터럴(`issue_category_transition_ok(from, to)` immutable)로 두고 TS `STATUS_TRANSITIONS` 와 골든 패리티(§6).

5. 이력 트리거 `trg_issue_status_history`(AFTER UPDATE OF status_code, `old.status_code is distinct from new.status_code`) — `issue_updates(issue_id, project_id, kind='status', body='<from>><to>', author_user_id, author_name)`(D5). 같은 트랜잭션.
6. `settings_ref_check` 를 `create or replace`(0023 본문 전체 + `workflow.issue_statuses` 분기): 사라지는 code 의 참조 이슈 수(reason `removed`), `category` 가 바뀌는 code 의 참조 수(reason `category`) → `23514 SETTINGS_CODE_IN_USE:workflow.issue_statuses` + detail.
7. `project_vocab_ref_count` 에 `issues.status_code` 분기. `migrate_setting_code` 를 `create or replace`(5인자 그대로) — 키 화이트리스트에 `workflow.issue_statuses`, 같은 범주 검사(D3), `set_config('dflow.actor', p_actor::text, true)` 뒤 update(이력 트리거가 작성자를 읽는다).
8. 사후검사: 열·CHECK·트리거 둘·기본값 4행·`settings_ref_check` 분기 존재·EXECUTE 권한.

### 3.3 `NNNN_workflow_policy`

순서(개정 §3.3 + D11~D16·D20):

1. `wbs_items` 에 `review_round integer not null default 0 check (>= 0)`·`review_steps text[]`. 이행: stage ∈ {im, xx} → round 1·steps `{review}`, 나머지 0·null.
2. `wbs_stage_approvals`(개정 §3.3.2 정의 그대로 — 라이브 승인 부분 유일 인덱스). RLS enable + 읽기 정책 `project_id in (select accessible_project_ids())`, 쓰기 정책 없음, `authenticated` 는 SELECT 만.
3. `workflow_setting(p_project uuid, p_key text) returns jsonb`(INVOKER, service_role EXECUTE) — 키 없음·null = 레지스트리 기본값 SQL 리터럴, 행 없음 `SETTINGS_ROW_MISSING`, 모양 손상 `CONFIG_INVALID:<key>` 22023. 대상 키 6개(`workflow.stage_credits` 포함 — D20).
4. `wbs_predecessor_reached(gate, stage, approved, actual, dev_workflow)`(immutable, 개정 §3.3.3 본문) + `wbs_stage_reaches_gate(stage, gate)`.
5. `apply_workflow_event` drop(8인자) + create(9인자, D11). 0012 본문 위에:
   - 주문·항목 `FOR UPDATE` 뒤 라운드를 열거나 승인을 기록하는 사건에서 설정 행 `FOR SHARE`(잠금 순서 주문 → 항목 → 설정).
   - 사건 표는 개정 §3.3.2 그대로 + D15(스냅샷 없는 im·xx = 현재 설정) + D16(사람 xx→im 새 라운드).
   - `approve`·`approve_step`: 대기 단계 ≠ `p_expected_step` → `approval_stale`, 보고 대조(기존), `approval_distinct_approvers` 이고 같은 라운드에 `p_actor` 승인 → `approval_same_actor`. 승인 행 기록. 대기가 남으면 주문 `reported`·stage im·실적 불변, 결과에 `approval:{round, step_code, remaining}`.
   - `set_stage 'xx'` 는 유효 단계 ≥2 면 `approval_required`.
   - `reached_first` = `wbs_stage_reaches_gate(new) and not wbs_stage_reaches_gate(old)`(gate 는 `workflow_setting`).
   - 크레딧 판독 = `workflow_setting(…, 'workflow.stage_credits')`(D20).
   - 격리 검사 `25001 WORKFLOW_EVENT_ISOLATION` 계승(대조·설정 판독 앞).
6. `guard_workflow_columns()` + 트리거(D13).
7. `guard_workflow_actual()` 교체 — 0011 ⑩ 본문 + 단계 절 + `BEFORE INSERT OR UPDATE OF actual_pct`(D14).
8. `settings_ref_check` `create or replace`(직전 마이그레이션 본문 전체 + `workflow.approval_steps` 분기): 대기 라운드(`stage = 'im'` ∧ 라운드 미완)의 스냅샷에 있는 단계를 지우면 거부(reason `pending_round`, 건수), 승인자를 넓히는(`admin` → `subtree_or_admin`) 단계가 대기면 거부(reason `approver_widen`).
9. `drop function set_dependency_waiver(...)`(열 `depends_waived`·정리 트리거는 보존).
10. 사후검사: 시그니처 9인자·격리 문자열·EXECUTE(service_role 만)·트리거 셋·기본값 리터럴 패리티 토큰.

### 3.4 격리 맵·픽스처

`tests/rls/isolation-map.ts` 세 목록 — `A_ROW_FILTER` 에 `wbs_stage_approvals: inAP`, `UPDATE_DENIED_BY_GRANT` 에 같은 표, `tests/rls/fixture-ws.sql` 에 A 행 1개(W-C8). 게이트 매니페스트 `approveWbsStep`(`module: null`, 가드 projectAdmin·completionApprover). `tests/invariants/rpc-actor-source.test.ts` 의 `HELPER_CALLERS['…#apply_workflow_event']` 호출 수를 새 호출과 같은 커밋에서 갱신(W-C9).

### 3.5 리허설·롤백

- 리허설 `supabase/rehearsal/<번호>_issue_status_vocab_smoke.sql`·`<번호>_workflow_policy_smoke.sql`(롤백되는 스모크 — 기본값 동작 불변·5상태 정의·2단계 승인 한 바퀴·롤백→재적용 왕복).
- 롤백 `supabase/rollbacks/<번호>_issue_status_vocab_rollback.sql`: 기본 4 code 밖 `status_code` 가 있거나 `workflow.issue_statuses` 가 설정된 프로젝트가 있으면 raise. 아니면 트리거·함수·열 삭제, `settings_ref_check`·`migrate_setting_code`·`project_vocab_*` 를 0023 본문으로. 이력 행은 남는다(같은 형식).
- 롤백 `…_workflow_policy_rollback.sql`: 2단 이상·`final`·`credit_policy` 설정 또는 대기 라운드가 있으면 raise. 아니면 D12 대상으로 복원, `set_dependency_waiver` 를 기준선 본문·권한으로 되살리고 열·표·함수·트리거 삭제.

---

## 4. 도메인·서버

### 4.1 이슈 표시 상태

- `vocab.ts`: 키 목록에 `workflow.issue_statuses`, 의미 속성 `category`(편집 규칙: 참조가 있으면 바꿀 수 없음 — 서버가 `CONFIG_IN_USE` reason `category` 로 알려 준다), 불변식 `open`·`resolved` 범주 활성 ≥1·≤20개, 기본 4행.
- `issueWorkflow.ts`: `initialStatus`·`allowedTargets(defs, fromCode)`(현재 범주에서 고정 전이표로 갈 수 있는 범주의 활성 상태 + 같은 범주 활성 상태, 자기 제외)·`canTransitionCode`·`categoryOf`(모르는 code → null, 표시 = 로깅).
- `updateIssueProgress`: 정의 로드(실패 = 중단) → `canTransitionCode` 사전 검증 → CAS `status_code` → 트리거 오류 토큰 매핑(`ISSUE_*` 를 `src/lib/issues/errors.ts` 에, `CONFIG_INVALID:<key>` 는 키별 문구 — I-C11). `resolved_at` 계산·이력 insert 삭제(D5·D7).
- 소비처(실측-I ③ 의 "표시"·"둘" 전부): 목록 select 에 `status_code`, 필터 두 층(범주 4칩 + 표시 상태 드롭다운), 모달 선택지, 이력 파서(code 정규식 — 모르는 code 는 code 그대로), 회의록 칩 둘, 포털 '내 담당 이슈'(프로젝트별 정의 맵 — `getProjectVocabs` 꼴), 분석 스냅샷(D10). 대시보드·`issueDashboard`·`sortIssues`·`isOverdue` 등 범주 소비처는 무변경(결정 3).
- 시드 스크립트(`ui-capture.mjs`·`perf-baseline.mjs`)는 insert 뒤 `status_code` update 두 단계로(I-U3 — DB 예외를 늘리지 않는다).

### 4.2 승인 단계

- `approvalSteps.ts`(개정 §3.3.2): `effectiveSteps(item, current)`(D15 규칙)·`nextPendingStep`·`approverOf`(사라진 단계 → `admin`).
- `approveAgentCompletion`: 대기 단계 읽기 → 승인자 가드(D18) → `apply_workflow_event('approve', …, p_expected_step)`. 중간 단계면 `recordReview` 를 쓰지 않고 알림 `work.approval_step`(required)을 다음 단계 승인 자격자에게. 마지막 단계면 현행(`review_action='approve'`·`work.approved`).
- `approveWbsStep(itemId, expectedStep)`(신설, 사람 경로 — 주문 없는 im 항목): 같은 판정, 사건 `approve_step`.
- `setWbsStage`: 유효 단계 ≥2 에서 xx 요청은 앱이 먼저 거부(`approval_required` 문구), DB 도 거부.
- `updateActual`: `actualHundredBlocked({ delegated, orderStatus, stage, reviewSteps, approvalSteps })` + 토큰 `WORKFLOW_APPROVAL_REQUIRED` 매핑.
- `REASON_TEXT` 에 `approval_stale`·`approval_same_actor`·`approval_required`·`config_invalid`, 결과 형에 `approval`.

### 4.3 선행 기준

`predecessorReached(p, gate)`(gate 필수 인자 — tsc 가 호출부를 드러낸다)·`stageReachesGate`. 소비처 5곳(D21): `depends.ts`(select 에 `dev_workflow`, gate 는 `getProjectConfig(pid, { client: admin })`), `stageTransition.ts`(승인 주문 조회 추가), `dependencyReadiness.ts`(서버 페이지가 gate·승인 맵을 `RowDetailPanel` prop 으로), `waitReason.ts`(대기 문구 gate 별, `stageText` 는 해석 라벨), 좌석표(프로젝트별 gate 맵). claim 거부 문구는 gate 별로 생성(응답 키 불변).

### 4.4 크레딧 정책

`DEFAULT_CREDIT_POLICY` 를 `stageCredits.ts` 로, `validateStageCredits(table, policy)`·`clampCredit(…, policy)`. 레지스트리 `parseStageCredits` 의 "비기본 정책 throw" 자리를 정책 주입으로, 두 키 교차 검사는 `validateConfig`. `StageCreditSlider` 가 정책(단위·간격)을 prop 으로.

### 4.5 설정 키 등록

`PLANNED_KEYS` 의 workflow 6키를 `PROJECT_DEFS` 로(module: 이슈 상태 `issues`, 나머지 `wbs`), `CATALOG_META`·사전 KO/EN·`docs/settings-catalog.md` 재생성. 위젯: 이슈 상태 `vocab`, 라벨 `custom`(5칸), 승인 단계 `custom`, 서로 다른 승인자 `boolean`, gate `select`, 크레딧 정책 `custom`(슬라이더와 한 섹션). `agents.stage_workflow` 는 등록하지 않는다(은퇴 — 기존 고정 테스트 유지).

### 4.6 에이전트 프로토콜

응답 키·URL·주문 상태 불변. `depends_evidence[].reached` 값만 gate 반영. `api-contract.md` 표 6·7행·`:166-171` 에 `reached` 주석, `:32` 크레딧 저장 위치 정정. `contract_version` 은 올리지 않는다(개정 §3.4). `tests/skills` 무수정.

---

## 5. 화면

| 화면 | 변경 | Phase |
|---|---|---|
| 설정 '상태·승인' 섹션 | 이슈 표시 상태 목록(`VocabEditor` + 범주 칸·"초기 상태" 표시·사용 중 삭제 → 그 자리 이관) | I |
| 〃 | WBS 단계 라벨 5칸, 승인 단계 1~3(라벨·승인자), 서로 다른 승인자, 선행 기준 라디오(영향 미리보기 "im 선행으로 착수 가능·진행 중인 후속 N건"), 크레딧 슬라이더 + 단위·간격 | W |
| `StatusPill` | 정의를 받는다(D8) | I |
| 이슈 목록·모달·이력·회의록 칩·포털 | 표시 상태 라벨·색, 허용 전이만 선택지, 필터 두 층, "(비활성)" 배지 | I |
| 단계 패널 | 프로젝트 라벨, 단계 ≥2 면 xx 선택지 비활성 + 안내, "승인(1/2 · 내부 검토)" 버튼 | W |
| 결재 대기열·위임 표·좌석표·명세 패널 | "n/m · 라벨", `expectedStep` 동봉, `approval_stale` 이면 새로고침 안내 | W |
| 보드 | '흐름' 보기(D17) | W |
| 서버 문구 | `STAGE_LABEL_KO` 직접 사용 13파일(실측-W ⑧ 3)을 해석 라벨 주입으로 | W |

새 화면 부분은 SP3b 패턴(PageHeader·StatusMessage·SettingsLayout)으로 만들고, 만지지 않는 부분의 패턴 정리는 SPU3(SP5 §8 #10 과 같은 원칙).

---

## 6. 테스트·검증

| 종류 | 내용 |
|---|---|
| 골든 패리티 | `tests/fixtures/parity/issue-workflow.json`(범주 16쌍 × 같은/다른 범주 × 활성/비활성 × INSERT 갈래) · `tests/fixtures/parity/workflow.json`(선행 120 조합 · 크레딧 4표 × 사건 8 · 실적 차단 · 승인 단계 시나리오) — vitest 와 `tests/rls` 가 같은 파일을 읽어 **실행 결과로** 대조(개정 §3.7). 기본값 패리티(`workflow_setting`·`project_vocab_default` = TS 기본값) |
| RLS | `tests/rls/issue-workflow.test.ts`(멤버·관리자 JWT 직접 PATCH·INSERT 허용·거부, `resolved_at`·`status` 직접 쓰기 거부, 이력 행, 격리 25001, 경합: 상태 삭제 vs 그 상태로 생성 → 고아 0, 이관 vs 단건 UPDATE → 40P01 이면 재시도 성공) · `tests/rls/workflow-policy.test.ts`(2단계 승인 한 바퀴, stale 단계·보고, 같은 사람, 반려·재작업·승인취소, xx→im, JWT 관리자 stage·review·dev_workflow·tags 직접 PATCH/INSERT 42501, 실적 100 INSERT, 경합: 같은 단계 동시 승인 정확히 1건) · `isolation-map` |
| 단위 | 도메인 셋(`issueWorkflow`·`approvalSteps`·gate·크레딧 정책), 액션(가드 순서·CAS·오류 매핑·알림 분기), 화면(선택지·필터·배지·'흐름' 열), 레지스트리·카탈로그 동기, 응답 키 스냅샷(claim·GET work — P0) |
| 회귀 | 기본 설정에서 기존 테스트 무수정 통과 — 개정 §3.7 목록 + 이슈 쪽(`tests/domain/{issues,issue-updates,issue-dashboard}`·`tests/actions/{issues-gate,issue-notify}`). 예외는 D11 의 `h2-postchecks` ⑪ 케이스 하나(기계적 수정, 커밋 메시지에 사유) |
| 로컬 E2E | `scripts/e2e-local.mjs` 에 `issue-status-flow`(5상태 정의 → 전이 허용·거부 → 사용 중 삭제 거부 → 이관 → 삭제)·`workflow-approval`(2단계 + `final` — 첫 승인 뒤 후속 claim 403, 둘째 뒤 허용) 단계 |
| 합성 | `S6-issue-status`·`S3-flow`(D24) |
| 성능 | `perf-baseline.mjs workflow` p95 — P0 기준선 대비 ≤ 1.20(done_when #8), 화면 경로 일괄 측정(SP5 방식)도 Z 에서 한 번 |
| 눈확인 | D25 — 설정 '상태·승인'·이슈 목록/모달·단계 패널·결재 대기열·보드 '흐름' × 1440/390 × light/dark |

---

## 7. 완료 조건(done_when)

개정 §3.8 SP5b done_when 1~9 를 이 문서의 결정으로 구체화한다.

1. 설정 키가 없는 프로젝트가 현행과 같다 — §6 회귀 목록 무수정 초록(예외 D11 하나), 현행 고정 패리티(`workflow-parity`)가 개정 전후 초록.
2. 연구 픽스처 이슈 5상태(접수 open·첫 활성 → 검토 open → 고객 승인 on_hold → 실행 in_progress → 종료 resolved, 반려·재개 간선)가 UI 선택지·액션·**PostgREST 직접 PATCH** 세 경로에서 같은 결과, 범주 전이표 밖 이동은 세 경로 모두 거부, 대시보드 카운트는 범주 기준 불변, 세 경로 모두 이력 1행.
3. 2단계 승인 + `final`: 개정 #3 그대로(첫 승인 뒤 주문 `reported`·im·실적 불변·`work.approved` 0·`work.approval_step` 1·후속 claim 거부 / 둘째 뒤 approved·xx·100·`work.approved` 1·후속 허용 / 기본 `reached` 대조 / 같은 사람·stale 거부 / 반려 → 새 라운드 / 2단계에서 `set_stage 'xx'` 직행 `approval_required`, JWT 관리자 stage PATCH 42501 `WORKFLOW_COLUMNS_RPC_ONLY`) + D13 의 `dev_workflow`·`tags` 직접 쓰기 42501.
4. `final`: im 선행 claim 403 `dependency_not_met`·`reached=false`, xx 첫 도달에 `work.unblocked` 1건, 화면 "시작 가능"·대기 사유가 claim 게이트와 같은 판정(D21). `tests/skills` 무수정, 응답 키 스냅샷 불변, 스킬 API 경로 동결 목록 대조 — 명령은 `grep -rhoE 'api/v1/[a-zA-Z_/{}$-]+' .claude/skills | sort -u` 와 P0 에서 고정한 목록(heartbeat 는 `dflow.sh` 의 `$_id` 꼴 포함 — 실측-W ⑤-1).
5. 크레딧 0/20/25/90/100 을 `{step:5, min_gap:5}` 에서 저장·전이, 기본 정책에서 거부. 모양 손상 크레딧 = 22023(D20). TS↔SQL 크레딧 패리티 초록.
6. 사용 중 이슈 상태 삭제는 이관 없이 `CONFIG_IN_USE`(건수), 범주 변경은 사용 0건일 때만, `migrate_setting_code` 는 같은 범주 안으로만·건수 반환·이력 행. 설정 revision 충돌 409.
7. 위임·점유 항목과 유효 단계 ≥2 항목에 JWT 멤버·관리자의 `actual_pct=100` 직접 PATCH·INSERT 42501. 새 함수 `anon`·`authenticated` EXECUTE 0건, `isolation-map` 에 `wbs_stage_approvals`.
8. `apply_workflow_event` p95 가 P0 기준선(`87c6116`) 대비 ≤ 1.20(라운드별 중앙값, `judgeRegression`).
9. 정본 반영 — `docs/settings-catalog.md` workflow 6키 verified·고정 어휘 절, `api-contract.md` `reached` 주석·`:32` 정정, 개정 §6.3 번호 실측 줄.
10. (§5.12.5) `StatusPill` 이 해석된 정의를 받고, 보드 '흐름' 보기 열이 단계 정의(프로젝트 라벨)에서 파생된다.
11. (로드맵 고유) 합성 S3(흐름)·S6(상태) 통과, 로컬 E2E 두 단계 통과, `sp5b-done` 태그.

---

## 8. 사용자 확인 항목

각 항목은 권고 기본값으로 진행한다(사전 승인 규칙 — SP5 §8 과 같음). 다르게 하시려면 그 Phase 착수 전에 말씀해 주시면 된다.

| # | 질문 | 권고 기본값 | 대안 | 바꿀 때 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | 개정이 "SP5 종료 시 판단"으로 남긴 **레버 L3**: SP5b 와 SP5c(사용자 정의 필드)를 동시에 진행할까요? | 순서대로(SP5b → SP5c) — 이슈 모달·WBS 상세·설정 페이지를 둘 다 고친다. 지금은 작업자가 하나라 병렬 이득이 없다 | 병렬(소유 파일 재분할) | 높음 — 파일 충돌 | P0 |
| 2 | 관리자가 앱을 거치지 않고 데이터 API 로 WBS 항목의 단계·에이전트 위임 표시(`tags`)·워크플로 사용 여부(`dev_workflow`)를 직접 바꾸는 길을 막을까요? 앱 화면의 모든 기능은 그대로 됩니다 | 막는다(D13) — 승인을 건너뛴 완료(실적 100)의 남은 우회로 | 단계만 막는다(개정 원안) | 낮음 | W |
| 3 | 이슈 상태를 지울 때 그 상태의 이슈를 옮기는 것은 **같은 범주(열림·진행·보류·해결) 안으로만** 허용할까요? 다른 범주로는 이슈마다 상태를 바꿔야 합니다 | 같은 범주만(D3) — 지난 통계의 뜻이 바뀌지 않는다 | 범주를 넘는 이관 허용 | 중간 — DB 우회 경로·해결일 처리 | I |
| 4 | 이슈 상태가 바뀔 때의 기록(누가 무엇에서 무엇으로)을 **DB 가 자동으로** 남기게 할까요? 지금은 앱 화면에서 바꿀 때만 남고 실패하면 빠질 수 있습니다. 작성자 이름은 프로필 이름을 씁니다 | 자동(D5) | 지금처럼 앱이 남김 | 낮음 | I |
| 5 | 이슈를 칸반 보드로 보는 화면은 이번에 만들지 않고, WBS 보드에 '흐름'(단계별 열) 보기만 더할까요? | 그렇게(D8·D17) | 이슈 보드 신설(+0.3~0.5 노력주) | 중간 | W |
| 6 | 2단계 이상 승인에서 중간 승인 뒤 다음 승인자에게 보내는 알림은 **끌 수 없는 알림**으로 할까요? | 끌 수 없음(개정 — 승인 요청류 관례) | 끌 수 있음 | 낮음 | W |
| 7 | 각 Phase 가 main 에 들어간 뒤 지금 쓰시는 로컬 DB 에 적용할까요? 적용하면 I: 이슈에 상태 code 열이 생기고 기존 이슈는 지금 상태 그대로, W: WBS 항목에 승인 라운드 열·승인 원장이 생기고 기존 동작은 그대로입니다(설정을 바꾸기 전까지) | 그때 묻는다(SP5 §8 #13 과 같음). 0019~0024 적용이 먼저다 | — | — | 각 Phase 뒤 |

---

## 9. 범위 제외·이월

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| 프로젝트별 전이 그래프 편집기·역할/capability 설정·`preventSelfApproval`(AUTH-07b)·스크립트·수식 | 비목표(개정 §6.2 SP5b 범위 제외) | 이미 있음 |
| 이슈 보드 | 미정(필요해지면 SPU2 와 함께) | §8 #5 |
| 보드 카드 이동 메뉴·드래그 정리 | SPU2(그리드·보드 통합) | SPU2 블록에 한 줄 |
| 알림 `issue.status` 발행 | 비목표(D9) — 필요하면 SP8 알림 정책과 | SP8 블록에 한 줄 |
| AI 색인 이슈 상태 라벨·재색인 | SP8 | SP8 블록에 이미 있는 이슈 재색인 줄에 덧붙임 |
| 카탈로그 `status_code`·`status_label` 렌더 | SP6 | 이미 있음(개정 §2.11 SP6) |
| `api-contract.md` v2.5 절이 `reached` 주석 흡수·스튜디오 결재 단계 표시 | SP7 | 이미 있음 |
| 색 체계 이행(개정 7색 토큰) | 디자인 SP(UI-3 계열) | 개정 §8.1 에 한 줄 |
| 옛 `import_wbs`·`replace_wbs`·`import_wbs_upsert` 의 authenticated 실행권 회수 | SP9 출시 점검(이미 이월, CLAUDE.md 권한 절) — D13 뒤에는 관리자 JWT 가 이 RPC 로 stage 가 있는 행을 넣으면 42501 로 깨진다(앱은 service_role 이라 무관) | SP9 블록 줄에 덧붙임 |

---

## 10. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| K1 | `apply_workflow_event` 재작성 회귀(가장 큰 RPC, 에이전트·사람 경로 공용) | P0 의 현행 고정 패리티·응답 키 스냅샷을 먼저, 골든 행렬로 실행 결과 대조, 기본 설정 회귀 무수정 |
| K2 | 설정 행 `FOR SHARE` 추가로 교착(주문 → 항목 → 설정 순서) | 잠금 순서 고정, 설정 저장 RPC 는 참조를 세기만, 경합 테스트(같은 단계 동시 승인·단계 삭제 vs 승인) |
| K3 | gate 배선이 클라이언트·다프로젝트까지 — 누락 시 화면과 게이트 불일치 | `predecessorReached` gate 필수 인자(tsc), 5곳 단위 테스트, E2E 대조 |
| K4 | 이슈 트리거가 기존 쓰기(시드·리허설·롤백 재삽입)를 깨뜨림 | 시드 두 단계화(§4.1), 리허설 `status` 생략 확인, 0020 롤백은 0025+ 롤백 뒤에만 |
| K5 | 성능 — 트리거 셋(설정 `FOR SHARE`·이력 insert)과 RPC 의 설정 판독 | P0 기준선, 화면 경로·RPC 둘 다 ≤ 1.20, 넘으면 개정 §2.4.1 의 advisory 잠금 대안 |
| K6 | D13 이 관리자 직접 API 작업을 막는다 | §8 #2, 앱 경로 전수(실측-W ④-1)가 service_role 임을 테스트로 고정 |
