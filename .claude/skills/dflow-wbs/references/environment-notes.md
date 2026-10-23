# 실행 환경·스크립트 위치 메모 (dflow-wbs 에서 옮김)

> SKILL.md 머리말 안내문에서 분리. 원문 그대로.

> 이 리포 `.claude/skills/` 안에서 동작하는 스킬.
> - 스크립트·템플릿·출력 형식 정본(`references/`) = 이 폴더.
> - node 스크립트는 `.claude/skills/` 아래 `_shared/node/`, `dflow-export/scripts/`(`_pystr.mjs`·`wbs-validate.mjs`)를 import. 이 폴더만 복사하면 안 돎 (`_shared`·`dflow-export`·`dflow-wbs-nlevel` 함께 둠).
> - PRD 검증·결정 로그(`prd-validate`·`decision-log`) = 이 스킬 `scripts/`.
> - wbs.md 검증·export = `/dflow-wbs-nlevel` 스킬의 `wbs-nlevel-parse.mjs` (levels 표기 — 2026-10-19 전환). 의존 분석 = `/dflow-export` 스킬의 `dep-analysis.mjs`.
>   `/dflow-export` 의 `wbs-parse`·`wbs-validate` 는 옛 표기 파일 전용. 별도 복사본 없음.
> - dev plugin 없는 PC 도 리포 clone + node(18.17+)만으로 동작. 상대 경로 = 리포 루트가 cwd 전제.
> - `decision-log.mjs append`: `decisions.md.lock` 디렉터리(mkdir 잠금)로 동시 기록 방지. 15초 안에 못 잡으면 종료 코드 1.
>   - 항목 머리 = `## D-<숫자> (<시각>)` 로 줄이 끝나는 줄만 인정 (dflow-merge `decisions.mjs` 와 같은 규칙).
> - 6상태 로컬 워크플로우 서술 제거됨 (2026-08-11 WBS 중앙관리 결정. 옛 로컬 오버라이드는 dev-workflow 리포에서 같은 날 삭제).
