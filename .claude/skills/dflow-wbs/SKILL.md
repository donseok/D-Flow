---
name: dflow-wbs
description: PRD/TRD 또는 프로그램 리스트(json/yaml/csv/md/xlsx)로 WBS 를 Water-Scrum-Fall 샌드위치 구조로 생성한다. 선행 공정(초기화·기본설계) → 애자일 기능 Task → 후행 통합테스트. 프로그램 1개 = fullstack Task 1개(수직 슬라이스). category 7종(dev/defect/infra/feat/design/research/itest). 출력 wbs.md 는 levels 계약 표기(frontmatter 단계 선언 + 체크박스 Task + 상세 블록)라 D-Flow 가져오기 화면의 WBS 마크다운 탭에 그대로 올라간다. 생성 상태는 항상 [ ] — 상태 전이는 D-Flow(stage)가 정본이며 wbs.md 는 import 부트스트랩용이다. 사용법 /dflow-wbs [SUBPROJECT | /absolute/path/to/wbs.md] [--programs 경로] [--scale large|medium] [--start-date YYYY-MM-DD] [--estimate-only] [--export-xlsx [경로]]
---

# /dflow-wbs - PRD/TRD·프로그램 리스트 기반 WBS 생성 (Water-Scrum-Fall)

> 문체: 산출 문서 → `../_shared/style/Korean-STE-Writing-Guide.md`.

> 상대 경로 = 리포 루트 cwd 전제, node 18.17+.
> - 구조·경계·게이트 규칙 정본 = 대상 리포 `docs/wbs-workflow.md`. 있으면 생성 전 Read. 이 파일과 다르면 그 문서 우선.
> - **상태·전이·배정·진척 정본 = D-Flow.** 이 스킬은 상태를 `[ ]` 로만 생성.
> - wbs.md = 최초 작성·사람 검수·import 부트스트랩 전용. import 후 실행 상태는 D-Flow DB 에서 읽음.
> - **출력 표기 = levels 계약 (2026-10-19 전환).** 정본 = `.claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md` 「쓰기 규칙」.
>   - 이 스킬은 그 계약의 **3~4단 단일 파일**(attach 없음, WP 가 최상위)을 만든다. 검증·export = `dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs`.
>   - D-Flow 웹 파서(`src/lib/wbsmd/parse.ts`)와 같은 규칙 → 가져오기 화면 "WBS 마크다운" 탭에 변환 없이 올라감.
>   - 옛 표기(`### TSK-` 헤딩 + 열 0 `- field:` 줄)는 웹 탭이 못 읽음. 새로 쓰지 않음. 옛 파일은 `/dflow-export`(API)로만 올라감.

## 참조 — references/ Read 시점

| 문서 | 읽는 때 |
|---|---|
| program-list-adapter.md | `--programs` 있을 때 |
| contract-shared-file-rules.md | `tags: contract` Task 를 만들거나 기능 Task 의 requirements/acceptance 를 쓸 때. |
| dflow-integration.md | Task 를 쓸 때(`assignee`·`prd-ref`)와 13번 바인딩 확인 때 (사실상 매번) |
| output-format.md | wbs.md 를 쓰기 전 |
| xlsx-export.md | `--export-xlsx` 있을 때 (14번) |
| success-criteria.md | 12번 출력 검증 뒤 자기 검수 때 |
| toolchain-constraints.md | 검증 결과가 이상할 때, 옛 표기 wbs.md 를 다룰 때, 진행 중 WBS 를 `dep-analysis` 로 재분석할 때 |
| environment-notes.md | 스크립트 import 오류·`decisions.md` 기록 실패·다른 PC 이식 때 |

## 인자 파싱 — 서브프로젝트 감지

인자를 공백 토큰화, 첫 토큰 검사:

1. `/` 로 시작 (절대 경로): 파일 있으면 `WBS_FILE={경로}`, `DOCS_DIR={파일 디렉토리}`, `VIEW_MODE=true`.
   - VIEW_MODE = 내용 전체 표시 후 종료. 단 `--export-xlsx` 있으면 export 실행 뒤 종료.
   - 파일 없으면 에러 후 종료.
2. 토큰 없음 또는 `--` 시작 → `DOCS_DIR=docs`
3. `^(WP|TSK)-` 패턴 → `DOCS_DIR=docs` (토큰 유지)
4. 그 외 → 서브프로젝트 후보.
   - `docs/{토큰}/` 있으면 `SUBPROJECT={토큰}`, `DOCS_DIR=docs/{토큰}`.
   - 없으면 사용자에게 생성 여부 확인 (오타 가능성).

플래그:
- `--scale large|medium`: 규모 강제
- `--start-date YYYY-MM-DD`
- `--estimate-only`: 산정만
- `--programs {경로}`: 프로그램 리스트 입력 모드 (`.json` / `.yaml` / `.yml` / `.csv` / `.md` / `.xlsx`)
- `--export-xlsx [경로]`: WBS 엑셀 보고본 생성. 경로 생략 시 `{DOCS_DIR}/wbs.xlsx`
  - **VIEW_MODE 에서도 동작.** 주 용도 = 기존 WBS 를 재생성 없이 엑셀로만 뽑기.

## 입력 파일 — 모드 두 개

| 모드 | 조건 | 입력 |
|---|---|---|
| **PRD 모드** (기본) | `--programs` 없음 | `{DOCS_DIR}/PRD.md`, `{DOCS_DIR}/TRD.md` — 둘 다 없으면 에러 후 중단 |
| **프로그램 리스트 모드** | `--programs {경로}` 있음 | 그 파일. PRD/TRD 는 **선택** — 있으면 함께 읽어 requirements·tech-spec 보강, 없어도 중단 안 함 |

프로그램 리스트 모드 상세 = 참조 표의 program-list-adapter.md.

### 입력 검증 (자율 보강, 사용자에게 묻지 않음)

PRD/TRD 있을 때만 실행. 프로그램 리스트 모드에서 둘 다 없으면 건너뜀.

```bash
node .claude/skills/dflow-wbs/scripts/prd-validate.mjs validate --target {DOCS_DIR}/PRD.md
node .claude/skills/dflow-wbs/scripts/prd-validate.mjs validate --target {DOCS_DIR}/TRD.md
```

`issues` 있으면:
1. 합리적 가정으로 보강 → `## Assumptions (auto-resolved YYYY-MM-DD)` append.
2. `decisions.md` 에 `phase=prd-resolve` 적재 (`node .claude/skills/dflow-wbs/scripts/decision-log.mjs append`).
3. 재검증 1회.
4. 그래도 남으면 한 줄 알림 후 진행 (흐름 차단 없음).

### 출력 검증 (wbs.md 생성 직후)

```bash
node .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs validate --wbs {DOCS_DIR}/wbs.md --role skeleton
```

- `--role skeleton` = attach 없는 단일 파일. 웹 업로드도 이 파일을 같은 종류(골격)로 판정한다.
- 통과 조건: `ok: true`(errors 0) + `counts` 의 Task 수 = 생성한 Task 수. 다르면 Task 줄 표기가 틀린 것 — 그 줄을 고친다.
- 검증기가 미리 잡는 웹 업로드 거부 조건: levels 미선언·미선언 접두어·ID 중복·`[x]`(STK 외)·제목의 `%`·priority 라벨·`w:` 양수·module 형식.
- warnings 는 리포트에 전량 나열(생략 금지). 4단계에서 WP 직속 Task 가 있으면 "필수층 Activity 건너뜀" 경고 — ACT 아래로 옮긴다.
- 서버 상태(기존 트리 깊이·같은 module 의 기존 항목)는 파일만으로 못 본다 → 웹 미리보기 카드가 마지막 관문.
→ references/toolchain-constraints.md (참조 표 참고).

issue 발견 시: 해당 Task 만 재작성 → 재검증 1회 → `decisions.md` 에 `phase=wbs-resolve` 적재.

## 전체 구조 — 샌드위치 (정본: wbs-workflow.md §1)

```
[선행 공정]                [애자일 반복]              [후행 공정]
WP-01 초기화·공유계약  →   기능 WP × N           →   마지막 WP 통합테스트
WP-02 전체 기본설계        (설계→구현→테스트를        (기능 간 E2E, 성능,
                           Task 안에 내포)            권한 교차, UAT)
```

- 화살표 = 개념 순서. 실제 진행은 게이트 충족 시 구간 겹칠 수 있음.
- **선행/기능 경계**: "2개 이상 기능이 공유하거나, 바꾸면 migration 필요한 것"만 선행.
- **선행 설계는 얇게**: 핵심 엔티티·관계까지만. column 상세는 기능 Task 에 위임.
- **DB(ERD) 설계는 그룹 설계에서 분리해 작게 뗌** — 계약 파이프라인이라서 (계약 Task 의 유일한 선행 = DB 설계).
  - DB 설계가 큰 그룹 설계에 묶이면 계약 동결이 그룹 전체 완료까지 대기.
- **후행/기능 경계**: 기능 Task = 자기 기능 E2E 까지. 통합 WP = 기능 **간** 흐름·성능·permission 교차·이관 리허설만.
- **결함 되돌림**: 통합테스트 결함 → 해당 기능 WP 에 `category: defect` Task 신설.
- 소규모면 WP-02 생략 가능 (WP-01 이 흡수). 기능 WP 2개 이상이면 통합테스트 WP 필수.
  - **프로그램 리스트 모드는 예외 — 기능 WP 1개여도 통합테스트 WP 생성** (`## 프로그램 리스트 입력 어댑터`).

## 계층·규모·ID (정본: wbs-workflow.md §2)

```
Phase → WP → [ACT(4단계만)] → Task → [Sub Task 수동]
```

| 기준 | 대규모(4단계) | 중소규모(3단계) |
|------|--------------|----------------|
| 기간 | 12개월+ | 미만 |
| 팀 | 10명+ | 미만 |
| 기능 영역 | 5개+ | 미만 |
| Task 수 | 50개+ | 미만 |

- 타이브레이커: 2:2 면 4단계 (ACT 제거가 추가보다 쌈).
- **예외**: 모듈 경계 명확한 다모듈 시스템은 규모 미달이어도 ACT 허용 (다모듈 샘플).

| 레벨 | 4단계 | 3단계 |
|------|-------|-------|
| frontmatter `levels` | WP → Activity → Task → SubTask | WP → Task → SubTask |
| WP | `## WP-XX: 제목` | `## WP-XX: 제목` |
| ACT | `### ACT-XX-YY: 제목` | — |
| TSK | `- [ ] TSK-XX-YY-ZZ: 제목 …` (ACT 아래 리스트 줄) | `- [ ] TSK-XX-ZZ: 제목 …` (WP 아래 리스트 줄) |

- 층 판정 = ID 접두어(levels 의 prefix). 헤딩 깊이·들여쓰기는 부모 판정에만 쓰임. Task 는 헤딩이 아니라 **체크박스 리스트 줄**이다.
- levels 선언 두 벌·Task 줄 토큰·상세 블록 = references/output-format.md.

- **모든 레벨 번호 `01` 부터** — `WP-01` · `ACT-XX-01` · `TSK-XX-01`. `00` 은 어느 세그먼트에도 안 씀.
  - 예외: 이미 import 된 wbs.md 가 `WP-00` 으로 시작하면 그대로 둠 (재번호매김 = 중복 행).
- `WP-01` = 초기화 예약. **Task ID 는 숫자만** — 분할 시 새 숫자 ID + `tags: split-from-XX`.
- Sub Task = Task 줄 밑 두 칸 들여쓴 `- [ ] STK-{Task ID 꼬리}-{n}: …` (checklist 층 — 업로드 때 부모 Task 의 acceptance 로 접힘). 생성하지 않고 사람이 단다.

## Task category — 7종 약어 (정본: wbs-workflow.md §3)

**애자일형** (산출물 = 코드+테스트):
- `dev`: 기능
- `defect`: 결함
- `infra`: 인프라·공유 계약·리팩토링
- `feat`: 독립 기능, `/feat` 별도 실행, 의존 그래프 제외

**공정형** (산출물 = 문서·결정·검증 결과):
- `design`: 설계서·ERD
- `research`: 결정 문서, `decisions.md` 반영
- `itest`: 통합테스트 결과서

- 판정 순서: ① 구간 먼저 (선행 WP → design/research/infra, 후행 WP → itest) ② 기능 구간은 산출물로 (코드 → dev/defect/infra).
- `feat` 자동 분류: depends 없음 + fan-in 0 + 코드·계약 공유 없음, 전부 충족 시. feat Task 에 depends 걸기 금지.
- 부가 Task(시드 데이터·fixture·API 키): 공유 범위로 판정.
  - 2+ 기능 공유 → `infra` 선행 분리.
  - 1개 전용 → 해당 기능 Task 에 흡수.

## 상태 — 생성은 `[ ]` 하나 (전이 정본: D-Flow)

- **WBS 생성 시 모든 Task 줄은 `- [ ]`** — 담당자를 알아도 동일. `[x]` 는 SubTask 전용(Task 에 쓰면 검증 에러).
- 진행 중 WBS 를 `dep-analysis` 로 재분석하면 `--docs-dir {DOCS_DIR}` 필수 (근거: references/toolchain-constraints.md 끝).
- 담당 = **입력이 email 을 줄 때만** Task 줄에 `@{email}` 토큰. 그 외 토큰 생략 (규칙: `## D-Flow 연동 표기` 절).

## D-Flow 연동 표기 (정본: 부록 §2.5·§2.6·§7.2)

→ references/dflow-integration.md 요지:
- ID(WP·ACT 헤딩, Task 줄) = import 매칭 키(`{module}/{ID}`) → 재번호매김 금지. frontmatter `module` 도 바꾸지 않음.
- import 성공 후 wbs.md 재생성 금지.
- 사라진 ID 재사용·중간 삽입으로 번호 밀기 금지.
- wbs.md 에 `project_id`·UUID·branch·worktree 경로·`item_owners`·실적% 넣지 않음.
- 작업 리포 `.env`(D-Flow 바인딩·PAT) 는 생성·수정 금지, 값 출력 금지.

## depends 규칙 (정본: wbs-workflow.md §2)

- **FS(Finish-to-Start)만 사용.** SS 등 다른 유형 없음.
- **FS 의존과 일정 겹침 공존 금지** — 검증식: depends 있는 쌍은 `후행 시작일 > 선행 종료일`.
  - 겹치게 계획했으면 의존 제거 또는 일정 밀기.
- fast-tracking = **계약 분리**로 표현: 계획 단계 = 일정 겹침(비의존), 실행 단계 = 계약 동결(contract Task).
- 개발 Task 는 설계 Task 가 아니라 **계약 Task** 에 depends (설계는 전이적 게이트).

**계약 전용 Task 관례** → references/contract-shared-file-rules.md §계약 전용 Task 관례
**공유 계약 사전 분석 (Task 분해 전 필수)**:
1. TRD 4종 스캔 (data-model / API / 타입·스키마 / 이벤트).
2. "2개 이상 feature 참조?"
3. 예 → 계약 전용 Task 선행 분리, feature 들이 depends 연결.
4. 1개 전용 → 수직 슬라이스로 흡수.

## 프로그램 리스트 입력 어댑터 (정본: 부록 §2.6 · DEV-04)

→ references/program-list-adapter.md (참조 표 참고)

### 계약 Task 의 공유 파일 규칙

→ references/contract-shared-file-rules.md (참조 표 참고)

## 엑셀 export (`--export-xlsx`) — 보고본

→ references/xlsx-export.md (참조 표 참고)

## Task 분해 원칙

- UI 있는 기능 = screen+API+전용 DB 를 **하나의 `fullstack` Task** (layer 수평 분할 금지, 큰 screen 은 수직 분할). `entry-point` 필수.
  프로그램 리스트 모드에서는 이 원칙이 **프로그램 1개 = Task 1개**로 구체화 (`## 프로그램 리스트 입력 어댑터`).
- 순수 백엔드 = `backend` 단독, `entry-point` 줄 생략.
- 크기: 최소 4시간 / 권장 1-3일 / 최대 1주.
- `model` 필드: 다중 시스템·아키텍처·보안 핵심 → `opus`, 표준 패턴 → `sonnet`. 항상 명시.

## 일정 계산

| category | 기본 | 범위 |
|----------|------|------|
| dev | 10일 | 5-15 |
| defect | 3일 | 2-5 |
| infra | 5일 | 2-10 |
| design | 5일 | 3-7 |
| research | 3일 | 2-5 |
| itest | 5일 | 3-10 |

depends 기반 시작/종료일 산출. 산출 후 FS+겹침 검증식 통과 확인.

⚠️ 위 표 = **PRD 유래 기능 Task** 기준.
- 프로그램 리스트 모드 기능 Task = 난이도 기반 기간표(하 2 / 중 3 / 상 5 영업일) 사용. 근거 = `## 프로그램 리스트 입력 어댑터`.
- 선행·후행 공정 Task = 모드 무관하게 이 표 사용.

## Dev Config — 쓰지 않는다

levels 표기 wbs.md 에는 `## Dev Config` 블록을 두지 않는다(2026-10-19). 그 블록의 소비자는 옛 표기 툴체인
(`wbs-parse.mjs --dev-config`·`wbs-validate.mjs`)뿐이었고, D-Flow import 는 읽지 않는다. 품질 명령·설계 지침은
대상 리포의 문서(TRD·`docs/wbs-workflow.md`)가 정본이다.

## 실행 플로우

1. **VIEW_MODE** 면 파일 전체 표시 후 종료.
   - `--export-xlsx` 함께 오면 표시 후 14번(엑셀 보고본 생성)만 실행하고 종료. 2-13번 건너뜀.
2. 대상 리포 `docs/wbs-workflow.md` 있으면 Read (규칙 로드).
3. 입력 분석·규모 산정 (`--estimate-only` 면 여기서 종료).
   - PRD 모드: PRD/TRD 분석 → 기존 규모 판별 4기준.
   - 프로그램 리스트 모드: `--programs` 파일 로드 → 정규화 → **검증(중단 조건 먼저)** → 프로그램 수·모듈 수·`group` 유무로 규모 판정. PRD/TRD 있으면 함께 읽어 컨텍스트로만 사용.
4. 계약 Task 목록 확정.
   - PRD 모드: 공유 계약 사전 분석 (TRD 4종 스캔).
   - 프로그램 리스트 모드: 고정 골격 — 전사 계약 1개 + 모듈당 계약 1개(모듈 수 무관). TRD 없으므로 4종 스캔 실행 안 함.
5. WP 매핑 (샌드위치): WP-01 → WP-02(설계, DB 분리) → 기능 WP → 통합 WP.
6. (4단계만) ACT 분해 — MECE, 1-4주.
7. Task 분해 + category/domain/model + PRD/TRD 컨텍스트 주입 (requirements/acceptance 를 자기 완결로. 기술 스펙 상세는 TRD 정본 — `prd-ref` 로 가리킴).
8. 일정 계산 + FS+겹침 검증.
9. `{DOCS_DIR}/wbs.md` 생성 — references/output-format.md 의 levels 표기 그대로 (frontmatter·체크박스 Task·한 줄 필드).
10. 의존 그래프 검증:
    ```bash
    node .claude/skills/dflow-wbs-nlevel/scripts/wbs-nlevel-parse.mjs export --wbs {DOCS_DIR}/wbs.md > {scratchpad}/wbs-export.json
    node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(d.nodes.filter(n=>n.kind==="task"&&!n.milestone).map(n=>({tsk_id:n.id,depends:n.depends.join(", ")||"-",status:"[ ]"}))))' {scratchpad}/wbs-export.json > {scratchpad}/tasks.json
    node .claude/skills/dflow-export/scripts/dep-analysis.mjs {scratchpad}/tasks.json --graph-stats
    ```
    - export 는 검증 게이트를 품는다 — 오류가 있으면 JSON 이 안 나온다(12번 검증부터 고친다).
    - `max_chain_depth > 3`(기능 구간 내부 기준, 공정 양끝 +2 는 구조 비용 허용) 또는 `fan_in ≥ 3` → 계약 추출 재검토.
    - 결과를 `## 의존 그래프` 챕터에 기록 (후보 없어도 "후보 없음" 명시).
    - 같은 자리에서 확인 (자기 리뷰 게이트):
      - 계약 Task(`tags: contract`)마다 acceptance 에 「계약 Task 의 공유 파일 규칙」 고정 네 항목 있음(` / ` 로 이은 한 줄).
      - 기능 Task(`dev`)마다 requirements 에 편집 지점 한 줄 있음.
      - 빠졌으면 고친 뒤 다시 검증.
11. (프로그램 리스트 모드) **`## 입력 매핑 리포트` 챕터 작성** — `## 의존 그래프` 챕터 **앞**에 배치.
    - 다섯 표 전부 작성: 유형 미매핑 · 난이도 미매핑 · 담당 미매칭 · depends 미해결 · route 파생.
    - 해당 없는 표 = "해당 없음" 명시. 비워두지 않음.
12. 출력 검증 — `### 출력 검증` 절 명령(`wbs-nlevel-parse.mjs validate --role skeleton`). errors 0 이 될 때까지 고친다.
13. **`.env` 바인딩 확인** — `## D-Flow 연동 표기` 의 프로젝트 바인딩 절 그대로.
    - 키 유무만 보고 (값 출력 금지).
    - 해석 결과(업로드 가능 / `업로드 불가 — .env 에 DFLOW_PROJECT_ID 또는 DFLOW_PROJECT_MAP 필요`)를 생성 리포트에 남김.
    - 없어도 생성 정상 완료 (fail-closed 는 업로드에만).
    - **실제 업로드는 이 스킬이 안 함.** 리포트에 두 길을 다음 단계로 안내:
      - **웹(사람)**: 가져오기 화면(`/p/{id}/import`) "WBS 마크다운" 탭에 wbs.md 를 그대로 올림 → 미리보기(종류 골격·module·단계 "새로 정함")를 확인하고 적용. 프로젝트 관리자 전용, PAT 불필요.
      - **API(자동화)**: `wbs-nlevel-parse.mjs export` → `dflow-export/scripts/wbs-envelope.mjs --set "project_id=<UUID>"` → `POST /api/v1/wbs/import` (절차·PAT 규칙 = dflow-wbs-nlevel SKILL.md §업로드).
    - ⚠️ attach 없는 파일 = **골격 업로드** → 프로젝트의 WBS 단계 이름을 파일 levels(`WP`·(`Activity`)·`Task`·`SubTask`)로 정한다. 기존 트리가 그보다 깊으면 서버가 거부한다(단계 축소 금지). 리포트에 이 사실을 한 줄로 남김.
    - 옛 표기 파일(이미 `/dflow-export` 로 올린 것)과 같은 `module`·ID 를 쓰면 재업로드는 같은 항목을 갱신한다.
14. (`--export-xlsx` 있을 때) **엑셀 보고본 생성** — `## 엑셀 export` 절 그대로. 실패해도 wbs.md 생성 결과 되돌리지 않음. 실패 사유를 리포트에 남김.

**생성 리포트** — 실행 종료 시 사용자에게 출력하는 요약 (별도 파일 아님 — 파일 산출물 = wbs.md 와 xlsx 뿐). 반드시 담을 것:
- 규모 판정(3/4단계)과 근거
- 검증 결과 요약 (`ok`·`counts`·warnings 전량)
- frontmatter `module` 값과 그 출처(`DOCS_DIR` 세그먼트 / 사용자 지정)
- 담당 미매칭 요약
- `.env` 바인딩 상태 ("설정됨/없음"만 — 값 금지)
- export 결과 (해당 시)

## 출력 형식 (요약)

> 상세 정본 = `.claude/skills/dflow-wbs/references/output-format.md`. **wbs.md 를 쓰기 전에 그 파일 Read.**
> 계약 정본 = `.claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md` 「쓰기 규칙」(두 파서 공통).

```markdown
---
project: 주문관리
module: c10
start_date: 2026-11-02
levels:
  - { name: WP,      prefix: WP,  progress: rollup, report: weekly }
  - { name: Task,    prefix: TSK, progress: input }
  - { name: SubTask, prefix: STK, progress: checklist, optional: true, upload: fold }
---

# WBS - 주문관리

## WP-03: 주문
- [ ] TSK-03-01: 주문 목록 화면 @dev1@example.com w:3 2026-11-09~2026-11-11
  - category: dev
  - domain: fullstack
  - model: sonnet
  - priority: high
  - tags: c10, ui
  - depends: TSK-01-02
  - prd-ref: program:OD001
  - entry-point: /c10/od001 (메뉴: 주문 > 주문 목록)
  - requirements: 주문을 기간·상태로 조회한다; 비고: 엑셀 내려받기 포함
  - acceptance: 조회 조건별 결과가 맞다 / 화면 E2E 가 통과한다
```

### 표기 계약 (어기면 값이 유실되거나 업로드가 거부된다)

1. **파일 첫 줄 `---` + frontmatter**(`project`·`module`·`start_date`·`levels`). `module` = `^[A-Za-z0-9_-]{1,32}$`. levels 는 3단계/4단계 두 벌 중 하나를 그대로, 항목은 한 줄에 하나.
2. **Task = 체크박스 리스트 줄** `- [ ] TSK-…: 제목 [@이메일] w:N 시작~종료`. 헤딩으로 쓰지 않는다.
3. **필드 = Task 줄 밑 두 칸 들여쓴 한 줄** `  - key: value`. 열 가지 키만(category·domain·model·priority·tags·depends·prd-ref·entry-point·requirements·acceptance).
   requirements 는 `; `, acceptance 는 ` / ` 로 항목을 잇는다. 하위 bullet 은 읽히지 않는다.
4. **빈 필드는 줄 생략.** `- field: -` 금지. `status`·`assignee`·`schedule`·`note`·`blocked-by` 줄은 쓰지 않는다(토큰·리포트로 대신).

- WP·ACT 헤딩 아래 필드 줄 금지 (일정·진척은 Task 집계로 파생).
- 보고 장(`## 입력 매핑 리포트`·`## 의존 그래프`)은 표·문단·mermaid 만 — 체크박스·들여쓴 `- key:` 줄 금지.
- 진척율·실적은 입력 안 함 — import 후 진척·실적 정본 = D-Flow. 재업로드해도 웹 값 보존.

## 성공 기준

→ references/success-criteria.md (참조 표 참고)
