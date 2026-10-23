# 툴체인 제약 (dflow-wbs)

> 2026-10-19 levels 표기 전환 뒤의 도구 지도. 검증 결과를 곧이곧대로 믿지 말고 아래 범위를 확인한다.

## 새 표기(levels 계약) wbs.md — 이 스킬의 출력

| 일 | 도구 | 비고 |
|---|---|---|
| 구조·표기 검증 | `node .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs validate --wbs {wbs} --role skeleton` | D-Flow 웹 파서(`src/lib/wbsmd/parse.ts`)와 같은 규칙. 서버 상태(기존 트리 깊이·같은 module 의 기존 항목)는 못 본다 — 웹 미리보기가 마지막 관문 |
| import payload | `… wbs-nlevel-parse.mjs export --wbs {wbs}` | 검증 게이트 내장(에러면 JSON 안 나옴). 봉투 `{schema_version: "2.2", module, levels, nodes}` |
| 의존 분석 | export JSON → 어댑터(SKILL.md 10번) → `node .claude/skills/dflow-export/scripts/dep-analysis.mjs {tasks.json} --graph-stats` | 어댑터가 Task 노드를 `{tsk_id, depends, status: "[ ]"}` 로 바꾼다 |
| 엑셀 보고본 | export JSON → 행 배열 → `xlsx-write.mjs` | references/xlsx-export.md |

- `dflow-export` 의 `wbs-parse.mjs`·`wbs-validate.mjs` 는 **옛 표기 전용**이다. 새 표기 파일에 돌리면 Task 를 못 찾는다(`task_count` 0) — 쓰지 않는다.
- export 는 SubTask(STK)를 부모 acceptance 로 접는다. 의존 분석·엑셀에는 Task 까지만 나온다.

## 옛 표기(`### TSK-` 헤딩) wbs.md — 이미 만들어 둔 파일

- 웹 "WBS 마크다운" 탭은 읽지 못한다(levels 선언 없음 오류). 올리려면 `/dflow-export`(API) 경로를 쓰거나,
  이 스킬로 새 표기로 다시 만든다(같은 `module`·ID — references/dflow-integration.md ID 복원).
- 그 파일의 검증·export 는 `dflow-export` 스킬 node 판(`wbs-parse.mjs`·`wbs-validate.mjs`)이 맡는다.

## 그 밖의 제약

| 제약 | 영향 |
|---|---|
| Task ID 는 숫자 세그먼트만(`TSK-03-01`) | 웹 파서는 `TSK-02-01a` 도 받지만 ID 안정성 규칙상 쓰지 않는다 — 분할은 새 숫자 ID + `tags: split-from-XX` |
| 파서는 코드 펜스를 따로 보지 않는다 | 펜스 안이어도 `- [ ] …`·들여쓴 `- key:` 줄은 읽힌다 — 보고 장은 표·문단·mermaid 만 |
| ID 없는 헤딩은 파서 상태를 끊지 않는다 | 보고 장 첫 헤딩 뒤 두 칸 들여쓴 `- key: value` 는 마지막 Task 필드로 붙을 수 있다 |
| `dep-analysis.mjs` 완료 판정 기본값이 `[xx]` 단독 | 생성 시점엔 전 Task `[ ]` 라 영향 없음. 진행 중 상태는 D-Flow 가 정본 — 파일로 재분석하지 않는다 |
