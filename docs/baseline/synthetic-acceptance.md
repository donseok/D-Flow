# 합성 게이트 기록 — `npm run accept:synthetic` (SP3a 마감, S1·S9)

스펙 SP3a §7.3. 고객 이름·실명 없는 합성 구성 둘(R — 연구 과제, C — 건설 현장 · `tests/fixtures/synthetic/configs.ts`)로
**코드를 건드리지 않고 설정만으로 다른 업무 형태를 만들 수 있는지**를 로컬 스택에서 실제 서버 액션으로 단언한다.
러너는 `scripts/e2e-synthetic.mjs`, 구성값은 `scripts/lib/synthetic.mjs`(TS 픽스처와 `tests/scripts/synthetic.test.ts` 가 대조).

측정일 2026-10-01(KST). 트리 `sp3a/phase-d` 의 `d44d1e3`. 전용 스택 `d-flow-sp3a-c-visual`(api 54521 · db 54522) 위에서만 돌렸고 사용자의 메인 스택은 건드리지 않았다.

## 결과

**exit 0 — S1 ✓ · S9 ✓ · S2~S8·S10 '미활성(담당 SP)'** (활성 단계를 건너뛰지 않았다 — D25).
같은 DB 에서 로컬 E2E 30단계(`sp3a-e2e.md` Phase D 절)를 먼저 돌려 통과한 뒤 이어서 돌렸다.

| 단계 | 판정 |
|---|---|
| S1 생성 | 워크스페이스 R·C 와 각 프로젝트를 빈 값으로 만들었다(`createProject` — 필수 설정(단계 라벨)과 생성이 한 트랜잭션, 생성 직후 라벨이 입력값과 같다). 등록 키는 **화면과 같은 서버 액션**으로 넣었다 — 워크스페이스는 `updateWorkspaceSettings`(`modules.allowed`, C 는 `ai.enabled=false` 포함), 프로젝트는 `updateProjectSettings`(`modules.enabled`·`core.milestone_keywords`·`workflow.stage_credits`). 다시 읽은 값이 넣은 값과 같고(JSON 키 순서 무관, 배열 순서는 그대로) 이력이 남는다 — 액션으로 바뀐 키는 `source=edit`·행위자 = 플랫폼 관리자, 생성 때 이미 그 값이었던 키(`modules.enabled` 의 기본값은 워크스페이스 허용 목록에서 나온다)는 생성 행의 값이 기대값이다. 크레딧 표는 R `{as:0, ip:20, rw:30, im:90, xx:100}`·C `{as:0, ip:10, rw:20, im:80, xx:100}` 이 고정 정책에서 유효해 액션이 받았다 |
| S9 격리 | R 의 설정을 바꾼 뒤(프로젝트 `core.milestone_keywords`, 워크스페이스 `ai.enabled`; 프로젝트 revision 2 → 3) **C 의 설정 문서 두 개(전 키·revision)와 이력 두 표가 바이트 단위로 같다**(프로젝트 revision 2·이력 5행, 워크스페이스 revision 2·이력 3행). 다른 워크스페이스 B 의 관리자(`createAccount` 로 만든 계정)는 R·C 의 `project_settings`·`project_settings_history`·`workspace_settings`·`workspace_settings_history` 를 **0행** 읽는다 — 같은 질의를 플랫폼 관리자로 하면 2행이라(대조) 0 이 '표가 비어서'가 아니다. B 관리자가 R 의 설정을 서버 액션으로 바꾸려는 시도는 `대상을 찾을 수 없습니다.` 로 거부되고 R 의 설정은 그대로다 |
| S2~S8·S10 | 미활성: S2 SP4 · S3 SP5b·SP5c · S4 SP4(월)·SP5(일) · S5 SP5 · S6 SP5·SP5b · S7 SP8(봇)·SPU1(개인 알림) · S8 SP6 · S10 SP4~SP8. 건너뜀으로 세지 않는다 — 그 단계가 켜지는 SP 가 러너에 더한다 |

## 소스 청결

스펙은 실행 전후 `git diff --quiet -- src supabase` 가 참이어야 한다고 했다. 러너는 이를 **src 와 스키마(`supabase/migrations`·`rollbacks`·`seed.sql`)의
미커밋 변경 0건**과 **`src`·`supabase` diff 의 지문이 실행 전후로 같음**으로 확인한다. `supabase/config.toml` 은 뺐다 — 전용 로컬 스택을 쓰는 스크래치 워크트리는 그 파일의
포트·`project_id` 만 환경에 맞게 바꿔 두고 커밋하지 않는다(그 파일은 지문에는 들어 있어 실행 중 바뀌면 실패한다). 두 검사 모두 통과했다.

## 실행

```bash
# 전용 스택·dev 서버가 떠 있는 상태(e2e-local.mjs 와 같은 방식, 3101)에서
BOOTSTRAP_PASSWORD=… [BOOTSTRAP_EMAIL=admin@example.com] LOCAL_DB_URL=… npm run accept:synthetic
```

- 워크스페이스 행 셋(R·C·B)과 그 허용 모듈 시드(`apply_workspace_settings`)만 로컬 픽스처다 — 생성 화면은 SP3 라 `service_role` 로 만든다. 슬러그·이메일은 실행마다 초 단위와 무작위 꼬리를 붙여 다시 돌려도 겹치지 않는다.
- 계정 비밀번호(B 관리자)는 실행마다 새로 만들고 출력하지 않는다. 결과는 stdout 에 JSON 한 덩어리.
- 첫 시도 세 번은 러너 결함으로 멈췄다(전용 스택 `config.toml` 을 미커밋 변경으로 봄 / 객체 값의 JSON 키 순서 비교 / 생성 때 이미 그 값인 키의 이력 기대) — 모두 러너를 고쳤고 앱 코드는 바뀌지 않았다.

## SP4 A1 — S1 추가분·S2·S4(월)

스펙 SP4 §6.4. 측정일·트리·스택은 `sp4-e2e.md` 의 A1 절과 같다(같은 DB 에서 로컬 E2E 뒤에 이어서 돌렸다 — 2026-10-02 00:59~01:03 KST, 트리 `70f2a7f`, 전용 스택 `d-flow-sp4`).

**exit 0 — S1 ✓ · S1 추가 ✓ · S9 ✓ · S2 ✓ · S4(월) ✓ · 미활성 S3·S4(일 — SP5)·S5~S8·S10.** 활성 단계를 건너뛰지 않았다(D25).

| 단계 | 판정 |
|---|---|
| S1 추가(`S1-teams-areas`) | C 구성에 `weekly`(프로젝트 `modules.enabled`·워크스페이스 `modules.allowed` 둘 다 — D40). 팀 R `RES`·`OPS`, C `CIV`·`MEP`·`SAF` 를 `addProjectTeam` 으로(이름 = code — 개명은 SP4 A2·B), 주간 영역 R 셋·C 넷과 담당 팀을 `upsertArea`(설정 화면의 편집기와 같은 액션)로 — 다시 읽은 code·이름·순서·활성·담당 팀이 넣은 값과 같다(R 영역 `EXP`·`DATA`·`RUN`, C 영역 `WORK`·`SAFE`·`QUAL`·`MATL`) |
| S2(`S2-wbs-import`) | R 4단(양식 예시가 3단이라 러너가 exceljs 로 직접 만든 파일)·C 3단(양식 다운로드에 채운 파일)을 양식 저장과 함께 가져왔다. 같은 `commandId` 재전송은 `kind: 'duplicate'`·같은 건수, 항목은 한 벌, `wbs.excel_profile` 이력은 1건(R 5건·C 4건, 이력 각 1) |
| S4(월)(`S4-weekly-monday`) | C 에서 이번 주·다음 주 문서를 만들었다 — DB 의 `week_start` 가 월요일이고 7일 간격(주 키는 앱의 `mondayIso` — W30). 1주 차 차주 계획이 2주 차 같은 영역의 금주 실적으로 이월됐고, 영역 하나를 개명한 뒤 `area_id`·두 주의 행·셀이 그대로다(`2026-09-28`·`2026-10-05`, 둘 다 `created`, 행 수 `[4,4]`) |

`src`·`supabase` 의 미커밋 변경은 실행 전후 0 이고 diff 지문이 같다(`git diff --quiet -- src supabase` 참).

같은 체크포인트의 첫 실행(트리 `9852c09`)은 S2 에서 409 `NEEDS_TEAMS`(`needsTeams: ['*']`)로 멈췄다 — 양식 저장 요청이 팀명 직접 방식의 표지 `'*'` 를 미등록 팀으로 센 앱 결함이었고
`70f2a7f` 가 고쳤다(`sp4-e2e.md` A1 절 비고 ①). 러너는 바뀌지 않았다.

## SP4 A2 — S10(SP4 부분)·경계 행렬 SP4 행

스펙 SP4 §6.4(S10)·W37·W39. 측정일·트리·스택은 `sp4-e2e.md` 의 A2 절과 같다(같은 DB 에서 `next start` 로컬 E2E 뒤에 이어서 돌렸다 — 2026-10-02 08:10 KST, 트리 `6b1f7aa`, 전용 스택 `d-flow-sp4`, 서버 `next start -p 3101`).

**exit 0 — S1 ✓ · S1 추가 ✓ · S9 ✓ · S2 ✓ · S4(월) ✓ · S10-negative ✓ · boundary-sp4 ✓ · 미활성 S3·S4(일 — SP5)·S5~S8·S10(나머지).** 기록의 `pending.S10` 은 `SP5~SP8(나머지 부분 집합)`. 활성 단계를 건너뛰지 않았다(D25).

### S10(SP4 부분) — 출력에 옛 기본값 0

일치 규칙은 `scripts/lib/sentinels.mjs` 하나(대소문자·영문 코드 경계·마스크·zip 텍스트 파트). 등록 이름과 **같은** 센티널만 뺐다 — C 의 영역 이름 '품질'(11구분명과 같다 — D8).
교차는 다른 쪽 프로젝트의 팀 code(①~④). ⑤ 화면 HTML 은 R·C 각자의 **명단 밖 워크스페이스 관리자**로 받았고(앱 셸의 보는 사람 소속 팀 — F-1), 그 HTML 에 그 프로젝트의
내용이 실제로 그려졌는지(주간 = 활성 영역 이름 전부, WBS = 루트 항목 이름 전부)를 함께 단언한다(W1).

| 구성 | ① 응답 본문 | ② 시트 PPT | ③ 기본 주간 보고서 | ④ WBS 엑셀 | ⑤ 화면 HTML | 대상 수 | 적중 | 교차 |
|---|---|---|---|---|---|---|---|---|
| R | 2(주간 생성·가져오기 감지) | 0 — 이번 주(09-28) 빈 문서, 앱 400 '해당 주차에 작성된 내용이 없습니다'(`emptyWeeks`) | 2(xlsx·pptx) | 1(접기) — 펼침은 저장 아웃라인 양식이라 앱 400 미지원(`unsupportedExports`) | 2(주간·WBS) | 7 | 0 | 0 |
| C | 2 | 2(09-28·10-05) | 2 | 1(접기) — 펼침 미지원 400 | 2 | 9 | 0 | 0 |

- ⑤ 그려짐(W1): R 주간 '실험'·'데이터'·'운영', WBS '합성 1' / C 주간 '공정 관리'(S4 개명 뒤)·'안전'·'품질'·'자재', WBS '합성 1' — 모두 있음.
- 판정 밖 기록(`adminShell`): 플랫폼 관리자 세션의 같은 네 화면에 'ERP' — 위치는 모두 셸의 `"teamCodes":["ERP","OPS","QA"]`(그 계정의 E2E 명단 대표 팀). F-1 의 원인 확정(`sp4-e2e.md` A2 절).
- 계획의 기대 "대상 수 R·C 각각 ≥ 8" 과 다르다(R 7) — 앱이 낼 출력이 없는 대상 둘(빈 주차·아웃라인 펼침) 때문이다(`sp4-e2e.md` A2 비고 ②).
- R 의 ② 시트 PPT 는 0장이다 — R 시트 PPT(영역 실험·데이터·운영)의 센티널 0 증거는 이 게이트에 없고 A1 E2E `weekly-outputs`(B 프로젝트) 하나뿐이다. R 에 내용 있는 주차를 만드는 S10 R 시트 PPT 는 SP5 의 일요일 키 합성(S4 일)에서 채운다(A2 최종 리뷰 완료 P3-4).

### 경계 행렬 SP4 행(W39)

| 구성 | 설정 없음(새 빈 프로젝트) | 비활성 유형(둘째 주간 영역 비활성) | 데이터 있는 개명 |
|---|---|---|---|
| R | 주간 생성 `CONFIG_REQUIRED` ✓ · 문서 0 ✓ · 엑셀 표준 ✓ · 설정 화면 표기 ✓ | 이월 대기(CARRY_PENDING)에 그 영역 ✓ · 활성 목록에서 빠짐 ✓ · '옮기지 않음' 뒤 새 주차에 행 없음 ✓ · 과거 행 남음 ✓ | 영역 `area_id` 그대로 ✓ · 셀 행 있음 ✓ · 같은 셀 ✓ · 팀 id·code 그대로 ✓ |
| C | ✓ · ✓ · ✓ · ✓ | ✓ · ✓ · ✓ · ✓ | ✓ · ✓ · ✓ · ✓ |

스펙 §6.4 행의 "팀 개명 → 팀 id 불변·**봇 이름 매칭**" 가운데 이 게이트는 앞 절반(팀 id·영역·셀 불변)만 본다. 봇 이름 매칭(개명한 이름으로 그 팀을 찾는다 — W27)은
단위 `tests/ai/chat-v2-router.test.ts` 로 갈음한다: 합성 러너는 챗 라우트를 부르지 않는다(`scripts/e2e-synthetic.mjs` 에 챗 호출 없음) — 봇의 end-to-end 는
SP8(봇 테스트 정비)의 몫이다(A2 최종 리뷰 완료 P3-3 — 계획 과제 22 는 이 절반을 구현 대상에 넣지 않았다 — 스펙 §6.4 행에 정오표).

`src`·`supabase` 의 미커밋 변경은 실행 전후 0 이고 diff 지문이 같다(`git diff --quiet -- src supabase` 참).

같은 체크포인트의 앞 두 실행(`6f0e52b`·`9817810`)은 S10 ②(빈 주차 400)와 ④(아웃라인 펼침 400)에서 멈췄다 — 둘 다 앱의 정당한 거절을 200 으로 기대한 러너 결함이었고
`f144c29`·`6b1f7aa` 가 러너만 고쳤다. 앱 코드는 바뀌지 않았다.

## SP4 B(마감) 실행

스펙 SP4 §7 B("`accept:synthetic` 에서 S1·S2·S4(월)·S9·S10(부분)·경계 행렬 SP4 행 통과, 기록"). 2026-10-03 06:05 KST, 트리 `ui/sp4-screens` **`170b7edf`**,
전용 스택 `d-flow-sp4`, 서버 스크래치 워크트리의 `next start -p 3101` — `sp4-e2e.md` B 절의 로컬 E2E(50단계) 바로 뒤 같은 DB 에서 돌렸다.

**exit 0·`ok: true` — 15단계 실패 0, 빠진 필수 0.** B 는 합성 러너와 마이그레이션을 바꾸지 않았다 — A2 와 같은 단계를 B 의 화면·원천 위에서 다시 돈 것이다.

| 단계 | 결과 |
|---|---|
| `S1-create` | ✓ |
| `S1-teams-areas` | ✓ |
| `S9-isolation` | ✓ |
| `S2-wbs-import` | ✓ |
| `S4-weekly-monday` | ✓ |
| `S10-negative` | ✓ R 대상 7·C 대상 9, 적중 0·교차 0, ⑤ 그려짐 R·C 모두 ok, 빈 주차 R 1(09-28 — 앱 400)·펼침 미지원 R·C 각 1(앱 400 — A2 와 같다). `adminShell`(플랫폼 관리자 세션, 판정 밖) 적중 0 — A2 의 'ERP'(셸 `identity.teamCodes`) 가 이번에는 없다 — 판정 밖이라 원인은 따로 확인하지 않았다(적중이 줄어든 쪽이라 누출 판정에 영향 없음) |
| `boundary-sp4` | ✓ R·C 각 12값(설정 없음 넷·비활성 유형 넷·데이터 있는 개명 넷) 모두 true |
| 미활성 | `S3`(SP5b·SP5c)·`S4`(일 — SP5)·`S5`(SP5)·`S6`(SP5·SP5b)·`S7`(SP8 봇·SPU1 알림)·`S8`(SP6)·`S10`(SP5~SP8 나머지 부분 집합) |

`src`·`supabase` 의 미커밋 변경은 실행 전후 0(`git diff --quiet -- src supabase` 참 — 실행 전·뒤 둘 다). 실행 뒤 `settings:verify` exit 0(프로젝트 12·워크스페이스 5·문제 0).

## SP5 A — 2026-10-03

- 러너 `scripts/e2e-synthetic.mjs`, 서버 3101(스크래치 `next start`), 체크포인트 HEAD `5d207d06` — `sp5-e2e.md` A 체크포인트 절의 로컬 E2E(54단계) 바로 뒤 같은 DB(08:20 KST). 실행 전후 `git diff --quiet -- src supabase` 참.
- **exit 0·`ok: true` — 실패 0, 빠진 필수 0.**
- 켠 단계: `S1-calendar`(R LA·월~금·일요일 / C 베를린·월~토·월요일 + 10/10 휴무·10/25 근무 — 설정·일정 화면과 같은 액션) ✓, `S4-weekly-sunday`(R 연속 2주·이월·영역 개명 — 일요일 키) ✓,
  `S5-calendar` ✓(계획% R 10-12 A 60 · 10-26 B 60 / C 10-12 A 60 · 10-26 B 67 — 기대 60·60 / 60·67, 판별적 시각 R 아니오·C 예 — 서버 tz 경로 근거로 쓰지 않는다), `S10-negative` ✓(시간대 센티널 `Asia/Seoul`·`+09:00` 적중 R·C 0, 내용 적중 0·교차 0).
- 기존 단계 ✓: `S1-create`·`S1-teams-areas`·`S9-isolation`·`S2-wbs-import`·`S4-weekly-monday`·`boundary-sp4`.
- 미활성(건너뜀 아님): `S3`(SP5b·SP5c)·`S6`(SP5 B1·SP5b)·`S7`(SP8·SPU1)·`S8`(SP6)·`S10` 나머지(SP5 B1·B4~SP8).
- 1회차(`0431001e`, 08:16)도 ok — E2E 의 `calendar-tz` 러너 결함과 무관하게 같은 판정이었다. 실행 뒤 `settings:verify` exit 0(프로젝트 17·워크스페이스 5·문제 0).


## SP5 B1 — 2026-10-03

- `scripts/e2e-synthetic.mjs`, 전용 3102 `next start`, source HEAD `4eb5fe81`; **exit 0, `ok:true`, 18/18**. 확인한 활성 단계: `S1-issues`, `S6-issue-codes`, `S10-negative`, `S6-pending`, `S10-pending`; SP4 단계 포함 전체 18단계 통과.
- S10 음성 검사에서 R 대상 7·C 대상 9, 적중·교차 모두 0. 화면 증거는 `weekly_section`만 대상으로 삼아 issue-area 원자료를 주간 출력으로 오인하지 않는다. 합성 영역명 `QA 검사`는 SP4 센티널 단어와 충돌하지 않도록 정했다.
- 실행 전후 `git diff --quiet -- src supabase` 참. 검사는 로컬 합성 데이터만 사용했다.

## SP5 B2 — 2026-10-04

- `scripts/e2e-synthetic.mjs`, 서버 3101 `next start`, `sp5/b2` 묶음4 커밋 위(14:26 KST). **exit 0, `ok:true`, 19/19** — B4 의 `S1-vocab` 포함 전 단계 통과, 실패 0·빠진 필수 0.
- B2 는 새 합성 단계를 더하지 않았다 — 회의록 팀 루트·비활성 거부는 로컬 E2E `minutes-teams` 단계(`sp5-e2e.md` B2 절)와 RLS `minutes-teams` 계열이 본다. `S10-negative` 적중·교차 0.
- 실행 전후 `git diff --quiet -- src supabase` 참.
