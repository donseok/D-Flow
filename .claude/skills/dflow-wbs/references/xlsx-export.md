# 엑셀 export (dflow-wbs 에서 옮김)

> SKILL.md `## 엑셀 export (--export-xlsx)` 절에서 분리. 2026-10-19 levels 표기 전환에 맞춰 데이터 출처를 바꿈.

## 엑셀 export (`--export-xlsx`) — 보고본

정본 = `wbs.md`. xlsx = **읽기 전용 파생 산출물.** wbs.md 로 되돌리지 않음 (부록 §2.6 — 바이너리는 diff·merge·검수 불가).

**용도 = "import 전 사람 검수" 하나.**
- wbs.md 는 import 후 은퇴 → wbs.md 기준 엑셀 = import 시점 snapshot, 곧 낡음.
- 운영·대외 보고본 = D-Flow export (DB 기준).
- 검수 결과 수정 = **입력 프로그램 리스트나 wbs.md 를 고쳐 재생성.** 엑셀 수정 금지.

### 데이터 출처 — export JSON 한 번

wbs.md 를 직접 파싱하지 않는다. 검증기 겸 export 를 한 번 돌려 노드 배열을 얻는다:

```bash
node .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs export --wbs {wbs} > {scratchpad}/wbs-export.json
```

- `nodes` = WP·(ACT)·Task 노드, **파일 등장 순**. 각 노드에 `id`·`parent_id`·`level`·`title`·`category`·`domain`·`model`·`priority`·
  `assignee`·`schedule`(`시작 ~ 종료`)·`depends[]`·`tags[]`·`prd_ref`·`entry_point`·`acceptance[]`·`weight` 가 있다.
- 레벨 열 = `levels[node.level].prefix`(`WP`/`ACT`/`TSK`). 부모 귀속 = `parent_id` (ID 세그먼트로 유도하지 않는다).
- SubTask(STK)는 노드로 안 나오고 부모 Task 의 `acceptance` 에 `[ ] …` 항목으로 접혀 있다.
- export 가 실패하면(검증 오류) 엑셀을 만들지 않고 그 오류를 리포트에 남긴다.
- 옛 표기 wbs.md(VIEW_MODE)는 levels 선언이 없어 export 가 실패한다 → "옛 표기 — 새 표기로 다시 만든 뒤 export" 를 리포트하고 끝낸다.
- ⚠️ 상태는 파일에서 읽지 않는다. 생성물은 전 Task `- [ ]` 이고 진행 상태의 정본은 D-Flow 다.

### 컬럼

| # | 컬럼 | 출처 |
|---|---|---|
| 1 | 레벨 (`WP`/`ACT`/`TSK`) | `levels[level].prefix` |
| 2 | ID | `id` (= D-Flow `external_ref` 의 `{module}/` 뒤) |
| 3 | 제목 | `title` |
| 4 | category | `category` |
| 5 | domain | `domain` |
| 6 | model | `model` |
| 7 | 상태 코드 | Task 행 `[ ]` (생성물 전부) |
| 8 | 상태 | `docs/state-machine.json` 의 `states["[ ]"].label` — **하드코딩 금지, 그 파일에서 읽는다** |
| 9 | 담당 | `assignee` |
| 10 | 시작일 | `schedule` 의 ` ~ ` 앞 |
| 11 | 종료일 | `schedule` 의 ` ~ ` 뒤 |
| 12 | 영업일 | 시작~종료 영업일 수 (주말 제외) — 숫자 |
| 13 | depends | `depends` 를 `, ` 로 이음 |
| 14 | entry-point | `entry_point` |
| 15 | prd-ref | `prd_ref` |
| 16 | tags | `tags` 를 `, ` 로 이음 |
| 17 | 진척(파생) | `docs/state-machine.json` 의 `progress` 블록으로 환산 — 숫자 |
| 18 | acceptance | `acceptance` 를 ` / ` 로 이음 |

- **17번 = 파생값.**
  - `category` 가 `progress.agile.applies_to` 에 있으면 `progress.agile.state_weights[상태코드]`.
  - `progress.process.applies_to` 에 있으면 `progress.process` 규칙(`pre_accept_cap` 포함) 적용.
  - **환산표 스킬·스크립트 하드코딩 금지** — `state-machine.json` 의 `progress._comment` 가 금지.
- **`docs/state-machine.json` 이 대상 리포에 없으면**:
  - 8번 = 상태 코드 그대로, 17번 = `[ ]` = 0.
  - 리포트에 그 사실을 남김 (import 전 검수용 snapshot 은 전 Task `[ ]` 라 실질 손실 없음).
- WP/ACT 행:
  - 4-9·13-16·18 = 비움.
  - 10·11 = `parent_id` 로 귀속된 하위 Task 의 최소 시작일·최대 종료일.
  - 12·17 = 그 하위 집합에 `progress.rollup` 규칙(영업일 가중 평균) 적용.
  - 하위 없는 WP/ACT = 10-12·17 비우고 리포트에 나열.
- **실적%·진행률 사람 입력 컬럼 만들지 않음.**
- **1행 = 헤더 고정** (도구 호환 — 위에 주석 행 금지). 디스클레이머 = **마지막 데이터 행 다음 한 줄** A열:
  `import 전 검수용이다 — wbs.md 기준이며 D-Flow 실적·배정은 반영되지 않는다. 운영 보고본은 D-Flow export 를 쓴다. 이 파일을 고쳐도 정본에 반영되지 않는다.`

### 쓰기 — 의존성 0

행 배열을 JSON 으로 만들어 스크립트에 넘김 (node 만 필요, 의존성 0 — zip 은 스크립트가 직접 씀):

```bash
node .claude/skills/dflow-wbs/scripts/xlsx-write.mjs --out {경로} < rows.json
```

- 입력 `rows.json` = 행 배열 `[[헤더…], [셀…], …]` (첫 행 = 헤더). 셀 = 문자열 또는 숫자. 파일 경로 인자도 가능 (`… --out {경로} rows.json`). 숫자(12·17번 컬럼) = JSON 숫자.
- 문자열 셀 = `t="s"`(sharedStrings), 숫자 셀 = `t` 속성 없음. 공유 문자열 중복은 하나로 합침. 출력 경로 부모 폴더 없으면 만들고, 파일 있으면 덮어씀.
- **열 최대 26개(A-Z).** 이 문서 표 = 18열이라 충분. 27열 이상이면 종료 코드 1 + 짧은 stderr. 입력 JSON 이 잘못돼도 종료 코드 1, 파일 안 만듦.

XML 이스케이프(`&`·`<`·`>`·`"`·`'`)는 스크립트가 처리 — Task 제목에 `&`·`<` 있어도 XML 안 깨짐.
- XML 이 문자로 허용 안 하는 제어 문자(`0x00~0x08`·`0x0B`·`0x0C`·`0x0E~0x1F`)·`U+FFFE`·`U+FFFF`·짝 없는 서로게이트 = XLSX 관례 `_xHHHH_`(대문자 16진 4자리)로 인코딩.
- 원문의 `_x0041_` 같은 글자는 `_x005F_x0041_` 로 밑줄 이스케이프. `xlsx-read.mjs` 가 읽을 때 되돌림.
- 엑셀은 이 표기를 원래 글자로 열고, 일부 뷰어는 표기 그대로 보임.
- 이 스크립트는 파일이 어느 엑셀·뷰어에서나 열린다고 보장 안 함. 확인한 것 = XML 해석 가능성과 이 저장소 읽기 스크립트로의 왕복뿐 (엑셀 실물 열기 test 안 함).
- 서식(열 너비·틀 고정·색)은 이 절 범위 밖.

### 순서와 실패 처리

- 행 순서 = export `nodes` 순서(= wbs.md 등장 순서) — WP → (ACT) → 그 하위 Task.
- export 실패: 엑셀을 만들지 않는다. 검증 오류를 리포트에 전량 나열 (에러 3원칙: 실패를 "데이터 없음"으로 위장 안 함).
- 출력 경로에 파일 있으면 덮어씀. 정본 아니므로 백업 안 함.
