# SP3a — 설정 엔진·모듈 레지스트리·저장 계약·설정 화면 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-27 |
| 상태 | 승인 — 사용자 사전 승인(2026-09-27). §9 사용자 확인 항목은 권고 기본값으로 진행하며, 각 항목은 해당 Phase 착수 전까지 바꿀 수 있다 |
| 상위 정본 | 정본 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 의 §3.2(모듈 레지스트리 가운데 개정이 바꾸지 않은 부분)·§5.4.5·§6.5.2·§6.5.3, 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §2(설정 계약 전부)·§5.3.5·§5.9.3·§5.11.2·§6.2 SP3a 블록·§6.2.0 H2 구현 결과·§6.5.6~§6.5.8. 이 문서는 그 결정을 옮겨 적고 **이 리포에서 실제로 할 일**(파일 경로·순서·경계 동작·테스트)을 더한다. 상위 문서가 정확한 정의를 가진 곳은 절만 가리킨다 |
| 선행 | G0-1 충족 — `sp2-done` = `87bcd74`, `npm run test:rls` 70/70, `docs/baseline/sp2-e2e.md`<br>G0-2 충족 — 사용자 결정 U-1~U-6 과 일괄 승인(2026-09-26·27), 정본 §1.10 에 반영(`064f79d`). 개정 머리 표의 상태 행은 `9f81e07` 이 "승인"으로 고쳤다(E1). 단 개정 §8.1 #3·#20·#21 은 원장 판정 G0-6-4 로 권고 기본값 진행 중이며 사용자 확인 전이다(§9.2)<br>G0-3 충족 — 개정 §2(항목별 대조 §1.4)<br>G0-4 충족 — 이 문서 §3.6(항목별 대조와 코드 조각 §1.4)<br>G0-5 충족 — H1 main `bdbcfac`, 태그 `h1-done`, CI run `36286379450` 초록<br>G0-6 충족 — 정본 반영 `bc10e6f..064f79d`(문서 3파일), CI run `36288109273` 초록<br>G0-7 충족 — H2 main `00bfe8c`, 태그 `h2-done`. 커밋 넷: 앱 호환 `2639924..13b398d`, 마이그레이션 `8b02b54`(`Staging-verified: local db reset 2026-09-27 19:21`), RLS 테스트 `56c1ffa`, i 의 앱 코드 `49c4530`. `npm run test:rls` 18파일 172 통과(건너뜀 0)<br>G0-8 충족 — 이 표의 상태 행<br>G0-9 충족 — `00bfe8c` 에서 `npm run test` 589파일 7281 통과, `typecheck`·`lint` 오류 0, 빌드 exit 0(스크래치 워크트리), CI run `36313647511` 초록 |
| 마이그레이션 | `supabase/migrations/0012_settings.sql` 한 파일 + `supabase/rollbacks/0012_settings_rollback.sql`(개정 §6.2 SP3a 블록과 §6.3 번호표가 정했다 — D33). 착수 직전에 `ls supabase/migrations \| tail -1` 이 `0011_authz_hardening.sql` 인지 확인한다 |
| 실측 근거 | 2026-09-27 읽기 전용 조사. 코드·`0011:N` 줄 번호는 main `00bfe8c`, DB 는 로컬 카탈로그(`0000`~`0011` 적용, public 표 73개). 비평이 롤백 트랜잭션 안에서 잰 사실은 "비평 실측"으로 적고 파일을 밝힌다(`.superpowers/sp3a/critique-*.md`) |

읽는 순서: 사용자는 §9 를 먼저 읽는다. 표기 — "정본 §N"·"개정 §N" 은 두 상위 문서의 절, `정본@31878b1:N` 은 개정이 인용하는 고정 줄(`git show 31878b1:docs/superpowers/specs/2026-09-23-generic-platform-design.md`)이다.

## 1. 전제와 결정

### 1.1 사용자 결정(SP3a 를 구속하는 것)

| # | 결정(출처) | SP3a 에서의 귀결 |
|---|---|---|
| U-1 | 업무 흐름 설정화(개정 §1.2, 대장 C2·C3·C4) | `core.stage_credits` 를 `workflow.stage_credits` 로 개명해 이관만 한다. `agents.stage_workflow` 는 등록하지 않는다. 레지스트리는 `workflow.*` 의 값 형태를 담을 수 있어야 한다(G0-4) |
| U-2 | 사용자 정의 필드(대장 C5) | `fields.<entity>` 의 형태(정의 목록·`guarded`·`reindexOn`)를 표현할 수 있어야 한다. 등록은 SP5c |
| U-3 | 집계·위험·완료 정책은 지금과 같게(대장 C6) | `progress.rollup`·`risk.thresholds`·`lifecycle.completion` 키를 만들지 않는다. 카탈로그 '제품 고정' 절에 싣는다 |
| U-4 | 주 시작 일요일(대장 C7) | 규칙 목록·`seedFrom.map`·`edit` 를 표현할 수 있어야 한다. 달력 키 등록은 SP5 Phase A |
| U-5 | 공휴일 오버레이 없음(대장 C8) | `calendar.holiday_region` 을 만들지 않는다 |
| U-6 | 디자인 결정 번복(대장 C9~C11) | `branding.accent` 미설정은 중립·코발트다. `navFor` 는 워크스페이스·프로젝트 두 층을 낸다. 셸은 건드리지 않는다 |
| C1 | 결정은 사용자만 개정한다(개정 §1.3 C1, 정본 §1.10) | 이 문서는 결정을 옮겨 적는다. 상위 문서가 정하지 않은 것은 §9 에 올린다 |
| 결정 5·7·8·9 | 정본 §1.3 | 설정 항목은 코드 레지스트리, 값은 관리자 화면. 모듈은 3층 교집합. 권한 판정은 두 곳·기존 가드 불변. 팀·영역·휴일은 FK 표라 키가 아니다 |
| S1~S18 | 개정 §2.0 결정 요약 | §3~§5 전체가 따른다. S9·S10 의 참조 검사 분기와 S17·S18 은 계약만 고정하고 구현은 뒤 SP 다 |
| SP2 U2·U4 | SP2 스펙 §1.1 | 경로 이동·전환기는 SP3b. SP3a 는 `/w/[slug]` 의 레이아웃 골격과 설정 화면만 만든다. 검증은 로컬이다 |
| P-1 | 2026-09-27 사용자 지시 — 스펙 사전 승인 | 머리 표 상태 행. §9 는 권고 기본값으로 진행하고 목록을 사용자에게 보고한다 |

### 1.2 컨트롤러 기본값

| # | 결정 | 이유 | 사용자가 달리 정하면 |
|---|---|---|---|
| D1 | 설정 RPC·생성 RPC·권한 RPC 는 0011 의 격리 규칙을 따른다. 잠금 뒤·다른 행 판독 전에 read committed 가 아니면 `25001 SETTINGS_ISOLATION`(권한 RPC 는 `AUTHZ_EVENT_ISOLATION`)으로 거절한다. 면제와 조기 반환은 검사보다 앞이다 | 설정 행을 잠근 뒤 이력(`command_id`)과 참조 건수를 읽어 판정한다(`0011:36-37` 과 같은 꼴, 개정 §6.2.0 H2 구현 결과 A6). 뒤 SP 의 참조 쓰기 트리거는 잠근 그 행만 읽으므로 대상이 아니다 | 검사 절과 테스트 한 묶음을 뺀다 |
| D2 | `project_settings.updated_by` 와 `agent_projects.created_by` 의 FK 를 `on delete set null` 로 바꾸고, `workspace_settings` 에 같은 `updated_by` 열을 더한다 | 둘 다 NO ACTION 이라(DB `confdeltype = 'a'`) RPC 와 모듈 토글이 값을 쓰면 그 계정 삭제가 23503 으로 막힌다(E2·E3, H2 의 교훈) | FK 를 그대로 두고 계정 삭제 차단을 운영 절차로 넘긴다 |
| D3 | 이력 세 표는 고칠 수 없다. 설정 이력 두 표는 UPDATE 를 전부 거부하고 DELETE 는 부모(프로젝트·워크스페이스) 부재일 때만 통과한다. `authz_events` 는 UPDATE·DELETE 를 전부 거부하고, 워크스페이스 행이 없어진 뒤의 정리만 명시 함수 하나로 허용하고, 워크스페이스 삭제 트리거가 그 함수를 부른다(§6). 사람을 가리키는 열(`changed_by`·행위자·대상)과 `authz_events` 의 범위 id 에는 FK 를 두지 않는다 | service_role 권한은 회수할 수 없다(SP2 불변식 ⓘ). FK 를 두면 캐스케이드가 이력을 지우고, 부모가 지워지는 도중의 기록 insert 가 23503 으로 삭제를 막는다(비평 실측 — `critique-security.md` C1·`critique-feasibility.md` C1). 개정 §2.2.1 의 `changed_by … on delete set null` 은 이 규칙으로 바뀐다. 무엇을 얼마나 남기는지는 기본값 — 사용자 확인 항목(§9 #15) | 트리거를 빼고 grep 게이트만 남긴다 |
| D4 | 이행이 값을 쓴 설정 행과 그 이력은 `revision = 1` 이다 | 생성 RPC 의 "revision 1"(개정 §2.3.3)과 같게 한다 | 0 으로 두면 이력 revision 과 문서 revision 이 어긋난다 |
| D5 | 새 표는 `revoke all … from anon, authenticated` 뒤 `grant select … to authenticated` 만 한다. identity 시퀀스도 두 롤에서 회수한다 | 기본 권한이 새 표에 anon `r`·authenticated `arwd` 를 준다(E8). 정책 없는 DML 0 불변식(`tests/rls/h2-table-grants.test.ts`)에 걸린다 | 없음(불변식이 강제) |
| D6 | 세션 경로의 프로젝트 insert 를 닫는다 — 정책 `wsadmin_insert_projects` 삭제, `projects` 의 authenticated INSERT 회수. 워크스페이스 관리자는 액션으로 계속 만든다 | 남기면 필수 키 없는 빈 설정 행이 생성 RPC 를 우회해 만들어진다 | 정책을 남기고 `required_missing` 상태를 화면이 처리한다 |
| D7 | 설정 행의 직접 DELETE 를 트리거로 막는다(`23514 SETTINGS_ROW_REQUIRED`). 부모 부재(캐스케이드)만 통과한다 | 행 1:1 불변식을 검출이 아니라 기계로 지킨다. 캐스케이드 안에서 자식 트리거가 부모 부재를 본다(비평 실측 — `critique-feasibility.md` C1 참고) | 검출(`SETTINGS_ROW_MISSING`)만 남긴다 |
| D8 | 명령 id 의 유일성은 (행위자, 범위, 명령 id)다. 같은 키로 다른 내용이 오면 `23505 COMMAND_REUSED` 하나로 거부한다. 내용은 요약값으로 비교한다 — RPC 가 인자에서 `sha256` 요약을 만들어 이력·권한 이력의 `command_digest` 열에 남긴다. 다른 행위자·다른 범위의 같은 id 는 서로 보이지 않는다. 설정 RPC 둘·생성 RPC·권한 RPC 셋에 모두 적용한다 | 무조건 `duplicate` 를 돌려주면 두 번째 변경(특히 권한 회수)이 조용히 사라진다. 이력에는 값이 바뀐 키만 남아 키 대조로는 "키를 더한 재전송"을 못 잡는다(`critique-security.md` I2·M4). 이력 표에 열 하나가 개정 정의에 더해진다 | 대조하지 않고 `duplicate` 를 돌려준다 |
| D9 | 결과 조회 액션 `getSettingsCommandOutcome` 을 둔다. 이력에 없으면 `unknown` 이고 클라이언트는 같은 `commandId` 로 재전송한다 | 개정 §5.8.2 의 `getCommandOutcome` 과 COM-2 증거 "응답 유실 결과 조회". 값 불변 명령은 이력이 없어 재전송이 유일한 길이다 | 조회 없이 재전송만 쓴다 |
| D10 | `requireModule` 은 `src/lib/authz/index.ts` 가 아니라 `src/lib/modules/gate.ts` 에 둔다(재수출하지 않는다 — 순환 import). 시그니처 불변식은 그 파일을 읽는다. 단위 테스트는 전역 기본 mock(`tests/setup/module-gate.ts`)이 통과를 돌려준다 | `vi.mock('@/lib/authz')` 를 쓰는 테스트가 79파일이고 대부분 팩토리에 새 이름이 없다(E17) | 정본대로 `authz/index.ts` 에 두고 79파일의 mock 을 고친다 |
| D11 | URL 404 는 레이아웃이 아니라 페이지마다 관문을 부르고, 정적 불변식이 `src/app` 아래 모든 `page.tsx` 를 본다(닫힌 제외 목록) | 레이아웃은 경로 조각을 모르고, 레이아웃의 `notFound()` 는 페이지 로더를 멈추지 못한다(E13). `(app)` 밖의 공유 페이지도 모듈 데이터를 낸다 | 없음(레이아웃 단독으로는 막지 못한다) |
| D12 | SP3a 가 등록하는 워크스페이스 키 8개의 소유 모듈은 core `settings` 다 | `SettingDef.module` 은 필수인데 상위 문서에 열이 없다. core 소유라 저장 규칙(개정 §2.7.3)에서 늘 열린다 | 키별로 모듈을 다시 배정한다 |
| D13 | `SettingWidget` 은 6종을 유지한다. 범주 어휘·구조체·규칙 목록·정의 목록은 `custom` 으로 선언한다 | 개정 §2.6.1 "유지". 위젯은 TS 뿐이라 뒤에 넓혀도 `0012` 가 바뀌지 않는다 | `vocab` 에 속성 선언을 더한다 |
| D14 | `EditCtx` 를 스코프 유니온으로 둔다(`scope: 'project'` 는 개정 정의 그대로, `scope: 'workspace'` 는 `workspaceId`). `branding.accent` 는 `edit` 로 입력(hex 하나)과 저장(파생 세트)을 가른다 | 개정의 `EditCtx` 는 `projectId` 필수인데 accent 는 워크스페이스 키다 | accent 파생을 `parse` 안에서 한다 |
| D15 | `OperationalDef.owner` 는 파일 목록(`readonly string[]`)이다 | 같은 env 를 2~3파일이 읽는 이름이 7개다(E21) | 읽기를 단일 모듈로 옮긴다 |
| D16 | 워커가 건너뛴 잡은 `status = 'skipped'`, `last_error = 'module_disabled'` 로 닫는다. `0012` 가 잡 표 세 개의 status check 에 `'skipped'` 를 더한다. 쓰는 주체는 워커 자신이다 — claim 한 잡을 service_role 의 직접 update 로 닫는다(조건은 `id` 와 `status = 'running'`). `finish_*`·`complete_ai_index_job` 은 고치지 않는다. 모듈을 다시 켜도 `skipped` 잡은 다시 큐에 넣지 않는다 | 정본 §3.2.7 규칙 3(b). 지금 check 는 네 값만 허용하고(E14) 기존 종료 함수는 `done`·`pending`·`dead_letter` 만 쓴다(`critique-feasibility.md` Minor 8) | `done` + `last_error` 로 닫는다 |
| D17 | `aiAvailable` 과 `hasLLM()` 호출부 교체를 Phase B 에 넣는다. `hasLLM(` 이 든 파일은 11개이고 정의(`provider.ts`)·진단(`health.ts`)·주석뿐인 `llm-override.ts` 를 빼면 호출 파일은 8개다 | 정본 §5.4.5 가 정의했고 담당 SP 가 없다. 빠지면 `ai.enabled` 를 꺼도 두 모듈만 꺼진다(네 연결 원칙, 개정 §6.1) | `ai.enabled` 상태를 `stored` 에 두고 SP8 로 넘긴다 |
| D18 | 열거는 동적 import 가 아니라 정적 AST 로 한다. 매니페스트 `guard` 에 `'session'` 과 `'minutesSecret'` 을 더하고 `module` 은 목록도 받는다(전부 유효해야 통과). 게이트는 인라인 `'use server'` 0건과 `'use server'` 모듈의 default export 0건도 단언한다 | 동적 import 는 `src/lib/teams/master.ts:187` 의 최상위 await 를 돌린다. 역할 가드 없는 액션이 65개, 두 모듈에 걸친 액션이 있다. default export 는 정적 열거가 놓친다 | 없음 |
| D19 | 로고는 새 비공개 버킷 `branding` 에 둔다. 경로 `ws/<wid>/branding/<slot>-<sha256 앞 16자>.<png·jpg·webp>`, `slot` 은 `full`·`full_dark`·`mark` 셋. 읽기 정책은 `bucket_id = 'branding'` 과 경로 검사를 정책 안에 직접 쓰고 기존 헬퍼 `is_ws_member` 만 부른다. 새 실행 가능 함수를 만들지 않는다. 쓰기는 service_role 뿐. **SVG 는 받지 않는다**(개정 §2.8.1 은 SVG·PNG — 판정으로 좁힌다). 크기 상한 262,144바이트 | DB 에 브랜딩용 버킷이 없다(E32). 개정 §2.3.2 와 done_when ② 는 authenticated 가 실행하는 새 함수 0건을 요구한다. `bucket_id` 가 없으면 다른 버킷의 같은 모양 경로가 열린다(`critique-security.md` I6). SVG 는 스크립트를 담을 수 있다 | SVG 를 받고 거부 목록(`<script`·`on…=`·`<foreignObject`·`<!DOCTYPE`·`<!ENTITY`·외부 참조)을 둔다 |
| D20 | 카탈로그 생성 논리는 TS 순수 모듈이고 `scripts/settings-catalog.mjs` 는 `CATALOG_WRITE=1` 로 동기화 테스트를 띄우는 래퍼다 | `.mjs` 는 `@/` 별칭을 쓰는 TS 레지스트리를 읽지 못한다 | TS 로더 의존성을 더한다 |
| D21 | DB 가 필요한 단언은 `tests/rls/` 에 둔다(개정 §2.11 ①·④ 의 DB 부분 포함) | `vitest.config.ts` 는 DB 없이 돌고 `skipIf` 는 금지다(E24) | 없음 |
| D22 | Phase A 의 커밋은 네 묶음이다: ① 0012 와 무관하게 초록인 새 모듈 → ② `0012` + 롤백 두 파일만(G4 트레일러) → ③ `tests/rls/**`·픽스처 → ④ 읽기·쓰기 경로 교체. 중간 커밋은 배포 가능 상태가 아니다 | H2 관례(개정 §6.2.0 H2 구현 결과 A1). 원격이 없고 체크포인트는 넷이 다 들어간 뒤다 | 없음(G1 이 강제) |
| D23 | 출처 라벨: 최신 이력이 `source='copy'` 면 '생성 시 복사'(원본 이름), `source='create'` 이고 키에 `seedFrom` 이 있으면 '생성 시 복사'(워크스페이스 값), 그 밖의 저장값은 '프로젝트 설정', 미설정은 '제품 기본값'. 워크스페이스는 '워크스페이스 설정'·'배포 기본값'·'제품 기본값' | 생성 RPC 는 모든 키에 `source='create'` 를 남기므로 개정 §2.1 문장만으로는 가려지지 않는다 | 판정식만 바꾼다 |
| D24 | '기록' 범주는 최근 20건과 '더 보기'(20건씩)다. 되돌리기는 없다 | 대체된 정본 §3.1 의 값이고(`정본@31878b1:1195`) 개정은 건수를 말하지 않는다 | 건수·되돌리기 추가 |
| D25 | 합성 게이트 러너·`accept:synthetic`·픽스처를 SP3a 가 만든다. 뒤 SP 의 단계는 '미활성(담당 SP)'으로 기록하고 건너뜀으로 세지 않는다. 활성 단계를 건너뛰면 실패다 | SP3a 가 단계를 켜는 첫 SP 다(개정 §6.5.8) | 없음 |
| D26 | 롤백은 두 설정 표를 0011 모양으로 재생성하고, 열이 있던 키는 `values` 에서 되돌려 채운다. 이력·권한 이력·열이 없던 키는 되돌리지 않는다 | 열을 drop·add 하면 컬럼 순서가 달라 카탈로그 대조가 깨진다(0003 롤백 선례) | 기준선 기본값으로만 되돌린다 |
| D27 | `dev-bootstrap.mjs` 는 모듈 id 목록과 `SETTINGS_SCHEMA_VERSION` 을 `scripts/lib/bootstrap-modules.mjs` 의 상수로 갖고 `tests/modules/bootstrap-ids.test.ts` 가 레지스트리와 대조한다 | 스크립트가 TS 를 읽지 못한다. 틀린 id 가 저장되면 모든 모듈이 fail-closed 로 닫힌다 | 없음 |
| D28 | SP3a 화면은 기존 프리미티브로 기능만 만든다. 시각 패턴은 SP3b UI-3 이 입힌다 | 개정 §5.9.3 제목 "(SP3a 기능, SP3b UI-3)" | 없음 |
| D29 | 복사 원본에 `invalid` 키가 하나라도 있거나 원본이 `schemaAhead` 면 `createProject` 는 복사를 거부하고 그 키 목록을 `fieldErrors` 로 돌려준다(`CONFIG_INVALID`). 아무것도 만들지 않는다. 옮기는 것은 원본의 `set` 키 전부다 | 값 복사를 액션이 하므로(§3.3) 손상 키가 조용히 빠질 수 있다. 조용한 기본값 치환은 0건이어야 한다(개정 §6.2 SP3a 블록 목표, 에러 처리 원칙 ①) | 빠진 키를 결과에 싣고 화면이 경고한 뒤 생성은 진행한다 |
| D30 | accent 거부 임계값은 hue 20°·C 0.08 로 시작하고 SP3b UI-1 이 표본 10종으로 조정해 테스트에 고정한다(개정 §8.1 #8 — 판단 "실측") | 계산 규칙은 개정 §5.11.2. 임계값이 좁아지면 저장된 세트가 읽을 때 `invalid` 가 되므로 조정 커밋은 `npm run settings:verify` 로 로컬 저장값을 확인한다 | 다른 시작값 |
| D31 | 마감에서 개정 §6.3 총 기간 표를 SP3a 의 실측 노력 비율로 다시 계산해 문서 커밋으로 남긴다(개정 §8.1 #16 — 판단 "실측") | 개정 §6.3 이 재산정 시점을 SP3a 종료로 정했다 | 없음 |
| D32 | 계정 범위 개인 설정의 저장 위치는 SP3b 스펙이 정한다(개정 §8.1 #5, G0-8). SP3a 는 `user_preferences` 와 `prefsWorkspaceId` 를 건드리지 않는다 | 판단 "설계"이고 G0-8 이 SP3b 스펙에 배정했다. 채택하면 SP3b 가 번호 하나를 받고 SP3a 번호는 그대로다 | 없음 |
| D33 | SP3a 의 DB 변경은 `0012` 한 파일이다. 버킷·잡 표 check·권한 이력도 같은 파일이다 | 개정 §6.2 SP3a 블록과 §6.3 번호표가 파일을 정했다. 나누는 것은 번호표 개정이라 사용자 결정이다(R1) | 번호표를 고쳐 뒤 SP 번호를 민다 |
| D34 | `core.level_labels` 는 '변경 내용 검토'를 거치지 않는다. 줄이는 저장은 `validateConfig` 가 막고 "기존 WBS 에 깊이 N단 항목이 있어 …" 문구로 건수를 알린다 | 개정 §2.8.2 가 impact 를 `none` 으로 정했다. 개정 §5.9.3 의 예시 표는 이 키를 검토 대상에 넣었지만 키 정의의 정본은 개정 §2.8 이다 | impact 에 `recompute` 를 더한다(레지스트리 변경 규칙 R5 가 아니라 메타 변경) |
| D35 | 워크스페이스 제품명으로 바꾸는 산출물은 메일 제목·발신명, 엑셀 템플릿 안내문, 보고서 엑셀 작성자, 회의록 내보내기 파일명·머리말이다. 공개 화면(로그인·초대·공유)은 개정대로 env 다. 외부 API 오류 문구와 LLM 프롬프트도 env 를 유지한다 | 앞의 넷은 워크스페이스가 정해진 서버 경로다. 외부 API 문구는 동결된 스킬 계약이고, 프롬프트는 모듈 최상위 상수라 요청 문맥이 없다. 뒤 둘은 개정에 없는 선택이다 | 프롬프트·API 문구도 요청마다 워크스페이스 값을 읽게 고친다(SP8) |
| D36 | 로고를 새로 올려도 옛 파일은 지우지 않는다 | 설정 이력의 옛 값이 그 경로를 가리킨다. 파일은 최대 256KB 다 | 교체 때 옛 객체를 지우고 이력의 경로는 죽은 참조로 둔다 |
| D37 | 워커 산출물의 `settings_revision` 기록(개정 §2.5)은 SP5 로 넘긴다 | SP3a 의 워커는 모듈 판정만 읽고 설정 값을 산출물 계산에 쓰지 않는다. 값을 쓰는 첫 워커는 SP5 의 달력 소비다. 받는 쪽 기록은 §10 | SP3a 가 잡 표에 열을 더한다 |
| D38 | 개정의 "모듈 목록과 열거 게이트에는 SP5b·SP5c 가 새로 만드는 액션도 등록한다"는 "매니페스트에 없는 새 액션은 CI 가 막는다"로 읽는다 | 그 액션들은 아직 없다. 열거 게이트가 실행 때 세므로 등록 없이는 통과하지 못한다 | 없음 |
| D39 | `branding.*` 의 저장값이 읽을 때 `parse` 에 실패하면 키 상태는 `invalid` 이고(설정 화면은 "설정 손상"), 표시 소비처는 제품 기본값으로 그리며 실패를 로그에 남긴다 | 접근을 여닫는 값이 아니라 표시 값이다. 화면 전체를 멈추는 것보다 중립 표시가 안전하다. 조용한 치환이 아니도록 기록한다 | 다른 키처럼 그 기능을 멈춘다 |
| D40 | `invites.allowed_domains` 는 저장 때 정규화한다(소문자, 앞뒤 공백·선행 `@`·끝 점 제거, 퓨니코드 변환, 중복 제거). 형식이 틀린 항목은 버리지 않고 **거부**한다. `'*'` 는 단독(`['*']`)일 때만 유효하고 섞이면 거부한다. 비교는 정확 일치다(하위 도메인 불포함) | 지금 `parseAllowedDomains` 는 틀린 항목을 조용히 버리고 `'*'` 가 섞이면 전체 허용으로 바꾼다(`src/lib/domain/invites.ts:36-55`). 저장 화면에서 그대로 두면 관리자가 모르게 넓어진다 | 지금처럼 버린다 |
| D41 | 에이전트 옛 토글(`setAgentProjectEnabled`·`AgentProjectToggle`)은 새 모듈 토글이 나오는 Phase C 까지 남긴다. Phase B 가 옛 토글을 `modules.enabled` 의 `agents` 도 함께 쓰게 고친다 | 먼저 지우면 B 와 C 사이에 에이전트를 켜고 끌 길이 없다(`critique-scope.md` S4) | 없음 |

### 1.3 상위 문서 대비 정정(실측)

E29 는 뺐다(개정이 `5d69f0e` 로 고쳐졌다). 번호는 다시 매기지 않는다.

| # | 상위 문서의 말 | 실측(근거) | 이 문서의 처리 |
|---|---|---|---|
| E1 | 개정 머리 표 상태 "초안", G0-2 증거는 "스펙 상태 승인" | main `00bfe8c` 의 개정 6행은 "초안"이다. 승인 사실은 `.superpowers/g0/progress.md:3` 과 정본 §1.10 | `9f81e07` 이 고쳤다. Phase A 착수 점검은 main 의 개정 6행이 "승인"으로 시작하는지 본다 |
| E2 | 개정 §2.2.1 "`updated_by` 는 FK 없음" | `0000_baseline.sql:9850-9851`, DB `project_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)` | D2 |
| E3 | 개정 §2.3.2 워크스페이스 RPC 는 "동형"(`updated_by` 를 쓴다). 개정 §2.4.2 `migrate_setting_code` 는 4인자, 개정 §3.2.3 은 8인자 | `0008_workspace_settings.sql:9-14`, DB 열 `workspace_id,allowed_domains,updated_at` — `updated_by` 없음. 뒤 함수는 SP3a 가 만들지 않는다 | D2. 인자 수는 SP5 스펙이 정한다 |
| E4 | 개정 §2.2.2 쓰기 5곳 | 6곳 — `src/app/actions/project.ts:220`(`clearExcelProfile`, H1 과제 1b). 줄 이동: `import/execute/route.ts:188`, `wbs/structure/route.ts:47` | §3.4 표 |
| E5 | 개정 §2.2.2·§2.8.2 `apply_workflow_event` 판독은 `0000:908` | H2 가 8인자로 재생성(`0011:675-911`), 판독 `0011:873`, DB 에 8인자 하나 | `0012` 는 0011 원문에서 고친다 |
| E6 | 개정 §2.3.2 "기본 권한이 anon·authenticated 에 EXECUTE", "아무 롤에도 주지 않는다" | DB `pg_default_acl` 함수 = `authenticated=X, service_role=X`. anon 은 내장 PUBLIC 으로 실행한다 | 회수 문장은 `from public, anon, authenticated`. service_role 은 기본 권한으로 남는다(0011 관례) |
| E7 | 개정 §2.11 ② "F20 허용 목록 무변경" | H2 가 목록에 두 함수를 더했다(`tests/rls/schema-invariants.test.ts:159-176`) | 기준은 `h2-done` 의 목록이다. SP3a 는 그 파일을 고치지 않는다(D19) |
| E8 | 개정 §2.2.1 ⑤ 의 revoke 문장 | DB 기본 권한 표 = `anon=r, authenticated=arwd`. 문장이 새 표의 anon SELECT 를 걷지 못한다 | D5 |
| E9 | 개정 §2.5 "4조회", `{ client: adminFor({ projectId }) }`, 캐시 키 `(projectId, client)` | S1 은 프로젝트가 워크스페이스 값을 읽지 않는다. `adminFor` 는 `{ …scope, admin }` 을 돌려준다(`src/lib/supabase/adminFor.ts:15-19`). `react` `cache` 는 인자 동일성으로 비교한다 | 3조회, `adminFor(…).admin` 을 넘긴다, 위치 인자 캐시(§3.5) |
| E10 | 개정 §2.5 `valueOf` 는 프로젝트 전용, `from: 'deploy'` 가 `ProjectConfig` 아래 | 개정 §2.7.1 이 워크스페이스 config 로 부른다. 배포 기본값은 워크스페이스 3키뿐이다 | `valueOf` 오버로드, `'deploy'` 는 워크스페이스 키에서만 나온다 |
| E11 | 개정 §2.5 `ingest.ts:31` 은 워커 | `src/lib/ai/ingest.ts:33`, 호출 4곳이 모두 세션 경로 | 세션 클라이언트를 유지한다 |
| E12 | 정본 §3.2.4 예시 `resolveScope('projects', …)` | `ProjectScopedTable` 에 `'projects'` 가 없다(`src/lib/authz/scope.ts:5-7`) | `ProjectConfig.workspaceId` 로 얻는다(§4.1) |
| E13 | 정본 §3.2.5 프로젝트 레이아웃이 경로 조각으로 `notFound()` | 레이아웃은 `params` 만 받는다(`src/app/(app)/p/[projectId]/layout.tsx:10-13`). `tests/invariants/project-page-gates.test.ts:4` 의 기록 | D11 |
| E14 | 정본 §3.2.7 잡을 `skipped` 로 닫는다 | DB check 세 개가 `pending·running·done·dead_letter` 만 허용. `IndexJobStatus`(`src/lib/ai/index/types.ts:76`)도 네 값 | D16 |
| E15 | 정본 §3.2.4·§3.2.7 에이전트 API 킬스위치는 `gateAgentApi` | 호출처 0. 실제는 `resolveAgentPrincipal`(`src/lib/agent/externalApi.ts:138`) | 킬스위치는 지금 자리에 둔다 |
| E16 | 정본 §3.2.2 모듈 표에 `issue_analysis` | 개정 §2.8.2 "SP5 부터", 개정 §2.6.2 R6(모듈 추가는 그 SP 의 이행이 기록) | SP3a 는 17개. `/api/issue-analysis` 는 `issues` 소속, `OFF_ON_CREATE = []` |
| E17 | 정본 §3.2.6 "35파일·핸들러 44", authz mock 50파일 | 액션 34파일·173 export, 라우트 41파일, 함수 핸들러 44 + `/api/v1` 의 `export const` 스텁 74(그 가운데 10개는 인라인 클로저 — `wbs/import/route.ts:94-98`, `agent/work/mine/route.ts:133-137`), authz mock 79파일 | 실측값을 쓴다 |
| E18 | 개정 §2.3.1 "가드 3종", 정본 §2.4.4 "5종", CLAUDE.md "넷뿐" | 가드 넷 + `resolveScope`(`tests/authz/guard-signatures.test.ts:11-15`), `requireSuperuser(` 호출 11곳 고정 | `requireModule` 은 가드가 아니라 관문이다. CLAUDE.md 권한 절에 한 문장을 더하고 시그니처 불변식에 넣는다. 11곳은 그대로다 |
| E19 | 개정 §5.3.5 코드 주석 "(SP3b)", `tests/nav/nav-for.test.ts` 는 SP3b done_when | 개정 §6.2 SP3a 블록이 `navFor` 를 SP3a 에 준다(SP 배정의 정본은 개정 §6 이다) | 함수와 순수 단위 테스트 파일은 SP3a 가 소유하고 SP3b 는 셸 소비 케이스를 덧붙인다(§10.1) |
| E20 | 개정 §6.8 이 `portal.widgets`·`views.default` 를 SP3a 에 | 개정 §2.8.1·§2.8.2·§6.2 SP3a 블록은 SP3b | 등록하지 않는다(`PLANNED_KEYS`) |
| E21 | 개정 §2.6.3 owner 는 단일 파일, 개정 §2.8.4 에 `APP_ENV` | `CRON_SECRET` 3파일 등 7개 이름이 2~3파일. `APP_ENV` 판독 0건, 코드는 `VERCEL_ENV`·`STAGING` | D15. `APP_ENV` 는 싣지 않는다 |
| E22 | 개정 §2.8.1 `branding.mail_from_name` 기본은 제품명 | `src/lib/mail/fromName.ts:10` 은 제품명 뒤에 " 알림" | §9 #4 |
| E23 | 개정 §2.2.2 `max_depth` 는 버리고 라벨 수에서 파생 | `maxDepth` null 은 무제한이다(`src/lib/domain/wbsAffordance.ts:5-6`). 앱의 생성·단계 편집은 라벨 수를 쓴다(`project.ts:95,179`, `wbsImport.ts:227`). 로컬 4행은 전부 null 이다. 외부 API 가 값을 그대로 낸다(`wbs/structure/route.ts:93`) | §9 #1 |
| E24 | 개정 §2.11 ①·④ 가 `tests/settings/` 아래 | `vitest.config.ts` 가 `tests/rls/**` 밖을 DB 없이 돌린다 | D21 |
| E25 | 개정 §2.11 ⑤ "설정 insert 실패를 주입" | 생성 RPC 는 트리거가 만든 행을 update 한다 | "설정 기록 실패를 주입"으로 읽는다 |
| E26 | 개정 §2.1 워크스페이스 화면은 프로젝트 업무 키를 행 단위로 읽지 않는다 | 포트폴리오가 프로젝트마다 마일스톤 키워드를 읽는다(`src/lib/data/portfolio.ts:98-99`). 개정에는 무엇으로 대신하는지가 없다 | §9 #16 |
| E27 | 개정 §4.0 R4-7 영역 kind 탭은 소비처 SP 에서 연다 | 두 탭은 개정 기준선에도 열려 있었고(`src/components/settings/ProjectAreasManager.tsx:15,34,90`) R4-7 이 닫기로 정했다. 영역을 읽는 소비처는 0건이다 | §9 #7 |
| E28 | 정본 §6.5.2 패턴 `LEGACY_ORIGIN_PROFILE` | SP0 에서 `LEGACY_EXCEL_PROFILE_V1` 로 개명(구 이름 0건) | 새 이름으로 검사한다 |
| E30 | — | `src/lib/repositories/supabase/settings.ts:13` 이 없는 열 `projects.updated_at` 을 읽어 봇 설정 조회가 늘 실패한다 | 같은 파일을 고칠 때 열을 뺀다(Phase A) |
| E31 | 개정 §6.2 SP3a 소유 파일 행 | 범위가 요구하는 파일이 빠져 있다 | §2.2 표 |
| E32 | 개정 §2.8.1 `branding.logo` 는 "Storage 경로" | DB 버킷은 `deliverables·issue-attachments·minutes` 셋 | D19 |
| E33 | 대체된 정본 §3.1 이 `DEFAULT_LEVEL_LABELS` 도 SP3 에서 삭제 | 정본 §3.4 인벤토리는 SP4. `src/components/wbs/shared.tsx:14` 의 **주석**이 옛 로더를 가리킨다(import 아님) | SP3a 는 그 주석을 새 해석기 기준으로 고친다. 상수 삭제는 SP4 |
| E34 | 정본@31878b1:1217 복사 대상에 `form_templates` | 표가 없다(SP6 `0024`) | SP3a 는 값·영역·영역-팀·프로젝트 전용 팀만. SP6 이 `create or replace` 로 더한다 |
| E35 | 개정 §2.3.1 ⑤ 가 살아남는다고 한 `정본:1206` | 그 줄은 `forms.*` 행이다. 폐지된 사전 건수 조회는 `:1208` | SP3a 에 해당하는 교차 검사는 트리 깊이와 `teamColumns` 둘이다 |
| E36 | `supabase/rehearsal/0008_smoke.sql` | 0012 뒤에는 `:7,31` 의 단언이 거짓이 된다 | Phase A 가 파일 머리에 "0012 이전 상태의 기록"이라고 적는다 |
| E37 | 개정 §6.2 SP3a 블록 노력 "3주(2.5~3.5)" | 일의 목록과 H1·H2 실측으로는 약 4.3~6.3주다(`critique-feasibility.md` I9). `authz_events` 가 증분 없이 더해졌다 | §2.1 표에 Phase 별 추정을 적고 §9 #17 로 알린다 |

### 1.4 G0-3·G0-4 항목별 대조

| 게이트 항목 | 충족하는 곳 |
|---|---|
| G0-3 모듈 검증 모순 | 개정 §2.7.1~§2.7.3 → §3.3, §4.1 |
| G0-3 `revision`·`expectedRevision`·409·`schema_version` | 개정 §2.2.1·§2.3·§2.6.2 → §3.1, §3.3 |
| G0-3 code 삭제·의미 변경의 원자 검사 | 개정 §2.4 → §3.3 의 `settings_ref_check` 골격(분기는 SP5 부터) |
| G0-3 parse 실패 비위장·미등록 키 거부·오류 코드 | 개정 §2.5·§2.3.4 → §3.3, §3.5 |
| G0-3 이력 | 개정 §2.2.1 → §3.1 |
| G0-3 SettingDef 메타 | 개정 §2.6.1 → §3.6 |
| G0-3 상속 없음·생성 시 복사 | 개정 §2.1·§2.3.3 → §3.3, D23 |
| G0-3 명령 응답 계약 | 개정 §2.3.1 → §3.3 |
| G0-3 `branding.*` 2단 키 | 개정 §2.8.1 → §3.6 키 표 |
| G0-3 카탈로그 열·운영 설정·지원 제한 분류 | 개정 §2.10·§2.8.4·§2.9 → §5.6, §5.7 |
| G0-4 범주 속성과 예약 code 를 가진 어휘 | 아래 조각 `issueStatuses` — `widget: custom`, 범주·예약 code 는 `parse` |
| G0-4 구조체 값 | 아래 조각 `approvalSteps` |
| G0-4 적용일을 가진 규칙 목록 | 아래 조각 `weekStart` 의 저장 형태 |
| G0-4 엔티티별 정의 목록 | 아래 조각 `issueFields`(키 묶음은 열거 고정 3개) |
| G0-4 복합 영향 | `impact` 가 비지 않은 목록(`approvalSteps`·`weekStart`) |
| G0-4 부수효과 | `issueFields.reindexOn` |
| G0-4 변환 복사 | `weekStart.seedFrom.map` |
| G0-4 입력≠저장 | `weekStart.edit` |
| G0-4 SQL 디스패처 골격 | §3.3 `settings_ref_check` |

아래 네 선언은 **등록하지 않는다**. `tests/settings/registry.test.ts` 가 같은 조각을 형 검사 픽스처로 갖고, `parse` 함수와 값 타입은 그 픽스처가 최소 구현으로 채운다. 소유 모듈은 등록하는 SP 가 정한다.

```ts
const approvalSteps: SettingDef<ApprovalStep[]> = { key: 'workflow.approval_steps', scope: 'project', module: 'wbs',
  default: [{ code: 'review', label: null, approver: 'subtree_or_admin' }], parse: parseApprovalSteps,
  widget: { kind: 'custom', component: 'ApprovalStepsEditor' }, editor: 'project_admin', apply: 'immediate',
  impact: ['future_only', 'guarded'], sql: { readers: ['apply_workflow_event', 'guard_workflow_actual', 'guard_workflow_columns'] } }
const weekStart: SettingDef<WeekRule[], WeekDay> = { key: 'calendar.week_start', scope: 'project', module: 'settings',
  default: [{ day: 'sunday', from: null }], parse: parseWeekRules,
  widget: { kind: 'custom', component: 'WeekStartEditor' }, editor: 'project_admin', apply: 'immediate',
  impact: ['future_only', 'recompute'], sql: { readers: ['week_key_of'] },
  seedFrom: { key: 'calendar.week_start', map: day => [{ day: day as WeekDay, from: null }] },
  edit: { parseInput: parseWeekDay, toStored: changeWeekStart } }
const issueFields: SettingDef<FieldDef[]> = { key: 'fields.issue', scope: 'project', module: 'issues',
  default: [], parse: parseFieldDefs, widget: { kind: 'custom', component: 'FieldDefsEditor' },
  editor: 'project_admin', apply: 'immediate', impact: ['guarded'], sql: { readers: ['enforce_custom_fields'] }, reindexOn: ['label', 'searchable', 'options.label'] }
const issueStatuses: SettingDef<IssueStatus[]> = { key: 'workflow.issue_statuses', scope: 'project', module: 'issues',
  default: DEFAULT_ISSUE_STATUSES, parse: parseIssueStatuses,
  widget: { kind: 'custom', component: 'IssueStatusesEditor' }, editor: 'project_admin', apply: 'immediate',
  impact: ['guarded'], sql: { readers: ['enforce_issue_workflow'] } }
```

## 2. Phase 구성

개정 §6.1 은 SP 노력 상한을 3주로 두고 넘으면 Phase 와 main 체크포인트를 요구한다. SP3a 의 추정은 개정의 3주를 넘는다(E37). Phase 마다 3주를 넘지 않으므로 SP 를 쪼개지 않고 네 Phase 로 나눈다.

### 2.1 Phase 표

| Phase | 목표 | 의존 | 노력(추정) | 브랜치 | 체크포인트(main 배포 가능) |
|---|---|---|---|---|---|
| A — 저장·쓰기 계약·레지스트리·읽기 | 설정이 `values` 에 있고 모든 읽기는 해석기, 모든 쓰기는 RPC 를 지난다. 권한 변경은 DB 가 기록한다. 모듈은 전부 켜진 채 기록만 한다 | G0-1~G0-9, E1 확인(`9f81e07`) | 2~3주 | `sp3a/phase-a` | 공통 묶음 + 롤백 리허설 불일치 0 + `npm run settings:verify` 0 + 로컬 E2E 1~2단계와 기존 시나리오 통과 + 눈확인 A 행(§7.5) |
| B — 모듈·게이트·`navFor` | 모듈을 끄면 URL·액션·API·공유 링크·봇·워커가 닫힌다. `navFor` 가 같은 판정에서 메뉴 모델을 낸다 | A | 1~1.5주 | `sp3a/phase-b` | 공통 묶음 + 열거 게이트 초록 + 모듈 끔 E2E(§7.3) + 성능 기준 통과(§7.4) + 눈확인 B 행 |
| C — 설정 화면·브랜딩·카탈로그 | 관리자가 화면에서 14키를 고치고 출처·영향·충돌을 본다. 카탈로그 문서가 레지스트리에서 나온다. 옛 에이전트 토글이 사라진다 | B | 1~1.5주 | `ui/sp3a-settings` | 공통 묶음 + `catalog-sync`·`operational-env` 초록 + 로컬 E2E 7단계 + 눈확인 C 행 전부 |
| D — 권한 변경 이력 배선 | 관리 화면의 권한 변경이 행위자·명령 id 와 함께 남고 관리자가 읽는다 | C | 0.3주 | `sp3a/phase-d` | 공통 묶음 + `tests/actions/authz-events*.test.ts` 초록 + 로컬 E2E 8단계(관리 화면의 변경에 행위자가 있다) + 눈확인 D 행 |
| 마감 | 합성 게이트 S1·S9, 로컬 E2E 기록, 노력 재산정, 태그 | D | — | main | `sp3a-done` |

- **순차로 돈다: A → B → C → D → 마감.** 병렬은 하지 않는다. 로컬 Supabase 스택이 하나라 `db:reset`·`dev:bootstrap`·`test:rls`·리허설·성능 측정·E2E 를 동시에 돌릴 수 없고, 여러 Phase 가 같은 파일을 이어 고친다(§2.3).
- **공통 묶음**은 모든 체크포인트가 돌린다: `npm run db:reset` → `npm run dev:bootstrap` → `npm run test:rls`(건너뜀 0)·`npm run test`·`npm run lint`·`npm run typecheck`·`npm run build` 초록 → main ff·push(사람 확인) → CI 초록. 빌드는 main 브랜치의 커밋을 스크래치 워크트리에서 돌린다(메인 체크아웃에서 돌리지 않는다).
- Phase A 의 동작은 0011 때와 같다. 의도된 변경은 넷이다: `createProject` 가 throw 대신 결과를 돌려준다, 가져오기 화면이 프로파일 저장 실패를 경고한다(W5), 설정 조회 실패가 기본값 대신 오류 상태로 보인다(A 는 기존 오류 표시로 그리고 C 가 `ConfigStateNotice` 로 바꾼다), 깊이 제한이 단계 이름 수가 된다(§9 #1).
- Phase B 뒤 SP3b UI-2 까지 사이드바는 꺼진 모듈의 링크를 계속 보이고 그 링크는 404 다. 메뉴 소비가 SP3b 이기 때문이다(개정 §6.2 SP3a 블록). E2E 기록에 적는다.
- CI 는 `main`·`staging`·`sp0/**`·`ui/**` push 와 PR 에서만 돈다(`.github/workflows/ci.yml:3-4`). `sp3a/*` 브랜치의 CI 증거는 main push 뒤에 받는다.
- `git add -A` 는 쓰지 않는다. 커밋 메시지는 한국어, push 는 사람 확인 뒤다. 체크포인트마다 Phase 의 실측 노력을 원장(`.superpowers/sp3a/progress.md`)에 적는다(D31).
- SP3b 스펙은 Phase A 가 도는 동안 승인받는다(G0-8). SP3b UI-0·UI-1 은 SP3a 와 나란히 돌 수 있고 UI-2 는 Phase B 체크포인트 뒤다. 개정 §8.1 #21 은 UI-1 착수 전에 필요하다(§9.2).

### 2.2 소유 파일

파일마다 주인은 하나다. 주인은 그 파일을 만들거나 처음 고치는 Phase 다. 뒤 Phase 가 이어 고치는 파일은 §2.3 에 따로 적는다.

| Phase | 소유 파일 |
|---|---|
| A — DB | `supabase/migrations/0012_settings.sql`, `supabase/rollbacks/0012_settings_rollback.sql`, `supabase/rehearsal/0012_seed_wide.sql`·`0012_smoke.sql`·`0012_precheck_violations.sql`, `supabase/rehearsal/0008_smoke.sql`(머리 주석) |
| A — 엔진 | `src/lib/settings/{registry,errors,projectConfig,workspaceConfig,validateConfig,write,history,catalog-meta,accent,accentTokens,brandingPath}.ts`·`defs/{workspace,project}.ts`, `src/lib/nav/ids.ts`, `src/lib/modules/{registry,defaults,closure,effective,saveRule,flags,agentsSync}.ts`, `src/app/actions/settings.ts`, `src/app/actions/project.ts` |
| A — 호출부 | 옛 로더를 import 하는 13파일(`grep -rln "lib/data/projectConfig" src` 의 14파일에서 주석뿐인 `shared.tsx` 제외 — 페이지 넷, 라우트 넷, `src/lib/ai/{projectFacts,ingest}.ts`, `src/lib/data/portfolio.ts`, `src/lib/repositories/{types.ts,supabase/settings.ts}`)과 `src/lib/data/projectConfig.ts`(삭제), `src/components/wbs/shared.tsx`(주석), `src/app/api/v1/wbs/structure/route.ts`, `src/app/actions/wbsMarkdown.ts`, `src/lib/agent/wbsImport.ts`, `src/lib/data/inviteDomains.ts`, `src/lib/domain/invites.ts`, `src/lib/domain/stageCredits.ts`, `src/components/settings/{LevelSettingsManager,StageCreditSlider,ClearExcelProfileButton}.tsx`, `src/components/home/NewProjectModal.tsx`, `src/components/import/ImportWizard.tsx`, `src/lib/domain/importWizard.ts`, `src/lib/i18n/dict/settings.ts`·`settings.en.ts` |
| A — 스크립트·문서 | `scripts/dev-bootstrap.mjs`, `scripts/lib/bootstrap-modules.mjs`, `scripts/e2e-local.mjs`, `scripts/perf-baseline.mjs`, `scripts/settings-verify.mjs`, `package.json`, `docs/sp2-admin-client-audit.md`, `CLAUDE.md`, `docs/baseline/sp3a-ui.md` |
| A — 테스트 | 새 파일: `tests/settings/{registry,config-lifecycle,errors,project-isolation,create-project,internal-write,accent,no-runtime-constants}.test.ts`, `tests/modules/{registry,effective,bootstrap-ids,agents-sync}.test.ts`, `tests/actions/settings-outcome-history.test.ts`, `tests/scripts/bootstrap-modules.test.ts`, `tests/rls/{settings-write,settings-rows,settings-cas,settings-lifecycle,settings-create,settings-isolation,authz-events,synthetic-parity}.test.ts`, `tests/invariants/settings-writes.test.ts`, `tests/fixtures/{synthetic,parity}/**`. 기존 파일: `tests/rls/{workspace-settings,workflow-parity,workspace-isolation,storage-realtime}.test.ts`·`isolation-map.ts`·`fixture.sql`·`fixture-ws.sql`, 옛 로더를 import 하는 테스트 14파일(`grep -rln "lib/data/projectConfig" tests`), `tests/actions/{level-settings,clear-excel-profile,project-stage-credits,project-actions,invite-redeem,project-invites-gate,wbs-markdown-upload}.test.ts`, `tests/components/{level-settings-manager,stage-credit-slider,clear-excel-profile-button,import-wizard-profile-mismatch}.test.tsx`, `tests/ui/new-project-modal.test.tsx`·`import-wizard-state.test.ts`, `createProject` 를 mock 하는 `tests/actions/authz-gate-wbs.test.ts`·`tests/ui/projects-home.test.tsx`, `tests/agent/{wbs-import-nlevel,wbs-structure}.test.ts`, `tests/repositories/settings-read.test.ts`, `tests/scripts/e2e.test.ts` |
| B | `src/lib/modules/{gate,pageGate,aiAvailable}.ts`, `src/lib/nav/registry.ts`, `src/lib/authz/errors.ts`, A·C·D 가 가진 파일을 뺀 `src/app/actions/*.ts`, A·C 가 가진 파일을 뺀 `src/app/**/page.tsx`(공유 페이지 `src/app/share/minutes/[token]/page.tsx` 포함)와 `src/app/api/**/route.ts`, `src/lib/ai/**` 가운데 env·`hasLLM` 판독부와 워커 루프(`wiki-ingest.ts`·`index/pgvector.ts`·`index/types.ts`)·봇 도구 등록(`chat/default-registry.ts`·`chat/access-scope.ts`), `src/lib/wiki/serviceState.ts`, `src/lib/agent/{externalApi,mineShared,delegation,ensureOrder,routeShared}.ts`, `src/lib/minutes/externalApi.ts`, `src/lib/data/agentHub.ts`, `src/app/actions/agentWork.ts`, `src/components/chat/AssistantChat.tsx`, `scripts/env-swap.mjs`, `vitest.config.ts`, `tests/setup/module-gate.ts`, `tests/gates/**`, `tests/nav/nav-for.test.ts`, `tests/modules/{bot-domains,bot-tools-gate,worker-gate,agents-gate}.test.ts`, `tests/ai/ai-available.test.ts`, `tests/invariants/module-page-gates.test.ts`, `tests/authz/guard-signatures.test.ts`, `tests/app/share-minutes-gate.test.tsx`, `tests/api/minutes-meta-modules.test.ts`, `tests/actions/agent-work-actions.test.ts`, `docs/baseline/sp3a-perf.md` |
| C | `src/app/(app)/w/[slug]/layout.tsx`, `src/app/(app)/w/[slug]/settings/**`, `src/app/(app)/projects/page.tsx`, `src/app/api/brand/**`, `src/app/actions/{settingsPreview,branding}.ts`, `src/components/settings/` 의 새 파일(`SettingsShell`·`SettingsHistoryList`·`ModuleToggleEditor`·`ModuleAllowEditor`·`LogoEditor`·`AccentEditor`·`MenuOrderEditor`·`ConfigStateNotice`·`ConflictCompare`)과 `AgentProjectToggle.tsx`(삭제)·`ProjectAreasManager.tsx`, `src/components/agent-hub/HubStatusBar.tsx`, `src/components/ui/BrandMark.tsx`, `src/lib/settings/{impactPreview,brandMark,catalogDoc,operational}.ts`, `src/lib/edit/session.ts`, `src/lib/branding.ts`, `src/lib/mail/{fromName,projectInvite}.ts`, `src/lib/excel/template.ts`, `src/lib/report/excel.ts`, `src/lib/minutes/export.ts`, `.env.local.example`, `scripts/settings-catalog.mjs`, `docs/settings-catalog.md`, `tests/settings/{operational-env,catalog-sync,brand-mark,impact-preview,logo-upload}.test.ts`, `tests/api/brand-route.test.ts`, `tests/app/w-layout.test.tsx`, `tests/components/{config-state-notice,settings-conflict,module-toggle-editor,agent-hub-view,agent-hub-queue}.test.tsx`, `tests/lib/branding.test.ts`, `tests/invariants/project-page-gates.test.ts` |
| D | `src/app/actions/accounts.ts`, `src/app/actions/roster.ts`, `src/app/actions/authzEvents.ts`, `src/lib/authz/events.ts`, `src/components/settings/AuthzEventList.tsx`, `tests/actions/{authz-events,authz-events-list}.test.ts`, 두 액션 파일의 기존 테스트(`grep -rln "setPlatformAdmin\|setWorkspaceRole\|upsertRosterMember" tests/actions` 의 결과) |
| 마감 | `scripts/e2e-synthetic.mjs`, `docs/baseline/{sp3a-e2e,synthetic-acceptance}.md` |

### 2.3 이어 고치는 파일·당겨 온 파일·UI 위험 파일

| 파일(주인) | 이어 고치는 Phase 와 내용 |
|---|---|
| 페이지 넷 `p/[projectId]/{agents,dashboard,wbs,settings}/page.tsx`, 라우트 다섯 `api/{export,report,import/inspect,import/execute}`·`api/v1/wbs/structure`(A) | B 가 관문 한 줄을 넣는다. C 가 설정 페이지를 범주 화면으로 다시 짠다 |
| 편집기 셋·`NewProjectModal.tsx`·사전 `settings*.ts`(A) | C 가 저장 바·충돌 비교·복사 선택과 새 문구를 더한다 |
| `src/app/actions/agentWork.ts`(B) | C 가 옛 토글 액션 둘을 지운다 |
| `tests/gates/manifest.ts`·`tests/invariants/module-page-gates.test.ts`(B) | C 가 `previewSettingsImpact`·`uploadBrandLogo`·`/api/brand` 와 제외 목록의 `w/[slug]/settings` 를, D 가 `listAuthzEvents` 를 등록한다 |
| `tests/actions/agent-work-actions.test.ts`(B), `tests/invariants/settings-writes.test.ts`(A) | C 가 옛 토글 액션의 케이스를 지운다. D 가 허용 목록에 `src/lib/authz/events.ts` 를 더한다 |
| `scripts/e2e-local.mjs`(A) | B 가 3~6단계를, C 가 7단계를, D 가 8단계를 더한다(§7.3) |
| `package.json`(A — `settings:verify`) | C 가 `catalog:write` 를, 마감이 `accept:synthetic` 을 더한다 |
| `docs/sp2-admin-client-audit.md`·`CLAUDE.md`(A) | B·C·D 가 새 service_role 파일의 행을 덧붙인다. B 가 CLAUDE.md 권한 절에 관문 문장을 더한다 |
| `src/app/(app)/w/[slug]/settings/**`(C) | D 가 '기록' 범주에 `AuthzEventList` 를 싣는다 |
| `tests/ui/projects-home.test.tsx`(A) | C 가 `/projects` 의 설정 링크와 마크 규칙을 바꾸며 고친다 |
| `docs/baseline/sp3a-ui.md`(A) | B·C·D 가 자기 눈확인 행을 덧붙인다(§7.5) |
| `src/lib/settings/catalog-meta.ts`(A) | C 가 키마다 `consumers`·`tests` 경로와 마감 상태를 채운다(§5.6) |

| 뒤 Phase 에 기대던 것 | 처리 |
|---|---|
| `registry.test` 가 보는 메뉴 id 24개, accent 파생, 로고 경로 판정, 사전 키, 모듈 플래그 술어 | A 로 당긴다: `src/lib/nav/ids.ts`, `accent.ts`·`accentTokens.ts`, `brandingPath.ts`, 사전 두 파일, `flags.ts` |
| `operational-env.test.ts` 와 `operational.ts` | C 로 옮긴다. env 판독부가 B(플래그 판독부 7파일)와 C(`fromName.ts`·`branding.ts`)에서 마지막으로 바뀐다 |
| `authz_events` 의 DB 테스트 | A 에 둔다(DB 객체와 같은 Phase) |
| `previewSettingsImpact`·`uploadBrandLogo`·`listAuthzEvents` | 액션 파일을 나눠 C·C·D 가 소유한다 |
| `settings:verify`, `catalog:write` | 처음 쓰는 A, C 에 둔다 |

- **UI 위험 파일**(`src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`)은 어느 Phase 도 건드리지 않는다. `createProject` 는 `(app)/layout.tsx:80` 의 주석에만 나온다. 설정 화면의 저장 바는 스크롤 영역 안 `sticky` 로 두고 `ProjectPageShell.tsx` 를 고치지 않는다. 구현 중 위험 파일을 고쳐야 하는 일이 생기면 멈추고 SP3b 로 넘긴다.
- 훅 G2 대상은 아니지만 **화면을 바꾸는 각 커밋**에 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 트레일러를 단다(체크포인트는 ff 라 머지 커밋이 없다). 기계로 볼 수 있게 범위를 파일로 정한다: `src/components/**`·`page.tsx`·`layout.tsx` 를 고친 커밋은 전부 트레일러를 갖는다. 화면이 달라지지 않는 커밋(관문 한 줄, import 교체)은 `Preview-checked: n/a — <사유>` 를 쓴다(`.githooks/pre-push:280` 의 예와 같은 꼴).
- dev 서버는 스크래치 워크트리에서 3101 포트로만 띄운다(성능 기준선의 `h2-done` 워크트리는 3102). 3000 포트와 메인 체크아웃은 쓰지 않는다.

## 3. Phase A — 저장·쓰기 계약·레지스트리·읽기(`0012_settings.sql`)

### 3.1 표·제약·정책·권한·트리거

정의의 정본은 개정 §2.2.1 이다. 아래는 그 위에 더하거나 고친 것이다.

| 객체 | 내용 |
|---|---|
| `project_settings` | `values`·`schema_version`·`revision` 추가(개정 정의). `updated_by` FK → `on delete set null`(D2). 넓은 열 13개와 check `project_settings_force_bottleneck_positive` 삭제. 읽기 정책 `project_settings_ws_read` 유지 |
| `workspace_settings` | 같은 세 열 + `updated_by uuid references auth.users(id) on delete set null`. `allowed_domains` 와 그 check 삭제. 정책 `workspace_settings_write` 삭제, authenticated 의 INSERT·UPDATE·DELETE 회수 |
| `agent_projects` | `created_by` FK → `on delete set null`(D2). 그 밖은 그대로(표 drop 은 SP7) |
| `project_settings_history` | 개정의 11열에서 `changed_by` 는 FK 없는 `uuid`(D3), `command_digest text` 추가(D8). 인덱스 `project_settings_history_key_idx (project_id, key, revision desc)`·`project_settings_history_command_idx (project_id, command_id)`, 유일 제약 `project_settings_history_rev_key_uq (project_id, revision, key)`. 읽기 정책 `project_settings_history_read` — `project_id in (select accessible_project_ids())` |
| `workspace_settings_history` | 같은 모양(`workspace_id`, `copied_from` 없음, `source` check 는 같은 다섯 값). 읽기 정책 `workspace_settings_history_read` — `(select is_ws_member(workspace_id))` |
| 권한(네 표) | D5. service_role 의 SELECT·INSERT·UPDATE·DELETE 는 남긴다(개정 S8) |
| 행 생성 트리거 | `projects_settings_row`(→ `ensure_project_settings_row()`), `workspaces_settings_row`(→ `ensure_workspace_settings_row()`). 개정 정의 그대로 |
| 행 유지 트리거(D7) | `project_settings_keep_row`·`workspace_settings_keep_row` BEFORE DELETE → `settings_row_keep()`. 부모 행이 없으면 통과 |
| 설정 이력 불변 트리거(D3) | `project_settings_history_worm`·`workspace_settings_history_worm` BEFORE UPDATE OR DELETE → `settings_history_reject_mutation()`, `55000 HISTORY_IMMUTABLE`. UPDATE 는 전부 거부, DELETE 는 부모 부재일 때만 통과 |
| 이력 세 표 TRUNCATE 거부 | `project_settings_history`·`workspace_settings_history`·`authz_events` 에 BEFORE TRUNCATE 문장 트리거 → `55000 HISTORY_IMMUTABLE`. 새 표는 기본 권한으로 service_role 에 TRUNCATE 를 받고(`pg_default_acl` 실측 `arwdDxtm`) TRUNCATE 는 행 트리거를 건너뛰기 때문이다. 기존 위키 리비전의 같은 틈은 SP3a 범위 밖이다 |
| 세션 insert 폐쇄(D6) | 정책 `wsadmin_insert_projects` 삭제, `revoke insert on public.projects from authenticated` |
| 잡 표 check(D16) | `ai_index_jobs`·`wiki_processing_jobs`·`wiki_project_rebuild_jobs` 의 status check 에 `'skipped'` 추가(제약 이름 유지) |
| 버킷(D19) | `storage.buckets` 에 `branding`(비공개, `file_size_limit` 262144, mime `image/png`·`image/jpeg`·`image/webp`). `storage.objects` 읽기 정책 `branding read` 하나 — `bucket_id = 'branding'`, 조각 수 4, 첫 조각 `ws`, 셋째 조각 `branding`, 둘째 조각이 uuid 꼴일 때만 캐스팅해 `is_ws_member` 에 넘긴다(`case` 로 감싼 캐스팅 — `uuid_or_null` 을 정책에서 직접 부르면 정책 INVOKER 불변식 `tests/rls/schema-invariants.test.ts:90-111` 에 걸린다). 쓰기 정책은 두지 않는다 |
| `authz_events` 와 그 트리거·RPC | §6 |

정책은 `project_ws` 를 직접 부르지 않고, 헬퍼 호출은 `(select …)` 로 감싸며, 읽기 정책에는 스코프 마커가 든다. 새 표는 같은 public 부모를 두 열로 가리키지 않는다. 값 스키마는 DB 에 두지 않는다(개정 §2.2.1 불변식). `values` 의 키는 점이 든 평면 문자열이고 SQL 은 `values->'<키>'` 로만 읽는다.

### 3.2 이행 순서·사전검사·사후검사·롤백

`0012` 는 절을 이 순서로 둔다. 정방향에 `begin`·`commit` 을 쓰지 않는다(CLI 가 파일을 한 트랜잭션으로 적용한다). 머리 주석은 0011 모양(요약·절 목록·롤백 경로)이다.

1. 사전검사 `SP3A_0012_PRECHECK` — 아래 표. 위반 행을 세어 목록(`left(…, 600)`)과 운영자 조치를 메시지에 적고 멈춘다. 조용히 보정하지 않는다.
2. 설정 두 표에 열 추가, `updated_by`·`created_by` FK 교체.
3. 누락 행 백필(개정 §2.2.1 의 두 insert). 로컬 DB 는 워크스페이스 3 대 설정 행 1 이다.
4. 설정 이력 두 표 생성. 이행이 이력을 쓰므로 5보다 앞이다.
5. 넓은 열 이행(개정 §2.2.2 표)과 이행 이력. 키마다 1행, `source='migration'`, `changed_by`·`command_digest` null, `command_id` 는 프로젝트·워크스페이스마다 하나, `revision = 1`(D4).
6. `apply_workflow_event` 의 판독 교체. 8인자 시그니처·INVOKER·`c_default` 선언(`0011:680`)·격리 검사(`0011:763-764`)를 그대로 두고 `create or replace` 한다. 행이 없으면 `P0001 SETTINGS_ROW_MISSING`, 키가 없으면 `c_default`, 잠금은 걸지 않는다(`FOR SHARE` 는 SP5b).
7. 넓은 열 drop.
8. 함수(§3.3).
9. 설정 표의 권한·정책·트리거(§3.1).
10. `authz_events` 와 그 불변 트리거·기록 트리거·정리 트리거·RPC(§6).
11. 버킷, 잡 표 check.
12. 종합 사후검사 `SP3A_0012_POSTCHECK`.

| 사전검사 | 멈추는 조건 | 운영자 조치 |
|---|---|---|
| 프로파일 모양 | `excel_profile` 이 객체가 아니다 | 그 행을 `'{}'` 로 고치고 다시 적용 |
| 크레딧 모양 | `stage_credits` 가 null 이 아닌데 객체가 아니거나 `default` 가 객체가 아니다 | null 로 고치고 다시 적용 |
| 단계 라벨 | `level_labels` 가 1~10개가 아니거나 빈 문자열·중복이 있다 | 라벨을 고치고 다시 적용 |
| 트리 깊이(§9 #1 이 기본값일 때만) | WBS 트리 깊이가 라벨 수보다 깊은 프로젝트가 있다 | 라벨을 더하고 다시 적용 |

- 이행 세부(개정이 말하지 않은 것): `extra_axis_label` null 은 키 없음. `milestone_keywords` 는 빈 배열이어도 **명시 `[]`** 로 옮긴다(지금의 "마커 0건"을 지킨다 — 제품 기본값이 6개로 바뀌므로 개정 §2.6.2 R2 에 해당). 값은 소문자로 정규화한다. `allowed_domains` 는 개정대로 빈 배열이면 키 없음이다. `modules.enabled`·`modules.allowed` 의 목록은 마이그레이션 SQL 의 리터럴이다(`kanban`·`meetings`·`weekly`·`issues`·`announcements`·`attendance`·`agents`·`wiki`·`chatbot` 9개, 워크스페이스는 여기에 `minutes`·`minutes_integration`·`portfolio`·`usage` 를 더한 13개). `tests/modules/registry.test.ts` 는 파일 본문의 리터럴을 테스트 안의 동결 목록과 대조하고, 레지스트리가 그 목록을 포함하는지 본다(SP5 가 모듈을 더해도 깨지지 않는다).
- 옮긴 값이 레지스트리 `parse` 를 통과하는지는 SQL 이 아니라 `npm run settings:verify`(`scripts/settings-verify.mjs` — 모든 설정 행을 해석기로 읽어 `invalid`·`required_missing` 키를 나열, 하나라도 있으면 종료 코드 1)로 본다. 리허설과 체크포인트에서 돌린다.
- 사후검사가 보는 것: 설정 행 1:1, 넓은 열 0, 모든 프로젝트 행에 `core.level_labels`·`modules.enabled`, 모든 워크스페이스 행에 `modules.allowed`, RLS 켜짐과 정책 수, 정책 없는 DML 0(`0011:952-960` 의 쿼리), anon·authenticated 의 TRUNCATE·TRIGGER·REFERENCES·MAINTAIN 실효 0, 새 트리거 존재·활성, 잠금 뒤 다른 행을 읽는 0012 함수 본문의 격리 검사 문자열, 0012 가 만든 **모든** 함수의 EXECUTE 기대표. `apply_workflow_event` 본문은 `select stage_credits` 가 없고 `workflow.stage_credits` 와 `WORKFLOW_EVENT_ISOLATION` 이 있다.
- 식별자에 `atomic` 접미사를 쓰지 않는다. `grep -niE "[a-z0-9_]*atomic\b" supabase/migrations/0012_settings.sql` 0건.
- **롤백**(D26)은 `begin … commit` 으로 감싸고 정방향의 역순이다. 되살리는 `apply_workflow_event` 본문은 0011 적용 DB 의 원문을 바이트 그대로 옮긴다. 열 순서·제약 이름·권한은 `critique-feasibility.md` "확인만 하고 문제없던 것"의 실측 목록을 롤백 머리 주석에 옮긴다(`stage_credits` 가 `updated_by` 뒤, FK 둘은 NO ACTION 으로, `project_settings` 는 authenticated `r`, `workspace_settings` 는 authenticated `arwd`, 둘 다 anon 없음). 정책 `wsadmin_insert_projects` 와 `grant insert on public.projects to authenticated` 를 되돌린다. 버킷은 `set local storage.allow_delete_query = 'true'` 뒤 `branding` 의 객체 행과 버킷 행을 지운다(0001 롤백 선례 — 파일 바이트는 Storage 에 남는다). 머리에 되돌리지 않는 데이터를 적는다: 두 이력 표, `authz_events`, 열이 없던 키(`modules.*`·`branding.*`·`navigation.menu`·`ai.enabled`), 명시 `invites.allowed_domains = []` 는 `'{}'`(env 폴백)로, `max_depth` 는 null 로, `skipped` 잡은 `dead_letter` 로 돌아간다.
- **리허설**: H2 계획의 R 절차를 0011→0012 로 바꿔 돌린다(`compare-catalog.mjs` 두 diff 불일치 0, 기본 권한 diff 없음, 롤백 뒤 재적용 성공). **분기** — 버킷 삭제가 `storage.protect_delete` 에 막혀 불일치 0 을 만들지 못하면 버킷을 `0012` 에서 빼고 로고 업로드(§5.4)를 SP3b 로 넘긴다. 그때 `branding.logo` 는 등록하되 편집기를 숨긴다. 재는 단계는 Phase A 의 커밋 ② 전 리허설이다.
- 데이터가 있는 업그레이드는 `supabase db reset --version 0011` → `0012_seed_wide.sql` → `supabase migration up --local` → `0012_smoke.sql` 순서다. 시드가 덮는 경우: 프로파일 있음·없음, 크레딧 있음·null, `agent_projects` 켜짐·꺼짐·행 없음, 도메인 목록 있음·빈 목록, 설정 행 없는 프로젝트와 워크스페이스.
- 사전검사는 경우마다 한 번씩 본다: `supabase db reset --version 0011` → `docker exec -i supabase_db_d-flow psql -U postgres -v ON_ERROR_STOP=1 -v case=<n> < supabase/rehearsal/0012_precheck_violations.sql`(그 경우의 위반 행을 심는다) → `supabase migration up --local` 이 `SP3A_0012_PRECHECK` 메시지로 멈추는지 확인. 경우는 넷이고 §9 #1 이 대안이면 셋이다.

### 3.3 쓰기 계약

| 함수 | 인자 | 반환(jsonb) | 개정에 더한 것 |
|---|---|---|---|
| `apply_project_settings` | 개정 §2.3.2 의 8인자 | `{status:'applied', revision}`·`{status:'applied', revision, changed:0}`·`{status:'duplicate', revision}` | 검사 순서는 잠금 → **격리 검사(D1)** → 중복(D8) → 세대 → 값 불변 → CAS → 참조 → 넘침 → 기록. 중복 조회는 `project_id`·`command_id`·`changed_by is not distinct from p_actor` 다. 요약이 같으면 `duplicate`, 다르면 `COMMAND_REUSED`. `p_set`·`p_unset` 이 null 이면 `'{}'` 로 본다. `p_set` 안의 JSON `null` 은 명시 값이고 키 없음이 미설정이다. `p_actor` 가 null 인데 `p_source` 가 `migration`·`internal` 이 아니면 `22023 SETTINGS_ACTOR_REQUIRED` |
| `apply_workspace_settings` | 같은 8인자(`p_workspace_id`) | 같음 | 참조 단계가 없다 |
| `settings_ref_check` | 개정 정의 | void | 본문 `return;`. SP3a 등록 키 가운데 참조형은 없다 |
| `create_project_with_settings` | `p_workspace_id uuid, p_name text, p_start_date date, p_end_date date, p_description text, p_values jsonb, p_copy_from uuid, p_actor uuid, p_command_id uuid, p_schema_version int` | `{status, project_id, revision:1}` | `p_actor` 가 null 이면 `22023 SETTINGS_ACTOR_REQUIRED`, `p_command_id` 가 null 이면 `22023 COMMAND_ID_REQUIRED`(둘 다 잠금보다 먼저 — null 키는 잠그지 않는다, §6 RPC 행) → `pg_advisory_xact_lock(hashtextextended('settings-create:' \|\| p_actor \|\| ':' \|\| p_command_id, 0))` → 격리 검사 → 중복 조회(그 워크스페이스의 프로젝트 이력 가운데 `command_id`·`changed_by = p_actor`·`source in ('create','copy')`) — 요약이 같으면 `duplicate`, 다르면 `COMMAND_REUSED` → `p_values` 에 `core.level_labels`·`modules.enabled` 가 없으면 `22023 CONFIG_INVALID:<키>` → `projects` insert → 설정 행 update → 키마다 이력(`create` 또는 `copy` + `copied_from`) → 복사면 `copy_project_config` |
| `copy_project_config` | `p_src uuid, p_dst uuid` | void | 두 프로젝트의 워크스페이스가 다르면 `42501 COPY_SOURCE_FORBIDDEN`, 대상에 영역이나 프로젝트 전용 팀이 이미 있으면 `23514 COPY_TARGET_NOT_EMPTY`. `project_areas`·`area_teams`·프로젝트 전용 `teams` 를 복사하고 영역-팀을 복사된 팀끼리 다시 잇는다. 값은 여기서 복사하지 않는다(아래) |

- **0012 의 모든 함수**는 `set search_path to ''`, `revoke all … from public, anon, authenticated` 다. SECURITY DEFINER 는 RLS 를 넘어야 하는 명령과 트리거 함수이고 `settings_ref_check` 만 INVOKER 다. 트리거 함수는 아무 롤에도 grant 하지 않는다. `grant execute … to service_role` 은 `apply_*`·`create_project_with_settings`·`copy_project_config` 와 §6 의 넷이다. authenticated 가 실행하는 새 함수는 0개다. 충돌에 SQLSTATE `40001` 을 쓰지 않는다(개정 §2.3.2).
- 참조 쓰기 쪽 잠금 규약(개정 §2.4.1)은 계약으로만 고정한다. 설정 쪽은 `FOR UPDATE` 뒤에 세고 참조 표는 잠그지 않는다. 뒤 SP 의 트리거가 설정 행에 `FOR SHARE` 를 걸 수 있도록 service_role 의 UPDATE 권한을 남긴다.
- 설정 RPC 는 호출자의 등급을 판정하지 않는다. 관문은 액션의 가드 하나다(개정 계약). 그래서 §4.3 의 deny 테스트가 설정 액션을 포함한다.
- **값 복사와 시드는 액션이 한다.** DB 는 값 스키마를 모르므로 `createProject` 가 원본을 해석기로 읽어 `set` 키 전부를 `p_values` 로 넘긴다. 원본에 `invalid` 키가 있으면 거부한다(D29). `modules.enabled` 는 대상 워크스페이스의 `modules.allowed` 와 다시 교집합한다(`src/lib/modules/saveRule.ts` 의 한 함수를 저장 검증과 같이 쓴다). `seedFrom` 키는 그 순간의 워크스페이스 값을 읽어 `map` 을 거쳐 넣는다. SP3a 등록 키에는 `seedFrom` 이 없다. SP5 는 `createProject` 의 복사 경로에 `calendar.week_start` 정규화를 더한다(`0012` 무변경).

**액션**(`src/app/actions/settings.ts` — async 함수와 타입만 export 한다. 상수는 `src/lib/settings/errors.ts`).

| 액션 | 가드 | 하는 일 |
|---|---|---|
| `updateProjectSettings(projectId, patch)` | `requireProjectAdmin` | 개정 §2.3.1 의 8단계. 같은 키가 `set` 과 `unset` 에 있으면 `CONFIG_INVALID`. `modules.enabled` 에 `agents` 가 더해지면 RPC 성공 뒤 `src/lib/modules/agentsSync.ts` 를 부른다(§4.4). 성공하면 `revalidatePath('/p/[projectId]', 'layout')` |
| `updateWorkspaceSettings(workspaceId, patch)` | `requireWorkspaceAdmin` | 같음. `def.editor === 'platform_admin'` 인 키는 가드가 돌려준 `actor.isSuperuser` 로 본다(`requireSuperuser()` 를 새로 부르지 않는다). `branding.logo` 의 경로는 둘째 조각이 `workspaceId` 와 같은지 여기서 본다(`parse` 는 문맥을 받지 않는다). 성공하면 `revalidatePath('/', 'layout')`(워크스페이스 전역 키가 `/p/*` 에도 적용된다) |
| `getSettingsCommandOutcome(scope, commandId)` | 스코프의 관리자 가드 | 이력에서 자기(`changed_by` = 행위자)의 `command_id` 를 찾아 `applied`(revision 포함) 또는 `unknown` |
| `listSettingsHistory(scope, { limit, before })` | 스코프의 관리자 가드 | 세션 클라이언트로 이력을 읽는다(D24) |
| `createProject(input)` — `src/app/actions/project.ts` | `requireWorkspaceAdmin(input.workspaceId)` | 인자는 객체(`workspaceId`·`name`·`startDate`·`endDate`·`description`·`levelLabels`·`copyFromProjectId?`·`commandId`). throw 대신 결과를 돌려준다. 보상 삭제(`project.ts:99-114`)와 `TODO(SP3)` 주석을 지운다 |

- `updateLevelSettings`·`updateStageCredits`·`clearExcelProfile` 은 삭제하고 컴포넌트가 `updateProjectSettings` 를 부른다(비우기는 `unset: ['wbs.excel_profile']`). 호출부와 그 테스트는 Phase A 가 함께 고친다(§2.2).
- 서버 내부 쓰기는 `src/lib/settings/write.ts` 의 `writeProjectSettingsInternal(admin, projectId, change, actorUserId)` 하나다. 방금 읽은 revision 으로 CAS 하고 충돌이면 한 번 다시 읽어 재시도한다(`source='internal'`).
- 자동 재기준은 개정 §2.3.1 ⑦ 그대로 한 번이다. 겹침 판정의 키 쌍은 `workflow.stage_credits`↔`workflow.credit_policy` 하나이고 SP3a 에서는 뒤 키가 없어 발동하지 않는다.
- 오류 모듈 `src/lib/settings/errors.ts` 는 개정 §2.3.4 의 코드 표와 DB 토큰 표를 **전부** 싣는다(뒤 SP 의 토큰 포함). DB 사유는 메시지의 첫 토큰(`:` 앞)으로 옮긴다. SP3a 가 더하는 토큰: `COMMAND_REUSED`(23505) → `CONFIG_INVALID` 422(문구 "같은 요청 번호로 다른 내용을 보냈습니다. 새로 고친 뒤 다시 시도하세요."), `COPY_SOURCE_FORBIDDEN`(42501) → `ERR_DENIED` 403. `COPY_TARGET_NOT_EMPTY`·`SETTINGS_ROW_REQUIRED`·`SETTINGS_ACTOR_REQUIRED`·`COMMAND_ID_REQUIRED`·`SETTINGS_ISOLATION`·`AUTHZ_EVENT_ISOLATION`·`HISTORY_IMMUTABLE` 은 표에 넣지 않는다 — 정상 경로에서 나올 수 없고, 표에 없는 토큰은 그대로 로깅하고 500 으로 드러낸다.

| 코드 | `SettingsCommandResult.kind` | retryable | UI `MutationResult`(개정 §5.8.2) |
|---|---|---|---|
| 성공 | `applied`·`duplicate` | — | `ok` |
| `CONFIG_INVALID`·`CONFIG_UNKNOWN_KEY`·`CONFIG_IN_USE`·`CONFIG_MODULE_NOT_ALLOWED` | `invalid` | false | `invalid`(`fieldErrors` 배열 → 키별 문구, `refCount` 는 문구에 넣는다) |
| `CONFIG_CONFLICT` | `conflict` | false | `conflict`(`latest.values`·`latest.revision`) |
| `ERR_DENIED` | `denied` | false | `forbidden` |
| `ERR_MODULE_DISABLED` | `denied` | false | `module_disabled` |
| `CONFIG_UNAVAILABLE`·`CONFIG_BUSY` | `unavailable` | true | `failed` |
| `CONFIG_SCHEMA_AHEAD`(넘침 포함) | `schema_ahead` | false | `failed` |
| 표에 없는 오류 | throw | — | 오류 경계 |

### 3.4 옮기는 읽기·쓰기 경로(실측 `00bfe8c`)

| # | 지금 | SP3a 뒤 |
|---|---|---|
| W1 | `src/app/actions/project.ts:92-98` `createProject` — 두 문장, 보상 삭제 | `create_project_with_settings` |
| W2 | `project.ts:176-182` `updateLevelSettings` | 삭제 → `updateProjectSettings`(`core.level_labels`). 트리 깊이 선행 조회는 `validateConfig` 의 `deps` 로 남는다 |
| W3 | `project.ts:199-204` `updateStageCredits` | 삭제 → `workflow.stage_credits` |
| W4 | `project.ts:220-225` `clearExcelProfile` | 삭제 → `unset` |
| W5 | `src/app/api/import/execute/route.ts:187-194` 프로파일 저장, 실패는 로그만 | `writeProjectSettingsInternal`. 실패하면 응답에 `profileSave: { ok:false, code, error }` 를 싣고 `ImportWizard` 가 경고로 보인다(가져오기 자체는 성공) |
| W6 | `src/lib/agent/wbsImport.ts:226-229` 레벨 시드 | `writeProjectSettingsInternal` |
| R1 | `src/lib/data/projectConfig.ts:35-57`(importer `src` 13·`tests` 14) | 파일 삭제 → `src/lib/settings/projectConfig.ts`. `/api/export` 의 422(프로파일 손상)와 409(펼침 내보내기에 프로파일 없음 — `CONFIG_REQUIRED`)는 그대로다 |
| R2 | `src/app/actions/wbsMarkdown.ts:90-91` | `getProjectConfig(projectId, { client: admin })` |
| R3 | `src/app/api/v1/wbs/structure/route.ts:46-48` | 같음. 응답 필드 `levels`·`max_depth` 는 유지한다(외부 스킬 계약). `max_depth` 값은 `levelDepthOf`(§9 #1) |
| R4 | `src/lib/agent/wbsImport.ts:200-201` | 같음 |
| R5 | `scripts/e2e-local.mjs:205,209` | 객체 인자 `createProject`, `values->'core.level_labels'` |
| R6 | `apply_workflow_event`(`0011:873`) | §3.2 의 6 |
| R7 | `src/lib/data/inviteDomains.ts:17-18` | `getWorkspaceConfig(workspaceId, { client: admin })`. 조회 실패와 `invalid` 는 `{ ok:false }`(env 로 넘어가지 않는다). `source` 는 `'workspace'`·`'env'`·`'product'` |
| R8 | `src/lib/repositories/supabase/settings.ts:68-76` 래퍼 | 새 해석기를 감싼다. `ConfigUnavailableError` → `PROJECT_SETTINGS_READ_FAILED`. `:13` 의 `updated_at` 을 뺀다(E30) |

grep 게이트(개정 §2.11 ⑦)는 `tests/invariants/settings-writes.test.ts` 다. `from('project_settings')`·`from('workspace_settings')`·두 이력 표·`from('authz_events')` 가 닫힌 허용 목록 밖에서 0건이어야 한다. 허용 목록(사유 필수): `src/lib/settings/projectConfig.ts`·`workspaceConfig.ts`(읽기), `write.ts`(revision 판독), `history.ts`(이력 읽기), `src/lib/authz/events.ts`(권한 이력 읽기 — Phase D 가 목록에 더한다), `scripts/dev-bootstrap.mjs`·`scripts/e2e-local.mjs`·`scripts/settings-verify.mjs`(읽기). 목록에 있고 실제로 쓰지 않는 파일도 실패다.

### 3.5 읽기 경로

상태 여덟 가지와 stale 규칙은 개정 §2.5 가 정본이다.

| 이름 | 파일 | 뜻 |
|---|---|---|
| `ProjectSettingKey`·`WorkspaceSettingKey`·`SettingKey`·`SettingValue<K>` | `registry.ts` | 등록 목록(`as const`)에서 유도한 키 유니온과 값 타입 |
| `ConfigReadClient` | `projectConfig.ts` | `Pick<SupabaseClient, 'from'>`. 세션 없는 경로는 `adminFor({ projectId }).admin` 을 넘긴다 |
| `getProjectConfig(projectId, opts?)` | `projectConfig.ts` | 모듈 수준 `const loadCached = cache(load)` 를 두고 래퍼가 `loadCached(projectId, opts?.client)` 를 부른다. 조회는 셋 — `project_settings ⨝ projects(workspace_id)`, `project_areas ⨝ area_teams`, `teams`. `calendar` 필드는 SP5 Phase A 가 더한다 |
| `getWorkspaceConfig(workspaceId, opts?)`·`WorkspaceConfig` | `workspaceConfig.ts` | `{ workspaceId, revision, schemaVersion, schemaAhead, keys, unknownKeys }`. 배포 기본값 env 세 개는 이 파일에서 읽는다(`NEXT_PUBLIC_BRAND_NAME` 은 공개 화면용으로 `src/lib/branding.ts` 도 — §5.7) |
| `valueOf` | `registry.ts` | 두 config 에 대한 오버로드. `invalid` → `ConfigKeyError('CONFIG_INVALID', key)`, `required_missing` → `ConfigKeyError('CONFIG_REQUIRED', key)` |
| `levelDepthOf(cfg)` | `projectConfig.ts` | 옛 `maxDepth` 의 후계. 라벨 수를 돌려준다(기본값 — 사용자 확인 항목(§9 #1)) |

- 화면별 해석은 개정 §2.1 이다: `/p/*` 는 프로젝트 키만, `/w/*` 는 워크스페이스 키만 읽고, 워크스페이스 전역 키의 닫힌 목록만 모든 화면에 적용된다. 개인 설정은 서버의 업무 계산·권한·필수 입력 검증에 들어가지 않는다. 포트폴리오는 프로젝트별 마일스톤 키워드를 읽지 않고 레지스트리의 제품 기본값으로 판정한다(기본값 — 사용자 확인 항목(§9 #16)).
- fail-closed 대상은 `modules.*`·`ai.enabled`·`invites.allowed_domains` 다(읽기 실패·손상이면 거부). 업무 계산 키는 거부가 아니라 오류 표시로 가고 그럴듯한 값으로 계속하지 않는다. `branding.*` 는 표시 폴백을 쓴다(D39).
- 설정 행 0건·조회 오류는 전체 throw(`ConfigUnavailableError`)다. 기본값으로 채우지 않는다. 옛 `DEFAULT_PROJECT_CONFIG` 폴백에 기대던 호출부는 이렇게 바뀐다: 페이지는 편집기·목록을 그리지 않고 "설정을 불러오지 못했습니다" 상태를 보인다, 라우트는 503, 봇 저장소는 R8. 포트폴리오는 프로젝트 설정을 읽지 않게 된다(§9 #16 의 기본값).
- parse 실패는 그 키만 `invalid` 다. 요청마다 키당 한 번 `console.error('[settings] invalid', { scope, id, key, error })` 를 남긴다(표시 = 로깅). 화면 표시 자리는 §5.3.
- 미등록 저장 키는 `unknownKeys` 에 담고 읽기에서 무시한다. `RETIRED_KEYS` 는 빈 목록으로 시작한다(개명된 네 키는 저장된 적이 없다). 미등록 키를 지우는 경로는 두지 않는다.
- `milestone_keywords` 의 소문자 정규화는 `parse` 로 옮긴다.
- `invites.allowed_domains`(D40): 실측한 현행 의미는 "유효 목록이 비면 아무도 초대할 수 없다"이다(`isAllowedInviteDomain` 은 빈 목록을 전부 거부 — `src/lib/domain/invites.ts:80-86`). 새 계약도 같다: 명시 `[]` 는 초대 불가, 미설정만 env 로 넘어간다(개정 §2.5 상태 2). `['*']` 단독은 제한 없음이다(정본 §3.3.2). 편집기는 "기본값으로"(미설정 → env)와 "목록 비우기"를 따로 준다. 퓨니코드 변환은 저장값과 비교하는 메일 주소의 호스트 양쪽에 건다.
- 캐시는 요청 범위의 `react` `cache` 하나다. 프로세스 전역 캐시를 만들지 않는다(`project-isolation` 테스트가 `src/lib/settings/**` 에 모듈 수준 `Map`·전역 캐시가 없음을 본다). 요청 밖 캐시를 만들게 되면 키에 `(workspaceId, projectId, revision)` 을 넣는다. admin 클라이언트는 호출마다 새 객체라 세션 없는 경로는 캐시를 공유하지 않는다.
- 워커는 잡마다 설정을 새로 읽는다. 설정 행 0건이면 그 잡을 실패로 기록한다(`last_error = 'CONFIG_UNAVAILABLE'`). `settings_revision` 기록은 SP5 다(D37).
- 해석기 파일은 `@/lib/modules` 의 값을 import 하지 않는다(타입 import 만). `tests/modules/registry.test.ts` 가 단언한다.

### 3.6 레지스트리와 등록 키

`SettingDef`(필수 10 + 선택 4)·`SettingScope`·`SettingEditor`·`ApplyTiming`·`DataImpact`·`REQUIRED_ON_CREATE` 는 개정 §2.6.1 이 정본이고, `SettingWidget` 6종은 `정본@31878b1:1113-1119` 다. 필드는 필수 `key`·`scope`·`module`·`default`·`parse`·`widget`·`editor`·`apply`·`impact`·`sql`, 선택 `deployDefault`·`seedFrom`·`edit`·`reindexOn` 이다. 달라지는 것은 `EditCtx`(D14)뿐이다.

- 등록: 정의는 `src/lib/settings/defs/workspace.ts`·`project.ts` 에 두고 `registry.ts` 가 `WORKSPACE_SETTINGS`·`PROJECT_SETTINGS`·`settingDef(scope, key)` 를 낸다. 같은 이름이 두 스코프에 있을 수 있어 찾기는 늘 스코프와 키다. `ModuleDef.settings` 는 이 정의를 참조한다(모듈 → 설정은 값 import, 설정 → 모듈은 타입 import).
- 라벨·설명은 i18n 키 `settings.<key>.label`·`.desc` 다. 소비처·테스트·상태는 `catalog-meta.ts` 에 둔다(`PLANNED_KEYS` 는 뒤 SP 의 키를 표시 열과 함께 글로 갖는다).
- `SETTINGS_SCHEMA_VERSION = 1`. 변경 규칙 R1~R6 은 개정 §2.6.2. 저장본의 세대가 코드보다 크면 읽기는 아는 키만, 쓰기는 `CONFIG_SCHEMA_AHEAD` 다.
- 로드 단언 `assertRegistry()`(모듈 로드 때와 `tests/settings/registry.test.ts`): 키는 정확히 `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`(아니면 throw), 스코프 안 유일, `deployDefault` 는 세 키에만, `impact` 는 비지 않음, 기본값이 자기 `parse` 를 통과, `module` 이 모듈 목록에 있음, `seedFrom.key` 가 워크스페이스 목록에 있음, 은퇴 키와 등록 키가 겹치지 않음. 두 사전에 라벨·설명 키가 있는지는 테스트가 본다.

값 형태·기본값·검증의 정본은 개정 §2.8.1·§2.8.2 다. 14키 모두 `apply: 'immediate'` 이고 `seedFrom`·`reindexOn` 을 쓰는 키는 없다. 마감 상태가 `verified` 가 아닌 키는 개정 §2.8 의 SP 열이 소비를 뒤 SP 로 나눈 키다 — 네 연결 원칙(개정 §6.1)의 명시된 예외이고 그 SP 가 `verified` 로 올린다.

| 키 | 스코프·편집 | 모듈 | widget | 비고 | 화면 범주 | 마감 상태 |
|---|---|---|---|---|---|---|
| `modules.allowed` | W·플랫폼 관리자 | `settings` | custom `ModuleAllowEditor` | impact recompute | 모듈·AI | `verified` |
| `ai.enabled` | W·워크스페이스 관리자 | `settings` | boolean | 소비는 `effectiveModules`·`aiAvailable` | 모듈·AI | `verified` |
| `invites.allowed_domains` | W·워크스페이스 관리자 | `settings` | text_list | `deployDefault` `INVITE_ALLOWED_DOMAINS`. 검증은 D40 | 초대 | `verified` |
| `branding.product_name` | W·워크스페이스 관리자 | `settings` | text(40) | `deployDefault` `NEXT_PUBLIC_BRAND_NAME`. 1~40자, 제어 문자(U+0000~U+001F·U+007F) 금지. 소비 범위 D35 | 일반 | `stored` |
| `branding.logo` | W·워크스페이스 관리자 | `settings` | custom `LogoEditor` | `parse` 는 경로 형태만 본다(정확히 `ws/<uuid>/branding/<slot>-<16자>.<png·jpg·webp>`, `slot` 은 셋 가운데 하나, 아니면 거부). 자기 워크스페이스인지는 액션이 본다(§3.3). 파일 검증은 업로드 액션 | 일반 | `stored` |
| `branding.accent` | W·워크스페이스 관리자 | `settings` | custom `AccentEditor` | `edit`(D14). `parse` 는 정확히 `{ base, light, dark }`, 두 세트는 정확히 여섯 키, 모든 값이 `^#[0-9a-f]{6}$`. `edit.parseInput` 은 `^#[0-9a-fA-F]{6}$` 하나 또는 `null` | 일반 | `stored` |
| `branding.mail_from_name` | W·워크스페이스 관리자 | `settings` | text(40) | `deployDefault` `MAIL_FROM_NAME`. 1~40자, 줄바꿈을 포함한 제어 문자 금지. 기본값은 `null` 이고 소비처가 제품명으로 푼다(기본값 — 사용자 확인 항목(§9 #4)) | 일반 | `verified` |
| `navigation.menu` | W·워크스페이스 관리자 | `settings` | custom `MenuOrderEditor` | 검증은 `src/lib/nav/ids.ts` 의 id 목록(§4.5). 소비는 SP3b(기본값 — 사용자 확인 항목(§9 #6)) | 메뉴 | `stored` |
| `core.level_labels` | P·프로젝트 관리자 | `wbs` | custom `LevelSettingsManager` | `REQUIRED_ON_CREATE`. 교차: 트리 깊이. 검토 단계 없음(D34) | 일반 | `verified` |
| `core.extra_axis_label` | P·프로젝트 관리자 | `wbs` | text(20) | 소비처 0건. 목차에서 숨긴다(기본값 — 사용자 확인 항목(§9 #8)) | 일반 | `stored` |
| `core.milestone_keywords` | P·프로젝트 관리자 | `wbs` | text_list | 기본값은 `project.ts:58` 의 6개를 레지스트리로 옮긴다. impact recompute | 일반 | `verified` |
| `wbs.excel_profile` | P·프로젝트 관리자 | `wbs` | custom `ExcelProfilePanel` | 기본값 `null`(저장값은 프로파일만). 교차: `teamColumns` ⊆ 팀 코드, `'*'` 항목은 검사에서 뺀다. 표준 레이아웃은 SP4 | 일반 | `stored` |
| `modules.enabled` | P·프로젝트 관리자 | `settings` | custom `ModuleToggleEditor` | 생성 때 늘 명시 기록. impact recompute | 모듈·메뉴 | `verified` |
| `workflow.stage_credits` | P·프로젝트 관리자 | `wbs` | custom `StageCreditSlider` | `sql.readers: ['apply_workflow_event']`. `parse` 는 정책 `{ step: 5, min_gap: 10 }` 을 인자로 받는 자리만 만든다(SP5b 가 주입). impact future_only | 상태·승인 | `wired` |

### 3.7 부트스트랩

`scripts/dev-bootstrap.mjs` 는 계정을 만든 **뒤** 워크스페이스 설정 행의 revision 을 읽고 `apply_workspace_settings` 로 `modules.allowed` 를 기록한다(`p_source = 'internal'`, `p_actor` = 방금 만든 계정). 값은 env `BOOTSTRAP_MODULES`(쉼표 목록)이고 없으면 비core 13개 전부다. 빈 문자열은 `[]`(core 만)다. 목록 밖 id 가 있으면 허용 id 를 보여 주고 멈춘다. 파싱은 `scripts/lib/bootstrap-modules.mjs` 의 순수 함수다(D27).

- 스크립트는 같은 이메일로 다시 돌리면 계정 생성에서 멈춘다(`scripts/dev-bootstrap.mjs:47-48`). 이미 만든 DB 의 허용 모듈을 바꾸는 길은 워크스페이스 설정 화면(Phase C)이거나 `db:reset` 뒤 다시 돌리는 것이다.
- `scripts/e2e-local.mjs` 가 만드는 워크스페이스 B(`:403-407`)는 만든 직후 플랫폼 관리자 세션의 `updateWorkspaceSettings` 로 `modules.allowed` 를 비core 13개로 기록한다. 그러지 않으면 Phase B 뒤 B 의 `/minutes`·`/api/v1/minutes/meta` 단계가 닫힌다.
- `scripts/perf-baseline.mjs` 의 PERF 프로젝트(`:109-116`)는 `create_project_with_settings` 로 만든다(단계 라벨과 `modules.enabled` 명시).
- CI 의 `db` 잡은 부트스트랩 없이 `test:rls` 를 돌리므로 테스트는 픽스처가 만든 행에만 기댄다.

### 3.8 H2 가 남긴 규칙을 0012 가 따르는 방식

개정 §6.2.0 "H2 구현 결과" 표의 규칙 가운데 뒤 마이그레이션에 걸리는 것과 이 문서의 자리다.

| H2 규칙 | 0012 에서 |
|---|---|
| 새 함수의 EXECUTE 는 명시적으로 회수한다(A4, `0011:910-911`) | §3.3 의 공통 규칙. 사후검사가 0012 의 모든 함수를 기대표로 본다 |
| 사후검증은 실효 권한으로 본다(A9) | §3.2 사후검사 — `has_*_privilege` 로 PUBLIC·상속을 포함해 본다 |
| 잠금 뒤 다른 행을 읽는 가드는 격리 수준을 검사한다(A6) | D1. 다시 쓰는 `apply_workflow_event` 는 `WORKFLOW_EVENT_ISOLATION` 을 잇는다. 상시 보호는 `25001` 을 기대하는 `tests/rls` 케이스다(`settings-lifecycle`·`authz-events`, 기존 `workflow-parity`) |
| 마지막-행 가드는 advisory 잠금을 쓴다(a, `0011:30`) | 생성 RPC 와 권한 RPC 가 명령 id 에 `pg_advisory_xact_lock` 을 건다. 키는 접두 문자열(`settings-create:`·`authz:`)로 기존 키와 겹치지 않는다 |
| 세션 경로의 부여자는 가드가 찍고, 세션 사용자가 `auth.users` 에 있을 때만(A8) | §6 의 `invited_by` 도장과 행위자 규칙 |
| (H2 이월) 격리 스캔의 update 탐침 | `tests/rls/workspace-isolation.test.ts`(`:114-115`)를 Phase A 가 고친다. 탐침은 PK 가 아니라 authenticated 가 열 UPDATE 권한을 가진 첫 열을 고른다. 그런 열이 없는 표는 42501 을 기대값으로 단언하고 표 이름을 출력해 목록으로 고정한다(목록은 `has_any_column_privilege` 실측과 같아야 한다). 그 표들의 격리는 읽기 탐침과 `settings-isolation`·`authz-events` 의 B 계정 케이스가 본다 |

## 4. Phase B — 모듈·게이트·`navFor`

모듈 레지스트리·`effectiveModules`·`saveRule`·`flags.ts` 는 Phase A 가 만든다(§2.2). 이 절의 B 몫은 관문·`requireModule`·소비처 배선·`navFor` 다. **모듈 관문은 화면과 기능을 닫는다. 읽기 권한을 거두지 않는다** — 멤버가 RLS 로 읽을 수 있는 행은 모듈이 꺼져도 PostgREST 와 Realtime 으로 읽힌다. 접근을 거두는 것은 역할 변경이다.

### 4.1 모듈 레지스트리·`effectiveModules`·`requireModule`

- `src/lib/modules/registry.ts` 는 정적 목록이다(정본 §3.2.1 의 10필드, `nav` 형태만 개정 §5.3.5). 내용은 정본 §3.2.2 표에서 `issue_analysis` 를 뺀 17개다(E16). `requires` 와 core 의 `envAvailable` 단언은 개정 §2.7.1 아래 문단 그대로 `tests/modules/registry.test.ts` 에 둔다.
- 경로 이동 전이므로 워크스페이스 스코프 모듈은 지금 경로도 갖는다. `LEGACY_GLOBAL_PREFIXES`(`/meetings` → `meetings`, `/minutes` → `minutes`, `/agents` → `agents`, `/portfolio` → `portfolio`, `/usage` → `usage`)를 `registry.ts` 에 두고 SP3b 가 경로를 옮기며 지운다.
- `effectiveModules` 는 개정 §2.7.1 본문이다. 상수는 `PROJECT_TOGGLABLE`(9개)·`WORKSPACE_SCOPED`(4개)·`AI_MODULES`·`OFF_ON_CREATE = []`(`defaults.ts`). 저장 규칙 세 갈래(개정 §2.7.3)와 "새로 추가된 id" 검사는 `saveRule.ts` 한 곳이다.
- `requireModule(scope, moduleId, opts?: { client?: ConfigReadClient })`. `{ projectId }` 면 `getProjectConfig` 가 돌려준 `workspaceId` 를 쓴다(E12). 예외는 전부 `[requireModule]` 로그 뒤 `ERR_MODULE_DISABLED` 다(fail-closed). `ERR_MODULE_DISABLED` 는 `src/lib/authz/errors.ts` 에 더하고 `denyStatus` 가 404 로 옮긴다(정본 §3.2.4).
- 환경에서 꺼진 모듈을 `modules.enabled` 에 더하는 것, `requires` 가 빠진 `modules.allowed` 는 저장을 막지 않는다(개정 §2.7.2 가 막는 것은 `modules.enabled` 의 닫힘뿐이다). 런타임 닫힘이 빼고 화면이 이유를 적는다.
- `wiki`·`chatbot` 의 `envAvailable` 은 정본 §3.2.2 대로 `WIKI_SERVICE_ENABLED`·`CHAT_V2_ENABLED` 다. 플래그가 없는 배포에서는 두 모듈의 화면과 API 가 404 가 되고 옛 챗 라우트도 닫힌다(기본값 — 사용자 확인 항목(§9 #5)). `npm run env:local`(`scripts/env-swap.mjs`)이 로컬 `.env.local` 에 모듈 플래그 8개를 `true` 로 쓴다.
- 하위 기능 플래그는 `src/lib/modules/flags.ts` 의 이름 있는 술어(`chatPlannerEnabled`·`chatLlmSynthesisEnabled`·`chatIndexWorkerEnabled`·`wikiWorkerEnabled`)로 읽고 `envAvailable` 도 이 파일의 술어를 부른다. B 가 기존 판독부 7파일을 이 술어로 바꾼다.
- `aiAvailable({ workspaceId, projectId? })`(D17)는 `hasLLM()` ∧ `ai.enabled` ∧ 모듈 판정이다. `hasLLM()` 직접 호출은 `provider.ts`·`health.ts` 둘만 남는다(정본 §5.4.5).

### 4.2 관문 배치

여러 워크스페이스·프로젝트에 걸친 호출은 **대상 행의 프로젝트·워크스페이스**로 판정한다. 목록형 응답은 모듈이 꺼진 프로젝트의 행을 뺀다.

| 소비처 | 관문 | 꺼졌을 때 |
|---|---|---|
| `/p/[projectId]/<조각>/**/page.tsx` | 페이지 첫머리에서 `await requireModulePage({ projectId }, id)`(`src/lib/modules/pageGate.ts`). 모듈은 `routePrefixes` 로 정해진다. 어느 모듈에도 속하지 않는 조각은 불변식이 실패시킨다. 프로젝트 레이아웃(`TeamsProvider` 주입 포함)은 고치지 않는다 | `notFound()` |
| 전역 경로 다섯(`/meetings`·`/minutes`·`/agents`·`/portfolio`·`/usage`) | 같은 관문을 `{ workspaceId }` 로. 대상 행이 있는 페이지(`/minutes/[id]`)는 그 행의 워크스페이스, 없는 페이지는 `resolveSoleWorkspaceId`. 그 함수가 `ok:false`(소속 0개 또는 2개 이상 — `src/lib/authz/workspace.ts:11-17`)면 닫는다. `/meetings` 목록은 회의 모듈이 꺼진 프로젝트의 행을 뺀다 | `notFound()` |
| 공유 링크 `/share/minutes/[token]` | 토큰으로 행을 찾은 뒤 `requireModule({ workspaceId: 행의 워크스페이스 }, 'minutes', { client: admin })` | `notFound()` |
| 서버 액션 | 권한 가드 → `requireModule` → 본문(정본 §3.2.4 순서). `module: null` 인 액션은 부르지 않는다 | `{ ok:false, error: ERR_MODULE_DISABLED }` |
| 세션 API 라우트 | 같은 순서 | 404 |
| 에이전트 API(`/api/v1/agent/*`·`/api/v1/wbs/*`, 개인 토큰) | 정본 §3.2.4 의 세 단계. 킬스위치는 지금 자리(E15). 자격 확인 뒤 대상 프로젝트로 `requireModule(…, { client: admin })`. 목록(`me`·`work/mine`)은 `agents` 가 유효한 프로젝트만 싣는다 | 404, 목록은 그 행 생략 |
| 회의록 업로드 API(`/api/v1/minutes/*`, 배포 비밀) | 쓰기는 대상 행의 워크스페이스(와 프로젝트)로 판정한다. `meta` 목록은 `minutes_integration` 이 유효한 워크스페이스의 행만 싣는다. 대상도 유일 워크스페이스도 없으면 닫는다 | 409 `module_disabled` |
| 봇 | 요청마다 도구 등록 전에 거른다. 페이지 문맥에 프로젝트가 있으면 그 프로젝트로 판정한다. 없으면("전체 프로젝트") 도구마다 `allowedProjectIds` 를 그 도구의 도메인 모듈과 `chatbot` 이 유효한 프로젝트로 거르고, 거른 목록이 비면 그 도구와 capability 를 등록하지 않는다 | 도구 미등록 |
| 워커 | 정본 §3.2.7 규칙 2·3·5. 전역 열거는 워크스페이스 → 프로젝트 순으로 유효한 것만, 잡 큐는 잡마다 판정 | 건너뜀 + 로그 1줄 + `skipped`(D16) |
| 챗 위젯 | `AssistantChat` 이 `/api/chat/context` 의 404 를 받으면 스스로 그리지 않는다. 옛 챗 라우트 네 개도 `chatbot` 관문을 지난다 | 위젯 없음 |
| `/api/shell` | core 허용 목록에 남긴다. 안에서 부르는 액션이 각자 관문을 지나 그 항목만 비운다 | 해당 값 생략 |

- 워커 규칙 1(인증 통일·시크릿 두 개 삭제·라우트 흡수·잡 레지스트리)은 SP8 이다(§10).
- `tests/invariants/module-page-gates.test.ts` 는 `src/app` 아래 **모든** `page.tsx` 를 본다. 페이지는 자기 모듈 id 로 관문을 부르거나 닫힌 제외 목록(사유 필수)에 있어야 한다. 제외 목록은 `login`·`invite/[token]`·루트 `page.tsx`·`(app)/account`·`(app)/admin/*` 셋·`(app)/projects` 와 Phase C 가 더하는 `(app)/w/[slug]/settings` 다.

### 4.3 열거 게이트

파일은 정본 §6.5.3 의 셋(`tests/gates/manifest.ts`·`enumerate.test.ts`·`deny.test.ts`)이다.

| 항목 | 내용 |
|---|---|
| 열거 | `tests/invariants/_walk.ts` 와 `use-server` 판별을 재사용한 정적 AST. 액션은 `'use server'` 모듈의 `export async function`(지금 173개·34파일), 라우트는 `src/app/api/**/route.ts` 41파일의 함수 핸들러 44개. 수는 테스트에 박지 않고 실행 때 센다. 인라인 `'use server'` 와 default export 는 0건이어야 한다(D18) |
| 매니페스트 항목 | `{ guard, module, note? }`. `guard` 는 정본의 일곱 값 + `'session'`(로그인만 확인하고 자기 헬퍼로 판정 — `note` 필수) + `'minutesSecret'`. `module` 은 `ModuleId`·목록·`null` |
| const 스텁 | `/api/v1/**` 15파일의 `export const <METHOD>` 74개는 항목이 아니다. 64개는 `apiNotFound` 나 그 별칭이고 10개는 인라인 클로저다(E17). 테스트는 두 모양을 다 찾아 **호출하면 404 `not_found` 를 돌려주는지** 단언한다 |
| deny | 가드 mock 이 거부하면 admin 클라이언트 미호출·거부 응답. `module` 이 있는 항목은 `requireModule` mock 이 거부하면 거부·404. `module: null` 항목은 `requireModule` 을 부르면 실패. 회의록 `meta` 는 두 워크스페이스에 속한 행위자와 한쪽만 허용된 경우를 본다 |
| 닫힌 목록 | `public`·`cronSecret`·`session`·`minutesSecret` 항목은 사유와 함께 별도 목록. core 허용 경로는 `/api/prefs`·`/api/shell`·`/api/cron/inbox-retention` 과 Phase C 가 더하는 `/api/brand`. `/api/v1/**` 파일은 core 모듈의 `apiPrefixes` 에 걸리지 않는다 |
| 뒤 SP | 매니페스트에 없는 새 액션은 CI 가 막는다(D38) |

### 4.4 에이전트 사용 여부의 두 원천

규칙은 개정 §2.2.2 다. `agent_projects` 를 읽는 곳은 아홉이다. 옛 토글의 둘(`actions/agentWork.ts:42-51`·`:68`)을 뺀 일곱(`externalApi.ts:49-54`, `mineShared.ts:13`, `api/v1/agent/me/route.ts:33-34`, `delegation.ts:81`, `ensureOrder.ts:19-24`·`:132-144`, `agentHub.ts:33`)에 B 가 `effectiveModules ∋ 'agents'` 를 AND 로 건다.

- 동기화는 `src/lib/modules/agentsSync.ts`(A) 하나다. `modules.enabled` 에 `agents` 를 더한 저장이 성공하면 `agent_projects` 를 맞추고(행이 없으면 insert, `enabled=false` 면 true) 옛 토글이 하던 `backfillProjectOrders` 를 돌린다. 어느 쪽이든 실패하면 오류를 보이고 게이트는 닫힌 채다.
- `agents` 를 뺄 때는 `agent_projects` 를 고치지 않는다. `ensureOrder` 의 자동 생성은 남고 `enabled=false` 행을 되살리지 않는다(사람이 멈춘 것은 위임이 되살리지 못한다).
- 옛 토글은 Phase C 까지 남는다(D41). B 는 `setAgentProjectEnabled` 가 `writeProjectSettingsInternal` 로 `modules.enabled` 의 `agents` 를 더하거나 빼고 같은 동기화를 부르게 고친다. 끄는 쪽은 지금처럼 `agent_projects.enabled = false` 도 쓴다. C 가 `ModuleToggleEditor` 를 내면서 `setAgentProjectEnabled`·`getAgentProjectState`·`AgentProjectToggle.tsx` 를 지우고 `HubStatusBar` 는 상태와 "프로젝트 설정 → 모듈·메뉴" 링크만 보인다.
- 에이전트 페이지(`/p/<id>/agents/**`·`/agents`)는 §4.2 의 관문을 지난다. `workflow.stage_credits` 편집기는 `agents` 가 꺼져도 남고 "에이전트 모듈이 꺼져 있습니다"를 보인다(정본 §3.3.1).

### 4.5 `navFor`

시그니처와 규칙은 개정 §5.3.5 다. id 목록은 `src/lib/nav/ids.ts`(A), `navFor` 와 `SHELL_NAV`·`NAV_NEEDS` 는 `src/lib/nav/registry.ts`(B)다. 순수하고 권한을 판정하지 않는다. Sidebar·HeaderChrome·브레드크럼·사용 현황 키·봇 경로의 소비는 SP3b 다(§10).

| 그룹 | id(출처) | 필요 caps |
|---|---|---|
| `ws.main` | `ws.home`·`ws.my_work`·`ws.projects`(셸) | — |
| `ws.shared` | `ws.meetings`(`meetings`)·`ws.minutes`(`minutes`)·`ws.agents`(`agents`) | — |
| `ws.ops` | `ws.portfolio`(`portfolio`)·`ws.usage`(`usage`)·`ws.members`·`ws.teams`·`ws.settings`(셸) | 차례로 `canViewPortfolio`·`canViewUsage`·`isWorkspaceAdmin`·`isWorkspaceAdmin`·`isWorkspaceAdmin` |
| `ws.platform` | `ws.llm`·`ws.ui_states`(셸) | `isPlatformAdmin` |
| `p.overview` | `p.dashboard`(`dashboard`) | — |
| `p.plan` | `p.wbs`(`wbs`)·`p.issues`(`issues`)·`p.weekly`(`weekly`) | — |
| `p.collab` | `p.meetings`(`meetings`)·`p.wiki`(`wiki`)·`p.announcements`(`announcements`) | — |
| `p.team` | `p.members`(`members`)·`p.attendance`(`attendance`)·`p.agents`(`agents`) | — |
| `p.settings` | `p.settings`(`settings`) | `isProjectAdmin` |

- id 는 24개다. 개정 §5.3.5 의 예시 넷 밖의 이름은 이 문서가 붙였다. `kanban`·`minutes_integration`·`chatbot` 은 `nav: null` 이다(보드는 작업 계획의 보기다 — 개정 §5.3.4).
- 모듈 항목의 caps 는 `NavEntry` 에 필드를 더하지 않고 `NAV_NEEDS` 에 둔다.
- `navigation.menu` 의 `parse` 는 이 24개로 검증한다: `order` 는 유일하고 등록된 id, 같은 그룹 안의 상대 순서만 뜻한다. 라벨은 1~20자이고 `<`·`>` 가 없다.

## 5. Phase C — 설정 화면·브랜딩·카탈로그

### 5.1 프로젝트 설정(`/p/[projectId]/settings`)

접근은 지금과 같다(프로젝트 관리자, 아니면 대시보드로). 화면 규칙의 정본은 개정 §5.9.3 이다.

| 범주 | 내용 | 편집기 |
|---|---|---|
| 일반 | 프로젝트 정보(이름·설명·기간 — `projects` 열), 공개 범위(지금처럼 플랫폼 관리자에게만. 기본값 — 사용자 확인 항목(§9 #9)), `core.level_labels`, `core.milestone_keywords`, `core.extra_axis_label`(숨김), 데이터(가져오기 링크·내보내기·`wbs.excel_profile` 비우기), AI 색인 상태·재색인 | 정보·공개 범위·색인은 지금의 전용 컴포넌트. 키는 레지스트리 자동 폼 또는 전용 편집기 |
| 모듈·메뉴 | `modules.enabled`. 접힌 구역 "꺼진 모듈"(허용됐지만 꺼짐), 저장값에 남은 허용 밖 id 는 "워크스페이스 미허용 — 저장값 유지". 허용 밖이고 저장값에도 없는 모듈은 숨기되 관리자에게는 "이 배포/계약에서 사용할 수 없는 모듈"로 보인다(개정 §2.7.3) | `ModuleToggleEditor` |
| 팀·업무영역 | 프로젝트 팀, 역할 안내 링크. 담당 영역 편집기의 두 탭은 숨긴다 — 이미 입력된 영역은 지우지 않는다(기본값 — 사용자 확인 항목(§9 #7)) | 지금의 `ProjectTeamsManager`. `ProjectAreasManager` 는 탭 표시 조건만 바꾼다 |
| 상태·승인 | `workflow.stage_credits`, 상태 정책 안내문 | `StageCreditSlider` |
| 달력 | 기준일·휴일 | 지금의 `ScheduleManager` |
| 기록 | 설정 변경 이력(D24) — 시각·바꾼 사람·키·전→후·출처. 지워진 계정은 '삭제된 계정'으로 보인다 | `SettingsHistoryList` |

'추가 필드'·'양식'·'알림'·'연동'은 키가 없으므로 목차에 보이지 않는다. '지표·위험' 범주는 없다.

### 5.2 워크스페이스 설정(`/w/[slug]/settings`)과 레이아웃 골격

- `src/app/(app)/w/[slug]/layout.tsx`: 슬러그로 워크스페이스를 세션 클라이언트로 찾는다. 없거나 소속이 아니면 `notFound()`(플랫폼 관리자는 통과). 권한 조회 실패(degraded)는 404 로 위장하지 않는다. `generateMetadata` 가 제품명을 낸다. 이 파일은 그 밖의 일을 하지 않는다 — 전환기·셸·경로 이동은 SP3b.
- **분기(파비콘)** — 루트의 파일 기반 아이콘(`src/app/icon.tsx`)이 `/w/[slug]` 레이아웃의 메타데이터 아이콘을 덮는지는 돌려 봐야 안다. Phase C 의 첫 작업이 `/w/<slug>/settings` 응답의 `<link rel="icon">` 을 확인한다. 메타데이터가 이기면 마크를 아이콘으로 내고 눈확인 행에 넣는다. 덮이면 파비콘의 워크스페이스별 교체는 SP3b 로 넘기고(§10.1) SP3a 는 아이콘을 건드리지 않는다.
- 설정 페이지는 워크스페이스 관리자만 연다(아니면 `/projects` 로). `modules.allowed` 구역은 플랫폼 관리자에게만 보인다.
- 들어가는 길은 위험 파일 밖에 둔다: `/projects` 화면 머리와 프로젝트 설정 '일반' 범주의 링크(워크스페이스 관리자에게만).

| 범주 | 내용 |
|---|---|
| 일반 | `branding.product_name`·`branding.logo`·`branding.accent`·`branding.mail_from_name` |
| 모듈·AI | `modules.allowed`(플랫폼 관리자 전용 구역), `ai.enabled` |
| 초대 | `invites.allowed_domains`. 공용 팀은 지금의 `/admin/teams` 로 가는 링크(화면 이동은 SP3b) |
| 메뉴 | `navigation.menu`(그룹 안 순서·라벨) |
| 기록 | 설정 변경 이력, 권한 변경 이력(§6 — Phase D 가 싣는다) |

### 5.3 저장·검토·충돌

- 화면 왼쪽에 범주 목차와 필드 검색(라벨·설명·키 이름으로 거른다)을 둔다.
- 저장 단위는 범주다. 저장 바가 변경 수를 보이고 그 범주에서 바뀐 키만 한 패치로 보낸다. 저장 바는 스크롤 영역 안 `sticky` 다(§2.3). 전용 편집기는 자기 저장을 갖는다. `commandId` 는 저장 시도마다 클라이언트가 만든다. 응답이 `changed: 0` 이면 "바뀐 값이 없습니다"를 보인다.
- 값마다 현재 적용값·출처(D23)·적용 시점·편집 주체를 보인다. '상속됨'은 쓰지 않는다.
- '변경 내용 검토'는 `impact` 에 `recompute`·`future_only` 가 있을 때만 뜬다(SP3a 에는 `guarded` 키가 없다): `modules.allowed`·`modules.enabled`·`core.milestone_keywords`·`workflow.stage_credits`. 나머지 10키는 바로 저장한다(`ai.enabled` 는 개정 §2.8.1 의 `none`, `core.level_labels` 는 D34).
- 영향 계산기(`src/lib/settings/impactPreview.ts`, 서버 전용·읽기만)는 둘이다: `modules.enabled`(꺼지는 모듈별 데이터 건수 — 삭제되지 않음을 함께 적는다), `modules.allowed`(좁히면 영향받는 프로젝트 수). `ctx` 는 스코프 유니온이다. 계산기가 없는 키는 적용 시점 문구만 보인다. 액션은 `previewSettingsImpact`(`src/app/actions/settingsPreview.ts`)다.
- 409: 내 편집을 버리지 않는다. 키마다 내 값·최신 값을 나란히 보이고 "내 값 다시 적용"·"최신 값 사용"을 고르게 한 뒤 `latest.revision` 을 기준으로 새 `commandId` 로 다시 저장한다. 표준 문구는 개정 §5.10.3.
- 결과 불명(응답 유실): `getSettingsCommandOutcome` 을 부른다. `unknown` 이면 같은 `commandId` 로 재전송한다(멱등).
- 오류가 뜨는 자리: 필드 오류는 그 필드 아래, 패치 전체 거부는 저장 바 위 알림, 조회 실패는 범주 본문 자리, "설정 손상"은 그 키 자리에 사유와 함께(다른 키는 편집 가능), "필요 설정 없음"은 그 기능 화면에 — 관리자에게는 설정 경로, 그 밖에는 문의처 안내. 이 다섯은 `src/components/settings/ConfigStateNotice.tsx` 하나가 그린다(SP3b 가 `StatusMessage` 로 바꾼다).
- 타입 `EditState`·`ConnState`·`EditSession`·`MutationResult`·`CommandOutcome` 은 `src/lib/edit/session.ts` 에 선언만 한다(개정 §5.8.2). 리듀서와 표면 일반화는 SPU1.

### 5.4 브랜딩

- **로고**: 업로드 액션 `uploadBrandLogo(workspaceId, slot, file)`(`src/app/actions/branding.ts`, `requireWorkspaceAdmin`)이 검증하고 service_role 로 올린 뒤 경로를 돌려준다. 저장은 `updateWorkspaceSettings` 다. 검증: `slot` 은 `full`·`full_dark`·`mark` 가운데 하나, 첫 바이트로 본 형식이 PNG·JPEG·WebP, 262,144바이트 이하(버킷 상한과 같은 값). SVG 는 받지 않는다(D19). 렌더는 `<img>` 로만 하고 로고 바이트를 문서에 넣지 않는다(`logo-upload` 테스트가 로고 컴포넌트에 `dangerouslySetInnerHTML` 이 없음을 본다). 옛 파일은 지우지 않는다(D36).
- 읽기는 세션 라우트 `GET /api/brand/[workspaceId]/[slot]` 이다. 소속을 확인하고 `X-Content-Type-Options: nosniff`·`Content-Security-Policy: default-src 'none'` 과 함께 바이트를 낸다.
- **마크 해석**은 `src/lib/settings/brandMark.ts` 의 순수 함수 하나다: 마크가 있으면 그 이미지, 없으면 제품명이 `'D-Flow'` 일 때 흐름 아이콘, 아니면 첫 글자 모노그램(개정 §5.11.2 env 흡수).
- **흡수 범위**: `NEXT_PUBLIC_BRAND_PORTAL_ICON` 판독과 `resolvePortalIcon` 의 명시값 분기를 지운다(`src/lib/branding.ts:11-22`, `.env.local.example:27`, `tests/lib/branding.test.ts`). `/projects` 화면(`projects/page.tsx:188`)과 `src/components/ui/BrandMark.tsx:68` 은 마크 없음 규칙으로 돈다. 루트 `src/app/icon.tsx`·`apple-icon.tsx` 는 고치지 않는다. 셸과 `/p/*` 의 로고·파비콘 반영은 SP3b ★8 이다.
- **accent**: `src/lib/settings/accent.ts`(A)가 개정 §5.11.2 의 1~4 를 순수 함수로 구현한다. 클라이언트가 세트를 보내면 `CONFIG_INVALID` 다. 거부 응답은 실패한 쌍과 대비값을 `fieldErrors` 문구에 싣는다. 기준 색(캔버스·표면·`danger`·`success`)은 `accentTokens.ts` 에 개정 §5.5.3·§5.5.4 의 값으로 두고 SP3b UI-1 이 같은 모듈을 쓴다. 임계값은 D30.
- **제품명 소비**(D35): `src/lib/mail/projectInvite.ts:66`·`src/lib/mail/fromName.ts:10`·`src/lib/excel/template.ts:45`·`src/lib/report/excel.ts:225`·`src/lib/minutes/export.ts:64,161` 을 워크스페이스 값으로 바꾼다. 표시 소비처는 저장값이 `invalid` 면 제품 기본값으로 그리고 로그를 남긴다(D39).

### 5.5 생성·복사 화면

`NewProjectModal` 에 "빈 값으로 시작 / 기존 프로젝트에서 복사"를 더한다. 복사 원본은 같은 워크스페이스의 프로젝트만 고를 수 있다. 화면에 적는다: "복사합니다: 설정 값·팀·업무영역. 복사하지 않습니다: 멤버·WBS·회의록·이슈." 단계 라벨은 빈 값이면 필수 입력, 복사면 원본 값이 채워진다. 원본에 손상된 설정이 있으면 복사를 거부하고 그 키를 보인다(D29).

### 5.6 카탈로그 문서

구조·열·상태 어휘는 개정 §2.10 이 정본이다.

- `src/lib/settings/catalogDoc.ts` 가 레지스트리·`catalog-meta.ts`·`OPERATIONAL_SETTINGS` 에서 자동 구역(1·2·4·5번 절)을 만든다. 5번 절 개인 설정의 출처는 `catalog-meta.ts` 의 `PERSONAL_PREFS` 목록이다(개정 §2.8.5).
- `tests/settings/catalog-sync.test.ts` 가 메모리에서 다시 만들어 `docs/settings-catalog.md` 의 `<!-- catalog:auto:<구역> -->` 사이와 비교한다. `npm run catalog:write` 는 같은 테스트를 `CATALOG_WRITE=1` 로 돌려 파일을 쓴다(D20).
- 같은 테스트가 본다: 등록 키마다 메타가 있다, `consumers`·`tests` 의 경로가 실재한다, `verified` 는 `tests` 가 비지 않았다, 14키의 상태가 §3.6 표 값의 리터럴과 같다.
- 카탈로그의 수기 절(0·3·6~10번)은 SP3a 가 개정 §2.9 와 개정 §3.6.10 을 옮겨 적는다. 근거는 줄 번호가 아니라 **파일과 심볼 이름**으로 적고, 테스트가 그 심볼이 있는지 본다. 6번 절의 고정 어휘 문구 확정은 SP5 다. 9번 절은 예약 네임스페이스 셋이다. 설정화율은 산출하지 않는다.

### 5.7 운영 설정 목록(`src/lib/settings/operational.ts`)

개정 §2.6.3 의 `OperationalDef` 에서 `owner` 만 목록으로 바꾼다(D15). 값은 담지 않는다. secret 인 이름의 값은 로그·화면·내보내기에 싣지 않는다.

| 묶음 | 이름 | kind·secret | owner |
|---|---|---|---|
| 메일 | `SMTP_HOST`·`SMTP_PORT`·`SMTP_SECURE`·`SMTP_AUTH`·`SMTP_USER`·`SMTP_PASS`·`SMTP_FROM_ADDRESS` | env · `SMTP_USER`·`SMTP_PASS` | `src/lib/mail/transport.ts` |
| 배포 기본값 | `MAIL_FROM_NAME`·`INVITE_ALLOWED_DOMAINS`·`NEXT_PUBLIC_BRAND_NAME` | env·env_public | `src/lib/settings/workspaceConfig.ts`, 제품명은 `src/lib/branding.ts` 도 |
| 공개 화면 브랜드 | `NEXT_PUBLIC_BRAND_TAGLINE`·`NEXT_PUBLIC_BRAND_COPYRIGHT` | env_public | `src/lib/branding.ts` |
| 앱 주소 | `NEXT_PUBLIC_APP_URL`·`VERCEL_PROJECT_PRODUCTION_URL` | env_public·env | `src/app/actions/meetingNotify.ts`, `src/app/actions/projectInvites.ts` |
| 배포 환경 | `VERCEL_ENV`·`STAGING`·`USAGE_TRACKING` | env | `src/lib/domain/usageTracking.ts`, `src/app/api/track/route.ts`, `src/app/(app)/layout.tsx`, `next.config.ts` |
| 잡 시크릿 | `CRON_SECRET`·`WIKI_WORKER_SECRET`·`CHAT_V2_INDEX_CRON_SECRET` | env · 전부 | 워커·크론 라우트 네 파일 |
| 외부 API 시크릿 | `AGENT_API_SECRET`·`MINUTES_API_SECRET` | env · 전부 | `src/lib/agent/externalApi.ts`, `src/lib/minutes/externalApi.ts` |
| 모듈 플래그 8 | `AGENT_API_ENABLED`·`MINUTES_API_ENABLED`·`WIKI_SERVICE_ENABLED`·`WIKI_WORKER_ENABLED`·`CHAT_V2_ENABLED`·`CHAT_V2_PLANNER_ENABLED`·`CHAT_V2_LLM_SYNTHESIS_ENABLED`·`CHAT_V2_INDEX_WORKER_ENABLED` | env | `src/lib/modules/flags.ts`, 두 `externalApi.ts` |
| 폐지 예정 플래그 2 | `MINUTES_FOLDER_PATH_ENABLED`(SP7)·`CHAT_V2_INDEX_ENQUEUE_ENABLED`(SP8) | env | 지금 파일 그대로 |
| AI 공급자 | `AI_PROVIDER`·`LLM_API_KEY`·`OPENAI_API_KEY`·`LLM_BASE_URL`·`LLM_MODEL`·`EMBED_MODEL`·`GEMINI_API_KEY`·`GOOGLE_API_KEY`·`GEMINI_BASE_URL`·`GEMINI_MODEL`·`GEMINI_EMBED_MODEL`·`GEMINI_FALLBACK_MODELS`·`ASSISTANT_MIN_SIMILARITY` | env · 키 넷 | `src/lib/ai/provider.ts`·`llm.ts`·`similarity.ts` |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` | env_public·env · 마지막 | `src/lib/supabase/{client,server,env}.ts`, `src/middleware.ts` |
| 표 | `table:llm_config`·`table:llm_profiles` | table · 토큰 | `src/lib/ai/llm-override.ts` |

- 코드 상수 두 행(보존 90일, 첨부 상한)은 env 가 아니라 카탈로그 4번 절의 수기 행이다.
- `tests/settings/operational-env.test.ts`(C): (가) 목록의 이름은 owner 파일에서만 읽힌다 (나) `src`·`next.config.ts` 의 `process.env.<이름>` 가운데 목록에 없는 것은 실패(허용: `NODE_ENV`) (다) `process.env` 를 통째로 넘기거나 계산된 이름으로 읽는 곳은 `transport.ts`·`track/route.ts`·`workspaceConfig.ts` 셋뿐 (라) 목록의 env 이름은 모두 `.env.local.example` 에 있다. 검사는 주석을 뺀 코드 줄로 한다. 정본의 `tests/modules/env-flags.test.ts` 는 따로 만들지 않는다 — (가)가 같은 것을 본다.

## 6. Phase D — 권한 변경 이력(`authz_events`)

DB 객체와 그 DB 테스트는 Phase A 다(`0012` 의 10번 절, `tests/rls/authz-events.test.ts`). Phase D 는 서버 배선과 읽기 화면이다.

| 항목 | 내용 |
|---|---|
| 열 | `id bigint generated always as identity`, `kind`(`platform_admin`·`workspace_role`·`project_access`), `workspace_id uuid`, `project_id uuid`, `target_user_id uuid`, `target_person_id uuid`, `before jsonb`, `after jsonb`, `cause`(`direct`·`cascade`·`parent_deleted`), `actor_user_id uuid`, `command_id uuid`, `command_digest text`, `created_at`. **어느 열에도 FK 를 두지 않는다**(D3) — 이름·이메일은 저장하지 않고 id 만 남긴다 |
| 제약 | kind 별 check: 플랫폼은 두 범위 id 가 null, 워크스페이스 등급은 `workspace_id` 필수, 명단은 `project_id`·`workspace_id` 필수(명단 행의 워크스페이스는 늘 얻을 수 있다 — `project_members.person_id → people` 과 `projects.workspace_id` 가 RESTRICT 라 삭제 도중에도 부모가 남는다. 그래서 정리가 워크스페이스를 가진 모든 행에 닿는다). 유일 인덱스 `authz_events_command_uq (actor_user_id, command_id, kind, target_user_id, target_person_id, workspace_id, project_id) nulls not distinct where command_id is not null` |
| 불변 | 트리거 `authz_events_worm` BEFORE UPDATE OR DELETE → `authz_events_reject_mutation()`. UPDATE 는 전부 거부한다. DELETE 는 `workspace_id` 가 있고 그 워크스페이스 행이 없으며 트랜잭션 설정 `app.authz_purge` 가 `on` 일 때만 통과한다. 그 설정을 켜는 곳은 `purge_authz_events(p_workspace_id uuid)`(service_role 만) 하나이고, 함수는 지운 뒤 설정을 `''` 로 되돌린다. 워크스페이스 행의 AFTER DELETE 트리거 `workspaces_purge_authz_events`(→ `purge_workspace_authz_events()`, SECURITY DEFINER, 아무 롤에도 grant 하지 않는다)가 `purge_authz_events(old.id)` 를 부른다 — 워크스페이스 삭제가 같은 트랜잭션에서 그 워크스페이스의 권한 기록을 지우고, 정리 경로는 여전히 그 함수 하나다. FK 캐스케이드와의 순서는 결과를 바꾸지 않는다(원인 ① 이 그 워크스페이스의 새 기록을 막는다). 워크스페이스를 지우는 앱 경로는 지금 없다(`grep -rn "from('workspaces')" src scripts` 에 delete 0건) — 운영자·테스트·뒤 SP 의 삭제가 모두 이 트리거를 지난다. 플랫폼 행은 워크스페이스가 없어 지울 수 없다. TRUNCATE 는 §3.1 의 문장 트리거가 막는다 |
| 누가 쓰는가 | 트리거 `authz_events_record`(→ `record_authz_event()`, SECURITY DEFINER)가 `platform_admins`(insert·delete), `workspace_members`(insert·delete·`role` update), `project_members`(insert·delete·`access_role` update)에서 **전과 후가 다를 때만** 1행을 쓴다. 연쇄·초대·계정 생성·프로젝트 삭제로 생긴 변경도 남는다(기본값 — 사용자 확인 항목(§9 #3)). insert 의 `after` 에는 그 행의 도장 열(`granted_by`·`invited_by`·`access_granted_by`) 값을 함께 싣는다 |
| 원인 | 순서대로 판정한다. ① 워크스페이스를 가진 종류(`workspace_role`·`project_access`)에서 그 워크스페이스 행이 없다(워크스페이스 삭제 중) → 기록하지 않는다(그 워크스페이스의 기록은 정리 트리거가 함께 지운다 — 불변 행). `platform_admin` 은 ① 을 건너뛴다. ② 부모 행이 없다(프로젝트, 또는 대상 계정의 `auth.users` 행) → `parent_deleted`. ③ `pg_trigger_depth() > 1`(소속 삭제가 명단 권한을 회수하는 0011 트리거) → `cascade`. ④ 그 밖 → `direct`. FK 캐스케이드 안의 깊이는 1 이고 부모 부재는 보인다(비평 실측 — `critique-security.md` M1, `critique-feasibility.md` Minor 1). 명단 행의 `workspace_id` 는 그 인물(`people`)의 워크스페이스에서 얻는다 |
| 행위자 | ① 세션 사용자 `auth.uid()`(그 계정이 `auth.users` 에 있을 때) ② 없으면 트랜잭션 설정 `app.authz_actor`(권한 RPC 가 넘긴 행위자) ③ 그것도 없으면 null. 저장된 도장 열을 행위자로 읽지 않는다 — 삭제와 등급 변경에서 그 값은 처음 준 사람이다. 세션 사용자가 있으면 트리거는 `app.authz_actor`·`app.command_id`·`app.command_digest` 를 하나도 읽지 않는다(명령 id·요약은 null 로 남는다) |
| `invited_by`(H2-e 이월) | 트리거 `workspace_members_stamp_inviter` BEFORE INSERT 가 세션 경로의 `invited_by` 를 `auth.uid()` 로 찍는다(0011 의 `access_granted_by` 와 같은 규칙: 세션 계정이 실재할 때만, service_role 경로는 넘어온 값을 둔다) |
| RPC | `set_platform_admin(p_actor, p_target, p_grant, p_command_id)`, `set_workspace_role(p_actor, p_workspace_id, p_target, p_role, p_command_id)`, `upsert_project_member_cmd(p_actor, p_project_id, p_person, p_member, p_team_ids, p_command_id)`. 셋 다 `p_actor`·`p_command_id` 가 null 이면 잠금보다 먼저 `22023 COMMAND_ID_REQUIRED`(null 키의 `pg_advisory_xact_lock` 은 잠그지 않고 null 을 돌려주고 중복 조회도 맞지 않아 멱등이 조용히 사라진다) → `pg_advisory_xact_lock(hashtextextended('authz:' \|\| p_actor \|\| ':' \|\| p_command_id, 0))` → 격리 검사 → 행위자의 등급 확인(아니면 42501) → 같은 (행위자, 범위, 명령 id)의 행이 있으면 요약 비교(D8) → `set_config('app.authz_actor'·'app.command_id'·'app.command_digest', …, true)` → 쓰기 → 세 설정을 `''` 로 되돌린다(트랜잭션 설정은 RPC 가 아니라 트랜잭션 끝까지 남아, 같은 트랜잭션의 뒤 쓰기가 명령 id 를 물려받으면 `authz_events_command_uq` 에 걸린다). 셋째는 기존 `upsert_project_member` 를 부른다. **세션은 이 설정들(과 `app.authz_purge`)을 켤 수 없다**: SQL 로는 어느 롤이나 `app.*` 를 쓸 수 있지만 세션이 DB 에 닿는 길은 PostgREST 뿐이고, PostgREST 는 `public`·`graphql_public` 스키마만 낸다(`supabase/config.toml:13` — `set_config` 는 `pg_catalog`), `app.*` 로 옮겨지는 요청 헤더와 `db_pre_request` 훅이 없으며, anon·authenticated 가 실행할 수 있는 함수 가운데 본문에 `set_config`·`set local` 이 든 것은 0개다. 마지막 조건은 `tests/rls/authz-events.test.ts` 가 `pg_proc` 로 단언한다. 행위자는 이 조건과 무관하게 세션이 위조하지 못한다(행위자 행 ①). **기존 5인자 함수는 시그니처도 본문도 고치지 않는다**(SP2 불변식 ⓘ 가 그 시그니처를 이름으로 지정한다 — `tests/rls/workspace-isolation-cases.test.ts:186-189`). 권한이 바뀌지 않은 호출은 행을 남기지 않으므로 재전송은 다시 실행된다(멱등 upsert) |
| 누가 읽는가 | 정책 `authz_events_read` — `(select is_superuser()) or (workspace_id is not null and (select is_ws_admin(workspace_id)))`. 권한은 D5. 프로젝트가 지워진 뒤에도 그 워크스페이스 관리자가 읽는다 |
| 앱 배선(D) | `src/app/actions/accounts.ts` 의 `setPlatformAdmin`(`:317`)·`setWorkspaceRole`(`:355`)이 직접 쓰기(`:328`·`:339`·`:363`) 대신 새 RPC 를 부른다. `accounts.ts:199`·`roster.ts:83` 의 호출을 `upsert_project_member_cmd` 로 바꾼다. 마지막 관리자 거부 토큰(`PLATFORM_LAST_ADMIN`·`WORKSPACE_LAST_ADMIN`)은 그대로 전달된다. `requireSuperuser(` 호출 11곳은 늘지 않는다 |
| 읽기 화면(D) | 워크스페이스 설정 '기록' 범주의 '권한 변경' 목록 — 최근 20건과 더 보기. 액션 `listAuthzEvents(workspaceId, { limit, before })`(`src/app/actions/authzEvents.ts`, `requireWorkspaceAdmin`, 세션 클라이언트). 플랫폼 행은 플랫폼 관리자에게만 같은 목록에 보인다. 지워진 계정은 '삭제된 계정'으로 보인다 |
| 격리 맵·픽스처(A) | `authz_events: t.workspace_id = A`. `fixture-ws.sql` 이 A 워크스페이스 행 하나를 넣는다 |

Phase A 와 D 사이에는 트리거가 이미 기록한다. 그동안 service_role 의 직접 쓰기(`setPlatformAdmin`·`setWorkspaceRole`·계정 생성·초대 수락)는 행위자가 null 로 남는다. 원격이 없는 동안의 중간 상태로 허용하고, D 뒤에도 계정 생성과 초대 수락의 행위자는 null 이다(도장 값은 `after` 에 있다).

## 7. 테스트와 검증

### 7.1 단위·정적(`npm run test`, DB 없음)

| 파일(Phase) | 고정하는 것 |
|---|---|
| `tests/settings/registry.test.ts`(A) | `assertRegistry()`, 14키가 정확히 등록, §1.4 의 네 선언이 형 검사를 통과하고 `parse` 가 돈다, `agents.stage_workflow`·`portal.widgets`·`views.default` 미등록, 사전 키 존재 |
| `tests/settings/config-lifecycle.test.ts`(A) | 개정 §2.11 ① 가운데 액션 층: 미등록 키, parse 실패(RPC 미호출), 409 와 최신값(`latest`·`changedKeys`), 겹치지 않는 편집의 자동 재기준(`rebased: true`), `editor` 등급 부족 403, `set`·`unset` 중복 키, 손상 저장값은 그 키만 `invalid`, 앞선 세대는 읽기 성공·쓰기 `CONFIG_SCHEMA_AHEAD`. 도메인 목록(D40): 틀린 항목 거부, `['*', 'a.com']` 거부, 정규화 뒤 중복 제거. 저장된 accent `'red;}'`·`'</style>'` 는 `invalid`, 줄바꿈이 든 발신명은 거부 |
| `tests/settings/errors.test.ts`(A) | 코드 표·토큰 표 전수, 표에 없는 토큰은 500, §3.3 의 kind 대응표 |
| `tests/settings/project-isolation.test.ts`(A) | P1-AC4 의 해석기 층: A·B 를 번갈아 읽고 써도 B 의 config 가 같다. 개인 설정을 바꿔도 해석 결과와 서버 판정이 같다. `src/lib/settings/**` 에 모듈 수준 `Map`·전역 캐시가 없다 |
| `tests/settings/create-project.test.ts`(A) | 필수 키 누락 거부, `modules.enabled` 명시 기록, 복사 때 재교집합, 원본에 `invalid` 키가 있으면 거부하고 아무것도 만들지 않는다(D29) |
| `tests/settings/internal-write.test.ts`(A) | `writeProjectSettingsInternal` 이 충돌에서 한 번만 재시도한다 |
| `tests/settings/accent.test.ts`(A) | 파생·거부(실패 쌍과 대비값) |
| `tests/settings/no-runtime-constants.test.ts`(A) | 정본 §6.5.2 의 패턴(E28)과 허용 목록 파일. SP4·SP5 가 지운다 |
| `tests/actions/settings-outcome-history.test.ts`(A) | `getSettingsCommandOutcome` 의 `applied`·`unknown`, `listSettingsHistory` 의 20건 쪽 나눔 |
| `tests/modules/registry.test.ts`(A) | 17개, core `requires: []`·`envAvailable` 상수 true, 순환 없음, `BOT_DOMAINS` 와 `botDomains` 합집합 일치, 0012 리터럴 = 동결 목록 ⊆ 레지스트리, 해석기의 import 방향 |
| `tests/modules/effective.test.ts`(A) | 개정 §2.11 ③ 네 가지. ③ 의 넷째는 비core 모듈이 소유한 픽스처 `SettingDef` 로 본다(SP3a 등록 키는 전부 core 소유다) |
| `tests/modules/agents-sync.test.ts`(A) | `agents` 를 더하면 `agent_projects` insert·enable 과 `backfillProjectOrders`, 실패하면 오류, 빼면 `agent_projects` 무변경 |
| `tests/modules/bootstrap-ids.test.ts`·`tests/scripts/bootstrap-modules.test.ts`(A) | 스크립트 상수(D27). `BOOTSTRAP_MODULES` 빈 문자열은 `[]`, 모르는 id 는 멈춤 |
| 기존 `tests/api/import-execute.test.ts`·`tests/components/import-wizard-profile-mismatch.test.tsx`(A) | W5 — 프로파일 저장 실패가 응답 `profileSave` 와 화면 경고로 나온다 |
| 기존 `tests/agent/wbs-structure.test.ts`(A) | 외부 API 가 호출자의 워크스페이스 밖 프로젝트 설정을 내지 않는다, 응답 필드 `levels`·`max_depth` 유지 |
| `tests/invariants/settings-writes.test.ts`(A) | §3.4 |
| `tests/gates/**`(B) | §4.3 |
| `tests/invariants/module-page-gates.test.ts`(B) | §4.2 — 모든 `page.tsx` |
| `tests/app/share-minutes-gate.test.tsx`(B) | 모듈이 꺼진 워크스페이스의 공유 링크는 404 이고 회의록 조회가 일어나지 않는다 |
| `tests/api/minutes-meta-modules.test.ts`(B) | 두 워크스페이스에 속한 행위자의 `meta` 목록이 허용된 쪽 행만 싣는다 |
| `tests/modules/bot-domains.test.ts`(B) | 도구 → 도메인 → 모듈 대응이 완전하다 |
| `tests/modules/bot-tools-gate.test.ts`(B) | `issues` 가 꺼진 요청의 도구 목록에 `issues` 도구와 capability 가 없다. 프로젝트 문맥이 없을 때 꺼진 프로젝트가 도구의 프로젝트 목록에서 빠지고, 목록이 비면 도구가 없다 |
| `tests/modules/worker-gate.test.ts`(B) | 모듈이 꺼진 프로젝트의 잡은 `skipped`·`module_disabled` 로, 설정 행이 없는 잡은 실패·`CONFIG_UNAVAILABLE` 로 닫힌다 |
| `tests/modules/agents-gate.test.ts`(B) | AND 게이트 네 조합, 목록 응답에서 꺼진 프로젝트 제외 |
| `tests/ai/ai-available.test.ts`(B) | 예외 2파일 밖 `hasLLM(` 0건(주석을 뺀 코드 줄 — `_walk.ts` 의 `codeLines`), 세 조건의 조합 |
| `tests/nav/nav-for.test.ts`(B) | 모듈 × caps × `navigation.menu` 조합, 항상 보이는 항목, 그룹 고정 |
| `tests/authz/guard-signatures.test.ts`·`tests/invariants/platform-guards.test.ts`(B) | `requireModule` 시그니처 추가, 11곳 불변 |
| `tests/settings/{operational-env,catalog-sync}.test.ts`(C) | §5.7, §5.6 |
| `tests/settings/{brand-mark,impact-preview,logo-upload}.test.ts`(C) | 마크 해석 세 갈래, 손상된 브랜딩 값은 제품 기본값으로 그리고 로그를 남긴다(D39), 계산기 수치, 형식·크기·`slot` 거부와 인라인 금지 |
| `tests/api/brand-route.test.ts`(C) | 비소속 404, `nosniff`·CSP 헤더 |
| `tests/app/w-layout.test.tsx`(C) | 없는 슬러그·비소속 404, 플랫폼 관리자 통과, degraded 는 404 가 아니다 |
| `tests/components/{config-state-notice,settings-conflict,module-toggle-editor}.test.tsx`(C) | 다섯 상태의 표시(실행 중인 서버에서 만들 수 없는 '조회 실패'·'필요 설정 없음' 포함), 충돌에서 내 값 보존·키별 재적용, 사용할 수 없는 모듈 표시 |
| `tests/invariants/project-page-gates.test.ts`(C) | `PAGES_ROOT` 에 `src/app/(app)/w/[slug]` 추가 |
| `tests/actions/authz-events.test.ts`·`authz-events-list.test.ts`(D) | 세 액션이 RPC 를 부르고 `commandId` 를 넘긴다. 목록 쪽 나눔, 워크스페이스 관리자에게 플랫폼 행이 보이지 않는다 |

설정을 읽는 도메인 계약 테스트(`effectiveModules`·`navFor`·크레딧 검증·마일스톤 판정)는 `tests/fixtures/synthetic/configs.ts` 의 세 구성(기본·R·C)으로 `describe.each` 한다(개정 §6.5.7). R 과 C 의 크레딧 표는 SP3a 의 고정 정책 `{5, 10}` 에서 유효한 값이다(R 은 `{as:0, ip:20, rw:30, im:90, xx:100}`). 개정 §6.5.8 의 R 표(0/20/25/90/100, `min_gap:5`)는 SP5b 가 `workflow.credit_policy` 와 함께 넣는다.

### 7.2 실행형(`npm run test:rls`, 건너뜀 0) — 전부 Phase A

권한은 `asService`(postgres)가 아니라 `set local role service_role` 과 `asUser` 로 확인한다. 부트스트랩 계정에 기대지 않는다.

| 파일 | 고정하는 것 |
|---|---|
| `tests/rls/settings-write.test.ts` | 개정 §2.11 ②: 네 표 직접 쓰기 42501, `workspace_settings_write` 0건, 0012 의 모든 함수에서 anon·authenticated EXECUTE 0, SP2 불변식 ⓘ·ⓘ′ 무수정 초록. 더해서 세션의 `projects` insert 42501(D6), 잡 표 셋이 `status='skipped'` 를 받는다 |
| `tests/rls/workspace-settings.test.ts` | `:29-76`(①)을 RPC 경로로 다시 쓴다. 설정 행을 지우던 부분은 없앤다. ⑧ 의 워크스페이스 삭제(`:196-238`)는 고치지 않고 통과해야 한다 |
| `tests/rls/settings-rows.test.ts` | 프로젝트·워크스페이스와 설정 행 1:1, 직접 DELETE 거부, 부모 삭제는 통과, `updated_by` 가 찍힌 계정의 삭제가 성공한다(D2) |
| `tests/rls/settings-cas.test.ts` | **두 연결**: 둘 다 `begin` → A 가 저장(잠금) → B 가 같은 `expectedRevision` 으로 저장해 대기(`pg_blocking_pids` 로 관찰) → A 커밋 → B 는 `SETTINGS_REVISION_CONFLICT`, `detail` 은 새 revision. revision 은 1만 오르고 이력은 한 명령분. 커밋 데이터를 쓰고 `finally` 에서 그 프로젝트를 지운다. 정리 실패는 실패다 |
| `tests/rls/settings-lifecycle.test.ts` | 개정 §2.11 ① 의 DB 층: 같은 `commandId` 재전송은 `duplicate`·이력 1벌, 두 연결 동시 재전송은 한쪽 `applied`·한쪽 `duplicate`·충돌 0, 값 불변 명령, 앞선 세대 거부, 같은 id·다른 내용 거부(키를 더한 재전송 포함), 다른 행위자의 같은 id 는 새 명령, 격리 수준 셋(`repeatable read`·`serializable`·`read uncommitted`)은 `25001`·`read committed` 는 통과, 이력 UPDATE·DELETE 거부, service_role 의 이력 TRUNCATE 거부 |
| `tests/rls/settings-create.test.ts` | 개정 §2.11 ⑤: 설정 기록 실패 주입(필수 키 없는 `p_values`) 뒤 `projects` 0행, 복사 이력 `source='copy'`·`copied_from`, 복사된 영역·영역-팀·프로젝트 전용 팀의 수와 새 팀 id 로의 재연결, 멤버 미복사, 다른 워크스페이스 원본 거부, 같은 `commandId` 재전송은 같은 프로젝트, 다른 워크스페이스에서 쓴 같은 id 는 보이지 않는다, 같은 id·다른 이름은 `COMMAND_REUSED`, `p_actor`·`p_command_id` 가 null 이면 각자의 토큰으로 거부하고 `projects` 0행 |
| `tests/rls/settings-isolation.test.ts` | P1-AC4 의 DB 층: A·B 프로젝트를 번갈아·동시에 써도 B 의 `values`·revision·이력이 그대로. 워크스페이스 B 계정은 A 의 설정·이력을 0건 읽는다 |
| `tests/rls/workflow-parity.test.ts` | `:81`·`:334` 를 `values` 로. `src/lib/domain/stageCredits.ts:4` 의 없는 테스트를 가리키는 주석을 이 파일로 고친다. 골든 `tests/fixtures/parity/stage-credits.json` 을 TS(`validateStageCredits`·기본값)와 SQL(`c_default`·이벤트 적용 결과)이 함께 읽는다 |
| `tests/rls/authz-events.test.ts` | 세 종류의 변경마다 1행(전·후·행위자). 세션 DELETE 는 지운 관리자를 행위자로 남긴다. 설정 없는 service_role 등급 변경은 행위자 null 이다(초대한 사람이 아니다). 같은 (행위자, 명령 id) 재전송 1행, 같은 id·다른 대상은 `COMMAND_REUSED`. `p_actor`·`p_command_id` 가 null 이면 `COMMAND_ID_REQUIRED`. RPC 뒤 같은 트랜잭션에서 세 설정이 `''` 이다. 세션 사용자의 쓰기는 `app.command_id` 가 켜져 있어도 명령 id 를 남기지 않는다. anon·authenticated 가 실행할 수 있는 함수 가운데 본문에 `set_config`·`set local` 이 든 것 0개(`pg_proc`). 직접 insert 42501, UPDATE·DELETE 거부, service_role 의 TRUNCATE 거부. 0011 트리거의 연쇄 회수는 `cascade`. 명단 행이 있는 프로젝트 삭제가 성공하고 `parent_deleted` 행이 남으며 워크스페이스 관리자가 읽는다. 계정 삭제가 성공하고 `parent_deleted` 행이 남는다. 소속 행이 있는 워크스페이스 삭제가 성공하고(기존 ⓒ·⑧ 무수정 초록) 그 워크스페이스의 권한 기록이 0행이 된다. 다른 워크스페이스의 행과 플랫폼 행은 남는다. `invited_by` 위조 불가, B 관리자는 A 행 0건, 격리 수준 셋 거부 |
| `tests/rls/workspace-isolation.test.ts` | §3.8 마지막 행 — update 탐침 수정과 권한 거부 표 목록 |
| `tests/rls/storage-realtime.test.ts` | `branding` 버킷: A 멤버 읽기, B 계정 0건, 세션 쓰기 거부. `deliverables` 버킷에 브랜딩 모양 이름으로 둔 객체는 일반 멤버가 읽지 못한다. 둘째 조각이 uuid 가 아닌 객체가 있어도 목록 조회가 22P02 로 실패하지 않는다. 정책의 경로 판정과 TS `parseBrandingPath` 가 같은 표본(정상·조각 수 틀림·확장자 틀림·uuid 아님·`slot` 틀림)에 같은 답을 낸다 |
| `tests/rls/synthetic-parity.test.ts` | 세 구성의 크레딧 표에 대한 SQL 판정(개정 §6.5.8) |
| `tests/rls/isolation-map.ts`·픽스처 | 새 세 표 등록. 픽스처의 설정 insert 세 곳(`fixture.sql:55`, `fixture-ws.sql:44`·`:214`)을 트리거가 만든 행의 `update … set values = …` 로 바꾼다(두 번 적재해도 같은 값). 워크스페이스 픽스처는 `modules.allowed` 와 `invites.allowed_domains` 를 둘 다 쓴다. 새 표마다 A 행 1개 이상 |

### 7.3 로컬 E2E 와 합성 게이트

`scripts/e2e-local.mjs` 의 기본 주소를 `http://localhost:3101` 로 바꾸고 3000 포트는 거부한다. 서버는 스크래치 워크트리에서 `npm run env:local` 이 만든 `.env.local` 에 스크립트 머리가 요구하는 env(`INVITE_ALLOWED_DOMAINS`·`NEXT_PUBLIC_APP_URL=http://localhost:3101`·`MINUTES_API_*`)와 모듈 플래그를 넣고 `npm run dev -- -p 3101` 로 띄운다. 기록은 `docs/baseline/sp3a-e2e.md`.

| # | 단계(더하는 Phase) | 기대 |
|---|---|---|
| 1 | `updateProjectSettings` 로 프로젝트 A 의 `core.milestone_keywords` 를 바꾼다(A) | 이력에 전·후와 행위자가 남는다 |
| 2 | `createProject` 를 빈 값과 복사로 부른다(A) | 두 프로젝트가 생기고 복사본의 이력이 `source='copy'` 다 |
| 3 | 프로젝트 A 의 `issues` 를 끈다(B) | `GET /p/A/issues` 404, `createIssue` 는 `ERR_MODULE_DISABLED`, `GET /api/issue-analysis?projectId=A` 404. 응답 본문에 이슈 데이터가 없다 |
| 4 | `agents` 를 끈다(B) | `GET /api/v1/agent/me` 목록에 A 가 없다. A 대상 에이전트 API 는 404 |
| 5 | 워크스페이스의 `minutes_integration` 을 허용에서 뺀다(B) | 회의록 업로드 API 가 409 `module_disabled` |
| 6 | service_role 로 A 의 `ai_index_jobs` 대기 행을 넣고 `CRON_SECRET` 으로 색인 크론을 부른다(B) | 그 행이 `skipped`·`module_disabled` |
| 7 | A 에만 속한 계정이 `GET /w/<B 슬러그>/settings`(C) | 404 |
| 8 | `setWorkspaceRole` 뒤 `listAuthzEvents`(D) | 전·후·행위자가 든 1행 |

화면의 복사 범위 문구와 봇 도구 목록은 HTTP 스크립트가 볼 수 없다. 앞은 눈확인(§7.5), 뒤는 `bot-tools-gate` 테스트가 본다.

`npm run accept:synthetic`(`scripts/e2e-synthetic.mjs`, 마감): 설정은 화면과 같은 서버 액션으로만 넣는다. 실행 전후 `git diff --quiet -- src supabase` 가 참이어야 한다. 기록은 `docs/baseline/synthetic-acceptance.md`.

| 단계 | SP3a 에서 단언하는 것 |
|---|---|
| S1 생성 | R·C 를 빈 값으로 만들고(생성과 필수 설정이 한 트랜잭션) SP3a 등록 키를 액션으로 넣는다 — 단계 라벨, 마일스톤 키워드, 모듈 구성, 고정 정책에서 유효한 크레딧 표(§7.1). 다시 읽은 값이 넣은 값과 같고 이력이 남는다 |
| S9 격리 | R 의 설정을 바꾼 뒤 C 의 해석 결과(전 키)·revision·이력이 그대로다. 워크스페이스 B 계정은 R·C 의 설정과 이력을 0건 읽는다. S5~S8 산출물 해시는 그 단계가 켜지는 SP 에서 더한다 |
| S2~S8·S10 | '미활성(담당 SP)'으로 기록(D25) |

### 7.4 성능 기록(Phase B)

모듈 관문이 요청마다 설정 두 표를 읽는다. 스택이 하나이므로 차례로 잰다. ① `h2-done` 스크래치 워크트리(3102)에서 `supabase db reset --version 0011` → `npm run dev:bootstrap` → `node scripts/perf-baseline.mjs seed` → `measure --base http://localhost:3102 --n 30` 을 3회. ② SP3a 워크트리(3101)에서 `npm run db:reset` → 같은 seed → 같은 측정 3회. 계정은 **일반 멤버**다. 판정은 대시보드·WBS 셸 각각의 3회 p95 가운데 중앙값이고 기준은 ① 대비 +20% 이내다. p50 도 함께 `docs/baseline/sp3a-perf.md` 에 적는다. 기준을 넘으면 `effectiveModules` 의 조회를 한 번으로 합친 뒤 다시 잰다 — 넘은 채로 B 를 머지하지 않는다.

### 7.5 눈확인 목록

도구는 헤드리스 Chromium 이다(Playwright 를 `npx` 캐시로 쓴다 — `package.json` 에 더하지 않는다). 서버는 스크래치 워크트리의 3101 포트다. 계정은 그 작업이 만든 임시 계정 셋(플랫폼 관리자, 플랫폼 관리자가 아닌 워크스페이스 관리자, 일반 멤버)이고 비밀번호는 메모리에만 둔다. 화면 크기는 1440×900·1280×720·768×1024·390×844, 테마는 라이트다. 결과는 `docs/baseline/sp3a-ui.md` 에 표(라우트·크기·결과·스크린샷 파일명과 해시)로 남긴다. 확인하는 주체는 에이전트다(기본값 — 사용자 확인 항목(§9 #10)). 실행 중인 서버에서 만들 수 없는 상태('조회 실패'·'필요 설정 없음')는 `config-state-notice` 단위 테스트가 대신한다.

| 화면(Phase) | 확인 |
|---|---|
| 기존 설정 화면의 편집기 셋(A) | 단계 이름·크레딧·저장 양식 비우기가 새 액션으로 저장되고 다시 열면 값이 남는다 |
| 새 프로젝트 — 빈 값(A) | 생성이 되고 실패는 문구로 보인다(throw 가 아니다) |
| 가져오기 경고(A) | 프로파일 저장 실패 경고가 보인다(단위 테스트가 상태를 만들고 눈확인은 문구 위치만) |
| 설정 조회 오류 상태(A) | 대시보드·WBS 가 기본값 대신 오류 상태를 보인다(`core.level_labels` 를 아래 '설정 손상' 행의 방법으로 손상시켜 확인) |
| 챗 위젯·꺼진 모듈 URL(B) | 챗 모듈을 끄면 위젯이 없다. 꺼진 모듈 URL 은 404. 사이드바 링크는 남아 있다(§2.1) |
| 프로젝트 설정 여섯 범주(C) | 네 크기. 목차·검색이 돌고 저장 바가 마지막 입력을 가리지 않는다. 담당 영역 탭이 없다 |
| 워크스페이스 설정 다섯 범주(C) | 네 크기. 워크스페이스 관리자 계정에는 모듈 허용 구역이 없다 |
| 출처 라벨과 값 불변(C) | 값마다 출처가 보인다. 바꾸지 않고 저장하면 "바뀐 값이 없습니다" |
| 변경 내용 검토(C) | 모듈을 끌 때 데이터 건수와 "삭제되지 않음"이 보인다 |
| 충돌(C) | 두 세션으로 같은 키를 저장해 비교 화면이 뜨고 내 값이 남는다 |
| 필드 오류·패치 거부·설정 손상(C) | 셋이 각자 자리에 뜬다. 손상은 `docker exec supabase_db_d-flow psql -U postgres -c "update public.project_settings set values = jsonb_set(values, '{core.milestone_keywords}', '42') where project_id = '<id>'"` 로 만든다(로컬 DB, 확인 뒤 `db:reset`) |
| 에이전트 허브(C) | 토글이 없고 설정 링크가 있다 |
| 새 프로젝트 — 복사(C) | 복사 범위 문구와 필수 라벨. 손상된 원본은 거부 문구 |
| 로고·accent(C) | 업로드 미리보기, 거부 사유, 기본값으로 되돌리기 |
| `/projects` 의 설정 링크와 `/w/<슬러그>` 404(C) | 워크스페이스 관리자에게만 링크가 보인다. 비소속 계정은 404 |
| 파비콘(C — §5.2 분기가 "메타데이터가 이긴다"일 때만) | `<link rel="icon">` 이 워크스페이스 마크를 가리킨다 |
| 권한 변경 목록(D) | '기록' 범주에 최근 변경이 보이고 워크스페이스 관리자에게 플랫폼 행이 없다 |

## 8. 완료 조건(done_when)

- [ ] `npm run db:reset` 초록(0000→0012), `npm run settings:verify` 종료 코드 0, `tests/invariants/migration-files.test.ts` 초록
- [ ] 롤백 리허설: `compare-catalog.mjs` 두 diff 가 "불일치 0", 기본 권한 diff 출력 없음, 롤백 뒤 재적용 성공. `0012_seed_wide.sql` → `0012_smoke.sql` 통과, `0012_precheck_violations.sql` 의 경우마다 `SP3A_0012_PRECHECK` 로 멈춘다(§3.2)
- [ ] 개정 §2.11 ① — `tests/settings/config-lifecycle.test.ts` 와 `tests/rls/settings-lifecycle.test.ts` 초록
- [ ] 개정 §2.11 ② — `tests/rls/settings-write.test.ts`·`workspace-settings.test.ts`·`settings-rows.test.ts` 초록, `git diff --quiet h2-done -- tests/rls/schema-invariants.test.ts tests/rls/workspace-isolation-cases.test.ts` 가 참(F20 목록과 SP2 불변식 ⓘ·ⓘ′ 무수정)
- [ ] 개정 §2.11 ③ — `tests/modules/effective.test.ts` 초록
- [ ] 개정 §2.11 ④ — `tests/settings/project-isolation.test.ts` 와 `tests/rls/settings-isolation.test.ts` 초록
- [ ] 개정 §2.11 ⑤ — `tests/rls/settings-create.test.ts` 초록
- [ ] 개정 §2.11 ⑥ — `tests/settings/catalog-sync.test.ts` 초록(14키의 상태를 §3.6 표 값의 리터럴과 대조)
- [ ] 개정 §2.11 ⑦ — `tests/invariants/settings-writes.test.ts` 초록
- [ ] `tests/rls/settings-cas.test.ts` 초록(두 연결, 한쪽만 성공)
- [ ] `tests/rls/workflow-parity.test.ts` 초록(`values` 판독, 골든 JSON 공유)
- [ ] `tests/rls/workspace-isolation.test.ts` 초록 — update 탐침이 열 권한이 허용하는 열을 고르고 권한 거부 표 목록이 실측과 같다(H2 이월)
- [ ] `tests/settings/registry.test.ts` 초록 — §1.4 의 G0-4 행 가운데 SQL 디스패처를 뺀 여덟 형태(범주 어휘·구조체·규칙 목록·정의 목록·복합 영향·부수효과·변환 복사·입력≠저장)와 네 선언, 14키만 등록
- [ ] 모듈을 끄면 URL 404·액션 거부·API 404·공유 링크 404 — `tests/gates/enumerate.test.ts`·`deny.test.ts`·`tests/invariants/module-page-gates.test.ts`·`tests/app/share-minutes-gate.test.tsx` 초록과 로컬 E2E 3~5단계
- [ ] 봇 도구 미등록·워커 건너뜀 — `tests/modules/bot-tools-gate.test.ts`·`worker-gate.test.ts` 초록과 로컬 E2E 6단계
- [ ] 워크스페이스가 허용하지 않은 모듈은 프로젝트에서 새로 켤 수 없다 — `tests/modules/effective.test.ts` 와 `config-lifecycle` 의 `CONFIG_INVALID`
- [ ] `tests/settings/no-runtime-constants.test.ts` 가 허용 목록과 함께 초록, `tests/settings/operational-env.test.ts` 초록
- [ ] `tests/nav/nav-for.test.ts`·`tests/ai/ai-available.test.ts`·`tests/modules/agents-gate.test.ts`·`agents-sync.test.ts` 초록
- [ ] 설정 409 에서 내 값 보존·키별 재적용 — `tests/components/settings-conflict.test.tsx` 초록과 눈확인 '충돌' 행
- [ ] `/w/[slug]` 골격과 브랜드 라우트 — `tests/app/w-layout.test.tsx`·`tests/api/brand-route.test.ts` 초록
- [ ] 로컬 E2E(§7.3) 여덟 단계 통과, `docs/baseline/sp3a-e2e.md` 에 기록
- [ ] 권한 변경마다 1행, 같은 명령 id 재전송 1행, 직접 insert 42501, 워크스페이스를 지우면 그 워크스페이스의 권한 기록 0행(플랫폼 행은 남는다) — `tests/rls/authz-events.test.ts`·`tests/actions/authz-events.test.ts`·`authz-events-list.test.ts` 초록
- [ ] `npm run accept:synthetic` 에서 S1·S9 통과, `git diff --quiet -- src supabase` 참, `docs/baseline/synthetic-acceptance.md` 에 기록
- [ ] `tests/rls/isolation-map.ts` 에 새 세 표가 있고 `npm run test:rls` 전체 초록(건너뜀 0)
- [ ] `docs/baseline/sp3a-perf.md` 의 p95 중앙값이 기준 안이다(§7.4)
- [ ] `docs/baseline/sp3a-ui.md` 의 모든 행이 통과이고, 화면 파일을 고친 커밋마다 트레일러가 있다 — `git log --format='%h %(trailers:key=Preview-checked,valueonly)' h2-done..sp3a-done -- 'src/components' 'src/app/**/page.tsx' 'src/app/**/layout.tsx'` 에 값이 빈 줄이 없다
- [ ] `0012` 커밋은 두 파일만 담고 `Staging-verified: local db reset <YYYY-MM-DD HH:MM> — <요약>` 트레일러가 `Co-Authored-By:` 바로 위에 있다
- [ ] `CLAUDE.md` 에 `BOOTSTRAP_MODULES` 한 줄과 권한 절의 관문 문장, `.env.local.example` 에 §5.7 의 이름 전부(`operational-env` 의 (라)), 새 service_role 파일의 분류 — `tests/invariants/admin-scope.test.ts` 초록
- [ ] main 브랜치의 커밋을 스크래치 워크트리에서 돌려 `npm run test`·`npm run lint`·`npm run typecheck`·`npm run build` 초록, push 뒤 GitHub Actions 초록
- [ ] 원장에 Phase 별 실측 노력과 개정 §6.3 총 기간 재산정 문서 커밋이 있고, `git tag -l sp3a-done` 이 태그를 낸다

## 9. 사용자 확인 항목

### 9.1 항목

각 항목은 권고 기본값으로 진행한다. "기한"은 그 Phase 에 착수하기 전이다. 옮긴 항목은 번호를 남긴다.

| # | 질문 | 권고 기본값 | 대안 | 나중에 바꾸는 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | 깊이 제한 값이 비어 있는 프로젝트(앱의 생성·단계 편집을 거치지 않은 프로젝트 — 2026-09-27 로컬 DB 는 4개 전부)에서 단계 이름 수보다 깊은 작업을 계속 만들 수 있게 둘까요? 앱으로 만든 프로젝트는 이미 "최대 깊이 = 단계 이름 수"입니다 | 개정대로 모든 프로젝트의 최대 깊이 = 단계 이름 수(개정 §2.2.2). 이미 더 깊은 작업이 있는 프로젝트가 있으면 이행이 멈추고 단계 이름을 더하라고 안내한다. 외부 API 의 `max_depth` 는 단계 이름 수를 낸다 | 모든 프로젝트에서 깊이 제한을 없앤다(외부 API 는 null) | 기본값 → 대안: 해석기 한 함수. 이행이 옛 깊이 열을 지우므로 Phase A 뒤에는 어느 프로젝트가 비어 있었는지 알 수 없어 프로젝트별 예외는 만들 수 없다 | Phase A |
| 2 | (§1.2 D33 으로 옮김) | — | — | — | — |
| 3 | 권한 변경 기록에 어디까지 남길까요? | 전부 — 관리 화면의 변경, 초대 수락·계정 생성으로 생긴 첫 권한, 시스템이 연쇄로 회수한 권한(워크스페이스에서 빠지거나 프로젝트·계정이 지워질 때)까지. 워크스페이스 삭제 때의 회수는 기록하지 않는다 — 그 워크스페이스의 기록은 삭제와 함께 지워진다(#15) | 관리 화면에서 한 세 가지 변경만(슈퍼유저 지정·해제, 워크스페이스 등급, 명단 권한) | 중간 — 기록 트리거를 고치는 새 DB 변경이 필요하고, 그 사이의 변경은 기록에 없다. 전부 → 좁히기: 이미 남은 기록은 고칠 수 없는 표라 지우지 못한다 | Phase A |
| 4 | 알림 메일의 발신 표시명 기본값에서 " 알림"을 뺄까요? 지금은 "제품명 알림"입니다 | 개정대로 제품명만 | 지금처럼 "제품명 알림"을 기본값으로 둔다 | 낮음 — 소비처 한 줄 | Phase C |
| 5 | 환경 변수로 켜지 않은 배포에서는 위키와 AI 챗을 화면에서 아예 숨길까요? 지금은 플래그가 없어도 위키 화면이 열리고 챗은 옛 방식으로 돕니다 | 정본대로 숨긴다(404). 로컬은 `npm run env:local` 이 플래그를 켠다 | 두 모듈은 늘 가용으로 두고 플래그는 워커와 새 챗만 끈다 | 낮음 — 모듈 목록의 두 줄 | Phase B |
| 6 | 저장은 되지만 새 셸(SP3b)이 와야 화면에 반영되는 설정 — 메뉴 순서·로고·강조색 — 을 SP3a 끝에 관리자에게 보일까요? | 보인다. "화면 반영은 다음 셸 갱신부터"를 함께 적는다 | SP3b 까지 숨기고 서버 액션으로만 검증한다 | 낮음 — 범주 노출 조건 | Phase C |
| 7 | 담당 영역(주간 구분·이슈 영역) 편집 탭을 SP3a 설정 화면에서 숨길까요? 지금은 두 탭이 열려 있지만 영역을 읽는 기능은 아직 없습니다(주간보고는 SP4, 이슈는 SP5 부터 읽는다). 개정은 각 탭을 그 기능이 생기는 SP 에서 열기로 정했습니다(개정 §4.0 R4-7) | 개정대로 숨긴다. 이미 입력된 영역은 지우지 않는다. 주간 구분 탭은 SP4, 이슈 영역 탭은 SP5 가 연다 | 지금처럼 열어 둔다 — 입력한 영역은 SP4·SP5 전까지 어디에도 쓰이지 않는다 | 기본값 → 대안: 표시 조건 한 줄. 대안을 고르면 SP4 이행이 그 사이에 입력된 주간 구분 영역과 코드가 겹치는 경우를 처리해야 한다(유일 인덱스 `(project_id, kind, code)`, 로컬 DB 에 이미 1행) | Phase C |
| 8 | '추가 축 이름' 설정은 지금 어디에도 쓰이지 않습니다. 설정 화면에 보일까요? | 등록하되 쓰는 화면이 생기는 SP 까지 목차에서 숨긴다 | 보이고 엑셀 내보내기 머리글에 바로 잇는다(작업 추가) | 낮음 | Phase C |
| 9 | 프로젝트 비공개 스위치를 누구에게 보일까요? SP2 가 서버 권한을 프로젝트 관리자(워크스페이스 관리자 포함)로 정했는데 화면은 아직 플랫폼 관리자에게만 보입니다 | 지금 그대로(화면은 플랫폼 관리자만, 서버는 SP2 대로) | 프로젝트 관리자에게도 보인다(SP2 의 서버 판정과 맞춘다) | 낮음 — 표시 조건 한 줄 | Phase C |
| 10 | SP3a 화면의 눈확인을 누가 할까요? **개정은 눈확인을 사람의 게이트로 정했습니다**(개정 §6.5.9·R21). 아래 기본값은 그 결정과 다릅니다 — 2026-09-26·27 의 "끝까지 진행" 지시와 H1·H2 의 진행 방식을 따른 것입니다. Phase A·B 의 화면 변경(편집기 셋·새 프로젝트·가져오기 경고·오류 상태·챗 위젯)은 이 답과 무관하게 에이전트가 확인합니다 — 이 항목의 기한이 Phase C 라 그 전에 main 에 들어가기 때문입니다 | 에이전트가 헤드리스 브라우저로 확인하고 스크린샷·기록을 남긴다. 사용자는 기록을 보고 SP3b UI-3 게이트에서 직접 본다 | 개정대로 사용자가 Phase C 체크포인트에서 §7.5 목록을 직접 확인한다(에이전트는 기록을 준비한다) | 기본값으로 가면 main 의 커밋에 `Preview-checked:` 트레일러가 남고 main 이력은 고칠 수 없다. 사람이 나중에 찾은 화면 결함은 SP3b 에서 다시 고친다 | Phase C |
| 11 | (§1.2 D30 으로 옮김) | — | — | — | — |
| 12 | (§1.2 D31 으로 옮김) | — | — | — | — |
| 13 | (§1.2 D32 으로 옮김) | — | — | — | — |
| 14 | (개정 §8.1 #10) 첫 원격 배포는 언제 할까요? 그때까지 로컬 검증 규칙이 유지됩니다 | SP5c 뒤 | 더 일찍 | 앞당기면 그 뒤로는 `0012` 를 고칠 수 없다(R1) | SP5c 종료 |
| 15 | 권한 변경 기록(누가 누구에게 어떤 권한을 주고 거뒀는지)에 사람에 대해 무엇을 얼마나 남길까요? 이 기록과 설정 변경 기록은 고치거나 지울 수 없게 만듭니다 | 계정 id 만 남긴다(이름·이메일 없음 — 화면에는 지워진 계정을 '삭제된 계정'으로). 계정이나 프로젝트를 지워도 권한 기록은 남는다. 워크스페이스를 지우면 그 워크스페이스의 권한 기록도 같은 트랜잭션에서 지운다(DB 트리거 — §6). 플랫폼 관리자 지정·해제 기록은 계정을 지워도 남고 지울 수 없다. 설정 변경 기록의 '바꾼 사람'도 계정을 지운 뒤 id 로 남고, 그 기록은 프로젝트·워크스페이스와 함께 지워진다 | 계정이나 프로젝트를 지울 때 그 권한 기록도 함께 지운다 | 지운 기록은 되살릴 수 없다. 남긴 기록을 나중에 지우려면 새 DB 변경이 필요하다 | Phase A |
| 16 | 워크스페이스 포트폴리오의 마일스톤 표시를 프로젝트마다 다른 키워드로 계속 판정할까요? 개정은 워크스페이스 화면이 프로젝트별 설정을 읽는 것을 금지했습니다(개정 §2.1). 무엇으로 대신하는지는 개정에 없습니다 | 개정대로 프로젝트별 값을 읽지 않는다. 포트폴리오는 모든 프로젝트를 제품 기본 키워드 6개로 판정한다(대신할 값은 개정에 없어 이 문서가 제안한 것이다). 키워드를 바꾸었거나 비워 둔 프로젝트는 대시보드와 포트폴리오의 마일스톤이 다르게 보인다 — 2026-09-28 로컬 DB 는 4개 전부 빈 목록이라(명시 `[]` 로 이행, §3.2) 대시보드에는 마커가 없고 포트폴리오에는 기본 키워드의 마커가 생긴다 | 지금처럼 프로젝트별 키워드로 판정한다(개정 규칙의 예외로 카탈로그에 적는다). 또는 포트폴리오에서 마일스톤 표시를 뺀다 | 낮음 — 포트폴리오 로더의 한 줄 | Phase A |
| 17 | (알림 — 결정 아님) SP3a 의 노력 추정이 개정의 3주를 넘습니다. 일의 목록과 H1·H2 실측으로는 약 4.3~6.3주입니다(A 2~3·B 1~1.5·C 1~1.5·D 0.3). 레인 A 의 SP4 착수가 그만큼 밀립니다 | Phase 구성을 그대로 두고 체크포인트마다 실측을 적어 마감에서 재산정한다(D31) | 범위를 줄인다 — 줄일 수 있는 것은 Phase D 의 앱 배선·읽기 화면(0.3주)과 Phase C 의 로고 업로드다 | 범위를 줄이면 개정 SP3a 블록의 done_when 을 고쳐야 한다 | Phase A |

### 9.2 개정 §8.1 에서 아직 사용자 답이 없는 항목

G0-2 때 닫기로 했으나 명시적 답이 없어 권고 기본값으로 진행 중이다(원장 판정 G0-6-4). SP3a 의 스키마와 화면에는 닿지 않는다.

| 개정 §8.1 | 무엇 | 닫는 시점 | SP3a 와의 관계 |
|---|---|---|---|
| #21 | 다크 모드 선택 자리(계정 팝오버 3단 선택 대 숨겼던 전역 바 아이콘) | SP3b UI-1 착수 전 — SP3a Phase A 기간 안 | SP3a 파일 밖. **SP3a 와 나란히 도는 디자인 작업 전에 필요하다** |
| #3 | 주차 보고가 있는 기존 프로젝트도 다음 주부터 일요일 시작으로 바꾸기 | G0-2(지남) → 늦어도 SP5 Phase A 이행 전 | 레지스트리 모양(§1.4 `weekStart`)은 두 안이 같다 |
| #20 | 저장·공유 보기와 가져오기 매핑 복원을 출시 뒤로 미루기 | G0-2(지남) → 늦어도 SPU2 착수 전 | SP3a 는 `views.*` 키를 등록하지 않는다 |
| #2 | 주차 라벨 규칙 | SP5 착수 전 | SP5 |

## 10. 범위 제외

SP3a 밖으로 옮긴 일 가운데 받는 SP 의 블록에 적혀 있지 않은 것은, SP3a 마감의 문서 커밋이 개정의 그 SP 블록에 한 줄을 더한다("받는 쪽 기록" 열).

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| Sidebar·HeaderChrome·모바일 메뉴·브레드크럼의 `navFor` 소비, `ProjectTabs` 삭제, 셸의 로고·accent 반영, `/p/*` 파비콘, 설정 화면 머리의 배지(`PageHero` 가 그리지 않는다) | SP3b | 이미 있음(개정 §5.12.3) |
| 기존 라우트의 `/w/[slug]` 이동, 전환기, `resolveSoleWorkspaceId` 교체, `/admin/teams`·`/admin/accounts` 의 페이지 게이트 정리 | SP3b | 이미 있음 |
| `portal.widgets`·`views.default` 등록, 봇 경로·딥링크의 레지스트리 파생(`DOMAIN_PATH`) | SP3b | 이미 있음 |
| 사용 현황 메뉴 단언, `PROJECT_SEGMENT_KEYS`, `inferDomain` 의 레지스트리 파생(정본 §3.2.5 의 5·6·9행) | SP3b | 개정 SP3b 블록에 한 줄을 더한다 |
| 워커 산출물의 `settings_revision` 기록(D37) | SP5 | 개정 SP5 블록에 한 줄을 더한다 |
| `wbs.excel_profile` 표준 레이아웃, 진척 null 가중치, `DEFAULT_LEVEL_LABELS`·팀 캐시 폐기, 팀 절의 "전역 팀을 상속" 문구(목록형 행이라 '상속됨' 금지의 대상이 아니다), 가져오기 멱등 표 `command_receipts` | SP4 | 이미 있음 |
| 달력 키·`minutes.root_folders`·어휘 키, 참조 쓰기 트리거의 `FOR SHARE`, `settings_ref_check` 분기, `migrate_setting_code`, `issue_analysis` 모듈, 카탈로그 고정 어휘 절 확정, 복사 경로의 `calendar.week_start` 정규화 | SP5 | 이미 있음(정규화는 §3.3 의 문장을 SP5 블록에 옮긴다) |
| `workflow.*`(`credit_policy` 주입, 합성 R 의 크레딧 표 포함)·`fields.*` | SP5b·SP5c | 이미 있음 |
| `forms.*`, `copy_project_config` 의 `form_templates` 복사 | SP6 | 이미 있음 |
| `agent_projects` 표 drop, `minutes.auto_file_by_path`, 외부 자격증명 | SP7 | 이미 있음 |
| 워커 인증 통일·잡 레지스트리·라우트 흡수, 봇 planner·verifier 의 도메인 주입, 증분 색인 배선, LLM 프롬프트·외부 API 문구의 제품명(D35) | SP8 | 앞의 셋은 이미 있음. 제품명은 개정 SP8 블록에 한 줄을 더한다 |
| 편집 상태 머신 리듀서·동기화 표시·로컬 초안·`security.local_drafts`, 지원용 참조 ID | SPU1 | 이미 있음 |
| 프로젝트 단위 메뉴 재정의 | 계획 없음 | 개정 §8.2 |
| 설정 되돌리기 | 계획 없음 | 대체된 정본 §3.1 의 값(D24) |
| 설정 내보내기·가져오기 | 계획 없음 | 상위 문서에 요구 없음 |

### 10.1 SP3b 에 넘기는 목록

| 넘기는 것 | SP3a 가 끝낸 것 | SP3b 가 할 것 |
|---|---|---|
| `/w/[slug]/layout.tsx` | 슬러그 → 워크스페이스, 비소속 404, 단위 테스트 `tests/app/w-layout.test.tsx` | 2-워크스페이스 E2E 로만 다시 본다(개정 §5.12.3 ★2). 레이아웃을 `UI_RE` 에 더한다 |
| `tests/nav/nav-for.test.ts` | 순수 함수의 조합 테스트 | 셸 소비 케이스를 같은 파일에 덧붙인다 |
| `BrandMark.tsx` 의 `/projects` 규칙 | 마크 없음 규칙으로 바꿈 | 셸 전체에 로고·마크를 반영한다(★8) |
| `src/lib/ai/chat/verifier.ts` | 건드리지 않는다 | `DOMAIN_PATH` 의 경로 접두어(★4). 도메인 주입은 SP8 |
| 파비콘(§5.2 분기가 "덮인다"일 때) | 재어서 기록함 | 워크스페이스별 아이콘 |
| 로고 버킷(§3.2 분기가 "불일치 0 불가"일 때) | 키 등록, 편집기 숨김 | 버킷·업로드·편집기 |

## 11. 리스크

| # | 리스크 | 담는 방법 |
|---|---|---|
| R1 | `0012` 가 크고 뒤 Phase 의 DB 객체까지 담는다. 뒤 Phase 에서 결함이 나오면 이미 main 에 있는 파일을 고쳐야 한다 | 원격 DB 가 없는 동안은 `0012` 를 고치고 리허설·G4 트레일러를 다시 남긴다. 원격이 생긴 뒤에는 금지다. 파일을 나누는 것은 개정 번호표 변경이라 사용자 결정이다 |
| R2 | 가드가 설정 쓰기의 유일한 관문이다(설정 RPC 는 등급을 보지 않는다) | deny 테스트가 설정 액션을 포함, grep 게이트의 닫힌 허용 목록, RPC EXECUTE 는 service_role 만 |
| R3 | 관문 누락은 fail-open 이다(개정 §6.4 R9) | 열거 게이트와 페이지 불변식이 새 export·새 페이지를 막는다 |
| R4 | 관문이 요청마다 두 표를 더 읽는다 | 요청 캐시, §7.4 의 기준. 넘으면 조회를 합치고 다시 잰다 |
| R5 | 넓은 열을 읽던 코드가 남으면 런타임에 깨진다(plpgsql 은 의존성을 추적하지 않는다) | 사후검사의 본문 검사, grep 게이트, `typecheck` |
| R6 | CI 는 빈 DB 에 `migration up` 하므로 이행 분기가 0행으로만 돈다 | 데이터 리허설(`0012_seed_wide.sql`)과 `settings:verify` 를 체크포인트 조건으로 |
| R7 | 트리 깊이·팀 코드 교차 검사는 TS 선행 조회라 저장과 사이에 경합이 남는다 | 개정이 원자 검사를 어휘에만 요구한다. 잔여를 기록하고 해석기가 읽을 때 `invalid` 로 드러낸다 |
| R8 | 이력 불변 트리거가 부모 삭제나 테스트 정리를 막는다 | 부모 부재 면제는 비평 실측으로 성립한다(`critique-feasibility.md` C1 참고). `settings-rows`·`authz-events` 가 프로젝트·워크스페이스·계정 삭제 세 경로를 상시 단언한다. 워크스페이스 삭제는 정리 트리거가 그 워크스페이스의 권한 기록을 지우고 `authz-events` 가 남은 행 0 을 단언한다(§6) |
| R9 | 권한 기록의 원인 판정이 틀린다 | 닫음 — FK 캐스케이드의 깊이는 1 이라 부모 부재로 가른다(비평 실측). `authz-events` 가 네 원인을 각각 본다 |
| R10 | 로고 파일로 스크립트가 들어온다 | SVG 를 받지 않는다(D19). `<img>` 렌더, 응답 헤더 CSP·`nosniff`, 비공개 버킷, 인라인 금지 단언 |
| R11 | 노력이 개정의 3주를 넘는다(E37) | Phase 마다 3주 안이다. 체크포인트마다 실측을 적는다. A 가 3주를 넘으면 그 체크포인트에서 범위 조정안(§9 #17 의 대안)을 사용자에게 올린다(결정은 사용자) |
| R12 | 롤백이 되살리는 0011 원문이 어긋난다 | `apply_workflow_event` 원문은 main `00bfe8c` 의 `0011:676-909` 다. 롤백은 0011 적용 DB 에서 `pg_get_functiondef` 로 다시 떠서 대조한다 |
| R13 | 눈확인이 사람 게이트에서 밀린다(개정 §6.4 R21) | 목록과 도구·계정·크기를 미리 적었다(§7.5). §9 #10 |
| R14 | 프레임워크 동작에 기댄 가정 — 페이지 관문의 `notFound()` 뒤 로더가 돌지 않는다, 메타데이터 아이콘 | 단정하지 않는다. 앞은 로컬 E2E 3단계가 404 응답에 데이터가 없음을 본다. 뒤는 §5.2 의 분기다 |
| R15 | 여러 워크스페이스에 속한 사용자는 SP3b 까지 전역 화면 다섯(`/meetings`·`/minutes`·`/agents`·`/portfolio`·`/usage`)을 열지 못한다(§4.2 의 fail-closed). `/minutes` 는 지금도 그렇다(`minutes/page.tsx:74`) | E2E 기록과 SP3b 인수 목록에 적는다. 로컬 데이터의 다중 소속 계정은 픽스처뿐이다 |
| R16 | 개정이 받던 SVG 로고를 받지 않는다(D19) — 승인된 개정의 값보다 좁다 | 컨트롤러 판정(개정 1차, 브랜딩)의 선택이다. 컨트롤러 보고에 올리고, 사용자가 SVG 를 원하면 D19 의 대안으로 바꾼다 |
| R17 | 로컬 Supabase 스택이 하나다 | Phase 를 순차로 돌리고 성능 측정도 차례로 잰다(§7.4). `db:reset`·`test:rls`·E2E 를 동시에 돌리지 않는다 |
