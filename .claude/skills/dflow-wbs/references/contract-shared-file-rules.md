# 계약 Task 의 공유 파일 규칙 (dflow-wbs 에서 옮김)

> SKILL.md `### 계약 Task 의 공유 파일 규칙` 절에서 분리. 원문 그대로.

## 계약 Task 의 공유 파일 규칙

병렬 기능 Task 가 공유 파일 같은 줄을 서로 다르게 고쳐 개발 branch merge 에서 충돌하는 것을 설계 단계에서 막음.
(2026-09-21 원본 리포 실측: 팀원 8명 중 6건 충돌 — 병렬 머지 충돌 설계 §3).
두 모드의 계약 Task 모두 이 절을 따름.

| # | 규칙 |
|---|---|
| C1 | **기능 Task = 자기 소유 파일만 수정.** 계약 Task 는 design.md 에 `## 기능 Task 편집 지점` 표(기능 Task → 소유 파일)를 두고, 두 기능 Task 가 같은 파일을 소유하지 않게 함. 공유 파일은 이 표에 나오면 안 됨 |
| C2 | **등록 = 자동 수집.** 라우트·핸들러·migration 같은 목록은 디렉터리 스캔(`readdirSync`·glob)이나 파일 이름 관례로 모음. 기능 Task 가 `server.js`·`routes/index.js` 의 import 블록이나 배열에 줄을 더하지 않게 함 |
| C3 | **계약 test = 틀의 존재만 단정.** export 있음, 시그니처 맞음, 탑재 순서 맞음은 단정. "라우터가 비어 있다"·"이 함수는 아직 `not implemented` 다" 는 단정 금지 |
| C4 | **스텁 판정 = 각 함수의 test 가 스스로 함.** 계약 Task 는 기능 Task 마다 자기 test 파일(`tests/routes/<name>.test.*`)을 빈 틀(`it.todo`)로 만들어 둠. 기능 Task 는 그 파일만 채움. 공유 목록(`STUBS`·`IMPLEMENTED`) 두지 않음 |
| C5 | **계약 문서가 지정한 파일은 계약 Task 가 모두 만듦.** 공용 test 헬퍼(`tests/helpers/*`)가 대표 |
| C6 | **횡단 관심사는 계약에서 먼저 연다.** 인증 가드처럼 모든 라우트 동작을 바꾸는 Task 가 있으면, 계약 Task 가 test 헬퍼에 가드 헤더를 처음부터 싣거나 그 Task 를 기능 Task 들의 선행으로 depends 에 걸기 |
| C7 | 공유 파일을 **먼저 들어온 쪽이 새 규약으로 바꾸지 않음.** 규약이 필요하면 계약 Task 가 처음부터 정함 |

C1·C4 = 강제 진행 설계(`2026-09-23-force-progress-design.md`) §3.4 1번과 같은 방향. 그쪽 = 스텁을 둘 **자리**, 이 절 = 계약 Task 가 만드는 **test·등록 구조**.

**생성 산출물에 싣는다.** 계약 Task 구현 워커는 이 스킬을 안 읽음. 규칙이 Task 본문에 있어야 워커에게 닿음.
`tags: contract` Task 의 `acceptance` 끝에 아래 네 항목을 고정으로 붙임 (PRD·프로그램 리스트 모드 공통).
acceptance 는 한 줄이므로 ` / ` 로 이어 붙인다:
```
공유 시험은 틀의 존재·탑재 순서만 단정한다. 빈 라우터·스텁 목록(`STUBS` 등)을 단정하지 않는다 / 기능 Task 마다 자기 시험 파일과 소유 파일을 design.md `## 기능 Task 편집 지점` 에 적고, 두 Task 가 한 파일을 나눠 갖지 않는다 / 등록(라우트·핸들러 목록)은 자동 수집이며 기능 Task 가 공유 진입점에 줄을 더하지 않아도 된다 / 계약 문서가 지정한 파일(공용 시험 헬퍼 포함)이 모두 있다
```
기능 Task(`category: dev`) `requirements` 끝에 `; ` 로 한 항목 붙임:
```
계약 Task design.md 「기능 Task 편집 지점」 의 자기 소유 파일만 고친다
```
표기는 references/output-format.md 상세 블록 규칙(두 칸 들여쓴 한 줄 필드)을 따름.


## 계약 전용 Task 관례 (SKILL.md `## depends 규칙` 에서 옮김)

**계약 전용 Task 관례** (다모듈 샘플 준수):
- `category: infra`, `tags: contract`, 제목에 "(계약 전용)" 접미
- acceptance 에 "실행 로직 없음 (contract-only)" 명시
- 범위: DDL·타입·인터페이스·스키마·이벤트 페이로드 정의만
- 유일한 depends = 해당 DB(ERD)/설계 분리 Task
- 공유 파일 규칙(C1-C7)·acceptance 고정 네 줄 = 위 「계약 Task 의 공유 파일 규칙」 절 (PRD·프로그램 리스트 모드 공통)
