# SP5b — 업무 흐름 설정화(이슈 표시 상태 · WBS 승인 단계 · 선행 기준 · 크레딧 정책) 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-04 |
| 상태 | **확정 — 비평 셋·판정 S1~S26 반영, 2026-10-04**. 비평 `.superpowers/sp5b/critique-{feasibility-scope,fidelity,db-security}.md`(F-1~F-22·V-1~V-22·B-1~B-26), 판정 `.superpowers/sp5b/rulings.md`(S1~S26 — 구속). 판정이 바꾼 행에는 "비평 반영 — Sn" |
| 상위 정본 | 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §2.3.4(오류 코드)·§2.4.1·§2.4.2·§2.5(fail-closed·세션 없는 경로)·§2.8.2 `workflow.*` 6행·§2.8.6·§2.11 SP5b 행·§3.0~§3.8·§5.9.2·§5.9.3·§5.12.5 SP5b 행·§6.2 SP5b 블록·§6.2.0 H1 과제 11·15·H2 구현 결과 A6·B1·§6.5.7·§6.5.8. 정본 `2026-09-23-generic-platform-design.md` 5.3.4·6.6(에이전트 프로토콜 동결). SP5 확정 스펙 `2026-10-02-sp5-calendar-issues-minutes-design.md`(이하 "SP5 Dn") — D58(어휘 이관 두 명령)·§3.6·§4.9·§9 SP5b 행 |
| 선행 | `sp5-done`(main `87c6116`) — B4 어휘 인프라(`0023_vocab_settings`)와 SP3a 의 `apply_workflow_event` 판(`0012_settings`) 위 |
| 마이그레이션 | **둘** — 개발 중 파일명 `NNNN_issue_status_vocab`(Phase I)·`NNNN_workflow_policy`(Phase W1). 번호는 main 머지 직전(SP4 D12 — 지금 순서면 `0025`·`0026`). 테스트·리허설은 접미로 찾는다 |
| 실측 근거 | 2026-10-04 읽기 전용 사전 실측 `.superpowers/sp5b/survey-issues.md`(이하 "실측-I")·`survey-wbs.md`(이하 "실측-W"). file:line 은 `87c6116` 기준, 착수 때 심볼로 다시 찾는다 |

읽는 순서: 사용자는 **§8 을 먼저** 읽는다. 표기 — "D n" 이 문서의 결정, "E n" 상위 문서 대비 정정, "S n" 판정, "K n" 리스크, "개정:줄" 상위 줄, "I-Cn/W-Cn·I-Un/W-Un" 실측 번호.

## 목차

1. 전제와 결정 — 1.1 구속하는 결정 · 1.2 결정(D) · 1.3 상위 대비 정정(E) · 1.4 범위 표
2. Phase 구성 — 2.1 Phase 표 · 2.2 노력 추정 · 2.3 소유 파일 · 2.4 UI 위험 파일·트레일러 · 2.5 커밋·브랜치·배포 순서
3. DB 계약 — 3.1 공통 규칙 · 3.2 `NNNN_issue_status_vocab` · 3.3 `NNNN_workflow_policy` · 3.4 오류 토큰 표 · 3.5 격리 맵·매니페스트 · 3.6 리허설·롤백
4. 도메인·서버 — 4.1 이슈 표시 상태 · 4.2 승인 단계 · 4.3 선행 기준 · 4.4 크레딧 정책 · 4.5 설정 키 등록 · 4.6 에이전트 프로토콜 · 4.7 호환 규칙
5. 화면
6. 테스트·검증 — 6.1 종류별 · 6.2 의도적 수정 표 · 6.3 고정 테스트 갱신 표
7. 완료 조건(done_when)
8. 사용자 확인 항목
9. 범위 제외·이월
10. 리스크
11. 정본 반영 목록

---

## 1. 전제와 결정

### 1.1 구속하는 결정

- **사용자 결정 1(2026-09-26)** 업무 흐름은 설정화 — 고정은 시스템 의미 범주(이슈 4범주·WBS `as/ip/im/xx`·주문 5상태)와 에이전트 프로토콜뿐. **결정 3** 집계·위험·완료 판정은 어떤 설정으로도 바뀌지 않는다. 스크립팅 없음(W2).
- 개정 W1(행은 범주와 표시 상태 둘 다)·W3(WBS 는 같은 범주 복수 표시 상태 없음 — 승인 단계로)·W4(설정은 권한을 넓히지 않는다)·W5(승인 0단계 없음 — `approved` 는 머지 조건).
- SP5 D58 — 어휘 code 이관은 `migrate_setting_code` 와 일반 설정 저장의 두 명령(개정 §2.4.2 의 한 명령·revision CAS 판을 대체).
- 에이전트 프로토콜 동결 — URL 11개·응답 키·주문 상태·`depends_evidence[].reached` 키·타입 불변.
- CLAUDE.md — 판정 위치 두 곳, 가드 넷, `p_actor` = 가드 결과 `actor.userId`, 마이그레이션·코드 분리 커밋, 에러 처리 3원칙.

### 1.2 이 SP 의 결정

**이슈 표시 상태(Phase I)**

| # | 결정 | 근거 |
|---|---|---|
| D1 | `workflow.issue_statuses` 는 **B4 어휘 계열의 여섯째 키** — 엄격 parse·라벨 사전 규약·색 토큰·편집기(`VocabEditor`)·`settings_ref_check` 어휘 분기·`migrate_setting_code` 재사용. 의미 속성 `category ∈ {open, in_progress, resolved, on_hold}`(`attendance.types.counts_as` 와 같은 "참조 있으면 못 바꾸는 속성"). 전이 판정(`initialStatus`·`allowedTargets`·`canTransitionCode`·`categoryOf`)만 순수 모듈 `src/lib/domain/issueWorkflow.ts` | 실측-I ⑦·I-U1. 개정의 `issueWorkflow.ts` 별도 어휘 모듈(개정:1196)은 판정 함수만 남긴다 |
| D2 | 라벨 **필수 문자열**, 기본 code·기본 라벨이면 사전 문구(`issue.status.<code>`). 색은 `VOCAB_COLORS`, 기본값은 현 칩 색(open=delayed·in_progress=progress·resolved=done·on_hold=neutral) | **상위와 다름** — 개정 `label: string\|null`·7색(개정:1161). `action` 은 `-weak` 짝이 없어 칩이 안 된다(I-C5·I-C6). 색 체계 이행은 디자인 SP(§9) |
| D3 | `migrate_setting_code` 는 **B4 5인자 계약 유지**(설정 행 `FOR UPDATE` 먼저 → 참조 update → 건수 반환, revision·`p_command_id`·`p_remove_from` 없음) + `workflow.issue_statuses` 분기. 이슈 분기는 **같은 범주 안으로만**(다르면 `SETTINGS_CODE_CATEGORY_MISMATCH`). 삭제 = 이관 → 일반 저장의 두 명령 | **상위와 다름 — E15**(개정:618-619 "의미 변경의 유일한 경로"·:1176 GUC 우회·:1188 을 좁힌다). 이유: ① 범주 전이표를 우회하는 DB 경로를 두지 않는다 ② `resolved_at` 진입·이탈을 대량 경로에 재구현하지 않는다 ③ 이력이 개별 전이와 같은 꼴. 범주를 넘는 일괄 이동은 SPU3 대량 변경으로(§9). 비평 반영 — S15 |
| D4 | DB 판정 트리거 `trg_vocab_issue_status`(`BEFORE INSERT OR UPDATE OF status, status_code, resolved_at`, DEFINER·`search_path ''`) — 개정 §3.2.2 표 + ① 격리 가드 `25001 ISSUE_WORKFLOW_ISOLATION` ② `resolved_at` 은 트리거만 정한다(직접 쓰기 거부, **service_role 포함**) ③ 명시값이 파생값과 다르면 거부, 조용히 덮지 않는다(INSERT 의 `status` 가 'open' 이 아닌데 `status_code` 없음·`status_code` 와 다른 범주의 `status` 동봉) ④ from 범주는 `old.status` | I-C9·I-C10·I-C15, 비평 반영 — S26(B-14·B-15·V-18). 대시보드 해결 7일 KPI 가 `resolved_at` 을 믿는다. DEFAULT 'open' 이 트리거 전에 채워지므로 "생략"과 "명시 open" 은 같은 뜻 |
| D5 | 상태 이력 `issue_updates(kind='status')` 는 **AFTER UPDATE 트리거**가 쓴다(DEFINER·`search_path ''`·`WHEN (old.status_code is distinct from new.status_code)`). 작성자 = `auth.uid()` → 없으면 GUC `dflow.actor`(`nullif(…,'')` + uuid 정규식, 틀리면 null) → null. 이름 = GUC `dflow.actor_name` → `profiles.display_name` → '(이름 없음)'. 액션의 별도 insert 는 지운다 | I-C19·I-U7·I-U8, 비평 반영 — S5(B-3·B-4). 세 경로(액션·PATCH·이관)가 같은 이력을 원자적으로. 작성자 이름 출처가 `user_metadata`→`profiles` 로 바뀐다(이메일 폴백 소멸 — 수용) |
| D6 | `updateIssueProgress` patch 필드 이름 `status`·`expectedStatus` 유지, 값의 뜻만 "표시 상태 code"(타입 별칭 `IssueStatusCode`·JSDoc 로 드러낸다). CAS `.eq('status_code', expected)`. 선조회 오류 미확인(`:1101`) 수정 | 액션·UI 테스트 5파일 수정을 피한다(개정 회귀 목록 밖 — 비평 반영 — S26 V-10) |
| D7 | `nextResolvedAt`·`canTransition`(범주 전이표 판정) **남긴다** — 트리거·`issueWorkflow` 의 TS 오라클, 액션은 더 쓰지 않는다 | I-C7, 비평 반영 — S26(V-11). **상위와 다름**(개정:1211 "삭제·대체") |
| D8 | 이슈 보드는 만들지 않는다. `StatusPill` 은 **유니언 props**(`{ status }` 기존 WBS 일정 상태 \| `{ def: { id, label, category?, tone, icon } }`) — 이슈 칩 넷(`IssuesView`·`IssueModals.StatusChip`·회의록 둘)과 포털은 `def` 를 넘긴다. 이슈 칩 모양은 바뀐다(점 → 범주 아이콘 + weak 배경, 색만으로 전달하지 않는다 — 개정 §5.5.4) | I-C14·I-C17, 비평 반영 — S23(F-14·V-14). 모양 변화는 의도 — 눈확인 트레일러 |
| D9 | 알림 `issue.status` 발행은 시작하지 않는다 | I-C12. **상위와 다름**(개정:1225) |
| D10 | 분석 스냅샷 B4 규약(기본 정의면 글자까지 동일), AI 색인 본문 code 유지 | I-U10·I-U11. **상위와 다름**(개정:1224 색인 라벨 — SP8 로, E16) |

**WBS 흐름(Phase W1·W2)**

| # | 결정 | 근거 |
|---|---|---|
| D11 | `apply_workflow_event` 출발점 = **`0012_settings.sql:229-466`** 본문. `p_expected_step text default null` 을 **9번째**로 — drop(8인자) + create + `revoke … from public, anon, authenticated` + `grant execute … to service_role`, 한 트랜잭션. `c_default` 상수는 본문에 남긴다 | W-C2·W-C3. 깨지는 테스트는 §6.2 의도적 수정 표(비평 반영 — S1) |
| D12 | 롤백 복원 = 0012 본문 바이트 그대로·8인자·권한, `guard_workflow_actual` = `0011:918-943` 본문 + 트리거 정의(`before update of actual_pct`) | W-C2, 비평 반영 — S10(B-12) |
| D13 | `guard_workflow_columns` — JWT 세션(`auth.uid() is not null`)의 `stage`·`review_round`·`review_steps`·`dev_workflow`·`tags` 쓰기 42501 `WORKFLOW_COLUMNS_RPC_ONLY`. INSERT 허용 = `stage is null ∧ review_round = 0 ∧ review_steps is null ∧ dev_workflow = false ∧ coalesce(cardinality(tags),0) = 0` | **개정:3684(H2 이월) 이행** — 다문장 우회(dev_workflow·태그 끄기 → 100 → 켜기)를 닫는다. 개정 §3.3.2 코드 블록(stage·review 만)을 이 범위로 넓힌다. 앱 JWT 쓰기는 다섯 열을 쓰지 않는다(실측-W ④-1). `tags` 기본은 null(`0000:6972`). 비평 반영 — S7·S17 |
| D14 | `guard_workflow_actual` 재작성 순서: 값 불변·≤99 통과 → **`old.stage = 'im'` ∧ 유효 단계 ≥2 → `WORKFLOW_APPROVAL_REQUIRED`(dev_workflow 무관)** → `dev_workflow` 아니면 통과 → 0011 잠금 절(태그 → 격리 → 주문) → 비 xx ∧ 유효 단계 ≥2 → APPROVAL_REQUIRED. 설정 판독은 `FOR SHARE`(격리 검사 뒤). 트리거 `BEFORE INSERT OR UPDATE OF actual_pct` — INSERT 갈래는 `new.*` 로 따로 | 비평 반영 — S4(B-2)·S26(B-22). 서버 경로로 `dev_workflow` 를 꺼도 im 대기 라운드의 실적 100 은 막힌다 |
| D15 | 유효 단계 규칙 하나: stage ∈ {im, xx} **이고 스냅샷이 있으면** 스냅샷, 그 밖(스냅샷 없음 포함)은 현재 설정. 스냅샷 없는 im·xx 행(서비스 가져오기)에 승인·`unapprove`·xx 지정이 오면 RPC 가 **먼저 라운드를 연다**(`review_round := 1`, `review_steps := 현재 설정`, 설정 `FOR SHARE` 아래) | **상위와 다름** — 개정 §3.3.5 `coalesce(cardinality(review_steps),1)` 와 §3.3.2 의 불일치 해소. `import_wbs_upsert` 무변경. 비평 반영 — S14(V-4) |
| D16 | 사람 `set_stage` 의 `xx → im` 은 새 라운드(개정:1334 그대로) + **옛 라운드 승인 철회**(`stage_reset`) | W-U5, 비평 반영 — S26(V-12) |
| D17 | 보드 '흐름' 보기는 **SPU2 로 이월**(카드 이동 메뉴와 함께). §5.12.5 ②(보드 열 파생)는 SPU2 done_when 으로 옮긴다 | **상위와 다름** — 개정:1475·3038·3269. 로더·딥링크·AI 도구 배선(1~1.5h)을 이동 메뉴와 한 번에. 비평 반영 — S16(V-6·F-15·F-19). §8 #4 로 확인 |
| D18 | 승인 판정: 액션이 대기 단계를 읽고 `approverOf` 가 `admin` 이면 `requireProjectAdmin`, `subtree_or_admin` 이면 `requireCompletionApprover` → `p_expected_step` CAS. **사람 경로 xx 지정(`setWbsStage(…,'xx')`)도 같은 판정**을 거친다. RPC 는 설정 `FOR SHARE` 아래 대기 단계 approver 가 `admin` 이면 `actor_is_project_admin(p_actor, project)` 재판정(아니면 `approval_forbidden`). 원장에 `via ∈ {approve, approve_step, set_stage}`. 화면용 `canApproveCompletion` 은 `src/lib/domain/authz.ts` 로 옮기고 `seatmap.ts` 는 재수출, 재료 `{ pendingStepApprover, approvedThisRound }` 추가 | 비평 반영 — S3(B-1·B-10·B-19)·S20(F-11·F-18). 기본 1단계에서도 사람 xx 직행이 자기 승인 금지(AUTH-07a)를 받는다 — 현행 동작 변화 → §8 #3 |
| D19 | `approveWbsStep` 모듈 관문 없음(`module: null` — `wbs` 는 core, 개정 표기 "모듈 wbs" 와 의미 같음). `approveAgentCompletion` 은 `agents` 그대로 | W-U10, 비평 반영 — S26(V-13) |
| D20 | 크레딧 SQL 판독 fail-closed — 키 없음·JSON null = `c_default`(현행), **모양 손상 = `CONFIG_INVALID:workflow.stage_credits` 22023**. 판독은 값 받는 헬퍼(`workflow_value_of(values, key)` — 행은 호출부가 한 번 읽는다) | W-C12·W-U2, 비평 반영 — S26(B-20). **상위와 다름**(개정 §3.3.4 "재검증 안 함"). 마이그레이션 사전 검사(S8)가 기존 손상 값을 적용 시점에 드러낸다 |
| D21 | 선행 gate 는 소비처 5곳 모두 같은 입력 `{ stage, orderApproved, actualPct, devWorkflow }` 로 — 새 이름 `predecessorReachedFor(p, gate)`(gate 필수). `RowDetailPanel` 숙주 둘(`WbsGanttSheet`·`AgentHubView`)에 gate·승인 재료 배선. `agents` 모듈이 꺼진 프로젝트는 승인 축 = false(꺼진 모듈 표를 읽지 않는다 — claim 게이트도 닫혀 있어 불일치 없음). 좌석표는 프로젝트별 gate 맵 | W-C19·W-U8, 비평 반영 — S1(F-4)·S22(F-13) |
| D22 | 성능: P0 는 `perf-baseline.mjs workflow` 명령(pg 직결, 사건 순환)과 두 스키마 스모크만. 실측은 **Z 에서 `87c6116` worktree 와 같은 세션 A/B**(RPC·화면 둘 다, SP5 방식) | 비평 반영 — S11(F-6) |

**공통**

| # | 결정 | 근거 |
|---|---|---|
| D23 | Phase **P0 → I → W1 → W2 → Z**. 마이그레이션 번호도 I → W1 순 | I-U16, 비평 반영 — S12(F-7) |
| D24 | 합성 게이트 SP5b 몫: **S1**(R 에 `workflow.issue_statuses` 5행·`approval_steps` 2단·`predecessor_gate='final'`·`credit_policy {5,5}`·`stage_credits` 0/20/25/90/100 을 설정 액션으로, C 는 키 없음) · **S3-flow**(R 2단계 승인 + `final`, C 기본) · **S6-issue-status**(R 5상태 흐름) · **S9**(R 상태 하나 비활성·단계 라벨 개명 뒤 C 의 판정·출력 불변). `PENDING_STEPS.S3 = 'SP5c(필드)'`. 합성 C 크레딧은 키 없음(기본)으로 | 비평 반영 — S18(V-8), W-C11 |
| D25 | 눈확인은 에이전트 스크린샷(1440·390 × light·dark, 다크는 계정 선호까지)으로, `docs/baseline/sp5b-ui.md` | SP5 D31·B2 재촬영 교훈 |
| D26 | 설정 키 `impact`·`apply` 는 개정 §2.8.2 값 그대로, 영향 미리보기는 `IMPACT_PREVIEW` 서버 계산(실패면 수치 없이 문구), '상태·승인' 저장은 SP3a 공용 저장 바(섹션 `expectedRevision`, 409 비교) | 비평 반영 — S26(V-15) |

### 1.3 상위 문서 대비 정정(실측)

| # | 상위 서술 | 실측 | 처리 |
|---|---|---|---|
| E1 | 번호 `0020_workflow_policy`·`0021_issue_status_vocab`(개정:1150·1265·1699·3667·3844-3845) | `0020`=`issue_areas`, `0021`=`attachments`, 다음은 0025(개정:3851) | 접미 이름, 번호는 머지 직전 |
| E2 | `apply_workflow_event` 기준선 `0000:731-944`, `c_default :735`·잠금 `:887-893`·첫 도달 `:916` | 살아 있는 본문 `0012:229-466`, `c_default 0012:233`, 잠금 `0012:404-411`, 첫 도달 `0012:438` | D11·D12 |
| E3 | `migrate_setting_code` 8인자·이슈 행 먼저 잠금(개정:1188) | 5인자·설정 행 먼저(`0023:225-263`), 교착은 액션 40P01 재시도 | D3 |
| E4 | 오류 `CONFIG_IN_USE` | DB 토큰 `SETTINGS_CODE_IN_USE:<key>` → 앱 `CONFIG_IN_USE` | detail reason `category`·`pending_round`·`approver_widen` 추가 |
| E5 | 이슈 보드 열 파생·`KanbanBoard.tsx:28,122,337` | 이슈 보드 없음 — `KanbanBoard` 는 WBS 일정 상태 전용 | D8·D17 |
| E6 | `StatusPill` 이 이슈 표시 상태를 받는다 | WBS 일정 상태 전용, 이슈 칩은 4곳 손 칩 | D8 |
| E7 | 알림 `issue.status` 본문 라벨 | 발행 0 | D9 |
| E8 | 소비처 표(개정:1213-1227) | 회의록 칩 둘·포털 누락(`MyWorkList.tsx:22` 는 지금도 원 code 출력) | 실측-I ③ 전수표가 정본 |
| E9 | `getProjectConfig` 0행 throw 신설(`src/lib/data/projectConfig.ts:35`) | 이미 있다 — `src/lib/settings/projectConfig.ts:99` | PAT 경로에 `{ client: admin }` 만 |
| E10 | 다수 file:line(실측-W C-7) | 이동 | 심볼로 인용 |
| E11 | `api-contract.md:26-29,164-168` | `:26-27,29-30,166-171`, `:32` 크레딧 저장 위치 서술은 틀림 | 주석 + `:32` 정정 |
| E12 | `tests/skills` 16파일 | `*.test.ts` 16개 — 일치 | — |
| E13 | 합성 R 0/20/25/90/100(개정:4040) | R 0/20/30/90/100·C 0/10/20/80/100 | D24 |
| E14 | `agentWork.ts:31` "`tests/migrations/0096` 이 대조" | `tests/rls/workflow-parity.test.ts` | P0 에서 주석 정정 |
| E15 | 범주 넘는 이관(개정:618-619·1176·1188) | — | D3 — 같은 범주만 |
| E16 | AI 색인 상태 라벨(개정:1224) | 색인 본문 `상태: <code>`(`content.ts:294-308`) | D10 — SP8 |
| E17 | 범주 전이표 "10간선" 류 서술 | `issues.ts:60-65` 는 **11간선**(`resolved→on_hold` 만 없음) | 골든이 11간선을 고정 |
| E18 | 경로 동결 대조 정규식(개정:1708) | heartbeat 는 `dflow.sh` 의 `$_id` 꼴이라 상위 정규식에 안 잡힌다 | done_when #4 — 상위 명령 = 정본 목록 대조 + 넓힌 정규식 = P0 고정 목록 대조 둘 다(비평 반영 — S25) |

### 1.4 범위 표

| 포함 | Phase |
|---|---|
| 측정 명령·두 스키마 스모크, 에이전트 응답 키 스냅샷(claim·GET work)·스킬 API 경로 목록 고정, `agentWork.ts:31` 주석 | P0 |
| `workflow.issue_statuses`, `issues.status_code`, 판정·이력 트리거, 이관 분기, 소비처(목록·모달·이력·회의록 칩·포털·분석 스냅샷), `StatusPill` 유니언, 이슈 상태 편집기 | I |
| `wbs_items.review_*`, `wbs_stage_approvals`, `apply_workflow_event` 재작성, `guard_workflow_columns`·`guard_workflow_actual`, `workflow_value_of`·`wbs_predecessor_reached`, `set_dependency_waiver` 삭제, `approvalSteps.ts`, 승인 액션 셋(`approveAgentCompletion` 다단계·`approveWbsStep`·`setWbsStage` xx 판정), 레지스트리 workflow 5키, 단계 패널·결재 대기열 최소 표시 | W1 |
| gate 주입 5곳·숙주 둘, 크레딧 정책 주입(슬라이더), 승인 가능 셈(결재 배지·포털·좌석표·위임 표·명세 패널), 단계 라벨 주입, 설정 '상태·승인' WBS 몫, 계약 문서 주석 | W2 |
| 합성 S1·S3·S6·S9, 성능 A/B, 카탈로그 verified, 원장·HANDOFF·정본 반영(§11), `sp5b-done` | Z |

---

## 2. Phase 구성

### 2.1 Phase 표

| Phase | 내용 | 마이그레이션 | 체크포인트 |
|---|---|---|---|
| **P0** | `perf-baseline.mjs workflow`(87c6116·후보 두 스키마에서 도는 스모크), 응답 키 스냅샷 테스트, 스킬 경로 목록(`tests/fixtures/agent-api-paths.json` + 대조 테스트), 주석 정정 | 없음 | 단위 초록·두 스키마 스모크 |
| **I** | 순수 계약(`vocab.ts` 6번째 키·`issueWorkflow.ts`) → `NNNN_issue_status_vocab`(+롤백·리허설·RLS·골든) → 레지스트리·액션·이관 분기·오류 토큰 → 소비처·`StatusPill` → 편집기 → 검증 | 1 | db reset·RLS·단위·build·실앱 5상태 흐름·눈확인 → main |
| **W1** | 순수 계약(`approvalSteps.ts`·`predecessorReachedFor`·크레딧 정책) → `NNNN_workflow_policy`(+롤백·리허설·RLS·골든·경합) → 레지스트리 5키 → 승인 액션 셋 → 단계 패널·결재 대기열 최소 표시 → 검증 | 1 | db reset·RLS·패리티·단위·build·E2E `workflow-approval` → main |
| **W2** | gate 주입·크레딧 주입·승인 가능 셈·라벨 주입·설정 화면 WBS 몫·승인 화면 넷 | 없음 | 단위·build·실앱 2단계 승인 화면·눈확인 → main |
| **Z** | 합성 S1·S3·S6·S9, 성능 A/B(D22), 카탈로그 verified, 계약 문서, 원장(`sp5b-{e2e,ui,effort,perf}.md`·`synthetic-acceptance.md`)·HANDOFF·§11 정본 반영·CLAUDE.md 권한 절, `sp5b-done` | 없음 | 전체 검증 |

### 2.2 노력 추정

| 근거 | 값 |
|---|---|
| 개정 §6.2 | 2.5주(2~3) |
| 실측-I ⑦·실측-W ⑧ | 이슈 사람 기준 4~6일, WBS 7~10일 |
| SP5 클라우드·단일 세션 실측(`docs/baseline/sp5-effort.md`) | A 10.0h·B1 6.3h(트리거+화면+E2E)·B4 1.3h·B2 2.3h |

**추정**(비평 반영 — S12): P0 1~1.5 · I 3~5 · W1 5~7.5 · W2 3~4.5 · Z 1.5~2.5 = **13.5~21 에이전트 시간 ≈ 1.4~2.2 노력주**(9.4h/노력주, 단일 세션, 독립 리뷰 없음). W 는 A·B1 이 비교 기준이다(가장 큰 RPC 재작성·골든 행렬·경합·새 E2E 하네스 — `e2e-local.mjs` 에 claim→승인 흐름이 없다). 개정 2.5주보다 작은 것은 B4(이슈 인프라)·H1·H2(대조·격리·잠금 절)가 앞서 했기 때문이다.

### 2.3 소유 파일

- 도메인: `src/lib/domain/{agentWork,stageCredits,stageLabels,issues,issueWorkflow,approvalSteps,issueUpdates,waitReason,dependencyReadiness,approvable,seatmap,authz}.ts`(seatmap·authz 는 D18 이전분), `src/lib/settings/{vocab,defs/project,catalog-meta,errors}.ts`
- 서버: `src/lib/agent/{workflowEvent,stageTransition,depends}.ts`, `src/app/actions/{agentWork,wbs,wbsAssign,issues,vocab,settings}.ts`, `src/lib/data/{issues,portal,agentApprovals}.ts`, `src/app/api/shell/route.ts`(결재 배지), `src/lib/report/issues/storedRun.ts`·`src/lib/ai/issue-analysis.ts`(D10 범위), `api/v1/agent/work/*` 승인 판정부·거부 문구
- 화면: `src/components/ui/StatusPill.tsx`, `src/components/issues/{IssuesView,IssueModals,IssueUpdates}.tsx`, `src/components/minutes/{MinuteBlockPopover,MinuteInsightCard}.tsx`(칩만), `src/components/portal/MyWorkList.tsx`, `src/components/settings/{VocabEditor,WorkflowSettings,StageCreditSlider}.tsx`, `src/components/wbs/{WbsAssigneeStagePanel,WbsSpecPanel,RowDetailPanel,WbsGanttSheet,shared}.tsx`(라벨·숙주 배선만), `src/components/agent-hub/{ApprovalQueue,DelegationTable,AgentHubView,labels}.ts(x)`, `src/components/agents/seatOps.ts`, 좌석표, 프로젝트 설정 '상태·승인' 섹션
- DB·테스트·스크립트: 두 마이그레이션·롤백·리허설, `tests/rls/{issue-workflow,workflow-policy,workflow-parity,h2-postchecks,h2-report-stale,isolation-map}.ts`·`fixture-ws.sql`, `tests/fixtures/parity/{issue-workflow,workflow}.json`, `scripts/{perf-baseline,e2e-synthetic,e2e-local,ui-capture}.mjs`·`scripts/lib/{synthetic,perf}.mjs`, `.claude/skills/dflow-work/references/api-contract.md`(주석만)

SP5c 와 겹치는 파일은 SP5b 가 먼저 끝낸다(§8 #1).

### 2.4 UI 위험 파일·트레일러

CLAUDE.md UI 위험 파일은 건드리지 않는다. `StatusPill` 과 이슈 칩 모양 변화(D8)는 전 화면에 그려지므로 그 커밋에 `Preview-checked: local <일시> — <화면>` 을 단다. 새 색 토큰은 만들지 않는다.

### 2.5 커밋·브랜치·배포 순서

- 브랜치 `sp5b/p0`·`sp5b/i`·`sp5b/w1`·`sp5b/w2`, 각 체크포인트에서 main 에 ff 병합(SP5 관례). 계획 문서 `docs/superpowers/plans/2026-10-xx-sp5b-phase-{p0,i,w1,w2}.md` 는 Phase 착수 때.
- 마이그레이션은 별도 커밋(G1)·`Staging-verified: local db reset <일시>`(G4).
- 배포 순서(비평 반영 — S26 B-26): I 마이그레이션 뒤 구 앱의 `updateIssueProgress`(`status`·`resolved_at` 패치)는 `ISSUE_STATUS_DERIVED` 로 실패한다 — 원격 배포가 생긴 뒤에는 마이그레이션과 코드가 같은 배포 단위여야 한다. `apply_workflow_event` 는 이름 인자라 구 앱·새 DB 호환(새 앱·구 DB 는 PGRST202).

---

## 3. DB 계약

### 3.1 공통 규칙

- 새 함수: DEFINER 면 `set search_path to ''`, EXECUTE 는 `revoke … from public, anon, authenticated` 뒤 필요한 역할만(트리거 함수는 EXECUTE 없음). `anon`·`authenticated` EXECUTE 0.
- 격리 수준 가드(`25001 <AREA>_ISOLATION`)는 **잠금 아래 다른 행을 읽어 판정**하는 곳에만(H2 A6). 값만 읽는 사건은 제외(비평 반영 — S9).
- 설정 판정 트리거는 설정 행 `FOR SHARE`, 설정 쓰기 RPC 는 `FOR UPDATE`(§2.4.1). 트리거 내부 순서는 0023 관례 — 값 불변이면 즉시 반환 → `FOR SHARE` → 격리 검사 → 판정(비평 반영 — S26 B-16).
- 설정 판독은 **값 받는 헬퍼**(`project_vocab_of(values, key)` 꼴) — 행은 호출부가 한 번 읽는다(B-20).
- 거부는 `raise exception '<TOKEN>[:<detail>]' using errcode = …`, 앱 매핑은 `src/lib/settings/errors.ts` TOKENS **한 곳**(개정 §2.3.4 — 비평 반영 — S13). 표는 §3.4.
- 사후검사 do 블록, `atomic` 접미 금지.

### 3.2 `NNNN_issue_status_vocab`

1. **사전 검사**: 모든 프로젝트의 `workflow.issue_statuses` 값(있으면)이 SQL 모양 검사를 통과 — 실패 목록과 raise(지금은 키가 없으므로 0).
2. `issues.status_code text` → `update issues set status_code = status` → `not null` + `issues_status_code_shape check (status_code ~ '^[a-z][a-z0-9_]{0,19}$')`. DEFAULT 없음. `issues_status_check`(범주) 유지.
3. `project_vocab_default('workflow.issue_statuses')` 분기 — 기본 4행(code = 범주 code, 사전 기본 라벨, D2 색, category = code, sort 1~4, active). TS `DEFAULT_ISSUE_STATUSES` 와 패리티(`config-vocabulary` 의 VOCAB_KEYS 순회가 자동으로 잡는다).
4. 모양 판독 `issue_statuses_of(p_values jsonb)`(값 받는 판) — `project_vocab_of` + `category` 4값 검사·`open`·`resolved` 범주 활성 ≥1·≤20개. 손상 = `CONFIG_INVALID:workflow.issue_statuses` 22023.
5. `issue_category_transition_ok(from, to)` immutable — 11간선 리터럴(E17).
6. 판정 트리거 `enforce_issue_workflow()` + `trg_vocab_issue_status`(D4). 같은 시점 트리거 이름 순 `trg_assign_issue_code` → `trg_vocab_issue_severity` → `trg_vocab_issue_source` → `trg_vocab_issue_status`(마지막 — 파생 `status` 가 최종, CHECK 는 그 뒤):

| 경우 | 판정 | 오류 |
|---|---|---|
| UPDATE 이고 `status`·`status_code`·`resolved_at` 모두 불변 | 즉시 통과(잠금 없음) | — |
| 공통 | 설정 행 `FOR SHARE` → 격리 수준 read committed 아니면 거부 → 행 없음·모양 손상 fail-closed | `25001 ISSUE_WORKFLOW_ISOLATION` · `P0001 SETTINGS_ROW_MISSING` · `22023 CONFIG_INVALID:workflow.issue_statuses` |
| INSERT, `resolved_at` 지정 | 거부 | `23514 ISSUE_RESOLVED_AT_DERIVED` |
| INSERT, `status_code` null | `status = 'open'` 이면 `open` 범주 첫 활성으로. 아니면 거부 | `23514 ISSUE_STATUS_DERIVED` |
| INSERT, `status_code` 지정 | 활성 ∧ 범주 `open` ∧ `status = 'open'` | `ISSUE_STATUS_UNKNOWN:<code>` · `ISSUE_STATUS_NOT_INITIAL:<code>` · `ISSUE_STATUS_DERIVED` |
| UPDATE, `status_code` 불변·`status` 변경 | 거부 | `ISSUE_STATUS_DERIVED` |
| UPDATE, `resolved_at` 만 변경 | 거부(service_role 포함) | `ISSUE_RESOLVED_AT_DERIVED` |
| UPDATE, `status_code` 변경 | 대상 정의에 있음 ∧ 활성(나가기는 허용) ∧ `(old.status, 대상 범주)` 가 다르면 전이표 안 ∧ 동봉된 `status` 가 대상 범주와 같거나 불변 | `ISSUE_STATUS_UNKNOWN` · `ISSUE_STATUS_INACTIVE:<code>` · `ISSUE_TRANSITION_DENIED:<from>><to>` · `ISSUE_STATUS_DERIVED` |
| 파생 | `new.status := 대상 범주`. `resolved_at`: INSERT null · `resolved` 로 들어오면 now() · `resolved` 안 이동은 유지 · 나가면 null | — |

7. 이력 트리거 `trg_issue_status_history`(D5) — AFTER UPDATE OF status_code, `WHEN (old.status_code is distinct from new.status_code)`, body `'<from>><to>'`.
8. `settings_ref_check` `create or replace`(0023 본문 전체 + 분기): **새 값 모양 검사 먼저**(`CONFIG_INVALID`) → 사라지는 code 의 참조 수(reason `removed`)·`category` 가 바뀌는 code 의 참조 수(reason `category`) → `23514 SETTINGS_CODE_IN_USE:workflow.issue_statuses` + detail(비평 반영 — S8).
9. `project_vocab_ref_count` 에 `issues.status_code`. `migrate_setting_code` `create or replace`(5인자) — 화이트리스트에 키 추가, 같은 범주 검사, `set_config('dflow.actor', p_actor::text, true)`·`set_config('dflow.actor_name', <프로필 이름>, true)` 뒤 update.
10. 사후검사: 열·CHECK·트리거 둘(`prosecdef`)·기본값 4행·분기·EXECUTE.

### 3.3 `NNNN_workflow_policy`

1. **사전 검사**: 모든 프로젝트의 `workflow.stage_credits`·(있으면) 나머지 workflow 키가 SQL 모양 검사를 통과 — 실패 목록과 raise(D20 이 기존 손상 값을 적용 시점에 드러낸다, 비평 반영 — S8).
2. `wbs_items` + `review_round integer not null default 0 check (>= 0)`·`review_steps text[]`. 이행: stage ∈ {im, xx} → 1·`{review}`, 나머지 0·null.
3. `wbs_stage_approvals`(개정 §3.3.2 정의 + 보강 — 비평 반영 — S26 B-18):
   - `(wbs_item_id, project_id) references wbs_items(id, project_id) on delete cascade`(복합 FK — 둘이 어긋난 행 불가).
   - `via text not null check (via in ('approve','approve_step','set_stage'))`(S3).
   - `approved_by references auth.users(id)`(RESTRICT — `agent_work_reports.reviewed_by` 관례와 같음, 의도). 항목 삭제 cascade 는 수용(원장은 항목 수명).
   - RLS enable, 읽기 정책 `to authenticated using (project_id in (select accessible_project_ids()))`, `revoke all … from anon, authenticated; grant select … to authenticated`.
4. `workflow_value_of(p_values jsonb, p_key text) returns jsonb`(immutable) — 키 없음·null = 레지스트리 기본값 SQL 리터럴, 손상 = `CONFIG_INVALID:<key>` 22023. 대상 6키. 기본 리터럴은 TS 레지스트리와 패리티.
5. `wbs_predecessor_reached(gate, stage, approved, actual, dev_workflow)`·`wbs_stage_reaches_gate(stage, gate)`(immutable).
6. `apply_workflow_event` drop + create(D11). 0012 본문 위:
   - 주문 → 항목 `FOR UPDATE` → (판정 사건이면) 설정 `FOR SHARE` → 격리 검사(S9 대상 사건만) → 판정.
   - 사건 표 = 개정 §3.3.2 + D15(라운드 개시)·D16 + S6(`p_expected_step` null 은 유효 단계 1 일 때만).
   - `approve`·`approve_step`·`set_stage 'xx'`: 대기 단계 ≠ `p_expected_step` → `approval_stale` · 보고 대조(기존, approve) · 대기 단계 approver `admin` 이면 `actor_is_project_admin(p_actor, project)` 아니면 `approval_forbidden` · `approval_distinct_approvers` ∧ 같은 라운드 `p_actor` 승인 → `approval_same_actor` · 승인 행(`via`) · 대기가 남으면 주문 `reported`·im·실적 불변·결과 `approval:{round, step_code, remaining}` · 마지막이면 현행(approved·xx·100). `set_stage 'xx'` 는 유효 단계 ≥2 면 `approval_required`(현재 stage 무관), 1 이면 라운드 개시 + 그 단계 승인 판정·행(`via='set_stage'`).
   - 동시 승인의 마지막 방어 = 라이브 부분 유일 인덱스 23505 → `approval_stale`.
   - `reached_first` = `wbs_stage_reaches_gate(new) ∧ ¬wbs_stage_reaches_gate(old)`(gate = `workflow_value_of`).
   - 크레딧 = `workflow_value_of(values, 'workflow.stage_credits')`, `c_default` 상수 유지.
7. `guard_workflow_columns()` + 트리거(D13). 트리거 이름은 `guard_workflow_actual` 이 먼저 돌게(이름 순 — 기존 `LOCKED` 기대 유지, B-22).
8. `guard_workflow_actual()` 교체(D14) + 트리거 `BEFORE INSERT OR UPDATE OF actual_pct`.
9. `settings_ref_check` `create or replace`(I 본문 + 분기): 새 값 모양 검사 → `workflow.approval_steps` 에서 대기 라운드(im 이고 미완, 또는 **xx 이고 스냅샷이 그 단계를 가짐** — `unapprove` 가 되살릴 수 있다, B-21)의 스냅샷 단계 삭제(reason `pending_round`)·대기 단계 승인자 넓히기(`approver_widen`) 거부.
10. `drop function set_dependency_waiver(...)`(열·정리 트리거 보존. `rpc-actor-source` 의 추출 목록은 create 기준이라 무영향).
11. 사후검사: 9인자 시그니처·격리 문자열·EXECUTE(service_role 만)·트리거 셋(정의 문자열)·기본값 리터럴 토큰·원장 권한.

### 3.4 오류 토큰 표

`src/lib/settings/errors.ts` TOKENS(이미 있는 행은 유지 — 비평 반영 — S13):

| 토큰 | 코드 | HTTP | 비고 |
|---|---|---|---|
| `ISSUE_TRANSITION_DENIED`·`ISSUE_STATUS_NOT_INITIAL`·`ISSUE_STATUS_DERIVED` | `CONFIG_INVALID` | 422 | 기존 행 |
| `ISSUE_STATUS_INACTIVE` | `CONFIG_STALE` | 409 | 기존 행 |
| `ISSUE_STATUS_UNKNOWN` | `CONFIG_STALE` | 409 | 신규 — 개정:541 "미존재 code" |
| `ISSUE_RESOLVED_AT_DERIVED` | `CONFIG_INVALID` | 422 | 신규 |
| `SETTINGS_CODE_CATEGORY_MISMATCH` | `CONFIG_INVALID` | 422 | 신규 — 이관 대화상자가 문구로 |
| `ISSUE_WORKFLOW_ISOLATION`·`WORKFLOW_EVENT_ISOLATION` | — | 500 | 문구로 옮기지 않는다(로깅) — A6 관례 |
| `WORKFLOW_COLUMNS_RPC_ONLY`·`WORKFLOW_ACTUAL_LOCKED`·`WORKFLOW_APPROVAL_REQUIRED` | `ERR_DENIED` | 403 | 기존 관례 |
| RPC 결과 reason `approval_stale`·`approval_same_actor`·`approval_required`·`approval_forbidden`·`config_invalid` | `REASON_TEXT` | — | `applyWorkflowEvent` 가 DB 22023 `CONFIG_INVALID:*` 를 reason `config_invalid` 로 접는다 |

### 3.5 격리 맵·매니페스트

- `tests/rls/isolation-map.ts` — `A_ROW_FILTER`·`UPDATE_DENIED_BY_GRANT` 에 `wbs_stage_approvals`, `fixture-ws.sql` 에 A 행 1개.
- 게이트 매니페스트 `approveWbsStep`(`module: null`, `guard: 'projectAdmin'` + note "대기 단계 승인자에 따라 completionApprover"). 이관은 새 액션 없이 `migrateVocabCode` 키→모듈 맵에 `workflow.issue_statuses: 'issues'`. `approveWbsStep` 은 `resolveProjectId` → `requireProjectMember` → 대기 단계 읽기 → 승인자 가드 순(가드 앞 service_role 읽기 없음).
- `tests/invariants/rpc-actor-source.test.ts` — `HELPER_CALLERS['…#apply_workflow_event']` 호출 수·`except`(승인자 가드 결과의 `actor.userId` — 사유 기록) 같은 커밋(B-23).

### 3.6 리허설·롤백

- 리허설(접미 이름): **데이터 있는 업그레이드** — 적용 전 시드(4범주 이슈, im·xx·as 항목, 승인된 주문) → 적용 → 백필(`status_code`·`review_round`·`review_steps`) 단언 → 기본값 동작 불변 → 5상태 정의·2단계 승인 한 바퀴 → 롤백 → 재적용 왕복(비평 반영 — S18).
- I 롤백: W 산출물(`wbs_stage_approvals` 등)이 있으면 raise(먼저 W 롤백). 기본 4 code 밖 `status_code` 또는 `workflow.issue_statuses` 설정 프로젝트가 있으면 raise. 아니면 트리거·함수·열 삭제, `settings_ref_check`·`migrate_setting_code`·`project_vocab_*` 를 0023 본문으로. 이력 행은 남는다.
- W1 롤백: `approval_steps` 비기본·`approval_distinct_approvers` 설정·`final`·`credit_policy` 설정·대기 라운드·**원장 행 존재** 중 하나라도 있으면 raise(감사 기록을 지우지 않는다). 아니면 D12 복원(본문·트리거 정의), `settings_ref_check` 는 **I 본문**으로, `set_dependency_waiver` 를 기준선 본문·권한으로 되살리고 열·표·함수·트리거 삭제(비평 반영 — S10).

---

## 4. 도메인·서버

### 4.1 이슈 표시 상태

- `vocab.ts`: 6번째 키(`workflow.issue_statuses`), 의미 속성 `category`, 불변식, 기본 4행.
- `issueWorkflow.ts`: `initialStatus`·`allowedTargets(defs, fromCode)`(현재 범주에서 전이표로 갈 수 있는 범주의 활성 상태 + 같은 범주 활성, 자기 제외)·`canTransitionCode`·`categoryOf`(모르는 code → null — 표시 = 로깅).
- `updateIssueProgress`(D6): 정의 로드(실패 = 중단) → `canTransitionCode` → CAS `status_code` → 토큰 매핑. `resolved_at` 계산·이력 insert 삭제.
- 소비처(실측-I ③ 의 "표시"·"둘" 전부): 목록 select `status_code`, 필터 두 층(범주 4칩 + 표시 상태 드롭다운), 모달 선택지, 이력 파서(code 정규식, 모르는 code 는 code 그대로), 회의록 칩 둘, 포털(프로젝트별 정의 맵), 분석 스냅샷(D10). 이슈 컴포넌트의 정의 prop 은 **선택**(없으면 기본 4정의 — 기존 UI 테스트 무수정, S23). 범주 소비처(대시보드·`issueDashboard`·`sortIssues`·`isOverdue`)는 무변경.
- 이관 대화상자: 후보는 **같은 범주의 활성 상태**만, 없으면 "먼저 같은 범주에 상태를 추가하거나 이슈를 개별로 옮기세요"(S15).
- 시드 스크립트(`ui-capture`·`perf-baseline`)는 insert 뒤 `status_code` update 두 단계. 과거 해결일 시드는 만들 수 없다 — 해결 7일 KPI 시나리오는 now 기준(우회 플래그 금지, B-26).

### 4.2 승인 단계

- `approvalSteps.ts`: `effectiveSteps(item, current)`(D15)·`nextPendingStep`·`approverOf`(사라진 단계 → `admin`).
- `approveAgentCompletion(orderId, expectedReportId, expectedStep?)`: 대기 단계 읽기 → 승인자 가드(D18) → RPC. 중간 단계면 `recordReview` 없이 알림 `work.approval_step`(required)을 다음 단계 승인 자격자에게, 마지막이면 현행.
- `approveWbsStep(itemId, expectedStep)` 신설(주문 없는 im 항목), `setWbsStage(…,'xx')` 는 승인 판정 경유(D18).
- `updateActual`: `actualHundredBlocked({ delegated, orderStatus, stage, reviewSteps, approvalSteps })`(D14 순서) + `WORKFLOW_APPROVAL_REQUIRED` 매핑.
- `REASON_TEXT` + `approval_stale`·`approval_same_actor`·`approval_required`·`approval_forbidden`·`config_invalid`.
- 승인 가능 셈(결재 배지 `api/shell` → `agentApprovals.ts`·포털 '검토'·`approvable.ts`·좌석표)은 `canApproveCompletion`(authz.ts) 에 `{ pendingStepApprover, approvedThisRound }` 를 실어 서버 판정과 같게(S20). 로더는 주문과 함께 라운드·스냅샷·원장을 읽는다.

### 4.3 선행 기준

`predecessorReachedFor(p, gate)`·`stageReachesGate`(D21). 소비처: `depends.ts`(select `dev_workflow`, gate = `getProjectConfig(pid, { client: admin })`), `stageTransition.ts`(승인 주문 조회 추가), `dependencyReadiness.ts`(숙주 둘이 gate·승인 맵을 prop 으로, agents 꺼짐이면 승인 축 false), `waitReason.ts`(대기 문구 gate 별, `stageText` 해석 라벨), 좌석표(프로젝트별 gate 맵). claim 거부 문구 gate 별(응답 키 불변 — 에이전트 `error` 문자열은 동결 대상 아님).

### 4.4 크레딧 정책

`DEFAULT_CREDIT_POLICY` 를 `stageCredits.ts` 로, `validateStageCredits(table, policy = DEFAULT)`·`clampCredit(…, policy = DEFAULT)`. 레지스트리 `parseStageCredits` 의 비기본 정책 throw 자리를 주입으로, 교차 검사는 `validateConfig`. `StageCreditSlider` 가 정책을 prop 으로.

### 4.5 설정 키 등록

`PLANNED_KEYS` 의 workflow 6키 → `PROJECT_DEFS`(이슈 상태 module `issues`, 나머지 `wbs`), `CATALOG_META`·사전 KO/EN·`docs/settings-catalog.md` 재생성. `impact`·`apply` 는 개정 §2.8.2(D26). 위젯: 이슈 상태 `vocab`, 단계 라벨 `custom`(5칸 — 트림 1~20자), 승인 단계 `custom`(라벨은 **개정대로** — null 은 기본 단계 `review` 만, 그 밖 1~20자. 승인자 `subtree_or_admin|admin`), 서로 다른 승인자 `boolean`, gate `select`, 크레딧 정책 `custom`. 복사 생성(`create_project_with_settings`)은 6키를 다른 키처럼 복사(이슈·원장은 복사 안 함 — 단위 1건, V-19). `agents.stage_workflow` 미등록.

### 4.6 에이전트 프로토콜

응답 키·URL·주문 상태 불변. `depends_evidence[].reached` 값만 gate 반영. `api-contract.md` 표 6·7행·`:166-171` 에 `reached` 주석, `:32` 정정. `contract_version` 유지. `tests/skills` 무수정.

### 4.7 호환 규칙(비평 반영 — S1)

| 규칙 | 지키는 것 |
|---|---|
| 필수 gate 는 새 이름 `predecessorReachedFor`, 옛 `predecessorReached(p)` 는 `'reached'` 래퍼(불변식: src 사용 0) | typecheck(CI — tests 포함)·`predecessor-reached`·`workflow-parity:154` |
| `policy` 인자 선택(기본 `DEFAULT_CREDIT_POLICY`) | `stage-credits` 테스트 |
| `applyWorkflowEvent` 는 `expectedStep` 이 있을 때만 `p_expected_step`, 결과 `approval` 은 돌려받을 때만 | `workflow-event.test.ts:17-21` 정확 일치 |
| 승인 액션 `expectedStep` 선택 3번째 인자, 기본 1단계에서 추가 조회가 기존 큐 mock 을 밀면 그 파일을 §6.2 에 올린다(W1 계획 체크 항목) | `agent-work-actions`·`agentHub.ts:315` |
| `c_default` 상수 유지 | `workflow-parity:58-64` 추출 정규식 |
| `StatusPill` 유니언·이슈 정의 prop 선택 | `status-pill.test`·이슈·회의록 UI 테스트 약 15파일 |
| `canApproveCompletion` seatmap 재수출 | `seatmap.test.ts:3` |

---

## 5. 화면

| 화면 | 변경 | Phase |
|---|---|---|
| 설정 '상태·승인' | 이슈 표시 상태(`VocabEditor` + 범주 칸·"초기 상태" 표시·사용 중 삭제 → 그 자리 이관, 대화상자 문구 §4.1) | I |
| 〃 | 단계 라벨 5칸, 승인 단계 1~3, 서로 다른 승인자, 선행 기준 라디오(IMPACT_PREVIEW "im 선행으로 착수 가능·진행 중인 후속 N건"), 크레딧 슬라이더 + 단위·간격 | W2 |
| `StatusPill` + 이슈 칩 넷·포털 | 유니언 props, 라벨·색·범주 아이콘, "(비활성)" 배지, 허용 전이만 선택지, 필터 두 층 | I |
| 단계 패널 | 프로젝트 라벨, 단계 ≥2 면 xx 선택지 비활성 + 안내, "승인(1/2 · 내부 검토)" 버튼 | W1 최소(버튼·안내) / W2 라벨 |
| 결재 대기열 | "n/m · 라벨", `expectedStep` 동봉, `approval_stale` 이면 새로고침 안내 | W1 |
| 위임 표·좌석표·명세 패널·결재 배지·포털 '검토' | 단계 표시·승인 가능 셈 | W2 |
| 단계 라벨 그리는 곳(비평 반영 — S21) | i18n `wbs.stage*`: `components/wbs/shared.tsx:95-98`(`StageChip` — `WbsGanttSheet` prop 배선), `WbsAssigneeStagePanel.tsx:34,225,233` · `stageLabelKo`: `DelegationTable.tsx:455,458` · `STAGE_NONE_LABEL`: `agent-hub/labels.ts:56` · 하드코딩 "검수 대기": `agent-hub/labels.ts:69`·`components/agents/seatOps.ts:38`·`actions/wbs.ts:115`(`ACTUAL_LOCKED_MSG`)·`claim/route.ts:66`·`waitReason.ts:54`. `STAGE_LABEL_KO` 직접 사용은 `waitReason.ts` 하나 | W2 |

새 화면 부분은 SP3b 패턴으로, 만지지 않는 부분의 패턴 정리는 SPU3.

---

## 6. 테스트·검증

### 6.1 종류별

| 종류 | 내용 | 검증 수단 |
|---|---|---|
| 골든 패리티 | `tests/fixtures/parity/issue-workflow.json`(범주 16쌍(11 허용) × 같은/다른 범주 × 활성/비활성 × INSERT 갈래) · `workflow.json`(선행 120 · 크레딧 4표 × 사건 8 · 실적 차단(D14 순서) · 승인 단계 **1·2·3단계 × 스냅샷 있음·없음 × 설정 변경 전후** · `p_expected_step` null 갈래) — vitest·`tests/rls` 공유. 기본값 패리티(`workflow_value_of`·`project_vocab_default` = TS). "TS parse 통과 ⇔ SQL 모양 검사 통과" 쌍(S8) | `npm run test`·`npm run test:rls` |
| 설정 조합 | 도메인 넷(`issueWorkflow`·`approvalSteps`·gate·크레딧 정책)은 `tests/fixtures/synthetic/configs.ts` 의 기본·R·C 로 `describe.each`(개정 §6.5.7) | `npm run test` |
| RLS | `issue-workflow.test.ts`(멤버·관리자 JWT 직접 PATCH·INSERT, `resolved_at`·`status` 직접 쓰기, service_role `resolved_at` 거부, 이력 1행·DEFINER, 격리 25001, 경합: 상태 삭제 vs 생성 → 고아 0, 이관 vs 단건 → 40P01 재시도) · `workflow-policy.test.ts`(2단계 한 바퀴, stale·null 단계, 같은 사람, admin 단계 비관리자 → forbidden, 반려·재작업·승인취소, xx→im, 스냅샷 없는 im 라운드 개시, JWT 관리자 다섯 열 PATCH/INSERT 42501, 기존 JWT insert 두 경로 통과, 서버 경로 dev_workflow OFF 뒤 멤버 100 거부, 경합: 같은 단계 동시 승인 1건·단계 삭제 vs 승인·승인자 좁히기 vs 승인) · `isolation-map` | `npm run test:rls` |
| 단위 | 액션(가드 순서·CAS·토큰 매핑·알림 분기), 화면(선택지·필터·배지·승인 버튼), 레지스트리·카탈로그, 응답 키 스냅샷·경로 목록(P0), 복사 생성 | `npm run test` |
| 회귀 | 기본 설정에서 개정 §3.7 목록 + `tests/domain/{issues,issue-updates,issue-dashboard}`·`tests/report/issue-analysis*` 무수정 — §6.2 의도적 수정 표 밖 | `git diff --exit-code 87c6116 -- <목록>`(Z 명령) |
| 로컬 E2E | `issue-status-flow`(5상태 정의 → 전이 허용·거부 → 사용 중 삭제 거부 → 이관 → 삭제) · `workflow-approval`(**새 하네스** — 위임·주문 생성·PAT claim·보고·2단계 승인·후속 claim 403→허용, `notification_events` 로 `work.approval_step` 1·`work.approved` 0→1·`work.unblocked` 1 확인) | `scripts/e2e-local.mjs` |
| 합성 | D24 | `npm run accept:synthetic` |
| 성능 | D22 — RPC p95·화면 경로 p95 각각 ≤ 1.20 | `perf-baseline.mjs workflow`·`measure` |
| 눈확인 | D25 — 설정 '상태·승인'·이슈 목록/모달·회의록 칩·단계 패널·결재 대기열·위임 표 | 스크린샷 기록 |
| 상수 가드 | `no-runtime-constants` 패턴 + `STAGE_LABEL_KO`·`STAGE_NONE_LABEL_KO`·`CREDIT_STEP`·`CREDIT_GAP`(허용 = 정의 파일과 "설정에 없는 칸" 의 폴백 자리 넷 — `stageLabels.ts`·`waitReason.ts`·`agent-hub/labels.ts`·`stageCredits.ts`, `removedBy: 'never'`). **Z 정정**: `ISSUE_STATUS_META` 는 가드하지 않는다 — 표시 상태가 아니라 **범주**(제품 고정 4종)의 메타이고, 대시보드 카운트가 범주 기준(done_when #2)이라 `IssueStatusCard` 의 사용이 정답이다 | `npm run test` |

### 6.2 의도적 수정 표(done_when #1 의 예외 — 단언의 의도는 보존)

| 파일 | 고칠 곳 | 사유 |
|---|---|---|
| `tests/rls/h2-postchecks.test.ts` | ⑪ 재실행 케이스 — 현 시그니처를 카탈로그에서 찾아 같은 검사 | D11 시그니처 9인자 |
| `tests/rls/workflow-parity.test.ts` | `:60` 시그니처 리터럴 · `:310-321` 트리거 정의 기대(`INSERT OR UPDATE OF actual_pct`) · `arrange` 준비 구간에서 claims 비우기(단언 무수정) | D11·D14·D13(S2) |
| `tests/rls/h2-report-stale.test.ts` | `:110-128` 시그니처·"하나뿐" 단언 | D11 |
| `tests/actions/issues-gate.test.ts`·`issue-notify.test.ts` | 이력 insert 단언 → 트리거로 이전, 정의 로드 mock | D5·D6 |
| `tests/settings/registry.test.ts` | 키 수·정렬 목록·SQL 판독 키·`PLANNED_KEYS` 단언 | 6키 등록 |
| `tests/settings/vocab.test.ts` | "다섯 정의" 이름 | D1 |
| `tests/domain/inbox.test.ts` | REQUIRED 목록에 `work.approval_step` | §8 기본값(개정 승인 요청류) |
| `tests/scripts/synthetic.test.ts` | `PENDING_STEPS` | D24 |
| `tests/css/no-raw-color.test.ts` | `issues.ts` slate-400 허용 행 제거 | D8 |
| (W1 계획에서 확인) `tests/actions/agent-work-actions.test.ts` | 큐 mock 이 밀리면 | §4.7 — **Z 확인: 고치지 않았다**(승인 재료 로더를 단위 전역 셋업이 mock — W1·W2 계획) |
| `tests/modules/registry.test.ts` | 등록 키 셈·흐름 키의 모듈 | 6키 등록(Z 가 행 추가 — W1 계획) |
| `tests/invariants/settings-writes.test.ts` | e2e 참조 허용 수(이슈 상태·승인 흐름 E2E 단계의 설정 액션) | E2E 두 단계(Z 가 행 추가) |
| `tests/modules/effective.test.ts` | "등록되지 않은 비core 키" 픽스처를 `workflow.issue_statuses` → `fields.issue`(SP5c 계획 키) | D1 — 픽스처 키가 등록됐다(Z 가 행 추가) |
| `tests/rls/issue-areas.test.ts` | 트리거를 끈 CHECK 케이스의 직접 INSERT 에 `status_code` | `status_code` NOT NULL(트리거가 채움) — 트리거를 끈 케이스만(Z 가 행 추가) |
| `tests/setup/module-gate.ts` | 승인 재료·선행 기준·승인 주문·단계 이름 로더 전역 mock | §4.7 호환 — 기존 큐 mock 보호(Z 가 행 추가) |

Z 확인 — 표에 있었으나 고치지 않고도 초록으로 끝난 것(`git diff 87c6116` 0줄): `tests/settings/vocab.test.ts`·`tests/css/no-raw-color.test.ts`·`tests/actions/issue-notify.test.ts`·`tests/actions/agent-work-actions.test.ts`. `tests/scripts/perf-baseline.test.ts` 는 P0 의 새 명령에 대한 **추가**(수정 아님)다.

### 6.3 고정 테스트 갱신 표

`tests/gates/manifest.ts`(새 액션), `tests/invariants/rpc-actor-source.test.ts`(HELPER_CALLERS·except), `tests/rls/isolation-map.ts`, `tests/settings/catalog-sync.test.ts`(행 추가), `tests/settings/no-runtime-constants.allow.ts`(패턴), `tests/invariants/settings-writes.test.ts`(합성·성능 스크립트가 설정을 쓰면 허용 경로로만). 각각 그 변경과 같은 커밋.

---

## 7. 완료 조건(done_when)

개정 §3.8 SP5b done_when 1~9 의 구체화(비평 반영 — S25: 검증 수단을 적는다).

1. 설정 키가 없는 프로젝트는 현행과 같다 — §6.1 회귀 목록이 §6.2 밖에서 무수정 초록(`git diff --exit-code 87c6116 -- …`), 현행 고정 패리티 단언이 개정 전후 초록.
2. 연구 픽스처 이슈 5상태 흐름(접수 → 검토 → 고객 승인 → 실행 → 종료, 반려·재개)이 **UI 선택지**(컴포넌트 테스트 + 눈확인)·**액션**(E2E `issue-status-flow`)·**PostgREST 직접 PATCH**(RLS)에서 같은 결과, 전이표 밖 이동은 셋 다 거부, 대시보드 카운트 범주 기준 불변, 이력은 액션(E2E)·PATCH·이관(RLS)에서 각 1행.
3. 2단계 승인 + `final`(E2E `workflow-approval` + RLS): 첫 승인 뒤 `reported`·im·실적 불변·`work.approved` 0·`work.approval_step` 1·후속 claim 403 / 둘째 뒤 approved·xx·100·`work.approved` 1·후속 허용 / 기본 `reached` 대조 / 같은 사람·stale·admin 단계 비관리자 거부 / 반려 → 새 라운드 / 2단계 `set_stage 'xx'` 직행 `approval_required` / JWT 관리자 다섯 열 쓰기 42501 / 1단계 `admin` 단계에서 비관리자의 xx 지정 거부.
4. `final`: im 선행 claim 403·`reached=false`, xx 첫 도달 `work.unblocked` 1, 화면 "시작 가능"·대기 사유 = claim 게이트(단위). `tests/skills` 무수정, 응답 키 스냅샷 불변, 경로 대조 둘(E18).
5. 크레딧 0/20/25/90/100 을 `{5,5}` 에서 저장·전이, 기본 정책 거부, 모양 손상 22023, TS↔SQL 패리티.
6. 사용 중 이슈 상태 삭제 `CONFIG_IN_USE`(건수), 범주 변경은 사용 0건만, 이관은 같은 범주만·건수·이력, revision 충돌 409.
7. 유효 단계 ≥2(서버 경로 `dev_workflow` OFF 뒤 포함)·위임·점유 항목에 JWT 멤버·관리자의 `actual_pct=100` PATCH·INSERT 42501. 새 함수 `anon`·`authenticated` EXECUTE 0, `isolation-map` 에 `wbs_stage_approvals`.
8. `apply_workflow_event` p95 와 화면 경로 p95 가 같은 세션 A/B(`87c6116` 대비) ≤ 1.20.
9. 정본 반영(§11) — 카탈로그 workflow 6키 verified, `api-contract.md`, 개정 §6.3 번호, CLAUDE.md 권한 절.
10. (§5.12.5 ①) `StatusPill` 이 해석된 정의를 받는다. (②는 SPU2 로 — D17)
11. 합성 S1·S3·S6·S9 통과, E2E 두 단계 통과, `sp5b-done`.

---

## 8. 사용자 확인 항목

각 항목은 권고 기본값으로 진행한다(사전 승인 규칙). 다르게 하시려면 그 Phase 착수 전에 말씀해 주시면 된다.

| # | 질문 | 권고 기본값 | 대안 | 바꿀 때 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | (개정 레버 L3 — "SP5 종료 시 판단") SP5b 와 SP5c(사용자 정의 필드)를 동시에 진행할까요? | 순서대로 — 같은 화면(이슈 모달·WBS 상세·설정)을 둘 다 고치고, 작업자가 하나라 병렬 이득이 없다 | 병렬(소유 파일 재분할) | 높음 | P0 |
| 2 | 관리자가 앱을 거치지 않고 데이터 API 로 WBS 항목의 단계·위임 표시·워크플로 사용 여부를 직접 바꾸는 길을 막을까요? 앱 화면 기능은 그대로입니다 | 막는다(D13) — 개정이 이 SP 에 맡긴 "승인 건너뛰기 우회" 정리 | 단계만 막는다 — 다문장 우회가 남아 다른 수단을 따로 정해야 한다 | 중간 | W1 |
| 3 | WBS 항목을 '완료'로 바로 지정할 때도 승인과 같은 규칙(관리자 전용 단계면 관리자만, 자기 담당 리프는 자기가 완료 못 함)을 적용할까요? 기본 설정에서 **서브트리 관리자가 자기 담당 리프를 바로 완료하던 것이 막힙니다** | 적용한다(D18) — 승인자 설정을 우회하는 길을 닫는다 | 기본 1단계에서는 지금처럼 | 낮음 | W1 |
| 4 | 이슈를 칸반 보드로 보는 화면과 WBS 보드의 '흐름'(단계별 열) 보기·카드 이동 메뉴는 **이번에 만들지 않고 SPU2(작업 계획 화면 통합)로** 넘길까요? | 넘긴다(D8·D17) | WBS '흐름' 보기만 이번에(+1~1.5h) | 낮음 | W2 |
| 5 | 이슈 상태를 지울 때 그 상태의 이슈를 옮기는 것은 **같은 범주(열림·진행·보류·해결) 안으로만** 허용할까요? 다른 범주로는 이슈마다 상태를 바꿔야 합니다 | 같은 범주만(D3) | 범주를 넘는 이관 | 중간 — DB 우회 경로·해결일 처리 | I |
| 6 | 이슈 상태가 바뀔 때의 기록을 **DB 가 자동으로** 남기게 할까요? 앱 밖 수정·이관도 남고 상태 변경과 함께 저장됩니다. 작성자 이름은 프로필 이름입니다 | 자동(D5) | 지금처럼 앱이 남김 | 낮음 | I |
| 7 | 이슈 칩 모양을 상태 칩(아이콘 + 옅은 배경)으로 통일할까요? 지금은 색 점입니다 | 통일(D8 — 색만으로 전달하지 않는다) | 지금 모양 유지 | 낮음 | I |
| 8 | 각 Phase 가 main 에 들어간 뒤 로컬 DB 에 적용할까요? I: 이슈에 상태 code 열(기존 이슈는 지금 상태 그대로), W1: 승인 라운드 열·승인 원장(설정을 바꾸기 전까지 동작 동일). 적용 전에 `npm run settings:verify` 로 손상 설정 0을 확인합니다 | 그때 묻는다(0019~0024 적용이 먼저) | — | — | 각 Phase 뒤 |

---

## 9. 범위 제외·이월

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| 프로젝트별 전이 그래프 편집기·역할/capability·`preventSelfApproval`(AUTH-07b)·스크립트·수식 | 비목표 | 이미 있음 |
| 이슈 보드, WBS 보드 '흐름' 보기·카드 이동 메뉴, §5.12.5 ② | SPU2 | SPU2 블록 범위·done_when 에 한 줄(Z) |
| 범주를 넘는 이슈 일괄 상태 이동 | SPU3 대량 변경 | SPU3 블록에 한 줄 |
| 알림 `issue.status` 발행 | 비목표(필요하면 SP8 알림 정책) | SP8 블록에 한 줄 |
| AI 색인 이슈 상태 라벨·재색인 | SP8 | SP8 재색인 줄에 덧붙임 |
| 카탈로그 `status_code`·`status_label` 렌더 | SP6 | 이미 있음 |
| `api-contract.md` v2.5 절 흡수·스튜디오 결재 단계 표시 | SP7 | 이미 있음 |
| 색 체계 이행(개정 7색 토큰) | 디자인 SP(UI-3 계열) | 개정 §8.1 에 한 줄 |
| 상태 이력(`kind='status'`) 삭제 제한(관리자 삭제 정책을 `note` 로) | SPU1(감사·저장 신뢰성) | SPU1 블록에 한 줄 |
| 옛 `import_wbs`·`replace_wbs`·`import_wbs_upsert` 의 authenticated 실행권 회수 | SP9 출시 점검 — D13 뒤 관리자 JWT 의 이 RPC 직접 호출은 흐름 열이 있는 행에서 42501 | SP9 줄에 덧붙임, CLAUDE.md 권한 절(Z) |

---

## 10. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| K1 | `apply_workflow_event` 재작성 회귀(에이전트·사람 공용 최대 RPC) | P0 응답 키 스냅샷, 골든 실행 대조, §6.2 밖 무수정, W1 단독 체크포인트 |
| K2 | 설정 `FOR SHARE` 추가로 교착 | 순서 주문 → 항목 → 설정 고정, 설정 저장 RPC 는 세기만, 경합 테스트 셋. 유일한 교착 쌍(이관 vs 이슈 단건 UPDATE — 40P01)은 B4 와 같은 재시도 |
| K3 | gate 배선 누락 → 화면과 게이트 불일치 | `predecessorReachedFor` 필수 인자(tsc), 5곳·숙주 둘 단위 테스트, E2E 대조 |
| K4 | 이슈 트리거가 시드·리허설·롤백 재삽입을 깸 | 시드 두 단계, 리허설 `status` 생략 확인, 롤백 순서 가드(S10) |
| K5 | 트리거 셋·RPC 설정 판독 비용 | 값 받는 판독(한 번 읽기), A/B 측정, 넘으면 개정 §2.4.1 advisory 잠금 대안 |
| K6 | D13 이 관리자 직접 API 작업을 막는다 | §8 #2, 앱 경로 전수가 service_role 임을 테스트로 고정 |
| K7 | **잔여 신뢰 범위**(S4·S17): 관리자·서브트리 관리자가 서버 경로로 `dev_workflow` 를 끈 비-im 항목의 실적 100, 관리자 JWT 의 항목 삭제·재생성으로 `final` 선행 충족 — 승인 대기(im) 항목은 막힌다 | 관리자 신뢰 범위로 수용, 원장·이력으로 사후 추적. 필요해지면 SPU1 감사 |

---

## 11. 정본 반영 목록(Z — 비평 반영 — S19)

| 대상 | 고칠 것 | 근거 |
|---|---|---|
| 개정 §2.8.2 `workflow.issue_statuses` 행·§3.2.1·§3.2.4 | label 필수 + 사전 규약, `VOCAB_COLORS`, 기본 색 | D2 |
| 개정 §2.3.4 토큰 표 | §3.4 신규 토큰 | S13 |
| 개정 §2.4.2·§3.2.2 이관 행·§3.2.3 ③ | 5인자·설정 먼저·같은 범주·두 명령·GUC 없음 | D3·E3·E15 |
| 개정 §3.2.2 판정 표 | 격리·`resolved_at`·명시값 거부·트리거 열 | D4 |
| 개정 §3.2.4·§3.2.5 | `nextResolvedAt`·`canTransition` 유지, 필드 이름 유지, 색인 라벨 SP8, 알림 없음 | D6·D7·D9·D10 |
| 개정 §3.3.2 코드 블록·사건 표 | 다섯 열 가드·INSERT 조건, xx→im 철회, 라운드 0 개시, xx 지정 승인 판정·RPC admin 재판정·`via` | D13·D15·D16·D18 |
| 개정 §3.3.5 | 순서(im 대기 절이 dev_workflow 앞)·`INSERT OR UPDATE`·D15 규칙 | D14·D15 |
| 개정 §3.3.4 SQL 행·§2.8.2 `workflow.stage_credits` | 모양 손상 22023 | D20 |
| 개정 §3.3.6·§3.7 현행 고정 행·§3.0 | 0012 본문 기준, 롤백 조건 | D12·E2·S10 |
| 개정 §3.5 보드 행·§5.9.2·§5.12.5 ② | SPU2 로 | D17 |
| 개정 §3.7 회귀 목록·매니페스트 문장 | 의도적 수정 표, `approveWbsStep` module null, `migrateVocabCode` 확장 | §6.2·D19 |
| 개정 §3.8·§6.2 SP5b 마이그레이션 행·§6.3 | 접미 이름·실제 번호 | E1 |
| 개정 §6.2 SPU1·SPU2·SPU3·SP8·SP9 블록 | §9 행들 | §9 |
| 정본 §4.5.2(`status_label`) | B4 사전 규약 | D2 |
| CLAUDE.md 권한 절 | 흐름 열 가드(다섯 열 RPC 전용)와 옛 가져오기 RPC 의 JWT 경로 | D13 |
| `.claude/skills/dflow-work/references/api-contract.md` | `reached` 주석, `:32` | §4.6 |
