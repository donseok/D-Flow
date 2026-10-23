---
name: dflow-export
description: 로컬 wbs.md 를 검증하고 D-Flow /wbs/import 계약 v2.1 JSON 으로 export 한다 (부트스트랩 1회 import 경로). 트리거 - "/dflow-export", "wbs export", "D-Flow 로 올려", "import payload 만들어". 사용법 - /dflow-export [SUBPROJECT | wbs.md 절대경로] [--project-id UUID --module NAME] [--push]
---

# dflow-export — WBS 부트스트랩 export

로컬 `wbs.md`(옛 표기 — `### TSK-` 헤딩) → D-Flow `POST /api/v1/wbs/import` 요청 본문 생성 (+선택 전송). 새 표기(levels 계약)는 아래 「웹 탭과의 관계」 절.
**스크립트 정본**: 이 스킬 폴더 `.claude/skills/dflow-export/scripts/`. 다른 리포 사본과 무관. 수정은 여기서.
**계약 정본**: `.claude/skills/dflow-work/references/api-contract.md` §"POST /wbs/import" — **v2.1**. 계약과 다르면 계약 우선.

## 인자

- `SUBPROJECT` → `docs/{SUBPROJECT}/wbs.md` (예: `c10`, `bookloop`). 절대경로도 허용.
- `--project-id <UUID>` `--module <이름>`: import 봉투 완성용. 없으면 아래 "D-Flow 프로젝트 바인딩" 순서로 해석.
- `--push`: 실제 전송. **기본 = dry-run** (payload 파일 생성까지).

## D-Flow 프로젝트 바인딩

`dflow-wbs` 스킬(`.claude/skills/dflow-wbs/references/dflow-integration.md` §"D-Flow 프로젝트 바인딩")과 같은 규칙.
wbs.md 자체에 프로젝트 결합 넣지 않음. 파일이 git 으로 복제·branch 되므로 안에 박으면 엉뚱한 프로젝트로 업로드될 위험.

해석 순서 (먼저 맞는 것 우선). 값은 작업 리포 `.env`(dflow-work 스킬과 같은 파일)의 `DFLOW_PROJECT_MAP`·`DFLOW_PROJECT_ID` 에서 읽는다.

1. CLI 인자 `--project-id`/`--module` — 최우선.
2. `.env` 의 `DFLOW_PROJECT_MAP` 에서 현재 `DOCS_DIR`(= `docs/{SUBPROJECT}`) 키 조회.
3. `.env` 의 `DFLOW_PROJECT_ID`.
4. **전부 없으면 업로드·payload 조립 중단** (fail-closed, 추측 금지). export 는 정상 완료. 필요한 키 이름(`DFLOW_PROJECT_ID` 또는 `DFLOW_PROJECT_MAP`)만 안내.

`module` 기본값 = `DOCS_DIR` 마지막 경로 세그먼트 (`docs/c10` → `c10`).

`.env` 값 출력 금지 (같은 파일에 PAT 등 N인분 자격증명 있음). **존재·키 유무만 확인.** 생성·수정 금지.

## PAT

- `DFLOW_PATS`(쉼표 구분, **첫 토큰** 사용) 우선, 없으면 `DFLOW_PAT`.
- **값을 화면·리포트에 절대 출력 금지.** curl 호출도 셸 환경변수 치환만 사용. 리터럴로 풀어 쓰지 않음.

```bash
PAT="$(echo "${DFLOW_PATS:-$DFLOW_PAT}" | cut -d',' -f1)"
```

## 실행 순서

- 모든 명령 전제: **작업 리포 루트 = cwd**, 스킬 폴더 상대경로 사용.
- 임시 파일은 `/tmp` 아닌 **이 세션의 scratchpad 디렉토리**. 경로 하드코딩 금지 (세션마다 다름).

### 1. 검증 게이트 (실패 시 중단)

```bash
node .claude/skills/dflow-export/scripts/wbs-validate.mjs validate --wbs docs/{MOD}/wbs.md
```
- 통과 조건: `ok: true` + `task_count` = 실제 Task 수. 0 이면 헤딩 형식 문제 — 진행 금지.
- 이 게이트는 import 거부 조건을 미리 잡는다 (D-Flow `toRpcNode` 기준).
  - `missing_title`: Task·WP·ACT 헤딩에 제목 없음.
  - `invalid_priority`: `critical|high|medium|low` 가 아님. `-` 와 빈 값은 미지정.
  - `invalid_schedule`: `YYYY-MM-DD ~ YYYY-MM-DD` 또는 `~ YYYY-MM-DD` 가 아님. 없는 날짜도 포함.
  - `invalid_status`: export 가 모르는 `- status:` 표기. 그대로 두면 stage 가 조용히 null 이 됨.
  - `ok: false` 면 2번으로 가지 않는다. 이슈를 고친 뒤 다시 실행한다.
- Task 헤딩 정규식 `#{3,5}`: **3-5단계 헤딩(`###`~`#####`) 모두 TSK 로 인식** (3단계·4단계 WBS 겸용).
- 참고 검사 (선택): Task 목록을 pipe 로 넘겨야 의미 있음. 입력 없이 `--docs-dir` 만 주면 빈 결과.
  ```bash
  node .claude/skills/dflow-export/scripts/wbs-parse.mjs docs/{MOD}/wbs.md --tasks-all \
    | node .claude/skills/dflow-export/scripts/dep-analysis.mjs --docs-dir docs/{MOD}
  ```
  의존 충족 임계는 상태머신이 정함. 6상태 정의면 `[im]` 이상, 5상태 정의/미지정이면 `[xx]` 만 충족.

### 2. Export

```bash
node .claude/skills/dflow-export/scripts/wbs-parse.mjs docs/{MOD}/wbs.md --export > "$SCRATCHPAD/wbs-export-{MOD}.json"
```
봉투: `{"schema_version": "2.1", "source": "...", "nodes": [...]}`. 결정적 출력 (재실행 = byte 동일). `$SCRATCHPAD` = 이 세션 scratchpad 디렉토리로 치환.

### 3. import 본문 조립

export 봉투에 2필드 추가 = 요청 본문:
```bash
node .claude/skills/dflow-export/scripts/wbs-envelope.mjs \
  --in "$SCRATCHPAD/wbs-export-{MOD}.json" --out "$SCRATCHPAD/wbs-import-{MOD}.json" \
  --set "project_id=<UUID>" --set "module=<MOD>" --indent 2
```
- 입력 없음·깨진 JSON·출력 폴더 없음 → 종료 코드 1 + 한 줄 `ERROR:`. 폴더 생성 안 함.
- `--set` 없음 또는 `KEY=VALUE` 형식 아님 → 사용 오류, 종료 코드 2 + 한 줄 stderr.
- `--set` 값은 `"project_id=<UUID>"` 처럼 따옴표로 감쌈 (`<`·`>` 가 셸 redirection 으로 해석되지 않게).
- `--set module=` 값이 `^[A-Za-z0-9_-]{1,32}$` 가 아니거나 `nodes` 가 비었거나 1000건을 넘으면 종료 코드 1 + 한 줄 `ERROR:`. 서버가 400 으로 거부할 입력을 미리 막는 검사다.
- 비 0 종료면 4번(전송)으로 넘어가지 않음.

### 4. 전송 (`--push` 일 때만)

```bash
PAT="$(echo "${DFLOW_PATS:-$DFLOW_PAT}" | cut -d',' -f1)"
curl -sS -X POST "$DFLOW_API_BASE/api/v1/wbs/import" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d @"$SCRATCHPAD/wbs-import-{MOD}.json"
```
- PAT 스코프 `work:claim` 필요 (옛 `work:report` 토큰도 수용, 스코프 폐지 2026-08-25).
- **프로젝트 관리자(admin) 또는 슈퍼유저 전용**. 그 외 역할 = 403 `forbidden_role`.
- `nodes` 최대 `MAX_NODES = 1000` 건. 초과 시 400.
- 404 = 킬스위치(`AGENT_API_ENABLED`) 꺼짐 / 프로젝트 미등록 / PAT principal 이 프로젝트 비멤버. **의도적으로 구분 안 함.**
- 응답 확인: `upserted`/`skipped`/`unmatched_assignees`/`non_leaf_skipped`/`orders_created`.
  - `non_leaf_skipped` = 정상 데이터에서 항상 빈 배열 (task 는 리프가 계약 전제). 값 있으면 비정상 WBS.
  - `unmatched_assignees` 와 `orders_created` 는 서로 독립 (v2.1). assignee 이메일이 roster 에 매칭 안 돼도 task 노드 주문 발행.
- **멱등**: 같은 payload 재전송 = 0건 갱신. 삭제는 절대 안 함.
- **필드 소유권**: 기존 행은 구조·명세만 갱신. `stage`·`assignee`·`actual_pct` 는 서버가 보존. 재업로드해도 진행 상태 초기화 안 됨.

## 웹 "WBS 마크다운" 탭과의 관계 — 표기가 갈린다

- **이 스킬이 다루는 것 = 옛 표기 wbs.md**(`## WP-` 아래 `### TSK-` 헤딩 + 열 0 `- field:` 줄). D-Flow 웹 탭은 이 표기를 읽지 못한다
  ("levels 가 없습니다" 오류) — 이 스킬의 export(API) 경로로 올린다.
- **`/dflow-wbs`(2026-10-19 이후)·`/dflow-wbs-nlevel` 이 만드는 새 표기(levels 계약)** 는 웹 탭에 그대로 올리거나
  `dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs export` 로 payload 를 만든다. 이 스킬의 `wbs-parse.mjs` 는 새 표기를 읽지 못한다(`task_count` 0).
- 옛 표기 파일을 새 표기로 다시 만들 때는 같은 module(`DOCS_DIR` 마지막 세그먼트)과 ID 를 쓴다 — 이미 올라간 항목이 갱신된다.

## 계약 v2.1 요지 (export 가 이미 준수 — 수동 조작 금지)

- `stage`: `as|fp|ip|im|xx` 또는 `null`(미착수 `[ ]`). `todo` 폐기 (서버가 과도기 별칭으로 null 정규화).
  - 레거시 마커 `[dd!]` 는 아직 `todo` 로 방출되나 서버 정규화로 무해. 그대로 둠.
- `priority`: 문자열 label 그대로 (`critical/high/medium/low`). 정수 매핑(100/50/10/0)은 서버 책임.
- `spec_sections` 6키 (requirements[]·test_criteria[]·constraints[]·api_spec·data_model·description), `acceptance[]` 최상위. 서버가 고정 섹션 순서 markdown 으로 조립해 `spec` 저장.
- `dev_workflow`: payload 에 없음. 서버가 `kind:"task"` 자동 ON.
- `depends[]`: 같은 모듈 내 노드 id. 서버 선행 gate: claim 시 선행 stage 가 `im`/`xx` 아니면 403 `dependency_not_met`.

## 상태의 진실 원천

- import 이후 정본 = **D-Flow DB**. `wbs.md` = 최초 작성·부트스트랩 전용.
- 실행 중 Task 는 `docs/tasks/<ID>/state.json` 이 로컬 정본. export 가 이 값으로 `- status:` 를 자동 덮어씀 (`wbs-parse.mjs` 가 `_wbs_status.mjs` 경유, 별도 조작 불요).
- 이 경로 탐색은 스킬 폴더 `scripts/references/state-machine.json` 을 fallback 으로 참조. 스크립트만 옮기고 이 파일 빠뜨리면 깨짐.

## 결과 보고

- `unmatched_assignees` **전량 나열**. 생략 금지 (조회 실패를 데이터 없음으로 위장하지 않는 원칙과 같음).
- 바인딩 미설정으로 업로드 중단했으면 없던 키 이름을 리포트에 남김. 값은 절대 남기지 않음.

## 알려진 제약

→ references/known-constraints.md 「dflow-export — 알려진 제약」 (파일 전체)

## 참조

| 문서 | 읽을 때 |
|---|---|
| references/known-constraints.md | `node --test`·golden·기대값 재생성을 다룰 때, `wbs-envelope.mjs` 의 옛 python 동등성을 볼 때, `--push` 404 를 진단할 때 |
