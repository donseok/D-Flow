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
