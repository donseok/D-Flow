# PL 입력 파일 programs.* (dflow-wbs-nlevel 에서 옮김)

> SKILL.md `### PL 입력 파일 (programs.*)` 절에서 분리.

### PL 입력 파일 (`programs.*`) — dflow-wbs 어댑터 준용 + N단 확장

공통 스키마·한글 헤더 별칭·포맷별 읽기는 dflow-wbs `references/program-list-adapter.md` 를
준용하고, N단 배치를 위해 아래 키를 추가한다:

| 키 | 필수 | 역할 |
|---|---|---|
| `subsystem` | ✅ | SUB 배치 — `접수` → `SUB-{SYS}-IN`. 없으면 에러(N단 필수) |
| `target` | I/F 만 | 상대 시스템 — 인터페이스 Task 는 I/F Subsystem(`SUB-{SYS}-IF`) 아래, WP 는 `target` 하나당 하나(`WP-{SYS}-IF-{약어}`), `group`(선택)은 그 아래 ACT |
| `weight` / `md` | — | 가중치(MD) — 있으면 `w:` 에 그대로 쓴다 |

- `type` → WP 판정: 프로세스/배치→`-PR`, 화면/리포트→`-UI`, 인터페이스→I/F Subsystem 아래 `target` WP.
  PL 모드는 skeleton.yaml 을 읽지 못한다 — 인터페이스 배치는 `target`/`group` 만으로 정하고, 상대 시스템 종류에 따른 분기는 두지 않는다.
- `id` 는 Task 의 `prd-ref: program:{id}` 로 보존 — 재생성 시 기존 Task ID 복원 키.
- 가중치 `w:` — `weight`/`md` 열이 있으면 그 값, 없으면 difficulty 기본 환산(하 2 / 중 3 / 상 5).
  다른 환산이 필요하면 programs 파일 머리에 주석으로 고정한다(아래 SUB 약어와 같은 관례). 생성 리포트에
  `w:` 출처(열 / 기본 환산 / 머리 주석)를 적는다. 인터페이스 Task 는 `credit:if` 자동.
- subsystem 값→SUB 약어 매핑과 target 값→WP 약어 매핑은 최초 등장 시 제안·programs 파일 머리에 주석으로 고정(재실행 안정).
