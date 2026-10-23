# dflow-export — 알려진 제약

> 출처: `SKILL.md` §"알려진 제약" 을 그대로 옮김. test 실행, E2E·`--push` 404 진단 때 읽음.

- E2E 실사: 대상 D-Flow 서버에 `AGENT_API_ENABLED` 켜져 있어야 가능. 꺼져 있으면 `--push` = 404.
- test: `node --test .claude/skills/dflow-export/tests/` — 통과 = 건강 기준선 (약 3분, 1,100여 건).
  - python 3 있으면 동결 원본(`tests/golden/legacy/*.legacy.py`)과 출력을 byte 까지 비교하는 golden test 도 같이 돎.
  - python 없으면(윈도우) 그 부분만 건너뜀. 미리 계산한 기대값 파일(`tests/golden/expected/`)과 비교.
  - 기대값 재생성: `tests/make-expected*.mjs --write`.
- `wbs-envelope.mjs`(import 본문 조립) = 옛 인라인 python 과 byte 까지 같음. 그 python 두 가지는 `.legacy.py` 파일 아님. `tests/envelope-cases.mjs` 의 문자열(`PY_V1`·`PY_V2`)로 보관. 같은 폴더 `make-expected-envelope.mjs` 가 기대값 생성.
- 동봉 회귀 test: export·validate·status·md·dep-analysis. test_wbs_md_consistency 는 merge-wbs-status.py(이 스킬 범위 밖) 의존이라 제외. 정본은 dev-workflow 리포.
