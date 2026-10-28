# 다른 PC에서 이어서 개발하기 — 에이전트 오피스 실습

작성: 2026-10-23. 이 문서는 실제로 생성한 D-Flow 실습 프로젝트에 개발 PC를 연결하기 위한 메모입니다.

## 실습 프로젝트

| 항목 | 값 |
|---|---|
| 워크스페이스 | 기본 워크스페이스 |
| 프로젝트 | 에이전트 오피스 실습 |
| 프로젝트 ID | `fd5594a0-2c49-4cac-99f1-f7d06cfee33c` |
| 서버 | `https://d-flow-eight.vercel.app` |
| 작업 계획 | [웹 WBS 열기](https://d-flow-eight.vercel.app/p/fd5594a0-2c49-4cac-99f1-f7d06cfee33c/wbs) |
| 에이전트 오피스 | [오피스 열기](https://d-flow-eight.vercel.app/p/fd5594a0-2c49-4cac-99f1-f7d06cfee33c/agents/office) |
| WBS 가져오기 | [마크다운 가져오기](https://d-flow-eight.vercel.app/p/fd5594a0-2c49-4cac-99f1-f7d06cfee33c/import) |

현재 완료: 프로젝트 생성, WBS 단계 `단계 / 묶음 / 작업` 설정, 에이전트 모듈 켜짐 확인.

현재 미완료(2026-10-23 19:45 기준): **샘플 WBS 등록이 중간에 멈춤**. 웹에서 손으로 `PH-01`, `WP-01`, `WP-02`, `TSK-01-01`(명세 비어 있음)까지만 만들어져 있습니다. 남은 일은 TSK-01-01 명세 입력과 TSK-02-01~04 작업·명세 등록입니다.

이어서 할 방법(택1):
- 손으로 만든 4개 항목을 지운 뒤 아래 **올릴 파일** 절차로 샘플 파일을 한 번에 업로드(권장, 중복 방지).
- 또는 웹에서 남은 항목을 직접 추가하고, 명세는 샘플 파일의 requirements/acceptance 문구를 복사.

## 올릴 파일

[agent-office-demo-wbs.md](./agent-office-demo-wbs.md)를 사용합니다. 안내서 자체를 가져오기에 올리면 안 됩니다.

1. 위의 **마크다운 가져오기** 링크를 엽니다.
2. `WBS 마크다운 (wbs.md)` 탭의 **파일 선택**에서 샘플 파일을 고릅니다.
3. 오류가 없고 신규 8건(상위 항목 3개 + 개발 작업 5개)인지 미리보기를 확인합니다.
4. **적용**을 누릅니다.

샘플 파일에는 자동 착수용 `agent` 태그와 담당자 이메일을 넣지 않았습니다. 업로드 뒤 PC별 개발 계정을 담당자로 지정하고, 실행할 작업의 위임을 켜세요.

## PC별로 나눌 작업

| 작업 ID | 작업 | 권장 PC | 변경할 함수 파일 |
|---|---|---|---|
| TSK-01-01 | 이름 정리 함수 | Mac mini 1에서 처음 한 건 시험 | `src/normalize-name.mjs` |
| TSK-02-01 | 합계 함수 | Mac mini 1 | `src/sum-values.mjs` |
| TSK-02-02 | 퍼센트 표시 함수 | Mac mini 2 | `src/format-percent.mjs` |
| TSK-02-03 | 안전한 나눗셈 함수 | Windows PC 1 | `src/safe-divide.mjs` |
| TSK-02-04 | 긴 문장 줄이기 함수 | Windows PC 2 | `src/shorten-text.mjs` |

각 작업의 명세에는 함수 동작, 자동 테스트, 완료 기준과 변경 범위가 들어 있습니다. 서로 다른 함수·테스트 파일을 사용하며 선행 의존성은 없습니다.

## 개발 PC의 연결 값

개발 대상은 별도 `office-demo` 저장소입니다. **아직 GitHub의 실습 코드 저장소나 PC별 개발 계정·PAT를 새로 만들지는 않았습니다.** 최초 준비는 [상세 안내서](./agent-office-four-pc-guide.md)의 3~8절을 따릅니다.

개발 대상 저장소의 `.env`에 다음을 넣습니다.

```dotenv
DFLOW_API_BASE=https://d-flow-eight.vercel.app
DFLOW_PROJECT_ID=fd5594a0-2c49-4cac-99f1-f7d06cfee33c
DFLOW_PATS=해당_PC_개발계정의_PAT_전체
DFLOW_AS=
DFLOW_AUTOMERGE=0
```

토큰은 각 PC 개발 계정의 **내 계정 → 개인 액세스 토큰(PAT)**에서 발급합니다. 스코프는 `work:claim`, 허용 프로젝트는 위 실습 프로젝트를 선택합니다. 토큰은 이 문서나 GitHub에 기록하지 않습니다.

스킬 설치와 프로젝트 초기 준비가 끝나면 터미널에서 연결을 확인합니다.

```bash
sh .claude/skills/dflow-work/scripts/dflow.sh me
sh .claude/skills/dflow-work/scripts/dflow.sh list --scope assigned
```

담당 작업의 주문 ID 앞 8자리를 확인하고 Claude Code 입력칸에서 실행합니다.

```text
/dflow-dev 실제주문ID앞8자리
```

완료 보고는 별도 관리자 계정으로 웹에서 승인합니다. 승인 후 코드 합치기는 Mac mini 1에서 `/dflow-merge`로 차례대로 수행합니다. 네 PC에서 자동 머지 루프를 동시에 시작하지 않습니다.
